/* 네트워크 경로 지연·PPS 실측 — 5편 창작 수치 "2.5~4.0µs / 25~40µs" 대체
 *
 * 발행본은 오버레이 왕복 세금을 출처 없이 단언했다:
 *   "VM-Exit 2회(~1.0µs) + OVS 탐색(~1.2µs) + LLC 스톨(~0.3µs) = 왕복당 2.5~4.0µs"
 * 세 항목 어느 것도 측정된 적이 없다. 여기서는 경로를 티어로 쪼개 차분으로 잰다.
 *
 * 방법 — 티어 차분(差分):
 *
 *   같은 프로브·같은 페이로드로 경로만 바꿔 재고, 인접 티어의 차이를 그 계층의
 *   비용으로 귀속한다. 단일 티어의 절대값은 커널 스택·NIC 에뮬레이션·스케줄링이
 *   전부 섞여 있어 그 자체로는 아무것도 증명하지 못한다.
 *
 *     l0-veth        netns <-> netns, Linux bridge      = 소프트웨어 스위칭 바닥
 *     l0-ovs         netns <-> netns, OVS               - l0-veth = OVS 플로우 탐색
 *     l0-ovs-geneve  netns <-> netns, OVS + GENEVE      - l0-ovs  = 캡슐화
 *     l1-bridge      guest <-> guest, virbr0            - l0-veth = 가상화 경계
 *     l1-ovs         guest <-> guest, OVS
 *     l1-ovs-geneve  guest <-> guest, OVS + GENEVE      - l1-ovs  = 캡슐화(가상화 위)
 *
 *   핵심 질문은 절대값이 아니라 **증분의 비교**다:
 *     (l1-ovs-geneve - l1-ovs) > (l0-ovs-geneve - l0-veth) 인가?
 *   이것이 참이어야 "가상화가 오버레이 세금을 증폭한다"는 발행본 주장이 성립한다.
 *   §8.9에서 LLC 절벽이 가상화 고유가 아니었던 것과 같은 형태의 대조다.
 *
 * 측정 위생:
 *   - 양단 모두 CPU 하나에 고정(sched_setaffinity). 마이그레이션이 µs를 흔든다
 *   - **busy-poll 수신**(논블로킹 + 스핀). blocking recvfrom의 깨우기 비용은
 *     수 µs로 측정 대상보다 커서 티어 간 차이를 덮어 버린다
 *   - 워밍업 표본은 버린다(ARP·이웃 탐색·플로우 테이블 미스가 첫 패킷에 몰린다)
 *   - 평균이 아니라 **분위수**. 선점당한 표본 하나가 평균을 통째로 오염시킨다
 *   - 페이로드 크기를 함께 쓴다. GENEVE 헤더(~50B)가 MTU를 넘기면 단편화가
 *     일어나 지연이 계단식으로 뛰므로, 크기를 밝히지 않은 오버레이 수치는 무의미하다
 *
 * 한정 사항 (본문에 반드시 밝힐 것):
 *   게스트 2대가 같은 물리 호스트에 있으므로 이 터널 경로에는 **물리 NIC과 선로가
 *   없다**. 따라서 여기서 재는 것은 캡슐화·스위칭·경계 통과 비용이지 노드 간
 *   실제 네트워크 지연이 아니다. 발행본 주장이 exit·탐색·캐시 비용이었으므로
 *   그 주장에 대해서는 올바른 격리지만, "노드 간 지연"으로 확대 해석하면 안 된다
 *
 * 빌드: gcc -O2 -static -o net-probe net-probe.c
 * 사용: net-probe --server [--port N] [--cpu N]
 *       net-probe --client --target IP [--size N] [--samples N] [--out f.json]
 *       net-probe --client --target IP --mode pps --duration 10
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>

#define MAX_PAYLOAD 65507
#define DEFAULT_PORT 9911

static volatile sig_atomic_t stop_flag = 0;
static void on_sigint(int s) { (void)s; stop_flag = 1; }

static inline double now_ns(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1e9 + (double)ts.tv_nsec;
}

static int pin_cpu(int cpu)
{
    cpu_set_t set;
    if (cpu < 0) return 0;
    CPU_ZERO(&set);
    CPU_SET(cpu, &set);
    return sched_setaffinity(0, sizeof(set), &set);
}

static int cmp_double(const void *a, const void *b)
{
    double x = *(const double *)a, y = *(const double *)b;
    return (x > y) - (x < y);
}

/* 정렬된 배열에서 백분위. 선형 보간 없이 하한 인덱스 — 표본이 많아 충분하다 */
static double pct(const double *sorted, int n, double p)
{
    int i = (int)(p * (double)n);
    if (i < 0) i = 0;
    if (i >= n) i = n - 1;
    return sorted[i];
}

static void set_nonblock_and_bufs(int fd)
{
    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    int buf = 4 << 20;
    setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &buf, sizeof(buf));
    setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &buf, sizeof(buf));
}

/* ── 서버: 받은 것을 그대로 되돌려 준다 (busy-poll) ─────────────────── */
static int run_server(int port, int cpu)
{
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) { perror("socket"); return 1; }

    int one = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(port);
    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind"); return 1;
    }
    set_nonblock_and_bufs(fd);

    if (pin_cpu(cpu) != 0 && cpu >= 0)
        fprintf(stderr, "경고: CPU %d 고정 실패\n", cpu);

    fprintf(stderr, "server: udp/%d 대기 (Ctrl-C 종료)\n", port);

    static char buf[MAX_PAYLOAD];
    unsigned long long echoed = 0;
    while (!stop_flag) {
        struct sockaddr_in peer;
        socklen_t plen = sizeof(peer);
        ssize_t n = recvfrom(fd, buf, sizeof(buf), 0,
                             (struct sockaddr *)&peer, &plen);
        if (n < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) continue;
            if (errno == EINTR) continue;
            perror("recvfrom"); break;
        }
        /* pps 모드 패킷은 되돌리지 않는다 — 첫 바이트가 태그 */
        if (n > 0 && buf[0] == 'P') { echoed++; continue; }
        sendto(fd, buf, (size_t)n, 0, (struct sockaddr *)&peer, plen);
        echoed++;
    }
    fprintf(stderr, "server: 처리 %llu\n", echoed);
    close(fd);
    return 0;
}

/* ── 클라이언트 RTT: 핑퐁 ──────────────────────────────────────────── */
static int run_rtt(const char *target, int port, int size, int samples,
                   int warmup, int cpu, double timeout_ms,
                   double **out_samples, int *out_n, unsigned long long *out_lost)
{
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) { perror("socket"); return 1; }
    set_nonblock_and_bufs(fd);

    struct sockaddr_in dst;
    memset(&dst, 0, sizeof(dst));
    dst.sin_family = AF_INET;
    dst.sin_port = htons(port);
    if (inet_pton(AF_INET, target, &dst.sin_addr) != 1) {
        fprintf(stderr, "잘못된 target: %s\n", target); return 1;
    }

    if (pin_cpu(cpu) != 0 && cpu >= 0)
        fprintf(stderr, "경고: CPU %d 고정 실패\n", cpu);

    static char sbuf[MAX_PAYLOAD], rbuf[MAX_PAYLOAD];
    memset(sbuf, 'R', (size_t)size);

    int total = samples + warmup;
    double *lat = calloc((size_t)total, sizeof(double));
    if (!lat) { fprintf(stderr, "메모리 부족\n"); return 1; }

    int kept = 0;
    unsigned long long lost = 0;

    for (int i = 0; i < total && !stop_flag; i++) {
        /* 표본마다 시퀀스를 박아 지연 도착 패킷을 버린다 */
        unsigned int seq = (unsigned int)i;
        memcpy(sbuf + 1, &seq, sizeof(seq));
        sbuf[0] = 'R';

        double t0 = now_ns();
        if (sendto(fd, sbuf, (size_t)size, 0,
                   (struct sockaddr *)&dst, sizeof(dst)) < 0) {
            if (errno == EINTR) continue;
            perror("sendto"); break;
        }

        double deadline = t0 + timeout_ms * 1e6;
        double t1 = 0;
        int got = 0;
        while (now_ns() < deadline) {
            ssize_t n = recvfrom(fd, rbuf, sizeof(rbuf), 0, NULL, NULL);
            if (n < 0) {
                if (errno == EAGAIN || errno == EWOULDBLOCK) continue;
                if (errno == EINTR) continue;
                perror("recvfrom"); goto done;
            }
            t1 = now_ns();
            unsigned int rseq;
            memcpy(&rseq, rbuf + 1, sizeof(rseq));
            if (rseq != seq) continue;  /* 늦게 온 이전 표본 — 버린다 */
            got = 1;
            break;
        }
        if (!got) { lost++; continue; }
        if (i >= warmup) lat[kept++] = t1 - t0;
    }

done:
    close(fd);
    *out_samples = lat;
    *out_n = kept;
    *out_lost = lost;
    return 0;
}

/* ── 클라이언트 PPS: 단방향 최대 송신 ──────────────────────────────── */
static unsigned long long run_pps(const char *target, int port, int size,
                                  double duration_s, int cpu, double *out_elapsed)
{
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) { perror("socket"); return 0; }
    set_nonblock_and_bufs(fd);

    struct sockaddr_in dst;
    memset(&dst, 0, sizeof(dst));
    dst.sin_family = AF_INET;
    dst.sin_port = htons(port);
    inet_pton(AF_INET, target, &dst.sin_addr);

    if (pin_cpu(cpu) != 0 && cpu >= 0)
        fprintf(stderr, "경고: CPU %d 고정 실패\n", cpu);

    static char sbuf[MAX_PAYLOAD];
    memset(sbuf, 'P', (size_t)size);   /* 'P' = 에코하지 말 것 */

    double t0 = now_ns();
    double end = t0 + duration_s * 1e9;
    unsigned long long sent = 0;
    while (!stop_flag && now_ns() < end) {
        for (int k = 0; k < 64; k++) {
            ssize_t n = sendto(fd, sbuf, (size_t)size, 0,
                               (struct sockaddr *)&dst, sizeof(dst));
            if (n < 0) {
                if (errno == EAGAIN || errno == EWOULDBLOCK || errno == ENOBUFS)
                    break;   /* 송신 큐 포화 — 이번 배치는 접는다 */
                if (errno == EINTR) break;
                perror("sendto"); goto done;
            }
            sent++;
        }
    }
done:
    *out_elapsed = (now_ns() - t0) / 1e9;
    close(fd);
    return sent;
}

int main(int argc, char **argv)
{
    int server = 0, client = 0, port = DEFAULT_PORT, cpu = -1;
    int size = 64, samples = 20000, warmup = 2000;
    double timeout_ms = 200.0, duration_s = 10.0;
    const char *target = NULL, *label = "unlabeled", *out_path = NULL;
    const char *mode = "rtt";

    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--server")) server = 1;
        else if (!strcmp(argv[i], "--client")) client = 1;
        else if (!strcmp(argv[i], "--target") && i + 1 < argc) target = argv[++i];
        else if (!strcmp(argv[i], "--port") && i + 1 < argc) port = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--cpu") && i + 1 < argc) cpu = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--size") && i + 1 < argc) size = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--samples") && i + 1 < argc) samples = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--warmup") && i + 1 < argc) warmup = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--duration") && i + 1 < argc) duration_s = atof(argv[++i]);
        else if (!strcmp(argv[i], "--mode") && i + 1 < argc) mode = argv[++i];
        else if (!strcmp(argv[i], "--label") && i + 1 < argc) label = argv[++i];
        else if (!strcmp(argv[i], "--out") && i + 1 < argc) out_path = argv[++i];
        else {
            fprintf(stderr,
                "usage: %s --server [--port N] [--cpu N]\n"
                "       %s --client --target IP [--mode rtt|pps] [--size N]\n"
                "              [--samples N] [--warmup N] [--duration S]\n"
                "              [--cpu N] [--label S] [--out FILE]\n", argv[0], argv[0]);
            return 2;
        }
    }
    if (size < 8) size = 8;              /* 태그 1B + 시퀀스 4B 자리 확보 */
    if (size > MAX_PAYLOAD) size = MAX_PAYLOAD;

    signal(SIGINT, on_sigint);
    signal(SIGTERM, on_sigint);

    if (server) return run_server(port, cpu);
    if (!client || !target) {
        fprintf(stderr, "--server 또는 --client --target IP 가 필요합니다\n");
        return 2;
    }

    struct utsname un;
    uname(&un);

    FILE *of = stdout;
    if (out_path) {
        of = fopen(out_path, "w");
        if (!of) { perror("fopen"); return 1; }
    }

    if (!strcmp(mode, "pps")) {
        double elapsed = 0;
        unsigned long long sent = run_pps(target, port, size, duration_s, cpu, &elapsed);
        fprintf(of, "{\n  \"label\": \"%s\",\n  \"probe\": \"net-probe\",\n", label);
        fprintf(of, "  \"mode\": \"pps\",\n");
        fprintf(of, "  \"host\": {\"nodename\": \"%s\", \"release\": \"%s\"},\n",
                un.nodename, un.release);
        fprintf(of, "  \"config\": {\"target\": \"%s\", \"port\": %d, \"size\": %d, "
                    "\"duration_s\": %.1f, \"cpu\": %d},\n",
                target, port, size, duration_s, cpu);
        fprintf(of, "  \"sent\": %llu,\n  \"elapsed_s\": %.3f,\n", sent, elapsed);
        fprintf(of, "  \"pps\": %.0f,\n", elapsed > 0 ? (double)sent / elapsed : 0.0);
        fprintf(of, "  \"mbps\": %.1f\n",
                elapsed > 0 ? (double)sent * (double)size * 8.0 / elapsed / 1e6 : 0.0);
        fprintf(of, "}\n");
        if (out_path) { fclose(of); fprintf(stderr, "wrote %s\n", out_path); }
        return 0;
    }

    double *lat = NULL;
    int n = 0;
    unsigned long long lost = 0;
    if (run_rtt(target, port, size, samples, warmup, cpu, timeout_ms,
                &lat, &n, &lost) != 0)
        return 1;
    if (n <= 0) {
        fprintf(stderr, "표본 0개 — 서버가 떠 있는지, 경로가 살아 있는지 확인하세요\n");
        return 1;
    }

    qsort(lat, (size_t)n, sizeof(double), cmp_double);
    double sum = 0;
    for (int i = 0; i < n; i++) sum += lat[i];

    fprintf(of, "{\n  \"label\": \"%s\",\n  \"probe\": \"net-probe\",\n", label);
    fprintf(of, "  \"mode\": \"rtt\",\n");
    fprintf(of, "  \"host\": {\"nodename\": \"%s\", \"release\": \"%s\"},\n",
            un.nodename, un.release);
    fprintf(of, "  \"config\": {\"target\": \"%s\", \"port\": %d, \"size\": %d, "
                "\"samples\": %d, \"warmup\": %d, \"cpu\": %d},\n",
            target, port, size, samples, warmup, cpu);
    fprintf(of, "  \"kept\": %d,\n  \"lost\": %llu,\n", n, lost);
    fprintf(of, "  \"rtt_us\": {\"min\": %.3f, \"p50\": %.3f, \"p90\": %.3f, "
                "\"p99\": %.3f, \"max\": %.3f, \"mean\": %.3f}\n",
            lat[0] / 1000.0, pct(lat, n, 0.50) / 1000.0, pct(lat, n, 0.90) / 1000.0,
            pct(lat, n, 0.99) / 1000.0, lat[n - 1] / 1000.0, sum / n / 1000.0);
    fprintf(of, "}\n");

    if (out_path) { fclose(of); fprintf(stderr, "wrote %s\n", out_path); }
    free(lat);
    return 0;
}
