# go-ti 프로젝트 컨텍스트 (blog-writer용)

> 미변환 drafts 변환 시 blog-writer agent가 서사·why·프로젝트 맥락을 삽입할 때 참조합니다.
> 2026-04-24 확보된 사용자 답변 기반.

## 프로젝트 개요 (모든 글 공통 배경)

- **팀 규모**: 15인
- **성격**: 대규모 야구 티켓팅 플랫폼 (시연/포트폴리오 + 실운영급 목표)
- **운영 대상**: 삼성(AWS EKS `goti-prod`, ap-northeast-2) / 두산(GCP GKE) 2개 구단
- **트래픽 분배**: Cloudflare로 AWS↔GCP 분산 + Failover
- **3대 목표**:
  - 동시 접속 50만 (최소 20만)
  - API p99 < 200ms (대기열 제외)
  - 좌석 정합성 100%
- **부가 목표**: 봇 차단 >95%, DR Failover <5분, 실무 운영급 모니터링
- **프로젝트 종료**: 2026-04-21 전체 destroy로 운영 종료

## 인프라 공통 (EKS prod 기준)

- 클러스터: `goti-prod`, K8s v1.34.4
- 노드: 8개 (Bottlerocket, Spot + Core 혼합)
- 데이터 계층: RDS db.t3.medium PostgreSQL 16.10 Multi-AZ + ElastiCache Redis (TLS)
- 레지스트리/시크릿: Harbor `harbor.go-ti.shop/prod/` + ClusterSecretStore `aws-ssm` (`/prod/{service}`)
- VPC: 초기 private /24 (254 IP) → 2026-04-01 IP 소진 사태 이후 /20 확장, WARM_IP_TARGET=2
- 부하 도구: K6 (EIP 43.202.205.23 / c7g.xlarge), 1500 VU 기본, 3000 VU 검증

## 시리즈별 컨텍스트

### S4. goti-java-to-go (Java → Go 마이그레이션)

- **Why**: JVM 메모리/콜드스타트 + Kind 5노드 리소스 압박 + 50만 동시 트래픽 목표. ticketing-go PoC에서 **메모리 6x 절감 실측** → 전량 전환 근거
- **기간**: 2026-04-09 시작 → Phase 0~6 구현 완료(~04-11) → Phase 7 audit(04-12) PAUSED → Phase 6.5 신설 → **cutover 미완료 상태로 프로젝트 종료(04-21)**
- **대상**: Step 4=4b 확정 = 6서비스 전체 (user/ticketing/payment/resale/stadium/queue). 4a(ticketing-go만 선행) 기각
- **Go 스택**: Go 1.26.1, Gin v1.12, pgx v5, go-redis v9, raw SQL(ORM 미사용)

### S6. goti-ticketing-phase (Phase 6/6.5/7/8)

Phase 구분 기준: 기능(서비스) 단위 + 검증 단계. 시간 기반 아님.

- **Phase 6 — Ticketing 구현**: 포팅 본체. 58 Go 파일, Redis Lua inventory script, N+1 제거
- **Phase 6.5 — Go prod 인프라 신설**: Phase 7 진입 차단 갭 해소. helm values 5세트 / SSM Parameter + ExternalSecret / ApplicationSet entry / KEDA. "values가 Java 기준이라 Go pod 하나도 prod에 없음" 발견 후 추가된 Phase
- **Phase 7 — Go Readiness Audit**: 컷오버 전 8게이트 검증 (API 계약/E2E/정적분석/부하/관측성/운영준비/데이터정합성/보안)
- **Phase 8 — Cleanup**: Java deprecation, Phase 7 풀세트 + Step 4 컷오버 **후에만** 진입

### S8. goti-argocd

**개별 글: `argocd-otel-collector-crashloop`** — Alloy → OTel Collector 전환 이유 (ADR 0007, 2026-03-30 Accepted)
1. 커뮤니티 자료 부족 — Alloy는 River 문법 전용, contrib 생태계 제한
2. Kafka 연동 공식 지원 — OTel Collector는 Kafka exporter/receiver가 공식. 30만 스파이크 시 logs도 Kafka 버퍼에 태워 Loki/Tempo OOM 방지 (Alloy 시절엔 traces만 Kafka 경유)
3. 벤더 중립 — loki.process/prometheus.remote_write/mimir.rules.kubernetes 등 Grafana 전용 블록 의존 해소
4. 팀 학습 용이성 — OTel은 범용 스택

CrashLoopBackOff는 전환 직후 **후속 부작용**(NetworkPolicy egress 누락 + Loki ingestion rate 4MB/sec 초과)

### S12. goti-istio-ops

- **버전**: Istio 1.29.0 **sidecar 모드** (Ambient 아님)
- **범위**: MSA 5서비스(+Swagger) 전체 mesh 탑재. dev(Kind) + prod(EKS/GKE) 양쪽 독립 mesh
- **진화**: 초기 "Istio 껍데기"(VirtualService 라우팅만) → Phase 1(mTLS, AuthorizationPolicy, RequestAuthentication JWT) → Phase 2(DestinationRule CB, retry/timeout, ServiceEntry) → Phase 3(메트릭/Kiali) 순차 심화
- **Gateway 네임스페이스 차이**: GCP=`istio-ingress`, AWS=`istio-system` (gatewayRef 작성 시 주의)

### S13. goti-eks

- 프로덕션 EKS `goti-prod`, ap-northeast-2, K8s v1.34.4, 노드 8개
- VPC 초기 /24 (254 IP) → 2026-04-01 max-pods 35→110 rolling 중 IP 소진 데드락 → **/20 확장, WARM_IP_TARGET=2**

**개별 글: `eks-rolling-update-cascading-failures` (2026-04-01, 프로덕션 발생)**
- max-pods 35→110 변경 배경: goti-load-observer 등 신규 pod들이 IP 할당 실패(VPC CNI prefix delegation 부족)로 Pending. 노드 밀집도를 올려 해결하려 함. **노드 축소 목적 아님** — "기존 노드에 더 많이 태우기"
- 연쇄 4건: (1) RDS/ElastiCache SG ingress 삭제(Terraform inline vs 별도 rule 충돌) / (2) VPC 서브넷 /24 IP 소진 데드락 / (3) RDS 접속 불가 / (4) OOM

### S15. goti-pgbouncer

두 편 세트로 묶되 rollout 글도 단독으로 읽히게 배경을 깔아야 합니다.

- **배경**: 3000 VU 부하테스트에서 `ticket_success 15.6%`, `order_creation p95 60s timeout`. DB 연결 폭증이 주 병목 후보. RDS 커넥션 한계(~150~200) 대비 6 replica × app pool이 쉽게 초과
- **ADR 0013 (order 1)**: pool_mode 결정 — **session 모드 채택**, transaction+pgx 호환은 별도 PR로 유예
- **Rollout (order 2)**: 실제 도입 + 1차 3000 VU 결과. session 모드 회귀, 특수문자 비번 URL encoding, ANALYZE 누락(hot table `n_live_tup=0`) 발견

역할 분담: ADR="왜 session 모드, 왜 도입" / Rollout="어떻게 쓰러지고 뭘 발견"

### S16. goti-loadtest (두 글 완전히 다른 성격)

**`synthetic-traffic` (order 1)** — 모니터링 파이프라인 검증용
- 목적: 메트릭/로그/트레이스/대시보드 살아있는지 확인. **부하 도구 아님**
- 왜: 대시보드가 "데이터 없어 비어보임" 문제 해소
- 사용 단계: Phase 1.5 ~ 2 (MSA 전환 + 모니터링 안정화 직후, 2026-03-24)
- 패턴: 프론트엔드 실제 호출 빈도 기반 가중치 (9 GET + 2 POST, POST는 HOLD/test-user만 — 데이터 소모 無), 호출 간 2~5초 대기로 브라우징 시뮬레이션
- 운영: Kind 클러스터 내부 CronJob, `*/5분마다 4분간 VU=100`

**`load-test-db-realistic-data` (order 2)** — 부하테스트 정확도용
- 목적: 실제 쿼리 분포 재현, EXPLAIN plan 검증
- 왜: 소량 데이터 plan과 prod plan이 다른 문제 해소
- 시드 규모: 578K users, 3.6M seats

둘은 **레이어가 다름**(synthetic=트래픽, realistic=DB 시드). 묶지 말고 각각 기능 분명히.

**`3000vu-2nd-and-next-checklist` (order 3)** — 2차 3000VU 부하 + 다음 체크리스트

### S17. goti-prometheus-agent

- `0011-prometheus-agent-mode.md` ADR 1편 (단독 ADR 취급, series 필드는 선택)

## 작성 규칙 보강 (이번 변환용)

1. **A그룹(풍부)**: 원본 옵션 수 = 변환글 옵션 수. 🧭 스캐폴딩 정석대로 적용
2. **B그룹(중급)**: 도입부에 이 컨텍스트 문서에서 **해당 시리즈의 why 2-3줄**을 반드시 녹인다 (복붙 아닌 글 흐름으로)
3. **C그룹(단순)**: front matter에 `tags: ["go-ti", ..., "troubleshooting"]` 포함. 서사 과장 금지
4. **공통**: 실명(준상/수연/성전/josuyeon/junsang/sungjeon/suyeon/akistory/ressKim) 전부 POC A/B/C 또는 중립 표현으로 치환. 마침표(.) 문장·문단·bullet 끝 생략(한국어 관행). 격식체 100%
