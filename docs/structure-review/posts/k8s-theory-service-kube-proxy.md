# Service와 kube-proxy — 고정 주소 뒤의 목록·규칙·연결 상태 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-service-kube-proxy.md](../../../src/content/essays/kubernetes/k8s-theory-service-kube-proxy.md)
- 시리즈: `k8s-theory-network` / 4
- 원문 SHA256: `6bec2d2cdfa572114289d9e909dba7ea8b611f2f64c21a1acef76d7492a464d5`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 큰 단위 재배치

## 독자와 중심 질문

Service IP로 시작한 한 연결은 어떻게 백엔드를 선택하고, 백엔드 목록이 바뀌어도 기존 연결은 왜 같은 경로를 사용할 수 있을까요?

선행 개념: Pod 간 IP 통신과 Service의 selector를 간단히 알고 있다고 가정합니다. EndpointSlice·DNAT·conntrack은 등장하는 순간 정의합니다

## 현재 전개

- L23: 백엔드 목록과 패킷 전달은 다른 흐름입니다
- L58: ClusterIP 할당과 백엔드 선택은 별도 작업입니다
- L102: iptables는 Service를 찾은 뒤 확률로 백엔드를 고릅니다
- L125: conntrack은 변환을 기억해 재사용하고 응답을 되돌립니다
- L168: 프록시 모드는 조회 구조와 분배 방식을 함께 봐야 합니다
- L222: externalTrafficPolicy Local은 후보를 줄여 출발지 보존을 돕습니다
- L246: Cilium 소켓 경로는 Service를 조회하는 위치를 옮깁니다
- L264: 실패 지점은 할당·목록·규칙·연결 상태로 나눕니다
- L283: 확인한 근거

## 원문 근거와 개선점

### L40 전체 전달 흐름을 보기 전에 목록 관리 세부로 들어갑니다

> ### 주소 목록을 나눠 변경된 조각을 전달합니다

도입에서 목록 갱신과 패킷 처리를 나눈 점은 좋습니다. 바로 뒤에 조각 크기·상한·deprecated API·selector 예외가 이어져 실제 패킷 처리까지 거리가 생깁니다

수정 방향: 처음에는 EndpointSlice가 백엔드 주소·상태를 담고 kube-proxy가 이를 규칙으로 반영한다는 관계만 설명합니다. 조각 크기와 selector 예외는 기본 연결 흐름 뒤의 목록 갱신 절로 옮깁니다

### L70 첫 ClusterIP 연결을 설명하기 전에 예외와 접근점이 늘어납니다

> ### Service 타입은 접근점을 구분합니다

NodePort·LoadBalancer·ExternalName·headless를 먼저 비교하면 아직 DNAT와 conntrack을 모르는 독자가 생략되거나 달라지는 단계를 판단하기 어렵습니다

수정 방향: 일반 ClusterIP의 새 연결·응답·기존 연결 재사용을 먼저 완결합니다. 그 뒤 타입과 headless를 기본 경로에서 무엇이 추가되거나 빠지는지로 비교합니다

### L168 구현 비교와 외부 접근 정책을 구분해 읽게 합니다

> ## 프록시 모드는 조회 구조와 분배 방식을 함께 봐야 합니다

모드 비교 안에 GA 상태·폐기 여부·NodePort 수신 주소·localhost 조건까지 들어 있고 이후 외부 트래픽 정책과 Cilium 경로가 이어집니다. 기능별 차이와 구현별 차이를 동시에 추적해야 합니다

수정 방향: ClusterIP 기본 경로 다음을 목록 변화와 연결 상태, 외부 접근과 Local 정책, 구현별 대체 경로의 세 단위로 구분합니다. NodePort 주소 예외는 외부 접근 단위에 두되 모드별 조건을 함께 유지합니다

## 권장 설명 순서

1. Pod 교체에도 사용할 접점이라는 Service의 목적과 일반 ClusterIP 사례를 제시합니다
2. Service·EndpointSlice·kube-proxy·커널의 역할을 목록 갱신 흐름과 패킷 흐름으로 구분합니다
3. iptables의 첫 연결을 따라 Service 조회·백엔드 선택·DNAT·conntrack 기록·응답 역변환을 한 번에 설명합니다
4. 기존 흐름 재사용과 백엔드 목록 변경을 연결하고 EndpointSlice 분할, UDP stale 상태, conntrack 용량을 서로 다른 문제로 정리합니다
5. Service 타입과 headless를 기본 경로와 비교하고 외부 트래픽의 Cluster·Local 후보, NodePort 수신 주소 조건을 설명합니다
6. iptables·IPVS·nftables와 Cilium 소켓 경로를 조회 위치·분배 방식·지원 조건으로 비교합니다. GA·기본값·deprecated를 별개로 표기합니다
7. 주소 할당·백엔드 목록·규칙 반영·기존 연결 상태를 구분하는 진단표로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

첫 패킷에서 고른 백엔드는 conntrack의 변환 상태에 남습니다
이제 EndpointSlice에서 백엔드를 제거했을 때 새 연결과 이미 이어진 연결이 왜 다르게 움직일 수 있는지 볼 수 있습니다

## 유지할 내용과 조건

- API 서버·controller가 매 패킷의 백엔드를 고르지 않는다는 핵심 구분을 보존합니다
- 확률적 선택은 요청 수나 부하의 균등 보장이 아니며 모드마다 알고리즘이 다름을 유지합니다
- UDP stale 정리와 conntrack 표 포화, 새 NAT 연결 비용과 기존 흐름 비용을 구분합니다
- 모드·버전·주소군·기능 게이트·트래픽 출발지에 따른 예외를 일반화하지 않습니다

## 편집 후 독자 확인

- 타입·모드 비교를 읽기 전에 ClusterIP 한 연결의 왕복을 설명할 수 있나요?
- 백엔드 목록을 바꾼 직후 기존 연결이 달라지지 않을 수 있는 이유를 알 수 있나요?
- Service 조회 방법과 백엔드 분배 방법을 구분할 수 있나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
