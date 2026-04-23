---
title: "모니터링 E2E 연쇄 트러블 — CloudFront 404부터 Mimir·Tempo OOM까지"
excerpt: "한 세션에서 발견한 4건의 트러블을 시간 순으로 기록합니다. CloudFront Custom Error Response가 API 404를 HTML로 덮는 문제부터 Mimir distributor/Tempo OOM의 연쇄 장애까지 풀어갑니다."
category: monitoring
tags:
  - go-ti
  - Observability
  - Monitoring
  - Troubleshooting
  - CloudFront
  - Istio
  - Mimir
  - Tempo
series:
  name: "goti-observability-ops"
  order: 12
date: "2026-03-24"
---

## 한 줄 요약

> E2E 테스트가 6/9에서 막혀있던 원인을 따라갔더니 4개의 장애가 순차적으로 드러났습니다. CloudFront Custom Error Response, Istio 라우팅 누락, Mimir distributor OOM, Tempo OOM — 하나씩 풀어서 10/11까지 복구한 세션 기록입니다.

---

## 🔥 문제: E2E 테스트가 막히고 모니터링마저 전면 불능

E2E 테스트에서 좌석 예약 API를 호출하면 **React 프론트엔드 HTML이 200으로 돌아오는** 이상 증상으로 시작했습니다.
원인을 파고들다 Istio 라우팅 누락이 연이어 나왔고, 디버깅에 써야 할 Grafana 대시보드는 모든 패널이 `No data` 상태였습니다.

모니터링 파이프라인을 들여다보니 Mimir distributor가 168회 재시작 중이었고, Tempo도 115회 재시작 중이었습니다.
**관측성 스택이 멈춰 있으니 애플리케이션 장애를 진단할 수 없는** 상황이었습니다.

한 세션 안에서 해결한 4건을 문제 → 원인 → 해결 순서로 정리합니다.

---

## 🔥 Issue 1: CloudFront가 API 404를 HTML 200으로 변환

### 증상

E2E 테스트 중 좌석 예약 호출에서 아래와 같은 응답이 돌아왔습니다.

```text
POST https://dev.go-ti.shop/api/v1/seat-reservations/seats/{seatId}
→ 200 OK, Content-Type: text/html
→ <!DOCTYPE html><html>...<title>Rsbuild App</title>...
```

JWT를 유효하지 않게 넣으면 401 JSON이 정상 반환되는데, 유효한 JWT로 호출하면 200 HTML이 돌아왔습니다.
응답 헤더에 `x-amz-server-side-encryption: AES256`, `x-cache: Error from cloudfront`가 찍혀 있어 S3 origin에서 응답이 내려온 흔적이 보였습니다.

### 가설 제거 과정

가장 먼저 의심한 것은 CloudFront 캐시였습니다.
`/api/*` behavior를 확인했으나 `CachingDisabled` (TTL=0)에 POST도 허용되어 있어 캐시 문제는 아니었습니다.

다음으로 Istio VirtualService 경로 누락을 의심했습니다.
`/api/v1/seat-reservations` prefix는 ticketing VirtualService에 존재했지만, 관련 API인 `/api/v1/game-seats` prefix가 누락되어 있었습니다.
다만 이것만으로는 "404가 HTML 200으로 바뀌는" 현상을 설명할 수 없었습니다.

### 🤔 원인: Custom Error Response가 distribution 레벨 설정

근본 원인은 CloudFront의 Custom Error Response 설정이었습니다.

```json
[
  {"ErrorCode": 403, "ResponsePagePath": "/index.html", "ResponseCode": "200"},
  {"ErrorCode": 404, "ResponsePagePath": "/index.html", "ResponseCode": "200"}
]
```

이 설정은 React SPA 라우팅과 Google OAuth 콜백을 위해 꼭 필요해 제거할 수 없었습니다.
문제는 **Custom Error Response가 distribution 레벨이라 특정 behavior만 제외할 수 없다**는 점입니다.

흐름을 따라가보겠습니다.

1. 클라이언트가 `POST /api/v1/seat-reservations/...`를 호출합니다.
2. Istio VirtualService에 경로가 없거나 AuthorizationPolicy에서 거부되어 404/403을 반환합니다.
3. CloudFront가 이 에러 응답을 가로채서 S3의 `index.html`을 대신 내려보냅니다.
4. 응답 코드는 200, Content-Type은 `text/html`로 바뀝니다.

**API와 프론트엔드가 같은 distribution을 쓰는 한 이 문제는 구조적으로 해결되지 않습니다.**

### ✅ 해결: API 전용 도메인 분리

기존에 사용하지 않던 `kind.go-ti.shop` CloudFront 배포를 `api.go-ti.shop`으로 재활용했습니다.

- `api.go-ti.shop` → 별도 CloudFront 배포 (Custom Error Response 없음, Kind PC origin 전용)
- Route53 A record를 `d2zfttm14phznh.cloudfront.net`으로 지정
- ACM은 `*.go-ti.shop` 와일드카드 인증서 사용
- E2E 스크립트 `BASE_URL`을 `https://api.go-ti.shop`으로 변경

역할 분리 결과는 다음과 같습니다.

| 도메인 | 용도 | Custom Error Response |
|--------|------|----------------------|
| `dev.go-ti.shop` | 프론트엔드(React SPA) | 유지(OAuth 콜백용) |
| `api.go-ti.shop` | API 전용 | 없음(JSON 그대로 반환) |

분리 후 API 404는 JSON 그대로 돌아오게 되었고, Istio 라우팅 설정 오류도 즉시 재현할 수 있는 상태가 되었습니다.

### 관련 파일

- `Goti-k8s/infrastructure/dev/istio/gateway/values-dev.yaml` — `api.go-ti.shop` 호스트 추가
- `Goti-k8s/environments/dev/goti-*/values.yaml` — 전 서비스 VirtualService hosts 추가 (6파일)
- `goti-team-controller/scripts/e2e-api-test.sh` — 헬스체크 경로 + `CURL_RESOLVE` 지원

---

## 🔥 Issue 2: Istio VirtualService 누락 + AuthorizationPolicy glob 오해

### 증상

API 도메인을 분리하고 다시 E2E를 돌리자 이번에는 진짜 라우팅 이슈가 드러났습니다.

```text
# 1) game-seats 경로 누락 → Istio 404
GET /api/v1/game-seats/{gameId}/sections/{sectionId}/seat-statuses → 404

# 2) payment→ticketing 통신 차단 → 403
GET http://goti-ticketing-dev:8080/api/v1/orders/{id}/payment-order → 403

# 3) payment→ticketing 통신 URL → localhost (401)
GET http://localhost:8080/api/v1/orders/{id}/payment-order → 401
```

### 🤔 원인: 세 가지가 겹친 상황

첫째, **game-seats 경로 누락**입니다.
새로 추가된 엔드포인트가 ticketing VirtualService의 prefix 목록에 들어가지 않아 Istio Gateway에서 404를 반환하고 있었습니다.

둘째, **payment→ticketing 내부 통신 URL이 localhost로 고정**된 상태였습니다.
`TICKETING_BASE_URL` 환경변수가 설정되지 않아 Spring 애플리케이션이 기본값인 `localhost:8080`을 사용했습니다.
MSA 구조에서 localhost는 자기 자신을 가리키므로, payment 서비스가 자기 자신의 `/api/v1/orders/{id}/payment-order`를 호출해 401이 반환된 것입니다.

셋째, **AuthorizationPolicy의 경로 매칭 오해**입니다.
Istio의 `*` glob은 **단일 경로 세그먼트만 매칭**합니다.
`/api/v1/orders/*`는 `/api/v1/orders/{id}`까지는 잡지만, `/api/v1/orders/{id}/payment-order`는 하위 세그먼트가 더 있어서 매칭되지 않습니다.

### ✅ 해결

세 가지를 각각 수정했습니다.

1. ticketing VirtualService에 `/api/v1/game-seats` prefix 추가.
2. payment `values.yaml`에 `TICKETING_BASE_URL`, ticketing `values.yaml`에 `STADIUM_API_URL`을 K8s 서비스 DNS 형태로 추가.

```yaml
# goti-payment/values.yaml
env:
  TICKETING_BASE_URL: http://goti-ticketing-dev.goti.svc.cluster.local:8080

# goti-ticketing/values.yaml
env:
  STADIUM_API_URL: http://goti-stadium-dev.goti.svc.cluster.local:8080
```

3. AuthorizationPolicy paths에 하위 경로 패턴 추가.

```yaml
rules:
  - to:
      - operation:
          methods: ["GET", "POST"]   # 기존 POST만 → GET 추가
          paths:
            - /api/v1/orders/*
            - /api/v1/orders/*/payment-order   # 하위 세그먼트 별도 패턴
```

### 📚 재발 방지

- **새 API 엔드포인트 추가 시** VirtualService prefix + AuthorizationPolicy paths를 한 PR에서 동시에 수정합니다.
- **MSA 서비스 간 통신**은 `*_BASE_URL` 환경변수가 필수입니다. 기본값 `localhost:8080`은 MSA에서 항상 실패합니다.
- **Istio `*` glob은 단일 세그먼트 매칭**입니다. 하위 경로는 별도 패턴을 추가해야 합니다.

---

## 🔥 Issue 3: Mimir Distributor OOM + Alloy Backlog Ingestion 차단

### 증상

애플리케이션 장애를 추적하려고 Grafana를 열었는데, service_name 변수에 `All`만 표시되고 모든 패널이 `No data`였습니다.
모니터링 네임스페이스를 보니 Mimir distributor가 CrashLoopBackOff 중이었습니다.

```text
Last State: Terminated
  Reason: OOMKilled
  Exit Code: 137
  Restart Count: 168
  Limits: memory=512Mi
```

재시작 횟수가 168회였고, 약 20시간 동안 OOM 루프를 돌고 있었습니다.

### 🤔 원인: OOM → 복구 시 일괄 push → Kafka record 크기 초과 → 설정 실수로 전체 CrashLoop

distributor의 메모리 limit(512Mi)이 부족해서 OOM이 반복되고 있었고, 메모리를 올려 복구하자 이번에는 다른 에러가 쏟아졌습니다.

```text
err-mimir-distributor-max-write-request-data-item-size
the write request contains a timeseries or metadata item which is larger
than the maximum allowed size of 15983616 bytes
```

흐름을 따라가보겠습니다.

1. distributor가 20시간 동안 OOM 상태였습니다.
2. 그 사이 Alloy가 WAL에 메트릭을 계속 축적했습니다.
3. distributor 복구 직후 Alloy가 backlog를 일괄 push했습니다.
4. 단일 Kafka record가 Mimir 기본 제한 15MB를 초과해 거부되었습니다.

여기서 수습을 시도하다 2차 사고가 발생했습니다.
`max_write_request_data_item_size` 값을 Mimir `structuredConfig.limits`에 추가했는데, **Mimir 3.0.1에서 해당 config key가 존재하지 않았습니다**.

```text
error loading config from /etc/mimir/mimir.yaml:
line 83: field max_write_request_data_item_size not found
       in type validation.plainLimits
```

이 파싱 에러로 distributor뿐 아니라 Mimir 전체(ingester, querier 포함)가 CrashLoop에 빠졌습니다.

### ✅ 해결

세 단계로 복구했습니다.

1. **distributor 메모리 상향**: 512Mi → 768Mi.
2. **긴급 롤백**: 존재하지 않는 설정 제거. ArgoCD sync가 ConfigMap을 즉시 반영하지 않아 kubectl로 직접 패치했습니다.

```bash
$ kubectl get cm mimir-dev-config -n monitoring -o yaml | \
    sed '/max_write_request_data_item_size/d' | kubectl apply -f -
```

3. **Alloy queue_config 추가**: 재발 방지를 위해 remote_write 측에서 분할 전송을 강제했습니다.

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

복구 후 Mimir 전체가 Running 상태로 안정화되었고, Alloy backlog도 작은 단위로 나뉘어 정상적으로 ingestion되었습니다.

### 📚 교훈

- **Mimir structuredConfig에 존재하지 않는 key를 추가하면 전체 CrashLoop입니다.** 설정 변경 전 해당 버전의 문서/소스를 먼저 확인해야 합니다.
- **ArgoCD가 Helm chart의 ConfigMap을 즉시 업데이트하지 않을 때가 있습니다.** 긴급 상황에서는 kubectl 직접 패치가 필요합니다.
- **Alloy remote_write queue_config은 기본 설정으로 넣어둡니다.** distributor 장애 복구 시 backlog 일괄 push를 막아주는 안전장치입니다.

### 관련 파일

- `Goti-monitoring/values-stacks/dev/mimir-values.yaml` — distributor memory 512Mi→768Mi
- `Goti-monitoring/values-stacks/dev/alloy-values.yaml` — queue_config 추가

---

## 🔥 Issue 4: Tempo OOM — metricsGenerator와 block duration이 만든 메모리 경합

### 증상

메트릭을 복구하고 나니 이번에는 트레이스가 보이지 않았습니다.
Error Tracking 대시보드에서 Grafana가 502 Bad Gateway를 냈고, Tempo Pod를 확인하니 115회 재시작 상태였습니다.

```text
Last State: Terminated
  Reason: OOMKilled
  Exit Code: 137
  Restart Count: 115
  Limits: memory=2Gi
```

Grafana에서도 연결 자체가 실패하고 있었습니다.

```text
Get "http://tempo-dev.monitoring.svc:3200/api/search?...":
dial tcp 10.96.64.214:3200: connect: connection refused
```

### 🤔 원인: Monolithic mode의 메모리 경합 + 불필요한 기능 활성화

Tempo는 monolithic mode로 운영되고 있어, 모든 컴포넌트(ingester, compactor, querier, metrics-generator)가 단일 프로세스에서 메모리를 공유합니다.
여기에 세 가지 요인이 겹쳐 있었습니다.

- `metricsGenerator: true` — span metrics, service graphs 생성에 200~500MB 소비
- `max_block_duration` 기본 30분 — ingester가 30분간 트레이스를 인메모리 유지
- Grafana의 트레이스 검색 부하

### ✅ 해결

세 단계로 풀었습니다.

1. **설정 최적화**로 메모리 사용량을 먼저 줄였습니다.

```yaml
# tempo-values.yaml
metricsGenerator:
  enabled: false              # dev 환경에서 비활성화, 200~500MB 절감

ingester:
  max_block_duration: 5m      # 30m → 5m, 메모리 ~50% 절감
  trace_idle_period: 10s
  flush_check_period: 10s
```

2. **Config 파싱 에러 수정**: `tempo.overrides.defaults` 키가 chart v1.x(grafana/tempo 1.24.4)에서 `legacyConfig` 타입으로 취급되어 파싱에 실패했습니다.

```text
failed to parse configFile: yaml: unmarshal errors:
line 48: field defaults not found in type overrides.legacyConfig
```

chart v1.x에서는 overrides가 `overrides.yaml`로 별도 관리되어 structuredConfig에 직접 넣을 수 없었습니다.
overrides 설정을 제거하고 ArgoCD ConfigMap이 갱신되지 않아 kubectl로 직접 패치한 뒤 pod를 삭제했습니다.

3. **메모리 상향**: 최적화 후에도 OOM이 지속되어 2Gi → 3Gi로 올렸습니다.

결과적으로 Tempo가 1/1 Running, 0 restart, 5분 이상 안정화되었고, Error Tracking 대시보드와 트레이스 검색이 정상 동작하게 되었습니다.

### 외부 조사 결과 요약

| 항목 | 내용 |
|------|------|
| Monolithic 권장 범위 | &lt;50GB/일, &lt;20 서비스 |
| 가장 효과적인 메모리 절감 | `max_block_duration` 축소 (30m→5m: ~50%) |
| metrics_generator OFF 효과 | 200~500MB 절감 |
| tail sampling 효과 | 볼륨 60~90% 감소 |
| 트레이스 보관 업계 표준 | 7일 (메트릭 90일, 로그 30일) |
| HA 전환 경로 | monolithic → tempo-distributed + S3/MinIO |
| 데이터 마이그레이션 | 불필요 (동일 스토리지 포맷) |
| Kafka ingest | Tempo 장애 시에도 Kafka에 트레이스 보존 |

조사에서 가장 중요한 발견은 **monolithic mode의 한계가 생각보다 낮다**는 점이었습니다.
일 50GB 이상이나 20개 이상의 서비스를 다룰 예정이라면 처음부터 distributed 구성을 고려해야 합니다.
또한 `max_block_duration`을 줄이는 것이 `metricsGenerator` 비활성화보다 효과가 크다는 수치도 이후 튜닝 기준이 되었습니다.

### 📚 재발 방지 TODO

- **Alloy tail sampling 도입**: 에러 + 느린 요청 100%, 나머지 20%로 샘플링하면 트레이스 볼륨이 60~70% 감소합니다. OOM을 근본적으로 막는 방법입니다.
- **Alloy sending_queue + retry 강화**: Tempo 재시작 시 트레이스 유실을 방지합니다.
- **prod 전환 시**: tempo-distributed chart + S3 백엔드 + ingester replication으로 이동합니다.

### 관련 파일

- `Goti-monitoring/values-stacks/dev/tempo-values.yaml` — metricsGenerator OFF, ingester 5m flush, memory 3Gi

---

## 📚 세션 성과 요약

| 항목 | Before | After |
|------|--------|-------|
| E2E 테스트 | 6/9 통과 | 10/11 통과 |
| API 도메인 | dev.go-ti.shop(HTML 혼재) | api.go-ti.shop(API 전용) |
| Mimir distributor | OOMKilled (168회) | Running, 0 restart |
| Tempo | OOMKilled (115회) | Running, 0 restart |
| 메트릭 수집 | 전면 차단 | 정상 |
| 트레이스 조회 | 502 Bad Gateway | 정상 |
| seat_statuses | 0건 | 75,060건 |
| MSA 내부 통신 | localhost:8080 (실패) | K8s 서비스 DNS (정상) |

이 세션에서 얻은 가장 큰 교훈은 **연쇄 트러블을 디버깅할 때는 관측성 스택이 먼저 살아있어야 한다**는 것입니다.
애플리케이션 장애를 추적하려다 모니터링이 죽어 있어 역순으로 모니터링부터 복구해야 했습니다.

두 번째 교훈은 **배포 플랫폼의 전역 설정이 특정 엔드포인트의 의미를 바꿀 수 있다**는 점입니다.
CloudFront Custom Error Response처럼 distribution 레벨에서 걸린 설정은 API와 프론트엔드를 같은 도메인에 묶는 순간 반드시 문제가 됩니다.
역할이 다른 트래픽은 처음부터 도메인을 분리하는 편이 안전합니다.

세 번째 교훈은 **설정 추가 전 해당 버전의 설정 스키마를 확인해야 한다**는 것입니다.
Mimir `max_write_request_data_item_size`와 Tempo `overrides.defaults` 모두 버전에 따라 존재 여부가 달라져 전체 CrashLoop를 유발했습니다.
운영 중인 버전 문서/소스를 직접 확인하는 습관이 필요합니다.
