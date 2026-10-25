# API 확장 지점 — 타입 등록과 기능 활성은 다른 일입니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-api-extension-points.md](../../../src/content/essays/kubernetes/k8s-theory-api-extension-points.md)
- 시리즈: `k8s-theory-api` / 14
- 원문 SHA256: `85807a7cc54c911b599e6e8166b11073189814124a4636dc6c34e88ca647a528`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 확장 개요의 깊이 조정과 후반 질문 연결

## 독자와 중심 질문

새 API를 제공할 때 타입 등록·요청 전달·클라이언트 발견·기능 실행을 구분합니다

선행 개념: API group/version/resource, controller의 역할

## 현재 전개

- L22: 새 타입의 구현을 어디까지 맡을 것인가
- L54: APIService는 어느 요청을 전달하는가
- L94: Discovery는 이름을 찾고 OpenAPI는 구조를 설명합니다
- L122: api-resources는 모든 버전을 나열하는 명령이 아닙니다
- L159: API 버전이 올라가면 호환성 약속도 달라집니다
- L189: feature gate와 API 서빙 설정은 따로 확인해야 합니다
- L238: 실패 신호가 가리키는 설정부터 확인합니다

## 원문 근거와 개선점

### L54 선택 개요 직후 상태 검사 구현으로 깊어집니다

> ## APIService는 어느 요청을 전달하는가

CRD와 별도 서버의 책임을 비교한 뒤 APIService의 오류 reason·5초/6초·TLS로 길게 들어갑니다. 아직 새 타입을 클라이언트가 찾는 기본 경로가 완성되지 않았습니다

수정 방향: 최소 그룹/버전 라우팅만 먼저 설명하고 discovery까지 연결합니다. Available 검사와 timeout은 등록 후 장애 확인 단위로 옮깁니다

### L159 확장 사용 흐름에서 버전 정책으로 넘어가는 이유가 약합니다

> ## API 버전이 올라가면 호환성 약속도 달라집니다

api-resources 출력 뒤 지원 기간 표로 전환되면서, 새 타입이 보이는데 왜 기능이 안 켜질 수 있는지라는 제목의 질문이 늦어집니다

수정 방향: 타입이 발견됨과 기능 실행이 다르다는 MAP 사례를 먼저 묶고, API 수명 정책은 사용 가능한 버전을 유지하는 별도 질문으로 배치합니다

## 권장 설명 순서

1. CRD와 aggregated API의 구현 책임을 비교하고 CRD 등록만으로 controller가 생기지 않음을 설명합니다
2. CRD 등록 또는 APIService 라우팅에서 새 API 경로가 생기는 기본 흐름을 제시합니다
3. discovery·OpenAPI·api-resources가 각각 무엇을 알려주는지 연결합니다
4. MAP 사례로 API 서빙·gate·플러그인·정책 매칭의 차이를 설명합니다
5. API 버전 수명·gate 기본값의 버전 조건을 보충합니다
6. APIService Available·캐시·지원 버전·기능 실행 단계별 실패 신호로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

클라이언트가 새 타입을 찾을 수 있다는 것은 그 API 경로를 사용할 수 있다는 뜻입니다
그 객체를 읽어 실제 작업을 수행할 controller나 플러그인이 동작하는지는 따로 확인해야 합니다

## 유지할 내용과 조건

- CRD와 별도 API 서버의 책임 차이, APIService의 특수 core 경로
- 집계 discovery와 aggregation layer의 다른 역할
- beta/GA 이름만으로 기본값·잠금·서빙 여부를 단정하지 않는 조건

## 편집 후 독자 확인

- CRD 등록 뒤 실제 외부 작업이 일어나지 않는 이유를 설명할 수 있는가?
- API discovery에 보이지만 정책이 실행되지 않는 경우 어떤 단계를 확인하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
