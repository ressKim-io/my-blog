# HPA와 scale subresource — replica 계산과 필드 소유권의 경계 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-hpa-scale-subresource.md](../../../src/content/essays/kubernetes/k8s-theory-hpa-scale-subresource.md)
- 시리즈: `k8s-theory-node` / 18
- 원문 SHA256: `27febd7282ef8c2e9d76e33b8dc4b8a716a43baf047b00246a6002812a07a96c`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 계산과 쓰기의 기본 연결 뒤 각 세부를 확장

## 독자와 중심 질문

지표 추천·정책 적용·scale 저장·실제 Pod 수를 구분하고 다른 작성자와의 필드 경쟁을 이해합니다

선행 개념: Deployment replica·Metrics API, SSA와 Update의 최소 차이

## 현재 전개

- L24: HPA는 지표를 읽고 목표 개수를 갱신합니다
- L44: 비율을 개수로 바꾸기 전에 계산 대상을 고릅니다
- L114: 안정화 창은 과거의 추천값을 기억합니다
- L163: scale은 본체의 replica 정보를 별도 API로 보여 줍니다
- L184: HPA의 Update와 GitOps의 Apply는 충돌 방식이 다릅니다
- L242: 롤아웃은 ReplicaSet에 개수를 배분합니다
- L254: CRD는 Scale에 대응시킬 경로를 선언합니다
- L271: 계산 실패와 쓰기 실패를 구분합니다
- L288: 참고 자료

## 원문 근거와 개선점

### L163 처음부터 쓰는 scale의 구조를 계산 상세 뒤에 설명합니다

> ## scale은 본체의 replica 정보를 별도 API로 보여 줍니다

도입과 첫 절에서 scale을 읽고 쓴다고 한 뒤 누락 보정·안정화·behavior 이력을 읽어야 이 API가 별도 객체가 아니라 본체 표현임을 배웁니다

수정 방향: scale의 최소 의미와 대상 본체→Deployment→ReplicaSet 관계를 첫 기본 순환에 붙입니다

### L80 정상 계산의 끝보다 예외 보정이 먼저 길어집니다

> ### 누락 지표와 미준비 Pod는 보수적으로 보정합니다

사용률 식 직후 정수 처리·request 누락·tolerance·미준비 보정이 이어져 추천이 쓰기로 이어지는 기본 결과를 놓치기 쉽습니다

수정 방향: 정상 표본 사례의 비율→추천→정책→scale Update를 먼저 보여줍니다. 보정과 안정화는 왜 단순식과 다른지 답하는 후속 단위로 묶습니다

## 권장 설명 순서

1. Metrics API→추천→정책→scale Update→Deployment/ReplicaSet이라는 기존 그림을 먼저 완결합니다
2. scale은 같은 본체의 replica 표현이며 권한을 나눌 수 있다는 의미를 설명합니다
3. 정상 표본의 사용률 계산 뒤 tolerance·누락/미준비·복수 지표 조건을 확장합니다
4. 안정화 창과 behavior 정책·재시작 이력을 구분합니다
5. HPA Update와 GitOps Apply의 값/소유권 변화를 기존 3→7 예로 비교합니다
6. CRD scale 경로와 계산 실패/쓰기 실패/실행 지연을 나눠 진단합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

HPA가 저장하는 것은 실행 중인 Pod 개수가 아니라 워크로드의 목표 replica 수입니다
그 목표를 실제 Pod로 만드는 다음 조정은 Deployment와 ReplicaSet이 맡습니다

## 유지할 내용과 조건

- 실제 readyPodCount·정수 비율·누락 보정 조건
- behavior nil과 기본 정책 차이·재시작 뒤 초기 추천
- HPA는 Update, 소유권과 RBAC는 별개, 인계 전 replicas 생략의 defaulting 위험

## 편집 후 독자 확인

- 추천 수·정책 제한 수·저장된 목표·Ready Pod 수가 왜 다를 수 있는가?
- HPA와 Deployment controller가 같은 필드를 서로 되돌리는 구조로 오해하지 않는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
