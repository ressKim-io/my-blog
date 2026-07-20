#!/usr/bin/env bash
# KVM 게스트 프로비저닝 — 5편 이중 스케줄링 실측용
#
# 멱등: 이미 있는 게스트는 건너뛴다. 다시 만들려면 ./provision-guests.sh destroy 후 재실행.
# 원커맨드: ./provision-guests.sh [up|destroy|status|ips]
#
# 토폴로지 (호스트 12 pCPU 기준):
#   게스트 3개 x 8 vCPU = 24 vCPU  ->  하이퍼바이저 레벨 2배 오버스크립션
#   게스트 각각은 자기 관점에서 1배(8워커/8vCPU)로만 돌린다.
#   따라서 게스트 내부 런큐 대기는 낮게 유지되는데 steal만 치솟는 그림이 나와야 한다.
#   그 격차가 곧 "게스트 스케줄러에게 보이지 않는 하이퍼바이저 계층의 세금"이다.
set -euo pipefail

ACTION="${1:-up}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB="${LAB:-$HOME/vm-lab}"
BASE_IMG="$LAB/images/noble-server-cloudimg-amd64.img"
PREFIX="${PREFIX:-schedlab}"
COUNT="${COUNT:-3}"
VCPUS="${VCPUS:-8}"
MEM_MB="${MEM_MB:-4096}"
DISK_GB="${DISK_GB:-10}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519.pub}"
URI="qemu:///system"

vsh() { virsh -c "$URI" "$@"; }

guest_names() { for i in $(seq 1 "$COUNT"); do echo "${PREFIX}${i}"; done; }

require() {
  [[ -f "$BASE_IMG" ]] || { echo "base image 없음: $BASE_IMG" >&2; exit 1; }
  [[ -f "$SSH_KEY" ]]  || { echo "ssh 공개키 없음: $SSH_KEY" >&2; exit 1; }
  vsh version >/dev/null 2>&1 || {
    echo "libvirt 접속 불가. libvirt 그룹 반영을 위해 재로그인이 필요합니다" >&2; exit 1; }
}

ensure_network() {
  if ! vsh net-info default >/dev/null 2>&1; then
    echo "default 네트워크가 없습니다. virsh net-define 필요" >&2; exit 1
  fi
  if [[ "$(vsh net-info default | awk '/^Active/{print $2}')" != "yes" ]]; then
    echo "-- default 네트워크 기동"
    vsh net-start default
  fi
  vsh net-autostart default >/dev/null 2>&1 || true
}

make_seed() {
  local name="$1"
  local seeddir="$LAB/seed/$name"
  mkdir -p "$seeddir"
  cat > "$seeddir/user-data" <<EOF
#cloud-config
hostname: $name
fqdn: $name.schedlab
users:
  - name: ubuntu
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - $(cat "$SSH_KEY")
# 부팅을 빠르게 유지한다. 측정 에이전트는 클라우드 이미지의 python3만 쓴다
package_update: false
package_upgrade: false
EOF
  printf 'instance-id: %s\nlocal-hostname: %s\n' "$name" "$name" \
    > "$seeddir/meta-data"
  cloud-localds "$LAB/images/${name}-seed.iso" \
    "$seeddir/user-data" "$seeddir/meta-data"
}

create_guest() {
  local name="$1"
  local disk="$LAB/images/${name}.qcow2"

  if vsh dominfo "$name" >/dev/null 2>&1; then
    echo "-- $name 이미 존재, 건너뜀"
    return
  fi

  echo "-- $name 생성 (${VCPUS} vCPU / ${MEM_MB}MB / ${DISK_GB}G)"
  # 백킹 파일 오버레이 — 베이스 이미지를 공유하므로 게스트당 수백 MB만 소비한다
  qemu-img create -f qcow2 -F qcow2 -b "$BASE_IMG" "$disk" "${DISK_GB}G" >/dev/null
  make_seed "$name"

  virt-install \
    --connect "$URI" \
    --name "$name" \
    --memory "$MEM_MB" \
    --vcpus "$VCPUS" \
    --cpu host-passthrough \
    --disk "path=$disk,format=qcow2,bus=virtio" \
    --disk "path=$LAB/images/${name}-seed.iso,device=cdrom" \
    --os-variant ubuntu24.04 \
    --network network=default,model=virtio \
    --graphics none \
    --import \
    --noautoconsole
}

guest_ip() {
  local name="$1"
  vsh domifaddr "$name" 2>/dev/null \
    | awk '/ipv4/{split($4,a,"/"); print a[1]; exit}'
}

case "$ACTION" in
  up)
    require
    ensure_network
    mkdir -p "$LAB/images" "$LAB/seed"
    for n in $(guest_names); do create_guest "$n"; done

    echo "== 부팅 및 IP 할당 대기 =="
    for n in $(guest_names); do
      for _ in $(seq 1 60); do
        ip="$(guest_ip "$n")"
        [[ -n "$ip" ]] && break
        sleep 2
      done
      echo "   $n -> ${ip:-(IP 미할당)}"
    done

    echo "== SSH 준비 대기 =="
    for n in $(guest_names); do
      ip="$(guest_ip "$n")"
      [[ -z "$ip" ]] && { echo "   $n: IP 없음, 건너뜀"; continue; }
      for _ in $(seq 1 60); do
        if ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
               -o ConnectTimeout=3 -o BatchMode=yes \
               "ubuntu@$ip" true 2>/dev/null; then
          echo "   $n ($ip) ready"; break
        fi
        sleep 3
      done
    done
    echo "== 완료. 다음: ./measure-guests.sh =="
    ;;

  destroy)
    require
    for n in $(guest_names); do
      vsh destroy "$n" 2>/dev/null || true
      vsh undefine "$n" --nvram 2>/dev/null || true
      rm -f "$LAB/images/${n}.qcow2" "$LAB/images/${n}-seed.iso"
      rm -rf "$LAB/seed/$n"
      echo "-- $n 제거"
    done
    ;;

  status)
    require
    vsh list --all
    echo
    free -h
    ;;

  ips)
    require
    for n in $(guest_names); do echo "$n $(guest_ip "$n")"; done
    ;;

  *)
    echo "usage: $0 [up|destroy|status|ips]" >&2; exit 1
    ;;
esac
