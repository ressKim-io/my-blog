---
date: 2026-03-24
category: troubleshoot
project: goti-team-controller, Goti-k8s, Goti-monitoring
tags: [cloudfront, custom-error-response, istio, virtualservice, authorizationpolicy, mimir, tempo, oom, kafka, alloy, msa, seat-statuses, e2e]
---

# 모니터링 OOM 4중 장애 + E2E CloudFront/Istio 라우팅 해결

세션 중 발견·해결한 4건의 트러블슈팅을 시간 순으로 기록.

---

## Issue 1: CloudFront Custom Error Response가 API 404를 HTML로 변환

### Context

E2E 테스트에서 `POST /api/v1/seat-reservations/seats/{seatId}` 호출 시 React 프론트엔드 HTML이 200으로 반환됨. API 응답이 아닌 프론트엔드 index.html.

### Issue

```
POST https://dev.go-ti.shop/api/v1/seat-reservations/seats/{seatId}
→ 200 OK, Content-Type: text/html
→ <!DOCTYPE html><html>...<title>Rsbuild App</title>...
```

- 유효하지 않은 JWT → 401 JSON (정상)
- 유효한 JWT → 200 HTML (비정상)
- 응답 헤더에 `x-amz-server-side-encryption: AES256` (S3 origin), `x-cache: Error from cloudfront`

### Action

1. **가설: CloudFront 캐시 문제** → 검증: `/api/*` behavior는 `CachingDisabled` (TTL=0). POST 허용. 캐시 아님.

2. **가설: Istio VirtualService 경로 누락** → 검증: `/api/v1/seat-reservations` prefix는 ticketing에 존재. 하지만 `/api/v1/game-seats` prefix는 누락.

3. **근본 원인 발견**: CloudFront Custom Error Response 설정.
   ```json
   [
     {"ErrorCode": 403, "ResponsePagePath": "/index.html", "ResponseCode": "200"},
     {"ErrorCode": 404, "ResponsePagePath": "/index.html", "ResponseCode": "200"}
   ]
   ```
   - 이 설정은 React SPA 라우팅 + Google OAuth 콜백을 위해 존재 (제거 불가)
   - Istio에서 404/403 반환 → CloudFront가 S3 index.html + HTTP 200으로 변환
   - **Custom Error Response는 distribution 레벨** — 특정 behavior만 제외 불가

4. **해결: API 전용 도메인 분리**
   - `api.go-ti.shop` → 별도 CloudFront 배포 (구 `kind.go-ti.shop` 재활용)
   - 이 CloudFront에는 Custom Error Response 없음, Kind PC origin 전용
   - Route53: `api.go-ti.shop` A record → CloudFront `d2zfttm14phznh.cloudfront.net`
   - ACM: `*.go-ti.shop` 와일드카드 인증서 사용

### Result

- `api.go-ti.shop`에서 API 404가 JSON 그대로 반환됨 (HTML 변환 없음)
- `dev.go-ti.shop`은 프론트엔드 전용, `api.go-ti.shop`은 API 전용으로 역할 분리
- E2E 스크립트 `BASE_URL`을 `https://api.go-ti.shop`으로 변경

### Related Files

- `Goti-k8s/infrastructure/dev/istio/gateway/values-dev.yaml` — `api.go-ti.shop` 호스트 추가
- `Goti-k8s/environments/dev/goti-*/values.yaml` — 전 서비스 VirtualService hosts 추가 (6파일)
- `goti-team-controller/scripts/e2e-api-test.sh` — 헬스체크 경로 + CURL_RESOLVE 지원

---

## Issue 2: Istio VirtualService 경로 누락 + AuthorizationPolicy 제한

### Context

E2E 테스트 step 4-2 좌석 상태 조회, step 7 결제 API 실패.

### Issue

```
# 1) game-seats 경로 누락 → Istio 404
GET /api/v1/game-seats/{gameId}/sections/{sectionId}/seat-statuses → 404

# 2) payment→ticketing 통신 차단 → 403
GET http://goti-ticketing-dev:8080/api/v1/orders/{id}/payment-order → 403

# 3) payment→ticketing 통신 URL → localhost (401)
GET http://localhost:8080/api/v1/orders/{id}/payment-order → 401
```

### Action

1. **game-seats 경로 누락**: ticketing VirtualService에 `/api/v1/game-seats` prefix 추가.

2. **payment 내부 통신 URL**: `TICKETING_BASE_URL` 환경변수 미설정 → 기본값 `localhost:8080` 사용.
   - payment values.yaml에 `TICKETING_BASE_URL: http://goti-ticketing-dev.goti.svc.cluster.local:8080` 추가
   - ticketing values.yaml에 `STADIUM_API_URL: http://goti-stadium-dev.goti.svc.cluster.local:8080` 추가

3. **AuthorizationPolicy 경로 매칭**: `/api/v1/orders/*`는 Istio에서 **단일 경로 세그먼트만 매칭**. `/api/v1/orders/{id}/payment-order`는 2단계 하위 경로라 매칭 안 됨.
   - paths에 `/api/v1/orders/*/payment-order` 추가
   - methods에 `GET` 추가 (기존 POST만)

### Result

- game-seats 조회 정상 동작
- payment→ticketing 내부 통신 정상 (K8s 서비스 DNS 사용)
- 결제 API는 AuthorizationPolicy 수정 후 재테스트 필요

### 재발 방지

- **새 API 엔드포인트 추가 시**: VirtualService prefix + AuthorizationPolicy paths 동시 확인
- **MSA 서비스 간 통신**: `*_BASE_URL` 환경변수 누락 체크 — `localhost:8080` 기본값은 MSA에서 항상 실패
- **Istio `*` glob**: 단일 세그먼트만 매칭. 하위 경로는 별도 패턴 추가 필요

### Related Files

- `Goti-k8s/environments/dev/goti-ticketing/values.yaml` — game-seats prefix, STADIUM_API_URL, AuthorizationPolicy GET+경로 추가
- `Goti-k8s/environments/dev/goti-payment/values.yaml` — TICKETING_BASE_URL 추가

---

## Issue 3: Mimir Distributor OOM + Alloy Backlog Ingestion 차단

### Context

Grafana 대시보드에서 service_name 변수가 "All"만 표시, 모든 패널 0/No data. 모니터링 전체 불능 상태.

### Issue

```
# Mimir distributor CrashLoopBackOff (168회 재시작)
Last State: Terminated
  Reason: OOMKilled
  Exit Code: 137
  Limits: memory=512Mi

# Distributor 복구 후 — 모든 메트릭 push 거부
err-mimir-distributor-max-write-request-data-item-size
the write request contains a timeseries or metadata item which is larger
than the maximum allowed size of 15983616 bytes
```

### Action

1. **Distributor OOM**: memory limit 512Mi → 768Mi 상향. → 복구 성공.

2. **Ingestion 차단**: Distributor가 20시간 OOM 동안 Alloy WAL에 메트릭 축적 → 복구 후 일괄 push → 단일 Kafka record가 15MB 제한 초과.

3. **`max_write_request_data_item_size` 설정 시도**: Mimir structuredConfig limits에 추가 → **Mimir 3.0.1에서 해당 config key 미존재** → `field not found in type validation.plainLimits` 파싱 에러 → **Mimir 전체 CrashLoop!**
   ```
   error loading config from /etc/mimir/mimir.yaml:
   line 83: field max_write_request_data_item_size not found
   ```

4. **긴급 롤백**: 설정 제거 후 push → ArgoCD sync가 ConfigMap 업데이트 안 함 → kubectl로 직접 ConfigMap 패치.
   ```bash
   kubectl get cm mimir-dev-config -n monitoring -o yaml | \
     sed '/max_write_request_data_item_size/d' | kubectl apply -f -
   ```

5. **Alloy queue_config 추가** (재발 방지):
   ```alloy
   prometheus.remote_write "default" {
     endpoint {
       queue_config {
         max_samples_per_send = 500   # 기본 2000 → 축소
         max_shards = 50              # 동시 전송 제한
         capacity = 10000
       }
     }
   }
   ```

### Result

- Mimir 전체 복구 (distributor, ingester, querier 등 모두 Running)
- Alloy backlog이 queue_config으로 분할 전송되어 정상 ingestion 재개
- 메트릭 수집 정상화

### 교훈

- **Mimir structuredConfig에 존재하지 않는 key 추가 시 전체 CrashLoop** — 반드시 해당 버전 문서/소스 확인 후 설정
- **ArgoCD가 Helm chart의 ConfigMap을 즉시 업데이트하지 않는 경우 있음** — 긴급 시 kubectl 직접 패치 필요
- **Alloy remote_write queue_config은 기본 설정 필수** — distributor 장애 복구 시 backlog 일괄 push 방지

### Related Files

- `Goti-monitoring/values-stacks/dev/mimir-values.yaml` — distributor memory 512Mi→768Mi
- `Goti-monitoring/values-stacks/dev/alloy-values.yaml` — queue_config 추가

---

## Issue 4: Tempo OOM (115회 재시작)

### Context

Tempo monolithic mode, memory limit 2Gi. Error Tracking 대시보드에서 트레이스 조회 불가, Grafana에서 502 Bad Gateway.

### Issue

```
# Tempo pod
Last State: Terminated
  Reason: OOMKilled
  Exit Code: 137
  Restart Count: 115
  Limits: memory=2Gi

# Grafana → Tempo 연결 실패
Get "http://tempo-dev.monitoring.svc:3200/api/search?...":
dial tcp 10.96.64.214:3200: connect: connection refused
```

### Action

1. **근본 원인 조사** (외부 검색 포함):
   - Monolithic mode: 모든 컴포넌트(ingester, compactor, querier, metrics-generator)가 단일 프로세스 → 메모리 경합
   - `metricsGenerator: true` → span metrics, service graphs 생성에 200~500MB 소비
   - `max_block_duration` 기본 30분 → ingester가 30분간 트레이스를 인메모리 유지

2. **수정 적용**:
   - `metricsGenerator: false` (dev 환경, 200~500MB 절감)
   - `ingester.max_block_duration: 5m` (30m → 5m, 메모리 ~50% 절감)
   - `ingester.trace_idle_period: 10s`, `flush_check_period: 10s`

3. **Config 파싱 에러**: `tempo.overrides.defaults` 키가 chart v1.x (grafana/tempo 1.24.4)에서 `legacyConfig` 타입으로 취급 → 파싱 실패.
   ```
   failed to parse configFile: yaml: unmarshal errors:
   line 48: field defaults not found in type overrides.legacyConfig
   ```
   - overrides 설정 제거 (chart v1.x에서는 `overrides.yaml`로 별도 관리)
   - ArgoCD ConfigMap 미반영 → kubectl 직접 패치 + pod 삭제

4. **메모리 상향**: 최적화에도 OOM 지속 → 2Gi → 3Gi 상향.

### Result

- Tempo 1/1 Running, 0 restarts, 5분+ 안정
- Error Tracking 대시보드 정상 동작
- 트레이스 조회/검색 정상

### 재발 방지 (TODO)

- **Alloy tail sampling 도입** — 에러+느린요청 100%, 나머지 20%. 트레이스 볼륨 60~70% 감소 → OOM 근본 해결
- **Alloy sending_queue + retry 강화** — Tempo 재시작 시 트레이스 유실 방지
- **prod 전환 시**: tempo-distributed chart + S3 백엔드 + ingester replication

### 외부 조사 결과 요약

| 항목 | 내용 |
|------|------|
| Monolithic 권장 범위 | <50GB/일, <20 서비스 |
| 가장 효과적인 메모리 절감 | `max_block_duration` 축소 (30m→5m: ~50%) |
| metrics_generator OFF 효과 | 200~500MB 절감 |
| tail sampling 효과 | 볼륨 60~90% 감소 |
| 트레이스 보관 업계 표준 | 7일 (메트릭 90일, 로그 30일) |
| HA 전환 경로 | monolithic → tempo-distributed + S3/MinIO |
| 데이터 마이그레이션 | 불필요 (동일 스토리지 포맷) |
| Kafka ingest | Tempo 장애 시에도 Kafka에 트레이스 보존 |

### Related Files

- `Goti-monitoring/values-stacks/dev/tempo-values.yaml` — metricsGenerator OFF, ingester 5m flush, memory 3Gi

---

## 세션 성과 요약

| 항목 | Before | After |
|------|--------|-------|
| E2E 테스트 | 6/9 통과 | 10/11 통과 |
| API 도메인 | dev.go-ti.shop (HTML 혼재) | api.go-ti.shop (API 전용) |
| Mimir distributor | OOMKilled (168회) | Running, 0 restarts |
| Tempo | OOMKilled (115회) | Running, 0 restarts |
| 메트릭 수집 | 전면 차단 | 정상 |
| 트레이스 조회 | 502 Bad Gateway | 정상 |
| seat_statuses | 0건 | 75,060건 (KIA 3경기) |
| MSA 내부 통신 | localhost:8080 (실패) | K8s 서비스 DNS (정상) |
