---
title: "kind-dev 합성 트래픽 활성화 + 대시보드 panel 일괄 검증"
excerpt: "k6 합성 트래픽을 kind에 흘리니 setup이 500→401→503→404 다른 에러로 떨어졌습니다. JWT viper prefix mismatch부터 Istio AuthorizationPolicy namespace 누락까지 5단계 가설-검증으로 풀어낸 과정과 625개 PromQL 쿼리 일괄 검증 결과를 기록합니다"
type: troubleshooting
category: monitoring
tags:
  - go-ti
  - SyntheticTraffic
  - k6
  - JWT
  - Istio
  - dashboard
  - troubleshooting
series:
  name: "goti-kind-dev-bootstrap"
  order: 4
date: "2026-04-25"
---

## 한 줄 요약

> k6 합성 트래픽 활성화 직후 setup이 500→401→503→404 순서로 다른 에러를 토했습니다. JWT viper prefix mismatch와 Istio AuthorizationPolicy namespace 누락이 맞물린 복합 장애였으며, 5단계 가설-검증으로 해소한 뒤 625개 PromQL 쿼리를 일괄 검증해 우선순위 작업 목록을 정리했습니다

---

## 🔥 목표: 모니터링 시연용 상시 트래픽 확보

### 배경

Istio Gateway 트리아지를 완료한 직후 세션입니다. 모니터링 시연과 영상 촬영을 위해 `kind-goti-dev-v2` 클러스터(K8s 1.34.3)에 끊김 없는 합성 트래픽을 흘리는 것이 목표였습니다.

`Goti-k8s/charts/synthetic-traffic` chart는 k6 기반 CronJob으로 이미 구현되어 있었습니다. `environments/dev/synthetic-traffic/values.yaml`에서 `enabled: false`만 바꾸면 됐습니다.

### values 변경 내역

| 항목 | 변경 전 | 변경 후 | 이유 |
|------|---------|---------|------|
| `enabled` | `false` | `true` | 활성화 |
| `k6.vus` | `100` | `10` | kind-dev 자원 보호 |
| `k6.duration` | `"4m"` | `"4m30s"` | `*/5` 스케줄과 갭을 30초로 줄여 거의 상시 트래픽 유지 |

활성화 직후 k6 setup 함수가 연속으로 다른 에러 코드를 토했습니다. 단일 장애가 아니라 **하나를 고칠 때마다 다음 장애가 드러나는 연쇄 구조**였습니다.

---

## 🤔 5단계 디버깅 — 500 → 401 → 503 → 404

### Step 1 — HTTP 500: Go 앱이 JWT 발급 실패

```text
ERROR creating test user token: RSA private key not configured
```

k6 setup 함수는 테스트용 유저 토큰을 발급받습니다. 이 요청이 goti-user 서비스에서 500으로 떨어졌습니다.

**원인**: `pkg/config/config.go`의 viper가 `SetEnvPrefix("USER")` 설정에 따라 `USER_JWT_PRIVATE_KEY_PEM`을 기대했지만, K8s Secret은 `envFrom` 방식으로 통째로 주입되어 있었고 키 이름이 prefix 없는 `JWT_PRIVATE_KEY_PEM`이었습니다.

Spring Boot 시절 secret 컨벤션을 Go 마이그레이션 이후에도 그대로 유지했던 것이 root cause였습니다. viper의 `SetEnvPrefix`와 `envFrom` 주입 방식이 충돌한 것입니다.

**수정**: `environments/dev/goti-user/values.yaml`의 `env` 섹션에 `valueFrom.secretKeyRef`로 `USER_JWT_PRIVATE_KEY_PEM`과 `USER_JWT_PUBLIC_KEY_PEM`을 명시 매핑했습니다.

```yaml
# environments/dev/goti-user/values.yaml
env:
  - name: USER_JWT_PRIVATE_KEY_PEM
    valueFrom:
      secretKeyRef:
        name: goti-jwt-secret
        key: JWT_PRIVATE_KEY_PEM
  - name: USER_JWT_PUBLIC_KEY_PEM
    valueFrom:
      secretKeyRef:
        name: goti-jwt-secret
        key: JWT_PUBLIC_KEY_PEM
```

관련 commit: `Goti-k8s@e119d0b` — `fix(dev): JWT secret env에 service prefix 명시 매핑`

---

### Step 2 — HTTP 401: istiod가 JWKS fetch 실패

```text
istiod: Failed to GET .../.well-known/jwks.json: read: connection reset by peer
istiod: The JWKS key is not yet fetched ... using a fake JWKS for now
```

유저 서비스가 토큰을 발급했지만, istiod가 JWKS를 가져오지 못해 JWT 검증에 "가짜 JWKS"를 사용 중이었습니다.

**원인**: mesh-wide STRICT mTLS(`istio-system/default` PeerAuthentication)가 살아있는 상태에서, goti 네임스페이스의 PERMISSIVE PeerAuthentication이 `istio-system`에 잘못 배포되어 있었습니다.

`goti-policy` chart의 `peer-auth-prometheus-ports.yaml` template에 `metadata.namespace` 필드가 누락되어 있었고, helm이 release namespace인 `istio-system`에 리소스를 생성했습니다. istiod는 사이드카 없이 plaintext로 JWKS endpoint에 접근하는데, goti Pod의 STRICT mTLS 정책이 이를 거부했습니다.

**수정**: `peer-auth-prometheus-ports.yaml` template에 `metadata.namespace: goti`를 명시했습니다.

관련 commit: `Goti-k8s@bae704f` — `fix(istio): goti-policy AP/PeerAuth 누락 namespace=goti 명시`

---

### Step 3 — 여전히 401 (PeerAuth 통과 후 RBAC 403): istiod JWKS 요청이 AuthorizationPolicy에 막힘

```text
istiod: Failed to GET .../.well-known/jwks.json: status 403, message "RBAC: access denied"
```

PeerAuth 문제를 수정했지만 403이 새로 나타났습니다.

**원인**: goti Pod에는 `from-ingress-gateway`, `from-mesh-internal`, `require-jwt` 세 개의 AuthorizationPolicy가 적용되어 있습니다. istiod의 JWKS fetch 요청은 source principal(namespace/service account) 식별이 불가한 plaintext 요청이므로, 어느 allowlist에도 매칭되지 않아 implicit deny가 발생했습니다.

`goti-policy` chart에는 `/.well-known/jwks.json` 경로를 `from` 절 없이 ALLOW하는 `allow-istiod-jwks.yaml` template이 있었습니다. 그러나 이 AP 역시 같은 namespace 누락 버그로 `istio-system`에 배포되어 있었고, Istio Gateway 트리아지 1차 수정 시 디버깅 편의를 위해 `allowIstiodJwks.enabled: false`로 꺼둔 상태였습니다.

**수정**: `allow-istiod-jwks.yaml` template에 `namespace: goti`를 명시하고, `values-dev.yaml`의 `allowIstiodJwks.enabled`를 `true`로 되돌렸습니다.

---

### Step 4 — HTTP 503: ticketing app panic — `JWT public key not configured`

```text
ticketing logs: WARN JWT public key not configured: failed to decode PEM block
ticketing logs: panic: nil pointer dereference at pkg/middleware/error_handler.go:19
```

setup이 토큰을 받아 ticketing 서비스를 호출하자 panic이 발생했습니다.

**원인**: Step 1과 동일한 viper prefix 문제가 ticketing, payment, queue, resale, stadium 5개 서비스에도 동일하게 존재했습니다. 이 서비스들은 JWT를 발급하지 않고 검증만 하므로 public key만 필요하지만, `{SVC}_JWT_PUBLIC_KEY_PEM` 형식의 env 이름으로 주입되지 않아 nil pointer를 참조했습니다.

**수정**: 5개 서비스의 `values.yaml`에 각각 `{SVC}_JWT_PUBLIC_KEY_PEM`을 `valueFrom.secretKeyRef`로 명시 매핑했습니다.

```yaml
# 예시: environments/dev/goti-ticketing/values.yaml
env:
  - name: TICKETING_JWT_PUBLIC_KEY_PEM
    valueFrom:
      secretKeyRef:
        name: goti-jwt-secret
        key: JWT_PUBLIC_KEY_PEM
```

---

### Step 5 — HTTP 404: k6 스크립트 일부 경로가 실제 API에 없음

setup 자체는 성공(`gameId`, `sectionIds`, `teams` 추출 완료)했습니다. 그러나 default 함수의 일부 GET path가 현재 라우팅에 없는 prefix를 사용하거나 잘못된 파라미터 형식(`INVALID_FORMAT`)을 전달했습니다.

시연 메트릭 발생에는 무관한 수준의 에러였습니다. 스크립트 path 수정은 별도 이슈로 관리합니다.

---

## ✅ 상시 트래픽 활성화 결과

5단계를 해소한 뒤 상시 트래픽이 정상 동작을 확인했습니다.

```bash
$ kubectl -n goti get cronjob synthetic-traffic
NAME                SCHEDULE      ACTIVE   LAST SCHEDULE   AGE
synthetic-traffic   */5 * * * *   1        ...             ...

$ kubectl -n goti logs <synthetic-traffic-pod> -c k6 | grep setup
INFO setup: gameId=15000734-..., stadiumId=4553f1c7-..., sections=60, teams=5
```

10 VUs가 ticketing, stadium, resale, payment, user 5개 서비스에 sleep 2~5초 사이로 GET/POST를 분산합니다. 스케줄 `*/5 * * * *`에 duration `4m30s`를 조합해 인접 실행 간 30초 갭으로 거의 상시 트래픽이 흐르는 구조입니다.

관련 commit: `Goti-k8s@e329018` — `feat(dev/synthetic-traffic): kind-dev 활성화`

### 후속 과제 — root fix

현재 적용한 K8s values 수정은 quick fix입니다. 근본 해결 방안은 두 가지입니다.

- `Goti-go/pkg/config/config.go`의 `bindServiceLocalEnv()`에 모든 서비스 공통으로 `jwt.*` 명시 BindEnv를 추가하면 K8s values 보정이 불필요합니다
- 또는 `60-secrets.sh`가 secret 키 이름에 service prefix를 붙여 생성하도록 변경합니다

prod 적용 전 위 둘 중 하나로 마이그레이션이 필요합니다.

---

## ✅ 대시보드 쿼리 일괄 검증

### 동기

상시 트래픽이 도는데도 `goti-dev-db-health` 대시보드의 모든 panel이 빈 상태였습니다. 어떤 메트릭이 수집되지 않는지 대시보드 단위로 일괄 측정해 우선순위를 정하기로 했습니다.

### 검증 도구

`Goti-monitoring/scripts/verify-dashboard-queries.py`를 신규 작성했습니다.

동작 방식입니다.

1. `grafana/dashboards/**/*.json`에서 모든 panel의 `targets[*].expr`(PromQL)을 추출합니다
2. `${var}` 패턴을 기본값(`service_name=goti-ticketing-go`, `cluster=kind-dev` 등)으로 치환합니다
3. Mimir query-frontend(`/prometheus/api/v1/query`)에 instant query를 실행합니다
4. 결과를 OK / EMPTY(no series) / ERROR(HTTP/syntax) 3가지로 분류합니다
5. 대시보드별 status와 EMPTY 메트릭 빈도 Top N, EMPTY expr 샘플을 출력합니다

LogQL이 섞인 경우 `--skip-loki` 옵션으로 건너뜁니다.

```bash
# Mimir query-frontend port-forward
$ kubectl -n monitoring port-forward svc/mimir-dev-query-frontend 18080:8080 &

# 일괄 검증 실행
$ python3 Goti-monitoring/scripts/verify-dashboard-queries.py --skip-loki
```

### 검증 결과 (2026-04-25 08:55 KST, 37개 대시보드 / 625개 PromQL 쿼리)

| 분류 | 건수 | 비율 |
|------|------|------|
| OK | 191 | 30.6% |
| EMPTY | 411 | 65.8% |
| ERROR | 23 | 3.7% |

전체 쿼리의 65.8%가 빈 결과를 반환했습니다. 대시보드가 가정하는 메트릭 수집 파이프라인과 실제 kind-dev 환경의 갭이 매우 크다는 의미입니다.

### EMPTY 메트릭 Top 10

| 빈도 | 메트릭 | 진단 및 대응 |
|------|--------|------------|
| 25 | `http_server_request_duration_seconds_count` | Go OTel HTTP server metric 미수집 또는 라벨 mismatch — 대시보드는 `job` 라벨 사용, Go SDK는 `service.name`으로 export할 가능성 |
| 21 | `span_metrics_duration_seconds_bucket` | OTel collector의 `spanmetricsconnector` 미설정 또는 export 누락 |
| 11 | `istio_request_duration_milliseconds_bucket` | PodMonitor `metricRelabelings.keep` regex에서 누락 — `goti-policy` PodMonitor가 좁은 allowlist 사용 |
| 11 | `k6_http_reqs_total` | synthetic-traffic chart가 k6 메트릭을 prometheus remote_write로 보내지 않음 |
| 8 | `cloudflare_zone_requests_total` | dev 환경에 Cloudflare exporter 없음 — **의도된 환경 차이** (prod 전용 panel) |
| 7 | `jvm_thread_count` | Spring → Go 마이그레이션으로 영구 소멸된 메트릭 — **대시보드 정리 필요** |
| 7 | `span_metrics_calls_total` | `span_metrics_duration_seconds_bucket`과 동일 원인(spanmetrics) |
| 7 | `db_client_connections_*` | OTel SDK DB connection pool meter 미연결 — Go pgx OTel instrumentation 필요 |
| 7 | `http_server_request_duration_seconds_bucket` | `http_server_request_duration_seconds_count`와 동일 원인 |
| 7 | `k6_*` | `k6_http_reqs_total`과 동일 원인 |

### 우선순위 제안

시연 및 모니터링 가치 대비 작업량을 기준으로 정리했습니다.

| 순위 | 항목 | 작업 추정 | 가치 |
|------|------|-----------|------|
| 1 | Istio bucket 메트릭 keep regex 확장 | `goti-policy` PodMonitor values 수정 1줄 + helm upgrade | 높음 — RED 메트릭 즉시 가시화 |
| 2 | OTel HTTP server label mismatch 해결 | dashboard PromQL의 `job` → `service_name` 또는 collector relabel | 높음 — 대부분 RED panel 복구 |
| 3 | spanmetricsconnector 활성화 | otel-collector values 수정 | 중간 — DB span/dependency panel 복구 |
| 4 | k6 → Prometheus remote_write 노출 | k6 `--out experimental-prometheus-rw` 추가 | 중간 — k6 dashboard만 영향 |
| 5 | OTel pgx instrumentation 추가 | Go 코드 수정 + 빌드 + 배포 | 높음 — db-health pool 메트릭 복구 |
| — | `jvm_thread_count` 등 deprecated panel 제거 | dashboard JSON 정리 | 기술 부채 해소 |
| — | Cloudflare panel | dev 환경에서 정상 EMPTY | 무시 |

### 23건 ERROR 분석

대부분 `|=` 같은 LogQL 연산자가 PromQL 쿼리로 전달되어 `parse error: unexpected character: '|'`가 발생한 경우입니다. 스크립트가 dashboard JSON의 datasource type을 정확히 추정하지 못하는 한계 때문입니다. dashboard JSON에 datasource 정보가 명시되어 있으면 정확도를 높일 수 있습니다.

관련 commit: `Goti-monitoring@TBD` — `feat(scripts): verify-dashboard-queries.py 추가`

---

## 📚 배운 점

**1. Spring→Go 마이그레이션 시 secret 컨벤션 변경을 즉시 문서화합니다**

`envFrom` 방식은 secret 키 이름이 곧 env 이름이 됩니다. viper `SetEnvPrefix`를 도입하면 모든 서비스의 env 이름 규칙이 바뀌는 것이므로, 마이그레이션 당시 secret 생성 스크립트와 chart values를 함께 업데이트해야 합니다. 이번처럼 서비스별로 일일이 수정하는 상황을 방지할 수 있습니다

**2. Istio AuthorizationPolicy namespace 누락은 silent failure입니다**

AP가 의도한 namespace가 아닌 helm release namespace에 배포되어도 에러가 나지 않습니다. 결과적으로 wrong namespace에 deny 정책이 적용되거나 의도한 allow 정책이 무효가 됩니다. `goti-policy` chart처럼 다중 namespace를 대상으로 하는 chart는 모든 template에 `metadata.namespace`를 명시하는 것이 안전합니다

**3. istiod JWKS fetch 경로는 별도 allowlist가 필요합니다**

STRICT mTLS 환경에서 istiod는 plaintext로 JWKS endpoint에 접근합니다. source principal 없는 요청이므로 JWT를 검증하는 서비스의 AP에서 `/.well-known/jwks.json` 경로를 `from` 절 없이 ALLOW하는 별도 정책이 필요합니다. 이를 빠뜨리면 JWT 검증이 영구적으로 실패합니다

**4. 대시보드 쿼리를 코드처럼 검증합니다**

625개 쿼리 중 65.8%가 EMPTY인 상황은 "대시보드가 있다"는 것이 "메트릭이 수집된다"는 의미가 아님을 보여줍니다. `verify-dashboard-queries.py` 같은 도구를 CI에 붙여 신규 dashboard PR마다 EMPTY 비율을 budget으로 관리하면 품질 저하를 조기에 차단할 수 있습니다

**5. 실패 유형 태그로 이슈 패턴을 분류합니다**

| 이슈 | 실패 유형 |
|------|-----------|
| JWT viper prefix mismatch | `context-missing` — Spring→Go 마이그레이션 시 secret 컨벤션 변경 미문서화 |
| goti-policy AP/PeerAuth namespace 누락 | `wrong-layer` — chart template 작성 시 namespace 의도가 코드에 미반영 |
| 대시보드 EMPTY 다수 | `dependency-unknown` — dashboard 작성자가 가정한 수집 파이프라인과 실제 환경 불일치 |

이슈 유형을 태그로 분류해두면 유사한 문제가 발생했을 때 과거 기록을 빠르게 참조할 수 있습니다
