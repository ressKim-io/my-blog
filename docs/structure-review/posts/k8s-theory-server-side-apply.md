# Server-Side Apply — 필드별 소유권으로 변경 충돌을 판단합니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-server-side-apply.md](../../../src/content/essays/kubernetes/k8s-theory-server-side-apply.md)
- 시리즈: `k8s-theory-api` / 10
- 원문 SHA256: `cc24fc2a30d07ebec92fb2c51d5d5bd73ecc21e758f0327d1ea47fe116d4f242`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 행동 결과를 먼저 묶고 저장 표현은 뒤에 설명

## 독자와 중심 질문

여러 작성자가 필드를 나눠 관리할 때 Apply와 Update가 값과 소유권을 어떻게 바꾸는지 이해합니다

선행 개념: Deployment 필드, 기본 Update·PATCH, resourceVersion 충돌

## 현재 전개

- L24: 같은 필드라도 쓰기 방식에 따라 결과가 다릅니다
- L41: managedFields는 이름 하나당 한 항목이 아닙니다
- L103: 충돌은 남의 소유권과 이번 변경이 겹칠 때 생깁니다
- L129: 충돌을 풀 때는 값과 소유권을 함께 정해야 합니다
- L147: Update는 같은 값까지 모두 가져가지 않습니다
- L165: 리스트의 소유 단위는 스키마가 정합니다
- L205: 스키마의 관리 단위를 바꾸면 기존 소유권 해석도 바뀝니다
- L223: API 버전이 달라도 비교할 수 있지만 조건이 있습니다
- L239: client-side apply와 SSA는 변경안을 계산하는 곳이 다릅니다

## 원문 근거와 개선점

### L41 충돌 사례 직후 기록 형식으로 들어갑니다

> ## managedFields는 이름 하나당 한 항목이 아닙니다

같은 값·다른 값 Apply라는 도입은 좋습니다. 이어서 manager 식별자와 trie 접두사를 상세히 읽고 나서야 충돌의 이유와 선택지를 만납니다

수정 방향: 도입 사례 → 충돌 이유 → 유지·공유·인계 선택을 먼저 묶습니다. managedFields는 이 결과를 확인하는 기록으로 소개합니다

### L189 일반 스키마 소유 단위와 topology 변경 사이를 예외 구현이 끊습니다

> ### CRD의 추론형 변환기는 모든 필드를 atomic으로 묶지 않습니다

list의 atomic/map 구분에서 기존 소유권의 변화를 보려는 흐름에 모델 생성 실패와 주석 오류 정정이 끼어듭니다

수정 방향: list 소유 단위와 topology 변경을 연속해서 설명하고 추론형 대체 경로는 마지막 구현 주의사항으로 옮깁니다

## 권장 설명 순서

1. HPA와 GitOps의 필드 분담 목적을 제시하고 A·B의 같은 값/다른 값 Apply를 비교합니다
2. 소유권 충돌과 resourceVersion 충돌을 구분한 뒤 force·관리 포기·공동 소유를 설명합니다
3. Update는 값이 바뀐 필드의 소유권을 가져간다는 차이와 생략 시 prune 조건을 붙입니다
4. managedFields 예시로 앞의 결과를 읽고 manager 식별자·fieldsV1 표현을 풉니다
5. 리스트와 맵의 소유 단위 및 topology 변경 영향을 연결합니다
6. API 버전 변환·추론형 경로를 보충하고 CSA와의 차이로 정리합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

값이 같아서 충돌하지 않았더라도 관리 주체는 늘어날 수 있습니다
이제 서버가 그 분담을 어디에 기록하는지 managedFields에서 확인하겠습니다

## 유지할 내용과 조건

- 동일 값 Apply의 공동 소유와 Update의 실제 변경 필드만 취득하는 차이
- 유일 소유자의 생략은 삭제/defaulting 가능, force의 범위 제한
- CRD topology 변경과 버전 소실에 따른 소유권 손실 조건

## 편집 후 독자 확인

- 같은 필드가 요청에 있다는 것만으로 충돌하지 않는 이유를 설명하는가?
- force·생략·동일 값 Apply의 값/소유권 결과를 각각 구분하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
