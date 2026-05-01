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
