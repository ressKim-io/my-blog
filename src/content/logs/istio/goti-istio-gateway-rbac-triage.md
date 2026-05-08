---
title: "Istio Gateway RBAC 트리아지 — chart 버그 3건 연쇄 발견"
excerpt: "kind-dev-v2에서 외부 HTTP 접근이 전부 실패. Gateway selector mismatch → AuthorizationPolicy namespace leak → Grafana VirtualService 잘못된 destination host. 3건 chart 버그를 연쇄적으로 발견·수정한 기록입니다"
type: troubleshooting
category: istio
tags:
  - go-ti
  - Istio
  - Gateway
  - AuthorizationPolicy
  - VirtualService
  - kind
  - troubleshooting
series:
  name: "goti-kind-dev-bootstrap"
  order: 3
date: "2026-04-25"
---

## 한 줄 요약

> kind-dev-v2 bootstrap 직후 외부 HTTP가 전부 차단됐습니다. Gateway selector mismatch → AuthorizationPolicy namespace leak → Grafana VirtualService destination 불일치, 세 가지 chart 버그가 연쇄로 드러났고 모두 수정 후 정상화됐습니다

---

## 🔥 문제: bootstrap 직후 외부 HTTP 접근 전면 실패

### 환경

kind-dev-v2 클러스터(K8s 1.34.3)에 goti 서비스 스택을 새로 올린 직후 발생한 이슈입니다.
Istio ingressgateway가 배포된 상태에서 외부 curl 요청이 전부 차단됐습니다.

### 증상

```bash
$ curl -v -H "Host: dev.go-ti.shop" http://127.0.0.1/
* Connected to 127.0.0.1 (127.0.0.1) port 80
* Recv failure: 상대편이 연결을 끊음
HTTP 000
```

TCP 연결 자체는 성공했지만 Envoy가 즉시 reset을 보냈습니다.

Listener 목록을 확인하면 원인이 명확해집니다.

```bash
$ istioctl proxy-config listener -n istio-system istio-ingressgateway-xxx
ADDRESSES PORT  MATCH DESTINATION
0.0.0.0   15021 ALL   Inline Route: /healthz/ready*
0.0.0.0   15090 ALL   Inline Route: /stats/prometheus*
# HTTP 80 listener 없음
```

port 80 listener가 존재하지 않았습니다.
Gateway 리소스가 ingressgateway pod에 전혀 push되지 못한 상태입니다.

---

## 🤔 가설-검증 루프

총 3개의 가설을 순서대로 검증했습니다.
각 가설 확인 후 다음 증상이 드러나는 연쇄 구조였습니다.

### H1: Gateway selector ↔ Pod label mismatch

**근거**: Istio Gateway는 `spec.selector`로 특정 label을 가진 pod에 바인딩됩니다.
listener가 아예 없다면 selector가 어떤 pod에도 매칭되지 못한 것이 유력합니다.

**검증**:

```bash
$ kubectl -n istio-system get gateway goti-shared-gateway \
    -o jsonpath='{.spec.selector}'
{"istio":"gateway"}

$ kubectl -n istio-system get pod -l istio=ingressgateway --show-labels
istio-ingressgateway-xxx ... istio=ingressgateway,app=istio-ingressgateway,...
```

**결과: confirmed**

Gateway는 `istio: gateway`를 찾는데 실제 pod label은 `istio: ingressgateway`였습니다.

**원인 심화**: `istio/gateway` subchart의 `_helpers.tpl`이 이름을 자동 조립합니다.

```text
istio: {{ (.Values.labels.istio | quote) | default (include "gateway.name" . | trimPrefix "istio-") }}
```

Helm release 이름 `istio-ingressgateway`에서 `istio-` prefix를 trim하면 자동 label은 `ingressgateway`가 됩니다.
그런데 `shared-gateway.yaml` template에는 `istio: gateway`가 하드코딩되어 있었습니다.
subchart의 네이밍 규칙을 파악하지 않은 상태에서 작성된 것으로 보입니다.

**수정**: `shared-gateway.yaml`의 selector를 `istio: ingressgateway`로 변경 후 helm upgrade.

```bash
$ istioctl proxy-config listener -n istio-system istio-ingressgateway-xxx
0.0.0.0   80    ALL   Route: http.80     # 생성됨
```

port 80 listener가 생겼습니다.

---

### H2: AuthorizationPolicy가 외부 요청 거부

**증상 전이**: listener 생성 후 curl이 이번에는 403을 반환했습니다.

```text
< HTTP/1.1 403 Forbidden
< server: istio-envoy
RBAC: access denied
```

**근거**: `istioctl x authz check`으로 pod에 적용된 정책을 확인합니다.

**검증**:

```bash
$ istioctl x authz check istio-ingressgateway-xxx.istio-system
ACTION   AuthorizationPolicy                    RULES
ALLOW    allow-istio-gateway.istio-system       1
ALLOW    allow-kubelet-probes.istio-system      1
ALLOW    allow-prometheus-scrape.istio-system   1
ALLOW    deny-all.istio-system                  1
```

**결과: confirmed**

goti-policy chart의 AuthorizationPolicy들이 전부 `istio-system` namespace에 배포되어
ingressgateway pod에 그대로 적용됐습니다.

Istio AP semantics에서 ALLOW 정책이 존재할 때 어떤 rule에도 매칭되지 않으면 default deny입니다.
외부 익명 HTTP 요청은 허용 rule에 매칭되지 않으므로 모두 거부됩니다.

**원인 심화**: `goti-policy/templates/*.yaml` 파일에 `metadata.namespace`가 지정되지 않았습니다.
Helm은 release namespace를 기본값으로 사용하므로 `istio-system`으로 배포됐습니다.
그런데 template 주석에는 "goti namespace 모든 워크로드에 대한 트래픽 거부"라고 명시되어 있었습니다.
작성 의도와 실제 배포 위치가 불일치한 silent namespace leak입니다.

**수정**: kind-dev 한정으로 `values-dev.yaml`에서 AP 전체를 disable했습니다.

비활성화 대상: `denyAll`, `allowGateway`, `allowKubeletProbes`, `allowIstiodJwks`, `allowPrometheus.authz`

모니터링 리소스인 PodMonitor, ServiceMonitor, PeerAuthentication(PERMISSIVE)은 유지했습니다.
`allowPrometheus.enabled` flag를 monitoring 리소스 제어용과 AP 제어용으로 분리하여
`authz.enabled` sub-flag를 추가했습니다.

> **참고**: kind-dev의 AP disable은 workaround입니다. prod 환경에서는 allowlist security 모델을 유지해야 합니다.
> template에 `namespace: goti`를 명시하거나 goti namespace에 chart를 설치하도록 근본 수정이 필요합니다.

---

### H3: Grafana VirtualService destination host 불일치

**증상 전이**: H2 해결 후 `dev.go-ti.shop/api/*`는 정상(400 MISSING_PARAMETER = app 도달).
그러나 `dev-monitoring.go-ti.shop`은 여전히 503이었습니다.

**검증**:

```bash
$ kubectl -n monitoring get virtualservice grafana \
    -o yaml | grep host
  host: kube-prometheus-stack-dev-grafana.monitoring.svc.cluster.local

$ kubectl -n monitoring get svc | grep graf
kps-grafana   ClusterIP   10.96.229.143   <none>   80/TCP
```

**결과: confirmed**

VirtualService가 존재하지 않는 service 이름을 참조하고 있었습니다.
실제 kube-prometheus-stack release 이름은 `kps`이므로 생성되는 service 이름은 `kps-grafana`입니다.

**원인 심화**: `mesh-policy/templates/grafana-virtualservice.yaml`에 host가
`kube-prometheus-stack-dev-grafana.monitoring.svc.cluster.local`로 하드코딩되어 있었습니다.
과거 release name이 `kube-prometheus-stack-dev`였던 시기에 작성되거나,
release name 변경 후 VirtualService 업데이트가 누락된 것으로 보입니다.

**수정**: VS template의 host를 `kps-grafana.monitoring.svc.cluster.local`로 변경했습니다.

---

## ✅ 최종 검증

4단계로 K8s/Istio 레이어 전체를 확인했습니다.

```bash
# 1. Gateway listener 생성 확인
$ istioctl proxy-config listener -n istio-system istio-ingressgateway-xxx
0.0.0.0   80    ALL   Route: http.80

# 2. istio-system AuthorizationPolicy 제거 확인
$ kubectl get authorizationpolicy -n istio-system
No resources found

# 3. 외부 API — backend 도달 확인
$ curl -s -H "Host: dev.go-ti.shop" \
    "http://127.0.0.1/api/v1/baseball-teams?teamIds=1,2,3"
{"code":"INVALID_FORMAT","message":"teamIds 형식 오류"}

# 4. Grafana 302 redirect 확인
$ curl -sI -H "Host: dev-monitoring.go-ti.shop" http://127.0.0.1/
HTTP/1.1 302 Found
location: /login
```

app 응답(`INVALID_FORMAT`)은 backend에 요청이 실제로 도달했다는 증거입니다.
Grafana의 `/login` redirect는 VS routing이 올바르게 동작하고 있음을 나타냅니다.

### 외부 접근 경로 전체 상태

| 레이어 | 상태 | 메모 |
|--------|------|------|
| ingressgateway Envoy listener 80 | 정상 | 이번 수정으로 생성 |
| AuthorizationPolicy (istio-system) | 정상 | 정책 제거 완료 |
| VirtualService routing (goti/monitoring) | 정상 | Grafana host 수정 포함 |
| kind hostPort 80/443 → container 31080/31443 | 정상 | kind-cluster-config.yaml |
| 공유기 포트포워딩 외부 → PC:80/443 | 수동 확인 필요 | 외부 네트워크 설정 |
| DNS `dev/dev-monitoring.go-ti.shop` → public IP | 수동 확인 필요 | CF Dashboard |
| Cloudflare SSL mode (Flexible = origin HTTP) | 수동 확인 필요 | TLS secret 부재 |

K8s/Istio 레이어는 전부 정상화됐습니다.
브라우저에서 `dev-monitoring.go-ti.shop`에 접근하려면 표의 "수동 확인 필요" 3건이 구성되어 있어야 합니다.

---

## 📚 배운 점

### 이슈 분류

| 이슈 | 유형 | 근거 |
|------|------|------|
| Gateway selector | wrong-layer | 앱 에러로 보였지만 Istio Gateway 바인딩 레이어가 원인. subchart 네이밍 가정과 실제 불일치 |
| AP namespace leak | context-missing | template 주석에는 goti namespace 의도가 기록됐으나 `metadata.namespace` 선언 누락. 렌더링 결과 검증 부재 |
| Grafana VS host | context-missing | release name 변경 이력이 chart에 반영되지 않음. 변경 이력 문서화 부재 |

### 핵심 교훈

- **listener 부재 → selector mismatch 먼저 확인**: `istioctl proxy-config listener`에서 port 80이 없으면 Gateway `spec.selector`와 pod label을 먼저 대조합니다
- **RBAC denied → AP namespace 분포 확인**: `istioctl x authz check <pod>.<namespace>`로 어떤 정책이 pod에 적용됐는지 확인합니다. ALLOW 정책이 잘못된 namespace에 배포되면 예상하지 못한 default deny가 발생합니다
- **helm template 산출물의 namespace 분포 검증**: `helm template` 결과를 리소스별로 namespace 단위로 확인하는 lint 또는 test가 없으면 silent namespace leak을 사전에 잡기 어렵습니다
- **chart 하드코딩 값은 parameterize**: Grafana VS의 destination host처럼 release name에 의존하는 값은 values로 빼두어야 release name 변경에 유연하게 대응할 수 있습니다
- **subchart 네이밍 규칙 파악 필수**: `_helpers.tpl`의 label 생성 로직을 확인하지 않으면 selector 하드코딩 시 mismatch가 발생합니다. `helm template`으로 실제 label 값을 확인한 뒤 selector를 작성해야 합니다
