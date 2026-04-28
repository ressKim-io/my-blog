# ASCII Cleanup — 진행 상황 (todo list)

> 작업을 재개할 때 항상 이 파일부터 확인. 완료 `[x]`, 진행 중 `[~]`, 대기 `[ ]`.

## Phase 1 — 인벤토리 (완료)

- [x] `scripts/scan.mjs` 작성 + 분류 로직 개선 (2026-04-28)
  - tree 토큰 카운트 (`├──`/`└──` ≥3) → tree 27개로 정상 분류
  - 코드 lang 필터 → code-arrow 113개 분리
  - decision 자동 추천 (flatten/keep/skip)
- [x] `inventory.json` / `inventory.md` 재생성 — 141편/429블록/4,425줄

## Phase 2 — 처리 기준 확정 (완료)

- [x] `criteria.md` 작성 — 두 갈래(평탄화/보존) 결정 룰
- [x] 시각화 도구 도입은 다음 세션으로 미룸 (단계 분리 결정)
- [x] 분포 확정: flatten 211 / keep 105 / skip 113

## Phase 3 — 평탄화 작업 (대기)

### 그룹 진행 (시리즈/카테고리 단위, 자동 산출)

> `groups.md` 참고. 41 그룹 / 211 flatten 블록 / 1,017줄. 라인 수 내림차순.

상위 14 그룹 (전체의 ~75% 라인 차지):

- [x] **G1.** `cat:kubernetes` — 8편 / 34블록 / 174줄 (2026-04-28)
- [x] **G2.** `series:argocd-troubleshooting` — 3편 / 6블록 / 102줄 (2026-04-28)
- [x] **G3.** `series:eks-troubleshooting` — 7편 / 24블록 / 97줄 (2026-04-28)
- [x] **G4.** `series:goti-multicloud` — 7편 / 12블록 / 60줄 (2026-04-29)
- [ ] **G5.** `series:goti-observability-ops` — 5편 / 9블록 / 46줄
- [ ] **G6.** `cat:cicd` — 3편 / 7블록 / 36줄
- [ ] **G7.** `series:goti-observability-stack` — 5편 / 8블록 / 34줄
- [ ] **G8.** `series:goti-java-to-go` — 4편 / 8블록 / 33줄
- [ ] **G9.** `series:istio-observability` — 2편 / 3블록 / 32줄
- [ ] **G10.** `series:goti-cloudflare-migration` — 2편 / 10블록 / 30줄
- [ ] **G11.** `series:goti-auth` — 3편 / 5블록 / 26줄
- [ ] **G12.** `cat:challenge` — 3편 / 6블록 / 24줄
- [ ] **G13.** `series:goti-redis-sot` — 3편 / 7블록 / 24줄
- [ ] **G14.** `series:goti-ticketing-phase` — 3편 / 5블록 / 23줄
- [ ] **G15~G41.** 잔여 27 그룹 (`groups.md` 참고) — 글당 1~3 블록의 작은 그룹

### 그룹별 작업 절차

1. `inventory.md`에서 그룹의 flatten 블록 위치 확인
2. 각 글 본문 읽고 컨텍스트 파악
3. `criteria.md` 평탄화 방법론 적용
4. 그룹 단위 commit
5. 이 파일 체크박스 업데이트

## Phase 4 — 마무리 (대기)

- [ ] `CLAUDE.md` 재발 방지 룰 추가 (박스+5줄+ 금지 등)
- [ ] `scan.mjs` 재실행 — Before/After 비교
- [ ] `decisions.md` 작성 (그룹별 처리 로그)
- [ ] 작업 폴더 보존 (git 추적, audit 패턴)

## 다음 세션 인계 항목

- `keep` 105 블록 = 디자인 개편 세션의 입력
- 다이어그램 시스템 결정: MDX 컴포넌트 / drawio / Mermaid / HTML→PNG (D2 제외)
- 다크모드 제거 후 일관 변환

## Phase 3 누적 진행 (~G4)

| 그룹 | 글 | 평탄화 | keep (분류 보정) |
|---|---|---|---|
| G1 `cat:kubernetes` | 8 | 33 | 1 (lang=`log`) |
| G2 `argocd-troubleshooting` | 3 | 5 | 1 (lang=`hcl`) |
| G3 `eks-troubleshooting` | 7 | 23 | 1 (lang=`diff`) |
| G4 `goti-multicloud` | 7 | 12 | 0 (lang 명시는 하이브리드) |
| **합계** | **25** | **73** | **3** |

전체 211 flatten 추천 중 **76 블록 처리(약 36%)**. 다음 진입점은 **G5 `series:goti-observability-ops`** (5편 / 9블록 / 46줄).

### 다음 세션 재개 절차

1. 이 파일(`state.md`) 확인 — Phase 3 체크박스 + 진행 로그
2. `groups.md`의 G5 섹션에서 글 목록과 블록 위치 확인
3. `criteria.md` 평탄화 방법론 + 분류 보정 룰("lang 명시 코드는 keep") 적용
4. `decisions.md`의 G1~G4 결정 로그 패턴 참고 (bullet/표/번호목록/인라인 분포)

## 진행 로그

- 2026-04-28 오전: Phase 1 인벤토리 자동 추출 (141편/429블록/4,425줄)
- 2026-04-28 오후: Plan 리뷰 후 v2로 전환 — 단계 분리 결정 (시각화 도구는 다음 세션). scan.mjs 분류 로직 개선(tree 토큰 + lang 필터 + decision 추천). Phase 2 완료, `criteria.md` + `groups.md` 산출 (41 그룹 / 211 flatten 블록 / 1,017줄). Phase 3 시작 대기.
- 2026-04-28 저녁: G1 (`cat:kubernetes`) 완료 — 8편 / 33블록 평탄화 (1블록은 실로그라 keep 처리). 표 5개, 인라인 7개, lang 명시 13개, 마크다운 목록 8개로 변환. 자세한 결정 로그는 `decisions.md` 참조.
- 2026-04-28 저녁: G2 (`series:argocd-troubleshooting`) 완료 — 3편 / 5블록 평탄화 (75줄 hcl 코드 1블록은 실제 Terraform 코드라 keep 처리). 표 2개, nested 번호 목록 3개로 변환.
- 2026-04-28 저녁: G3 (`series:eks-troubleshooting`) 완료 — 7편 / 23블록 평탄화 (10줄 diff 코드 1블록은 실제 ArgoCD diff라 keep 처리). 표 1개, bullet 목록 14개, 인라인 5개, 번호 목록 3개로 변환.
- 2026-04-29: G4 (`series:goti-multicloud`) 완료 — 7편 / 12블록 평탄화. 멀티클라우드 트래픽 경로/장애 사슬 박스가 많아 번호 목록 비중이 가장 높음(4건). 표 2개, bullet 목록 3개, 인라인 2개, lang 명시+주석 분리 1개. 다음은 G5 `goti-observability-ops`.
