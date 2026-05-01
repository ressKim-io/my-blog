---
title: "경기 시간이 9시간 밀린 이유 — Java↔Go JSON 시간 계약 정합"
excerpt: "Java LocalDateTime + @JsonFormat으로 내려오던 wall-clock 문자열이 Go 포팅 후 RFC3339Z로 바뀌었습니다. 프론트가 이를 UTC로 해석하면서 9시간이 밀려 표시되던 문제를 JSON wrapper 3종으로 계약을 통일해 해결한 기록입니다"
category: challenge
tags:
  - go-ti
  - Contract
  - JSON
  - UTC
  - Troubleshooting
date: "2026-04-19"
---

## 🎯 한 줄 요약

> 프론트에서 경기 시간이 KST 18:30 대신 다음날 03:30으로 표시되던 이슈를 추적했습니다. Go 포팅 과정에서 Java의 `@JsonFormat` 문자열 계약이 사라지고 `time.Time` 기본 RFC3339Z로 바뀐 것이 원인이었습니다. Java 계약과 일치하는 JSON wrapper 3종을 추가해 응답·내부 DTO 전수를 교정했습니다

---

## 🔥 문제: 경기 시간이 9시간 밀려서 표시됨

### 기대 동작

Java 원본 서버는 경기 시작 시간을 **offset 없는 wall-clock 문자열**로 내려줬습니다.

```json
{
  "startAt": "2026-04-20 18:30"
}
```

프론트는 `new Date("2026-04-20 18:30")`로 파싱하면 브라우저 로컬 타임존(KST)으로 해석되어 화면에 `18:30 KST`로 표시되었습니다.

### 발견한 증상

Goti-go로 포팅한 뒤, 프론트에서 경기 시간이 이상하게 표시되기 시작했습니다. `18:30 KST` 경기가 `03:30` 또는 `Z` 접미사가 붙은 UTC 문자열로 노출되었습니다.

주요 증상 필드를 정리하면 다음과 같습니다.

| 필드 | Go 기본 출력 | 프론트 `new Date()` 결과 |
|------|--------------|--------------------------|
| `startAt` (경기 시작) | `2026-04-20T18:30:00Z` | KST 03:30 (다음날) — 9시간 밀림 |
| `orderedAt` (주문 시각) | `2026-04-20T09:30:00.123Z` | 18:30이 나와야 하는데 09:30 그대로 |
| `gameDate` (티켓의 경기일) | 동일 | 동일 |

같은 이벤트라도 필드마다 밀리는 방향이 달랐습니다.

`startAt`은 DB에 저장된 KST wall-clock이 그대로 `Z` 접미사만 붙어 UTC로 오해받는 경우였고, `orderedAt`은 애초에 UTC로 기록된 값이 포맷팅 없이 그대로 나가는 경우였습니다. 둘 다 프론트에서 잘못 해석되었지만 교정 방향이 달라 필드별 대응이 필요했습니다.

---

## 🤔 원인: Java Jackson 계약이 Go encoding/json으로 포팅되지 않음

### DB 저장 형태 불일치

`game_schedules.start_at` 컬럼은 `TIMESTAMP WITHOUT TIME ZONE` 타입입니다.
seed 시점에 KST wall-clock 값을 그대로 `'2026-04-20 18:30'::TIMESTAMP`로 저장했습니다.

pgx는 이 값을 `time.Time(location=UTC)`로 읽어옵니다.
타임존 메타데이터만 UTC로 붙고, 값 자체는 변하지 않습니다.
즉 Go 입장에서는 "UTC 18:30"으로 보이지만 실제로는 KST 18:30이 의도한 값입니다.

### Java Jackson 출력 (Before)

Java 원본 DTO는 다음과 같이 선언되어 있었습니다.

```java
@JsonFormat(pattern = "yyyy-MM-dd HH:mm")
private LocalDateTime startAt;
```

Jackson은 `LocalDateTime`과 `@JsonFormat` 조합을 만나면 **offset 없는 wall-clock 문자열**을 내립니다.

```text
"startAt": "2026-04-20 18:30"
```

프론트 `new Date("2026-04-20 18:30")`는 이 문자열을 로컬 타임존(KST)으로 해석합니다. 의도대로 `18:30 KST`가 표시됩니다.

### Go encoding/json 기본 동작 (After)

Go `time.Time`의 `MarshalJSON`은 RFC3339Nano로 직렬화합니다.

```text
"startAt": "2026-04-20T18:30:00Z"
```

`Z` 접미사는 **UTC**를 의미합니다. 프론트 `new Date("...Z")`는 이 문자열을 UTC로 해석한 뒤 KST로 변환하면서 +9시간을 더합니다. 결과는 다음날 03:30.

### 기존 InstantTime wrapper의 한계

Goti-go 안에는 이미 `response.InstantTime`이라는 wrapper가 있었습니다. 이는 Java `Instant` 타입과 호환되도록 **ISO8601 with Z suffix** 포맷을 내리는 wrapper입니다.

문제는 이 wrapper로도 `LocalDateTime + @JsonFormat("yyyy-MM-dd HH:mm")` 필드의 wire format을 흉내낼 수 없다는 점입니다. Instant는 UTC 기준이지만, Java 원본의 `LocalDateTime`은 타임존이 없는 wall-clock이기 때문입니다.

즉 Java 쪽에는 세 가지 시간 포맷 패턴이 섞여 있었고, Go 포팅은 그중 하나(`InstantTime`)만 지원하고 있었습니다.

---

## 🧭 선택지 비교: 시간 포맷 wrapper 설계

### 고려한 옵션

| 옵션 | 핵심 아이디어 | 장점 | 한계 |
|------|---------------|------|------|
| A. Go `time.Time` 그대로 유지 | 기본 RFC3339Z 출력 | 코드 변경 없음 | 프론트가 UTC로 해석해 9시간 밀림 — 계약 불일치 |
| B. 기존 `InstantTime` 전체 재사용 | 모든 시간 필드를 ISO8601Z로 통일 | wrapper 1종만 유지 | Java `LocalDateTime + pattern` 계약(`"yyyy-MM-dd HH:mm"`)을 재현 불가 |
| C. Java 계약 1:1 대응 wrapper 3종 추가 | Jackson 애너테이션별로 별도 Go 타입 도입 | 필드 단위로 계약 일치 | 유지할 타입이 늘어남 (4종) |

### 기각 이유

- **A 탈락**: 프론트 수정으로 우회할 수도 있지만, 프론트는 이미 수많은 화면에서 `new Date()`를 사용하고 있었습니다. 백엔드 단에서 계약을 맞추는 것이 영향 범위가 훨씬 작습니다.
- **B 탈락**: `InstantTime`은 UTC Z suffix를 강제합니다. Java의 `LocalDateTime` wall-clock 필드를 Z suffix로 통일하면 이번에는 **프론트 표시 로직이 모두 바뀌어야** 합니다. Java→Go 포팅의 목적은 wire format 호환이었기 때문에 허용할 수 없었습니다.

### 결정 기준과 최종 선택

**C안을 채택했습니다.**

결정 기준은 다음 우선순위입니다.

1. **Java 원본 계약과의 wire format 일치**: 프론트 수정 없이 Go로 갈아끼울 수 있어야 합니다.
2. **필드별 시맨틱 차이 보존**: Java 원본은 `LocalDateTime`과 `Instant`를 의도적으로 나눠 쓰고 있었습니다. 이 구분이 Go에서도 타입으로 드러나야 추후 실수를 줄입니다.
3. **기존 `InstantTime` 공존**: 재작업 비용이 크기 때문에 전면 교체하지 않습니다.

C는 Java의 세 가지 Jackson 패턴을 Go 타입 세 개로 1:1 매핑합니다. 타입 이름 자체가 계약이기 때문에 리뷰에서 놓칠 여지가 줄어듭니다.

---

## ✅ 해결: pkg/response/time.go에 wrapper 3종 추가 후 전수 교정

### wrapper 3종 설계

`pkg/response/time.go`에 다음 타입을 추가했습니다.

| 타입 | 출력 포맷 | 대응 Java 선언 |
|------|-----------|----------------|
| `LocalDateTime` | `2006-01-02 15:04` (wall-clock, location 무시) | `LocalDateTime + @JsonFormat("yyyy-MM-dd HH:mm")` |
| `LocalDateTimeSeoul` | UTC → KST 변환 후 `2006-01-02 15:04` | `Instant + @JsonFormat(pattern, timezone="Asia/Seoul")` |
| `LocalDate` | `2006-01-02` | `LocalDate + @JsonFormat("yyyy-MM-dd")` |

세 타입 모두 `Scan`(pgx), `MarshalJSON`, `UnmarshalJSON`을 구현합니다.
pgx 스캔, HTTP 응답 직렬화, 서비스 간 역직렬화까지 한 번에 지원합니다.
기존 `InstantTime`은 그대로 유지합니다. 본격적으로 UTC ISO8601이 필요한 경우를 대비한 fallback입니다.

### 수정 범위

5개 커밋, 16개 파일을 순차적으로 수정했습니다.

| 커밋 | 영역 | 핵심 필드 |
|------|------|-----------|
| `feat(response)` | `pkg/response/time.go` | wrapper 3종 |
| `fix(ticketing/game)` | dto_game + game_service + game_search_service | StartAt, TicketingOpenedAt, TicketingEndAt |
| `fix(ticketing/ticket)` | dto_ticket + ticket_info_service + ticket_resale_service | GameDate, UsedAt, IssuedAt(KST), ExpiresAt |
| `fix(ticketing)` | dto_order/seat/pricing + stadium_seat_handler | RefundAt, OrderedAt(KST), SessionExpiresAt(KST), PolicyStartAt/EndAt(LocalDate) |
| `fix(payment)` | payment/domain/dto + ticketing_client + resale_client | PaidAt(KST), PurchaseSearchResponse 전체 |
| `fix(resale)` | resale/domain/dto | ListedAt/SoldAt/CanceledAt(KST), ResalePurchaseList 전체, PriceHistory |

### TicketInfoResponse 예외 처리

`TicketInfoResponse`는 Goti-go 내부 서비스 간 HTTP 호출(`ticketing → resale`) 전용 DTO입니다. 이 DTO는 **기존 `time.Time` (RFC3339) 그대로 유지**했습니다.

이유는 Go encoder와 decoder가 양쪽 모두 같은 기본 동작을 쓰기 때문입니다. 내부 서비스 간에서는 계약 일치가 이미 보장되어 있으므로 wrapper를 강제할 필요가 없었습니다.

**외부 계약에만 wrapper를 적용하고 내부 계약은 Go 기본값을 유지**하는 방식으로 범위를 제한했습니다.

### Before / After

**Before** — Goti-go 포팅 직후

```json
{
  "gameId": "...",
  "startAt": "2026-04-20T18:30:00Z",
  "ticketingOpenedAt": "2026-04-20T17:30:00Z"
}
```

프론트가 UTC로 파싱 → KST 변환 시 다음날 03:30으로 밀림.

**After** — wrapper 적용 후

```json
{
  "gameId": "...",
  "startAt": "2026-04-20 18:30",
  "ticketingOpenedAt": "2026-04-20 17:30"
}
```

프론트 `new Date("2026-04-20 18:30")` → 로컬(KST) 18:30 표시.

### smoke test 결과

```text
LocalDateTime(UTC time 18:30): "2026-04-20 18:30"
LocalDateTimeSeoul(UTC 09:30): "2026-04-20 18:30"   # +9h KST 변환
LocalDate:                     "2026-04-20"
LocalDateTime round-trip:      "2026-04-20 18:30"
LocalDateTime zero:            null
```

`LocalDateTime`은 location을 무시하고 wall-clock 그대로 포맷팅합니다.
`LocalDateTimeSeoul`은 UTC 값을 받아 KST로 변환한 뒤 포맷팅합니다.
두 wrapper가 같은 문자열을 만들어내지만 **입력 해석 방식이 완전히 다릅니다**.

### 검증

```bash
$ go build ./...
PASS

$ go test ./internal/ticketing/... ./internal/payment/... ./internal/resale/... ./pkg/response/...
ok  # domain/repository/service 테스트 스위트 포함 ALL PASS
```

### 배포

| 단계 | 결과 |
|------|------|
| `Goti-go main → deploy/gcp` fast-forward push | `bcf3720..62295fd` |
| CD(gcp) run #14 | 7서비스 GAR 이미지 빌드 + push |
| Goti-k8s PR auto-생성 | `environments/prod-gcp/goti-*/values.yaml` × 7, `+1/-1` each |
| PR squash merge | commit `b5baf52` |
| ArgoCD sync | user/stadium/ticketing/payment/resale/outbox-worker 자동 폴링, queue만 폴링 지연 → `argocd.argoproj.io/refresh=normal` annotation으로 수동 트리거 |
| GKE 롤링 최종 | 7/7 서비스 `gcp-14-62295fd` 태그로 `Synced / Healthy` |

queue 서비스만 ArgoCD 자동 폴링이 다른 Application보다 늦게 도달했습니다. `argocd.argoproj.io/refresh=normal` annotation은 force 플래그가 아니므로 SSA 규칙을 위반하지 않고 즉시 refresh를 트리거할 수 있습니다.

---

## 📚 배운 점

1. **포팅 시 Jackson 애너테이션을 1급 시그널로 취급합니다** — `@JsonFormat(pattern, timezone?)` 조합은 그 자체로 line-level 계약입니다. "Java `LocalDateTime` → Go `time.Time`" 같은 타입 이름 매핑만으로는 wire format이 달라집니다

2. **Go `time.Time` 기본 JSON은 RFC3339Z입니다** — 프론트가 `new Date()`로 파싱하면 UTC로 해석되어 로컬 시각이 밀립니다. wall-clock을 그대로 보여주고 싶다면 wrapper가 필수입니다

3. **Java 쪽에도 잠재 버그가 있었습니다** — `Instant + @JsonFormat(pattern)` 조합에서 timezone을 지정하지 않으면 Jackson은 UTC로 포맷팅합니다. 이번 기회에 `LocalDateTimeSeoul`로 통일해 교정했습니다. 기존엔 wall-clock UTC 문자열이 프론트 로컬로 해석되면서 우연히 결과가 맞아떨어지고 있었습니다

4. **내부 DTO와 외부 DTO를 분리합니다** — 서비스 간 JSON은 Go 기본 `time.Time`이 양방향 대칭이라 문제없습니다. 외부 계약(프론트 노출)에만 wrapper를 적용해 범위를 제한하면 유지보수 비용이 줄어듭니다

5. **`pkg/` 변경은 전체 서비스 재빌드를 유발합니다** — `cd-gcp.yml`의 detect-changes는 `pkg/|deployments/|go.mod` 변경 감지 시 7서비스 전체를 빌드 타겟으로 세팅합니다. wrapper 추가 한 번으로 모든 이미지가 다시 빌드되고 ArgoCD sync 7개가 줄줄이 발생한다는 점을 미리 염두에 두고 움직여야 합니다

6. **ArgoCD Application별 auto-polling 타이밍은 개별적입니다** — Git commit 한 번으로 여러 Application의 values.yaml이 함께 바뀌어도 sync 도달 시점에 최대 3분 편차가 납니다. 시연 타이밍이 급하면 `kubectl annotate application <name> argocd.argoproj.io/refresh=normal --overwrite`로 즉시 refresh합니다. force 플래그가 아니라서 SSA 앱에서도 안전합니다
