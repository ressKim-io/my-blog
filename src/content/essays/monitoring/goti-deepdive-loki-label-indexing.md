---
title: "Grafana Loki — 레이블 인덱싱으로 로그를 싸게 저장하는 법"
excerpt: "Loki가 ELK와 달리 레이블만 인덱싱해 스트림 단위로 로그를 저장하는 구조, 인덱스가 원본보다 훨씬 작은 이유, LogQL로 원하는 스트림만 골라 읽는 쿼리 동작 원리를 설명합니다"
category: monitoring
tags:
  - go-ti
  - loki
  - label-indexing
  - logql
  - otlp
  - log-stream
  - concept
series:
  name: "goti-deepdive-observability"
  order: 3
date: "2026-03-27"
---

## 한 줄 요약

> Loki는 로그 원문을 토크나이즈하는 대신 레이블 조합(스트림 식별자)만 인덱싱하고, 로그 라인 자체는 압축 청크로 Object Storage에 저장해 인덱스 크기를 원본의 수 퍼센트 이하로 유지합니다

---

## 🤔 무엇을 푸는 기술인가

분산 시스템에서 로그를 중앙 집중 저장할 때 가장 먼저 부딪히는 문제는 **비용**입니다

로그는 메트릭이나 트레이스보다 데이터량이 압도적으로 많습니다 서비스 5개가 초당 수백 라인을 쏟아내면 하루에 수 GB가 쌓입니다 여기에 Elasticsearch 방식의 전문(full-text) 인덱싱을 적용하면 인덱스 자체가 원본과 맞먹는 크기를 가집니다 각 단어가 역 인덱스(Inverted Index) 엔트리를 만들기 때문입니다

**Grafana Loki**는 이 비용 구조를 근본적으로 바꿉니다 "어떤 로그인지"를 설명하는 레이블 메타데이터만 인덱싱하고, 로그 라인 자체는 압축 청크로 묶어 Object Storage에 밀어 넣습니다 인덱스 크기는 레이블 조합 수에만 비례하므로, 원본이 수 TB여도 인덱스는 수십 MB 수준에 머무를 수 있습니다

---

## 🔧 동작 원리

### 인덱싱 방식의 차이 — full-text vs 레이블

![인덱싱 방식 비교 — ELK full-text 인덱스 vs Loki 레이블 인덱스|tall](/diagrams/goti-deepdive-loki-label-indexing-1.svg)

왼쪽의 ELK(Elasticsearch)는 로그 원문을 분석(analyze) 단계에서 토크나이즈합니다 `"2026-03-27 ERROR payment timeout"` 같은 한 줄이 들어오면 `ERROR`, `payment`, `timeout`, `2026-03-27` 같은 토큰들이 각각 역 인덱스 엔트리를 생성합니다 결과적으로 인덱스 크기는 원본 텍스트 크기에 근접하며, 모든 단어에 대한 포인터가 메모리와 디스크를 함께 점유합니다 JVM 기반인 Elasticsearch는 이 인덱스를 메모리에 유지하기 위해 수 GB 단위의 힙이 필요하고, 가용성을 위해 3노드 이상의 클러스터 구성이 권장됩니다

오른쪽의 Loki는 접근 방식이 다릅니다 로그 라인 자체는 건드리지 않고 **레이블**(label) 집합만 추출합니다 `{app="payment", level="error", namespace="goti-prod"}` 같은 키-값 쌍이 레이블입니다 이 레이블 조합이 **스트림**(stream)을 정의합니다 같은 레이블 조합에서 오는 로그 라인들은 하나의 스트림으로 묶이고, 시간 순으로 정렬된 뒤 gzip이나 snappy로 압축한 **청크**(chunk) 파일로 Object Storage에 저장됩니다

**인덱스에는 스트림 식별자(레이블 조합)와 청크 파일 위치 정보만 들어갑니다** 전체 로그 원문이 인덱스에 기록되지 않으므로, 인덱스 크기는 스트림 수에 비례합니다 스트림이 100개라면 인덱스 엔트리도 100개 규모입니다 원본 데이터가 TB 단위여도 인덱스는 수십 MB 수준에 머물 수 있는 이유입니다

### 스트림 정의와 LogQL 쿼리 흐름

![Loki 스트림 → 청크 → LogQL 처리 흐름|tall](/diagrams/goti-deepdive-loki-label-indexing-2.svg)

스트림은 레이블 조합이 달라지는 순간 새로 생성됩니다 `{app="payment", level="error"}`와 `{app="payment", level="info"}`는 서로 다른 스트림입니다 `app`만 다른 `{app="ticketing", level="error"}`도 별개의 스트림입니다 스트림 수는 레이블 값의 카디널리티(cardinality)에 직접 비례합니다

LogQL 쿼리가 실행될 때 Loki는 세 단계로 처리합니다

**첫째, 스트림 셀렉터로 대상 청크를 좁힙니다** `{app="payment"} |= "ERROR"` 같은 쿼리에서 중괄호 안의 레이블 표현식(`{app="payment"}`)이 스트림 셀렉터입니다 Loki는 인덱스를 조회해 이 레이블 조합에 매칭되는 스트림과 그 청크 파일 위치만 확인합니다 다른 스트림의 청크 파일에는 접근하지 않습니다

**둘째, 매칭된 청크 파일만 Object Storage에서 읽어 압축을 해제합니다** 전체 데이터를 스캔하는 것이 아니라 해당 스트림이 담긴 청크 파일 목록만 순차적으로 fetch합니다

**셋째, 청크 내에서 전문 필터링을 적용합니다** `|= "ERROR"` (문자열 포함), `|~ "timeout.*payment"` (정규식), `!= "health"` (문자열 제외) 같은 라인 필터가 이 단계에서 동작합니다 CPU를 사용하지만 스캔 범위가 이미 레이블로 좁혀져 있으므로, ELK의 전체 인덱스 조회보다 처리 대상이 크게 줄어 있습니다

이 구조 덕분에 Loki는 "넓게 저장하고 좁게 읽는" 패턴에서 비용 효율이 높습니다 로그를 쌓을 때는 압축·저렴한 Object Storage를 사용하고, 읽을 때는 레이블로 범위를 좁혀 필요한 청크만 가져옵니다

### 압축 청크와 Object Storage 경로

Loki가 청크를 Object Storage에 저장하는 경로는 다음 형태입니다

```text
{tenant-id}/
  chunks/
    {stream-fingerprint}/
      {from-to-timestamp}.chunk
  index/
    {period}/
      {table-name}
```

스트림 핑거프린트는 레이블 조합의 해시값입니다 같은 레이블 조합의 로그는 항상 같은 경로 하위에 쌓입니다 인덱스 테이블은 설정한 기간(기본 24시간)마다 새로운 파티션으로 생성됩니다 이 설계 덕분에 특정 날짜 이전 데이터를 삭제하거나 티어링(tiering)할 때 인덱스 테이블 단위로 처리할 수 있습니다

청크 압축률은 로그 내용에 따라 크게 다르지만, 반복 패턴이 많은 구조화된 로그에서 gzip은 원본 대비 10배 내외의 압축률을 보입니다 1GB 로그 원문이 약 100MB 청크 파일로 저장됩니다

### 레이블 카디널리티 — 핵심 운영 원칙

레이블 인덱싱 모델의 효율은 레이블 카디널리티를 낮게 유지하는 데 달려 있습니다

레이블 값이 무한히 늘어날 수 있는 항목을 레이블로 쓰면 스트림이 폭발합니다 예를 들어 `user_id`, `trace_id`, `request_id` 같은 고유 식별자를 레이블로 등록하면, 요청 하나마다 새로운 스트림이 생성됩니다 스트림이 수천만 개로 늘어나면 인덱스도 그만큼 커지고 성능이 저하됩니다

레이블에 적합한 값의 기준은 명확합니다 — **값의 종류가 예측 가능하고 고정된 집합에 속할 때**만 레이블로 씁니다

```text
좋은 레이블 예시:
  app         →  "payment", "ticketing", "user" (서비스 수만큼 고정)
  level       →  "debug", "info", "warn", "error", "fatal" (5개 고정)
  namespace   →  "goti-prod", "goti-dev" (환경 수만큼 고정)
  job         →  "alloy", "loki" (컴포넌트 수만큼 고정)

나쁜 레이블 예시 (고카디널리티):
  trace_id    →  요청마다 고유값 → 스트림 폭발
  user_id     →  사용자마다 고유값 → 스트림 폭발
  request_id  →  요청마다 고유값 → 스트림 폭발
```

`trace_id`처럼 고유 식별자는 레이블이 아닌 **로그 라인 본문**(structured log field)에 포함시킵니다 Loki는 `{app="payment"} | json | trace_id="abc123"` 처럼 라인 파서를 통해 본문 필드로 필터링할 수 있습니다 이 경우 스트림은 늘어나지 않지만 쿼리 시 해당 청크 내 전문 스캔이 필요하므로 느립니다 용도에 따라 레이블 vs 라인 본문을 구분해 써야 합니다

### OTLP native 수집과 자동 레이블

Loki v2.9 이후로 OTLP 엔드포인트를 네이티브로 지원합니다 OTel Collector나 Grafana Alloy가 OTLP 포맷으로 로그를 전송하면, Loki가 OTLP Resource Attributes를 레이블로 자동 변환합니다

```text
OTLP Resource Attributes → Loki 레이블 매핑 (기본값):
  service.name    →  detected_service_name  (자동)
  service.version →  (라인 본문에 포함)
  level / severity →  detected_level        (자동)
```

`detected_service_name`과 `detected_level`은 OTLP 로그에서 자동으로 추출되는 레이블입니다 별도 파이프라인 설정 없이 `{detected_service_name="goti-payment"} |= "ERROR"` 같은 쿼리가 바로 동작합니다 Prometheus가 `__name__` 레이블로 메트릭을 분류하듯, Loki는 `detected_service_name`으로 서비스별 로그를 스트림 단위로 자연스럽게 분리합니다

---

## 📐 세부 동작과 옵션

### LogQL 파이프라인 구조

LogQL은 스트림 셀렉터 뒤에 파이프(`|`)로 처리 단계를 연결합니다

| 단계 | 예시 | 설명 |
|---|---|---|
| 스트림 셀렉터 | `{app="payment"}` | 레이블로 스트림 선택 (인덱스 조회) |
| 라인 필터 | `\|= "ERROR"` | 문자열 포함 필터 |
| 파서 | `\| json` | 구조화 로그 파싱 (JSON/logfmt) |
| 레이블 필터 | `\| level="error"` | 파서로 추출한 필드 필터 |
| 메트릭 쿼리 | `rate(...[5m])` | 로그 라인 수를 메트릭으로 변환 |

파서 단계(`| json`, `| logfmt`)를 통과하면 로그 라인 본문의 JSON 키가 임시 레이블로 추출됩니다 이후 `| level="error"`처럼 레이블 필터로 원하는 항목만 골라낼 수 있습니다 파서를 쓰면 유연하지만 레이블 인덱스를 활용하지 못하고 전문 스캔이 일어나므로, 스트림 셀렉터로 범위를 충분히 좁힌 다음 파서를 적용하는 순서가 성능에 중요합니다

### ELK·Splunk·Loki 핵심 차이

| 항목 | ELK | Splunk | Loki |
|---|---|---|---|
| 인덱싱 방식 | full-text (역 인덱스) | full-text | 레이블만 |
| 인덱스 크기 | ≈ 원본 크기 | 원본보다 큼 | 원본의 수% 이하 |
| 스토리지 백엔드 | 로컬 / S3 (유료) | 로컬 / 클라우드 | Object Storage (S3 등) |
| 쿼리 언어 | KQL / Lucene | SPL | LogQL (PromQL 유사) |
| OTLP 네이티브 | Exporter 필요 | Exporter 필요 | v2.9+ 네이티브 |
| Grafana 통합 | 플러그인 | 플러그인 | 네이티브 datasource |
| 리소스 사용 | 높음 (JVM 기반) | 높음 | 낮음 (Go 기반) |
| 라이선스 | OSS (Basic) / 유료 | 유료 | AGPLv3 (무료) |

ELK는 전문 검색 성능에서 Loki를 앞섭니다 로그 본문의 임의 단어를 색인해 즉각 조회하는 용도라면 여전히 강력합니다 Loki는 "레이블로 범위를 좁혀 읽는" 패턴에 최적화되어 있으므로, 레이블 설계가 쿼리 성능을 결정합니다

---

## 🧩 go-ti에서는

go-ti 관측성 스택에서 Loki는 로그 백엔드를 담당합니다 Alloy Agent(DaemonSet)가 OTLP gRPC(4317) 엔드포인트로 로그를 수신한 뒤, Kafka 토픽 `otlp_logs`로 먼저 전송합니다 Alloy Gateway(StatefulSet)가 Kafka에서 소비해 Loki의 OTLP 엔드포인트로 밀어 넣습니다 메트릭과 달리 로그·트레이스는 부하테스트 5,000 VU 구간에서 버스트가 크기 때문에, Kafka 버퍼로 순간 spike를 흡수하는 설계입니다

레이블은 OTLP Resource Attributes에서 자동 추출된 `detected_service_name`과 `detected_level`을 주로 사용합니다 별도 Promtail이나 Fluent Bit 없이 Alloy 단일 에이전트로 메트릭·로그·트레이스를 모두 수집합니다 Grafana에서 메트릭 스파이크를 발견하면 같은 시간대의 `{detected_service_name="goti-ticketing"} |= "ERROR"` 쿼리로 바로 로그 드릴다운이 가능합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [관측성 스택 선택 — Grafana LGTM+ 스택을 택한 이유](/logs/goti-observability-stack-selection)에 정리했습니다

---

## 📚 핵심 정리

- Loki는 로그 원문 대신 레이블 조합(스트림 식별자)만 인덱싱해 인덱스 크기를 원본의 수% 이하로 유지합니다 로그 라인은 압축 청크로 Object Storage에 저장합니다
- 스트림은 레이블 조합이 달라지는 순간 새로 생성됩니다 레이블 카디널리티가 낮을수록 인덱스가 작고 성능이 좋습니다 `trace_id`, `user_id` 같은 고유값은 레이블이 아닌 로그 라인 본문에 넣어야 합니다
- LogQL 쿼리는 스트림 셀렉터로 대상 청크를 좁힌 뒤, 해당 청크 내에서 라인 필터와 파서를 적용하는 순서로 동작합니다 읽는 청크 수를 줄이는 것이 쿼리 성능의 핵심입니다
- OTLP native 수집(v2.9+)은 `detected_service_name`, `detected_level` 레이블을 자동 생성합니다 별도 파이프라인 설정 없이 서비스별·레벨별 필터링이 바로 동작합니다
- PromQL을 아는 사람이라면 LogQL을 빠르게 익힐 수 있습니다 스트림 셀렉터 문법이 PromQL의 레이블 매처와 동일하기 때문입니다
