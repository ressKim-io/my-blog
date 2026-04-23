---
title: "Alertmanager Pod FailedMount — 3개 레포의 배포 순서 의존성"
excerpt: "Alertmanager Pod가 Pending 상태로 멈춘 이유는 참조하는 Secret이 아직 없어서였습니다. Terraform → ExternalSecret → Alertmanager config 3개 레포의 배포 순서가 역전된 결과였습니다."
category: monitoring
tags:
  - go-ti
  - Observability
  - Alertmanager
  - Prometheus
  - ExternalSecret
  - ArgoCD
  - troubleshooting
series:
  name: "goti-observability-ops"
  order: 14
date: "2026-03-31"
---

## 한 줄 요약

> Alertmanager Pod가 `Pending` 상태로 멈춰 있었습니다. 참조하는 Secret이 아직 생성되지 않은 상태에서 Alertmanager config가 먼저 배포된 것이 원인이었습니다. 3개 레포의 배포 순서 역전이 이 장애의 본질이었습니다.

---

## 🔥 문제: Alertmanager Pod가 3/3 Running이 되지 않는 상황

### 기대 동작

EKS prod 환경에서 Discord 알림을 구축하던 중이었습니다. 설정은 다음 흐름으로 이뤄지도록 설계되어 있었습니다.

- Terraform이 SSM Parameter Store에 Discord Webhook URL을 저장합니다.
- External Secrets Operator(ESO)가 SSM 값을 읽어 Kubernetes Secret을 생성합니다.
- Alertmanager가 `alertmanagerSpec.secrets`로 해당 Secret을 Pod에 마운트합니다.
- Alertmanager config는 마운트된 파일 경로를 읽어 Discord로 알림을 전송합니다.

정상 상태라면 Alertmanager Pod가 `3/3 Running`이어야 합니다.

### 발견한 문제

`kubectl get pod`로 상태를 확인했을 때 Alertmanager Pod가 `Pending` 상태로 멈춰 있었습니다. describe로 이벤트를 확인했습니다.

```text
Events:
  Warning  FailedMount  39s (x11 over 6m51s)  kubelet
    MountVolume.SetUp failed for volume "secret-alertmanager-discord-webhook" :
    secret "alertmanager-discord-webhook" not found
```

kubelet이 `alertmanager-discord-webhook`이라는 Secret을 찾아 볼륨을 마운트하려 했지만, 해당 Secret이 네임스페이스에 존재하지 않았습니다.

확인을 위해 Secret 존재 여부를 직접 조회했습니다.

```bash
$ kubectl get secret alertmanager-discord-webhook -n monitoring
Error from server (NotFound): secrets "alertmanager-discord-webhook" not found
```

Alertmanager가 참조하는 Secret 자체가 생성되지 않은 상태였습니다.

---

## 🤔 원인: 3개 레포의 배포 순서가 역전됐습니다

이 장애는 단순한 설정 오류가 아니라 **배포 순서 의존성**의 문제였습니다. Discord 알림 구축에는 3개 레포가 관여합니다.

- `Goti-Terraform`: SSM Parameter Store에 Webhook URL 등록
- `Goti-k8s`: ExternalSecret 리소스 정의 (SSM → Secret 변환)
- `Goti-monitoring`: Alertmanager config (Secret 마운트 참조)

정상 배포 순서는 아래와 같아야 합니다.

1. Terraform apply로 SSM 파라미터를 생성합니다.
2. Goti-k8s의 ExternalSecret이 SSM 파라미터를 읽어 Kubernetes Secret을 만듭니다.
3. Goti-monitoring의 Alertmanager config가 완성된 Secret을 Pod에 마운트합니다.

실제로는 이 순서가 역전됐습니다. Goti-monitoring의 PR이 먼저 머지되면서 ArgoCD가 Alertmanager config부터 동기화했고, 그 시점에 Secret은 아직 존재하지 않았습니다.

더 근본적으로는 `alertmanagerSpec.secrets: [alertmanager-discord-webhook]` 설정이 **존재하지 않는 리소스에 대한 하드 디펜던시**라는 점이 문제였습니다. Kubernetes는 Pod가 참조하는 볼륨이 준비될 때까지 Pod를 기동하지 않습니다. Secret이 나중에 생성되더라도 자동으로 마운트를 재시도하지 않습니다.

---

## ✅ 해결: Secret 생성 후 Pod를 재기동했습니다

### Step 1. ExternalSecret과 SSM 상태 확인

먼저 ExternalSecret이 정상적으로 Secret을 만들어낼 수 있는 상태인지 확인했습니다.

```bash
$ kubectl get externalsecret -n monitoring
NAME                           STATUS         READY   AGE
alertmanager-discord-webhook   SecretSynced   True    2m
```

이 시점에는 Terraform apply와 Goti-k8s 반영이 끝나 ExternalSecret이 `SecretSynced: True`가 된 상태였습니다. 즉 Kubernetes Secret도 이미 생성되어 있었습니다.

```bash
$ kubectl get secret alertmanager-discord-webhook -n monitoring
NAME                           TYPE     DATA   AGE
alertmanager-discord-webhook   Opaque   2      1m
```

### Step 2. Alertmanager Pod 재기동

Secret은 이미 만들어졌지만 Pod는 여전히 `Pending` 상태였습니다. kubelet이 최초 마운트 실패 후 재시도 간격을 늘려가며 대기하고 있었고, Pod를 지워 StatefulSet이 새 Pod를 만들게 해야 했습니다.

```bash
$ kubectl delete pod alertmanager-kube-prometheus-stack-alertmanager-0 -n monitoring
pod "alertmanager-kube-prometheus-stack-alertmanager-0" deleted
```

StatefulSet이 새 Pod를 생성했고, 이번에는 Secret이 존재했기 때문에 마운트에 성공했습니다.

```bash
$ kubectl get pod -n monitoring -l app.kubernetes.io/name=alertmanager
NAME                                                READY   STATUS    RESTARTS   AGE
alertmanager-kube-prometheus-stack-alertmanager-0   2/2     Running   0          45s
```

### Step 3. Discord 알림 동작 검증

`amtool`로 테스트 알림을 발송해 Discord 양쪽 채널에서 수신되는지 확인했습니다.

```bash
$ amtool alert add alertname="Test" severity="critical" \
    --alertmanager.url=http://localhost:9093
```

Discord critical 채널과 warning 채널 양쪽에서 알림이 들어왔습니다.

### 재발 방지: 배포 순서 문서화

해결 과정에서 얻은 결론은 **배포 순서를 문서화하고 강제**해야 한다는 것이었습니다.

- Terraform(SSM) → Goti-k8s(ExternalSecret) → Goti-monitoring(Alertmanager) 순서를 운영 문서에 명시했습니다.
- Discord 알림 같은 신규 Secret 마운트를 추가할 때는 PR 머지 전에 선행 레포 배포 완료 여부를 체크리스트에 포함시켰습니다.

---

## 📚 배운 점

- **Secret 마운트는 하드 디펜던시입니다**: `alertmanagerSpec.secrets`에 적힌 Secret이 없으면 Pod는 기동조차 하지 못합니다. ConfigMap이나 값 참조처럼 런타임 실패로 끝나지 않고 Pod가 `Pending`으로 멈춥니다.

- **kubelet은 Secret 생성을 자동 감지하지 않습니다**: 최초 마운트가 실패하면 kubelet이 재시도하긴 하지만 간격이 빠르지 않습니다. Secret이 나중에 생겼다면 Pod 재기동으로 강제로 마운트를 다시 시도시키는 것이 가장 빠릅니다.

- **다중 레포 구성에서는 배포 순서가 코드만큼 중요합니다**: 같은 장애를 ESO 캐시(장애 2)와 ArgoCD 리소스 이중 관리(장애 3) 형태로 연쇄적으로 겪었습니다. 3개 레포에 분산된 선언적 리소스가 서로를 참조할 때는 의존성 방향을 명시적으로 고정해야 합니다.

- **운영 체크리스트는 문서가 아니라 절차여야 합니다**: 이번 장애 이후 "새 Secret을 마운트하는 PR은 선행 레포 배포 완료 후 머지" 규칙을 팀 내 릴리스 체크리스트에 넣었습니다. 개인 기억에 의존하지 않도록 구조화된 절차로 남겨야 재발을 막을 수 있습니다.

- **`kubectl describe pod`의 Events 섹션이 가장 빠른 진단 경로입니다**: Pod 상태가 `Pending`일 때 로그는 아무것도 말해주지 않습니다. Events가 마운트 실패, 스케줄링 실패, 이미지 풀 실패 중 어느 것인지 즉시 알려줍니다.
