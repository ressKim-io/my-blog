---
date: 2026-04-06
type: troubleshoot
severity: critical
duration: ~2h
services: [goti-queue-gate, goti-guardrail]
tags: [harbor, cloudflare, waf, eks, imagepull, dns, route53, containerd, bottlerocket]
---

# Harbor ImagePullBackOff 403 Forbidden — Cloudflare WAF + Route53 Private Hosted Zone 이중 장애

## TL;DR

EKS에서 Harbor 이미지 pull 시 403 Forbidden → **원인이 2개** 겹쳐 있었다:
1. **Cloudflare WAF**: `containerd/2.1.6+bottlerocket` User-Agent를 봇으로 차단
2. **Route53 Private Hosted Zone**: `harbor.go-ti.shop`이 Cloudflare가 아닌 EC2 origin IP로 resolve → 443 timeout

WAF 예외 + PHZ 레코드 삭제로 해결.

---

## 1. 증상 발견

### 최초 상태
queue-gate CD prod 성공 (Harbor push 완료) → Goti-k8s PR 머지 → ArgoCD sync → **pod ImagePullBackOff**

```
goti-queue-gate-prod-6c8656fd6d-59dzz   1/2     ImagePullBackOff
goti-queue-gate-prod-6c8656fd6d-d5q72   1/2     ImagePullBackOff
```

### 에러 메시지 (1차 — ECR)
```
Failed to pull image "707925622666.dkr.ecr.ap-northeast-2.amazonaws.com/prod/goti-queue-gate:init-0000000":
  failed to resolve image: unexpected status from HEAD request: 403 Forbidden
```

**초기 진단**: ECR `prod/goti-queue-gate` 레포가 존재하지 않음. Harbor→ECR replication이 미설정.

---

## 2. 1차 시도 — ECR → Harbor 직접 pull 전환

ECR replication 대신 Harbor에서 직접 pull하도록 values-aws.yaml 수정:

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

### 결과: 여전히 403

```
Failed to pull image "harbor.go-ti.shop/prod/goti-queue-gate:prod-3-8add224":
  unexpected status from HEAD request to https://harbor.go-ti.shop/v2/prod/goti-queue-gate/manifests/prod-3-8add224: 403 Forbidden
```

---

## 3. 진단 과정 — "curl은 되는데 kubelet만 실패"

### 3-1. Harbor 이미지 존재 확인

```bash
$ curl -u "robot$prod+goti-cicd:..." "https://harbor.go-ti.shop/v2/prod/goti-queue-gate/tags/list"
{"name":"prod/goti-queue-gate","tags":["prod-1-3ed22dc","prod-2-3ed22dc","prod-3-8add224"]}
```
→ 이미지 있음.

### 3-2. curl HEAD/GET 테스트

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

### 3-3. Bearer Token Flow 시뮬레이션 (containerd 동작 재현)

```bash
# Step 1: 인증 없이 → 401
# Step 2: Token 발급
# Step 3: Bearer token으로 HEAD → 200
```
→ **로컬에서 전체 flow 정상**.

### 3-4. EKS 클러스터 내부에서 테스트

```bash
$ kubectl run harbor-debug ... -- curl -s -o /dev/null -w "%{http_code}" -X HEAD ...
200
```
→ **클러스터 내부에서도 curl은 정상**. kubelet/containerd만 실패.

### 3-5. harbor-creds Secret 검증

```json
{
  "auths": {
    "harbor.go-ti.shop": {
      "username": "robot$prod+goti-cicd",
      "password": "...",
      "auth": "cm9ib3Qk..."  // base64 decode = username:password 일치
    }
  }
}
```
→ Secret 정상.

### 3-6. Harbor 프로젝트 설정 확인

```json
{
  "prevent_vul": "true",
  "severity": "high",
  "auto_scan": "true",
  "public": "false"
}
```
→ `prevent_vul: true` 의심. 하지만 스캔 결과 `Success`, 취약점 `None`.

**이 시점에서 2시간 가까이 소요. curl은 되는데 containerd만 실패하는 원인 불명.**

---

## 4. 원인 1 발견 — Cloudflare WAF

### 발견 경로

Harbor 담당 팀원이 Cloudflare Security Analytics에서 차단 로그 발견:

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

Cloudflare WAF Custom Rule이 User-Agent에 `bot` 문자열이 포함된 요청을 차단:

```
(http.user_agent contains "Headless") or 
(http.user_agent contains "bot") or      ← "bottlerocket"이 여기 매칭!
(http.user_agent contains "crawler")
```

`containerd/2.1.6+bottlerocket`의 **`bottlerocket`에 `bot`이 포함**되어 있어서 차단됨.

### 왜 curl은 됐는가?

- curl의 User-Agent: `curl/8.x` → `bot` 미포함 → WAF 통과
- containerd의 User-Agent: `containerd/2.1.6+bottlerocket` → `bot` 포함 → **WAF 차단**

### 수정

WAF 규칙에 containerd 예외 추가:

```
((http.user_agent contains "Headless") or (http.user_agent contains "bot") or (http.user_agent contains "crawler"))
and not (http.user_agent contains "containerd")
```

**이 수정은 GKE 등 다른 클라우드에서도 동일하게 적용됨** — containerd UA 기반이라 IP 무관.

---

## 5. 원인 2 발견 — Route53 Private Hosted Zone

### 증상

WAF 수정 후에도 에러가 403에서 **i/o timeout**으로 변경:

```
dial tcp 43.200.219.176:443: i/o timeout
dial tcp 3.37.136.8:443: i/o timeout
dial tcp 15.164.204.79:443: i/o timeout
```

### 진단

EKS 내부 DNS 조회:

```bash
$ nslookup harbor.go-ti.shop  (from EKS pod)
Name:    harbor.go-ti.shop
Address: 43.200.219.176    ← EC2 IP!
Address: 3.37.136.8        ← EC2 IP!
Address: 15.164.204.79     ← EC2 IP!

$ dig +short harbor.go-ti.shop @1.1.1.1  (from local)
104.26.10.42               ← Cloudflare IP
104.26.11.42               ← Cloudflare IP
172.67.68.127              ← Cloudflare IP
```

**EKS 내부에서는 Cloudflare가 아닌 EC2 origin IP로 resolve!**

### 근본 원인

Route53 Private Hosted Zone (`go-ti.shop`, Zone ID: `Z060291220AOKNIF7KTWA`)에 harbor A 레코드가 등록되어 있었음:

```
harbor.go-ti.shop  A  60  3.37.136.8, 43.200.219.176, 15.164.204.79
```

**Private Hosted Zone은 VPC 내부 DNS 조회에서 Public DNS보다 우선** → EKS 노드가 EC2 IP로 직접 연결 시도 → 해당 EC2에서 443 HTTPS를 안 받음 → timeout.

### 배경

Harbor가 EKS 클러스터 안에 Pod으로 돌고 있고, 외부 접근 경로:

```
외부 → Cloudflare (TLS terminate) → ALB/NLB → Istio Gateway (HTTP) → Harbor Pod
```

Istio Gateway는 `protocol: HTTP`만 받음 (TLS는 Cloudflare가 처리). EC2 IP로 직접 443 연결하면 TLS handshake할 대상이 없어서 timeout.

### 수정

Private Hosted Zone에서 harbor A 레코드 삭제:

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

삭제 후 EKS DNS가 Cloudflare IP로 fallback → WAF containerd 예외 적용 → **pull 성공**.

---

## 6. 최종 결과

```
goti-guardrail-prod-679c769c9-mmdmk     2/2     Running
goti-queue-gate-prod-6d8fb989b6-dn9c2   2/2     Running
goti-queue-gate-prod-6d8fb989b6-z2fb4   2/2     Running
```

---

## 7. 장애 원인 요약 (이중 장애)

```
EKS containerd가 harbor.go-ti.shop 이미지 pull 시도
  │
  ├─ [원인 1] Route53 Private Hosted Zone
  │   harbor.go-ti.shop → EC2 origin IP (3개)
  │   → EC2에서 HTTPS(443) 미제공 → dial tcp timeout
  │
  └─ [원인 2] Cloudflare WAF (원인 1 해결 후 노출)
      User-Agent: containerd/2.1.6+bottlerocket
      → "bot" 문자열 매칭 → block_bot_user_agent 규칙 → 403 Forbidden
```

두 원인이 **동시에 존재**하여 하나를 해결해도 다른 하나가 차단. 순서대로 해결 필요했음.

---

## 8. 교훈 (Lessons Learned)

### 8-1. Cloudflare WAF substring 매칭의 위험

`contains "bot"` 규칙이 `bottlerocket`을 오탐. 정규식이나 word boundary 매칭이 불가한 Cloudflare Free/Pro에서는 **예외 규칙 필수**.

> **Action Item**: WAF 규칙 작성 시 컨테이너 런타임 UA(`containerd`, `cri-o`, `podman`) 예외를 기본으로 포함.

### 8-2. Private Hosted Zone의 숨은 DNS 오버라이드

Private HZ가 존재하면 해당 zone의 **모든 서브도메인** 쿼리가 PHZ를 먼저 확인. 레코드가 없으면 **NXDOMAIN이 아니라 상위 zone의 NS로 fallback**하지만, 레코드가 있으면 Public DNS 완전 무시.

> **Action Item**: Private HZ에 레지스트리 도메인 레코드를 넣을 때는 해당 IP에서 HTTPS가 가능한지 반드시 확인.

### 8-3. curl과 containerd의 동작 차이

같은 HTTP 요청이라도 **User-Agent가 다르면** WAF 결과가 완전히 달라짐. "curl로 되는데 왜 안 되지?" 상황에서는 **UA 차이를 먼저 의심**.

### 8-4. Multi-Cloud 환경에서 containerd 예외의 범용성

`and not (http.user_agent contains "containerd")` 규칙은 **EKS, GKE, AKS 모두** containerd를 사용하므로 클라우드 무관하게 적용됨. IP 기반 허용보다 범용적.

### 8-5. 이중 장애 디버깅 전략

원인이 2개 겹치면 하나를 고쳐도 증상이 바뀔 뿐 해결 안 됨. **에러 메시지 변화를 추적**하는 것이 중요:
- 403 Forbidden → WAF 문제
- dial tcp timeout → DNS/네트워크 문제
- 에러가 바뀌면 → 하나는 해결된 것, 다른 원인 존재

---

## 9. 변경 사항 정리

| 변경 | 파일/서비스 | 내용 |
|------|-----------|------|
| Cloudflare WAF | `block_bot_user_agent` 규칙 | `and not (http.user_agent contains "containerd")` 예외 추가 |
| Route53 | Private HZ `Z060291220AOKNIF7KTWA` | `harbor.go-ti.shop` A 레코드 삭제 |
| Goti-k8s | `environments/prod/goti-queue-gate/values-aws.yaml` | ECR → Harbor 직접 pull (`harbor-creds`) |
| Goti-k8s | `environments/prod/goti-guardrail/values-aws.yaml` | ECR → Harbor 직접 pull (`harbor-creds`) |
| Goti-guardrail-server | `.github/workflows/cd-prod.yml` | 신규 생성 (Harbor push + K8s PR) |
| Goti-guardrail-server | `.github/workflows/cd.yml → cd-dev.yml` | rename |

---

## 10. 향후 개선 (Optional)

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
