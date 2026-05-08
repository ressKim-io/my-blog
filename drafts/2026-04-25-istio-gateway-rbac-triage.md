# 2026-04-25 Istio Gateway RBAC 트리아지 — chart 버그 3건 수정

goti-dev-v2 bootstrap 직후 외부 HTTP 접근이 전부 실패하던 현상의 근본 원인 분석.
Gateway selector mismatch → AuthorizationPolicy namespace leak → Grafana VirtualService 잘못된 destination host. 총 3개 chart 버그를 연쇄적으로 발견/수정.

## 관련 commit / 문서

- `Goti-k8s@3ef6692` — fix(istio): kind-dev gateway selector + chart namespace leak 수정
- `docs/dev-logs/2026-04-25-kind-dev-bootstrap-ingress-loki-pending.md` — 선행 트리아지 (가설 수립 단계)
- `docs/dev-logs/2026-04-24-kind-dev-bootstrap.md` — bootstrap 세션 원본
- 검증 cluster: `kind-goti-dev-v2` (K8s 1.34.3)

---

## 증상 (REPRODUCE)

```bash
$ curl -v -H "Host: dev.go-ti.shop" http://127.0.0.1/
* Connected to 127.0.0.1 (127.0.0.1) port 80
* Recv failure: 상대편이 연결을 끊음
HTTP 000

$ istioctl proxy-config listener -n istio-system istio-ingressgateway-xxx
ADDRESSES PORT  MATCH DESTINATION
0.0.0.0   15021 ALL   Inline Route: /healthz/ready*
0.0.0.0   15090 ALL   Inline Route: /stats/prometheus*
# HTTP 80 listener 없음
```

TCP 연결은 성공하지만 Envoy가 즉시 reset. Listener 부재는 Gateway 리소스가 ingressgateway pod에 push되지 못했음을 의미.

---

## 가설-검증 루프

### H1: Gateway selector ↔ Pod label mismatch (confirmed)

**근거**: Istio ingress Gateway가 `spec.selector`로 특정 label을 가진 pod에 바인딩.

**검증**:
```bash
$ kubectl -n istio-system get gateway goti-shared-gateway -o jsonpath='{.spec.selector}'
{"istio":"gateway"}

$ kubectl -n istio-system get pod -l istio=ingressgateway --show-labels
istio-ingressgateway-xxx ... istio=ingressgateway,app=istio-ingressgateway,...
```

**결과**: confirmed. Gateway는 `istio: gateway`를 찾는데 pod label은 `istio: ingressgateway`.

**원인 심화**: `istio/gateway` subchart의 `_helpers.tpl` 확인:
```
istio: {{ (.Values.labels.istio | quote) | default (include "gateway.name" . | trimPrefix "istio-") }}
```
Helm release 이름 `istio-ingressgateway`에서 `istio-` prefix를 trim → 자동 label `ingressgateway`. 그런데 `shared-gateway.yaml` template은 `istio: gateway`를 하드코딩. 작성자가 subchart의 네이밍 규칙을 파악하지 못한 상태에서 작성한 것으로 추정.

**수정**: `shared-gateway.yaml` selector를 `istio: ingressgateway`로 변경. `helm upgrade` 후 listener 생성 확인.

```bash
$ istioctl proxy-config listener ...
0.0.0.0   80    ALL   Route: http.80     # 생성됨
```

### H2: ingressgateway pod에 적용된 AuthorizationPolicy가 외부 요청 거부 (confirmed)

**증상 전이**: listener 생성 후 curl이 403 RBAC denied 반환.
```
< HTTP/1.1 403 Forbidden
< server: istio-envoy
RBAC: access denied
```

**근거**: `istioctl x authz check`로 pod에 적용된 정책 확인.

**검증**:
```bash
$ istioctl x authz check istio-ingressgateway-xxx.istio-system
ACTION   AuthorizationPolicy                    RULES
ALLOW    allow-istio-gateway.istio-system       1
ALLOW    allow-kubelet-probes.istio-system      1
ALLOW    allow-prometheus-scrape.istio-system   1
ALLOW    deny-all.istio-system                  1
```

**결과**: confirmed. goti-policy chart의 AuthorizationPolicy들이 전부 istio-system namespace에 배포되어 ingressgateway pod에 적용됨. Istio AP semantics상 ALLOW 정책 존재 시 어떤 rule에도 매칭 안 되면 default deny → 외부 익명 HTTP 요청 거부.

**원인 심화**: `goti-policy/templates/*.yaml` 파일 검토 결과 모든 AP template에 `metadata.namespace` 미지정. Helm은 release namespace를 기본값으로 사용 → `istio-system`. 그러나 template 주석에는 "goti namespace 모든 워크로드에 대한 트래픽 거부"라고 명시되어 있어 작성 의도와 배포 결과 불일치. 원본 작성자는 chart가 goti namespace에 설치될 것으로 가정했거나, 또는 template 작성 시 namespace 선언을 누락.

**수정**: kind-dev 한정으로 values-dev.yaml에서 AP 전부 disable (`denyAll`, `allowGateway`, `allowKubeletProbes`, `allowIstiodJwks` + `allowPrometheus.authz`). PodMonitor/ServiceMonitor/PeerAuthentication(PERMISSIVE)은 유지하여 모니터링은 정상 동작. `allowPrometheus.enabled` flag는 monitoring 리소스(PodMonitor/ServiceMonitor) 제어와 AP 제어로 분리(`authz.enabled` sub-flag 추가).

### H3: Grafana VirtualService destination host 불일치 (confirmed)

**증상 전이**: Istio AP 정리 후 `dev.go-ti.shop/api/*`는 정상(400 MISSING_PARAMETER = app 도달). 그러나 `dev-monitoring.go-ti.shop`은 503.

**검증**:
```bash
$ kubectl -n monitoring get virtualservice grafana -o yaml | grep host
  host: kube-prometheus-stack-dev-grafana.monitoring.svc.cluster.local

$ kubectl -n monitoring get svc | grep graf
kps-grafana   ClusterIP   10.96.229.143   <none>   80/TCP
```

**결과**: confirmed. VirtualService가 존재하지 않는 service 참조. 실제 kube-prometheus-stack release 이름은 `kps`이므로 service 이름은 `kps-grafana`.

**원인 심화**: `mesh-policy/templates/grafana-virtualservice.yaml`에 host가 `kube-prometheus-stack-dev-grafana.monitoring.svc.cluster.local`로 하드코딩. 과거 release name이 다른 상태(`kube-prometheus-stack-dev`)에서 작성되었거나 release name 변경 후 VS 업데이트 누락.

**수정**: VS template의 host를 `kps-grafana.monitoring.svc.cluster.local`로 변경.

---

## 최종 검증

```bash
# 1. Gateway listener
$ istioctl proxy-config listener -n istio-system istio-ingressgateway-xxx
0.0.0.0   80    ALL   Route: http.80

# 2. istio-system AP 정리 확인
$ kubectl get authorizationpolicy -n istio-system
No resources found

# 3. 외부 API (backend 도달)
$ curl -s -H "Host: dev.go-ti.shop" "http://127.0.0.1/api/v1/baseball-teams?teamIds=1,2,3"
{"code":"INVALID_FORMAT","message":"teamIds 형식 오류"}

# 4. Grafana 302 /login
$ curl -sI -H "Host: dev-monitoring.go-ti.shop" http://127.0.0.1/
HTTP/1.1 302 Found
location: /login
```

---

## 실패 유형 태그

| 이슈 | 태그 | 근거 |
|------|------|------|
| Gateway selector | `wrong-layer` | 앱 에러로 보였지만 Istio Gateway 바인딩 레이어가 원인. `env-difference`도 관련(chart 작성자의 subchart 네이밍 가정과 실제 불일치) |
| AP namespace leak | `context-missing` | template 주석에는 goti namespace 의도가 기록되어 있으나 `metadata.namespace` 선언이 누락되어 실제 배포 위치 불일치. chart 작성/리뷰 시 렌더링 결과를 namespace 단위로 검증하는 과정 부재 |
| Grafana VS host | `context-missing` | kube-prometheus-stack release 이름 변경 이력이 chart와 synchronize되지 않음. 변경 이력 문서화 부재 |

---

## 후속 과제

### 즉시

- [ ] **prod에서는 chart 근본 수정 필요** — values-dev에서 AP disable한 것은 kind-dev 한정 workaround. prod는 allowlist security 모델이 살아있어야 하므로, template에 `namespace: goti` 명시하거나 chart를 goti namespace에 설치하도록 변경. `allow-jwks-public`/ServiceMonitor 등 istio-system에 있어야 하는 리소스는 분리.
- [ ] **chart 렌더링 검증 자동화** — `helm template` 산출물에서 각 리소스의 namespace 분포를 체크하는 linting 또는 test 추가. 이번과 같은 silent namespace leak 예방.

### 중기

- [ ] Grafana VS의 destination host를 values로 parameterize 하여 release name 변경에 유연하게 대응.
- [ ] mesh-policy chart와 bootstrap `95-gateway.sh`가 동일 VirtualService(`dev-monitoring-root` / `grafana`)를 중복 생성 — 하나로 통합 필요.

### 장기

- [ ] 이 트리아지는 가설 3개 모두 confirmed로 종결됐으나 증상→원인 거리가 층층이 달라 시간이 걸림. `debugging.md`의 "K8s 디버깅 트리아지" 섹션에 **listener 부재 → selector mismatch**, **RBAC denied → AP namespace 분포 확인** 패턴 추가 제안.

---

## 외부 접근 경로 상태 (kind-dev-v2 → internet)

`docs/architecture/network-paths.md` 기반 체크리스트:

| 레이어 | 상태 | 메모 |
|--------|------|------|
| ingressgateway Pod Envoy listener 80 | ✅ | 이번 수정으로 생성 |
| AuthorizationPolicy (istio-system) | ✅ | 정책 제거 완료 |
| VirtualService routing (goti/monitoring) | ✅ | Grafana host 수정 포함 |
| kind hostPort 80/443 → container 31080/31443 | ✅ | `kind-cluster-config.yaml` |
| iptime 공유기 포트포워딩 외부 → PC:80/443 | 수동 확인 필요 | `manual-configs.md` 기록 |
| Cloudflare DNS `dev/dev-monitoring.go-ti.shop` → public IP | 수동 확인 필요 | CF Dashboard |
| Cloudflare SSL mode (Flexible = origin HTTP) | 수동 확인 필요 | TLS secret `goti-tls` 부재 |

k8s/Istio 레이어는 전부 뚫렸다. 외부(브라우저)에서 `dev-monitoring.go-ti.shop`으로 접근하려면 위 표의 "수동 확인 필요" 3건이 구성돼 있어야 한다. Cloudflare origin이 HTTP 전용이라면 CF SSL mode는 Flexible이어야 함.
