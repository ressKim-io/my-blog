# 2026-04-12 — Phase 7 D 결정 번복 + Phase 6.5 신설 + Step 4 = 4b 확정

**유형**: decision
**관련 SDD**:
- [phase7-go-readiness-audit-sdd.md](../migration/java-to-go/phase7-go-readiness-audit-sdd.md) — D 번복 표시
- [phase6.5-go-prod-infra-sdd.md](../migration/java-to-go/phase6.5-go-prod-infra-sdd.md) — 신설
- [final-execution-plan.md](../project/final-execution-plan.md) — 진행 상태 컬럼 추가

---

## 1. 결정 요약

| 시간 | 결정 | 사유 |
|------|------|------|
| 오전 | Phase 7 = D 채택 (audit 설계 + ticketing-go PoC로 마감) | Go 5서비스 prod 인프라 부재, 포트폴리오 성격이라 비용 최소화 |
| 오후 | **D 번복** + Phase 6.5 신설 + Step 4 = 4b 확정 | 사용자 결정: "10만 동시접속 + 리소스 절감 = Go 6서비스 전부 전환 필수, GCP $300 크레딧 보유, Multi-Cloud DR(Step 9)까지 진행" |

---

## 2. 진행 흐름 변화 (Before / After)

### Before (D 채택 시점, 오전)
```
Phase 6 ✅ → Phase 7 D-마감(보여주기용) → 끝
```

### After (D 번복, 오후)
```
Phase 6 ✅
  → Phase 7 S0/S3 ✅ (audit 설계 + 정적분석 GREEN)
  → Phase 6.5 (신설, Go 5서비스 prod 인프라 W1~W7) ← 진입 차단 갭 해소
  → Phase 7 재개 (Audit 풀세트 G1~G8)
  → Step 4 (Go 6서비스 canary 컷오버, 4b)
  → Step 5 (Go 부하 10만 동시접속)
  → Step 6 (GKE 셋업)
  → Step 7 (GCP 동기화)
  → Step 8 (Multi-Cloud 부하)
  → Step 9 (DR Failover) ← 프로젝트 종결
```

---

## 3. 주요 결정 사유

### 3.1 4b 채택 (6서비스 전부 Go 전환)
- **10만 동시접속 목표**: Java(JVM 메모리/콜드스타트)로는 비용 효율 부족
- **6x 메모리 절감**: ticketing-go 실측에서 Java 384/768Mi → Go 128/256Mi 검증 완료
- **부분 전환(4a)의 한계**: 1/6 서비스만 Go면 "Go 전환"의 의미가 약함, 포트폴리오 가치 ↓

### 3.2 GCP 진입 가능 사유
- $300 무료 크레딧 보유
- GKE small (3노드 e2-medium) ≈ $70/월 → 약 3~4개월 운영 가능
- Step 6~9 완료까지 충분

### 3.3 Java 보호 (brnach + PR 전략)
사용자 요구: "Java 살아있는 상태에서 Go 인프라 작업, brnach 따서 PR 단위로". 따라서:
- Goti-k8s/Goti-go/Goti-Terraform 모두 feature brnach + PR 머지 후 사용자 검증
- 6대 안전 가드 (SG1~SG6) 모든 PR에서 준수 (Phase 6.5 SDD §1.3)

---

## 4. Phase 6.5 신설 — Go 5서비스 prod 인프라

### 4.1 작업 매트릭스 (W1~W7)
| W | 작업 | 레포 | 추정 PR |
|---|------|------|--------|
| W1 | helm values 5세트 | Goti-k8s | 1 PoC + 4 일괄 |
| W2 | ECR CD 워크플로우 5개 | Goti-go | 1 통합 또는 5 분리 |
| W3 | GAR CD (GCP) 5개 | Goti-go | Step 6 직전 분리 |
| W4 | AWS Secrets Manager + ExternalSecret | Goti-Terraform | 1 |
| W5 | Istio AuthPolicy/RequestAuth/DR | Goti-k8s (W1 동시) | - |
| W6 | KEDA ScaledObject | Goti-k8s (W1 동시) | - |
| W7 | ApplicationSet 6 entry 추가 | Goti-k8s | 1 |

총 9~14 PR.

### 4.2 PoC → 일괄 전략
1. **stadium PoC** (가장 단순한 read-mostly 서비스) — 표준 패턴 검증
2. 검증 후 user/queue/resale/payment 일괄 (1~4 PR)

### 4.3 6대 안전 가드 (SG1~SG6)
| ID | 가드 | 구현 |
|----|------|------|
| SG1 | 0% weight 첫 배포 | `replicaCount: 0` 또는 Istio VS weight 0 |
| SG2 | 별도 deployment name | `goti-{svc}-go-prod` (Java 그대로) |
| SG3 | 별도 ServiceAccount + DB user | Go ExternalSecret 분리 |
| SG4 | ApplicationSet entry 분리 | Java 6 + Go 6 = 12 entry |
| SG5 | 머지 전 manifest 검증 | `helm template` + `kubectl --dry-run=server` |
| SG6 | ArgoCD prune: false | **Go entry만**, Java entry는 기존 정책 유지 |

---

## 5. Phase 7 재개 조건

Phase 6.5 P6.5-G1~G7 모두 GREEN (24h 관측 Java 무영향) → S1·S2·S4·S5·S7·S8·S11 풀세트 재개.

S0/S3/일부 G6 산출물은 그대로 활용.

---

## 6. 영향받은 문서/메모리

| 위치 | 변경 |
|------|------|
| `phase7-go-readiness-audit-sdd.md` 헤더 | D 채택→번복 이력, PAUSED 상태, 재개 조건 명시 |
| `phase7/audit/ops-readiness.md` §5 | 결정 이력 (오전 D / 오후 번복) |
| **`phase6.5-go-prod-infra-sdd.md` 신설** | W1~W7, 안전 가드 SG1~SG6, PoC 전략, 표준 values 패턴 |
| `final-execution-plan.md` | Step 4 = 4b 명시, Phase 6.5 삽입, 9단계 진행 상태 컬럼 |
| 메모리 `project_phase7_go_audit` | D 번복 + Phase 6.5 의존 명시 |
| 메모리 `project_goti_go_migration` | Phase 6.5 신설 반영 |
| 메모리 신규 `project_phase6_5_go_prod_infra` | Phase 6.5 SDD 진입점 |
| 메모리 `project_final_execution_plan` | Step 4 = 4b + 진행 상태 |
| 메모리 `MEMORY.md` index | Phase 6.5 entry 추가 |

---

## 7. 다음 세션 시작점

`feature/phase6.5-stadium-go-prod-values` brnach 따고 stadium PoC PR 작성.

산출물 위치:
- `Goti-k8s/environments/prod/goti-stadium-go/values.yaml`
- `Goti-k8s/environments/prod/goti-stadium-go/values-aws.yaml`

ticketing-go 패턴 100% 복제 후 Stadium 라우트만 교체.
