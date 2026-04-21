---
title: "Multi-Cloud Failover 관측 파이프라인 bring-up — Worker fanout으로 양쪽 Grafana 통일"
excerpt: "Cloudflare Worker가 직접 emit하는 라우팅 메트릭을 AWS/GCP 양쪽 cluster로 fanout해, 어느 쪽 Grafana에서 봐도 동일한 failover 대시보드를 띄운 과정입니다."
category: monitoring
tags:
  - go-ti
  - Multi-Cloud
  - Failover
  - AWS
  - GCP
  - Cloudflare
series:
  name: "goti-multicloud"
  order: 7
date: "2026-04-17"
---

## 한 줄 요약

> Cloudflare Worker `multicloud-router`의 라우팅 결정을 직접 메트릭으로 뽑아, AWS/GCP 양쪽 cluster의 `goti-load-observer`로 fanout했습니다. GCP 쪽 파이프라인이 end-to-end로 동작하는 것을 확인했고, AWS 쪽은 ASG=0 대기 상태로 남겨뒀습니다.

## Impact

- **목표**: GCP 장애 시 AWS 100% 전환을 라이브 대시보드로 관측
- **결과**: GCP 파이프라인 end-to-end 검증 완료 (2026-04-17 17:40 KST)
- **남은 작업**: AWS 재기동 후 수 분 작업으로 완성
- **관련 레포**: 5개 (goti-load-observer, Goti-k8s, Goti-monitoring, goti-team-controller, Goti-Terraform)

---

## 🔥 문제: Multi-Cloud 라우팅을 관측할 방법이 없다

Cloudflare Worker `multicloud-router`는 AWS EKS와 GCP GKE로 트래픽을 분배합니다. GCP 장애가 발생하면 AWS로 100% 전환되도록 설계되어 있습니다.

문제는 이 라우팅 결정을 **라이브로 관측할 수단이 없다**는 것이었습니다. 영상 촬영이 가능한 수준의 대시보드가 필요했지만, 기존 메트릭 소스로는 부족했습니다.

### 기존 접근의 한계

두 가지 후보를 검토했습니다.

**1. Origin 도달 메트릭 사용**

각 cluster의 Istio Gateway에서 들어오는 트래픽을 세면 됩니다. 하지만 이 방식은 중간 실패를 놓칩니다. Worker에서 circuit이 open되어 요청이 아예 origin에 도달하지 않는 경우, origin 메트릭에는 기록되지 않습니다. 실제 라우팅 분배를 정확히 반영하지 못합니다.

**2. cloudflare-exporter 사용**

Cloudflare Zone 단위 메트릭을 긁어오는 exporter입니다. 하지만 cloud 단위 분리가 불가능합니다. Zone 전체 트래픽만 보이고, 그중 AWS로 간 것과 GCP로 간 것을 구분할 수 없습니다. 메트릭 소스로 부적절했습니다.

### 진실은 Worker의 라우팅 결정 그 자체

**진실 소스는 Worker의 라우팅 결정 자체**라는 결론에 도달했습니다. Worker가 직접 메트릭을 emit하고, 양쪽 cluster로 동시에 보내야 합니다.

---

## 🤔 원인: Workers Analytics Engine은 라이브 데모에 부적합

Cloudflare에는 Workers Analytics Engine이라는 내장 분석 도구가 있습니다. Worker가 `writeDataPoint`로 데이터를 쓰면 Cloudflare가 집계해줍니다.

문제는 **1~2분 지연**입니다. 라이브 데모에서는 GCP kill 직후 수 초 내에 AWS 전환이 대시보드에 반영되어야 합니다. 1분 지연은 영상 촬영에 치명적입니다.

### 커스텀 HTTP sink 채택

Worker가 `ctx.waitUntil`로 fire-and-forget fetch를 날리는 방식을 선택했습니다. 양쪽 cluster의 `goti-load-observer`가 sink 역할을 합니다.

```
CF Worker ──ctx.waitUntil(Promise.allSettled([
    fetch('https://aws-api.go-ti.shop/__worker-metrics/ingest'),
    fetch('https://gcp-api.go-ti.shop/__worker-metrics/ingest'),
]))──▶

  [AWS EKS]                    [GCP GKE]
   Istio Gateway                Istio Gateway
     │                            │
     └─/__worker-metrics ──▶     └─/__worker-metrics ──▶
         goti-load-observer          goti-load-observer
           │                            │
         Prom scrape                  Prom scrape (향후)
           │
       Grafana: Multi-Cloud Failover (17 panel)
```

이 구조의 핵심 결정은 **양쪽 cluster 동일 뷰**입니다. Worker가 AWS sink와 GCP sink 양쪽으로 fanout하기 때문에, 어느 cluster의 Grafana에서 보더라도 같은 데이터가 나옵니다. GCP가 죽어도 AWS Grafana에 GCP kill 시나리오가 그대로 기록됩니다.

`Promise.allSettled`를 쓴 이유는 한쪽 sink가 실패해도 나머지 쪽은 계속 받아야 하기 때문입니다. 500ms timeout과 loop 방지 로직을 함께 넣었습니다.

---

## ✅ 해결: 5개 레포에 걸친 구현

### goti-load-observer — Ingest Handler 추가

`internal/ingest/handler.go`로 POST `/__worker-metrics/ingest` 엔드포인트를 추가했습니다. 주요 제약 조건을 넣었습니다.

- **shared-token 인증**: `x-metrics-token` 헤더 검증
- **4KB payload cap**: Worker에서 들어오는 페이로드 크기 제한
- **cardinality bounded labels**: 라벨 값이 폭주하지 않도록 허용 목록 기반 검증

registry도 5종으로 확장했습니다.

- `goti_worker_requests`
- `goti_worker_failover`
- `goti_worker_circuit_opens`
- `goti_worker_request_duration`
- `goti_worker_ingest_errors`

`.github/workflows/cd-gcp.yml`을 추가해 GCP Artifact Registry로 push하고 Goti-k8s PR을 자동 생성하도록 만들었습니다. 관련 커밋은 `7795425`, `a37b622`, `cc57b0f`입니다.

### Goti-k8s — Gateway 라우팅 구성

AWS와 GCP 양쪽 environment에 load-observer values를 추가했습니다.

- `environments/prod/goti-load-observer/values.yaml`: `aws-api.go-ti.shop/__worker-metrics/*` → load-observer-prod
- `environments/prod-gcp/goti-load-observer/values.yaml`: `gcp-api.go-ti.shop` 동일 패턴

2026-04-17 수정 사항으로, GCP 쪽 `gatewayRef`를 `"istio-system/..."`에서 `"istio-ingress/..."`로 바꿨습니다. 네임스페이스 차이 때문이었습니다. 관련 커밋은 `85a68ab`, `d8ed57f`입니다.

### Goti-monitoring — 17 패널 대시보드

`grafana/dashboards/devops/multi-cloud-failover.json`을 추가하고 `charts/goti-monitoring/`에 동기 복사했습니다. 17개 패널로 구성됩니다.

- **파이차트**: AWS/GCP 라우팅 비율
- **Stat 패널**: 상태 요약
- **시계열**: 분당 요청 추이
- **Failover 원인**: timeout, circuit open 등 사유별 카운트
- **팀별 테이블**: 팀 단위 트래픽 분포
- **CF edge 참고**: Cloudflare edge 메트릭 참조용
- **Origin 검증**: Worker 메트릭과 origin 메트릭 교차 검증

관련 커밋은 `b9c0013`입니다.

### goti-team-controller — Worker Fanout 구현

`infra/cloudflare/multicloud-router.worker.js`에 fanout 로직을 추가했습니다.

- `Promise.allSettled`로 양쪽 sink 동시 호출
- 500ms timeout
- loop 방지 (sink 자체가 Worker로 돌아오지 않도록)

`infra/cloudflare/README.md`에 `METRICS_TOKEN` Worker Secret 설정 가이드를 추가했습니다. 관련 커밋은 `76d71a3`입니다.

### Goti-Terraform — Secret 관리

`prod-aws`와 `prod-gcp` config 모듈에 `WORKER_INGEST_TOKEN` secret을 추가했습니다.

`prod-gcp` database 모듈에는 `google_sql_user.observer_ro`를, config 모듈에는 세 개의 secret을 추가했습니다.

- `LOAD_OBSERVER_DB_DSN`
- `REDIS_ADDR`
- `REDIS_PASSWORD`

관련 커밋은 `35de9fd`입니다. GRANT 용 `null_resource`는 제거했습니다(아래 트러블슈팅 참고).

---

## 🔧 겪은 문제와 해결

### 1. ArgoCD auto-sync pickup 실패

PR #273을 머지하고 44분이 지났는데도 deployment가 옛 tag를 참조하고 있었습니다.

```bash
$ kubectl patch application goti-load-observer \
    --type merge -p '{"operation":{"sync":{"revision":"HEAD"}}}'
```

`refresh=hard`로 수동 트리거하자 즉시 revision이 업데이트됐습니다. 원인은 미확인입니다. auto-sync polling 실패 또는 webhook 미설정 중 하나로 추정합니다.

### 2. Cloud SQL private-only + Terraform null_resource

`cloud-sql-proxy`를 로컬에서 실행해 private IP 인스턴스에 연결하려 했습니다. 하지만 private-only 환경에서는 로컬에서 proxy로 접근이 불가능했습니다. Terraform apply가 15분 hang 후 timeout으로 실패했습니다.

해결책은 `null_resource`를 제거하고, GRANT 실행을 K8s Job으로 옮기는 것이었습니다. 이렇게 하면 Job이 cluster 내부에서 실행되므로 private IP에 접근 가능합니다.

### 3. ExternalSecret regex rewrite override

`goti-user-prod-gcp-secrets`의 `DATASOURCE_USERNAME`이 `goti_app`이 아니라 `goti_user_ro`로 저장되는 현상을 발견했습니다. 다른 ExternalSecret의 rewrite 규칙이 key를 가로채고 있었습니다.

해결책은 master 전용 `goti-db-master-cred` ExternalSecret을 별도로 만들고, 좁은 regex를 적용하는 것이었습니다.

```yaml
regex: "^goti-prod-server-DATASOURCE_(USERNAME|PASSWORD)$"
```

이렇게 하면 다른 ExternalSecret의 rewrite가 이 키를 건드리지 못합니다.

### 4. Istio Gateway 네임스페이스 차이

prod-gcp는 `istio-ingress` 네임스페이스를 쓰고, prod-aws는 `istio-system`을 씁니다. 첫 배포 시 실수로 GCP에서도 `istio-system`을 참조했고, 모든 요청이 404를 반환했습니다.

values.yaml의 `gatewayRef`를 환경별로 다르게 관리하는 것이 중요합니다.

### 5. Distroless 이미지라 kubectl exec 불가

메트릭 확인을 위해 `kubectl exec ... wget`으로 `/metrics`를 긁으려 했습니다. 하지만 load-observer는 distroless 이미지로 빌드되어 shell이나 wget이 없었습니다.

`kubectl port-forward`로 로컬에서 scrape하는 방식으로 우회했습니다.

---

## 📊 검증 로그 (2026-04-17 17:40 KST)

### Ingest 인증 검증

```bash
$ curl -X POST https://gcp-api.go-ti.shop/__worker-metrics/ingest \
    -H "x-metrics-token: ${TOKEN}" -d '{...valid payload...}'
HTTP 204

$ curl -X POST https://gcp-api.go-ti.shop/__worker-metrics/ingest \
    -H "x-metrics-token: WRONG" -d '{...}'
HTTP 401
```

정상 토큰은 204, 잘못된 토큰은 401을 반환합니다. 인증이 올바르게 걸려 있습니다.

### Pod 내부 /metrics 확인 (port-forward)

```
goti_worker_failover_total{from_cloud="gcp",reason="timeout",to_cloud="aws"} 1
goti_worker_ingest_errors_total{reason="auth"} 1
goti_worker_request_duration_seconds_count{routed_cloud="gcp"} 25
goti_worker_request_duration_seconds_count{routed_cloud="aws"} 1
```

`gcp=25`가 핵심 증거입니다. 이 숫자는 **실사용자 트래픽**이 CF Worker를 거쳐 GCP로 라우팅됐고, Worker가 그 결정을 GCP sink로 fanout했다는 것을 의미합니다. 배포가 end-to-end로 완전히 동작한다는 확신이 생겼습니다.

---

## 🔜 AWS 재기동 후 남은 작업

AWS 쪽은 ASG=0 상태로 대기 중입니다. 재기동 후 다음 순서로 진행하면 수 분 작업으로 완성됩니다.

1. `terraform apply` (prod-aws) — SSM에 `WORKER_INGEST_TOKEN` 저장
2. goti-load-observer AWS ECR 이미지 재빌드 + Goti-k8s prod values tag 업데이트
3. ArgoCD sync → AWS load-observer pod 기동 → AWS sink 수신 시작
4. AWS Grafana `d/goti-multi-cloud-failover` → GCP kill 시나리오 라이브 촬영

---

## 📚 배운 점

### 진실 소스를 잘못 고르면 관측이 거짓말을 한다

Origin 도달 메트릭이나 Cloudflare Zone 메트릭은 언뜻 쓸 만해 보입니다. 하지만 Multi-Cloud 라우팅의 진실은 **Worker의 라우팅 결정** 그 자체입니다.

중간 단계 메트릭을 쓰면 circuit open, timeout, fanout 실패 같은 중요한 케이스를 놓칩니다. 관측 대상이 무엇인지 처음부터 명확히 정의하고, 그 지점에서 직접 emit하는 것이 가장 정확합니다.

### 양쪽 cluster 동일 뷰는 fanout으로만 가능하다

GCP가 죽었을 때 GCP Grafana도 같이 죽는다면 관측 의미가 없습니다. Worker가 양쪽 sink로 fanout하면, GCP가 죽어도 AWS Grafana에서 GCP kill 상황을 그대로 볼 수 있습니다.

`ctx.waitUntil`과 `Promise.allSettled` 조합이 적합합니다. fire-and-forget이라 응답 지연이 없고, 한쪽 실패가 다른 쪽을 막지 않습니다.

### Analytics Engine의 1~2분 지연은 라이브에 부적합

Cloudflare Workers Analytics Engine은 편하지만 1~2분 지연이 있습니다. 라이브 데모에서는 이 지연이 치명적입니다. 수 초 내 반영이 필요하다면 커스텀 HTTP sink가 답입니다.

### Istio Gateway 네임스페이스는 환경별로 다를 수 있다

prod-gcp는 `istio-ingress`, prod-aws는 `istio-system`처럼 다를 수 있습니다. values.yaml을 환경별로 분리해 관리하고, 첫 배포 시에는 네임스페이스부터 확인해야 합니다. 이 실수 하나로 모든 요청이 404를 반환합니다.

### Distroless 이미지는 디버깅 방식을 바꾼다

distroless 이미지는 공격 표면을 줄여주지만, `kubectl exec`로 shell을 띄울 수 없습니다. 디버깅 도구는 `kubectl port-forward` + 로컬 curl로 대체하는 것이 표준 방식입니다.
