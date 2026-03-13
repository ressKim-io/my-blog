---
date: 2026-03-12
type: troubleshoot
tags: [kind, monitoring, alloy, loki, pyroscope, tempo, helm, otel, externalsecret]
---

# [TROUBLE] Kind 모니터링 스택 일괄 정상화 — 7개 이슈 해결

## 배경
Kind K8s 클러스터에 모니터링 스택(kube-prometheus-stack, Alloy, Loki, Tempo, Pyroscope)을 ArgoCD로 배포한 후, 다수 Pod가 CrashLoopBackOff이고 텔레메트리 파이프라인이 전혀 동작하지 않았음.

## 근본 원인: Helm release 이름 suffix

ApplicationSet이 `{{component}}-{{env}}` 패턴으로 release 이름을 생성하므로, 모든 Service/ConfigMap/Secret 이름에 `-dev`가 포함됨. values에서 서비스 주소를 하드코딩할 때 이 suffix를 누락하면 DNS 해석 실패.

**영향받은 모든 서비스 주소:**

| values 파일 | 잘못된 주소 | 올바른 주소 |
|-------------|-----------|-----------|
| alloy | `kube-prometheus-stack-prometheus.monitoring.svc` | `kube-prometheus-stack-dev-prometheus.monitoring.svc` |
| alloy | `loki.monitoring.svc` | `loki-dev.monitoring.svc` |
| alloy | `tempo.monitoring.svc` | `tempo-dev.monitoring.svc` |
| loki | `kube-prometheus-stack-alertmanager.monitoring.svc` | `kube-prometheus-stack-dev-alertmanager.monitoring.svc` |
| tempo | `kube-prometheus-stack-prometheus.monitoring.svc` | `kube-prometheus-stack-dev-prometheus.monitoring.svc` |
| kps grafana | `loki.monitoring.svc` (datasource) | `loki-dev.monitoring.svc` |
| kps grafana | `tempo.monitoring.svc` (datasource) | `tempo-dev.monitoring.svc` |

---

## 이슈 1: Pyroscope CrashLoopBackOff

### 증상
- `pyroscope-dev-0`: `flag provided but not defined: -pyroscopedb.retention-period` → CrashLoopBackOff (198회)

### 원인
- pyroscope chart v1.18.1에서 `-pyroscopedb.retention-period` CLI 플래그 미지원
- values의 `extraArgs`에 해당 플래그 설정

### 해결
- Pyroscope 자체가 dev 환경에서 불필요 → **리소스 전체 제거**
- `monitoring-appset.yaml`에서 pyroscope 항목 삭제
- `pyroscope-values.yaml` 파일 삭제
- kps grafana에서 Pyroscope 데이터소스 및 Tempo `tracesToProfiles` 참조 제거

---

## 이슈 2: Alloy /tmp 볼륨 누락 (read-only filesystem)

### 증상
- `alloy-dev` DaemonSet 일부 worker에서: `mkdir /tmp/alloy: read-only file system` → CrashLoopBackOff

### 원인
- `securityContext.readOnlyRootFilesystem: true`인데 Alloy가 `--storage.path=/tmp/alloy`로 쓰기 시도
- `/tmp`에 emptyDir 볼륨 미마운트

### 해결
```yaml
# alloy-values.yaml — Alloy chart의 올바른 values 키
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

### 주의: Helm chart values 키 불일치
처음에 `alloy.extraVolumes`/`alloy.extraVolumeMounts`로 작성했으나, Alloy chart는 이 키를 무시함. 올바른 키는 `alloy.mounts.extra` + `controller.volumes.extra`.

---

## 이슈 3: Alloy OTLP 포트 미노출

### 증상
- goti-server가 Alloy에 OTLP 데이터를 보낼 수 없음
- `alloy-dev` Service가 12345/TCP (UI)만 노출

### 원인
- Alloy chart 기본 Service에 OTLP 포트(4317 gRPC / 4318 HTTP) 미포함

### 해결
```yaml
# alloy-values.yaml — Alloy chart의 올바른 values 키
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

### 주의: Helm chart values 키 불일치
처음에 `service.additionalPorts`로 작성했으나, Alloy chart는 이 키를 무시함. 올바른 키는 `alloy.extraPorts`.

---

## 이슈 4: OTEL_EXPORTER_ENDPOINT 잘못된 서비스 주소

### 증상
- goti-server → `http://goti-alloy:4318` 전송 시도 → DNS 해석 실패
- Alloy에 OTLP 데이터 미도달 → Prometheus 메트릭 0건, Loki 로그 미수집

### 원인
- SSM Parameter Store `/dev/server/OTEL_EXPORTER_ENDPOINT`가 EC2 docker-compose 서비스명(`goti-alloy`)으로 설정
- Kind 환경에서는 Helm release로 생성된 `alloy-dev.monitoring.svc`를 사용해야 함

### 해결
- EC2와 Kind가 같은 SSM 파라미터를 공유하므로, Kind 전용 override 경로 추가
- Terraform: `/dev/kind/server/OTEL_EXPORTER_ENDPOINT` = `http://alloy-dev.monitoring.svc:4318`
- ExternalSecret의 `overridePath` 기능으로 공통값 위에 Kind 전용값 덮어쓰기

### 같은 패턴으로 분리한 파라미터
| 파라미터 | EC2 (`/dev/server/`) | Kind (`/dev/kind/server/`) |
|---------|---------------------|--------------------------|
| DATASOURCE_URL | `jdbc:postgresql://postgres:5432/goti` | `jdbc:postgresql://172.20.0.1:5432/goti` |
| REDIS_HOST | `redis` | `172.20.0.1` |
| OTEL_EXPORTER_ENDPOINT | `http://goti-alloy:4318` | `http://alloy-dev.monitoring.svc:4318` |

---

## 이슈 5: Loki sidecar ServiceAccount 토큰 없음

### 증상
- `loki-sc-rules` sidecar: `Service token file does not exist` → CrashLoopBackOff (197회)

### 원인
- `serviceAccount.automountServiceAccountToken: false` 설정
- sidecar가 K8s API에 접근하여 ConfigMap (alert rule) 읽어야 하는데 토큰 없음

### 해결
```yaml
# loki-values.yaml
serviceAccount:
  automountServiceAccountToken: true
```

---

## 이슈 6: Loki extraObjects {{ $value }} Helm 렌더링 에러

### 증상
- `loki-dev` ArgoCD 앱이 **Unknown** 상태
- Helm 렌더링 실패로 모든 loki 리소스 배포 불가 (이슈 5의 수정도 반영 안 됨)

### 원인
- `extraObjects`의 alert rule ConfigMap에서 `{{ $value }}`가 Helm 템플릿 변수로 해석됨
- `{{ $value }}`는 Loki/Prometheus alertmanager 변수이지 Helm 변수가 아님
- Helm이 undefined variable 에러 발생

### 해결
```yaml
# Before — Helm이 $value를 해석 시도
description: "5분간 결제 에러 로그 {{ $value }}건 발생"

# After — Helm 이스케이프
description: '5분간 결제 에러 로그 {{ "{{" }} $value {{ "}}" }}건 발생'
```

---

## 이슈 7: Loki extraVolumes ConfigMap 이름 불일치

### 증상
- Loki Pod 기동 시 `loki-alert-rules` ConfigMap을 찾지 못함

### 원인
- `singleBinary.extraVolumes`에서 `configMap.name: loki-alert-rules` 참조
- `extraObjects`에서 생성하는 ConfigMap 이름은 `loki-alerting-rules`
- 이름이 다름

### 해결
```yaml
# Before
configMap:
  name: loki-alert-rules

# After
configMap:
  name: loki-alerting-rules
```

---

## 이슈 8: Grafana 데이터소스 URL + Pyroscope 참조

### 증상
- Grafana에서 Loki/Tempo 데이터소스 연결 실패
- Pyroscope 데이터소스 존재하나 리소스 이미 삭제됨

### 원인
- Grafana `additionalDataSources`에서 Loki/Tempo URL에 `-dev` suffix 누락
- Pyroscope 데이터소스 항목 + Tempo `tracesToProfiles` pyroscope 연동이 남아있음

### 해결
- Loki URL: `loki.monitoring.svc` → `loki-dev.monitoring.svc`
- Tempo URL: `tempo.monitoring.svc` → `tempo-dev.monitoring.svc`
- Pyroscope 데이터소스 항목 제거
- Tempo `tracesToProfiles` (pyroscope 연동) 블록 제거

---

## 이슈 9: Tempo metricsGenerator remote_write URL

### 증상
- Tempo가 생성한 service graph / span metrics가 Prometheus에 미전달

### 원인
- `tempo.metricsGenerator.config.storage.remote_write` URL에 `-dev` suffix 누락

### 해결
```yaml
# Before
url: "http://kube-prometheus-stack-prometheus.monitoring.svc:9090/api/v1/write"

# After
url: "http://kube-prometheus-stack-dev-prometheus.monitoring.svc:9090/api/v1/write"
```

---

## 수정 파일 전체 목록

| 레포 | 파일 | 변경 |
|------|------|------|
| Goti-k8s | `environments/dev/monitoring/alloy-values.yaml` | /tmp 볼륨, OTLP 포트, exporter URL -dev suffix |
| Goti-k8s | `environments/dev/monitoring/loki-values.yaml` | automountServiceAccountToken, {{ $value }} 이스케이프, ConfigMap 이름 수정, alertmanager URL |
| Goti-k8s | `environments/dev/monitoring/kube-prometheus-stack-values.yaml` | Loki/Tempo 데이터소스 URL, Pyroscope 데이터소스/tracesToProfiles 제거 |
| Goti-k8s | `environments/dev/monitoring/tempo-values.yaml` | metricsGenerator remote_write URL |
| Goti-k8s | `gitops/applicationsets/monitoring-appset.yaml` | Pyroscope 항목 제거 |
| Goti-k8s | `environments/dev/monitoring/pyroscope-values.yaml` | 파일 삭제 |
| Goti-Terraform | `terraform/dev/config/main.tf` | `/dev/kind/server/OTEL_EXPORTER_ENDPOINT` 추가 |
| Goti-Terraform | `terraform/dev/config/variables.tf` | `kind_server_otel_exporter_endpoint` 변수 |
| Goti-Terraform | `terraform/dev/variables.tf` | 루트 변수 |
| Goti-Terraform | `terraform/dev/terraform.tfvars` | 값 설정 |

---

## 교훈

1. **Helm release suffix는 모든 내부 서비스 참조에 영향** — ApplicationSet의 `{{component}}-{{env}}` 패턴이 release 이름을 결정하고, 모든 생성 리소스명에 반영됨. values에서 서비스 주소를 하드코딩할 때 **반드시 `kubectl get svc -n <ns>`로 실제 이름 확인**
2. **Helm chart values 키는 chart마다 다름** — 같은 기능(`extraVolumes`)이라도 chart별로 키 구조가 다름. `helm show values <chart>`로 확인 필수
3. **extraObjects에서 {{ }} 사용 시 Helm 이스케이프 필수** — alertmanager/prometheus의 `{{ $value }}`는 `{{ "{{" }} $value {{ "}}" }}`로 이스케이프
4. **EC2와 Kind는 서비스 주소가 다름** — Docker Compose 서비스명 vs K8s Service FQDN. SSM Parameter Store에서 환경별 override 경로로 분리
5. **automountServiceAccountToken 설정 시 sidecar 고려** — 메인 컨테이너가 SA 토큰 불필요해도, sidecar가 K8s API 접근 필요하면 true 설정
6. **ConfigMap 이름 일관성** — extraObjects에서 생성하는 리소스와 extraVolumes에서 참조하는 이름이 정확히 일치하는지 확인
