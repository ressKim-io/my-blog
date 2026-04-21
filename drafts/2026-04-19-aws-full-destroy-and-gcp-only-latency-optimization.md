# 2026-04-19 AWS 전량 Destroy + GCP-only 시연 구조 전환 + Latency 최적화

- 세션 기간: 2026-04-19 10:30 ~ 14:00 KST (약 3.5시간)
- 전제: [오전 bring-up 세션](./2026-04-19-aws-bringup-harbor-to-ecr.md) 종료 후 곧바로 "시연은 GCP only 로" 방침 확정
- 연관 PR: Goti-k8s #291~#295, Goti-go #8, Goti-front deploy/prod 직접 commit, controller 직접 commit
- 연관 메모리:
  - `project_aws_cost_freeze_gcp_only` (전면 개편)
  - `project_cloudflare_multicloud_worker` (전면 개편)
  - `reference_gcp_db_grants_and_orphan_tables` (신규)
  - `reference_gcp_pod_cpu_throttling` (신규)

## 1. 배경

오전 bring-up 에서 AWS 전체를 **일회성 데모/검증** 용도로 기동. 이후 방침:

- 시연 1주일 남았고 멀티클라우드 failover 시연 계획 제거
- GCP 단일로 데모 → 운영 단순화 + 비용 $0
- AWS 인프라 전량 destroy, 잔여 리소스도 전부 cleanup

## 2. Phase A — AWS 전량 destroy

### 2.1 destroy.sh 보강

기존 destroy.sh 는 11 단계. 이번 세션에서 발견한 새 잔여물 대응:

1. **S3 versioned 버킷 (`goti-prod-loki-chunks` 3701개 delete marker)**: `aws s3 rm --recursive` 는 current version 만. 500개 chunk 단위로 `delete-objects` 배치 필요.
2. **수동 SSM 28개** (`/prod/{svc}-go/*`): Terraform 관리 밖. `aws ssm delete-parameters` 별도.
3. **Harbor SG (sg-063f38465de1c092f)**: `alb-sg` 에 inbound 규칙 참조 → ALB SG destroy 실패. `revoke-security-group-ingress` 로 rule 제거 후 SG 삭제.
4. **Secrets Manager 전수 force-delete**: 7일 recovery window 우회.

보강 후 13 단계로 확장 (`destroy.sh` 경로: `Goti-Terraform/terraform/prod-aws/destroy.sh`).

### 2.2 실행 중 이슈

| 단계 | 이슈 | 대응 |
|---|---|---|
| RDS destroy | SQS DNS `no such host` (transient) | 재시도로 복구 |
| EKS destroy | `aws_s3_bucket.loki_chunks` BucketNotEmpty | 500-slice delete-markers batch (3701개) |
| foundation destroy | ALB SG `DependencyViolation` | Harbor SG 수동 정리 후 재시도 |

### 2.3 결과

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

**월 비용 $0**. 다만 `goti-terraform-state` S3 삭제로 향후 재구축 시 fresh state 부터.

## 3. Phase B — GCP-only 시연 구조 전환

### 3.1 네트워크 경로 재설계

멀티클라우드용 복잡 경로 → 단순 직통:

```
Before: 브라우저 → CF Edge (LAX!) → Worker (LAX) → AWS/GCP failover → Seoul
After:  브라우저 → gcp-api.go-ti.shop (DNS Only) → 34.22.80.226 (GCP LB Seoul)
```

**의도**: Cloudflare Edge (Anycast 가 한국 ISP 특성상 LAX 로 잡힘) 자체를 우회.

### 3.2 작업 목록

#### 3.2.1 Cloudflare Worker 단순화

- `infra/cloudflare/multicloud-router.worker.js` (296줄, 멀티클라우드 routing + circuit breaker + metrics fanout) 삭제
- `goti-proxy.worker.js` (31줄) 신규: GCP forward + teamCode URL strip 만
- `wrangler.toml` 도입 — `placement.hint="apac"` (Dashboard UI 미지원 옵션). `npx wrangler deploy` 로 배포.

#### 3.2.2 Frontend — teamCode 제거 (deploy/prod 전용)

- `Goti-front/src/shared/lib/bookingApiPath.ts` 의 `shouldScopeBookingApiPath = !isMswEnabled` → **`false` 강제**
- develop 브랜치 영향 없음. AWS 복구 시 develop merge 로 원복.
- Pages env `PUBLIC_API_BASE_URL = https://gcp-api.go-ti.shop` 로 변경 (production)
- 빈 commit + push 로 Pages rebuild 트리거.

#### 3.2.3 GCP Istio 정책 — CORS + OPTIONS 예외 + X-GR-BS

CF Proxy OFF 로 gcp-api 직통하면 `go-ti.shop → gcp-api.go-ti.shop` = cross-origin. CORS 처리 필요.

| PR | 내용 |
|---|---|
| #292 | 7개 서비스 VS `corsPolicy` 추가. allowOrigins: `go-ti.shop`, `www.go-ti.shop`. allowHeaders: Auth/Content-Type/X-Requested-With |
| #293 | `require-jwt` DENY 정책에 `notMethods: [OPTIONS]` 예외. preflight 가 JWT 없이 오는데 DENY 에 걸리던 문제 |
| #294 | allowHeaders 에 **`X-GR-BS`** 추가 (Guardrail Bot Score custom header) |

### 3.3 작동 확인

```
OPTIONS /api/v1/stadium-seats/.../seat-grades
→ 200 OK (server: istio-envoy)
→ access-control-allow-origin: https://go-ti.shop
→ access-control-allow-headers: Authorization, Content-Type, X-Requested-With, X-GR-BS
```

## 4. Phase C — Latency 최적화

브라우저 실측 500-900ms 지속 → 원인 추적.

### 4.1 진단

- `gcp-api.go-ti.shop` DNS Only 확인: Remote Address `34.22.80.226`, `server: istio-envoy` ✅
- curl 직접 측정: **~60ms** (네트워크는 빠름)
- Pod 내부 `latency_ms` 로그: **p50 189ms, p95 785ms** ← 병목

### 4.2 원인 1 — DB 쓰기 권한 부재 (ticketing_service.game_seat_inventories)

```
ERROR: permission denied for table game_seat_inventories (SQLSTATE 42501)
```

- pg-primary VM 의 `goti_ticketing_ro` user 는 이름이 "ro" 지만 **실제 Go 앱이 sync 시 INSERT/UPDATE 수행**
- VM 초기화 스크립트 `02-init-users.sql` 이 `GRANT SELECT` 만 부여했던 것
- K8s Job `pg-check-grant-v2-20260419` 로 5 ro users × 6 schemas 일괄 `GRANT SELECT,INSERT,UPDATE,DELETE`

### 4.3 원인 2 — 누락 테이블 (resale_service.resale_listing_orders)

```
ERROR: relation "resale_listing_orders" does not exist (SQLSTATE 42P01)
```

- 2026-04-18 Cloud SQL → VM 이전 시 `pg_dump --exclude-table` 로 제외했던 "고아 테이블" 이 실제로는 Go 코드 (`Goti-go/internal/resale/repository/listing_repo.go:172`) 참조 중
- Job `pg-create-resale-orders-20260419` 로 재생성 + 2 indexes + ro users 에 GRANT

### 4.4 원인 3 — CPU limits 병목 (CFS throttling 의심)

- `kubectl top`: pod CPU 5-9m (1% 미만, idle)
- 그런데 p50 189ms. 단순 요청은 빠르지만 parallel 시 큐잉
- 원인: `resources.limits.cpu = 200m` → Go 런타임 GOMAXPROCS~=1 + CFS 100ms 중 20ms only
- **Goti-k8s PR #295**: 5 서비스 limits.cpu 200m → 1000m, memory 128Mi → 256Mi, requests 는 100m/128Mi

결과:

| 지표 | Before | After | 개선 |
|---|---|---|---|
| Pod p50 | 189ms | **18ms** | 10× |
| Pod p95 | 785ms | **144ms** | 5.5× |
| 브라우저 seat-statuses | 500-900ms | **93-279ms** | 3-10× |
| queue/auth/pricing API | 200-300ms | **27-70ms** | 4-10× |

## 5. 최종 상태 요약

**시연 준비 완료**:

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

**AWS**: 전량 destroy ($0/월)

## 6. 남은 잔재 / TODO

### 6.1 정상 에러 (버그 아님)

- POST `/api/v1/resales/listings` 400: `LISTING_ALREADY_CLOSED` "경기 시작 1시간 전부터 리셀 등록 불가" — 의도된 비즈니스 제약.

### 6.2 알려진 warnings (시연에 영향 없음)

- OTel exporter timeout: `name resolver error: produced zero addresses` — GCP 에 모니터링 스택 미배포 상태. 앱 로그만 남김.
- WARN: `reconcile: inv overwritten from seat hash, driftRatio 0.2` — Redis inventory vs seat hash 재동기화. pg-primary 재구축 후 초기 drift. 시간 지나면 수렴.

### 6.3 데이터 이슈 (시연 후 차순위)

- `orders` / `payments` 테이블 PK 충돌로 pglogical 미복제 상태 (AWS shutdown 전 Phase B 상태 그대로, 현재 AWS 없으니 무의미)
- `pglogical_repl` password 노출 이력 → rotation (AWS 재기동 시 처리)

### 6.4 향후 이슈 

- **경기 시간이 UTC 로 잘못 표시**되는 현상 → 다음 세션에서 별도 처리 예정

## 7. 교훈

1. **`_ro` naming 과 실제 권한 불일치** — "read-only" 접미사만 보고 실제 앱 동작 확인 안 함. naming 규약 + 실제 권한 매트릭스 자동 검증 스크립트 필요.
2. **pg_dump --exclude-table 은 위험** — "고아" 판단 전 코드베이스 grep 필수. 0 rows ≠ 참조 없음.
3. **Go pod CPU limits 하한은 1 core 이상** — 한 자리 % 사용률이어도 limits 낮으면 CFS throttling 으로 p95 폭발. GKE core 노드 캐패시티 재설계 필요.
4. **Cloudflare DNS Only 가 한국 latency 정답** — LAX Edge 라우팅 이슈는 Smart Placement 로도 완전 해결 불가. 대신 CF 보호 포기 + origin 직통으로 급격한 개선 (900ms → 60ms).
5. **Worker 코드 복잡도는 latency 에 선형 영향 아님** — Worker 실행 위치 (PoP) 가 더 지배적. 296줄→31줄 자체는 ~50-100ms 절감 정도.
