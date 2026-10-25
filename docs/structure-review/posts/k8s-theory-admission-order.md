# Admission 실행 순서 — 누가 값을 바꾸고, 누가 거부하는가 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-admission-order.md](../../../src/content/essays/kubernetes/k8s-theory-admission-order.md)
- 시리즈: `k8s-theory-api` / 4
- 원문 SHA256: `37f3ff7f26594716f2c38a7db5814a8b508bca42110aca2646cc4d373013fbda`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기본 흐름 유지, 사례의 배치 조정

## 독자와 중심 질문

Pod 생성 요청의 값은 언제 바뀌며, 어느 시점의 값을 누가 검사하는지 설명합니다

선행 개념: CREATE 요청, 인증과 인가, Pod spec

## 현재 전개

- L23: Pod 생성 요청에서 검사하는 순서
- L43: 플러그인 목록 하나를 두 단계에서 사용합니다
- L75: 기본값을 채운 뒤에도 검사가 남습니다
- L128: 값을 바꾸지 않아도 mutating 단계에서 거부할 수 있습니다
- L143: 뒤에서 바꾼 내용을 앞의 플러그인이 다시 보는 경우
- L172: ResourceQuota의 사용량 반영과 Pod 저장은 별개입니다
- L193: Admission이 넣은 필드의 소유자는 자동으로 생기지 않습니다
- L208: Deployment는 생성됐는데 Pod는 거부될 수 있습니다
- L235: 응답 코드와 메시지를 함께 봅니다
- L255: 공식 문서

## 원문 근거와 개선점

### L43 호출 인터페이스가 사례보다 먼저 나옵니다

> 플러그인 목록 하나를 두 단계에서 사용합니다

첫 절에서 전체 순서는 잘 보입니다. 그러나 바로 Admit·Validate 구현과 플러그인 표로 들어가면 두 단계가 필요한 이유를 실제 값의 변화로 확인하기 전에 분류를 외워야 합니다

수정 방향: ServiceAccount가 명세를 넣고 뒤 검사가 그 결과를 보는 짧은 사례를 먼저 완성합니다. 그다음 동일 목록을 두 번 훑는 구현으로 돌아옵니다

### L193 필드 소유권이 최종 검증 사례를 끊습니다

> Admission이 넣은 필드의 소유자는 자동으로 생기지 않습니다

quota까지 읽고 나면 생성 성공과 후속 Pod 거부를 연결할 차례인데 managedFields로 별도 개념을 열었다가 PSA로 돌아옵니다

수정 방향: PSA의 Deployment 성공·Pod 거부를 생성 경로 설명에 붙이고, managedFields는 마지막 심화 절로 옮겨 SSA 글과 연결합니다

## 권장 설명 순서

1. Pod CREATE 하나로 API defaulting → mutation → 저장 전략 → validation → 저장 순서를 먼저 제시합니다
2. ServiceAccount의 명세 추가와 LimitRanger 기본값으로 앞 단계의 변경을 뒤 단계가 보는 이유를 풉니다
3. 같은 플러그인 목록의 Admit·Validate 참여를 설명하고, 검사 목적이어도 mutating 단계에서 거부할 수 있음을 연결합니다
4. sidecar 추가 사례로 재호출·멱등성과 최종 검증의 필요성을 설명합니다
5. PSA와 quota로 거부 사례를 확인합니다. Deployment와 controller의 Pod CREATE는 별도 요청임을 보여줍니다
6. 기본 StorageClass의 사후 변경, quota 보정, managedFields를 서로 다른 보충 질문으로 묶고 응답 메시지 진단표로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

앞의 플러그인이 값을 채웠더라도 뒤의 플러그인이 객체를 다시 바꿀 수 있습니다
따라서 처음 넣은 기본값과 최종 검증에 들어가는 값이 같은지부터 확인해야 합니다

## 유지할 내용과 조건

- CREATE의 실제 순서와 GET·LIST·WATCH, PATCH·DELETE·CONNECT의 적용 범위 차이
- mutation과 validation 모두 거부 가능, quota 갱신과 Pod 저장은 별도 작업
- 재호출 횟수 비보장, PSA 면제·enforce 범위, admission과 managedFields의 관계

## 편집 후 독자 확인

- sidecar가 나중에 추가됐을 때 첫 LimitRanger 평가만으로 충분하지 않은 이유를 말할 수 있는가?
- Deployment 성공 뒤 Pod 생성이 막히는 상황을 별도 요청으로 설명할 수 있는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
