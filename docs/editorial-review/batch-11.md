# Batch 11 — Eviction과 OOM·워크로드 롤아웃·Job과 CronJob

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-eviction-oom.md`

자원 여유와 임계값의 비교를 헤더에 드러내고, 예약량·OOM 집계 대상의 모호한 표현을 구체화했습니다

- 원문: 배치 계산에서 제외했던 여유
- 수정: 배치 계산에서 제외했던 hard eviction 예약분

### `k8s-theory-workload-rollout-revisions.md`

목표 수 변경과 Pod 생성·Ready·available 상태의 차이를 평이하게 풀었습니다

- 원문: 목표 수 변경은 Pod 생성·Ready·available 완료와 같은 사건이 아닙니다
- 수정: 목표 수를 바꿨다고 Pod가 생성되고 Ready·available 상태가 된 것은 아닙니다

### `k8s-theory-job-cronjob-completion.md`

startingDeadlineSeconds 기본 설명 뒤에 100회 초과 시 문서·소스 차이를 배치하고, 회차별 이름의 재현성을 구체화했습니다

- 원문: 결정적인 이름을 만듭니다
- 수정: 같은 회차를 다시 처리해도 이름은 같습니다

## 독립 검수와 보완

작성하지 않은 reviewer가 원문·수정본 3편을 전문 대조했습니다. 수정이 필요한 문제를 발견하지 못했습니다. 특히 oom_kill을 종료된 프로세스 수의 합계로 푼 문장이 앞의 OOM 발생 범위 추가 확인 설명과 일관되는지 확인했습니다. 이는 외부 커널 문서를 다시 검증한 결과는 아닙니다

## 보존과 검증

eviction의 두 유예 시간과 hard eviction 예약, OOM 발생 범위의 추가 확인 필요성, 롤아웃 수량·이력·Ready/available 조건, Job 완료 판정과 CronJob 회차·중복 실행·문서와 소스 차이를 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 바뀐 헤더로 향하는 저장소 내 fragment 링크를 확인했고, 끊어진 연결은 발견하지 못했습니다
- 현재 PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 30편 편집 뒤 별도로 실행합니다
- lint·테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링 검사는 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
