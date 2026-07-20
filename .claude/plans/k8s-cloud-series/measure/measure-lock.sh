#!/usr/bin/env bash
# 락 홀더 선점(LHP) 실측 — 5편 중심 주장 검증
#
# 멱등·원커맨드: ./measure-lock.sh [duration_s]
#
# sched-probe.py 측정의 사각지대를 메운다. 그 프로브는 공유 상태가 없는 워크로드라
# 락 홀더 선점이 원리적으로 관측될 수 없었다. 여기서는 락 모드를 바꿔가며
# 같은 오버스크립션 배수를 L0와 L1에서 각각 측정해 가상화 고유의 몫을 분리한다.
#
# 측정 행렬 (4 모드 x 4 국면):
#
#   host-x1      12스레드 / 12 pCPU  — 경합 없는 L0 기준선
#   host-x2      24스레드 / 12 pCPU  — 2배 오버스크립션, 단일 계층. **핵심 대조군**
#   guest-solo    8스레드 / 8 vCPU   — 게스트 1대만. 하이퍼바이저 여유
#   guest-oversub 8스레드 / 8 vCPU x 3대 = 24 vCPU / 12 pCPU — 2배, 이중 계층
#
# host-x2와 guest-oversub는 물리적으로 동일한 2배 경합이다.
# 두 결과의 차이가 곧 가상화 계층이 추가로 물리는 세금이며,
# 모드별로 그 크기가 어떻게 달라지는지가 이 측정의 목적이다.
set -euo pipefail

DURATION="${1:-30}"
PHASE="${2:-all}"   # all | host | mirror | guest

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTDIR="$HERE/results"
PROBE="$HERE/lock-probe"
PREFIX="${PREFIX:-schedlab}"
COUNT="${COUNT:-3}"
URI="qemu:///system"
MODES=(none mutex spin kspin)

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o ConnectTimeout=5 -o BatchMode=yes -o LogLevel=ERROR)

mkdir -p "$OUTDIR"

[[ -x "$PROBE" ]] || {
  echo "lock-probe 없음. 빌드: gcc -O2 -static -pthread -o lock-probe lock-probe.c" >&2
  exit 1
}
# 정적 링크가 아니면 게스트에서 라이브러리 불일치로 죽는다
file "$PROBE" | grep -q "statically linked" || {
  echo "lock-probe가 정적 링크가 아닙니다. -static으로 재빌드하세요" >&2; exit 1; }

guest_names() { for i in $(seq 1 "$COUNT"); do echo "${PREFIX}${i}"; done; }

guest_ip() {
  virsh -c "$URI" domifaddr "$1" 2>/dev/null \
    | awk '/ipv4/{split($4,a,"/"); print a[1]; exit}'
}

summarize_one() {
  python3 - "$1" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
c, s, t = r["config"], r["sched"], r["throughput"]
print(f"   mode={c['mode']:<6} iter/s={t['iter_per_sec']:>14,.0f}  "
      f"run_delay_ratio={s['run_delay_ratio']:<9} "
      f"cpu_eff={s['cpu_efficiency']:<9} "
      f"steal={r['cpu_time_pct'].get('steal', 0.0)}%")
PY
}

NPROC="$(nproc)"

if [[ "$PHASE" == "all" || "$PHASE" == "host" ]]; then
echo "== 호스트(L0) 락 경합 측정 — nproc=$NPROC =="
for MULT in 1 2; do
  THREADS=$((NPROC * MULT))
  echo "-- host-x${MULT} (${THREADS} threads / ${NPROC} pCPU)"
  for m in "${MODES[@]}"; do
    OUT="$OUTDIR/lock-host-x${MULT}-${m}.json"
    "$PROBE" --mode "$m" --threads "$THREADS" --duration "$DURATION" \
             --label "host-x${MULT}-${m}" --out "$OUT" 2>/dev/null
    summarize_one "$OUT"
    sleep 3
  done
done
fi

# 게스트 토폴로지를 L0에서 그대로 흉내 낸 대조군.
#
# host-x2(24스레드/락 1개)는 guest-oversub(8스레드 x 락 3개)의 올바른 대조군이 아니다.
# 프로세스마다 락이 따로이므로 프로세스 3개를 띄워야 락 도메인 수까지 일치한다.
# 이게 맞아야 "같은 2배 경합에서 가상화가 추가로 무엇을 물리는가"를 물을 수 있다.
#
#   host-1x8  프로세스 1개 x 8스레드   <-> guest-solo
#   host-3x8  프로세스 3개 x 8스레드   <-> guest-oversub
if [[ "$PHASE" == "all" || "$PHASE" == "mirror" ]]; then
GT="${GT:-8}"   # 게스트 vCPU 수와 맞춘다
echo
echo "== 호스트(L0) 게스트 미러 대조군 — 프로세스당 ${GT}스레드 =="
for m in "${MODES[@]}"; do
  echo "-- $m"
  OUT="$OUTDIR/lock-host-1x${GT}-${m}.json"
  "$PROBE" --mode "$m" --threads "$GT" --duration "$DURATION" \
           --label "host-1x${GT}-${m}" --out "$OUT" 2>/dev/null
  summarize_one "$OUT"
  sleep 3

  pids=()
  for i in 1 2 3; do
    "$PROBE" --mode "$m" --threads "$GT" --duration "$DURATION" \
             --label "host-3x${GT}-p${i}-${m}" \
             --out "$OUTDIR/lock-host-3x${GT}-p${i}-${m}.json" 2>/dev/null &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p"; done
  for i in 1 2 3; do
    summarize_one "$OUTDIR/lock-host-3x${GT}-p${i}-${m}.json"
  done
  sleep 3
done
fi

if [[ "$PHASE" == "host" || "$PHASE" == "mirror" ]]; then
  echo
  echo "== 완료(호스트 국면만): $OUTDIR =="
  exit 0
fi

# 게스트 IP 확인
declare -A IP
for n in $(guest_names); do
  ip="$(guest_ip "$n")"
  [[ -z "$ip" ]] && { echo "$n IP 미할당. provision-guests.sh up 먼저" >&2; exit 1; }
  IP["$n"]="$ip"
done

echo
echo "== 프로브 배포 =="
for n in $(guest_names); do
  scp "${SSH_OPTS[@]}" -q "$PROBE" "ubuntu@${IP[$n]}:/tmp/lock-probe"
  ssh "${SSH_OPTS[@]}" "ubuntu@${IP[$n]}" chmod +x /tmp/lock-probe
  echo "   $n (${IP[$n]}) ok"
done

# 게스트 스레드 수 = 게스트 nproc. 두 국면 모두 이 값으로 고정한다(게스트 관점 1배)
GN="$(ssh "${SSH_OPTS[@]}" "ubuntu@${IP[${PREFIX}1]}" nproc)"
echo "   게스트 nproc=$GN (스레드 수로 고정)"

# pvspinlock 활성 여부를 기록 — nopvspin 대조 때 근거가 된다
echo
echo "== 게스트 pv-spinlock 상태 =="
for n in $(guest_names); do
  st="$(ssh "${SSH_OPTS[@]}" "ubuntu@${IP[$n]}" \
        'sudo dmesg 2>/dev/null | grep -i "spinlock" | tail -1' || true)"
  echo "   $n: ${st:-(로그 없음)}"
  echo "   $n cmdline: $(ssh "${SSH_OPTS[@]}" "ubuntu@${IP[$n]}" cat /proc/cmdline)"
done

run_guest() {
  local n="$1" mode="$2" label="$3"
  ssh "${SSH_OPTS[@]}" "ubuntu@${IP[$n]}" \
    "/tmp/lock-probe --mode $mode --threads $GN --duration $DURATION \
       --label '$label' --out /tmp/lock.json 2>/dev/null"
  scp "${SSH_OPTS[@]}" -q "ubuntu@${IP[$n]}:/tmp/lock.json" \
    "$OUTDIR/lock-${label}.json"
}

echo
echo "== 국면 1: guest-solo (게스트 1대만 부하, ${GN}스레드/${GN}vCPU) =="
for m in "${MODES[@]}"; do
  run_guest "${PREFIX}1" "$m" "guest-solo${TAG:-}-${m}"
  summarize_one "$OUTDIR/lock-guest-solo${TAG:-}-${m}.json"
  sleep 3
done

echo
echo "== 국면 2: guest-oversub (게스트 ${COUNT}대 동시, 각 ${GN}스레드/${GN}vCPU) =="
for m in "${MODES[@]}"; do
  pids=()
  for n in $(guest_names); do
    run_guest "$n" "$m" "guest-oversub${TAG:-}-${n}-${m}" &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p"; done
  for n in $(guest_names); do
    summarize_one "$OUTDIR/lock-guest-oversub${TAG:-}-${n}-${m}.json"
  done
  sleep 3
done

echo
echo "== 완료: $OUTDIR/lock-*.json =="
echo "   요약: ./summarize-lock.py"
