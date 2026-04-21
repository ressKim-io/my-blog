---
date: 2026-03-12
type: troubleshoot
tags: [cloudfront, istio, gateway, monitoring]
---

# [TROUBLE] kind.go-ti.shop 모니터링 외부 접속 불가

## 증상
- `https://kind.go-ti.shop/grafana/` 접속 시 응답 없음 (Grafana, Prometheus 모두 접근 불가)
- Kind 클러스터 내부에서는 모니터링 스택 정상 동작 중

## 원인 분석

### 원인 1: CloudFront Origin 잘못 설정
- **발견**: CloudFront 배포 E1QNU4QBSCAGP (`kind.go-ti.shop`) 의 Origin이 **S3 프론트엔드 버킷** (`goti-dev-front-s3.s3.ap-northeast-2.amazonaws.com`)으로 설정되어 있었음
- **올바른 설정**: Kind PC의 Istio Gateway NodePort (31080)를 바라봐야 함
- **추정 원인**: CloudFront 생성 시 기존 `dev.go-ti.shop` 배포를 복제하면서 Origin을 변경하지 않음
- **추가 문제**: Cache Policy가 `CachingOptimized`로 설정 — Grafana는 동적 콘텐츠이므로 `CachingDisabled` 필요, HTTP Methods도 GET/HEAD만 허용 — POST (로그인 등) 불가

### 원인 2: Istio Gateway selector 불일치
- **발견**: Gateway 리소스의 selector가 `istio: ingressgateway`로 설정
- **실제 Pod 레이블**: `istio: gateway`
- **결과**: Gateway가 Istio ingress Pod를 찾지 못해 라우팅이 아예 동작하지 않음
- **파일**: `Goti-k8s/environments/dev/monitoring/monitoring-gateway.yaml`

### 원인 3 (예방): 동적 IP 대신 DDNS 사용
- Kind PC의 공인 IP (118.38.182.85)는 ISP에 의해 변경될 수 있음
- iptime 공유기 DDNS (`resshome.iptime.org`)를 사용하면 IP 변동에 자동 대응

## 해결

### CloudFront 수정 (AWS CLI)
```bash
aws cloudfront update-distribution --id E1QNU4QBSCAGP --if-match <ETag> --distribution-config file:///tmp/cf-kind-update.json
```

변경 사항:
| 항목 | Before | After |
|------|--------|-------|
| Origin | S3 (`goti-dev-front-s3`) | Custom Origin (`resshome.iptime.org:31080`, HTTP) |
| Cache Policy | CachingOptimized | **CachingDisabled** |
| Origin Request Policy | 없음 | **AllViewer** (Host 등 헤더 전달) |
| HTTP Methods | GET, HEAD | **전체 7개** (POST 포함) |
| Comment | (없음) | Kind PC Istio Gateway - monitoring access |

### Gateway selector 수정
```yaml
# Before
selector:
  istio: ingressgateway

# After
selector:
  istio: gateway
```

파일: `Goti-k8s/environments/dev/monitoring/monitoring-gateway.yaml`

## 검증
- [ ] CloudFront 배포 완료 (Status: Deployed)
- [ ] Kind PC 방화벽 31080 포트 외부 허용
- [ ] `https://kind.go-ti.shop/grafana/` 접속 확인
- [ ] `https://kind.go-ti.shop/prometheus/` 접속 확인

### 원인 4: CloudFront update-distribution CLI로 플랜 해제 사고
- **발견**: `aws cloudfront update-distribution`으로 Origin 변경 시, 전체 `DistributionConfig`를 교체하면서 **flat-rate Free 플랜 연결이 해제**됨
- **영향**: `kind.go-ti.shop` (E1QNU4QBSCAGP) 뿐 아니라, 이후 comment 변경 시에도 같은 config를 사용하여 플랜 해제 상태 유지
- **근본 원인**: `update-distribution`은 부분 업데이트가 아닌 **전체 교체(full replace)** API. 원본 config에서 플랜 관련 속성이 누락된 채 덮어씌워짐
- **WAF 비용 발생**: 플랜 해제로 WAF Web ACL이 별도 과금 ($5/ACL/월)

### 원인 5: VirtualService destination host 불일치 (503 에러)
- **발견**: VirtualService의 destination이 `kube-prometheus-stack-grafana`로 설정되었으나, 실제 서비스명은 `kube-prometheus-stack-dev-grafana` (Helm release에 `-dev-` 포함)
- **결과**: Istio가 upstream을 찾지 못해 503 Service Unavailable 반환
- **파일**: `Goti-k8s/environments/dev/monitoring/monitoring-gateway.yaml`

## 해결

### CloudFront 수정 (AWS CLI) — ⚠️ 플랜 해제 사고 유발
```bash
aws cloudfront update-distribution --id E1QNU4QBSCAGP --if-match <ETag> --distribution-config file:///tmp/cf-kind-update.json
```

변경 사항:
| 항목 | Before | After |
|------|--------|-------|
| Origin | S3 (`goti-dev-front-s3`) | Custom Origin (`resshome.iptime.org:80`, HTTP) |
| Cache Policy | CachingOptimized | **CachingDisabled** |
| Origin Request Policy | 없음 | **AllViewer** (Host 등 헤더 전달) |
| HTTP Methods | GET, HEAD | **전체 7개** (POST 포함) |
| Comment | (없음) | Kind PC Istio Gateway - all services |

**⚠️ 부작용**: 이 CLI 작업으로 CloudFront flat-rate Free 플랜 연결이 해제됨. 콘솔에서 수동 재연결 필요.

### Gateway selector 수정
```yaml
# Before
selector:
  istio: ingressgateway

# After
selector:
  istio: gateway
```

### VirtualService destination 수정
```yaml
# Before
host: kube-prometheus-stack-grafana.monitoring.svc.cluster.local
host: kube-prometheus-stack-prometheus.monitoring.svc.cluster.local

# After
host: kube-prometheus-stack-dev-grafana.monitoring.svc.cluster.local
host: kube-prometheus-stack-dev-prometheus.monitoring.svc.cluster.local
```

파일: `Goti-k8s/environments/dev/monitoring/monitoring-gateway.yaml`

### CloudFront Free 플랜 재연결 (콘솔)
1. AWS Console → CloudFront → Pricing plans
2. `kind.go-ti.shop`, `dev.go-ti.shop` 두 배포 모두 Free 플랜 재연결

## 검증
- [x] CloudFront 배포 완료 (Status: Deployed)
- [ ] CloudFront Free 플랜 재연결 확인
- [ ] Kind PC 방화벽/포트포워딩 확인
- [x] `https://kind.go-ti.shop/grafana/` 접속 확인
- [ ] `https://kind.go-ti.shop/prometheus/` 접속 확인

## 교훈
1. **CloudFront 배포 복제 시 Origin 반드시 확인** — 기존 배포에서 복제하면 Origin이 그대로 복사됨
2. **Istio Gateway selector는 실제 Pod 레이블과 반드시 매칭 확인** — `kubectl get pod -n istio-system --show-labels`로 검증
3. **동적 IP 환경에서는 DDNS 사용** — CloudFront Custom Origin에 IP 대신 DDNS 도메인 사용
4. **절대 `aws cloudfront update-distribution` CLI로 배포 수정하지 말 것** — 전체 config 교체로 플랜/WAF 연결 해제 위험. 반드시 AWS 콘솔 사용
5. **Helm release 이름이 서비스명에 포함됨** — VirtualService destination은 `kubectl get svc -n <ns>`로 실제 서비스명 확인 후 설정
