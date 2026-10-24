# Batch 05 — Server-Side Apply·소유권 이행·informer

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-server-side-apply.md`

필드 소유권과 충돌 판단을 제목에 드러내고, 충돌을 해결할 때 값과 소유권을 함께 결정한다는 설명을 구체화했습니다

- 원문: 충돌을 푸는 선택은 값과 소유권을 함께 바꿉니다
- 수정: 충돌을 풀 때는 값과 소유권을 함께 정해야 합니다

### `k8s-theory-apply-ownership-migration.md`

prune 기본 조건과 defaulting을 설명한 뒤 구현 주석·버전 변환의 예외로 넘어가도록 순서를 조정했습니다

- 원문: 대상 이름
- 수정: 이전받을 매니저의 이름

### `k8s-theory-informer.md`

큐 소개 다음에 초기 동기화를 배치하고, 전체 목록과 로컬 사본 비교 결과를 실제 동작으로 풀었습니다

- 원문: 이 차집합이 삭제를 복원할 재료
- 수정: 로컬 사본에서 `c`를 제거해야 한다는 것을 알 수 있습니다

## 독립 검수와 보완

작성하지 않은 reviewer가 원문·수정본 3편을 전문 대조했습니다. 조건 누락은 발견하지 못했습니다. 바뀐 SSA 헤더가 CSA에는 서버 소유권 관리가 전혀 없다는 인상을 줄 수 있어 'client-side apply와 SSA는 변경안을 계산하는 곳이 다릅니다'로 수정했습니다. 본문의 CSA Update 소유권 기록 및 변경안 계산 설명과 다시 대조했습니다

## 보존과 검증

SSA의 값·소유권·공동 소유 조건, FieldManagerConflict 구분, prune·defaulting·HPA 인계의 예외, informer의 로컬 사본·삭제 복구·초기 동기화 조건을 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 바뀐 헤더로 향하는 저장소 내 fragment 링크를 확인했고, 끊어진 연결은 발견하지 못했습니다
- 현재 PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 30편 편집 뒤 별도로 실행합니다
- lint·테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링 검사는 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
