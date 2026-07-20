#!/usr/bin/env bash
# 오버레이 세금 측정용 네트워크 티어 구성 — 멱등, 원커맨드
#
#   ./net-setup.sh up     <tier>   구성
#   ./net-setup.sh verify <tier>   연결 확인 (측정 전 필수)
#   ./net-setup.sh down   <tier>   해체
#   ./net-setup.sh status          전체 상태
#   ./net-setup.sh down-all        전부 해체 (원상 복구)
#
# 안전 규칙 (코드로 강제):
#   - 물리 NIC(enp*/eth*/wl*)과 virbr0은 **절대 건드리지 않는다**. 이름 접두사로 차단
#   - 게스트에는 측정 전용 **두 번째 NIC을 추가**한다. 기존 NIC(SSH 경로)은 그대로 둔다
#   - 모든 생성물은 이름 접두사 'nt-' 를 갖는다. down-all은 그 접두사만 지운다
#
# 티어 설계 — 각 증분이 한 계층의 비용이 되도록 배치했다
#
#   l0-veth      netns <-> netns, Linux bridge          바닥(소프트웨어 스위칭)
#   l0-ovs       netns <-> netns, OVS bridge            - l0-veth = OVS 플로우 탐색
#   l0-geneve    netns <-> netns, 커널 GENEVE           - l0-veth = 캡슐화
#   l1-bridge    guest <-> guest, Linux bridge          - l0-veth = 가상화 경계
#   l1-ovs       guest <-> guest, OVS bridge            - l1-bridge = OVS 탐색(가상화 위)
#   l1-geneve    guest <-> guest, 커널 GENEVE           - l1-bridge = 캡슐화(가상화 위)
#
# 핵심 대조: (l1-geneve - l1-bridge) 와 (l0-geneve - l0-veth) 의 비교.
# 전자가 크면 "가상화가 캡슐화 세금을 증폭한다"가 참이고, 같으면 발행본 주장이 거짓이다.
# §8.9에서 LLC 절벽이 가상화 고유가 아니었던 것과 같은 형태의 판정이다.
#
# GENEVE 터널 엔드포인트를 **양쪽 다 netns 안에** 두는 이유: 커널 GENEVE는 UDP 6081을
# 쓰는데 한 netns에 두 엔드포인트를 두면 포트가 충돌한다. netns를 나누면 포트 공간이
# 분리돼 단일 호스트에서도 두 노드를 정직하게 흉내낼 수 있다.

set -euo pipefail

P=nt                                  # 모든 생성물 접두사
NS_A="${P}-nsa"; NS_B="${P}-nsb"
BR_L0="${P}-br0"                      # Linux bridge (l0-veth)
OVS_L0="${P}-ovs0"                    # OVS bridge (l0-ovs)
BR_L1="${P}-br1"                      # Linux bridge (l1-bridge)
OVS_L1="${P}-ovs1"                    # OVS bridge (l1-ovs)

OVL_A=10.90.0.1; OVL_B=10.90.0.2      # 오버레이(측정 대상 주소)
UL_A=10.91.0.1;  UL_B=10.91.0.2       # 언더레이(터널 전송로)
G1_IP=10.92.0.11; G2_IP=10.92.0.12    # 게스트 두 번째 NIC
GUEST1=schedlab1; GUEST2=schedlab2

VIRSH="virsh -c qemu:///system"
die() { echo "오류: $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

need_root() { [ "$(id -u)" -eq 0 ] || die "root 권한이 필요합니다 — sudo $0 $*"; }

# 물리 NIC 보호 — 이 스크립트가 만든 것 외에는 어떤 링크도 만지지 않는다
assert_ours() {
    case "$1" in
        ${P}-*) : ;;
        *) die "안전 차단: '$1' 은 이 스크립트 생성물이 아닙니다" ;;
    esac
}

link_del() { assert_ours "$1"; ip link del "$1" 2>/dev/null || true; }
ns_del()   { assert_ours "$1"; ip netns del "$1" 2>/dev/null || true; }

ensure_ns() { ip netns list | grep -qw "$1" || ip netns add "$1"; }

# ── L0 공통: netns 두 개 + veth 두 쌍 ────────────────────────────────
setup_l0_endpoints() {
    ensure_ns "$NS_A"; ensure_ns "$NS_B"
    for pair in "a:$NS_A:$OVL_A" "b:$NS_B:$OVL_B"; do
        IFS=: read -r tag ns ip <<<"$pair"
        host_if="${P}-h${tag}"; ns_if="${P}-p${tag}"
        if ! ip link show "$host_if" >/dev/null 2>&1; then
            ip link add "$host_if" type veth peer name "$ns_if"
            ip link set "$ns_if" netns "$ns"
        fi
        ip link set "$host_if" up
        ip -n "$ns" addr flush dev "$ns_if" 2>/dev/null || true
        ip -n "$ns" addr add "${ip}/24" dev "$ns_if"
        ip -n "$ns" link set "$ns_if" up
        ip -n "$ns" link set lo up
    done
}

detach_l0_endpoints() {
    for br in "$BR_L0"; do
        ip link show "$br" >/dev/null 2>&1 || continue
        for tag in a b; do
            ip link set "${P}-h${tag}" nomaster 2>/dev/null || true
        done
    done
    if have ovs-vsctl; then
        for tag in a b; do
            ovs-vsctl --if-exists del-port "$OVS_L0" "${P}-h${tag}" 2>/dev/null || true
        done
    fi
}

up_l0_veth() {
    setup_l0_endpoints; detach_l0_endpoints
    ip link show "$BR_L0" >/dev/null 2>&1 || ip link add "$BR_L0" type bridge
    ip link set "$BR_L0" up
    for tag in a b; do ip link set "${P}-h${tag}" master "$BR_L0"; done
}

up_l0_ovs() {
    have ovs-vsctl || die "ovs-vsctl 없음 — sudo apt install openvswitch-switch"
    setup_l0_endpoints; detach_l0_endpoints
    ovs-vsctl --may-exist add-br "$OVS_L0"
    for tag in a b; do ovs-vsctl --may-exist add-port "$OVS_L0" "${P}-h${tag}"; done
    ip link set "$OVS_L0" up
}

# 커널 GENEVE — 언더레이는 netns를 직접 잇는 veth 쌍, 오버레이 주소는 gnv0에 붙는다
up_l0_geneve() {
    ensure_ns "$NS_A"; ensure_ns "$NS_B"
    if ! ip -n "$NS_A" link show "${P}-ula" >/dev/null 2>&1; then
        ip link add "${P}-ula" type veth peer name "${P}-ulb"
        ip link set "${P}-ula" netns "$NS_A"
        ip link set "${P}-ulb" netns "$NS_B"
    fi
    ip -n "$NS_A" addr flush dev "${P}-ula" 2>/dev/null || true
    ip -n "$NS_B" addr flush dev "${P}-ulb" 2>/dev/null || true
    ip -n "$NS_A" addr add "${UL_A}/24" dev "${P}-ula"
    ip -n "$NS_B" addr add "${UL_B}/24" dev "${P}-ulb"
    ip -n "$NS_A" link set "${P}-ula" up; ip -n "$NS_A" link set lo up
    ip -n "$NS_B" link set "${P}-ulb" up; ip -n "$NS_B" link set lo up

    ip -n "$NS_A" link del "${P}-gnv" 2>/dev/null || true
    ip -n "$NS_B" link del "${P}-gnv" 2>/dev/null || true
    ip -n "$NS_A" link add "${P}-gnv" type geneve id 100 remote "$UL_B"
    ip -n "$NS_B" link add "${P}-gnv" type geneve id 100 remote "$UL_A"
    ip -n "$NS_A" addr add "${OVL_A}/24" dev "${P}-gnv"
    ip -n "$NS_B" addr add "${OVL_B}/24" dev "${P}-gnv"
    ip -n "$NS_A" link set "${P}-gnv" up
    ip -n "$NS_B" link set "${P}-gnv" up
}

# ── L1: 게스트에 측정 전용 두 번째 NIC 추가 ──────────────────────────
# 기존 NIC(virbr0/SSH)은 건드리지 않는다. 게스트 안 IP 설정은 사용자가 게스트에서 수행
attach_guest_nic() {
    local dom=$1 brname=$2 kind=$3   # kind = linux | ovs
    local mac; mac=$(printf '52:54:00:aa:%02x:%02x' "$((RANDOM%256))" "$((RANDOM%256))")
    local xml; xml=$(mktemp /tmp/${P}-nic-XXXX.xml)
    if [ "$kind" = ovs ]; then
        cat >"$xml" <<EOF
<interface type='bridge'>
  <source bridge='$brname'/>
  <virtualport type='openvswitch'/>
  <model type='virtio'/>
  <mac address='$mac'/>
</interface>
EOF
    else
        cat >"$xml" <<EOF
<interface type='bridge'>
  <source bridge='$brname'/>
  <model type='virtio'/>
  <mac address='$mac'/>
</interface>
EOF
    fi
    $VIRSH attach-device "$dom" "$xml" --live
    rm -f "$xml"
}

guest_nic_count() { $VIRSH domiflist "$1" | awk 'NR>2 && NF' | wc -l; }

up_l1_common() {
    local brname=$1 kind=$2
    if [ "$kind" = ovs ]; then
        have ovs-vsctl || die "ovs-vsctl 없음 — sudo apt install openvswitch-switch"
        ovs-vsctl --may-exist add-br "$brname"
    else
        ip link show "$brname" >/dev/null 2>&1 || ip link add "$brname" type bridge
    fi
    ip link set "$brname" up
    for g in "$GUEST1" "$GUEST2"; do
        if [ "$(guest_nic_count "$g")" -lt 2 ]; then
            attach_guest_nic "$g" "$brname" "$kind"
            echo "  $g: 측정용 NIC 추가 -> $brname"
        else
            echo "  $g: NIC 이미 2개 — 건너뜀 (교체하려면 down 후 up)"
        fi
    done
    cat <<EOF

  게스트 안에서 다음을 실행해 주소를 붙이십시오 (두 번째 NIC = 보통 enp*s0 중 새 것):
    $GUEST1:  sudo ip addr add ${G1_IP}/24 dev <새NIC> && sudo ip link set <새NIC> up
    $GUEST2:  sudo ip addr add ${G2_IP}/24 dev <새NIC> && sudo ip link set <새NIC> up
EOF
}

down_l1() {
    for g in "$GUEST1" "$GUEST2"; do
        $VIRSH domiflist "$g" 2>/dev/null | awk 'NR>2 && NF' | while read -r ifn typ src rest; do
            case "$src" in
                ${P}-*) $VIRSH detach-interface "$g" bridge --mac "$(echo "$rest" | awk '{print $2}')" --live 2>/dev/null || true ;;
            esac
        done
    done
    link_del "$BR_L1"
    have ovs-vsctl && ovs-vsctl --if-exists del-br "$OVS_L1" || true
}

# ── verify ───────────────────────────────────────────────────────────
verify_tier() {
    case "$1" in
        l0-*)
            echo -n "  $NS_A -> $OVL_B : "
            ip netns exec "$NS_A" ping -c2 -W2 -q "$OVL_B" >/dev/null 2>&1 \
                && echo OK || { echo FAIL; return 1; }
            ;;
        l1-*)
            echo "  게스트 간 확인은 게스트 안에서: ping -c2 ${G2_IP}"
            ;;
    esac
}

status() {
    echo "== netns =="; ip netns list | grep "^${P}-" || echo "  (없음)"
    echo "== links =="; ip -br link show | grep "^${P}-" || echo "  (없음)"
    have ovs-vsctl && { echo "== ovs =="; ovs-vsctl list-br | grep "^${P}-" || echo "  (없음)"; }
    echo "== guest NIC =="
    for g in "$GUEST1" "$GUEST2"; do
        echo "  $g: $(guest_nic_count "$g") 개"
    done
}

down_all() {
    down_l1
    ns_del "$NS_A"; ns_del "$NS_B"
    for tag in a b; do link_del "${P}-h${tag}"; done
    link_del "$BR_L0"; link_del "$BR_L1"
    if have ovs-vsctl; then
        ovs-vsctl --if-exists del-br "$OVS_L0" || true
        ovs-vsctl --if-exists del-br "$OVS_L1" || true
    fi
    echo "원상 복구 완료 (물리 NIC·virbr0 무변경)"
}

# ── main ─────────────────────────────────────────────────────────────
action=${1:-status}; tier=${2:-}

case "$action" in
    up)
        need_root "$@"
        case "$tier" in
            l0-veth)   up_l0_veth ;;
            l0-ovs)    up_l0_ovs ;;
            l0-geneve) up_l0_geneve ;;
            l1-bridge) up_l1_common "$BR_L1" linux ;;
            l1-ovs)    up_l1_common "$OVS_L1" ovs ;;
            l1-geneve) up_l1_common "$BR_L1" linux
                       echo "  (게스트 안에서 gnv0 GENEVE 인터페이스를 구성하십시오 — 아래 verify 참조)" ;;
            *) die "알 수 없는 tier: '$tier' (l0-veth|l0-ovs|l0-geneve|l1-bridge|l1-ovs|l1-geneve)" ;;
        esac
        echo "up: $tier 완료"; verify_tier "$tier" || true ;;
    verify) verify_tier "$tier" ;;
    down)
        need_root "$@"
        case "$tier" in
            l0-veth)   link_del "$BR_L0" ;;
            l0-ovs)    have ovs-vsctl && ovs-vsctl --if-exists del-br "$OVS_L0" ;;
            l0-geneve) ip -n "$NS_A" link del "${P}-gnv" 2>/dev/null || true
                       ip -n "$NS_B" link del "${P}-gnv" 2>/dev/null || true ;;
            l1-*)      down_l1 ;;
            *) die "알 수 없는 tier: '$tier'" ;;
        esac
        echo "down: $tier 완료" ;;
    down-all) need_root "$@"; down_all ;;
    status)   status ;;
    *) sed -n '2,10p' "$0"; exit 2 ;;
esac
