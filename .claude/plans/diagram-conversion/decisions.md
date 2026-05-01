# Diagram Conversion — 결정 로그

> Phase별 처리 기록 누적

## Phase 1 — 시범 (2026-05-01)

- `goti-discord-alerting-architecture.md` 3블록 → SVG
- 디자인 토큰 검증 — Cocoon 6색 매핑(라이트 톤다운) + Pretendard/Geist Mono 그대로 적용 가능

## Phase 2 — 핵심 그룹

### G1. `cat:kubernetes` (2026-05-01 완료)

- 7편 / 13블록 / 295줄 → SVG 13개 (`public/diagrams/`)
- 처리 글 목록:
  - `k8s-pod-flow-part1.md` (1) — Container Runtime 4단계
  - `goti-ssm-manual-config-troubleshooting.md` (1) — DB 접근 구조 Before/After
  - `goti-istio-jwks-mismatch-cdn-jwt-401.md` (2) — JWT 인증 흐름, istiod JWKS fetch mTLS 충돌
  - `goti-gcp-terraform-cross-cloud-review.md` (2) — Terraform·K8s 레이어 호환성, Overlay 해결 구조
  - `goti-istio-retry-duplicate-payment.md` (3) — 결제 정상 흐름, retry 장애 흐름, @Transactional 범위
  - `goti-redis-serialization-classcastexception.md` (2) — activateDefaultTyping 차이, ObjectMapper Bean 충돌
  - `goti-adr-istio-service-mesh.md` (2) — Sidecar/Ambient 워터폴 비교, Goti Istio 전체 아키텍처

**적용 패턴**:
- 박스 viewBox 가변 — 단순 흐름 600~720px / 다단계 800~920px
- 색상은 의미 단위로 매핑(예: External=slate, Cloud=amber, Backend=emerald, DB=violet, Security=rose)
- 1블록 1 SVG 원칙 — 한 ASCII 블록을 분할하지 않음(맥락 유지)
- TODO Draw.io 주석 함께 제거

**검증**: `npm run build` 통과 (459 static pages 생성)

### G2. `series:argocd-troubleshooting` (2026-05-01 완료)

- 4편 / 10블록 / 242줄
  - SVG 변환: 7블록 → SVG 7개 (`public/diagrams/`)
  - tree 보존: 3블록 → ` ```text` lang 명시만 (best-practices §ASCII 정책 — 디렉토리 트리 허용)
- 처리 글 목록:
  - `argocd-otel-crashloop-networkpolicy.md` (3 SVG) — OTel 2-tier 파이프라인, Loki retry 증폭 사이클, NetworkPolicy egress 비교
  - `argocd-probe-crd-appproject-retry.md` (2 SVG) — AppProject whitelist 검증 흐름(Probe 누락), Auto Sync retry 5회 소진과 새 리비전 재시작
  - `argocd-ssa-sync-pitfalls.md` (2 SVG) — Diff(client-side)/Apply(server-side) 불일치, Force Sync 에러 루프와 탈출 절차
  - `argocd-app-of-apps-deadlock.md` (3 tree) — Before/After/권장 구조 디렉토리 트리 lang=text 명시

**적용 패턴(추가)**:
- 사이클/루프 다이어그램 — 닫힘 화살표는 `stroke-dasharray` + `#BE123C` 톤으로 retry/loop 시그널 명확화
- 다단계 retry/시퀀스 — 동일 색(security/rose) 박스를 세로 정렬로 반복, 마지막 단계만 결과 박스(slate)로 색 변경해 인지 부담 감소
- whitelist 가시화 — 단일 박스 안에 ✓/✗ Geist Mono 라인을 2열로 배치(좌 4, 우 4) → 누락 항목만 rose로 강조
- tree 블록 정책 — best-practices.md "ASCII 다이어그램 정책" 표(디렉토리 트리 허용 + lang=text 명시)와 정합. SVG 변환 비용 대비 시각화 가치 작아 보존이 합리적

**검증**: `npm run build` 통과 (459 static pages 생성, 17개 SVG 자산 누적)

### G3. `series:eks-troubleshooting` (2026-05-01 완료)

- 6편 / 10블록 / 230줄
  - SVG 변환: 9블록 → SVG 9개 (`public/diagrams/`)
  - tree 보존: 1블록 → ` ```text` lang 명시 (의존성 체인 트리 — best-practices §ASCII 정책)
- 처리 글 목록:
  - `eks-troubleshooting-part2-istio-ambient-1.md` (3 SVG) — Sidecar/Ambient 구성 차이, Prometheus mesh 외부 mTLS 충돌, wealist-prod Ambient Mesh 최종 아키텍처
  - `eks-troubleshooting-part3-istio-ambient-2.md` (1 SVG) — api.wealist.co.kr HTTPS 트래픽 (Internet→Route53→NLB(ACM)→Gateway→HTTPRoute→Services)
  - `eks-troubleshooting-part5-monitoring-1.md` (1 SVG) — 초기 Monitoring Stack (Prometheus/Grafana/Loki + PVC + Promtail/Exporters)
  - `eks-troubleshooting-part6-monitoring-2.md` (1 SVG) — 개선 Monitoring Stack (PVC 단기 + S3 장기 + Pod Identity)
  - `eks-troubleshooting-part7-go-service.md` (1 SVG + 1 tree) — 6 Go + 1 Java/Spring 마이크로서비스 구성 / 의존성 체인 lang=text
  - `eks-troubleshooting-part9-rolling-update-cascading.md` (2 SVG) — VPC CNI/Kubelet max-pods 불일치, 서브넷 IP 소진 데드락(양방향 점선)

**적용 패턴(추가)**:
- 영역 컨테이너 + 점선 보더 — Istio Mesh, Monitoring Stack, namespace 같은 논리 경계는 dashed `#7C3AED`/`#D4D4D8`로 구분 (배경 `#F5F3FF`/`#FAFAFA`)
- 데드락/순환 — 두 박스 사이 양방향 점선 화살표 + `#BE123C`로 "막힘" 시각화
- 서비스 묶음(6개+) — 3열 × 2행 그리드 + 같은 색(emerald) 반복, 색이 다른 1개(rose)로 도메인 구분(Go vs Java)
- 트리블록은 디렉토리든 의존성 체인이든 ASCII 정책상 `\`text\`` 명시로 보존 — best-practices.md 1.1 갱신 시 명문화 후보

**검증**: `npm run build` 통과 (459 static pages 생성, 26개 SVG 자산 누적)

### G4. `series:istio-observability` (2026-05-01 완료)

- 2편 / 5블록 / 127줄
  - SVG 변환: 3블록 → SVG 3개
  - markdown 평탄화: 2블록 (체크리스트 박스 — 굵은 글씨 + `- [ ]` 리스트)
- 처리 글:
  - `istio-observability-part1-metrics.md` (1 SVG + 1 평탄화) — Service Dashboard 4패널 / 메트릭 체크리스트
  - `istio-observability-part2-tracing.md` (2 SVG + 1 평탄화) — Jaeger 검색 결과 / Trace 워터폴 / 트레이싱 체크리스트

**적용 패턴(추가)**:
- UI 모킹 → SVG 차트 — Grafana/Jaeger 모킹은 단순 박스가 아니라 "값(150 req/s, 45ms)·바차트·워터폴"을 살려서 정보 가치를 유지
- 워터폴 다이어그램 — 시간축 라벨 + 가로 바 길이로 비례 표현, 병목 단계만 rose 색으로 강조
- 체크리스트 박스 → markdown — 의미상 정렬 정보가 적은 체크리스트는 SVG 비용 대비 가치가 낮아 굵은 헤더 + bullet 평탄화

### G5. `series:istio-traffic` (2026-05-01 완료)

- 3편 / 5블록 / 112줄
  - SVG 변환: 2블록 → SVG 2개
  - markdown 평탄화: 3블록 (체크리스트 3종)
- 처리 글:
  - `istio-traffic-part5-mirroring.md` (2 SVG + 1 평탄화) — Fire-and-Forget 흐름 / Shadow Testing 대시보드 / Mirroring 체크리스트
  - `istio-traffic-part3-circuit-breaker.md` (1 평탄화) — Circuit Breaker 체크리스트
  - `istio-traffic-part4-retry-timeout.md` (1 평탄화) — Retry/Timeout 체크리스트

**검증**: `npm run build` 통과 (459 static pages 생성, 31개 SVG 자산 누적)

## Phase 3 — 중규모 그룹

### G6+G7+G8 (challenge/cicd/monitoring 카테고리, 2026-05-01 완료)

카테고리별 처리하되 `series:goti-pgbouncer`, `series:goti-kafka`, `series:challenge-2-wealist-migration`, `series:goti-observability-ops`, `series:goti-loadtest`, `series:observability`, `series:goti-metrics-collector`(G16~G18, G9, G14, G15, G21)의 글이 카테고리 그룹에 모두 포함되어 글 단위로 한 번 처리하면 시리즈 그룹도 함께 완료. Phase 1에서 이미 처리한 `goti-discord-alerting-architecture.md`는 제외.

- 8개 SVG 추가 + 8개 트리/짧은 흐름 lang=text 명시
- 처리 글:
  - `docker-compose-env-management.md` (1 SVG + 2 tree text) — Before/After 환경변수 분산·중앙집중 비교
  - `go-dependency-genproto-conflict.md` (1 tree text)
  - `goti-pgbouncer-connection-pooling-adr.md` (1 SVG) — PgBouncer RW/RO 분리 + Primary/Replica 분기
  - `goti-kafka-adoption-decision-adr.md` (이미 lang=text)
  - `challenge2-wealist-migration-part5.md` (1 tree text)
  - `challenge2-wealist-migration-part3.md` (1 tree text)
  - `multi-repo-cicd-strategy.md` (1 SVG + 4 tree text + 1 markdown 표 평탄화) — K8s GitOps 레포 구조
  - `github-actions-multi-platform-optimization.md` (1 tree text)
  - `goti-adr-alloy-to-otel-collector.md` (2 SVG) — Before(Alloy)와 After(OTel + Kafka 전면 버퍼링)
  - `goti-otel-agent-otlp-protocol-mismatch.md` (1 SVG) — goti namespace 4 데이터소스 파이프라인
  - `otel-monitoring-v3.md` (1 SVG) — OTel Collector Gateway 패턴 (Receivers/Connectors/Exporters)
  - `goti-synthetic-traffic.md` (1 SVG + 1 tree text) — CronJob synthetic-traffic + sidecar mTLS
  - `goti-kafka-buffered-otel-pipeline.md` (이미 lang=text)
  - `goti-metrics-collector-go-sidecar.md` (1 짧은 흐름 lang=text)

**적용 패턴(추가)**:
- 카테고리 vs 시리즈 중복 — inventory.json은 같은 글을 카테고리·시리즈 모두에 등록하므로 글 단위로 처리해 그룹별 commit 충돌 회피
- 짧은 인라인 흐름(6~8줄) — SVG 가치보다 lang=text 명시가 비용 효율적
- ADR Before/After 다이어그램 — 같은 슬롯에 두 SVG를 만들고 한쪽은 "위 다이어그램 참조"로 텍스트 안내해 중복 시각화 회피

### G10+G11+G12 (multicloud-db/queue-poc/eks-security, 2026-05-01 완료)

- 5개 SVG 추가 + 2개 트리 lang=text 유지
- 처리 글:
  - `goti-db-active-passive-with-read-split-adr.md` (1 SVG) — GCP primary + AWS subscriber 다중 클라우드 토폴로지
  - `goti-db-failback-reverse-replication-adr.md` (이미 lang=text)
  - `goti-multicloud-db-replication-technology-adr.md` (이미 lang=text)
  - `queue-poc-loadtest-part1-design.md` (1 SVG) — 공유 ticketing pod 충돌 (A/C 세션 검증 불일치)
  - `queue-poc-loadtest-part3-selection.md` (1 SVG) — B vs A 확장 부하 곡선 비교
  - `eks-security-jwt-rsa-mismatch.md` (2 SVG) — Pod별 RSA 키 불일치 / Secrets Manager 공유 해결

**검증**: `npm run build` 통과 (459 static pages 생성, 44개 SVG 자산 누적)

## Phase 4 — 소규모 그룹 (G13, G19, G20, 2026-05-01 완료)

- 1개 SVG + 3개 트리/짧은 흐름 lang=text
- 처리 글:
  - `goti-cloudflare-migration-adr.md` (1 SVG) — Cloudflare Pages + Workers + 전용 중간 도메인 dev 환경 아키텍처
  - `goti-cloudflare-migration-troubleshoot.md` (1 tree text) — 브라우저 진입 트리
  - `goti-harbor-imagepull-403-cloudflare-waf.md` (1 tree text) — 장애 원인 요약 트리
  - `istio-ambient-part6-rate-limiting.md` (1 tree text) — 프로젝트 디렉토리 구조

## Phase 5 — 엣지 케이스 (2026-05-01 완료)

- 3개 SVG + 6개 평탄화 + 2개 ASCII 박스 삭제
- 처리 글:
  - `istio-observability-part3-access-log.md` (markdown 평탄화) — Response Flag 5박스를 5행 표로 통합, tree 3개 lang=text, 체크리스트 평탄화
  - `argocd-bootstrap-circular-dependency.md` (ASCII 삭제) — 동일 내용 PNG 인접해 ASCII 박스 2개 삭제, Bootstrap 순서는 번호 리스트로 평탄화
  - `goti-adr-loki-tempo-stability-tuning.md` (2 SVG) — OOM 악순환 사이클(루프 점선) + 3축 적용 후 차단 흐름
  - `goti-observability-stack-selection.md` (1 SVG) — Grafana LGTM + Alloy Agent/Gateway + Kafka 버퍼 통합 아키텍처
  - `istio-observability-part4-kiali.md` (markdown 평탄화) — Kiali UI 모킹 9개를 markdown 표·리스트로 통합 (PNG 2개는 그대로 유지)

**평탄화 정책 정정**: inventory.json의 "PNG 인접" / "UI 모킹" 분류는 일부 부정확. E1/E5처럼 PNG 없이 UI 박스만 있는 경우는 표로 평탄화, E3처럼 사이클/흐름 다이어그램은 SVG 가치가 충분해 변환. 본문 직접 확인이 필수.

**검증**: `npm run build` 통과 (459 static pages 생성, 49개 SVG 자산 누적)
