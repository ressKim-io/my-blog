# ADR 0025 — Multi-Cloud 상위 아키텍처 (Active-Passive with 팀 코드 라우팅)

- 상태: Accepted
- 결정일: 2026-04-15 (최초 확장) · 2026-04-17 (Circuit Breaker) · 2026-04-18 (DB Primary GCP 전환) · 2026-04-19 (AWS cost freeze 전환)
- 결정 주체: 리더
- 성격: **헤더 ADR** — Multi-Cloud 상위 설계. DB 계층(0018~0021), 장애 대응(0016), 세션(0015) 하위 ADR 들의 상위 컨텍스트를 정의한다
- 관련 ADR:
  - `0001-istio-service-mesh.md` (각 CSP 독립 mesh)
  - `0005-cloudflare-cdn-migration.md` (CDN + Workers 기반)
  - `0015-jwt-issuer-sot-in-k8s-values.md` (cross-cloud 세션 호환)
  - `0016-multicloud-circuit-breaker-and-hpa.md` (장애 자동 failover)
  - `0018-multicloud-db-replication-technology.md` (DB 기술 선정)
  - `0019-db-active-passive-with-read-split.md` (DB RW/RO 구조)
  - `0020-db-failback-reverse-replication.md` (Failback 전략)
  - `0021-pglogical-mr-replication-known-gaps-and-roadmap.md` (복제 한계)
  - `kafka-adoption-decision.md` → **Superseded** (Kafka 제거됨)
- 영향 레포: 전체 (Goti-Terraform, Goti-k8s, Goti-go, Goti-front, Goti-monitoring, goti-team-controller)
- 참고 문서: `docs/project/final-goal.md`, `docs/project/reference-multi-cloud.md`

---

## 컨텍스트

### 문제 정의

Goti 는 단일 CSP에 묶일 수 없는 구조적 요구 3가지를 동시에 만족해야 한다.

1. **단일 CSP 리전 장애 = 서비스 전면 중단** — 티켓 오픈 시각에 이게 터지면 복구 전 경기 예매가 전부 무효
2. **15인 팀 프로젝트 제약** — 삼성 계열·두산 계열 멤버가 각자 담당 환경을 보유해야 함. "GCP 학습 목적" 이 아니라 **팀 구성의 현실적 필요**
3. **50만 동시 트래픽 목표** — 단일 CSP에서도 처리 가능하나, 2-cloud로 분산하면 pod 여유·네트워크 경로가 자연스럽게 둘로 나뉜다

이 셋을 한 번에 풀려면 "2-cloud 가 상시 가동" 그 자체가 제약이자 이점이다.

### 실관측

- **팀 구성**: 담당 인원이 삼성/두산 계열로 절반씩 배분됨 → 팀 코드 기반 라우팅이 자연스러운 단위
- **DNS**: Cloudflare `go-ti.shop` (ADR-0005로 이미 전환 완료). Workers + CDN + WAF 가 상위 계층에서 사용 가능
- **1주 시연 범위**: 프로젝트 운영 기간 ~2026-04-24. Multi-cluster Istio mesh 같은 무거운 도입은 범위 초과
- **비용 제약**: 상시 2-cloud 운영 비용 부담. AWS 부분을 필요 시 cost freeze 할 수 있어야 함 (2026-04-19 실제 발생)

### 기존 ADR 커버리지의 구멍

| 결정 영역 | 기존 ADR | 상태 |
|----------|---------|------|
| DB 복제 기술 | 0018 | OK |
| DB 구조 (RW/RO) | 0019 | OK |
| DB Failback | 0020 | OK |
| DB 복제 한계 | 0021 | OK |
| 장애 자동 failover | 0016 | OK |
| cross-cloud 세션 | 0015 | OK |
| **Multi-Cloud 상위 설계** | **없음** | **GAP** |
| **팀 코드 기반 라우팅 근거** | **없음** | **GAP** |
| **각 CSP 독립 Istio mesh 선택 근거** | **없음** | **GAP** |
| **K8s 레포 구조 (prod 단일 vs eks/gke 분리)** | **없음** | **GAP** |
| **이미지 레지스트리 배치 (Harbor 중앙 / GAR 분산)** | **없음** | **GAP** |
| **Redis 각 CSP 독립 선택** | **없음** | **GAP** |

본 ADR 은 이 GAP 을 메우는 헤더 역할을 한다. DB·세션·장애 대응 같은 하위 영역은 기존 ADR로 위임하고, 본 문서는 **상위 구조 결정과 그 불변 규칙**에 집중한다.

---

## 고려한 대안

| # | 대안 | 기각 사유 |
|---|------|---------|
| A | **단일 CSP (AWS only)** | 팀 프로젝트 구성상 두 CSP 분할이 필요. 리전 장애 대응 학습 기회 상실. 포트폴리오 가치 ↓ |
| B | **True Active-Active (DB 양방향)** | pglogical 양방향 가능하나 **티켓 중복 판매 위험** (동시 쓰기 충돌). Conflict resolution 규칙 복잡도 1주 시연 초과. ADR-0018/0020에서도 기각 |
| C | **Active-Passive + DNS Round Robin** | 두 A 레코드 반환 → 브라우저 캐시·OS 캐시로 failover 관측 불가. DB 쓰기 충돌 여전 |
| D | **Active-Passive + 앱 계층 라우팅** | Go 서비스마다 "내가 어느 CSP인지" 판단 로직 필요. CSP 중립성 파괴. 복잡도 분산 |
| E | **Active-Passive + CF Worker 팀 코드 라우팅 (채택)** | 라우팅 결정이 edge 단일점에 집중 → 관측/수정 용이. 팀 구성 단위와 기술 단위 1:1 매칭. Circuit Breaker로 자동 failover (ADR-0016) |

### Mesh 구성 선택

| 후보 | 기각 사유 |
|------|---------|
| **Istio Multi-Primary** (cross-cluster 서비스 발견) | Gateway API + Cilium ClusterMesh 등 추가 인프라. 1주 시연 범위 초과 |
| **Istio Primary-Remote** | 단일 Control Plane이 두 cluster 관리. cross-cloud 네트워크 latency가 mesh 안정성에 영향 |
| **각 CSP 독립 Istio** | **채택** — mesh 버그 blast radius 격리, 단순함, 각 CSP의 네이티브 네트워크(ALB / GCP LB) 활용 |

### K8s 레포 구조 선택

| 후보 | 기각 사유 |
|------|---------|
| `environments/prod-aws/` + `environments/prod-gcp/` 완전 분리 | 서비스 values 이중 관리 → 변경 시 동기화 누락 다수 (실제 dev-logs에 반복 사고) |
| **`environments/prod/` 단일 + `cluster-overrides/{eks,gke}.yaml`** | **채택** — 기본값 공유, CSP 편차만 overrides. ApplicationSet clusterGenerator로 자동 분배 |

### 이미지 레지스트리 전략

| 후보 | 기각 사유 |
|------|---------|
| 각 CSP 네이티브만 (ECR + GAR 독립 빌드) | 빌드 이중화. 이미지 해시 불일치로 재현성 손상 |
| Harbor 단일 + cross-cloud pull | GCP에서 AWS Harbor로 cross-cloud pull = 첫 배포 지연 + 네트워크 비용 |
| **Harbor 1차 검증 + ECR/GAR 로 복제** | **채택** — 공급망 보안 single source of truth + 각 CSP는 네이티브 레지스트리에서 pull (지연 없음) |

---

## 결정

**Active-Passive + Cloudflare Worker 팀 코드 기반 라우팅 + 각 CSP 독립 Istio mesh + K8s 레포 단일 구조(prod/) + 이미지 Harbor 중앙화 + Redis 각 CSP 독립.**

### 상위 구조

```
┌────────────────────── [User Browser] ──────────────────────┐
│                            │                                │
│                            ▼                                │
│                ┌─────────────────────────┐                  │
│                │   Cloudflare Edge       │                  │
│                │  ├─ DNS (go-ti.shop)    │                  │
│                │  ├─ CDN (ADR-0005/0022) │                  │
│                │  ├─ WAF / Rate Limit    │                  │
│                │  └─ Workers (라우터)    │                  │
│                │     TEAM_ROUTING:       │                  │
│                │       teamCode → cloud  │                  │
│                │     Circuit Breaker     │                  │
│                │     (1.5s+60s, ADR-0016)│                  │
│                └────────┬──────┬─────────┘                  │
│                         │      │                             │
│         ┌───────────────┘      └────────────────┐           │
│         ▼                                       ▼           │
│ ┌───────────────┐                    ┌───────────────┐      │
│ │  AWS EKS      │                    │  GCP GKE      │      │
│ │  (ap-ne-2)    │                    │  (asia-ne3)   │      │
│ │               │                    │               │      │
│ │ Istio (독립)  │                    │ Istio (독립)  │      │
│ │ 6 Go MSA      │                    │ 6 Go MSA      │      │
│ │ IRSA          │                    │ Workload Id.  │      │
│ │ ECR pull      │                    │ GAR pull      │      │
│ │               │                    │               │      │
│ │ RDS           │◄── pglogical ──────│ pg-primary VM │      │
│ │ (subscriber,  │    단방향 복제     │ (publisher,   │      │
│ │ read_only=on) │    (ADR-0018)      │ ADR-0018)     │      │
│ │               │                    │               │      │
│ │ ElastiCache   │                    │ Memorystore   │      │
│ │ Redis         │                    │ Redis         │      │
│ └───────────────┘                    └───────────────┘      │
│         │                                       │           │
│         │      AWS SSM ↔ GCP Secret Manager     │           │
│         └────  JWT 키 미러 (ADR-0015) ──────────┘           │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Harbor (on AWS EKS) ── 이미지 1차 검증 ──▶ ECR (AWS) + GAR (GCP)
```

### 핵심 기술 선택

| 영역 | 선택 | 근거 · 연관 ADR |
|------|------|----------------|
| **트래픽 분배** | CF Worker 팀 코드 기반 | edge 단일점 제어, 팀 구성과 1:1. 관측 · 수정 용이 |
| **팀 분배 원칙** | 삼성 계열 → AWS, 두산 계열 → GCP | 팀 프로젝트 제약. 2026-04-19 이후 AWS cost freeze로 GCP only 일시 전환 |
| **장애 자동 failover** | CF Worker Circuit Breaker (1.5s timeout + 60s open) | ADR-0016. `isCircuitOpen(cloud)` 로 primary를 반대 cloud 로 교체 |
| **Mesh** | 각 CSP 독립 Istio 1.29 | Multi-cluster 복잡도 회피, blast radius 격리 |
| **K8s 레포 구조** | `environments/prod/` 단일 + `cluster-overrides/{eks,gke}.yaml` | DRY, ApplicationSet clusterGenerator 자동 분배 |
| **이미지 레지스트리** | Harbor (EKS) → 1차 검증 → ECR + GAR 복제 | 공급망 SSoT + 각 CSP 네이티브 pull |
| **Redis** | 각 CSP 독립 (ElastiCache / Memorystore) | cross-cloud 비용·지연 회피. Redis는 캐시 성격이라 CSP 분기 가능 |
| **DB Primary 위치** | GCP pg-primary VM (2026-04-18 이전 완료) | Cloud SQL pglogical 미지원 → 자체 호스팅 선택 (ADR-0018) |
| **DB 복제 방향** | GCP publisher → AWS subscriber (단방향) | 쓰기 일관성 우선. 양방향은 충돌 위험 (ADR-0020) |
| **DB RW/RO 구조** | 쓰기 DB가 있는 곳에 읽기 DB도 대칭 배치 | ADR-0019 |
| **Failback 전략** | 역방향 유지 (원복하지 않음) | 두 번째 다운타임 회피 (ADR-0020) |
| **Cross-cloud 세션** | AWS SSM ↔ GCP Secret Manager JWT 키 미러 | ADR-0015 |
| **Kafka** | **제거됨** | Multi-cloud에서 Kafka 복제 복잡도 회피. Redis Stream으로 대체 (ADR-0017). `kafka-adoption-decision.md` Supersede 처리 필요 |
| **Terraform State** | AWS는 S3 + DynamoDB Lock, GCP는 GCS | 각 CSP 네이티브. cross-cloud state 공유 금지 |

### 결정 규칙 (불변)

1. **앱 코드는 CSP 중립** — Go 서비스가 "내가 어느 cloud인지" 알지 않는다. DB/Redis endpoint 차이는 ExternalSecret 주입으로만 처리
2. **K8s 매니페스트 중복 금지** — `environments/prod/` 단일. CSP 편차는 `cluster-overrides/` 에만
3. **Istio mesh는 각 CSP 독립** — Multi-cluster primary-remote 도입 금지 (범위 외)
4. **트래픽 분배는 CF Worker 만** — DNS 기반 분산 금지 (관측 불가), 앱 기반 라우팅 금지 (복잡도)
5. **쓰기는 항상 primary 한 곳** — 동시 양쪽 쓰기 금지. 티켓팅 도메인에서 이중 쓰기 = 중복 판매
6. **Redis는 각 CSP 독립** — cross-cloud 공유 금지 (지연·비용). 세션·캐시 일관성이 필요한 경우 DB로 해결
7. **Failback은 역방향 유지** — 장애 복구 후 원복 금지 (ADR-0020 강제)
8. **이미지는 Harbor에서 1차 검증** — 각 CSP 네이티브 직접 push 금지. Renovate로 버전 갱신 → Harbor → 복제

### 의식적으로 "하지 않은 것"

- **Multi-cluster Istio mesh** — 1주 시연 범위 초과
- **Active-Active (DB 양방향)** — 티켓 중복 판매 위험
- **DNS 기반 geo-routing** — Cloudflare Worker가 더 세밀한 제어 가능
- **Kafka cross-cloud 복제** — 제거됨 (kafka-adoption-decision 에 Superseded 기록 필요)
- **앱 계층 shard 라우팅** — CSP 중립 원칙 위반
- **CSP 간 VPC peering / Transit Gateway** — 비용·시간 대비 효과 낮음. pglogical은 Public IP + TLS + allowlist로 처리 (ADR-0018)

---

## 결과

### 목표 지표

- **단일 CSP 장애 시 60초 내 자동 failover** (CF Worker Circuit Breaker, ADR-0016)
- **Cross-cloud 세션 호환** (사용자 체감 중단 없음, ADR-0015)
- **팀별 일관된 CSP 연결** — 같은 팀 트래픽은 같은 cloud로 (관측·디버깅 단순화)
- **이미지 재현성** — Harbor 해시 == ECR 해시 == GAR 해시

### 이 구조가 풀어낸 문제

1. **CSP 리전 장애 대응** — CF Worker가 Circuit Breaker로 자동 전환, 운영자 개입 수초
2. **팀 프로젝트 제약** — 삼성·두산 멤버 각자 담당 환경 보유, 역할 분담 자연스러움
3. **비용 유연성** — "AWS만 끄기" 가 CF Worker 31줄 수정 + ASG 0 스케일로 완결 (2026-04-19 실증)
4. **Mesh blast radius 격리** — 한 CSP의 Istio 업그레이드가 반대 CSP에 영향 없음
5. **K8s 변경 전파 속도** — `prod/` 단일 구조로 같은 값 수정이 양 클러스터에 동시 반영

### 운영상 이점

- **점진 failover 가능**: Worker TEAM_ROUTING 조정으로 팀별 점진 이관 (전체 아님)
- **측정 가능성**: CF Worker 응답 헤더 (`x-goti-route-assigned`, `x-goti-route-circuit`, `x-goti-route-failover`) 로 라우팅 결정이 매 요청에 관측 가능 (ADR-0016)
- **cost freeze 유연성**: AWS ASG → 0, Worker → GCP only, 추가 설정 없음
- **Terraform state 격리**: CSP별 독립 state로 apply 실수의 blast radius 제한

### 리스크

- **Cross-cloud pglogical replication lag** (~5초 이내, ADR-0018) — failover 구간의 데이터 유실 가능성
- **CF Worker 배포 전파 시간 (수초~수분)** — 긴급 롤백 시 사용자에게 다르게 보일 수 있음
- **Harbor 중앙화 = AWS 의존** — AWS 장애 시 새 이미지 빌드·배포 불가. GAR 복제로 부분 완화 (배포된 이미지는 pull 가능)
- **관측 집계 분산** — 각 CSP Prometheus 독립이라 cross-cloud 집계는 Mimir 에서 Tenant 병합 필요
- **팀 코드 라우팅 단순화 취약** — 경기 조회·로그인 등 "팀 코드 미보유" 요청의 라우팅 기본값 정의 필요 (현재 GCP default)
- **AWS 상시 운영 비용** — 1주 시연 종료 후 AWS 유지 비현실적 → 복구 경로 runbook 필요 (memory `project_cloudflare_multicloud_worker.md` §AWS 복원)
- **DNS + Worker 조합의 디버깅 난이도** — 트래픽 경로가 `DNS → Worker → DNS(origin) → ALB/LB → Istio → Pod` 로 길어 문제 위치 파악에 추가 관측 툴 필요
- **Kafka 제거의 부수 효과** — 이벤트 버스가 Redis Stream 으로 단일화. Multi-cloud 이벤트 복제 필요 시 재설계 필요 (현 시점 요구 없음)

### Reversibility

| 단계 | 조치 |
|------|------|
| 1단계 (런타임 장애) | CF Worker Circuit Breaker 자동 (운영자 개입 0) |
| 2단계 (계획된 CSP 축소) | Worker 소스 교체 + ASG 0 (2026-04-19 실제 적용) |
| 3단계 (AWS 복구) | git log의 `multicloud-router.worker.js` 복원 + DNS proxy ON + Pages env 환원 |
| 4단계 (DB primary 재배치) | ADR-0020에 따라 역방향 유지, 원복 없음 |

**비가역 요소**: Failback 후 primary 역할 교체, Cloud SQL 삭제(이전 완료). 재구축은 가능하되 이전 상태 복원은 아님.

### 비용 실측

| 구성 | 월 비용 (추정) | 비고 |
|------|---------------|------|
| 2-cloud 정상 운영 | ~$200~300 | ASG On-Demand + GKE Regional |
| GCP only (2026-04-19~) | ~$80 | AWS shutdown, GCP BASIC Redis |
| Cloudflare Workers | Free plan 범위 | 유료 전환 시 $5/월부터 |
| 이미지 복제 | ~$2 | ECR/GAR egress |

---

## 후속

1. **`kafka-adoption-decision.md` 를 `Status: Superseded by ADR-0025`** 로 업데이트 (stale ADR 정리)
2. **ADR-0018~0021 / 0016 / 0015 의 상위 참조 링크 업데이트** — 본 ADR 을 헤더로 명시
3. **Multi-cluster Istio mesh 도입 재검토** — 장기 운영 확정 시
4. **KEDA + GMP adapter 구축** (ADR-0016 후속 D안)
5. **팀 코드 라우팅 정교화** — `docs/project/final-goal.md` 기반 로그인·조회 API 의 라우팅 기본값 규칙
6. **관측 통합** — cross-cloud Mimir Tenant 병합, Grafana `cluster` 라벨 기반 비교 대시보드
7. **이미지 완전 분리 검토** — Harbor/GAR 양립 구조 (AWS 의존 제거)
8. **AWS 복구 runbook 공식화** — `docs/runbooks/aws-restore-from-freeze.md`

---

## 실행 기록

| 일자 | 이벤트 |
|------|--------|
| 2026-03-25 | Cloudflare Worker 최초 (`dev-api` 단일 origin, 33줄) |
| 2026-04-15 | **Multi-cloud Worker 라우터 확장** — 296줄, `TEAM_ROUTING` + 5xx failover + metrics fanout |
| 2026-04-17 | Smart Placement(LAX PoP 이슈 대응) + 60초 Circuit Breaker 추가 (ADR-0016 채택). GCP 측 HPA 활성 (CPU 60%) |
| 2026-04-17 | **JWT cross-cloud 호환** 완료 (ADR-0015, AWS SSM ↔ GCP SM 미러) |
| 2026-04-18 | **DB Primary GCP 전환** (Cloud SQL → pg-primary VM + pglogical 2.4.6, ADR-0018). Phase B subscription AWS RDS 생성 |
| 2026-04-19 | **AWS cost freeze** → Worker 31줄 단순화 (GCP only, wrangler + `hint="apac"`). 프론트 `PUBLIC_API_BASE_URL=gcp-api.go-ti.shop`로 Worker 우회 경로 추가. 브라우저 실측 900ms → 93~279ms 개선 |
| 2026-04-20 | 본 ADR 승인 — 기존 6개 하위 ADR 에 **상위 헤더** 제공 |

### 현재 운영 모드 (2026-04-20 기준)

- **Primary**: GCP GKE (asia-northeast3)
- **Secondary**: AWS EKS cost freeze (ASG 0, RDS 가동 중)
- **트래픽**: 프론트 → `gcp-api.go-ti.shop` 직행 (Worker 우회). legacy `go-ti.shop/api/*` 경로만 Worker 경유
- **DB**: GCP pg-primary VM 단독 가동, AWS RDS subscription 부분 sync 상태 (ADR-0021 known gaps)
- **Redis**: GCP Memorystore BASIC (`10.195.173.91`)
- **복구 경로**: `project_cloudflare_multicloud_worker.md` + `project_aws_cost_freeze_gcp_only.md` 메모리에 명시됨
