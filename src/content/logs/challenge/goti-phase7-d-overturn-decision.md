---
title: "Phase 7 D 옵션 번복 — Phase 6.5 신설로 Go prod 인프라 갭을 해소하다"
excerpt: "당일 오전에 채택한 Phase 7 D(audit 보여주기용 마감)를 오후에 번복했습니다. values가 Java 기준이라 Go pod 하나도 prod에 없다는 갭을 먼저 해소하려고 Phase 6.5를 신설한 결정 기록입니다"
category: challenge
tags:
  - go-ti
  - Ticketing
  - Phase6.5
  - Phase7
  - Architecture Decision Record
  - adr
series:
  name: "goti-ticketing-phase"
  order: 4
date: "2026-04-12"
---

## 한 줄 요약

> 오전에 Phase 7 D 옵션(audit 설계 + ticketing-go PoC로 마감)을 채택했지만, helm values가 전부 Java 기준이어서 Go pod 하나도 prod에 존재하지 않는다는 사실을 확인한 뒤 같은 날 오후에 번복했습니다. Phase 6.5(Go 5서비스 prod 인프라 신설)를 먼저 완료해야 Phase 7 풀세트를 재개할 수 있습니다

---

## 배경

Phase 6에서 ticketing-go 서비스를 구현했고, Phase 7에서 컷오버 전 8게이트 Readiness Audit을 진행하는 계획이었습니다.

Phase 7 S0(audit 설계)와 S3(정적분석 GREEN)까지 완료한 시점에 마감 방향을 결정해야 하는 상황이 왔습니다. 10만 동시접속 + Multi-Cloud DR까지 진행하려면 인프라 비용이 추가로 들고, 포트폴리오 성격의 프로젝트 특성상 비용 최소화도 무시할 수 없었습니다.

당일 오전, 아래 판단으로 D 옵션을 채택했습니다.

- Go 5서비스의 prod 인프라(helm values/CD 워크플로우/Secrets)가 없어서 Phase 7 전체를 진행할 수 없는 상태
- 포트폴리오 성격이라 비용을 최소화하는 방향이 맞다는 판단
- audit 설계 + ticketing-go PoC 수준으로 마감

그러나 같은 날 오후에 이 결정을 번복했습니다.

---

## 🧭 두 경로: D 채택(오전) vs D 번복(오후)

### 경로 A — D 옵션 유지: audit 설계 + ticketing-go PoC로 마감

흐름은 Phase 6 ✅ → Phase 7 D-마감(보여주기용) → 종료 한 줄입니다.

Phase 7 S0/S3만 완료한 상태로 마감합니다. Go 5서비스 prod 인프라 작업은 생략하고, ticketing-go 단독 PoC 수준에서 프로젝트를 종료합니다.

**장점:**
- 추가 인프라 비용 없음
- 작업 범위가 줄어 빠른 마감 가능

**한계:**
- 6서비스 중 1서비스(ticketing-go)만 Go로 돌아 "Go 전환" 포트폴리오 가치가 낮음
- 10만 동시접속 목표와 Multi-Cloud DR Failover 시나리오가 사라짐
- ticketing-go 실측에서 확인된 6x 메모리 절감 효과를 전체 서비스에 적용하지 못함

### 경로 B — D 번복: Phase 6.5 신설 후 Phase 7 풀세트 진행

전체 흐름은 다음 9단계로 구성됩니다.

1. **Phase 6** — 완료 상태
2. **Phase 6.5 신설** — Go 5서비스 prod 인프라(W1~W7) 구축으로 진입 차단 갭 해소
3. **Phase 7 재개** — Audit 풀세트 G1~G8
4. **Step 4** — Go 6서비스 canary 컷오버 (4b)
5. **Step 5** — Go 부하 10만 동시접속 검증
6. **Step 6** — GKE 셋업
7. **Step 7** — GCP 동기화
8. **Step 8** — Multi-Cloud 부하
9. **Step 9** — DR Failover (프로젝트 종결 시점)

진입 차단 갭(Go pod 하나도 prod에 없음)을 먼저 해소하고 나서 Phase 7을 재개합니다.

### 번복 기준과 최종 선택

**경로 B를 채택했습니다.**

번복의 핵심 기준은 다음 세 가지입니다.

1. **10만 동시접속 + 6x 메모리 절감은 전량 Go 전환 없이는 의미가 없음**: ticketing-go 실측(Java 384/768Mi → Go 128/256Mi)의 가치를 포트폴리오로 증명하려면 6서비스 전체가 Go여야 합니다. 1/6 서비스만 Go이면 "Go 전환 프로젝트"라고 부르기 어렵습니다.
2. **GCP $300 무료 크레딧으로 비용 제약이 해소됨**: GKE small (3노드 e2-medium) 기준 월 약 $70로 Step 6~9 완료까지 3~4개월 운영이 가능합니다.
3. **Java 보호 전략이 준비되어 있음**: feature branch + PR 단위로 진행하고 6대 안전 가드(SG1~SG6)를 준수하면 Java 서비스를 건드리지 않고 Go 인프라를 추가할 수 있습니다.

---

## ✅ Phase 6.5 신설: Go 5서비스 prod 인프라

### Phase 6.5가 필요한 이유

Phase 7 Readiness Audit은 Go 서비스가 prod에서 실제로 돌고 있어야 의미가 있습니다. 그런데 Phase 6까지의 helm values는 전부 Java 기준이었습니다.

ticketing-go 한 서비스를 제외하면 **user/queue/resale/payment/stadium 5서비스는 prod에 Go deployment 자체가 없었습니다.** Phase 7 G1(API 계약 검증)부터 Go pod에 트래픽을 보내야 하는데, pod가 없으니 audit 자체가 불가능한 상태였습니다.

Phase 6.5는 이 갭을 해소하기 위한 전처리 단계입니다.

### 작업 매트릭스 (W1~W7)

| W | 작업 | 레포 | 추정 PR |
|---|------|------|--------|
| W1 | helm values 5세트 | Goti-k8s | PoC 1 + 일괄 4 |
| W2 | ECR CD 워크플로우 5개 | Goti-go | 1 통합 또는 5 분리 |
| W3 | GAR CD (GCP) 5개 | Goti-go | Step 6 직전 분리 |
| W4 | AWS Secrets Manager + ExternalSecret | Goti-Terraform | 1 |
| W5 | Istio AuthPolicy/RequestAuth/DR | Goti-k8s (W1 동시) | - |
| W6 | KEDA ScaledObject | Goti-k8s (W1 동시) | - |
| W7 | ApplicationSet 6 entry 추가 | Goti-k8s | 1 |

총 9~14 PR로 진행합니다.

W1~W7은 독립적이지 않습니다. W1(helm values)이 준비되어야 W5(Istio 정책)와 W6(KEDA ScaledObject)를 W1과 동시에 PR로 올릴 수 있습니다. W4(ExternalSecret)는 W2(CD 워크플로우)가 참조하는 시크릿 경로를 먼저 확정해야 합니다.

### PoC → 일괄 전략

5서비스를 한꺼번에 올리면 공통 문제가 터졌을 때 원인 추적이 어렵습니다. 따라서 stadium을 먼저 PoC로 진행합니다.

1. **stadium PoC**: 가장 단순한 read-mostly 서비스입니다. 표준 values 패턴을 stadium으로 검증합니다.
2. **검증 완료 후 일괄**: ticketing-go 패턴을 100% 복제한 stadium values가 정상 동작하면, user/queue/resale/payment를 1~4 PR로 일괄 추가합니다.

산출물 위치:

```text
Goti-k8s/environments/prod/goti-stadium-go/values.yaml
Goti-k8s/environments/prod/goti-stadium-go/values-aws.yaml
```

### 6대 안전 가드 (SG1~SG6)

Java 서비스가 살아있는 상태에서 Go 인프라를 추가하는 작업이므로, 모든 PR에서 아래 가드를 준수합니다.

| ID | 가드 | 구현 |
|----|------|------|
| SG1 | 0% weight 첫 배포 | `replicaCount: 0` 또는 Istio VirtualService weight 0 |
| SG2 | 별도 deployment name | `goti-{svc}-go-prod` (Java deployment 그대로 유지) |
| SG3 | 별도 ServiceAccount + DB user | Go ExternalSecret 분리 |
| SG4 | ApplicationSet entry 분리 | Java 6 + Go 6 = 12 entry |
| SG5 | 머지 전 manifest 검증 | `helm template` + `kubectl --dry-run=server` |
| SG6 | ArgoCD prune: false | Go entry에만 적용 (Java entry는 기존 정책 유지) |

SG1과 SG2가 가장 중요합니다. 첫 배포는 반드시 `replicaCount: 0` 또는 Istio VS weight 0으로 Go pod에 트래픽을 보내지 않는 상태에서 시작합니다. 사용자가 직접 검토하고 weight를 올리는 방식으로 진행합니다.

SG4는 ApplicationSet 구조를 두 배로 만들지만, Java entry와 Go entry가 완전히 독립되어 있어 한쪽이 ArgoCD에서 문제가 생겨도 다른 쪽에 영향을 주지 않습니다.

---

## Phase 7 재개 조건

Phase 6.5 작업 단위 G1~G7이 모두 GREEN(24h 관측 후 Java 무영향 확인) 상태가 되면 Phase 7 Audit 풀세트(S1·S2·S4·S5·S7·S8·S11)를 재개합니다.

Phase 7 S0(audit 설계)와 S3(정적분석 GREEN), G6 일부 산출물은 이미 완료 상태이므로 그대로 활용합니다.

Step 4는 4b로 확정했습니다. ticketing-go 단독이 아닌 **6서비스 전체 Go canary 컷오버**입니다.

---

## 📚 배운 점

- **"인프라 갭"을 인지한 시점이 번복 시점입니다.** D 옵션이 틀렸다는 것이 아니라, Phase 7 진입 조건이 충족되지 않은 상태에서 audit을 진행하면 공허한 결과가 나옵니다. "Go pod 하나도 prod에 없다"는 사실을 인지했을 때 바로 번복할 수 있었던 것이 중요합니다
- **포트폴리오 가치와 비용 제약은 함께 풀립니다.** 비용 때문에 D를 택했는데, GCP $300 크레딧이라는 제약 해소 수단이 있다면 비용 논리는 기각됩니다. 제약 조건 목록을 먼저 나열하고, 각 조건이 실제로 바인딩되어 있는지 확인하는 습관이 필요합니다
- **Java 보호 전략이 선행되어야 Go 인프라 추가가 안전합니다.** SG1~SG6 없이 진행했다면 feature branch 하나가 Java prod에 영향을 줄 수 있었습니다. 안전 가드를 명문화하고 PR마다 체크하는 구조가 실행 가능한 번복을 가능하게 합니다
- **단계별 게이트(Phase 번호)는 순서가 바뀔 수 있습니다.** Phase 6 → Phase 7이 자연스러운 흐름이지만, 진입 조건이 충족되지 않으면 6.5 같은 중간 단계를 삽입하는 것이 맞습니다. 번호의 순서보다 각 Phase의 목적과 진입 조건이 더 중요합니다
