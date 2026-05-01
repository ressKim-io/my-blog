# Diagram Conversion — Plan

> ASCII keep 블록 105개를 SVG 다이어그램으로 변환하는 작업 계획
> ASCII 정리(`.claude/plans/ascii-cleanup/`) 후속 — 보존된 시각화 자산을 정식 다이어그램으로 격상

## 배경

ASCII Cleanup Phase 1~4(2026-04-30 종료)에서 211블록을 평탄화했고, **시각화 가치가 큰 105블록은 keep으로 보존**했습니다. 이 keep 블록을 라이트 테마 + Cocoon 의미론적 색상 매핑 스타일의 SVG로 격상하는 것이 본 작업입니다.

## 입력 / 출력

### 입력
- `.claude/plans/ascii-cleanup/inventory.json` — keep 블록 위치·유형 데이터
- `.claude/plans/diagram-conversion/best-practices.md` — 디자인 토큰·접근성·반응형 규칙

### 출력
- `public/diagrams/{slug}-{n}.svg` — 변환된 SVG (slug = 글 파일명, n = 글 안 순번)
- `src/content/*.md` 본문 수정 — ASCII 블록을 마크다운 이미지 참조로 교체

## 전체 규모 (시범 1편 제외)

| 항목 | 수치 |
|---|---|
| 글 | 51편 |
| keep 블록 | 102개 |
| keep 라인 | 2,084줄 |

### 처리 정책별 분류

| 카테고리 | 글 | 블록 | 처리 |
|---|---|---|---|
| **순수 SVG 변환** | 46편 | 92블록 | 본 작업의 본진 — ASCII → SVG |
| **PNG/SVG 인접** | 2편 | 11블록 | ASCII 블록 단순 삭제 (이미지 자산 이미 존재) |
| **UI 모킹** | 2편 | 3블록 | 별도 정책 — 가능하면 마크다운 표/체크리스트 평탄화 |
| **PNG + UI 모킹 중복** | 1편 | 9블록 | kiali 글 — UI 모킹 ASCII 삭제 + PNG 유지 |

상세:
- PNG/SVG 인접 (2편): `istio-observability-part3-access-log.md`, `argocd-bootstrap-circular-dependency.md`
- UI 모킹 (2편): `goti-adr-loki-tempo-stability-tuning.md`, `goti-observability-stack-selection.md`
- 중복 (1편): `istio-observability-part4-kiali.md`

## Phase 별 진행 계획

### Phase 1 — 시범 ✅ (완료, 2026-05-01)
- 1편 / 3블록 / `goti-discord-alerting-architecture.md`
- 디자인 토큰 검증 완료 — best-practices.md 색상 매핑·박스 크기·접근성 메타 그대로 적용 가능

### Phase 2 — 핵심 그룹 G1~G5 (전체 라인 수 ~50%)

라인 수 내림차순. 아래 5개 그룹이 1,006줄을 차지합니다.

| 그룹 | 분류 | 글 | 블록 | 라인 |
|---|---|---|---|---|
| G1 | `cat:kubernetes` | 7편 | 13블록 | 295줄 |
| G2 | `series:argocd-troubleshooting` | 4편 | 10블록 | 242줄 |
| G3 | `series:eks-troubleshooting` | 6편 | 10블록 | 230줄 |
| G4 | `series:istio-observability` | 2편 | 5블록 | 127줄 |
| G5 | `series:istio-traffic` | 3편 | 5블록 | 112줄 |

소계: **22편 / 43블록 / 1,006줄**

### Phase 3 — 중규모 그룹 G6~G12 (전체 라인 수 ~25%)

| 그룹 | 분류 | 글 | 블록 | 라인 |
|---|---|---|---|---|
| G6 | `cat:challenge` | 2편 | 5블록 | 85줄 |
| G7 | `cat:cicd` | 2편 | 7블록 | 73줄 |
| G8 | `cat:monitoring` | 1편 | 3블록 | 71줄 |
| G9 | `series:goti-observability-ops` | 2편 | 2블록 | 60줄 |
| G10 | `series:goti-multicloud-db` | 3편 | 3블록 | 56줄 |
| G11 | `series:queue-poc-loadtest` | 2편 | 2블록 | 38줄 |
| G12 | `series:eks-security` | 1편 | 2블록 | 37줄 |

소계: **13편 / 24블록 / 420줄**

### Phase 4 — 소규모 그룹 G13~G21

| 그룹 | 분류 | 글 | 블록 | 라인 |
|---|---|---|---|---|
| G13 | `series:goti-cloudflare-migration` | 2편 | 2블록 | 37줄 |
| G14 | `series:goti-loadtest` | 1편 | 2블록 | 27줄 |
| G15 | `series:observability` | 1편 | 1블록 | 23줄 |
| G16 | `series:goti-pgbouncer` | 1편 | 1블록 | 17줄 |
| G17 | `series:goti-kafka` | 1편 | 1블록 | 15줄 |
| G18 | `series:challenge-2-wealist-migration` | 2편 | 2블록 | 15줄 |
| G19 | `series:goti-multicloud` | 1편 | 1블록 | 9줄 |
| G20 | `series:istio-ambient` | 1편 | 1블록 | 6줄 |
| G21 | `series:goti-metrics-collector` | 1편 | 1블록 | 6줄 |

소계: **11편 / 12블록 / 155줄**

### Phase 5 — 엣지 케이스 처리

| 처리 | 글 | 블록 |
|---|---|---|
| PNG 인접 ASCII 삭제 | `istio-observability-part3-access-log.md`, `argocd-bootstrap-circular-dependency.md` | 11블록 |
| UI 모킹 평탄화 | `goti-adr-loki-tempo-stability-tuning.md`, `goti-observability-stack-selection.md` | 3블록 |
| kiali 글 (PNG+UI 모킹) | `istio-observability-part4-kiali.md` | 9블록 |

소계: **5편 / 23블록**

### Phase 6 — 마무리

- ASCII Cleanup의 `scan.mjs`에 SVG 인식 로직 추가하거나, 별도 검증 스크립트 작성 (선택)
- `npm run build` 최종 검증
- `decisions.md` 작성 (Phase별 처리 로그)
- 메모리 reference 메모 추가
- best-practices.md 1.1 버전 갱신 (실작업 중 발견한 패턴 보강)

## 진행 단위 권장

**한 세션에 1~2 그룹 (블록 5~10개)** 권장합니다. 시범 글(3블록)이 본 세션 컨텍스트의 상당 부분을 사용했고, 1블록당 SVG 설계·작성·본문 교체에 전용 컨텍스트가 필요합니다.

세션 예상량 (블록 기준):

- Phase 2 (43블록) → 5~8 세션
- Phase 3 (24블록) → 3~4 세션
- Phase 4 (12블록) → 2 세션 (소규모 묶어서)
- Phase 5 (23블록) → 2~3 세션 (대부분 삭제·평탄화로 가벼움)

**총 12~17 세션 추정**. 작업 효율 따라 달라질 수 있습니다.

## 그룹별 작업 절차 (반복)

1. 그룹의 keep 블록 위치 확인 (`inventory.json`)
2. 글 본문 읽고 컨텍스트 파악
3. 블록당 SVG 설계 (best-practices.md 색상 매핑 적용)
4. SVG 파일 작성 (`public/diagrams/{slug}-{n}.svg`)
5. 본문에서 ASCII 블록을 마크다운 이미지로 교체 (TODO 주석도 함께 정리)
6. `npm run build` 통과 확인
7. 그룹 단위 commit
8. `state.md` 체크박스 업데이트
9. `decisions.md`에 그룹 처리 로그 기록

## Definition of Done

- 모든 keep 블록이 SVG로 격상되거나 (Phase 2~4) 적절히 정리됨 (Phase 5)
- 모든 글에서 `npm run build` 통과
- best-practices.md가 실작업 패턴을 반영해 갱신됨
- `decisions.md`에 그룹별 처리 기록 누적
- `state.md` 모든 체크박스 완료
