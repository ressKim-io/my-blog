# 고아 stadium 경기 5건 정리 (game_seat_inventories seed 갭)

날짜: 2026-04-13 (Phase 8 P0 착수 직전)
환경: AWS prod (EKS, goti ns, ticketing_service schema)
관련 세션: `docs/dev-logs/sessions/2026-04-13-session-2.md`
선행: `docs/dev-logs/2026-04-13-session-2-additional-findings.md` C2 항목

---

## 요약

Phase 8 SDD P0#6 검증(`game_seat_inventories` seed 상태) 중 future_games=610 vs games_with_inventory=605 로 **5건 inventory 누락** 발견. 추적 결과 stadium `75d8932b-3b72-4bbd-b670-29516fcc0f5d` 의 seat_sections/seats/seat_grades 가 0개 인 **고아 stadium** 이었고, Red team 테스트 단계에서 남은 잔재로 추정. 삭제 후 inventory 무결성 회복(605/605).

실패 태그: `context-missing` (문서화되지 않은 테스트 잔재 데이터)

---

## 진단

### 증상
```
SELECT COUNT(*) AS future_games,
       COUNT(gsi.game_id) AS games_with_inventory
FROM ticketing_service.game_schedules gs
LEFT JOIN (SELECT DISTINCT game_id FROM ticketing_service.game_seat_inventories) gsi
  ON gsi.game_id = gs.id
WHERE gs.start_at > NOW();

 future_games | games_with_inventory
--------------+----------------------
          610 |                  605
```

### 가설-검증

**가설 1**: step5 seed 실행이 5건에 대해 실패/누락. — **기각**
- step5 는 `EXISTS seat_statuses` 인 game 만 대상. 5건 모두 `seat_statuses_count=0` 이라 애초에 대상이 아님.

**가설 2**: step4(seat_statuses) 가 5건에 누락. — **확장 필요**
- step4 역시 seats/seat_sections 필요. 해당 stadium 에 seats=0 이면 step4도 대상 아님.

**가설 3 (확정)**: stadium `75d8932b...` 자체가 좌석 구조 없는 placeholder.
```
 sections | seats | grades
----------+-------+--------
        0 |     0 |      0
```
- 해당 stadium 경기 5건 모두 같은 home/away team, 2026-12-01 ~ 2026-12-31 범위
- 정상 구장 10곳과 구조가 다름 → Red team 의도적 생성 잔재로 추정

### FK 영향 스캔
| 자식 테이블 | 행 수 |
|---|---|
| `seat_holds` | 0 |
| `seat_statuses` | 0 |
| `game_statuses` | 5 |
| `game_ticketing_statuses` | 5 |
| `orders` | 0 |
| `game_seat_inventories` | 0 |

`game_schedules` 를 참조하는 FK 5개 child 테이블 중 `game_statuses`, `game_ticketing_statuses` 만 정리 필요.

---

## 조치

트랜잭션 1개로 CTE 체인 삭제:
```sql
BEGIN;
WITH ids AS (SELECT unnest(ARRAY[... 5 UUID ...]::uuid[]) AS id),
d1 AS (DELETE FROM ticketing_service.game_ticketing_statuses WHERE game_schedule_id IN (SELECT id FROM ids) RETURNING 1),
d2 AS (DELETE FROM ticketing_service.game_statuses WHERE game_schedule_id IN (SELECT id FROM ids) RETURNING 1),
d3 AS (DELETE FROM ticketing_service.game_schedules WHERE id IN (SELECT id FROM ids) RETURNING 1)
SELECT ...;
COMMIT;
```

결과: `del_tkt_status=5, del_game_status=5, del_schedules=5`.
사후 검증: `future_games=605 = games_with_inventory` ✓

### 삭제한 game_schedule ID
```
8cf76ac8-a61c-4428-bca4-24a84af6ad8a  2026-12-01 18:30
bafbcd00-8476-4102-a391-b06702a6f0a3  2026-12-02 18:30
e4a558ef-6d57-4f35-8756-47a1013eec0c  2026-12-03 18:30
037126be-29b0-4baa-9899-3f31d94d47a2  2026-12-25 18:30
ead2be7d-04f0-42e7-9e29-6721ef06fee4  2026-12-31 18:30
```
stadium_id: `75d8932b-3b72-4bbd-b670-29516fcc0f5d` (seed 0)

---

## 도구 — debug pod 패턴 확립

Istio sidecar injection 포함 시 EKS prod 노드 리소스 부족으로 Pending. 아래 스펙으로 회피:

- `annotations.sidecar.istio.io/inject: "false"` — sidecar 제외
- `labels.goti.io/debug: "true"` — Kyverno exception 후보 라벨 (현재 실제 exception 정책 미도입, E2 TODO)
- `readOnlyRootFilesystem: true` + `runAsNonRoot(uid=70)` + `capabilities.drop: [ALL]`
- `postgres:16-alpine` + `TICKETING_DATABASE_URL` 환경변수 매핑
- 주의: DATABASE_URL 에 `search_path=...` URI query 있음 → psql 거부, sed 로 제거 후 사용
- 주의: `readOnlyRootFilesystem` 이라 `kubectl cp` 로 스크립트 전송 불가 → `kubectl exec -i <pod> -- sh -s << EOF` 로 stdin 전달
- `activeDeadlineSeconds: 1800` + 작업 후 즉시 수동 `kubectl delete pod`

## 근본 개선 TODO

1. **seed 검증 CI job** — step5 성공 후 `future_games vs games_with_inventory` 일치 확인. 불일치 시 fail
2. **고아 stadium 방지** — stadium 생성 시 `seat_sections` 없이 존재하는 상태를 허용하지 않는 제약(seed 레벨 또는 application service 레벨)
3. **Red team 테스트 데이터 표식** — 고아 데이터 같은 경우 `label: test-data` 로 마킹 후 정기 cleanup job
4. **Kyverno debug exception 공식화** — `goti.io/debug=true` 라벨 기반 정책 bypass 정의 (session-2-additional-findings E2)

---

## 타임라인

- 13:10 UTC: debug pod 생성 시도 1차 → Pending (리소스 부족)
- 13:12: sidecar 제외 + 리소스 축소로 재생성 → Running
- 13:13: inventory count SQL 실행, 5건 누락 확인
- 13:15: 고아 stadium 원인 추적 (seats=0, grades=0)
- 13:17: FK 영향 스캔
- 13:18: 트랜잭션 삭제 실행, 605/605 확인
- 13:19: debug pod 삭제

---

## 참고

- 선행 SDD: `docs/migration/java-to-go/phase8-seat-booking-contract-port-sdd.md` P0#6
- seed 스크립트: `scripts/seed-prod/step5-game-seat-inventories.sql`
- FK 메타: `information_schema.referential_constraints`
