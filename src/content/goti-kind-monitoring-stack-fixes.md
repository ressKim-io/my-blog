---
title: "Kind 모니터링 스택 일괄 정상화: Helm suffix부터 OTLP 포트까지 8개 이슈 해결"
excerpt: "Kind 클러스터에 ArgoCD로 배포한 모니터링 스택에서 발생한 8가지 문제를 해결한 기록 — Helm release suffix, values 키 불일치, Helm 이스케이프까지"
category: kubernetes
tags:
  - go-ti
  - kind
  - monitoring
  - helm
  - alloy
  - loki
  - tempo
  - argocd
  - otel
  - troubleshooting
series:
  name: "goti-kind-monitoring"
  order: 1
date: "2026-03-12"
---

## 🎯 한 줄 요약

> Kind 클러스터에 모니터링 스택을 ArgoCD로 배포했더니 거의 모든 Pod가 CrashLoopBackOff. 근본 원인은 Helm release 이름의 `-dev` suffix였고, 총 8개 이슈를 한 번에 해결했습니다.

## 📊 Impact

- **영향 범위**: 모니터링 파이프라인 전체 불가 (메트릭, 로그, 트레이스 모두)
- **영향받은 컴포넌트**: Alloy, Loki, Tempo, Grafana, goti-server
- **발생일**: 2026-03-12

---

## 🔥 상황: 모니터링 스택이 전부 죽어있다

Kind 클러스터에 kube-prometheus-stack, Alloy, Loki, Tempo를 ArgoCD로 배포했습니다.
배포 자체는 성공했지만, 실제로 동작하는 컴포넌트가 거의 없었습니다.

다수 Pod가 CrashLoopBackOff이고, 텔레메트리 파이프라인이 전혀 동작하지 않았습니다.

---

## 🤔 근본 원인: Helm release 이름 suffix

8개 이슈의 대부분은 하나의 근본 원인에서 비롯됐습니다.

ApplicationSet이 `{{component}}-{{env}}` 패턴으로 release 이름을 생성합니다.
그래서 모든 Service, ConfigMap, Secret 이름에 `-dev`가 자동으로 붙습니다.

문제는 values 파일에서 서비스 주소를 하드코딩할 때 이 suffix를 누락한 것입니다.

영향받은 서비스 주소를 정리하면 다음과 같습니다:

| values 파일 | 잘못된 주소 | 올바른 주소 |
|-------------|-----------|-----------|
| alloy | `kube-prometheus-stack-prometheus.monitoring.svc` | `kube-prometheus-stack-**dev**-prometheus.monitoring.svc` |
| alloy | `loki.monitoring.svc` | `loki-**dev**.monitoring.svc` |
| alloy | `tempo.monitoring.svc` | `tempo-**dev**.monitoring.svc` |
| loki | `kube-prometheus-stack-alertmanager.monitoring.svc` | `kube-prometheus-stack-**dev**-alertmanager.monitoring.svc` |
| tempo | `kube-prometheus-stack-prometheus.monitoring.svc` | `kube-prometheus-stack-**dev**-prometheus.monitoring.svc` |
| kps grafana | `loki.monitoring.svc` (datasource) | `loki-**dev**.monitoring.svc` |
| kps grafana | `tempo.monitoring.svc` (datasource) | `tempo-**dev**.monitoring.svc` |

이 표에서 볼 수 있듯이, `-dev` suffix 누락이 7곳에서 동시에 발생했습니다.
Helm release 이름이 생성하는 리소스 이름에 직접 영향을 주기 때문에, values에서 서비스 주소를 참조할 때 **반드시 `kubectl get svc -n <ns>`로 실제 이름을 확인**해야 합니다.

---

## 🔥 이슈 1: Alloy /tmp 볼륨 누락 (read-only filesystem)

### 증상

```bash
$ kubectl logs alloy-dev-xxxxx -n monitoring
mkdir /tmp/alloy: read-only file system
```

Alloy DaemonSet의 일부 워커 노드에서 CrashLoopBackOff가 발생했습니다.

### 원인

`securityContext.readOnlyRootFilesystem: true`로 설정되어 있는데, Alloy가 `--storage.path=/tmp/alloy`로 쓰기를 시도합니다.
`/tmp`에 emptyDir 볼륨이 마운트되어 있지 않아서 쓰기가 실패한 겁니다.

### 해결

```yaml
# alloy-values.yaml
alloy:
  mounts:
    extra:
      - name: tmp
        mountPath: /tmp

controller:
  volumes:
    extra:
      - name: tmp
        emptyDir: {}
```

### ⚠️ Helm chart values 키 불일치

여기서 한 번 삽질했습니다.
처음에 `alloy.extraVolumes` / `alloy.extraVolumeMounts`로 작성했지만, **Alloy chart는 이 키를 무시합니다.**

올바른 키는 `alloy.mounts.extra` + `controller.volumes.extra`입니다.
Helm chart마다 같은 기능이라도 키 구조가 다르기 때문에, `helm show values <chart>`로 반드시 확인해야 합니다.

---

## 🔥 이슈 2: Alloy OTLP 포트 미노출

### 증상

goti-server가 Alloy에 OTLP 데이터를 보낼 수 없었습니다.
Service를 확인해보니 12345/TCP (UI 포트)만 노출되어 있었습니다.

### 원인

Alloy chart 기본 Service에는 OTLP 포트(4317 gRPC / 4318 HTTP)가 포함되어 있지 않습니다.

### 해결

```yaml
# alloy-values.yaml
alloy:
  extraPorts:
    - name: otlp-grpc
      port: 4317
      targetPort: 4317
      protocol: TCP
    - name: otlp-http
      port: 4318
      targetPort: 4318
      protocol: TCP
```

여기서도 처음에 `service.additionalPorts`로 작성했다가 무시당했습니다.
올바른 키는 `alloy.extraPorts`입니다.

**이슈 1과 같은 패턴입니다.** Helm chart의 values 키는 chart마다 다르므로, 문서가 아닌 `helm show values`를 기준으로 작성해야 합니다.

---

## 🔥 이슈 3: OTEL Exporter Endpoint — EC2 vs Kind 서비스 주소

### 증상

goti-server에서 `http://goti-alloy:4318`로 OTLP 전송을 시도하지만, DNS 해석이 실패합니다.
Alloy에 데이터가 도달하지 않아 Prometheus 메트릭 0건, Loki 로그 미수집 상태였습니다.

### 원인

SSM Parameter Store `/dev/server/OTEL_EXPORTER_ENDPOINT`가 EC2 docker-compose 서비스명(`goti-alloy`)으로 설정되어 있었습니다.
Kind 환경에서는 Helm release로 생성된 `alloy-dev.monitoring.svc`를 사용해야 합니다.

EC2와 Kind가 **같은 SSM 파라미터를 공유**하고 있는 것이 근본 원인입니다.

### 해결

Kind 전용 override 경로를 추가했습니다:

- Terraform: `/dev/kind/server/OTEL_EXPORTER_ENDPOINT` = `http://alloy-dev.monitoring.svc:4318`
- ExternalSecret의 `overridePath` 기능으로 공통값 위에 Kind 전용값 덮어쓰기

같은 패턴으로 분리한 파라미터를 정리하면:

| 파라미터 | EC2 (`/dev/server/`) | Kind (`/dev/kind/server/`) |
|---------|---------------------|--------------------------|
| DATASOURCE_URL | `jdbc:postgresql://postgres:5432/goti` | `jdbc:postgresql://172.20.0.1:5432/goti` |
| REDIS_HOST | `redis` | `172.20.0.1` |
| OTEL_EXPORTER_ENDPOINT | `http://goti-alloy:4318` | `http://alloy-dev.monitoring.svc:4318` |

Docker Compose 서비스명과 K8s Service FQDN은 완전히 다른 체계입니다.
환경별로 서비스 주소가 달라지는 파라미터는 SSM에서 경로를 분리하는 것이 깔끔합니다.

---

## 🔥 이슈 4: Loki sidecar ServiceAccount 토큰 누락

### 증상

```bash
$ kubectl get pods -n monitoring | grep loki
loki-dev-sc-rules-xxxxx   0/1   CrashLoopBackOff   197
```

`loki-sc-rules` sidecar 컨테이너가 197회 재시작을 반복하고 있었습니다.

```
Service token file does not exist
```

### 원인

`serviceAccount.automountServiceAccountToken: false`로 설정되어 있었습니다.
메인 컨테이너는 SA 토큰이 필요 없지만, sidecar는 K8s API에 접근하여 ConfigMap(alert rule)을 읽어야 합니다.
토큰이 없으니 API 접근이 불가능했던 것입니다.

### 해결

```yaml
# loki-values.yaml
serviceAccount:
  automountServiceAccountToken: true
```

`automountServiceAccountToken` 설정 시 **sidecar의 요구사항도 함께 고려**해야 합니다.
메인 컨테이너 기준으로만 판단하면 이런 문제가 발생합니다.

---

## 🔥 이슈 5: Loki extraObjects에서 Helm 렌더링 에러

### 증상

`loki-dev` ArgoCD 앱이 **Unknown** 상태로 표시됩니다.
Helm 렌더링 자체가 실패해서, 이슈 4의 수정을 포함한 모든 loki 리소스가 배포되지 않았습니다.

### 원인

`extraObjects`의 alert rule ConfigMap에서 `{{ $value }}`가 Helm 템플릿 변수로 해석됐습니다.

`{{ $value }}`는 Loki/Prometheus alertmanager 변수이지 Helm 변수가 아닙니다.
하지만 Helm은 이것을 자신의 변수로 인식하고, undefined variable 에러를 발생시킵니다.

### 해결

```yaml
# Before — Helm이 $value를 해석 시도
description: "5분간 결제 에러 로그 {{ $value }}건 발생"

# After — Helm 이스케이프
description: '5분간 결제 에러 로그 {{ "{{" }} $value {{ "}}" }}건 발생'
```

`extraObjects`에서 `{{ }}`를 사용할 때는 반드시 Helm 이스케이프를 적용해야 합니다.
Helm은 모든 `{{ }}`를 자신의 템플릿으로 해석하려고 시도하기 때문입니다.

---

## 🔥 이슈 6: Loki extraVolumes ConfigMap 이름 불일치

### 증상

Loki Pod 기동 시 `loki-alert-rules` ConfigMap을 찾지 못합니다.

### 원인

이름이 미묘하게 달랐습니다:

- `singleBinary.extraVolumes`에서 참조: `loki-alert-rules`
- `extraObjects`에서 실제 생성: `loki-alerting-rules`

`alert`과 `alerting`의 차이. 단순한 오타였습니다.

### 해결

```yaml
# Before
configMap:
  name: loki-alert-rules

# After
configMap:
  name: loki-alerting-rules
```

ConfigMap 이름은 생성하는 곳과 참조하는 곳이 **정확히 일치**해야 합니다.
이런 실수를 방지하려면 Helm 변수로 이름을 통일하는 것이 좋습니다.

---

## 🔥 이슈 7: Grafana 데이터소스 URL 수정

### 증상

Grafana에서 Loki/Tempo 데이터소스 연결이 실패합니다.

### 원인

근본 원인 섹션에서 설명한 `-dev` suffix 누락 문제가 Grafana 데이터소스에도 적용된 겁니다.

### 해결

- Loki URL: `loki.monitoring.svc` → `loki-dev.monitoring.svc`
- Tempo URL: `tempo.monitoring.svc` → `tempo-dev.monitoring.svc`

**서비스 주소를 하드코딩할 때는 실제 Service 이름을 반드시 확인**해야 합니다.

---

## 🔥 이슈 8: Tempo metricsGenerator remote_write URL

### 증상

Tempo가 생성한 service graph, span metrics가 Prometheus에 전달되지 않습니다.

### 원인

역시 `-dev` suffix 누락입니다.

```yaml
# Before
url: "http://kube-prometheus-stack-prometheus.monitoring.svc:9090/api/v1/write"

# After
url: "http://kube-prometheus-stack-dev-prometheus.monitoring.svc:9090/api/v1/write"
```

### 해결

Tempo의 `metricsGenerator.config.storage.remote_write` URL을 올바른 서비스 이름으로 수정했습니다.

---

## 📚 배운 점

### 1. Helm release suffix는 모든 내부 서비스 참조에 영향

ApplicationSet의 `{{component}}-{{env}}` 패턴이 release 이름을 결정하고, 모든 생성 리소스명에 반영됩니다.
values에서 서비스 주소를 하드코딩할 때 **반드시 `kubectl get svc -n <ns>`로 실제 이름을 확인**해야 합니다.

### 2. Helm chart values 키는 chart마다 다르다

같은 기능(`extraVolumes`)이라도 chart별로 키 구조가 다릅니다.
`helm show values <chart>`로 확인하는 것이 필수입니다.

### 3. extraObjects에서 `{{ }}` 사용 시 Helm 이스케이프 필수

alertmanager/prometheus의 `{{ $value }}`는 `{{ "{{" }} $value {{ "}}" }}`로 이스케이프해야 합니다.

### 4. EC2와 Kind는 서비스 주소가 다르다

Docker Compose 서비스명과 K8s Service FQDN은 완전히 다른 체계입니다.
SSM Parameter Store에서 환경별 override 경로로 분리하는 것이 깔끔합니다.

### 5. automountServiceAccountToken 설정 시 sidecar를 고려하라

메인 컨테이너가 SA 토큰 불필요해도, sidecar가 K8s API에 접근해야 하면 `true`로 설정해야 합니다.

### 6. ConfigMap 이름 일관성

extraObjects에서 생성하는 리소스와 extraVolumes에서 참조하는 이름이 정확히 일치하는지 확인하세요.

---

## 📋 수정 파일 전체 목록

| 레포 | 파일 | 변경 |
|------|------|------|
| Goti-k8s | `environments/dev/monitoring/alloy-values.yaml` | /tmp 볼륨, OTLP 포트, exporter URL -dev suffix |
| Goti-k8s | `environments/dev/monitoring/loki-values.yaml` | automountServiceAccountToken, Helm 이스케이프, ConfigMap 이름, alertmanager URL |
| Goti-k8s | `environments/dev/monitoring/kube-prometheus-stack-values.yaml` | Loki/Tempo 데이터소스 URL 수정 |
| Goti-k8s | `environments/dev/monitoring/tempo-values.yaml` | metricsGenerator remote_write URL |
| Goti-Terraform | `terraform/dev/config/main.tf` | Kind 전용 OTEL endpoint 추가 |
| Goti-Terraform | `terraform/dev/config/variables.tf` | kind_server_otel_exporter_endpoint 변수 |
