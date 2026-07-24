# 3차 편집 로그

> 작업 범위: portfolio-selection.md의 7선 보완 지시 + 리라이트 4편(승인 후 진행).
> scorecard.md는 참조만 하고 새 작업 근거로 쓰지 않음.

---
## 1. logs/kubernetes/goti-istio-jwks-mismatch-cdn-jwt-401.md

- 지시 출처(portfolio-selection.md #1 보완): "이모지 헤더(🎯🔥🤔) 제거 수준의 정리만 필요 — 내용은 현재 완성"
- Before → After: H2 헤더 11개에서 선행 이모지 제거(🎯📊🔥🤔🔧✅📋📚). 본문·수치·링크는 무변경
- 수치 검증: 해당 없음(문구 편집)
- 비고: lint 훅이 이 파일의 기존 마침표 생략 122건(내 편집과 무관, 원문 그대로)을 매 Edit마다 재보고함. 지시 범위 밖이라 손대지 않음
- **정정(사용자 피드백 반영)**: 이모지 헤더 제거를 실행했으나, logs/troubleshooting 트랙 전반(수십 개 글)에서 🔥🤔✅📚 헤더가 일관된 하우스 스타일임을 재확인 후 전량 원복. "옛 글에 현재 규칙을 강제하지 말라"는 지시에 따라 이 항목은 최종적으로 **무편집**으로 종결

## 2. logs/challenge/goti-3000vu-queue-oneshot.md

- 지시 출처(portfolio-selection.md #2 보완): "① '플래너가 이 테이블을 비어있는 것으로 판단' 문장 교정 — pg_stat_user_tables가 아니라 pg_class 통계(reltuples/relpages)를 봄" / "② 조치 3건 적용 후 재측정 수치 1문단(또는 Redis SoT 롤아웃 글 링크)"
- Before → After ①: "플래너가 이 테이블을 비어있는 것으로 판단하고 plan을 짜면" → "플래너는 pg_stat_user_tables가 아니라 pg_class의 reltuples(추정 행 수)로 plan을 세우는데, ANALYZE가 없으면 이 값도 갱신되지 않아"로 메커니즘 교정
- Before → After ②: "다음 테스트 가설" 목록에 "후속 결과" 항목 추가 — 2차 부하테스트(같은 날, 같은 3개 조치)에서 ticket_success 15.60%→13.2%로 악화, 원인은 MaxConns 축소 역효과 + 노드 자원 부족. `/logs/goti-3000vu-2nd-and-next-checklist` 링크
- 수치 검증: goti-3000vu-2nd-and-next-checklist.md 본문 직접 확인 — "ticket_success 15.6% → 13.2%(악화)" 표, "MaxConns 축소가 역효과", "0/10 nodes are available: 8 Insufficient cpu" 로그 인용. 2차에서 변경된 3개 설정(ANALYZE·MaxConns 18→10·PgBouncer pool_size 100)이 oneshot 글의 3개 조치와 정확히 일치함을 대조 확인
- 비고: 원래 기대했던 "개선 수치"가 아니라 "악화 원인 규명"이었음. 정직하게 그대로 반영(임의로 긍정적 결과로 각색하지 않음)
- **정정**: 추가한 두 문장 모두 이 글의 기존 문체(마침표 있음)에 맞춰 마침표 유지. 최초에는 "현재" lint 규칙에 맞춰 마침표를 지웠다가, "옛 글은 그 글 자체의 문체를 따라야 한다"는 사용자 피드백으로 원복

## 3. logs/challenge/goti-cloudflare-worker-lax-latency-investigation.md

- 지시 출처(portfolio-selection.md #3 보완, 작업지시 규칙 4): "LAX 모순 해소: 3번 글 말미에 '이후 전개' 문단 추가 — Smart Placement 한계와 DNS Only 전환까지 정직하게. 원 글의 당시 결론 자체는 수정하지 않는다"
- Before → After: 파일 최말단에 "## 이후 전개" 신규 섹션 추가. 기존 "채택: Option A 즉시 적용" 절 및 결론은 무변경(기록 보존)
- 추가 내용: "Smart Placement만으로 완전히 해결되지 않아 DNS Only로 전환, 900ms대→60ms" + `/logs/goti-aws-full-destroy-gcp-latency-optimization` 링크
- 수치 검증: goti-aws-full-destroy-gcp-latency-optimization.md 본문 직접 확인(2차 심사에서 이미 정독) — "배운 점 4. Cloudflare DNS Only가 한국 latency의 정답일 수 있습니다 — LAX Edge 라우팅 이슈는 Smart Placement로도 완전히 해결되지 않습니다. CF 보호를 포기하고 origin 직통으로 전환하면 즉시 큰 개선이 나옵니다(900ms → 60ms)" 문장을 그대로 인용
- 비고: 두 글의 모순을 "판단 오류"가 아니라 "반복 개선 서사"로 정리. Smart Placement 단계만의 격리된 효과 수치는 후속 글에 없어 언급하지 않음(과장 방지)

## 4. logs/challenge/goti-java-to-go-migration-adr.md

- 지시 출처(portfolio-selection.md #4 보완): "① '메모리 6배'가 requests(설정값) 변화임을 감안해 PoC 실측 근거 1문장 보강" / "② 'queue pass_rate 1.04%'가 keda 글과 프레임 차이 — 각주 1줄로 정합"
- Before → After ①: "결과" 표 앞 문단에 "표의 pod당 메모리 요청 값은 배포 시 설정한 requests이며, 이 설정치는 앞서 확인한 ticketing-go PoC 실측 메모리 사용량(동일 부하 조건 대비 6배 절감)을 근거로 산정했습니다" 1문장 추가
- Before → After ②: "queue pass_rate 1.04%" 문단 끝에 "같은 측정 데이터를 API별로 더 깊이 분석한 결과, 병목의 상당 부분은 Stadium 조회 API의 N+1 쿼리에 있었습니다(...) JVM 런타임 자체의 한계와 이 API별 쿼리 문제는 서로 배타적이지 않으며..." 1문장 + `/logs/goti-capacity-planning-keda` 링크 추가
- 수치 검증: goti-capacity-planning-keda.md의 R2 테이블(2차 심사에서 정독)과 이 문서의 "Java prod 3000VU 실측(2026-04-12)" 테이블의 4개 엔드포인트 수치(p95/5xx)가 완전히 일치함을 직접 대조 확인 — 동일 테스트 데이터임을 확정 후 링크
- 비고: 두 항목 모두 기존 문장은 보존하고 문장만 추가
- **정정**: 추가한 두 문장 모두 이 글의 기존 문체(마침표 있음)에 맞춰 마침표 유지. 최초에는 "현재" lint 규칙에 맞춰 마침표를 지웠다가, "옛 글은 그 글 자체의 문체를 따라야 한다"는 사용자 피드백으로 원복

## 5. logs/challenge/goti-managed-kafka-removal.md

- 지시 출처(portfolio-selection.md #5 보완): "① 도입 ADR(goti-kafka#1)을 본문에서 링크해 번복 서사를 한 쌍으로 묶기" / "② 'Zookeeper 대체 KRaft가 계속 자원을 소비' 문장 표현 교정(KRaft는 별도 앙상블이 없음)"
- Before → After ①: "이전 ADR(goti-kafka 시리즈 이전 글)" plain text 언급 → `[Kafka 도입 아키텍처 결정 — Strimzi + KRaft로 선택한 이유](/logs/goti-kafka-adoption-decision-adr)` 마크다운 링크로 교체
- Before → After ②: "Strimzi Operator, Zookeeper 대체 KRaft, 관련 NetworkPolicy가 계속 자원을 소비합니다" → "Strimzi Operator, Kafka 브로커(KRaft controller 겸용), 관련 NetworkPolicy가 계속 자원을 소비합니다" — KRaft가 ZK처럼 별도 앙상블이 아니라 브로커 자체의 controller 겸용 역할임을 명확화(goti-kafka-adoption-decision-adr의 "KRaft combined mode... controller와 broker 역할을 동일 Pod에서 겸용" 서술과 일치)
- 수치 검증: 해당 없음(개념 정확성 교정)
- 비고: 문장 끝 마침표는 이 글의 기존 문체(마침표 있음)를 그대로 따름

## 6. logs/kubernetes/goti-eks-rolling-update-cascading-failures.md

- 지시 출처(portfolio-selection.md #6 보완): "Kyverno 차단 원인이 '일시적으로 정책 위반 감지'로 뭉뚱함 — 어떤 정책이었는지 이벤트 로그 1줄 보강"
- 실행: **미실행**
- 사유: 규칙 3("사실 주장 추가 시 근거 필수... 후속 글에 없는 수치는 쓰지 말고 UNVERIFIED로 보고") 적용. 어떤 Kyverno 정책이 rolling을 차단했는지는 이 글 본문 어디에도 없고, 관련 후속 글도 찾지 못함. 근거 없이 정책명을 지어낼 수 없어 편집 보류
- → **UNVERIFIED 목록에 등재**

## 7. essays/challenge/goti-claude-vs-gemini-k8s-pr-192.md

- 지시 출처(portfolio-selection.md #7 보완, 최대 2): "① 자매글(gap-learning)을 서두에 링크해 '판단+시스템 설계' 쌍으로 제시" / "② 이 결정들이 이후 재발을 막았는지 후속 1줄"
- Before → After ①: 한 줄 요약 블록쿼트 직후에 "이 비교는 리뷰 결과를 정량화하는 데서 그치지 않고... 프롬프트 개선 사이클은 [리뷰 PR 갭 학습 — Gemini가 잡고 Claude가 놓친 5건에서 12개 체크를 도출하기](/essays/goti-review-pr-gap-learning)에서 다룹니다" 1문장 추가
- ②: **미실행** — FQDN 방향 결정(긴 형식 통일)이나 excludePaths 결정이 이후 실제로 재발을 막았는지 확인할 후속 글을 찾지 못함. UNVERIFIED로 보고, 추가하지 않음
- 수치 검증: 해당 없음(링크 추가만)
- 비고: 이 글은 essays 트랙이라 원래 문장 끝 마침표가 생략된 문체 — 추가한 문장도 마침표 없이 작성해 일치시킴(이 글 자체의 기존 문체를 따른 것)

---

# UNVERIFIED 목록 (사람 확인 필요)

1. **eks-rolling-update-cascading-failures.md** — Kyverno가 core 노드 그룹 rolling을 차단한 정확한 정책명/이벤트 로그. 본문·후속 글 어디에도 근거 없음. 확인 후 추가하려면 실제 `kubectl get events` 로그나 Kyverno policy report 원본이 필요
2. **claude-vs-gemini-k8s-pr-192.md** — PR #192에서 정한 FQDN 긴 형식 통일·excludePaths wildcard+주석 결정이 이후 실제로 재발을 막았는지 여부. 후속 검증 글이 있는지 확인 필요

---

# 리라이트 4편 (승인 완료: 1,2,3 진행 / 4 보류)

## R1. essays/monitoring/goti-prometheus-agent-mode-adr.md

- 문제: 제목 "4Gi 메모리를 1.2Gi로 줄인"이 본문엔 예상치로만 존재(제목-본문 불일치)
- Before → After:
  - 제목: "4Gi 메모리를 1.2Gi로 줄인 아키텍처 결정" → "메모리를 82% 줄인 아키텍처 결정"
  - 한 줄 요약: "메모리를 70% 절감했습니다" → "실제 전환 후 메모리는 2,770Mi에서 492Mi로 82% 줄었습니다"
  - "예상 효과" 섹션 뒤, "배운 점" 앞에 "## ✅ 실제 결과" 신규 섹션 추가 — 실측 표(2,770Mi→492Mi, -82% / CPU 500m→100m) + "예상(~1.2Gi, 70%)보다 실제가 더 컸다" 문장 + 후속 글 링크
- 수치 검증: `logs/monitoring/goti-prometheus-agent-mode-and-monitoring-cascade.md` 본문 직접 확인 — "전환 전 실측 2.77Gi" 표, "Prometheus 메모리(실측) 2770Mi → 492Mi -82%" 최종 상태 표를 그대로 인용
- 비고: ADR 선택지 비교·결정 근거 등 기존 본문은 무변경. 추가 문장은 이 파일의 기존 문체(마침표 있음)를 따름

## R2. essays/monitoring/goti-adr-loki-tempo-stability-tuning.md

- 문제: (a) fetch_max 1MB를 원인으로 지목했다가 해결책에서 5-10MB로 올리는 논리 모순 (b) 반말체 잔존
- Before → After (a): "기본 max_fetch_size는 1MB지만... 명시적으로 더 큰 값(5-10MB)을 설정하고 max_processing_time을 늘려 처리 여유를 주는 것이 핵심입니다. **아!** fetch 크기 자체보다, 처리 속도 조절이 관건이었습니다." → "fetch_max 값 자체보다 max_processing_time이 핵심이었습니다. 재시작 시 consumer가 backlog를 소비하는 속도가 tail_sampling의 처리 속도를 앞지르면, 처리를 기다리는 데이터가 메모리에 쌓입니다. fetch_max를 5-10MB로 명시하는 것은 fetch 단위를 예측 가능하게 만드는 보조 조치일 뿐이고, 소비와 처리 속도를 맞추는 실제 레버는 max_processing_time입니다." — fetch_max를 원인이자 해결책 양쪽에 두던 모순을 제거하고, max_processing_time을 유일한 실제 레버로 명확화
- Before → After (b): "**뭐지? 왜 매번 같은 패턴으로 죽는 거야?**" → "동일한 패턴이 반복되는 이유가 무엇인지 확인이 필요했습니다."
- 수치 검증: 해당 없음(논리·어투 교정). "1초의 여유를 주면 처리와 소비가 균형을 이룹니다" 등 뒤쪽 "해결" 섹션은 이미 max_processing_time을 핵심으로 서술하고 있어 이번 교정과 정합됨을 확인
- 비고: "예상 효과" 섹션(메모리 예상치)은 원래 "예상"으로 명시 라벨링돼 있어 손대지 않음. 후속 실측 검증 글을 찾지 못해 실측 수치는 추가하지 않음(UNVERIFIED). 추가/수정 문장은 이 파일 기존 문체(마침표 있음) 유지

## R3. logs/challenge/goti-redis-first-ticketing-adr.md

- 문제: (a) "RDS 부하 1/100" 근거 없는 단정 (b) frontmatter 날짜(2026-02-22)와 본문 내 4월 문서 인용 간 불일치
- Before → After (a): Trade-offs 표 "RDS 부하 1/100, latency ms 단위" → "RDS 부하 대폭 감소, latency ms 단위" — 근거 없는 배수 삭제
- 추가: 표 직후에 "이 전환이 실제로 얼마나 빨라졌는지는 이후 D0~D1 롤아웃에서 확인됩니다. [Redis SoT D0~D1 프로덕션 롤아웃 — 558ms를 32ms로](/logs/goti-redis-sot-d0-d1-rollout)에서 seat-statuses 응답이 900ms대에서 32ms로 줄어든 실측치를 다룹니다" 1문장 추가
- 수치 검증: goti-redis-sot-d0-d1-rollout.md 본문 직접 확인(2차 심사 정독) — "서버 측 900ms → 32ms 수준 개선" 인용. 단, 이 실측치는 seat-statuses 응답시간이지 "RDS 부하" 자체의 감소율은 아니므로, 표 셀은 "RDS 부하 1/100"의 대체 수치로 채우지 않고 정성적 표현("대폭 감소")으로만 완화 + 관련 있는 실측 결과는 별도 문장으로 명확히 구분해 링크
- (b) 날짜 불일치: **미수정**. 승인된 방식대로 frontmatter는 건드리지 않고 보고만 함 — 이 문서가 2월 작성 후 계속 갱신된 living document인지, 발행일 자체가 잘못 기록된 것인지 git 이력 확인 없이는 판단 불가
- 비고: 추가 문장은 이 파일 기존 문체(마침표 있음) 유지

---

# 최종 요약

- 7선 보완: 5개 실행(1,2,3,4,5) + 2개 미실행/UNVERIFIED(6,7의 항목②)
- 리라이트: 3개 실행(1,2,3) + 1개 보류(4, pod-scaling-vs-karpenter-nodepool — 근거 없음)
- 전체 UNVERIFIED 목록:
  1. eks-rolling-update-cascading-failures.md — Kyverno 차단 정책명/이벤트 로그
  2. claude-vs-gemini-k8s-pr-192.md — FQDN/excludePaths 결정의 재발 방지 확인
  3. goti-pod-scaling-vs-karpenter-nodepool.md — 5차 부하 결과 및 NodePool 최종 판정 (리라이트 전체 보류)
  4. goti-redis-first-ticketing-adr.md — frontmatter 날짜(2026-02-22)의 정확성 (git 이력 미확인)
- 사용자 피드백으로 중간 정정된 사항: "옛 글에는 그 글 자체의 기존 문체(마침표 유무, 이모지 헤더 등)를 따른다"는 원칙 확립. jwks-mismatch 이모지 헤더는 무편집 원복, oneshot·java-to-go 추가 문장은 마침표 원복
