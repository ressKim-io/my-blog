# 2026-04-25 kind-dev 부트스트랩 검증 — 후속 이슈 2건

goti-dev-v2 드라이런 검증 중 발견된, bootstrap 스크립트로는 자동 해결되지 않은 chart/설정 갭 추적. 별도 세션에서 후속 디버깅 예정.

## 관련 commit / 문서

- `docs/dx/0007-kind-dev-bootstrap-automation.md` — 부트스트랩 자동화 전반
- `docs/dev-logs/2026-04-24-kind-dev-bootstrap.md` — 원 세션 기록
- `fa35bf8`, `f4923ef`, `3379f93`, `aeeb173` — Phase 1-4 commit chain
- 검증 cluster: `goti-dev-v2` (kind, K8s 1.34.3, 2026-04-25 00시경 생성)

---

## 이슈 1 — loki-0 `loki-alerting-rules` ConfigMap 미생성

### 증상

```
$ kubectl -n monitoring get pod loki-0
NAME     READY   STATUS              RESTARTS   AGE
loki-0   0/2     ContainerCreating   0          20m

$ kubectl -n monitoring describe pod loki-0 | grep -A 2 "Warning.*FailedMount"
Warning  FailedMount  33s (x17 over 18m)  kubelet
MountVolume.SetUp failed for volume "loki-rules" : configmap "loki-alerting-rules" not found
```

### 원인

- grafana/loki chart(v7.0.0)의 loki StatefulSet이 `loki-rules` volume을 mount하고, 해당 volume은 `loki-alerting-rules` ConfigMap을 source로 한다.
- Goti 구성에서 이 ConfigMap은 **goti-monitoring 커스텀 chart가 만들어야 하는 것으로 설계**되었음 (dev-log 2026-04-24 기록).
- 실제 chart 템플릿 (`Goti-monitoring/charts/goti-monitoring/templates/`) 확인 결과 해당 ConfigMap 생성 template이 없음.
- 즉 dev-log 기록 "goti-monitoring install로 자동 해결"은 **부정확 또는 과거 시점의 상태**. 원래 기존 goti-dev 클러스터에서 loki-0가 Running 상태였던 것은 다른 경로(수동 `kubectl create configmap` 등)로 해결됐을 가능성.

### 현재 대응 (workaround, commit `aeeb173`에 포함)

`scripts/bootstrap/stages/70-monitoring.sh`가 loki helm install 직후 빈 ConfigMap을 선행 생성:

```bash
kubectl create configmap loki-alerting-rules -n monitoring \
  --from-literal=placeholder=none \
  --dry-run=client -o yaml | kubectl apply -f -
```

- loki-0 mount는 성공 (empty data라도 OK)
- alerting 기능은 비활성 상태 (rules 실제 내용 없음) — dev 환경에선 무관

### 근본 해결 방안 (후속)

세 가지 옵션 중 택일:

| 옵션 | 장단점 |
|------|--------|
| A. Goti-monitoring chart에 `loki-alerting-rules` ConfigMap template 추가 | SoT 명확. `Goti-monitoring/scripts/generate-k8s-loki-rules.sh` 산출물을 chart 안으로 옮기면 됨 |
| B. loki values에서 `loki.rulerConfig` 비활성화 | chart 없이 간단하나 alerting 기능 영구 포기 |
| C. 현재 workaround 유지 | 문제 발견 시 추적 어려움 — 권장 안 함 |

권장: **A**. 다음 세션에서 Goti-monitoring 레포 수정 → workaround 제거.

### 검증 방법

수정 후 clean kind cluster에서:
```bash
bash scripts/bootstrap-kind-dev.sh --cluster=goti-dev-v3
kubectl -n monitoring get pod loki-0
# Expected: 1/1 Running (Ready 안에 두 컨테이너 — loki + loki-sc-rules)
```

---

## 이슈 2 — Istio Gateway HTTP 80/443 listener 미반영

### 증상

```
$ curl -v -H "Host: dev.go-ti.shop" http://127.0.0.1/
* connect to 127.0.0.1 port 80 succeeded
* Recv failure: 상대편이 연결을 끊음
HTTP 000

$ kubectl -n istio-system exec istio-ingressgateway-xxx -- \
    curl -s http://127.0.0.1:15000/listeners
0.0.0.0_15090::0.0.0.0:15090     # stats
0.0.0.0_15021::0.0.0.0:15021     # health
# (HTTP 80 / HTTPS 443 listener 없음)
```

TCP 연결은 성공하지만 HTTP 요청 전송 직후 Envoy가 reset.
정상이라면 `0.0.0.0_80::0.0.0.0:80` 등 Gateway 리소스에 정의된 port가 보여야 함.

### 진단 포인트 (후속에서 확인)

1. **Gateway selector ↔ pod label 매칭**
   ```bash
   kubectl -n istio-system get gateway goti-shared-gateway -o yaml | yq .spec.selector
   # 기대: istio: ingressgateway
   kubectl -n istio-system get pod -l istio=ingressgateway
   # Label이 일치하는지
   ```
   `infrastructure/dev/istio/gateway/` chart의 pod label이 다른 형태(`app: istio-ingressgateway` 등)일 가능성.

2. **Gateway 리소스가 실제로 apply됐는지**
   ```bash
   kubectl -n istio-system get gateway goti-shared-gateway -o yaml
   # 존재 여부 + selector/servers 확인
   ```
   현재 `95-gateway.sh`가 chart 내부 template으로 이미 생성됨을 가정하고 skip한다 (`[ OK ] goti-shared-gateway — istio-ingressgateway chart에 포함됨`). 실제 chart template이 예상대로 동작하는지 검증 필요.

3. **istiod config push 상태**
   ```bash
   kubectl -n istio-system logs deploy/istiod | grep -i "gateway\|push"
   istioctl proxy-config listener istio-ingressgateway-xxx -n istio-system
   ```
   `istioctl proxy-config`가 기대 listener를 보여주는지.

4. **TLS credentialName `goti-tls` 부재 영향**
   - Gateway가 HTTPS 443에 `credentialName: goti-tls`로 secret 참조. 이 secret이 없으면 HTTPS listener는 생성 안 됨.
   - 그러나 HTTP 80 listener는 secret과 무관하게 생성되어야 함.
   - 혹시 Envoy가 "Gateway 전체를 파싱 실패"로 처리하면 두 listener 모두 drop 가능성 → istiod 로그 확인 필요.

### 가설

가장 유력: **Gateway selector mismatch**.
- `goti-shared-gateway.spec.selector.istio: ingressgateway` 는 Istio 공식 default이나,
- `infrastructure/dev/istio/gateway` chart가 pod label을 custom으로(`app: istio-ingressgateway` 등) 설정했을 가능성.

### 검증 후 조치

1. selector/label 확인
2. 불일치라면 Gateway 리소스의 `selector` 수정 → chart template 업데이트 → Goti-k8s 레포 commit
3. TLS secret `goti-tls`가 필요한지 판단 (HTTPS 경로 필요 시 — Cloudflare origin cert 등)
4. bootstrap `95-gateway.sh`의 fallback 경로도 동일 selector 사용하도록 맞춤

### 검증 방법

수정 후:
```bash
kubectl -n istio-system exec istio-ingressgateway-xxx -- \
  curl -s http://127.0.0.1:15000/listeners | grep "0.0.0.0_80"
# Expected: 0.0.0.0_80::0.0.0.0:80

curl -H "Host: dev.go-ti.shop" http://127.0.0.1/api/v1/baseball-teams
# Expected: HTTP 200 + JSON 응답
```

---

## 실패 유형 태그 (rules/debugging.md)

| 이슈 | 태그 |
|------|------|
| loki-alerting-rules | `context-missing` (dev-log 기록과 실제 chart 상태 불일치) |
| Gateway listener | `wrong-layer` (앱이 아니라 Istio Gateway config push), `env-difference` (chart가 기대한 pod label과 실제 불일치 가능성) |

## 우선순위

| 이슈 | 우선순위 | 근거 |
|------|----------|------|
| 1. loki ConfigMap | 낮음 | workaround 동작, 시연 영향 없음 |
| 2. Gateway listener | 높음 | 외부 트래픽이 이 경로로 들어와야 시연/영상 촬영 가능 |
