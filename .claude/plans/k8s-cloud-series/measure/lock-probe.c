/* 락 경합 워크로드 프로브 — 5편 락 홀더 선점(LHP) 실측용
 *
 * sched-probe.py의 한계를 메운다. 그 프로브의 워커는 서로 독립적인 CPU 소각
 * 프로세스라 공유 상태가 전혀 없었고, 그래서 게스트 cpu_efficiency가 오버스크립션
 * 에서도 1.000으로 나왔다. 그건 발견이 아니라 워크로드 설계의 필연이다.
 * LHP는 락이 있어야만 관측된다.
 *
 * 네 가지 모드를 같은 바이너리로 돌려 대조한다:
 *
 *   none   공유 상태 없음. sched-probe.py와 같은 성격의 대조군.
 *          vCPU가 선점돼도 다른 스레드에 전파되지 않는다
 *   mutex  pthread_mutex. 경합 시 futex로 잠들기 때문에 락 소유자가 선점당해도
 *          대기자가 CPU를 태우지 않는다. 완만한 열화를 예상
 *   spin   pthread_spinlock. 유저스페이스 순수 스핀이라
 *          CONFIG_PARAVIRT_SPINLOCKS의 보호를 받지 못한다.
 *          커널이 완화해 줄 수 없는 LHP의 민낯
 *   kspin  dup()/close()로 커널 스핀락(files_struct->file_lock)을 경합시킨다.
 *          이쪽은 pv-qspinlock이 적용되는 영역이라 nopvspin 부팅과 대조하면
 *          완화 기전의 값어치가 분리된다
 *
 * 지표는 sched-probe.py와 같은 스키마로 낸다(run_delay/steal/iterations).
 * 호스트와 게스트에서 동일 바이너리로 돌려야 사과 대 사과 비교가 성립하므로
 * 정적 링크로 빌드한다: gcc -O2 -static -pthread -o lock-probe lock-probe.c
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>

enum mode { M_NONE, M_MUTEX, M_SPIN, M_KSPIN, M_MEM };

static const char *mode_names[] = {"none", "mutex", "spin", "kspin", "mem"};

static volatile int stop_flag = 0;
static enum mode g_mode = M_NONE;
static int g_hold = 50;
static int g_gap = 200;
static int g_devnull = -1;
static size_t g_footprint_kb = 0; /* mem 모드: 스레드당 작업 집합 */
static int g_hugepage = 0;

static pthread_mutex_t g_mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_spinlock_t g_spin;

/* 버퍼 구성이 측정 구간에 섞이지 않게 막는 관문.
 * 128MB 버퍼는 만드는 데 수 초가 걸리므로 이게 없으면 측정이 오염된다.
 * 참가자는 워커 스레드 전부 + main 이다 */
static pthread_barrier_t g_barrier;

/* 공유 카운터. 캐시 라인을 일부러 공유시켜 경합을 만든다 */
static volatile unsigned long g_shared;

/* 스레드마다 자기 캐시 라인을 통째로 쓴다.
 *
 * 이걸 안 하면 인접 스레드의 구조체가 같은 캐시 라인에 얹혀서, 매 반복의
 * r->iterations++ 가 코어 간 캐시 라인 왕복(거짓 공유)을 일으킨다.
 * 실제로 이 프로브의 초판이 56바이트 구조체였고, 그 탓에 반복 비용이 싼
 * 모드(spin)의 처리량이 3.2배까지 왜곡됐다 — 락 경합을 잰 게 아니라
 * 프로브 자신의 거짓 공유를 잰 셈이었다.
 *
 * aligned(64)를 붙이면 sizeof도 64의 배수로 올림되고 배열 원소도 정렬된다.
 * 할당은 반드시 aligned_alloc(64, ...)로 해야 배열 시작 자체가 라인에 맞는다.
 * 필드를 추가해도 이 보호가 유지된다 */
struct wres {
    int idx;
    long long wall_ns;
    long long cpu_ns;
    long long run_delay_ns;
    long long timeslices;
    long long iterations;
    unsigned long local_acc; /* 최적화 방지 */
    void *chase;             /* mem 모드: 포인터 추적 현재 위치 */
} __attribute__((aligned(64)));

/* 64바이트 슬롯을 무작위 순열로 연결해 **단일 순환**을 만든다.
 * p = *(void **)p 로 따라가면 다음 주소가 현재 적재 결과에 의존하므로
 * 하드웨어 프리페처가 앞서갈 수 없고 컴파일러도 걷어낼 수 없다.
 * 캐시·TLB 계층을 정직하게 때리는 표준 기법이다.
 *
 * 순열을 Fisher-Yates로 만든 뒤 perm[k] -> perm[k+1] 로 닫으면
 * 순환이 하나임이 구조적으로 보장된다(Sattolo 알고리즘 불필요).
 * 슬롯을 전부 쓰므로 지연 할당(lazy allocation)도 여기서 해소된다 */
static void *build_chase(size_t bytes, int hugepage, unsigned int seed)
{
    const size_t SLOT = 64;
    size_t nslots = bytes / SLOT;
    size_t *perm;
    size_t i, k;
    char *m;

    if (nslots < 2)
        return NULL;

    m = mmap(NULL, bytes, PROT_READ | PROT_WRITE,
             MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (m == MAP_FAILED)
        return NULL;
    if (hugepage && madvise(m, bytes, MADV_HUGEPAGE) != 0)
        fprintf(stderr, "경고: MADV_HUGEPAGE 실패: %s\n", strerror(errno));

    perm = malloc(nslots * sizeof(*perm));
    if (!perm) {
        munmap(m, bytes);
        return NULL;
    }
    for (i = 0; i < nslots; i++)
        perm[i] = i;
    for (i = nslots - 1; i > 0; i--) {
        size_t j = (size_t)(rand_r(&seed) % (int)(i + 1));
        size_t t = perm[i];
        perm[i] = perm[j];
        perm[j] = t;
    }
    for (k = 0; k < nslots; k++)
        *(void **)(m + perm[k] * SLOT) = m + perm[(k + 1) % nslots] * SLOT;
    free(perm);
    return m;
}

/* THP를 **요청**한 것과 커널이 **부여**한 것은 다르다.
 * 요청했는데 0이면 그 측정은 THP 실험으로 쓸 수 없으므로 반드시 기록한다 */
static long read_anon_huge_kb(void)
{
    FILE *f = fopen("/proc/self/smaps_rollup", "r");
    char buf[256];
    long v = -1;
    if (!f)
        return -1;
    while (fgets(buf, sizeof(buf), f))
        if (sscanf(buf, "AnonHugePages: %ld kB", &v) == 1)
            break;
    fclose(f);
    return v;
}

static long long now_ns(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

/* /proc/<tid>/schedstat → cpu_ns, run_delay_ns, timeslices
 * 2번째 필드가 런큐 대기 누적 나노초다. 커널 CFS가 직접 계상한다 */
static int read_schedstat(pid_t tid, long long *cpu, long long *delay,
                          long long *slices)
{
    char path[64];
    FILE *f;
    snprintf(path, sizeof(path), "/proc/self/task/%d/schedstat", (int)tid);
    f = fopen(path, "r");
    if (!f)
        return -1;
    if (fscanf(f, "%lld %lld %lld", cpu, delay, slices) != 3) {
        fclose(f);
        return -1;
    }
    fclose(f);
    return 0;
}

static void *worker(void *arg)
{
    struct wres *r = arg;
    pid_t tid = syscall(SYS_gettid);
    long long c0 = 0, d0 = 0, s0 = 0, c1 = 0, d1 = 0, s1 = 0;
    long long t0, t1;
    unsigned long acc = 0;
    int i;

    /* 버퍼 구성은 측정 구간 **밖**에서 끝낸다. 스레드마다 다른 씨앗을 써서
     * 순열이 겹치지 않게 한다 — 같은 순열이면 캐시를 부당하게 공유한다 */
    if (g_mode == M_MEM) {
        r->chase = build_chase(g_footprint_kb * 1024, g_hugepage,
                               (unsigned int)(r->idx * 2654435761U + 1));
        if (!r->chase) {
            fprintf(stderr, "워커 %d: 버퍼 할당 실패 (%zu KB)\n", r->idx,
                    g_footprint_kb);
            pthread_barrier_wait(&g_barrier);
            return NULL;
        }
    }

    /* 모든 스레드가 여기 모인 뒤에야 main이 타이머를 연다 */
    pthread_barrier_wait(&g_barrier);

    read_schedstat(tid, &c0, &d0, &s0);
    t0 = now_ns();

    while (!stop_flag) {
        /* 임계 구역 */
        switch (g_mode) {
        case M_NONE:
            for (i = 0; i < g_hold; i++)
                acc = acc * 1103515245UL + 12345UL;
            break;
        case M_MUTEX:
            pthread_mutex_lock(&g_mutex);
            for (i = 0; i < g_hold; i++)
                g_shared++;
            pthread_mutex_unlock(&g_mutex);
            break;
        case M_SPIN:
            pthread_spin_lock(&g_spin);
            for (i = 0; i < g_hold; i++)
                g_shared++;
            pthread_spin_unlock(&g_spin);
            break;
        case M_KSPIN: {
            /* dup/close 쌍이 files_struct->file_lock(커널 스핀락)을 경합시킨다.
             * 같은 프로세스의 스레드끼리 fd 테이블을 공유하므로 경합이 확실하다 */
            int fd = dup(g_devnull);
            if (fd >= 0)
                close(fd);
            else
                acc++;
            break;
        }
        case M_MEM: {
            /* 포인터 추적. 결과를 struct에 되써서 최적화 제거를 이중으로 막고,
             * 다음 반복이 순환의 이어지는 지점부터 따라가게 한다 */
            void *p = r->chase;
            for (i = 0; i < g_gap; i++)
                p = *(void **)p;
            r->chase = p;
            break;
        }
        }

        /* 비임계 구역 — 경합 비율을 조절한다.
         * mem 모드는 추적 자체가 작업이므로 레지스터 연산을 섞지 않는다 */
        if (g_mode != M_MEM)
            for (i = 0; i < g_gap; i++)
                acc = acc * 1103515245UL + 12345UL;

        r->iterations++;
    }

    t1 = now_ns();
    read_schedstat(tid, &c1, &d1, &s1);

    r->wall_ns = t1 - t0;
    r->cpu_ns = c1 - c0;
    r->run_delay_ns = d1 - d0;
    r->timeslices = s1 - s0;
    r->local_acc = acc;
    return NULL;
}

/* /proc/stat 첫 cpu 행의 10개 필드. 8번째가 steal */
static const char *stat_keys[] = {"user",    "nice", "system", "idle",
                                  "iowait",  "irq",  "softirq", "steal",
                                  "guest",   "guest_nice"};

static int read_proc_stat(long long v[10])
{
    FILE *f = fopen("/proc/stat", "r");
    char buf[512];
    int i;
    if (!f)
        return -1;
    if (!fgets(buf, sizeof(buf), f)) {
        fclose(f);
        return -1;
    }
    fclose(f);
    {
        char *p = buf;
        while (*p && *p != ' ')
            p++;
        for (i = 0; i < 10; i++) {
            v[i] = strtoll(p, &p, 10);
        }
    }
    return 0;
}

static void json_str(FILE *f, const char *s)
{
    fputc('"', f);
    for (; s && *s; s++) {
        if (*s == '"' || *s == '\\')
            fprintf(f, "\\%c", *s);
        else if (*s == '\n')
            fputs("\\n", f);
        else if ((unsigned char)*s < 0x20)
            fprintf(f, "\\u%04x", *s);
        else
            fputc(*s, f);
    }
    fputc('"', f);
}

/* 파일에서 한 줄 읽어 개행 제거 */
static int read_line_file(const char *path, char *buf, size_t n)
{
    FILE *f = fopen(path, "r");
    size_t len;
    if (!f)
        return -1;
    if (!fgets(buf, n, f)) {
        fclose(f);
        return -1;
    }
    fclose(f);
    len = strlen(buf);
    while (len && (buf[len - 1] == '\n' || buf[len - 1] == '\r'))
        buf[--len] = '\0';
    return 0;
}

/* /proc/cpuinfo에서 model name 추출 + hypervisor 플래그 유무 */
static void read_cpuinfo(char *model, size_t n, int *is_guest)
{
    FILE *f = fopen("/proc/cpuinfo", "r");
    char buf[1024];
    model[0] = '\0';
    *is_guest = 0;
    if (!f)
        return;
    while (fgets(buf, sizeof(buf), f)) {
        if (!model[0] && strncmp(buf, "model name", 10) == 0) {
            char *p = strchr(buf, ':');
            if (p) {
                p++;
                while (*p == ' ')
                    p++;
                snprintf(model, n, "%s", p);
                {
                    size_t l = strlen(model);
                    while (l && (model[l - 1] == '\n' || model[l - 1] == ' '))
                        model[--l] = '\0';
                }
            }
        }
        if (strstr(buf, "hypervisor"))
            *is_guest = 1;
    }
    fclose(f);
}

static int cmp_ll(const void *a, const void *b)
{
    long long x = *(const long long *)a, y = *(const long long *)b;
    return (x > y) - (x < y);
}

static void usage(const char *p)
{
    fprintf(stderr,
            "usage: %s --mode none|mutex|spin|kspin|mem [--threads N] "
            "[--duration S] [--hold N] [--gap N] "
            "[--footprint KB] [--hugepage] --label L [--out FILE]\n",
            p);
}

int main(int argc, char **argv)
{
    int threads = (int)sysconf(_SC_NPROCESSORS_ONLN);
    int duration = 30;
    const char *label = "unlabeled";
    const char *out = "-";
    struct wres *res;
    pthread_t *tids;
    long long st0[10], st1[10], total_j = 0;
    long long t_start, t_end;
    long long tot_wall = 0, tot_cpu = 0, tot_delay = 0, tot_iter = 0;
    long long *delays;
    char model[256], kernel[128], host[128], cmdline[1024];
    struct utsname un;
    int is_guest = 0;
    long anon_huge_kb = -1;
    FILE *of;
    int i;

    for (i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--mode") && i + 1 < argc) {
            const char *m = argv[++i];
            if (!strcmp(m, "none"))
                g_mode = M_NONE;
            else if (!strcmp(m, "mutex"))
                g_mode = M_MUTEX;
            else if (!strcmp(m, "spin"))
                g_mode = M_SPIN;
            else if (!strcmp(m, "kspin"))
                g_mode = M_KSPIN;
            else if (!strcmp(m, "mem"))
                g_mode = M_MEM;
            else {
                usage(argv[0]);
                return 2;
            }
        } else if (!strcmp(argv[i], "--threads") && i + 1 < argc)
            threads = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--duration") && i + 1 < argc)
            duration = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--hold") && i + 1 < argc)
            g_hold = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--gap") && i + 1 < argc)
            g_gap = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--footprint") && i + 1 < argc)
            g_footprint_kb = (size_t)strtoul(argv[++i], NULL, 10);
        else if (!strcmp(argv[i], "--hugepage"))
            g_hugepage = 1;
        else if (!strcmp(argv[i], "--label") && i + 1 < argc)
            label = argv[++i];
        else if (!strcmp(argv[i], "--out") && i + 1 < argc)
            out = argv[++i];
        else {
            usage(argv[0]);
            return 2;
        }
    }
    if (threads < 1)
        threads = 1;

    if (g_mode == M_MEM && g_footprint_kb < 1) {
        fprintf(stderr, "mem 모드에는 --footprint <KB> 가 필요합니다\n");
        return 2;
    }

    if (g_mode == M_KSPIN) {
        g_devnull = open("/dev/null", O_RDONLY);
        if (g_devnull < 0) {
            perror("open /dev/null");
            return 1;
        }
    }
    pthread_spin_init(&g_spin, PTHREAD_PROCESS_PRIVATE);

    /* 배열 시작을 캐시 라인에 맞춘다. calloc은 정렬을 보장하지 않아서
     * 원소가 64바이트여도 배열이 어긋나면 이웃끼리 라인을 걸치게 된다 */
    res = aligned_alloc(64, (size_t)threads * sizeof(*res));
    tids = calloc(threads, sizeof(*tids));
    delays = calloc(threads, sizeof(*delays));
    if (!res || !tids || !delays) {
        fprintf(stderr, "alloc failed\n");
        return 1;
    }
    memset(res, 0, (size_t)threads * sizeof(*res));

    pthread_barrier_init(&g_barrier, NULL, (unsigned)threads + 1);

    for (i = 0; i < threads; i++) {
        res[i].idx = i;
        if (pthread_create(&tids[i], NULL, worker, &res[i]) != 0) {
            fprintf(stderr, "pthread_create %d failed: %s\n", i,
                    strerror(errno));
            return 1;
        }
    }

    /* 모든 스레드가 버퍼 구성을 마친 뒤에 측정 구간을 연다.
     * 이 관문이 없으면 128MB 버퍼 만드는 수 초가 결과에 섞인다 */
    pthread_barrier_wait(&g_barrier);
    anon_huge_kb = read_anon_huge_kb();

    read_proc_stat(st0);
    t_start = now_ns();

    sleep(duration);
    stop_flag = 1;

    for (i = 0; i < threads; i++)
        pthread_join(tids[i], NULL);

    t_end = now_ns();
    read_proc_stat(st1);

    for (i = 0; i < 10; i++)
        total_j += st1[i] - st0[i];

    for (i = 0; i < threads; i++) {
        tot_wall += res[i].wall_ns;
        tot_cpu += res[i].cpu_ns;
        tot_delay += res[i].run_delay_ns;
        tot_iter += res[i].iterations;
        delays[i] = res[i].run_delay_ns;
    }
    qsort(delays, threads, sizeof(*delays), cmp_ll);

    uname(&un);
    snprintf(kernel, sizeof(kernel), "%s", un.release);
    if (gethostname(host, sizeof(host)) != 0)
        snprintf(host, sizeof(host), "unknown");
    read_cpuinfo(model, sizeof(model), &is_guest);
    if (read_line_file("/proc/cmdline", cmdline, sizeof(cmdline)) != 0)
        cmdline[0] = '\0';

    of = strcmp(out, "-") ? fopen(out, "w") : stdout;
    if (!of) {
        perror("open out");
        return 1;
    }

    fputs("{\n", of);
    fputs("  \"label\": ", of);
    json_str(of, label);
    fputs(",\n  \"probe\": \"lock-probe\",\n", of);
    fprintf(of, "  \"config\": {\"mode\": \"%s\", \"threads\": %d, "
                "\"duration_s\": %d, \"hold\": %d, \"gap\": %d, "
                "\"footprint_kb\": %zu, \"hugepage\": %s},\n",
            mode_names[g_mode], threads, duration, g_hold, g_gap,
            g_footprint_kb, g_hugepage ? "true" : "false");
    /* 요청과 실제가 다를 수 있으므로 커널이 실제로 준 huge page 양을 남긴다 */
    fprintf(of, "  \"anon_huge_kb\": %ld,\n", anon_huge_kb);
    fputs("  \"env\": {", of);
    fputs("\"hostname\": ", of);
    json_str(of, host);
    fputs(", \"kernel\": ", of);
    json_str(of, kernel);
    fprintf(of, ", \"nproc\": %ld", sysconf(_SC_NPROCESSORS_ONLN));
    fprintf(of, ", \"is_guest\": %s", is_guest ? "true" : "false");
    fputs(", \"cpu_model\": ", of);
    json_str(of, model);
    /* nopvspin 부팅 여부가 결과 해석에 직결되므로 커널 명령줄을 남긴다 */
    fputs(", \"cmdline\": ", of);
    json_str(of, cmdline);
    fputs("},\n", of);

    fputs("  \"cpu_time_jiffies\": {", of);
    for (i = 0; i < 10; i++)
        fprintf(of, "%s\"%s\": %lld", i ? ", " : "", stat_keys[i],
                st1[i] - st0[i]);
    fputs("},\n", of);

    fputs("  \"cpu_time_pct\": {", of);
    for (i = 0; i < 10; i++)
        fprintf(of, "%s\"%s\": %.4f", i ? ", " : "", stat_keys[i],
                total_j ? (st1[i] - st0[i]) * 100.0 / total_j : 0.0);
    fputs("},\n", of);

    fputs("  \"sched\": {", of);
    fprintf(of, "\"total_wall_ns\": %lld, \"total_cpu_ns\": %lld, "
                "\"total_run_delay_ns\": %lld",
            tot_wall, tot_cpu, tot_delay);
    fprintf(of, ", \"run_delay_ratio\": %.6f",
            tot_cpu ? (double)tot_delay / tot_cpu : 0.0);
    fprintf(of, ", \"cpu_efficiency\": %.6f",
            tot_wall ? (double)tot_cpu / tot_wall : 0.0);
    fprintf(of, ", \"run_delay_p50_ns\": %lld", delays[threads / 2]);
    fprintf(of, ", \"run_delay_max_ns\": %lld", delays[threads - 1]);
    fputs("},\n", of);

    /* 처리량이 이 프로브의 주 지표다. 락이 걸리면 cpu_efficiency는
     * 여전히 1.0에 가까울 수 있지만(스핀은 CPU를 태우므로) 처리량은 무너진다 */
    fprintf(of, "  \"throughput\": {\"total_iterations\": %lld, "
                "\"iter_per_sec\": %.1f},\n",
            tot_iter, tot_iter / ((t_end - t_start) / 1e9));

    fputs("  \"workers\": [\n", of);
    for (i = 0; i < threads; i++) {
        fprintf(of,
                "    {\"worker\": %d, \"wall_ns\": %lld, \"cpu_ns\": %lld, "
                "\"run_delay_ns\": %lld, \"timeslices\": %lld, "
                "\"iterations\": %lld}%s\n",
                res[i].idx, res[i].wall_ns, res[i].cpu_ns, res[i].run_delay_ns,
                res[i].timeslices, res[i].iterations,
                i == threads - 1 ? "" : ",");
    }
    fputs("  ],\n", of);
    fprintf(of, "  \"wall_elapsed_s\": %.3f\n", (t_end - t_start) / 1e9);
    fputs("}\n", of);

    if (of != stdout) {
        fclose(of);
        fprintf(stderr, "wrote %s\n", out);
    }

    if (g_mode == M_MEM)
        fprintf(stderr, "[%s] footprint=%zuKB/thread hugepage=%d "
                        "anon_huge=%ldKB\n",
                label, g_footprint_kb, g_hugepage, anon_huge_kb);
    fprintf(stderr,
            "[%s] mode=%s threads=%d iter/s=%.1f run_delay_ratio=%.6f "
            "cpu_eff=%.6f steal=%.2f%%\n",
            label, mode_names[g_mode], threads,
            tot_iter / ((t_end - t_start) / 1e9),
            tot_cpu ? (double)tot_delay / tot_cpu : 0.0,
            tot_wall ? (double)tot_cpu / tot_wall : 0.0,
            total_j ? (st1[7] - st0[7]) * 100.0 / total_j : 0.0);

    return 0;
}
