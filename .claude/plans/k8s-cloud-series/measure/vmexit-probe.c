/* VM exit 왕복 비용 실측 — 5편 창작 수치 "150~200 클록 사이클(~500ns)" 대체
 *
 * 발행본은 VM exit 비용을 출처 없이 단언했고 그 안에서 모순까지 있었다
 * (200 사이클 @ 3GHz는 67ns이지 500ns가 아니다). 여기서는 직접 잰다.
 *
 * 방법 — 차분(差分) 측정:
 *
 *   CPUID는 x86 가상화에서 **항상 가로채이는** 명령이다. 게스트가 실행하면
 *   반드시 VM exit이 나고 하이퍼바이저가 에뮬레이트한 뒤 복귀한다.
 *   반면 베어메탈에서 CPUID는 그냥 (직렬화) 명령이다.
 *
 *     host  : CPUID 명령 자체의 비용
 *     guest : CPUID 명령 비용 + VM exit 왕복
 *     차이  = VM exit 왕복 비용
 *
 *   RDTSC는 TSC 오프셋 기능 덕에 보통 가로채이지 않으므로 대조군으로 쓴다.
 *   게스트와 호스트에서 RDTSC 비용이 같아야 측정 자체가 신뢰할 만하다는 뜻이다.
 *
 * 측정 위생:
 *   - CPU 하나에 고정(sched_setaffinity)해 마이그레이션 잡음을 없앤다
 *   - 배치(기본 200회)로 묶어 재고 나누므로 rdtsc 읽기 비용이 희석된다
 *   - 배치 표본을 많이 모아 **중앙값**을 쓴다. 선점당한 배치가 평균을 오염시키므로
 *     평균이 아니라 분위수를 봐야 한다
 *   - TSC 주파수는 CLOCK_MONOTONIC과 대조해 직접 보정한다(고정 상수를 믿지 않는다)
 *
 * 빌드: gcc -O2 -static -o vmexit-probe vmexit-probe.c
 */
#define _GNU_SOURCE
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/utsname.h>

static inline unsigned long long rdtsc_serialized(void)
{
    unsigned int lo, hi;
    __asm__ __volatile__("lfence" ::: "memory");
    __asm__ __volatile__("rdtsc" : "=a"(lo), "=d"(hi));
    __asm__ __volatile__("lfence" ::: "memory");
    return ((unsigned long long)hi << 32) | lo;
}

static inline void do_cpuid(void)
{
    unsigned int a = 0, b, c, d;
    __asm__ __volatile__("cpuid"
                         : "+a"(a), "=b"(b), "=c"(c), "=d"(d)
                         :
                         : "memory");
}

static inline void do_rdtsc_only(void)
{
    unsigned int lo, hi;
    __asm__ __volatile__("rdtsc" : "=a"(lo), "=d"(hi));
    (void)lo;
    (void)hi;
}

static int cmp_d(const void *a, const void *b)
{
    double x = *(const double *)a, y = *(const double *)b;
    return (x > y) - (x < y);
}

/* TSC 1사이클이 몇 ns인지 실측 보정 */
static double calibrate_ns_per_cycle(void)
{
    struct timespec a, b;
    unsigned long long t0, t1;
    double ns, cyc;

    clock_gettime(CLOCK_MONOTONIC, &a);
    t0 = rdtsc_serialized();
    usleep(200000);
    t1 = rdtsc_serialized();
    clock_gettime(CLOCK_MONOTONIC, &b);

    ns = (b.tv_sec - a.tv_sec) * 1e9 + (b.tv_nsec - a.tv_nsec);
    cyc = (double)(t1 - t0);
    return cyc > 0 ? ns / cyc : 0.0;
}

/* op: 0 = cpuid, 1 = rdtsc(대조군)
 * 배치당 batch회 실행하고 사이클/회를 반환. samples개 표본을 채운다 */
static void measure(int op, int batch, int samples, double *out)
{
    int i, j;
    for (i = 0; i < samples; i++) {
        unsigned long long t0, t1;
        t0 = rdtsc_serialized();
        for (j = 0; j < batch; j++) {
            if (op == 0)
                do_cpuid();
            else
                do_rdtsc_only();
        }
        t1 = rdtsc_serialized();
        out[i] = (double)(t1 - t0) / batch;
    }
    qsort(out, samples, sizeof(double), cmp_d);
}

static double pctl(const double *sorted, int n, double p)
{
    int k = (int)(n * p / 100.0);
    if (k >= n)
        k = n - 1;
    if (k < 0)
        k = 0;
    return sorted[k];
}

static int is_guest(void)
{
    FILE *f = fopen("/proc/cpuinfo", "r");
    char buf[1024];
    int g = 0;
    if (!f)
        return 0;
    while (fgets(buf, sizeof(buf), f))
        if (strstr(buf, "hypervisor")) {
            g = 1;
            break;
        }
    fclose(f);
    return g;
}

static void cpu_model(char *out, size_t n)
{
    FILE *f = fopen("/proc/cpuinfo", "r");
    char buf[1024];
    out[0] = '\0';
    if (!f)
        return;
    while (fgets(buf, sizeof(buf), f)) {
        if (strncmp(buf, "model name", 10) == 0) {
            char *p = strchr(buf, ':');
            if (p) {
                size_t l;
                p++;
                while (*p == ' ')
                    p++;
                snprintf(out, n, "%s", p);
                l = strlen(out);
                while (l && (out[l - 1] == '\n' || out[l - 1] == ' '))
                    out[--l] = '\0';
            }
            break;
        }
    }
    fclose(f);
}

int main(int argc, char **argv)
{
    int batch = 200, samples = 2000, cpu = 0, i;
    const char *label = "unlabeled", *out_path = "-";
    double *cpuid_s, *rdtsc_s, nspc;
    cpu_set_t set;
    struct utsname un;
    char model[256];
    FILE *of;

    for (i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--batch") && i + 1 < argc)
            batch = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--samples") && i + 1 < argc)
            samples = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--cpu") && i + 1 < argc)
            cpu = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--label") && i + 1 < argc)
            label = argv[++i];
        else if (!strcmp(argv[i], "--out") && i + 1 < argc)
            out_path = argv[++i];
        else {
            fprintf(stderr, "usage: %s [--batch N] [--samples N] [--cpu N] "
                            "--label L [--out FILE]\n",
                    argv[0]);
            return 2;
        }
    }

    /* CPU 고정 — 마이그레이션하면 TSC 비교가 흔들린다 */
    CPU_ZERO(&set);
    CPU_SET(cpu, &set);
    if (sched_setaffinity(0, sizeof(set), &set) != 0)
        fprintf(stderr, "경고: CPU %d 고정 실패, 결과 잡음 증가\n", cpu);

    nspc = calibrate_ns_per_cycle();

    cpuid_s = malloc(sizeof(double) * samples);
    rdtsc_s = malloc(sizeof(double) * samples);
    if (!cpuid_s || !rdtsc_s)
        return 1;

    /* 워밍업 — 캐시·주파수 상승 구간을 버린다 */
    measure(0, batch, 100, cpuid_s);
    measure(1, batch, 100, rdtsc_s);

    measure(0, batch, samples, cpuid_s);
    measure(1, batch, samples, rdtsc_s);

    uname(&un);
    cpu_model(model, sizeof(model));

    of = strcmp(out_path, "-") ? fopen(out_path, "w") : stdout;
    if (!of) {
        perror("open out");
        return 1;
    }

    fprintf(of, "{\n  \"label\": \"%s\",\n  \"probe\": \"vmexit-probe\",\n",
            label);
    fprintf(of, "  \"config\": {\"batch\": %d, \"samples\": %d, \"cpu\": %d},\n",
            batch, samples, cpu);
    fprintf(of,
            "  \"env\": {\"kernel\": \"%s\", \"is_guest\": %s, "
            "\"cpu_model\": \"%s\", \"ns_per_cycle\": %.6f, "
            "\"tsc_mhz\": %.1f},\n",
            un.release, is_guest() ? "true" : "false", model, nspc,
            nspc > 0 ? 1000.0 / nspc : 0.0);

    fprintf(of, "  \"cpuid_cycles\": {\"p10\": %.1f, \"p50\": %.1f, "
                "\"p90\": %.1f, \"p99\": %.1f},\n",
            pctl(cpuid_s, samples, 10), pctl(cpuid_s, samples, 50),
            pctl(cpuid_s, samples, 90), pctl(cpuid_s, samples, 99));
    fprintf(of, "  \"cpuid_ns\": {\"p50\": %.1f, \"p90\": %.1f},\n",
            pctl(cpuid_s, samples, 50) * nspc, pctl(cpuid_s, samples, 90) * nspc);
    fprintf(of, "  \"rdtsc_cycles\": {\"p50\": %.1f, \"p90\": %.1f},\n",
            pctl(rdtsc_s, samples, 50), pctl(rdtsc_s, samples, 90));
    fprintf(of, "  \"rdtsc_ns\": {\"p50\": %.1f}\n",
            pctl(rdtsc_s, samples, 50) * nspc);
    fprintf(of, "}\n");

    if (of != stdout) {
        fclose(of);
        fprintf(stderr, "wrote %s\n", out_path);
    }

    fprintf(stderr,
            "[%s] guest=%d  CPUID p50=%.1f cyc (%.1f ns)  p90=%.1f cyc  |  "
            "RDTSC p50=%.1f cyc (%.1f ns)  |  TSC %.0f MHz\n",
            label, is_guest(), pctl(cpuid_s, samples, 50),
            pctl(cpuid_s, samples, 50) * nspc, pctl(cpuid_s, samples, 90),
            pctl(rdtsc_s, samples, 50), pctl(rdtsc_s, samples, 50) * nspc,
            nspc > 0 ? 1000.0 / nspc : 0.0);
    return 0;
}
