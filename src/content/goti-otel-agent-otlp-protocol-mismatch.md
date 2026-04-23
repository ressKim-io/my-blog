---
title: "OTel Java Agent 2.25.0 OTLP 프로토콜 불일치 — gRPC와 http/protobuf의 포트 함정"
excerpt: "에이전트를 2.25.0으로 올렸더니 기본 OTLP 프로토콜이 http/protobuf로 바뀌었는데 엔드포인트는 4317(gRPC)이라서, WARN 한 줄만 남기고 JVM 대시보드 전체가 40분 뒤 끊긴 사건입니다."
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

> OTel Java agent 2.25.0에서 기본 OTLP 프로토콜이 `grpc`에서 `http/protobuf`로 변경되었습니다. 엔드포인트를 4317(gRPC)에 그대로 둔 채로 업그레이드하니 exporter가 포트에 HTTP를 쏘아대며 전송에 실패했고, Grafana JVM Deep Dive 대시보드가 약 40분 뒤 조용히 끊겼습니다.

## 📊 Impact

- **영향 범위**: Goti-server dev 환경의 JVM 메트릭·트레이스·로그 수집이 전부 중단되었습니다.
- **체감 시점**: 에이전트가 기동한 뒤 대시보드 화면상 약 40분 경과 시점부터 No Data로 전환되었습니다.
- **발생일**: 2026-03-14

---

## 🔥 문제: JVM Deep Dive 대시보드가 조용히 끊겼습니다

### 기존 아키텍처 / 기대 동작

Kind 기반 K8s 개발 환경에서 OTel Operator와 `Instrumentation` CR로 Java auto-instrumentation을 구성해 두었습니다. Instrumentation CR이 init container를 통해 OTel Java agent를 주입하고, 에이전트는 Alloy의 OTLP receiver로 데이터를 흘려보냅니다.

구성은 다음과 같았습니다.

- OTel Java agent: 2.25.0 (Instrumentation CR로 init container 주입)
- Alloy OTLP receiver: 4317(gRPC) / 4318(HTTP) 동시 노출
- Instrumentation CR endpoint: `http://alloy-dev.monitoring.svc:4317`

에이전트 기동 후 메트릭·트레이스·로그가 모두 Alloy로 들어가고, Alloy가 Mimir·Tempo·Loki로 팬아웃하는 것이 기대 동작이었습니다.

### 발견한 문제

Grafana의 **JVM Deep Dive** 대시보드를 열어보니 메트릭, 트레이스, 로그 패널이 전부 No Data였습니다. Pod는 기동되어 있었고 에러 로그도 올라오지 않았기 때문에, 첫인상은 "대시보드 쿼리가 깨졌나?"였습니다.

Pod 기동 로그를 끝까지 따라가 보니 다음 WARN이 메트릭/트레이스/로그 exporter 각각에 대해 세 번 반복해서 출력되고 있었습니다.

```text
[otel.javaagent 2026-03-14 03:34:22:806 +0000] [main] WARN io.opentelemetry.exporter.otlp.internal.OtlpConfigUtil
  - OTLP exporter endpoint port is likely incorrect for protocol version "http/protobuf".
    The endpoint http://alloy-dev.monitoring.svc:4317 has port 4317.
    Typically, the "http/protobuf" version of OTLP uses port 4318.
```

메시지 자체가 이미 원인을 정확히 짚고 있었습니다. 에이전트가 자신을 `http/protobuf`로 인식하고 있으면서, 엔드포인트 포트는 gRPC용인 4317을 보고 있었던 것입니다.

**재현 조건**을 정리하면 다음과 같습니다.

- OTel Java agent 2.25.0
- `OTEL_EXPORTER_OTLP_PROTOCOL` 환경변수 **미설정**
- Endpoint 포트가 4317

이 세 가지가 모두 겹치면 발생합니다.

---

## 🤔 원인: 2.25.0에서 기본 프로토콜이 `http/protobuf`로 바뀌었습니다

### 진단 과정

다음 순서로 원인을 좁혀 갔습니다.

1. **Pod가 죽었는가?** — `kubectl get pods -n goti`로 확인했습니다. `2/2 Running` 상태였습니다. 기각했습니다.
2. **OTel init container 주입이 실패했는가?** — `kubectl describe pod`의 container 목록에서 `opentelemetry-auto-instrumentation-java`가 정상적으로 확인되었습니다. 기각했습니다.
3. **에이전트 환경변수가 비정상인가?** — `env`를 확인했습니다. `JAVA_TOOL_OPTIONS`에 `-javaagent` 경로가 포함되어 있었습니다. 에이전트 로딩 자체는 문제가 없었습니다.
4. **OTLP 전송 단계에서 실패하는가?** — Pod 기동 로그를 초기부터 다시 훑었습니다. 여기서 위의 WARN 메시지를 발견하고 채택했습니다.

### 근본 원인 (Root Cause)

**OTel Java agent 2.25.0부터 기본 OTLP 프로토콜이 `grpc`에서 `http/protobuf`로 변경되었습니다.**

버전별 동작을 비교하면 다음과 같습니다.

- 이전 버전: `OTEL_EXPORTER_OTLP_PROTOCOL` 미설정 시 기본값이 `grpc`였습니다. 엔드포인트 4317을 그대로 써도 gRPC로 정상 송신되었습니다.
- 2.25.0: 기본값이 `http/protobuf`로 변경되었습니다. 4317 포트로 HTTP 요청을 보내지만, Alloy의 4317은 gRPC receiver이기 때문에 프로토콜 레벨에서 매칭이 되지 않고 export가 실패합니다.

Alloy의 `otelcol.receiver.otlp`는 4317(gRPC)과 4318(HTTP)을 **서로 다른 리스너로 분리**해서 받습니다. 에이전트가 프로토콜을 `http/protobuf`로 판단했다면 엔드포인트도 4318이었어야 합니다. 포트와 프로토콜이 한 칸씩 어긋나면서 데이터가 사일런트하게 버려졌습니다.

에이전트가 친절하게 WARN을 남겨 주긴 했지만, 대시보드 No Data와 WARN 라인을 연결지으려면 Pod 기동 로그를 의식적으로 뒤져봐야 했습니다. 이번 건에서 대부분의 시간은 바로 그 "조용한 실패"를 의심하기까지 걸린 시간이었습니다.

---

## ✅ 해결: Instrumentation CR에 프로토콜을 명시했습니다

### 적용한 수정

Instrumentation CR의 `env`에 `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`를 명시했습니다.

```yaml
# infrastructure/opentelemetry-operator/config/instrumentation.yaml
env:
  - name: OTEL_EXPORTER_OTLP_PROTOCOL
    value: grpc
```

이후 새 환경변수를 적용하기 위해 Deployment를 다시 굴렸습니다.

```bash
$ kubectl rollout restart deployment/goti-server-dev -n goti
```

### 재현 확인

재시작 후 확인한 내용입니다.

- Pod 기동 로그에서 WARN 메시지가 완전히 사라졌습니다.
- Grafana의 JVM Deep Dive 대시보드에서 메트릭 수신이 재개되었습니다.
- 로그, 트레이스도 정상 수신을 확인했습니다.

---

## 📎 프로토콜 비교 — gRPC vs http/protobuf

| 비교 항목 | gRPC (4317) | http/protobuf (4318) |
|----------|-------------|----------------------|
| 프로토콜 | HTTP/2 멀티플렉싱 | HTTP/1.1 |
| 페이로드 | binary protobuf | binary protobuf (동일) |
| 연결 | 하나의 커넥션에서 스트리밍 | 요청마다 커넥션 오버헤드 |
| 지연 | 낮음 | 상대적으로 높음 |
| 적합 환경 | **내부 서비스 간 (K8s)** | 프록시/방화벽 뒤 (외부) |

두 프로토콜은 페이로드 형식이 동일한 binary protobuf이기 때문에 **데이터 표현은 같고 전송 계층만 다릅니다**. 따라서 어느 쪽을 고르든 수집된 데이터 품질에는 차이가 없습니다.

차이가 드러나는 지점은 전송 계층입니다. gRPC는 HTTP/2 위에서 단일 커넥션을 멀티플렉싱하기 때문에 메트릭·트레이스·로그를 꾸준히 밀어 넣는 에이전트 워크로드에 유리합니다. 반면 `http/protobuf`는 HTTP/1.1 기반이라 요청마다 커넥션 오버헤드가 추가로 붙습니다.

K8s 내부 통신에는 gRPC를 막는 프록시나 방화벽이 거의 없으므로 gRPC가 최적입니다. 그럼에도 2.25.0이 기본값을 `http/protobuf`로 바꾼 이유는 **외부 환경에서의 호환성** 때문입니다. 로드밸런서, WAF, CDN 같은 중간 장비 중에는 gRPC(HTTP/2 + 트레일러 헤더)를 제대로 처리하지 못하는 경우가 많습니다. 초기 설정만으로 "일단 어딘가로 데이터가 가는" 경험을 주려면 HTTP/1.1 기반이 더 안전합니다.

결과적으로 기본값은 외부 친화적으로 바뀌었지만, K8s 내부에서 Alloy로 직접 쏘는 구성은 명시적으로 `grpc`를 지정해 두는 편이 안전합니다.

---

## 🛰️ 텔레메트리 경로별 프로토콜 현황

| 경로 | 프로토콜 | 포트 | 비고 |
|------|----------|------|------|
| Java agent → Alloy (메트릭/트레이스/로그) | gRPC | 4317 | 이번 수정으로 명시 |
| Alloy → Mimir (메트릭) | Prometheus remote_write (HTTP) | 8080 | Mimir 표준, 변경 불필요 |
| Alloy → Tempo (트레이스) | gRPC | 4317 | 이미 gRPC 사용 중 |
| Alloy → Loki (로그) | OTLP HTTP | 3100 | Loki OTLP는 HTTP만 지원 |
| Java agent → Pyroscope (프로파일) | HTTP | 4040 | Pyroscope 자체 프로토콜 |

경로마다 고를 수 있는 프로토콜이 다른 이유가 있습니다. Alloy에서 Mimir로 메트릭을 넣을 때는 Prometheus `remote_write`가 표준이므로 HTTP를 씁니다. Tempo는 OTLP gRPC를 네이티브로 받기 때문에 그대로 gRPC를 유지합니다.

Loki는 상황이 조금 다릅니다. Loki의 OTLP 수신은 **HTTP 엔드포인트만 제공**하므로 Alloy에서 Loki로 보낼 때는 선택지가 없고 `otlphttp`를 써야 합니다. 혼동하기 쉬우니 "로그만 HTTP"라고 기억해 두면 편합니다.

Pyroscope는 OTLP가 아니라 자체 HTTP 프로파일 프로토콜을 사용합니다. 따라서 에이전트에서 프로파일만 따로 Pyroscope로 직송하는 경로를 둡니다.

이번 WARN이 터진 지점은 표의 맨 첫 줄, `Java agent → Alloy` 구간입니다. 이 한 구간의 프로토콜이 엇나간 것만으로 JVM 대시보드 전체가 침묵했습니다.

---

## 🧭 아키텍처 다이어그램

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  goti namespace                                                         │
│                                                                         │
│  ┌─────────────────────────────────────┐                                │
│  │  goti-server Pod                    │                                │
│  │                                     │                                │
│  │  ┌───────────────────────────────┐  │                                │
│  │  │  OTel Java Agent 2.25.0       │  │                                │
│  │  │  (init container 주입)        │  │                                │
│  │  └──────┬───────┬───────┬────────┘  │                                │
│  │         │       │       │           │                                │
│  │  metrics│ traces│  logs │           │                                │
│  │  (gRPC) │(gRPC) │(gRPC) │           │                                │
│  │         │       │       │           │                                │
│  │  ┌──────┴───────┴───────┘           │                                │
│  │  │ Pyroscope SDK (HTTP)             │                                │
│  │  └──────┬──────────────────────────┐│                                │
│  └─────────┼──────────────────────────┘                                 │
│            │                                                            │
└────────────┼────────────────────────────────────────────────────────────┘
             │
             │  :4317 (gRPC)               :4040 (HTTP)
             │  ┌───────────┐              ┌──────────────┐
             ├─►│           │              │              │
             │  │   Alloy   │              │  Pyroscope   │
             └─►│           │              │              │
      profiles  │  (OTLP    │              │  (Continuous │
     ──────────►│ Collector)│              │  Profiling)  │
     :4040      └─────┬─────┘              └──────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
          ▼           ▼           ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │  Mimir   │ │  Tempo   │ │  Loki    │
   │          │ │          │ │          │
   │ Metrics  │ │ Traces   │ │  Logs    │
   │ Storage  │ │ Storage  │ │ Storage  │
   └────┬─────┘ └────┬─────┘ └────┬─────┘
        │            │            │
        │  remote    │  gRPC      │  OTLP
        │  write     │  :4317     │  HTTP
        │  :8080     │            │  :3100/otlp
        │            │            │
        └──────┬─────┴──────┬─────┘
               │            │
               ▼            │
        ┌────────────┐      │
        │  Grafana   │◄─────┘
        │            │
        │ Dashboards │  datasources:
        │            │  - prometheus (Mimir)
        │            │  - tempo
        │            │  - loki
        │            │  - pyroscope
        └────────────┘
```

통신 방향을 한 번 더 정리하면 다음과 같습니다.

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

다이어그램을 위에서 아래로 따라가면, 에이전트가 쏜 세 가지 텔레메트리(메트릭/트레이스/로그)는 모두 Alloy로 모인 뒤 Mimir·Tempo·Loki로 갈라집니다. Grafana는 이 세 저장소와 Pyroscope를 각각 별도 datasource로 물고 있으므로, 한 구간의 프로토콜만 엇나가도 대시보드 패널 전체가 동시에 침묵할 수 있는 구조입니다.

---

## 📚 배운 점

- **OTel 에이전트/SDK 업그레이드 시 기본값 변경을 반드시 CHANGELOG에서 확인합니다.** 이번 건은 마이너 버전 업그레이드임에도 기본 전송 프로토콜이 바뀌었습니다. 메이저 숫자만 보고 "minor면 안전"이라고 가정하면 같은 실수가 반복됩니다.
- **Instrumentation CR에 프로토콜·엔드포인트·포트를 항상 명시합니다.** 기본값에 의존하는 대신 `OTEL_EXPORTER_OTLP_PROTOCOL`과 endpoint를 둘 다 박아두면, 에이전트 버전을 올리더라도 전송 계층은 고정됩니다.
- **"포트 4317은 gRPC, 4318은 HTTP"를 습관으로 기억합니다.** OTLP 스펙의 기본 포트이며, Alloy를 비롯한 대부분의 OTLP receiver가 이 컨벤션을 따릅니다. 엔드포인트 포트와 프로토콜이 한 세트로 움직여야 합니다.
- **에이전트 기동 로그의 WARN을 절대 지나치지 않습니다.** 이번 건에서 에이전트는 "이 포트는 http/protobuf 기본값과 안 맞을 가능성이 높다"라고 정확히 경고했습니다. 대시보드 No Data를 만난 순간 가장 먼저 확인할 곳은 에이전트 기동 로그입니다.
- **관측성 파이프라인의 침묵은 장애보다 무섭습니다.** 에러 없이 그냥 데이터가 오지 않는 상태가 가장 오래 방치됩니다. "수집 파이프라인이 살아 있는지"를 확인하는 얕은 헬스 대시보드를 별도로 두는 것이 장기적으로 이득입니다.

---

## 관련 파일

- `Goti-k8s/infrastructure/opentelemetry-operator/config/instrumentation.yaml`
- `Goti-monitoring/values-stacks/dev/alloy-values.yaml`
