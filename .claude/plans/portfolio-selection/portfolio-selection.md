# 포트폴리오 대표글 최종 선정 (2차 심사 결과)

> 2026-07-16. 1차 후보 34편 전량 본문 정독 후 확정.
> 평가 상세는 [scorecard.md](scorecard.md), 1차 목록은 [candidates.md](candidates.md).

## 최종 7선

### 1. Istio JWKS 불일치: CDN 경유하면 JWT가 401인 이유

- **경로**: `logs/kubernetes/goti-istio-jwks-mismatch-cdn-jwt-401`
- **역할**: 교차 트러블슈팅 대표 A (보안 × 서비스메시 × GitOps) — 기준 1·2·4 동시 충족
- **근거**: "4ms는 Istio Envoy sidecar가 요청을 앱까지 보내지도 않고 차단했다는 뜻입니다"(응답 시간·content-type을 포렌식 증거로 사용), "RequestAuthentication만 있고 AuthorizationPolicy가 없으면, JWT 검증 실패 시 요청이 그냥 통과합니다"(어제는 왜 됐는지의 반전), jwksUri 시도가 STRICT mTLS에 막히고 Helm lookup 시도가 ArgoCD 제약에 막히는 **실패한 수정 2회를 메커니즘까지 기록**. smoke 100%로 검증 닫힘 + 재발 방지 표
- **한 줄 소개**: "인증 401 하나를 4ms 응답 시간에서 출발해 19개 서비스의 구조적 결함으로 추적하고, 두 번의 실패한 수정에서 Istio·ArgoCD의 제약을 규명한 5시간의 기록"
- **보완 (1)**: 이모지 헤더(🎯🔥🤔) 제거 수준의 정리만 필요 — 내용은 현재 완성

### 2. 3000VU Oneshot 부하테스트 — 대기열은 통과, 결제가 무너졌다

- **경로**: `logs/challenge/goti-3000vu-queue-oneshot`
- **역할**: 교차 트러블슈팅 대표 B (앱 코드 ↔ DB, 문제→가설→검증 서사) — 기준 1·2
- **근거**: "queue_pass_rate=100% vs goti_ticket_success_rate=15.60%"(입구/출구 지표 분리), "병목이 DB 커넥션 고갈 자체가 아니라 ticketing 트랜잭션 내부의 긴 작업"(PgBouncer pool 활용율을 증거로 가설 좁힘), "EXPLAIN ANALYZE 1.022ms vs 부하 시 5~10초"(단일 실행 ≠ 부하 시), 7.5GB 테이블의 n_live_tup=0 발견
- **한 줄 소개**: "대기열 통과 100%인데 결제 성공 15.6% — 병목의 위치를 커넥션 풀 지표와 실행 계획으로 좁혀 들어간 진단 기록"
- **보완 (최대 2)**: ① "플래너가 이 테이블을 비어있는 것으로 판단" 문장 교정 — 플래너는 pg_stat_user_tables가 아니라 pg_class 통계(reltuples/relpages)를 봄. 통계 부재→추정 왜곡이라는 결론은 유지하되 메커니즘 표현만 정확히 ② 조치 3건 적용 후 재측정 수치 1문단(또는 Redis SoT 롤아웃 글 링크 — 558ms→32ms가 후속 글에 있음)

### 3. Cloudflare Worker가 LAX에서 실행되어 900ms 지연

- **경로**: `logs/challenge/goti-cloudflare-worker-lax-latency-investigation`
- **역할**: 관측 데이터 기반 진단 방법론 대표 (포지셔닝 문장 그 자체) — 기준 1·2
- **근거**: "cf-ray + x-envoy-upstream-service-time + pod 로그 3지점 상관 분석"(세 지점의 뺄셈으로 934ms 실종 구간 확정), 가설 5개 매트릭스를 증거로 소거, 경로 분해 추정 700~1100ms가 실측 934ms와 일치
- **한 줄 소개**: "백엔드 32ms인데 체감 900ms — 세 관측 지점의 뺄셈으로 태평양 왕복을 찾아낸 레이턴시 수사 기록"
- **보완 (필수 1 + 권장 1)**: ① **후일담 문단 필수** — 이 글은 "Smart Placement로 해결"인데 이틀 뒤 글(goti-aws-full-destroy)은 "Smart Placement로도 완전히 해결되지 않아 DNS Only 전환"이라 서술. 두 글을 다 읽은 면접관에게 모순으로 보임. "부분 개선 → 최종 DNS Only 전환(링크)" 문단을 추가하면 모순이 반복 개선 서사로 승격됨 ② Smart Placement 적용 후 실측 수치 추가

### 4. Java/Spring Boot에서 Go로 — 6 MSA 전환 결정 ADR

- **경로**: `logs/challenge/goti-java-to-go-migration-adr`
- **역할**: 기술 선택 ADR 대표 — 기준 3
- **근거**: 대안 7개(JVM 튜닝·Loom·GraalVM·Kotlin·Rust·Node·Go)를 결정 기준 3개의 우선순위로 소거, "합산 효과에 대한 주의 — Go 단독 기여도를 분리 측정하려면 별도 부하가 필요합니다"(혼재 효과를 스스로 분리한 유일한 글), 롤백 3단계 설계, Phase 7 미완을 정직하게 공개
- **한 줄 소개**: "3000VU 실측으로 JVM의 구조적 한계를 확정하고, 7개 대안을 소거해 6개 서비스 전면 전환을 결정한 ADR — 개선 수치에서 Go 단독 기여와 혼재 효과까지 구분"
- **보완 (최대 2)**: ① "메모리 6배"가 requests(설정값) 변화임을 감안해 PoC 실측 근거 1문장 보강 ② "queue pass_rate 1.04%"가 keda 글(같은 테스트를 Stadium cascade로 설명)과 프레임이 달라 보이므로 각주 1줄로 정합

### 5. Redis 관리형 유지 + Kafka 완전 제거 — 두 인프라 결정

- **경로**: `logs/challenge/goti-managed-kafka-removal`
- **역할**: 판단 번복 서사 + 비용 ROI 대표 — 기준 3(번복 우대)·비용
- **근거**: "연간 절감액이 $1,440~$2,280이지만, 이 작업의 공수와 위험이 절감액 대비 과도합니다"(절감액 절대값이 아닌 ROI로 기각), Redis Operator 생태계 정체(2022 마지막 릴리스·Palark 데이터 파괴 사례)라는 검증 가능한 근거, "이미 결정이 번복된 컴포넌트는 즉시 제거" — ADR까지 채택했던 Kafka를 전면 철거
- **한 줄 소개**: "'도입 결정을 마친 Kafka를 제거한다'와 '월 $120이 아까워도 관리형을 유지한다' — 절감액이 아니라 전환 비용 대비 ROI로 내린 두 개의 인프라 결정"
- **보완 (최대 2)**: ① 본문 서두에 도입 ADR(goti-kafka#1) 링크를 명시해 번복 서사를 한 쌍으로 묶기 ② "Zookeeper 대체 KRaft가 계속 자원을 소비" 문장 표현 교정(KRaft는 별도 앙상블이 없음)

### 6. EKS max-pods rolling update가 부른 연쇄 장애 4건

- **경로**: `logs/kubernetes/goti-eks-rolling-update-cascading-failures`
- **역할**: 운영 완결성/재발 방지 대표 (프로덕션 연쇄 장애) — 기준 1·4
- **근거**: "18노드 × 48 IP = 864 IP > 서브넷 가용 254 IP"(IP 소진 데드락의 산수), Terraform inline SG + 별도 rule 혼용이 실제 규칙을 삭제하는 메커니즘, 복구 타임라인 11단계 → 15/15 확인, 재발 방지 체크리스트 표 2개(rolling 전 점검·PDB·WARM_IP_TARGET)
- **한 줄 소개**: "설정 하나 바꾸는 rolling update가 Terraform 상태·VPC IP 산수·admission webhook·모니터링 4개 레이어에서 연쇄 폭발한 프로덕션 사고 — 복구 타임라인과 재발 방지 체크리스트까지"
- **보완 (1)**: Kyverno 차단 원인이 "일시적으로 정책 위반 감지"로 뭉뚱함 — 어떤 정책이었는지 이벤트 로그 1줄 보강

### 7. Claude vs Gemini 리뷰 비교 — PR #192 (11건 vs 5건, 반대 방향 1건)

- **경로**: `essays/challenge/goti-claude-vs-gemini-k8s-pr-192`
- **역할**: AI 네이티브 엔지니어링 대표 — 기준 5
- **근거**: "양쪽이 같은 라인을 지적했는데 방향이 반대"(FQDN 긴 형식 vs 짧은 형식)를 "짧은 형식이 해석 실패로 이어진 **과거 인시던트**"로 사람이 판정 — AI를 쓰는 게 아니라 AI 산출물을 재정하는 체계를 보여줌. Gemini만 잡은 `~` 문법을 인정하는 양방향 정직성, "일치 0"의 해석
- **한 줄 소개**: "두 AI가 같은 코드 라인에 정반대 권고를 냈을 때 — 과거 인시던트를 근거로 사람이 최종 판정하는 AI 협업 리뷰 체계"
- **보완 (최대 2)**: ① 자매글(gap-learning — 갭을 프롬프트 체크 12개로 시스템화)을 서두에 링크해 "판단+시스템 설계" 쌍으로 제시 ② 이 결정들이 이후 재발을 막았는지 후속 1줄

### 중복 제거 노트

- 부하테스트 계열 3파전(keda·oneshot·load-test-db) → **oneshot만 선정** (서사 완결성 최고). keda는 8순위 예비
- Kafka 버퍼+OOM 계열(loki-tempo ADR vs tempo-oom 85회) → 실측 사건 기반 tempo-oom 우세이나 관측성 슬롯 자체를 최종 7에서 제외 (jwks·oneshot이 관측 데이터 활용을 이미 증명)
- AI 계열 4편 → #192 하나만 대표, gap-learning은 링크로 연결
- 같은 날·같은 소재(scaling#3 vs #4) → 대표 선정 없음, 리라이트 목록으로

---

## 아깝게 탈락 3편 — "이렇게 고치면 대표글"

1. **`logs/kubernetes/goti-capacity-planning-keda`** (사실상 8순위 동률)
   — 소재·서사 모두 1군(측정하러 갔다가 진범 Stadium을 찾은 반전, 400 에러 2.48K = 세션 TTL 2차 피해 인과 체인). 탈락 사유는 오직 부하테스트 계열 중복.
   **고치면**: "Stadium Go 전환 후 p95가 실제로 몇 ms가 됐는지" 결과 1문단 + 후속 글 링크를 달면 oneshot과 맞교체 가능. "Istio sidecar mTLS ~10ms/hop" 문장에 실측 단서 추가

2. **`logs/challenge/goti-session-dropout-root-cause-audit`**
   — FE(zustand 타이머·interceptor·localStorage) × BE(viper 기본값) × Istio(403 오판)를 file:line 단위로 관통하는 **유일한 풀스택 진단 글**. 탈락 사유는 완화책 적용 결과가 없는 열린 루프.
   **고치면**: "권장 #1~#3 적용 후 증상 소멸 여부" 결과 문단 하나면 즉시 1군 — 7선 중 하나와 교체까지 고려 가능

3. **`logs/kubernetes/goti-ticketing-hotpath-and-scaling-overhaul`** (goti-scaling#4)
   — 소재 밀도는 후보 전체 최고(코드/쿼리/리소스 3계층 분리, KEDA 90s 지연 산식, Karpenter 주석 상태 발견). 탈락 사유는 완성도 2.5: SDD-0004·CR-001~016·PR #257 같은 내부 식별자가 본문을 지배해 외부 독자가 못 따라옴.
   **고치면**: 내부 번호를 걷어내고 "CPU 117%는 증상 — 진짜 병목을 3계층으로 분리하다" 축으로 재구성 + 5차 부하 결과 수치. 리라이트 비용은 크지만 성공하면 1~2위권

---

## 리라이트하면 1군 (소재 4+ / 완성도·정합성 결함)

| 글 | 결함 | 리라이트 방향 |
|---|---|---|
| `essays/monitoring/goti-prometheus-agent-mode-adr` | 제목 "4Gi→1.2Gi로 줄인"인데 본문은 예상치만 | 후속 글(agent-mode-and-monitoring-cascade)의 전환 실측을 결과 섹션으로 이식, 또는 제목을 "줄이는 결정"으로 완화 |
| `essays/monitoring/goti-adr-loki-tempo-stability-tuning` | fetch_max를 문제로 지목하고 해결에서 올리는 논리 꼬임 + "죽는 거야?" 반말 잔존 + 효과 전부 예상치 | 실제 레버가 max_processing_time·sending_queue임을 명확화, 격식체 정리, 적용 후 실측 추가 |
| `logs/challenge/goti-redis-first-ticketing-adr` | frontmatter 2026-02-22인데 본문이 4월 문서·PgBouncer 인용(시점 모순), "RDS 부하 1/100" 무근거 단정 | 날짜 정합 + 후속 롤아웃 글(558ms→32ms) 링크로 결과 닫기 |
| `logs/kubernetes/goti-pod-scaling-vs-karpenter-nodepool` | "측정 선행" 결정 후 측정 결과가 글에 없음 | 5차 부하 결과 + NodePool 착수/불필요 판정 1문단 |

## 예비 풀 (포폴 본문에서 보조 링크로 활용)

- `goti-phase6-ticketing-sql-optimization` — 백엔드 코드 역량 보강 (N+1 87%, Go map deadlock)
- `goti-review-pr-gap-learning` — #192의 자매글 (AI 피드백 루프 설계)
- `goti-tempo-oom-kafka-buffer-sampling` / `goti-observability-stack-selection` — 관측성 심화
- `goti-aws-full-destroy-gcp-latency-optimization` — 비용($0)+성능, GOMAXPROCS 문장 교정 조건(automaxprocs 미명시 시 오류)
- `goti-node-rightsizing-and-rebalancing` — 비용 + requests vs actual
- `goti-cross-cloud-db-promote-automation-adr` — DR 설계 사고 (미구현임을 감안)
- `goti-load-test-db-realistic-data` — 방법론 자기 교정 (플래너 캐시 문장 교정 조건)

---

## 빈 서사 진단

1. **비용 절감 "정면" 서사 부재** — 재료는 흩어져 있음(kafka-removal ROI, AWS destroy $0, 노드 12→8, spot 60~90%). finops-opencost ADR은 도구 채택 계획에서 끝나 절감 실적이 없음. → 신규 글 없이도 포폴 소개 문구에서 세 글을 "비용 의사결정 3제"로 묶으면 커버 가능. 여력이 있으면 "이 프로젝트에서 돈을 아낀 결정들" 종합 1편이 이상적
2. **검증이 닫히지 않는 공통 패턴** — 상당수 글이 "예상/기대 효과"로 끝나고, 실측이 후속 글에 있는데도 원글에 링크가 없음. 후보 4편 이상에서 반복. → "후일담(그 후)" 1문단 패턴을 도입해 원글에서 결과로 점프할 수 있게. 대표 7선 보완 지시 대부분이 이 패턴
3. **글 간 모순 2건** — ① LAX 글("Smart Placement로 해결") vs destroy 글("완전히 해결되지 않음") ② stack-selection(Alloy 채택) vs alloy-to-otel-collector(전환). 개별 글은 정직한데 시점이 달라 모순처럼 읽힘. → 앞 글에 업데이트 노트 1줄씩
4. **프로젝트 전체 회고 부재** — retrospective 태그 글들은 전부 AI 워크플로우 회고. "50만 목표 대비 무엇을 달성/실패했고 다시 한다면"을 다루는 종료 회고가 없음. 면접의 단골 질문("아쉬웠던 점은?")에 대응하는 글이 있으면 포폴 마지막 링크로 강력
5. **날짜 정합성** — goti 시리즈 일부에서 frontmatter 날짜와 본문 인용 문서의 시점이 어긋남(redis-first ADR 등). 대표글 확정 후 7선+예비만이라도 날짜 검수 권장
