---
title: "kind 부트스트랩 후속 — loki-alerting-rules ConfigMap 미생성 + ingress 트리아지"
excerpt: "goti-dev-v2 드라이런 검증 중 발견한 loki-0 ContainerCreating + Istio Gateway listener 미반영 2건 트리아지. chart 가정과 실제 의존성 갭을 기록합니다"
type: troubleshooting
category: monitoring
tags:
  - go-ti
  - kind
  - Loki
  - ConfigMap
  - Helm
  - troubleshooting
series:
  name: "goti-kind-dev-bootstrap"
  order: 2
date: "2026-04-25"
---

## 한 줄 요약

> goti-dev-v2 클러스터 드라이런 중 부트스트랩 스크립트가 자동 해결하지 못한 이슈 2건을 기록합니다. loki-0 ConfigMap 미생성(즉시 workaround 적용)과 Istio Gateway HTTP listener 미반영(후속 세션 예정)입니다

---

## 🔥 이슈 1 — loki-0 ContainerCreating 20분 이상 지속

### 발생 상황

`goti-dev-v2` 클러스터(kind, K8s 1.34.3)를 부트스트랩한 직후, loki-0 Pod가 20분 이상 `ContainerCreating` 상태에서 벗어나지 못했습니다.

```bash
$ kubectl -n monitoring get pod loki-0
NAME     READY   STATUS              RESTARTS   AGE
loki-0   0/2     ContainerCreating   0          20m
```

describe 출력에서 FailedMount 이벤트가 반복됐습니다.

```text
Warning  FailedMount  33s (x17 over 18m)  kubelet
MountVolume.SetUp failed for volume "loki-rules" : configmap "loki-alerting-rules" not found
```

---

## 🤔 원인 — chart 가정과 실제 의존성 갭

grafana/loki chart(v7.0.0)의 loki StatefulSet은 `loki-rules` 볼륨을 마운트하며, 해당 볼륨의 소스가 `loki-alerting-rules` ConfigMap입니다.

프로젝트 구성에서 이 ConfigMap은 **커스텀 모니터링 chart가 생성해야 하는 것으로 설계**되어 있었습니다. 이전 dev-log(2026-04-24)에도 "goti-monitoring install로 자동 해결된다"고 기록되어 있었습니다.

그러나 실제 chart 템플릿 디렉터리를 확인한 결과, `loki-alerting-rules` ConfigMap을 생성하는 template이 존재하지 않았습니다.

즉, dev-log의 "자동 해결" 기록은 **부정확하거나 과거 시점의 상태**였습니다. 기존 `goti-dev` 클러스터에서 loki-0가 Running이었던 것은 수동 `kubectl create configmap` 등 다른 경로로 해결됐을 가능성이 높습니다.

---

## 🧭 선택지 비교

loki-alerting-rules 의존성을 해결하는 방법 3가지를 검토했습니다.

| 옵션 | 접근 방식 | 장점 | 한계 |
|------|-----------|------|------|
| A. chart에 ConfigMap template 추가 | 커스텀 chart에 loki-alerting-rules 생성 template 포함 | SoT 명확, 부트스트랩 완전 자동화 | chart 레포 수정 + 검증 필요 |
| B. loki values에서 ruler 비활성화 | `loki.rulerConfig`를 disabled로 설정 | chart 수정 불필요, 즉시 적용 | alerting 기능 영구 포기 |
| C. 부트스트랩 스크립트에서 빈 ConfigMap 선행 생성 | `70-monitoring.sh`에서 helm install 전 apply | 즉시 동작, dev 환경에서는 문제 없음 | 근본 해결 아님, 추적 어려움 |

### 기각 이유

- **B 탈락**: alerting 기능을 영구적으로 포기하는 것은 dev 환경이라도 불필요한 기능 제거입니다. 나중에 alerting을 붙이려면 chart 수정이 다시 필요합니다
- **C 탈락(근본 해결 시)**: workaround로만 유지하면 ConfigMap에 실제 rules 내용이 없어 alert 동작 여부를 파악하기 어렵습니다. 권장하지 않습니다

### 결정 기준과 최종 선택

**당장은 C(workaround)를 적용하고, 후속 세션에서 A로 전환**합니다.

결정 기준은 다음 우선순위였습니다.

1. **즉시 클러스터 정상화**: 드라이런 검증을 계속 진행해야 하므로 loki-0 기동이 우선
2. **dev 환경에서의 무해성**: 빈 ConfigMap이라도 마운트만 성공하면 loki-0가 Running 상태로 전환됨
3. **근본 해결은 별도 작업**: chart 수정은 검증 시간이 필요하므로 다음 세션에서 처리

---

## ✅ 해결 — workaround (commit `aeeb173`)

`scripts/bootstrap/stages/70-monitoring.sh`에서 loki helm install 직전에 빈 ConfigMap을 선행 생성합니다.

```bash
kubectl create configmap loki-alerting-rules -n monitoring \
  --from-literal=placeholder=none \
  --dry-run=client -o yaml | kubectl apply -f -
```

`--dry-run=client -o yaml | kubectl apply -f -` 패턴을 사용한 이유는 멱등성 보장 때문입니다. ConfigMap이 이미 존재해도 에러 없이 통과합니다.

적용 결과를 정리하면 다음과 같습니다.

| 항목 | 상태 |
|------|------|
| loki-0 마운트 성공 여부 | 성공 (empty data라도 마운트 가능) |
| alerting 기능 | 비활성 (rules 내용 없음) |
| dev 환경 영향 | 없음 |

### 근본 해결 — 후속 세션 계획

**옵션 A**를 채택해 커스텀 모니터링 chart에 template을 추가합니다.

`generate-k8s-loki-rules.sh` 스크립트의 산출물을 chart 내부로 옮기면 됩니다. 작업 완료 후 bootstrap 스크립트의 workaround 구문을 제거합니다.

검증은 clean kind 클러스터에서 수행합니다.

```bash
bash scripts/bootstrap-kind-dev.sh --cluster=goti-dev-v3
kubectl -n monitoring get pod loki-0
# Expected: 2/2 Running (loki + loki-sc-rules 두 컨테이너)
```

---

## 🔥 이슈 2 — Istio Gateway HTTP 80 listener 미반영

### 발생 상황

부트스트랩 완료 후 ingress 경로를 검증하는 과정에서 HTTP 요청이 전달되지 않았습니다.

```bash
$ curl -v -H "Host: dev.go-ti.shop" http://127.0.0.1/
* connect to 127.0.0.1 port 80 succeeded
* Recv failure: 상대편이 연결을 끊음
HTTP 000
```

TCP 연결(3-way handshake)은 성공하지만, HTTP 요청 전송 직후 Envoy가 연결을 reset했습니다.

ingressgateway Pod의 Envoy listener 목록을 직접 조회하면 다음과 같습니다.

```bash
$ kubectl -n istio-system exec istio-ingressgateway-xxx -- \
    curl -s http://127.0.0.1:15000/listeners
0.0.0.0_15090::0.0.0.0:15090  # stats
0.0.0.0_15021::0.0.0.0:15021  # health
# HTTP 80 / HTTPS 443 listener 없음
```

정상이라면 Gateway 리소스에 정의된 port에 해당하는 `0.0.0.0_80::0.0.0.0:80` 등이 보여야 합니다.

---

## 🤔 원인 — 진단 보류 (후속 세션 확인 예정)

완전한 원인을 특정하지 못했습니다. 현재까지 수집된 진단 포인트를 기록합니다.

**진단 포인트 1 — Gateway selector ↔ Pod label 매칭**

```bash
kubectl -n istio-system get gateway goti-shared-gateway -o yaml | yq .spec.selector
# 기대: istio: ingressgateway

kubectl -n istio-system get pod -l istio=ingressgateway
# label 일치 여부 확인
```

`infrastructure/dev/istio/gateway/` chart가 Pod label을 `app: istio-ingressgateway` 형태로 설정했을 가능성이 있습니다. selector와 label이 불일치하면 istiod가 Gateway 리소스를 해당 Pod에 push하지 않습니다.

**진단 포인트 2 — Gateway 리소스 실제 apply 여부**

```bash
kubectl -n istio-system get gateway goti-shared-gateway -o yaml
# 존재 여부 + selector/servers 필드 확인
```

현재 `95-gateway.sh`는 "goti-shared-gateway가 istio-ingressgateway chart에 포함된다"는 가정으로 해당 단계를 skip합니다. 실제 chart template이 예상대로 리소스를 생성하는지 검증이 필요합니다.

**진단 포인트 3 — istiod config push 상태**

```bash
kubectl -n istio-system logs deploy/istiod | grep -i "gateway\|push"
istioctl proxy-config listener istio-ingressgateway-xxx -n istio-system
```

`istioctl proxy-config`로 기대 listener가 있는지 확인합니다.

**진단 포인트 4 — TLS credentialName `goti-tls` 부재 영향**

Gateway가 HTTPS 443에 `credentialName: goti-tls`로 Secret을 참조합니다. 이 Secret이 없으면 HTTPS listener가 생성되지 않습니다. 그러나 HTTP 80 listener는 Secret과 무관해야 합니다.

만약 Envoy가 "Gateway 전체를 파싱 실패"로 처리하면 두 listener가 모두 drop될 가능성도 있습니다. istiod 로그에서 확인이 필요합니다.

### 현재 가설

가장 유력한 원인은 **Gateway selector mismatch**입니다.

- `goti-shared-gateway.spec.selector.istio: ingressgateway`는 Istio 공식 default
- `infrastructure/dev/istio/gateway` chart가 Pod label을 custom 형태(`app: istio-ingressgateway` 등)로 설정했을 가능성

---

## ✅ 해결 계획 (후속)

이슈 2는 후속 세션에서 다음 순서로 처리합니다.

1. selector/label 일치 여부 확인
2. 불일치라면 Gateway 리소스의 `selector` 수정 → chart template 업데이트 → Goti-k8s 레포 commit
3. TLS Secret `goti-tls` 필요 여부 판단 (HTTPS 경로 활성화 시 Cloudflare origin cert 발급 포함)
4. `95-gateway.sh`의 fallback 경로도 동일 selector를 사용하도록 수정

수정 후 검증 방법입니다.

```bash
kubectl -n istio-system exec istio-ingressgateway-xxx -- \
  curl -s http://127.0.0.1:15000/listeners | grep "0.0.0.0_80"
# Expected: 0.0.0.0_80::0.0.0.0:80

curl -H "Host: dev.go-ti.shop" http://127.0.0.1/api/v1/baseball-teams
# Expected: HTTP 200 + JSON 응답
```

---

## 📚 배운 점

**1. dev-log 기록과 chart 실제 상태를 동일시하지 않습니다**

"기존 클러스터에서 동작했다"는 기록이 "chart가 자동으로 만든다"는 의미가 아닐 수 있습니다. 수동 조치로 해결된 내용이 dev-log에 "자동 해결"로 잘못 기록될 수 있습니다. clean 클러스터 재생성으로 검증하면 이 갭을 발견할 수 있습니다

**2. 부트스트랩 스크립트의 가정은 명시적으로 검증합니다**

`95-gateway.sh`처럼 "chart에 포함되어 있으니 skip"하는 단계는 실제 리소스 존재 여부를 확인하는 검증 명령을 함께 두는 것이 안전합니다. 가정이 어긋났을 때 무증상으로 넘어가는 상황을 방지할 수 있습니다

**3. Istio Gateway listener 미반영의 첫 번째 확인 대상은 selector입니다**

Gateway 리소스가 존재하지만 Envoy에 listener가 없을 때, selector ↔ Pod label 매칭을 가장 먼저 확인합니다. istiod는 selector가 일치하는 Pod에만 config를 push하기 때문입니다

**4. workaround를 적용할 때는 근본 해결 경로를 함께 기록합니다**

빈 ConfigMap을 선행 생성하는 방식은 즉시 동작하지만, 이후 alert 기능을 추가할 때 "왜 placeholder가 있는지" 추적하기 어렵습니다. commit 메시지나 이슈에 workaround 이유와 후속 작업을 명시하면 혼란을 줄일 수 있습니다

**5. 실패 유형 태그로 이슈를 분류합니다**

| 이슈 | 실패 유형 |
|------|-----------|
| loki-alerting-rules | `context-missing` — dev-log 기록과 실제 chart 상태 불일치 |
| Gateway listener | `wrong-layer` (앱이 아닌 Istio config push 계층), `env-difference` (chart가 기대한 pod label과 실제 불일치 가능성) |

이슈 유형을 태그로 분류해두면 유사한 문제가 발생했을 때 과거 기록을 빠르게 참조할 수 있습니다
