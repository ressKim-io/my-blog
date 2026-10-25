# 트래픽 지역성과 dual-stack — 후보 제한과 선호, 주소군별 경로 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-traffic-locality-dual-stack.md](../../../src/content/essays/kubernetes/k8s-theory-traffic-locality-dual-stack.md)
- 시리즈: `k8s-theory-network` / 10
- 원문 SHA256: `8a3adf7822a920dce5df7ecd3312133d690fcc57337570df66c73c99e26b7807`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기본 흐름 유지·비교 기준 보강

## 독자와 중심 질문

Service 전체에는 백엔드가 있는데 특정 노드·주소군에서 후보가 없어지는 이유는 무엇이며, Local 제약과 지역 선호의 fallback은 어떻게 다를까요?

선행 개념: Service의 백엔드 선택, EndpointSlice와 ClusterIP·외부 접근점의 차이를 전제합니다

## 현재 전개

- L24: 어느 주소로 들어왔는지에 따라 정책을 고릅니다
- L54: Local은 원격 후보로 돌아가지 않는 제약입니다
- L86: Ready와 종료 중 후보의 fallback을 구분합니다
- L117: trafficDistribution은 선호 조건이 맞지 않으면 범위를 넓힙니다
- L168: dual-stack은 주소 할당과 주소군별 후보를 나눕니다
- L252: 후보 부재와 주소군 실패를 따로 확인합니다
- L271: 확인한 근거

## 원문 근거와 개선점

### L38 후보 제한의 기본 의미보다 SNAT 예외가 앞섭니다

> ### 두 Local이 출발지 주소에 주는 효과는 다릅니다

어느 접근점에 정책이 적용되는지 먼저 구분하는 것은 좋습니다. 다만 Local이 후보를 제한한다는 설명 전에 SNAT와 출발지별 예외를 읽어야 해서 중심 비교가 늦어집니다

수정 방향: 접근점 표 뒤에 Local의 원격 fallback 금지와 Cluster·선호의 차이를 짧은 사례로 제시합니다. SNAT 효과는 외부 Local을 고르는 이유와 예외로 그 뒤에 연결합니다

### L168 두 번째 질문으로 넘어가는 연결을 명시합니다

> ## dual-stack은 주소 할당과 주소군별 후보를 나눕니다

지역성에서 주소군별 할당·primary 불변·headless·DNS까지 범위가 넓어집니다. 앞의 후보 선택과 어떤 관계인지 계속 붙잡지 않으면 별도 글이 중간에 시작된 듯 읽힐 수 있습니다

수정 방향: dual-stack 단위의 첫 문장에서 앞의 후보 판단을 IPv4·IPv6 각각에 적용한다는 연결을 명시합니다. VIP와 후보 목록의 정상 대응을 먼저 완결하고 primary·headless·selectorless 예외를 그 뒤에 둡니다

## 권장 설명 순서

1. 같은 Service라도 이 노드에서 쓸 후보가 없을 수 있다는 사례와 접근점별 정책을 제시합니다
2. Local의 엄격한 후보 제한과 선호의 범위 확장을 대비하고 로컬 후보 부재·전체 후보 부재를 구분합니다
3. Ready·serving·terminating에 따른 후보 선택과 종료 후보 fallback을 설명합니다
4. trafficDistribution의 힌트 생성·모드 선택과 옛 Auto 계산을 구분하고 SNAT 효과·부하 쏠림·관측 지표를 붙입니다
5. 같은 후보 판단을 주소군별로 반복한다는 질문으로 넘어가 dual-stack VIP·EndpointSlice·경로를 연결합니다
6. primary 불변·headless·selectorless·DNS 주소 선택의 예외를 정리하고 노드·정책·주소군별 확인으로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

지금까지는 한 주소군 안에서 사용할 백엔드 후보를 골랐습니다
Dual-stack에서는 IPv4와 IPv6의 목록이 따로 있으므로, 같은 Local 정책이라도 각 주소군에서 후보가 남는지 확인해야 합니다

## 유지할 내용과 조건

- Local의 원격 fallback 금지, 지역성 모드의 범위 확장, 종료 후보 fallback을 서로 다른 동작으로 유지합니다
- REJECT·DROP과 GaugeVec 지표는 해당 구현 범위로 설명합니다
- 지역성 선호가 실시간 부하 균등이나 성능 향상을 보장하지 않는다는 조건을 보존합니다
- VIP Service의 primary 규칙과 headless·selectorless 예외, DNS·클라이언트 주소 선택을 구분합니다

## 편집 후 독자 확인

- fallback이라는 단어가 나올 때 후보 상태·지역 범위 중 무엇이 바뀌는지 구분할 수 있나요?
- IPv4 VIP가 있다는 사실만으로 IPv6 경로까지 준비됐다고 생각하지 않나요?
- dual-stack 절이 앞의 후보 선택 질문과 어떻게 이어지는지 설명할 수 있나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
