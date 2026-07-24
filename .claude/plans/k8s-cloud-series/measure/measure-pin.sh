#!/usr/bin/env bash
# vCPU 핀 고정 실측 — SMT 공유 비용 분리 + 5편 "1:1 고정" 처방 검증
#
# 멱등·원커맨드: ./measure-pin.sh <smt|partition> [duration_s]
#
# 호스트 토폴로지: AMD Ryzen 7500F = 물리 6코어 x SMT2 = 논리 12개.
# cpuN 과 cpu(N+6) 이 같은 물리 코어를 공유한다 (thread_siblings_list 확인).
#
# ── smt 국면 ──────────────────────────────────────────────────────
# §8.5의 미해결 격차를 닫는다. 처리량 손실 65.9%인데 steal은 50.3%였고,
# 15.6pp 차이를 SMT 간섭으로 추정만 해 두었다. 그 추정을 확정으로 바꾼다.
#
#   spread  vCPU 6개 -> 물리 6코어에 하나씩 (0,1,2,3,4,5)   SMT 공유 없음
#   packed  vCPU 6개 -> 물리 3코어에 형제까지 (0,6,1,7,2,8) SMT 완전 공유
#
# 게스트 설정(6스레드/6vCPU)은 양쪽 동일하고 물리 배치만 다르다.
# 두 결과의 차이가 곧 SMT 형제 간섭의 순수한 몫이며, steal은 이걸 세지 못한다.
#
# ── partition 국면 ────────────────────────────────────────────────
# 발행본 결론의 "vCPU 오버스크립션 금지, 1:1 Dedicated Pinning 강제"를 검증한다.
# OpenStack 의 cpu_pinning / 전용 인스턴스가 하는 일의 축소판이다.
#
#   free    게스트 3대 x 8 vCPU, 핀 없음 — 호스트 CFS가 자유 배치
#   pinned  게스트마다 논리 CPU 4개씩 배타 할당 (물리 2코어씩)
#             schedlab1 -> 0,6,1,7   schedlab2 -> 2,8,3,9   schedlab3 -> 4,10,5,11
#
# 총 오버스크립션 배수는 양쪽 다 2배로 같다. 바뀌는 건 배치 정책뿐이다.
set -euo pipefail

PHASE="${1:?usage: $0 <smt|partition> [duration_s]}"
DURATION="${2:-30}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTDIR="$HERE/results"
PROBE="$HERE/lock-probe"
PREFIX="${PREFIX:-schedlab}"
URI="qemu:///system"
MODES=(none kspin)

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o ConnectTimeout=5 -o BatchMode=yes -o LogLevel=ERROR)

mkdir -p "$OUTDIR"

vsh() { virsh -c "$URI" "$@"; }

guest_ip() {
  vsh domifaddr "$1" 2>/dev/null \
    | awk '/ipv4/{split($4,a,"/"); print a[1]; exit}'
}

wait_ssh() {
  local ip="$1"
  for _ in $(seq 1 60); do
    ssh "${SSH_OPTS[@]}" "ubuntu@$ip" true 2>/dev/null && return 0
    sleep 3
  done
  echo "SSH 대기 실패: $ip" >&2; return 1
}

deploy() {
  local ip="$1"
  scp "${SSH_OPTS[@]}" -q "$PROBE" "ubuntu@$ip:/tmp/lock-probe"
  ssh "${SSH_OPTS[@]}" "ubuntu@$ip" chmod +x /tmp/lock-probe
}

run_guest() {
  local ip="$1" mode="$2" threads="$3" label="$4"
  ssh "${SSH_OPTS[@]}" "ubuntu@$ip" \
    "/tmp/lock-probe --mode $mode --threads $threads --duration $DURATION \
       --label '$label' --out /tmp/pin.json 2>/dev/null"
  scp "${SSH_OPTS[@]}" -q "ubuntu@$ip:/tmp/pin.json" "$OUTDIR/pin-${label}.json"
}

show() {
  python3 - "$1" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
print(f"   {r['label']:<28} iter/s={r['throughput']['iter_per_sec']:>14,.0f}  "
      f"steal={r['cpu_time_pct'].get('steal',0.0):>6.2f}%  "
      f"cpu_eff={r['sched']['cpu_efficiency']:.4f}")
PY
}

# 핀 배치를 실제로 확인한다. 요청과 실제가 다르면 측정이 무의미해진다
verify_pin() {
  local dom="$1"
  echo "   [$dom vcpupin]"
  vsh vcpupin "$dom" | sed -n '3,$p' | awk 'NF{printf "      vcpu %s -> %s\n", $1, $2}'
}

case "$PHASE" in
smt)
  echo "== SMT 공유 비용 분리 — 게스트 1대, 6 vCPU =="
  for g in "${PREFIX}2" "${PREFIX}3"; do
    vsh destroy "$g" 2>/dev/null && echo "-- $g 정지" || true
  done

  # 6 vCPU 로 재구성. 물리 6코어와 1:1 대응시켜야 spread 배치가 성립한다
  vsh destroy "${PREFIX}1" 2>/dev/null || true
  sleep 2
  vsh setvcpus "${PREFIX}1" 6 --config
  vsh start "${PREFIX}1"
  IP="$(for _ in $(seq 1 60); do ip=$(guest_ip "${PREFIX}1"); \
        [[ -n "$ip" ]] && { echo "$ip"; break; }; sleep 2; done)"
  echo "-- ${PREFIX}1 -> $IP (6 vCPU)"
  wait_ssh "$IP"
  deploy "$IP"
  GN="$(ssh "${SSH_OPTS[@]}" "ubuntu@$IP" nproc)"
  echo "-- 게스트 nproc=$GN"

  declare -A LAYOUT=(
    [spread]="0 1 2 3 4 5"
    [packed]="0 6 1 7 2 8"
  )
  for name in spread packed; do
    echo
    echo "-- 배치: $name (${LAYOUT[$name]})"
    i=0
    for c in ${LAYOUT[$name]}; do
      vsh vcpupin "${PREFIX}1" "$i" "$c"
      i=$((i + 1))
    done
    verify_pin "${PREFIX}1"
    for m in "${MODES[@]}"; do
      run_guest "$IP" "$m" "$GN" "smt-${name}-${m}"
      show "$OUTDIR/pin-smt-${name}-${m}.json"
      sleep 3
    done
  done
  echo
  echo "== 완료. 8 vCPU 복원은 ./measure-pin.sh partition 이 수행 =="
  ;;

partition)
  echo "== 핀 고정 정책 대조 — 게스트 3대 x 8 vCPU =="
  vsh destroy "${PREFIX}1" 2>/dev/null || true
  sleep 2
  vsh setvcpus "${PREFIX}1" 8 --config
  for g in "${PREFIX}1" "${PREFIX}2" "${PREFIX}3"; do
    vsh start "$g" 2>/dev/null || true
  done

  declare -A IP
  for g in "${PREFIX}1" "${PREFIX}2" "${PREFIX}3"; do
    ip="$(for _ in $(seq 1 60); do x=$(guest_ip "$g"); \
          [[ -n "$x" ]] && { echo "$x"; break; }; sleep 2; done)"
    IP[$g]="$ip"
    echo "-- $g -> $ip"
    wait_ssh "$ip"
    deploy "$ip"
  done
  GN="$(ssh "${SSH_OPTS[@]}" "ubuntu@${IP[${PREFIX}1]}" nproc)"
  echo "-- 게스트 nproc=$GN"

  # 게스트별 배타 논리 CPU 집합. 각 게스트는 물리 2코어(형제 포함)를 독점한다
  declare -A PART=(
    [${PREFIX}1]="0 6 1 7"
    [${PREFIX}2]="2 8 3 9"
    [${PREFIX}3]="4 10 5 11"
  )

  for policy in free pinned; do
    echo
    echo "-- 정책: $policy"
    for g in "${PREFIX}1" "${PREFIX}2" "${PREFIX}3"; do
      if [[ "$policy" == "free" ]]; then
        # 전체 논리 CPU 허용 = 핀 해제
        for v in $(seq 0 $((GN - 1))); do
          vsh vcpupin "$g" "$v" 0-11
        done
      else
        set -- ${PART[$g]}
        for v in $(seq 0 $((GN - 1))); do
          # vCPU 8개를 논리 4개에 순환 배치
          idx=$((v % 4 + 1))
          vsh vcpupin "$g" "$v" "$(eval echo \${$idx})"
        done
      fi
    done
    verify_pin "${PREFIX}1"

    for m in "${MODES[@]}"; do
      pids=()
      for g in "${PREFIX}1" "${PREFIX}2" "${PREFIX}3"; do
        run_guest "${IP[$g]}" "$m" "$GN" "part-${policy}-${g}-${m}" &
        pids+=($!)
      done
      for p in "${pids[@]}"; do wait "$p"; done
      for g in "${PREFIX}1" "${PREFIX}2" "${PREFIX}3"; do
        show "$OUTDIR/pin-part-${policy}-${g}-${m}.json"
      done
      sleep 3
    done
  done
  ;;

*)
  echo "usage: $0 <smt|partition> [duration_s]" >&2; exit 1 ;;
esac

echo
echo "== 결과: $OUTDIR/pin-*.json =="
