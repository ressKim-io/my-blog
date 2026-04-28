---
title: "AWS 전량 Destroy + GCP-Only 지연 최적화 — 900ms에서 60ms로"
excerpt: "멀티클라우드 failover 계획을 접고 시연 1주일 전 AWS 전체를 destroy한 뒤, GCP-only 구조에서 DB 권한·누락 테이블·CPU limits 세 가지 병목을 제거해 p95를 785ms에서 144ms로 줄인 기록입니다."
category: challenge
tags:
  - go-ti
  - Multi-Cloud
  - AWS
  - GCP
  - Latency
  - Cost
  - troubleshooting
series:
  name: "goti-multicloud"
  order: 10
date: "2026-04-19"
---

## 한 줄 요약

> 시연 1주일 전, 멀티클라우드 failover 계획을 접고 AWS 인프라를 전량 destroy했습니다. GCP-only로 단순화한 뒤 브라우저 실측 500~900ms의 지연을 추적해 DB 권한, 누락 테이블, CPU limits 세 가지 병목을 제거하니 p95가 785ms에서 144ms로 떨어졌습니다.

---

## 🔥 문제: 시연 1주일 전, 멀티클라우드를 접다

### 배경

오전 bring-up 세션에서 AWS 전체를 일회성 데모·검증 용도로 기동한 상태였습니다. 그러나 오후에 방침이 바뀌었습니다.

- 시연까지 남은 기간은 1주일
- 멀티클라우드 failover 시연 계획은 제외하기로 결정
- GCP 단일 리전으로 데모하면 운영이 단순해지고 비용이 $0에 수렴

결과적으로 AWS 인프라를 전량 destroy하고, 잔여 리소스까지 모두 cleanup하는 쪽으로 방향을 잡았습니다.

### 시연 구조 전환의 전제

멀티클라우드용으로 짜여있던 네트워크 경로는 시연 1주일 전에는 오히려 부담이었습니다.

| 시점 | 경로 |
|---|---|
| Before | 브라우저 → CF Edge(LAX) → Worker(LAX) → AWS/GCP failover → Seoul |
| After | 브라우저 → `gcp-api.go-ti.shop`(DNS Only) → 34.22.80.226 (GCP LB Seoul) |

의도는 명확했습니다. Cloudflare Edge의 Anycast가 한국 ISP 특성상 LAX로 잡히는 문제를 회피하고, 브라우저가 서울 리전의 GCP LB로 직접 붙도록 경로를 단순화하는 것입니다.

---

## 🤔 원인: 900ms 지연, 세 가지 겹친 병목

GCP-only 전환 후에도 브라우저 실측은 500~900ms가 지속됐습니다. 네트워크를 의심했지만 `curl`로는 60ms 수준으로 돌아왔습니다.

`gcp-api.go-ti.shop`을 DNS Only로 확인한 결과는 다음과 같습니다.

- Remote Address: 34.22.80.226
- server: `istio-envoy`
- `curl` 직접 측정: 약 60ms

네트워크는 빠른데 브라우저는 느립니다. Pod 내부 `latency_ms` 로그를 봤더니 p50 189ms, p95 785ms였습니다. 병목이 Pod 내부에 있었습니다.

### 원인 1 — `_ro` 유저의 쓰기 권한 부재

```
ERROR: permission denied for table game_seat_inventories (SQLSTATE 42501)
```

pg-primary VM의 `goti_ticketing_ro` 유저는 이름이 "ro"였지만, 실제 Go 앱이 sync 시 INSERT/UPDATE를 수행하는 구조였습니다.

VM 초기화 스크립트 `02-init-users.sql`이 `GRANT SELECT`만 부여했기 때문에, 앱이 쓰기를 시도할 때마다 42501로 실패했습니다. 이름은 읽기 전용이었지만 실제 앱 동작은 쓰기까지 요구한 것이 근본 원인입니다.

### 원인 2 — `pg_dump --exclude-table`로 빠뜨린 테이블

```
ERROR: relation "resale_listing_orders" does not exist (SQLSTATE 42P01)
```

2026-04-18 Cloud SQL → VM 이전 시 `pg_dump --exclude-table`로 "고아 테이블"이라 판단해 제외한 것이 있었습니다. 그러나 실제로는 Go 코드(`Goti-go/internal/resale/repository/listing_repo.go:172`)가 이 테이블을 참조 중이었습니다.

0 rows라는 사실이 곧 "코드에서 참조하지 않는다"를 의미하지 않습니다. 이 가정이 틀렸던 것입니다.

### 원인 3 — CPU limits 200m → CFS throttling

`kubectl top`으로 봤을 때 Pod CPU는 5~9m 수준이었습니다. 1% 미만, 사실상 idle입니다. 그런데 p50이 189ms였습니다. 단순 요청은 빠르지만 parallel 시 큐잉이 발생한다는 뜻입니다.

원인은 CPU limits였습니다.

- `resources.limits.cpu = 200m`
- Go 런타임의 `GOMAXPROCS`가 사실상 1로 수렴
- CFS 100ms 주기 중 20ms만 실행 가능

평균 사용률은 낮지만, 요청이 겹치는 순간 CFS throttling에 걸려 p95가 폭발했습니다.

---

## ✅ 해결: destroy → 경로 단순화 → 병목 제거

### Phase A — AWS 전량 destroy

기존 `destroy.sh`는 11 단계였는데, 이번 세션에서 새로 발견한 잔여물 대응을 포함해 13 단계로 확장했습니다. 경로는 `Goti-Terraform/terraform/prod-aws/destroy.sh`입니다.

추가한 4가지 처리는 다음과 같습니다.

- **S3 versioned 버킷**: `goti-prod-loki-chunks`에 delete marker 3701개가 남아있었습니다. `aws s3 rm --recursive`는 current version만 처리하기 때문에, 500개 chunk 단위로 `delete-objects` 배치를 돌려야 했습니다.
- **수동 SSM 28개**: `/prod/{svc}-go/*` 경로는 Terraform 관리 밖이라 `aws ssm delete-parameters`로 별도 삭제했습니다.
- **Harbor SG**: `sg-063f38465de1c092f`가 ALB SG의 inbound 규칙에서 참조되어 ALB SG destroy가 실패했습니다. `revoke-security-group-ingress`로 rule을 먼저 제거한 뒤 SG를 삭제했습니다.
- **Secrets Manager**: 7일 recovery window를 우회하기 위해 전수 force-delete를 적용했습니다.

실행 중 다음 이슈가 있었습니다.

| 단계 | 이슈 | 대응 |
|---|---|---|
| RDS destroy | SQS DNS `no such host` (transient) | 재시도로 복구 |
| EKS destroy | `aws_s3_bucket.loki_chunks` BucketNotEmpty | 500-slice delete-markers batch (3701개) |
| foundation destroy | ALB SG `DependencyViolation` | Harbor SG 수동 정리 후 재시도 |

최종 결과는 다음과 같습니다.

```
VPC            | 0
EC2 / EBS / EIP| 0
EKS / ALB / NAT| 0
RDS / Redis    | 0
SSM / Secrets  | 0 / 0
KMS custom     | 0 (PendingDeletion 만 잔존, 과금 없음)
S3 buckets     | 0 (terraform-state 포함 전량 삭제)
ECR repos      | 0 (이미지 전량 + repo 삭제)
Lambda / CWL   | 0
```

월 비용은 $0으로 수렴했습니다. 다만 `goti-terraform-state` S3까지 삭제했기 때문에, 향후 재구축 시에는 fresh state부터 시작해야 합니다.

### Phase B — GCP-only 시연 구조 전환

#### Cloudflare Worker 단순화

기존 `infra/cloudflare/multicloud-router.worker.js`는 296줄 규모로 멀티클라우드 routing, circuit breaker, metrics fanout을 담당했습니다. 이걸 전부 삭제하고 `goti-proxy.worker.js` 31줄만 남겼습니다. 역할은 GCP forward와 teamCode URL strip 두 가지뿐입니다.

배포는 `wrangler.toml`로 전환했습니다. Dashboard UI에서는 지원하지 않는 `placement.hint="apac"` 옵션을 써야 했기 때문에 `npx wrangler deploy`로 배포했습니다.

#### Frontend — teamCode 제거 (deploy/prod 전용)

- `Goti-front/src/shared/lib/bookingApiPath.ts`의 `shouldScopeBookingApiPath = !isMswEnabled` → `false` 강제
- develop 브랜치 영향은 없습니다. AWS 복구 시 develop merge로 원복 가능합니다.
- Pages env `PUBLIC_API_BASE_URL`을 `https://gcp-api.go-ti.shop`으로 변경(production)
- 빈 commit + push로 Pages rebuild를 트리거했습니다.

#### GCP Istio 정책 — CORS + OPTIONS 예외 + X-GR-BS

Cloudflare Proxy를 OFF로 하고 gcp-api에 직통하면 `go-ti.shop → gcp-api.go-ti.shop`이 cross-origin이 됩니다. CORS 처리가 필요했습니다.

| PR | 내용 |
|---|---|
| #292 | 7개 서비스 VirtualService에 `corsPolicy` 추가. allowOrigins: `go-ti.shop`, `www.go-ti.shop`. allowHeaders: Auth/Content-Type/X-Requested-With |
| #293 | `require-jwt` DENY 정책에 `notMethods: [OPTIONS]` 예외. preflight가 JWT 없이 오는데 DENY에 걸리던 문제 |
| #294 | allowHeaders에 `X-GR-BS` 추가 (Guardrail Bot Score custom header) |

세 가지를 모두 적용한 뒤 preflight가 정상 응답했습니다.

`OPTIONS /api/v1/stadium-seats/.../seat-grades` 응답:

- 200 OK (server: `istio-envoy`)
- `access-control-allow-origin: https://go-ti.shop`
- `access-control-allow-headers: Authorization, Content-Type, X-Requested-With, X-GR-BS`

### Phase C — Latency 최적화

원인 세 가지를 순서대로 제거했습니다.

**DB 쓰기 권한 복구**: K8s Job `pg-check-grant-v2-20260419`로 5개의 `_ro` 유저 × 6개 스키마에 대해 `GRANT SELECT,INSERT,UPDATE,DELETE`를 일괄 부여했습니다.

**누락 테이블 재생성**: Job `pg-create-resale-orders-20260419`로 `resale_service.resale_listing_orders`를 재생성하고, 2개의 index와 `_ro` 유저들에 GRANT를 함께 적용했습니다.

**CPU limits 상향**: Goti-k8s PR #295로 5개 서비스의 `limits.cpu`를 200m → 1000m, `limits.memory`를 128Mi → 256Mi로 올렸습니다. requests는 100m / 128Mi로 유지했습니다.

결과는 다음과 같습니다.

| 지표 | Before | After | 개선 |
|---|---|---|---|
| Pod p50 | 189ms | 18ms | 10× |
| Pod p95 | 785ms | 144ms | 5.5× |
| 브라우저 seat-statuses | 500-900ms | 93-279ms | 3-10× |
| queue/auth/pricing API | 200-300ms | 27-70ms | 4-10× |

### 최종 상태

시연 준비가 완료된 구성은 다음과 같습니다.

| 레이어 | 상태 |
|---|---|
| CF DNS | `gcp-api.go-ti.shop` A 34.22.80.226 DNS Only |
| CF Worker | `goti-prod-proxy` 31줄 GCP 프록시 (legacy 호환 용도) |
| CF Pages | `goti-front` — env `PUBLIC_API_BASE_URL=https://gcp-api.go-ti.shop` |
| GCP LB | 34.22.80.226 (asia-northeast3) |
| Istio | goti-shared-gateway + VS CORS + OPTIONS 예외 |
| Pod | CPU 1 core, 5 서비스 Running (Redis SoT hit rate 86%) |
| DB | pg-primary VM 10.2.3.218 + 권한/테이블 복구 완료 |
| Redis | Memorystore 10.195.173.91 (BASIC 1GB, latency 1ms) |

AWS는 전량 destroy로 월 비용 $0을 달성했습니다.

---

## 📝 남은 잔재와 TODO

### 정상 에러 (버그 아님)

- POST `/api/v1/resales/listings` 400 응답 중 `LISTING_ALREADY_CLOSED`는 "경기 시작 1시간 전부터 리셀 등록 불가"라는 의도된 비즈니스 제약입니다.

### 알려진 warning (시연에 영향 없음)

- OTel exporter timeout: `name resolver error: produced zero addresses`. GCP에 모니터링 스택이 미배포 상태라 발생합니다. 앱 로그만 남깁니다.
- WARN `reconcile: inv overwritten from seat hash, driftRatio 0.2`. Redis inventory와 seat hash 재동기화 과정에서 pg-primary 재구축 후 초기 drift로 발생합니다. 시간이 지나면 수렴합니다.

### 데이터 이슈 (시연 후 차순위)

- `orders` / `payments` 테이블 PK 충돌로 pglogical 미복제 상태입니다. AWS shutdown 전 Phase B 상태 그대로이며, 현재 AWS가 없으니 무의미합니다.
- `pglogical_repl` password 노출 이력이 있어 rotation이 필요합니다. AWS 재기동 시 처리 예정입니다.

### 향후 이슈

- 경기 시간이 UTC로 잘못 표시되는 현상이 있어, 다음 세션에서 별도로 처리할 예정입니다.

---

## 📚 배운 점

### 1. `_ro` naming과 실제 권한은 일치하지 않을 수 있습니다

"read-only" 접미사만 보고 실제 앱 동작 확인을 건너뛰었습니다. naming 규약과 실제 권한 매트릭스를 자동 검증하는 스크립트가 필요합니다.

### 2. `pg_dump --exclude-table`은 위험합니다

"고아 테이블"이라 판단하기 전에 코드베이스 grep이 필수입니다. **0 rows는 참조 없음과 다릅니다**. 사용 흔적이 데이터가 아니라 코드에 있을 수 있습니다.

### 3. Go Pod CPU limits 하한은 1 core 이상이 안전합니다

한 자리 퍼센트 사용률이어도 limits가 낮으면 CFS throttling으로 p95가 폭발합니다. Go 런타임은 `GOMAXPROCS`가 CPU limits에 연동되기 때문에, 200m 같은 값은 사실상 싱글 스레드 강제와 같은 효과를 냅니다. GKE core 노드 캐패시티 재설계가 따라옵니다.

### 4. Cloudflare DNS Only가 한국 latency의 정답일 수 있습니다

LAX Edge 라우팅 이슈는 Smart Placement로도 완전히 해결되지 않습니다. CF 보호를 포기하고 origin 직통으로 전환하면 급격한 개선이 나옵니다(900ms → 60ms). 시연 구간에서는 보호보다 지연이 우선이었습니다.

### 5. Worker 코드 복잡도는 latency에 선형으로 영향을 주지 않습니다

Worker 실행 위치(PoP)가 훨씬 지배적입니다. 296줄 → 31줄 자체의 절감은 50~100ms 수준이었습니다. 큰 지연은 로직이 아니라 경로에서 나옵니다.
