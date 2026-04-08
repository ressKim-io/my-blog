---
title: "Istio Ambient 모드 실전기 (2): HTTPS 붙이기까지 3번의 삽질"
excerpt: "Gateway API 마이그레이션부터 NLB + ACM 설정까지, HTTPS를 붙이기 위한 여정"
category: istio
tags:
  - EKS
  - Troubleshooting
  - Istio
  - Gateway-API
  - AWS-NLB
  - ACM
  - HTTPS
series:
  name: "eks-troubleshooting"
  order: 3
date: '2025-12-29'
---

## 🎯 한 줄 요약

> HTTPS를 붙이려다 3번 삽질했습니다. Gateway API 마이그레이션, IAM 권한 부족, DNS 불일치를 거쳐 NLB + ACM으로 해결.

## 📊 Impact

- **영향 범위**: HTTPS 접속 불가
- **소요 시간**: 약 5시간
- **발생일**: 2025-12-29

---

## 💡 배경: 왜 Gateway API로 마이그레이션했나?

기존에는 `istio/gateway` Helm chart로 Ingress Gateway를 설치하려 했습니다. 그런데 Ambient 모드에서 스키마 오류가 발생했습니다:

```bash
$ helm install istio-ingress istio/gateway -n istio-system
Error: values don't meet the specifications of the schema
```

Istio Ambient 모드 + `istio/gateway` Helm chart 조합이 잘 맞지 않았습니다.

**해결책**: Kubernetes Gateway API를 직접 사용하기로 했습니다. Istio가 Gateway API 리소스를 보고 자동으로 Deployment/Service를 프로비저닝합니다.

```
[이전 - 문제]
Route53 → ALB (Terraform) → Istio Gateway (Helm) → Services
                              ↓
                      스키마 오류로 실패

[이후 - 해결]
Route53 → NLB (Gateway API) → Kubernetes Gateway → HTTPRoute → Services
                ↓
         AWS LB Controller가 자동 생성
```

---

## 🔥 1. Gateway API로 마이그레이션

### 기존 설정

```yaml
# 기존 Istio Gateway (작동 안 함)
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: wealist-gateway
spec:
  selector:
    istio: ingressgateway
  servers:
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - "api.wealist.co.kr"
```

### Gateway API로 변경

```yaml
# Kubernetes Gateway API
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: wealist-gateway
  namespace: istio-system
  annotations:
    # AWS NLB 자동 생성
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
spec:
  gatewayClassName: istio
  listeners:
    - name: http
      port: 80
      protocol: HTTP
      allowedRoutes:
        namespaces:
          from: All
```

### Helm 템플릿으로 관리

```yaml
# k8s/helm/charts/istio-config/templates/k8s-gateway.yaml
{{- if .Values.istio.k8sGateway.enabled }}
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: {{ .Values.istio.k8sGateway.name }}
  namespace: istio-system
  {{- with .Values.istio.k8sGateway.infrastructure.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  gatewayClassName: istio
  listeners:
    - name: http
      port: {{ .Values.istio.k8sGateway.listeners.http.port }}
      protocol: HTTP
      allowedRoutes:
        namespaces:
          from: All
{{- end }}
```

### prod.yaml 설정

```yaml
# k8s/helm/environments/prod.yaml
istio:
  k8sGateway:
    enabled: true
    name: wealist-gateway
    infrastructure:
      annotations:
        service.beta.kubernetes.io/aws-load-balancer-type: "external"
        service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
        service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
    listeners:
      http:
        port: 80
```

### 결과

```bash
$ kubectl get gateway -n istio-system
NAME              CLASS   ADDRESS   PROGRAMMED   AGE
wealist-gateway   istio             True         1m

$ kubectl get svc -n istio-system | grep gateway
wealist-gateway-istio   LoadBalancer   ...   80:31xxx/TCP
```

Istio가 Gateway 리소스를 보고 자동으로 Service를 생성했습니다!

### 핵심 포인트

- **Gateway API는 Istio와 잘 통합된다** - gatewayClassName: istio
- **AWS annotations을 Gateway에 직접 붙일 수 있다**
- **Helm으로 환경별 설정을 관리할 수 있다**

---

## 🔥 2. Port 80은 되는데 443은 안 된다

### 증상

HTTP는 됩니다:

```bash
$ curl http://api.wealist.co.kr/svc/user/health
{"status":"UP"}
```

HTTPS를 추가하려고 ACM 인증서를 설정했습니다:

```yaml
annotations:
  service.beta.kubernetes.io/aws-load-balancer-ssl-cert: "arn:aws:acm:..."
  service.beta.kubernetes.io/aws-load-balancer-ssl-ports: "443"
```

그런데 HTTPS가 안 됩니다:

```bash
$ curl https://api.wealist.co.kr/svc/user/health
curl: (28) Connection timed out
```

### 원인 분석

AWS Load Balancer Controller 로그를 확인했습니다:

```bash
$ kubectl logs -n kube-system deploy/aws-load-balancer-controller | grep -i error

{
  "level": "error",
  "logger": "backend-sg-provider",
  "msg": "Failed to auto-create backend SG",
  "error": "UnauthorizedOperation: ec2:CreateSecurityGroup action not allowed"
}
```

`ec2:CreateSecurityGroup` 권한이 없습니다!

AWS LB Controller의 Pod Identity IAM 역할을 확인해봤습니다:

```hcl
# 기존 권한 (문제)
Action = [
  "ec2:DescribeSecurityGroups",
  "ec2:DescribeSubnets",
  ...
  # CreateSecurityGroup이 없다!
]
```

### 해결

`terraform/prod/compute/pod-identity.tf`에 Security Group 관련 권한 추가:

```hcl
{
  Sid    = "ALBControllerEC2SecurityGroup"
  Effect = "Allow"
  Action = [
    "ec2:CreateSecurityGroup",
    "ec2:DeleteSecurityGroup",
    "ec2:AuthorizeSecurityGroupIngress",
    "ec2:RevokeSecurityGroupIngress",
    "ec2:CreateTags"
  ]
  Resource = "*"
}
```

```bash
$ cd terraform/prod/compute
$ terraform apply -target=module.pod_identity_alb_controller

$ kubectl rollout restart deployment/aws-load-balancer-controller -n kube-system
```

### 핵심 포인트

- **AWS LB Controller는 NLB용 Security Group을 자동 생성한다**
- **IAM 권한이 부족하면 조용히 실패한다** - 로그를 꼭 확인해야 한다
- **Terraform으로 IAM 관리 시 필요한 권한을 미리 파악해야 한다**

---

## 🔥 3. IAM 권한 수정 후에도 HTTPS 타임아웃

### 증상

IAM 권한을 추가했는데 여전히 HTTPS가 안 됩니다:

```bash
$ curl https://api.wealist.co.kr/svc/user/health
curl: (28) Connection timed out
```

### 원인 분석

NLB DNS를 직접 확인해봤습니다:

```bash
# 현재 Route53이 가리키는 NLB
$ dig api.wealist.co.kr
api.wealist.co.kr.  300  IN  A  52.xxx.xxx.xxx

# AWS가 가리키는 IP
$ nslookup aceab3fa3a53a4313ae5b27717b81723-xxx.elb.amazonaws.com
52.xxx.xxx.xxx  # ← 다른 IP!
```

Route53과 실제 NLB의 IP가 다릅니다.

```bash
# 현재 NLB 확인
$ kubectl get svc -n istio-system wealist-gateway-istio -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
k8s-istiosys-istioing-01c13bb6f1-xxx.elb.amazonaws.com  # ← 새 NLB!
```

**NLB가 재생성됐습니다!**

IAM 권한이 생기고 나서 AWS LB Controller가 새 NLB를 만들었는데, Route53은 여전히 이전 NLB를 가리키고 있었습니다.

```
이전 NLB: aceab3fa3a53a4313ae5b27717b81723-*
새 NLB:   k8s-istiosys-istioing-01c13bb6f1-*
          ↑
Route53이 이전 NLB를 가리키고 있음 → 타임아웃
```

### 해결

Route53 A 레코드를 새 NLB로 업데이트:

```bash
# 새 NLB DNS 확인
$ NLB_DNS=$(kubectl get svc -n istio-system wealist-gateway-istio \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
$ echo $NLB_DNS

# Route53 업데이트
$ aws route53 change-resource-record-sets \
  --hosted-zone-id Z0954990337NMPX3FY1D6 \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.wealist.co.kr",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "ZWKZPGTI48KDX",
          "DNSName": "'$NLB_DNS'",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

### 예방책: ExternalDNS

수동으로 DNS 업데이트하는 건 너무 위험합니다. ExternalDNS를 설치하면 자동화할 수 있습니다:

```yaml
# Gateway에 annotation 추가
metadata:
  annotations:
    external-dns.alpha.kubernetes.io/hostname: api.wealist.co.kr
```

ExternalDNS가 NLB 변경을 감지하고 Route53을 자동 업데이트합니다.

### 핵심 포인트

- **NLB가 재생성되면 DNS가 바뀐다**
- **Route53을 수동 관리하면 이런 사고가 발생한다**
- **ExternalDNS로 자동화하는 것을 강력 권장**

---

## 🔥 4. HTTPS/TLS 설정 (NLB + ACM)

### 최종 아키텍처

```
Client → HTTPS (443) → NLB (TLS Termination) → HTTP (80) → Gateway → Services
                         ↓
                    ACM 인증서로 TLS 처리
```

NLB에서 TLS를 종료하고, Gateway는 plain HTTP로 트래픽을 받습니다.

### 설정

```yaml
# k8s/helm/environments/prod.yaml
istio:
  k8sGateway:
    enabled: true
    name: wealist-gateway
    infrastructure:
      annotations:
        # NLB 기본 설정
        service.beta.kubernetes.io/aws-load-balancer-type: "external"
        service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
        service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
        # TLS 설정
        service.beta.kubernetes.io/aws-load-balancer-ssl-cert: "arn:aws:acm:ap-northeast-2:xxx:certificate/xxx"
        service.beta.kubernetes.io/aws-load-balancer-ssl-ports: "443"
        service.beta.kubernetes.io/aws-load-balancer-ssl-negotiation-policy: "ELBSecurityPolicy-TLS13-1-2-2021-06"
    listeners:
      http:
        port: 80
      https:
        enabled: true
        port: 443
        nlbTermination: true  # NLB에서 TLS 처리
```

### Gateway 템플릿 수정

```yaml
# k8s/helm/charts/istio-config/templates/k8s-gateway.yaml
spec:
  listeners:
    - name: http
      port: 80
      protocol: HTTP
    {{- if .Values.istio.k8sGateway.listeners.https.enabled }}
    - name: https
      port: 443
      {{- if .Values.istio.k8sGateway.listeners.https.nlbTermination }}
      # NLB TLS termination: NLB가 TLS 처리, Gateway는 HTTP 수신
      protocol: HTTP
      {{- else }}
      # Gateway TLS termination
      protocol: HTTPS
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: {{ .Values.istio.k8sGateway.listeners.https.certificateRef }}
      {{- end }}
      allowedRoutes:
        namespaces:
          from: All
    {{- end }}
```

### 왜 NLB TLS Termination을 선택했나?

| 방식 | 장점 | 단점 |
|------|------|------|
| **NLB TLS Termination** | cert-manager 불필요, ACM 자동 갱신 | NLB→Gateway 구간은 평문 |
| Gateway TLS Termination | E2E 암호화 | cert-manager 필요, 인증서 관리 |

VPC 내부 통신은 암호화가 필수는 아니라고 판단해서 NLB TLS Termination을 선택했습니다.

### 검증

```bash
$ curl -I https://api.wealist.co.kr/svc/user/health
HTTP/1.1 200 OK
server: istio-envoy
```

드디어 HTTPS가 동작합니다!

### 핵심 포인트

- **NLB + ACM 조합이 가장 간단하다** - cert-manager 설치 불필요
- **nlbTermination 플래그로 Gateway 설정을 분기할 수 있다**
- **VPC 내부 통신의 암호화 필요성은 요구사항에 따라 결정**

---

## 📚 종합 정리

### 3번의 삽질 요약

| 순서 | 문제 | 원인 | 해결 |
|------|------|------|------|
| 1차 | Gateway API 마이그레이션 | istio/gateway 스키마 오류 | Gateway API 직접 사용 |
| 2차 | 443 타임아웃 | IAM 권한 부족 | Security Group 권한 추가 |
| 3차 | 여전히 타임아웃 | NLB 재생성 → DNS 불일치 | Route53 수동 업데이트 |

### 최종 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   Route53        │
                    │ api.wealist.co.kr│
                    └────────┬─────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │         AWS NLB              │
              │  ┌────────────────────────┐  │
              │  │  TLS Termination       │  │
              │  │  (ACM Certificate)     │  │
              │  └────────────────────────┘  │
              │     443 (HTTPS) → 80 (HTTP)  │
              └──────────────┬───────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │     Kubernetes Gateway       │
              │     (wealist-gateway)        │
              │     protocol: HTTP           │
              └──────────────┬───────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │         HTTPRoute            │
              │  /svc/user → user-service    │
              │  /svc/board → board-service  │
              └──────────────┬───────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │    Services    │
                    └────────────────┘
```

### 이 날 배운 것들

1. **Gateway API는 Istio Ambient와 잘 맞는다**
2. **AWS LB Controller IAM 권한을 충분히 줘야 한다**
3. **NLB 재생성 시 DNS 업데이트가 필수** - ExternalDNS 권장
4. **NLB + ACM이 가장 간단한 HTTPS 설정 방법**

---

## 🤔 스스로에게 던지는 질문

### 1. Gateway TLS vs NLB TLS Termination, 언제 뭘 선택할까?

**NLB TLS Termination 선택:**
- ACM 인증서 사용 가능
- cert-manager 설치 부담 없음
- VPC 내부 통신 암호화가 필수가 아닐 때

**Gateway TLS Termination 선택:**
- E2E 암호화 필수
- 커스텀 인증서 사용
- 규정 준수 (HIPAA, PCI-DSS 등)

### 2. ExternalDNS 없이 DNS 관리하면 어떤 문제가 생길까?

- NLB 재생성 시 DNS 불일치 → 서비스 다운
- 수동 업데이트 필요 → 휴먼 에러
- 야간/주말 장애 시 대응 지연

**권장**: ExternalDNS + annotation으로 자동화

### 3. IAM 권한 부족을 사전에 발견하려면?

```bash
# AWS LB Controller 로그 모니터링
kubectl logs -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller -f

# 주요 에러 패턴
grep -E "UnauthorizedOperation|AccessDenied|Forbidden"
```

**권장**: CloudWatch Logs + 알람 설정

### 4. NLB가 예상치 않게 재생성되는 경우는?

- Service annotation 변경
- Gateway 재생성
- AWS LB Controller 재시작 (권한 변경 후)
- Kubernetes 버전 업그레이드

**권장**: NLB 생성 이벤트 모니터링 + ExternalDNS

---

## 🔗 다음 편 예고

다음 편에서는 **External Secrets Operator**에서 겪은 함정들을 다룹니다:
- apiVersion v1은 존재하지 않는다
- .gitignore가 external-secrets.yaml도 무시한다
- ESO 업그레이드 후 CRD Webhook 오류
- ArgoCD OutOfSync - 기본값 필드 문제

시크릿 관리 자동화의 어두운 면을 공유하겠습니다.

---

## 🔗 참고

- [Kubernetes Gateway API](https://gateway-api.sigs.k8s.io/)
- [Istio Gateway API Support](https://istio.io/latest/docs/tasks/traffic-management/ingress/gateway-api/)
- [AWS Load Balancer Controller - NLB](https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.5/guide/service/nlb/)
- [ExternalDNS](https://github.com/kubernetes-sigs/external-dns)
