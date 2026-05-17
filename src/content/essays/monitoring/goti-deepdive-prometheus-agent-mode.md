---
title: "Prometheus Agent Mode — 로컬 TSDB를 버리고 remote_write 전용으로"
excerpt: "Prometheus Agent Mode가 로컬 TSDB를 제거해 WAL replay·compaction 부담을 없애고, 메모리를 대폭 절감하는 동작 원리를 설명합니다"
category: monitoring
tags:
  - go-ti
  - prometheus
  - agent-mode
  - remote-write
  - tsdb
  - wal
  - concept
series:
  name: "goti-deepdive-observability"
  order: 11
date: "2026-04-13"
---

## 한 줄 요약

> Prometheus Agent Mode는 로컬 TSDB를 완전히 제거하고 WAL을 재시도 버퍼로만 쓰는 `--enable-feature=agent` 플래그 하나로 전환하는 경량 수집 모드입니다

---

## 🤔 무엇을 푸는 기술인가

Prometheus는 기본적으로 수집(scrape)과 저장(로컬 TSDB)을 함께 수행하는 단일 프로세스입니다 스크레이프된 샘플은 WAL에 기록되고, Head Block으로 올라가 메모리에 인덱싱된 뒤, 주기적으로 on-disk TSDB 블록으로 compaction됩니다

이 구조는 Prometheus 단독 환경에서는 합리적입니다 로컬 쿼리 API(`/graph`, PromQL)로 직접 조회할 수 있고, 외부 의존성 없이 자급자족하기 때문입니다

그러나 **Mimir·Thanos 같은 분산 메트릭 백엔드가 이미 존재하는 환경**에서는 상황이 달라집니다

- Grafana는 Mimir만 바라봅니다 — Prometheus 로컬 쿼리 API는 실질적으로 아무도 쓰지 않습니다
- 같은 메트릭이 Prometheus 로컬 TSDB와 Mimir에 이중으로 저장됩니다
- WAL replay(재시작 시)와 compaction(주기적)이 메모리 피크를 만들어냅니다

**Agent Mode**는 이 이중 구조의 낭비를 없애기 위해 Prometheus v2.32에서 도입된 공식 기능입니다 로컬 TSDB를 제거하고 remote_write 전용 파이프라인만 남기는 모드 전환으로, Prometheus의 수집 역할은 그대로 유지하면서 저장 부담을 없앱니다

---

## 🔧 동작 원리

### Server Mode와 Agent Mode의 구조 차이

![Prometheus Server Mode vs Agent Mode 구조 비교|tall](/diagrams/goti-deepdive-prometheus-agent-mode-1.svg)

왼쪽 Server Mode는 스크레이프 후 WAL → Head Block → Compaction → On-disk TSDB 블록이라는 전체 TSDB 스택을 거칩니다 오른쪽 Agent Mode는 스크레이프 후 WAL 버퍼 하나만 거쳐 바로 remote_write로 보냅니다 TSDB 블록 전체가 제거됩니다

Server Mode에서 메모리를 많이 쓰는 두 지점이 있습니다

첫째는 **WAL replay**입니다 Prometheus Pod가 재시작될 때 디스크에 남아 있는 WAL 세그먼트를 전부 읽어 메모리 Head Block을 복원합니다 세그먼트가 많을수록(71개 이상이면) 재생 피크가 높아집니다

둘째는 **compaction**입니다 일정 시간마다 Head Block의 메모리 데이터를 on-disk 블록으로 병합·압축합니다 이 과정에서 원본 메모리와 새 블록 버퍼가 동시에 필요하므로 순간적인 메모리 스파이크가 발생합니다 active series가 많을수록(100K~300K 이상) 스파이크가 커집니다

Agent Mode는 이 두 지점을 구조적으로 제거합니다 on-disk TSDB 블록이 없으므로 compaction 자체가 없고, WAL은 전송 재시도 버퍼로만 쓰이므로 replay할 대용량 세그먼트가 쌓이지 않습니다

### WAL의 역할 변화 — 전송 버퍼로의 전환

Agent Mode에서도 WAL은 살아있습니다 그러나 역할이 완전히 다릅니다

Server Mode WAL은 "로컬 TSDB 복원용 영구 기록"입니다 블록으로 compaction되기 전까지 모든 샘플을 보관하므로, 기본 설정에서 2시간치 데이터가 WAL에 남아 있습니다

Agent Mode WAL은 "remote_write 재시도용 최소 버퍼"입니다 샘플이 Mimir에 성공적으로 전달되는 순간, 해당 WAL 세그먼트가 트런케이트됩니다 Mimir가 일시 장애로 수신 불가 상태가 되면 WAL이 그 구간만큼 잠시 쌓이고, 회복되면 즉시 재전송 후 트런케이트합니다

이 메커니즘이 메모리 절감의 핵심입니다 active series가 100K~300K여도 WAL에는 "전송 대기 중인 최소한의 샘플"만 존재하므로, 세그먼트 누적이 구조적으로 발생하지 않습니다

### WAL 트런케이트와 재시도 동작 흐름

![Agent Mode WAL 경량 버퍼 동작 흐름|tall](/diagrams/goti-deepdive-prometheus-agent-mode-2.svg)

위 다이어그램은 Agent Mode의 샘플 생애주기를 보여줍니다

정상 경로(위)에서 샘플은 스크레이프 → WAL 기록 → remote_write 즉시 전송의 단순한 흐름을 따릅니다 Mimir가 200 OK를 반환하는 순간 WAL 세그먼트가 트런케이트됩니다 메모리에 남는 것은 현재 전송 중인 배치뿐입니다

실패 경로(아래)에서 Mimir가 5xx나 타임아웃을 반환하면 WAL이 그 샘플을 보관하고 지수 백오프로 재전송을 시도합니다 Mimir가 회복되면 재전송 후 트런케이트합니다 이 "실패 버퍼" 구간에서만 WAL이 일시적으로 커집니다

Server Mode와의 비교를 정리하면: Server Mode는 WAL이 항상 2시간치 누적 상태이고 compaction 피크가 주기적으로 발생합니다 Agent Mode는 WAL이 "현재 전송 대기 중"인 최소 분량만 유지하고 compaction 피크가 없습니다 이 구조 차이가 약 70% 메모리 절감(4 Gi → ~1.2 Gi)으로 이어집니다

### 쿼리 API 비활성화

Agent Mode는 Prometheus의 쿼리 엔드포인트(`/api/v1/query`, `/graph`, TSDB HTTP API 전체)를 비활성화합니다 로컬 TSDB가 없으므로 쿼리할 데이터 자체가 없기 때문입니다

ServiceMonitor, PodMonitor, PrometheusRule, Alertmanager와 같은 **scrape 설정은 그대로 동작**합니다 모드 전환이 수집 파이프라인에는 영향을 주지 않습니다

alerting rule evaluation은 주의가 필요합니다 Server Mode에서 Prometheus가 직접 수행하던 rule evaluation이 Agent Mode에서는 불가능합니다 Mimir ruler가 이 역할을 대신 수행해야 합니다 전환 전 `mimir-ruler`가 활성화되어 있는지, 기존 PrometheusRule이 Mimir ruler로 정상 동기화되는지 확인이 필요합니다

### 활성화 방법 — 단일 플래그

```bash
prometheus --enable-feature=agent
```

`kube-prometheus-stack` Helm chart에서는 `PrometheusSpec.enableFeatures` 필드로 전달합니다

```yaml
prometheus:
  prometheusSpec:
    enableFeatures:
      - agent
    retention: ""       # Agent Mode에서 무의미
    resources:
      requests: {cpu: 100m, memory: 512Mi}
      limits:   {cpu: 500m, memory: 1Gi}
```

`storageSpec` (PVC)도 제거 가능합니다 on-disk TSDB 블록을 저장할 필요가 없으므로 퍼시스턴트 볼륨 프로비저닝 비용도 사라집니다

`kube-prometheus-stack`이 Prometheus Operator 기반인 경우 `Prometheus` CRD의 `spec.mode: agent` 필드가 필요할 수 있습니다 차트 버전별로 지원 여부가 다르므로 릴리스 노트 확인이 필요합니다

---

## 📐 세부 동작과 옵션

### Server Mode vs Agent Mode 비교

| 항목 | Server Mode | Agent Mode |
|---|---|---|
| 로컬 TSDB | O (WAL + Head Block + on-disk 블록) | 없음 |
| WAL 역할 | 로컬 복원용 영구 기록 | remote_write 재시도 버퍼 |
| Compaction | 주기적 발생 (메모리 피크) | 없음 |
| 쿼리 API | 활성화 | 비활성화 |
| PVC | 필요 | 불필요 |
| rule evaluation | Prometheus 직접 수행 | Mimir ruler 필요 |
| 메모리 사용 | 높음 (active series에 비례) | 낮음 (전송 배치만) |
| 재시작 시 WAL replay | 전체 세그먼트 재생 | 미전송 배치만 재전송 |

### 전환 전 체크리스트

Agent Mode로 전환하기 전 확인해야 할 항목이 있습니다

**쿼리 datasource 확인**: Grafana 대시보드 panel 중 `datasource: Prometheus`로 직접 연결된 것이 있으면 전환 후 `No data`가 발생합니다 전환 전 전수 조사가 필요합니다 실제 운영에서 Grafana가 이미 Mimir만 바라보고 있다면 영향이 없습니다

**Mimir ruler 확인**: 기존에 PrometheusRule로 관리하던 alerting rule이 있으면, Mimir ruler가 활성화되어 있는지 그리고 rule이 동기화되는지 확인합니다

**dev 환경 선행 검증**: 전환 후 Mimir로의 remote_write가 정상 작동하는지, 대시보드가 정상인지, alert이 발화하는지 개발 환경에서 먼저 검증하는 것이 안전합니다

### 전환 시 발생하는 일시 블랙아웃

Server Mode → Agent Mode 전환 시 Prometheus StatefulSet이 재배포됩니다 이때 기존 로컬 TSDB에 있던 데이터(기본 2시간치)는 사라집니다

그러나 Mimir는 remote_write로 계속 데이터를 수신하고 있었으므로, Mimir 쪽에는 데이터가 완전히 보존됩니다 Grafana가 Mimir를 datasource로 바라보는 환경이라면 대시보드에 미치는 영향은 없습니다 전환 순간의 수초~수십 초 gap만 발생할 수 있습니다

---

## 🧩 go-ti에서는

go-ti는 2026-04-13 Go cutover 후 노드 rightsizing(12 → 8대) 과정에서 Prometheus pod이 노드 메모리를 98%까지 점유하는 문제를 겪었습니다 실측 3,981 Mi로 4 Gi 제한에 근접한 상태였고, 과거에는 메모리 limit을 2 Gi → 4 Gi로 올려 우회했지만 근본 해결이 아니었습니다

구조를 보면 Grafana는 이미 Mimir query-frontend만 datasource로 사용하고 있었습니다 즉 Prometheus 로컬 TSDB는 저장되고 있었지만 아무도 조회하지 않는 이중 저장 상태였습니다 Agent Mode 전환은 이 낭비를 제거하고, WAL replay·compaction 피크를 구조적으로 소멸시키는 결정이었습니다

전환 후 Prometheus 메모리 예상 사용량은 ~1.2 Gi(약 70% 절감)이며, 이는 노드 rightsizing 여유 확보와 spot 인스턴스 재축소 검토로 이어집니다 kube-prometheus-stack chart는 그대로 유지하고, ServiceMonitor·PodMonitor·Alertmanager 구성도 변경 없습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Prometheus Agent Mode 전환 — 이중 저장 제거와 메모리 절감](/essays/goti-prometheus-agent-mode-adr)에 정리했습니다

---

## 📚 핵심 정리

- Prometheus Agent Mode(`--enable-feature=agent`)는 로컬 TSDB(WAL replay 대상·Head Block·Compaction·on-disk 블록)를 제거하고 remote_write 전용 파이프라인만 남깁니다
- WAL은 "로컬 복원용 영구 기록"에서 "remote_write 재시도 버퍼"로 역할이 바뀝니다 전송 성공 즉시 트런케이트되어 세그먼트가 누적되지 않습니다
- compaction 피크와 WAL replay 피크가 구조적으로 소멸해 active series가 100K~300K인 환경에서 메모리를 약 70% 절감합니다
- 쿼리 API는 비활성화됩니다 Mimir·Thanos 같은 분산 백엔드가 이미 쿼리 타겟인 환경에서는 기능 손실이 없습니다
- alerting rule evaluation은 Agent Mode에서 수행 불가 — Mimir ruler가 이를 대신해야 하므로 전환 전 ruler 활성화 여부를 확인합니다
