# Aggregated API server — 경로 위임과 장애의 범위 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-aggregated-api-server.md](../../../src/content/essays/kubernetes/k8s-theory-aggregated-api-server.md)
- 시리즈: `k8s-theory-extension` / 5
- 원문 SHA256: `0e9fa5035af95968159a74a952864eefcebef733b9303e31c010511cfe2f5ef8`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

CRD의 저장 경로로 해결하기 어려운 API를 별도 서버에 맡기면 요청은 어떻게 전달되고, 서버 장애는 어디까지 영향을 줄까요?

선행 개념: CRD와 별도 controller의 역할, Service·TLS·인증과 인가를 전제합니다. discovery는 사용 가능한 API 자원 목록을 알아내는 과정으로 정의합니다

## 현재 전개

- L21: APIService는 그룹과 버전의 처리 경로를 등록합니다
- L49: 프록시는 인증 결과를 신뢰할 수 있는 헤더로 전달합니다
- L106: Available은 별도 컨트롤러가 검사합니다
- L145: 등록 목록과 실제 자원 목록은 다릅니다
- L176: Discovery 부분 실패는 Namespace 삭제 완료를 막을 수 있습니다
- L205: CRD 대신 별도 서버가 필요한 경계
- L227: Metrics-server는 측정값을 메모리에 둡니다
- L256: 확인한 근거

## 원문 근거와 개선점

### L205 별도 서버를 두는 이유가 구현과 장애 설명 뒤에 나옵니다

> ## CRD 대신 별도 서버가 필요한 경계

도입에서 별도 저장·응답을 언급하지만 그 필요를 구체적으로 이해하려면 APIService 필드·인증서·가용성 검사·discovery·Namespace 삭제를 먼저 읽어야 합니다

수정 방향: CRD와의 차이 및 metrics-server의 메모리 표본 사례를 앞에 짧게 배치합니다. APIService를 통해 그 서버를 기존 API 진입점에 연결한다는 이유가 생긴 뒤 전달·신뢰 경계를 풉니다

### L39 정상 요청 전달 전에 discovery 정렬 세부가 끼어 있습니다

> 우선순위 값은 클수록 앞섭니다

APIService의 경로 등록 설명 직후 그룹·버전 정렬을 다룹니다. 독자가 별도 서버에 실제 요청이 도착하는 과정을 보기 전에 목록 표현 방식으로 질문이 바뀝니다

수정 방향: 처음에는 group·version·service·TLS 연결에 필요한 필드만 보여줍니다. priority와 정렬은 등록 목록·aggregated discovery·OpenAPI를 비교하는 후반 단위에 함께 둡니다

## 권장 설명 순서

1. CRD의 저장·서빙 경로와 별도 서버의 선택 범위를 비교하고 metrics-server의 메모리 표본을 대표 사례로 제시합니다
2. APIService가 그룹·버전 경로를 서버에 연결한다는 관계와 로컬 위임 예외를 설명합니다
3. 일반 요청을 kube-apiserver의 사용자 인증·인가에서 프록시 전달·신원 헤더·확장 서버의 위임 인가까지 따라갑니다
4. 양방향 TLS 신뢰와 requestheader 설정을 바로 앞 경로의 보호 조건으로 설명합니다
5. Available 검사와 실제 자원 요청을 구분하고 등록 목록·discovery·OpenAPI의 상태와 정렬을 비교합니다
6. discovery 부분 실패가 Namespace 삭제 완료를 막는 이유를 연결하고 metrics-server의 상세 수집·계산 조건을 보충합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

metrics-server처럼 저장된 선언을 그대로 돌려주는 대신 메모리 표본에서 응답을 계산하는 서버도 있습니다
APIService는 이런 서버를 kube-apiserver의 경로에 연결하지만, 서버의 저장 방식과 가용성까지 대신 구현하지는 않습니다

## 유지할 내용과 조건

- service 없는 APIService의 로컬 위임을 모두 원격 프록시로 설명하지 않습니다
- 프록시 신원 검증과 원래 사용자의 인가, 서버 인증서 검증의 방향을 구분합니다
- Available·discovery·OpenAPI·실제 요청 성공을 같은 상태로 묶지 않습니다
- Namespace 부분 삭제와 완료 선언, metrics-server의 코드 기본값과 배포 인자를 구분합니다

## 편집 후 독자 확인

- APIService의 전체 필드 표 전에 왜 CRD 대신 서버가 필요한지 설명할 수 있나요?
- 그룹이 목록에 보이는데 요청은 실패할 수 있는 이유를 이해할 수 있나요?
- 일부 자원을 지웠는데 Namespace가 남는 이유를 전체 자원 목록의 불완전성과 연결할 수 있나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
