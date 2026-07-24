#!/usr/bin/env bash
# 게스트 측정 오케스트레이션 — 이중 스케줄링 세금 분리 실험
#
# 멱등·원커맨드: ./measure-guests.sh [duration_s]
#
# 두 국면을 대조한다. 게스트 내부 설정(8워커/8vCPU = 1배)은 양쪽 동일하게 두고
# **호스트 쪽 경합만** 바꾸는 것이 설계의 핵심이다.
#
#   solo    : 게스트 1개만 부하. 8 vCPU 요구 < 12 pCPU  -> 하이퍼바이저 여유
#   oversub : 게스트 3개 동시 부하. 24 vCPU 요구 > 12 pCPU -> 하이퍼바이저 2배 초과
#
# 게스트 스케줄러가 보는 세계는 두 국면에서 똑같다(항상 8워커/8vCPU).
# 그런데 실제 처리량은 떨어진다 — 그 차이가 게스트에게 보이지 않는 세금이고,
# steal time이 그 세금을 계량한 값이다.
set -euo pipefail

DURATION="${1:-30}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTDIR="$HERE/results"
PREFIX="${PREFIX:-schedlab}"
COUNT="${COUNT:-3}"
URI="qemu:///system"

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o ConnectTimeout=5 -o BatchMode=yes -o LogLevel=ERROR)

mkdir -p "$OUTDIR"

guest_names() { for i in $(seq 1 "$COUNT"); do echo "${PREFIX}${i}"; done; }

guest_ip() {
  virsh -c "$URI" domifaddr "$1" 2>/dev/null \
    | awk '/ipv4/{split($4,a,"/"); print a[1]; exit}'
}

# 게스트 이름 -> IP 캐시
declare -A IP
for n in $(guest_names); do
  ip="$(guest_ip "$n")"
  [[ -z "$ip" ]] && { echo "$n IP 미할당. provision-guests.sh up 먼저 실행" >&2; exit 1; }
  IP["$n"]="$ip"
done

echo "== 측정 에이전트 배포 =="
for n in $(guest_names); do
  scp "${SSH_OPTS[@]}" -q "$HERE/sched-probe.py" "ubuntu@${IP[$n]}:/tmp/sched-probe.py"
  echo "   $n (${IP[$n]}) ok"
done

# 게스트 vCPU 수 확인 — 워커 수를 게스트 nproc에 맞춘다(게스트 관점 1배)
GUEST_NPROC="$(ssh "${SSH_OPTS[@]}" "ubuntu@${IP[${PREFIX}1]}" nproc)"
echo "   게스트 nproc=$GUEST_NPROC (워커 수로 사용)"

# 한 게스트에서 측정 실행 후 결과를 호스트로 회수
run_on_guest() {
  local n="$1" label="$2"
  ssh "${SSH_OPTS[@]}" "ubuntu@${IP[$n]}" \
    "python3 /tmp/sched-probe.py --workers $GUEST_NPROC --duration $DURATION \
       --label '$label' --out /tmp/result.json >/dev/null 2>&1"
  scp "${SSH_OPTS[@]}" -q "ubuntu@${IP[$n]}:/tmp/result.json" \
    "$OUTDIR/sched-${label}.json"
}

# 호스트 쪽에서 같은 구간의 CPU 사용을 함께 기록한다
sample_host() {
  local label="$1" secs="$2"
  mpstat 1 "$secs" > "$OUTDIR/hoststat-${label}.txt" 2>&1 || true
}

echo
echo "== 국면 1: solo (게스트 1개만 부하) =="
sample_host "solo" "$((DURATION + 2))" &
HOSTPID=$!
run_on_guest "${PREFIX}1" "guest-solo"
wait $HOSTPID || true
python3 - "$OUTDIR/sched-guest-solo.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1])); s, p = r["sched"], r["cpu_time_pct"]
print(f"   run_delay_ratio={s['run_delay_ratio']}  cpu_eff={s['cpu_efficiency']}  "
      f"steal={p.get('steal', 0.0)}%")
PY

sleep 5

echo
echo "== 국면 2: oversub (게스트 ${COUNT}개 동시 부하) =="
sample_host "oversub" "$((DURATION + 2))" &
HOSTPID=$!
pids=()
for n in $(guest_names); do
  run_on_guest "$n" "guest-oversub-$n" &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
wait $HOSTPID || true

for n in $(guest_names); do
  python3 - "$OUTDIR/sched-guest-oversub-${n}.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1])); s, p = r["sched"], r["cpu_time_pct"]
print(f"   {r['label']}: run_delay_ratio={s['run_delay_ratio']}  "
      f"cpu_eff={s['cpu_efficiency']}  steal={p.get('steal', 0.0)}%")
PY
done

echo
echo "== 완료: $OUTDIR =="
echo "   요약: ./summarize.py"
