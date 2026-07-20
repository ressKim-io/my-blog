#!/usr/bin/env bash
# 오버레이 세금 측정 드라이버 — 멱등·원커맨드
#
#   ./measure-net.sh l1          게스트 티어 (호스트 sudo 불필요)
#   ./measure-net.sh l0          호스트 티어 (net-setup.sh up 선행 + sudo 필요)
#   ./measure-net.sh all
#
# 환경변수: SIZES(기본 "64 1400")  SAMPLES(기본 20000)  PPS_DUR(기본 5)  TAG
#
# ── 왜 이 티어 구성인가 ──────────────────────────────────────────────
#
# 발행본은 오버레이 왕복 세금을 "VM-Exit 2회 + OVS 탐색 + LLC 스톨 = 2.5~4.0µs"로
# 단언했다. 세 항목 어느 것도 잰 적이 없고, 합산 방식 자체가 검증된 적이 없다.
#
# 여기서는 경로를 티어로 쪼개고 **인접 티어의 차분**만 그 계층의 비용으로 귀속한다.
# 단일 티어의 절대값에는 UDP 스택·스케줄링·virtio가 전부 섞여 있어 그 자체로는
# 아무것도 증명하지 못한다.
#
#   l0-veth     netns <-> netns, Linux bridge     (호스트, 캡슐화 없음)
#   l0-geneve   netns <-> netns, 커널 GENEVE      - l0-veth   = L0 캡슐화 세금
#   l1-bridge   guest <-> guest, virbr0           (virtio 2회 통과)
#   l1-geneve   guest <-> guest, 게스트 커널 GENEVE - l1-bridge = L1 캡슐화 세금
#
# 판정: L1 캡슐화 세금 > L0 캡슐화 세금 이면 "가상화가 오버레이 세금을 증폭한다"가
# 참이고, 두 값이 같으면 발행본 주장은 거짓이다. §8.9에서 LLC 절벽이 가상화 고유가
# 아니었던 것과 같은 형태의 판정이며, 이 시리즈가 §8.4~8.9 내내 써온 방법이다.
#
# ── 측정 위생 ────────────────────────────────────────────────────────
#   - 양단 CPU 고정. 게스트는 vCPU 1과 5(서로 다른 물리 코어에 얹히도록)
#   - 페이로드 64B와 1400B 두 가지. GENEVE 헤더(~50B)가 MTU 1500을 넘기면
#     단편화로 지연이 계단식으로 뛴다. 크기를 밝히지 않은 오버레이 수치는 무의미하다
#   - 워밍업 2000표본 폐기(ARP·이웃 탐색·첫 플로우 미스가 여기 몰린다)
#   - 측정 중 CPU 주파수를 함께 기록한다(§8.8 교훈 — 주파수를 안 보면 결론이 뒤집힌다)
#   - 티어마다 3회 반복. §8.6 교훈 — 단일 실행으로 원인을 귀속하지 않는다

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTDIR="$HERE/results"; mkdir -p "$OUTDIR"

SIZES="${SIZES:-64 1400}"
SAMPLES="${SAMPLES:-20000}"
PPS_DUR="${PPS_DUR:-5}"
REPEAT="${REPEAT:-3}"
TAG="${TAG:-base}"
PORT=9911
TUN_ID=100
OVL_A=10.90.0.1; OVL_B=10.90.0.2

GUEST1=schedlab1; GUEST2=schedlab2
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o ConnectTimeout=5 -o BatchMode=yes -o LogLevel=ERROR)
VIRSH="virsh -c qemu:///system"

msg() { echo "$*" >&2; }
die() { echo "오류: $*" >&2; exit 1; }

guest_ip() {
  $VIRSH domifaddr "$1" 2>/dev/null | awk '/ipv4/{split($4,a,"/"); print a[1]; exit}'
}

gssh() { ssh "${SSH_OPTS[@]}" "ubuntu@$1" "${@:2}"; }

# 측정 구간의 실제 주파수 — §8.8에서 부스트 클럭이 결론을 뒤집은 전례가 있다
freq_snapshot() {
  awk '/cpu MHz/{s+=$4; n++} END{if(n) printf "%.0f", s/n}' /proc/cpuinfo
}

# ── L1: 게스트 티어 ──────────────────────────────────────────────────
l1_prepare() {
  IP1="$(guest_ip $GUEST1)"; IP2="$(guest_ip $GUEST2)"
  [ -n "$IP1" ] && [ -n "$IP2" ] || die "게스트 IP 미할당 — provision-guests.sh up"
  msg "== 프로브 배포: $GUEST1($IP1) $GUEST2($IP2) =="
  for ip in "$IP1" "$IP2"; do
    scp "${SSH_OPTS[@]}" -q "$HERE/net-probe" "ubuntu@${ip}:/tmp/net-probe"
    gssh "$ip" 'chmod +x /tmp/net-probe'
  done
}

# 게스트 안에 GENEVE 인터페이스를 올린다. 언더레이는 기존 virbr0 경로를 그대로 쓴다
# — 호스트를 전혀 건드리지 않으므로 sudo 없이 성립하고, 원상 복구도 링크 삭제뿐이다
l1_geneve_up() {
  msg "== 게스트 GENEVE 구성 =="
  gssh "$IP1" "sudo ip link del gnv0 2>/dev/null; \
               sudo ip link add gnv0 type geneve id $TUN_ID remote $IP2 && \
               sudo ip addr add $OVL_A/24 dev gnv0 && sudo ip link set gnv0 up"
  gssh "$IP2" "sudo ip link del gnv0 2>/dev/null; \
               sudo ip link add gnv0 type geneve id $TUN_ID remote $IP1 && \
               sudo ip addr add $OVL_B/24 dev gnv0 && sudo ip link set gnv0 up"
  gssh "$IP1" "ping -c2 -W2 -q $OVL_B >/dev/null" \
    || die "GENEVE 경로 불통 — 구성 확인 필요"
  msg "   터널 연결 확인 (mtu: $(gssh "$IP1" 'cat /sys/class/net/gnv0/mtu'))"
}

l1_geneve_down() {
  gssh "$IP1" 'sudo ip link del gnv0 2>/dev/null' || true
  gssh "$IP2" 'sudo ip link del gnv0 2>/dev/null' || true
}

# tier, 서버측 bind IP, 클라이언트가 때릴 대상 IP
l1_run_tier() {
  local tier=$1 dst=$2
  msg "== $tier =="
  # pkill -x(실행 파일명 정확 매칭). -f는 자기 자신의 ssh 명령줄에 걸려 접속을 끊는다
  gssh "$IP2" "pkill -x net-probe 2>/dev/null; sleep 0.2; \
               setsid nohup /tmp/net-probe --server --cpu 1 </dev/null >/dev/null 2>&1 & \
               sleep 0.3; exit 0" 
  for size in $SIZES; do
    for r in $(seq 1 "$REPEAT"); do
      local out="$OUTDIR/net-${TAG}-${tier}-s${size}-r${r}.json"
      local f0; f0="$(freq_snapshot)"
      gssh "$IP1" "/tmp/net-probe --client --target $dst --cpu 5 --size $size \
                   --samples $SAMPLES --label ${tier}-s${size}-r${r} --out /tmp/o.json" >/dev/null
      scp "${SSH_OPTS[@]}" -q "ubuntu@${IP1}:/tmp/o.json" "$out"
      python3 - "$out" "$f0" "$(freq_snapshot)" <<'PY'
import json,sys
p,f0,f1=sys.argv[1],sys.argv[2],sys.argv[3]
d=json.load(open(p)); d["host_mhz"]={"before":float(f0),"after":float(f1)}
json.dump(d,open(p,"w"),indent=2)
print(f"   {d['label']:<28} p50={d['rtt_us']['p50']:7.2f}us  p99={d['rtt_us']['p99']:7.2f}us  lost={d['lost']}")
PY
    done
    # PPS는 크기당 1회 — 분위수가 아니라 총량이라 반복 이득이 작다
    local pout="$OUTDIR/net-${TAG}-${tier}-s${size}-pps.json"
    gssh "$IP1" "/tmp/net-probe --client --target $dst --cpu 5 --size $size \
                 --mode pps --duration $PPS_DUR --label ${tier}-s${size}-pps --out /tmp/p.json" >/dev/null
    scp "${SSH_OPTS[@]}" -q "ubuntu@${IP1}:/tmp/p.json" "$pout"
    python3 -c "
import json,sys; d=json.load(open('$pout'))
print(f\"   {d['label']:<28} pps={d['pps']:>10,.0f}  {d['mbps']:8.1f} Mbps\")"
  done
  gssh "$IP2" "pkill -x net-probe 2>/dev/null; exit 0" || true
}

run_l1() {
  l1_prepare
  l1_run_tier l1-bridge "$IP2"
  l1_geneve_up
  l1_run_tier l1-geneve "$OVL_B"
  l1_geneve_down
  msg "== L1 완료 — 게스트 GENEVE 인터페이스는 제거했습니다 =="
}

# ── L0: 호스트 티어 (net-setup.sh 로 구성 후 실행) ───────────────────
l0_run_tier() {
  local tier=$1 dst=$2
  local NSA=nt-nsa NSB=nt-nsb
  ip netns list | grep -qw "$NSA" || die "netns 없음 — sudo ./net-setup.sh up $tier 먼저"
  msg "== $tier =="
  ip netns exec "$NSB" "$HERE/net-probe" --server --cpu 1 >/dev/null 2>&1 &
  local srv=$!; sleep 0.3
  for size in $SIZES; do
    for r in $(seq 1 "$REPEAT"); do
      local out="$OUTDIR/net-${TAG}-${tier}-s${size}-r${r}.json"
      local f0; f0="$(freq_snapshot)"
      ip netns exec "$NSA" "$HERE/net-probe" --client --target "$dst" --cpu 5 \
        --size "$size" --samples "$SAMPLES" --label "${tier}-s${size}-r${r}" --out "$out" 2>/dev/null
      python3 - "$out" "$f0" "$(freq_snapshot)" <<'PY'
import json,sys
p,f0,f1=sys.argv[1],sys.argv[2],sys.argv[3]
d=json.load(open(p)); d["host_mhz"]={"before":float(f0),"after":float(f1)}
json.dump(d,open(p,"w"),indent=2)
print(f"   {d['label']:<28} p50={d['rtt_us']['p50']:7.2f}us  p99={d['rtt_us']['p99']:7.2f}us  lost={d['lost']}")
PY
    done
    local pout="$OUTDIR/net-${TAG}-${tier}-s${size}-pps.json"
    ip netns exec "$NSA" "$HERE/net-probe" --client --target "$dst" --cpu 5 \
      --size "$size" --mode pps --duration "$PPS_DUR" --label "${tier}-s${size}-pps" --out "$pout" 2>/dev/null
    python3 -c "
import json; d=json.load(open('$pout'))
print(f\"   {d['label']:<28} pps={d['pps']:>10,.0f}  {d['mbps']:8.1f} Mbps\")"
  done
  kill "$srv" 2>/dev/null || true; wait "$srv" 2>/dev/null || true
  # sudo로 돌면 결과가 root 소유로 남는다 — 원래 사용자에게 되돌려 준다
  [ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER" "$OUTDIR"/net-"${TAG}"-"${tier}"-*.json 2>/dev/null || true
}

run_l0() {
  l0_run_tier l0-veth   10.90.0.2
  msg "다음: sudo ./net-setup.sh up l0-geneve 후 './measure-net.sh l0-geneve'"
}

case "${1:-all}" in
  l1)        run_l1 ;;
  l0-veth)   l0_run_tier l0-veth   10.90.0.2 ;;
  l0-geneve) l0_run_tier l0-geneve 10.90.0.2 ;;
  l0)        run_l0 ;;
  all)       run_l1; run_l0 ;;
  *) sed -n '2,8p' "$0"; exit 2 ;;
esac
