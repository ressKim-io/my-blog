# Batch 09 — 분산 추적·스케줄링과 바인딩·배치 제약

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-distributed-tracing.md`

추적 기록별 측정 구간과 부모의 표본 결정을 이어받는 관계를 구체적으로 표현했습니다

- 원문: 각 기록은 남기는 조건과 시간 경계가 다릅니다
- 수정: 기록마다 남는 조건과 측정하는 구간이 다릅니다

### `k8s-theory-scheduling-binding-cycles.md`

노드 선택·assume·Permit·Bind의 기본 흐름 다음에 실패 처리와 재시도 큐를 설명하도록 절을 이동했습니다

- 원문: API 쓰기는 성공했지만 응답이 늦어 실패처럼 보인 경우도 고려하는 경계입니다
- 수정: 이 검사는 API 쓰기는 성공했지만 응답이 늦어 실패처럼 보인 경우도 고려합니다

### `k8s-theory-scheduling-constraints.md`

배치 조건의 문장 호응을 고치고 topology spread가 비교하는 대상이 domain별 Pod 개수임을 드러냈습니다

- 원문: topology spread는 후보 domain의 개수 차이를 계산합니다
- 수정: topology spread는 domain별 Pod 개수 차이를 계산합니다

## 독립 검수와 보완

작성하지 않은 reviewer가 원문·수정본 3편을 전문 대조했습니다. 수정이 필요한 문제를 발견하지 못했습니다. 기본 배치 흐름 뒤 재시도 설명이 자연스럽고, 추적과 topology spread의 계산·예외 조건도 유지됐음을 확인했습니다

## 보존과 검증

추적 문맥·부모 기반 표본 추출·내보내기 기한의 구분, scheduling/binding 잠정 상태와 실패 처리, 1초 백오프 구간, Filter·Score·배치 이후 조건, topology spread의 식과 예외를 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 바뀐 헤더로 향하는 저장소 내 fragment 링크를 확인했고, 끊어진 연결은 발견하지 못했습니다
- 현재 PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 30편 편집 뒤 별도로 실행합니다
- lint·테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링 검사는 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
