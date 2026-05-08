# 2026-04-28 — 포트폴리오 컨설팅 2라운드: K8s DevOps 포지셔닝 + AI 4장 압축 통합

## 배경

2026-04-27 1라운드 (slides 21장 톤 정리 + AI Addendum 14장 별도 PDF) 이후 컨설팅 피드백을 받고 2라운드 진행. 핵심 변화는 **별도 PDF 폐기, 메인에 4장으로 통합** 그리고 **앞부분 "이력서식 About"으로 재구성**.

## 컨설팅 피드백 핵심

| 영역 | 피드백 | 처리 |
|------|--------|------|
| 분량 | 25장이 한도 — 알차서 있는 것, 더 늘리면 안 됨 | 21 + 4(AI) − 2(00-cover, 00a-intro) + 1(About) = 24장 |
| AI Addendum 14장 | 별도 PDF 안 보냄 → 메인 4장으로 압축 | 신규 4장 작성 |
| 00-cover + 00a-intro | 둘 다 폐기, "이력서 + About 합친" 1장으로 | 00-about.html 신규 |
| Java→Go 어필 | "뜬금없다" — 완전 제거 | 17-closing, 18-module-index 잔재 정리 |
| "AI를 도구가 아닌 환경으로" 슬로건 | 명시 거부 | 제거 |
| "15인 팀 전용 환경" | 실제 그렇게 쓴 게 아님 | 제거 |
| Skills/Agents 카운트 (194/46/46/19) | 누구나 가능, 인플레이션 | 카운트 어필 전면 제거 |

근거: Pulumi/Snyk 가이드 외부 검증 — "Kubernetes debugger는 skill, DevOps helper는 wish list". 카운트 인플레이션은 신호가 아님.

## 포지셔닝 결정

**"K8s 운영 DevOps에 AI를 박았습니다"** (헤드라인은 placeholder, 사용자 최종 컨펌 대기 중)

| 단계 | 후보 | 결정 |
|------|------|------|
| 1차 | "Internal AI Platform" + Cloudflare iMARS 비교 | **기각** — 사용자 본인 영역(K8s 한정)과 Cloudflare(사내 전체 dev productivity)의 layer가 다름 |
| 2차 | "인프라 도메인 특화 AI Platform" | **기각** — 본인 정체성("DevOps · Infra Lead")과 채용 시장 키워드 불일치 |
| 3차 | "DevOps 워크플로우 자동화" | **기각** — 너무 광범위, 다시 generic |
| **4차** | **"K8s 운영 DevOps"** | **채택** — 본인 무게중심, agents/skills 자산 정렬, 시장에서 specific 키워드 |

근거 메모리: `feedback_portfolio_self_pitch.md` (2026-04-28 강화), `feedback_no_java_go_in_self_pitch.md`

## AI 4장 압축 전략

원본 14장(S1~S14) → 4장으로. 청중 2종 모두 도달:
- AI 안 쓰는 사람: AI-1(자산 변환 결과) · AI-3(시간순 우위)
- AI 쓰는 개발자: AI-2(자기 개선 사이클) · AI-4(메타 증거)

| # | 메시지 축 | 핵심 비주얼 | 통합 원본 |
|---|-----------|-------------|-----------|
| **AI-1** | K8s 운영 DevOps에 AI 박음 — REVIEW · CYCLE · BUILD 3축 | 3 카드 grid | S1 + S5 + S8 |
| **AI-2** | 트러블이 룰로 환원되는 주간 사이클 (Self-correcting) | ★ **원형 다이어그램** (S6 그대로) | S6 + S7 |
| **AI-3** | Anthropic 명명 전 시작 — Harness 6 component 모두 보유 | Timeline + 매핑 테이블 | S11 + S12 |
| **AI-4** | 포트폴리오 빌드 자체가 작동 증거 + NEXT 3단계 | Evidence 3건 + Steps 3 | S9 + S13 + S14 |

각 페이지 다른 시각화 패턴(카드 grid / 원형 / 테이블 / evidence)으로 단조로움 방지. 카운트 어필 0개. 외부 검증 가능 지표만 사용.

## 새 About 1장 (00-about.html)

샘플 이력서 페이지 형식 + 본인 결과 임팩트 hybrid:

| 영역 | 구성 |
|------|------|
| 좌측 사이드바 | 김혁준 / DevOps Engineer / contact 3개 / 경력 / 교육 |
| 우측 메인 4 카드 | K8s 인프라(5xx 0%대) · GitOps CI/CD(자동 롤백) · 서비스 메시(MSA 6/6) · 관측성(380 패널 · 사건 4건) |
| 하단 기술 스택 6줄 | Cloud · Orch · CI/CD · Obs · IaC · Lang (Java 제외) |

샘플 페이지 대비 차이:
- 결과 임팩트 숫자를 4 카드에 다 박음 (샘플은 능력 명사만)
- 좌측 약점 노출 ("백엔드 1.2년") 제거 → "DevOps · Infra Lead"로 일관
- Lang에 Java 제외 (어필 안 할 거니까)
- 슬로건/카운트/15인 모두 부재

## Java→Go 잔재 제거 (3곳 → 2곳 변경 + 1곳 유지)

| 위치 | 변경 |
|------|------|
| `09-m04.html` 페이지 | **유지** — 이미 1라운드에서 "스파이크 대응 인프라"(KEDA + PgBouncer)로 재작성됨, Java→Go 어필 아님 |
| `17-closing.html:226` | `CDN Edge 97.7% 흡수 · p50 18ms 응답` → `CDN Edge 97.7% 흡수 · 5K VU 부하에서 5xx 0%대 검증` |
| `18-module-index.html:207-209` | `API 응답 P50 18ms / 189→18ms 10배` KPI 카드 → `P0 보안 갭 사전 차단 6건 / CIS·CVE·MITRE / AI 사이클 1회 산출` |

KPI 카드 교체 의도: AI-2 사이클 페이지의 "P0 보안 6건"과 연결되어 흐름 강화. 카운트 어필 아님 — "사이클이 사전 차단한 결과"라는 외부 검증 가능 지표.

## 작업 순서 (실제 진행)

1. ✅ 메모리 3건 작성 (이번 라운드 진행 + 기존 feedback 강화 + MEMORY.md 인덱스)
2. ✅ Task 8건 등록 (세션 복구용)
3. ✅ 새 About 1장 작성 (00-about.html)
4. ✅ AI-1 ~ AI-4 4장 작성 (20-23-ai-*.html)
5. ✅ Java→Go 잔재 2곳 정리
6. ✅ 기존 00-cover, 00a-intro → `pages/_archive/`로 이동
7. ✅ footer 페이지 번호 일괄 update (18개 파일, "/ 21" → "/ 24" + 분자 +1)
8. ✅ `19-contact.html` → `24-contact.html` rename (알파벳 순 캡처 순서 보정)
9. ✅ `index.html` 24장 grid로 재작성 (섹션 분리: INTRO · MAIN · AI · CONTACT)
10. ✅ `make-pptx.mjs` `19-contact.png` → `24-contact.png` 하드코딩 update
11. ✅ `build/out/` 옛 PNG 21개 클린
12. ✅ `npm run all` (capture 24장 → PPTX 빌드)

## 결과

- 총 24장 (25장 한도 안에서 1장 여유)
- 새 About 1장 + 새 AI 4장 = 5장 신규
- 기존 21장 → 19장 유지 (00-cover, 00a-intro 폐기)
- contact 페이지 위치 보정 (19 → 24)
- footer 페이지 번호 다 일관 (yy / 24)

## 다음 (사용자 컨펌 필요)

1. **헤드라인 5개 다듬기** — placeholder 그대로 둔 5개:
   - 00-about: "김혁준 · DevOps Engineer" (사이드바 본명 + role만, 헤드라인 없음 OK?)
   - 20-ai-1: "K8s 운영 DevOps에 AI를 박았습니다" (사용자 별로라 함)
   - 21-ai-2: "K8s 트러블이 룰로 환원되는 주간 사이클"
   - 22-ai-3: "Anthropic이 명명하기 전에 시작 — Harness 6 component 모두 보유"
   - 23-ai-4: "이 포트폴리오 빌드도 같은 시스템이 도왔습니다"
2. **00-cover, 00a-intro `_archive/` 보존 vs 삭제** — git rm 결정
3. **시각적 검증** — 24장 흐름 자연스러운지, 톤 일관성 확인

## 교훈

- **사용자 피드백 메모리를 먼저 읽고 적용해야** — 1차 제안에서 "AI를 도구가 아닌 환경으로" 슬로건 + Skills 카운트 카드 모두 메모리 원칙 위반. 사용자가 직접 지적해줘서 발견. 메모리 단순 저장이 아니라 **작업 시작 전 명시적으로 체크**가 필요.
- **외부 검색이 어필 강화에 결정적** — "Cloudflare iMARS" 사례, "Skill = 1 job 원칙", "2026 채용 시그널" 모두 검색으로 발굴. 본인 직감("AI 카운트는 누구나 가능")이 외부 가이드와 정확히 일치함을 확인. 검색이 자기 직감의 근거를 제공.
- **포지셔닝 4단계 시도 (Cloudflare → 인프라 → DevOps → K8s DevOps)** — 사용자가 단계마다 우려를 정확히 제기해 좁혀짐. 처음부터 정확한 답을 찾으려 하지 말고, **사용자 직감을 기준으로 좁혀가는 게 빠름**.
- **알파벳 순 빌드 함정** — `19-contact.html`이 새 `20-ai-*` 앞에 와서 캡처 순서 틀림. 파일명 prefix가 build order를 결정하는 시스템에서는 **파일 추가/제거 시 항상 sort 순서 검증** 필요.
- **하드코딩된 contact 슬라이드 hyperlink** — `make-pptx.mjs`에 `19-contact.png` 하드코딩. 파일명 변경 시 update 필요. 비슷한 단일 파일명 의존성 코드에 주의.

---

# 2026-04-28 (후속) — B안 채택 + AI Hero 새 디자인

## 결정 변경 (D안 → B안)

D안 (Hook 1장 + Climax 3장 분산)을 제안했으나 사용자가 핵심 우려 제기:

> "이거 끝까지 안볼수도 있다는게 중요해. 이사람이 ai 도 잘쓰네!! 이런게 20페이지 넘어 있으면 그까지 안본다면 이 포트폴리오 자체가 무의미해져서 그래"
>
> "내꺼 전체를 2분도 안되서 본다 생각해봐봐. 원래는 엄청 오래봐야될 만큼 많은 내용이 있어"

→ **2분 deck 사고 도입**. 채용 담당자는 페이지당 ~5초만 본다는 전제로 재설계.

| 원칙 | 적용 |
|------|------|
| **앞 5장 = 자체 완결 deck** | AI 4장 + About = 그것만 봐도 핵심 다 박힘 |
| **본문은 깊이 보고 싶은 사람용 detail** | 6번부터 안 봐도 핵심 메시지 보존 |
| **헤드라인이 본문 역할** | 5초만 봐도 메시지 전달 |

## B안 확정 구조

```
01. AI · HERO (Before/After · 표지 겸함)   ← 새 디자인
02. AI · CYCLE (★ 원형)
03. AI · HARNESS 매핑
04. AI · META (포트폴리오 = 작동 증거)
─────────────────────────────────────────
05. About (이력서식)
─────────────────────────────────────────
06~21. 본문 (Overview · Architecture · M02 · M04 · M05 · M06)
22. Closing
23. Impact Summary
24. Contact
```

## AI Hero 디자인 (옵션 2 — Before/After)

검색 인사이트로 5개 옵션 도출:
- 1 (Big Number) — 데이터형
- **2 (Before/After) — 사고 깊은 사람** ← 채택
- 3 (Single Statement) — 단호형
- 4 (Provocation) — 도발형
- 5 (Visual Proof) — 시각 우선

**채택 사유**: 사용자 정체성("실시간 운영 중인 사람")과 일치. 추가 시그널 — `github.com/ressKim-io/ress-claude-agents` agents 레포 실시간 개선 = 진짜 운영 증거.

### 디자인 핵심 요소

| 요소 | 내용 |
|------|------|
| 헤드라인 | "AI를 **어디까지 운영**할 수 있을까요?" (질문형) |
| 좌 카드 (BEFORE) | 쓴 사람 · one-shot · 매번 재학습 · 같은 실수 반복 (회색 처리) |
| 우 카드 (AFTER) | 운영한 사람 · cycle · sensors · self-correcting (브랜드 강조 + shadow-pop) |
| 중앙 화살표 | "박았습니다" 라벨 |
| 좌측 vertical brand bar | 표지 시그널 (8px gradient) |
| 헤더 | "● 김혁준 · DevOps Engineer" (표지 역할 겸함) |
| 하단 live signal | 🟢 dot + "실시간 운영 중 — github.com/ressKim-io/ress-claude-agents 매주 사이클로 갱신" |

## 파일 구조 변경 (B안)

기존 24개 파일 prefix 일괄 재정렬:

| 새 prefix | 새 파일명 | 이전 파일명 |
|-----------|-----------|-------------|
| 01 | 01-ai-hero.html | _new-ai-hero.html (방금 작성) |
| 02 | 02-ai-cycle.html | 21-ai-2-cycle.html |
| 03 | 03-ai-harness.html | 22-ai-3-harness.html |
| 04 | 04-ai-meta.html | 23-ai-4-meta.html |
| 05 | 05-about.html | 00-about.html |
| 06~21 | 06-overview ~ 21-m06-events | 01-overview ~ 16-m06-events |
| 22 | 22-closing.html | 17-closing.html |
| 23 | 23-impact.html | 18-module-index.html |
| 24 | 24-contact.html | 24-contact.html (그대로) |
| (제거) | _archive/20-ai-1-overview.html | 20-ai-1-overview.html (3 카드 grid 폐기) |

충돌 방지를 위해 두 단계 mv (zz- 임시 prefix 경유). footer 페이지 번호도 21개 파일 일괄 update.

## 결과

- 24장 (변동 없음)
- AI Hero 신규 디자인 (Before/After) — 1번 자리
- 기존 AI-1 (3 카드 grid) → archive
- footer 페이지 번호 모두 새 위치로 일관

## 다음

- 사용자 검토 (file:// 또는 index.html)
- 헤드라인 5개 다듬기 (사용자 워딩 결정)
- `_archive/` 처리 (보존 vs git rm)

## 추가 교훈

- **"끝까지 안 본다"는 사용자 직감이 narrative arc 함정의 정답** — 이론상 D안(분산)이 정교하지만 **현실적으로 차별화 메시지가 안 박히면 무용**. 사용자 우려를 추상 이론보다 우선시.
- **"2분 deck" 사고 = 정보 우선순위 결정 도구** — 모든 페이지가 아니라 **앞 5장이 deck 전체를 대표**. 뒤는 detail. 이게 채용 현실.
- **"실시간 운영 중" 시그널의 가치** — 정적 자산(OSS 공개)보다 **현재진행형 시그널**이 훨씬 강함. agents 레포 매주 갱신 사실을 hero 페이지 하단에 박은 게 결정적 차별화. (후속 라운드에서 1번 페이지 미니멀화로 제거하긴 했지만 컨셉 가치는 유효)
- **두 단계 mv 패턴** — 같은 디렉토리 내 prefix 재정렬 시 충돌 방지. zz- 임시 prefix 경유.

---

# 2026-04-28 (저녁 후속) — B-final 순서 + 면접관 소통 원칙

## 추가 결정 (Round 2 후반)

### 1. 페이지 순서 한 번 더 변경 (B → B-final)

사용자 우려 2가지 — "AI 끝나고 6번 어정쩡" + "Goti 컨텍스트 없이 시작" — 둘 다 해결.

**B-final 순서**:
```
01. About (이력서식 + Goti 정보 보강)
02-05. AI 4장
06. Overview ("10만 동시접속을 어떻게 흡수했나" — transition)
07-21. 본문
22-24. Conclusion
```

핵심 변화:
- About을 1번으로 이동 (이전: 5번)
- AI 4장을 2-5번으로 (이전: 1-4번 1칸씩 밀림)
- Overview는 6번 그대로 (본문 transition 역할)
- About 좌사이드바에 PROJECT + ROLE 그룹 분리해 Goti 정보 보강

### 2. "면접관 소통 원칙" 정립

> "이 텍스트로 면접관과 소통한다 생각하라" (사용자 컨설팅 피드백 인용)

- 슬라이드 헤드라인 = 면접관이 5초 보고 "어떻게?" 묻고 싶어하는 한 줄
- 추상 슬로건 ❌ → **질문형 / 도전 명시 / 결과 암시** ⭕
- 모호 동사 ("주도", "혁신") ❌ → **구체 사실 + 외부 검증 가능 숫자** ⭕

### 3. Overview 헤드라인 적용

- Before: "대규모 티켓팅, **3가지로 풀었습니다**" (모호)
- After: **"10만 동시접속을 어떻게 흡수했나"** (질문형)
- 50만 → 10만 (실제 검증 수치만)
- 서브헤드를 헤드라인으로 끌어올리는 사용자 직접 피드백 적용

### 4. About 좌사이드바 보강

| Before | After |
|--------|-------|
| EXPERIENCE: "DevOps · Infra Lead / Goti — 대규모 티켓팅 플랫폼 · 2026 Q1 (16주)" | **PROJECT**: Goti — KBO 야구 티켓팅 / 대규모 티켓팅 플랫폼 · 10만 동시접속 검증 |
| | **ROLE**: DevOps · Infra Lead / 7직군 협업 · 클라우드 네이티브 파트장 |
| EDUCATION: 그대로 | EDUCATION: 그대로 |

→ 1번 페이지에서 "이 사람 누구 + 이 프로젝트 뭐" 동시 박힘.

## 메모리 추가

- `feedback_slide_text_as_dialogue.md` — 면접관 소통 원칙 (다른 페이지 헤드라인 점검에도 적용 가능)
- `project_portfolio_consulting_round2_2026_04_28.md` — B-final 순서 + 변경 사항

## 결과

- 24장 유지 (페이지 수 변동 없음)
- PPTX 7 MB 재빌드
- footer 페이지 번호 일관 (xx / 24)
- index.html 4 섹션으로 분리 (IDENTITY · AI · OVERVIEW · MAIN · CONCLUSION)

## 추가 교훈 (Round 2 후반)

- **사용자 직감이 항상 narrative 정답** — 이론상의 narrative arc(crescendo, sandwich)는 컨설팅 가이드에 있지만, 실제 채용 환경에서는 사용자가 본 직감("끝까지 안 본다", "AI 다음 어정쩡")이 더 정확. 항상 사용자 직감을 받아 좁히는 방향.
- **"슬라이드 = 면접관 prompt" 사고가 모든 워딩 점검의 기준** — 헤드라인 작성 시 "이걸 본 면접관이 뭐 묻고 싶어할까?"를 1차 질문. 답변 거리가 본문에 있으면 OK, 없으면 워딩 다시.
- **About에 PROJECT 그룹 별도 분리** — EXPERIENCE 단일에 회사·역할·기간 다 묶으면 어느 게 핵심인지 안 보임. PROJECT(무엇)·ROLE(어떻게)·EDUCATION(준비) 3 그룹 분리가 5초 안 인지에 유리.
- **"50만"같은 부풀린 숫자는 면접에서 함정** — 실제 검증한 10만으로 정직하게. 면접관이 "정말 50만?" 물어보면 답 곤란. 실측 수치만.

---

# 2026-04-28 (마무리) — 텍스트 카피 전수 정리

## 사용자 통찰 — "포트폴리오 = 면접관과 소통하는 글"

세션 후반에 사용자가 진짜 핵심 원칙 정립:
> "이 텍스트로 면접관하고 소통한다 생각을 하라"
> "독특하게, 잘 읽히는 한글 — 글의 구성"
> "포트폴리오로 소통하는 거지. 얘기가 되어야 한다"

→ 슬라이드 텍스트 = **본인 발표를 받쳐주는 대화 도구**. 면접관이 5초에 박힐 + "어떻게?" 묻고 싶게 + 본인 답변 거리가 본문에 있어야.

## 외부 검색으로 도출한 12가지 한국어 카피 원칙

| 원칙 | 출처 |
|------|------|
| **3초 룰** — 핵심 못 잡으면 이탈 | 드랩아트 2026 디자인 트렌드 |
| **5-10 단어 원라이너** — 엔젤리스트/크런치베이스 표준 | 실리콘밸리 피치덱 |
| **모바일 단문** — "Are you sure ~?" → "Delete?" | UX writing 가이드 |
| **숫자 임팩트** — 짧은 시간에 결정 좌우 | 스타트업 피치덱 |
| **추상 ❌ 구체 ⭕** — "최적화" ❌ → "응답 0.8초 단축" ⭕ | 개발자 포트폴리오 |
| **문제 → 과정 → 해결 → 결과** 4단계 | 신입 포트폴리오 가이드 |
| **deck headline + dek** — "what is this + why care" | MasterClass |
| **추상 표현 금지** — 숙련도 형식 ❌ → 경험 ⭕ | 개발자 포트폴리오 |
| **명확한 언어** — cryptic words ❌ | Quora deck |
| **Human language** — 사람 톤 | Engineering portfolio |
| **삼성 UX writing** — 작은 표현이 인상 좌우 | Samsung Designing Words |
| **영문/한글 혼합 시 영문 적게** | 직지소프트 |

## 텍스트 카피 전수 변경 (총 ~50건)

### 헤드라인 (10개)

| # | Before | After |
|---|--------|-------|
| 06 Overview | "10만 동시접속을 어떻게 흡수했나" → | "**한 순간에 10만 명이 들어옵니다**" + 서브 "Goti — KBO 야구 티켓팅 플랫폼. 그 부하를 부하 흡수 · 안정성 확보 · 모니터링 3축으로 받아냈습니다" |
| 09 M02 Target | "10만 동시 접속 목표" → | "**한 명이 2초마다 status를 호출합니다**" |
| 12 M02 Arch | "CDN Edge 대기열 아키텍처" → | "**Polling은 엣지에서 막습니다**" |
| 13 M02 Verify | "검증 — 운영 부하 환경에서 CDN 효과를 실측했습니다" → | "**5K VU로 부딪쳐 봤습니다 — 97.7% 흡수**" |
| 14 M04 | "스파이크 트래픽 대응 — 인프라 영역 기여" → | "**예매 오픈 30분 전, Pod와 Node를 미리 띄웁니다**" |
| 18 M06 Select | "독립 평가 — 결과적으로 LGTM + OTel" → | "**메트릭 · 로그 · 트레이스 · 수집기, 각각 따로 골랐습니다**" |
| 19 M06 Pipeline | "수집 단일화 · Kafka → Pod replica 단순화" → | "**Kafka까지 검토했지만, 운영 부담으로 뺐습니다**" |
| 21 M06 Events | "모든 개선 의사결정은 '모니터링'으로 관측·확인했습니다" → | "**대시보드가 진짜 사건 4건을 잡았습니다**" |
| 22 Closing | "16주를 3가지로 정리합니다" → | "**부하를 막고, 안정성을 만들고, 모니터링으로 검증했습니다**" |
| 23 Impact | "모든 변경에 숫자가 따라왔습니다" → | "**숫자 없이는 결정하지 않았습니다**" |
| 04 AI Harness | "Anthropic이 명명하기 전에 시작 ..." → | "**Anthropic Harness 6 component와 1:1 매칭됩니다**" |

### Eyebrow (5개)

| # | Before → After |
|---|---|
| 03 AI Cycle | "(Self-Correcting)" 영문 괄호 제거 |
| 07 Multi-cloud | "아키텍처" → "Multi-cloud 인프라 구성" |
| 08 K8s | "아키텍처" → "K8s 클러스터 내부 구성" |
| 17 M06 Motive | "관측성 · 동기" → "모니터링을 도입한 이유 · Stadium 사건" |
| 19 M06 Pipeline | "아키텍처 · 모니터링 스택" → "모니터링 파이프라인 4단" |

### Callout (2개)

| # | Before → After |
|---|---|
| 15/16 M05 | "Cloudflare = SoT for Routing" → "Cloudflare Workers가 라우팅의 단일 관리점" |

### 일괄 sed 변경

- **관측성 → 모니터링** (19곳) — "Observability" 직역. 한국 개발자에 자연스럽지 않음. "Monitoring"으로 통일
- **환원 → 기록** (13곳) + **박힘 → 기록합니다** (1곳) — "환원"은 IT 산업 용어 아님 (외부 검색 0건). "기록"으로 통일
- **OBSERVABILITY 영문 → MONITORING** (22 closing role)

### 직역 의심 4곳

| 위치 | Before → After |
|---|---|
| 09 M02 Target subhead | "정량화" → "숫자로 봤습니다" |
| 18 M06 Select subhead | "의식적으로 검증" → "일부러 검증" |
| 18 M06 Select stack-card | "ADR-0007 · 의식적 전환" → "ADR-0007 · 의도적 전환" |
| 06 Overview axis-card | "모니터링 커스텀" → "모니터링 직접 구축" |

### 카운트/팀 규모 (메모리 원칙 준수)

- "16명" 제거 — 06 overview 하단 메타, 23 impact subhead
- "7직군 협업" 유지 — 협업 사실 보존

### 시각 정리

- 02 AI Hero "전 운영을 했습니다" 라벨 제거 — ★ 제 선택 배지로 충분
- 02 AI Hero hero-footer 통째 제거 — 미니멀화
- 04 AI Harness 매핑 테이블 헤더 행 제거 — 좌-우 색상으로 충분
- 04 AI Harness timeline marker "본인은 그 전에 시작" 제거 — 헤드라인과 중복

### 50만 → 10만 비례 조정

- 09 M02 Target: 동시 접속 50만→10만 / 최소 20만→4만 / 250K→50K req/s / 500K→100K polling
- 15 M05: "50만 동시접속과 CSP 리전 장애" → "10만 동시접속과 CSP 리전 장애"

### 페이지 순서 변경 (B-final)

```
01 About (이력서식)
02-05 AI 4장 (Hero / Cycle / Harness / Meta)
06 Overview ("한 순간에 10만 명이 들어옵니다") ← AI 다음 transition
07-21 본문 (Architecture · M02 · M04 · M05 · M06)
22-24 Conclusion (Closing / Impact / Contact)
```

## 빌드 결과

- 24장, PPTX ~7 MB
- footer 페이지 번호 일관 (xx / 24)
- 모든 텍스트 사람 톤 + 면접관 소통 원칙 적용
- "환원/박힘" 잔재 0건, "관측성" 잔재 0건, "16명" 잔재 0건

## 추가 교훈 (마무리)

- **본인이 만든 비표준 표현은 면접관에게 통하지 않는다** — "환원"은 본인 메타 키워드였지만 외부 검색 결과 IT 산업 용어 아님. 본인 머릿속에서 자연스러운 표현이 외부에서는 외계어. 면접관 관점 검증 필수.
- **"박는다"도 일상 한국어 IT 맥락에 어색** — 본인이 임시 대안으로 쓰던 표현도 사용자가 직접 거부. 정직하게 "기록"이 가장 통용.
- **"커스텀", "정량화", "의식적" 같은 한자어/영한 혼용 직역** — 한국어 이공계 논문/매뉴얼에서 흔하지만 면접관 대화에서는 어색. 일상 한국어 동사로 풀어 쓰기.
- **사용자가 직접 워딩 제안하면 그게 정답** — "같은 실수를 하지 않게 룰로 기록합니다" 같이 사용자가 직접 만든 문장이 가장 자연스러움. 본인 머릿속 톤이 본인 발표 톤과 일치.
- **외부 검색의 가치 — 자기 직감 검증 도구** — "관측성", "환원" 모두 사용자 직감으로 어색함을 발견. 검색이 그 직감의 외부 근거를 제공. 직감 + 검증의 사이클.

## 다음 세션 복구 지점

이 세션이 마무리됐으나 다음 세션에서:
1. **컨설턴트 다음 라운드 피드백** 받으면 같은 톤/원칙으로 추가 점검
2. **10번/11번 페이지 사용자 직접 워딩** 결정 (현재 "카피 교체 예정" 마킹)
3. **PPTX 컨설턴트 제출** + 피드백 응답 사이클
