# Java→Go cutover smoke 진행 중 추가 수정 3건 + inventory drift rebuild

날짜: 2026-04-13 (Phase 8 P0 후속 잔여 4건 dev-log 다음, 같은 세션)
환경: AWS prod (EKS goti ns)
관련:
- `docs/dev-logs/2026-04-13-phase8-p0-seat-booking-port.md` (P0 본체)
- `docs/dev-logs/2026-04-13-go-cutover-residual-fixes.md` (잔여 4건)
- `docs/dev-logs/2026-04-13-orphan-stadium-cleanup.md` (seed 5건 정리)

---

## 요약

Phase 8 P0 + 잔여 4건 배포 후 smoke 재시도하면서 추가로 3건 발견 + inventory cache drift 정리. 배포 이미지 흐름:

prod-13 (P0) → 14 (display_color_hex) → 15 (seat-statuses 응답) → 16 (is_available) → 17 (refresh cookie + reissue 분기 로깅) → 18 (queueTokenJti alias) → **19 (trailing slash route)**

| # | 증상 | 근본 원인 | 수정 | 커밋 |
|---|---|---|---|---|
| 5 | hold 400 BadRequest (빈 좌석 클릭) | 프론트가 `queueTokenJti` 키로 전송, Go 는 `queueToken` 만 인식 | DTO JSON 태그를 `queueTokenJti` 로 변경 (Java 의 `@JsonAlias` 와 동일 동작) | `82733e7` |
| 6 | order 502 Bad Gateway (CF "request with one-time-use body...redirect") | gin Group POST("/") → 308 redirect → axios stream body 재전송 불가 | trailing slash 그룹 경로(`POST("/", ..)`) 5곳을 `POST("", ..)` 로 변경 | `a3ab08b` |
| 7 | seat-grades 의 availableSeatCount 가 실제와 큰 drift (a5cdd8 게임 24,020 vs 실제 8,395) | step5 inventory cache 가 step2b SOLD seed 적용 *전* 시점 기준으로 채워짐 + 운영 코드의 외부 SQL 변경은 inventory_sync_service 안 거침 | step5 본체(검증 SELECT 제외) 재실행으로 1,510 게임 13,182 row UPDATE | (운영 데이터 fix, 코드 변경 없음) |

---

## 5. queueTokenJti alias

위 dev-log (잔여 4건) 의 패턴 연속. Java `HoldSeatRequest` 가 `@JsonAlias("queueTokenJti") String queueToken` 로 두 키 모두 수용하지만, Go 는 단일 JSON 태그만. 프론트(`useSeatHoldActions.ts`) 는 alias 키만 사용.

근거 (프론트):
```ts
// useSeatHoldActions.ts:150
{ queueTokenJti: bookingEntryState.queueTokenJti }
```

근거 (Java):
```java
// HoldSeatRequest.java
@JsonAlias("queueTokenJti")
String queueToken
```

수정: Go DTO 의 JSON 태그 변경
```go
QueueToken string `json:"queueTokenJti" binding:"required"`
```

값 자체는 jti 만이 아니라 full JWT (Java 와 동일하게 `tokenProvider.Parse` 로 디코딩). 변수명만 잘못된 통념. P2 에서 명확화.

## 6. trailing slash 308 redirect → 502

증상: `POST /api/v1/orders` 에서 Cloudflare 가 502 + 메시지
> "A request with a one-time-use body... encountered a redirect requiring the body to be retransmitted."

원인 chain:
1. gin `Group("/api/v1/orders")` + `POST("/", ...)` → 실제 라우트는 `/api/v1/orders/` (trailing slash 포함)
2. 클라이언트(axios)는 `POST /api/v1/orders` (slash 없음) 호출
3. gin 기본 `RedirectTrailingSlash=true` → 308 응답
4. axios/fetch 의 stream body (Request body 가 ReadableStream 으로 한 번 소비되는 케이스) 는 redirect 시 재전송 불가 → 에러
5. CF/proxy layer 가 502 로 변환

영향 범위 (5곳):
- `cmd/ticketing/main.go`: orders POST, games POST, pricing POST, pricing GET
- `cmd/payment/main.go`: payments/resales POST

수정: 모두 `POST("", ...)` / `GET("", ...)` 로 변경 (group base 자체에 매핑). Java `@PostMapping("/api/v1/orders")` 와 동일하게 trailing slash 없는 정식 경로.

회고 추가 (잔여 4건 dev-log 의 회고에 보강):
- gin Group + POST("/") 패턴은 Java Spring `@RequestMapping("/x") + @PostMapping("/")` 와 다르게 trailing slash 강제 → 환경(특히 프록시/CDN) 에 따라 호환성 문제
- Go 코드 작성 시 group root 경로는 항상 `POST("")` 사용. lint 규칙화 검토.

## 7. inventory cache drift rebuild

### 진단 (a5cdd8b5 게임)

| grade | inv_avail (캐시) | real_avail (seat_statuses COUNT) | drift |
|---|---|---|---|
| 응원특별석 | 3000 | 1064 | +1936 |
| K5석 | 2520 | 655 | +1865 |
| 훼미리석 | 1800 | 247 | +1553 |
| ... | ... | ... | ... |
| **합** | **24,020** | **8,395** | **+15,625** |

### 근본 원인

1. **seed 순서**: step4 가 모든 좌석 AVAILABLE 채움 → step5 가 그 시점 기준 inventory cache 채움 → step2b 가 80% SOLD 로 덮어씀. step5 는 step2b 이후 다시 안 돌아감.
2. **운영 시 외부 SQL 변경 → inventory_sync 안 거침**: `InventorySyncService.SyncDirtyGames` 가 5초마다 Redis dirty flag 기반 PG 동기화. 외부 SQL (red team 시뮬레이션, seed) 은 Redis dirty 안 마킹 → 영구 drift.

### 조치

step5 SQL 본체(BEGIN ~ DO $$ END $$ ~ COMMIT) 만 추출해서 재실행:
- 처음 시도: `psql -v ON_ERROR_STOP=1` 으로 실행 → 마지막 검증 SELECT 가 `JOIN stadium_service.stadiums` 에서 권한 부족 (cross-schema) → transaction abort → ROLLBACK
- 두 번째: head -137 로 검증 섹션 제거 + `DROP TABLE ... COMMIT;` 명시 → 13,182 row UPDATE 성공, COMMIT
- 소요: 32초

검증:
- a5cdd8 게임 grade 별 drift = 0
- 전체 inventory total available = 21,174,595 = 실제 seat_statuses AVAILABLE 카운트 (완벽 일치)

### "한 번 맞추면 계속 정확?" 에 대한 답

**조건부 Yes**:
- 운영 코드 (hold/order_confirm/order_cancel/seat_hold_expiry) 는 Redis 업데이트 + dirty 마킹 → `InventorySyncService.SyncDirtyGames` 가 5초 간격으로 Redis → PG 동기화 → PG inventory 자동 정확 유지.
- **단 외부 SQL/seed 직접 수정은 sync 안 됨** (Redis dirty flag 안 거치므로). 그런 경우 본 rebuild 같은 수동 재계산 필요.
- **Redis FLUSHALL 후 주의**: Redis cache 비어있는 상태에서 첫 hold 가 increment/decrement → 0 에서 감산 → 음수. 부하 테스트 시작 전 Redis inventory 초기 로드 메커니즘 별도 확인 필요 (현재 미확인). 후속 TODO.

### 근본 개선 TODO (P1/P2)

1. **read 경로를 Redis 1차로 변경** — PG 는 sync target / cold storage 로만. drift 자체 무력화 (메모리 C3)
2. **Redis 초기 로드 보장** — FLUSHALL 후 첫 호출 시 PG 에서 reload 또는 명시 init endpoint
3. **seed 파이프라인 순서 보정** — step5 는 step2b 이후 또는 별도 step7 로 분리
4. **inventory drift CI check** — 부하 테스트 시작 전 sanity check 자동화 (drift > N% → block)

---

## 빌드 / 배포 (커밋 5,6)

- `82733e7` (queueTokenJti alias) → prod-18
- `a3ab08b` (trailing slash) → prod-19
- 두 건 모두 `go build ./... + go vet ./...` exit 0
- Goti-k8s 자동 PR 머지 후 ArgoCD sync (`kubectl annotate refresh=hard`)

---

## 회고 (이번 세션 누적 11건)

| 카테고리 | 건수 | 사례 |
|---|---|---|
| Java↔Go 계약 불일치 (필드명/포맷) | 5 | OAuth env, JSON field 명, JWT issuer, queueTokenJti alias, datetime |
| Java↔Go DB schema mismatch | 2 | display_color_hex, is_available |
| Java↔Go 인프라 설정 (cookie/route) | 2 | SameSite=Strict, trailing slash redirect |
| viper config 누락 | 2 | RSA key SetDefault, scheduler env |
| 데이터 정합성 (seed 잔재 / cache drift) | 2 | orphan stadium 5건, inventory cache rebuild |

→ "환경 diff" 검증으로는 못 잡는 코드 자체 결함 (DB schema mismatch, JSON contract) 이 절반. P2 의 contract test / schema validation CI 가 우선순위.

→ trailing slash 같은 인프라 차이는 표면적이지만 발생 빈도 높으므로 lint rule 으로 박는 게 효율.
