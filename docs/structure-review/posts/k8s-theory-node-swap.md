# 노드 swap — 기동 허용과 컨테이너 한도, 배치 계산을 구분하기 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-node-swap.md](../../../src/content/essays/kubernetes/k8s-theory-node-swap.md)
- 시리즈: `k8s-theory-node` / 16
- 원문 SHA256: `6a42e3f64ed96c2cf63014a64a373d7de36bbac2f1c9d6828570b605f2d75838`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기본 흐름 유지, 제외 조건과 부가 효과 정리

## 독자와 중심 질문

swap이 있는 노드에서 kubelet 기동 허용·컨테이너 자격·swap 상한·배치 용량을 구분합니다

선행 개념: memory request/limit, cgroup v2, QoS

## 현재 전개

- L26: 기동 허용과 워크로드 정책을 따로 정합니다
- L63: LimitedSwap도 컨테이너마다 다시 판단합니다
- L108: 한도는 memory request 비율로 계산합니다
- L141: kubelet이 값을 전달하고 런타임이 cgroup에 적용합니다
- L166: 메모리 볼륨에는 tmpfs noswap을 확인합니다
- L194: 스케줄러의 메모리 배치 계산에는 swap이 더해지지 않습니다
- L209: 메모리 압박의 축출도 swap 사용량 자체를 임계로 삼지 않습니다
- L234: 용량 정보와 사용량 통계를 구분합니다
- L261: 실패 지점을 설정과 판정 단위로 찾습니다
- L274: 확인한 문서와 소스

## 원문 근거와 개선점

### L194 제목의 세 번째 구분이 tmpfs 구현 뒤로 밀립니다

> ## 스케줄러의 메모리 배치 계산에는 swap이 더해지지 않습니다

기동→자격→한도→cgroup은 자연스럽게 이어집니다. 하지만 cgroup v1·tmpfs noswap 탐지까지 거쳐야 배치 계산과의 차이가 나옵니다

수정 방향: 기본 cgroup v2 경로 직후 배치/eviction에 미치는 영향을 연결하고 v1·tmpfs 탐지 분기를 후반에 둡니다

### L95 자격 판단에 좋은 반례를 앞 표와 더 가깝게 연결할 수 있습니다

> ### Pod의 QoS와 컨테이너의 request를 구분합니다

Pod 전체 Burstable만으로 각 컨테이너의 자격을 판정할 수 없다는 사례가 이 글의 핵심입니다. QoS 일반 정의를 길게 반복하기보다 같은 Pod의 두 컨테이너 차이로 표를 읽게 할 수 있습니다

수정 방향: 자격 표 뒤에 기존 request=limit 컨테이너 사례를 바로 붙이고 QoS 재정의는 선행 글 링크로 줄입니다

## 권장 설명 순서

1. failSwapOn과 swapBehavior를 나눈 기존 설정 예를 유지합니다
2. 같은 Burstable Pod 안의 서로 다른 컨테이너 조건으로 LimitedSwap 자격을 확인합니다
3. request/RAM 비례식으로 상한을 계산하고 CRI→memory.swap.max 적용을 연결합니다
4. 상한은 예약이 아니며 scheduler memory allocatable에도 더하지 않는다고 설명합니다
5. 물리 메모리 신호·회수·OOM/eviction의 관계를 풉니다
6. v1 NoSwap·tmpfs noswap·통계 미제공 시 0 등 구현 조건을 보충합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

컨테이너의 swap 상한을 정했다고 노드의 메모리 배치 용량이 늘어나는 것은 아닙니다
스케줄러가 비교하는 memory request와 노드에서 허용하는 swap 사용량은 서로 다른 계산입니다

## 유지할 내용과 조건

- 기동→정책→자격→상한의 기존 흐름
- 한도는 예약·사용량 보장이 아님, Pod-level과 컨테이너 request 구분
- v1 NoSwap 한계·tmpfs 지원 탐지·실측 0과 미제공 0 차이

## 편집 후 독자 확인

- failSwapOn:false만으로 Pod swap이 허용되지 않는 이유를 설명하는가?
- swap 용량이 늘어도 Pending의 Insufficient memory가 해결되지 않을 수 있는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
