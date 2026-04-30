---
title: "5겹 장애: Kind 클러스터 모니터링 외부 접속 트러블슈팅"
excerpt: "CloudFront Origin 오설정부터 Istio Gateway selector 불일치, VirtualService host 오류, CLI 플랜 해제 사고까지 5가지 원인을 추적한 기록"
type: troubleshooting
category: cicd
tags:
  - go-ti
  - CloudFront
  - Istio
  - Gateway
  - Monitoring
  - Troubleshooting
  - DDNS
series:
  name: "goti-cloudfront-alb"
  order: 3
date: '2026-03-12'
---

## 한 줄 요약

> `kind.go-ti.shop/grafana/` 접속 불가. CloudFront Origin이 S3를 가리킴, Istio Gateway selector 불일치, VirtualService host 오류, CloudFront CLI로 플랜 해제 사고까지. 5개 원인을 하나씩 잡아냈습니다.

## Impact

- **영향 범위**: Kind 클러스터 모니터링 전체 (Grafana, Prometheus)
- **증상**: 외부에서 접속 불가 (내부는 정상)
- **소요 시간**: 약 3시간
- **발생일**: 2026-03-12

---

## 🔥 증상: 외부에서만 접속이 안 된다

`https://kind.go-ti.shop/grafana/` 접속 시 응답이 없었습니다.
Prometheus도 마찬가지로 접근이 불가능했습니다.

그런데 Kind 클러스터 내부에서는 모니터링 스택이 정상 동작 중이었습니다.
외부 → 내부 경로 어딘가에서 문제가 발생하고 있다는 뜻입니다.

이 글에서는 총 5가지 원인을 순서대로 추적합니다.

---

## 🤔 원인 1: CloudFront Origin이 S3를 가리킨다

### 발견

CloudFront 배포 E1QNU4QBSCAGP(`kind.go-ti.shop`)의 Origin을 확인했습니다.

Origin이 **S3 프론트엔드 버킷**(`goti-dev-front-s3.s3.ap-northeast-2.amazonaws.com`)으로 설정되어 있었습니다.

이것은 완전히 잘못된 설정입니다.
`kind.go-ti.shop`은 Kind PC의 Istio Gateway를 바라봐야 합니다.

### 추정 원인

CloudFront 배포를 새로 만들 때 기존 `dev.go-ti.shop` 배포를 복제했는데, **Origin을 변경하지 않은 것**으로 추정됩니다.
복제 후 Origin 교체를 깜빡한 전형적인 실수입니다.

### 추가 문제

Origin만 잘못된 게 아니었습니다:

| 항목 | 잘못된 설정 | 올바른 설정 |
|------|-----------|-----------|
| Cache Policy | CachingOptimized | CachingDisabled |
| Origin Request Policy | 없음 | AllViewer |
| HTTP Methods | GET, HEAD | 전체 7개 (POST 포함) |

Grafana는 **동적 콘텐츠**라서 캐싱하면 안 됩니다.
로그인 등 POST 요청도 필요하고, Host 헤더도 Origin으로 전달되어야 합니다.

CachingOptimized는 S3 같은 정적 콘텐츠용 정책입니다.
`dev.go-ti.shop`에서 복제하면서 이 설정까지 그대로 가져온 것입니다.

---

## 🤔 원인 2: Istio Gateway Selector 불일치

### 발견

CloudFront Origin을 수정해도 여전히 접속이 안 되었습니다.
다음 레이어인 Istio를 확인했습니다.

Gateway 리소스를 보니:

```yaml
# Goti-k8s/environments/dev/monitoring/monitoring-gateway.yaml
selector:
  istio: ingressgateway  # 이 레이블의 Pod를 찾음
```

그런데 실제 Istio ingress Pod의 레이블은:

```yaml
istio: gateway  # 실제 레이블
```

`ingressgateway`와 `gateway`는 다른 값입니다.
Gateway가 Istio ingress Pod를 찾지 못해서 **라우팅이 아예 동작하지 않았습니다**.

### 해결

```yaml
# Before
selector:
  istio: ingressgateway

# After
selector:
  istio: gateway
```

Istio Gateway selector는 반드시 실제 Pod 레이블과 매칭해야 합니다.
`kubectl get pod -n istio-system --show-labels`로 확인하는 습관이 필요합니다.

---

## 🤔 원인 3: 동적 IP 대응 — DDNS 사용

Kind PC의 공인 IP(`118.38.182.85`)는 ISP에 의해 언제든 변경될 수 있습니다.
CloudFront Origin에 IP를 직접 입력하면, IP가 바뀔 때마다 수동으로 수정해야 합니다.

iptime 공유기의 DDNS 기능(`resshome.iptime.org`)을 사용하면 IP 변동에 자동 대응할 수 있습니다.
CloudFront Custom Origin에 IP 대신 DDNS 도메인을 설정했습니다.

---

## 🤔 원인 4: CloudFront CLI로 플랜 해제 사고

### 발견

CloudFront Origin을 수정하기 위해 CLI를 사용했습니다:

```bash
$ aws cloudfront update-distribution \
    --id E1QNU4QBSCAGP \
    --if-match <ETag> \
    --distribution-config file:///tmp/cf-kind-update.json
```

수정은 잘 되었는데, **예상치 못한 부작용**이 발생했습니다.

CloudFront의 **flat-rate Free 플랜 연결이 해제**되었습니다.
WAF Web ACL도 별도 과금 상태($5/ACL/월)로 전환되었습니다.

### 근본 원인

`aws cloudfront update-distribution`은 **부분 업데이트가 아닌 전체 교체(full replace)** API입니다.

원본 config에서 플랜 관련 속성이 누락된 채로 전체 DistributionConfig를 덮어씌웠습니다.
Origin만 바꾸고 싶었는데, 플랜 설정까지 날아간 것입니다.

이건 `kind.go-ti.shop`(E1QNU4QBSCAGP)뿐 아니라, 이후 comment 변경 시에도 같은 config를 재사용하면서 플랜 해제 상태가 유지되었습니다.

### 해결

AWS Console에서 수동으로 Free 플랜을 재연결했습니다:

1. AWS Console → CloudFront → Pricing plans
2. `kind.go-ti.shop`, `dev.go-ti.shop` 두 배포 모두 Free 플랜 재연결

**절대 `aws cloudfront update-distribution` CLI로 배포를 수정하지 말 것.**
전체 config 교체로 플랜/WAF 연결 해제 위험이 있습니다. 반드시 AWS 콘솔을 사용해야 합니다.

---

## 🤔 원인 5: VirtualService Destination Host 불일치 (503)

### 발견

CloudFront, Gateway를 모두 수정했는데, 이번에는 **503 Service Unavailable**이 반환되었습니다.

VirtualService 설정을 확인했습니다:

```yaml
# Before (잘못된 설정)
destination:
  host: kube-prometheus-stack-grafana.monitoring.svc.cluster.local
  host: kube-prometheus-stack-prometheus.monitoring.svc.cluster.local
```

실제 서비스명을 확인해보니:

```bash
$ kubectl get svc -n monitoring
NAME                                      TYPE        PORT(S)
kube-prometheus-stack-dev-grafana         ClusterIP   3000/TCP
kube-prometheus-stack-dev-prometheus      ClusterIP   9090/TCP
```

Helm release 이름에 `-dev-`가 포함되어 있습니다.
VirtualService의 destination host와 실제 서비스명이 일치하지 않아서, Istio가 upstream을 찾지 못하고 503을 반환한 것입니다.

### 해결

```yaml
# After (올바른 설정)
destination:
  host: kube-prometheus-stack-dev-grafana.monitoring.svc.cluster.local
  host: kube-prometheus-stack-dev-prometheus.monitoring.svc.cluster.local
```

VirtualService destination은 반드시 `kubectl get svc`로 실제 서비스명을 확인한 후 설정해야 합니다.
Helm release 이름이 서비스명에 포함되는 것을 기억해야 합니다.

---

## ✅ 최종 수정 사항 정리

### CloudFront 수정

| 항목 | Before | After |
|------|--------|-------|
| Origin | S3 (`goti-dev-front-s3`) | Custom Origin (`resshome.iptime.org:80`, HTTP) |
| Cache Policy | CachingOptimized | CachingDisabled |
| Origin Request Policy | 없음 | AllViewer (Host 등 헤더 전달) |
| HTTP Methods | GET, HEAD | 전체 7개 (POST 포함) |

### Istio 리소스 수정

파일: `Goti-k8s/environments/dev/monitoring/monitoring-gateway.yaml`

- Gateway selector: `istio: ingressgateway` → `istio: gateway`
- VirtualService Grafana host: `kube-prometheus-stack-grafana` → `kube-prometheus-stack-dev-grafana`
- VirtualService Prometheus host: `kube-prometheus-stack-prometheus` → `kube-prometheus-stack-dev-prometheus`

### CloudFront Free 플랜 재연결

AWS Console에서 `kind.go-ti.shop`, `dev.go-ti.shop` 두 배포 모두 재연결.

---

## 📚 배운 점

이번 트러블슈팅에서 5가지 교훈을 얻었습니다.

### 1. CloudFront 배포 복제 시 Origin 반드시 확인

기존 배포에서 복제하면 Origin, Cache Policy, HTTP Methods가 그대로 복사됩니다.
복제 후 **모든 설정을 하나하나 검토**해야 합니다.

### 2. Istio Gateway selector는 실제 Pod 레이블과 매칭 확인

Gateway YAML을 작성할 때 기억에 의존하면 안 됩니다:

```bash
$ kubectl get pod -n istio-system --show-labels
```

이 명령으로 실제 레이블을 확인한 후 설정하는 것이 확실합니다.

### 3. 동적 IP 환경에서는 DDNS 사용

CloudFront Custom Origin에 IP를 직접 입력하면 IP 변경 시마다 수동 수정이 필요합니다.
DDNS 도메인을 사용하면 자동으로 대응할 수 있습니다.

### 4. CloudFront CLI update-distribution 사용 금지

`update-distribution`은 전체 config 교체 API입니다.
플랜, WAF 등 의도치 않은 설정이 날아갈 수 있습니다.
**반드시 AWS 콘솔에서 수정**해야 합니다.

### 5. Helm release 이름이 서비스명에 포함된다

`helm install my-release prometheus-stack`으로 설치하면 서비스명에 `my-release`가 포함됩니다.
VirtualService, Ingress 등에서 참조할 때 `kubectl get svc`로 실제 이름을 확인해야 합니다.

---

## 요약

| 순서 | 원인 | 증상 | 해결 |
|------|------|------|------|
| 1 | CloudFront Origin이 S3 | 응답 없음 | Custom Origin(DDNS)으로 변경 |
| 2 | Gateway selector 불일치 | 라우팅 안 됨 | `istio: gateway`로 수정 |
| 3 | 동적 IP | IP 변경 시 장애 | DDNS 도메인 사용 |
| 4 | CLI로 플랜 해제 | 과금 발생 | 콘솔에서 재연결 |
| 5 | VirtualService host 불일치 | 503 에러 | 실제 서비스명으로 수정 |
