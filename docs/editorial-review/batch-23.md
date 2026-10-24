# Batch 23 — page cache/reclaim/OOM·namespace 수명

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-page-cache-reclaim-oom.md`

제목에 비교 대상 limit을 넣고 charge 풀이를 첫 등장으로 옮겼습니다. 후보를 소비한다는 번역투도 구체화했습니다

- 원문: MGLRU는 접근 정보를 갱신하는 aging과 회수 후보를 소비하는 eviction을 나눕니다
- 수정: MGLRU는 접근 정보를 갱신하는 aging과 후보 페이지의 회수를 담당하는 eviction을 나눕니다

### `k8s-theory-namespace-lifetime.md`

추상적인 완료 증거라는 표현을 따로 확인해야 하는 상태로 풀었습니다

- 원문: API 목록에서 Pod가 안 보이는 것, sandbox가 종료된 것, namespace가 정리된 것과 IP가 반환된 것을 같은 완료 증거로 바꾸지 않기 위한 구분입니다
- 수정: API 목록에서 Pod가 안 보이는 것, sandbox가 종료된 것, namespace가 정리된 것과 IP가 반환된 것은 각각 따로 확인해야 합니다

## 독립 검수와 보완

별도 reviewer가 원문·수정본 2편을 전문 대조했고 의미·조건 보존 오류는 없었습니다. 원문부터 남아 있던 '어떤 종류인지 합산한다'는 oom_kill 문장을 '종류를 구분하지 않고 종료된 프로세스 수를 합산'으로 고친 뒤 위 표의 프로세스 수·memcg 한도 구분과 인접 문맥을 재확인했습니다. 외부 커널 문서를 새로 검증한 결과는 아닙니다

## 보존과 검증

working set과 limit 비교 조건, charge·reclaim·MGLRU·OOM 집계와 예외, namespace 수명·참조·관측 범위, API/sandbox/namespace/IP 상태별 확인 조건을 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 변경 헤더로 향하는 저장소 내 fragment 링크 파손은 발견하지 못했습니다
- PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 2편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 35편 편집 뒤 메인 채팅에서 실행합니다
- lint·별도 테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링을 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
