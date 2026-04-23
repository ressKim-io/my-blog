---
title: "고아 Stadium 경기 5건 정리 — inventory seed 갭 추적"
excerpt: "Phase 8 P0 검증 중 future_games 610 vs inventory 605 갭을 발견해, 좌석 구조가 없는 고아 stadium 1건과 그 경기 5건을 트랜잭션 CTE 체인으로 정리한 기록입니다."
category: challenge
tags:
  - go-ti
  - Cleanup
  - Database
  - DataConsistency
date: "2026-04-13"
---

## 한 줄 요약

> `game_seat_inventories` seed 검증 중 future_games=610 vs games_with_inventory=605로 5건 불일치를 발견했고, 좌석 구조가 0인 고아 stadium 1건이 원인이었습니다. FK 자식 테이블 정리 후 단일 트랜잭션 CTE 체인으로 삭제해 605/605 무결성을 회복했습니다.

---

## 🔥 문제: future_games와 inventory 카운트가 5건 차이

### 기존 기대 동작

Phase 8 SDD P0#6은 `game_seat_inventories` seed가 모든 future game에 대해 완성되어 있는지를 검증하는 단계입니다. 정상적으로 seed가 끝나면 `start_at > NOW()` 조건의 `game_schedules` 개수와, `game_seat_inventories`에서 distinct game_id로 뽑은 개수가 **정확히 일치**해야 합니다.

### 발견한 증상

AWS prod(EKS, `goti` namespace, `ticketing_service` schema)에서 아래 쿼리를 실행했습니다.

```sql
SELECT COUNT(*) AS future_games,
       COUNT(gsi.game_id) AS games_with_inventory
FROM ticketing_service.game_schedules gs
LEFT JOIN (
  SELECT DISTINCT game_id FROM ticketing_service.game_seat_inventories
) gsi
  ON gsi.game_id = gs.id
WHERE gs.start_at > NOW();
```

결과:

```text
 future_games | games_with_inventory
--------------+----------------------
          610 |                  605
```

5건이 inventory 없이 `game_schedules`에만 존재하는 상태였습니다. 단순 seed 누락이라면 재실행으로 풀려야 하지만, 실행 전 원인부터 추적했습니다.

---

## 🤔 원인: 좌석 구조가 0인 고아 stadium

### 가설-검증 과정

처음 떠오른 가설부터 하나씩 검증했습니다.

**가설 1 — step5 seed가 5건에 대해 실패했을 가능성.** 기각했습니다. step5는 `EXISTS seat_statuses` 조건의 game만 대상으로 합니다. 문제의 5건은 `seat_statuses_count=0`이라 애초에 대상이 아니었습니다.

**가설 2 — step4(seat_statuses)에서 5건이 누락됐을 가능성.** 확장이 필요했습니다. step4 역시 `seats`/`seat_sections`를 전제로 합니다. stadium에 `seats=0`이면 step4의 대상조차 아니게 됩니다.

**가설 3 (확정) — stadium 자체가 좌석 구조 없는 placeholder였습니다.** 문제의 5건 경기가 참조하는 stadium을 조회했습니다.

```sql
SELECT
  (SELECT COUNT(*) FROM ticketing_service.seat_sections WHERE stadium_id = s.id) AS sections,
  (SELECT COUNT(*) FROM ticketing_service.seats WHERE stadium_id = s.id) AS seats,
  (SELECT COUNT(*) FROM ticketing_service.seat_grades WHERE stadium_id = s.id) AS grades
FROM ticketing_service.stadiums s
WHERE s.id = '75d8932b-3b72-4bbd-b670-29516fcc0f5d';
```

결과:

```text
 sections | seats | grades
----------+-------+--------
        0 |     0 |      0
```

좌석 구조가 완전히 비어 있는 stadium이었습니다. 해당 stadium의 경기 5건은 모두 동일한 home/away team 조합에, 2026-12-01 ~ 2026-12-31 범위에 몰려 있었습니다. 정상 운영 중인 구장 10곳은 sections/seats/grades가 모두 정상 값을 가지는데, 이 stadium만 구조적으로 달랐습니다.

Red team 테스트 시나리오에서 의도적으로 생성했다가 정리되지 않고 남은 **잔재 데이터**로 추정했습니다. 이런 경우 step4/step5 seed는 좌석 구조가 없어 대상 자체에서 제외되므로, 영원히 inventory가 생성되지 않는 고아 상태로 남게 됩니다.

### 실패 태그

`context-missing` — 문서화되지 않은 테스트 잔재 데이터. 운영 데이터와 테스트 데이터를 구분할 메타데이터가 없어, 누락 원인을 찾기까지 여러 가설을 거쳐야 했습니다.

---

## ✅ 해결: FK 영향 스캔 후 단일 트랜잭션 삭제

### FK 영향 스캔

`game_schedules`를 참조하는 FK가 있는 자식 테이블을 먼저 조사했습니다. `information_schema.referential_constraints`로 5개 child 테이블을 찾고, 문제의 5건에 대해 각각 행 수를 확인했습니다.

| 자식 테이블 | 행 수 |
|---|---|
| `seat_holds` | 0 |
| `seat_statuses` | 0 |
| `game_statuses` | 5 |
| `game_ticketing_statuses` | 5 |
| `orders` | 0 |
| `game_seat_inventories` | 0 |

실제로 정리해야 할 대상은 `game_statuses`와 `game_ticketing_statuses` 두 테이블뿐이었습니다. `orders`가 0이었던 것은 다행이었습니다 — 실제 결제까지 간 데이터가 있었다면 삭제가 아니라 별도의 데이터 이관 절차가 필요했을 것입니다.

### 트랜잭션 1개로 CTE 체인 삭제

자식 테이블부터 역순으로 삭제하되, 5건이 모두 성공했는지 원자적으로 보장하고 싶었습니다. 그래서 **CTE 체인 + 단일 트랜잭션**으로 묶었습니다.

```sql
BEGIN;
WITH ids AS (
  SELECT unnest(ARRAY[
    '8cf76ac8-a61c-4428-bca4-24a84af6ad8a',
    'bafbcd00-8476-4102-a391-b06702a6f0a3',
    'e4a558ef-6d57-4f35-8756-47a1013eec0c',
    '037126be-29b0-4baa-9899-3f31d94d47a2',
    'ead2be7d-04f0-42e7-9e29-6721ef06fee4'
  ]::uuid[]) AS id
),
d1 AS (
  DELETE FROM ticketing_service.game_ticketing_statuses
  WHERE game_schedule_id IN (SELECT id FROM ids)
  RETURNING 1
),
d2 AS (
  DELETE FROM ticketing_service.game_statuses
  WHERE game_schedule_id IN (SELECT id FROM ids)
  RETURNING 1
),
d3 AS (
  DELETE FROM ticketing_service.game_schedules
  WHERE id IN (SELECT id FROM ids)
  RETURNING 1
)
SELECT
  (SELECT COUNT(*) FROM d1) AS del_tkt_status,
  (SELECT COUNT(*) FROM d2) AS del_game_status,
  (SELECT COUNT(*) FROM d3) AS del_schedules;
COMMIT;
```

이렇게 한 이유는 세 가지입니다.

첫째, **원자성**입니다. 셋 중 하나라도 실패하면 전부 롤백되어, FK 제약 때문에 중간에 멈춰 부분 삭제된 상태를 남기지 않습니다.

둘째, **검증 용이성**입니다. 한 번의 실행으로 `del_tkt_status=5, del_game_status=5, del_schedules=5`가 나오는지 바로 확인할 수 있습니다. 여러 문장을 순차 실행하면 중간에 개수를 따로 세야 합니다.

셋째, **재현 가능성**입니다. 같은 스크립트를 개발 환경 검증 → 스테이징 검증 → 프로덕션 실행으로 그대로 옮길 수 있습니다.

### 사후 검증

삭제 직후 다시 inventory 일치 쿼리를 돌렸습니다.

```text
 future_games | games_with_inventory
--------------+----------------------
          605 |                  605
```

605/605로 맞아떨어졌습니다. 삭제한 game_schedule ID와 시작 시각은 다음과 같습니다.

```text
8cf76ac8-a61c-4428-bca4-24a84af6ad8a  2026-12-01 18:30
bafbcd00-8476-4102-a391-b06702a6f0a3  2026-12-02 18:30
e4a558ef-6d57-4f35-8756-47a1013eec0c  2026-12-03 18:30
037126be-29b0-4baa-9899-3f31d94d47a2  2026-12-25 18:30
ead2be7d-04f0-42e7-9e29-6721ef06fee4  2026-12-31 18:30
```

모두 stadium_id `75d8932b-3b72-4bbd-b670-29516fcc0f5d` (좌석 구조 0)에 속한 경기였습니다.

---

## Debug Pod 패턴 확립

이 작업 과정에서 부수적으로 얻은 도구가 있습니다. EKS prod에서 일회성 DB 작업을 할 때 쓰는 **debug pod 패턴**입니다.

처음 시도는 기본 설정으로 pod를 띄운 것인데, Istio sidecar가 함께 주입되면서 노드 리소스 부족으로 `Pending`에 걸렸습니다. 아래 스펙으로 회피했습니다.

- `annotations.sidecar.istio.io/inject: "false"` — Istio sidecar 제외.
- `labels.goti.io/debug: "true"` — Kyverno exception 후보 라벨(현재 정책 미도입, 추후 TODO).
- `securityContext`: `readOnlyRootFilesystem: true`, `runAsNonRoot(uid=70)`, `capabilities.drop: [ALL]`.
- 이미지: `postgres:16-alpine` + `TICKETING_DATABASE_URL` 환경변수 매핑.
- `activeDeadlineSeconds: 1800` + 작업 후 즉시 수동 `kubectl delete pod`.

실행 중 걸린 두 가지 함정도 기록해 둡니다.

**DATABASE_URL의 search_path query.** `TICKETING_DATABASE_URL`에 `?search_path=...` URI 쿼리가 붙어 있었는데, psql이 이를 거부했습니다. 아래처럼 `sed`로 제거한 뒤 사용했습니다.

```bash
export PGURL=$(echo "$TICKETING_DATABASE_URL" | sed 's/?search_path=[^&]*//')
psql "$PGURL"
```

**readOnlyRootFilesystem으로 인한 kubectl cp 실패.** `kubectl cp`는 컨테이너 파일시스템에 쓰기를 시도하기 때문에 실패합니다. 스크립트 전송은 stdin으로 대체했습니다.

```bash
kubectl exec -i <pod> -- sh -s << 'EOF'
# 여기에 스크립트 본문
EOF
```

이 패턴은 향후 prod DB 일회성 작업을 할 때마다 재사용할 수 있습니다.

---

## 📚 배운 점

- **갭이 보이면 seed 재실행이 아니라 원인부터.** 610 vs 605를 보고 바로 seed를 다시 돌렸다면 여전히 5건은 누락됐을 것이고, 원인을 놓친 채 더 꼬였을 수 있습니다. 카운트 불일치는 **데이터 품질 지표이자 알람**이라는 관점으로 봐야 합니다.
- **FK 영향 스캔을 삭제 전에.** 자식 테이블에 무엇이 남아 있는지 먼저 스캔하면, 삭제 순서와 원자적 처리 방법이 자동으로 정해집니다. `orders`에 행이 있었다면 삭제 자체를 보류하고 다른 절차를 밟았을 것입니다.
- **CTE 체인 + 단일 트랜잭션은 다건 정리의 기본 패턴.** 여러 자식 테이블을 순차 삭제할 때, 개별 DELETE 문장을 나열하는 것보다 원자성·검증 편의성·재현성 모든 면에서 우월합니다.
- **테스트 데이터는 생성 시점부터 구분 가능해야 합니다.** 운영 데이터와 섞이면 cleanup 비용이 급격히 커집니다. 태그·네이밍 prefix·별도 namespace 등 어떤 수단으로든 구분 메타데이터를 남겨야 합니다.
- **무결성 제약을 seed 레벨에 걸어둘 것.** "좌석 구조 없는 stadium"이 애초에 존재할 수 없도록 seed 스크립트 또는 application service 레벨에서 막아두면, 이런 고아 데이터가 다시 생기지 않습니다.

### 후속 TODO

1. **Seed 검증 CI job** — step5 성공 후 `future_games vs games_with_inventory` 일치를 자동 검증, 불일치 시 fail 처리.
2. **고아 stadium 방지 제약** — stadium 생성 시 `seat_sections` 없이 존재하는 상태를 허용하지 않는 제약.
3. **Red team 테스트 데이터 마킹** — `label: test-data` 같은 표식 후 정기 cleanup job.
4. **Kyverno debug exception 공식화** — `goti.io/debug=true` 라벨 기반 정책 bypass 정의.
