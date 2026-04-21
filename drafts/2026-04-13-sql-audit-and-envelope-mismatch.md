# SQL 전수 audit + 응답 envelope mismatch (cutover 후속 5건)

날짜: 2026-04-13 (cutover smoke trail 이어서)
환경: AWS prod (EKS goti ns)
관련:
- `docs/dev-logs/2026-04-13-cutover-smoke-trail-fixes.md` (이전 cycle, residual 4건)
- `docs/dev-logs/2026-04-13-go-cutover-residual-fixes.md`
- `docs/dev-logs/2026-04-13-phase8-p0-seat-booking-port.md`

---

## 배경

마이페이지 (purchases/listings/orders) 진입 시 500 다발. 같은 패턴 (DB schema mismatch / envelope 불일치) 이 prod-12 (cutover 직후) 부터 prod-28 까지 8 사이클 누적. 사용자 요청으로 SQL 컬럼/테이블 전수 audit 진행 + 추가 발견.

---

## 추가 발견 5건 (이번 사이클)

| # | 파일 | 잘못 | 정정 | 이미지 |
|---|---|---|---|---|
| 8 | `ticketing/handler/order_handler.go` (memberId bind) | gin form binding 이 uuid.UUID TextUnmarshaler 호출 안 함 → zero UUID + required reject → 400 | mustQueryUUID 명시 parse 후 req 주입 | prod-25 (`e9e1bf4`) |
| 9 | `ticketing/repository/ticket_repo.go::FindByOrderIDs` | `JOIN seats s ... LEFT JOIN seat_grades sg ON sg.id = s.seat_grade_id` (seats 에 seat_grade_id 없음) | `seat_sections sec` 추가 join 후 `sg.id = sec.grade_id` | prod-26 (`a69d504`) |
| 10 | `ticketing/repository/game_repo.go::SaveStatus` | INSERT `status` (실 컬럼 game_status). FindStatusByGameID/FindStatusesByGameIDs SELECT 는 game_status 였으나 INSERT 만 누락 | `status` → `game_status` | prod-27 (`b82aae9`) |
| 11 | `ticketing/repository/ticket_freeze_repo.go::FindActiveByTicketID` | SELECT `reason` (실 컬럼 freeze_reason) | `reason` → `freeze_reason` | prod-27 (`b82aae9`) |
| 12 | `payment/infra/resale_client.go::GetPurchases` | resale 응답 envelope `{list, totalCount, totalPages}` 인데 client 가 단순 `[]ResalePurchaseListItem` 으로 unmarshal → object → array 변환 실패 | paged 임시 struct 로 받아 List 반환 | prod-28 (`82159d8`) |

---

## DDL 적용 2건 (테이블 부재)

| 테이블 | 영향 endpoint | DDL apply 시점 |
|---|---|---|
| `resale_service.resale_listing_orders` | `/api/v1/resales/listings/orders` | 14:0x UTC |
| `user_service.addresses` | 마이페이지 주소 조회/저장 | 14:1x UTC |

두 테이블 모두 Java entity 정의되어 있지만 prod migration 누락 (JPA `ddl-auto=none/validate` 추정). DDL 은 master role (`goti`) 로 apply, 서비스 role (`goti_resale_svc`, `goti_user_svc`) 에 GRANT.

스키마 (Java entity 기준):
```
resale_listing_orders: id PK, order_number unique, seller_id, grade_id, order_status, created_at, updated_at
addresses: id PK, member_id unique, zip_code, base_address, detail_address, created_at, updated_at
```

---

## SQL 전수 audit 결과 (Explore agent)

29 repository 파일 검사. service 별:

| Service | Mismatch | 비고 |
|---|---|---|
| ticketing | 2 (game_statuses INSERT, ticket_freezes SELECT) | 위 #10, #11 |
| resale | 0 (단 listing_orders 테이블 부재 — 별건) | DDL 로 해결 |
| payment | 0 (단 resale envelope mismatch — 별건) | 위 #12 |
| stadium | 0 | clean |
| user | 1 (addresses 테이블 부재) | DDL 로 해결 |
| queue | Redis 기반 | 해당 없음 |

### audit이 못 잡은 클래스

1. **응답 envelope mismatch** (#12) — SQL 컬럼이 아니라 service-to-service 계약 불일치. 별도 contract test 필요.
2. **gin binding 한계** (#8) — DTO field 형태 (uuid.UUID + form tag + binding) 가 런타임에 zero value 로 reject. 정적 분석으로 잡기 어려움. 패턴: cross-service 호출 시 query/path UUID 는 mustQueryUUID/mustPathUUID 로 명시 parse.
3. **JOIN alias 잘못** (#9) — seats 에 grade 직접 컬럼이 없는데 alias 만 보고 자동 검사로는 어려움. 수동 분석.

---

## 누적 통계 (이번 세션 모든 fix)

prod 이미지 흐름: prod-12 (cutover) → 13 (Phase 8 P0) → 14~28 (residual+audit fix 16개)

| 카테고리 | 건수 | 사례 |
|---|---|---|
| Java↔Go 계약 (필드명/포맷/엔벨롭) | 6 | OAuth env, JSON field, JWT issuer, queueTokenJti alias, datetime, resale paged envelope |
| Java↔Go DB schema (컬럼명/JOIN) | 7 | display_color_hex, is_available, orderers.mobile, tickets.issued_at, ticket_repo seat_grade_id JOIN, game_statuses INSERT, ticket_freezes |
| Java↔Go DB schema (테이블 부재) | 2 | resale_listing_orders, addresses |
| Java↔Go 인프라 (cookie/route) | 2 | SameSite=Strict, trailing slash redirect |
| viper config 누락 | 2 | RSA key SetDefault, scheduler env |
| 데이터 정합성 (seed/cache) | 2 | orphan stadium 5건, inventory cache rebuild |
| 인프라 (Redis lazy init) | 1 | NOT_INITIALIZED 자동 복구 |
| 성능 hotpath | 2 | seat-statuses LEFT JOIN, sectionId 제거 |
| 핸들러 binding | 1 | memberId mustQueryUUID |

총 **23건**.

---

## 근본 개선 우선순위 재정리 (P1 SDD 후보)

1. **Java OpenAPI → Go DTO contract test CI** — 계약 6건 + envelope 1건 모두 catch 가능. 가장 ROI 높음.
2. **DB schema → Go SQL static check** — atlas / sqlc / migration validation. 컬럼 mismatch 7건 모두 catch.
3. **DB migration prod 일관성 검증** — Java entity vs prod schema diff CI. 테이블 부재 2건 catch.
4. **service 별 DB role permission audit** — DDL apply 시 master role 필요했던 점 보면 권한 분리 자체는 잘 되어 있음. 다만 신규 테이블 GRANT 자동화 필요.
5. **gin binding 가이드 정립** — uuid.UUID + form binding 패턴 금지, mustQueryUUID 강제 lint rule.
6. **client 별 응답 envelope contract test** — handler response.Page vs response.Success 차이를 client side test 로 보장.

---

## 후속 TODO (smoke 후 정리)

부하 테스트 직전 필수:
- [x] inventory cache rebuild (PG)
- [ ] Redis FLUSHALL 재실행 (smoke 잔재 정리) — 자동 lazy init 동작 확인 (prod-22)
- [ ] Kyverno admission-controller replicas=1 복원
- [ ] Prometheus memory 2Gi 커밋
- [ ] CF Edge cache 적용 (`docs/dx/0002-seat-status-hotpath-perf.md` D)

미해결 인프라 작업 (별도 SDD):
- [ ] Java OpenAPI freeze + Go contract test
- [ ] DB migration validation CI
- [ ] queue cleanup 자동화 4건 (선행 dev-log 참조)

---

## 회고 강조

이번 세션 23건 fix 중 70% 가 **JPA 가 자동 처리하던 것을 Go 로 직접 작성하면서 누락**된 케이스. Java 시절에는 entity 정의만으로 컬럼명/SQL/응답 envelope 모두 처리되었지만 Go 는 SQL/JSON 양쪽 모두 명시. 이 차이가 cutover 시 표면화. 

**교훈**: 다음 서비스 Go 포팅 시 entity 추출 + 컬럼/응답 contract 자동 비교 도구를 prepare phase 에 우선 도입.
