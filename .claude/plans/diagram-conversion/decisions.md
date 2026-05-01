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
