# Job과 CronJob — 성공 집계와 실행 시각은 다른 판단입니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-job-cronjob-completion.md](../../../src/content/essays/kubernetes/k8s-theory-job-cronjob-completion.md)
- 시리즈: `k8s-theory-node` / 9
- 원문 SHA256: `3c9647689ed9166cf7cf8e022da101058004f37411e3b6b857d550b1c1346232`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기본 완료 경로 뒤 정책 확장, CronJob은 별도 질문으로 구분

## 독자와 중심 질문

Job의 성공 집계와 최종 종료, CronJob의 회차 생성이 각각 무엇을 보장하는지 이해합니다

선행 개념: Pod 종료 phase·재시작 정책, controller

## 현재 전개

- L24: Job은 Pod 결과를 집계한 뒤 최종 조건을 기록합니다
- L38: completions는 총 성공 목표, parallelism은 동시 활성 목표입니다
- L71: Job의 Pod 재시작 정책에는 Never와 OnFailure만 허용합니다
- L91: backoffLimit은 실패 Pod와 컨테이너 재시작을 구분해서 셉니다
- L128: 새로운 실패와 성공을 동시에 평가하면 실패 기준을 먼저 봅니다
- L169: successPolicy는 성공한 index의 조합을 봅니다
- L188: 대체 Pod를 만드는 시점은 종료 완료 시점과 다를 수 있습니다
- L206: 완료 Job의 삭제는 TTL 컨트롤러가 맡습니다
- L220: CronJob은 놓친 회차 전부를 만들지 않습니다
- L254: concurrencyPolicy와 이름 충돌은 다른 중복을 다룹니다
- L280: CronJob과 Job은 작업이 정확히 한 번만 실행된다고 보장하지 않습니다
- L297: 확인한 근거

## 원문 근거와 개선점

### L24 성공 목표를 알기 전에 중간·최종 조건을 읽습니다

> ## Job은 Pod 결과를 집계한 뒤 최종 조건을 기록합니다

SuccessCriteriaMet와 종료 정리를 먼저 구분하지만 독자는 completions·parallelism을 아직 배우지 않았습니다. 기존 6개/2개 예가 좋은 진입점입니다

수정 방향: completions 6·parallelism 2의 기본 성공 사례를 먼저 놓고 마지막 성공 뒤 정리를 기다리는 이유로 두 조건을 설명합니다

### L128 기본 실패 정책에서 여러 정책의 우선순위로 곧 확장합니다

> ## 새로운 실패와 성공을 동시에 평가하면 실패 기준을 먼저 봅니다

backoffLimit 직후 여러 검사 순서와 index 실패를 배운 뒤 successPolicy의 뜻을 만납니다

수정 방향: 성공·실패 정책별 입력과 결과를 먼저 설명하고 동시에 성립할 때의 우선순위를 뒤에 둡니다

## 권장 설명 순서

1. completions와 parallelism의 기존 숫자 예로 Pod 성공이 Job에 집계되는 기본 흐름을 설명합니다
2. 성공 기준 충족→남은 종료/집계 정리→Complete를 구분합니다
3. Never/OnFailure와 재시작·새 Pod 생성·backoffLimit을 연결합니다
4. Indexed·successPolicy·podFailurePolicy를 소개한 뒤 동시 충족 우선순위를 풉니다
5. 대체 시점·deadline·TTL은 각각 실행/종료/보존의 시간으로 구분합니다
6. CronJob을 언제 Job을 만들 것인가라는 두 번째 단위로 시작해 회차·시작 기한·동시성·이름 중복을 설명합니다
7. exactly-once 비보장과 보존 이력을 정리합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

성공한 Pod가 필요한 수에 도달한 시점과 Job의 모든 종료 정리가 끝난 시점은 다를 수 있습니다
Job은 이 차이를 중간 조건과 최종 조건으로 나눠 기록합니다

## 유지할 내용과 조건

- completions 미지정과 Indexed 집계 차이
- Pod 실패 수와 OnFailure restart 합의 비교 연산자 차이
- CronJob 놓친 100회 문서/소스 차이, Replace 종료 대기 비보장, 멱등성 필요

## 편집 후 독자 확인

- parallelism이 실제 존재하는 Pod 수의 절대 상한이 아닌 이유를 설명하는가?
- startingDeadlineSeconds·activeDeadlineSeconds·TTL의 시작점을 구분하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
