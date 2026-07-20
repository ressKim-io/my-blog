# 2차 심사 스코어카드 (본문 정독 기반)

> 축: 소재 강도 / 서사 구조 / 글 완성도 / 면접 방어력 (각 1~5)
> 판정: 즉시 1군 / 리라이트하면 1군 / 탈락

---

## 배치 1 — 스케일링·부하 계열

## logs/kubernetes/goti-pod-scaling-vs-karpenter-nodepool (goti-scaling#3)

- 소재 강도: 4 — "CPU 117%는 증상, 코드가 원인" 판단 + RDS 커넥션 함정(MaxConns 15×24pod=360>300) + c-series 단가 비교까지. 다만 이 글 자체는 "측정 선행으로 유보"한 결정 기록이라 해결 수치가 없음
- 서사 구조: 3 — 문제→분석→옵션 비교→결정은 완결이나, 검증(5차 부하 결과)이 글 밖에 있음. "throttling <1%면 불필요" 재개 조건만 제시하고 끝남
- 글 완성도: 4 — 표·구조 깔끔, 자립성 양호. 이모지 헤더(🔥🤔🧭) 잔존
- 면접 방어력: 4 — 결정 기준 3개가 명시적. "그래서 NodePool 했나요?"에 대한 답이 글에 없음(후속 글 링크 필요)
- 기술적 리스크: "c-series는 vCPU당 20% 비쌉니다"는 특정 시점 spot 단가 스냅샷 — 시점 명시 있어 방어 가능. 낮음
- 1차 근거 검증: O (FindPrice N+1·distLock WaitTimeout 본문 실존)
- 판정: **리라이트하면 1군** — 후속 측정 결과 1문단 + 링크만 추가하면 ADR 대표 가능. 단 scaling#4와 같은 날·같은 소재라 중복 주의

## logs/kubernetes/goti-ticketing-hotpath-and-scaling-overhaul (goti-scaling#4)

- 소재 강도: 5 — 코드/쿼리/리소스 3계층 병목 분리, KEDA 90s 지연 산식, Karpenter NodePool 주석 상태 발견, Gemini vs Claude 갭까지. 하루치 밀도가 후보 중 최고
- 서사 구조: 3 — 시간순 세션 로그. 문제→가설→검증이 아니라 "작업 나열 + 의사결정 표". 결과 수치(5차 부하) 부재
- 글 완성도: 2.5 — SDD-0004/0005, CR-001~016, PR #257~260 등 내부 식별자가 본문을 지배. 프로젝트 밖 독자(채용담당자)는 따라올 수 없음. "충격적 발견" 같은 표현도 정리 덜 된 인상
- 면접 방어력: 4 — 소재 자체는 꼬리질문 다 받아낼 수 있으나 글이 답을 찾기 어려운 형태
- 기술적 리스크: "payment-confirmations 분석이 Java 코드 기준(Go 재검증 필요)"을 본문이 스스로 명시 — 오히려 정직성 증거로 방어 가능
- 1차 근거 검증: O (7.8%, SDD 4개, PR 6개 실존)
- 판정: **리라이트하면 1군** — 소재 1급·완성도 미달의 전형. 내부 식별자 걷어내고 "3계층 병목 분리" 축으로 재구성하면 대표글감. 현 상태로는 scaling#3·#1이 대신 커버

## logs/kubernetes/goti-capacity-planning-keda (goti-scaling#1)

- 소재 강도: 5 — ticketing capacity를 재러 갔다가 진짜 범인(Stadium API)을 찾은 반전. API별 health matrix, 에러코드 분포에서 "400 2.48K = Stadium 느림→세션 TTL 초과의 2차 피해"라는 인과 체인 — 레이어 교차 진단의 정석
- 서사 구조: 4.5 — 측정 목표 5개→시나리오 매트릭스→결과→병목 판정 4건→우선순위 재배치→검증 기준(수치 목표)까지. "측정하러 갔다가 계획을 바꿈"이라는 서사가 살아있음
- 글 완성도: 4.5 — 표가 많지만 전부 판독 가능, 자립성 높음. Java→Go 체크리스트 섹션이 다소 길지만 가치 있음
- 면접 방어력: 4.5 — "Hibernate N+1 강력 추정(실측 프로파일링 별도 필요)"이라고 추정/실측을 스스로 구분 — 면접에서 오히려 신뢰 포인트. 단 "그래서 Stadium Go 전환 후 몇 ms 됐나?"는 후속 글 몫
- 기술적 리스크: "Istio sidecar mTLS overhead ~10ms/hop"은 통상 인용치(1~3ms)보다 높은 편 — 실측 표기 없으면 공격 가능 지점. 해당 문장에 출처나 실측 단서 추가 권장
- 1차 근거 검증: O (p95 6.84s, 5xx 10.88% 실존)
- 판정: **즉시 1군** — 교차 트러블슈팅 대표 최유력

## logs/challenge/goti-3000vu-queue-oneshot (goti-queue-poc#10)

- 소재 강도: 5 — queue 100% vs 결제 15.6% 괴리, order 60s timeout→hold 만료→좌석 탈취 race→409/unique 위반이라는 앱-DB 교차 인과 체인. n_live_tup=0(7.5GB 테이블 ANALYZE 전무) 발견은 백미
- 서사 구조: 5 — 문제→관측 패턴 5개→PgBouncer pool 증거로 가설 좁히기→EXPLAIN 1ms vs 부하 시 5~10s 구분→조치 3건→다음 가설. 후보 전체에서 가장 교과서적
- 글 완성도: 4.5 — 자립성·가독성 최상급. 표 하나하나 본문이 해설함
- 면접 방어력: 4 — "EXPLAIN 정상 ≠ 부하 시 정상" 논리가 강력. 약점: 조치 3건 적용 후 재측정 수치가 이 글에 없음 ("그래서 15.6%가 몇 %가 됐나?")
- 기술적 리스크: "플래너가 이 테이블을 비어있는 것으로 판단" — 플래너는 pg_stat_user_tables가 아닌 pg_class(reltuples/relpages)를 봄. 통계 부재→비효율 plan이라는 결론은 맞지만 메커니즘 서술이 부정확. 해당 문장 1곳 교정 권장
- 1차 근거 검증: O (100% vs 15.60% 실존)
- 판정: **즉시 1군** — 서사 구조 대표. 재측정 결과 1문단(또는 후속 글 링크) 보완 시 완성

## logs/challenge/goti-aws-full-destroy-gcp-latency-optimization (goti-multicloud#10)

- 소재 강도: 4.5 — 브라우저 900ms vs curl 60ms vs pod 내부 p95 785ms 삼각측량으로 병목 위치를 좁히고, DB 권한·누락 테이블·CPU limits(200m→CFS throttling) 3건을 독립 제거. "kubectl top 5~9m인데 p95 785ms" 역설이 훌륭
- 서사 구조: 4 — 문제→원인 3개→해결 3 Phase→Before/After 표(p50 10×, p95 5.5×). 수치로 닫힘. 단 destroy 런북 파트와 latency 추적 파트가 한 글에 섞여 초점 분산
- 글 완성도: 4 — 잘 읽히나 사실상 두 글(비용 정리 + 성능 추적)이 병합된 구조
- 면접 방어력: 4 — 각 원인의 증거가 명확(SQLSTATE 42501, 42P01, CFS)
- 기술적 리스크: 배운 점 3 "Go 런타임은 GOMAXPROCS가 CPU limits에 연동되기 때문에" — Go는 cgroup limit을 자동 인지하지 않음(automaxprocs 라이브러리 사용 시에만 연동). automaxprocs 사용 사실을 명시하지 않으면 면접에서 역공 가능한 문장. 교정 필수
- 1차 근거 검증: O (785ms→144ms 실존)
- 판정: **즉시 1군** — 교차 트러블슈팅 + 비용($0 수렴) 이중 역할 가능. GOMAXPROCS 문장 교정 조건부

## logs/istio/goti-istio-injection-label-pg-max-connections (goti-istio-ops#1)

- 소재 강도: 3 — 두 이슈가 인과로 얽힌 게 아니라 병발(본문 스스로 "독립적으로 진단"). namespace 라벨 유실은 원인이 "추정"으로 끝나고, max_connections은 표준 용량 계산 문제
- 서사 구조: 3.5 — 각 이슈별 문제→원인→해결→검증은 갖춤. 산정 근거 공식(5×2×10×2+10)은 좋음
- 글 완성도: 4 — 깔끔하고 자립적
- 면접 방어력: 3 — "라벨이 왜 유실됐나?"에 답 없음(추정). dev(Kind) 환경이라 프로덕션 서사도 아님
- 기술적 리스크: 낮음
- 1차 근거 검증: △ — "복합"은 맞으나 1차에서 기대한 인과 교차가 아니라 병발
- 판정: **탈락** — 같은 Istio×인프라 교차는 jwks-mismatch 글이, PG 커넥션 수리는 oneshot 글이 더 강하게 커버

---

## 배치 2 — 관측성·성능 계열

## logs/monitoring/goti-go-otel-sdk-missing-labels (goti-java-to-go#5)

- 소재 강도: 3 — 원인이 "SDK 초기화 코드를 안 썼음"이라는 누락. Java Operator 자동주입 vs Go 수동 초기화 대비는 교육적이나, 진단 자체는 깊지 않음
- 서사 구조: 3.5 — 문제→원인→해결 명확. 단 마무리가 "배포 후 예상 라벨" — 예상으로 끝나고 확인 수치 없음
- 글 완성도: 4 — 깔끔, 집중적
- 면접 방어력: 3 — "왜 누락됐나"의 답이 평범. 배운 점의 체크리스트/템플릿/플레이북 일반화가 가장 강한 부분
- 기술적 리스크: 낮음
- 1차 근거 검증: △ — "크로스레이어"라기보다 단일 레이어 누락의 증상이 관측 스택에 나타난 케이스
- 판정: **탈락** — 좋은 운영 글이지만 대표글 경쟁에서 밀림

## logs/challenge/goti-cloudflare-worker-lax-latency-investigation (goti-multicloud#5)

- 소재 강도: 5 — 체감 900ms vs 백엔드 32ms. cf-ray + x-envoy-upstream-service-time + pod 로그 3지점 상관 분석, 가설 5개 매트릭스 소거, 경로 분해 산수(700~1100ms 추정 vs 실측 934ms 일치). 엣지 네트워크×메시×앱 교차 진단의 전형
- 서사 구조: 5 — 기대→증상→증거→가설 매트릭스→확정→옵션 4개 비교→채택. 후보 중 최상급
- 글 완성도: 4.5 — 길지만 정돈. 단 조치 후 실측(After 수치)이 체크리스트("재측정 목표")로만 존재
- 면접 방어력: 4 — 진단은 철벽. **치명 리스크 1건**: 이 글은 "Smart Placement로 해결"이라 제목·요약에 명시하는데, 이틀 뒤 글(goti-aws-full-destroy... 배운 점 4)은 "LAX 이슈는 Smart Placement로도 완전히 해결되지 않는다 → DNS Only 전환"이라 서술. 두 글이 모순 — 면접에서 둘 다 읽은 사람에게 역공 지점
- 기술적 리스크: 위 모순 + After 실측 부재. 후일담 문단("Smart Placement 후 부분 개선 → 최종 DNS Only 전환" + 수치) 추가로 해소 가능 — 오히려 반복 개선 서사로 승격됨
- 1차 근거 검증: O
- 판정: **즉시 1군** (후일담 문단 추가 조건부) — 교차 진단 대표

## logs/challenge/goti-phase6-ticketing-sql-optimization (goti-ticketing-phase#2)

- 소재 강도: 4.5 — N+1 → 3-Phase 배치(70→9회), Go map 비결정 순회→deadlock(sorted slice 수정)은 진짜 동시성 발견. 앱 코드 역량 증명용으로 최적
- 서사 구조: 4 — 문제→원인→해결→P0 트리아지 선택지 비교. 단 검증이 "go build/test 통과"뿐 — 87%는 호출 횟수 계산이지 latency/TPS 실측 아님 ("12→200+ TPS"도 예상으로 명시돼 있어 정직함)
- 글 완성도: 4 — 커밋 단위 서술이 약간 로그성이나 판독 가능
- 면접 방어력: 4.5 — deadlock 메커니즘·P0 분류 기준이 명료해 꼬리질문에 강함. "그래서 실제 지연은?"만 후속 글 몫
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **즉시 1군** — "애플리케이션 코드가 인프라 장애로 발현" 포지셔닝의 앱 코드 쪽 절반을 담당

## essays/monitoring/goti-prometheus-agent-mode-adr

- 소재 강도: 4 — "Grafana는 이미 Mimir만 쿼리하는데 로컬 TSDB를 유지하는 이중 저장" 구조 통찰 + 옵션 4개 비교. limit 증설=우회였다는 자기 인식
- 서사 구조: 4 — ADR 완결. **단 제목이 "4Gi를 1.2Gi로 줄인"인데 본문은 "공식 벤치마크 기준 ~1.2Gi 예상"** — 실측 결과가 글에 없음. 제목-본문 불일치
- 글 완성도: 4.5 — essays답게 다듬어짐
- 면접 방어력: 3.5 — "실측 어디 있죠?"에 답 없음. 후속 글(goti-prometheus-agent-mode-and-monitoring-cascade)에 전환 실전이 있으므로 실측 문단 이식 가능
- 기술적 리스크: 제목의 수치가 예상치라는 점 자체
- 1차 근거 검증: △ — 98% 점유·3,981Mi 실존 / "1.2Gi로 줄인"은 미검증
- 판정: **리라이트하면 1군** — 실측 결과 문단 추가(또는 제목 완화) 조건부 ADR 대표 후보

## essays/monitoring/goti-adr-loki-tempo-stability-tuning

- 소재 강도: 4.5 — OOM→재시작→backlog 폭주→재OOM 피드백 루프 인식 + 3축 동시 해소. "OOM은 메모리 부족이 아니라 유입 제어 부재" 명제 좋음
- 서사 구조: 3.5 — 효과 섹션이 전부 "예상"(~800Mi 안정 예상). 실측 After 없음
- 글 완성도: 3.5 — "왜 매번 같은 패턴으로 죽는 거야?", "아!" 등 반말 감탄 잔존(격식체 위반). 다듬기 필요
- 면접 방어력: 4 — GOMEMLIMIT soft limit 설명 정확. **리스크**: 표에서 fetch_max 1MB(기본)를 "빠르게 소비하며 메모리 급증"의 원인으로 지목하고선 해결에서 5MB로 올림 — "fetch를 늘리는 게 왜 throttling인가?"에 본문 논리가 꼬여 있음(실제 레버는 max_processing_time). 해당 문단 논리 교정 필요
- 1차 근거 검증: O(악순환 구조) / X(절단 후 실측)
- 판정: **리라이트하면 1군** — 단 동일 소재(Kafka 버퍼+OOM)를 실측 사건 기반으로 다룬 tempo-oom-kafka-buffer-sampling이 우세라 중복 시 그쪽 채택

## logs/monitoring/goti-tempo-oom-kafka-buffer-sampling (goti-observability-stack#3)

- 소재 강도: 4.5 — 재시작 85회·compaction 로그 증거라는 실사건 + 원인 3개 구조 분석 + tail sampling 정책 설계(에러·느린 요청 100% / 나머지 10%). "관측 대상이 바빠질 때 관측 시스템도 바빠진다"는 통찰
- 서사 구조: 4.5 — 증상(로그·수치)→원인 3→조치 3(임시/근본 명시 구분)→Before/After→일반화. After가 "4Gi 안정 운영 + 유입 90% 감소"로 닫힘
- 글 완성도: 4 — Impact 섹션·구조 양호
- 면접 방어력: 4.5 — num_traces 확대 이유(미완료 트레이스 메모리 보유) 같은 메커니즘 이해가 드러남. 메모리 증설을 임시로 명시한 정직함
- 기술적 리스크: 낮음 ("초당 수만 건"은 개산)
- 1차 근거 검증: O
- 판정: **즉시 1군** — 관측 파이프라인 운영 완결성 대표. loki-tempo-stability ADR과 중복 시 이 글 우선

---

## 배치 3 — 기술 선택 ADR 계열

## logs/challenge/goti-java-to-go-migration-adr (goti-java-to-go#7)

- 소재 강도: 5 — 실측(3000VU 표) 기반 문제 정의 → 대안 7개(JVM 튜닝·Loom·GraalVM·Kotlin·Rust·Node·Go) 비교 → 결정 규칙 6개 → 롤백 설계 → 타임라인. 특히 "합산 효과에 대한 주의" 섹션에서 Go 단독 기여와 PgBouncer·캐시 등 혼재 효과를 스스로 분리 — 후보 전체에서 가장 성숙한 서술
- 서사 구조: 5 — ADR의 모범. 결과 표(메모리 6배·콜드스타트 10~20배)와 리스크·완화·롤백까지
- 글 완성도: 5 — 길지만 자립적, 외부 독자도 따라올 수 있음
- 면접 방어력: 5 — "Go 덕인지 어떻게 아나?"라는 고전 공격을 본문이 선제 차단. Phase 7 미완·프로젝트 종료도 정직하게 공개(역공보다 신뢰 포인트)
- 기술적 리스크: "pod당 메모리 요청 6배 절감"은 requests(설정값) 변화 — 실사용량 실측과 구분 질문 가능(PoC 실측 6배가 근거라고 답하면 됨). "queue pass_rate 1.04%"는 keda 글의 같은 테스트 서술(Stadium이 범인)과 프레임 차이 — 교차 독해 시 질문 소지
- 1차 근거 검증: O
- 판정: **즉시 1군** — 기술 선택 ADR 대표 최유력

## logs/challenge/goti-redis-first-ticketing-adr (goti-redis-sot#1)

- 소재 강도: 4 — 병목 실측(13~16%) 기반 결정 + 정합성 패턴 5종 정리. 다만 옵션 표가 3개로 얇고 패턴 해설 비중이 큼
- 서사 구조: 4 — 배경→선택지→결정→롤아웃→trade-offs. 결과 수치는 후속 글 몫
- 글 완성도: 4
- 면접 방어력: 3.5 — **날짜 모순**: frontmatter는 2026-02-22인데 본문 관련 기록이 2026-04-14 문서들을 인용하고 Phase A 보강에 PgBouncer(4월 도입) 등장. 시점 정합성 공격 가능
- 기술적 리스크: "RDS 부하 1/100"은 근거 없는 단정. 날짜 모순 교정 필요
- 1차 근거 검증: O
- 판정: **리라이트하면 1군** — 단 Redis SoT 서사는 실측 수치가 있는 롤아웃 글(D0~D1 558ms→32ms)이 더 강해서 대표 경합에서 밀림

## essays/kubernetes/goti-adr-istio-service-mesh

- 소재 강도: 4 — 3종 메시 + Gateway 대안 + Ambient 포기 근거(워터폴 trace workload name 불완전, 텔레메트리 이중 엣지)까지. Ambient 기각 논리가 차별점
- 서사 구조: 4 — 요구→비교→시나리오 적합도→기각. 단 자기 시스템 실측 수치가 없는 기능 비교표 중심 — "문서 요약" 성격이 절반
- 글 완성도: 4 — "어떻게 되겠습니까?", "좋은 질문입니다" 등 구어체 잔존
- 면접 방어력: 3.5 — "ztunnel L7 파싱은 상용 버전에서만"은 Solo.io 자료 기반 서술이라 반박 여지(업스트림 설계상 ztunnel=L4, L7은 waypoint 담당이 정확한 프레임). "70~90% 절감"은 인용 표기 있음
- 1차 근거 검증: O
- 판정: **탈락(대표 기준)** — 잘 쓴 글이나 실측 없는 비교형이라 5~7개 안에 못 듦. 포폴 본문에서 java-to-go ADR의 보조 링크로 가치

## logs/monitoring/goti-observability-stack-selection (goti-observability-stack#1)

- 소재 강도: 4.5 — 6개 결정을 하나의 아키텍처로 묶음. "왜 OTel Collector가 아닌가"에서 벤더 종속을 인정하고 탈출 경로를 명시한 정직성, 시그널별 Kafka 선택 적용, Prometheus 비활성+CRD만 유지 같은 비범한 결정 포함
- 서사 구조: 4.5 — 결정마다 대안 비교→근거. 실사고(Tempo OOM 85회)와 연결. 트레이드오프(12+ Pod, 메모리 47%) 공개
- 글 완성도: 4.5
- 면접 방어력: 4.5 — exemplar가 샘플링에 버려질 수 있다는 함정, metrics_generator vs spanmetrics connector 차이 등 세부 이해가 드러남
- 기술적 리스크: **후속 번복 미반영** — Decision 4(Alloy)는 이후 OTel Collector로 전환됨(goti-adr-alloy-to-otel-collector 글 존재). 이 글에 후일담 링크가 없어 "지금도 Alloy 쓰나요?"에 글이 낡은 답을 줌. 1문단 추가 필요
- 1차 근거 검증: O
- 판정: **즉시 1군 후보** — 관측성 설계 사고의 폭 증명. 최종 선정에서 tempo-oom(운영)과 java-to-go(ADR) 사이 중복 조정 대상

## logs/challenge/goti-kafka-adoption-decision-adr (goti-kafka#1)

- 소재 강도: 3.5 — 3축 결정 + 버전 호환 검증 + 토픽 설계로 꼼꼼하나, 본문 스스로 "구현은 Planned 상태" — 실행·검증이 없는 종이 아키텍처. 단독으로는 약함
- 서사 구조: 3.5 — 결정까지는 완결, 결과 없음
- 글 완성도: 4.5
- 면접 방어력: 3 — "Kafka 수백만 msg/s / RabbitMQ 수만 msg/s"는 마케팅성 비교 수치로 공격 가능(RabbitMQ 저평가). "그래서 돌려봤나요?" → "아니요, 제거했습니다"가 되는 구조
- 1차 근거 검증: O
- 판정: **탈락(단독)** — #3(제거 글)과 묶인 번복 서사의 전편으로서 링크 가치만

## logs/challenge/goti-managed-kafka-removal (goti-kafka#3)

- 소재 강도: 4.5 — "채택 완료한 Kafka를 사용처 소멸로 전면 제거"라는 희귀한 번복 서사 + Redis 자체 운영 전환을 ROI 계산(연 $1,440~2,280 절감 vs 10개+ 서비스 env 변경 공수·사고 리스크)으로 기각. **후보 중 유일하게 비용 의사결정이 정면 주제**
- 서사 구조: 4 — 두 Decision 각각 옵션→기각→기준→실행(구체 파일 목록)→배운 점. "쓰지 않는다도 유효한 결정" 명제가 시니어 감각
- 글 완성도: 4.5
- 면접 방어력: 4.5 — Redis Operator 생태계 정체(Spotahome/OpsTree 2022 마지막 릴리스, Palark 데이터 파괴 사례)는 검증 가능한 근거. "Zookeeper 대체 KRaft가 자원 소비" 문장만 표현 어색
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **즉시 1군** — 판단 번복 + 비용 ROI 이중 역할. 도입 ADR(#1)을 본문에서 링크해 묶으면 완성

---

## 배치 4 — 멀티클라우드 설계·비용·번복 계열

## logs/kubernetes/goti-multicloud-circuit-breaker-hpa-adr (goti-multicloud#1)

- 소재 강도: 4.5 — "5xx failover는 네트워크 레이어 실패(TCP timeout)를 못 잡는다"는 레이어 구분 통찰 + Circuit state를 Cloudflare Cache API max-age=60으로 저장해 PoP별 독립 CB를 만든 설계 + KEDA가 존재하지 않는 Mimir 주소를 참조해 사실상 죽어 있었다는 발견
- 서사 구조: 4.5 — 문제 2개(메커니즘 설명)→대안 4→채택→설계 상세→"왜 B가 아니라 C인가"(SPA 5~10 API 병렬 호출 논증)→롤백까지. PoP 단위 롤링 복귀가 cold start 쇼크를 분산한다는 운영 고려도 수준급
- 글 완성도: 4.5 — 자립적
- 면접 방어력: 4 — 결과 섹션은 "체감 지연 거의 없음 확인"인데 체크리스트의 "지연 ≤1.5s 확인" 항목은 미체크 상태로 남음 — 검증 미완 긴장. Cache API는 best-effort라 조기 eviction 시 CB가 일찍 닫힐 수 있다는 반론도 가능(글에서 미언급)
- 기술적 리스크: 위 Cache API eviction 미언급. 낮은 편
- 1차 근거 검증: O
- 판정: **즉시 1군 후보** — 복원력 설계 대표. promote-automation과 슬롯 경합

## logs/challenge/goti-cross-cloud-db-promote-automation-adr (goti-multicloud#14)

- 소재 강도: 5 — 장애 도메인 분리 원칙으로 옵션 5개를 소거(GitHub Actions=DR의 SPOF, edge에 credential 배포 위험, Temporal 과투자)하고 split-brain 방어 장치 표 + RTO Tier 표까지. 실제 수동 runbook 경험(훈련 10~20분/실전 30분+)이 바탕
- 서사 구조: 4.5 — SRE 설계 리뷰 수준. 단 **설계만 있고 구현이 없음** — 선행 조건에 "AWS 전량 destroy 상태라 RDS 자체가 없음"이라 명시. Tier 2는 미착수로 프로젝트 종료
- 글 완성도: 5 — 후보 중 가장 다듬어진 축
- 면접 방어력: 4.5 — 업계 레퍼런스(Aurora/Patroni in-region, Netflix/Shopify 반자동)로 "완전 자동화 안 한 이유"를 방어. "구현했나요?"에는 "Tier 1 설계까지, 종료로 미구현"이 정직한 답 — 감점 요인이나 치명적이진 않음
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **즉시 1군 후보** — DR 설계 사고 대표. 단 실행·검증이 있는 circuit-breaker 글과 하나만 선택 권장

## essays/monitoring/goti-finops-opencost-adoption-adr

- 소재 강도: 3.5 — P0/P1 요구사항 정리 + Kubecost IBM 인수 후 가격·GKE 무료 티어 제외 같은 구체 근거는 좋으나, 도구 "채택 계획" 단계에서 끝남 — 절감 실적 수치 없음(1차에서 확인하려던 관건이 부정으로 확정)
- 서사 구조: 4 — ADR 완결, 실행 결과 부재
- 글 완성도: 4.5
- 면접 방어력: 3.5 — "배포해서 뭘 발견했나?"에 답 없음. Kubecost 가격 정책은 변동이 잦아 시점 명시 필요
- 1차 근거 검증: O (비용 절감 수치 없음 확인)
- 판정: **탈락(대표 기준)** — 비용 서사는 실적이 있는 kafka-removal(ROI 계산)·aws-destroy($0)가 커버. 보조 링크 가치

## essays/istio/istio-ambient-part7-migration-to-sidecar

- 소재 강도: 3.5 — Ambient→Sidecar 번복 자체는 좋은 소재이나 본문 대부분이 마이그레이션 절차 가이드(targetRef→selector, ztunnel 제거, SG 규칙)
- 서사 구조: 3 — 전환 이유 3개는 명확하나 전환 "후" 카나리를 실제 운영한 결과가 없음
- 글 완성도: 3.5 — 한 줄 요약이 반말("돌아왔다"). 체크리스트/튜토리얼 성격
- 면접 방어력: 3 — **리스크 2건**: (1) "6개월 운영" 주장인데 블로그상 Ambient 도입 글(part4, 2025-12-24)과 이 글(2026-01-05)이 12일 차 — 발행일≠사건일이라 해명 가능하나 정합성 질문 소지 (2) 표의 "Ambient Circuit Breaker: 미지원" 단정 — waypoint(=Envoy) 배포 시 DestinationRule CB가 일부 동작하므로 버전 한정 없는 단정은 공격 가능
- 1차 근거 검증: △ — 번복 서사는 실존하나 깊이가 기대 이하
- 판정: **탈락** — 번복 서사는 kafka-removal이 실질(비용·정리 실행)까지 갖춰 우세

---

## 배치 5 — AI 네이티브 엔지니어링 계열

## essays/challenge/goti-claude-vs-gemini-k8s-pr-176 (goti-ai-review-comparison#1)

- 소재 강도: 4 — confidence 점수까지 붙인 정량 비교표 + Gemini 오탐(Kind 호스트 네트워크 맥락 부재) 분석. 깔끔하나 후속편(#192)보다 단순
- 서사 구조: 4 — 대상→비교표→강점→오탐→패턴("공통 3건만 신뢰")
- 글 완성도: 4.5
- 면접 방어력: 4 — Gemini 강점도 인정해 편향 인상 없음
- 기술적 리스크: 낮음
- 1차 근거 검증: O (9건 vs 4건 실존)
- 판정: **예비** — 같은 시리즈 #192가 "방향 반대" 케이스로 우세. 둘 다 선정은 중복

## essays/challenge/goti-claude-vs-gemini-k8s-pr-192 (goti-ai-review-comparison#2)

- 소재 강도: 4.5 — "같은 라인, 반대 방향 권고" 2건을 과거 인시던트(FQDN 해석 실패) 기준으로 사람이 판정. "일치 0" 해석, Gemini가 잡고 Claude가 놓친 `~` 문법까지 양방향 정직 분석. AI 도구 "사용"이 아니라 "판단 체계"를 보여줌
- 서사 구조: 4.5 — 모순 케이스 → 상호 누락 → 강점/약점 표 → 워크플로우 함의
- 글 완성도: 4.5
- 면접 방어력: 4.5 — 최종 결정 기준이 프로젝트 인시던트 이력이라는 점이 강함
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **즉시 1군** — AI 네이티브 대표 후보 (판단력 축)

## essays/challenge/goti-review-pr-gap-learning (goti-meta#1)

- 소재 강도: 4.5 — 갭 5건 누적→근본 약점 3개 도출("works=OK 편향", 파일 내부 일관성 미체크, 패턴 집계 부재)→에이전트 프롬프트에 체크 12개 주입. 리뷰 시스템에 피드백 루프를 설계한 기록 — 기준 5("워크플로우/검증 게이트로 설계")의 정의에 부합
- 서사 구조: 4.5 — 문제→원인(프롬프트에 실패 사례 부재)→해결(12개 체크 전문 수록)→사이클 일반화
- 글 완성도: 4.5
- 면접 방어력: 4 — 개선 "후" 갭 감소율 측정이 없음(후속 글에서 갭이 25건으로 누적 — PR 수 증가로 해명 가능하나 선제 문단 있으면 좋음). "Gemini는 대규모 학습 데이터로 내재화"는 추정성 서술
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **즉시 1군 후보** — AI 네이티브 대표 후보 (시스템 설계 축)

## essays/challenge/goti-ai-workflow-large-improvement (goti-meta#8)

- 소재 강도: 4.5 — 89 트러블 로그+25 리뷰 갭을 rules/skills/agents로 체계 반영, 외부 검증에서 자기 오류 2건 교정(오정보가 규칙화되는 것을 차단), 스킬 참조율 20%→36%. 지식 시스템 엔지니어링 스케일이 큼
- 서사 구조: 4 — 문제→원인(지식 휘발 구조)→3배치 해결→Result 수치. "기대 효과"(1.5h→5분)는 예측치로 명시돼 있으나 실측 후속 없음
- 글 완성도: 4 — 내부 파일명 밀도 높지만 표로 정리돼 판독 가능
- 면접 방어력: 4 — 자기 교정 2건 공개가 신뢰 포인트. 수치가 인벤토리 계수라 검증 가능
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **즉시 1군 후보** — gap-learning과 같은 축(피드백 루프)이라 최종에서 하나 선택 + 상호 링크 권장

---

## 배치 6 — 운영 완결성 계열 + meta

## essays/challenge/goti-claude-code-config-optimization (goti-meta#6)

- 소재 강도: 4 — "Claude가 규칙을 안 따른다"는 증상의 근본 원인이 시작 토큰 과소모(40K)였다는 진단 + path-scoping 설계. 수치(48% 절감) 명확
- 서사 구조: 4.5 — 증상→구조 원인→4단계→Result 표
- 글 완성도: 4.5
- 면접 방어력: 4 — 토큰 수치가 추정치(~40,000)임은 표기됨. 줄 수 변화는 검증 가능
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **예비** — AI 네이티브 축 3순위. Claude Code 특화 소재라 범용성은 192·gap-learning보다 낮음

## logs/challenge/goti-session-dropout-root-cause-audit (goti-auth#7)

- 소재 강도: 5 — 사용자 체감 증상("로그인 직후 튕김")을 FE(zustand 타이머·axios interceptor·localStorage persist·백그라운드 탭 throttle) × BE(viper 기본값 30분, K8s env 부재) × Istio(403을 만료로 오판) 3레이어에 걸쳐 file:line 단위로 매핑. P0~P2 트리아지 + 완화책 5개 우선순위. 프론트-백-메시를 관통하는 유일한 후보
- 서사 구조: 4.5 — 증상→기처리 중복 배제→P0/P1/P2→완화책→재현 절차→"확인 필요" 목록. 단 **완화책 적용 후 결과가 없음** — 열린 루프
- 글 완성도: 4.5 — 모든 주장에 코드 라인 증거
- 면접 방어력: 4.5 — "추정 라인", "재현 절차 미확보" 등 불확실성을 스스로 표기. "그래서 고쳐졌나?"만 후속 필요
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **즉시 1군 후보** — 적용 결과 1문단 보완 시 크로스레이어 진단 대표 확정

## logs/kubernetes/goti-eks-rolling-update-cascading-failures (goti-eks#2)

- 소재 강도: 5 — rolling update 하나가 Terraform state 의미론(inline+rule 혼용 삭제)·VPC CNI IP 산수(18노드×48IP=864 > 254 데드락)·Kyverno webhook·Prometheus WAL 4개 레이어에서 연쇄 폭발한 실제 프로덕션 사고(15개 서비스 전체 다운). IP 데드락 순환 구조 서술이 백미
- 서사 구조: 4.5 — 증상 로그 4종→원인 4건 메커니즘→복구 타임라인 11단계→15/15 복구 확인→재발 방지 체크리스트 표 2개. 기준 4(운영 완결성)의 교과서
- 글 완성도: 4.5 — 자립적, 로그 증거 충실
- 면접 방어력: 4.5 — Terraform 삭제 메커니즘·warm pool 산수 모두 검증 가능. Kyverno 원인만 다소 뭉뚱("일시적으로 정책 위반 감지") — 구체 정책명 질문 가능
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **즉시 1군** — 인프라 연쇄 장애 + 재발 방지 대표

## logs/kubernetes/goti-node-rightsizing-and-rebalancing (goti-scaling#2)

- 소재 강도: 4.5 — "actual 4~14%인데 축소 불가" 역설 → 스케줄러는 requests로 판단 + Descheduler 로그("No node is underutilized")가 오판을 교정 + Istio sidecar 1.3 vCPU 합산 누락 + Prometheus 이중 저장 근본 원인 연결. 비용(노드 12→8) 서사 겸함
- 서사 구조: 4 — 문제→로그 근거→해결→Before/After 표. 단 "Step 5"부터 시작하는 세션 로그 잔재(Step 1~4 부재)가 외부 독자에게 어색
- 글 완성도: 4 — Step 넘버링 정리 필요
- 면접 방어력: 4.5 — 오판을 스스로 공개하고 교정 과정을 보여줌
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **즉시 1군 후보** — 비용·스케줄링 원리 이해 증명. agent-mode ADR과 "Prometheus 이중 저장" 소재 연결로 시너지

---

## 배치 7 — 1차 보류 그룹

## logs/kubernetes/goti-istio-jwks-mismatch-cdn-jwt-401

- 소재 강도: 5 — 4ms + text/plain 응답을 "Envoy가 앱까지 안 보내고 차단" 포렌식 증거로 사용, 가설 3개 소거, 19개 서비스 전수 불일치 확인, "어제는 왜 됐지?"의 답(RequestAuthentication만 있고 AuthorizationPolicy 없으면 검증 실패해도 통과)이라는 반전, jwksUri가 STRICT mTLS에 막히는 메커니즘(istiod=plain HTTP), ArgoCD helm template에서 lookup 불가 제약, 실용적 타협, Falco 사이드이펙트 리팩토링까지. Istio×GitOps×보안 3계면 관통
- 서사 구조: 5 — 증상→포렌식→가설 검증→root cause→반전→수정 시도 2회 실패(각각 메커니즘 규명)→실용 결정→최종 smoke 100% 검증→재발 방지 표. 실패한 시도를 정직하게 기록한 유일한 글
- 글 완성도: 4.5 — 길지만 모든 섹션이 제 몫. 자립성 최상
- 면접 방어력: 5 — 모든 주장이 메커니즘 단위로 검증 가능. "장애가 안 나서 문제를 인지 못한 것이 더 위험"은 시니어급 통찰
- 기술적 리스크: 낮음 (istiod plain HTTP 제약은 문서화된 사실)
- 1차 근거 검증: O — 1차 "보류" 판정을 크게 상회. 프론트매터 추정의 한계를 보여준 대표 사례
- 판정: **즉시 1군** — 단일 글 기준 후보 전체 1위

## logs/challenge/goti-load-test-db-realistic-data (goti-loadtest#2)

- 소재 강도: 4.5 — "75K rows에선 인덱스가 전부 캐시에 상주해 병목이 숨는다"는 방법론 결함 발견 + 시드 전후 동일 조건 비교(좌석선택 p95 514ms→12,355ms 24배) + "지표 악화 = 정상화" 재해석. 실제 KBO 스케줄 기반 시드 설계
- 서사 구조: 4.5 — 왜→문제→원인→3단계 시드→제약 위반·디스크 풀 트러블→전후 비교표. 수치로 닫힘
- 글 완성도: 4.5
- 면접 방어력: 4 — **리스크 1건**: "인덱스가 메모리에 있어 EXPLAIN cost 추정이 캐시 히트 가정으로 낮음" — 플래너 cost는 캐시 상태를 직접 보지 않음(effective_cache_size 설정 기반 추정). 방향은 맞으나 메커니즘 표현이 느슨해 DB 전문 면접관에게 공격 가능. 해당 문단 교정 권장
- 1차 근거 검증: O
- 판정: **즉시 1군 후보** — 부하테스트 계열 3파전(keda·oneshot·이 글)에서 조정 대상

## logs/argocd/argocd-app-of-apps-deadlock (argocd-troubleshooting#1)

- 소재 강도: 4 — root-app 자기 참조 deadlock("waiting for healthy state of ... 자기 자신") + ArgoCD가 자기 secret을 prune해 자멸하는 2연쇄. GitOps footgun으로 훌륭
- 서사 구조: 4 — 증상→operationState 증거→원인→즉시+영구 해결→2차 문제→검증→체크리스트
- 글 완성도: 4 — wealist 시절(2026-01) 글이라 goti 서사와 별개. 후반 튜토리얼 톤
- 면접 방어력: 4
- 기술적 리스크: 낮음
- 1차 근거 검증: O
- 판정: **예비** — 단일 툴 심도로는 좋으나 상위 경쟁에서 밀림. GitOps 역량 보조 링크

## logs/challenge/goti-agentic-control-plane-evolution (goti-portfolio-meta#4)

- 소재 강도: 4 — 자기 시스템의 빈 레이어 4개 진단 + 4 Phase 로드맵은 좋은 사고. 단 실행 전 계획 단계(Phase 1 "진행")
- 서사 구조: 3.5 — 동향→진단→로드맵. 결과 없음
- 글 완성도: 4
- 면접 방어력: 3 — **후보 전체에서 가장 취약한 인용**: Gartner 70%·MTTR 3배·ROI 171%가 listicle 블로그(sherlocks.ai, dev.to) 출처 — "ROI 171% 출처가?"에 방어 불가. 대표글로 링크 시 역효과 위험
- 1차 근거 검증: O (방향성 글임을 확인)
- 판정: **탈락** — AI 네이티브 슬롯은 실행 기록이 있는 글(192·gap-learning)이 우선
