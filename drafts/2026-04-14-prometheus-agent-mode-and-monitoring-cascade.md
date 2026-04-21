# 2026-04-14 Prometheus Agent Mode 전환 + Monitoring 복구 Cascade

## 배경

부하테스트 직전 모니터링 스택 점검. 두 가지 구조적 문제 드러남:
1. **Go cutover 후 Grafana 대시보드에 메트릭 안 뜸** (OTel collector endpoint 오타 + service.namespace 누락)
2. **monitoring stack 전체 Pending** (core 노드 CPU 87~97% 포화, 5개 pod 10분째 대기)

시작 시점: Prometheus 실측 2.77Gi / limit 4Gi (69%), CPU request 500m / actual 89m (5.6x 과할당). ADR 0011(Proposed)이 근본 해결책으로 이미 문서화되어 있었음 — 2026-04-13 rightsizing 세션의 Follow-up에 "Agent mode 전환 + Grafana 대시보드 영향 전수 확인 선행" 등재.

## 타임라인

### Step 1: OTel 라벨 매핑 고치기

prod Go pod 로그 다발: `traces export: name resolver error: produced zero addresses`.

원인 2건 식별:
- **Collector 이름 불일치**: Go values = `otel-collector.monitoring.svc.cluster.local:4317`, 실제 배포된 front collector = `otel-front-prod.monitoring.svc:4317` (Java Instrumentation CR 기준)
- **`service.namespace` 누락**: Java는 `OTEL_RESOURCE_ATTRIBUTES=service.namespace=goti,...` 로 Prometheus `job` 라벨이 `goti/goti-*`, Go는 미설정이라 `goti-stadium-go` 만 됨 → Grafana panel의 `job="goti/$service_name"` 쿼리 빈 결과.

수정 (prod 6 values.yaml):
- endpoint `otel-front-prod.monitoring.svc:4317`
- env `OTEL_RESOURCE_ATTRIBUTES="service.namespace=goti,deployment.environment.name=prod"`

커밋 `275ae04`. prod-gcp는 collector 미배포 상태로 건너뜀.

### Step 2: Agent mode 전환 결정

사용자 요청("지금 어차피 안 보여, 하면서 근본적으로 해결")으로 부하테스트 전 전환 진행. 사전 검증:
- ✅ `mimir-prod-ruler` 9시간째 Running (alert eval 전담 가능)
- ✅ Grafana `prometheusService: mimir-prod-query-frontend` (이미 Mimir만 쿼리)
- ✅ 대시보드 전수 조사 생략 (사용자 수용: 사용자가 "어차피 안 보여")

`values-stacks/prod/kube-prometheus-stack-values.yaml`:
- `enableFeatures: [agent]`
- `retention: ""`, `storageSpec` 제거
- resources: 150m/2Gi → 100m/512Mi req, 1/4Gi → 500m/1Gi limit
- GOMEMLIMIT 4GiB → 800MiB

커밋 `05f0b37`.

### Step 3: ArgoCD sync 블록 — NetworkPolicy 화이트리스트

sync 실패 메시지:
```
NetworkPolicy/kube-prometheus-stack-prod-grafana-image-renderer-ingress:
  resource networking.k8s.io:NetworkPolicy is not permitted in project monitoring
```

grafana-image-renderer subchart가 자동 NetworkPolicy를 생성하는데 monitoring AppProject `namespaceResourceWhitelist`에 미등록. 추가 (Goti-k8s `3e3ca64`). goti-projects ArgoCD app이 반영해야 하므로 hard refresh 필요.

### Step 4: Operator Pending → STS 갱신 불가 (데드락)

`kube-prometheus-stack-operator` 도 Pending. CPU 부족 → operator 기동 불가 → Prometheus STS spec 업데이트 못함 → 기존 Prometheus pod 여전히 500m request로 CPU 점유 → operator 여전히 Pending. 순환.

해결:
```
kubectl scale sts prometheus-kube-prometheus-stack-prod-prometheus --replicas=0
```

기존 Prometheus pod 종료 → 500m CPU 해제 → operator 스케줄 가능 → Prometheus STS 재생성 (Agent mode spec) → Prometheus pod Running.

이후 ASG scale-up 노드(`ip-10-1-2-37`)도 join하여 5개 Pending pod 순차 해소.

### Step 5: Agent mode OOMKill → limit 재조정

배포 직후 Prometheus CrashLoopBackOff. `describe pod` → `OOMKilled`. 1Gi limit이 WAL replay + 300K series 초기 scrape 피크를 흡수 못함 (실측 peak ~1.3Gi).

수정:
- limit 1Gi → 2Gi
- GOMEMLIMIT 800MiB → 1600MiB

커밋 `a53db01`. ArgoCD가 즉시 반영 안 해서 Prometheus CR 직접 patch로 반영 후 자동 sync 동기화.

실측 안정화: CPU 177m, Memory **492Mi / 2Gi** (이전 4Gi대비 **-88%**).

### Step 6: Grafana `$deployment` 변수 parse error

사용자 보고: "1:50 parse error: unexpected <op:>>" 팝업.

원인: `infra-pod-health.json`의 variable 쿼리를 Java 0/0 deployments 제외 목적으로 `label_values(kube_deployment_spec_replicas{namespace=~"$namespace"} > 0, deployment)` 로 수정했는데 (커밋 `1c46d13`), `label_values()`는 Prometheus `/api/v1/series` endpoint를 사용하며 이 endpoint는 **label matcher만 허용, 비교 연산자 거부**.

수정: `query_result()` + regex 추출로 변경 (커밋 `94b00e4`).
```
query: query_result(kube_deployment_spec_replicas{namespace=~"$namespace"} > 0)
regex: /deployment="([^"]+)"/
```

`query_result`는 instant query endpoint 사용해 연산자 지원. grafana + charts 2벌 동기화.

## 최종 상태

| 지표 | Before | After | Δ |
|---|---|---|---|
| Prometheus 메모리 (실측) | 2770Mi | **492Mi** | -82% |
| Prometheus CPU request | 500m | **100m** | -80% |
| Prometheus 메모리 limit | 4Gi | 2Gi | -50% |
| Pending monitoring pods | 5개 (10분+) | **0** | 해소 |
| Grafana `$deployment` 드롭다운 | Java 0/0 포함, 혼란 유발 | replicas>0만 노출 | clean |
| core 노드 CPU 포화 | 87~97% | 정상 | - |

## 교훈

1. **Agent mode는 CPU/메모리 모두 대폭 절감**. 이중 저장(Prometheus TSDB + Mimir) 제거가 주효. Grafana가 이미 Mimir만 쿼리하는 구조에서는 선택이 아니라 필수.
2. **Helm subchart의 자동 생성 리소스는 AppProject whitelist 먼저 확인**. grafana-image-renderer NetworkPolicy 같은 side-effect가 sync를 블록할 수 있음.
3. **CPU 부족 → operator 부족 → 기존 pod 유지 → CPU 부족** 데드락은 `kubectl scale sts --replicas=0`으로 순환 끊기. GitOps drift지만 operator가 즉시 되돌림.
4. **OOM으로 limit bump는 증상 대응이 아닌 경우도 있음**. Agent mode는 runtime peak 성격이 다름(TSDB compaction 없지만 초기 WAL replay + 300K scrape 피크는 여전).
5. **Grafana `label_values()` 내부 연산자 불가**. 대안은 `query_result()` + regex. 이 제약은 Prometheus `/api/v1/series` endpoint의 한계에서 나옴.

## Follow-up

- [ ] ADR 0011 status Proposed → Accepted 전환 (본 세션에서 실행됨)
- [ ] `dev` 환경에도 Agent mode 적용 여부 검토 (현재 prod만)
- [ ] `prod-gcp` OTel collector 미배포 상태 정리 — Go service traces export 실패 고정화 중
- [ ] Istio sidecar request 100m 재검토 (rightsizing 세션에서 이어진 TODO)

## 관련 커밋

- Goti-k8s `275ae04` — prod/otel: collector endpoint + service.namespace
- Goti-k8s `3e3ca64` — prod AppProject NetworkPolicy whitelist
- Goti-monitoring `05f0b37` — Prometheus Agent mode 전환
- Goti-monitoring `a53db01` — Agent mode OOM 대응 (1Gi→2Gi)
- Goti-monitoring `1c46d13` → `94b00e4` — `$deployment` 변수 수정 (시행착오 포함)

## 관련 문서

- [ADR 0011 Prometheus Agent Mode](../adr/0011-prometheus-agent-mode.md)
- [2026-04-13 노드 Rightsizing](2026-04-13-node-rightsizing-and-rebalancing.md)
