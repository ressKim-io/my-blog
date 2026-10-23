---
title: "컨테이너 로그 파일: 경로를 정한 쪽은 그 파일을 쓰지 않습니다"
excerpt: "kubelet의 경로 지정과 런타임의 기록, 로그 회전과 컨테이너 GC, kubectl logs와 --previous의 조회 범위를 연결합니다"
category: "kubernetes"
tags: ["Kubernetes", "CRI", "kubelet", "Logging", "containerd", "concept"]
series:
  name: "k8s-theory-node"
  order: 17
date: "2026-09-25"
---

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> containerd 구현 예시는 v2.4.2의 고정 소스를 사용하며 클러스터에서 재현한 실측 기록은 포함하지 않습니다

`kubectl logs --since=1h`를 요청해도 한 시간 분량이 나오지 않을 수 있습니다
조회 조건이 한 시간을 지정했어도 노드의 현재 파일에 그 구간이 남아 있지 않으면 읽을 수 없습니다

컨테이너 로그는 kubelet이 경로를 정하고 런타임이 기록합니다
kubelet은 파일 회전과 조회를 맡지만, 로그 요청마다 남아 있는 회전본을 전부 모아 반환하지는 않습니다

![kubelet의 경로 지정, 런타임의 파일 기록, kubelet의 읽기와 API 서버 중계를 구분한 흐름|tall](/diagrams/k8s-theory-container-log-files-1.svg)

## 경로는 CRI의 두 필드로 전달합니다

[CRI와 OCI의 경계](/essays/k8s-theory-cri-oci-boundary)에서 본 kubelet과 런타임의 계약에는 로그 위치도 들어 있습니다
[`api.proto`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto)는 sandbox의 로그 디렉터리와 컨테이너의 상대 경로를 나눕니다

| CRI 필드 | kubelet이 전달하는 값의 형태 |
|---|---|
| `PodSandboxConfig.LogDirectory` | `/var/log/pods/<namespace>_<Pod 이름>_<UID>/` |
| `ContainerConfig.LogPath` | `<컨테이너 이름>/<restart count>.log` |

Linux의 기본 루트는 `podLogsDir: /var/log/pods`입니다
[`generateContainerConfig`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)는 컨테이너별 디렉터리를 만든 뒤 상대 경로를 설정합니다
실제 파일을 열고 출력 스트림을 기록하는 일은 런타임에 맡깁니다

[`BuildPodLogsDirectory`와 관련 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/helpers.go)는 namespace·Pod 이름·UID를 `_`로 연결합니다
이름을 재사용한 Pod도 UID가 다르면 별도 디렉터리에 속합니다
옛 `/var/log/pods/<UID>` 형태의 디렉터리 이름을 해석하는 호환 코드도 남아 있습니다

`podLogsDir`를 바꾸려면 비어 있지 않은 절대 경로여야 하며 정규화된 ASCII 경로여야 합니다
이는 [`ValidateKubeletConfiguration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/validation/validation.go)의 검증 조건입니다

### 파일 이름은 restart count를 복구할 때도 사용합니다

컨테이너 상태를 찾으면 kubelet은 그 상태의 restart count에 1을 더합니다
상태가 없으면 `calcRestartCountByLogDir`로 로그 디렉터리를 읽어 파일 이름에 남은 숫자를 확인합니다

이 함수는 `0.log` 같은 현재 파일뿐 아니라 `0.log.<시각>.gz` 같은 회전본 이름도 살핍니다
찾은 가장 큰 숫자에 1을 더하므로, 로그 파일 이름은 실행 결과이면서 다음 실행 번호를 정하는 입력입니다

일부 런타임이 재부팅 등으로 상태를 잃더라도 기존 로그를 다시 `0.log`에 쓰지 않도록 보완하는 경로입니다
재부팅 자체가 언제나 상태 손실을 뜻하지는 않습니다
상태와 로그 디렉터리를 모두 잃었다면 이 복구 자료도 사용할 수 없습니다

### /var/log/containers는 별도 원본 저장소가 아닙니다

kubelet은 시작한 컨테이너의 실제 로그 경로를 가리키는 호환용 심볼릭 링크도 만듭니다
[`legacyLogSymlink`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/legacy.go)가 만드는 이름은 다음 형태입니다

```text
/var/log/containers/<Pod 이름>_<namespace>_<컨테이너 이름>-<컨테이너 ID>.log
```

이 경로는 예전 수집기와의 호환을 위한 것이며 로그 내용을 한 벌 더 복사하지 않습니다
대상이 없다고 확인되면 시작 경로에서 링크를 만들지 않고, 파일명은 확장자를 포함해 255바이트 한도에 맞춥니다
컨테이너 로그를 삭제하는 경로에서는 이 링크도 정리합니다

## 경로 계약과 읽을 수 있는 형식은 구분해야 합니다

CRI의 `LogDirectory` 주석은 구조화된 바이너리 로그나 journald 파일 등이 디렉터리에 있을 수 있다고 설명합니다
하지만 이것이 kubelet의 로그 읽기가 그 형식을 모두 지원한다는 뜻은 아닙니다

현재 [`getParseFunc`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-client/pkg/logs/logs.go)는 CRI 형식과 Docker JSON 형식 순서로 파서를 시도합니다
읽기를 시작한 첫 로그 레코드로 파서를 선택하고 이후에도 같은 파서를 사용합니다
`--tail`로 시작 위치를 옮겼다면 여기서 말하는 첫 레코드는 파일의 맨 첫 줄과 다를 수 있습니다

어느 쪽도 해석하지 못하면 `unsupported log format: %q` 오류를 반환합니다
따라서 런타임이 지정된 경로에 파일을 만들었다는 사실과 `kubectl logs`로 읽을 수 있다는 사실을 나눠 확인해야 합니다

### CRI 로그에는 시각·스트림·태그·내용을 기록합니다

다음은 실제 노드에서 수집한 출력이 아니라 형식을 보여 주는 예입니다

```text
2016-10-06T00:17:09.669794202Z stdout F The content of the log entry
```

| 필드 | 뜻 |
|---|---|
| RFC3339Nano 시각 | 런타임이 기록한 로그 시각 |
| `stdout` 또는 `stderr` | 출력이 나온 스트림 |
| `F` 또는 `P` | 완결 또는 아직 완결되지 않은 조각 |
| 나머지 내용 | 공백을 포함할 수 있는 애플리케이션 출력 |

[`cri-api` 상수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/constants.go)에서 `F`는 완전한 한 줄 또는 분할된 출력의 마지막 조각입니다
`P`는 아직 끝나지 않은 조각입니다
태그 필드는 `:`로 확장할 수 있지만 확인한 버전의 정의된 태그는 이 둘입니다

containerd v2.4.2의 [`redirectLogs`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/io/logger.go)는 긴 출력을 설정된 길이에서 나누고 `P`로 기록합니다
출력 스트림이 개행 없이 끝나 남은 내용도 `P`로 기록할 수 있으므로 `P`만으로 뒤에 반드시 완결 조각이 온다고 판단하면 안 됩니다
kubelet의 CRI 파서는 `P` 레코드의 끝 개행을 제거해 조각이 이어지도록 출력합니다

`--since`가 비교하는 시각은 이 바깥쪽 첫 필드입니다
애플리케이션이 JSON 안에 적은 시각이나 파일의 수정 시각을 비교하지 않습니다

### stdout과 stderr를 가르는 조회는 별도 조건이 있습니다

기본 로그 조회는 두 스트림을 같은 응답에 씁니다
파일에는 이미 스트림 필드가 있으므로 분리 조회는 새로운 정보를 만드는 것이 아니라 그 필드로 출력 대상을 고르는 동작입니다

v1.37.1에서도 [`PodLogsQuerySplitStreams`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)는 Alpha이며 기본 off입니다
API 서버와 대상 kubelet에서 이를 켜면 `pods/log`의 `stream` 쿼리에 `Stdout`, `Stderr`, `All`을 지정할 수 있습니다
기본 off와 기능을 켤 수 없다는 설명은 다릅니다

[`ValidatePodLogOptions`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)는 특정 스트림 선택과 `tailLines`의 동시 지정을 허용하지 않습니다
또한 containerd의 [`createContainerLoggers`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/container_start.go)는 TTY가 없을 때만 stderr 로거를 별도로 만듭니다
기록 단계에서 이미 합쳐진 TTY 출력을 조회 옵션만으로 되돌릴 수는 없습니다

## 회전은 현재 파일을 바꾸고 런타임에 다시 열도록 요청합니다

kubelet의 [`containerLogManager`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/logs/container_log_manager.go)는 실행 중인 컨테이너를 주기적으로 큐에 넣습니다
처리 시 런타임의 `ContainerStatus.LogPath`를 조회하고 현재 파일 크기를 확인합니다
종료한 컨테이너는 이 주기적인 회전 큐의 대상이 아닙니다

| KubeletConfiguration | 기본값 | 역할·검증 조건 |
|---|---:|---|
| `containerLogMaxSize` | `10Mi` | 회전 크기 임계값, 음수면 회전 매니저 비활성 |
| `containerLogMaxFiles` | `5` | 현재 파일까지 포함한 보존 파일 수, 1보다 커야 함 |
| `containerLogMaxWorkers` | `1` | 회전 작업자 수, 1 이상 |
| `containerLogMonitorInterval` | `10s` | 실행 중 컨테이너 확인 주기, 3초 이상 |

기본값은 [`SetDefaults_KubeletConfiguration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go)에 있습니다
크기가 임계값 이상일 때 회전하므로 `10Mi`를 파일이 절대로 넘지 못하는 상한으로 읽으면 안 됩니다
다음 확인과 작업 처리 사이에도 런타임은 출력을 기록할 수 있습니다

회전은 다음 순서로 처리합니다

1. 이전 실패에서 남은 임시 파일과 불필요한 파일을 정리합니다
2. 오래된 회전본부터 지워 기존 회전본을 최대 `maxFiles - 2`개로 줄입니다
3. 남은 회전본 중 압축되지 않은 파일을 `.gz`로 압축합니다
4. 현재 파일을 `<n>.log.<시각>`으로 rename한 뒤 CRI `ReopenContainerLog`를 요청합니다

![현재 파일의 rename 뒤에도 열린 fd는 기존 파일을 가리키며 ReopenContainerLog로 새 현재 파일을 여는 회전 흐름|tall](/diagrams/k8s-theory-container-log-files-2.svg)

fd는 프로세스가 열어 둔 파일을 참조하는 식별자입니다
이름을 바꿔도 런타임의 기존 fd가 새 경로로 저절로 바뀌지 않으므로 다시 열도록 요청해야 합니다
확인한 containerd의 [`ReopenContainerLog`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/container_log_reopen.go)는 새 로거를 만들어 기존 출력 대상을 교체합니다

성공한 회전 뒤에는 새 현재 파일 하나와 최대 `maxFiles - 1`개의 회전본이 남습니다
이번에 만든 가장 최근 회전본은 바로 압축하지 않습니다
다음 회전에서 보존 대상에 남아 있으면 압축합니다
소스 주석은 런타임의 기록과 수집기의 읽기가 끝날 시간을 남기는 처리라고 설명합니다

압축은 `.tmp` 파일에 쓴 뒤 `.gz`로 이름을 바꾸고 원본을 삭제합니다
이때 최신 회전본을 바로 압축하지 않는 것과 오래된 파일부터 삭제하는 것은 기존 파일을 읽는 쪽을 고려한 동작입니다
수집기가 반드시 제때 읽는다거나 모든 출력을 손실 없이 보존한다는 보장은 아닙니다

RPC가 실패하면 kubelet은 회전한 파일의 이름을 되돌리려고 시도합니다
CRI 계약은 오류를 반환한 런타임이 새 로그 파일을 만들면 안 된다고 규정합니다
복구 rename 자체의 실패나 그 사이 kubelet 종료까지 원자적으로 보호하는 절차는 아닙니다

[초기 CRI 로그 설계](https://github.com/kubernetes/design-proposals-archive/blob/main/node/kubelet-cri-logging.md)는 회전을 외부 cron 작업 등에 맡기는 그림을 제시했습니다
현재는 kubelet의 회전 구현과 `ReopenContainerLog` RPC를 함께 봐야 합니다
과거 설계의 경로·회전 예시를 현재 구현과 그대로 대응시키면 안 됩니다

## kubectl logs는 선택한 인스턴스의 현재 파일을 읽습니다

[`GetContainerLogs`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)는 선택된 컨테이너 ID로 런타임 상태를 가져옵니다
그 상태의 `LogPath` 하나를 `ReadLogs`에 전달하며 회전본 목록을 모아 읽지 않습니다
[공식 로깅 문서](https://kubernetes.io/docs/concepts/cluster-administration/logging/#log-rotation)도 최신 파일의 내용만 조회할 수 있다고 설명합니다

노드에 `.gz` 회전본이 남아 있다는 사실만으로 `kubectl logs`가 그 내용을 반환하지는 않습니다
`containerLogMaxFiles`를 늘리면 디스크에 남기는 파일 수는 늘지만 이 조회가 읽는 파일 수는 늘지 않습니다
`--since=1h`도 선택한 파일 안에서 시각을 거를 뿐 회전 이전 구간을 복구하지 않습니다

최신 파일 하나로 제한한 실제 설계 이유는 확인한 근거에서 확정하지 못했습니다
압축을 풀고 더 많은 파일을 읽으면 비용이 늘 수 있다는 추론을 구현의 확정된 설계 이유로 제시하지는 않습니다

### follow는 같은 이름으로 다시 생긴 파일을 따라갑니다

현재 [`ReadLogs`와 `waitLogs`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-client/pkg/logs/logs.go)는 `--follow`일 때 파일의 끝까지 읽은 뒤 디렉터리 변경을 감시합니다
같은 이름의 파일이 생성된 이벤트를 만나면 그 경로를 다시 열어 읽기를 이어 갑니다

따라서 회전 전에 열어 둔 파일을 읽는 것과 새 현재 파일로 옮겨 읽는 처리가 모두 있습니다
이 경로를 확인한 것으로 회전 중 모든 출력을 무손실로 전달한다고 보장할 수는 없습니다
같은 소스 파일 상단의 오래된 회전 미지원 주석보다 실제 `ReadLogs`의 재열기 분기를 대조해야 합니다

### previous는 회전본이 아니라 이전 컨테이너를 선택합니다

[`validateContainerLogStatus`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_pods.go)는 `--previous`일 때 `lastState.terminated.containerID`를 고릅니다
그 ID의 상태와 `LogPath`로 읽기를 진행합니다
현재 파일명의 숫자에서 1을 빼 경로를 계산하지 않습니다

| 조회·정리 대상 | 다루는 단위 |
|---|---|
| `kubectl logs` | 상태에 따라 선택한 컨테이너 인스턴스의 현재 로그 파일 |
| `kubectl logs --previous` | 이전 종료 상태가 가리키는 인스턴스의 현재 로그 파일 |
| 로그 회전 | 같은 인스턴스에서 오래된 출력 구간 |
| 컨테이너 GC | 보존 조건을 넘은 종료 인스턴스와 그 로그 |

기본 [`MaxPerPodContainerCount`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/options/options.go)는 1입니다
종료 인스턴스를 하나 남기는 기본 보존 정책이며, 이전 로그를 영구 보관한다는 뜻은 아닙니다
[`containerGC`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_gc.go)는 최소 나이·개수와 Pod 제거 가능 여부 등을 함께 판단합니다

GC의 삭제 경로는 `removeContainerLog`를 거쳐 `LogPath`와 접두사가 같은 회전본까지 정리합니다
이전 인스턴스가 실행 중에 이미 회전했다면 `--previous`로도 마지막 파일만 읽습니다
그 뒤 GC가 인스턴스나 파일을 지웠다면 조회에 필요한 상태 또는 파일이 없어질 수 있습니다

## API 서버는 파일을 저장하지 않고 해당 노드에 중계합니다

로그 요청은 `pods/log` 서브리소스로 들어옵니다
[`LogLocation`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/strategy.go)은 Pod의 `spec.nodeName`으로 노드를 찾아 `/containerLogs/<namespace>/<Pod>/<컨테이너>` URL을 만듭니다
`follow`, `previous`, `sinceSeconds`, `tailLines` 등도 쿼리로 전달합니다

[`LogREST.Get`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/rest/log.go)은 그 응답을 스트림으로 중계합니다
[kubelet 접속 경로](/essays/k8s-theory-kubelet-access)의 API 서버와 노드 연결이 여기에도 필요합니다

노드가 아직 배정되지 않아 `spec.nodeName`이 비어 있으면 로그를 요청할 kubelet URL도 만들지 않습니다
노드가 정해졌더라도 kubelet과 연결할 수 없으면 해당 노드의 파일을 이 경로로 읽을 수 없습니다
로그 본문 전체가 Pod처럼 etcd에 저장돼 대신 반환되는 구조는 아닙니다

### 종료 메시지에 복사한 로그 꼬리는 예외입니다

`terminationMessagePolicy: FallbackToLogsOnError`이면 kubelet이 로그의 끝부분을 종료 메시지로 사용할 수 있습니다
[`convertToKubeContainerStatus`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)의 조건은 다음과 같습니다

- 컨테이너가 종료됐고 exit code가 0이 아니어야 합니다
- 시작조차 못 한 `ContainerCannotRun`은 제외합니다
- 종료 메시지가 비어 있거나 경로·파일·해당 mount가 없을 때 로그를 확인합니다
- 파일 부재 이외의 종료 메시지 읽기 오류에서는 fallback하지 않고 그 오류를 메시지에 남깁니다

로그 읽기가 성공하면 마지막 최대 80개 로그 레코드를 읽어 최대 2 KiB의 꼬리를 사용합니다
로그 읽기 자체가 실패하면 그 오류 문구가 메시지에 들어갈 수 있습니다
이 제한은 [`MaxContainerTerminationMessageLogLines`와 `MaxContainerTerminationMessageLogLength`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/container/runtime.go)에서 확인할 수 있습니다

종료 직후의 `state.terminated.message`, 재시작 뒤의 `lastState.terminated.message`는 Pod 상태에 포함됩니다
그 상태가 이미 API 서버에 보고됐다면 이후 노드의 로그 파일을 읽을 수 없어도 이 메시지는 남아 있을 수 있습니다
이는 로그 전체의 별도 보관과는 범위가 다릅니다

## 로그가 없거나 짧을 때 구분할 위치

다음 문구는 소스의 오류 분기를 대조한 것으로 실제 노드에서 수집한 장애 기록은 아닙니다

| 증상·문구 | 먼저 구분할 조건 |
|---|---|
| 최근 로그만 있거나 `--since` 범위보다 짧음 | 현재 `LogPath`에 남은 구간과 회전본을 구분 |
| `--previous`가 짧음 | 이전 인스턴스도 실행 중 회전했는지 확인 |
| `previous terminated container … not found` | Pod 상태에 이전 종료 상태와 ID가 있는지 확인 |
| `unable to retrieve container logs for …` | ID 선택 뒤 런타임의 ContainerStatus 조회가 실패했는지 확인 |
| `unsupported log format: …` | 읽기 시작 지점의 레코드가 지원 형식인지 확인 |
| 파일 경로 해석·열기 오류 | 실제 파일 존재, 심볼릭 링크 대상, 회전·재열기 경로 확인 |
| 회전이 실행되지 않음 | 음수 크기 설정 여부와 컨테이너 실행 상태 확인 |
| 노드 연결 실패 | 파일 조회의 노드 의존성과 이미 보고된 종료 메시지를 구분 |

노드 밖에서도 로그를 보존하려면 수집과 저장에 별도 수명주기가 필요합니다
그 수집기가 파일의 rename·압축·삭제를 어떻게 따라가는지는 노드 파일 조회와 구분해서 확인해야 합니다

## 확인한 근거

- [CRI 필드·재열기 계약](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto), [CRI 로그 상수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/constants.go) — 위치와 로그 메타데이터의 경계
- [컨테이너 경로 생성·로그 조회·종료 메시지](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go), [로그 매니저](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/logs/container_log_manager.go), [CRI 로그 리더](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-client/pkg/logs/logs.go) — 기록 이후의 회전·조회·삭제
- [공식 Logging Architecture 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/cluster-administration/logging.md) — 최신 파일 조회, 회전 설정과 기본 보존 정책
- [containerd v2.4.2 로그 기록](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/io/logger.go), [재열기 구현](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/container_log_reopen.go) — 런타임 구현 예시, 실제 노드 설치 버전 판정은 아님
