# 2026-04-13 Session 2 — 부수 발견 (미기록 항목 정리)

smoke 트러블슈팅 중 드러났지만 즉시 수정하지 않고 메모만 했던 항목. 위 dev-log (`2026-04-13-java-to-go-cutover-smoke-trouble.md`) 와 짝으로 읽을 것.

---

## A. Java → Go 계약 불일치 (예매 플로우 이외에도 잠재)

### A1. `GameScheduleSearchResponse` 의 팀명 필드
- Java: `homeTeamDisplayName`, `awayTeamDisplayName` (short name)
- Go: `homeTeamName`, `awayTeamName` (no display variant)
- 프론트 fallback: `game.homeTeamDisplayName ?? game.homeTeamName ?? game.homeTeamCode ?? game.homeTeamId`
- 영향: 당장은 렌더 되지만 Java 시절 식별자 체계와 달라서 팀 코드 매핑 (`findTeamReference`) 로직이 fallback 체인 끝까지 가면서 잘못된 shortName 을 잡을 가능성. smoke 성공 후에도 KBO 10 팀 이름 표시가 Java 와 다를 수 있음

### A2. Response envelope 구조
- Java Spring: `{ code, message, data: ... }` 통일 래퍼 (`SUCCESS`, `NOT_FOUND` 등)
- Go: `response.Success(c, data)` 가 어떤 구조로 직렬화하는지 전수 확인 필요 — 만약 data 만 평탄 반환하면 프론트의 `res.data.XXX` 접근이 전부 깨지는데 오늘 schedules 는 일부 필드만 렌더 안 됐으니 평탄 반환은 아닐 가능성. 그러나 확실하지 않음. (Explore 에이전트가 이것도 조사 중)

### A3. Datetime 포맷
- Java: `@JsonFormat(pattern = "yyyy-MM-dd HH:mm")` — `startAt`, `ticketingOpenedAt`, `ticketingEndAt`
- Go: `time.Time` 기본 RFC3339 (`2026-04-13T18:30:00Z`)
- 프론트: `parseApiDateTime(game.startAt)` — 구현 확인 필요. RFC3339 를 받아도 파싱되면 무해, 안 되면 깨짐
- 오늘 schedules 렌더는 됐으므로 프론트 파서가 RFC3339 를 받아들이는 듯. 그러나 **일관성 부재** 는 잠재 리스크

---

## B. 인프라/배포 관련 미해결 이슈

### B1. Kyverno admission-controller replicas=0
- 어제 Kyverno 정책이 노드 그룹 rolling 을 막아서 임시로 replicas=0 으로 내려둔 상태 (메모리 `feedback_cloud_cli_rules_reform.md` 관련)
- 오늘 debug pod 띄울 때 **policy 는 여전히 작동** (replicas=0 이어도 webhook 은 살아있음, audit mode 는 아님) — 6 개 정책 동시 차단
- 부하 테스트 시작 전 `replicas=1` 복원 필요. 복원 시 `goti.io/debug=true` 라벨 기반 exception 을 미리 추가하면 내부 debug 작업 효율 대폭 상승
- 아직 실행 안 함. 승인 대기 중 (세션 초반 TODO)

### B2. Goti-monitoring dashboard 2벌 동기화 여부
- 메모리: `feedback_monitoring_dashboard_dual_sync.md` — `grafana/` 수정 후 `charts/goti-monitoring/dashboards/` 복사 필수
- 오늘은 모니터링 대시보드 수정 없었지만, OTel SDK 배포 후 Go 서비스 라벨이 들어오는지 **검증 못 함** (별도 세션으로 위임됨)

### B3. Prometheus memory 1→2Gi 커밋 대기
- 메모리: "Prometheus memory 1Gi→2Gi (Helm values 수정 완료, 커밋 필요)"
- 오늘 세션에서 건드리지 않음. 부하 테스트 시작 전 반영 필요

### B4. PSA labels 적용 대기
- 메모리: `project_psa_labels_todo.md` — Step 6, kubectl label 적용 대기
- user-approval 규칙상 kubectl label 변경은 mutation → 승인 필요

### B5. core 노드 그룹 rolling 미완료
- 메모리: "core 노드 그룹 rolling 미완료 — Kyverno webhook 차단, 수동 EC2 종료로 우회"
- 진행 중. 오늘 터치 안 함

### B6. WARM_IP_TARGET=2 임시 상태
- 메모리: "서브넷 CIDR 확장 — /24→/20 prefix delegation IP 소진 장애 (2026-04-01)"
- WARM_PREFIX_TARGET 제거, WARM_IP_TARGET=2 임시 적용 중. 정식 복구 필요

---

## C. 데이터 / Redis / 상태 관리

### C1. Redis FLUSHALL 범위 주의
- 오늘 FLUSHALL 실행 → DB 0/1/2/3 전부 초기화됨
- 모든 서비스가 같은 Redis cluster 공유:
  - user, ticketing, payment, resale, stadium, queue-go: DB 0
  - queue-gate: DB 3
  - OAuth state, ticketing seat hold(redis), payment intermediate, queue-gate token 전부 날아감
- **향후 유사 상황 대비**: 서비스별 DB 분리 or 키 prefix 기반 부분 flush 스크립트 필요 (Lua `SCAN + DEL goti:queue:*` 처럼)

### C2. `game_seat_inventories` 테이블 실제 seed 여부 미확인
- 원래 DB 진단 SQL 실행 예정이었으나 JSON 필드명 불일치가 상위 원인으로 밝혀져서 진단 스킵
- **실제로 inventory 테이블에 값이 있는지, ±1 로직이 PG/Redis 이중경로에서 drift 없이 맞는지 검증 안 됨**
- 부하 테스트 전 반드시 확인:
  ```sql
  SELECT COUNT(*), SUM(available_count) FROM ticketing_service.game_seat_inventories;
  SELECT COUNT(*) AS future_games,
         COUNT(gsi.game_id) AS games_with_inventory
  FROM ticketing_service.game_schedules gs
  LEFT JOIN (SELECT DISTINCT game_id FROM ticketing_service.game_seat_inventories) gsi
    ON gsi.game_id = gs.id
  WHERE gs.start_at > NOW();
  ```
- 만약 future_games 와 games_with_inventory 불일치 시 seed `step5-game-seat-inventories.sql` 재실행

### C3. PG ↔ Redis inventory 이중 경로
- 읽기(`SearchSchedules.RemainingSeats`, `GameDetail.grades`): **PG 만** 조회
- 쓰기:
  - `seat_status_service.AdjustCounts`: PG 업데이트 (seat hold 초기 생성 경로)
  - `seat_hold_service.AdjustCounts`: **Redis** 업데이트
  - `order_confirm_service.AdjustCounts`: **Redis** 업데이트
  - `order_cancel_service.AdjustCounts`: **Redis** 업데이트
  - `seat_hold_expiry_service.AdjustCounts`: **Redis** 업데이트
- **drift 리스크**: Redis 에서 available/held/sold 를 감산하는데 PG 쪽은 초기 hold 이후 업데이트 로직 없음 → 오래 운영하면 PG 의 available_count 가 실제보다 커져서 오버셀 가능
- Redis → PG sync 배치 있는지 확인 필요. 있어도 PG 를 읽기 소스로 쓰는 한 항상 stale
- **장기 해결**: 읽기도 Redis 1차 → PG fallback, 또는 sync 배치를 짧은 주기로 돌리고 drift 알람

### C4. queue cleanup 자동화 부재 (이미 dev-log 에 기록)
- 위 trouble dev-log 의 6번 섹션 참조. INCR seq / waiting ZSET / activeCount drain / expirationUsersKey 등록 실패 fallback 4개 근본 개선 필요

---

## D. 예매 플로우 미구현/불완전 (오늘 smoke 중단 원인)

### D1. 예매 세션 lifecycle 미포팅
- `GET /stadium-seats/games/{gameId}/seat-grades?forceNewSession=true` 가 Java 에서는 Redis 에 `sessionId` 발급/저장/TTL 설정
- Go 는 세션 개념 자체 부재. 주석 `// For now return grades by stadiumId query param` — 명시적 TODO 상태
- 뒤이은 좌석 상태 조회 / hold / 확정 API 들이 sessionId 를 헤더/쿠키로 요구할 가능성 높음. Explore 에이전트 결과 대기

### D2. seatId 타입 혼란
- Go: `uuid.UUID` (`mustPathUUID`)
- 프론트 전송: `k8-109-4-16` human-readable code
- Java 원본이 어느 쪽인지 / 프론트가 좌석 목록 응답에서 어느 필드를 seatId 로 저장하는지 Explore 결과로 확정 예정
- 가설: Java 도 UUID 기대하지만, 좌석 목록 API 응답에 `seatId: UUID` 필드가 있어서 프론트가 거기서 읽어옴. Go 응답에서 같은 필드명이 없거나 값이 다를 수 있음 (`SeatID` JSON 태그가 `seatId` 로 직렬화되는지 확인 필요)

### D3. 추가 미구현 가능성 (조사 중)
- 주문 확정 → 결제 승인 → 영수증 발급 flow
- 취소 정책/기간 체크
- 좌석 구역별 제한, 회원 등급별 제한 (Java 에 있는 경우)
- 좌석 재판매(resale) 연동 경로
- QR 코드 생성 (`TICKETING_TICKETING_QR_SECRET` env 가 있으니 미구현은 아닐 것, 그러나 API 검증 안 됨)

---

## E. 운영/정책

### E1. Cleanup API prod 비활성
- `QUEUE_QUEUE_CLEANUP_API_ENABLED` default false
- 오늘 FLUSHALL 로 우회했지만 향후 게임 단위 정리는 수동 경로 없음

### E2. Debug pod Kyverno exception 필요
- `goti.io/debug=true` 라벨로 6개 정책 bypass (require-labels, require-probes, require-resource-limits, require-run-as-non-root, disallow-privilege-escalation, require-pod-probes)
- TTL 30분 이내 자동 삭제되는 CronJob 이나 컨트롤러로 강제 삭제하면 리스크 최소화

### E3. ArgoCD sync stuck 회피 규칙 재확인
- 메모리 `user-approval.md` 의 "ArgoCD Force Sync 금지" — 오늘 모든 sync 는 `--server-side` 기본 + operation patch 로 진행, force 안 씀. ✓
- 다만 goti-user-go 는 OAuth env 추가 시 한 번에 여러 번 sync 연쇄 → retry 소진 직전까지 간 순간 있음. 모니터링 잘 됐음

### E4. prod/prod-gcp values.yaml 자동 diff 부재
- 오늘 증상 1/5 모두 "prod 가 prod-gcp 보다 뒤처진" 상태. 어느 env 가 canonical 인지 정의 불명
- 대응: values 공통부는 `environments/_common/` 에 뽑고, env 별은 overlay 로. 또는 CI 에서 두 파일 diff 리포트

---

## F. 즉시 vs 이연 (후속 세션 분류)

### F1. 다음 smoke 재개 전 (블로커)
- Explore 결과로 D1, D2 해결 계획 확정 후 구현
- `game_seat_inventories` seed 검증 (C2)

### F2. 부하 테스트 시작 전
- Kyverno admission-controller replicas=1 복원 (B1)
- Prometheus memory 2Gi 커밋 (B3)
- Redis FLUSHALL 재실행 (smoke 후 상태 초기화)

### F3. 중단기 (별도 SDD)
- queue cleanup 자동화 4건 (trouble dev-log 6번)
- PG/Redis inventory drift (C3)
- values.yaml prod/prod-gcp 동기화 자동화 (E4)
- response envelope / datetime 포맷 / 필드명 Java 계약 전수 정합성 (A 군)

### F4. 모니터링 (병행 새 세션)
- OTel SDK 배포 후 service_name 라벨 실제 수집 검증
- Grafana dashboard 2벌 동기화 (goti-monitoring)

---

## 메모리 MEMORY.md 에 추가할 엔트리 후보
- `project_go_cutover_smoke_trouble.md` (이미 추가됨)
- `project_seat_booking_port_plan.md` (Explore 결과 나오면 생성, SDD 링크 포함)
- `project_inventory_pg_redis_drift.md` (C3)
- `project_values_prod_gcp_sync.md` (E4)
- `feedback_debug_pod_kyverno_label.md` (E2 — 한번 label exception 도입하면 계속 쓰임)
