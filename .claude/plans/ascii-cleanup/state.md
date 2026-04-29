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
- [x] **G5.** `series:goti-observability-ops` — 5편 / 9블록 / 46줄 (2026-04-29)
- [x] **G6.** `cat:cicd` — 3편 / 7블록 / 36줄 (2026-04-29)
- [x] **G7.** `series:goti-observability-stack` — 5편 / 8블록 / 34줄 (2026-04-29)
- [x] **G8.** `series:goti-java-to-go` — 4편 / 8블록 / 33줄 (2026-04-29)
- [x] **G9.** `series:istio-observability` — 2편 / 3블록 / 32줄 (2026-04-29)
- [x] **G10.** `series:goti-cloudflare-migration` — 2편 / 10블록 / 30줄 (2026-04-29)
- [x] **G11.** `series:goti-auth` — 3편 / 5블록 / 26줄 (2026-04-29)
- [x] **G12.** `cat:challenge` — 3편 / 6블록 / 24줄 (2026-04-29)
- [x] **G13.** `series:goti-redis-sot` — 3편 / 7블록 / 24줄 (2026-04-29)
- [x] **G14.** `series:goti-ticketing-phase` — 3편 / 5블록 / 23줄 (2026-04-29)
- [x] **G15~G24.** 묶음 처리 (2026-04-30) — 12편 / 37블록 평탄화 28 + keep 9
- [ ] **G25~G41.** 잔여 17 그룹 (`groups.md` 참고) — 글당 1~3 블록의 작은 그룹

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

## Phase 3 누적 진행 (~G5)

| 그룹 | 글 | 평탄화 | keep (분류 보정) |
|---|---|---|---|
| G1 `cat:kubernetes` | 8 | 33 | 1 (lang=`log`) |
| G2 `argocd-troubleshooting` | 3 | 5 | 1 (lang=`hcl`) |
| G3 `eks-troubleshooting` | 7 | 23 | 1 (lang=`diff`) |
| G4 `goti-multicloud` | 7 | 12 | 0 (lang 명시는 하이브리드) |
| G5 `goti-observability-ops` | 5 | 1 | 8 (lang=`text`/`alloy`/`promql`) |
| G6 `cat:cicd` | 3 | 3 | 4 (lang 명시 + 옵션 비교 일관성) |
| G7 `goti-observability-stack` | 5 | 7 | 1 (lang=`text` 명시) |
| G8 `goti-java-to-go` | 4 | 6 | 2 (lang=`text` 명시 메타데이터) |
| G9 `istio-observability` | 2 | 3 | 0 |
| G10 `goti-cloudflare-migration` | 2 | 10 | 0 |
| G11 `goti-auth` | 3 | 1 | 4 (lang=`diff`/`text` 명시) |
| G12 `cat:challenge` | 3 | 4 | 2 (lang=`text` 명시) |
| G13 `goti-redis-sot` | 3 | 4 | 3 (lang=`text` 명시 + race 시퀀스) |
| G14 `goti-ticketing-phase` | 3 | 5 | 0 |
| G15 `istio-intro` | 1 | 2 | 0 |
| G16 `goti-queue-poc` | 2 | 3 | 2 (lang=`text` 명시) |
| G17 `queue-poc-loadtest` | 1 | 2 | 2 (lang=`text` 명시 트리/응답) |
| G18 `cat:monitoring` | 4 | 5 | 1 (lang=`text` 토폴로지) |
| G19 `eks-infra` | 1 | 3 | 0 |
| G20 `goti-eks` | 2 | 2 | 1 (lang=`hcl` Terraform) |
| G21 `challenge-2-wealist-migration` | 4 | 4 | 0 |
| G22 `goti-istio-ops` | 3 | 3 | 2 (lang=`text` Prom 출력) |
| G23 `eks-security` | 1 | 1 | 1 (lang=`text` 콘솔 로그) |
| G24 `game-server` | 1 | 3 | 0 |
| **합계** | **78** | **145** | **36** |

전체 211 flatten 추천 중 **145 블록 처리(약 69%)** + keep 보정 36건. 다음 진입점은 **G25 `series:goti-multicloud-db`** (1편 / 1블록 / 12줄).

### 다음 세션 재개 절차

1. 이 파일(`state.md`) 확인 — Phase 3 체크박스 + 진행 로그
2. `groups.md`의 G6 섹션에서 글 목록과 블록 위치 확인
3. `criteria.md` 평탄화 방법론 + 분류 보정 룰("lang 명시 코드는 keep") 적용
4. `decisions.md`의 G1~G5 결정 로그 패턴 참고 (bullet/표/번호목록/인라인 분포 + G5의 keep 비중 사례)

## 진행 로그

- 2026-04-28 오전: Phase 1 인벤토리 자동 추출 (141편/429블록/4,425줄)
- 2026-04-28 오후: Plan 리뷰 후 v2로 전환 — 단계 분리 결정 (시각화 도구는 다음 세션). scan.mjs 분류 로직 개선(tree 토큰 + lang 필터 + decision 추천). Phase 2 완료, `criteria.md` + `groups.md` 산출 (41 그룹 / 211 flatten 블록 / 1,017줄). Phase 3 시작 대기.
- 2026-04-28 저녁: G1 (`cat:kubernetes`) 완료 — 8편 / 33블록 평탄화 (1블록은 실로그라 keep 처리). 표 5개, 인라인 7개, lang 명시 13개, 마크다운 목록 8개로 변환. 자세한 결정 로그는 `decisions.md` 참조.
- 2026-04-28 저녁: G2 (`series:argocd-troubleshooting`) 완료 — 3편 / 5블록 평탄화 (75줄 hcl 코드 1블록은 실제 Terraform 코드라 keep 처리). 표 2개, nested 번호 목록 3개로 변환.
- 2026-04-28 저녁: G3 (`series:eks-troubleshooting`) 완료 — 7편 / 23블록 평탄화 (10줄 diff 코드 1블록은 실제 ArgoCD diff라 keep 처리). 표 1개, bullet 목록 14개, 인라인 5개, 번호 목록 3개로 변환.
- 2026-04-29: G4 (`series:goti-multicloud`) 완료 — 7편 / 12블록 평탄화. 멀티클라우드 트래픽 경로/장애 사슬 박스가 많아 번호 목록 비중이 가장 높음(4건). 표 2개, bullet 목록 3개, 인라인 2개, lang 명시+주석 분리 1개. 다음은 G5 `goti-observability-ops`.
- 2026-04-29: G5 (`series:goti-observability-ops`) 완료 — 5편 / 9블록 중 1블록만 평탄화(번호 목록), 8블록은 분류 보정으로 keep. 관측성 시리즈는 lang=`text`/`alloy`/`promql` 명시 + 실제 응답·설정·옵션 비교 다이어그램이 대부분이라 keep 비중 압도적. 다음은 G6 `cat:cicd`.
- 2026-04-29: G6 (`cat:cicd`) 완료 — 3편 / 7블록 중 3블록 평탄화(굵은 글씨+bullet 2, 인라인 1), 4블록은 lang 명시 keep 보정. 옵션 비교 다이어그램(A/B/C)은 본문 일관성 위해 보존. Before/After 박스는 운영 효과 강조라 풀어쓰기. 다음은 G7 `goti-observability-stack`.
- 2026-04-29: G7 (`goti-observability-stack`) 완료 — 5편 / 8블록 중 7블록 평탄화(인라인 3, 표 3, 번호 목록 1), 1블록 keep 보정. Before/After 비교와 단계별 지연 누적이 표 형식으로 가장 가독성 좋음. 다음은 G8 `goti-java-to-go`.
- 2026-04-29: G8 (`goti-java-to-go`) 완료 — 4편 / 8블록 중 6블록 평탄화(표 4, 인라인 2), 2블록 keep(실 smoke 출력 + 커밋 목록 lang 명시). 이미지 배포 시퀀스·커밋-변경 매핑·트리거 차이가 구조적 매핑이라 표 비중 50%. 다음은 G9 `istio-observability`.
- 2026-04-29: G9 (`istio-observability`) 완료 — 2편 / 3블록 모두 평탄화. 20줄 Span 타임라인 ASCII 시각화는 표(Span/서비스/시작ms/종료ms/비고)로 변환 + 부모-자식 관계 + latency 누적 설명 본문 보강. 진단 절차 2건은 번호 목록. 다음은 G10 `goti-cloudflare-migration`.
- 2026-04-29: G10 (`goti-cloudflare-migration`) 완료 — 2편 / 10블록 모두 평탄화. 번호 목록 6, bullet 3, 인라인 1. CloudFront/Cloudflare 마이그레이션 서사 자체가 "5가지 문제 연쇄"이고 각 문제가 단계별 사이클이라 번호 목록 비중 60%. SSL 이중 종단 흐름은 두 글에서 반복되는데 일관되게 번호 목록으로 변환. **누적 50% 통과** (103/211). 다음은 G11 `goti-auth`.
- 2026-04-29: G11~G14 묶음 처리 완료 — 13편 / 23블록 중 14블록 평탄화(번호 목록 4, 인라인 3, 표 3, bullet 3, 굵은+번호 1), 9블록 keep(go-ti 시리즈가 lang=`diff`/`text`로 실제 diff/로그/측정값 많이 인용). D0~D7 롤아웃, Phase 7 경로 B 9단계, GitHub Actions 자동화 같은 다단계 흐름은 번호 목록이 압도적. 누적 117/211 (55%) + keep 27. 다음은 G15 `istio-intro`.
- 2026-04-30: G15~G24 묶음 처리 완료 — 20편(istio-intro/queue-poc/eks/monitoring/cicd 일부 + wealist 4파트 + game-server) / 37블록 중 28블록 평탄화(번호 목록 11, 인라인 8, bullet 6, 표 3), 9블록 keep(lang=`text`/`hcl` 명시 출력·토폴로지·Terraform). 누적 145/211 (69%) + keep 36. 짧은 토폴로지 화살표 흐름이 lang=`text` 명시되어 있을 때는 keep 보정으로 일관 처리. 다음은 G25 `goti-multicloud-db`.
