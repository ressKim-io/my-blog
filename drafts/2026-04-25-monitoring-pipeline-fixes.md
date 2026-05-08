# 2026-04-25 모니터링 수집 파이프라인 우선순위 5건 일괄 수정

`docs/dev-logs/2026-04-25-synthetic-traffic-and-dashboard-validation.md`에서 식별한 EMPTY 411건 중 metric 자체 미수집(289건) 우선순위 5건을 차근차근 해결.

## 관련 commit / 문서

- `Goti-k8s@7afa385` — fix(monitoring): envoy/istiod ServiceMonitor 라벨 + Istio bucket regex
- `Goti-k8s@363db11` — feat(monitoring): istio metric에 OTel 표준 service_name 라벨 부여
- `Goti-monitoring@5db2f37` — feat(scripts): verify v2 — MISSING vs LABEL_MISMATCH 분리
- `Goti-monitoring@61c2c5e` — feat(otel-collector-back/dev): spanmetricsconnector 활성화
- `Goti-k8s@4594f98` — feat(synthetic-traffic): k6 → Mimir prometheus remote_write
- `Goti-go@fb46a8f` — feat(database): pgxpool 통계 OTel metric export
- `Goti-monitoring@c41cc84` — feat(monitoring): verify false positive 제거 + tempo metrics-generator deployment

## 우선순위 진행

| P | 항목 | 결과 (mimir ingest) |
|---|------|-------------------|
| 1 | Istio bucket regex | istio_request_duration_milliseconds_*, istio_request_bytes_*, istio_response_bytes_* 등 12종 ✅ |
| 2 | Istio metric에 OTel 표준 service_name 라벨 부여 | reporter 방향별 workload → service_name 매핑 (`goti-XXX-dev` → `goti-XXX-go`) ✅ |
| 2.5 | verify 스크립트 v2 | MISSING / LABEL_MISMATCH / EMPTY 3분류 + false positive 제거 ✅ |
| 3 | OTel spanmetricsconnector | span_metrics_calls_total, span_metrics_duration_seconds_{bucket,count,sum} 4종 ✅ |
| 4 | k6 → Prometheus remote_write | k6_* 63종 (k6_http_reqs, k6_http_req_duration_p95/p99 등) ✅ |
| 5 | OTel pgx instrumentation | db_client_connections_{usage,max,pending_requests,idle_max,idle_min} 5종 ✅ |
| 6 | dashboard 일괄 OTel 표준 정리 | 부분 완료 (extract 개선 + tempo deployment). dashboard JSON 라벨 정리는 panel별 컨텍스트가 다양해 별도 PR로 분리 |
| 6.5 | tempo distributor → metrics-generator forwarding | 후속 디버깅 필요 — generator pod는 떴으나 service_graph 메트릭 미생성 |

## verify 스크립트 추이

| 단계 | OK | MISSING | LABEL_MISMATCH | EMPTY | ERROR |
|------|----|---------|-----------------|-------|-------|
| 시작 | 191 | (411 합계) | — | — | 23 |
| P1 후 | 191 | 411 (구버전 EMPTY) | — | — | 23 |
| P2.5 후 (분류 적용) | 191 | 289 | 88 | 34 | 23 |
| P2 후 | 191 | 289 | 88 | 34 | 23 |
| P3 후 | 199 | 255 | 114 | 34 | 23 |
| P4 후 | 206 | 229 | 133 | 34 | 23 |
| P5 후 | 216 | 218 | 134 | 34 | 23 |

**OK 191 → 216 (+25, +13%) / MISSING 289 → 218 (-71, -25%)**

LABEL_MISMATCH가 늘어난 건 신규 메트릭이 들어오면서 dashboard 라벨 셀렉터로 매칭 안 되는 케이스가 새로 잡힘 (이전엔 모두 MISSING으로 분류).

## 핵심 chart 버그 5건

세션 전체에서 발견한 chart 버그를 정리.

| 버그 | 영향 | 수정 commit |
|------|------|-------------|
| 1. `release: kube-prometheus-stack-dev` (실제 release name `kps`) | PodMonitor/ServiceMonitor가 Prometheus selector에 매칭 안 됨 → scrape pool 미생성 → envoy sidecar 메트릭 0건 | `7afa385` |
| 2. PodMonitor keep regex가 `_seconds_` 단위 가정 (Istio 1.29 default는 `_milliseconds_`) | duration 메트릭 전부 drop | `7afa385` |
| 3. spanmetricsconnector 미설정 | span_metrics_* 메트릭 0건 | `61c2c5e` |
| 4. synthetic-traffic chart에 prometheus output 옵션 없음 | k6_* 메트릭 0건 | `4594f98` |
| 5. Go pkg/database가 OTel pool stats export 미구현 | db_client_connections_* 메트릭 0건 | `fb46a8f` |
| 6. tempo metricsGenerator runtime config는 활성이지만 K8s deployment(top-level)는 비활성 | service_graph 메트릭 0건 (P6.5에서 수정 시도, 후속 작업) | `c41cc84` |

## 구조적 교훈

| 패턴 | 빈도 | 대응 |
|------|------|------|
| chart values 사용자 입력 가정과 실제 cluster state 불일치 (release name, 라벨, 단위) | 3건 (#1,#2,#6) | helm install 후 즉시 verify 스크립트로 cross-check |
| OTel SDK가 export하지 않는 메트릭을 dashboard에서 가정 | 2건 (#3,#5) | dashboard 작성 시 expected metric 카탈로그를 spec으로 작성 |
| 외부 시스템 메트릭(k6 등) 단방향 가정 | 1건 (#4) | 부하 도구 chart는 metric output 옵션을 dev 환경에서 default enable |

## 후속 과제 (별도 dev-log/PR)

### P6 잔여
- LABEL_MISMATCH 134건의 dashboard JSON 라벨 셀렉터 정리
- 영구 사라진 panel 처리 (jvm_*, HikariCP_*, cloudflare_*)
- istio dashboard의 destination_service/destination_workload selector를 OTel 표준 service_name으로 통일 (PoC 1개 후 일괄)

### P6.5
- distributor → metrics-generator forwarding 디버깅
- tempo의 metrics_generator processor가 traces를 받지 못하는 원인 (ring config / distributor forwarding flag)

### P7 (root fix)
- `Goti-go/pkg/config/config.go`의 `bindServiceLocalEnv()`에 jwt.* 명시 BindEnv 공통 추가하면 K8s values의 `valueFrom secretKeyRef` quick fix 제거 가능
- `Goti-k8s` 다른 chart들의 `release: kube-prometheus-stack-dev` 라벨 일괄 수정 (현재 미설치라 영향은 없으나 향후 설치 시 동일 문제):
  - infrastructure/dev/strimzi-operator/{servicemonitor,kafka-exporter-servicemonitor,prometheus-rules}.yaml
  - infrastructure/dev/redis-exporter/servicemonitor.yaml
  - infrastructure/dev/cloudflare-exporter/servicemonitor.yaml
  - infrastructure/dev/argocd/values-dev.yaml (4 occurrences)
  - environments/dev/goti-load-observer/values.yaml

### dashboard cleanup
- 37개 dashboard 중 dev-only 의미 있는 것과 prod 전용을 분리
- developer/devops/business 카테고리에서 jvm_* 같은 deprecated metric 사용 panel 제거 또는 OTel equivalent로 마이그레이션

## 실패 유형 태그

| 항목 | 태그 |
|------|------|
| chart 라벨/단위 가정 오류 | `context-missing` (작성자 머릿속의 release name / 단위 가정이 코드에 명시 안 됨) |
| 메트릭 수집 파이프라인 누락 (spanmetrics/k6 prom) | `dependency-unknown` (dashboard 작성자가 가정한 source 파이프라인이 실제와 다름) |
| Go OTel pgx 미구현 | `wrong-layer` (dashboard에 OTel 표준 메트릭이 있는데 SDK가 export 안 함 — app 레이어 책임) |
