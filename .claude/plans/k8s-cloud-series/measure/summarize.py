#!/usr/bin/env python3
"""results/*.json을 표로 요약 — plan.md §8 append용 초안을 만든다

수치를 본문에 옮기기 전 반드시 이 표를 §8에 먼저 기록한다 (revision-audit.md §8.2 주의사항).
"""

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
RESULTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "results"


def load():
    rows = []
    for p in sorted(RESULTS.glob("sched-*.json")):
        try:
            r = json.load(open(p))
        except (OSError, json.JSONDecodeError) as e:
            print(f"! 건너뜀 {p.name}: {e}", file=sys.stderr)
            continue
        s = r["sched"]
        pct = r["cpu_time_pct"]
        env = r["env"]
        rows.append({
            "label": r["label"],
            "guest": env.get("is_guest"),
            "nproc": env.get("nproc"),
            "workers": r["config"]["workers"],
            "dur": r["config"]["duration_s"],
            "run_delay_ratio": s["run_delay_ratio"],
            "cpu_eff": s["cpu_efficiency"],
            "steal_pct": pct.get("steal", 0.0),
            "p50_us": (s["run_delay_p50_ns"] or 0) / 1000,
            "max_us": (s["run_delay_max_ns"] or 0) / 1000,
        })
    return rows


def main():
    rows = load()
    if not rows:
        print(f"결과 없음: {RESULTS}", file=sys.stderr)
        return 1

    hdr = ("| 라벨 | 계층 | nproc | 워커 | run_delay_ratio | cpu_eff | steal% "
           "| delay p50(µs) | delay max(µs) |")
    sep = "|---|---|---|---|---|---|---|---|---|"
    print(hdr)
    print(sep)
    for r in rows:
        tier = "게스트" if r["guest"] else "호스트"
        print(f"| {r['label']} | {tier} | {r['nproc']} | {r['workers']} "
              f"| {r['run_delay_ratio']} | {r['cpu_eff']} | {r['steal_pct']} "
              f"| {r['p50_us']:.1f} | {r['max_us']:.1f} |")

    # 해석 보조 — solo 대비 oversub의 처리량 손실
    solo = [r for r in rows if "guest-solo" in r["label"]]
    over = [r for r in rows if "guest-oversub" in r["label"]]
    if solo and over:
        s_eff = solo[0]["cpu_eff"]
        o_eff = sum(r["cpu_eff"] for r in over) / len(over)
        o_steal = sum(r["steal_pct"] for r in over) / len(over)
        print()
        print(f"게스트 solo cpu_eff={s_eff:.4f} -> oversub 평균 cpu_eff={o_eff:.4f} "
              f"(손실 {(1 - o_eff / s_eff) * 100:.1f}%), oversub 평균 steal={o_steal:.2f}%")
        print("게스트 내부 설정은 두 국면에서 동일하므로, 이 손실분이 "
              "게스트 스케줄러에게 보이지 않는 하이퍼바이저 계층의 몫이다")
    return 0


if __name__ == "__main__":
    sys.exit(main())
