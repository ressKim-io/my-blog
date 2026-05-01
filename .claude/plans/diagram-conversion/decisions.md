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
