---
title: "Harbor ImagePull 403 — Cloudflare WAF가 containerd의 bottlerocket을 'bot'으로 차단"
excerpt: "EKS에서 Harbor 이미지 pull 시 403 Forbidden. Cloudflare WAF가 User-Agent의 bottlerocket을 봇으로 오탐했고, Route53 Private Hosted Zone이 Cloudflare를 우회하게 만들고 있었습니다."
category: kubernetes
tags:
  - go-ti
  - Multi-Cloud
  - Harbor
  - Cloudflare
  - WAF
  - ImagePull
  - troubleshooting
series:
  name: "goti-multicloud"
  order: 11
date: "2026-04-06"
---

## 한 줄 요약

> EKS에서 Harbor 이미지 pull 시 403 Forbidden이 발생했습니다. 원인은 두 가지였습니다. Cloudflare WAF가 `containerd/2.1.6+bottlerocket` User-Agent의 `bot` 문자열을 봇으로 오탐해 차단했고, Route53 Private Hosted Zone이 `harbor.go-ti.shop`을 Cloudflare가 아닌 EC2 origin IP로 resolve하고 있었습니다.

## Impact

- **영향 범위**: goti-queue-gate, goti-guardrail prod 배포
- **증상**: ImagePullBackOff (403 Forbidden → i/o timeout)
- **소요 시간**: 약 2시간
- **발생일**: 2026-04-06

---

## 🔥 문제: Harbor 이미지 pull이 계속 403

### 최초 상태

queue-gate CD prod가 성공적으로 완료되었습니다. Harbor push까지 정상적으로 끝났고, Goti-k8s PR이 머지되어 ArgoCD sync도 돌았습니다. 그런데 Pod이 올라오지 않았습니다.

```bash
$ kubectl get pods -n prod
goti-queue-gate-prod-6c8656fd6d-59dzz   1/2     ImagePullBackOff
goti-queue-gate-prod-6c8656fd6d-d5q72   1/2     ImagePullBackOff
```

### 1차 에러 — ECR 403

처음 발견한 에러는 ECR 403이었습니다.

```
Failed to pull image "707925622666.dkr.ecr.ap-northeast-2.amazonaws.com/prod/goti-queue-gate:init-0000000":
  failed to resolve image: unexpected status from HEAD request: 403 Forbidden
```

ECR에 `prod/goti-queue-gate` 레포 자체가 존재하지 않았습니다. Harbor → ECR replication이 미설정 상태였습니다.

### ECR 대신 Harbor 직접 pull로 변경

replication을 당장 설정하는 것보다 Harbor에서 직접 pull하도록 바꾸는 쪽이 빨랐습니다. `values-aws.yaml`을 수정했습니다.

```yaml
# Before (ECR)
image:
  repository: "707925622666.dkr.ecr.ap-northeast-2.amazonaws.com/prod/goti-queue-gate"
imagePullSecrets:
  - name: ecr-creds

# After (Harbor)
image:
  repository: "harbor.go-ti.shop/prod/goti-queue-gate"
imagePullSecrets:
  - name: harbor-creds
```

### 2차 에러 — Harbor도 403

그런데 Harbor로 바꾸니 또 403이 떴습니다.

```
Failed to pull image "harbor.go-ti.shop/prod/goti-queue-gate:prod-3-8add224":
  unexpected status from HEAD request to https://harbor.go-ti.shop/v2/prod/goti-queue-gate/manifests/prod-3-8add224: 403 Forbidden
```

---

## 🤔 진단 과정: "curl은 되는데 kubelet만 실패한다"

### Harbor 이미지 존재 여부 확인

먼저 이미지가 실제로 Harbor에 올라갔는지 확인했습니다.

```bash
$ curl -u "robot$prod+goti-cicd:..." "https://harbor.go-ti.shop/v2/prod/goti-queue-gate/tags/list"
{"name":"prod/goti-queue-gate","tags":["prod-1-3ed22dc","prod-2-3ed22dc","prod-3-8add224"]}
```

이미지는 정상적으로 존재했습니다.

### curl HEAD/GET 테스트

로컬에서 직접 manifest를 조회해봤습니다.

```bash
# HEAD — 200 OK
$ curl -s -o /dev/null -w "%{http_code}" -X HEAD -u "robot$..." \
  "https://harbor.go-ti.shop/v2/prod/goti-queue-gate/manifests/prod-3-8add224"
200

# GET — 200 OK
$ curl -s -o /dev/null -w "%{http_code}" -X GET -u "robot$..." \
  "https://harbor.go-ti.shop/v2/prod/goti-queue-gate/manifests/prod-3-8add224"
200
```

로컬 curl은 모두 200 OK로 통과했습니다.

### Bearer Token Flow 시뮬레이션

containerd가 실제로 수행하는 인증 플로우를 그대로 재현해봤습니다.

1. 인증 없이 요청 → 401 Unauthorized
2. Token 발급 요청 → Bearer token 수신
3. Bearer token을 붙여 HEAD 재요청 → 200 OK

로컬에서 전체 플로우가 정상이었습니다. 그렇다면 문제는 클러스터 안에만 있을 가능성이 높았습니다.

### EKS 클러스터 내부에서 테스트

debug Pod을 띄워 클러스터 내부에서 curl을 돌렸습니다.

```bash
$ kubectl run harbor-debug ... -- curl -s -o /dev/null -w "%{http_code}" -X HEAD ...
200
```

놀랍게도 클러스터 내부에서도 curl은 200이었습니다. **kubelet/containerd만 실패하는 상황**이었습니다.

### Secret과 Harbor 프로젝트 설정 검증

혹시나 해서 `harbor-creds` Secret을 base64 디코드해 확인했습니다. username/password 일치했습니다. Harbor 프로젝트 설정도 확인했습니다.

```json
{
  "prevent_vul": "true",
  "severity": "high",
  "auto_scan": "true",
  "public": "false"
}
```

`prevent_vul: true`가 의심스러웠지만 스캔 결과는 `Success`, 취약점은 `None`이었습니다.

**여기까지 약 2시간이 소요되었습니다.** curl은 되는데 containerd만 실패하는 이유를 알 수 없었습니다.

---

## 🤔 원인 1: Cloudflare WAF가 'bottlerocket'을 'bot'으로 오탐

### Cloudflare Security Analytics에서 차단 로그 발견

Harbor 담당 팀원이 Cloudflare 측 Security Analytics를 열어보고 차단 로그를 발견했습니다.

```
Service:     Custom rules
Action:      Block
Rule:        block_bot_user_agent
IP:          15.164.8.237 (EKS NAT Gateway)
ASN:         AS16509 AMAZON-02
User-Agent:  containerd/2.1.6+bottlerocket
Method:      HEAD
Host:        harbor.go-ti.shop
```

### 근본 원인

Cloudflare에는 User-Agent에 봇 관련 문자열이 포함된 요청을 차단하는 Custom Rule이 설정되어 있었습니다.

```text
(http.user_agent contains "Headless") or
(http.user_agent contains "bot") or
(http.user_agent contains "crawler")
```

문제는 가운데 줄입니다. `"bot"` 부분 문자열 매칭이 `bottlerocket`까지 잡아버립니다.

EKS 노드 OS가 Bottlerocket인데, containerd가 자신의 User-Agent를 `containerd/2.1.6+bottlerocket`으로 보냈습니다. `bottlerocket`에 `bot`이 포함되어 있어서 WAF 규칙에 걸린 것입니다.

### 왜 curl은 통과했는가

User-Agent 차이 때문이었습니다.

- curl의 User-Agent는 `curl/8.x`입니다. `bot` 문자열이 없어 WAF를 통과합니다.
- containerd의 User-Agent는 `containerd/2.1.6+bottlerocket`입니다. `bot` 문자열이 포함되어 WAF에서 차단됩니다.

같은 HTTP 요청이지만 User-Agent 한 줄 차이로 전혀 다른 결과가 나오고 있었습니다.

### 수정

WAF 규칙에 containerd 예외를 추가했습니다.

```
((http.user_agent contains "Headless") or (http.user_agent contains "bot") or (http.user_agent contains "crawler"))
and not (http.user_agent contains "containerd")
```

이 수정은 GKE, AKS 등 다른 클라우드에서도 동일하게 적용됩니다. containerd User-Agent 기반이라 IP에 의존하지 않는 범용적 해결책입니다.

---

## 🤔 원인 2: Route53 Private Hosted Zone이 Cloudflare를 우회

### 증상 변화 — 403에서 timeout으로

WAF 예외를 추가하고 다시 pull을 시도하자, 에러가 바뀌었습니다.

```
dial tcp 43.200.219.176:443: i/o timeout
dial tcp 3.37.136.8:443: i/o timeout
dial tcp 15.164.204.79:443: i/o timeout
```

403이 아니라 TCP dial timeout이었습니다. 에러 메시지가 달라졌다는 것은 원인 하나는 해결되었지만 다른 원인이 남아있다는 뜻이었습니다.

### EKS 내부 DNS 조회 확인

Pod 안에서 `harbor.go-ti.shop`을 resolve해봤습니다.

```bash
$ nslookup harbor.go-ti.shop  # (from EKS pod)
Name:    harbor.go-ti.shop
Address: 43.200.219.176    ← EC2 IP
Address: 3.37.136.8        ← EC2 IP
Address: 15.164.204.79     ← EC2 IP

$ dig +short harbor.go-ti.shop @1.1.1.1  # (from local)
104.26.10.42               ← Cloudflare IP
104.26.11.42               ← Cloudflare IP
172.67.68.127              ← Cloudflare IP
```

로컬에서는 Cloudflare IP로 resolve되는데, EKS 내부에서는 EC2 origin IP로 resolve되고 있었습니다.

### 근본 원인

Route53 Private Hosted Zone (`go-ti.shop`, Zone ID `Z060291220AOKNIF7KTWA`)에 harbor A 레코드가 등록되어 있었습니다.

```
harbor.go-ti.shop  A  60  3.37.136.8, 43.200.219.176, 15.164.204.79
```

Private Hosted Zone은 VPC 내부 DNS 조회에서 Public DNS보다 우선합니다. EKS 노드는 Private HZ에 있는 EC2 IP를 받아 해당 IP로 직접 443 연결을 시도했습니다. 하지만 그 EC2는 HTTPS를 제공하지 않아 timeout이 발생했습니다.

### 전체 경로 배경

Harbor는 사실 EKS 클러스터 안의 Pod으로 동작하고 있었습니다. 외부 접근 경로는 외부 → Cloudflare(TLS terminate) → ALB/NLB → Istio Gateway(HTTP) → Harbor Pod 순이었습니다.

Istio Gateway는 `protocol: HTTP`만 받도록 구성되어 있었습니다. TLS는 Cloudflare가 처리하는 전제였습니다. EC2 IP로 직접 443 연결을 시도하면 TLS handshake할 대상이 없어 timeout이 나는 것이 당연한 결과였습니다.

### 수정

Private Hosted Zone에서 harbor A 레코드를 삭제했습니다.

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z060291220AOKNIF7KTWA \
  --change-batch '{
    "Changes": [{
      "Action": "DELETE",
      "ResourceRecordSet": {
        "Name": "harbor.go-ti.shop",
        "Type": "A",
        "TTL": 60,
        "ResourceRecords": [
          {"Value": "3.37.136.8"},
          {"Value": "43.200.219.176"},
          {"Value": "15.164.204.79"}
        ]
      }
    }]
  }'
```

삭제 후 EKS DNS가 Public DNS로 fallback하면서 Cloudflare IP를 받게 되었고, WAF 예외까지 적용된 상태였기 때문에 pull이 정상 동작했습니다.

---

## ✅ 해결: 이중 장애를 순서대로 해결

### 최종 결과

```bash
$ kubectl get pods -n prod
goti-guardrail-prod-679c769c9-mmdmk     2/2     Running
goti-queue-gate-prod-6d8fb989b6-dn9c2   2/2     Running
goti-queue-gate-prod-6d8fb989b6-z2fb4   2/2     Running
```

### 장애 원인 요약

```text
EKS containerd가 harbor.go-ti.shop 이미지 pull 시도
  │
  ├─ [원인 1] Route53 Private Hosted Zone
  │   harbor.go-ti.shop → EC2 origin IP (3개)
  │   → EC2에서 HTTPS(443) 미제공 → dial tcp timeout
  │
  └─ [원인 2] Cloudflare WAF (원인 1 해결 후 노출됨)
      User-Agent: containerd/2.1.6+bottlerocket
      → "bot" 문자열 매칭 → block_bot_user_agent 규칙 → 403 Forbidden
```

두 원인이 **동시에 존재**하고 있었기 때문에 하나를 해결해도 다른 하나가 차단하고 있었습니다. 순서대로 해결이 필요했습니다.

### 변경 사항 정리

| 변경 | 파일/서비스 | 내용 |
|------|-----------|------|
| Cloudflare WAF | `block_bot_user_agent` 규칙 | `and not (http.user_agent contains "containerd")` 예외 추가 |
| Route53 | Private HZ `Z060291220AOKNIF7KTWA` | `harbor.go-ti.shop` A 레코드 삭제 |
| Goti-k8s | `environments/prod/goti-queue-gate/values-aws.yaml` | ECR → Harbor 직접 pull (`harbor-creds`) |
| Goti-k8s | `environments/prod/goti-guardrail/values-aws.yaml` | ECR → Harbor 직접 pull (`harbor-creds`) |
| Goti-guardrail-server | `.github/workflows/cd-prod.yml` | 신규 생성 (Harbor push + K8s PR) |
| Goti-guardrail-server | `.github/workflows/cd.yml → cd-dev.yml` | rename |

---

## 📚 배운 점

### Cloudflare WAF substring 매칭의 위험성

`contains "bot"` 규칙이 `bottlerocket`을 오탐했습니다. 단순 substring 매칭은 이런 오탐을 구조적으로 피할 수 없습니다. 정규식이나 word boundary 매칭이 불가능한 Cloudflare Free/Pro 플랜에서는 **예외 규칙을 반드시 명시**해야 합니다.

WAF 규칙을 작성할 때는 `containerd`, `cri-o`, `podman` 같은 컨테이너 런타임 User-Agent를 기본 예외에 포함해두는 것이 안전합니다.

### Private Hosted Zone의 숨은 DNS 오버라이드

Private Hosted Zone이 있으면 해당 zone의 **모든 서브도메인** 쿼리가 먼저 PHZ를 확인합니다. 레코드가 있으면 Public DNS는 완전히 무시됩니다.

레지스트리 도메인이나 외부 서비스 도메인을 Private HZ에 넣을 때는, 해당 IP에서 실제로 HTTPS가 가능한지를 반드시 검증해야 합니다. 과거 내부 경로를 위해 임시로 넣었던 레코드가 잊히면, 이번처럼 Cloudflare를 우회하며 조용히 실패를 만들어냅니다.

### curl과 containerd의 동작 차이 — User-Agent부터 의심

같은 HTTP 요청이라도 User-Agent가 다르면 WAF 결과가 달라집니다. "curl로는 되는데 왜 안 되지?" 상황에서는 User-Agent 차이를 가장 먼저 의심해야 합니다.

### Multi-Cloud에서 containerd 예외의 범용성

`and not (http.user_agent contains "containerd")` 규칙은 EKS, GKE, AKS 모두 containerd를 사용하므로 클라우드에 무관하게 적용됩니다. IP 기반 허용 규칙보다 이식성이 좋습니다.

### 이중 장애 디버깅 전략 — 에러 메시지 변화를 추적

원인이 2개 겹쳐 있을 때, 하나를 고치면 증상만 바뀌고 완전히 해결되지는 않습니다. 이번 사례에서도 에러 메시지가 단계별로 달라졌습니다.

- `403 Forbidden` → WAF 문제의 신호입니다.
- `dial tcp timeout` → DNS 또는 네트워크 문제의 신호입니다.
- 에러 메시지가 바뀌었다면, 하나는 해결된 것이고 또 다른 원인이 남아 있다는 뜻입니다.

에러 메시지 변화를 추적하는 습관이 이중 장애를 풀어내는 열쇠였습니다.

---

## 향후 개선

| 항목 | 설명 | 우선순위 |
|------|------|---------|
| Gateway TLS termination | Istio Gateway에서 TLS terminate → Cloudflare 우회, 클러스터 내부 통신 | P2 |
| Harbor ECR replication | replication rule 추가 → ECR pull 복원 (Cloudflare 완전 우회) | P2 |
| Cloudflare WAF 정교화 | `contains "bot"` → word boundary 매칭 또는 known bot list 활용 | P3 |
| Private HZ 정리 | `go-ti.shop` PHZ에 불필요 레코드 없는지 정기 점검 | P3 |

---

## 참고 자료

- [Harbor #19486 — Images can't be pulled while scan is "PENDING"](https://github.com/goharbor/harbor/issues/19486)
- [Harbor #16732 — "Prevent vulnerable images from running" is broken](https://github.com/goharbor/harbor/issues/16732)
- [Cloudflare Community — Docker Registry inaccessible with Cloudflare Access](https://community.cloudflare.com/t/docker-registry-inaccessible-with-cloudflare-access/429652)
- [Bottlerocket container-registry settings](https://bottlerocket.dev/en/os/1.20.x/api/settings/container-registry/)
