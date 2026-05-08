# 2026-04-25 상시 트래픽 활성화 + 대시보드 쿼리 일괄 검증

세션 후반부. Istio Gateway 트리아지(`2026-04-25-istio-gateway-rbac-triage.md`) 완료 후 모니터링 시연을 위한 상시 트래픽 활성화와 대시보드 panel 데이터 가시성 점검.

## 관련 commit / 문서

- `Goti-k8s@bae704f` — fix(istio): goti-policy AP/PeerAuth 누락 namespace=goti 명시
- `Goti-k8s@e119d0b` — fix(dev): JWT secret env에 service prefix 명시 매핑
- `Goti-k8s@e329018` — feat(dev/synthetic-traffic): kind-dev 활성화
- `Goti-monitoring@<TBD>` — feat(scripts): verify-dashboard-queries.py 추가
- 검증 cluster: `kind-goti-dev-v2` (K8s 1.34.3)

---

## 1. 상시 트래픽 활성화

### 목표

모니터링 시연/영상 촬영용으로 끊김 없는 합성 트래픽을 goti namespace에 흘림.

### 사용한 chart

`Goti-k8s/charts/synthetic-traffic` (k6 기반 CronJob, 이미 구현됨).
`environments/dev/synthetic-traffic/values.yaml`에서 `enabled: false`였음 → kind-dev에 맞춰 활성화.

| 항목 | 변경 |
|------|------|
| `enabled` | false → true |
| `k6.vus` | 100 → 10 (kind-dev 자원 보호) |
| `k6.duration` | "4m" → "4m30s" (schedule `*/5 * * * *` 와의 갭을 30초로 줄여 거의 상시 트래픽) |

### 부수 디버깅 — 5단계 가설-검증

활성화하자마자 setup 함수가 500 → 401 → 503 → 404 순으로 다른 에러를 토함. 각 단계의 가설/원인을 추적.

#### Step 1 (500): Go 앱이 JWT 발급 실패

```
ERROR creating test user token: RSA private key not configured
```

`pkg/config/config.go`의 viper가 service prefix(`USER_`)를 붙여 env를 찾는데 secret의 키 이름은 prefix 없는 `JWT_PRIVATE_KEY_PEM`이라 매칭 실패. envFrom으로 secret 통째 주입되니 키 이름이 곧 env 이름.

원인: Spring Boot 시절 secret 컨벤션을 그대로 두고 Go 마이그레이션. viper의 SetEnvPrefix와 충돌.

수정: `environments/dev/goti-user/values.yaml`의 env에 `valueFrom secretKeyRef`로 `USER_JWT_PRIVATE_KEY_PEM`/`USER_JWT_PUBLIC_KEY_PEM`을 명시 매핑.

#### Step 2 (401): istiod가 JWKS fetch 실패

```
istiod: Failed to GET .../.well-known/jwks.json: read: connection reset by peer
istiod: The JWKS key is not yet fetched ... using a fake JWKS for now
```

mesh-wide STRICT mTLS(`istio-system/default`)는 살아있고, 우리가 앞 작업에서 `goti-policy` chart의 PeerAuthentication PERMISSIVE를 isto-system이 아닌 goti namespace에 배포해야 하는데 chart 버그(`metadata.namespace` 누락)로 istio-system에 가 있었음. istiod는 sidecar 없이 plaintext로 JWKS fetch 시도 → goti pod의 STRICT가 plaintext 거부.

수정: `peer-auth-prometheus-ports.yaml` template에 `metadata.namespace: goti` 명시.

#### Step 3 (여전히 401, 그러나 PeerAuth 통과 후 RBAC 403): goti namespace의 AP가 plaintext istiod 요청 deny

```
istiod: Failed to GET .../.well-known/jwks.json: status 403, message "RBAC: access denied"
```

goti pod의 AuthorizationPolicy(`from-ingress-gateway`, `from-mesh-internal`, `require-jwt`)가 적용되어 있는데, istiod의 plaintext 요청은 source identity(principal/namespace) 식별 불가 → allowlist 어디에도 매칭 안 됨 → deny.

`goti-policy` chart의 `allow-jwks-public` AP가 goti namespace에 배포돼서 `/.well-known/jwks.json` path를 from 절 없이 ALLOW해줘야 했는데, 이 역시 같은 chart 버그로 istio-system에 가 있었고 우리가 트리아지 1차 수정 시 disable 시켜놓은 상태.

수정: `allow-istiod-jwks.yaml` template에 `namespace: goti` 명시 + `values-dev.yaml`의 `allowIstiodJwks.enabled` 다시 true.

#### Step 4 (503): ticketing app panic — `JWT public key not configured`

```
ticketing logs: WARN JWT public key not configured: failed to decode PEM block
ticketing logs: panic: nil pointer dereference at pkg/middleware/error_handler.go:19
```

Step 1과 같은 viper prefix 문제가 ticketing/payment/queue/resale/stadium 5개 서비스에도 동일하게 발생. 다만 이 서비스들은 public key만 필요 (issuer 검증용).

수정: 5개 서비스의 values.yaml에 `{SVC}_JWT_PUBLIC_KEY_PEM`을 valueFrom으로 명시 매핑.

#### Step 5 (404): k6 스크립트가 호출하는 일부 path가 실제 API에 없음

setup 자체는 성공(`gameId/sectionIds/teams` 추출 OK). default 함수의 일부 GET path가 실제 라우팅에 없는 prefix이거나 INVALID_FORMAT. 시연 메트릭 발생에는 무관.

### 결과

```
$ kubectl -n goti get cronjob synthetic-traffic
NAME                SCHEDULE      ACTIVE   LAST SCHEDULE   AGE
synthetic-traffic   */5 * * * *   1        ...             ...

$ kubectl -n goti logs <synthetic-traffic-...> -c k6 | grep setup
INFO setup: gameId=15000734-..., stadiumId=4553f1c7-..., sections=60, teams=5
```

10 VUs 가 goti-{ticketing,stadium,resale,payment,user} 5개 서비스에 sleep 2-5초 사이로 GET/POST 분산.

### 후속 과제 (root fix)

- `Goti-go/pkg/config/config.go`의 `bindServiceLocalEnv()`에 모든 서비스 공통으로 jwt.* 명시 BindEnv 추가하면 K8s values 보정 필요 없음.
- 또는 `60-secrets.sh` 가 secret 키 이름에 service prefix를 붙여 생성하도록 변경.
- 현재 적용한 K8s values는 quick fix이며 prod 적용 전 위 둘 중 하나로 마이그레이션 필요.

---

## 2. 대시보드 쿼리 일괄 검증

### 동기

상시 트래픽이 도는데도 사용자가 보려는 `goti-dev-db-health` 대시보드의 모든 panel이 빈 상태. 어떤 메트릭이 안 들어오는지를 dashboard 단위로 일괄 측정해서 우선순위를 잡고자 함.

### 도구

`Goti-monitoring/scripts/verify-dashboard-queries.py` 신규 작성.

- 입력: `grafana/dashboards/**/*.json`
- 동작:
  1. 모든 panel의 `targets[*].expr` (PromQL) 추출
  2. `${var}` 패턴 치환 (기본값: service_name=goti-ticketing-go, cluster=kind-dev, …)
  3. Mimir query-frontend(`/prometheus/api/v1/query`)에 instant query
  4. 결과 분류: OK / EMPTY (no series) / ERROR (HTTP/syntax)
- 출력: 대시보드별 status + EMPTY 메트릭 빈도 Top N + EMPTY expr 샘플
- LogQL은 `--skip-loki`로 스킵 가능 (일부 expr이 변수 치환 후 LogQL 파서가 거부)

### 실행

```bash
# port-forward
kubectl -n monitoring port-forward svc/mimir-dev-query-frontend 18080:8080 &
# 검증
python3 Goti-monitoring/scripts/verify-dashboard-queries.py --skip-loki
```

### 결과 (2026-04-25 08:55 KST 기준, 37 dashboards / 625 PromQL queries)

| 분류 | count | % |
|------|-------|---|
| OK | 191 | 30.6 |
| EMPTY | 411 | 65.8 |
| ERROR | 23 | 3.7 |

#### EMPTY metric Top 10

| 빈도 | metric | 진단 / 대응 |
|-----|--------|------------|
| 25 | `http_server_request_duration_seconds_count` | Go OTel HTTP server metric 미수집 또는 라벨 mismatch (대시보드는 `job` 라벨 사용, Go SDK는 `service.name` 라벨로 export할 가능성) |
| 21 | `span_metrics_duration_seconds_bucket` | OTel collector의 `spanmetricsconnector` 미설정 또는 export 누락 |
| 11 | `istio_request_duration_milliseconds_bucket` | PodMonitor `metricRelabelings.keep` regex에서 누락 (현재 `goti-policy` PodMonitor가 좁은 allowlist 사용) |
| 11 | `k6_http_reqs_total` | synthetic-traffic chart가 k6 메트릭을 prometheus remote_write 안 함 |
| 8 | `cloudflare_zone_requests_total` | dev엔 Cloudflare exporter 없음 — **의도된 환경 차이** (prod 전용 panel) |
| 7 | `jvm_thread_count` | Spring→Go 마이그레이션으로 영구 사라진 메트릭 — **dashboard 정리 필요** |
| 7 | `span_metrics_calls_total` | 위 #2와 동일 (spanmetrics) |
| 7 | `db_client_connections_*` | OTel SDK DB connection pool meter 미연결 (Go pgx OTel attach 필요) |
| 7 | `http_server_request_duration_seconds_bucket` | 위 #1과 동일 |
| 7 | `k6_*` | 위 #4와 동일 |

#### 우선순위 제안 (시연/모니터링 가치 vs 작업량)

| 순위 | 항목 | 작업 추정 | 가치 |
|-----|------|-----------|------|
| 1 | Istio bucket 메트릭 keep regex 확장 | values 수정 1개 + helm upgrade | 高 (RED 메트릭 즉시 가시화) |
| 2 | OTel HTTP server label mismatch 해결 | dashboard PromQL의 `job` → `service_name` 또는 collector relabel | 高 (대부분 RED panel 살아남) |
| 3 | spanmetricsconnector 활성화 | otel-collector values 수정 | 中 (DB span/dependency 패널 회복) |
| 4 | k6 → Prometheus 노출 | k6 `--out experimental-prometheus-rw` 추가 | 中 (k6 dashboard만 영향) |
| 5 | OTel pgx instrumentation 추가 | Go 코드 수정 + 빌드 + 배포 | 高 (db-health pool 메트릭 살아남) |
| - | jvm_thread_count 등 deprecated panel 제거 | dashboard JSON cleanup | 정리 가치 |
| - | cloudflare panel | dev 환경에서 정상 EMPTY | 무시 |

### 23건 ERROR

대부분 (a) 변수 치환 결과 LogQL 파서 거부, (b) `|=` 같은 LogQL 연산자가 PromQL에 들어감 → `parse error: unexpected character: '|'`. 스크립트의 datasource type 추정 한계. 추후 dashboard JSON에 datasource 명시되어 있으면 정확도 올라감.

---

## 실패 유형 태그

| 항목 | 태그 |
|------|------|
| JWT viper prefix mismatch | `context-missing` (Spring→Go 마이그레이션 시 secret 컨벤션 변경 미문서화) |
| goti-policy AP/PeerAuth namespace 누락 | `wrong-layer` (chart template 작성 시 namespace 의도가 코드에 반영 안 됨, 트리아지 1차분과 동일 root) |
| 대시보드 EMPTY 다수 | `dependency-unknown` (dashboard 작성자가 가정한 메트릭 수집 파이프라인이 실제와 다름) |

## 후속 과제

### 즉시
- [ ] Istio bucket regex 확장 (`goti-policy` PodMonitor `metricRelabelings`) — 값 1줄, 작업량 최소
- [ ] dashboard PromQL의 `job=~"$service_name"` ↔ Go OTel export label 통일

### 중기
- [ ] OTel collector spanmetricsconnector 활성화
- [ ] k6 prometheus remote_write 옵션 추가
- [ ] OTel pgx instrumentation 추가 (Go pkg/database 레이어)

### 장기
- [ ] 매 PR 자동 검증 — `verify-dashboard-queries.py`를 CI에 붙여 신규/수정 dashboard의 EMPTY 비율 budget화
- [ ] dashboard 라이프사이클 — Spring 시절 만들어진 jvm_*/HikariCP_* panel 제거 또는 OTel equivalent로 마이그레이션
