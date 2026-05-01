---
title: "Tempo overrides.defaults 파싱 에러 — per_tenant_overrides로 우회"
excerpt: "Tempo chart v1.24.4에서 overrides.defaults에 값을 넣자 legacyConfig 파서가 거부해 CrashLoopBackOff에 빠졌습니다. per_tenant_overrides로 overrides.yaml을 분리해 우회한 과정을 정리합니다"
category: monitoring
tags:
  - go-ti
  - Observability
  - Tempo
  - Helm
  - ArgoCD
  - Troubleshooting
series:
  name: "goti-observability-ops"
  order: 5
date: "2026-03-24"
---

## 한 줄 요약

> Tempo monolithic OOM 안정화 작업 중, 트레이스 폭주 방어를 위해 `tempo.overrides.defaults`에 제한값을 넣자 `legacyConfig` 파서가 `field defaults not found` 에러로 거부했습니다. 같은 제한값을 `tempo.per_tenant_overrides`로 옮겨 별도 `overrides.yaml` ConfigMap에 렌더링되도록 했더니 정상 기동했습니다

## Impact

- **영향 범위**: Tempo 파드 전체가 CrashLoopBackOff에 진입해 트레이스 수집·조회 전부 중단
- **환경**: grafana/tempo chart v1.24.4 (appVersion 2.9.0), Kind, ArgoCD GitOps
- **발생일**: 2026-03-24

---

## 🔥 문제: overrides.defaults 한 줄에 Tempo 파드가 전부 죽었다

### 기존 상황

Tempo monolithic 모드가 트레이스 폭주로 OOMKilled를 115회 반복하고 있었습니다. 메모리·샘플링 조정 외에, 트레이스 단위 제한값을 `overrides`로 걸어 수집 단계에서 방어하려고 했습니다.

Tempo chart의 공식 values 스키마를 보면 `tempo.overrides.defaults` 하위에 `max_traces_per_user`, `max_bytes_per_trace` 등을 둘 수 있도록 되어 있었습니다. 그래서 아래와 같이 values를 추가했습니다.

```yaml
tempo:
  overrides:
    defaults:
      max_traces_per_user: 5000
      max_bytes_per_trace: 5000000
```

### 발견한 문제

ArgoCD sync 직후 Tempo 파드가 전부 CrashLoopBackOff로 진입했습니다. 컨테이너 로그에는 YAML 파싱 에러가 남았습니다.

```text
failed parsing config: failed to parse configFile /conf/tempo.yaml: yaml: unmarshal errors:
  line 48: field defaults not found in type overrides.legacyConfig
```

chart values 스키마에는 분명히 존재하는 `defaults` 키가, 정작 Tempo 바이너리의 config 파서에서는 "존재하지 않는 필드"로 거부되고 있었습니다.

---

## 🤔 원인: chart values 스키마와 Tempo 바이너리 config 스키마의 불일치

Tempo chart v1.24.4는 `tempo.yaml`을 `legacyConfig` 구조체로 파싱합니다. 이 구조체에는 `defaults` 필드가 정의돼 있지 않습니다.

반면 Helm chart의 values 스키마는 편의상 `overrides.defaults` 경로를 지원합니다. chart 템플릿이 values의 `overrides` 블록을 그대로 `tempo.yaml`에 렌더링하는데, Tempo 바이너리의 파서가 strict 모드로 해당 키를 읽으면서 터지는 구조입니다.

`defaults` 키를 빼고 flat 구조로 바꾸는 우회도 시도했지만 실패했습니다.

```yaml
tempo:
  overrides:
    max_traces_per_user: 5000
    max_bytes_per_trace: 5000000
```

이 경우 chart가 기본값으로 `defaults: {}`를 자동 주입하면서, 그 옆에 놓인 `max_traces_per_user` 같은 flat 키들 역시 `legacyConfig` 구조체에 없는 필드로 판정돼 동일한 에러가 재현됐습니다. `defaults: {}`(빈 맵)만 있을 때는 Go YAML 파서가 허용하지만, 다른 unknown 필드가 함께 있으면 strict 파싱이 트리거된다는 차이가 있었습니다.

정리하면 **chart values 스키마와 Tempo 바이너리 config 스키마가 버전별로 엇갈려 있는 것**이 근본 원인입니다. v2.x 이후 chart는 새 구조를 지원하지만, v1.x 계열은 legacyConfig에 묶여 있어 values에 있는 편의 키가 실제로는 무효합니다.

---

## ✅ 해결: per_tenant_overrides로 overrides.yaml 파일 분리

Tempo chart는 `tempo.per_tenant_overrides` 키를 별도 경로로 지원합니다. 이 값은 `tempo.yaml`이 아니라 별도의 `overrides.yaml` ConfigMap으로 렌더링되므로, `tempo.yaml`의 `overrides` 섹션은 chart 기본값(`defaults: {}` + `per_tenant_override_config`)만 유지됩니다. 덕분에 legacyConfig 파서가 거부할 키가 남지 않습니다.

```yaml
tempo:
  per_tenant_overrides:
    "single-tenant":
      max_traces_per_user: 5000
      max_bytes_per_trace: 5000000
      ingestion_rate_limit_bytes: 15000000
      ingestion_burst_size_bytes: 20000000
```

주의할 점은 위치입니다. `per_tenant_overrides`는 반드시 `tempo:` 하위에 두어야 합니다. 최상위에 놓으면 chart가 무시해서 `overrides.yaml`이 빈 파일로 렌더링됩니다.

### 부수 이슈: CrashLoopBackOff 상태에서는 새 ConfigMap이 반영되지 않았다

ArgoCD sync로 ConfigMap은 업데이트됐지만, 이미 CrashLoopBackOff 상태인 파드는 볼륨이 다시 마운트되지 않아 새 ConfigMap을 읽지 못했습니다. kubelet이 파드 컨테이너를 재시작해도, 컨테이너가 기동 직전에 죽어버리면 projected volume이 최신 값으로 다시 동기화되지 않는 경우가 있었습니다.

파드를 강제로 지워서 새로 스케줄링되도록 하자 최신 ConfigMap이 반영됐습니다.

```bash
$ kubectl delete pod -n monitoring -l app.kubernetes.io/name=tempo
```

### 적용한 수정 요약

1. `tempo.overrides.defaults` 제거 — `tempo.yaml`의 overrides 섹션을 chart 기본값으로 되돌렸습니다.
2. 같은 제한값을 `tempo.per_tenant_overrides` 아래 `"single-tenant"` 키로 이동했습니다.
3. ArgoCD sync 후 `kubectl delete pod`로 파드를 재생성해 새 ConfigMap을 확실히 적용했습니다.

### 정상 기동 확인

Tempo 로그에서 정상 기동 메시지가 확인됐습니다.

```text
level=info msg="Tempo started"
level=info msg="completing block" tenant=single-tenant
```

렌더링된 `overrides.yaml` ConfigMap 내용도 기대한 값과 일치했습니다.

```yaml
overrides:
  single-tenant:
    ingestion_burst_size_bytes: 20000000
    ingestion_rate_limit_bytes: 15000000
    max_bytes_per_trace: 5000000
    max_traces_per_user: 5000
```

---

## 📚 배운 점

- **chart values 스키마는 바이너리 config 스키마와 동일하지 않습니다**. Helm values에 키가 있다고 해서 런타임 파서가 받아준다는 보장은 없습니다. chart 버전과 appVersion을 함께 보고, 필요하면 렌더링된 ConfigMap을 직접 확인해야 합니다.
- **Tempo chart v1.x에서 tenant별 제한값은 `per_tenant_overrides`로 거는 것이 기본 경로입니다**. `overrides.defaults`는 v2.x 이상에서 재검토합니다.
- **CrashLoopBackOff 상태에서는 ConfigMap 업데이트가 파드에 즉시 반영되지 않는 경우가 있습니다**. sync 후에도 파드가 계속 죽는다면 `kubectl delete pod`로 강제 재스케줄링을 시도합니다.
- **strict YAML 파서는 빈 맵 하나에 민감합니다**. `defaults: {}` 단독일 때는 통과하다가 다른 unknown 키가 붙는 순간 터지는 패턴은 재현 난도가 높으므로, unknown 필드 경고를 항상 의심합니다.
- **재발 방지 체크리스트에 등록**: "Tempo chart v1.x에서 `overrides.defaults` 사용 금지, `per_tenant_overrides` 사용"을 monitoring rule에 고정해, 같은 경로로 다시 들어가지 않도록 했습니다.
