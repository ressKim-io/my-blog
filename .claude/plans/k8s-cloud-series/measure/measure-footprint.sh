#!/usr/bin/env bash
# 작업 집합 스윕 — steal이 놓치는 세금의 정체 규명
#
# 멱등·원커맨드: ./measure-footprint.sh <l1|l0|thp> [duration_s]
#
# 검증할 가설 (plan.md §8.5 정정본에 열려 있는 미검증 가설):
#   오버스크립션 시 게스트당 처리량 유지율은 작업 집합 크기에 따라 떨어진다.
#   동거 게스트가 L3를 나눠 쓰기 때문이며, steal은 스케줄 대기만 세므로 못 잡는다.
#
# 하드웨어 사실: L1d 32KB/코어, L2 1MB/코어, **L3 32MB를 논리 12개가 공유**, NUMA 단일.
# 스레드당 작업 집합 F에 대해 solo 총량 = 8F, oversub 총량 = 24F.
#   oversub가 L3를 넘는 지점 F > 1.33MB / solo가 넘는 지점 F > 4MB
#   -> 그 사이(2MB 부근)가 가설의 가장 날카로운 판정 지점
#
# 국면:
#   l1   게스트 3대. solo(1대) vs oversub(3대)        본 측정
#   l0   호스트에서 프로세스 1개 vs 3개 x 8스레드      **대조군**
#   thp  큰 작업 집합 2점에서 THP on/off             TLB(중첩 페이징) 분리
#
# l0 대조군이 핵심이다. 캐시 경합은 베어메탈에서도 일어나므로, 두 곡선이 겹치면
# "가상화 세금"이 아니라 일반적인 메모리 경합이고 교훈은 "steal은 메모리 경합을
# 측정하지 않는다"가 된다. L1이 더 나빠지면 그 차이가 중첩 페이징(NPT)의 몫이다.
#
# 주의: l0 국면도 게스트를 띄워 둔 채(유휴) 돌린다 — §8.6 미러 대조군과 같은 조건.
set -euo pipefail

PHASE="${1:?usage: $0 <l1|l0|thp> [duration_s]}"
DURATION="${2:-20}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTDIR="$HERE/results"
PROBE="$HERE/lock-probe"
PREFIX="${PREFIX:-schedlab}"
COUNT="${COUNT:-3}"
URI="qemu:///system"
GAP="${GAP:-64}"

# 스레드당 작업 집합(KB). L1d -> L2 -> L3 임계 -> DRAM 순으로 계층을 가로지른다
FOOTPRINTS=(16 128 512 2048 8192 32768 131072)
# THP 국면은 TLB 압박이 큰 두 점만
THP_FOOTPRINTS=(32768 131072)

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o ConnectTimeout=5 -o BatchMode=yes -o LogLevel=ERROR)

mkdir -p "$OUTDIR"

[[ -x "$PROBE" ]] || { echo "lock-probe 없음" >&2; exit 1; }
file "$PROBE" | grep -q "statically linked" || {
  echo "lock-probe가 정적 링크가 아닙니다" >&2; exit 1; }

# ── 주파수 고정 확인 (fail-fast) ────────────────────────────────
# §8.8에서 부스트 클럭이 SMT 측정 결론을 뒤집은 전례가 있다.
# 고정되지 않았으면 아예 시작하지 않는다
"$HERE/pin-frequency.sh" status >/dev/null 2>&1 || {
  echo "주파수가 고정되지 않았습니다. 먼저 실행: ./pin-frequency.sh on" >&2
  exit 1
}
echo "-- 주파수 고정 확인됨"

guest_names() { for i in $(seq 1 "$COUNT"); do echo "${PREFIX}${i}"; done; }

guest_ip() {
  virsh -c "$URI" domifaddr "$1" 2>/dev/null \
    | awk '/ipv4/{split($4,a,"/"); print a[1]; exit}'
}

# 파일명의 작업 집합 자리를 0으로 채운 고정폭으로 쓴다.
# 글롭이 다른 국면 결과를 흡수하던 사고(§8.6)를 구조적으로 막는다
fpad() { printf 'f%07d' "$1"; }

# 측정 구간 동안 주파수를 샘플링해 고정이 유지됐음을 남긴다
sample_freq_bg() {
  local out="$1" secs="$2"
  (
    local n=0 sum=0 i c f
    for ((i = 0; i < secs; i++)); do
      for c in /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq; do
        f=$(cat "$c" 2>/dev/null || echo 0)
        sum=$((sum + f)); n=$((n + 1))
      done
      sleep 1
    done
    [[ "$n" -gt 0 ]] && echo "$((sum / n / 1000))" > "$out" || echo 0 > "$out"
  ) &
  echo $!
}

show() {
  local j="$1" freq="$2"
  python3 - "$j" "$freq" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
c = r["config"]
print(f"   {c['footprint_kb']:>7} KB/thread  "
      f"iter/s={r['throughput']['iter_per_sec']:>12,.0f}  "
      f"steal={r['cpu_time_pct'].get('steal', 0.0):>6.2f}%  "
      f"anon_huge={r['anon_huge_kb']:>9} KB  "
      f"freq={sys.argv[2]} MHz")
PY
}

run_host() {
  local fp="$1" hp="$2" label="$3" out="$4"
  local extra=()
  [[ "$hp" == 1 ]] && extra=(--hugepage)
  "$PROBE" --mode mem --threads 8 --duration "$DURATION" --gap "$GAP" \
           --footprint "$fp" "${extra[@]}" --label "$label" --out "$out" \
           2>/dev/null
}

run_guest() {
  local ip="$1" fp="$2" hp="$3" label="$4" out="$5"
  local extra=""
  [[ "$hp" == 1 ]] && extra="--hugepage"
  ssh "${SSH_OPTS[@]}" "ubuntu@$ip" \
    "/tmp/lock-probe --mode mem --threads 8 --duration $DURATION --gap $GAP \
       --footprint $fp $extra --label '$label' --out /tmp/fp.json 2>/dev/null"
  scp "${SSH_OPTS[@]}" -q "ubuntu@$ip:/tmp/fp.json" "$out"
}

prepare_guests() {
  declare -gA IP
  for n in $(guest_names); do
    local ip
    ip="$(guest_ip "$n")"
    [[ -z "$ip" ]] && { echo "$n IP 미할당. provision-guests.sh up 먼저" >&2; exit 1; }
    IP["$n"]="$ip"
    local np
    np="$(ssh "${SSH_OPTS[@]}" "ubuntu@$ip" nproc)"
    # §8.8 smt 국면이 vCPU를 6으로 바꿨다가 되돌린 이력이 있어 매번 확인한다
    [[ "$np" == 8 ]] || { echo "$n nproc=$np (8이어야 함)" >&2; exit 1; }
    # 최대 작업 집합이 들어가는지 사전 확인
    local avail
    avail="$(ssh "${SSH_OPTS[@]}" "ubuntu@$ip" \
             "awk '/MemAvailable/{print \$2}' /proc/meminfo")"
    local need=$((131072 * 8))
    [[ "$avail" -gt $((need + 524288)) ]] || {
      echo "$n MemAvailable=${avail}KB, 필요 ${need}KB + 여유. 부족" >&2; exit 1; }
    scp "${SSH_OPTS[@]}" -q "$PROBE" "ubuntu@$ip:/tmp/lock-probe"
    ssh "${SSH_OPTS[@]}" "ubuntu@$ip" chmod +x /tmp/lock-probe
    echo "   $n ($ip) nproc=$np avail=$((avail / 1024))MB ok"
  done
}

sweep_l1() {
  local tag="$1" hp="$2"
  shift 2
  local fps=("$@")

  echo
  echo "== [$tag] 국면 1: solo (게스트 1대만) =="
  for fp in "${fps[@]}"; do
    local out="$OUTDIR/fp-${tag}-l1-solo-$(fpad "$fp").json"
    local ff="/tmp/.fpfreq.$$"
    local pid; pid=$(sample_freq_bg "$ff" "$DURATION")
    run_guest "${IP[${PREFIX}1]}" "$fp" "$hp" "${tag}-l1-solo-${fp}" "$out"
    wait "$pid" 2>/dev/null || true
    show "$out" "$(cat "$ff" 2>/dev/null || echo '?')"
    sleep 2
  done

  echo
  echo "== [$tag] 국면 2: oversub (게스트 ${COUNT}대 동시) =="
  for fp in "${fps[@]}"; do
    local ff="/tmp/.fpfreq.$$"
    local pid; pid=$(sample_freq_bg "$ff" "$DURATION")
    local pids=()
    for n in $(guest_names); do
      run_guest "${IP[$n]}" "$fp" "$hp" "${tag}-l1-oversub-${n}-${fp}" \
        "$OUTDIR/fp-${tag}-l1-oversub-${n}-$(fpad "$fp").json" &
      pids+=($!)
    done
    for p in "${pids[@]}"; do wait "$p"; done
    wait "$pid" 2>/dev/null || true
    local freq; freq="$(cat "$ff" 2>/dev/null || echo '?')"
    for n in $(guest_names); do
      show "$OUTDIR/fp-${tag}-l1-oversub-${n}-$(fpad "$fp").json" "$freq"
    done
    sleep 2
  done
}

sweep_l0() {
  local tag="$1" hp="$2"
  shift 2
  local fps=("$@")

  echo
  echo "== [$tag] L0 대조군 1: 프로세스 1개 x 8스레드 =="
  for fp in "${fps[@]}"; do
    local out="$OUTDIR/fp-${tag}-l0-1x8-$(fpad "$fp").json"
    local ff="/tmp/.fpfreq.$$"
    local pid; pid=$(sample_freq_bg "$ff" "$DURATION")
    run_host "$fp" "$hp" "${tag}-l0-1x8-${fp}" "$out"
    wait "$pid" 2>/dev/null || true
    show "$out" "$(cat "$ff" 2>/dev/null || echo '?')"
    sleep 2
  done

  echo
  echo "== [$tag] L0 대조군 2: 프로세스 3개 x 8스레드 =="
  for fp in "${fps[@]}"; do
    local ff="/tmp/.fpfreq.$$"
    local pid; pid=$(sample_freq_bg "$ff" "$DURATION")
    local pids=()
    for i in 1 2 3; do
      run_host "$fp" "$hp" "${tag}-l0-3x8-p${i}-${fp}" \
        "$OUTDIR/fp-${tag}-l0-3x8-p${i}-$(fpad "$fp").json" &
      pids+=($!)
    done
    for p in "${pids[@]}"; do wait "$p"; done
    wait "$pid" 2>/dev/null || true
    local freq; freq="$(cat "$ff" 2>/dev/null || echo '?')"
    for i in 1 2 3; do
      show "$OUTDIR/fp-${tag}-l0-3x8-p${i}-$(fpad "$fp").json" "$freq"
    done
    sleep 2
  done
}

case "$PHASE" in
l1)
  echo "== 게스트 준비 =="
  prepare_guests
  sweep_l1 base 0 "${FOOTPRINTS[@]}"
  ;;
l0)
  sweep_l0 base 0 "${FOOTPRINTS[@]}"
  ;;
thp)
  echo "== 게스트 준비 =="
  prepare_guests
  sweep_l1 thp 1 "${THP_FOOTPRINTS[@]}"
  sweep_l0 thp 1 "${THP_FOOTPRINTS[@]}"
  ;;
*)
  echo "usage: $0 <l1|l0|thp> [duration_s]" >&2; exit 1 ;;
esac

rm -f "/tmp/.fpfreq.$$"
echo
echo "== 완료: $OUTDIR/fp-*.json =="
echo "   요약: ./summarize-footprint.py"
