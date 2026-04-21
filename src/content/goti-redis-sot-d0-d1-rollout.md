---
title: "Redis SoT D0~D1 프로덕션 롤아웃 — 558ms를 32ms로"
excerpt: "Memorystore noeviction 교체와 seat-statuses SoT wiring 단 두 단계로 좌석 조회 응답을 900ms에서 32ms로 줄인 1주 시연용 롤아웃 기록입니다."
category: challenge
tags:
  - go-ti
  - Redis
  - SoT
  - Rollout
  - Production
  - Memorystore
  - Ticketing
series:
  name: "goti-redis-sot"
  order: 5
date: "2026-04-17"
---

## 한 줄 요약

> SDD-0005 D0~D7 로드맵 중 **D0 (Memorystore `noeviction` 교체) + D1 (seat-statuses SoT wiring)** 두 단계만 1주 시연 범위로 축소 실행했습니다. 서버 측 응답이 558~967ms에서 32ms 수준으로 개선됐습니다.

## Impact

- **영향 범위**: 좌석 진입 시 `/seat-statuses` 엔드포인트 (프론트 14개 동시 호출 경로)
- **증상**: 개별 응답 558~967ms, 좌석 진입 시 구조적 병목
- **측정 결과**: 서버 내부 평균 20ms, 최대 70ms (lazy build 포함)
- **발생일**: 2026-04-17

---

## 🔥 문제: `/seat-statuses`가 요청마다 PG LEFT JOIN을 직격한다

### 실관측

프론트에서 좌석 섹션 진입 시 다음 엔드포인트를 14개 동시 호출합니다.

```text
GET /api/v1/game-seats/{gameId}/sections/{sectionId}/seat-statuses
```

개별 응답은 558~967ms에 머물렀습니다. 좌석 진입 단계에서 구조적 병목이 발생하고 있었습니다.

### 원인이 모순적이었던 코드 상태

Redis SoT 관련 자산은 이미 대부분 구현되어 있었습니다. 문제는 **핸들러 wiring, flag, Cluster 세 가지가 전혀 정렬되지 않은 상태**라는 것이었습니다.

| 레이어 | 상태 |
|---|---|
| `SeatStatusService.GetSeatStatuses` (Redis HGETALL + lazy build) | 구현 완료 |
| `SeatStatusSoTRepository` (UniversalClient) | 구현 완료 |
| 핸들러 `GameSeatHandler.GetSeatStatuses` → `seatStatusSvc` 라우팅 | 미연결 (실제로는 `seatSvc.GetSeatsBySectionForGame` PG 직격 호출) |
| `cfg.Ticketing.RedisSoT.SeatStatuses` flag | false |
| Memorystore Cluster | 없음 (BASIC 1GB 단일, `redisCluster=nil`) |
| Memorystore `maxmemory-policy` | `allkeys-lru` (SoT 용도로는 위험) |

표를 한 줄로 요약하면 "설계는 있고 wiring만 빠져 있었다"입니다.

`SeatService.GetSeatsBySectionForGame`가 `seats LEFT JOIN seat_statuses`를 매 요청마다 실행하고 있었고, Redis 경로는 로드되지도 않은 채 대기 중이었습니다. flag 하나만 켜도 되는 문제가 아니라, Redis 인스턴스의 eviction 정책까지 함께 맞춰야 SoT로 안전하게 쓸 수 있는 상황이었습니다.

---

## 🤔 결정: 1주 시연 범위로 D0+D1만 실행

프로젝트 종료가 2026-04-24로 확인되면서, SDD-0005의 D0~D7 로드맵을 전부 실행할 시간이 없었습니다. 로드맵을 3 단계로 분리했습니다.

- **Start (1주 시연)**: BASIC 1GB 유지 + `noeviction` in-place 교체 + seat-statuses handler 재배선 + flag on
- **Mid (장기 재개)**: D2 이후
- **Target (10팀)**: 10팀 규모로 확장할 때의 최종 목표

ADR-0017은 "Redis as Source of Truth 전면 채택"으로 Accepted 상태이고, ADR-0014 Phase A는 D1 시점에 Supersedes 됩니다.

### 장기 로드맵에서 보류된 항목

D0, D1은 이번 1주 시연 범위에 포함되지만 그 이후는 장기 재개 시점으로 보존합니다.

- **D2**: seat_holds Lua
- **D3**: inventory reconcile
- **D4**: orders Lua
- **D5**: payment_confirm Lua + outbox worker
- **D6**: tickets
- **D7**: dual-write off

1주 시연이라는 제약이 범위 결정에 결정적 역할을 했습니다. 결제 경로(D4, D5)나 dual-write 제거(D7) 같은 단계는 리스크가 커서 짧은 시간에 검증하기 어렵습니다. **"가장 아픈 단일 병목(D1)만 푼다"**는 관점으로 범위를 잡았습니다.

---

## ✅ 해결

### D0 — Memorystore `noeviction` (Goti-Terraform)

Memorystore 설정을 `allkeys-lru`에서 `noeviction`으로 in-place 교체했습니다. SoT 용도에서는 데이터를 임의로 제거하면 안 되므로 eviction 정책 변경이 필수입니다.

| 단계 | 커밋 / 로그 |
|---|---|
| ADR-0017 + SDD-0005 갱신 (controller) | `9df9005`, `10e264a` |
| Migration 0006 (controller) | `b32eb12` → `10e264a` 로 재작성 (in-place) |
| observer_ro Cloud SQL RO 사용자 + Secret 엔트리 (이전 세션 마무리) | `0a6b0ce` |
| STANDARD_HA 5GB 전환 시도 → revert | `27c4b56` → `1b75b8f` |
| `maxmemory-policy`만 `noeviction`으로 교체 | `9761dd2` |
| Apply (2026-04-17 ~20:44 KST) | `0 added, 2 changed, 0 destroyed`, 43초 |

검증 명령은 다음과 같습니다.

```bash
$ gcloud redis instances describe ...
# BASIC 1 noeviction 10.195.173.91 6379 READY
```

이 단계에서 중요한 결정 하나는 **STANDARD_HA 5GB 전환을 포기한 것**입니다. 초기에는 고가용성을 확보하려 `27c4b56`에서 전환을 시도했지만, force-replace 동작 때문에 30~60분 다운타임과 월 약 $231의 비용이 추가로 발생합니다. 1주짜리 프로젝트에서 회수 불가능한 비용이었습니다. `maxmemory-policy`만 교체하는 in-place 방식으로 재작성했고, 비용은 $0을 유지했습니다.

### D1 — Goti-go seat-statuses SoT wiring

변경 대상은 3개 파일입니다.

**`cmd/ticketing/main.go`** — SoT repo 주입 경로를 열었습니다.

`seatStatusSoTRepo`를 `redisCluster`가 없어도 `redisClient` (UniversalClient)로 생성하도록 수정하고, `NewSeatService`에 SoT repo와 flag를 함께 주입합니다.

**`internal/ticketing/service/seat_service.go`** — 읽기 경로 분기를 추가했습니다.

```go
// SeatService 필드 추가
statusSoTRepo     SeatStatusSoTRepository
enableSoTRead     bool
sectionSeatsCache *cache.Cache  // TTL 5분
```

`GetSeatsBySectionForGame`는 flag에 따라 두 경로로 분기합니다.

- **ON + SoT repo 존재**: `getSeatsBySectionViaSoT` 경로로 진입합니다. `seatRepo.FindBySectionID`(캐시)와 `SoT.HGetAll`(Redis)을 사용하고, miss가 나면 PG에서 lazy build 후 `HSetMany`로 Redis에 채웁니다.
- **OFF**: 기존 PG LEFT JOIN fallback을 그대로 사용합니다.

이 분기의 핵심은 **lazy build 전략**입니다. Redis에 데이터가 없을 때 미리 모든 seat_status를 밀어 넣는 대신, 첫 요청에서 PG로 한 번 읽고 결과를 Redis에 채웁니다. 이후 요청은 Redis 경로로 흐르므로 cold start 비용만 발생합니다.

**`configs/ticketing.yaml`** — flag를 켰습니다.

```yaml
redis_sot:
  seat_statuses: true
```

빌드와 테스트 모두 통과했습니다.

```bash
$ go test ./internal/ticketing/service/... ./internal/ticketing/repository/...
# PASS (ticketing/service, ticketing/repository 전부 pass)
```

커밋: `e1bc2f3 feat(ticketing): SDD-0005 D1 — seat-statuses Redis SoT read 경로 활성화`.

### 배포 (Goti-k8s + ArgoCD)

| 단계 | 내용 |
|---|---|
| Goti-go workflow_dispatch | `cd-gcp.yml` services=ticketing, run #8 |
| GAR push | `asia-northeast3-docker.pkg.dev/.../goti-ticketing-go:gcp-8-e1bc2f3` |
| Goti-k8s PR #274 | `gcp-6-977130c → gcp-8-e1bc2f3` 단 1줄 변경 |
| 머지 (squash) | `b422b9f` |
| ArgoCD refresh + sync | `goti-ticketing-prod-gcp` `Synced/Healthy`, revision → `b422b9f` |
| Pod rolling | 2/2 `755f7c86dd-*` Running, 기동 로그 정상 (scheduler × 3, HTTP :8080 start) |

배포 경로는 표준 GitOps 흐름을 따랐습니다. Goti-go에서 이미지를 빌드·푸시하고, Goti-k8s의 values 파일에서 이미지 태그 한 줄을 바꿔 PR을 올립니다. ArgoCD가 자동으로 sync하면서 Pod가 rolling으로 교체됩니다.

---

## 측정

### 백엔드 자체 — 정상

Pod 내부 HTTP middleware 로그에서 21건의 동시 `seat-statuses` 요청의 지연을 추출했습니다.

```text
latency_ms: 62, 60, 69, 7, 8, 10, 15, 6, 28, 31, 37, 9, 27, 8, 10, 7, 28, 31, 37, 11, 9
→ 평균 20ms, 최대 70ms (첫 3건은 lazy build 포함)
```

D1 효과는 정상 작동했습니다. **서버 측 900ms → 32ms 수준 개선**을 확인했습니다. 첫 3건은 PG에서 lazy build를 수행하므로 조금 긴 지연을 보이고, 이후 요청은 Redis HGETALL 경로로 흘러 7~15ms에 수렴합니다.

### 프론트 체감 — 여전히 느림 (별도 이슈)

프론트 Network 탭 실측은 여전히 **766~1170ms**였습니다. 응답 크기는 3.7KB에서 13KB로 증가했습니다. lazy build 이후 모든 seat가 명시적으로 `"AVAILABLE"`로 serialize되기 때문입니다.

숫자를 분해해보면 네트워크 경로에 원인이 있다는 사실이 드러납니다.

```text
프론트: 966ms
백엔드:  32ms (x-envoy-upstream-service-time)
       ────
차이:   934ms  ← 네트워크 경로 문제
```

934ms는 백엔드 개선으로는 손댈 수 없는 영역입니다. 후속 조사에서 **Cloudflare Worker가 LAX PoP에서 실행되고 Seoul origin과 왕복**하는 것이 원인으로 확인됐습니다. 백엔드 SoT 전환과는 별개의 네트워크 레이어 이슈이므로 D1 작업 자체의 성공/실패와 분리해서 봐야 합니다.

Cloudflare Worker LAX 지연에 대한 상세 조사와 해결 옵션은 별도 글에서 다룹니다. D1 자체는 성공적으로 완료됐고, CF Worker 이슈는 Option A (Smart Placement 활성화)로 진행 중입니다.

---

## 트러블

### 1. revert가 필요했던 STANDARD_HA 전환

STANDARD_HA 5GB 전환 commit(`27c4b56`)을 1주 시연 범위를 인식한 시점에 revert했습니다. force-replace에 따른 30~60분 다운타임과 월 $231 비용이 1주 프로젝트에서 회수 불가능했습니다. `maxmemory-policy`만 교체하는 in-place 방식으로 재작성해서 비용을 $0으로 유지했습니다.

### 2. 보안 시스템 vs memory 권한 충돌

Goti-go는 사용자 개인 레포라는 memory (`feedback_goti_go_autonomy.md`)에 commit/push 전권이 기록되어 있었지만, 보안 시스템이 프로젝트 CLAUDE.md의 "팀 레포" 기본 규칙을 우선 적용했습니다. 사용자가 직접 `git commit`, `git push`를 수행해야 했고, 이후 세션에서 동일 이슈가 반복되면 프로젝트 CLAUDE.md 갱신으로 해결 가능합니다.

### 3. observer_ro 미커밋 변경 선분리

Goti-Terraform에 이전 세션의 미커밋 observer_ro 변경이 이번 Redis 변경과 같은 파일에 섞여 있었습니다. 섞인 commit을 방지하기 위해 다음 순서로 작업했습니다.

1. 먼저 Redis 변경을 되돌립니다.
2. observer_ro만 먼저 commit합니다 (`0a6b0ce`).
3. Redis 변경을 다시 적용합니다.

한 commit에 서로 다른 목적의 변경이 섞이면 revert 단위가 꼬이므로, 목적별로 분리하는 것이 원칙입니다.

---

## 📚 배운 점

### 설계가 되어 있어도 wiring이 빠지면 아무 효과가 없다

이번 사례는 **"코드 자산은 있지만 연결되지 않은 상태"**를 정확히 보여줍니다. `SeatStatusService`, `SeatStatusSoTRepository`, HGETALL 경로까지 이미 구현되어 있었지만, 핸들러가 `seatSvc.GetSeatsBySectionForGame`를 호출하는 한 PG 직격은 계속됩니다. flag, handler wiring, Cluster 설정 세 가지가 동시에 맞아야 SoT 경로가 실제로 작동합니다.

새 기능을 설계할 때 체크리스트에 "실제 핸들러에서 호출되는가"를 반드시 넣어야 합니다.

### 범위를 줄이면 롤아웃이 가능해진다

D0~D7 로드맵 전체를 1주 안에 하려고 했다면 롤아웃은 실패했을 것입니다. 1주라는 시간 제약 안에서 **가장 아픈 단일 병목(D1)만** 해결하는 Start 범위로 줄이면서 실제 효과(900ms → 32ms)를 확보할 수 있었습니다.

결제 경로나 dual-write 제거처럼 리스크가 큰 단계는 장기 재개 시점으로 보존하고, Start/Mid/Target 3단계로 로드맵을 분리한 결정이 이번 작업의 핵심이었습니다.

### in-place 교체 우선, force-replace는 최후 수단

STANDARD_HA로 전환하려던 시도는 force-replace 때문에 revert했습니다. Memorystore처럼 상태를 가진 리소스에서 force-replace는 다운타임과 비용 모두에 영향을 줍니다. 이번처럼 `maxmemory-policy`만 바꾸면 충분한 경우라면 in-place 교체로 충분합니다.

변경 전에 Terraform plan에서 "force-replace" 표시가 나오는지 확인하는 습관이 필요합니다.

### 서버 개선과 네트워크 개선은 분리해서 봐야 한다

D1 이후 백엔드는 32ms까지 떨어졌지만 프론트 체감은 900ms대였습니다. `x-envoy-upstream-service-time`으로 서버 측 지연을 분리해서 측정한 덕분에 **원인이 네트워크 레이어(CF Worker LAX)에 있음**을 즉시 특정할 수 있었습니다.

프론트 체감이 개선되지 않았다고 해서 백엔드 작업이 실패한 것은 아닙니다. 계층별로 측정값을 분리하고, 각 계층의 책임을 명확히 분리해야 정확한 원인 파악이 가능합니다.

---

## 📎 관련

- ADR-0017 Redis as Source of Truth 채택
- SDD-0005 revision D0~D7 로드맵 (Start/Mid/Target 3단계 분리)
- Migration 0006 Memorystore BASIC → STANDARD_HA (보류)
- Goti-Terraform: `9761dd2`
- Goti-go: `e1bc2f3`
- Goti-k8s: `b422b9f` (PR #274)
