---
date: 2026-03-14
category: troubleshoot
project: Goti-k8s
tags: [otel, grpc, http-protobuf, alloy, jvm-metrics, protocol-mismatch]
---

# OTel Java agent 2.25.0 OTLP 프로토콜 불일치 — gRPC vs http/protobuf

## Context

Kind K8s 환경에서 OTel Operator + Instrumentation CR을 통한 Java auto-instrumentation 구성 완료 후,
Grafana JVM Deep Dive 대시보드에서 약 40분 이후 메트릭 수신이 중단되는 현상 발생.

- OTel Java agent: 2.25.0 (Instrumentation CR로 init container 주입)
- Alloy OTLP receiver: 4317(gRPC) / 4318(HTTP)
- Instrumentation CR endpoint: `http://alloy-dev.monitoring.svc:4317`

## Issue

JVM Deep Dive 대시보드에서 메트릭, 트레이스, 로그 데이터가 모두 수신되지 않음.

```
[otel.javaagent 2026-03-14 03:34:22:806 +0000] [main] WARN io.opentelemetry.exporter.otlp.internal.OtlpConfigUtil
  - OTLP exporter endpoint port is likely incorrect for protocol version "http/protobuf".
    The endpoint http://alloy-dev.monitoring.svc:4317 has port 4317.
    Typically, the "http/protobuf" version of OTLP uses port 4318.
```

동일 경고가 메트릭/트레이스/로그 exporter 각각에 대해 3회 반복 출력.

**재현 조건**: OTel Java agent 2.25.0 + `OTEL_EXPORTER_OTLP_PROTOCOL` 미설정 + endpoint 4317 포트 지정

## Action

### 진단 과정
1. **가설: pod가 죽었는가?** → `kubectl get pods -n goti` → `2/2 Running` 정상. 기각.
2. **가설: OTel init container 주입 실패?** → container 목록에 `opentelemetry-auto-instrumentation-java` 확인. 기각.
3. **가설: agent 환경변수 문제?** → env 확인, `JAVA_TOOL_OPTIONS`에 `-javaagent` 포함. 환경변수 정상.
4. **가설: OTLP 전송 실패?** → pod 시작 로그 확인 → **WARN 발견: http/protobuf 프로토콜이 4317 포트와 불일치**. 채택.

### 근본 원인 (Root Cause)

**OTel Java agent 2.25.0에서 기본 OTLP 프로토콜이 `grpc` → `http/protobuf`로 변경됨.**

- 이전 버전: `OTEL_EXPORTER_OTLP_PROTOCOL` 미설정 시 기본값 = `grpc` → 4317 포트 정상
- 2.25.0: 기본값 = `http/protobuf` → 4317(gRPC) 포트로 HTTP 요청 전송 → 프로토콜 불일치 → export 실패
- Alloy의 `otelcol.receiver.otlp`는 4317(gRPC) / 4318(HTTP) 각각 별도 포트로 수신

### 적용한 수정

Instrumentation CR에 `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` 명시:

```yaml
# infrastructure/opentelemetry-operator/config/instrumentation.yaml
env:
  - name: OTEL_EXPORTER_OTLP_PROTOCOL
    value: grpc
```

수정 후 `kubectl rollout restart deployment/goti-server-dev -n goti` 실행하여 새 환경변수 적용.

## Result

- 재시작 후 WARN 메시지 완전 소멸 확인
- JVM Deep Dive 대시보드 메트릭 수신 재개
- 로그, 트레이스도 정상 전송 확인

**재발 방지책**: Instrumentation CR에 프로토콜을 항상 명시적으로 설정.
OTel agent 버전 업그레이드 시 CHANGELOG에서 기본값 변경 확인 필수.

## 프로토콜 비교 — gRPC vs http/protobuf

| 비교 항목       | gRPC (4317)                   | http/protobuf (4318)          |
|----------------|-------------------------------|-------------------------------|
| 프로토콜        | HTTP/2 멀티플렉싱              | HTTP/1.1                      |
| 페이로드        | binary protobuf               | binary protobuf (동일)        |
| 연결            | 하나의 커넥션에서 스트리밍      | 요청마다 커넥션 오버헤드       |
| 지연            | 낮음                          | 상대적으로 높음                |
| 적합 환경       | **내부 서비스 간 (K8s)**       | 프록시/방화벽 뒤 (외부)        |

K8s 내부 통신에서는 gRPC 제약이 없으므로 gRPC가 최적.
`http/protobuf`가 기본값으로 변경된 이유: 외부 환경(LB, WAF, CDN)에서 gRPC 미지원 케이스가 많아서.

## 텔레메트리 경로별 프로토콜 현황

| 경로                                     | 프로토콜                      | 포트  | 비고                          |
|------------------------------------------|-------------------------------|-------|-------------------------------|
| Java agent → Alloy (메트릭/트레이스/로그) | gRPC                          | 4317  | 이번 수정으로 명시            |
| Alloy → Mimir (메트릭)                   | Prometheus remote_write (HTTP)| 8080  | Mimir 표준, 변경 불필요       |
| Alloy → Tempo (트레이스)                 | gRPC                          | 4317  | 이미 gRPC 사용 중             |
| Alloy → Loki (로그)                      | OTLP HTTP                     | 3100  | Loki OTLP는 HTTP만 지원       |
| Java agent → Pyroscope (프로파일)        | HTTP                          | 4040  | Pyroscope 자체 프로토콜       |

## 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────────┐
│  goti namespace                                                         │
│                                                                         │
│  ┌─────────────────────────────────────┐                                │
│  │  goti-server Pod                    │                                │
│  │                                     │                                │
│  │  ┌───────────────────────────────┐  │                                │
│  │  │  OTel Java Agent 2.25.0      │  │                                │
│  │  │  (init container 주입)       │  │                                │
│  │  └──────┬───────┬───────┬───────┘  │                                │
│  │         │       │       │          │                                │
│  │  metrics│ traces│  logs │          │                                │
│  │  (gRPC) │(gRPC) │(gRPC) │          │                                │
│  │         │       │       │          │                                │
│  │  ┌──────┴───────┴───────┘          │                                │
│  │  │ Pyroscope SDK (HTTP)            │                                │
│  │  └──────┬──────────────────────────┘                                │
│  └─────────┼──────────────────────────┘                                │
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
        │             │            │
        │  remote     │  gRPC      │  OTLP
        │  write      │  :4317     │  HTTP
        │  :8080      │            │  :3100/otlp
        │             │            │
        └──────┬──────┴──────┬─────┘
               │             │
               ▼             │
        ┌────────────┐       │
        │  Grafana   │◄──────┘
        │            │
        │ Dashboards │  datasources:
        │            │  - prometheus (Mimir)
        │            │  - tempo
        │            │  - loki
        │            │  - pyroscope
        └────────────┘
```

```
통신 방향 상세:

  Java Agent ──gRPC:4317──►  Alloy  ──remote_write:8080──► Mimir   (메트릭)
  Java Agent ──gRPC:4317──►  Alloy  ──gRPC:4317──────────► Tempo   (트레이스)
  Java Agent ──gRPC:4317──►  Alloy  ──OTLP HTTP:3100/otlp► Loki    (로그)
  Java Agent ──HTTP:4040──►  Pyroscope                              (프로파일)

  Grafana  ◄── query ── Mimir      (PromQL)
  Grafana  ◄── query ── Tempo      (TraceQL)
  Grafana  ◄── query ── Loki       (LogQL)
  Grafana  ◄── query ── Pyroscope  (profile query)
```

## Related Files

- `Goti-k8s/infrastructure/opentelemetry-operator/config/instrumentation.yaml`
- `Goti-monitoring/values-stacks/dev/alloy-values.yaml`
