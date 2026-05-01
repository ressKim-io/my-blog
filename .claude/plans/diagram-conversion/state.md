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

## Phase 4 — 소규모 그룹 G13~G21 (대기, 11편/12블록/155줄)

- [ ] **G13.** `series:goti-cloudflare-migration` — 2편 / 2블록 / 37줄
- [ ] **G14.** `series:goti-loadtest` — 1편 / 2블록 / 27줄
- [ ] **G15.** `series:observability` — 1편 / 1블록 / 23줄
- [ ] **G16.** `series:goti-pgbouncer` — 1편 / 1블록 / 17줄
- [ ] **G17.** `series:goti-kafka` — 1편 / 1블록 / 15줄
- [ ] **G18.** `series:challenge-2-wealist-migration` — 2편 / 2블록 / 15줄
- [ ] **G19.** `series:goti-multicloud` — 1편 / 1블록 / 9줄
- [ ] **G20.** `series:istio-ambient` — 1편 / 1블록 / 6줄
- [ ] **G21.** `series:goti-metrics-collector` — 1편 / 1블록 / 6줄

## Phase 5 — 엣지 케이스 (대기, 5편/23블록)

- [ ] **E1.** PNG 인접 ASCII 삭제 — `istio-observability-part3-access-log.md` / 9블록
- [ ] **E2.** PNG 인접 ASCII 삭제 — `argocd-bootstrap-circular-dependency.md` / 2블록
- [ ] **E3.** UI 모킹 평탄화 — `goti-adr-loki-tempo-stability-tuning.md` / 2블록
- [ ] **E4.** UI 모킹 평탄화 — `goti-observability-stack-selection.md` / 1블록
- [ ] **E5.** kiali 처리 (PNG 유지 + UI 모킹 ASCII 삭제) — `istio-observability-part4-kiali.md` / 9블록

## Phase 6 — 마무리 (대기)

- [ ] `decisions.md` 작성 (Phase별 처리 로그 누적)
- [ ] `npm run build` 최종 검증
- [ ] `best-practices.md` 1.1 버전 갱신 (실작업 패턴 반영)
- [ ] 메모리 reference 메모 추가 (`reference_diagram_conversion_workspace.md`)

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
