# Batch 03 — Admission 순서·webhook 실패·resourceVersion

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-admission-order.md`

리소스 값과 검증 대상을 구체화하고, 현재 요청에서 검사한 내용과 이후 UPDATE를 구분했습니다

- 원문: 최종 자원 형태
- 수정: 최종 requests·limits

### `k8s-theory-admission-webhook-failure.md`

Fail·Ignore의 기본 동작과 라벨 사례를 앞에 배치하고, 오류 종류별 적용 범위는 뒤에서 설명했습니다

- 원문: 변경받지 못한 객체
- 수정: 라벨이 추가되지 않은 객체

### `k8s-theory-resource-version.md`

제목에 오래된 상태로 덮어쓰는 문제를 드러내고, 두 버전 검사의 목적을 구체화했습니다

- 원문: API의 번호 검사와 etcd의 CAS는 다른 간격을 지킵니다
- 수정: resourceVersion 검사 뒤에도 etcd의 CAS가 필요한 이유

## 독립 검수와 보완

작성하지 않은 reviewer가 원문·수정본 3편을 전문 대조했습니다. 의미 보존 오류는 발견하지 못했으며, 라벨을 지우는 UPDATE를 가리킨 '그 삭제 요청'이 객체 DELETE로 읽힐 수 있다고 지적했습니다. '그 UPDATE 요청 자체'로 고친 뒤 대상 요청과 앞뒤 문맥을 다시 확인했습니다

## 보존과 검증

admission의 변경·타입 검증·정책 검증 순서, failurePolicy의 명시적 거부/호출 실패 구분, 재호출 조건, UPDATE의 이전/새 객체 매칭 조건, resourceVersion 비교와 etcd CAS의 역할 차이를 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 바뀐 헤더로 향하는 저장소 내 fragment 링크를 확인했고, 끊어진 연결은 발견하지 못했습니다
- 현재 PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 30편 편집 뒤 별도로 실행합니다
- lint·테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링 검사는 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
