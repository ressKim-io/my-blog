#!/usr/bin/env bash
# 스케줄링 지연 스윕 — 호스트(L0)와 게스트(L1)에서 동일하게 실행한다.
#
# 멱등: 같은 라벨로 다시 돌리면 결과 파일을 덮어쓴다.
# 원커맨드: ./run-baseline.sh <tier> [duration]
#   tier: 결과를 구분할 계층 이름 (host / guest-a / guest-b ...)
#
# 오버스크립션 배수는 그 머신의 nproc 기준이다.
# 호스트 12스레드면 0.5x=6, 1x=12, 2x=24, 3x=36 워커.
set -euo pipefail

TIER="${1:?usage: $0 <tier> [duration_s]}"
DURATION="${2:-30}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTDIR="${OUTDIR:-$HERE/results}"
NPROC="$(nproc)"

mkdir -p "$OUTDIR"

echo "== sched sweep: tier=$TIER nproc=$NPROC duration=${DURATION}s =="

for MULT in 0.5 1 2 3; do
  WORKERS=$(python3 -c "print(max(1, round($NPROC * $MULT)))")
  LABEL="${TIER}-x${MULT}"
  OUT="$OUTDIR/sched-${LABEL}.json"
  echo "-- $LABEL: $WORKERS workers"
  python3 "$HERE/sched-probe.py" \
    --workers "$WORKERS" \
    --duration "$DURATION" \
    --label "$LABEL" \
    --out "$OUT" >/dev/null
  # 한 줄 요약을 stdout으로
  python3 - "$OUT" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
s, p = r["sched"], r["cpu_time_pct"]
print(f"   run_delay_ratio={s['run_delay_ratio']:<10} "
      f"cpu_eff={s['cpu_efficiency']:<10} "
      f"steal={p.get('steal', 0.0)}%  "
      f"guest={r['env'].get('is_guest')}")
PY
  # 다음 측정이 직전 부하의 잔열을 받지 않도록
  sleep 3
done

echo "== done: $OUTDIR/sched-${TIER}-x*.json =="
