---
title: "Multi-Cloud ReadOnly 스모크 테스트 — CF Worker로 AWS·GCP 양쪽 트래픽 증명"
excerpt: "Cloudflare Worker가 AWS EKS와 GCP GKE 양쪽으로 트래픽을 분배하는지 2분짜리 read-only k6 스모크로 검증합니다. Grafana 대시보드에서 두 클라우드의 선이 동시에 뜨는 순간이 곧 Active-Active Read의 증명입니다"
category: monitoring
tags:
  - go-ti
  - Multi-Cloud
  - ReadOnly
  - SmokeTest
  - Failover
  - troubleshooting
series:
  name: "goti-multicloud"
  order: 8
date: "2026-04-18"
---

## 한 줄 요약

> Cloudflare Worker → AWS EKS + GCP GKE 양쪽에 2분간 read-only 트래픽을 흘려보내며 Grafana에서 cloud 별 p95·RPS·CPU를 비교했습니다. 에러 0으로 끝나면 **Multi-Cloud Active-Active Read**가 실증된 것입니다

---

## 🔥 상황: Phase B 관측 시연이 필요합니다

pglogical 기반 Multi-Cloud 구성이 구축된 상태에서, 실제로 양쪽 클라우드가 동시에 read 트래픽을 처리하는지를 **수치로** 보여줘야 했습니다.

단순히 "구성이 됐다"로는 부족합니다.
대시보드에 AWS와 GCP 두 선이 동시에 뜨고, 각 클러스터 CPU가 동시에 움직이는 그림이 필요했습니다.
그래야 시연이나 보고 자리에서 "지금 양쪽이 살아있다"는 증명이 됩니다.

시연 시점은 **저녁에 AWS EKS를 기동한 뒤, pglogical subscription 상태가 `replicating`이 된 이후**로 잡았습니다.
스크립트는 `infra/ops/phase-b-pglogical/load-test-multicloud-readonly.js`입니다.

---

## 🤔 사전 준비: 4중 체크리스트

스모크를 돌리기 전에 **4개 레이어가 전부 Ready**여야 합니다.
한 곳이라도 빠지면 대시보드가 이상해 보이거나 아예 요청이 실패합니다.

### 1. AWS EKS 노드·Pod Ready

기본 구성은 core 5대 + spot 5대, 합쳐서 최소 10대 이상입니다.

```bash
$ kubectl --context=aws-goti-prod get nodes --no-headers | wc -l
# 10 이상이어야 함

$ kubectl --context=aws-goti-prod get pods -n goti --no-headers | grep -c Running
```

앱 Pod가 전부 Running 상태인지 한 번 더 확인합니다.

### 2. AWS 모니터링 스택 정상

Mimir와 Grafana가 돌아가고, query-frontend endpoint가 존재해야 Grafana 대시보드에 AWS 메트릭이 들어옵니다.

```bash
$ kubectl --context=aws-goti-prod get pods -n monitoring --no-headers | head
$ kubectl --context=aws-goti-prod get ep mimir-prod-query-frontend -n monitoring
```

endpoint가 비어 있으면 대시보드에 AWS 선이 안 뜹니다.

### 3. pglogical subscription `replicating`

AWS 쪽 PostgreSQL에서 subscription 상태가 `replicating`인지 확인합니다.

```bash
# master password는 K8s Secret에서 꺼내고, pod 안에서 psql 실행
psql -h <rds-endpoint> -U goti -d goti -c \
  "SET default_transaction_read_only=off; \
   SELECT status, slot_name FROM pglogical.show_subscription_status();"
# expected: status=replicating
```

read-only라 WAL을 만들지는 않지만, subscription이 끊어진 상태면 복제 지연 패널이 이상하게 찍힐 수 있습니다.

### 4. Cloudflare Worker 분배 확인

팀 코드 기반 라우팅(samsung/doosan)이 정상 동작하는지 간단히 찍어봅니다.

```bash
$ curl -s -w "%{http_code} %{time_total}s\n" -o /dev/null \
  https://go-ti.shop/api/v1/games/schedules?today=true
```

200이 돌아오고 응답 시간이 정상이면 Worker가 살아 있는 것입니다.

### 선택: orders/payments 정합성 복구

이 단계는 선택이지만, **안 하면 대시보드가 왜곡되어 보입니다**.
양쪽 클라우드의 row count가 다르면 "aws=100개 / gcp=80개" 같이 비대칭으로 보여서 시연의 인상을 해칩니다.
복구 절차는 `docs/runbooks/db-failover-failback.md`를 따릅니다.

---

## ✅ 실행: k6 스모크 2분

기본 시나리오는 **VU 5명, 2분**입니다.
인상을 더 강조하고 싶으면 VU 10명, 5분으로 확장합니다.

```bash
$ cd infra/ops/phase-b-pglogical

# 기본 (5 VU, 2분)
$ k6 run -e BASE_URL=https://go-ti.shop load-test-multicloud-readonly.js

# 확장 (10 VU, 5분) — 시연용
$ k6 run -e BASE_URL=https://go-ti.shop -e VUS=10 -e DURATION=5m \
  load-test-multicloud-readonly.js
```

read-only 엔드포인트만 치기 때문에 DB 쓰기 경로를 건드리지 않습니다.
AWS 쪽이 read_only 상태여도 스모크가 깨지지 않는 이유입니다.

---

## ✅ 관측 포인트: Grafana 대시보드 4종

시연의 핵심은 **대시보드에서 무엇을 봐야 하는가**입니다.
Grafana는 `monitoring.go-ti.shop`을 씁니다.

### 1. `multi-cloud-compare` 대시보드

가장 핵심이 되는 대시보드입니다.
세 개 패널을 같이 봅니다.

- **p99 per cluster**: AWS와 GCP 양쪽 선이 동시에 떠야 합니다. 한 쪽만 뜨면 CF Worker가 한 쪽으로만 트래픽을 보내고 있다는 뜻입니다.
- **error rate**: 0 유지. read-only라 쓰기 차단 영향이 없어서 에러가 날 이유가 없습니다.
- **requests per cluster**: CF Worker가 트래픽을 어떤 비율로 나눴는지 확인합니다.

양쪽 선이 동시에 뜨는 그림이 바로 Active-Active Read의 증명입니다.

### 2. `pglogical-replication` 관련 패널

replication lag은 변화가 없어야 합니다.
read만 치기 때문에 WAL이 생성되지 않습니다.
subscription status는 내내 `replicating`이어야 정상입니다.

### 3. `istio-ingress` 대시보드

AWS Istio gateway RPS와 GCP Istio gateway RPS를 각각 봅니다.
합계는 **k6 요청 × 2 endpoints / 2초 sleep** 식으로 맞아떨어져야 합니다.
맞지 않으면 분배 비율이 비정상이거나 Worker 라우팅에 문제가 있는 것입니다.

### 4. `pod/cpu` 패널 (클라우드 별)

- AWS: `goti-user`, `ticketing`, `stadium` 중 호출된 서비스의 CPU spike.
- GCP: `goti-user-prod-gcp`도 같은 시점에 CPU가 올라가야 합니다.

양쪽 CPU 선이 동시에 움직이는 게 시각적으로 가장 설득력이 있습니다.

---

## ✅ 예상 결과: 에러 0 시나리오

k6 실행이 끝나면 대략 다음과 같은 요약이 나옵니다.

```json
{
  "duration": "120s",
  "vus": 5,
  "total_requests": "~600",
  "rps": "5.0",
  "failed_rate": 0,
  "p95_ms": "<2000",
  "p99_ms": "<5000"
}
```

양쪽 cloud에 약 300 req 씩 흘러간 셈입니다.
read-only라 쓰기 차단의 영향을 받지 않아 failed_rate는 0입니다.
p95가 2초 이하, p99가 5초 이하로 나오면 CF Worker 라우팅도 정상입니다.

Grafana 대시보드에서 AWS/GCP 양 선이 동시에 찍혔다면, **멀티클라우드 active-active read가 실증 완료**된 것입니다.

---

## 🤔 트러블슈팅 레퍼런스

시연 중 터질 수 있는 증상과 대응입니다.

| 증상 | 원인 | 조치 |
|------|------|------|
| `no healthy upstream` | AWS monitoring pod readiness 지연 | 1~2분 대기 후 재시도 |
| 502 / 503 | AWS 쪽 앱 pod 기동 중 | `kubectl rollout status`로 확인 |
| 401 | 인증 없는 요청 일부 (정상) | 무시 |
| p95 > 5s | CF Worker LAX 라우팅 이슈 | Smart Placement / APAC hint 확인 |

**`no healthy upstream`**은 AWS 모니터링 스택이 아직 완전히 기동되지 않은 신호입니다.
초저녁에 EKS를 켜자마자 스모크를 돌리면 자주 겪습니다.
1~2분만 기다리면 해소되므로, 급하게 원인 분석하지 않습니다.

**502/503**은 앱 Pod가 아직 올라오는 중입니다.
`kubectl rollout status deployment/<name> -n goti`로 진행 상태를 확인합니다.

**401**은 일부 API가 인증을 요구하는데 스모크 스크립트가 토큰 없이 호출하는 경우입니다.
read-only 스모크의 목적은 **트래픽이 양쪽으로 흐르는지**이지 200만 보는 게 아니므로, 401 자체는 무시해도 됩니다.

**p95 > 5s**가 지속되면 Cloudflare Worker의 LAX 라우팅 이슈를 의심합니다.
Smart Placement 설정이나 APAC hint가 제대로 들어가 있는지 확인이 필요합니다.

---

## ✅ 완료 후 기록

시연이 끝난 뒤 남겨야 할 것들입니다.

- **k6 결과**: JSON을 `docs/screenshots/phase-b-readonly-*.png` 또는 `.json`으로 저장합니다.
- **Grafana 스크린샷**: 멀티클라우드 AWS/GCP 비교 패널을 그대로 캡처합니다. 양쪽 선이 동시에 뜬 구간이 핵심 이미지입니다.
- **dev-log 업데이트**: 본 문서의 "결과 기록 블록"을 채웁니다.

```markdown
- 실 실행 시각:
- 소요:
- 결과 JSON:
- Grafana 링크:
- 관찰점:
```

이 기록이 나중에 "언제 어떤 상태에서 양쪽이 살아 있었다"는 근거가 됩니다.

---

## 🤔 확장 시나리오: Failover 시연 추가

read-only 스모크가 익숙해지면 **중간에 GCP VM을 내리는 시나리오**를 붙일 수 있습니다.
Cloudflare Worker가 GCP 실패를 감지하고 AWS로 전환하는 과정을 실시간으로 보여줍니다.

### 시나리오 흐름

1. k6 스모크를 시작합니다.
2. 30초 지점에 별도 터미널에서 GCP VM을 stop합니다.
3. CF Worker가 장애를 감지하고 AWS로 트래픽을 넘깁니다.
4. AWS 쪽 RPS가 증가하고 GCP 쪽 RPS가 0으로 떨어지는 걸 확인합니다.
5. 시연 종료 후 VM을 재시작합니다.

### 실행 명령

```bash
# 스모크 시작 후 30초 뒤 별도 터미널에서
$ gcloud compute instances stop goti-prod-pg-primary \
  --zone=asia-northeast3-a --project=project-7b8317dd-9b4d-4f5f-ba2

# 시연 종료 후 재시작
$ gcloud compute instances start goti-prod-pg-primary \
  --zone=asia-northeast3-a --project=project-7b8317dd-9b4d-4f5f-ba2
```

### 주의 사항

GCP 앱이 이 VM에 붙어 있기 때문에 VM을 stop하면 **앱도 같이 먹통**이 됩니다.
CF Worker가 이를 감지해 AWS로 넘기면, AWS는 read_only 상태라도 read는 성공합니다.
스모크는 read 전용이므로 전환 이후에도 계속 200이 찍힙니다.

이 시나리오의 포인트는 "쓰기는 막혀 있어도, 장애 중에 read 서비스는 멈추지 않는다"는 점입니다.
Active-Active Read의 가치가 가장 잘 드러나는 시연 구성입니다.

---

## 📚 배운 점

- **Multi-Cloud 실증은 대시보드로 증명합니다**. 구성이 됐다는 말보다 AWS/GCP 두 선이 동시에 찍힌 그래프 한 장이 훨씬 강력합니다.
- **read-only 스모크는 파괴적 부작용이 없습니다**. 프로덕션에서도 돌릴 수 있고, AWS가 read_only 상태라도 스모크 자체는 깨지지 않습니다.
- **사전 체크리스트가 반이다**. 노드/모니터링/subscription/Worker 4곳 중 하나라도 빠지면 시연이 이상해 보입니다. 체크리스트를 시연 직전에 한 번 더 확인합니다.
- **orders/payments 정합성은 시각적 인상에 영향을 줍니다**. 기능은 문제 없어도 row count 비대칭은 대시보드를 지저분하게 만듭니다. 가능하면 복구 후 시연합니다.
- **Failover 시나리오는 read-only 스모크에 쉽게 얹힙니다**. VM stop 한 줄로 장애를 만들고, Worker 전환 과정을 실시간으로 보여줄 수 있습니다.
