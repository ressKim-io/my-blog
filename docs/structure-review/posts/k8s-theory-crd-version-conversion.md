# CRD 버저닝 — 저장 목표와 기존 저장본을 나눕니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-crd-version-conversion.md](../../../src/content/essays/kubernetes/k8s-theory-crd-version-conversion.md)
- 시리즈: `k8s-theory-extension` / 2
- 원문 SHA256: `0ecd622c41141cee34fc95d26325a8ca3a6113fac96becb273d931d2e36d7b59`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

같은 CR을 여러 API 버전으로 읽고 쓸 때 현재 저장 목표와 실제 남아 있는 저장본은 어떻게 다르며, 옛 버전을 없애기 전에 무엇을 확인해야 할까요?

선행 개념: CRD 스키마와 pruning, API 버전과 저장 표현의 구분을 전제합니다. conversion은 같은 자원의 표현을 바꾸는 작업으로 소개합니다

## 현재 전개

- L22: 쓰기 목표와 읽기 표현 사이에 변환이 있습니다
- L36: served·storage·deprecated는 서로 다른 결정을 합니다
- L70: None은 필드 변환을 대신하지 않습니다
- L89: ConversionReview 버전과 CR 버전은 별개입니다
- L135: HTTP 호출 성공과 변환 성공은 다릅니다
- L168: storedVersions는 남아 있는 CR의 개수를 기록하지 않습니다
- L188: 옛 버전 제거에는 실제 재쓰기 확인이 필요합니다
- L233: 필드를 없애는 변경은 왕복 후의 값을 봐야 합니다
- L248: 실패한 위치를 나눠 봅니다
- L260: 확인한 근거

## 원문 근거와 개선점

### L53 저장 목표의 핵심 대비보다 discovery 정렬 세부가 앞섭니다

> ### 선호 버전과 저장 버전도 같을 필요가 없습니다

served·storage·deprecated 표는 필요한 구분입니다. 바로 뒤에 버전 정렬·경고 추천·문구 길이가 나와 실제 필드 변환과 혼재 저장본을 이해하기 전 주변 규칙이 늘어납니다

수정 방향: 처음에는 선호 버전과 storage가 같을 필요 없다는 한 문장만 둡니다. 정렬·추천·경고 형식은 후반의 클라이언트 이행 보충 절로 옮깁니다

### L168 도입에서 약속한 저장본 혼재 예시를 더 일찍 보여줍니다

> ## storedVersions는 남아 있는 CR의 개수를 기록하지 않습니다

옛 저장본이 남는다는 도입의 핵심을 확인하려면 ConversionReview 봉투·응답 검사·HTTP 실패·삭제 영향까지 지나야 합니다. 두 CR 중 하나만 재쓰는 그림이 오히려 변환이 계속 필요한 이유를 설명해 줄 수 있습니다

수정 방향: served·storage의 기본 의미와 None·Webhook의 역할을 설명한 뒤 두 CR의 혼재 예시와 storedVersions를 붙입니다. 이행 전체 순서를 이해한 후 conversion 프로토콜과 장애 조건을 상세화합니다

## 권장 설명 순서

1. v1alpha1 쓰기와 v1 읽기가 같은 CR의 표현이라는 사례로 현재 저장 목표·요청 버전을 구분합니다
2. served·storage·deprecated를 설명하고 None이 필드 의미를 바꾸지 못하는 이유와 Webhook의 역할을 제시합니다
3. storage를 바꾼 뒤 일부 CR만 재쓴 예시로 혼재 저장본과 storedVersions 장부를 설명합니다
4. 새 버전 제공·클라이언트 이행·저장본 재쓰기 확인·장부 정리·옛 선언 제거의 조건을 연결합니다
5. ConversionReview의 버전·왕복 UID·객체 배열·응답 검사를 풀고 HTTP 성공과 의미 변환 성공을 구분합니다
6. 변환 장애가 읽기·쓰기·삭제에 미치는 범위, 현행 migrator 동작, 필드 왕복 손실과 discovery 세부를 보충합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

저장 목표를 v1으로 바꿔도 아직 다시 쓰지 않은 CR은 옛 표현으로 남을 수 있습니다
이 혼재 상태에서는 조회와 이행에 옛 버전의 해석이 필요하므로, served를 끄는 일과 버전 선언을 제거하는 일을 구분해야 합니다

## 유지할 내용과 조건

- 현재 storage 하나와 기존 저장본 버전 통일이 다르다는 도입의 핵심을 유지합니다
- storedVersions가 실제 CR 개수나 재쓰기 완료 증거가 아니며 장부 수정이 마이그레이션을 대신하지 않음을 보존합니다
- conversion에는 admission의 Ignore 경로가 없고 HTTP 200과 result.status를 구분한다는 조건을 유지합니다
- 실제 etcd 쓰기 생략·현행 Merge patch·필드 제거 후 왕복 손실의 범위를 보존합니다

## 편집 후 독자 확인

- ConversionReview의 모든 필드를 읽기 전에 옛 버전 제거가 왜 별도 작업인지 설명할 수 있나요?
- served=false와 spec.versions 제거, storedVersions 수정을 구분할 수 있나요?
- 변환 응답 형식 검사 통과를 의미 보존의 증명으로 오해하지 않나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
