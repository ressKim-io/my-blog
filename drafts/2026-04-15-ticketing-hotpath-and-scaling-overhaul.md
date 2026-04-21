# 2026-04-15 — Ticketing Hot Path 근본 원인 진단 + Redis SoT 설계 + Scaling 튜닝

> 4차 부하(2026-04-14, 3000 VU, `ticket_success_rate 7.8%`, p99 거의 전부 10s)의 진짜 병목을
> 코드/쿼리/리소스 수준에서 분리하고, 단기 최적화(Phase 1+2)와 중장기 아키텍처 전환(Redis SoT)을
> 동시에 설계한 하루.

## 0. 출발점

전날 4차 부하 결과 + 분석 문서 (`docs/architecture/ticketing-flow-and-bottleneck-analysis.md`).
사용자 첫 요구: "AWS 안 올리고, 각 API 느린 원인 진짜 상세하게 분석. Kafka 도입해도 될 정도로 심각하면 그렇게."

## 1. SDD-0004 — Hot Path 근본 원인

병렬 4 조사 (Explore × 4 + 직접 검증):

| 영역 | 발견 |
|---|---|
| `/orders` (Go orderCreateService) | context timeout 부재 / **FindPrice N+1** / pricing 인덱스 부족 / TX 7쿼리 |
| `/payment-confirmations` | payment→ticketing **동기 chain** (timeout 10s margin 1.5s) — 36.65% 5xx 진짜 원인. (Java 코드로 봤음, Go 재검증 필요 명시) |
| seat-hold | distLock WaitTimeout 1s 너무 짧음 / TX 3쿼리 / sectionID 추가 lookup |
| PostgreSQL bloat | 로컬 PG 접근 timeout, 어제 ANALYZE만 적용. autovacuum_analyze_scale_factor 조정 필요 |

**Kafka 적용 매트릭스** 결론: `/payment-confirmations`만 적합. 그러나 프로젝트가 4월에 Kafka 의도적 제거 → **Postgres Outbox 권고** (운영 부담 ↓).

## 2. SDD-0005 — Redis as Source of Truth

사용자: "redis 로 올릴 수 있는게 더 없어?? db 안거치고 redis 로 처리해도 되는게 많이 보이는데?"

**자기비판**: 처음에 read cache 프레임에 갇혔음. 진짜 티켓팅 시스템은 "Redis = SoT, RDS = audit". Phase A 패턴을 종착점으로 다룬 게 실수.

병렬 조사 (`ticketing-expert` + `redis-expert`):
- seat_statuses Hash, seat_holds TTL STRING, orders/order_items, tickets, inventory HINCRBY 모두 Redis SoT 전환
- Redis Cluster 6M+6R, hash tag `{game_id}`, AOF everysec + RDB
- Redis Stream outbox (Kafka 대체) + Go worker → RDS UPSERT
- D0~D7 단계별 rollout

**Kafka 비교**: 사용자 질문에 솔직 답변. 결론: 지금은 미도입, 단 `EventBus` 인터페이스 추상화로 미래 전환 비용 최소화.

## 3. SDD-0006 — Karpenter NodePool 초안

사용자 고민: "ticket pod 리소스만 늘리는 게 나은지, pod 늘려서 분산이 나은지? Karpenter로 ticket 전용 CPU-heavy spot 노드?"

**핵심 답변**: "vertical vs horizontal" 잘못된 프레임. CPU 117%는 증상, 진짜 원인은 코드 병목. **측정 선행 + NodePool은 초안만**. 사용자 채택.

## 4. SDD-0007 + Plan Mode — Scale-out 반응성 튜닝

사용자: "keda나 karpenter 설정 다듬을 필요 있지 않아? 부하 들어올때 터지고 나서 늘어나는 경향."

KEDA/Karpenter 감사 → 충격적 발견:
- **Karpenter NodePool 파일 전체 주석 상태 → 미작동**
- KEDA pollingInterval 30s + Prometheus `[1m]` → ~90s 지연
- chart `_hpa.tpl`이 KEDA advanced 필드 미지원 → values만 변경해도 효과 없음

Plan mode 전환 → spot-only 채택 → 3개 PR 분리.

## 5. 실행 — 6개 PR 생성 + 리뷰 사이클

### Goti-k8s

| PR | 제목 | 변경 | 리뷰 후 수정 |
|---|---|---|---|
| #257 | Phase 1+2 hot path | ticketing CPU/memory + pgbouncer label + redis-cluster scaffold | CR-001~016 (16건 종합) → CR-001/002/009/010 등 9건 적용 |
| #258 | chart KEDA advanced 필드 | _hpa.tpl optional 필드 4종 | CR-001 (hasKey), CR-002 (Chart.yaml 0.2.0 bump) |
| #259 | Karpenter NodePool spot | 주석 해제 + spot-only + overprovision | CR-001 (nodeSelector pool=app-spot), CR-002 (namespace karpenter), CR-004 (WhenEmpty + 30m) |
| #260 | v2 6 services KEDA 튜닝 | pollingInterval/cooldown/advanced behavior/cron prewarm/MaxConns | CR-001 (.cluster.local), CR-002 (stale 주석), CR-003 (stabilizationWindow 15), CR-004 ([45s]), CR-006 (cron 09:20), CR-007 (queue 주석) |

### Goti-go (main + deploy/prod 둘 다 push)

| 커밋 | 내용 |
|---|---|
| `02c63db` | Timeout middleware 5s + Stadium 5min cache + seat_lock_wait 1→3 |
| `942b299` | FindPrice N+1 → cache 선형검색 (DB 0) + sectionID 추가 lookup 제거 + pricing 인덱스 마이그레이션 003 |

### controller (SDD + dev-log)

- SDD-0004 (hot path), SDD-0005 (Redis SoT), SDD-0006 (Karpenter), SDD-0007 (plan)
- dev-log: pod scaling 의사결정, 본 문서

## 6. 리뷰 사이클 패턴 확립

각 PR마다:
1. `gh pr diff` + Gemini 코멘트 fetch (병렬)
2. 3관점 Claude 에이전트 병렬 (Helm/Security/Ops)
3. 종합 → 사용자 확인 → 게시
4. Critical/High 즉시 수정 → push

**Gemini vs Claude 갭 패턴 확립** (`reference_gemini_review_gaps.md` 강화):

| 영역 | Gemini | Claude |
|---|---|---|
| 단일 파일 옵션 조합/표현 일관성 | ✅ 강함 | ✅ 동의 |
| 시스템 간 상호작용 (HA, blast radius) | ❌ 거의 못 잡음 | ✅ 잘 잡음 |
| 비용/공격 amplification | ❌ 못 잡음 | ✅ 잘 잡음 |
| 인프라 메커니즘 정확성 (Karpenter v1 등) | ❌ **사실 오류 1건** | ✅ 반박 |
| 프로젝트 컨텍스트 (multi-cloud, legacy) | ❌ 모름 | ✅ 활용 |
| Helm chart schema (Bitnami key 경로 등) | ❌ 모름 | ✅ 잘 잡음 |
| Chart.yaml version bump 필요성 | ❌ 모름 | ✅ 잘 잡음 |

**3 PR 종합**: Gemini 9건 / Claude 종합 33건 (Critical 7, High 7, Major 14, Minor 5).

## 7. 의사결정 기록

| 결정 | 채택 | 근거 |
|---|---|---|
| Kafka 재도입 vs Outbox/Stream | **Redis Stream + Postgres Outbox** | Kafka 4월 의도적 제거, 운영 부담↓, 단일 consumer면 Stream 충분 |
| Redis SoT 전환 시점 | **D0~D7 단계별, 측정 선행** | 큰 변화이므로 단일샷 검증 위험. Phase 1+2 효과 측정 후 |
| Karpenter capacity-type | **spot-only** | 학습 환경, 비용 60~90% 절감, 다중 instance/AZ로 회수 완화 |
| NodePool 활성화 시점 | **PR-2로 즉시** | 기존 Spot NodeGroup 16 core 한계가 명확, scaffolding만 두면 효과 0 |
| pod scaling 방식 | **Vertical baseline + Horizontal HPA + 측정 후 NodePool 분리** | 코드 최적화가 진짜 레버, 인프라는 baseline |
| AWS 검증 방식 | **단일 창에서 Phase 1+2 + Scaling 한번에** | 4시간 제약, 코드/인프라 효과 통합 측정 |
| 리뷰 후 즉시 수정 | **Critical/High 같은 PR에 추가 commit** | 머지 1회로 끝, 별도 PR 부담 회피 |

## 8. 회고

### 잘한 점

- 사용자 첫 의도("Kafka 정도 심각")를 검증하면서 "잘못된 프레임" 발견 (Kafka 1곳만 적합 → Redis SoT 더 큰 그림)
- 자기비판 ("Phase A 종착점으로 다룸") → SDD-0005 발전형 도출
- Plan mode 활용으로 사용자 합의 후 실행 (Scaling 튜닝)
- 6 PR 생성 + 3관점 리뷰 + Gemini 비교 + 수정 사이클 모두 자동화

### 아쉬운 점

- payment-confirmations agent가 Java 코드(Goti-server)를 봤음. Phase 3 착수 전 Go 재검증 필요 (SDD-0004 7절 명시)
- 처음에 ticketing-expert 서브에이전트를 안 썼음. 사용자 지적("redis 더 못 올려?") 후 호출해서 Redis SoT 도출. 다음부터 도메인 전문 에이전트를 초기 조사에 포함
- LSP 워크스페이스 false positive 다수 (Goti-go 모듈 미인식). 무시 가능했지만 첫 발생 시 혼란

### 패턴 발견

- **"증상 vs 근본 원인"** 분리: CPU throttling은 증상, 코드 N+1이 원인
- **Gemini는 "단일 파일 마이크로", Claude는 "시스템 간 매크로"** 강점이 다름
- **chart 캐싱**(Library Chart `.tgz` 버전 기반)은 Gemini가 모름 → 사람이 알려줘야

## 9. AWS 복구 후 (8시 예정) 체크리스트

1. **Goti-k8s 머지 순서**:
   - PR #257 (Phase 1+2 hot path)
   - PR #258 (chart KEDA fields) — chart 캐시 재패키징 위해 먼저
   - PR #259 (Karpenter spot) — 30분 관찰 (`kubectl get nodes -l karpenter.sh/capacity-type=spot -w`)
   - PR #260 (v2 KEDA tuning)
2. **DB 작업**: `psql -c "\\i migrations/003_pricing_performance_indexes.sql"` (CONCURRENTLY, non-blocking)
3. **5차 부하 측정**:
   - `ticket_success_rate` (목표 50%+)
   - `/orders` p50/p95
   - `/seat-reservations` p50/p95
   - `kube_horizontalpodautoscaler_status_current_replicas` 추이
   - `karpenter_nodeclaims_created_total`
   - `container_cpu_cfs_throttled_periods_total`
4. **결과 dev-log**: `docs/load-test/2026-04-15-5th-phase1-and-scaling.md`

## 10. 관련 산출물

### SDD
- `docs/dx/0004-ticketing-hotpath-root-cause-sdd.md`
- `docs/dx/0005-redis-source-of-truth-sdd.md`
- `docs/dx/0006-ticketing-karpenter-nodepool-sdd.md`
- Plan: `~/.claude/plans/misty-seeking-orbit.md` (SDD-0007, 머지 후 docs로 이동 예정)

### Dev-log
- `docs/dev-logs/2026-04-15-pod-scaling-vs-karpenter-nodepool-discussion.md`
- 본 문서

### PR
- Goti-k8s #257, #258, #259, #260
- Goti-go main / deploy/prod (2 commits)

### Memory
- `reference_gemini_review_gaps.md` 신규
- MEMORY.md 인덱스 update
