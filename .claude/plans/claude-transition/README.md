# Codex → Claude 전환 기록과 다음 작업

**새 세션에서 글쓰기 규칙·스킬·에이전트를 손보기 전에 이 파일부터 읽는다**

---

## 배경

2026-10-21~26에 k8s-theory 71편의 변환·문장 편집·구조 편집·그림 추가를 Codex(GPT)로 진행했다
그동안 Codex용 설정 사본(AGENTS.md, `.agents/skills`, `.codex/`)이 생겼다. Claude 쪽 CLAUDE.md·스킬·에이전트에는 "Codex·Claude 공통" 문구와 `docs/writing-voice.md` 기준이 들어갔다

2026-11-07 사용자 결정: **앞으로 이 블로그는 Claude Code로만 작업한다**

## 2026-11-07에 끝낸 것

| 작업 | 내용 |
|---|---|
| Codex 전용 파일 삭제 | `AGENTS.md`, `.agents/skills/draft-to-post/`, `.codex/`(agents·hooks·config), `scripts/lint-post-hook.mjs`, `.gitignore` 항목 |
| Codex 언급 정리 | CLAUDE.md, draft-to-post SKILL.md, `docs/writing-voice.md`, `docs/theory-writing-rationale.md`, k8s-theory README·plan, `docs/structure-review/handoff.md` |
| CLAUDE.md 보강 | Codex가 넣고 문서화하지 않은 예약 게시·매일 재빌드·`PREVIEW_K8S_THEORY` 동작을 추가 |
| 낡은 안내 정리 | SKILL.md의 "진행 중 시리즈" 안내, blog-writer의 Codex 시절 문구와 확정일 표기, blog-reviewer의 기준 문서 표현 |

과거 작업 기록(배치 기록, `docs/editorial-review/`, `docs/structure-review/execution/`·`diagrams/`)에 남은 AGENTS.md·Codex 언급은 **그대로 둔다**
당시 실제로 읽은 문서를 적은 기록이라, 고치면 기록이 틀려진다

글쓰기 규칙은 사용자가 "현행 유지 위주"로 정했다. 이에 따라 `docs/writing-voice.md`의 방향(문단 수 할당 없음, 중복은 덜어냄, 요약·예고 의무 없음)을 유지한다
예전 Claude 시기 기준(표 뒤 2~4문단, 편당 2~3배 확장)으로 되돌리지 않는다

---

## 다음 작업

실행 순서는 T1 → T2·T3 → T4~T6이다
T2·T3의 결정은 T1 비교 결과에 달려 있다. T4~T6은 스킬·에이전트를 다시 나누는 작업이라 한 번에 해야 두 번 손대지 않는다
T7은 별도 결정 사항이다

### T1. Codex가 쓴 k8s 글의 문체를 비교해 스킬·에이전트로 추출

**이유**: 사용자가 Codex로 쓴 k8s-theory 글을 "개인적으로 더 자연스러운 부분이 많다"고 평가했다. 무엇이 자연스러운지 찾아 규칙으로 만들면 이후 Claude 작업에도 같은 품질을 재현할 수 있다

**비교 대상**
- Codex: `src/content/essays/kubernetes/k8s-theory-*.md` 71편
- Claude 시기: `src/content/essays/runtime/`(kernel-runtime 시리즈), `src/content/essays/rust/`(rust-cs-layer)

**먼저 볼 차이** (2026-11-07에 대강 확인한 것. 비교에서 맞는지 다시 확인한다)
- 도입: 독자의 질문으로 시작하고, 가정 예시("~라고 가정하겠습니다")를 바로 세운다
- 근거 고지 블록: 소스 ref·문서 저장본·"실측 기록 없음"을 글 상단에 밝힌다
- 주체·동작 서술: 무엇이 무엇을 바꾸는지 문장 주어로 드러낸다
- 설명 분량: 문단 수 할당 없이 기전·조건 위주로 쓴다
- 문장 길이·SVG 라벨: T2·T3 참고

**방법**: 같은 성격의 글(개념 해설)끼리 2~3편씩 짝지어 읽고, 차이를 `원문 → 무엇이 다른가 → 규칙화 가능 여부`로 기록한다
규칙으로 만들 수 있는 것만 draft-to-post 스킬 또는 blog-writer/blog-reviewer에 넣는다

**주의**: 비교 결과가 나오기 전에는 k8s 본문과 Claude 시기 글을 수정하지 않는다

### T2. SVG 라벨 언어 결정

**이유**: 규칙끼리 충돌한다
- `SKILL.md`(이미지·다이어그램 절)와 `blog-writer.md`(다이어그램 절): "라벨은 영문"
- `blog-reviewer.md` P2-18: SVG 한글 라벨을 영문 관례 위반으로 보고
- k8s-theory plan 1절: "다이어그램 라벨 한글". 실제 k8s SVG **153장 전부 한글**
- 우선순위 규칙상 plan이 이기는 항목은 slug·order·기준 버전뿐이다. 그래서 plan의 한글 라벨 결정은 근거 없는 예외가 된다

**할 일**: T1 비교에서 한글 라벨의 가독성을 확인하고 전역 기준을 하나로 정한다
- 한글로 바꾸면 SKILL·writer·reviewer 세 곳을 같이 고친다
- 영문을 유지하면 plan의 한글 예외를 우선순위 규칙에 명시한다

Draw.io는 한글 폰트 깨짐 때문에 영문 유지(CLAUDE.md)이고 이번 결정과 별개다

### T3. 문장 길이·SVG 글자 수 기준 재검토

**이유**: 자연스럽다고 평가한 글이 현재 lint 기준에 대부분 걸린다
- `npm run lint:post`의 "100자 초과 줄" 경고가 k8s **71편 전부**에서 나온다
- SVG `<text>` 16개 목표 초과 경고가 18건이다. 근거는 메모리의 svg-minimal-text-rule(2026-07-10 사용자 피드백 "글자가 많아 작아지고 겹친다")
- CLAUDE.md·SKILL.md·writing-voice.md에는 "50자는 참고치"라고 되어 있어 lint의 100자 경고와 기준이 다르다

**할 일**: T1에서 긴 문장이 실제로 읽기 불편한지 확인하고 기준을 정한다
- lint 기준을 바꾸면 `scripts/lint-post.mjs`와 세 문서의 50자 서술을 같이 고친다
- SVG 글자 수는 사용자 피드백이 근거라 기준을 낮추지 않는다. 경고가 난 18건만 실제로 렌더해 겹침·크기를 확인한다

### T4. `docs/theory-writing-rationale.md` 분리

**이유**: 149줄 중 지침은 50줄 정도다. 나머지는 작업 이력이다(PVC 사례 서사, 추가 그림 8장 목록, SVG 153장 수치, 묶음 36개·파일럿, 배포 run 링크, 해시 관련 주의). 그런데 CLAUDE.md는 이론 글을 설계·개선할 때마다 이 파일을 읽게 한다

**할 일**
- 지침 부분을 스킬 쪽 파일(예: `.claude/skills/draft-to-post/theory-structure.md`)로 옮긴다: 설명 순서 기준표, 단계 구분 보존(요청 수락·저장·조정·실행·관측), 그림 선택 원칙, 독립 검토 질문 9개
- 이력 부분은 `docs/structure-review/`에 기록으로 남긴다
- CLAUDE.md의 안내 링크를 새 파일로 바꾼다

### T5. `docs/writing-voice.md` 정리

**이유**
- "말투 참고 자료" 절에 지시가 아닌 출처 설명이 섞여 있다("초기 등록본도 전부 직접 쓴 문장이라고 확인된 것은 아닙니다", 커밋 `34fcda8` 언급). 참고 글 4편 목록만 있으면 된다
- "적용 범위와 우선순위" 절의 "일괄 수정하지 않습니다", "현재 사용자 지시 우선"은 전역 CLAUDE.md의 범위 규칙과 겹친다
- 본문 83줄 중 25줄이 "~않습니다"다. Claude는 "이렇게 쓴다 + 이유" 형태를 더 안정적으로 따른다. 금지 사항은 이미 있는 "줄일 표현" 표로 모은다

**할 일**: 위 세 가지를 고치되 판단 기준(줄일 표현 표, 근거와 확신, 편집 예시, 탈고 질문 6개)의 의미는 바꾸지 않는다. T1에서 찾은 규칙이 말투에 관한 것이면 여기에 넣는다

### T6. 규칙 중복 정리와 문서 역할 분담

**이유**: 같은 규칙이 여러 곳에 반복돼 이미 서로 어긋났다(T2가 그 예). 2026-11-07 grep 결과는 아래와 같다
- "격식체": CLAUDE.md·writing-voice·SKILL·blog-writer 4개 파일
- "원본에 없는": 4개 파일 8회
- "AI 작성 여부 추정 금지": 3개 파일 5회
- "lint 통과 ≠ 문맥 검토": writing-voice·SKILL·blog-writer 3곳. SKILL.md 변환 절차 9단계가 특히 장황하다
- `blog-writer.md`의 "절대 규칙"·"다이어그램" 절은 SKILL.md와 거의 같은 내용이다

**목표 구조**

| 문서 | 담을 것 |
|---|---|
| CLAUDE.md | 매 세션 필요한 최소 규칙과 다른 문서 안내 |
| `docs/writing-voice.md` | 말투·설명 분량·근거 판단 기준 |
| draft-to-post SKILL.md | 변환 절차와 형식 규칙(트랙·front matter·마침표·다이어그램·lint) |
| blog-writer / blog-reviewer | 역할·입출력·보고 형식, 그리고 "위 문서를 읽어라". 규칙 본문은 반복하지 않음 |

**할 일**: T1~T5 결과를 반영한 뒤 한 번에 재배치한다. 고친 다음에는 같은 grep으로 중복이 줄었는지 확인하고 blog-writer로 draft 1편을 시험 변환한다

### T7. 별도 결정 사항 (글쓰기 규칙과 무관)

| 항목 | 현재 상태 | 결정할 것 |
|---|---|---|
| k8s-theory 공개 | `src/lib/post-visibility.mjs`의 `PREVIEW_K8S_THEORY = true`라 목록·검색·sitemap에서 숨김. 게시일 2026-07-24~11-15 | 검토가 끝나면 `false`로 바꿔 공개 |
| 시리즈 카드 | k8s-theory 6개 시리즈가 `src/lib/series.ts`에 미등록 | 홈·`/series` 노출 여부 |
| drawio MCP | `.mcp.json` 경로가 `/Users/ress/...`라 이 머신에서 연결 실패 | 현재 경로로 고칠지, 쓰지 않으면 지울지 |
| lint hook | Claude의 `lint-post` PostToolUse hook이 git 미추적 `.claude/settings.local.json`에만 있음 | 공유 `.claude/settings.json`으로 옮길지 |
