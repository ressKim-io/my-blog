---
date: 2026-03-24
category: troubleshoot
project: Goti-monitoring
tags: [tempo, helm, legacyConfig, overrides, chart-v1.x, argocd]
---

# Tempo chart v1.x legacyConfig에서 overrides.defaults 파싱 에러 — per_tenant_overrides로 우회

## Context

Tempo monolithic mode OOM 반복(115회 재시작) 안정화 작업 중, 트레이스 폭주 방어를 위해 overrides 제한값 적용 시도. Tempo chart: grafana/tempo v1.24.4 (appVersion 2.9.0), ArgoCD GitOps, Kind 환경.

## Issue

```
failed parsing config: failed to parse configFile /conf/tempo.yaml: yaml: unmarshal errors:
  line 48: field defaults not found in type overrides.legacyConfig
```

Tempo values에 `tempo.overrides.defaults` 키로 제한값을 설정하면 Tempo pod가 CrashLoopBackOff 진입.

재현 조건: tempo-values.yaml에 아래 설정 추가 후 ArgoCD sync

```yaml
tempo:
  overrides:
    defaults:
      max_traces_per_user: 5000
      max_bytes_per_trace: 5000000
```

## Action

### 가설 1: `defaults` 대신 flat 구조로 변경 → 실패

`tempo.overrides`에 `defaults` 없이 직접 키를 넣으면 legacyConfig가 수용할 것으로 예상.

```yaml
tempo:
  overrides:
    max_traces_per_user: 5000
    max_bytes_per_trace: 5000000
```

결과: chart가 기본값 `defaults: {}` 키를 자동 주입. 추가한 flat 키들(`max_traces_per_user` 등)도 legacyConfig struct에 없는 필드라 동일 에러 발생. `defaults: {}`(빈 맵)만 있을 때는 Go YAML 파서가 무시하지만, 다른 unknown 필드가 함께 있으면 strict 파싱이 트리거됨.

### 가설 2: `per_tenant_overrides`로 overrides.yaml에 직접 설정 → 성공

chart의 `tempo.per_tenant_overrides` 키를 사용하면 `tempo.yaml`이 아닌 별도 `overrides.yaml` ConfigMap에 값이 렌더링됨. `tempo.yaml`의 `overrides` 섹션은 기본값(`defaults: {}` + `per_tenant_override_config`)만 유지되어 파싱 에러 회피.

```yaml
tempo:
  per_tenant_overrides:
    "single-tenant":
      max_traces_per_user: 5000
      max_bytes_per_trace: 5000000
      ingestion_rate_limit_bytes: 15000000
      ingestion_burst_size_bytes: 20000000
```

**주의**: `per_tenant_overrides`는 반드시 `tempo:` 하위에 위치해야 함. 최상위에 놓으면 chart가 무시하여 overrides.yaml이 비어있게 렌더링됨.

### 부수 이슈: CrashLoopBackOff 중 ConfigMap 업데이트 미반영

ArgoCD sync로 ConfigMap이 업데이트되었지만, CrashLoopBackOff 상태의 pod가 새 ConfigMap을 읽지 못하는 현상 발생. `kubectl delete pod`로 강제 재생성해야 최신 ConfigMap 반영됨.

### 근본 원인 (Root Cause)

Tempo chart v1.24.4는 `legacyConfig` 구조체를 사용하여 `tempo.yaml`을 파싱함. 이 구조체에는 `defaults` 필드가 존재하지 않음. chart의 Helm values는 `overrides.defaults` 키를 지원하지만, 실제 Tempo 바이너리의 legacyConfig 파서가 거부함. **chart values 스키마와 Tempo 바이너리 config 스키마 불일치** 문제.

### 적용한 수정

1. `tempo.overrides.defaults` 제거 — `tempo.yaml`의 overrides 섹션을 chart 기본값으로 복원
2. `tempo.per_tenant_overrides`에 `single-tenant` 키로 제한값 설정 — `overrides.yaml` ConfigMap에 렌더링
3. `kubectl delete pod`로 새 ConfigMap 적용 확인

## Result

Tempo 정상 기동 확인:
```
level=info msg="Tempo started"
level=info msg="completing block" tenant=single-tenant
```

overrides.yaml 반영 확인:
```yaml
overrides:
  single-tenant:
    ingestion_burst_size_bytes: 20000000
    ingestion_rate_limit_bytes: 15000000
    max_bytes_per_trace: 5000000
    max_traces_per_user: 5000
```

### 재발 방지

- monitoring.md rule에 기록: **Tempo chart v1.x에서 `overrides.defaults` 사용 금지, `per_tenant_overrides` 사용**
- chart v2.x 업그레이드 시 `defaults` 키 사용 가능 여부 재검토

## Related Files

- `Goti-monitoring/values-stacks/dev/tempo-values.yaml` — per_tenant_overrides 추가
- `Goti-monitoring/values-stacks/dev/alloy-values.yaml` — Tempo exporter retry 강화 (같은 작업)
- `goti-team-controller/.claude/rules/monitoring.md` — pitfalls 체크리스트 업데이트 대상
