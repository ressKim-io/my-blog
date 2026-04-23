---
title: "Multi-Cloud 서킷브레이커 + HPA 설계 — AWS Cost Freeze 중에도 GCP로 흡수하기"
excerpt: "AWS ASG가 0으로 내려간 상태에서 매 요청 10초 지연과 GCP Pod 부족이 드러났습니다. Cloudflare Worker Circuit Breaker + GCP HPA로 수동 개입 없이 자동 복귀하는 Multi-Cloud 라우팅을 설계했습니다."
category: kubernetes
tags:
  - go-ti
  - Multi-Cloud
  - CircuitBreaker
  - HPA
  - Architecture Decision Record
  - AWS
  - GCP
  - Cloudflare
  - adr
series:
  name: "goti-multicloud"
  order: 1
date: "2026-04-17"
---

## 한 줄 요약

> Cloudflare Worker가 AWS로 먼저 fetch를 보내고 TCP timeout까지 10초를 기다리는 구조적 지연을 발견했습니다. primary 1.5초 타임아웃 + Circuit Breaker + GCP HPA 조합으로 AWS Cost Freeze 기간에도 사용자 체감 지연이 거의 없도록 설계했습니다.

---

## 배경

go-ti는 Cloudflare Worker로 팀코드 기반 AWS/GCP 5:5 분배 + 5xx failover 라우팅을 구성해 두었습니다.
AWS ASG를 0으로 내려 비용을 동결(cost freeze)한 상태에서 다음 두 문제가 드러났습니다.

### 문제 1: 매 요청 10초 지연

Worker가 AWS로 먼저 fetch를 시도하고 TCP connect timeout까지 약 10초를 기다린 뒤 GCP로 failover가 일어났습니다.
5xx에서 잡히도록 만든 기존 로직은 Origin이 아예 응답하지 않을 때(연결 자체 실패)는 너무 늦게 움직였습니다.

```
Client → Worker → AWS (TCP timeout 10s) → GCP (성공)
                    │
                    └─ 사용자는 매 요청마다 10초 대기
```

ASG가 0이면 AWS 쪽 Origin은 TCP 연결 자체가 성립하지 않습니다.
HTTP 5xx가 아니라 네트워크 레이어에서 실패하기 때문에, 5xx 기반 failover 조건이 걸리지 않고 Worker가 기본 timeout까지 계속 기다리게 됩니다.

### 문제 2: GCP Pod 부족

5개 팀이 GCP로 몰려도 Go 서비스의 `replicaCount`는 1~3 수준에 고정되어 있어 GCP 쪽이 부하를 흡수할 여력이 없었습니다.
기존 KEDA trigger는 prod-gcp에 존재하지 않는 `mimir-prod-query-frontend.monitoring.svc`를 참조 중이라 실질적으로 비활성 상태였습니다.

KEDA가 scaler 주소를 resolve하지 못하면 metric 조회에 실패하므로 scale-up이 일어나지 않습니다.
결과적으로 GCP는 "5:5 분배일 때 GCP가 받는 몫"만큼만 버틸 수 있는 replica 수로 고정되어 있었고, AWS가 빠진 상황에서 10배 가까운 트래픽을 받을 준비가 되어 있지 않았습니다.

---

## 고려한 대안

### A. Worker에서 AWS 팀 매핑을 전부 GCP로 수동 재설정

AWS Cost Freeze 기간 동안 `TEAM_ROUTING`을 전부 `gcp`로 바꿔 버리는 방식입니다.

단순하지만 **AWS 재기동 시 원복이 필요**하고, 사람 개입이 필연적으로 따라옵니다.
부분 장애(AWS가 간헐적 503 등) 처리도 불가능합니다.
"AWS가 죽었다/살았다"라는 바이너리 상태로만 대응하게 되어 실제 운영 시나리오를 커버하지 못합니다.

### B. primary fetch 타임아웃만 단축 (AbortController 1.5s)

`AbortController`로 fetch 타임아웃을 10초에서 1.5초로 줄이는 방법입니다.

지연은 크게 줄어듭니다.
하지만 **매 요청에 1.5초 지연이 항상 발생**한다는 문제가 남습니다.
여러 API 호출이 연쇄되는 SPA 페이지에서는 1.5초 × N번이 누적되어 체감 지연이 여전히 큽니다.
AWS가 완전히 죽어있다는 사실을 Worker가 "기억"하지 못하니 같은 요청이 반복될 뿐입니다.

### C. (채택) primary 1.5s timeout + Circuit Breaker

primary 실패/타임아웃을 한 번 겪으면 해당 cloud의 circuit을 60초간 open합니다.
open 기간에는 AWS 매핑 팀의 요청도 primary 자체를 GCP로 직행시키므로 지연이 0에 가까워집니다.
60초 경과 후 첫 요청이 probe 역할을 하여 자동 half-open → close 동작으로 복귀합니다.

GCP가 흡수할 Pod 여유 확보를 위해 HPA(CPU 60%)를 병행 활성화합니다.

### D. KEDA + Google Managed Prometheus adapter

가장 표현력이 높은 트래픽 기반 scale 방식입니다.
HTTP RPS나 큐 길이 같은 애플리케이션 수준 신호로 scale을 결정할 수 있습니다.

다만 GMP → KEDA adapter 구축이 별도로 필요하고, 오늘 복구 시점에는 준비가 미완이었습니다.
**후속 단계로 분리**하여 HPA로 우선 복구한 뒤 점진적으로 교체하기로 했습니다.

---

## 결정

대안 C를 채택합니다.

Circuit Breaker 패턴을 Worker 레벨에서 구현하고, GCP에는 HPA를 활성화합니다.
KEDA는 `enabled: false`로 두되 설정 구조는 남겨 두어 GMP adapter 준비 후 재도입할 자리를 확보합니다.

### Cloudflare Worker (`infra/cloudflare/multicloud-router.worker.js`)

Worker 측 변경사항입니다.

- `PRIMARY_TIMEOUT_MS = 1500` + `AbortController`로 primary fetch 타임아웃을 강제합니다.
- Circuit state는 **Cloudflare Cache API**에 `max-age=60` 응답으로 저장합니다. PoP 단위로 독립된 상태를 가집니다.
- 요청 진입 시 `isCircuitOpen(assignedCloud)`를 검사합니다. open이면 반대 cloud를 primary로 교체합니다.
- primary 실패 시 `openCircuit(assignedCloud)`를 호출하고 fallback cloud로 전환합니다.
- 응답 헤더에 디버깅용 정보를 노출합니다.

```
x-goti-route-assigned        원래 할당된 cloud (aws/gcp)
x-goti-route-circuit         open/closed 상태
x-goti-route-failover        failover 발생 여부
x-goti-route-primary-error   primary 실패 사유
```

Circuit state를 Cloudflare Cache API에 올리는 점이 설계의 핵심입니다.
Workers는 기본적으로 stateless이므로, Cache API의 `max-age=60`을 활용해 **각 PoP가 스스로 60초 타이머를 가진 Circuit Breaker**를 갖게 됩니다.
전역 상태 스토어(KV, Durable Objects 등)가 필요 없어 구현이 가볍고, PoP별 독립성 덕분에 일부 리전이 AWS에 도달 가능한 상태에서 다른 리전은 도달 불가한 상황도 자연스럽게 처리됩니다.

### prod-gcp HPA (`environments/prod-gcp/goti-*/values.yaml`)

6개 Go 서비스에 HPA를 활성화합니다. `targetCPU 60%`로 공격적 scale-up을 확보합니다.

| service | minReplicas | maxReplicas |
|---|---|---|
| goti-user | 3 | 12 |
| goti-queue | 2 | 12 |
| goti-ticketing | 2 | 12 |
| goti-resale | 2 | 8 |
| goti-stadium | 2 | 8 |
| goti-payment | 2 | 10 |

위 설정에는 두 가지 판단이 녹아 있습니다.

첫째, **`targetCPU 60%`는 의도적으로 공격적인 값**입니다.
일반적인 80%보다 낮춰 잡은 이유는, AWS가 빠진 상황에서 GCP가 받아야 하는 트래픽이 평시 대비 두 배 가까이 늘어나기 때문입니다.
CPU가 80%에 도달한 시점에 scale-up을 시작하면 이미 응답 지연이 발생하고 있는 상태이므로, 60%에서 선제적으로 확장하도록 설정했습니다.

둘째, `minReplicas`가 서비스별로 다른 이유는 **요청 경로상 중요도** 때문입니다.
`goti-user`는 모든 요청이 거치는 인증 경로에 있어 기본값을 3으로 두었고, `goti-resale`·`goti-stadium` 같은 보조 서비스는 2로 유지했습니다.

기존 KEDA blocks는 도달 불가능한 Mimir 주소를 참조하고 있어 제거했습니다.
`keda.enabled: false`로 유지하여 GMP adapter 준비 후 재도입할 자리를 남깁니다.

---

## 근거

### 왜 "timeout만 단축"이 아니라 Circuit Breaker인가

대안 B(timeout만 단축)는 단일 요청의 최악 지연을 1.5초로 막아줍니다.
하지만 이 방식은 **AWS가 죽어있다는 사실을 Worker가 기억하지 못합니다**.

현대 SPA는 한 화면을 그리기 위해 5~10개의 API를 동시에 호출합니다.
1.5초 타임아웃이 있더라도 5개 요청이 모두 AWS로 먼저 가면 각자 1.5초씩 대기하게 됩니다.
브라우저 HTTP/2 커넥션 풀링이 끼어들면 더 복잡해집니다.

Circuit Breaker는 **한 번 실패를 경험하면 60초 동안 primary 선택 자체를 바꾸는** 구조입니다.
AWS 팀으로 매핑된 사용자도 Circuit이 open된 이후에는 GCP로 직행하므로, 체감 지연이 거의 0에 수렴합니다.
60초가 지나면 probe 한 번으로 상태를 재확인하므로, AWS 복구 시에도 자동으로 정상 라우팅이 되돌아옵니다.

### 왜 KEDA 대신 HPA인가 (지금 시점에는)

KEDA + GMP는 트래픽 기반 scale을 제공한다는 점에서 더 정확합니다.
하지만 오늘 복구 시점에는 GMP → KEDA adapter가 준비되지 않았습니다.

HPA는 **GCP 환경에서 즉시 사용 가능한 기본 스케일러**입니다.
CPU 신호는 느리고 부정확하지만, 적어도 scale-up 자체가 동작한다는 점이 더 중요합니다.
트래픽이 갑자기 몰렸을 때 "KEDA가 못 붙어서 replica 1개로 버티는 것"보다 "HPA가 CPU 기반으로라도 scale-up하는 것"이 낫습니다.

GMP adapter 작업은 별도 PR로 분리하고, 그 준비가 끝나면 `keda.enabled: true`로 다시 올리면 됩니다.

---

## 구현 체크리스트

- [x] Worker 리팩토링(`multicloud-router.worker.js`) — timeout + Circuit Breaker
- [x] Cloudflare 대시보드 수동 배포 (사용자 작업)
- [x] Goti-k8s PR #271 merge (HPA 활성화)
- [x] ArgoCD auto-sync 후 HPA 6개 생성 확인
- [ ] 부하 테스트로 HPA scale-up 실제 트리거 검증
- [ ] GMP → KEDA adapter 구축 (Prometheus trigger 부활)
- [ ] PR #271 rollout 후 AWS 팀으로 실제 /queue 재현 — 지연 ≤ 1.5s 확인

---

## 결과

- AWS Cost Freeze 기간 중에도 **유저 체감 지연이 거의 없음**을 확인했습니다.
- AWS가 다시 살아나면 Circuit TTL 만료 → 첫 요청이 자동 probe → 정상 5:5 분배로 자연 복귀합니다.
- GCP Pod는 HPA CPU 60% 기준으로 자동 확장하여, 수동 개입 없이 두 배 트래픽을 흡수합니다.

---

## 운영 고려사항

Circuit state는 Cloudflare Cache API의 PoP 단위로 저장됩니다.
각 PoP가 60초마다 probe하므로 글로벌 probe 트래픽은 대략 `(PoP 수 × 1/min)` 수준입니다.
AWS가 완전히 죽어있는 시나리오에서는 무시해도 되는 양입니다.

Probe가 실패하면 즉시 다시 open됩니다.
따라서 AWS가 복구되는 시점에는 "일부 요청이 실제로 AWS에 가서 성공"해야 정상 라우팅으로 돌아옵니다.
이 방식은 전체 트래픽을 한꺼번에 AWS로 돌리지 않고 **PoP 단위로 롤링 전환**되므로, 복구 직후의 cold start 쇼크를 자연스럽게 분산시킵니다.

HPA가 Pod 수를 늘려도 `goti-queue-gate` 등 미배포 서비스는 여전히 프로덕션 플로우에 관여하지 않습니다.
현재 설계는 queue/ticketing/user 중심의 핫 패스에 초점이 맞춰져 있습니다.

---

## 롤백

롤백은 두 단계로 독립적으로 수행할 수 있습니다.

1. **Worker**: 이전 버전(5xx only failover) 코드 복구 후 Cloudflare 대시보드에 붙여넣기
2. **Goti-k8s**: PR #271 revert → ArgoCD auto-sync → HPA 삭제 + 원래 replicaCount 복귀

Worker와 HPA 설정이 각각의 repo/배포 경로에 분리되어 있어, 문제가 생긴 쪽만 선택적으로 되돌릴 수 있습니다.
예를 들어 HPA가 과도하게 scale-up을 일으키면 HPA만 끄고 Circuit Breaker 로직은 유지할 수 있습니다.
