#!/usr/bin/env bash
# CPU 주파수 하드 고정 — 측정에서 부스트 클럭 교란을 제거한다
#
# 원커맨드: ./pin-frequency.sh <on|off|status>
#
# 왜 필요한가: §8.8 SMT 측정에서 벽시계 결과가 부스트 클럭 때문에 뒤집혔다.
# 3코어만 쓰면 5,039 MHz, 6코어를 쓰면 4,444 MHz로 붙어서, SMT를 공유하는 배치가
# 오히려 빨라 보였다. 사후 보정은 유휴 코어가 평균을 오염시켜 신뢰하기 어렵다.
# 그래서 아예 고정한다.
#
# 고정 값은 scaling_min_freq(= amd_pstate_lowest_nonlinear_freq)와 같은 값이다.
# 이 주파수는 12스레드 전부 부하를 걸어도 확실히 유지되므로, 활성 코어 수에
# 상관없이 같은 클럭이 보장된다.
set -euo pipefail

ACTION="${1:?usage: $0 <on|off|status>}"

CPUS=$(ls -d /sys/devices/system/cpu/cpu[0-9]* 2>/dev/null \
       | grep -E 'cpu[0-9]+$' | sort -V)
PINNED_KHZ="${PINNED_KHZ:-2997505}"
FULL_KHZ="${FULL_KHZ:-5077405}"

show_status() {
  local all_pinned=1
  for c in $CPUS; do
    [[ -f "$c/cpufreq/scaling_max_freq" ]] || continue
    local mx cur
    mx=$(cat "$c/cpufreq/scaling_max_freq")
    cur=$(cat "$c/cpufreq/scaling_cur_freq")
    printf "  %-6s max=%-8s cur=%s MHz\n" "$(basename "$c")" "$mx" "$((cur / 1000))"
    [[ "$mx" == "$PINNED_KHZ" ]] || all_pinned=0
  done
  if [[ "$all_pinned" == 1 ]]; then
    echo "고정 상태: ON (${PINNED_KHZ} kHz)"
    return 0
  fi
  echo "고정 상태: OFF"
  return 1
}

case "$ACTION" in
on|off)
  if [[ "$ACTION" == "on" ]]; then TARGET="$PINNED_KHZ"; else TARGET="$FULL_KHZ"; fi
  echo "-- scaling_max_freq -> $TARGET kHz (sudo 필요)"
  for c in $CPUS; do
    [[ -f "$c/cpufreq/scaling_max_freq" ]] || continue
    echo "$TARGET" | sudo tee "$c/cpufreq/scaling_max_freq" >/dev/null
  done
  # 쓰기가 먹었는지 반드시 되읽어 확인한다. 조용히 무시되는 경우가 있다
  echo "-- 검증"
  show_status || {
    [[ "$ACTION" == "on" ]] && { echo "고정 실패" >&2; exit 1; }
  }
  ;;
status)
  show_status || true
  ;;
*)
  echo "usage: $0 <on|off|status>" >&2; exit 1 ;;
esac
