# Production EKS 트러블슈팅 가이드 - 2

> 이 문서는 Production EKS 환경에서 발생한 문제들과 해결 방법을 기록합니다.
> TROUBLESHOOTING-PROD.md의 연속 문서입니다.

---

## 2025-12-29: Istio Gateway API 마이그레이션 및 HTTPS 설정

### 배경

Production 환경에서 모니터링 URL들이 접근 불가능한 상태 발생.
Istio Ambient 모드 (v1.28.2)에서 Ingress Gateway 설정 문제.

### 증상

```
- Grafana, Prometheus, Kiali 등 모니터링 URL 접근 불가
- Istio Ingress Gateway Deployment: 0/1 replicas
- LoadBalancer EXTERNAL-IP: pending
```

### 근본 원인

1. Istio Gateway Helm chart (`istio/gateway`)가 Ambient 모드에서 스키마 오류 발생
2. AWS Load Balancer Controller 미설치
3. 기존 아키텍처가 Istio Ambient 모드 권장 패턴과 불일치

### 해결: Kubernetes Gateway API 마이그레이션

#### 아키텍처 변경

```
[이전 - 문제]
Route53 → ALB (Terraform) → Istio Gateway (Helm) → Services
                              ↓
                      스키마 오류로 실패

[이후 - 해결]
Route53 → NLB (Gateway API 자동 생성) → Kubernetes Gateway → HTTPRoute → Services
                     ↓
              AWS LB Controller가 자동 관리
```

#### 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `k8s/helm/environments/prod.yaml` | `k8sGateway` 설정 추가, NLB annotations |
| `k8s/helm/charts/istio-config/templates/k8s-gateway.yaml` | `nlbTermination` 플래그 추가 |
| `terraform/prod/argocd-apps/argocd-bootstrap.tf` | Gateway API 리소스 whitelist 추가 |
| `terraform/prod/argocd-apps/cluster-addons.tf` | istio-ingressgateway ArgoCD 앱 비활성화 |
| `terraform/prod/compute/pod-identity.tf` | ALB Controller IAM 권한 추가 |

---

## 2025-12-29: AWS LB Controller Security Group 권한 오류

### 증상

```
Port 80: 연결 성공
Port 443: Connection timed out
```

### 로그

```json
{
  "level": "error",
  "logger": "backend-sg-provider",
  "msg": "Failed to auto-create backend SG",
  "error": "UnauthorizedOperation: ec2:CreateSecurityGroup action not allowed"
}
```

### 원인

AWS Load Balancer Controller의 Pod Identity IAM 역할에 Security Group 관리 권한 누락.

```hcl
# 문제의 코드 (pod-identity.tf)
# EC2 Describe 권한만 있고 CreateSecurityGroup 없음
Action = [
  "ec2:DescribeSecurityGroups",
  "ec2:DescribeSubnets",
  ...
]
```

### 해결

`terraform/prod/compute/pod-identity.tf`에 권한 추가:

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

### 적용 명령

```bash
cd terraform/prod/compute
terraform apply -target=module.pod_identity_alb_controller

# Pod 재시작
kubectl rollout restart deployment/aws-load-balancer-controller -n kube-system
```

---

## 2025-12-29: NLB 재생성으로 인한 Route53 DNS 불일치

### 증상

IAM 권한 수정 후 HTTPS 여전히 timeout.

### 원인

AWS LB Controller가 권한 획득 후 새 NLB 생성 → DNS 주소 변경:

```
이전 NLB: aceab3fa3a53a4313ae5b27717b81723-*.elb.ap-northeast-2.amazonaws.com
새 NLB:   k8s-istiosys-istioing-01c13bb6f1-*.elb.ap-northeast-2.amazonaws.com
```

Route53는 이전 NLB를 가리키고 있어 연결 실패.

### 해결

Route53 A 레코드 수동 업데이트:

```bash
# 새 NLB DNS 확인
kubectl get svc -n istio-system istio-ingressgateway-istio \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'

# Route53 업데이트
aws route53 change-resource-record-sets \
  --hosted-zone-id Z0954990337NMPX3FY1D6 \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.wealist.co.kr",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "ZWKZPGTI48KDX",
          "DNSName": "<새-NLB-DNS>",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

### 예방책

ExternalDNS 설치하여 자동 DNS 업데이트 권장:
- Gateway에 annotation 추가: `external-dns.alpha.kubernetes.io/hostname`
- ExternalDNS가 NLB 변경 시 Route53 자동 업데이트

---

## 2025-12-29: HTTPS/TLS 설정 (NLB + ACM)

### 요구사항

api.wealist.co.kr에 HTTPS 적용 (ACM 인증서 사용)

### 아키텍처

```
Client → HTTPS (443) → NLB (TLS Termination) → HTTP (443) → Gateway → Services
                         ↓
                    ACM 인증서로 TLS 처리
```

### 설정

#### prod.yaml

```yaml
k8sGateway:
  enabled: true
  infrastructure:
    annotations:
      # NLB 기본 설정
      service.beta.kubernetes.io/aws-load-balancer-type: "external"
      service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
      service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
      # TLS 설정
      service.beta.kubernetes.io/aws-load-balancer-ssl-cert: "arn:aws:acm:..."
      service.beta.kubernetes.io/aws-load-balancer-ssl-ports: "443"
      service.beta.kubernetes.io/aws-load-balancer-ssl-negotiation-policy: "ELBSecurityPolicy-TLS13-1-2-2021-06"
  listeners:
    http:
      port: 80
    https:
      enabled: true
      port: 443
      nlbTermination: true  # NLB에서 TLS 처리, Gateway는 HTTP 수신
```

#### k8s-gateway.yaml 템플릿

```yaml
{{- if .Values.istio.k8sGateway.listeners.https.nlbTermination }}
# NLB TLS termination: NLB handles TLS, Gateway receives HTTP
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
```

### 검증

```bash
# HTTPS 연결 테스트
curl -I https://api.wealist.co.kr/svc/user/health/live

# 예상 응답
HTTP/1.1 200 OK
server: istio-envoy
```

---

## 2025-12-29: ConfigMap 변경 시 Pod 자동 재시작 안됨

### 증상

```
- ArgoCD에서 Synced 상태로 표시
- ConfigMap은 업데이트됨
- 하지만 Pod는 여전히 이전 환경변수로 실행 중
- 수동으로 kubectl rollout restart 해야만 새 설정 적용
```

### 예시

```bash
# S3_BUCKET 변경 후
kubectl get cm storage-service-config -o jsonpath='{.data.S3_BUCKET}'
# 출력: wealist-prod-files-290008131187 (새 값)

kubectl exec deploy/storage-service -- env | grep S3_BUCKET
# 출력: wealist-prod-storage (이전 값 - Pod 재시작 안됨!)
```

### 근본 원인

Kubernetes는 ConfigMap이 변경되어도 **기존 Pod를 자동으로 재시작하지 않음**.

ArgoCD 관점:
1. ConfigMap 업데이트 ✅
2. Deployment spec 변경 없음 (image, replicas 등 동일)
3. "Synced" 상태로 표시 ✅
4. Pod는 재시작되지 않음 ❌

### 해결: ConfigMap Checksum Annotation

Deployment의 pod template에 ConfigMap 내용의 해시값을 annotation으로 추가.
ConfigMap 변경 → 해시값 변경 → pod template 변경 → rolling update 트리거.

#### 1. Helper 함수 추가 (`wealist-common/templates/_helpers.tpl`)

```yaml
{{/*
ConfigMap checksum for triggering pod restart on config change
*/}}
{{- define "wealist-common.configChecksum" -}}
{{- $sharedConfig := .Values.shared.config | default dict | toJson -}}
{{- $serviceConfig := .Values.config | default dict | toJson -}}
{{- printf "%s-%s" $sharedConfig $serviceConfig | sha256sum | trunc 16 -}}
{{- end }}
```

#### 2. Deployment 템플릿에 annotation 추가

```yaml
# 각 서비스의 templates/deployment.yaml
template:
  metadata:
    annotations:
      checksum/config: {{ include "wealist-common.configChecksum" . }}
```

### 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `k8s/helm/charts/wealist-common/templates/_helpers.tpl` | `configChecksum` helper 추가 |
| `k8s/helm/charts/*/templates/deployment.yaml` | 6개 Go 서비스에 annotation 추가 |

### 적용 후 동작

| 변경 유형 | 재시작 범위 |
|----------|------------|
| 서비스 이미지 변경 | 해당 서비스만 |
| `shared.config` 변경 (DB_AUTO_MIGRATE 등) | 모든 Go 서비스 |
| 서비스별 `config` 변경 | 해당 서비스만 |

### 검증

```bash
# Helm 템플릿에서 checksum 확인
helm template storage-service k8s/helm/charts/storage-service \
  -f k8s/helm/environments/base.yaml \
  -f k8s/helm/environments/prod.yaml | grep "checksum/config"

# 예상 출력
# checksum/config: cbc34bf242def090
```

---

## 핵심 교훈

1. **Istio Ambient 모드에서는 Kubernetes Gateway API 사용**
   - `istio/gateway` Helm chart 대신 Gateway API 리소스 직접 생성
   - Istio가 자동으로 Deployment/Service 프로비저닝

2. **AWS LB Controller IAM 권한 충분히 부여**
   - Security Group 생성/수정 권한 필수
   - NLB 재생성 시 DNS 업데이트 필요

3. **NLB + ACM 조합이 간단**
   - NLB에서 TLS Termination
   - Gateway는 HTTP로 트래픽 수신
   - cert-manager 불필요

4. **ExternalDNS 설치 권장**
   - NLB 변경 시 Route53 자동 업데이트
   - 수동 DNS 관리 부담 제거

5. **ConfigMap 변경 시 Pod 자동 재시작 필요**
   - Kubernetes는 ConfigMap 변경 시 Pod 자동 재시작 안함
   - Deployment에 `checksum/config` annotation 추가로 해결
   - ArgoCD "Synced" 상태여도 Pod는 이전 설정으로 실행될 수 있음
