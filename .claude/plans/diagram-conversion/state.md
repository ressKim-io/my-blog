# Diagram Conversion — 진행 상황

> 작업 재개 시 이 파일부터 확인. 완료 `[x]`, 진행 중 `[~]`, 대기 `[ ]`.

## Phase 1 — 시범 (완료)

- [x] 시범 글 선정 + 변환 (2026-05-01)
  - `goti-discord-alerting-architecture.md` / 3블록
  - `public/diagrams/goti-discord-alerting-architecture-{1,2,3}.svg`
- [x] best-practices.md 디자인 토큰 검증 — 색상 매핑·박스 크기·접근성 메타 그대로 적용

## Phase 2 — 핵심 그룹 G1~G5 (완료)

- [x] **G1.** `cat:kubernetes` — 7편 / 13블록 / 295줄 (2026-05-01 완료)
- [x] **G2.** `series:argocd-troubleshooting` — 4편 / 10블록 / 242줄 (2026-05-01 완료)
- [x] **G3.** `series:eks-troubleshooting` — 6편 / 10블록 / 230줄 (2026-05-01 완료)
- [x] **G4.** `series:istio-observability` — 2편 / 5블록 / 127줄 (2026-05-01 완료)
- [x] **G5.** `series:istio-traffic` — 3편 / 5블록 / 112줄 (2026-05-01 완료)

## Phase 3 — 중규모 그룹 G6~G12 (완료)

- [x] **G6.** `cat:challenge` — 2편 / 5블록 / 85줄 (2026-05-01 완료, 시리즈 중복 글 G16/G17/G18 통합 처리)
- [x] **G7.** `cat:cicd` — 2편 / 7블록 / 73줄 (2026-05-01 완료)
- [x] **G8.** `cat:monitoring` — 1편 / 3블록 / 71줄 (2026-05-01 완료, G9/G14/G15/G21 통합 처리)
- [x] **G9.** `series:goti-observability-ops` — 2편 / 2블록 / 60줄 (G8 통합 완료)
- [x] **G10.** `series:goti-multicloud-db` — 3편 / 3블록 / 56줄 (2026-05-01 완료)
- [x] **G11.** `series:queue-poc-loadtest` — 2편 / 2블록 / 38줄 (2026-05-01 완료)
- [x] **G12.** `series:eks-security` — 1편 / 2블록 / 37줄 (2026-05-01 완료)

## Phase 4 — 소규모 그룹 G13~G21 (완료)

- [x] **G13.** `series:goti-cloudflare-migration` — 2편 / 2블록 / 37줄 (2026-05-01 완료)
- [x] **G14.** `series:goti-loadtest` — Phase 3에서 글 단위 처리 완료
- [x] **G15.** `series:observability` — Phase 3에서 글 단위 처리 완료
- [x] **G16.** `series:goti-pgbouncer` — Phase 3에서 글 단위 처리 완료
- [x] **G17.** `series:goti-kafka` — Phase 3에서 글 단위 처리 완료
- [x] **G18.** `series:challenge-2-wealist-migration` — Phase 3에서 글 단위 처리 완료
- [x] **G19.** `series:goti-multicloud` — 1편 / 1블록 / 9줄 (2026-05-01 완료, lang=text)
- [x] **G20.** `series:istio-ambient` — 1편 / 1블록 / 6줄 (2026-05-01 완료, lang=text)
- [x] **G21.** `series:goti-metrics-collector` — Phase 3에서 글 단위 처리 완료

## Phase 5 — 엣지 케이스 (완료)

- [x] **E1.** `istio-observability-part3-access-log.md` / 9블록 (2026-05-01 완료) — Response Flag 5박스를 markdown 표로 평탄화 + tree 3개 lang=text + 체크리스트 markdown
- [x] **E2.** `argocd-bootstrap-circular-dependency.md` / 2블록 (2026-05-01 완료) — PNG 인접 ASCII 박스 2개 삭제 (PNG 유지)
- [x] **E3.** `goti-adr-loki-tempo-stability-tuning.md` / 2블록 (2026-05-01 완료) — 사이클/흐름 다이어그램이라 SVG 2개로 변환 (inventory 분류 정정)
- [x] **E4.** `goti-observability-stack-selection.md` / 1블록 (2026-05-01 완료) — 관측성 스택 아키텍처 SVG 변환
- [x] **E5.** `istio-observability-part4-kiali.md` / 9블록 (2026-05-01 완료) — 9개 UI 모킹을 markdown 표·리스트로 전부 평탄화 (PNG 2개 유지)

## Phase 6 — 마무리 (완료, 2026-05-01)

- [x] `decisions.md` 작성 (Phase 1~5 처리 로그 누적)
- [x] `npm run build` 최종 검증 (459 static pages 통과)
- [x] `best-practices.md` 1.1 버전 갱신 (§11 실작업 패턴 9종 추가)
- [x] 메모리 reference 메모 갱신 (`reference_diagram_conversion_workspace.md` — 전체 완료 상태 반영)

## 작업 절차

1. 그룹의 keep 블록 위치 확인 (`inventory.json`)
2. 글 본문 읽고 컨텍스트 파악
3. 블록당 SVG 설계 (best-practices.md 색상 매핑 적용)
4. SVG 파일 작성 (`public/diagrams/{slug}-{n}.svg`)
5. 본문에서 ASCII 블록 → 마크다운 이미지 (TODO 주석도 정리)
6. `npm run build` 통과 확인
7. 그룹 단위 commit
8. 이 파일 체크박스 업데이트
9. `decisions.md`에 처리 로그
