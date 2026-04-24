---
title: "Java→Go 전환 전략 — 병렬 폴더 제안에서 One-Shot Cutover로"
excerpt: "부하테스트로 Java 병목을 공식화한 당일, 팀원이 제안한 '병렬 폴더 + 딸깍 토글' 아이디어를 검토하고 결국 단일 컷오버로 방향을 틀기까지의 의사결정 기록"
category: challenge
tags:
  - go-ti
  - Go
  - Java
  - Migration
  - Architecture Decision Record
  - adr
series:
  name: "goti-java-to-go"
  order: 1
date: "2026-04-12"
---

## 한 줄 요약

> 병렬 폴더 + 토글 전략은 이미 구현 방향과 일치했지만, 시간 제약과 운영 부담을 감안해 당일 심야에 one-shot full cutover로 전환 방향을 확정했습니다

---

## 배경: Java 병목이 공식화된 날

go-ti 프로젝트는 대규모 야구 티켓팅 플랫폼을 목표로 했습니다.
동시 접속 50만, API p99 200ms 이하라는 수치를 달성하려면 기존 Java 서버의 한계를 넘어야 했습니다.

2026-04-12, capacity planning 부하테스트에서 Stadium 서비스의 p95 응답 시간이 6.8초, 5xx 오류율이 10.88%로 측정됐습니다.
JVM 메모리 압박과 콜드스타트 지연이 핵심 병목임이 수치로 확인됐고, 이미 진행 중이던 Go 전환 작업을 가속하기로 결정했습니다.

Go PoC에서는 메모리 사용량 6배 절감이 실측됐습니다.
이 수치를 근거로 ticketing 서비스를 시작으로 6개 서비스 전체를 Go로 전환하는 계획(Step 4=4b)이 확정된 상황이었습니다.

병목 수치가 나온 직후, 팀원이 prod 전환 전략에 대한 구체적인 아이디어를 제시했습니다.

---

## 팀원 제안: 병렬 폴더 + 딸깍 토글

> "prod 환경에서 Go로 전환할 때 Java 코드 건들지 말고, 폴더를 하나 더 만들어서 그쪽으로 전환하면 어떠냐. 딸깍 변수 바꾸면 다시 Java로 돌아갈 수 있게."

제안의 핵심 포인트는 네 가지였습니다.

1. **Java 코드 무수정 원칙** — 기존 `Goti-server/` 디렉토리를 그대로 유지
2. **병렬 Go 배포** — 별도 폴더/디렉토리에서 Go 구현 배포
3. **변수 토글 기반 스위치** — 값 하나를 바꾸면 Java ↔ Go 즉시 전환
4. **빠른 롤백** — Go에 문제가 생기면 딸깍 한 번으로 Java로 복귀

---

## 현재 아키텍처 상태 (2026-04-12 기준)

제안을 받고 확인해보니, **병렬 폴더 방향은 이미 부분적으로 구현된 상태**였습니다.

| 레이어 | Java | Go |
|---|---|---|
| 코드 레포 | `Goti-server/` (그대로 유지) | `Goti-go/` (별도 레포) |
| Helm values | `Goti-k8s/environments/prod/goti-ticketing/` | `Goti-k8s/environments/prod/goti-ticketing-go/` |
| Deployment | `goti-ticketing-prod` | `goti-ticketing-go-prod` |
| Service | `goti-ticketing-prod` | `goti-ticketing-go-prod` |
| ArgoCD App | `goti-ticketing-prod` | `goti-ticketing-go-prod` |
| ApplicationSet | `prod` | `prod` (elements에서 주석 처리 중 — Phase 6.5 완료까지) |

"Java 코드 무수정 + 별도 폴더/배포" 구조는 이미 확립됐습니다.

미해결 요소는 **"딸깍 토글" 메커니즘을 구체적으로 무엇으로 구현할 것인가**였습니다.

---

## 🧭 선택지 비교

### 고려한 옵션

| 옵션 | 핵심 아이디어 | 장점 | 한계 |
|------|---------------|------|------|
| A. Istio VirtualService weight | Helm values의 weight 값으로 Java/Go 비율 조절 | 점진 롤아웃, 실시간 A/B 메트릭 비교 | PR 필요, 수분 소요 |
| B. ApplicationSet elements 주석 | ArgoCD elements 주석 처리/해제로 활성화 전환 | 이미 현재 방식과 동일, 구현 불필요 | 단계 조절 불가, 0% 또는 100%만 |
| C. Feature Flag / 환경변수 | 게이트웨이 앞단에서 `IMPL_MODE=java\|go`로 분기 | 코드 레벨 제어, 무중단 전환 | 구현 복잡도 높음, 외부 서비스 연동 필요 |

---

### 옵션 상세 분석

**옵션 A — Istio VirtualService weight 기반 라우팅**

Helm values에 weight를 두어 Java와 Go로의 트래픽 비율을 조절하는 방식입니다.

```yaml
# charts/goti-common/templates/_virtualservice.tpl
http:
  - route:
      - destination: { host: goti-ticketing-prod }
        weight: 100   # Java (현재)
      - destination: { host: goti-ticketing-go-prod }
        weight: 0     # Go (대기)
```

weight 값을 변경하고 PR을 올리면 ArgoCD가 sync하면서 수 분 내 전환됩니다.
100/0 → 90/10 → 50/50 → 0/100 단계적 롤아웃이 가능하고, Grafana에서 두 버전의 p95와 에러율을 나란히 비교할 수 있습니다.

**옵션 B — ApplicationSet elements 주석 토글**

ArgoCD ApplicationSet의 elements 목록에서 Go 항목을 주석 처리하거나 해제하는 방식입니다.

```yaml
# Goti-k8s/environments/prod/apps/applicationset.yaml
generators:
  - list:
      elements:
        - name: goti-ticketing         # Java (활성)
        # - name: goti-ticketing-go    # Go — 주석 처리 중
```

현재 `ticketing-go`가 정확히 이 방식으로 비활성 상태입니다.
추가 구현 없이 주석만 해제하면 Go가 배포되고, 다시 주석 처리하면 Java로 돌아옵니다.
단, 0% 또는 100% 두 상태만 존재해 점진 롤아웃이 불가능합니다.

**옵션 C — Feature Flag / 환경변수 기반**

게이트웨이 앞단에서 환경변수로 라우팅 분기를 제어하는 방식입니다.
LaunchDarkly, GrowthBook 같은 외부 flag 서비스와 연동하면 코드 배포 없이 즉시 전환도 가능합니다.
100% 무중단 전환이 가능하지만 구현 복잡도가 가장 높습니다.

---

### 기각 이유

- **B 탈락(단독 토글로는 불충분)**: 구현이 가장 간단하지만 점진 롤아웃이 불가능합니다. Go에서 문제가 발생했을 때 10% 롤백, 50% 유지 같은 세밀한 제어가 어렵습니다. 단, initial cutover는 이 방식으로 해도 무방합니다
- **C 탈락**: 외부 flag 서비스 연동은 1~2일 추가 구현이 필요합니다. 이미 capacity test로 하루를 소진한 상황에서 투자 대비 효과가 맞지 않았습니다

---

### 결정 기준과 원 제안 결론

원 제안 기준은 다음 우선순위였습니다.

1. **빠른 롤백 가능성**: Go 문제 시 Java로 즉시 복귀
2. **점진 노출**: 소수 사용자부터 Go를 경험시켜 안전하게 확대
3. **운영 부담 최소화**: 두 버전 동시 유지에 따른 Config 이중 관리 허용 여부

A를 기본으로 삼고, initial cutover는 B로 처리한 뒤 fine-tuning은 A로 하는 병행 방식이 논의됐습니다.

---

## 심야 결정: 병렬 운영 기각, One-Shot Cutover 채택

그러나 같은 날 심야에 방향이 완전히 바뀌었습니다.

**최종 채택: 병렬 배포 없이 one-shot full cutover.**

- prod에서 **Java 완전 철수 + Go 전면 배포**
- Java-Go **호환성 검증 생략** (시간·리소스 부족)
- "딸깍 토글" 기반 병렬 운영 **미채택**
- Kubernetes/Helm 상에서 Java Deployment 제거 + Go Deployment만 운영

### 채택 근거

1. **시간 제약**: capacity test로 하루를 소진했고, 팀이 호환성 검증에 투입할 여력이 없었습니다
2. **리스크 허용**: staging에서 충분히 검증하면 prod cutover는 단일 이벤트로 처리 가능하다고 판단했습니다
3. **운영 부담 감소**: 병렬 운영 시 DB schema drift, config 이중 관리 비용을 피할 수 있습니다
4. **Java 병목 확정**: 이미 수치로 병목이 확인됐으므로 빨리 제거하는 것이 유리했습니다

### 전제 조건과 리스크 수용

이 결정은 다음 전제 위에서 성립합니다.

- **Staging E2E 검증 완료**: Go 전체 E2E가 staging에서 통과됐음을 전제
- **roll-forward only 정책**: 문제 발생 시 Java 롤백이 아니라 **Go에서 즉시 hotfix**
- **DB 스키마 호환**: Go가 동일 PostgreSQL 스키마를 읽고 쓸 수 있는 상태

수용한 리스크는 명확합니다.

- prod 사용자 세션이 전환 순간 일시적으로 끊길 수 있습니다
- Go에서 잠재 버그가 드러나면 Java 롤백이 불가능하며 Go에서 즉시 수정 배포를 해야 합니다
- 병렬 A/B 메트릭 비교가 불가능하며, 비교 기준선은 이날 부하테스트 결과를 사용합니다

---

## 📚 배운 점

- **"이미 하고 있던 방향"을 제안으로 재확인하는 것도 가치 있습니다** — 팀원 제안이 기존 Phase 6.5 설계와 일치했다는 것은 방향이 옳다는 독립 검증입니다
- **병렬 운영의 진짜 비용은 코드가 아니라 DB입니다** — Java/Go가 같은 PostgreSQL 스키마를 공유할 때 schema migration은 양쪽 호환을 전제해야 합니다. 이 복잡도가 결국 병렬 운영 포기의 핵심 이유 중 하나였습니다
- **토글 메커니즘은 사전에 명문화해야 합니다** — A(VS weight)와 B(elements 주석)는 모두 PR 기반이고 롤백 시간이 수 분입니다. "딸깍" 한 번이 실제로 얼마나 걸리는지 팀이 공유된 인식을 가져야 합니다
- **시간 제약은 설계 단순화의 정당한 이유입니다** — 병렬 운영이 이상적이더라도, 검증 여력이 없을 때 단순한 one-shot 전환이 더 현실적인 선택일 수 있습니다
