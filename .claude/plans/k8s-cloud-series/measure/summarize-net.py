#!/usr/bin/env python3
"""오버레이 세금 요약 — 티어별 RTT/PPS 집계와 캡슐화 증분 판정

사용: ./summarize-net.py [TAG]     (기본 TAG=base)

핵심 출력은 절대값이 아니라 **캡슐화 증분의 L0/L1 대조**다:

    L0 증분 = l0-geneve - l0-veth      (베어메탈에서 캡슐화가 무는 비용)
    L1 증분 = l1-geneve - l1-bridge    (가상화 위에서 캡슐화가 무는 비용)

두 값이 같으면 "가상화가 오버레이 세금을 증폭한다"는 발행본 주장은 거짓이다.
§8.9에서 LLC 절벽의 L0 곡선이 L1과 겹쳐 가상화 고유가 아님을 판정한 것과 같은 형태다.

반복 실행의 **변동폭을 반드시 함께** 낸다 — §8.6에서 단일 실행 점추정으로 원인을
세 번 잘못 귀속한 전례가 있다. 증분이 변동폭보다 작으면 그 증분은 주장할 수 없다.
"""
import json
import sys
from pathlib import Path
from statistics import mean

RESULTS = Path(__file__).resolve().parent / "results"
TIERS = ["l0-veth", "l0-geneve", "l1-bridge", "l1-geneve"]
PAIRS = [("L0 캡슐화", "l0-veth", "l0-geneve"), ("L1 캡슐화", "l1-bridge", "l1-geneve")]


def load(tag):
    """tier -> size -> {'rtt': [p50...], 'p99': [...], 'pps': float, 'mbps': float}"""
    data = {}
    for f in sorted(RESULTS.glob(f"net-{tag}-*.json")):
        try:
            d = json.loads(f.read_text())
        except json.JSONDecodeError:
            print(f"  ! 파손된 파일 건너뜀: {f.name}", file=sys.stderr)
            continue
        label = d.get("label", "")
        # 라벨 형식: <tier>-s<size>-(r<n>|pps)
        parts = label.rsplit("-", 2)
        if len(parts) != 3:
            continue
        tier, ssize, kind = parts
        if not ssize.startswith("s"):
            continue
        size = int(ssize[1:])
        slot = data.setdefault(tier, {}).setdefault(size, {"rtt": [], "p99": []})
        if d.get("mode") == "pps":
            slot["pps"] = d.get("pps")
            slot["mbps"] = d.get("mbps")
        else:
            slot["rtt"].append(d["rtt_us"]["p50"])
            slot["p99"].append(d["rtt_us"]["p99"])
            slot.setdefault("lost", 0)
            slot["lost"] += d.get("lost", 0)
    return data


def spread(xs):
    return (max(xs) - min(xs)) if len(xs) > 1 else 0.0


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else "base"
    data = load(tag)
    if not data:
        print(f"결과 없음: results/net-{tag}-*.json")
        return 1

    sizes = sorted({s for t in data.values() for s in t})

    print(f"\n== RTT p50 (µs, 왕복) — TAG={tag} ==\n")
    head = "티어".ljust(12) + "".join(f"{f'{s}B':>22}" for s in sizes)
    print(head)
    print("-" * len(head))
    for tier in TIERS:
        if tier not in data:
            continue
        row = tier.ljust(12)
        for s in sizes:
            slot = data[tier].get(s)
            if not slot or not slot["rtt"]:
                row += f"{'-':>22}"
                continue
            m, sp, n = mean(slot["rtt"]), spread(slot["rtt"]), len(slot["rtt"])
            row += f"{f'{m:.2f} ±{sp:.2f} (n={n})':>22}"
        print(row)

    print(f"\n== PPS / 대역폭 ==\n")
    for tier in TIERS:
        if tier not in data:
            continue
        for s in sizes:
            slot = data[tier].get(s, {})
            if "pps" not in slot:
                continue
            print(f"  {tier:<12} {s:>5}B   {slot['pps']:>10,.0f} pps   {slot['mbps']:8.1f} Mbps")

    print(f"\n== 캡슐화 증분 (왕복 µs) ==\n")
    incr = {}
    for name, base_t, enc_t in PAIRS:
        if base_t not in data or enc_t not in data:
            print(f"  {name}: 미측정 ({base_t} 또는 {enc_t} 결과 없음)")
            continue
        for s in sizes:
            b = data[base_t].get(s, {}).get("rtt") or []
            e = data[enc_t].get(s, {}).get("rtt") or []
            if not b or not e:
                continue
            d = mean(e) - mean(b)
            noise = spread(b) + spread(e)
            incr[(name, s)] = d
            verdict = "유의" if abs(d) > noise else "변동폭 이하 — 주장 불가"
            print(f"  {name:<10} {s:>5}B   +{d:6.2f} µs   "
                  f"(합산 변동폭 {noise:.2f}, {verdict})")

    print(f"\n== 판정: 가상화가 캡슐화 세금을 증폭하는가 ==\n")
    any_pair = False
    for s in sizes:
        k0, k1 = ("L0 캡슐화", s), ("L1 캡슐화", s)
        if k0 in incr and k1 in incr:
            any_pair = True
            ratio = incr[k1] / incr[k0] if incr[k0] else float("nan")
            print(f"  {s:>5}B   L0 +{incr[k0]:.2f} µs  vs  L1 +{incr[k1]:.2f} µs   "
                  f"= {ratio:.2f}배")
    if not any_pair:
        print("  L0 티어 미측정 — sudo ./net-setup.sh up l0-veth / l0-geneve 후")
        print("  ./measure-net.sh l0-veth 와 ./measure-net.sh l0-geneve 를 실행하십시오")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
