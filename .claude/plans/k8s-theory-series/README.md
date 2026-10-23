# ☸️ k8s-theory 시리즈 — 진입점

**새 세션은 이 파일부터 읽는다.**

---

## 한 줄 요약

Obsidian vault의 Kubernetes 이론 노트를 **한 번에 3편씩** 한국어 `essays` 글로 변환한다
**2026-10-23 Batch 16까지 56편 검수 완료. 이번 요청 30/30편, 보류 0편**
로컬 콘텐츠 등록·정적 빌드·커밋까지 마쳤다. 공개 사이트 반영과 k8s-theory 시리즈의 전용 카드 등록은 별도 상태이며 [등록 점검 기록](plan.md#커밋등록-점검--2026-10-23)을 참고한다
사용자가 3편씩 10개 배치, 총 30편과 작성자·독립 검수자 분담 및 검증 후 커밋을 요청했다. 기존 5편 단위 규칙은 이 요청으로 대체한다
2026-10-21에 확인한 원본 파일은 71개다. 9월 조사 당시의 50편 목록은 과거 기록으로 보존한다

---

## 원본 위치

```text
/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/
```

위는 현재 확인한 로컬 경로다. 환경이 바뀌면 Obsidian 설정이나 `obsidian-work-vault` 스킬에서 실제 Vault 위치를 확인한다
Vault는 읽기 전용으로 사용하고 블로그 저장소에 결과를 쓴다

파일명에 이모지·중점(`·`)·공백이 섞여 있어 셸에서 **반드시 따옴표로 감싼다.**

vault의 다른 참고 파일 (같은 `☸️ k8s-theory/` 아래).

| 파일 | 쓸모 |
|---|---|
| `☸️ progress.md` | 원본의 현재 진행·미완 항목·「확인 못 함」 목록 |
| `☸️ 문서 형식.md` | 노트 작성 규칙. 최신 저장본을 확인 |
| `☸️ LAB TODO.md` | 실습 계획. 목록에 있다는 이유로 실행한 경험으로 쓰지 않음 |
| `2026-10-05 세부 학습 글 편집 계획과 인계.md` | 독자 관점 편집 기준과 원본 검수 이력. 블로그 진행 상태와 구분 |
| `☸️ glossary.md` · `glossary · A~E` | 용어 사전 (항목당 5줄 상한) |
| `☸️ source-map.md` · `source-map · Phase 1~5` | `[S]` 소스 경로 누적 지도 |
| `☸️ concept-map.md` · `concept-map · Phase 1~5` | 용어 간 관계도 |

---

## 읽는 순서

| 순서 | 파일 | 내용 |
|---|---|---|
| 1 | [AGENTS.md](../../../AGENTS.md) · [CLAUDE.md](../../../CLAUDE.md) · [공통 말투 기준](../../../docs/writing-voice.md) | Codex·Claude 공통 작성·검토 기준 |
| 2 | 사용하는 도구의 `draft-to-post` 스킬 | 아래 저장소 참고의 진입점 사용 |
| 3 | [plan.md](plan.md) | 말투 적용 · 3편 단위 절차 · 모델 참고 · 다음 배치와 진행 기록 |
| 4 | [source-format.md](source-format.md) | 학습 노트를 블로그 해설로 재구성하는 기준 |
| 5 | [inventory.md](inventory.md) | **2026-09-08 당시** 50편 목록과 재산출 방법. 현재 목록으로 취급하지 않음 |

---

## 반드시 먼저 알아야 할 것 3가지

### 1. 이 노트들은 실습 기록이 아니다

소스와 공식 문서를 읽고 정리한 이론 해설이다
9월 조사 당시 LAB TODO 478건은 미실행이었다. 현재 첫 3편에도 `release-1.35` 소스 링크가 남아 있다
대상 노트의 최신 상태와 실제 근거 버전은 각 배치에서 확인한다

품질이 높아 실무 기록처럼 읽히기 쉬운 게 위험 지점이다.
**"관찰했습니다 / 재현했습니다"를 붙이면 없는 경험이 생긴다.**

### 2. 원본이 아직 자라는 중이다

2026-10-21에 실제 Markdown 파일 71개를 확인했다
9월의 50편 목록이나 10월 5일의 69편 기록과 다르다
대상 3편의 최신 파일명·본문을 읽고 원본 hash를 남긴다. 과거 줄 수나 검수 판정을 그대로 옮기지 않는다

### 3. 말투와 사실을 따로 검수한다

원본의 질문·설명 이유는 살리고 과장·직역·반복 안내는 줄인다
자연스럽게 고친 문장도 원본 의미·조건·출처와 대조한다
문단·SVG 개수를 채우거나 원본에 없는 실패담을 만들지 않는다
자동 lint는 형식 검사이므로 이 검토를 대신하지 못한다

---

## 다음에 할 일

**이번 요청 10개 배치·30편 검수와 로컬 커밋 완료**

다음 미착수 3편은 Phase 4-4·4-5·4-6이다. 추가 변환은 다음 요청에서 진행한다

예정 slug·series/order·이후 배치 전체는 [plan.md 연속 변환 진행표](plan.md#2026-10-23-연속-변환--batch-0716)를 따른다
매 배치 blog-writer 3명 분담 → 별도 blog-reviewer 검수 → 수정 → lint·build·정적 출력 검증 → 로컬 커밋 후 다음 3편으로 넘어간다
보류 이유·미실행 검증을 기록하고 실패한 글은 완료 편수에 포함하지 않는다
push·배포·시리즈 카드 등록은 별도 요청으로 진행한다

### 이번 요청 진행표

| 배치 | 좌표 | 상태 | 검증·근거 기록 | 콘텐츠 커밋 | 다음 대상 |
|---|---|---|---|---|---|
| 07 | 2-4, 2-5, 2-6 | 검수 완료 | post lint 0/3, lint 0/1, build 586·export 통과; [근거·검수](batches/batch-07.md) | `cc7ff41` | 2-7, 2-8.1, 2-8.2 |
| 08 | 2-7, 2-8.1, 2-8.2 | 검수 완료 | post lint 0/3, lint 0/1, build 592·export 통과; [근거·검수](batches/batch-08.md) | `4db7801` | 2-9, 2-10, 2-11 |
| 09 | 2-9, 2-10, 2-11 | 검수 완료 | post lint 0/3, lint 0/1, build 598·export 통과; [근거·검수](batches/batch-09.md) | `fbcd25e` | 2-12, 2-13, 2-14 |
| 10 | 2-12, 2-13, 2-14 | 검수 완료 | post lint 0/3, lint 0/1, build 604·export 통과; [근거·검수](batches/batch-10.md) | `2167f11` | 2-15, 2-16, 2-17 |
| 11 | 2-15, 2-16, 2-17 | 검수 완료 | post lint 0/3, lint 0/1, build 610·export 통과; [근거·검수](batches/batch-11.md) | `31c4495` | 2-18, 3-1, 3-2.1 |
| 12 | 2-18, 3-1, 3-2.1 | 검수 완료 | post lint 0/3, lint 0/1, build 616·export 통과; [근거·검수](batches/batch-12.md) | `3c62d6a` | 3-2.2, 3-3, 3-4 |
| 13 | 3-2.2, 3-3, 3-4 | 검수 완료 | post lint 0/3, lint 0/1, build 622·export 통과; [근거·검수](batches/batch-13.md) | `a999ddc` | 3-5, 3-6, 3-7 |
| 14 | 3-5, 3-6, 3-7 | 검수 완료 | post lint 0/3, lint 0/1, build 628·export 통과; [근거·검수](batches/batch-14.md) | `36b28e6` | 3-8, 3-9, 3-10 |
| 15 | 3-8, 3-9, 3-10 | 검수 완료 | post lint 0/3, lint 0/1, build 634·export 통과; [근거·검수](batches/batch-15.md) | `28a9375` | 4-1, 4-2, 4-3 |
| 16 | 4-1, 4-2, 4-3 | 검수 완료 | post lint 0/4, lint 0/1, build 640·export 통과; [근거·검수](batches/batch-16.md) | `c5f8353` | 4-4, 4-5, 4-6 |

---

## 저장소 쪽 참고

| 경로 | 쓸모 |
|---|---|
| [docs/writing-voice.md](../../../docs/writing-voice.md) | 공통 말투·편집·검토 기준. 과거 plan의 문체 예시보다 우선 |
| [Codex draft-to-post](../../../.agents/skills/draft-to-post/SKILL.md) | Codex용 스킬 진입점 |
| [Claude draft-to-post](../../skills/draft-to-post/SKILL.md) | 공통 변환 절차 상세 |
| [SVG 가이드](../diagram-conversion/best-practices.md) | §1(색상) · §11(패턴 9종) |
| `scripts/lint-post.mjs` | `npm run lint:post -- <file>` |
| `src/content/essays/kubernetes/cloud-virtualization-double-tax.md` | 근거 등급 고지 블록의 선례 |
| `src/content/essays/rust/` | 같은 vault에서 변환한 선행 사례 (CS레이어 7편) |
