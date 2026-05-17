---
title: "Multi-Cloud 상위 아키텍처 — Active-Passive + 팀 코드 라우팅 헤더 ADR"
excerpt: "AWS↔GCP 2-cloud 상시 가동 구조, 팀 코드 기반 Cloudflare Worker 라우팅, 각 CSP 독립 Istio mesh, Harbor 이미지 중앙화를 정의한 헤더 ADR. 하위 ADR 6개(DB·세션·장애 대응)의 상위 컨텍스트를 채웁니다"
category: "challenge"
tags:
  - go-ti
  - Multi-Cloud
  - AWS
  - GCP
  - Cloudflare
  - Architecture
  - adr
series:
  name: "goti-multicloud"
  order: 12
date: "2026-04-15"
---

## 한 줄 요약

> go-ti의 Multi-Cloud 상위 설계 결정을 기록한 헤더 ADR입니다. DB 복제(ADR-0018~0021), 장애 자동 failover(ADR-0016), cross-cloud 세션(ADR-0015) 하위 ADR들이 개별 영역을 다루는 반면, 이 문서는 그 모든 결정을 묶는 **불변 구조 규칙**을 정의합니다

---

## 배경

### 구조적 요구사항 3가지

go-ti는 단일 CSP에 묶일 수 없는 요구사항 세 가지를 동시에 만족해야 했습니다.

**첫째, CSP 리전 장애 대응입니다.**
티켓 오픈 시각에 단일 CSP 장애가 발생하면 예매 전체가 무효화됩니다.
60초 내 자동 failover 없이는 선착순 티켓팅 서비스를 운영할 수 없습니다.

**둘째, 15인 팀 프로젝트 제약입니다.**
팀원이 두 계열로 절반씩 나뉘어 각자 담당 CSP 환경을 보유해야 했습니다.
"GCP 학습 목적"이 아니라 팀 구성의 현실적 필요였습니다.

**셋째, 50만 동시 트래픽 목표입니다.**
2-cloud 분산 시 Pod 여유와 네트워크 경로가 자연스럽게 둘로 나뉩니다.

이 세 가지를 한 번에 해결하려면 "2-cloud 상시 가동" 자체가 제약이자 이점이었습니다.

### 실관측

- **DNS**: Cloudflare `go-ti.shop` (ADR-0005로 이미 전환 완료). Workers + CDN + WAF가 상위 계층에서 사용 가능한 상태였습니다
- **1주 시연 범위**: 프로젝트 운영 기간 ~2026-04-24. Multi-cluster Istio mesh 같은 무거운 도입은 범위를 초과했습니다
- **비용 제약**: 상시 2-cloud 운영 비용이 부담입니다. AWS 부분을 필요 시 cost freeze 할 수 있어야 했고, 2026-04-19에 실제로 발생했습니다

### 기존 ADR 커버리지의 공백

각 하위 ADR이 개별 영역을 잘 커버하고 있었지만, 상위 구조 결정이 어디에도 기록되지 않았습니다.

| 결정 영역 | 기존 ADR | 상태 |
|----------|---------|------|
| DB 복제 기술 | ADR-0018 | 커버됨 |
| DB 구조 (RW/RO) | ADR-0019 | 커버됨 |
| DB Failback | ADR-0020 | 커버됨 |
| DB 복제 한계 | ADR-0021 | 커버됨 |
| 장애 자동 failover | ADR-0016 | 커버됨 |
| cross-cloud 세션 | ADR-0015 | 커버됨 |
| **Multi-Cloud 상위 설계** | **없음** | **공백** |
| **팀 코드 라우팅 근거** | **없음** | **공백** |
| **각 CSP 독립 Istio mesh 선택 근거** | **없음** | **공백** |
| **K8s 레포 구조 (prod 단일 vs CSP 분리)** | **없음** | **공백** |
| **이미지 레지스트리 배치** | **없음** | **공백** |
| **Redis CSP 독립 선택** | **없음** | **공백** |

이 ADR은 그 공백을 메우는 헤더 역할을 합니다.
DB·세션·장애 대응 같은 하위 영역은 기존 ADR로 위임하고, 이 문서는 **상위 구조 결정과 불변 규칙**에 집중합니다.

---

## 🧭 선택지 비교

### 트래픽 분배 방식

| 옵션 | 구성 | 기각 사유 |
|------|------|---------|
| A. 단일 CSP (AWS only) | AWS만 운영 | 팀 구성상 두 CSP 분할이 필요. 리전 장애 대응 학습 기회 상실 |
| B. Active-Active (DB 양방향) | DB 양쪽 동시 쓰기 | pglogical 양방향은 티켓 중복 판매 위험. 충돌 해소 규칙 복잡도가 1주 시연을 초과 |
| C. Active-Passive + DNS Round Robin | DNS A레코드 2개 반환 | 브라우저·OS 캐시로 failover 관측 불가. DB 쓰기 충돌 여전 |
| D. Active-Passive + 앱 계층 라우팅 | Go 서비스마다 CSP 판단 로직 | CSP 중립성 파괴. 복잡도가 서비스 전체에 분산 |
| **E. Active-Passive + CF Worker 팀 코드 라우팅** | **Cloudflare edge에서 팀 코드 기반 분배** | **채택** |

옵션 E가 적합한 이유는 세 가지입니다.
라우팅 결정이 edge 단일점에 집중되어 관측과 수정이 용이합니다.
팀 구성 단위(두 계열)와 기술 단위(AWS/GCP)가 1:1로 매칭됩니다.
Circuit Breaker로 자동 failover가 가능합니다(ADR-0016).

### Istio Mesh 구성

| 후보 | 기각 사유 |
|------|---------|
| Multi-Primary (cross-cluster 서비스 발견) | Gateway API + Cilium ClusterMesh 등 추가 인프라 필요. 1주 시연 범위 초과 |
| Primary-Remote | 단일 Control Plane이 두 클러스터 관리. cross-cloud 네트워크 지연이 mesh 안정성에 영향 |
| **각 CSP 독립 Istio** | **채택** — mesh 버그 blast radius 격리, 단순함, 각 CSP 네이티브 네트워크 활용 |

### K8s 레포 구조

| 후보 | 기각 사유 |
|------|---------|
| `environments/prod-aws/` + `environments/prod-gcp/` 완전 분리 | 서비스 values 이중 관리. 변경 시 동기화 누락 사고가 실제 dev-logs에 반복됨 |
| **`environments/prod/` 단일 + `cluster-overrides/{eks,gke}.yaml`** | **채택** — 기본값 공유, CSP 편차만 overrides. ApplicationSet clusterGenerator로 자동 분배 |

### 이미지 레지스트리

| 후보 | 기각 사유 |
|------|---------|
| ECR + GAR 독립 빌드 | 빌드 이중화. 이미지 해시 불일치로 재현성 손상 |
| Harbor 단일 + cross-cloud pull | GCP에서 AWS Harbor로 cross-cloud pull = 첫 배포 지연 + 네트워크 비용 |
| **Harbor 1차 검증 + ECR/GAR 복제** | **채택** — 공급망 보안 단일 진실 소스 + 각 CSP는 네이티브 레지스트리에서 pull |

### 결정 기준

결정 기준의 1순위는 **"1주 시연 범위 내 구현 가능한가"**였습니다.
2순위는 **"CSP 중립성을 유지하는가"**(앱 코드가 cloud를 몰라야 함)였습니다.
3순위는 **"부분 장애 시 운영자 개입 없이 자동 복구되는가"**였습니다.

Multi-cluster Istio, Active-Active DB, 앱 계층 라우팅은 이 기준 중 하나 이상에서 탈락했습니다.

---

## 결정

**Active-Passive + Cloudflare Worker 팀 코드 기반 라우팅 + 각 CSP 독립 Istio mesh + K8s 레포 단일 구조(`prod/`) + 이미지 Harbor 중앙화 + Redis 각 CSP 독립.**

### 상위 구조 요약

전체 트래픽 경로는 다음과 같습니다.

1. 사용자 브라우저가 `go-ti.shop`으로 요청합니다
2. Cloudflare Edge에서 DNS + CDN + WAF를 거친 뒤 Worker가 팀 코드를 기반으로 AWS EKS 또는 GCP GKE 중 하나를 선택합니다
3. Circuit Breaker가 열려 있으면(ADR-0016) 반대 CSP로 자동 교체합니다
4. 각 CSP 클러스터 내부에서 독립된 Istio mesh가 트래픽을 처리합니다

이미지 경로는 별도로 운영됩니다.
Harbor(AWS EKS)에서 1차 검증 후 ECR(AWS)과 GAR(GCP)로 복제합니다.
각 클러스터는 자신의 CSP 네이티브 레지스트리에서 pull하므로 cross-cloud 지연이 없습니다.

DB 복제는 GCP pg-primary VM에서 AWS RDS로의 단방향 pglogical 복제입니다.
쓰기는 항상 GCP primary 한 곳에만 이루어집니다.

### 핵심 기술 선택

| 영역 | 선택 | 연관 ADR |
|------|------|---------|
| 트래픽 분배 | CF Worker 팀 코드 기반 | — |
| 팀 분배 원칙 | 삼성 계열 → AWS, 두산 계열 → GCP | — |
| 장애 자동 failover | CF Worker Circuit Breaker (1.5s timeout + 60s open) | ADR-0016 |
| Mesh | 각 CSP 독립 Istio 1.29 | — |
| K8s 레포 구조 | `environments/prod/` 단일 + `cluster-overrides/{eks,gke}.yaml` | — |
| 이미지 레지스트리 | Harbor(EKS) → 1차 검증 → ECR + GAR 복제 | — |
| Redis | 각 CSP 독립 (ElastiCache / Memorystore) | — |
| DB Primary 위치 | GCP pg-primary VM | ADR-0018 |
| DB 복제 방향 | GCP publisher → AWS subscriber 단방향 | ADR-0020 |
| Cross-cloud 세션 | AWS SSM ↔ GCP Secret Manager JWT 키 미러 | ADR-0015 |
| Kafka | **제거됨** — Redis Stream으로 대체 | ADR-0017 |
| Terraform State | AWS는 S3 + DynamoDB Lock, GCP는 GCS (각 CSP 네이티브) | — |

### 불변 규칙 8가지

이 결정에서 도출된 규칙은 하위 ADR과 구현 전반에 적용됩니다.

1. **앱 코드는 CSP 중립** — Go 서비스가 "내가 어느 cloud인지" 알지 않습니다. DB/Redis endpoint 차이는 ExternalSecret 주입으로만 처리합니다
2. **K8s 매니페스트 중복 금지** — `environments/prod/` 단일. CSP 편차는 `cluster-overrides/`에만 존재합니다
3. **Istio mesh는 각 CSP 독립** — Multi-cluster primary-remote 도입은 범위 외입니다
4. **트래픽 분배는 CF Worker 만** — DNS 기반 분산(관측 불가)과 앱 기반 라우팅(복잡도)은 금지입니다
5. **쓰기는 항상 primary 한 곳** — 티켓팅 도메인에서 동시 양쪽 쓰기는 중복 판매로 이어집니다
6. **Redis는 각 CSP 독립** — cross-cloud 공유 금지. 세션·캐시 일관성이 필요한 경우 DB로 해결합니다
7. **Failback은 역방향 유지** — 장애 복구 후 원복하지 않습니다(ADR-0020)
8. **이미지는 Harbor에서 1차 검증** — 각 CSP 네이티브 직접 push 금지. Renovate 버전 갱신 → Harbor → 복제 순입니다

### 의식적으로 하지 않은 것

다음 선택지는 명시적으로 기각했습니다.

- **Multi-cluster Istio mesh** — 1주 시연 범위 초과
- **Active-Active (DB 양방향)** — 티켓 중복 판매 위험
- **DNS 기반 geo-routing** — CF Worker가 더 세밀한 제어 가능
- **앱 계층 shard 라우팅** — CSP 중립 원칙 위반
- **CSP 간 VPC peering / Transit Gateway** — 비용·시간 대비 효과 낮음. pglogical은 Public IP + TLS + allowlist로 처리합니다(ADR-0018)

---

## 결과

### 목표 지표

- **단일 CSP 장애 시 60초 내 자동 failover** (CF Worker Circuit Breaker, ADR-0016)
- **Cross-cloud 세션 호환** — 사용자 체감 중단 없음 (ADR-0015)
- **팀별 일관된 CSP 연결** — 같은 팀 트래픽은 같은 cloud로, 관측·디버깅이 단순화됩니다
- **이미지 재현성** — Harbor 해시 == ECR 해시 == GAR 해시

### 이 구조가 해결한 문제

**CSP 리전 장애 대응**은 CF Worker Circuit Breaker로 자동 전환합니다.
운영자 개입 없이 60초 내 복구가 가능합니다.

**팀 프로젝트 제약**은 팀 코드 라우팅으로 자연스럽게 해소했습니다.
각 계열 멤버가 담당 CSP 환경을 보유하면서도 서비스는 단일하게 운영됩니다.

**비용 유연성**은 2026-04-19에 실증됐습니다.
CF Worker 31줄 수정 + ASG 0 스케일로 "AWS만 끄기"가 완결됐습니다.

**Mesh blast radius 격리**는 각 CSP 독립 구조 덕분입니다.
한 CSP의 Istio 업그레이드가 반대 CSP에 영향을 주지 않습니다.

**K8s 변경 전파 속도**는 `prod/` 단일 구조로 보장됩니다.
같은 값 수정이 양 클러스터에 동시 반영됩니다.

### 운영상 이점

- **점진 failover 가능** — Worker `TEAM_ROUTING` 조정으로 팀별 점진 이관이 가능합니다(전체 전환 불필요)
- **측정 가능성** — CF Worker 응답 헤더(`x-goti-route-assigned`, `x-goti-route-circuit`, `x-goti-route-failover`)로 라우팅 결정이 매 요청에 관측됩니다
- **cost freeze 유연성** — AWS ASG → 0, Worker → GCP only. 추가 설정이 없습니다
- **Terraform state 격리** — CSP별 독립 state로 apply 실수의 blast radius가 제한됩니다

### 리스크

- **Cross-cloud pglogical replication lag** (~5초 이내, ADR-0018) — failover 구간의 데이터 유실 가능성이 있습니다
- **CF Worker 배포 전파 시간 (수초~수분)** — 긴급 롤백 시 사용자에게 다르게 보일 수 있습니다
- **Harbor 중앙화 = AWS 의존** — AWS 장애 시 새 이미지 빌드·배포가 불가합니다. GAR 복제로 부분 완화됩니다(배포된 이미지는 pull 가능)
- **관측 집계 분산** — 각 CSP Prometheus가 독립이라 cross-cloud 집계는 Mimir에서 Tenant 병합이 필요합니다
- **팀 코드 미보유 요청** — 경기 조회·로그인 등의 라우팅 기본값 정의가 필요합니다(현재 GCP default)
- **Kafka 제거의 부수 효과** — 이벤트 버스가 Redis Stream으로 단일화됩니다. Multi-cloud 이벤트 복제가 필요한 경우 재설계가 필요합니다(현 시점 요구 없음)

### Reversibility

| 단계 | 조치 |
|------|------|
| 1단계 (런타임 장애) | CF Worker Circuit Breaker 자동 복구 (운영자 개입 0) |
| 2단계 (계획된 CSP 축소) | Worker 소스 교체 + ASG 0 (2026-04-19 실제 적용) |
| 3단계 (AWS 복구) | `multicloud-router.worker.js` git log 복원 + DNS proxy ON + Pages env 환원 |
| 4단계 (DB primary 재배치) | ADR-0020에 따라 역방향 유지, 원복 없음 |

**비가역 요소**: Failback 후 primary 역할 교체, Cloud SQL 삭제(이전 완료). 재구축은 가능하되 이전 상태 복원은 아닙니다.

### 비용 실측

| 구성 | 월 비용 (추정) | 비고 |
|------|---------------|------|
| 2-cloud 정상 운영 | ~$200~300 | ASG On-Demand + GKE Regional |
| GCP only (2026-04-19~) | ~$80 | AWS shutdown, GCP BASIC Redis |
| Cloudflare Workers | Free plan 범위 | 유료 전환 시 $5/월부터 |
| 이미지 복제 | ~$2 | ECR/GAR egress |

---

## 실행 기록

| 일자 | 이벤트 |
|------|--------|
| 2026-03-25 | Cloudflare Worker 최초 배포 (dev-api 단일 origin, 33줄) |
| 2026-04-15 | Multi-cloud Worker 라우터 확장 — 296줄, `TEAM_ROUTING` + 5xx failover + metrics fanout |
| 2026-04-17 | Smart Placement(LAX PoP 이슈 대응) + 60초 Circuit Breaker 추가 (ADR-0016 채택). GCP HPA 활성 (CPU 60%) |
| 2026-04-17 | JWT cross-cloud 호환 완료 (ADR-0015, AWS SSM ↔ GCP SM 미러) |
| 2026-04-18 | DB Primary GCP 전환 (Cloud SQL → pg-primary VM + pglogical 2.4.6, ADR-0018). Phase B subscription AWS RDS 생성 |
| 2026-04-19 | AWS cost freeze → Worker 31줄 단순화 (GCP only, `hint="apac"`). 브라우저 실측 900ms → 93~279ms 개선 |
| 2026-04-20 | 본 ADR 승인 — 기존 6개 하위 ADR에 상위 헤더 제공 |

### 현재 운영 모드 (2026-04-20 기준)

- **Primary**: GCP GKE (asia-northeast3)
- **Secondary**: AWS EKS cost freeze (ASG 0, RDS 가동 중)
- **트래픽**: 프론트 → `gcp-api.go-ti.shop` 직행 (Worker 우회). legacy `go-ti.shop/api/*` 경로만 Worker 경유
- **DB**: GCP pg-primary VM 단독 가동, AWS RDS subscription 부분 sync 상태 (ADR-0021 known gaps)
- **Redis**: GCP Memorystore BASIC

---

## 📚 후속 과제

1. `kafka-adoption-decision.md`를 `Status: Superseded by ADR-0025`로 업데이트합니다(stale ADR 정리)
2. ADR-0018~0021 / ADR-0016 / ADR-0015에 본 ADR을 상위 헤더로 명시합니다
3. Multi-cluster Istio mesh 도입은 장기 운영 확정 시 재검토합니다
4. 팀 코드 라우팅 정교화 — 로그인·조회 API의 라우팅 기본값 규칙을 정의합니다
5. 관측 통합 — cross-cloud Mimir Tenant 병합, Grafana `cluster` 라벨 기반 비교 대시보드를 구축합니다
6. Harbor/GAR 양립 구조 검토로 AWS 의존을 제거합니다
7. AWS 복구 runbook을 `docs/runbooks/aws-restore-from-freeze.md`로 공식화합니다

---

## 🔗 관련 기술 해설

이 글에서 결정한 기술의 동작 원리는 다음 해설글에서 자세히 다룹니다

- [멀티클라우드 트래픽 라우팅 — 엣지 단일점 제어가 관측성을 만드는 원리](/essays/goti-deepdive-multicloud-traffic-routing)
- [Istio 멀티클러스터 토폴로지 3종 — Control Plane 위치가 결정하는 것들](/essays/goti-deepdive-istio-multicluster-topology)
- [ApplicationSet clusterGenerator — 멀티클러스터 배포를 DRY하게 유지하는 원리](/essays/goti-deepdive-applicationset-clustergenerator)
- [컨테이너 이미지 공급망 — 중앙 검증 후 멀티 리전 복제가 재현성을 보장하는 방식](/essays/goti-deepdive-image-supply-chain)
