---
name: draft-to-post
description: drafts/*.md 원본 로그/ADR을 src/content/*.md 블로그 글로 변환합니다. 격식체(~합니다/~입니다) 100%, 이모지 섹션 헤더(🔥🤔✅📚), 문단 분리, 설명 분량 가이드, 이미지 힌트를 적용합니다. "draft를 블로그 글로 만들어줘", "이 draft 변환해줘", "게시할 수 있게 정리해줘" 등의 요청에서 사용합니다.
---

# Draft → Blog Post 변환 가이드

이 skill은 `drafts/*.md` 파일(트러블슈팅 로그, ADR, dev-log 스냅샷)을 `src/content/*.md` 블로그 글로 변환하는 절차입니다.

## 입력/출력

- **입력**: `drafts/<name>.md` (원본 로그/ADR, 보통 내부 표현·반말체·불완전한 문장)
- **출력**: `src/content/goti-<slug>.md` (격식체, 이모지 섹션, 읽기 좋은 분량)
- **이미지 재사용**: 원본에 이미지 경로가 있으면 그대로 사용. 새 다이어그램은 `docs/drawio/` → `public/images/` PNG.

## 네이밍 규칙

- go-ti 프로젝트 유래의 글은 **`goti-` prefix**를 붙여 구분합니다. 예: `2026-03-23-mimir-ingester-oom-webhook-deadlock.md` → `goti-mimir-ingester-oom-webhook-deadlock.md`.
- 날짜 접두어는 slug에서 제거합니다. 파일명이 URL slug가 되므로 날짜는 불필요합니다.
- ADR은 `goti-adr-<topic>.md` 형태로, 트러블슈팅은 `goti-<topic>.md`로 저장합니다.

## Front Matter 필수 형식

```yaml
---
title: "명확한 한 줄 제목 — 부제로 포인트 강조"
excerpt: "무엇을 발견했고 어떻게 해결했는지 1~2문장"
category: istio  # istio | kubernetes | challenge | argocd | monitoring | cicd
tags:
  - go-ti        # ← 반드시 첫 번째 (프로젝트 모으기용)
  - <기술명1>
  - <기술명2>
series:
  name: "goti-<series-slug>"  # 시리즈면 포함, 단독글이면 전체 생략
  order: 1
date: "YYYY-MM-DD"
---
```

- `title`은 60자 이내, **포인트를 드러내는 제목**이 좋습니다. 예: "CloudFront에서 Cloudflare로 — CDN 전환을 결정한 이유".
- `excerpt`는 1~2문장, 검색/카드 노출용.
- `category`는 CLAUDE.md에 정의된 6개 중 하나만 사용.
- `date`는 원본 draft의 날짜를 기본으로 사용. 작성일과 다를 때는 draft 날짜 우선.

### 절대 규칙: `go-ti` 태그 (프로젝트 모으기)

이 블로그의 goti-* 글은 모두 **go-ti 프로젝트 실전 기록**입니다. 블로그 이용자가 `/blog?tag=go-ti`로 한 번에 모아볼 수 있도록, **모든 goti 글의 `tags` 배열 첫 번째는 반드시 `go-ti`**입니다. 예외 없음.

```yaml
# ✅ 올바름
tags:
  - go-ti
  - Redis
  - Ticketing

# ❌ 틀림 (go-ti가 없거나 뒤에 있음)
tags:
  - Redis
  - go-ti
  - Ticketing
```

ADR 글도 동일합니다. 첫 번째 `go-ti`, 그 다음이 `Architecture Decision Record`·기술 태그 순.

## 문체 규칙 (절대 규칙)

```
[MUST] 격식체 100%: ~합니다, ~입니다, ~했습니다
[MUST] 한 문장 50자 이내 권장, 간결하게
[MUST] 모든 코드 블록에 언어 명시: ```bash, ```yaml, ```java, ```sql 등
[NEVER] 해요체: ~해요, ~했어요, ~돼요
[NEVER] 반말체: ~한다, ~했다, ~이다
[NEVER] 요청 없이 장황한 서론/결론
```

원본 draft가 반말/해요체여도 변환 시 **전부 격식체**로 바꿉니다.

## 섹션 구조 (권장)

트러블슈팅 글은 다음 흐름이 기본입니다:

```markdown
## 한 줄 요약

> 무엇을 발견했고 어떻게 해결했는지 1~2문장.

---

## 🔥 문제: <증상을 한 줄로>

### 기존 아키텍처 / 기대 동작

- 원래 어떻게 돌아가야 했는지

### 발견한 문제

- 실제로 무슨 일이 벌어졌는지, 에러 메시지/로그 포함

---

## 🤔 원인: <한 줄로 진짜 원인>

- 왜 그렇게 되는지, 내부 동작 설명
- 공식 문서/소스 링크가 있으면 포함

---

## ✅ 해결: <어떻게 풀었는지>

- 변경된 설정/코드
- 재현 확인 방법

---

## 📚 배운 점

- 반복 방지용 일반화된 교훈 (3~5개 bullet)
```

ADR 성격의 글은 `🔥 문제` 대신 `## 배경`, `## 선택지 비교`, `## 결정`, `## 근거` 구조를 씁니다.

## 설명 분량 가이드 (중요)

표/다이어그램 **뒤에는 반드시 상세한 설명**을 붙입니다. 단순 요약 금지.

| 표/다이어그램 유형 | 권장 설명 분량 |
|-------------------|---------------|
| 핵심 개념 비교표 | 3-4 문단 |
| 아키텍처 다이어그램 | 4-6 문단 + 역할 목록 |
| 트래픽 흐름 다이어그램 | 단계별 번호 목록 + 1-2 문단 |
| 기능 지원 현황표 | 지원/미지원 분류 + 2-3 문단 |
| 요약 정리표 | 2-3 문단 (마무리) |

### 설명 작성 7원칙

1. **문단 나누기**: 한 줄에 다 쓰지 말고 개념별로 문단 분리.
2. **구체적 수치/시나리오**: "업그레이드 문제가 있다" 대신 "1000개 Pod에서 Rolling Restart로 수 시간 걸린다".
3. **단계별 흐름 설명**: 복잡한 프로세스는 번호 목록.
4. **"왜"를 설명**: "Rust로 작성됐다"가 아니라 "Envoy C++는 최적화됐지만 메모리가 많이 드는데 Rust는 더 적게 쓴다".
5. **도입부+마무리**: "트래픽 흐름을 따라가보겠습니다." / "이것이 Ambient가 효율적인 이유입니다."
6. **목록 구조**: 기능/역할 설명은 bullet.
7. **지원/미지원 분류**: 기능 비교표 아래는 "완전히 지원" / "아직 미지원"으로 명확히 나눔.

## 코드 블록 규칙

```
[MUST] 언어 명시: ```yaml, ```bash, ```python, ```java
[MUST] 핵심 포인트는 코드 주석으로
[SHOULD] 실행 결과는 별도 블록
[SHOULD] $ prompt 포함 (bash 실행 결과)
```

예시:

````markdown
```bash
$ kubectl get pods
NAME                     READY   STATUS    RESTARTS   AGE
myapp-5d8c7b8d9f-abc12   1/1     Running   0          5m
```
````

## 이미지 사이즈 힌트

alt 텍스트에 힌트를 넣어 높이를 조절합니다.

```markdown
![설명](/images/foo.png)           # 기본 (max-height: 800px)
![설명|short](/images/foo.png)     # 작은 이미지 (max-height: 600px)
![설명|tall](/images/foo.png)      # 세로로 긴 이미지 (max-height: 1100px)
![설명|xtall](/images/foo.png)     # 매우 세로로 긴 이미지 (max-height: 1600px)
![설명|auto](/images/foo.png)      # 제한 없음
```

다이어그램은 거의 `tall` 또는 기본. 전체 시스템 아키텍처는 `xtall`.

## 다이어그램 워크플로우

새 다이어그램이 필요하면:

1. Draw.io MCP로 `.drawio` 파일 생성 → `docs/drawio/` 저장
2. 사용자 검토/수정
3. PNG로 내보내기 → `public/images/` 저장
4. 블로그 글에서 `![설명](/images/name.png)` 참조

**다이어그램 안의 텍스트는 반드시 영어**로 작성합니다. 한글은 폰트 문제로 깨집니다. 설명은 이미지 아래 본문에 한글로 자세히 씁니다. 상세 스타일은 `.claude/Draw-io-*.md` 참조.

## 시리즈 판단 (중요 — 반드시 series-plan.md 참조)

시리즈 소속·slug·order는 `.claude/plans/series-plan.md`가 **단일 기준**입니다. 추측·즉석 판단 금지. 변환 전 반드시:

1. `.claude/plans/series-plan.md`를 Read로 확인
2. 해당 draft가 어느 시리즈(S1~S18) 또는 "단독 글"에 있는지 확인
3. series-plan.md의 `name`과 `order`를 그대로 front matter에 기입

**규칙:**

- 시리즈 slug는 `goti-<topic>` 형태(예: `goti-redis-sot`, `goti-multicloud`, `goti-queue-poc`).
- series-plan.md에 정의된 `order` 번호를 **재할당하지 않습니다**. 나중에 편이 추가되어도 기존 order는 유지.
- 단독 글은 `series` 필드 자체를 **생략**합니다. 빈 객체(`series: {}`)로 두지 않습니다.
- series-plan.md에 없는 draft를 만나면 → 사용자에게 어느 시리즈로 편입할지 확인합니다.

**기존 시리즈 (이미 변환 완료, 재변환 금지):**

- `goti-cloudflare-migration` (2편)
- `goti-observability-stack` (5편)
- `goti-metrics-collector` (2편)

## 변환 절차 (체크리스트)

1. **원본 읽기**: `drafts/<name>.md` 전체 정독.
2. **시리즈 확인**: `drafts/_index.md`에서 해당 draft의 시리즈 소속 확인.
3. **기존 변환글 참조**: `src/content/goti-*.md` 중 유사 글 1~2개 읽고 톤·구조 맞추기.
4. **front matter 작성**: title/excerpt/category/tags/date/series 채움.
5. **섹션 구성**: 한 줄 요약 → 🔥 문제 → 🤔 원인 → ✅ 해결 → 📚 배운 점.
6. **격식체 변환**: 반말/해요체를 전부 ~합니다/~입니다로.
7. **설명 붙이기**: 표/다이어그램/코드 뒤에 상세 문단 (위의 7원칙).
8. **코드 블록 언어 명시**: 모든 ``` 뒤에 언어.
9. **이미지 힌트**: alt 텍스트에 사이즈 힌트.
10. **저장**: `src/content/goti-<slug>.md`에 Write.
11. **drafts 원본 처리**: 원본 draft는 **삭제하지 않음** (참조용). 발행 완료는 `_index.md`에서 `⬜`→`✅` 업데이트 (이건 사용자가 배치로 하는 경우가 많음).

## 안 되는 것

- 원본에 없는 사실을 지어내지 않습니다. 원본 로그/코드만 근거.
- 원본이 비어있거나 사실 관계가 불명확하면 사용자에게 확인합니다.
- 실명·민감 정보는 자동으로 익명화(이니셜 또는 역할명).
- 이모지 섹션 헤더 외의 장식 이모지는 쓰지 않습니다.

## 참고 자료

- **시리즈 플랜(단일 기준)**: `.claude/plans/series-plan.md` — 모든 미변환 draft의 시리즈/order 매핑
- 프로젝트 규칙 원본: `CLAUDE.md` (Blog Content Stats, 블로그 글 작성 지침서)
- drafts 전체 인덱스(원본 소스): `drafts/_index.md`
- 좋은 변환 예시: `src/content/goti-cloudflare-migration-adr.md`, `src/content/goti-mimir-ingester-oom-webhook-deadlock.md`
- 다이어그램 스타일: `.claude/Draw-io-*.md`
