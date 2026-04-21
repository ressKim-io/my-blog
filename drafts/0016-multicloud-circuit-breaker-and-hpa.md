# ADR 0016 — Multi-cloud 장애 대응: Cloudflare Worker Circuit Breaker + GCP HPA

- 상태: Accepted
- 결정일: 2026-04-17
- 관련 문서: `docs/dev-logs/2026-04-17-jwt-issuer-401-root-fix.md`, `memory/project_aws_cost_freeze_gcp_only.md`, `memory/project_cloudflare_multicloud_worker.md`
- 영향 레포: goti-team-controller (Worker 소스), Goti-k8s (prod-gcp values)

## 컨텍스트

Goti 는 Cloudflare Worker 로 팀코드 기반 AWS/GCP 5:5 분배 + 5xx failover 라우팅을 구성해 두었다. AWS ASG 가 0 으로 내려간 상태(cost freeze) 에서 다음 두 문제가 드러났다.

1. **매 요청 10초 지연**: Worker 가 AWS 로 먼저 fetch 를 시도하고 TCP connect timeout 까지 ~10 초를 기다린 뒤 GCP 로 failover. 5xx 에서 잡히도록 만든 기존 로직은 origin 이 아예 응답하지 않을 때(연결 자체 실패) 는 너무 늦게 움직였다.
2. **GCP pod 부족**: 5개 팀이 GCP 로 몰려도 Go 서비스 replicaCount 는 1~3 수준에 고정돼 있어 GCP 쪽이 부하를 흡수할 여력이 없었다. 기존 KEDA trigger 는 prod-gcp 에 존재하지 않는 `mimir-prod-query-frontend.monitoring.svc` 를 참조 중이라 실질적으로 비활성.

## 고려한 대안

### A. Worker 에서 AWS 팀 매핑을 전부 GCP 로 수동 재설정
- AWS cost freeze 기간 동안 TEAM_ROUTING 을 전부 `gcp` 로 바꿔 버림.
- AWS 재기동 시 원복 필요. 사람 개입 필연.
- 부분 장애(AWS 가 간헐적 503 등) 처리 불가.

### B. primary fetch 타임아웃만 단축 (AbortController 1.5s)
- 10 초 → 1.5 초로 줄어드나, 매 요청에 1.5 초 지연이 항상 발생.
- 여러 API 호출이 연쇄되면 누적 체감 지연이 여전히 크다.

### C. (채택) primary 1.5s timeout + Circuit Breaker
- primary 실패/타임아웃을 한 번 겪으면 해당 cloud 의 circuit 을 60 초간 open.
- open 기간에는 AWS 매핑 팀 요청도 primary 자체를 GCP 로 직행 (지연 0).
- 60 초 경과 후 첫 요청이 probe 역할을 하여 자동 half-open → close 동작.
- GCP 가 흡수할 pod 여유 확보를 위해 HPA (CPU 60%) 를 병행 활성화.

### D. KEDA + Google Managed Prometheus adapter
- 가장 표현력 높은 트래픽 기반 scale.
- GMP → KEDA adapter 구축이 필요하고, 오늘 복구 시점에는 준비 미완. 후속 단계로 분리.

## 결정

대안 C 를 채택한다.

### Cloudflare Worker (`infra/cloudflare/multicloud-router.worker.js`)

- `PRIMARY_TIMEOUT_MS = 1500` + `AbortController`
- Circuit state 는 Cloudflare Cache API 에 `max-age=60` 응답으로 저장 (PoP 단위 독립)
- 요청 진입 시 `isCircuitOpen(assignedCloud)` 검사 → open 이면 반대 cloud 를 primary 로 교체
- primary 실패 시 `openCircuit(assignedCloud)` 호출 + fallback cloud 로 전환
- 응답 헤더에 `x-goti-route-assigned`, `x-goti-route-circuit`, `x-goti-route-failover`, `x-goti-route-primary-error` 노출 (디버깅)

### prod-gcp HPA (`environments/prod-gcp/goti-*/values.yaml`)

6개 Go 서비스에 HPA 활성화. targetCPU 60 % 로 공격적 scale-up 확보.

| service | minReplicas | maxReplicas |
|---|---|---|
| goti-user | 3 | 12 |
| goti-queue | 2 | 12 |
| goti-ticketing | 2 | 12 |
| goti-resale | 2 | 8 |
| goti-stadium | 2 | 8 |
| goti-payment | 2 | 10 |

기존 KEDA blocks 는 unreachable Mimir 주소를 참조하고 있어 제거. `keda.enabled: false` 로 유지하여 GMP adapter 준비 후 재도입할 자리를 남긴다.

## 구현 체크리스트

- [x] Worker 리팩토링 (`multicloud-router.worker.js`) — timeout + Circuit Breaker
- [x] Cloudflare 대시보드 수동 배포 (사용자 작업)
- [x] Goti-k8s PR #271 merge (HPA 활성화)
- [x] ArgoCD auto-sync 후 HPA 6개 생성 확인
- [ ] 부하 테스트로 HPA scale-up 실제 트리거 검증
- [ ] GMP → KEDA adapter 구축 (prometheus trigger 부활)
- [ ] PR #271 rollout 후 AWS 팀 (SS 등) 으로 실제 /queue 재현 — 지연 ≤ 1.5 s 확인

## 결과

- AWS cost freeze 기간 중에도 유저 체감 지연 거의 없음.
- AWS 가 다시 살아나면 circuit TTL 만료 → 첫 요청이 자동 probe → 정상 5:5 분배로 자연 복귀.
- GCP pod 는 HPA CPU 60 % 기준으로 자동 확장, 수동 개입 없이 2배 트래픽 흡수.

## 운영 고려사항

- Circuit state 는 Cloudflare Cache API 의 PoP 단위. 각 PoP 가 60 초마다 probe 하므로 글로벌 probe 트래픽은 `(PoP 수 × 1/min)` 수준. AWS 가 완전히 죽어있는 시나리오에서는 무시 가능.
- probe 의 실패 시 즉시 다시 open 되므로 AWS 가 복구되는 시점에는 "일부 요청이 실제로 AWS 에 가서 성공" 해야 정상 라우팅으로 돌아옴. 롤링 방식으로 부드럽게 전환됨.
- HPA 가 pod 수를 늘려도 `goti-queue-gate` 등 미배포 서비스는 여전히 프로덕션 플로우에 관여하지 않는다 (queue/ticketing/user 중심).

## 롤백

1. Worker: 이전 버전 (5xx only failover) 코드 복구 후 Cloudflare 대시보드에 붙여넣기
2. Goti-k8s: PR #271 revert → ArgoCD auto-sync → HPA 삭제 + 원래 replicaCount 복귀
3. 두 단계는 독립적으로 롤백 가능
