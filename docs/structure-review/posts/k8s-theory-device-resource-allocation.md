# 장치 자원 할당 — 수량에 따른 노드 선택과 DRA의 장치 선택 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-device-resource-allocation.md](../../../src/content/essays/kubernetes/k8s-theory-device-resource-allocation.md)
- 시리즈: `k8s-theory-node` / 13
- 원문 SHA256: `97193f697f7c6eae473eaac01fe386ea1dfa960e12ce2bdbb996192607df502b`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 두 할당 경로를 먼저 비교하고 노드 정책을 보충

## 독자와 중심 질문

GPU 수량으로 노드를 고르는 일과 장치 ID·속성으로 실제 장치를 할당하는 일을 구분합니다

선행 개념: Pod 자원 요청·scheduler·kubelet, Filter/Reserve/PreBind

## 현재 전개

- L23: 기본 개수 모델은 노드 선택과 장치 선택을 나눕니다
- L33: 확장 자원은 이름과 정수 수량을 광고합니다
- L78: NodeResourcesFit은 수량을 검사하고 장치 ID를 고르지 않습니다
- L90: 등록할 때는 kubelet이 서버이고 할당할 때는 플러그인을 호출합니다
- L139: NUMA 정렬은 개수 검사 뒤의 노드 내부 판단입니다
- L183: DRA는 목록·요구·할당 결과를 API로 표현합니다
- L213: DRA의 내부 예약과 API 기록은 다른 단계입니다
- L267: 정수 요청도 DRA에 위임할 수 있습니다
- L296: 실패 위치를 API 검증·스케줄링·노드 준비로 나눕니다
- L316: 확인한 소스와 문서

## 원문 근거와 개선점

### L69 장치 선택 경로 전에 자원 보호의 별도 주제가 나옵니다

> ### 장치만 요청해도 CPU·메모리 QoS는 올라가지 않습니다

수량 요청 검증 뒤 QoS·메모리 축출을 읽고 장치 ID 선택으로 돌아갑니다. 아직 장치를 누가 고르는지 기본 흐름이 완성되지 않았습니다

수정 방향: 수량 광고→노드 선택→kubelet ID 선택→Allocate→런타임 전달을 먼저 연결하고 QoS는 노드 자원 정책과 함께 보충합니다

### L139 DRA 비교 전에 CPU/Memory Manager의 자격 조건까지 확장됩니다

> ## NUMA 정렬은 개수 검사 뒤의 노드 내부 판단입니다

도입은 개수 모델과 DRA 차이인데 NUMA 정책·전용 CPU·Memory Manager·Pod-level gate를 거쳐야 DRA를 만납니다

수정 방향: 기본 plugin 경로 뒤 DRA 목록/claim/예약/노드 준비를 비교합니다. NUMA 정렬과 전용 할당 조건은 두 경로를 이해한 뒤 별도 질문으로 풉니다

## 권장 설명 순서

1. 기존 GPU 두 개 요청으로 수량과 장치 속성의 차이를 제시합니다
2. device plugin 등록·전체 목록 광고→scheduler 수량 검사→kubelet 선택·Allocate→CRI 전달을 설명합니다
3. 개수만으로 표현하기 어려운 선택을 DRA의 Slice·Class·Claim으로 연결합니다
4. DRA의 내부 예약→API 기록→노드 준비→CDI를 끝까지 따라갑니다
5. NUMA·CPU/Memory Manager·QoS·unhealthy 상태를 노드의 추가 조건으로 묶습니다
6. 정수 요청의 DRA 위임·부속 gate·실패 단계 차이를 보충합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

기본 개수 경로에서는 노드를 고른 뒤 kubelet이 장치 ID를 정합니다
장치 속성을 배치 판단에 사용하려면 선택 가능한 장치와 요구 조건을 스케줄러가 볼 수 있는 형태로 제공해야 합니다

## 유지할 내용과 조건

- 정수 요청·overcommit 제한과 숫자 광고/실제 장치 준비의 차이
- 기본 plugin과 DRA 위임 경로, NUMA node와 Kubernetes Node 구분
- DRA Reserve/API 기록/NodePrepareResources는 별도, CDI와 optional operations 조건

## 편집 후 독자 확인

- 노드에 GPU 두 개가 남아도 컨테이너 준비가 실패할 수 있는 단계를 말하는가?
- DRA allocation이 있어도 실제 노드 준비 완료는 아닌 이유를 설명하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
