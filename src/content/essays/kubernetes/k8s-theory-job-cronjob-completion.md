---
title: "Job과 CronJob — 성공 집계와 실행 시각은 다른 판단입니다"
excerpt: "Job의 성공·실패 집계, 재시도 한도와 시간 제한, 중간 조건과 최종 완료를 구분합니다. CronJob의 놓친 회차 선택과 시작 기한, 동시 실행 정책이 정확히 한 번 실행을 보장하지 않는 이유도 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "Job", "CronJob", "Controller", "concept"]
series:
  name: "k8s-theory-node"
  order: 9
date: "2026-09-12"
---

Deployment와 달리 Job은 필요한 성공을 채우면 Pod를 더 만들 필요가 없는 워크로드입니다
Pod 하나가 성공했다는 사실만으로 Job 전체가 완료되는 것은 아닙니다
총 성공 목표와 활성 Pod 수, 실패 정책, 종료 정리가 함께 판정에 들어갑니다

CronJob은 그 Job을 언제 생성할지 정합니다
Job의 성공을 판정하는 일과 정해진 회차에 Job을 만드는 일은 다른 컨트롤러의 책임입니다

> **근거**: Kubernetes v1.37.1의 기본 Job·CronJob 컨트롤러 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## Job은 Pod 결과를 집계한 뒤 최종 조건을 기록합니다

Pod에는 `Pending`, `Running`, `Succeeded`, `Failed` 같은 phase가 있지만 Job에는 같은 형태의 phase가 없습니다
Job 컨트롤러는 성공·실패·활성 Pod 수와 `status.conditions`로 작업 상태를 표현합니다

![Job 컨트롤러가 Pod 결과와 정책을 평가해 중간 성공·실패 조건을 정하고 종료·집계 정리 뒤 최종 조건을 기록하는 흐름|tall](/diagrams/k8s-theory-job-cronjob-completion-1.svg)

여기서 **성공 기준 충족**과 **최종 완료**를 구분해야 합니다
`SuccessCriteriaMet`는 성공 기준이 충족됐다는 중간 조건이고, `Complete`는 Job의 최종 성공 조건입니다
실패도 `FailureTarget`으로 종료 이유를 먼저 기록한 뒤 `Failed`를 기록하는 단계를 거칩니다

[`enactJobFinished`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/job_controller.go)는 아직 집계하지 않은 종료 Pod나 종료 중인 Pod가 남으면 최종 조건 기록을 미룹니다
따라서 중간 조건을 확인한 시점에 모든 Pod가 사라졌거나 컨테이너가 이미 멈췄다고 판단하면 안 됩니다

## completions는 총 성공 목표, parallelism은 동시 활성 목표입니다

`completions`는 필요한 총 성공 수이고, `parallelism`은 컨트롤러가 목표로 삼는 동시 활성 Pod 수입니다
다음은 모든 Pod가 성공하고 실행 시간이 같다고 가정한 개념도입니다
실제 클러스터에서 측정한 실행 순서나 시간은 아닙니다

![completions 6과 parallelism 2에서 두 Pod씩 실행하며 총 여섯 성공을 채우는 개념도](/diagrams/k8s-theory-job-cronjob-completion-2.svg)

[`SetDefaults_Job`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/batch/v1/defaults.go)은 두 필드를 모두 생략하면 둘 다 1로 채웁니다
`completions`만 쓰면 `parallelism`은 1이 됩니다
반대로 `parallelism`만 쓰면 `completions`는 비어 있는 상태로 남습니다

기본 성공 판정은 이 차이에 따라 달라집니다

| completions 설정 | 기본 성공 판정 |
|---|---|
| 값이 있음 | `succeeded >= completions`이면서 `active == 0` |
| 값이 없음 | `succeeded > 0`이면서 `active == 0` |

`completions`가 없는 경우에도 첫 Pod의 성공을 보자마자 남은 Pod를 전부 종료하는 것은 아닙니다
컨트롤러는 새 Pod 보충을 멈추고 이미 활성인 Pod들이 끝나기를 기다립니다
성공 하나 이상과 활성 Pod 0이라는 조건을 함께 보는 이유입니다

### Indexed는 같은 번호의 성공을 중복해서 세지 않습니다

`completionMode`의 기본값은 `NonIndexed`이며, 성공한 Pod 수를 셉니다
`Indexed`에서는 `0`부터 `completions-1`까지 번호를 배정하고, 각 번호가 성공했는지 따로 기록합니다
같은 번호의 Pod가 여러 번 생성되더라도 그 번호의 성공은 하나로 집계합니다

번호는 `batch.kubernetes.io/job-completion-index` annotation과 label에 기록됩니다
[`addCompletionIndexEnvVariable`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/indexed_job_utils.go)은 `JOB_COMPLETION_INDEX`가 이미 명시돼 있지 않으면 label을 참조하는 환경 변수를 추가합니다
이 번호로 작업 구간을 나눌 수 있지만, 번호의 중복 집계를 막는 것과 애플리케이션이 실제로 한 번만 실행되는 것은 다릅니다

## Job의 Pod 재시작 정책에는 Never와 OnFailure만 허용합니다

Job의 `spec.template.spec.restartPolicy`에는 `Never` 또는 `OnFailure`를 지정해야 합니다
`Always`를 넣거나 비우면 [`validateJobSpec`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/batch/validation/validation.go)이 거부합니다
다음은 validation이 만드는 에러 형식이며 실제 apply 결과를 수집한 것은 아닙니다

```text
spec.template.spec.restartPolicy: Required value: valid values: "OnFailure", "Never"
```

필드를 비우면 PodSpec defaulting이 먼저 `Always`를 채우므로 거부 대상이 됩니다
Pod 정책을 그대로 따르는 일반 컨테이너는 정상 종료해도 `Always`이면 kubelet이 다시 실행해 Pod가 성공 phase로 끝나지 못하기 때문입니다

Job은 성공한 컨테이너 실행을 별도로 세는 대신, [kubelet이 판정한 Pod 결과](/essays/k8s-theory-kubelet-pod-lifecycle)를 입력으로 사용합니다
컨테이너별 재시작 정책·규칙을 별도로 지정하지 않은 기본 경로에서는 다음과 같이 구분합니다
`OnFailure`는 실패한 컨테이너를 같은 Pod 안에서 다시 실행할 수 있고, `Never`는 그 컨테이너를 다시 시작하지 않는다는 차이가 있습니다

현재 기본 on인 `ContainerRestartRules` 기능에서는 일반 컨테이너의 `restartPolicy`와 `restartPolicyRules`가 Pod 정책을 재정의할 수 있습니다
Pod 정책과 컨테이너별 규칙을 함께 확인해야 실제 재시작 여부를 판단할 수 있습니다

## backoffLimit은 실패 Pod와 컨테이너 재시작을 구분해서 셉니다

`backoffLimit`의 기본값은 6입니다
`backoffLimitPerIndex`를 설정한 Indexed Job에서는 별도 지정하지 않은 전체 `backoffLimit`이 `2147483647`, 즉 `MaxInt32`로 바뀝니다
이때도 index별 실패 판정과 Job 전체 실패 판정은 구분됩니다

[`syncJob`과 `pastBackoffLimitOnFailure`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/job_controller.go)는 다음 두 경로를 검사합니다

| 검사 경로 | 적용 대상 | 실패를 결정하는 비교 |
|---|---|---|
| 실패로 집계한 Pod 수 | `Never`, `OnFailure` 모두 | `failed > backoffLimit` |
| 컨테이너 재시작 합 | `OnFailure` 추가 검사 | 양수 한도는 `restarts >= backoffLimit` |
| 컨테이너 재시작 합의 한도 0 | `OnFailure` 추가 검사 | `restarts > 0` |

`OnFailure`의 재시작 합은 `Running` 또는 `Pending` Pod에 기록된 일반 컨테이너·init 컨테이너의 `restartCount`를 더합니다
이미 삭제된 모든 Pod의 재시작 이력을 복원해 합산하는 계산은 아닙니다

따라서 한도가 6이면 실패 Pod 집계 7개는 `7 > 6`에 걸리고, `OnFailure`의 재시작 합 6은 `6 >= 6`에 걸립니다
두 경로의 경계가 같지 않습니다
[공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/job.md#pod-backoff-failure-policy)의 한도 도달이라는 요약만으로 비교 연산자까지 같다고 읽으면 안 됩니다

컨테이너 재시작을 추가로 보는 이유는 실패가 남는 위치가 다르기 때문입니다
실패 Pod 수만 보면 같은 Pod 안에서 계속 재시작하는 컨테이너를 놓칠 수 있습니다
반대로 `OnFailure`도 Pod 자체가 실패할 수 있으므로 실패 Pod 수 검사가 함께 필요합니다

### 재시도 지연과 실패 한도는 다른 값입니다

실패 Pod를 보충할 때는 지연을 늘리는 backoff를 적용합니다
[`DefaultJobPodFailureBackOff`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/job_controller.go)는 10초이고, `MaxJobPodFailureBackOff`는 10분입니다

마지막 성공 이후 실패가 계속되는 경우 지연 계산은 10초, 20초, 40초처럼 두 배로 늘고 10분에서 제한됩니다
[`getRemainingTimeForFailuresCount`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/backoff_utils.go)는 마지막 실패 뒤 이미 지난 시간을 빼서 남은 대기를 계산합니다
현재 확인한 공식 문서도 상한을 10분으로 설명하므로 이 부분은 소스와 일치합니다

이 값은 **Job 컨트롤러의 Pod 보충 지연**입니다
컨테이너를 같은 Pod 안에서 다시 실행하는 kubelet의 backoff와 같은 타이머가 아니며, Pod 생성 시각이 정확히 이 수열 간격으로 관찰된다는 보장도 아닙니다

## 새로운 실패와 성공을 동시에 평가하면 실패 기준을 먼저 봅니다

[`syncJob`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/job_controller.go)은 먼저 이미 기록된 `SuccessCriteriaMet`와 `FailureTarget`을 확인합니다
어느 조건으로 종료할지 아직 정하지 않은 경우에는 다음 순서로 새로운 기준을 평가합니다

1. 실패 Pod가 `podFailurePolicy`의 `FailJob` 규칙에 맞는지 확인합니다
2. 실패 Pod 수나 `OnFailure` 재시작 합이 `backoffLimit`에 걸리는지 확인합니다
3. `activeDeadlineSeconds`에 걸리는지 확인합니다
4. index별 실패 한도를 사용하는 Job이면 실패한 index 수와 남은 index를 확인합니다
5. Indexed Job의 `successPolicy`를 평가하고, 아직 종료 조건을 정하지 않았다면 기본 성공 목표도 평가합니다

앞선 검사에서 종료 이유를 정하면 뒤의 검사로 덮어쓰지 않습니다
`podFailurePolicy`의 모든 매치가 Job을 즉시 실패시키는 것은 아닙니다
`Ignore`는 해당 실패를 한도 계산에서 제외하고, `Count`는 집계하며, `FailIndex`는 해당 index를 실패로 처리합니다
Job 전체를 실패시키는 규칙이 `FailJob`입니다

| 실패 reason | 판단 내용 |
|---|---|
| `PodFailurePolicy` | `FailJob` 규칙에 맞는 실패 |
| `BackoffLimitExceeded` | 전체 실패 Pod 수 또는 OnFailure 재시작 합 검사에 걸림 |
| `DeadlineExceeded` | 활성 시간 한도에 도달 |
| `MaxFailedIndexesExceeded` | 실패한 index 수가 `maxFailedIndexes`를 초과 |
| `FailedIndexes` | 모든 index의 성공·실패가 정해졌고 실패 index가 남음 |

기본 실패 Pod 수는 policy의 `Ignore` 같은 집계 예외를 반영한 값입니다
따라서 화면에서 확인한 모든 Failed Pod 수를 그대로 더하는 것과 항상 같지는 않습니다
기본 대체 정책에서는 삭제 중이면서 아직 Succeeded가 아닌 Pod를 실패로 볼 수 있지만, `Failed` 대체 정책에서는 phase가 Failed에 도달하기 전까지 이 경로로 실패 집계하지 않습니다

### activeDeadlineSeconds는 실패가 없어도 작업을 끝낼 수 있습니다

Job의 `spec.activeDeadlineSeconds`는 `status.startTime`부터 잰 활성 시간에 적용합니다
실패 없이 계속 실행되는 Pod도 이 시간 한도에 걸릴 수 있습니다
실패 횟수 제한이 아직 남아 있어도 시간 한도를 넘으면 Pod를 계속 보충하지 않습니다

동시에 두 제한이 걸렸을 때 기록할 reason은 앞서 본 소스 평가 순서를 따릅니다
문서가 시간 한도의 우선 적용을 설명하는 것과, 동시에 만족한 검사 중 어떤 reason이 먼저 선택되는지는 다른 문제입니다

suspend 상태에서는 이 시간 한도를 검사하지 않습니다
재개할 때는 `startTime`을 현재 시각으로 다시 설정하므로, 중단 전까지 쓴 시간을 누적한 채 초시계를 이어 가는 방식이 아닙니다
또한 Job 수준의 이 필드와 Pod 템플릿 내부의 같은 이름 필드를 구분해야 합니다

## successPolicy는 성공한 index의 조합을 봅니다

`successPolicy`는 Indexed Job에서만 사용할 수 있습니다
기본 `completions`를 전부 채우기 전이라도 지정한 index와 성공 개수가 규칙에 맞으면 성공 기준을 충족할 수 있습니다

| 규칙 필드 | 충족 조건 |
|---|---|
| `succeededIndexes`만 지정 | 지정한 index가 모두 성공 |
| `succeededCount`만 지정 | 성공한 index 수가 지정 값 이상 |
| 둘 다 지정 | 지정한 목록 안에서 성공한 index 수가 지정 값 이상 |

[`matchSuccessPolicy`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/success_policy.go)는 규칙을 쓴 순서대로 검사하고 하나가 맞으면 뒤의 규칙은 검사하지 않습니다
규칙을 충족하면 `SuccessCriteriaMet`의 reason은 `SuccessPolicy`가 됩니다
기본 성공 목표로 충족한 경우의 reason은 `CompletionsReached`입니다

새 실패 기준과 성공 기준이 같은 sync에서 함께 충족되면 앞선 실패 검사가 먼저 적용됩니다
그러나 이미 `SuccessCriteriaMet`가 저장돼 있다면 다음 sync에서는 그 조건에 따라 처리하고 새로운 실패 검사를 건너뜁니다
항상 실패가 성공을 뒤집는다고 일반화하면 이 저장된 조건의 처리를 놓칩니다

## 대체 Pod를 만드는 시점은 종료 완료 시점과 다를 수 있습니다

`parallelism`은 종료 중인 Pod까지 합쳐 실제로 존재하는 Pod 수의 상한이 아닙니다
기본 `podReplacementPolicy: TerminatingOrFailed`에서는 이전 Pod에 `deletionTimestamp`가 생기면 종료 완료 전에 대체 Pod를 만들 수 있습니다
그동안 종료 중인 Pod와 새 Pod가 함께 존재할 수 있습니다

`podReplacementPolicy: Failed`를 쓰면 이전 Pod가 Failed에 도달하기 전까지 대체를 미룹니다
컨트롤러의 활성 목표 계산에도 종료 중인 Pod 수를 반영하므로, 빠른 보충과 종료 완료 대기의 동작이 달라집니다
`status.terminating`에서 종료 중인 Pod 수를 확인할 수 있습니다

[`SetDefaults_Job`과 validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/batch/validation/validation.go)은 `podFailurePolicy`가 있으면 대체 정책을 `Failed`로 제한합니다
이 조합의 기본값도 `Failed`이며 `TerminatingOrFailed`는 허용하지 않습니다
`podFailurePolicy`를 쓸 때는 템플릿의 `restartPolicy`도 `Never`여야 합니다

소스에서 확인한 것은 종료 코드 규칙이 컨테이너의 `state.terminated.exitCode`를 읽는다는 사실입니다
이 값은 종료 뒤에 생깁니다
그 조건만으로 정책 조합을 제한한 설계 이유까지 입증되는 것은 아니므로, 여기서는 허용 조합과 실제 판정 입력을 구분합니다

## 완료 Job의 삭제는 TTL 컨트롤러가 맡습니다

`ttlSecondsAfterFinished`는 완료 Job을 얼마 동안 보존할지 정합니다
[`ttlafterfinished` 컨트롤러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/ttlafterfinished/ttlafterfinished_controller.go)는 `Complete` 또는 `Failed` 최종 조건의 시각에 TTL을 더해 만료를 계산합니다
`FailureTarget`이나 `SuccessCriteriaMet`가 생긴 순간부터 세는 시간이 아닙니다

삭제 직전에는 API 서버에서 Job을 다시 읽어 TTL을 재확인한 뒤 UID 조건을 붙여 foreground 삭제를 요청합니다
그 뒤 owner reference에 연결된 Pod 정리도 이어집니다
TTL이 지났다고 모든 오브젝트가 바로 사라진다는 시간 보장은 아닙니다

이 필드를 생략하면 TTL 기반 자동 삭제는 적용되지 않습니다
CronJob이 만든 Job은 별도로 성공·실패 이력 개수 제한에 따라 정리할 수 있습니다
두 정리 경로를 혼동하면 완료 Job이 남은 이유를 잘못 찾게 됩니다

## CronJob은 놓친 회차 전부를 만들지 않습니다

CronJob 컨트롤러는 생성할 스케줄 시각을 계산해 가장 최근의 놓친 회차 하나를 선택합니다
다음은 매시 실행하며 시작 기한이 없고, 컨트롤러가 15시에 돌아왔다고 가정한 그림입니다

![놓친 매시 회차 중 최근 15시 하나를 선택한 뒤 정책이 허용하면 Job 하나 생성을 시도하는 흐름|tall](/diagrams/k8s-theory-job-cronjob-completion-3.svg)

[`mostRecentScheduleTime`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/cronjob/utils.go)은 놓친 횟수도 계산하지만, 생성 대상으로 반환하는 시각은 최근 회차 하나입니다
오래된 누락분을 모두 Job 오브젝트로 복원하는 동작은 아닙니다
회차 하나를 골랐다고 실제 생성까지 확정되는 것도 아닙니다

### startingDeadlineSeconds는 실행 시간이 아니라 시작 기한입니다

이 필드는 스케줄 시각에서 얼마나 늦게 Job 생성을 시작할 수 있는지 제한합니다
설정하면 `scheduledTime + startingDeadlineSeconds < now`인지를 검사합니다
또한 회차 계산의 시작점을 기한 안으로 좁혀 너무 오래된 회차를 후보에서 제외합니다

필드가 없으면 이 시작 기한에 따른 만료 제한을 두지 않습니다
하지만 동시 실행 정책이나 생성 오류가 없어지는 것은 아니므로 모든 회차의 생성 보장으로 읽으면 안 됩니다

문서는 10초 미만의 시작 기한에서 스케줄을 놓칠 수 있다고 경고하며 10초 검사 주기로 설명합니다
반면 확인한 현재 컨트롤러는 다음 스케줄 시각에 100ms를 더해 큐에 다시 예약하는 경로를 사용합니다
이 경고를 모든 CronJob이 고정 10초 간격으로만 검사된다는 구현 설명이나, 짧은 기한이면 반드시 누락된다는 보장으로 옮기지는 않습니다

### 100회 초과는 현재 소스에서 생성 중단 조건이 아닙니다

현재 확인한 [CronJob 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/cron-jobs.md#job-creation)는 100회를 넘게 놓치면 Job을 시작하지 않는다고 설명합니다
하지만 확인한 고정 소스의 `nextScheduleTime`은 `TooManyMissedTimes` 경고 뒤에도 최근 스케줄 시각을 반환합니다
`syncCronJob`은 그 시각으로 나머지 조건을 검사하고 생성을 시도합니다

따라서 이 버전에서 경고가 남았다는 이유만으로 Job 생성이 중단됐다고 판단할 수는 없습니다
100회는 놓친 횟수를 분류해 경고하는 기준이며, 모든 회차를 생성하는 개수 제한도 아닙니다
문서와 구현이 다른 부분이므로 실제 동작을 설명할 때 기준 ref를 함께 봐야 합니다

## concurrencyPolicy와 이름 충돌은 다른 중복을 다룹니다

`concurrencyPolicy`는 같은 CronJob의 이전 회차가 활성 상태로 보일 때 새 회차를 어떻게 처리할지 정합니다

| 정책 | 이전 Job이 활성 상태로 보일 때 |
|---|---|
| `Allow` | 겹쳐도 새 Job 생성 시도. 기본값 |
| `Forbid` | 지금은 생성하지 않음 |
| `Replace` | 이전 Job의 삭제 요청 후 새 Job 생성 시도 |

`Forbid`로 건너뛴 회차가 모두 영구히 버려진다고 단정할 수는 없습니다
이전 Job이 끝난 뒤에도 시작 기한 안이라면 가장 최근의 놓친 회차 하나를 생성할 수 있습니다
기한이 없다면 이 필드로 제한되는 만료 시점도 없습니다

`Replace`는 이전 Job과 그 Pod의 종료가 모두 끝났음을 기다린 뒤 생성하는 정책은 아닙니다
삭제 요청과 실제 프로세스 종료를 구분해야 합니다

같은 회차를 반복 처리하는 문제는 Job 이름으로도 줄입니다
[`getJobName`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/cronjob/cronjob_controllerv2.go)은 CronJob 이름과 스케줄 시각의 Unix 분 값을 조합해 이름을 정합니다
같은 회차를 다시 처리해도 이름은 같습니다
같은 이름의 Job이 이미 있으면 API 서버의 생성은 `AlreadyExists`로 실패합니다
컨트롤러는 자기 소유의 Job인지 확인하고 필요하면 활성 목록에 다시 반영합니다

이름 충돌은 **같은 회차의 추가 오브젝트 생성**을 다루고, `Forbid`는 **다른 회차의 동시 실행**을 다룹니다
판정 대상과 주체가 같지 않습니다

## CronJob과 Job은 작업이 정확히 한 번만 실행된다고 보장하지 않습니다

[`Forbid` 검사 주석](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/cronjob/cronjob_controllerv2.go)은 이미 실행 중인 Job을 아직 보지 못한 채 판단할 수 있다고 설명합니다
컨트롤러가 본 `status.active`가 뒤처지면 `Forbid`에서도 이론적으로 실행이 겹칠 수 있습니다
이 경계는 [캐시된 상태로 판단하는 reconcile](/essays/k8s-theory-reconcile)의 한계와 연결됩니다

공식 문서도 스케줄 회차마다 Job을 정확히 하나 만드는 보장은 아니라고 설명합니다
이름 충돌 검사만으로 오브젝트 생성, Pod 실행, 외부 시스템에 쓴 작업 결과를 모두 한 번으로 만들 수는 없습니다
중복 실행 가능성을 고려해 같은 작업을 반복해도 필요한 결과가 유지되는 멱등성을 애플리케이션에서 설계해야 합니다

실행 누락을 판단할 때는 Job 생성 시각과 원래 스케줄 시각도 나눠 봅니다
생성된 Job의 `batch.kubernetes.io/cronjob-scheduled-timestamp` annotation은 원래 예정 시각을 RFC3339로 기록합니다
현재 시각과 이 값을 비교하는 것은 작업 자체의 실행 시간 한도와도 다른 관측입니다

완료 Job의 기본 보존 개수는 성공 3개, 실패 1개입니다
`successfulJobsHistoryLimit`과 `failedJobsHistoryLimit`으로 바꾸며, 이 제한이 있더라도 정리 처리가 반영될 때까지 더 많은 Job이 남을 수 있습니다

## 확인한 근거

- [Job 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/batch/v1/defaults.go)과 [validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/batch/validation/validation.go) — 성공·동시 실행·실패 한도, 정책 조합
- [Job 컨트롤러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/job_controller.go) — `syncJob`, `pastBackoffLimitOnFailure`, `pastActiveDeadline`, `manageJob`, `enactJobFinished`
- [실패 규칙](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/pod_failure_policy.go), [성공 규칙](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/success_policy.go), [index 집계](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/indexed_job_utils.go) — action별 집계와 성공 index 평가
- [CronJob 컨트롤러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/cronjob/cronjob_controllerv2.go)와 [스케줄 계산](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/cronjob/utils.go) — 최근 회차, 경고, 기한, 이름과 재예약
- [공식 Job 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/job.md)과 [CronJob 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/cron-jobs.md) — API 의미와 실행 보장의 한계
