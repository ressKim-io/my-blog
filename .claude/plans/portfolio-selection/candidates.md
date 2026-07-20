# 포트폴리오 대표글 1차 후보 (프론트매터 스크리닝 결과)

> 2026-07-16, 338개 전체 프론트매터(제목·excerpt·시리즈·type태그) 스캔 결과.
> 아래 "1차 근거"는 excerpt 기반 추정이므로 본문 검증 전까지 신뢰 금지.

## 평가 관점 (고정)

- 포지셔닝: "백엔드/DevOps/인프라 경계를 넘나들며 장애의 근본 원인을
  관측 데이터로 추적해 해결하는 신입" (백엔드 1.2년 + 부트캠프 최우수상)
- 선정 기준 우선순위: 1) 레이어 교차 트러블슈팅 2) 문제→가설→검증→수치 서사
  3) 기술 선택 Why(트레이드오프) 4) 운영 완결성(재발 방지) 5) AI 네이티브 설계
- 제외: 튜토리얼/문서 요약/개념 정리, 단순 실수 수준 트러블, 수치·검증 없는 해결

## A. 최우선 후보 — 레이어 교차 + 수치 + 서사

1. `logs/kubernetes/goti-pod-scaling-vs-karpenter-nodepool` (goti-scaling#3) — CPU 117%는 증상, 진짜 원인은 FindPrice N+1·distLock WaitTimeout
2. `logs/kubernetes/goti-ticketing-hotpath-and-scaling-overhaul` (goti-scaling#4) — 3000VU ticket_success 7.8%를 코드·쿼리·리소스 3계층 분리, SDD 4개+PR 6개
3. `logs/kubernetes/goti-capacity-planning-keda` (goti-scaling#1) — KEDA 측정 중 Stadium API(p95 6.8s, 5xx 10.88%) cascade 발견, 계획 변경
4. `logs/challenge/goti-3000vu-queue-oneshot` (goti-queue-poc#10) — 큐 통과율 100% vs 결제 성공률 15.6%, 가설 뒤집힘
5. `logs/challenge/goti-aws-full-destroy-gcp-latency-optimization` (goti-multicloud#10) — p95 785ms→144ms, 병목 3개 순차 제거
6. `logs/istio/goti-istio-injection-label-pg-max-connections` (goti-istio-ops#1) — sidecar 미주입 + PG max_connections 고갈 복합
7. `logs/monitoring/goti-go-otel-sdk-missing-labels` (goti-java-to-go#5) — 앱(SDK 미초기화) 원인 → 관측 인프라 증상 크로스레이어
8. `logs/challenge/goti-cloudflare-worker-lax-latency-investigation` (goti-multicloud#5) — cf-ray로 LAX PoP 실행 확인, 32ms vs 900ms+, Smart Placement
9. `logs/challenge/goti-phase6-ticketing-sql-optimization` (goti-ticketing-phase#2) — N+1 제거 DB 호출 70→9회(87%), 동시성 P0 3건
10. `essays/monitoring/goti-prometheus-agent-mode-adr` — 메모리 98% 점유 → Agent Mode, 4Gi→1.2Gi
11. `essays/monitoring/goti-adr-loki-tempo-stability-tuning` — Kafka backlog 폭주 OOM 악순환을 3축으로 절단
12. `logs/monitoring/goti-tempo-oom-kafka-buffer-sampling` (goti-observability-stack#3) — Tempo OOM 85회 → 샘플링 10% + Kafka 버퍼

## B. 기술 선택 Why (ADR형)

13. `logs/challenge/goti-java-to-go-migration-adr` (goti-java-to-go#7) — JVM 콜드스타트 30~60초 실측, 메모리 6배 절감 근거
14. `logs/challenge/goti-redis-first-ticketing-adr` (goti-redis-sot#1) — ticket_success 13~16% RDS 경합 → Redis-first
15. `essays/kubernetes/goti-adr-istio-service-mesh` — Linkerd/Cilium/SCG 비교, Ambient 포기 근거
16. `logs/monitoring/goti-observability-stack-selection` (goti-observability-stack#1) — 관측 스택 6가지 결정
17. `logs/challenge/goti-kafka-adoption-decision-adr` (goti-kafka#1) — Strimzi+KRaft 채택
18. `logs/challenge/goti-managed-kafka-removal` (goti-kafka#3) — Kafka 완전 제거 (17과 묶으면 번복 서사)
19. `logs/kubernetes/goti-multicloud-circuit-breaker-hpa-adr` (goti-multicloud#1) — ASG 0 상태에서 CB+HPA 자동 복귀 설계
20. `logs/challenge/goti-cross-cloud-db-promote-automation-adr` (goti-multicloud#14) — 수동 runbook RTO 30분+ → Lambda+Step Functions, 5개 옵션
21. `essays/monitoring/goti-finops-opencost-adoption-adr` — 비용 가시성 ADR (실제 절감 수치 있는지 확인 필요)
22. `essays/istio/istio-ambient-part7-migration-to-sidecar` — Ambient → Sidecar 회귀 (번복 서사)

## C. AI 네이티브 엔지니어링

23. `essays/challenge/goti-claude-vs-gemini-k8s-pr-176` — 9건 vs 4건 정량 비교
24. `essays/challenge/goti-claude-vs-gemini-k8s-pr-192` — 11건 vs 5건, 방향 반대 케이스
25. `essays/challenge/goti-review-pr-gap-learning` (goti-meta#1) — 리뷰 갭 → 체크 12개 시스템화
26. `essays/challenge/goti-ai-workflow-large-improvement` (goti-meta#8) — 89 트러블+25 리뷰 갭 → Rules/Skills/Agents 반영
27. `essays/challenge/goti-claude-code-config-optimization` (goti-meta#6) — 컨텍스트 토큰 48% 절감

## D. 운영 완결성

28. `logs/challenge/goti-session-dropout-root-cause-audit` (goti-auth#7) — P0~P2 8건 + 완화책 5개
29. `logs/kubernetes/goti-eks-rolling-update-cascading-failures` (goti-eks#2) — 프로덕션 연쇄 장애 4건
30. `logs/kubernetes/goti-node-rightsizing-and-rebalancing` (goti-scaling#2) — 스케줄러는 requests로 판단한다는 교훈

## E. 보류/검토

31. `logs/istio/goti-istio-jwks-mismatch-cdn-jwt-401` — CDN+Istio+JWT 복합, 19개 서비스
32. `logs/challenge/goti-load-test-db-realistic-data` (goti-loadtest#2) — 인덱스 전량 캐싱이라는 방법론 결함 발견, 360만 행 시드
33. `logs/argocd/argocd-app-of-apps-deadlock` — 9시간 deadlock, 단일 툴이지만 추적력
34. `essays/challenge/goti-agentic-control-plane-evolution` (goti-portfolio-meta#4) — AI SRE 방향성

## 1차에서 제외한 그룹 (참고)

- goti-deepdive-* 59편: 개념 해설 시리즈 (제외 기준 "개념 정리 위주")
- kernel-runtime-tradeoffs 22편 / rust-cs-layer 7편 / packet-journey 6편: CS 원리 탐구
- istio 입문 시리즈·초기 설치형 트러블슈팅: 튜토리얼 성격
- 1바이트 시크릿, 환경변수 혼동 등: 단순 실수형
