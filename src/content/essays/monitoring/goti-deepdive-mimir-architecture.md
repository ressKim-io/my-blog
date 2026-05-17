---
title: "Grafana Mimir — Distributor·Ingester·Querier가 PromQL을 수평 확장하는 법"
excerpt: "Grafana Mimir가 메트릭 수신(Write Path)과 PromQL 처리(Read Path)를 컴포넌트 단위로 분리해 수평 확장하는 구조, Ingester replication N=3 HA, Object Storage 장기 보관, 멀티테넌시 동작 원리를 설명합니다"
category: monitoring
tags:
  - go-ti
  - mimir
  - prometheus
  - distributed-metrics
  - ingester-replication
  - object-storage
  - concept
series:
  name: "goti-deepdive-observability"
  order: 2
date: "2026-03-27"
---

## 한 줄 요약

> Grafana Mimir는 Prometheus remote_write를 수신하는 Write Path와 PromQL을 처리하는 Read Path를 독립 컴포넌트로 분리해, 각 경로를 별도로 수평 확장할 수 있는 분산 메트릭 백엔드입니다

---

## 🤔 무엇을 푸는 기술인가

Prometheus 단독 운영의 한계는 명확합니다 — 단일 Pod이기 때문에 스크레이프 대상이 늘수록 메모리와 CPU가 함께 증가하고, 수평 확장이 불가능합니다 디스크 장애가 생기면 수집한 메트릭 전체가 유실되고, 장기 보관을 위한 별도 솔루션이 없으면 기본 2주 보존 기간 이후 데이터가 삭제됩니다

또한 MSA 환경에서 서비스별 Prometheus를 독립 운영하면 "서비스 A의 레이턴시와 서비스 B의 에러율을 하나의 PromQL로 조회"하는 것이 구조상 어렵습니다

**Grafana Mimir**는 이 문제들을 컴포넌트 분리로 해결합니다 메트릭 수신·HA 복제·Object Storage 저장·PromQL 실행을 각각 다른 컴포넌트가 맡아, 병목 지점만 선택적으로 스케일 아웃할 수 있습니다

Thanos도 유사한 목표를 추구하지만 접근 방식이 다릅니다 Thanos는 기존 Prometheus Pod에 Sidecar를 붙이는 방식이라, Prometheus 자체가 전제 조건입니다 Mimir는 Prometheus 없이 remote_write 엔드포인트만으로 동작하므로, Prometheus를 수집 에이전트(Alloy 등)로 대체하고 싶을 때 더 자연스럽습니다

---

## 🔧 동작 원리

### Write Path — Distributor에서 Object Storage까지

![Mimir 컴포넌트 구조도 — Write Path와 Read Path 분리|tall](/diagrams/goti-deepdive-mimir-architecture-1.svg)

위 다이어그램은 Mimir의 핵심 구조인 Write Path(초록)와 Read Path(파랑)가 어떻게 분리되어 있는지를 보여줍니다

Write Path는 Alloy나 Prometheus가 `HTTP /api/v1/push` 엔드포인트로 보내는 remote_write 요청에서 시작됩니다 요청은 반드시 `X-Scope-OrgID` 헤더를 포함해야 하며, 이 값이 테넌트를 식별하는 키가 됩니다 멀티테넌시가 활성화된 Mimir에서는 이 헤더 없이 보내면 요청이 거부됩니다

**Distributor**는 Write Path의 첫 번째 컴포넌트입니다 샘플(타임스탬프·값·레이블 집합)을 수신해 두 가지 역할을 수행합니다 첫째, 중복 검증 — 동일 타임스탬프에 같은 레이블 집합이 이미 있으면 거부합니다 둘째, consistent hashing — 레이블 집합을 해시 링에 매핑해 어느 Ingester로 보낼지 결정합니다 이 해시 링 덕분에 같은 메트릭 시리즈(동일 레이블 집합)는 항상 같은 Ingester 그룹으로 라우팅됩니다 Distributor 자체는 상태를 갖지 않으므로 인스턴스를 자유롭게 추가·제거할 수 있습니다

**Ingester**는 Write Path의 핵심입니다 Distributor로부터 샘플을 받아 먼저 로컬 디스크의 WAL(Write-Ahead Log)에 기록합니다 동시에 메모리에도 적재해 빠른 최신 데이터 조회를 지원합니다 일정 시간이나 블록 크기에 도달하면 메모리 데이터를 TSDB 블록 포맷으로 직렬화해 Object Storage에 플러시합니다 Ingester가 재시작될 때는 WAL을 재생해 메모리를 복원하므로 짧은 중단 이후에도 데이터가 보존됩니다

**Compactor**는 Object Storage에 쌓인 TSDB 블록들을 주기적으로 병합(merge)하고 다운샘플링합니다 작은 블록이 시간이 지나면 더 큰 블록으로 합쳐져 쿼리 효율이 높아집니다 오래된 데이터는 해상도를 낮춰 저장 공간을 절약합니다

### Ingester Replication N=3 — HA 원리

![Ingester Replication N=3 HA 구조도|tall](/diagrams/goti-deepdive-mimir-architecture-2.svg)

Mimir의 HA는 Ingester를 N개(기본 3개) 복제 그룹으로 묶어 동일 샘플을 모두에 쓰는 방식으로 동작합니다

Distributor는 consistent hashing으로 담당 Ingester 그룹을 선택하면 그 중 N=3개 Ingester에 동일 샘플을 병렬 전송합니다 쓰기는 **write quorum** 기준으로 처리됩니다 — `(N/2)+1`개 이상의 Ingester가 성공 응답을 보내면 쓰기가 완료된 것으로 간주합니다 N=3이면 quorum은 2이므로, Ingester 하나가 장애 상태여도 나머지 두 복제본으로 쓰기가 정상 완료됩니다

위 다이어그램에서 Ingester-1이 OOMKilled 상태일 때를 가정하면, Distributor는 Ingester-0과 Ingester-2에 샘플을 전송하고 두 곳 모두 성공 응답을 반환합니다 quorum 조건인 2개를 충족하므로 클라이언트(Alloy)에는 성공이 반환됩니다 Ingester-1이 재시작되면 WAL을 재생해 빠진 구간을 채웁니다

읽기 역시 quorum 방식입니다 Querier가 여러 Ingester에 동시 쿼리를 보내 중복 제거 후 병합합니다 어떤 Ingester가 느리거나 장애 상태여도 나머지로부터 응답을 받아 결과를 완성합니다

이 구조 덕분에 Ingester 인스턴스 하나를 교체하거나 재시작하는 롤링 업그레이드 중에도 메트릭 수집이 중단되지 않습니다

### Read Path — PromQL 처리 흐름

Read Path는 Grafana가 보내는 PromQL 쿼리에서 시작합니다 쿼리는 다음 순서로 처리됩니다

1. **Query-Frontend**: 쿼리를 받아 시간 범위가 긴 경우 여러 서브쿼리로 분할(샤딩)합니다 결과 캐싱도 이 계층에서 처리됩니다 멀티테넌시 라우팅 — `X-Scope-OrgID` 헤더를 기준으로 테넌트별 쿼리를 격리합니다
2. **Querier**: 분할된 서브쿼리를 실제로 실행합니다 두 소스를 동시에 쿼리합니다 — Ingester 메모리(최신 N시간 데이터)와 Store-Gateway(Object Storage의 오래된 블록)
3. **Store-Gateway**: Object Storage의 TSDB 블록 인덱스를 메모리에 캐싱합니다 Querier가 특정 시간 범위를 요청하면 인덱스만 먼저 스캔해 관련 블록을 특정하고, 필요한 청크만 읽어옵니다 블록 전체를 다운로드하지 않으므로 네트워크 비용이 낮습니다

Querier는 두 소스에서 온 결과를 병합할 때 동일 타임스탬프·레이블에 대한 중복 샘플을 제거합니다 이 중복은 Ingester가 아직 플러시하지 않은 최신 데이터와 Object Storage에 이미 저장된 블록이 겹치는 구간에서 발생합니다

### 멀티테넌시 — X-Scope-OrgID

Mimir는 단일 클러스터에서 복수 테넌트의 메트릭을 격리하는 네이티브 멀티테넌시를 지원합니다 격리의 핵심은 HTTP 헤더 하나입니다

```text
X-Scope-OrgID: goti-ticketing
```

이 헤더가 모든 write와 query 요청에 포함됩니다 Distributor는 헤더 값을 메트릭 레이블 공간에 내포해 저장하고, Query-Frontend는 헤더 값으로 쿼리 범위를 제한합니다 테넌트 A가 쓴 메트릭은 테넌트 B의 쿼리로 절대 조회되지 않습니다

Object Storage 역시 `{tenant-id}/` 경로 접두어로 테넌트 데이터를 분리해 저장합니다

---

## 📐 세부 동작과 옵션

### Write Path 단계별 요약

| 단계 | 컴포넌트 | 상태 | 스케일 방향 |
|---|---|---|---|
| 수신·검증·라우팅 | Distributor | 무상태 | 수평 자유 |
| 복제·WAL·메모리 | Ingester | 유상태 (WAL) | 수평 (replication 고려) |
| 블록 병합·다운샘플 | Compactor | 무상태 | 단일 또는 소수 |
| 장기 저장 | Object Storage | 외부 | S3 정책으로 관리 |

Distributor는 무상태이므로 HPA(Horizontal Pod Autoscaler)로 스케일 아웃이 용이합니다 Ingester는 WAL을 가진 유상태 컴포넌트라 StatefulSet으로 운영하며, replication factor를 고려해 최소 `N=3` 이상을 유지합니다

### Prometheus 단독·Thanos와 핵심 차이

| 항목 | Prometheus 단독 | Thanos | Mimir |
|---|---|---|---|
| 수평 확장 | 불가 | Sidecar 기반 | 컴포넌트별 독립 스케일 |
| HA | 없음 | Replica + 쿼리 시 중복 제거 | Ingester replication N=3 |
| 장기 스토리지 | 로컬 디스크 | Object Storage | Object Storage |
| Prometheus 의존 | 필수 | 필수 (Sidecar 전제) | 없음 (remote_write만) |
| 멀티테넌시 | 없음 | 제한적 | 네이티브 (X-Scope-OrgID) |
| Kafka Ingest | 없음 | 없음 | 내장 (Ingest Storage) |

Thanos는 Prometheus Pod이 이미 있고 그 위에 장기 보관·글로벌 쿼리를 붙이려는 시나리오에 적합합니다 Mimir는 Prometheus를 에이전트 모드로만 쓰거나 Alloy 같은 수집기로 완전히 대체하고 싶을 때 선택합니다

### Object Storage 블록 구조

Mimir가 Object Storage에 저장하는 TSDB 블록은 다음 형태를 갖습니다

```text
{tenant-id}/
  01HQZ6.../
    chunks/      # 시계열 데이터 (압축된 바이너리)
    index        # 레이블·청크 위치 인덱스
    meta.json    # 블록 메타 (시간 범위·샘플 수·버전)
```

Store-Gateway는 `index`와 `meta.json`을 메모리에 캐싱합니다 쿼리가 들어오면 인덱스로 관련 청크 위치만 확인하고, 필요한 `chunks/` 파일 부분만 Object Storage에서 읽습니다

---

## 🧩 go-ti에서는

go-ti 관측성 스택에서 Mimir는 메트릭 백엔드를 맡았습니다 Alloy Agent(DaemonSet)가 ServiceMonitor 기반으로 각 서비스의 메트릭을 스크레이프한 뒤, Alloy의 `prometheus.remote_write` 컴포넌트가 Mimir Distributor의 `/api/v1/push` 엔드포인트로 직접 전송합니다 Prometheus 단독 운영과 달리 Prometheus Pod 자체는 배포하지 않습니다 — kube-prometheus-stack에서 Prometheus를 비활성화하고 ServiceMonitor CRD와 Alertmanager만 활용합니다

메트릭은 Kafka를 거치지 않고 Mimir로 직접 전송합니다 로그·트레이스와 달리 메트릭은 알림 지연이 30초 이내여야 해서 Kafka 버퍼를 넣으면 latency가 치명적이기 때문입니다 Kind 개발 환경에서는 Minio를 Object Storage로 사용하고, EKS 프로덕션 전환 시 S3로 교체할 예정입니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [관측성 스택 선택 — Grafana LGTM+ 스택을 택한 이유](/logs/goti-observability-stack-selection)에 정리했습니다

---

## 📚 핵심 정리

- Mimir는 Write Path(Distributor → Ingester → Object Storage)와 Read Path(Querier → Store-Gateway / Ingester)를 독립 컴포넌트로 분리해 각 경로를 별도로 수평 확장합니다
- Distributor는 무상태로 consistent hashing으로 Ingester를 선택하고 N=3 복제 전송합니다 write quorum `(N/2)+1`을 만족하면 쓰기가 완료됩니다 Ingester 하나가 장애여도 수집이 중단되지 않습니다
- Ingester는 WAL→메모리→Object Storage flush 순서로 내구성과 성능을 동시에 확보합니다 재시작 시 WAL 재생으로 데이터가 복원됩니다
- Store-Gateway는 Object Storage 블록 인덱스를 캐싱해, 쿼리 시 전체 블록 다운로드 없이 필요한 청크만 읽습니다
- `X-Scope-OrgID` 헤더로 단일 클러스터에서 복수 테넌트 메트릭을 완전 격리하는 네이티브 멀티테넌시를 지원합니다
