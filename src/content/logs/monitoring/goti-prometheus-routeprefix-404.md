---
title: "Alloy/Tempo remote_write 404: Prometheus routePrefix 함정"
excerpt: "Prometheus에 routePrefix를 설정하면 remote_write 엔드포인트 경로도 함께 바뀝니다 — Alloy와 Tempo에서 404가 발생한 원인과 해결을 정리합니다"
category: monitoring
tags:
  - go-ti
  - Prometheus
  - Grafana Alloy
  - Tempo
  - Remote Write
  - Troubleshooting
series:
  name: "goti-spring-otel"
  order: 2
date: "2026-03-13"
---

## 한 줄 요약

> Prometheus `routePrefix: "/prometheus"` 설정 시 remote_write 엔드포인트가 `/prometheus/api/v1/write`로 바뀝니다. Alloy와 Tempo가 `/api/v1/write`로 보내서 404가 발생했습니다

## Impact

- **영향 범위**: Alloy → Prometheus 메트릭 수집, Tempo → Prometheus span metrics 전송
- **증상**: Grafana에서 JVM 메트릭, Log Explorer 데이터, etcd 데이터 미표시
- **소요 시간**: 약 1시간
- **발생일**: 2026-03-13

---

## 🔥 상황: Grafana 대시보드가 텅 비어 있다

Kind 클러스터의 모니터링 스택에서 Grafana 대시보드를 확인했더니 여러 곳에서 데이터가 없었습니다.

- Log Explorer: 데이터 없음
- JVM Deep Dive: 메트릭 없음
- etcd: 데이터 없음

Alloy pod 로그를 확인해봤습니다:

```
level=error msg="non-recoverable error"
  component_id=prometheus.remote_write.default
  url=http://kube-prometheus-stack-dev-prometheus.monitoring.svc:9090/api/v1/write
  err="server returned HTTP status 404 Not Found: 404 page not found\n"
```

Tempo에서도 비슷한 에러가 나고 있었습니다:

```
level=info msg="Exporting failed. Will retry the request after interval."
  component_id=otelcol.exporter.otlp.tempo
  error="rpc error: code = Unavailable desc = connection refused"
```

핵심은 Alloy가 Prometheus에 remote_write를 보내는데 **404를 받고 있다**는 점입니다.

---

## 🤔 원인: routePrefix가 모든 API 경로를 바꾼다

### 가설 검증 과정

1. **Alloy/Loki/Tempo pod 문제?** → 기각. 모든 pod Running 상태, Loki 로그는 정상.
2. **Prometheus remote write receiver 미활성화?** → 기각. `enableRemoteWriteReceiver: true` 확인.
3. **Prometheus API 경로 불일치?** → 채택!

### 근본 원인

kube-prometheus-stack의 values를 확인해봤습니다:

```yaml
prometheusSpec:
  externalUrl: "/prometheus"
  routePrefix: "/prometheus"
```

이 설정으로 Prometheus 프로세스가 다음과 같이 시작됩니다:

```
/bin/prometheus --web.route-prefix=/prometheus --web.enable-remote-write-receiver ...
```

`routePrefix`를 설정하면 Prometheus의 **모든 API 경로** 앞에 prefix가 붙습니다.
remote_write 엔드포인트도 예외가 아닙니다.

| 설정 | remote_write 엔드포인트 |
|------|------------------------|
| routePrefix 없음 | `/api/v1/write` |
| routePrefix: `/prometheus` | `/prometheus/api/v1/write` |

Alloy와 Tempo는 여전히 `/api/v1/write`로 보내고 있었으니, 당연히 404가 나온 것입니다.

### 직접 검증

Prometheus pod 안에서 직접 확인했습니다:

```bash
# 404 — 경로가 틀림
$ kubectl exec prometheus-0 -- wget -qO- --post-data="" http://localhost:9090/api/v1/write

# 400 — 경로는 맞음 (빈 body라서 400이지만 경로 자체는 정상)
$ kubectl exec prometheus-0 -- wget -qO- --post-data="" http://localhost:9090/prometheus/api/v1/write
```

404와 400의 차이가 명확합니다.
404는 "그런 경로 없음", 400은 "경로는 맞는데 요청 본문이 잘못됨"입니다.

---

## ✅ 해결: remote_write URL에 prefix 추가

### Alloy 설정 수정

```yaml
# values-stacks/dev/alloy-values.yaml
# Before
- url = "http://...svc:9090/api/v1/write"
# After
+ url = "http://...svc:9090/prometheus/api/v1/write"
```

### Tempo 설정 수정

```yaml
# values-stacks/dev/tempo-values.yaml
# Before
- url: "http://...svc:9090/api/v1/write"
# After
+ url: "http://...svc:9090/prometheus/api/v1/write"
```

### docker-compose 환경은 유지

docker-compose의 Prometheus는 `routePrefix` 없이 동작하기 때문에, docker-compose용 설정(`alloy/config.alloy`, `tempo/tempo-config.yml`)은 기존 `/api/v1/write` 경로를 그대로 유지합니다.

| 환경 | routePrefix | remote_write URL |
|------|-------------|-----------------|
| Kind (K8s) | `/prometheus` | `/prometheus/api/v1/write` |
| docker-compose | 없음 | `/api/v1/write` |

이렇게 환경별로 URL이 다른 점을 놓치기 쉽습니다.

---

## 검증

수정 후 ArgoCD 자동 sync를 거쳐 배포됐습니다.

- Alloy → Prometheus remote_write 정상화: Alloy pod 로그에서 `404 Not Found` 에러 소멸
- Tempo → Prometheus remote_write 정상화: service-graphs, span-metrics 데이터 복구
- Grafana 대시보드: JVM 메트릭, Log Explorer 데이터 정상 표시

---

## 📚 배운 점

### routePrefix 설정 시 체크리스트

Prometheus에 `routePrefix`를 설정하면 UI뿐 아니라 **모든 API 엔드포인트**의 경로가 바뀝니다.
흔히 Ingress/리버스 프록시 연동을 위해 설정하는데, 이때 다음을 반드시 확인해야 합니다:

1. **remote_write client URL** (Alloy, Tempo, OTEL Collector 등)
2. **PromQL API URL** (Grafana datasource 등)
3. **AlertManager webhook URL** (알림 설정)

### 환경별 설정 차이를 문서화하라

docker-compose(로컬 개발)와 Kubernetes(클러스터) 환경에서 동일한 컴포넌트가 다른 URL을 사용할 수 있습니다.
이런 차이를 명시적으로 문서화하지 않으면 한쪽에서 수정할 때 다른 쪽을 빠뜨리기 쉽습니다.

### 404 vs 400 — 디버깅의 핵심

API 호출이 실패할 때 HTTP 상태 코드를 정확히 구분하는 것이 중요합니다.

- **404**: 경로 자체가 존재하지 않음 → URL 경로 문제
- **400**: 경로는 맞지만 요청이 잘못됨 → 페이로드/인증 문제
- **405**: 경로는 맞지만 HTTP 메서드가 틀림 → GET/POST 확인

이번처럼 빈 body로 테스트해서 400이 나오면, 경로가 맞다는 확신을 가질 수 있습니다.
