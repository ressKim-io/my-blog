#!/usr/bin/env python3
"""락 경합 측정 요약 — lock-*.json을 대조표로

핵심 대조는 두 축이다:
  1. L0에서 2배 오버스크립션(host-x1 -> host-x2)의 처리량 유지율
  2. L1에서 2배 오버스크립션(guest-solo -> guest-oversub)의 게스트당 유지율

두 유지율의 차이가 가상화 계층이 추가로 물리는 몫이다.
모드별로 이 차이가 어떻게 달라지는지가 LHP 논지의 검증 지점이다.
"""

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, "results")
MODES = ["none", "mutex", "spin", "kspin"]


def load(pattern):
    out = []
    for p in sorted(glob.glob(os.path.join(OUTDIR, pattern))):
        with open(p) as f:
            out.append(json.load(f))
    return out


def thr(r):
    return r["throughput"]["iter_per_sec"]


def steal(r):
    return r["cpu_time_pct"].get("steal", 0.0)


def one(pattern):
    rows = load(pattern)
    return rows[0] if rows else None


def fmt(x, w=13):
    return f"{x:>{w},.0f}" if x is not None else " " * w


def main():
    suffix = sys.argv[1] if len(sys.argv) > 1 else ""
    tag = f"-{suffix}" if suffix else ""

    # L0 대조군은 게스트 토폴로지를 미러링한 것을 쓴다.
    # host-x2(24스레드/락 1개)는 락 도메인 수가 달라 대조군 자격이 없다 —
    # 그걸로 계산하면 spin 유지율이 149%로 나오는 착시가 생긴다
    print(f"== L0 (호스트) — 게스트 미러 대조군, 8스레드 프로세스 1개 vs 3개 ==")
    print(f"{'mode':<7} {'1x8 iter/s':>14} {'3x8 평균':>14} {'유지율':>8} "
          f"{'3x8 cpu_eff':>12} {'3x8 run_delay':>14}")
    print("-" * 76)
    l0 = {}
    for m in MODES:
        a = one(f"lock-host-1x8-{m}.json")
        b = load(f"lock-host-3x8-p*-{m}.json")
        if not (a and b):
            continue
        avg = sum(thr(r) for r in b) / len(b)
        keep = avg / thr(a)
        l0[m] = keep
        print(f"{m:<7} {fmt(thr(a), 14)} {fmt(avg, 14)} {keep*100:7.1f}% "
              f"{sum(r['sched']['cpu_efficiency'] for r in b)/len(b):12.4f} "
              f"{sum(r['sched']['run_delay_ratio'] for r in b)/len(b):14.4f}")

    print()
    print("참고 — 단일 락 도메인 L0 스윕 (대조군 아님, 락 경합 강도 자체의 영향)")
    print(f"{'mode':<7} {'x1(12스레드)':>15} {'x2(24스레드)':>15} {'유지율':>8}")
    print("-" * 50)
    for m in MODES:
        a, b = one(f"lock-host-x1-{m}.json"), one(f"lock-host-x2-{m}.json")
        if a and b:
            print(f"{m:<7} {fmt(thr(a), 15)} {fmt(thr(b), 15)} "
                  f"{thr(b)/thr(a)*100:7.1f}%")

    print()
    print(f"== L1 (게스트) — 이중 계층 2배 오버스크립션{tag} ==")
    print(f"{'mode':<7} {'solo iter/s':>14} {'oversub 평균':>14} {'유지율':>8} "
          f"{'steal':>7} {'cpu_eff':>9} {'run_delay':>10}")
    print("-" * 76)
    l1 = {}
    for m in MODES:
        s = one(f"lock-guest-solo{tag}-{m}.json")
        # 게스트 이름 자리를 [0-9]로 좁힌다. `*`를 쓰면 태그가 없는 호출에서
        # lock-guest-oversub-nopvspin-schedlab1-*.json 까지 빨려 들어와
        # 두 국면의 평균이 섞인다
        o = load(f"lock-guest-oversub{tag}-schedlab[0-9]-{m}.json")
        if not (s and o):
            continue
        avg = sum(thr(r) for r in o) / len(o)
        keep = avg / thr(s)
        l1[m] = keep
        print(f"{m:<7} {fmt(thr(s), 14)} {fmt(avg, 14)} {keep*100:7.1f}% "
              f"{sum(steal(r) for r in o)/len(o):6.1f}% "
              f"{sum(r['sched']['cpu_efficiency'] for r in o)/len(o):9.4f} "
              f"{sum(r['sched']['run_delay_ratio'] for r in o)/len(o):10.6f}")

    print()
    print("== 가상화 고유의 몫 (같은 2배 경합에서 L0 대비 L1) ==")
    print(f"{'mode':<7} {'L0 유지율':>10} {'L1 유지율':>10} {'차이(pp)':>10}")
    print("-" * 42)
    for m in MODES:
        if m in l0 and m in l1:
            d = (l1[m] - l0[m]) * 100
            print(f"{m:<7} {l0[m]*100:9.1f}% {l1[m]*100:9.1f}% {d:+9.1f}")

    print()
    print("공정분배 기준선: 2배 오버스크립션에서 게스트당 유지율 50%")
    print("50%를 크게 웃돌면 하이퍼바이저가 유휴 구간을 흡수했거나")
    print("경합이 완화된 것이고, 크게 밑돌면 가상화 고유의 손실이다")


if __name__ == "__main__":
    main()
