# go-ti 기술 해설글 — 마스터 인벤토리

> Phase A 산출물 (2026-05-16 작성). ADR 28개의 결정 항목을 추출해 해설글 후보로 분류
> 계획: `/Users/ress/.claude/plans/lovely-percolating-finch.md`
> 상태: **Phase A 완료 — 승인 1 대기**. Phase B에서 우선순위 채점, Phase C에서 series 확정

## 요약

- ADR 28개(`drafts/0001~0025` + Kafka·Upstage·cross-cloud-promote)에서 결정 항목 약 100개 추출
- **KEEP 59편** — 해설글 후보 (결정 항목별로 잘게)
- **REVIEW 2건** — 승인 1에서 판정
- MERGE 27건 — 상위 KEEP 글에 흡수, DROP 26건 — 프로젝트 한정이라 일반 해설 불가

| 도메인 | KEEP | 카테고리 |
|---|---|---|
| 관측성 (TE-001~011) | 11 | monitoring |
| 서비스 메시·보안·인프라 (TE-012~020) | 9 | istio 4 / challenge 2 / cicd 1 / kubernetes 2 |
| 데이터베이스 (TE-021~031) | 11 | challenge |
| 캐시·티켓팅·런타임 (TE-032~051) | 20 | challenge 16 / kubernetes 1 / monitoring 3 |
| 아키텍처·메시징 (TE-052~059) | 8 | challenge 3 / istio 1 / argocd 1 / cicd 1 / kubernetes 2 |

`adr_date` = 해설글 frontmatter `date` (backdating 기준). `짝 ADR 글`은 상호 링크 대상 (e=essays, l=logs 트랙)

---

## 1. 관측성 — monitoring (TE-001 ~ TE-011)

| id | 해설 주제 | 출처 | adr_date | 짝 ADR 글 | 동작 원리 키워드 |
|---|---|---|---|---|---|
| TE-001 | Prometheus pull vs push 모델 | 0003 | 2026-03-27 | l:goti-metrics-collector-go-sidecar | pull scrape, /metrics, exporter 패턴, OTLP push 대비, ServiceMonitor |
| TE-002 | Mimir 분산 아키텍처 | 0004 | 2026-03-27 | l:goti-observability-stack-selection | Distributor/Ingester/Querier, replication N=3, S3 장기저장, 멀티테넌시 |
| TE-003 | Loki 레이블 인덱싱 구조 | 0004 | 2026-03-27 | l:goti-observability-stack-selection | 레이블 인덱싱 vs full-text, LogQL, 스트림, 압축 청크 |
| TE-004 | Tempo와 분산 트레이싱 | 0004 | 2026-03-27 | l:goti-observability-stack-selection | Exemplar, metrics_generator, TraceQL, tail sampling |
| TE-005 | 관측 파이프라인 Kafka 버퍼 | 0004,0007 | 2026-03-27 | e:goti-adr-alloy-to-otel-collector | 시그널별 백프레셔, 메트릭 직접/로그·트레이스 버퍼, 버스트 흡수 |
| TE-006 | 구조화 로깅 — logfmt vs JSON | 0006 | 2026-03-28 | e:goti-logging-convention-adr | logfmt key=value, Loki \| logfmt 파서, MDC trace_id |
| TE-007 | OTel Collector 파이프라인 | 0007 | 2026-03-29 | e:goti-adr-alloy-to-otel-collector | receiver/processor/exporter, ocb 빌드, OTLP |
| TE-008 | Kafka 컨슈머 백프레셔 (fetch_max) | 0008 | 2026-03-31 | e:goti-adr-loki-tempo-stability-tuning | consumer fetch, fetch_max, 재시작 OOM 사이클, retention 소화 |
| TE-009 | GOMEMLIMIT — Go 컨테이너 메모리 인지 | 0008 | 2026-03-31 | e:goti-adr-loki-tempo-stability-tuning | Go GC, soft memory limit, 컨테이너 limit 미인지 |
| TE-010 | OpenCost — K8s 비용 관측 | 0009 | 2026-04-02 | e:goti-finops-opencost-adoption-adr | cost allocation, Pricing API, predict_linear, Showback |
| TE-011 | Prometheus Agent Mode | 0011 | 2026-04-13 | e:goti-prometheus-agent-mode-adr | 로컬 TSDB 제거, remote_write only, WAL/compaction 소멸 |

## 2. 서비스 메시·보안·인프라 (TE-012 ~ TE-020)

| id | 해설 주제 | 출처 | cat | adr_date | 짝 ADR 글 | 동작 원리 키워드 |
|---|---|---|---|---|---|---|
| TE-012 | Istio 서비스 메시 동작 원리 | 0001 | istio | 2026-03-14 | e:goti-adr-istio-service-mesh | Envoy sidecar 주입, iptables, xDS, istiod 제어평면, CRD |
| TE-013 | Sidecar vs Ambient 데이터 플레인 | 0001 | istio | 2026-03-14 | e:goti-adr-istio-service-mesh | ztunnel L4, Waypoint L7, 관측성 트레이드오프 |
| TE-014 | GitOps 이미지 자동 업데이트 | 0002 | cicd | 2026-03-16 | e:goti-container-image-update-strategy-adr | Renovate vs Image Updater vs CI Push, datasource, write-back |
| TE-015 | Cloudflare Pages+Workers 엣지 아키텍처 | 0005 | challenge | 2026-03-27 | l:goti-cloudflare-migration-adr | Pages 정적/Workers 동적, V8 isolate, SPA fallback 함정 |
| TE-016 | Cloudflare Workers Host 헤더 제약 | 0005 | challenge | 2026-03-27 | l:goti-cloudflare-migration-adr | fetch() Host 불변, Error 1003, 중간 도메인 우회 |
| TE-017 | Istio JWT 검증과 JWKS 배포 | 0010 | istio | 2026-04-12 | l:goti-jwks-distribution-automation-adr | RequestAuthentication, JWKS/kid/RS256, istiod fetch, STRICT mTLS 충돌 |
| TE-018 | JWT issuer 검증과 설정 우선순위 | 0015 | istio | 2026-04-17 | l:goti-jwt-issuer-sot-adr | iss claim 매칭, viper 우선순위, config drift, fail-fast |
| TE-019 | 서킷 브레이커 패턴 | 0016 | challenge | 2026-04-17 | l:goti-multicloud-circuit-breaker-hpa-adr | closed/open/half-open 상태머신, probe, AbortController |
| TE-020 | Kubernetes HPA 동작 원리 | 0016 | kubernetes | 2026-04-17 | l:goti-multicloud-circuit-breaker-hpa-adr | 제어 루프, desired replica 계산식, HPA vs KEDA |

## 3. 데이터베이스 — challenge (TE-021 ~ TE-031)

| id | 해설 주제 | 출처 | adr_date | 짝 ADR 글 | 동작 원리 키워드 |
|---|---|---|---|---|---|
| TE-021 | Read Replica와 read/write 분리 | 0012 | 2026-04-14 | l:goti-read-replica-split-adr | 비동기 복제, 복제 지연, read-your-write, 쿼리 라우팅 |
| TE-022 | PgBouncer 커넥션 풀링 | 0013 | 2026-04-14 | l:goti-pgbouncer-connection-pooling-adr | connection multiplexing, pool_mode 3종, idle 연결 비용 |
| TE-023 | transaction pooling이 깨뜨리는 것 | 0013 | 2026-04-14 | l:goti-pgbouncer-connection-pooling-adr | prepared statement 충돌, LISTEN/NOTIFY, advisory lock, pgx |
| TE-024 | pglogical 논리 복제 | 0018 | 2026-04-18 | l:goti-multicloud-db-replication-technology-adr | 논리 디코딩, 복제 슬롯, publication/subscription, 충돌 해소 |
| TE-025 | PostgreSQL 물리 복제 vs 논리 복제 | 0018 | 2026-04-18 | l:goti-multicloud-db-replication-technology-adr | WAL streaming, physical slot, 버전·플랫폼 제약 |
| TE-026 | Active-Passive 복제 토폴로지 | 0019 | 2026-04-18 | l:goti-db-active-passive-with-read-split-adr | 단일 쓰기 지점, read-only subscriber, 비대칭 |
| TE-027 | pglogical replication set과 시퀀스 복제 | 0019 | 2026-04-18 | l:goti-db-active-passive-with-read-split-adr | replication set 분류, 시퀀스 last-value, Failover gap |
| TE-028 | Failback — 역방향 복제 전략 | 0020 | 2026-04-18 | l:goti-db-failback-reverse-replication-adr | 역방향 복제 재구성, 대칭 토폴로지, stale 동기화 |
| TE-029 | pglogical 복제의 신뢰성 한계 | 0021 | 2026-04-19 | l:goti-pglogical-mr-replication-gaps-adr | Patroni HA, PITR, WAL archive, 수동 promote RTO |
| TE-030 | split-brain과 복제 정합성 | 0021 | 2026-04-19 | l:goti-pglogical-mr-replication-gaps-adr | split-brain 탐지, at-least-once, 멱등 설계, UUID PK |
| TE-031 | 복제 채널 보안 모델 | 0021 | 2026-04-19 | l:goti-pglogical-mr-replication-gaps-adr | sslmode require vs verify-full, plaintext DSN, 최소 권한 |

## 4. 캐시·티켓팅·런타임 (TE-032 ~ TE-051)

| id | 해설 주제 | 출처 | cat | adr_date | 짝 ADR 글 | 동작 원리 키워드 |
|---|---|---|---|---|---|---|
| TE-032 | Cache-Aside 패턴과 TTL self-healing | 0014 | challenge | 2026-04-14 | l:goti-redis-first-ticketing-adr | lazy loading, TTL stale window, invalidation, stampede |
| TE-033 | Redis SETNX 분산 락 | 0014 | challenge | 2026-04-14 | l:goti-redis-first-ticketing-adr | SETNX NX EX, 원자적 set-and-expire, lock 소유자, TTL 해제 |
| TE-034 | Redis Pub/Sub 메시징 모델 | 0014 | challenge | 2026-04-14 | l:goti-redis-first-ticketing-adr | publish/subscribe 채널, fire-and-forget, polling 대비 push |
| TE-035 | Dirty Set과 write-behind 동기화 | 0014 | challenge | 2026-04-14 | l:goti-redis-first-ticketing-adr | write-behind, dirty set, 배치 flush, reconciliation |
| TE-036 | Outbox 패턴 — dual-write 정합성 | 0014,0017 | challenge | 2026-04-14 | l:goti-redis-sot-adoption-adr | dual-write 문제, outbox 테이블, poller, at-least-once |
| TE-037 | Redis 단일 스레드와 Lua 원자성 | 0017 | challenge | 2026-04-17 | l:goti-redis-sot-adoption-adr | 단일 스레드 모델, Lua 원자 실행, EVALSHA, WATCH/MULTI 대비 |
| TE-038 | Redis Streams와 Consumer Group | 0017 | challenge | 2026-04-17 | l:goti-redis-sot-adoption-adr | append-only log, XADD/XREADGROUP, consumer group, PEL |
| TE-039 | 도메인 모델을 Redis 자료구조로 사상하기 | 0017 | challenge | 2026-04-17 | l:goti-redis-sot-adoption-adr | HASH/STRING+TTL/LIST/ZSET/SET, 시간복잡도, 도메인 매핑 |
| TE-040 | Redis 영속화 — RDB와 AOF | 0017 | challenge | 2026-04-17 | l:goti-redis-sot-adoption-adr | RDB 스냅샷, AOF appendfsync, 유실 윈도우, 재기동 복구 |
| TE-041 | Redis maxmemory eviction 정책 | 0017 | challenge | 2026-04-17 | l:goti-redis-sot-adoption-adr | maxmemory, noeviction vs allkeys-lru, LRU 근사 |
| TE-042 | Redis Cluster 해시 슬롯과 hash tag | 0017 | challenge | 2026-04-17 | l:goti-redis-sot-adoption-adr | 16384 슬롯, CRC16, hash tag 키 co-location |
| TE-043 | CDN edge 캐싱 — Cache-Control | 0022 | challenge | 2026-04-04 | l:goti-queue-implementation-cdn-caching-adr | max-age/s-maxage, edge HIT/MISS, origin 바이패스 |
| TE-044 | JWE 암호화 토큰 | 0022 | challenge | 2026-04-04 | l:goti-queue-implementation-cdn-caching-adr | JWE 5-part, AES-256-GCM AEAD, JWS 대비, stateless |
| TE-045 | CDN Cache Key 설계 | 0022 | challenge | 2026-04-04 | l:goti-queue-implementation-cdn-caching-adr | URL+식별자 키, Vary, 사용자별 캐시 분리 |
| TE-046 | Go 런타임 특성 (JVM 대비) | 0023 | challenge | 2026-04-09 | l:goti-java-to-go-migration-adr | 정적 컴파일, 콜드스타트, JVM warmup/GC 대비, 메모리 풋프린트 |
| TE-047 | Go 동시성 — goroutine과 GMP | 0023 | challenge | 2026-04-09 | l:goti-java-to-go-migration-adr | goroutine, channel CSP, GMP 스케줄러 |
| TE-048 | distroless 컨테이너 이미지 | 0023 | kubernetes | 2026-04-09 | l:goti-java-to-go-migration-adr | OS 패키지 없는 이미지, 정적 링크, multi-stage, 공격 표면 |
| TE-049 | k6 부하 테스트 도구 | 0024 | monitoring | 2026-04-03 | l:goti-load-testing-methodology-adr | VU 모델, goja 런타임, thresholds, 커스텀 메트릭 |
| TE-050 | Prometheus Remote Write 프로토콜 | 0024 | monitoring | 2026-04-03 | l:goti-load-testing-methodology-adr | snappy protobuf push, pull 대비, Mimir 수집, cardinality |
| TE-051 | k6 시나리오 executor | 0024 | monitoring | 2026-04-03 | l:goti-load-testing-methodology-adr | executor 종류, VU 라이프사이클, setup/teardown |

## 5. 아키텍처·메시징 (TE-052 ~ TE-059)

| id | 해설 주제 | 출처 | cat | adr_date | 짝 ADR 글 | 동작 원리 키워드 |
|---|---|---|---|---|---|---|
| TE-052 | Active-Passive 멀티클라우드 트래픽 라우팅 | 0025 | challenge | 2026-04-15 | l:goti-multicloud-high-level-architecture-adr | Active-Passive, 엣지 단일점 라우팅, DNS RR 한계 |
| TE-053 | Istio 멀티클러스터 토폴로지 3종 | 0025 | istio | 2026-04-15 | l:goti-multicloud-high-level-architecture-adr | Multi-Primary/Primary-Remote/독립 mesh, blast radius |
| TE-054 | ArgoCD ApplicationSet clusterGenerator | 0025 | argocd | 2026-04-15 | l:goti-multicloud-high-level-architecture-adr | generator, cluster-overrides, DRY 멀티클러스터 배포 |
| TE-055 | 컨테이너 이미지 공급망 — 중앙 검증 후 복제 | 0025 | cicd | 2026-04-15 | l:goti-multicloud-high-level-architecture-adr | 다이제스트 재현성, 중앙 검증 후 멀티리전 복제 |
| TE-056 | 메시징 시스템 비교 — Kafka/RabbitMQ/Redis Streams | kafka | challenge | 2026-03-14 | l:goti-kafka-adoption-decision-adr | 순서 보장, 디스크 영속, 재처리, 처리량 차이 |
| TE-057 | Kafka KRaft — ZooKeeper 없는 합의 | kafka | kubernetes | 2026-03-14 | l:goti-kafka-adoption-decision-adr | Raft 합의, 컨트롤러 쿼럼, 메타데이터 로그, ZooKeeper 제거 |
| TE-058 | Strimzi Operator — CRD 기반 Kafka 운영 | kafka | kubernetes | 2026-03-14 | l:goti-kafka-adoption-decision-adr | Operator 패턴, CRD reconciliation, 선언적 토픽 |
| TE-059 | Cross-cloud DB 페일오버 자동화 | cross-cloud-promote | challenge | 2026-04-21 | l:goti-cross-cloud-db-promote-automation-adr | 감지/결정/실행 분리, split-brain 방어, Step Functions |

---

## REVIEW 판정 (승인 1 — 2026-05-16)

RV-1·RV-2 모두 **MERGE 확정** — 독립 해설글로 만들지 않음:
- RV-1 복제 lag 모니터링 → TE-029·TE-030·TE-031에 "복제 관측성" 섹션으로 분산 흡수
- RV-2 fail-fast vs graceful degradation → TE-037·TE-040 등 관련 글에 섹션 흡수

**승인 1 확정**: KEEP 59편 입도 유지 / 짝 ADR 글은 logs 트랙(20개) 포함 전부 상호 링크 대상

---

## 통합 결정 로그 — MERGE (27건, 상위 KEEP 글에 흡수)

- 0001 API Gateway 방식 → TE-012 / 0004 Alloy 수집 에이전트 → TE-007 / 0004 kube-prometheus-stack CRD → TE-001
- 0006 JSON 전송 포맷 → TE-006 / 0007 Kafka 버퍼 → TE-005 / 0008 Loki·Tempo retry+sending_queue → TE-007
- 0010 복수 kid JWKS → TE-017 / 0013 PgBouncer 배포·호스팅 → TE-022
- 0014 reservation lock → TE-033 / 0014 메타 캐시 → TE-032 / 0014 active hold count → TE-039 / 0014 Reconciliation Job → TE-035
- 0017 UniversalClient 추상 → TE-042 / 0018 Patroni·etcd 생략 → TE-029 / 0019 subscriber read-only → TE-026
- 0020 대칭 설계 불변식 → TE-028 / 0020 Active-Active 기각 → TE-030
- 0022 polling 주기 vs TTL → TE-043 / 0022 Heartbeat 불필요 → TE-044
- 0023 JVM vs Go 비교 → TE-046 / 0023 pgx raw SQL → TE-046
- 0024 ALB·CF 이원 측정 → TE-049 / 0024 setup() 일괄 signup → TE-051
- 0025 Redis CSP 독립 → TE-052 / kafka 토픽 설계 → TE-056 / cross-cloud split-brain 방어 5종 → TE-059

## DROP 로그 (26건, 프로젝트 한정이라 일반 기술 해설 불가)

- go-ti 도메인 결정: 0003 비즈니스 메트릭 Go 서비스 분리·DB/Redis 직접 read, 0006 action+도메인 ID 필드, 0014 TTL/SSoT 데이터 분류
- 단계 로드맵: 0009 Phase 1-4, 0012 5단계 롤아웃, 0013 Phase 분리, 0014 Phase A/B/C, 0017 D0~D7·인프라 3단, 0020 Failback 5단계, 0021 Tier 1-3, 0023 Phase 0-8
- 운영 수치·범위: 0012 풀 사이즈, 0018 6 alternatives·비용표, 0019 RW/RO Deployment 범위, 0022 no-store 규칙, 0024 커스텀 메트릭 7종·RUNNER_ID
- 헤더 ADR 재참조: 0025 DB Primary 위치·자동 failover·팀 분배·cost freeze
- 기타: 0007 Mimir distributed 유지(Helm 제약), 0023 Istio canary(0001 영역), kafka 4.2.0 버전, Upstage opt-out 전체, cross-cloud Tier 로드맵

---

## 우선순위 작업 큐 (Phase B — 2026-05-16)

`priority = importance + rarity × 1.5` (희소성 가중 1.5). 동점은 importance 우선
- importance: 기술 깊이·시스템 영향 (도메인 지식 채점)
- rarity: 외부 웹 검색으로 확정한 희소성. 잠정 1~2(확실히 흔함)는 검색 생략

| 순위 | id | 주제 | imp | rar | prio | 희소성 |
|---|---|---|---|---|---|---|
| 1 | TE-024 | pglogical 논리 복제 | 5 | 5 | 12.5 | 한국어 자료 전무, 영어도 공식 문서뿐 |
| 2 | TE-059 | Cross-cloud DB 페일오버 자동화 | 5 | 5 | 12.5 | 멀티클라우드 DB failover 자동화 한국어 전무 |
| 3 | TE-022 | PgBouncer 커넥션 풀링 | 4 | 5 | 11.5 | 한국어 전무, 영어 심화도 적음 |
| 4 | TE-026 | Active-Passive 복제 토폴로지 | 4 | 5 | 11.5 | DB 복제 관점 체계적 해설 전무 |
| 5 | TE-027 | pglogical replication set·시퀀스 복제 | 4 | 5 | 11.5 | 시퀀스 드리프트 — 매우 구체적, 자료 전무 |
| 6 | TE-029 | pglogical 복제 신뢰성 한계 (HA/PITR) | 4 | 5 | 11.5 | pglogical+Patroni+PITR 조합 자료 극히 드묾 |
| 7 | TE-031 | 복제 채널 보안 모델 | 4 | 5 | 11.5 | 복제 sslmode verify-full 실전 가이드 전무 |
| 8 | TE-035 | Dirty Set·write-behind 동기화 | 4 | 5 | 11.5 | write-behind+dirty set 자료 매우 드묾 |
| 9 | TE-052 | 멀티클라우드 트래픽 라우팅 | 4 | 5 | 11.5 | active-passive 엣지 라우팅 한국어 전무 |
| 10 | TE-030 | split-brain과 복제 정합성 | 5 | 4 | 11.0 | split-brain은 알려졌으나 정합성·멱등 결합 글 적음 |
| 11 | TE-037 | Redis 단일 스레드·Lua 원자성 | 5 | 4 | 11.0 | Lua 원자성 실전 함정 심화글 적음 |
| 12 | TE-057 | Kafka KRaft | 5 | 4 | 11.0 | 한국어 입문 수준만, 합의 메커니즘 심화 적음 |
| 13 | TE-004 | Tempo 분산 트레이싱 | 4 | 4 | 10.0 | metrics_generator·TraceQL 심화 적음 |
| 14 | TE-005 | 관측 파이프라인 Kafka 버퍼 | 4 | 4 | 10.0 | 시그널별 백프레셔 전략 자료 희소 |
| 15 | TE-023 | transaction pooling이 깨뜨리는 것 | 4 | 4 | 10.0 | prepared statement 충돌 — 한국어 전무 |
| 16 | TE-044 | JWE 암호화 토큰 | 4 | 4 | 10.0 | JWE는 JWS보다 훨씬 희소, 한국어 입문뿐 |
| 17 | TE-054 | ApplicationSet clusterGenerator | 4 | 4 | 10.0 | clusterGenerator 실전 사례 한국어 적음 |
| 18 | TE-058 | Strimzi Operator | 4 | 4 | 10.0 | CRD 운영 자동화 심화글 적음 |
| 19 | TE-017 | Istio JWT 검증·JWKS 배포 | 5 | 3 | 9.5 | 기본 설정글뿐, 운영 심화 희소 |
| 20 | TE-036 | Outbox 패턴 — dual-write 정합성 | 5 | 3 | 9.5 | 패턴은 알려졌으나 한국어 실전 적음 |
| 21 | TE-053 | Istio 멀티클러스터 토폴로지 3종 | 5 | 3 | 9.5 | 설치 중심, 토폴로지 트레이드오프 분석 적음 |
| 22 | TE-008 | Kafka 컨슈머 백프레셔 (fetch.max) | 3 | 4 | 9.0 | fetch.max·백프레셔 연계 심화 희소 |
| 23 | TE-016 | Cloudflare Workers Host 헤더 제약 | 3 | 4 | 9.0 | 한국어 자료 거의 전무 |
| 24 | TE-018 | JWT issuer·viper 설정 우선순위 | 3 | 4 | 9.0 | 설정 우선순위 시나리오 자료 드묾 |
| 25 | TE-045 | CDN Cache Key 설계 | 3 | 4 | 9.0 | 캐시 키 설계 전략 심화 가이드 적음 |
| 26 | TE-055 | 컨테이너 이미지 공급망 복제 | 3 | 4 | 9.0 | 멀티리전 복제 아키텍처 심화 적음 |
| 27 | TE-002 | Mimir 분산 아키텍처 | 4 | 3 | 8.5 | 한국어 동작 원리 심화 부족 |
| 28 | TE-025 | PostgreSQL 물리 vs 논리 복제 | 4 | 3 | 8.5 | 한국어 입문글만 |
| 29 | TE-028 | Failback — 역방향 복제 전략 | 4 | 3 | 8.5 | 개념글은 있으나 역방향 복제 전술 부족 |
| 30 | TE-038 | Redis Streams·Consumer Group | 4 | 3 | 8.5 | 한국어 입문글뿐, 심화 부족 |
| 31 | TE-042 | Redis Cluster 해시 슬롯·hash tag | 4 | 3 | 8.5 | hash tag 핫스팟·최적화 심화 부족 |
| 32 | TE-009 | GOMEMLIMIT | 3 | 3 | 7.5 | 한국어 기본 개념뿐, 컨테이너 실전 부족 |
| 33 | TE-010 | OpenCost | 3 | 3 | 7.5 | 설치 가이드 중심, 비용 할당 알고리즘 부족 |
| 34 | TE-011 | Prometheus Agent Mode | 3 | 3 | 7.5 | 한국어 입문 소수 |
| 35 | TE-014 | GitOps 이미지 자동 업데이트 | 3 | 3 | 7.5 | 도구 비교 한국어 거의 없음 |
| 36 | TE-050 | Prometheus Remote Write 프로토콜 | 3 | 3 | 7.5 | 프로토콜 구조 심화 부족 |
| 37 | TE-051 | k6 시나리오 executor | 3 | 3 | 7.5 | executor 실전 시나리오 가이드 부족 |
| 38 | TE-003 | Loki 레이블 인덱싱 구조 | 4 | 2 | 7.0 | 한국어 자료 다수 |
| 39 | TE-007 | OTel Collector 파이프라인 | 4 | 2 | 7.0 | 입문·기본 개념 포화 |
| 40 | TE-013 | Sidecar vs Ambient 데이터 플레인 | 4 | 2 | 7.0 | 비교 글 다수 |
| 41 | TE-015 | Cloudflare 엣지 아키텍처 | 4 | 2 | 7.0 | Workers 글 흔함 |
| 42 | TE-019 | 서킷 브레이커 패턴 | 4 | 2 | 7.0 | 고전 패턴, 글 흔함 |
| 43 | TE-021 | Read Replica·read/write 분리 | 4 | 2 | 7.0 | 글 흔함 |
| 44 | TE-033 | Redis SETNX 분산 락 | 4 | 2 | 7.0 | Redis 분산 락 글 흔함 |
| 45 | TE-039 | Redis 자료구조 모델링 | 4 | 2 | 7.0 | 자료구조 글 흔함 |
| 46 | TE-040 | Redis 영속화 RDB/AOF | 4 | 2 | 7.0 | RDB/AOF 글 흔함 |
| 47 | TE-043 | CDN edge 캐싱 (Cache-Control) | 4 | 2 | 7.0 | Cache-Control 글 흔함 |
| 48 | TE-046 | Go 런타임 특성 (JVM 대비) | 4 | 2 | 7.0 | Go vs Java 글 흔함 |
| 49 | TE-047 | Go 동시성 — goroutine·GMP | 4 | 2 | 7.0 | goroutine/GMP 글 흔함 |
| 50 | TE-056 | 메시징 시스템 비교 | 4 | 2 | 7.0 | Kafka vs RabbitMQ 글 흔함 |
| 51 | TE-012 | Istio 서비스 메시 동작 원리 | 5 | 1 | 6.5 | 포화 — 자료 매우 많음 |
| 52 | TE-006 | 구조화 로깅 logfmt vs JSON | 2 | 3 | 6.5 | 한국어 적으나 주변 주제 |
| 53 | TE-034 | Redis Pub/Sub 메시징 모델 | 3 | 2 | 6.0 | 흔함 |
| 54 | TE-041 | Redis maxmemory eviction 정책 | 3 | 2 | 6.0 | 한국어 자료 다수 |
| 55 | TE-048 | distroless 컨테이너 이미지 | 3 | 2 | 6.0 | distroless 글 흔함 |
| 56 | TE-049 | k6 부하 테스트 도구 | 3 | 2 | 6.0 | k6 글 흔함 |
| 57 | TE-020 | Kubernetes HPA 동작 원리 | 4 | 1 | 5.5 | 포화 |
| 58 | TE-032 | Cache-Aside 패턴 | 4 | 1 | 5.5 | 포화 |
| 59 | TE-001 | Prometheus pull vs push 모델 | 3 | 1 | 4.5 | 포화 — 가장 흔함 |

**관찰**: 상위 12편이 pglogical 멀티클라우드 복제·cross-cloud failover·PgBouncer·split-brain·KRaft에 집중 — "중요하면서 희소한" 주제 (사용자 의도 부합). 하위권은 Istio 서비스 메시·Cache-Aside·HPA·Prometheus pull/push 등 중요하지만 포화된 주제

## 작성 진행 상황

**해설글 59편 전부 작성 완료** (Phase E 종료, 2026-05-16) — 파일럿 3편 + 배치 1~12

- 전 배치 `npm run build` + blog-reviewer 검증 통과. 격식체 100%·문장 끝 마침표 생략·ASCII 흐름 문자 0건
- 다이어그램 SVG 직접 작성(`|tall` 힌트), backdating 적용(2026-03-14 ~ 2026-04-21)
- 시리즈 7개: goti-deepdive-observability(11)·istio(5)·database(11)·redis(11)·edge(6)·runtime(6)·platform(9)
- Phase F 완료: 최종 빌드 통과(essays 100편 — 기존 41 + 해설글 59), ADR 글 27편에 "🔗 관련 기술 해설" 역링크 추가 → ADR↔해설글 양방향 완성
