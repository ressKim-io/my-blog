---
title: "FinOps 도구 선택 — OpenCost를 채택한 이유"
excerpt: "Multi-Cloud(EKS+GKE) 환경에서 K8s 워크로드별 비용 가시성이 필요했습니다. Kubecost v3과 클라우드 네이티브 도구를 저울질한 끝에, 기존 Prometheus/Mimir/Grafana 스택을 그대로 재활용할 수 있는 OpenCost를 선택한 결정 과정입니다."
category: monitoring
tags:
  - go-ti
  - FinOps
  - OpenCost
  - Kubecost
  - ADR
date: "2026-04-02"
---

## 한 줄 요약

> Multi-Cloud 전환 중 인프라 비용 가시성이 부재했습니다. Kubecost v3은 IBM 인수 후 가격이 상승했고 클라우드 네이티브 도구는 K8s 수준 분해가 불가능했습니다. CNCF Incubating 프로젝트인 OpenCost를 선택해 기존 Prometheus/Mimir/Grafana 스택 위에서 비용을 관측하기로 결정했습니다.

---

## 배경

### 상황

Multi-Cloud(AWS EKS + GCP GKE) 환경으로 전환하는 중이었습니다. 인프라가 두 개의 클라우드로 분산되면서 비용 가시성 문제가 전면에 드러났습니다.

기존에 존재한 것은 CloudWatch billing alarm `$100` 하나뿐이었습니다. 임계치를 넘으면 알림이 울리지만, **어떤 워크로드가 비용을 쓰고 있는지**는 알 수 없었습니다. 클러스터 전체의 월 청구액만 보이고, namespace나 Pod 수준의 분해는 불가능했습니다.

Grafana에는 FinOps 대시보드(`infra-finops.json`)가 존재했습니다. 다만 데이터 소스가 연결되어 있지 않아 모든 쿼리가 `vector(0)`을 반환하고 있었습니다. 대시보드 UI는 있으나 실제로 수치를 보여주지 못하는 상태였습니다.

### 요구사항

비용 가시화 도구가 만족해야 할 조건을 우선순위로 정리했습니다.

| 요구사항 | 우선순위 |
|----------|----------|
| K8s 워크로드(namespace/Pod)별 비용 추적 | P0 |
| 기존 Prometheus/Grafana/Alertmanager 스택 연동 | P0 |
| Multi-Cloud(EKS + GKE) 동일 도구 | P0 |
| 비용 이상 탐지 및 Discord 알림 | P1 |
| 예산 예측(predict_linear) | P1 |
| 추가 인프라 비용 최소화 | P1 |

P0 세 가지가 동시에 만족되어야 합니다. K8s 수준 분해가 없으면 FinOps 대시보드의 본래 목적을 달성할 수 없고, 기존 스택 연동이 없으면 별도 파이프라인을 구축해야 합니다. Multi-Cloud 동일 도구가 아니면 AWS와 GCP를 각자 다른 UI로 봐야 하고 통합 뷰가 불가능합니다.

---

## 🧭 선택지 비교

### 고려한 옵션

세 가지 방향을 저울질했습니다.

| 옵션 | 핵심 아이디어 | 장점 | 한계 |
|------|---------------|------|------|
| A. OpenCost (CNCF Incubating) | Prometheus exporter로 K8s 비용 메트릭 노출 | 무료, CNCF 표준, 기존 스택 연동 | RI/Spot 할인 미반영, 자체 알림 없음 |
| B. Kubecost v3 (IBM) | 상용 FinOps 플랫폼, OpenCost의 상위 호환 | RI/Spot 반영, 멀티클러스터 UI, 내장 알림 | IBM 인수 후 가격 상승, 벤더 종속 |
| C. Cloud Native Only | AWS Cost Explorer + GCP FinOps Hub | 설정 간단, 클라우드별 최적화 | K8s namespace/Pod 수준 분해 불가 |

### 기각 이유

**옵션 C 탈락 — P0 요구사항 미충족**

AWS Cost Explorer와 GCP FinOps Hub는 **K8s 내부 구조를 이해하지 못합니다**. EC2 인스턴스 단위나 GCE VM 단위로만 비용을 쪼개주며, 그 안에서 돌아가는 Pod별로 비용을 분해할 수 없습니다. namespace별 showback이 불가능하다는 뜻입니다.

또한 통합 뷰가 없습니다. AWS와 GCP 각각 별도 콘솔에서 비용을 봐야 하고, Prometheus 연동도 없어 대시보드 통일성도 확보되지 않습니다. P0 세 항목 모두에 걸려 기각했습니다.

**옵션 B 탈락 — 비용과 벤더 종속성**

Kubecost는 기능적으로 가장 완성도가 높습니다. RI/Spot 할인 반영, 멀티클러스터 UI, 내장 알림, AWS/GCP 완전 통합을 모두 제공합니다.

다만 두 가지 문제가 있었습니다.

첫째, **IBM 인수 후 가격이 상승**했습니다. 무료 티어는 $100K 지출 한도가 있습니다. EKS 번들은 이 한도를 면제받지만, **GKE는 적용 대상이 아닙니다**. Multi-Cloud 요구사항상 GKE도 포함해야 하므로 결국 무료 티어로는 운영할 수 없습니다. Enterprise는 `$449+/월`부터 시작합니다.

둘째, **벤더 종속성**입니다. IBM의 로드맵에 따라 기능과 가격 정책이 바뀔 수 있고, 이미 인수 후 가격 인상이 진행된 사례가 있습니다. FinOps 도구 자체에 강한 lock-in이 생기는 것은 장기적으로 부담이었습니다.

### 결정 기준과 최종 선택

**옵션 A(OpenCost)를 채택했습니다.**

결정 기준은 다음 우선순위였습니다.

1. **기존 스택 100% 재활용 가능성**: 새 인프라 없이 Prometheus/Mimir/Grafana/Alertmanager를 그대로 사용할 수 있는가.
2. **Multi-Cloud 동일 도구**: EKS와 GKE에서 같은 Helm chart와 같은 메트릭 이름으로 통합할 수 있는가.
3. **추가 비용 최소화**: 1주 시연·초기 운영 단계에서 별도 라이선스나 인프라 비용이 들지 않는가.

OpenCost는 세 가지를 모두 만족합니다. Prometheus exporter를 네이티브로 제공해 기존 파이프라인에 그대로 얹을 수 있고, Helm chart가 클라우드 중립적이라 EKS/GKE에 동일하게 배포 가능합니다. Pod 리소스 비용은 월 `$2~4` 수준으로 Kubecost Enterprise 대비 100배 이상 저렴합니다.

RI/Spot 미반영과 자체 알림 부재는 명시적으로 인지된 한계였습니다. 이는 Phase 3에서 AWS CUR과 GCP BigQuery billing export로 보완하고, 알림은 기존 Alertmanager → Discord 파이프라인을 재활용해 해결하기로 했습니다.

---

## 결정

**OpenCost를 채택합니다.** Helm chart로 EKS와 GKE 양쪽에 배포하며, Prometheus ServiceMonitor → Mimir → Grafana 경로로 기존 관측성 스택에 통합합니다.

### 근거 상세

**첫째, 기존 스택 100% 재활용입니다.**

새로 도입해야 하는 인프라가 없습니다. OpenCost Pod 하나만 추가하면 Prometheus ServiceMonitor가 메트릭을 긁어가고, Mimir에 저장되고, Grafana에서 쿼리됩니다. 알림은 Alertmanager → Discord 경로를 그대로 씁니다. 운영 복잡도가 증가하지 않는다는 뜻입니다.

**둘째, Multi-Cloud 동일 도구입니다.**

EKS와 GKE에 동일한 Helm chart로 배포할 수 있습니다. 메트릭 이름도 동일하므로 Grafana에서 `cluster` 라벨 하나로 구분해 통합 대시보드를 만들 수 있습니다. Kubecost처럼 클러스터별 별도 UI를 오가지 않습니다.

**셋째, 비용 `$2~4/월`입니다.**

Kubecost Enterprise는 `$449+/월`부터 시작합니다. OpenCost는 CNCF 프로젝트이므로 라이선스 비용이 없고, Pod 리소스 비용만 발생합니다. 초기 단계에서 100배 이상의 비용 차이는 의사결정을 확실하게 만들었습니다.

**넷째, CNCF Incubating으로 벤더 중립입니다.**

CNCF의 거버넌스 아래 운영되므로 특정 회사에 종속되지 않습니다. 2025년에 11회 릴리스가 이뤄졌고, 커뮤니티가 활발합니다. 특정 벤더가 가격 정책을 바꿔도 프로젝트 방향이 흔들리지 않습니다.

**다섯째, MCP Server 내장입니다.**

2026년 신규 기능으로 MCP Server가 내장되었습니다. Claude Code에서 자연어로 비용을 조회할 수 있는 경로가 열려 있습니다. 운영 도구와의 연동성이 자연스럽게 확장 가능합니다.

**여섯째, RI/Spot 미반영 보완 경로가 있습니다.**

OpenCost 단독으로는 RI/Spot 할인을 반영하지 못합니다. Phase 3에서 AWS CUR(Cost and Usage Report)과 GCP BigQuery billing export를 연결해 이 갭을 메우기로 설계했습니다. 단기에 필요한 정보는 list price 기준만으로도 의사결정에 충분합니다.

---

## 구현 계획

네 단계로 롤아웃합니다.

### Phase 1 — OpenCost 배포 + 대시보드 연결

GitOps 구조 위에 OpenCost를 올립니다.

- `monitoring-appset.yaml`에 OpenCost 컴포넌트 추가
- `opencost-values.yaml` 생성해 Mimir query-frontend를 데이터 소스로 연결
- Terraform으로 AWS Pricing API 호출을 위한 IRSA 구성
- `infra-finops.json` 대시보드의 쿼리를 OpenCost 메트릭으로 교체

ServiceAccount에 AWS Pricing API 권한을 IRSA로 부여해야 list price를 정확히 가져올 수 있습니다. 권한 없이 동작시키면 fallback으로 공개 가격표를 사용하지만 정확도가 떨어집니다.

### Phase 2 — 알림 체계 구축

Recording rule과 Alert rule을 작성합니다.

**Recording rules**:
- `namespace:cost_hourly:sum` — namespace별 시간당 비용
- `cluster:cost_monthly:sum` — 클러스터별 월 비용
- CPU/Memory 효율성(요청량 대비 실사용량)

**Alert rules**:
- 예산 초과: 월 예산 대비 현재 지출 추세
- 비용 급등: 전주 대비 급격한 상승
- 유휴 리소스: 할당됐지만 사용되지 않는 CPU/Memory
- 예산 예측: `predict_linear`로 월말 예상치가 임계를 초과할 때

알림은 `#goti-finops` Discord 채널로 전송합니다. Alertmanager의 webhook receiver로 기존 경로를 재활용합니다.

### Phase 3 — 클라우드 네이티브 보완

OpenCost가 커버하지 못하는 영역을 메웁니다.

- AWS Budget → SNS → Lambda → Discord 연동
- GCP Budget → Pub/Sub → Cloud Function → Discord 연동
- AWS Cost Anomaly Detection 활성화
- Infracost CI 도입으로 Terraform 변경 시 비용 diff 확인

이 단계에서 RI/Spot 할인이 반영된 실제 청구액을 확보합니다. OpenCost의 list price 기반 수치와 대조해 보정값을 운영합니다.

### Phase 4 — Multi-Cloud 통합 뷰

GKE에도 OpenCost를 배포하고 FOCUS 포맷으로 AWS/GCP 비용을 통합합니다. FOCUS(FinOps Open Cost & Usage Specification)는 클라우드 간 비용 데이터 형식을 통일하는 FinOps Foundation 표준입니다. 이를 기준으로 단일 Grafana 대시보드에 두 클라우드 비용을 합쳐 표시합니다.

---

## 결과

### Positive

결정으로 얻게 되는 것은 다음과 같습니다.

- **K8s 워크로드별 비용 추적**이 namespace/Pod 수준에서 가능해집니다. FinOps 대시보드의 본래 목적을 달성합니다.
- **기존 모니터링 파이프라인을 완전히 재활용**합니다. 운영 복잡도가 증가하지 않습니다.
- **`predict_linear` 기반 사전 예산 알림**으로 비용이 급증하기 전에 대응할 수 있습니다.
- **경기별 Showback**이 가능해집니다. 삼성(AWS)과 두산(GCP)을 namespace 라벨로 분리해 각 경기에서 소비한 비용을 책임 단위로 귀속합니다.

### Negative

감수해야 할 한계는 세 가지입니다.

- **OpenCost 단독으로는 RI/Spot 할인이 반영되지 않습니다.** Phase 3의 CUR/BigQuery 연동이 필수입니다.
- **전월 대비 비용 비교**는 Phase 3이 끝나기 전까지 정확도가 떨어집니다. list price와 실청구액의 차이가 있기 때문입니다.
- **OpenCost Pod 장애 시 비용 메트릭에 공백**이 생깁니다. 이 공백이 대시보드를 깨뜨리지 않도록 recording rule에 `or vector(0)` 패턴을 적용합니다.

### Reversibility

OpenCost는 Helm uninstall만으로 제거됩니다. ServiceMonitor와 Mimir 데이터는 보존되지만, 새 메트릭 유입이 멈출 뿐입니다. 다른 도구로 전환해야 한다면 Kubecost는 OpenCost의 상위 호환이므로 메트릭 호환성이 상당 부분 유지됩니다. 교체 비용이 낮다는 점은 이번 결정의 reversibility를 지탱하는 근거입니다.

---

## 📚 배운 점

- **"무엇이 최선인가"가 아니라 "무엇이 현재 제약에 맞는가"**로 판단해야 합니다. Kubecost가 기능적으로 우위였지만, GKE의 무료 티어 제외와 벤더 종속성은 우리 상황에서 결정적 탈락 요인이었습니다.
- **기존 스택 재활용은 과소평가하기 쉬운 가치**입니다. 새 파이프라인을 구축하는 비용은 초기에 보이지 않지만, 운영 단계에서 두 배 이상의 복잡도로 돌아옵니다.
- **한계는 숨기지 말고 명시하고 보완 경로를 설계**합니다. OpenCost의 RI/Spot 미반영은 ADR에 적시하고 Phase 3에서 CUR/BigQuery로 보완하기로 명시했습니다. 이 경로가 없으면 같은 결정은 위험합니다.
- **vendor-neutral 선택은 의사결정의 reversibility를 높입니다.** CNCF 프로젝트는 가격 정책 변경 리스크가 없고, 필요 시 상위 호환 도구로 이전하기가 쉽습니다.
- **FinOps는 "데이터를 모으는 것"이 아니라 "행동을 바꾸는 것"**입니다. 예산 알림과 showback 구조를 함께 설계해야 비용 가시화가 실제 의사결정으로 연결됩니다.
