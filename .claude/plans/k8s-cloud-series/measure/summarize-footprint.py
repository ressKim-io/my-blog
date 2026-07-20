#!/usr/bin/env python3
"""작업 집합 스윕 요약 — 캐시 가설 판정

핵심 출력은 세 가지다:

1. L1 유지율 곡선 — 작업 집합이 커지면 게스트당 유지율이 떨어지는가?
   떨어지지 않고 50% 부근에서 평평하면 **가설은 거짓**이다.

2. L0 유지율 곡선 — 같은 일이 베어메탈에서도 일어나는가?
   두 곡선이 겹치면 가상화 세금이 아니라 일반적인 메모리 경합이고,
   교훈은 "steal은 메모리 경합을 측정하지 않는다"가 된다.

3. 격차 곡선 (L1 − L0) — 작업 집합에 따라 벌어지면 중첩 페이징(NPT)
   2차원 페이지 워크의 몫이다. THP 국면이 이걸 확증하거나 기각한다.

공정분배 기준선은 50%다(2배 오버스크립션에서 각자 절반).
"""

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, "results")


def load(pattern):
    out = []
    for p in sorted(glob.glob(os.path.join(OUTDIR, pattern))):
        with open(p) as f:
            out.append(json.load(f))
    return out


def thr(r):
    return r["throughput"]["iter_per_sec"]


def fpad(kb):
    return "f%07d" % kb


def human(kb):
    if kb >= 1024:
        return f"{kb // 1024}MB"
    return f"{kb}KB"


def retention(tag, layer, kb):
    """(유지율, solo 처리량, oversub 평균, 평균 steal) 또는 None"""
    if layer == "l1":
        s = load(f"fp-{tag}-l1-solo-{fpad(kb)}.json")
        o = load(f"fp-{tag}-l1-oversub-schedlab[0-9]-{fpad(kb)}.json")
    else:
        s = load(f"fp-{tag}-l0-1x8-{fpad(kb)}.json")
        o = load(f"fp-{tag}-l0-3x8-p[0-9]-{fpad(kb)}.json")
    if not s or not o:
        return None
    solo = thr(s[0])
    avg = sum(thr(r) for r in o) / len(o)
    steal = sum(r["cpu_time_pct"].get("steal", 0.0) for r in o) / len(o)
    return avg / solo, solo, avg, steal


def sweep_table(tag, footprints):
    print(f"{'작업집합':>9} {'L0 유지율':>10} {'L1 유지율':>10} {'격차(pp)':>9} "
          f"{'L1 steal':>9} {'L1 solo it/s':>14} {'L1 oversub it/s':>16}")
    print("-" * 82)
    rows = []
    for kb in footprints:
        r0 = retention(tag, "l0", kb)
        r1 = retention(tag, "l1", kb)
        if not (r0 and r1):
            continue
        gap = (r1[0] - r0[0]) * 100
        rows.append((kb, r0[0], r1[0], gap))
        print(f"{human(kb):>9} {r0[0]*100:9.1f}% {r1[0]*100:9.1f}% {gap:+8.1f} "
              f"{r1[3]:8.1f}% {r1[1]:14,.0f} {r1[2]:16,.0f}")
    return rows


def main():
    footprints = [16, 128, 512, 2048, 8192, 32768, 131072]
    thp_footprints = [32768, 131072]

    print("== 기본 스윕 (4KB 페이지) ==")
    print("L3 32MB 공유. solo 총량=8F, oversub 총량=24F")
    print("  -> oversub가 L3를 넘는 지점 F>1.33MB / solo가 넘는 지점 F>4MB\n")
    rows = sweep_table("base", footprints)

    if rows:
        print()
        print("== 판정 ==")
        small = [r for r in rows if r[0] <= 512]
        large = [r for r in rows if r[0] >= 8192]
        if small and large:
            s1 = sum(r[2] for r in small) / len(small) * 100
            l1 = sum(r[2] for r in large) / len(large) * 100
            print(f"  L1 유지율: 작은 작업집합 평균 {s1:.1f}% -> "
                  f"큰 작업집합 평균 {l1:.1f}%  ({l1-s1:+.1f}pp)")
            s0 = sum(r[1] for r in small) / len(small) * 100
            l0 = sum(r[1] for r in large) / len(large) * 100
            print(f"  L0 유지율: {s0:.1f}% -> {l0:.1f}%  ({l0-s0:+.1f}pp)")
            print()
            if abs(l1 - s1) < 5:
                print("  판정: 유지율이 작업 집합에 따라 변하지 않음 -> **가설 거짓**")
            elif abs((l1 - s1) - (l0 - s0)) < 5:
                print("  판정: L0에서도 같은 크기로 떨어짐 -> 가상화 세금이 아니라")
                print("        **일반적인 메모리 경합**. steal이 이를 못 잡는 것이 교훈")
            else:
                print("  판정: L1이 L0보다 더 떨어짐 -> **가상화 고유의 몫 존재**")
                print("        (중첩 페이징 여부는 THP 국면이 판정)")

    thp_rows = sweep_table("thp", thp_footprints) if load("fp-thp-*") else []
    if thp_rows:
        print()
        print("== THP 국면 (2MB 페이지) — TLB 분리 ==")
        sweep_table("thp", thp_footprints)
        print()
        print("== THP on/off 격차 대조 ==")
        print(f"{'작업집합':>9} {'4KB 격차':>10} {'2MB 격차':>10} {'변화':>8}")
        print("-" * 42)
        for kb in thp_footprints:
            b0, b1 = retention("base", "l0", kb), retention("base", "l1", kb)
            t0, t1 = retention("thp", "l0", kb), retention("thp", "l1", kb)
            if not all([b0, b1, t0, t1]):
                continue
            gb = (b1[0] - b0[0]) * 100
            gt = (t1[0] - t0[0]) * 100
            print(f"{human(kb):>9} {gb:+9.1f} {gt:+9.1f} {gt-gb:+7.1f}")
        print()
        print("  격차가 THP로 줄면 원인은 중첩 페이지 테이블 워크(NPT),")
        print("  그대로면 LLC·대역폭 경합")

        # THP가 실제로 부여됐는지 확인 — 요청과 부여는 다르다
        print()
        print("== THP 실제 부여 확인 ==")
        for r in load("fp-thp-*.json")[:4]:
            print(f"  {r['label']:<32} anon_huge={r['anon_huge_kb']:,} KB")


if __name__ == "__main__":
    main()
