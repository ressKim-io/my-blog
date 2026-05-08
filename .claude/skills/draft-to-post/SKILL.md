---
name: draft-to-post
description: drafts/*.md 원본 로그/ADR을 src/content/{essays|logs}/{category}/*.md 블로그 글로 변환합니다. 트랙·카테고리 디렉토리 결정, 격식체 100%, 이모지 섹션 헤더(🔥🤔✅📚), 분량 가이드, 이미지 힌트를 적용합니다. "draft를 블로그 글로 만들어줘", "이 draft 변환해줘", "게시할 수 있게 정리해줘" 등의 요청에서 사용합니다.
---

# Draft → Blog Post 변환

## 입력/출력

- **입력**: `drafts/<name>.md` (원본 로그/ADR — 보통 반말체·내부 표현·불완전 문장)
- **출력**: `src/content/{track}/{category}/goti-<slug>.md`
- **자산**: `public/diagrams/{slug}-{n}.svg`, `public/images/{file}.png` — **평탄 구조 유지** (디렉토리 분리해도 본문의 `/diagrams/...` 경로 변경 X)

## 트랙·카테고리 결정 (1순위 SSOT)

**디렉토리 위치가 트랙·카테고리의 단일 진실 원천**입니다. frontmatter `type` 필드는 표시 메타로만 쓰이며 트랙 격리에 영향 없음.

**트랙 결정** — 본문 구조로 판단:
- `essays/` — "옵션 비교 → 결정 → 근거" / 회고 / 개념 정리 (다듬은 글)
- `logs/` — "증상 → 원인 → 해결 → 배운 점" / 작업 노트 (트러블슈팅)
- **한 시리즈는 한 트랙으로 통일** (essays/logs 혼합 시 시리즈 navigation이 갈라짐)

**카테고리 6종**: `kubernetes` · `istio` · `challenge` · `monitoring` · `argocd` · `cicd`

frontmatter `category`와 디렉토리 위치가 일치하도록 작성합니다.

## 네이밍

- go-ti 글: `goti-<topic>.md`
- ADR 성격: `goti-adr-<topic>.md` 또는 `goti-<topic>-adr.md`
- 원본의 날짜 접두어(`2026-03-22-`)는 제거 — 파일명이 URL slug

## Front Matter

```yaml
---
title: "명확한 한 줄 제목 — 부제로 포인트 강조"
excerpt: "무엇을 발견했고 어떻게 해결했는지 1~2문장"
category: istio  # kubernetes | istio | challenge | monitoring | argocd | cicd
tags:
  - go-ti        # ← 반드시 첫 번째
  - <기술명1>
  - <기술명2>
series:
  name: "goti-<series-slug>"  # 단독 글이면 series 필드 전체 생략
  order: 1
date: "YYYY-MM-DD"
---
```

- `title` 60자 이내, 포인트가 드러나는 제목
- `excerpt` 1~2문장, 검색·카드 노출용
- `date`는 원본 draft 날짜 우선
- **첫 태그 `go-ti` 절대 규칙** — `/blog?tag=go-ti`로 프로젝트 모아보기. 예외 없음

## 문체 (CLAUDE.md 규칙 그대로)

- 격식체 100% (~합니다 / ~입니다 / ~했습니다)
- 마침표(.) 생략 — URL/버전/소수점/약어 예외, `?`/`!` 유지
- 한 문장 50자 이내 권장
- 모든 코드블록에 언어 명시 (`bash`/`yaml`/`text` 등)

원본이 반말·해요체여도 변환 시 **전부 격식체**로 바꿉니다.

## 섹션 구조

**트러블슈팅(logs)** — 기본 4섹션:

```markdown
## 한 줄 요약
> 무엇을 발견했고 어떻게 해결했는지 1~2문장

## 🔥 문제: <증상 한 줄>
- 기존 아키텍처/기대 동작
- 실제 일어난 일, 에러 메시지/로그

## 🤔 원인: <진짜 원인 한 줄>
- 왜 그렇게 되는지, 내부 동작
- 공식 문서/소스 링크

## ✅ 해결: <어떻게 풀었는지>
- 변경된 설정/코드
- 재현 확인 방법

## 📚 배운 점
- 일반화된 교훈 3~5개
```

**ADR(essays)**: `## 배경 → ## 선택지 → ## 결정 → ## 근거`

## 🧭 선택지 비교 섹션 (조건부)

원본에 다음 **신호** 있을 때만 추가:
- "Option A/B/C", "안1/안2", "~를 고려했으나"
- 도구·아키텍처·기술 스택 선정이 본문 주제

신호 없으면 추가 금지 — **원본에 없는 대안을 만들어내는 건 사실 훼손**입니다. 상세 규칙·구조·체크리스트는 `./decision-tradeoff.md`.

## 표·다이어그램 설명 분량

표/다이어그램 뒤에는 **반드시 상세 설명**. 단순 요약 금지.

| 유형 | 분량 |
|---|---|
| 핵심 개념 비교표 | 3-4 문단 |
| 아키텍처 다이어그램 | 4-6 문단 + 역할 목록 |
| 트래픽 흐름 다이어그램 | 단계별 번호 목록 + 1-2 문단 |
| 기능 지원 현황표 | 지원/미지원 분류 + 2-3 문단 |
| 요약 정리표 | 2-3 문단 |

**설명 7원칙**: ① 문단 분리 ② 구체적 수치·시나리오 ③ 단계별 번호 ④ "왜"를 설명 ⑤ 도입부+마무리 ⑥ 목록 구조 ⑦ 지원·미지원 분류

추상적 설명 대신 구체값. "업그레이드 문제가 있다"가 아니라 "1000개 Pod에서 Rolling Restart 시 수 시간 걸린다".

## 이미지·다이어그램

- 사이즈 힌트(alt 텍스트): `|short`(600px) / 기본(800px) / `|tall`(1100px) / `|xtall`(1600px) / `|auto`
- 다이어그램 텍스트는 영어로 (한글은 폰트 깨짐). 한글 설명은 본문에 별도로
- ASCII 박스/다단계 흐름 금지 — CLAUDE.md "ASCII 박스/다이어그램 정책" 참고

## 시리즈 (반드시 series-plan.md 참조)

`.claude/plans/series-plan.md`가 단일 기준. 추측·즉석 판단 금지.

1. series-plan.md Read
2. draft가 어느 시리즈(S1~S18) 또는 단독 글인지 확인
3. `name`/`order`를 그대로 frontmatter에 기입
4. 단독 글은 `series` 필드 전체 생략 (빈 객체 X)
5. **한 시리즈 = 한 트랙** — 통일 안 되면 시리즈 navigation 분리

series-plan.md에 없는 draft를 만나면 사용자에게 어느 시리즈로 편입할지 확인.

## 변환 절차

1. `drafts/<name>.md` 정독
2. `series-plan.md`로 시리즈/order 확인
3. **트랙·카테고리 결정** (위 가이드)
4. 같은 시리즈의 기존 글 1편 참조 (톤·구조)
5. front matter 작성 + 섹션 구성 + 격식체 변환
6. 코드블록 언어 명시 + 이미지 힌트 + 표·다이어그램 뒤 분량 가이드 적용
7. `src/content/{track}/{category}/goti-<slug>.md`에 Write
8. drafts 원본은 손대지 않음 (참조용 보존). 발행 상태(`_index.md`)는 사용자 배치 처리

## Gotchas

- **디렉토리 = SSOT, frontmatter `type` 명시 불필요**: 트랙 격리는 디렉토리만 본다. `type: troubleshooting`을 적어도 logs로 가지 않음 (위치 우선)
- **시리즈 분리 위험**: ADR + 트러블슈팅이 섞인 시리즈는 한 트랙(보통 logs)으로 통일. 분리 시 시리즈 페이지가 갈라짐
- **자산 경로 변경 금지**: 디렉토리 분리해도 본문의 `![](/diagrams/foo-1.svg)`·`/images/...`는 그대로
- **slug 충돌**: 트랙/카테고리 디렉토리가 달라도 파일명(slug)은 전역 유일. URL 충돌
- **drafts 원본 손대지 않음**: 변환 후에도 보존
- **첫 태그 `go-ti`**: 첫 번째가 아니면 `/blog?tag=go-ti`에서 누락

## 안 되는 것

- 원본에 없는 사실(성능 수치·추가 맥락) 지어내기
- 실명·민감 고유명사 노출 (이니셜·역할명으로 익명화)
- 이모지 섹션 헤더 외의 장식 이모지
- 긴 서론·결론

## 참고 자료

- 시리즈 단일 기준: `.claude/plans/series-plan.md`
- drafts 인덱스: `drafts/_index.md`
- 좋은 변환 예시(ADR/essays): `src/content/essays/argocd/goti-container-image-update-strategy-adr.md`
- 좋은 변환 예시(트러블슈팅/logs): `src/content/logs/monitoring/goti-mimir-ingester-oom-webhook-deadlock.md`
- 다이어그램 스타일: `.claude/Draw-io-*.md`, `.claude/plans/diagram-conversion/best-practices.md`
- 코어 규칙: `CLAUDE.md` (블로그 글 작성 핵심 규칙 / ASCII 정책)
