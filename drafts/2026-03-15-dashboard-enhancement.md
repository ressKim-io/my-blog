---
date: 2026-03-15
category: meta
project: Goti-monitoring
tags: [grafana, dashboard, developer-experience, observability]
---

# Developer 대시보드 실무 고도화 — "어디 API에서 에러가 났는지" 찾을 수 있도록

## Context

기존 Developer 대시보드 4개(API RED, Distributed Tracing, Error Analysis, JVM Deep Dive)가 기본적인 메트릭만 보여주고 있어 실무 디버깅에 부적합했다. 핵심 문제: **"어디 API에서 에러가 났는지 찾기 힘들다"**, 트레이스가 trace ID 기반이라 API 엔드포인트 중심 탐색이 불가능했다.

## 개선 내용

### 목표 디버깅 워크플로우
```
Alert → API Health Matrix에서 문제 API 발견
     → Error Analysis에서 원인 좁히기
     → Logs에서 예외 확인
     → Trace에서 호출 체인 추적
     → JVM에서 리소스 상태 확인
     → Profiling에서 코드 레벨 병목 확인
```

### 대시보드별 개선

#### Error Analysis (가장 큰 개선)
- **API Error Heatmap**: 모든 엔드포인트별 RPS/5xx/4xx/에러율%/p99를 한 테이블에. 에러율 컬러 매핑 + 클릭 시 Tracing/Logs로 이동
- **Error Spike Detection**: 현재 에러율 vs 1h전 비교. 2배 이상이면 빨간색
- **에러 핑거프린팅**: Loki에서 `sum by (logger)` → 어떤 Java 클래스에서 에러가 많은지
- **에러율 추이**: 엔드포인트별 에러율 시계열 → "언제부터 이 API가 실패했나"

#### API RED Metrics
- **API Health Matrix**: RPS/Error%/p99/p50 by endpoint. 셀 컬러 매핑 + 클릭 시 Error Analysis/Tracing 이동. **"지금 어디가 문제인가"를 한눈에**
- **SLO 임계선**: p50/p95/p99 차트에 `vector(0.5)` = 500ms 목표선 추가
- **Recent Error Logs**: 대시보드 전환 없이 최근 에러 10줄 바로 확인

#### Distributed Tracing
- **http_route 필터**: API 엔드포인트 중심 트레이스 검색
- **인라인 트레이스 워터폴**: 화면 이동 없이 대시보드 안에서 span 타임라인 직접 확인
- **Service Dependency Graph**: Tempo serviceMap 기반 서비스 간 관계 시각화 (MSA 대비)
- **Correlated Logs**: ERROR/WARN 로그 → traceId 클릭으로 트레이스 연결

#### DB & Dependencies (신규)
- **Latency Breakdown**: API 응답시간 중 Server/DB/Redis/External 각각 차지하는 비율
- **Slow DB Query 목록**: TraceQL로 느린 쿼리 즉시 확인
- **Redis vs DB Latency 비교**: 둘 다 올라가면 전체 인프라 문제, 하나만이면 해당 dependency
- **HikariCP Connection Pool**: JVM에서 이동, 풀 고갈 위험 게이지

#### Continuous Profiling (신규)
- CPU/Memory/Lock/Wall Clock/Exceptions 5종 Flame Graph
- 각각 메트릭 추이(timeseries) + Flame Graph 쌍
- Pyroscope datasource 연동

#### JVM Deep Dive (최소 변경)
- instance 변수 (MSA 대비 pod별 필터)
- Uptime stat (최근 재시작 여부)

### Cross-Dashboard 연결
모든 대시보드 간 data link로 연결. 테이블 셀 클릭 시 관련 대시보드로 변수 전달되며 이동.

## 수치
- 대시보드: 4개 → 6개 (DB Dependencies, Continuous Profiling 신규)
- 패널: ~40개 → ~90개
- 변수: 4종 → 10종 (http_route, http_request_method, log_level, span_name 등)
