# Production 트러블슈팅 V11 - ops-portal 메트릭 수집 실패 (2026-01-06)

## 개요

이 문서는 ops-portal에서 Prometheus/ArgoCD 메트릭이 모두 0으로 표시되는 문제와 해결 방법을 다룹니다.

---

## 1. 문제 현상

### 1.1 증상

- ops-portal의 Monitoring 페이지에서 모든 메트릭이 0으로 표시
- API는 200 OK를 반환하지만 데이터가 비어있음
- ArgoCD Applications: 0개
- Service Metrics: 모두 0

### 1.2 API 응답 예시

```json
// GET /api/monitoring/metrics/overview
{"success":true,"data":{"totalRequests":0,"avgResponseTime":0,"errorPercentage":0,"activeServices":0}}

// GET /api/monitoring/applications
{"success":true,"data":[]}
```

---

## 2. 원인 1: Prometheus Route Prefix

### 2.1 문제

Prometheus가 `--web.route-prefix`로 설정되어 있으면, API endpoint 경로가 변경됨.

```yaml
# Prometheus Deployment args
- --web.route-prefix=/api/monitoring/prometheus
- --web.external-url=https://api.wealist.co.kr/api/monitoring/prometheus
```

### 2.2 결과

| 설정 | API Endpoint |
|------|-------------|
| route-prefix 없음 | `/api/v1/query` |
| route-prefix 있음 | `/api/monitoring/prometheus/api/v1/query` |

### 2.3 테스트 방법

```bash
# 404 반환 (잘못된 경로)
kubectl run prom-test --rm -it --restart=Never --image=curlimages/curl -n wealist-prod -- \
  curl -s "http://prometheus.wealist-prod.svc.cluster.local:9090/api/v1/query?query=up"

# 정상 응답 (올바른 경로)
kubectl run prom-test --rm -it --restart=Never --image=curlimages/curl -n wealist-prod -- \
  curl -s "http://prometheus.wealist-prod.svc.cluster.local:9090/api/monitoring/prometheus/api/v1/query?query=up"
```

### 2.4 해결 방법

ArgoCD Application에서 `PROMETHEUS_URL`에 route prefix 포함:

```yaml
# k8s/argocd/apps/prod/ops-service.yaml
parameters:
  - name: config.PROMETHEUS_URL
    value: "http://prometheus.wealist-prod.svc.cluster.local:9090/api/monitoring/prometheus"
```

---

## 3. 원인 2: ArgoCD Token 미설정

### 3.1 문제

ops-service가 ArgoCD API에 접근하려면 인증 토큰이 필요함.

```go
// cmd/api/main.go
if cfg.ArgoCD.ServerURL != "" && cfg.ArgoCD.Token != "" {
    argoCDClient = client.NewArgoCDClient(...)
} else {
    logger.Warn("ArgoCD configuration incomplete, ArgoCD features disabled")
}
```

### 3.2 증상

```
{"level":"warn","msg":"ArgoCD client not configured"}
```

### 3.3 필요한 환경변수

| 변수 | 설명 | 예시 |
|------|------|------|
| `ARGOCD_SERVER_URL` | ArgoCD 서버 URL | `https://argocd.wealist.co.kr` |
| `ARGOCD_TOKEN` | ArgoCD API 토큰 | (AWS Secrets Manager에서 관리) |
| `ARGOCD_INSECURE` | TLS 검증 비활성화 | `false` |

### 3.4 ArgoCD 토큰 생성 방법

```bash
# ArgoCD CLI로 토큰 생성
argocd account generate-token --account <account-name>

# 또는 Kubernetes Secret에서 admin 비밀번호 확인 후 API 호출
kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}" | base64 -d
```

### 3.5 해결 방법 (권장)

1. AWS Secrets Manager에 ArgoCD 토큰 저장
2. ExternalSecret으로 ops-service에 주입

```yaml
# ExternalSecret 설정 예시
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: ops-service-argocd
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

## 4. 원인 3: DB 마이그레이션 미실행

### 4.1 문제

ops-service의 일부 API는 PostgreSQL 테이블이 필요함.

### 4.2 증상

```
# 500 Internal Server Error on:
GET /api/admin/audit-logs
GET /api/admin/config
```

### 4.3 해결 방법

ArgoCD Application에서 auto-migration 활성화:

```yaml
parameters:
  - name: config.DB_AUTO_MIGRATE
    value: "true"
```

### 4.4 GORM 제약조건 이름 불일치

GORM이 생성한 제약조건과 PostgreSQL 기본 제약조건 이름이 다를 수 있음:

```sql
-- PostgreSQL 기본 이름
portal_users_email_key

-- GORM 예상 이름
uni_portal_users_email
```

수동 수정:
```sql
ALTER INDEX portal_users_email_key RENAME TO uni_portal_users_email;
```

---

## 5. 체크리스트

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

## 6. 관련 파일

| 파일 | 역할 |
|------|------|
| `k8s/argocd/apps/prod/ops-service.yaml` | ops-service 환경변수 설정 |
| `services/ops-service/internal/config/config.go` | 설정 로딩 로직 |
| `services/ops-service/internal/client/prometheus_client.go` | Prometheus API 클라이언트 |
| `services/ops-service/internal/client/argocd_client.go` | ArgoCD API 클라이언트 |
