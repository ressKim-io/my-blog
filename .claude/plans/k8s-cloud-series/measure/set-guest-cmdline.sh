#!/usr/bin/env bash
# 게스트 커널 명령줄 파라미터 토글 후 재부팅 — pv-qspinlock 대조 실험용
#
# 멱등·원커맨드: ./set-guest-cmdline.sh <add|remove> <param>
#   예: ./set-guest-cmdline.sh add nopvspin
#       ./set-guest-cmdline.sh remove nopvspin
#
# nopvspin은 게스트가 pv-qspinlock(CONFIG_PARAVIRT_SPINLOCKS) 대신 순수
# qspinlock을 쓰게 만든다. 락 소유자가 하이퍼바이저에 선점당했을 때
# 대기자가 양보하지 못하고 계속 스핀하므로, 5편이 묘사한 LHP의 민낯이 드러난다.
# 켠 상태와 끈 상태를 대조해야 완화 기전의 값어치가 숫자로 분리된다.
set -euo pipefail

ACTION="${1:?usage: $0 <add|remove> <param>}"
PARAM="${2:?usage: $0 <add|remove> <param>}"

PREFIX="${PREFIX:-schedlab}"
COUNT="${COUNT:-3}"
URI="qemu:///system"

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o ConnectTimeout=5 -o BatchMode=yes -o LogLevel=ERROR)

guest_names() { for i in $(seq 1 "$COUNT"); do echo "${PREFIX}${i}"; done; }

guest_ip() {
  virsh -c "$URI" domifaddr "$1" 2>/dev/null \
    | awk '/ipv4/{split($4,a,"/"); print a[1]; exit}'
}

declare -A IP
for n in $(guest_names); do
  ip="$(guest_ip "$n")"
  [[ -z "$ip" ]] && { echo "$n IP 미할당" >&2; exit 1; }
  IP["$n"]="$ip"
done

for n in $(guest_names); do
  echo "-- $n ($ACTION $PARAM)"
  ssh "${SSH_OPTS[@]}" "ubuntu@${IP[$n]}" \
    "sudo python3 - '$ACTION' '$PARAM'" <<'PY'
import os, subprocess, sys

action, param = sys.argv[1], sys.argv[2]

# /etc/default/grub 을 고치면 안 된다. 우분투 클라우드 이미지는
# /etc/default/grub.d/50-cloudimg-settings.cfg 를 나중에 읽으면서
# GRUB_CMDLINE_LINUX_DEFAULT 를 통째로 덮어쓴다.
# 50번 뒤에 오는 드롭인에서 기존 값에 덧붙여야 반영된다.
dropin = "/etc/default/grub.d/99-schedlab.cfg"
key = "GRUB_CMDLINE_LINUX_DEFAULT"

if action == "add":
    with open(dropin, "w") as f:
        f.write(f'{key}="${key} {param}"\n')
    print(f"  {dropin} 작성")
else:
    if os.path.exists(dropin):
        os.remove(dropin)
        print(f"  {dropin} 제거")
    else:
        print(f"  {dropin} 없음(이미 제거됨)")

subprocess.run(["update-grub"], check=True,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("  grub 갱신 완료")
PY
  ssh "${SSH_OPTS[@]}" "ubuntu@${IP[$n]}" "sudo systemctl reboot" || true
done

echo
echo "== 재부팅 대기 =="
sleep 10
for n in $(guest_names); do
  for _ in $(seq 1 60); do
    if ssh "${SSH_OPTS[@]}" "ubuntu@${IP[$n]}" true 2>/dev/null; then
      cmdline="$(ssh "${SSH_OPTS[@]}" "ubuntu@${IP[$n]}" cat /proc/cmdline)"
      echo "   $n ready"
      echo "      cmdline: $cmdline"
      # 실제로 반영됐는지 확인한다. 반영 안 된 채로 측정하면 대조가 무의미하다
      if [[ "$ACTION" == "add" && "$cmdline" != *"$PARAM"* ]]; then
        echo "      경고: $PARAM 이 명령줄에 없습니다" >&2
      fi
      if [[ "$ACTION" == "remove" && "$cmdline" == *"$PARAM"* ]]; then
        echo "      경고: $PARAM 이 아직 남아 있습니다" >&2
      fi
      echo "      $(ssh "${SSH_OPTS[@]}" "ubuntu@${IP[$n]}" \
             'sudo dmesg | grep -i "spinlock" | tail -1' || echo '(로그 없음)')"
      break
    fi
    sleep 3
  done
done
echo "== 완료 =="
