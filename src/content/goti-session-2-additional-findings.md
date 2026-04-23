---
title: "Session 2 추가 발견 사항 — smoke 중 드러난 미기록 이슈 정리"
excerpt: "Java→Go cutover smoke 트러블슈팅 중 즉시 수정하지 않고 메모만 했던 계약 불일치, 인프라 미해결 이슈, Redis/PG drift, 예매 플로우 미구현 항목을 범주별로 정리합니다."
category: "challenge"
tags:
  - go-ti
  - Session
  - Findings
  - Troubleshooting
  - Cutover
date: "2026-04-13"
---

## 한 줄 요약

> Java→Go cutover smoke 세션 중 발견했지만 당장 고치지 않고 메모로 남긴 항목을 계약 불일치 / 인프라 / 데이터 / 예매 플로우 / 운영 정책 5개 범주로 모아 후속 세션 블로커와 이연 항목을 구분합니다.

---

## 🔥 배경: smoke 중 부수 발견을 왜 따로 정리했는가

cutover smoke dev-log와 짝을 이루는 문서입니다.

smoke 진행 중에는 주된 블로커(JSON 필드명 불일치, 세션 lifecycle 누락 등)에 집중했고, 그 외에 드러난 이슈는 즉시 수정하면 smoke 흐름이 산으로 갔기 때문에 메모만 남겼습니다.
이 글은 그 메모를 범주별로 정리하고, 다음 smoke 재개 전 블로커인지, 부하 테스트 시작 전 정리 대상인지, 별도 SDD로 뺄 중장기 작업인지 분류한 기록입니다.

구체 항목은 A~E 범주로 나눕니다.

- **A. Java→Go 계약 불일치**: 예매 플로우 외의 API 응답에도 잠재.
- **B. 인프라/배포 미해결**: 이전 세션 이후 유지되던 임시 상태.
- **C. 데이터/Redis/상태 관리**: FLUSHALL 범위, inventory drift.
- **D. 예매 플로우 미구현**: smoke 중단의 직접 원인.
- **E. 운영/정책**: Kyverno exception, ArgoCD sync, values 동기화.

마지막에 F 섹션으로 **즉시 처리 / 이연 / 별도 세션** 우선순위를 정리합니다.

---

## 🤔 A. Java→Go 계약 불일치

예매 플로우 외에도 Java Spring 시절과 Go 전환 이후의 응답 계약이 어긋날 가능성이 있는 지점입니다.

### A1. `GameScheduleSearchResponse`의 팀명 필드

Java와 Go에서 필드명이 다릅니다.

```text
Java:  homeTeamDisplayName, awayTeamDisplayName  (short name)
Go:    homeTeamName,        awayTeamName         (display 변종 없음)
```

프론트는 fallback 체인으로 렌더합니다.

```typescript
game.homeTeamDisplayName ?? game.homeTeamName ?? game.homeTeamCode ?? game.homeTeamId
```

당장은 fallback으로 렌더가 되지만, Java 시절과 식별자 체계가 달라 팀 코드 매핑(`findTeamReference`) 로직이 fallback 체인 끝까지 내려가면서 잘못된 shortName을 잡을 가능성이 있습니다.
smoke가 성공해도 KBO 10팀 이름 표시가 Java와 다르게 보일 여지가 남아 있습니다.

### A2. Response envelope 구조

Java Spring은 통일된 래퍼를 사용했습니다.

```json
{ "code": "SUCCESS", "message": "...", "data": { } }
```

Go 쪽 `response.Success(c, data)`가 어떤 구조로 직렬화하는지 전수 확인이 필요합니다.
만약 `data`만 평탄하게 반환한다면 프론트의 `res.data.XXX` 접근이 전부 깨져야 하는데, 오늘 schedules에서 일부 필드만 렌더되지 않은 것으로 보아 평탄 반환은 아닐 가능성이 큽니다.
다만 확신하기 어려워 별도 조사가 진행 중입니다.

### A3. Datetime 포맷

Java와 Go의 기본 직렬화 포맷이 다릅니다.

```text
Java: @JsonFormat(pattern = "yyyy-MM-dd HH:mm")  (startAt, ticketingOpenedAt, ticketingEndAt)
Go:   time.Time 기본 RFC3339                      (2026-04-13T18:30:00Z)
```

프론트의 `parseApiDateTime(game.startAt)` 구현을 확인해야 합니다.
RFC3339를 받아도 파싱된다면 무해하고, 받지 못하면 렌더가 깨집니다.
오늘 schedules 렌더가 성공한 것으로 보아 프론트 파서는 RFC3339를 받아들이는 것으로 추정됩니다.
그러나 **일관성 부재** 자체가 잠재 리스크이므로 Java 계약 전수 점검 대상입니다.

---

## 🤔 B. 인프라/배포 미해결

### B1. Kyverno admission-controller replicas=0

이전 세션에서 Kyverno 정책이 노드 그룹 rolling을 막아 임시로 `replicas=0`으로 내려둔 상태입니다.

오늘 debug pod를 띄울 때 확인해 보니 **replicas=0이어도 webhook은 여전히 작동**했습니다.
audit mode가 아니기 때문에 6개 정책(require-labels, require-probes, require-resource-limits, require-run-as-non-root, disallow-privilege-escalation, require-pod-probes)이 동시에 차단에 걸렸습니다.

부하 테스트 시작 전 `replicas=1` 복원이 필요합니다.
복원 시 `goti.io/debug=true` 라벨 기반 exception을 미리 추가해두면 내부 debug 작업 효율이 대폭 상승합니다.
아직 실행하지 않았고 승인 대기 상태입니다.

### B2. goti-monitoring 대시보드 2벌 동기화

`grafana/` 수정 후 `charts/goti-monitoring/dashboards/` 복사가 필수라는 규칙이 있습니다.
오늘 세션에서는 모니터링 대시보드 수정이 없었습니다.
다만 OTel SDK 배포 후 Go 서비스 라벨이 실제로 들어오는지 **검증을 못 했고**, 이 검증은 별도 세션으로 위임되었습니다.

### B3. Prometheus memory 1→2Gi 커밋 대기

Helm values 수정은 완료되었으나 커밋이 아직입니다.
오늘 세션에서는 건드리지 않았고, 부하 테스트 시작 전에 반드시 반영해야 합니다.

### B4. PSA labels 적용 대기

PSA(Pod Security Admission) Step 6 kubectl label 적용이 승인 대기 상태입니다.
user-approval 규칙상 kubectl label 변경은 mutation에 해당해 별도 승인이 필요합니다.

### B5. core 노드 그룹 rolling 미완료

Kyverno webhook 차단으로 수동 EC2 종료로 우회 중이었고, 오늘 세션에서는 터치하지 않았습니다.

### B6. WARM_IP_TARGET=2 임시 상태

이전 서브넷 CIDR 확장(/24→/20 prefix delegation IP 소진 장애) 복구 과정에서 `WARM_PREFIX_TARGET`을 제거하고 `WARM_IP_TARGET=2`를 임시로 적용한 상태입니다.
정식 복구가 필요합니다.

---

## 🤔 C. 데이터 / Redis / 상태 관리

### C1. Redis FLUSHALL 범위 주의

오늘 smoke 중 FLUSHALL을 실행했는데, DB 0/1/2/3이 전부 초기화되었습니다.
모든 서비스가 같은 Redis cluster를 공유하는 구조 때문입니다.

- **DB 0**: user, ticketing, payment, resale, stadium, queue-go
- **DB 3**: queue-gate

그 결과 OAuth state, ticketing seat hold(redis), payment intermediate, queue-gate token이 전부 날아갔습니다.

향후 유사 상황에 대비해 **서비스별 DB 분리** 또는 **키 prefix 기반 부분 flush 스크립트**가 필요합니다.
예를 들어 Lua로 `SCAN + DEL goti:queue:*` 를 실행하는 방식입니다.

### C2. `game_seat_inventories` 테이블 실제 seed 여부 미확인

원래 DB 진단 SQL을 실행할 예정이었으나, JSON 필드명 불일치가 상위 원인으로 밝혀져 진단을 스킵했습니다.

결과적으로 **inventory 테이블에 값이 있는지**, **±1 로직이 PG/Redis 이중 경로에서 drift 없이 맞는지** 검증되지 않았습니다.
부하 테스트 전 반드시 확인할 쿼리입니다.

```sql
SELECT COUNT(*), SUM(available_count)
FROM ticketing_service.game_seat_inventories;

SELECT COUNT(*)                    AS future_games,
       COUNT(gsi.game_id)          AS games_with_inventory
FROM ticketing_service.game_schedules gs
LEFT JOIN (
  SELECT DISTINCT game_id FROM ticketing_service.game_seat_inventories
) gsi ON gsi.game_id = gs.id
WHERE gs.start_at > NOW();
```

`future_games`와 `games_with_inventory`가 불일치하면 `step5-game-seat-inventories.sql` seed를 재실행해야 합니다.

### C3. PG ↔ Redis inventory 이중 경로

읽기와 쓰기가 서로 다른 스토어를 바라봅니다.

**읽기 (PG만 조회):**

- `SearchSchedules.RemainingSeats`
- `GameDetail.grades`

**쓰기 경로:**

- `seat_status_service.AdjustCounts`: PG 업데이트 (seat hold 초기 생성)
- `seat_hold_service.AdjustCounts`: **Redis** 업데이트
- `order_confirm_service.AdjustCounts`: **Redis** 업데이트
- `order_cancel_service.AdjustCounts`: **Redis** 업데이트
- `seat_hold_expiry_service.AdjustCounts`: **Redis** 업데이트

여기서 drift 리스크가 발생합니다.
Redis에서 available/held/sold를 감산하는 반면, PG는 초기 hold 이후 업데이트 로직이 없습니다.
오래 운영하면 PG의 `available_count`가 실제보다 커져 **오버셀 가능성**이 생깁니다.

Redis→PG sync 배치가 있는지 확인이 필요합니다.
있더라도 PG를 읽기 소스로 쓰는 한 항상 stale한 값을 읽게 됩니다.
장기적으로는 읽기도 Redis 1차 → PG fallback으로 바꾸거나, sync 배치를 짧은 주기로 돌리고 drift 알람을 거는 방향이 필요합니다.

### C4. queue cleanup 자동화 부재

상위 trouble dev-log 6번 섹션 참조입니다.
INCR seq, waiting ZSET, activeCount drain, expirationUsersKey 등록 실패 fallback 4개에 대한 근본 개선이 필요합니다.

---

## 🤔 D. 예매 플로우 미구현 — 오늘 smoke 중단의 직접 원인

### D1. 예매 세션 lifecycle 미포팅

Java에서는 다음 엔드포인트가 Redis에 `sessionId`를 발급/저장/TTL 설정했습니다.

```text
GET /stadium-seats/games/{gameId}/seat-grades?forceNewSession=true
```

Go 쪽은 세션 개념 자체가 부재합니다.
코드에는 명시적 TODO 주석이 남아 있었습니다.

```go
// For now return grades by stadiumId query param
```

뒤이은 좌석 상태 조회 / hold / 확정 API들이 sessionId를 헤더나 쿠키로 요구할 가능성이 높습니다.
Explore 에이전트의 조사 결과를 대기 중입니다.

### D2. seatId 타입 혼란

Go 핸들러와 프론트가 서로 다른 형식을 사용합니다.

```text
Go 파라미터:  uuid.UUID  (mustPathUUID)
프론트 전송:  k8-109-4-16  (human-readable code)
```

Java 원본이 어느 쪽을 기대했는지, 프론트가 좌석 목록 응답에서 어느 필드를 seatId로 저장하는지 Explore 결과로 확정할 예정입니다.
가설은 다음과 같습니다.

Java도 UUID를 기대하지만 좌석 목록 API 응답에 `seatId: UUID` 필드가 포함되어 있어 프론트가 거기서 읽어왔을 가능성이 있습니다.
Go 응답에도 같은 필드명이 있는지, `SeatID` 태그가 `seatId`로 직렬화되는지 확인이 필요합니다.

### D3. 추가 미구현 가능성

조사 중인 항목입니다.

- 주문 확정 → 결제 승인 → 영수증 발급 flow
- 취소 정책/기간 체크
- 좌석 구역별 제한, 회원 등급별 제한 (Java에 있는 경우)
- 좌석 재판매(resale) 연동 경로
- QR 코드 생성 (`TICKETING_TICKETING_QR_SECRET` env가 존재하므로 미구현은 아닐 가능성이 높지만 API 검증은 안 됨)

---

## 🤔 E. 운영 / 정책

### E1. Cleanup API prod 비활성

`QUEUE_QUEUE_CLEANUP_API_ENABLED`의 기본값이 false입니다.
오늘은 FLUSHALL로 우회했지만, 향후 게임 단위 정리는 수동 경로가 없는 상태입니다.

### E2. Debug pod Kyverno exception 필요

`goti.io/debug=true` 라벨로 6개 정책을 bypass하는 구성이 반복해서 필요합니다.

- require-labels
- require-probes
- require-resource-limits
- require-run-as-non-root
- disallow-privilege-escalation
- require-pod-probes

TTL 30분 이내에 자동 삭제되는 CronJob이나 컨트롤러로 강제 삭제하면 리스크를 최소화할 수 있습니다.

### E3. ArgoCD sync stuck 회피 규칙 재확인

"ArgoCD Force Sync 금지" 규칙에 따라, 오늘 모든 sync는 `--server-side` 기본 + operation patch로 진행했고 force는 쓰지 않았습니다.
다만 goti-user-go는 OAuth env 추가 시 한 번에 여러 번 sync가 연쇄되어 retry 소진 직전까지 간 순간이 있었습니다.
모니터링은 잘 이루어졌습니다.

### E4. prod/prod-gcp values.yaml 자동 diff 부재

오늘 증상 1/5 모두 "prod가 prod-gcp보다 뒤처진" 상태였습니다.
어느 env가 canonical인지 정의가 불명확합니다.

대응 방향은 두 가지입니다.

- values 공통부를 `environments/_common/`에 뽑고 env별은 overlay로 관리
- CI에서 두 파일 diff 리포트 생성

---

## ✅ F. 즉시 vs 이연 — 후속 세션 분류

발견 사항을 블로커 / 부하 테스트 전 / 중장기 / 병행 4개 트랙으로 분류했습니다.

### F1. 다음 smoke 재개 전 (블로커)

- Explore 결과로 D1, D2 해결 계획 확정 후 구현
- `game_seat_inventories` seed 검증 (C2)

### F2. 부하 테스트 시작 전

- Kyverno admission-controller replicas=1 복원 (B1)
- Prometheus memory 2Gi 커밋 (B3)
- Redis FLUSHALL 재실행 (smoke 후 상태 초기화)

### F3. 중장기 (별도 SDD)

- queue cleanup 자동화 4건 (trouble dev-log 6번)
- PG/Redis inventory drift (C3)
- values.yaml prod/prod-gcp 동기화 자동화 (E4)
- response envelope / datetime 포맷 / 필드명 Java 계약 전수 정합성 (A 군)

### F4. 모니터링 (병행 새 세션)

- OTel SDK 배포 후 service_name 라벨 실제 수집 검증
- Grafana dashboard 2벌 동기화 (goti-monitoring)

---

## 📚 배운 점

- **smoke 집중 중 발견한 부수 이슈는 즉시 수정보다 메모**가 낫습니다. 주된 블로커에서 집중을 잃으면 세션 전체가 길어집니다.
- **범주별로 정리한 뒤 블로커/이연/병행으로 분류**해야 다음 세션 시작 비용이 줄어듭니다. 그냥 쌓기만 하면 잊힙니다.
- **이중 스토어 경로는 drift가 기본값**입니다. Redis/PG처럼 쓰기 경로가 갈라지고 읽기가 한쪽에만 몰리면 장기적으로 오버셀·오버런 리스크가 구조적으로 쌓입니다.
- **Kyverno webhook은 replicas=0이어도 정책이 유효**합니다. audit mode가 아니라면 단순 scale down으로 비활성화가 되지 않습니다.
- **FLUSHALL의 영향 범위는 cluster 전체**입니다. 서비스별 DB 분리나 prefix 기반 부분 flush를 미리 준비해두지 않으면, 한 서비스 초기화가 OAuth/결제 중간 상태까지 날립니다.
- **계약(필드명·envelope·datetime 포맷) 변경은 fallback 렌더로 숨겨지기 쉽습니다.** smoke 통과가 계약 정합성의 증거가 아니라는 점을 기억해야 합니다.
