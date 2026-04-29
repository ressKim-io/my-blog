---
title: "Discord 알림 구축기: 아키텍처 결정부터 배포 3연속 장애까지"
excerpt: "Alertmanager receiver가 null인 상태에서 Discord 알림을 구축하면서 만난 Secret 미존재, ESO 캐시, ArgoCD 리소스 이중 관리 3연속 장애"
category: monitoring
tags:
  - go-ti
  - Alertmanager
  - Discord
  - Monitoring
  - ExternalSecret
  - ArgoCD
  - Troubleshooting
  - Architecture-Decision
date: "2026-02-13"
---

## 🎯 한 줄 요약

> Alertmanager receiver가 전부 "null"인 상태에서 Discord 알림을 구축했습니다. 3개 레포를 동시에 수정하면서 Secret 미존재, ESO 캐시, ArgoCD 리소스 이중 관리까지 3연속 장애를 만났습니다.

## 📊 Impact

- **영향 범위**: 20개+ PrometheusRule이 동작 중이지만 알림이 **아무 곳에도 전송되지 않는 상태**
- **증상**: Alertmanager receiver가 전부 `"null"` → firing alert가 쌓여도 아무도 모름
- **연쇄 장애**: Discord 알림 구축 과정에서 3건의 연쇄 장애 발생
- **소요 시간**: 아키텍처 결정 + 구현 + 장애 해결까지 약 1일
- **발생일**: 2026-03-31

---

## 🤔 아키텍처 결정: Slack이 아니라 Discord인 이유

### 배경: receiver가 전부 null이라고?

EKS prod 환경에 모니터링 스택은 잘 구축되어 있었습니다.

- Alertmanager 동작 중
- PrometheusRule 20개+ 등록 완료
- Blackbox Exporter로 외부 헬스체크도 돌고 있음

그런데 문제가 하나 있었습니다. **receiver가 전부 `"null"`이었습니다.**

```yaml
# alertmanager.yml (변경 전)
receivers:
  - name: "null"
route:
  receiver: "null"
  routes:
    - match:
        severity: critical
      receiver: "null"    # ← 여기도 null
    - match:
        severity: warning
      receiver: "null"    # ← 여기도 null
```

firing alert가 쌓여도 아무도 모르는 상태였습니다. 팀원이 알림 채널 구축을 요청했고, 팀에서 사용하는 커뮤니케이션 도구가 Discord였기 때문에 Discord를 선택했습니다.

### 3가지 옵션 비교

Alertmanager에서 Discord로 알림을 보내는 방법은 3가지가 있습니다.

| | Option A | Option B | Option C |
|---|---|---|---|
| **방식** | Discord native webhook (`webhook_configs`) | Discord `/slack` endpoint (`slack_configs`) | alertmanager-discord 프록시 |
| **메시지 포맷** | Discord embed (색상, 필드 구분) | Plain text (Slack 형식) | Rich embed + 유연한 포맷팅 |
| **구현 난이도** | Go template으로 Discord embed JSON 직접 구성 | `slack_configs` 그대로 사용 | 별도 Deployment/Service 운영 |
| **ExternalSecret 재사용** | ❌ `url` 직접 지정 | ✅ `api_url_file` 지시어 | ❌ 별도 설정 필요 |
| **유지보수 부담** | 높음 (Go template) | 낮음 (기존 가이드 기반) | 중간 (추가 컴포넌트) |

각 옵션의 차이를 좀 더 살펴보겠습니다.

**Option A**는 Discord webhook에 embed JSON을 직접 보내는 방식입니다. 색상 sidebar, 필드 구분 같은 rich 메시지가 가능하지만, Alertmanager에 Discord 네이티브 지원이 없습니다. Go template으로 Discord embed JSON을 직접 구성해야 하는데, 이것이 생각보다 유지보수 부담이 큽니다.

**Option B**는 Discord의 숨겨진 기능을 활용합니다. Discord webhook URL 뒤에 `/slack`을 붙이면 Slack 형식 payload를 수신할 수 있습니다. 즉 Alertmanager의 `slack_configs`를 **그대로** 사용할 수 있다는 뜻입니다. 게다가 `api_url_file` 지시어로 ExternalSecret 패턴까지 재사용 가능합니다.

**Option C**는 별도 프록시 서비스를 띄우는 방식입니다. Rich embed도 가능하고 유연하지만, 추가 Deployment/Service를 운영해야 합니다. 알림 하나 보내려고 컴포넌트를 하나 더 띄우는 것은 과하다고 판단했습니다.

### 채널 구조 결정: severity별 2채널

채널 구조도 결정해야 했습니다.

| 구조 | 장점 | 단점 |
|---|---|---|
| **단일 채널** | 관리 용이, webhook URL 1개 | critical과 warning이 섞임 |
| **severity별 2채널** | 알림 노이즈 감소, 중요도별 분리 | webhook URL 2개 관리 필요 |

팀원이 이미 `alerts-high`(critical)과 `alerts-low`(warning) 채널 2개를 만들어둔 상태였습니다. 자연스럽게 severity별 2채널 분리로 결정했습니다.

### 최종 선택: Option B + 2채널 분리

**Option B (Discord `/slack` endpoint) + severity별 2채널 분리**를 선택했습니다.

선택 근거를 정리하면:

1. **마이그레이션 비용 최소**: 기존 가이드 문서와 alertmanager.yml이 모두 `slack_configs` 기반
2. **ExternalSecret 패턴 재사용**: `api_url_file`로 Secret 파일 마운트 패턴을 그대로 쓸 수 있음
3. **alerting 용도에는 plain text로 충분**: alert name, severity, description만 전달하면 됨
4. **채널 이미 준비 완료**: 팀원이 high/low 채널을 미리 생성해둔 상태

plain text라는 제약이 있지만, 알림 목적에서는 **"뭐가 터졌는지 빠르게 파악"**이 중요하지 예쁜 embed가 중요한 것이 아닙니다.

---

## 🔧 구현: 3개 레포를 동시에 수정하면 벌어지는 일

### 구현 구조

Discord 알림을 동작시키려면 **SSM → ExternalSecret → Secret → Alertmanager → Discord** 전체 파이프라인을 구축해야 합니다.

{/* TODO: Draw.io로 교체 (public/images/monitoring/discord-alerting-pipeline.svg) */}
```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Discord Alerting Pipeline                             │
│                                                                         │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────┐      │
│  │ AWS SSM      │    │ ExternalSecret   │    │ K8s Secret        │      │
│  │ Parameter    │───▶│ (ESO)            │───▶│                   │      │
│  │ Store        │    │                  │    │ url-high          │      │
│  │              │    │ alertmanager-    │    │ url-low           │      │
│  │ DISCORD_     │    │ discord-webhook  │    │                   │      │
│  │ WEBHOOK_     │    │                  │    └────────┬──────────┘      │
│  │ URL_HIGH     │    └──────────────────┘             │                 │
│  │ URL_LOW      │                                     │                 │
│  └──────────────┘                          ┌──────────▼──────────┐     │
│                                            │ Alertmanager        │     │
│                                            │                     │     │
│                                            │ api_url_file:       │     │
│                                            │   /etc/alertmanager │     │
│                                            │   /secrets/url-high │     │
│                                            │   /etc/alertmanager │     │
│                                            │   /secrets/url-low  │     │
│                                            └──────────┬──────────┘     │
│                                                       │                │
│                                          ┌────────────┴────────────┐   │
│                                          │                         │   │
│                                          ▼                         ▼   │
│                                  ┌──────────────┐        ┌────────────┐│
│                                  │ Discord      │        │ Discord    ││
│                                  │ #alerts-high │        │ #alerts-low││
│                                  │ (critical)   │        │ (warning)  ││
│                                  └──────────────┘        └────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

이 파이프라인을 구축하려면 **3개 레포를 동시에 수정**해야 합니다.

| 레포 | 변경 내용 | 역할 |
|---|---|---|
| **Goti-Terraform** | SSM Parameter 추가 (`DISCORD_WEBHOOK_URL_HIGH/LOW`) | 시크릿 저장소 |
| **Goti-k8s** | ExternalSecret 리소스 생성 (`alertmanager-discord-webhook`) | SSM → K8s Secret 동기화 |
| **Goti-monitoring** | Alertmanager config 전면 교체 (receiver, route, secrets 마운트) | 알림 발송 설정 |

여기서 핵심은 **의존성 순서**입니다.

1. Terraform이 SSM 파라미터를 만들어야 →
2. ExternalSecret이 SSM에서 값을 읽어 Secret을 생성하고 →
3. Alertmanager가 그 Secret을 마운트해서 사용

이 순서가 꼬이면? 바로 장애가 터집니다.

### Alertmanager 설정 변경

receiver를 `"null"`에서 실제 Discord webhook으로 교체했습니다.

```yaml
# alertmanager.yml (변경 후)
receivers:
  - name: "discord-high"
    slack_configs:
      - api_url_file: "/etc/alertmanager/secrets/alertmanager-discord-webhook/url-high"
        channel: "#alerts-high"
        send_resolved: true
        title: '{{ .CommonLabels.alertname }}'
        text: >-
          {{ range .Alerts }}
          *Severity*: {{ .Labels.severity }}
          *Description*: {{ .Annotations.description }}
          {{ end }}
  - name: "discord-low"
    slack_configs:
      - api_url_file: "/etc/alertmanager/secrets/alertmanager-discord-webhook/url-low"
        channel: "#alerts-low"
        send_resolved: true
        title: '{{ .CommonLabels.alertname }}'
        text: >-
          {{ range .Alerts }}
          *Severity*: {{ .Labels.severity }}
          *Description*: {{ .Annotations.description }}
          {{ end }}

route:
  receiver: "discord-low"
  routes:
    - match:
        severity: critical
      receiver: "discord-high"
    - match:
        severity: warning
      receiver: "discord-low"
```

`api_url_file`이 핵심입니다. URL을 config에 직접 넣지 않고, Secret에서 마운트한 파일 경로를 참조합니다. 이렇게 하면 webhook URL이 Git에 노출되지 않습니다.

### ExternalSecret 설정

```yaml
# alertmanager-discord-externalsecret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: alertmanager-discord-webhook
  namespace: monitoring
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-parameter-store
    kind: ClusterSecretStore
  target:
    name: alertmanager-discord-webhook
  data:
    - secretKey: url-high
      remoteRef:
        key: /prod/monitoring/DISCORD_WEBHOOK_URL_HIGH
    - secretKey: url-low
      remoteRef:
        key: /prod/monitoring/DISCORD_WEBHOOK_URL_LOW
```

SSM Parameter Store에서 `DISCORD_WEBHOOK_URL_HIGH`와 `DISCORD_WEBHOOK_URL_LOW`를 읽어서 K8s Secret의 `url-high`, `url-low` 키로 매핑합니다.

3개 레포에 PR을 올리고 머지했습니다. 그리고 여기서부터 3연속 장애가 시작됐습니다.

---

## 🔥 장애 1: Secret이 없어서 Pod이 안 뜬다

### 증상

Alertmanager Pod가 `3/3 Running`이 되지 않고 `Pending` 상태에 머물렀습니다.

```bash
$ kubectl describe pod alertmanager-kube-prometheus-stack-alertmanager-0 -n monitoring
```

```
Events:
  Warning  FailedMount  39s (x11 over 6m51s)  kubelet
    MountVolume.SetUp failed for volume "secret-alertmanager-discord-webhook" :
    secret "alertmanager-discord-webhook" not found
```

`alertmanager-discord-webhook` Secret을 마운트하려는데, **Secret 자체가 존재하지 않는다**는 에러였습니다.

뭐지? 분명 ExternalSecret도 같이 배포했는데?

### 🤔 원인: 배포 순서 역전

확인해봤더니 문제는 간단했습니다.

```bash
$ kubectl get secret alertmanager-discord-webhook -n monitoring
Error from server (NotFound): secrets "alertmanager-discord-webhook" not found
```

Secret이 진짜 없었습니다. 원인은 **배포 순서 역전**이었습니다. 실제 발생한 순서는 다음과 같습니다

1. Goti-monitoring PR 머지 → ArgoCD가 Alertmanager config 먼저 sync
2. Alertmanager가 Secret 마운트 시도 → Secret 없음 → FailedMount
3. Goti-k8s PR 머지 → ExternalSecret 배포 (아직 안 됨)
4. Terraform apply → SSM 파라미터 생성 (아직 안 됨)

정상적인 순서는 Terraform → Goti-k8s → Goti-monitoring인데, 3개 레포에 거의 동시에 PR을 올리다 보니 **Goti-monitoring이 가장 먼저 sync**되어 버렸습니다.

### ✅ 해결

Secret이 생성된 후 Pod를 재시작했습니다.

```bash
# Secret 존재 확인
$ kubectl get secret alertmanager-discord-webhook -n monitoring
NAME                              TYPE     DATA   AGE
alertmanager-discord-webhook      Opaque   2      30s

# Pod 재시작 (StatefulSet이 새 Pod 생성)
$ kubectl delete pod alertmanager-kube-prometheus-stack-alertmanager-0 -n monitoring
pod "alertmanager-kube-prometheus-stack-alertmanager-0" deleted

# 재시작 후 확인
$ kubectl get pod alertmanager-kube-prometheus-stack-alertmanager-0 -n monitoring
NAME                                                  READY   STATUS    RESTARTS   AGE
alertmanager-kube-prometheus-stack-alertmanager-0      3/3     Running   0          45s
```

3/3 Running 확인. 하지만 아직 끝이 아니었습니다.

### 재발 방지

**배포 순서를 문서화**했습니다. 3개 레포에 걸친 변경은 반드시 아래 순서를 지켜야 합니다

1. Terraform apply (SSM 파라미터 생성)
2. Goti-k8s 배포 (ExternalSecret → Secret 생성)
3. Goti-monitoring 배포 (Alertmanager config 적용)

이 순서가 중요한 이유는 **각 단계의 출력이 다음 단계의 입력**이기 때문입니다.

---

## 🔥 장애 2: ESO가 SSM을 못 읽는다

### 증상

장애 1을 해결하려고 ExternalSecret 상태를 확인했더니, 여기서도 에러가 나고 있었습니다.

```bash
$ kubectl describe externalsecret alertmanager-discord-webhook -n monitoring
```

```
Events:
  Warning  UpdateFailed  67s (x9 over 5m22s)  external-secrets
    error processing spec.data[0] (key: /prod/monitoring/DISCORD_WEBHOOK_URL_HIGH),
    err: Secret does not exist
```

ExternalSecret이 SSM에서 파라미터를 못 읽는 것입니다. Terraform apply는 분명 완료했는데 말입니다.

### 🤔 원인 분석

첫 번째 가설: **IAM 권한 부족?**

```bash
$ kubectl get clustersecretstore aws-parameter-store -o jsonpath='{.spec.provider.aws.auth}'
```

ESO가 사용하는 IAM role의 policy를 확인했습니다. `arn:aws:ssm:...parameter/prod/*` 와일드카드로 설정되어 있어서 **권한 문제는 아니었습니다**.

두 번째 가설: **ESO 캐시?**

아! Terraform apply 직후라 SSM에 파라미터가 존재하는 건 확실합니다. 하지만 ESO는 `refreshInterval`에 따라 **주기적으로 polling**하는 구조입니다.

```yaml
spec:
  refreshInterval: 1h  # ← 1시간마다 polling
```

ESO가 마지막으로 polling했을 때는 SSM 파라미터가 **아직 없었습니다**. 그 "파라미터 없음" 상태를 캐시하고 있었던 것입니다. 다음 polling까지 최대 1시간을 기다려야 하는 상황이었습니다.

이것이 근본 원인입니다. **ESO는 외부 저장소의 실시간 상태가 아니라 캐시된 상태를 봅니다.**

### ✅ 해결: force-sync annotation

ESO에는 수동으로 즉시 동기화를 트리거하는 방법이 있습니다.

```bash
$ kubectl annotate externalsecret alertmanager-discord-webhook \
    -n monitoring \
    force-sync=$(date +%s) \
    --overwrite
externalsecret.external-secrets.io/alertmanager-discord-webhook annotated
```

`force-sync` annotation을 추가하면 ESO가 `refreshInterval`과 무관하게 **즉시 SSM을 다시 조회**합니다.

```bash
$ kubectl get externalsecret alertmanager-discord-webhook -n monitoring
NAME                              STORE                   REFRESH INTERVAL   STATUS
alertmanager-discord-webhook      aws-parameter-store     1h                 SecretSynced
```

`SecretSynced` 상태 확인. Secret이 정상 생성됐습니다.

### 재발 방지

**SSM 파라미터 신규 생성 후에는 반드시 ExternalSecret force-sync를 실행**하는 것을 운영 절차에 포함했습니다.

```bash
# SSM 파라미터 신규 생성 후 필수 실행
$ kubectl annotate externalsecret <name> -n <namespace> \
    force-sync=$(date +%s) --overwrite
```

`refreshInterval`이 1시간이면, 최악의 경우 Terraform apply 후 1시간 동안 Secret이 안 생길 수 있습니다. 이것은 아는 사람만 아는 함정입니다.

---

## 🔥 장애 3: ArgoCD가 sync를 거부한다

### 증상

장애 1, 2를 해결하고 나니 이번에는 ArgoCD가 문제였습니다. `monitoring-custom` Application의 sync가 실패하고 있었습니다.

```bash
$ kubectl get application monitoring-custom -n argocd -o jsonpath='{.status.conditions[*].message}'
```

```
Status: OutOfSync / Missing / Failed
Message: one or more synchronization tasks are not valid (retried 5 times).
Condition: ExternalSecret/grafana-admin-secret is part of applications
  argocd/monitoring-custom and external-secrets-config
```

`grafana-admin-secret`이 두 개의 ArgoCD Application에 동시에 속해 있다는 에러였습니다.

### 🤔 원인: 리소스 이중 관리

ArgoCD는 하나의 리소스가 **하나의 Application에만 속해야** 합니다. 같은 리소스를 두 Application이 관리하면 소유권 충돌로 sync를 거부합니다.

확인해봤습니다.

```bash
$ kubectl get externalsecret grafana-admin-secret -n monitoring \
    -o jsonpath='{.metadata.annotations}' | jq .
```

```json
{
  "argocd.argoproj.io/tracking-id": "external-secrets-config:external-secrets.io/ExternalSecret:monitoring/grafana-admin-secret"
}
```

`tracking-id`가 `external-secrets-config` Application을 가리키고 있었습니다. 그런데 `monitoring-custom` 차트에도 `grafana-admin-externalsecret.yaml` 템플릿이 있어서, **동일한 리소스를 두 곳에서 배포**하고 있었던 것입니다.

{/* TODO: Draw.io로 교체 (public/images/monitoring/argocd-resource-conflict.svg) */}
```
┌──────────────────────────────────────────────────────────────┐
│                   ArgoCD Resource Conflict                     │
│                                                               │
│  ┌─────────────────────┐    ┌──────────────────────────┐     │
│  │ monitoring-custom    │    │ external-secrets-config   │     │
│  │ Application          │    │ Application               │     │
│  │                      │    │                           │     │
│  │ charts/              │    │ infrastructure/prod/      │     │
│  │  goti-monitoring/    │    │  external-secrets/        │     │
│  │   templates/         │    │   config/                 │     │
│  │    grafana-admin-    │    │    grafana-admin-         │     │
│  │    externalsecret    │    │    externalsecret         │     │
│  │    .yaml             │    │    .yaml                  │     │
│  └──────────┬───────────┘    └─────────────┬────────────┘     │
│             │                               │                 │
│             │    ┌─────────────────────┐    │                 │
│             └───▶│ ExternalSecret/     │◀───┘                 │
│                  │ grafana-admin-secret│                      │
│                  │ (namespace:         │                      │
│                  │  monitoring)        │  ← 소유권 충돌!       │
│                  └─────────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

두 Application이 같은 ExternalSecret을 배포하려고 하니 ArgoCD가 **"이 리소스 누구 거야?"**라고 거부한 겁니다. 이건 Discord 알림과 직접 관련은 없지만, monitoring-custom sync가 막혀있어서 Alertmanager config 변경사항도 반영이 안 되는 상황이었습니다.

### ✅ 해결: 소유권을 한 곳으로 통합

`grafana-admin-secret`은 `external-secrets-config`에서 이미 관리하고 있었으니, `monitoring-custom` 차트에서 제외했습니다.

```yaml
# Goti-monitoring/charts/goti-monitoring/values-prod.yaml (변경 후)
grafanaAdminSecret:
  enabled: false  # ← external-secrets-config에서 관리하므로 비활성화
```

이 한 줄로 monitoring-custom 차트가 `grafana-admin-externalsecret.yaml` 템플릿을 렌더링하지 않게 됩니다.

```bash
$ git diff values-prod.yaml
```

```diff
 grafanaAdminSecret:
-  enabled: true
+  enabled: false
```

PR 머지 후 ArgoCD가 자동으로 재시도하면서 sync에 성공했습니다.

### 리소스 소유권 원칙

이 장애에서 얻은 교훈을 정리합니다.

**ArgoCD에서 리소스 소유권은 반드시 1:1이어야 합니다.** 하나의 리소스를 여러 Application이 관리하면 반드시 충돌이 발생합니다.

| 리소스 유형 | 관리 주체 | 원칙 |
|---|---|---|
| ExternalSecret | `external-secrets-config` Application | Goti-k8s 레포에서 통합 관리 |
| Alertmanager config | `monitoring-custom` Application | Goti-monitoring 레포에서 관리 |
| PrometheusRule | `monitoring-custom` Application | Goti-monitoring 레포에서 관리 |

ExternalSecret은 Goti-k8s(`external-secrets-config`)에서 통합 관리하는 것이 원칙입니다. Goti-monitoring 차트에 ExternalSecret 템플릿을 추가할 때는 **반드시 중복 여부를 확인**해야 합니다.

---

## ✅ 최종 결과

3연속 장애를 모두 해결한 후, 알림 테스트를 진행했습니다.

### amtool 테스트

```bash
# critical 알림 테스트
$ kubectl exec -n monitoring alertmanager-kube-prometheus-stack-alertmanager-0 -- \
    amtool alert add test-critical \
    severity=critical \
    description="Critical alert test" \
    --alertmanager.url=http://localhost:9093

# warning 알림 테스트
$ kubectl exec -n monitoring alertmanager-kube-prometheus-stack-alertmanager-0 -- \
    amtool alert add test-warning \
    severity=warning \
    description="Warning alert test" \
    --alertmanager.url=http://localhost:9093
```

Discord 양쪽 채널에서 알림 수신을 확인했습니다.

- `#alerts-high` 채널: critical 알림 수신 확인
- `#alerts-low` 채널: warning 알림 수신 확인

### 배포 순서 정립

이번 경험으로 3개 레포에 걸친 변경의 **올바른 배포 순서**를 확립했습니다.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────┐
│ 1. Terraform    │────▶│ 2. Goti-k8s     │────▶│ 3. Goti-monitoring  │
│                 │     │                 │     │                     │
│ SSM 파라미터    │     │ ExternalSecret  │     │ Alertmanager config │
│ 생성            │     │ → Secret 생성   │     │ Secret 마운트       │
│                 │     │                 │     │                     │
│ + force-sync    │     │                 │     │                     │
│   annotation    │     │                 │     │                     │
└─────────────────┘     └─────────────────┘     └─────────────────────┘
```

각 단계가 완료된 것을 확인한 후 다음 단계로 넘어가야 합니다. 특히 1단계 완료 후 `force-sync` annotation을 빼먹지 않는 것이 중요합니다.

---

## 📚 핵심 포인트

### 아키텍처 결정

- Discord `/slack` endpoint를 활용하면 Alertmanager `slack_configs`를 **그대로 재사용** 가능
- `api_url_file` 지시어로 webhook URL을 Secret 파일 마운트로 관리 → Git에 시크릿 노출 방지
- alerting 목적이면 plain text로 충분합니다. rich embed는 운영 복잡도 대비 효용이 낮습니다

### 배포 순서

- 3개 레포에 걸친 변경은 **의존성 순서를 반드시 지켜야** 함: Terraform → Goti-k8s → Goti-monitoring
- 동시에 PR을 올리면 ArgoCD가 어떤 순서로 sync할지 **예측 불가능**

### ExternalSecret 운영

- ESO는 `refreshInterval` 주기로 polling → 신규 파라미터 생성 후 **즉시 반영되지 않음**
- SSM 파라미터 신규 생성 후에는 `force-sync` annotation 필수

### ArgoCD 리소스 소유권

- **하나의 리소스는 하나의 Application만** 관리해야 함
- 같은 리소스를 여러 Application이 관리하면 sync 실패
- ExternalSecret은 전용 Application에서 통합 관리하는 것이 안전
