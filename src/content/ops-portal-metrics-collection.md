---
title: "ops-portal 메트릭이 모두 0인 이유: Prometheus Route Prefix"
excerpt: "Prometheus의 --web.route-prefix 설정이 API endpoint 경로를 변경하는 문제와 ArgoCD 토큰 설정 방법"
category: monitoring
tags:
  - Prometheus
  - ArgoCD
  - Monitoring
  - Troubleshooting
series:
  name: "observability"
  order: 2
date: '2026-01-06'
---

## 한 줄 요약

> Prometheus에 `--web.route-prefix`가 설정되어 있으면 API endpoint 경로가 변경된다. `/api/v1/query`가 아니라 `/prefix/api/v1/query`로 호출해야 한다.

## Impact

- **영향 범위**: ops-portal Monitoring 페이지
- **증상**: 모든 메트릭 0 표시
- **소요 시간**: 약 3시간
- **발생일**: 2026-01-06

---

## 🔥 증상: 메트릭이 모두 0

### API 응답

```json
// GET /api/monitoring/metrics/overview
{
  "success": true,
  "data": {
    "totalRequests": 0,
    "avgResponseTime": 0,
    "errorPercentage": 0,
    "activeServices": 0
  }
}

// GET /api/monitoring/applications
{
  "success": true,
  "data": []
}
```

API는 200 OK를 반환하지만 데이터가 비어있습니다.

---

## 🤔 원인 1: Prometheus Route Prefix

### Prometheus 설정 확인

```yaml
# Prometheus Deployment args
- --web.route-prefix=/api/monitoring/prometheus
- --web.external-url=https://api.wealist.co.kr/api/monitoring/prometheus
```

### 경로 변경

| 설정 | API Endpoint |
|------|-------------|
| route-prefix 없음 | `/api/v1/query` |
| route-prefix 있음 | `/api/monitoring/prometheus/api/v1/query` |

### 테스트

```bash
# 404 반환 (잘못된 경로)
kubectl run prom-test --rm -it --restart=Never --image=curlimages/curl -n wealist-prod -- \
  curl -s "http://prometheus.wealist-prod.svc.cluster.local:9090/api/v1/query?query=up"
# {"status":"error","error":"404 page not found"}

# 정상 응답 (올바른 경로)
kubectl run prom-test --rm -it --restart=Never --image=curlimages/curl -n wealist-prod -- \
  curl -s "http://prometheus.wealist-prod.svc.cluster.local:9090/api/monitoring/prometheus/api/v1/query?query=up"
# {"status":"success","data":{...}}
```

### 해결

ArgoCD Application에서 `PROMETHEUS_URL`에 route prefix 포함:

```yaml
# k8s/argocd/apps/prod/ops-service.yaml
parameters:
  - name: config.PROMETHEUS_URL
    value: "http://prometheus.wealist-prod.svc.cluster.local:9090/api/monitoring/prometheus"
```

---

## 🤔 원인 2: ArgoCD Token 미설정

### ops-service 로그

```
{"level":"warn","msg":"ArgoCD client not configured"}
{"level":"warn","msg":"ArgoCD configuration incomplete, ArgoCD features disabled"}
```

### 필요한 환경변수

| 변수 | 설명 | 예시 |
|------|------|------|
| `ARGOCD_SERVER_URL` | ArgoCD 서버 URL | `https://argocd.wealist.co.kr` |
| `ARGOCD_TOKEN` | ArgoCD API 토큰 | (AWS Secrets Manager) |
| `ARGOCD_INSECURE` | TLS 검증 비활성화 | `false` |

### ArgoCD 토큰 생성

```bash
# ArgoCD CLI로 토큰 생성
argocd account generate-token --account ops-service

# 또는 admin 비밀번호로 API 호출
kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath="{.data.password}" | base64 -d
```

### 해결 (ExternalSecret 사용)

```yaml
# ExternalSecret으로 ArgoCD 토큰 주입
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: ops-service-argocd
  namespace: wealist-prod
spec:
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: ops-service-argocd-token
  data:
    - secretKey: ARGOCD_TOKEN
      remoteRef:
        key: wealist/prod/ops-service
        property: argocd_token
```

---

## 🤔 원인 3: DB 마이그레이션 미실행

### 증상

```
# 500 Internal Server Error on:
GET /api/admin/audit-logs
GET /api/admin/config
```

### 해결

```yaml
# ArgoCD Application
parameters:
  - name: config.DB_AUTO_MIGRATE
    value: "true"
```

### GORM 제약조건 이름 불일치

PostgreSQL과 GORM이 생성하는 제약조건 이름이 다를 수 있습니다:

```sql
-- PostgreSQL 기본 이름
portal_users_email_key

-- GORM 예상 이름
uni_portal_users_email

-- 수동 수정
ALTER INDEX portal_users_email_key RENAME TO uni_portal_users_email;
```

---

## 체크리스트

ops-portal 메트릭이 표시되지 않을 때:

- [ ] Prometheus route prefix 확인 (`--web.route-prefix` 설정 여부)
- [ ] `PROMETHEUS_URL`에 route prefix 포함 여부
- [ ] ArgoCD 토큰 설정 여부 (`ARGOCD_TOKEN`)
- [ ] DB 마이그레이션 실행 여부 (`DB_AUTO_MIGRATE=true`)
- [ ] ops-service 로그에서 에러/경고 확인

```bash
kubectl logs deploy/ops-service -n wealist-prod --tail=100 | grep -E "(error|warn|Error|Warn)"
```

---

## 📚 배운 점

### Prometheus route-prefix의 영향

`--web.route-prefix`는 Prometheus의 모든 HTTP 경로에 prefix를 추가합니다:

| 경로 | 기본 | route-prefix=/monitoring |
|------|------|--------------------------|
| Query API | `/api/v1/query` | `/monitoring/api/v1/query` |
| Targets | `/-/healthy` | `/monitoring/-/healthy` |
| UI | `/graph` | `/monitoring/graph` |

이 설정은 보통 **리버스 프록시 뒤에서 Prometheus를 노출**할 때 사용합니다.

### 클라이언트 설정 주의사항

Prometheus 클라이언트 라이브러리를 사용할 때 URL 설정:

```go
// ❌ 잘못된 설정
prometheusURL := "http://prometheus:9090"

// ✅ 올바른 설정 (route-prefix 포함)
prometheusURL := "http://prometheus:9090/api/monitoring/prometheus"
```

---

## 요약

| 문제 | 원인 | 해결 |
|------|------|------|
| 메트릭 모두 0 | route-prefix 누락 | `PROMETHEUS_URL`에 prefix 포함 |
| ArgoCD 앱 목록 없음 | 토큰 미설정 | ExternalSecret으로 토큰 주입 |
| audit-logs 500 에러 | DB 테이블 없음 | `DB_AUTO_MIGRATE=true` |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `k8s/argocd/apps/prod/ops-service.yaml` | ops-service 환경변수 설정 |
| `services/ops-service/internal/config/config.go` | 설정 로딩 로직 |
| `services/ops-service/internal/client/prometheus_client.go` | Prometheus API 클라이언트 |
| `services/ops-service/internal/client/argocd_client.go` | ArgoCD API 클라이언트 |

---

## 참고

- [Prometheus Configuration - web.route-prefix](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#command-line-flags)
- [ArgoCD API Authentication](https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/)
