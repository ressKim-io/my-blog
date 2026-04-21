# 2026-04-19 경기 시간 UTC 표시 이슈 근본 수정 — Java↔Go JSON 계약 정합

## 요약

프론트에서 경기 시간이 UTC로 표시 (예: `18:30 KST` 경기가 `03:30` 또는 `Z` 접미사 포함 UTC 로 노출)되던 이슈를 Goti-go 응답 DTO 전수에 대해 근본 수정.

- **근본 원인**: Java 원본은 `LocalDateTime + @JsonFormat("yyyy-MM-dd HH:mm")`로 offset 없는 wall-clock 문자열을 내려 프론트가 로컬(KST)로 해석하는 반면, Go 포팅은 `time.Time` 기본(RFC3339Z) 또는 `response.InstantTime`(ISO8601Z) 으로 내려 프론트가 UTC로 파싱.
- **해결**: Java 계약과 일치하는 JSON wrapper 3종을 추가하고, Java 원본에서 `@JsonFormat` 이 걸린 모든 응답/내부 DTO 필드를 매핑해 수정.
- **부수 효과**: Java 원본에 잠재 버그로 남아있던 `Instant + @JsonFormat(pattern, timezone 미지정)` 필드들(UTC wall-clock 출력)을 동시에 KST로 교정.

## 증상

| 필드 | Go 기본 출력 | 프론트 `new Date()` 결과 |
|------|--------------|--------------------------|
| `startAt` (경기 시작) | `2026-04-20T18:30:00Z` | KST 03:30 (다음날) — **9시간 밀림** |
| `orderedAt` (주문 시각) | `2026-04-20T09:30:00.123Z` | 18:30 이 나와야 하는데 09:30 그대로 |
| `gameDate` (티켓의 경기일) | 동일 | 동일 |

## 근본 원인

1. **DB 저장 형태 불일치**: `game_schedules.start_at` = `TIMESTAMP WITHOUT TIME ZONE`. seed 시점에 KST wall-clock 그대로 `'2026-04-20 18:30'::TIMESTAMP` 로 저장. pgx 는 이를 `time.Time(location=UTC)` 로 읽어 Go 타임존 메타데이터만 UTC 로 붙음 (값 자체는 변하지 않음).
2. **Java Jackson 출력**: `LocalDateTime + @JsonFormat("yyyy-MM-dd HH:mm")` → `"2026-04-20 18:30"`. 프론트 `new Date("2026-04-20 18:30")` → **로컬타임(KST)** 로 해석 ✅
3. **Go encoding/json 기본**: `time.Time` 의 `MarshalJSON` 은 RFC3339Nano → `"2026-04-20T18:30:00Z"`. 프론트 `new Date("...Z")` → **UTC** 로 해석 → KST 변환 시 +9h → 다음날 03:30 표기 ❌
4. **Goti-go 내 기존 InstantTime wrapper**: Java `Instant` 호환 (UTC Z suffix ISO8601). Java 에서 `LocalDateTime + pattern` 필드는 이 포맷이 맞지 않음.

## 변경 사항

### pkg/response/time.go — wrapper 3종 추가 (1 커밋)

| 타입 | 출력 포맷 | 대응 Java |
|------|-----------|-----------|
| `LocalDateTime` | `2006-01-02 15:04` (wall-clock, location 무시) | `LocalDateTime + @JsonFormat("yyyy-MM-dd HH:mm")` |
| `LocalDateTimeSeoul` | UTC → KST 변환 후 `2006-01-02 15:04` | `Instant + @JsonFormat(pattern, timezone="Asia/Seoul")` |
| `LocalDate` | `2006-01-02` | `LocalDate + @JsonFormat("yyyy-MM-dd")` |

`Scan` (pgx), `MarshalJSON`, `UnmarshalJSON` 전부 구현 → pgx 스캔, 응답 직렬화, 서비스 간 역직렬화까지 지원. 기존 `InstantTime` 은 유지 (본격적으로 UTC ISO8601 이 필요한 경우 대비).

### 수정 범위 (5 커밋, 16 파일)

| 커밋 | 영역 | 핵심 필드 |
|------|------|-----------|
| `feat(response)` | `pkg/response/time.go` | wrapper 3종 |
| `fix(ticketing/game)` | dto_game + game_service + game_search_service | StartAt, TicketingOpenedAt, TicketingEndAt |
| `fix(ticketing/ticket)` | dto_ticket + ticket_info_service + ticket_resale_service | GameDate, UsedAt, IssuedAt(KST), ExpiresAt |
| `fix(ticketing)` | dto_order/seat/pricing + order/pricing service + stadium_seat_handler | RefundAt, OrderedAt(KST), GameDate, SessionExpiresAt(KST), PolicyStartAt/EndAt(LocalDate) |
| `fix(payment)` | payment/domain/dto + payment/infra/ticketing_client + resale_client | PaidAt(KST), PurchaseSearchResponse 전체, 내부 역직렬화 DTO 동기화 |
| `fix(resale)` | resale/domain/dto | ListedAt/SoldAt/CanceledAt(KST), ResalePurchaseList 전체, PriceHistory |

### `TicketInfoResponse` 예외

Goti-go 내부 서비스 간 HTTP 호출 (`ticketing → resale`) 전용 DTO 는 `time.Time` (RFC3339) 그대로 유지. Go encoder/decoder 양쪽 모두 같은 기본 동작을 쓰므로 계약 일치.

## Before / After

### 요청: `GET /api/v1/games/schedules`

**Before**
```json
{
  "gameId": "...",
  "startAt": "2026-04-20T18:30:00Z",
  "ticketingOpenedAt": "2026-04-20T17:30:00Z"
}
```
프론트가 UTC 로 파싱 → KST 변환 시 다음날 03:30 로 밀림.

**After**
```json
{
  "gameId": "...",
  "startAt": "2026-04-20 18:30",
  "ticketingOpenedAt": "2026-04-20 17:30"
}
```
프론트 `new Date("2026-04-20 18:30")` → 로컬(KST) 18:30 표시 ✅

### smoke test 결과

```
LocalDateTime(UTC time 18:30): "2026-04-20 18:30"
LocalDateTimeSeoul(UTC 09:30): "2026-04-20 18:30"   # +9h KST 변환
LocalDate:                     "2026-04-20"
LocalDateTime round-trip:      "2026-04-20 18:30"
LocalDateTime zero:            null
```

## 검증

- `go build ./...` — PASS
- `go test ./internal/ticketing/... ./internal/payment/... ./internal/resale/... ./pkg/response/...` — ALL PASS (domain/repository/service 테스트 스위트 포함)
- wrapper 포맷 smoke test — PASS

## 배포

| 단계 | 결과 |
|---|---|
| `Goti-go main → deploy/gcp` fast-forward push | `bcf3720..62295fd` |
| CD (gcp) run #14 (`24621948084`) | ✅ 7서비스 GAR 이미지 빌드 + push |
| Goti-k8s PR [#296](https://github.com/Team-Ikujo/Goti-k8s/pull/296) auto-생성 | `environments/prod-gcp/goti-*/values.yaml` × 7, `+1/-1` each |
| PR #296 squash merge | commit `b5baf52` (05:38:51Z) |
| ArgoCD sync | user/stadium/ticketing/payment/resale/outbox-worker 자동 폴링으로 진입. **queue 만 폴링 지연** → `argocd.argoproj.io/refresh=normal` annotation 으로 수동 트리거 |
| GKE 롤링 최종 | 7/7 서비스 전부 `gcp-14-62295fd` 태그로 `Synced / Healthy` |

## 교훈 (배포 관련 추가)

5. **ArgoCD Application 별 auto-polling 타이밍은 개별적**. Git commit 한 번으로 여러 Application 의 values.yaml 이 함께 바뀌어도 sync 도달 시점은 최대 3분 편차. 시연 타이밍이 급하면 `kubectl annotate application <name> argocd.argoproj.io/refresh=normal --overwrite` 로 즉시 refresh. **force 플래그가 아니라서 규칙 위반 아님** (ServerSideApply 앱도 안전).
6. **`pkg/` 변경은 전체 서비스 재빌드**. `cd-gcp.yml` 의 detect-changes 에서 `pkg/|deployments/|go.mod` 변경 감지 시 7서비스 전체를 빌드 타겟으로 세팅. wrapper 추가 같은 경우 이 트리거 이해하고 움직여야 빌드 시간/이미지 스토리지 비용 예측 가능.

## 교훈

1. **포팅 시 Jackson 애너테이션을 1급 시그널로 취급**. `@JsonFormat(pattern, timezone?)` 조합이 바로 line-level 계약이다. "Java `LocalDateTime` → Go `time.Time`" 같은 타입 이름 매핑만으로는 wire format 이 달라진다.
2. **Go `time.Time` 기본 JSON 은 RFC3339Z**. 프론트가 `new Date()` 로 파싱하면 UTC 해석되어 로컬 시각이 밀린다. 한 번이라도 wall-clock 을 그대로 보여주고 싶다면 wrapper 가 필수.
3. **잠재 Java 버그 발견**. `Instant + @JsonFormat(pattern)` 으로 timezone 미지정 시 Jackson 은 UTC 로 포맷팅. 이번 기회에 `LocalDateTimeSeoul` 로 통일해 교정.
4. **내부 vs 외부 DTO 분리**. Goti-go 내 서비스 간 JSON 은 Go 기본 `time.Time` 이 양방향 대칭이라 문제없음. 외부 계약만 wrapper 적용.

## 관련 커밋

```
cc33d0c feat(response): Java LocalDateTime/LocalDate 호환 JSON wrapper 3종
f8100c3 fix(ticketing/game): StartAt/TicketingOpenedAt/TicketingEndAt KST wall-clock 포맷
75777c5 fix(ticketing/ticket): 티켓 시간 필드 KST wall-clock 포맷
6adf12c fix(ticketing): order/seat/pricing DTO 시간 필드 포맷 수정
efaab7f fix(payment): 응답/내부 DTO 시간 필드 KST wall-clock 포맷
62295fd fix(resale): 리스팅/구매이력 DTO 시간 필드 KST wall-clock 포맷
```

## 태그

- failure-type: `context-missing` (Java JSON 계약 정보가 Go 측 코드에 암묵적으로만 유지됨)
- follow-up: dev 환경 실제 API 호출로 포맷 재확인, JPA@Version 포팅 체크리스트에 "Jackson 애너테이션 → JSON wrapper 매핑" 항목 추가 검토
