---
title: "버전을 올리자 텔레메트리가 조용히 끊겼다 — WARN 한 줄과 40분의 공백"
excerpt: "에이전트를 2.25.0으로 올렸더니 기본 OTLP 프로토콜이 http/protobuf로 바뀌었는데 엔드포인트는 4317(gRPC)이라서, WARN 한 줄만 남기고 JVM 대시보드 전체가 40분 뒤 끊긴 사건입니다"
category: monitoring
tags:
  - go-ti
  - Observability
  - OpenTelemetry
  - OTLP
  - Alloy
  - Grafana
  - troubleshooting
series:
  name: "goti-observability-ops"
  order: 2
date: "2026-03-14"
---

## 🎯 한 줄 요약

> OTel Java agent 2.25.0에서 기본 OTLP 프로토콜이 `grpc`에서 `http/protobuf`로 바뀌었습니다. 엔드포인트를 4317(gRPC)에 그대로 둔 채 올리니 exporter가 그 포트로 HTTP를 쏘며 전송에 실패했고, Grafana JVM Deep Dive 대시보드가 약 40분 뒤 아무 소리 없이 끊겼습니다

## 📊 Impact

- **영향 범위**: Goti-server dev 환경의 JVM 메트릭·트레이스·로그 수집 전면 중단
- **체감 시점**: 에이전트 기동 후 대시보드 기준 약 40분 뒤부터 No Data
- **발생일**: 2026-03-14

---

## 🔥 문제: JVM Deep Dive 대시보드가 소리 없이 끊겼습니다

### 기존 구성과 기대 동작

Kind 기반 K8s 개발 환경에서 OTel Operator와 `Instrumentation` CR로 Java auto-instrumentation을 걸어 뒀습니다

Instrumentation CR이 init container로 OTel Java agent를 주입하고, 에이전트가 Alloy의 OTLP receiver로 데이터를 흘려보내는 구조입니다

- OTel Java agent: 2.25.0 (Instrumentation CR로 init container 주입)
- Alloy OTLP receiver: 4317(gRPC) / 4318(HTTP) 동시 노출
- Instrumentation CR endpoint: `http://alloy-dev.monitoring.svc:4317`

에이전트가 뜨면 메트릭·트레이스·로그가 Alloy로 모이고, Alloy가 Mimir·Tempo·Loki로 나눠 보내는 것이 기대한 흐름이었습니다

### 발견한 문제

Grafana의 **JVM Deep Dive** 대시보드를 열었더니 메트릭과 트레이스, 로그 패널이 전부 No Data였습니다

Pod는 떠 있었고 에러 로그도 없었습니다. 그래서 처음에는 대시보드 쿼리가 깨진 줄 알았습니다

Pod 기동 로그를 처음부터 끝까지 훑고 나서야 WARN을 찾았습니다. 메트릭·트레이스·로그 exporter 각각에 대해 세 번 반복해 찍혀 있었습니다

```text
[otel.javaagent 2026-03-14 03:34:22:806 +0000] [main] WARN io.opentelemetry.exporter.otlp.internal.OtlpConfigUtil
  - OTLP exporter endpoint port is likely incorrect for protocol version "http/protobuf".
    The endpoint http://alloy-dev.monitoring.svc:4317 has port 4317.
    Typically, the "http/protobuf" version of OTLP uses port 4318.
```

메시지가 이미 원인을 정확히 짚고 있었습니다. 에이전트는 스스로를 `http/protobuf`로 알고 있는데, 바라보는 포트는 gRPC용 4317이었습니다

재현 조건은 셋입니다

- OTel Java agent 2.25.0
- `OTEL_EXPORTER_OTLP_PROTOCOL` 환경변수 **미설정**
- Endpoint 포트가 4317

세 가지가 겹치면 발생합니다

---

## 🤔 원인: 2.25.0에서 기본 프로토콜이 바뀌었습니다

### 진단 과정

이 순서로 좁혀 갔습니다

1. **Pod가 죽었는가** — `kubectl get pods -n goti`로 봤더니 `2/2 Running`이었습니다. 기각
2. **init container 주입이 실패했는가** — `kubectl describe pod`의 container 목록에 `opentelemetry-auto-instrumentation-java`가 정상적으로 들어가 있었습니다. 기각
3. **에이전트 환경변수가 잘못됐는가** — `env`를 봤더니 `JAVA_TOOL_OPTIONS`에 `-javaagent` 경로가 들어 있었습니다. 로딩 자체는 문제없었습니다. 기각
4. **전송 단계에서 실패하는가** — 기동 로그를 처음부터 다시 훑다가 위 WARN을 찾았습니다. 채택

### 근본 원인

**2.25.0부터 기본 OTLP 프로토콜이 `grpc`에서 `http/protobuf`로 바뀌었습니다**

버전별로 이렇게 갈립니다

- 이전 버전: `OTEL_EXPORTER_OTLP_PROTOCOL`을 안 넣으면 기본이 `grpc`였습니다. 4317을 그대로 써도 정상 송신됐습니다
- 2.25.0: 기본이 `http/protobuf`입니다. 4317로 HTTP 요청을 보내는데 Alloy의 4317은 gRPC receiver라 프로토콜 단계에서 어긋나 export가 실패합니다

Alloy의 `otelcol.receiver.otlp`는 4317(gRPC)과 4318(HTTP)을 서로 다른 리스너로 나눠 받습니다. 에이전트가 `http/protobuf`로 판단했다면 엔드포인트도 4318이었어야 합니다

포트와 프로토콜이 한 칸씩 어긋나면서 데이터가 아무 에러 없이 버려졌습니다

에이전트가 WARN을 남겨 주긴 했습니다. 그런데 대시보드 No Data와 그 WARN 한 줄을 연결하려면 Pod 기동 로그를 작정하고 뒤져야 합니다

이번 건에서 시간이 걸린 곳은 원인 파악이 아니라, 어디를 봐야 할지 의심하기까지의 구간이었습니다

---

## ✅ 해결: Instrumentation CR에 프로토콜을 명시했습니다

Instrumentation CR의 `env`에 `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`를 박았습니다

```yaml
# infrastructure/opentelemetry-operator/config/instrumentation.yaml
env:
  - name: OTEL_EXPORTER_OTLP_PROTOCOL
    value: grpc
```

새 환경변수를 태우려고 Deployment를 다시 굴렸습니다

```bash
kubectl rollout restart deployment/goti-server-dev -n goti
```

재시작 뒤 확인한 것은 셋입니다

- Pod 기동 로그에서 WARN이 사라졌습니다
- JVM Deep Dive 대시보드에 메트릭이 다시 들어왔습니다
- 로그와 트레이스도 정상 수신을 확인했습니다

---

## 📎 프로토콜 비교 — gRPC vs http/protobuf

| 비교 항목 | gRPC (4317) | http/protobuf (4318) |
|----------|-------------|----------------------|
| 프로토콜 | HTTP/2 멀티플렉싱 | HTTP/1.1 |
| 페이로드 | binary protobuf | binary protobuf (동일) |
| 연결 | 하나의 커넥션에서 스트리밍 | 요청마다 커넥션 오버헤드 |
| 지연 | 낮음 | 상대적으로 높음 |
| 적합 환경 | **내부 서비스 간 (K8s)** | 프록시·방화벽 뒤 (외부) |

둘은 페이로드가 똑같은 binary protobuf입니다. 데이터 표현은 같고 전송 계층만 다릅니다. 어느 쪽을 골라도 수집된 데이터 품질은 차이가 없습니다

갈리는 곳은 전송 계층입니다. gRPC는 HTTP/2 위에서 커넥션 하나를 멀티플렉싱하므로, 텔레메트리를 계속 밀어 넣는 에이전트 워크로드에 유리합니다. `http/protobuf`는 HTTP/1.1이라 요청마다 커넥션 비용이 붙습니다

K8s 내부에는 gRPC를 막는 프록시나 방화벽이 거의 없으니 gRPC가 낫습니다

그런데도 2.25.0이 기본값을 바꾼 이유는 외부 환경 호환성입니다. 로드밸런서나 WAF, CDN 중에는 gRPC의 HTTP/2와 트레일러 헤더를 제대로 다루지 못하는 장비가 많습니다. 설정 없이도 일단 데이터가 어딘가로 가는 경험을 주려면 HTTP/1.1 쪽이 안전합니다

기본값은 외부에 맞춰 바뀐 셈이니, K8s 안에서 Alloy로 직접 쏘는 구성이라면 `grpc`를 명시해 두는 편이 맞습니다

---

## 🛰️ 텔레메트리 경로별 프로토콜 현황

| 경로 | 프로토콜 | 포트 | 비고 |
|------|----------|------|------|
| Java agent → Alloy (메트릭/트레이스/로그) | gRPC | 4317 | 이번 수정으로 명시 |
| Alloy → Mimir (메트릭) | Prometheus remote_write (HTTP) | 8080 | Mimir 표준, 변경 불필요 |
| Alloy → Tempo (트레이스) | gRPC | 4317 | 이미 gRPC 사용 중 |
| Alloy → Loki (로그) | OTLP HTTP | 3100 | Loki OTLP는 HTTP만 지원 |
| Java agent → Pyroscope (프로파일) | HTTP | 4040 | Pyroscope 자체 프로토콜 |

경로마다 고를 수 있는 프로토콜이 다릅니다. Alloy에서 Mimir로 메트릭을 넣을 때는 Prometheus `remote_write`가 표준이라 HTTP를 씁니다. Tempo는 OTLP gRPC를 그대로 받으니 gRPC를 유지합니다

Loki만 사정이 다릅니다. Loki의 OTLP 수신은 HTTP 엔드포인트만 있어 선택지가 없습니다. 로그만 HTTP라고 외워 두면 헷갈리지 않습니다

Pyroscope는 OTLP가 아니라 자체 HTTP 프로파일 프로토콜을 씁니다. 그래서 에이전트에서 프로파일만 따로 직송하는 경로를 둡니다

이번에 어긋난 곳은 표의 첫 줄, `Java agent → Alloy` 한 구간입니다. 이 하나만으로 JVM 대시보드 전체가 비었습니다

---

## 🧭 아키텍처 다이어그램

![goti namespace 관측성 파이프라인 — Agent에서 Grafana까지](/diagrams/goti-otel-agent-otlp-protocol-mismatch-1.svg)

통신 방향을 다시 정리하면 이렇습니다

```text
  Java Agent ──gRPC:4317──►  Alloy  ──remote_write:8080──► Mimir   (메트릭)
  Java Agent ──gRPC:4317──►  Alloy  ──gRPC:4317──────────► Tempo   (트레이스)
  Java Agent ──gRPC:4317──►  Alloy  ──OTLP HTTP:3100/otlp► Loki    (로그)
  Java Agent ──HTTP:4040──►  Pyroscope                              (프로파일)

  Grafana  ◄── query ── Mimir      (PromQL)
  Grafana  ◄── query ── Tempo      (TraceQL)
  Grafana  ◄── query ── Loki       (LogQL)
  Grafana  ◄── query ── Pyroscope  (profile query)
```

에이전트가 쏜 세 가지 텔레메트리는 전부 Alloy로 모인 뒤 Mimir·Tempo·Loki로 갈라집니다

Grafana는 이 셋과 Pyroscope를 각각 별도 datasource로 물고 있습니다. 그래서 앞단 한 구간만 어긋나도 뒤쪽 패널이 한꺼번에 비는 구조입니다

---

## 📚 배운 점

- **OTel 에이전트를 올릴 때는 기본값 변경을 CHANGELOG에서 먼저 확인합니다**: 이번은 마이너 버전인데도 전송 프로토콜 기본값이 바뀌었습니다. 마이너면 안전하다고 가정하면 같은 일을 또 겪습니다
- **프로토콜·엔드포인트·포트를 CR에 항상 명시합니다**: 기본값에 기대지 않고 `OTEL_EXPORTER_OTLP_PROTOCOL`과 endpoint를 둘 다 박아 두면 버전을 올려도 전송 계층은 고정됩니다
- **4317은 gRPC, 4318은 HTTP를 습관으로 외웁니다**: OTLP 스펙의 기본 포트이고 대부분의 receiver가 이 관례를 따릅니다. 포트와 프로토콜은 한 세트로 움직여야 합니다
- **에이전트 기동 로그의 WARN을 흘려보내지 않습니다**: 이번에 에이전트는 포트가 안 맞을 가능성이 높다고 정확히 경고했습니다. 대시보드가 비면 가장 먼저 볼 곳은 에이전트 기동 로그입니다
- **에러 없이 멈추는 쪽이 더 오래 방치됩니다**: 무언가 터지면 바로 보이지만, 그냥 데이터가 안 오는 상태는 아무도 눈치채지 못합니다. 수집 파이프라인이 살아 있는지만 보는 얕은 헬스 대시보드를 따로 두는 편이 길게 보면 이득입니다

---

## 관련 파일

- `Goti-k8s/infrastructure/opentelemetry-operator/config/instrumentation.yaml`
- `Goti-monitoring/values-stacks/dev/alloy-values.yaml`
