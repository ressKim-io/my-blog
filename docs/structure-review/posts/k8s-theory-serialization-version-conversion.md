# 직렬화와 버전 변환 — 요청·메모리·저장의 모양이 다른 이유 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-serialization-version-conversion.md](../../../src/content/essays/kubernetes/k8s-theory-serialization-version-conversion.md)
- 시리즈: `k8s-theory-api` / 16
- 원문 SHA256: `c26fdad97c6f9cb946e7fd8e0c5ce7f692c726c67bed5a53c5ea06581ae9bbdf`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 버전과 바이트 형식을 기준으로 기본 경로 정리

## 독자와 중심 질문

같은 객체의 API 버전과 바이트 형식이 요청·메모리·저장에서 왜 달라지는지 이해합니다

선행 개념: API group/version/kind, HTTP 요청과 저장소

## 현재 전개

- L24: 요청 버전과 메모리 버전, 저장 버전은 따로 정합니다
- L49: __internal은 클라이언트에게 제공하는 API 버전이 아닙니다
- L74: 가운데 타입 하나가 버전 사이의 연결 수를 줄입니다
- L113: 기본값은 요청받은 버전에서 먼저 채웁니다
- L130: Accept는 바이트 형식과 응답 타입을 함께 요청합니다
- L158: protobuf 지원은 최종적으로 인코딩할 타입에 달려 있습니다
- L193: kubectl의 표는 서버가 정의한 열을 그립니다
- L211: CRD에는 별도의 내부 Go 타입이 없습니다
- L224: Event는 두 API 그룹이 같은 저장소를 사용합니다
- L238: continue에는 시점뿐 아니라 읽기 위치도 있습니다
- L286: 응답 형식과 저장 형식은 독립적입니다
- L302: 오류를 볼 때 버전과 형식을 나눠 확인합니다

## 원문 근거와 개선점

### L49 내부 타입을 두는 이유보다 등록 세부가 먼저 나옵니다

> ## __internal은 클라이언트에게 제공하는 API 버전이 아닙니다

첫 그림은 좋지만 곧 Scheme의 제외·오류·GVK 제거 규칙으로 들어갑니다. 가운데 타입이 외부 호환과 변환 수를 어떻게 관리하는지 알기 전에 내부 예외를 읽습니다

수정 방향: 외부 호환과 hub-and-spoke 이유를 먼저 설명한 뒤 __internal 등록 규칙과 향후 KEP 변경을 보충합니다

### L238 표현 변환에서 목록 페이징 복구로 주제가 넓어집니다

> ## continue에는 시점뿐 아니라 읽기 위치도 있습니다

Event의 여러 API 표현을 읽은 뒤 continue 내부 형식과 410을 길게 읽고, 다시 저장 형식으로 돌아옵니다

수정 방향: 응답 형식과 저장 형식의 독립성을 앞의 기본 경로에 붙입니다. 페이징은 별도 읽기 심화 단위로 두거나 watch/LIST 글로 이동할 후보임을 표시합니다

## 권장 설명 순서

1. API 버전은 객체 표현, 직렬화는 바이트 형식이라는 두 축을 먼저 구분합니다
2. 내장 객체 하나의 요청 디코딩 → defaulting → 메모리 변환 → 저장, 다시 응답까지 따라갑니다
3. 내부 hub를 두는 이유와 __internal의 역할·예외를 설명합니다
4. Content-Type·Accept와 Table/PartialObjectMetadata 사례로 응답 타입·형식을 연결합니다
5. 내장 API와 CRD의 타입·protobuf·저장 코덱 차이를 비교합니다
6. Event 공유 표현, KEP 진행 상태, continue 페이징은 기본 경로와 구분한 심화 절로 배치합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

요청을 JSON으로 보냈다는 것은 바이트를 읽는 방법을 정한 것입니다
읽어 낸 객체를 어떤 API 버전으로 다루고 저장할지는 별도의 선택입니다

## 유지할 내용과 조건

- defaulting과 변환의 일반 순서 및 개별 변환 예외
- 최종 응답 타입별 protobuf 지원 차이, CBOR gate와 저장 읽기 조건
- KEP 목표와 현재 적용 상태 구분, continue 410 후 snapshot 일관성 손실

## 편집 후 독자 확인

- JSON 응답을 받았다고 저장소도 JSON이라고 판단하지 않는가?
- CR 본체와 PartialObjectMetadata의 형식 지원이 다른 이유를 설명하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
