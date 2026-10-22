# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Design Change Rule

**디자인/레이아웃 변경 시 반드시 ASCII 목업을 먼저 보여주고 사용자 승인 후 코드를 작성한다.**

1. 변경할 레이아웃을 ASCII art로 시각화
2. 여러 안이 있으면 각각 ASCII로 비교
3. 사용자가 선택/승인하면 그때 코드 작성
4. 사소한 색상/간격 조정은 예외 (바로 적용 가능)

## Project Overview

Next.js 기반 개인 기술 블로그입니다. DevOps 학습 경험(Kubernetes, AWS, Terraform, Istio, CI/CD)을 기록합니다. 콘텐츠는 한국어로 작성됩니다.

## Tech Stack

- **Framework**: Next.js 16.1.1 (App Router)
- **Styling**: Tailwind CSS 4
- **Content**: MDX (next-mdx-remote)
- **Search**: Fuse.js (client-side fuzzy search)
- **Deployment**: GitHub Pages via GitHub Actions

## Development Commands

```bash
npm install        # Install dependencies
npm run dev        # Development server (http://localhost:3000)
npm run build      # Production build (static export)
npm run lint       # ESLint
```

## Architecture

### Content Flow
1. MDX posts in `src/content/{essays|logs}/{category}/*.md` → parsed by `gray-matter` → rendered via `next-mdx-remote/rsc`
2. `src/lib/posts.ts` provides `getAllPosts()`, `getPostBySlug()`, `getSeriesPosts()`, `extractHeadings()`
3. Static generation: `generateStaticParams()` in `[slug]/page.tsx` creates all post pages at build time
4. **디렉토리 위치가 track·category의 1순위 SSOT**입니다. `src/content/essays/{cat}/{slug}.md`는 essays 트랙, `src/content/logs/{cat}/{slug}.md`는 logs 트랙. URL은 `/essays/{slug}` · `/logs/{slug}` 그대로 (디렉토리는 분류용, 파일명만 slug)

### Key Directories
- `src/content/{track}/{category}/` - MDX blog posts. track ∈ {essays, logs}, category ∈ {kubernetes, istio, challenge, monitoring, argocd, cicd}
- `src/lib/posts.ts` - Post utilities (재귀 readdir + slug→경로 인덱스 캐시)
- `src/lib/series.ts` - 7개 deepdive 해설 시리즈 메타·집계 (`getAllSeries`/`getSeriesById`)
- `src/components/MDXComponents.tsx` - Custom MDX rendering (code blocks, tables, headings with anchors)
- `src/app/series/` - 시리즈 인덱스(`/series`)·상세(`/series/[id]`) 라우트
- `public/images/`, `public/diagrams/` - Blog post images (글 슬러그 1:1, 평탄 구조 유지)
- `docs/drawio/` - Draw.io diagram source files

### Static Export
- `next.config.ts`: `output: 'export'` for GitHub Pages
- Production uses `/my-blog` base path; development uses root

### Homepage & Series

- 홈(`src/app/page.tsx`)은 **시리즈 쇼케이스 + 카테고리 탭 피드** 구조. 7개 기술 해설(deepdive)
  시리즈를 첫 화면에서 1클릭 거리로 노출한다
- `src/lib/series.ts`가 7개 deepdive 시리즈(`goti-deepdive-*`)를 정의 — `id`(URL 슬러그)·표시명·
  소개문. `getAllSeries`/`getSeriesById`/`pickFeatured`로 집계
- `/series` 인덱스, `/series/[id]` 상세 라우트. 컴포넌트: `SeriesCard`·`SeriesFeaturedCard`·
  `SeriesShowcase`·`SeriesRailMobile`(모바일 가로 레일)·`HomeCategoryFeed`(클라이언트 탭 피드)
- 시리즈 `id`는 `series.name`에서 `goti-deepdive-` 접두사를 뗀 값 — sitemap `/series/{id}/`는 `postbuild.mjs`가 콘텐츠에서 자동 도출

### RSC 페이로드 — content 경량화

클라이언트 컴포넌트(`'use client'`)에 글 객체를 넘길 때 **본문(`content`)을 포함하면 안 된다** —
RSC payload에 전 글 본문이 직렬화돼 페이지가 비대해진다. `posts.ts`의 경량 변환을 사용한다:

- `getSearchIndex()` → `SearchPost[]` — 헤더 검색용 (essays만, content 제외)
- `getEssaysList()` → `PostListItem[]` — 글 목록용 (content만 제외)
- `toListItem(post)` — `PostData` → `PostListItem` 변환 헬퍼
- 서버 컴포넌트끼리는 `PostData`(content 포함) 그대로 전달해도 무방

### Link 컴포넌트 정책

**`next/link`를 직접 import하지 말고 `@/components/Link` 래퍼를 사용합니다.**

- 위치: `src/components/Link.tsx`
- 정책: prefetch 기본값을 `false`로 뒤집음 (Next.js 16의 `'auto'` 기본값은 viewport에 들어오는 모든 Link의 RSC payload를 동시 prefetch해서 글 카드 200+ 목록에서 동시 연결 한계 초과 → `__next._tree.txt` (pending) 폭주 → 사이트 멈춤)
- 정적 export라 클릭 시 RSC payload fetch가 충분히 빠르므로 prefetch 비용 거의 없음
- 특정 위치에서 prefetch가 필요하면 `<Link prefetch={true}>`로 명시적 opt-in

### logs 트랙 격리 정책

logs 트랙(트러블슈팅 거친 노트)은 **URL을 직접 알아야만 접근 가능한 상태**로 운영합니다. 거친 작업 노트라 일반 방문자에게 노출 의도가 낮기 때문입니다.

- **헤더 메뉴 제외**: `src/components/Header.tsx`의 `navItems`에 `/logs` 없음. 메뉴에서 진입 불가
- **검색 제외**: `Header`에서 Search에 넘기기 전에 `track !== 'logs'` 필터링
- **`/logs/` 인덱스 페이지 부재**: `src/app/logs/page.tsx` 자체가 없어서 `/logs/`는 404. 목록 자체가 노출되지 않음
- **sitemap.xml 제외**: `scripts/postbuild.mjs`의 `generateSitemap`이 logs 트랙을 빼고 정적 페이지에서도 `/logs/` 제거
- **RSS 제외**: `feed.xml`은 essays만 포함
- **llms.txt 제외**: AI/LLM 인덱스에서도 essays만 노출, "## Logs" 섹션 자체 제거
- **개별 URL은 살아있음**: `/logs/{slug}/` 페이지는 빌드되어 직접 입력하면 정상 표시. 인덱스만 부재
- **트랙 분류 SSOT는 디렉토리**: `src/content/logs/{cat}/`에 위치한 글은 무조건 logs. `inferType` 추론은 표시 메타로만 잔존

격리 강화가 더 필요하면 `/logs/{slug}/` 페이지에 `robots: { index: false }` 추가(검색엔진 차단)도 고려 가능합니다.

<!-- STATS:START -->
<!-- 자동 생성: scripts/update-stats.mjs (prebuild 훅), 수동 편집 금지 -->
## Blog Content Stats (2026-05-01 기준, 자동 생성)

- **총 글 수**: 224개 (go-ti 프로젝트 실전 기록 132편 포함)
- **카테고리 (6개)**:
  - `challenge` (73): 게임서버/POC/부하테스트/AI 워크플로우 경험 시리즈
  - `kubernetes` (46): K8s 기본, EKS, Helm, KEDA, Karpenter, 스케일링
  - `monitoring` (46): Prometheus, OpenTelemetry, Grafana, Loki, Tempo, Mimir
  - `istio` (34): Service Mesh, Traffic/Security/Observability/Ambient, JWT
  - `argocd` (14): ArgoCD, SSA, ApplicationSet
  - `cicd` (11): CI/CD, ArgoCD GitOps, EC2 CD 파이프라인
- **유형 메타 태그**: `troubleshooting` (95) / `adr` (33) / `concept` (23) / `retrospective` (9)
  - `/blog?tag=adr` — 의사결정 서사 글만 모아보기
  - `/blog?tag=troubleshooting` — 단순 트러블슈팅 모아보기
  - `/blog?tag=concept` — 개념·학습 글
  - `/blog?tag=retrospective` — 메타 회고
- **태그**: 고유 태그 419개 (유형 메타 태그 4종 포함)
- **주요 시리즈** (편수 순):
  - go-ti 프로젝트 (27개 시리즈): goti-observability-ops (15), goti-multicloud (11), goti-queue-poc (11), goti-auth (7), goti-multicloud-db (7), goti-redis-sot (7), goti-java-to-go (6), goti-argocd (5), goti-ec2-deploy (5), goti-meta (5), goti-observability-stack (5), goti-resale (5), goti-ticketing-phase (5), goti-otel-prometheus (4), goti-scaling (4), goti-cloudfront-alb (3), goti-eks (3), goti-istio-ops (3), goti-kafka (3), goti-kind-monitoring (3), goti-loadtest (3), goti-ai-review-comparison (2), goti-argocd-gitops (2), goti-cloudflare-migration (2), goti-metrics-collector (2), goti-pgbouncer (2), goti-spring-otel (2)
  - 기존 시리즈 (13개): eks-troubleshooting (9), game-server (7), istio-ambient (7), argocd-troubleshooting (5), challenge-2-wealist-migration (5), istio-traffic (5), istio-observability (4), istio-security (4), istio-intro (3), queue-poc-loadtest (3), eks-security (2), observability (2), eks-infra (1)
- **월별 분포**: 2025-10: 15 / 2025-11: 1 / 2025-12: 33 / 2026-01: 9 / 2026-02: 29 / 2026-03: 59 / 2026-04: 78
- **go-ti 태그 필터**: 모든 goti 글은 `tags[0] == "go-ti"`로 `/blog?tag=go-ti` 한 번에 조회 가능
<!-- STATS:END -->

## Content (Blog Posts)

### Front Matter Format

```yaml
---
title: "Post Title"
excerpt: "Brief description"
category: "kubernetes"  # istio, kubernetes, challenge, argocd, monitoring, cicd
tags: ["tag1", "tag2"]
series:
  name: "series-name"
  order: 1
date: "2025-01-01"
---
```

### Adding New Posts

1. Create `.md` file in `src/content/` (filename becomes URL slug)
2. Add front matter with required fields
3. For series posts, include `series.name` and `series.order`
4. Images go in `public/images/`

### Diagram Workflow

다이어그램 작성 옵션이 두 가지 있습니다. 글의 성격과 다이어그램 복잡도에 따라 선택합니다.

**옵션 1 — SVG 직접 작성 (기본)**

```
ASCII 박스/흐름 패턴이 떠오르면 → SVG로 작성 → public/diagrams/{slug}-{n}.svg
→ 본문에서 ![설명](/diagrams/{slug}-{n}.svg) 참조
```

라이트 테마 + Cocoon 의미론적 6색 매핑(emerald/cyan/violet/amber/rose/slate)을 그대로 사용합니다. 한글 라벨이 가능하고, viewBox 기반 반응형이라 모바일에서도 가독성을 유지합니다.

**상세 가이드**: `.claude/plans/diagram-conversion/best-practices.md` (1.1) — 색상 토큰·접근성 메타·실작업 패턴 9종(사이클/데드락/워터폴/UI 모킹 처리/ADR Before-After/카테고리·시리즈 중복/트리 정책/SVG 작성 주의/평탄화 우선순위)

**옵션 2 — Draw.io (복잡 아키텍처)**

```
Draw.io MCP → .drawio 파일 생성 (docs/drawio/)
→ 사용자 수정/검토 → PNG 내보내기 (public/images/)
→ 블로그 글에서 사용
```

**Draw.io는 다이어그램 텍스트를 반드시 영어로 작성합니다.** 한글은 폰트 문제로 깨질 수 있습니다.

상세 스타일 가이드: `.claude/Draw-io-*.md` 참조

### Image Size Hints

이미지의 높이를 조절하려면 alt 텍스트에 사이즈 힌트를 추가합니다.

```markdown
![설명](/image.png)           # 기본 (max-height: 800px)
![설명|short](/image.png)     # 작은 이미지 (max-height: 600px)
![설명|tall](/image.png)      # 세로로 긴 이미지 (max-height: 1100px)
![설명|xtall](/image.png)     # 매우 세로로 긴 이미지 (max-height: 1600px)
![설명|auto](/image.png)      # 제한 없음 (원본 크기)
```

## Theme System

- Toggle via `data-theme` attribute on `<html>` (light/dark)
- CSS variables in `globals.css`: `--bg-primary`, `--bg-secondary`, `--text-primary`, `--accent`, `--border`
- Theme script in `layout.tsx` prevents FOUC by setting theme before render

---

# 블로그 글 작성 지침서

> 글을 작성·변환·검토하기 전에 [공통 말투·편집 기준](docs/writing-voice.md)을 반드시 읽습니다
> Codex와 Claude가 같은 기준을 사용합니다. 문체·설명 분량은 이 공통 문서를 기준으로 판단하며, 예전 시리즈의 문체 예시를 그대로 모방하지 않습니다
> draft 변환은 `.agents/skills/draft-to-post/SKILL.md`에서 시작합니다

## 글쓴이의 말투 보존

- 원본의 상황·의문·확인 결과·판단이 바뀐 이유를 연결합니다. `저는`, `저희는`, 당시 제약을 격식체 변환 중 지우지 않습니다
- `~하다 보니`, `~해봤습니다`, `그래서 바꿨습니다`처럼 평범한 말과 행동 중심 표현을 사용합니다. 모든 글에 같은 서사를 강제하지 않습니다
- 원본에 없는 경험·감정·실패·대안·수치를 만들지 않습니다. 개념 해설에 개인 경험을 억지로 넣지 않습니다
- 과장·직역·근거 없는 단정·반복 안내·설명 없는 내부 식별자를 점검합니다. 상세 판단 기준과 예시는 공통 문서에 둡니다
- 표 아래 문단 수나 상투적인 도입·마무리를 강제하지 않습니다. 이미 설명한 내용은 반복하지 않습니다
- 검토는 원문·문제 이유·최소 수정안을 제시합니다. 문장만으로 AI 작성 여부를 판정하지 않습니다

## 목적

- 기술 블로그 글 (개인 블로그, 팀 블로그, Medium, velog 등)
- 학습 내용 정리, 트러블슈팅 기록, 튜토리얼 작성

## 규칙

### 기본 어조

```
[MUST] 본문 서술은 격식체: ~합니다, ~입니다, ~했습니다 — 원본의 짧은 독백·질문은 인용으로 보존 가능
[MUST] 문장·문단·bullet 끝 마침표(.) 생략 — URL/버전/소수점/약어/코드블록 내부는 예외, ?/! 유지
[MUST] 신규 글의 헤더는 텍스트로 작성 — 레거시 이모지 형식은 요청 없이 소급 수정하지 않음
[NEVER] 해요체 (~해요, ~했어요, ~돼요)
[NEVER] 반말체 (~한다, ~했다, ~이다)
```

**격식체로 판단 과정을 보존하는 예시:**

```text
처음에는 dev와 prod만 나누려고 했습니다
그런데 작업하다 보니 EC2에서 개발 테스트를 할 환경도 필요했습니다
그래서 ec2-dev를 따로 나눴습니다
```

이런 경험이 원본에 있을 때만 사용할 수 있는 예시입니다

### 문체

```
[SHOULD] 간결한 문장 (50자는 참고치, 길이만 맞추려고 이유·조건을 잘라내지 않음)
[MUST] 문장·문단·bullet 끝 마침표(.) 생략 (한국어 블로그 관행, ?/! 유지)
[MUST] 모든 코드 블록에 언어 명시 (```bash, ```yaml 등)
[SHOULD] 기술 용어는 첫 등장 시 간단히 설명
[NEVER] "~해요", "~했어요" 해요체 사용
[NEVER] "~한다", "~했다", "~이다" 반말체 사용
[NEVER] 불필요한 영어 표현 남발
[NEVER] 요청 없이 장황한 서론/결론
```

### 어휘 (직역체 회피)

영어를 그대로 옮긴 듯한 단어는 자연스러운 한국어로 바꿉니다. 의미가 모호하면 더 평이한 표현을 우선합니다.

| 직역체 | 자연스러운 한글 |
|---|---|
| 근본 원인 감사 | 근본 원인 분석 |
| 전수 감사 | 전수 점검 |
| 감사 결과 | 분석 결과 |
| 감사 스크립트 | 점검 스크립트 |
| 계약 감사 | 계약 검토 |
| GitOps 감사성 | GitOps 추적성 |
| 이번 감사에서 제외 | 이번 분석에서 제외 |
| 감사 트리거 | 점검 트리거 |
| 주기적으로 감사해야 | 주기적으로 검토해야 |
| 결론 도출 | 결론을 얻다 |
| 전략 수립 | 전략 세우기 |
| 체감 증상 | 겪은 증상, 느낀 증상 |
| 솔직하게 적습니다 | 솔직하게 기록합니다 |

**예외 — 보안/회계 도메인 표준 용어는 그대로 유지합니다.**

| 표준 용어 | 의미 |
|---|---|
| 감사 로그 | audit log |
| 감사 추적 | audit trail |
| 감사 이벤트 | audit event |
| 정산 / 감사 / 환불 | 회계 도메인 명사 |
| 영속/감사, 감사·정산·failover | 회계·운영 |
| 감사/reconcile | 데이터 일관성 |

판단 기준: **보안·회계 도메인의 표준 용어로 굳어진 경우만 유지**, 그 외 audit의 일반 의미("조사·분석")는 한국어 친화 어휘로 바꿉니다.

### 일반·기술 표준어 (그대로 사용)

`검증` · `진단` · `점검` · `반영` · `분석` · `검토` — 일상적·기술적 표준어로 변경 대상이 아닙니다.

## 표/다이어그램 설명 원칙

문단 수 대신 독자가 이해해야 할 기전·조건·선택 이유·예외를 기준으로 분량을 정합니다
자세한 기준은 [공통 말투·편집 기준](docs/writing-voice.md)의 “표·다이어그램·섹션”을 따릅니다

- 개념별로 문단을 나누되, 앞에서 충분히 설명한 요약표 뒤에는 같은 설명을 덧붙이지 않습니다
- 표의 모든 행을 문장으로 다시 읽지 않습니다. 중요한 관계와 판단 근거를 풉니다
- 구체적인 수치는 원본·출처·측정 조건이 있을 때만 씁니다. 가정 예시는 가정임을 밝히며 실측으로 표현하지 않습니다
- 복잡한 흐름은 번호 목록으로 설명하고, 지원 여부는 버전·조건과 함께 씁니다
- “풀어 설명하겠습니다”, “이것이 핵심입니다”를 매 절의 도입·마무리에 반복하지 않습니다
- 언어·도구 이름만으로 성능 우위를 단정하지 않습니다. 원본의 수치도 근거가 불명확하면 확인 필요로 남깁니다

## 코드 블록 규칙

```
[MUST] 언어 명시: ```yaml, ```bash, ```python
[SHOULD] 주석은 비자명한 이유·제약이 있을 때만 추가
[SHOULD] 실행 결과 포함 시 별도 블록으로 분리
[SHOULD] 실제 명령어 출력: $ prompt 포함
```

예시:
```bash
$ kubectl get pods
NAME                     READY   STATUS    RESTARTS   AGE
myApp-5d8c7b8d9f-abc12   1/1     Running   0          5m
```

## DevOps 블로그 특화 규칙

```
[SHOULD] 실제 에러 메시지 포함 (트러블슈팅 글)
[SHOULD] 명령어 실행 환경 명시 (OS, 버전)
[SHOULD] 복잡한 구성은 다이어그램 보조 (ASCII 박스 금지 — 아래 정책 참고)
```

## ASCII 다이어그램 정책 (재발 방지)

코드블록 안에 `┌┐└┘├┤│─` 박스나 `→←` 화살표로 다이어그램을 그리는 패턴은 1.x 본문 정리(`/.Codex/plans/ascii-cleanup/`)에서 224편 중 141편에 211블록을 평탄화한 결과 **재발 방지가 필요**하다고 판단했습니다. 신규 글 작성 시 다음 정책을 따릅니다.

| 패턴 | 정책 | 권장 대안 |
|---|---|---|
| 박스(`┌┐└┘`) + 5줄 이상 | **금지** | markdown 표, 번호 목록, 콜아웃 / 시각화 가치 크면 SVG (`public/diagrams/`) |
| 박스 + 5줄 이하 | **지양** | 표 또는 굵은 글씨 + 인라인 코드 |
| 디렉토리 트리(`├ └`) | **허용** — 단, 코드블록 ` ```text` 명시 필수 | — |
| 짧은 인라인 흐름(`A → B → C`) | **허용** — 단, 한 줄짜리만 | — |
| 다단계 흐름 (3단계 이상) | **금지** (박스/화살표로 그리지 않음) | 번호 목록 또는 SVG |
| Before/After 비교 박스 | **금지** | markdown 표 (시점 / 상태 2~3열) 또는 SVG 1장으로 통합 |
| 사이클/루프/데드락 | **금지** | SVG (시각화 가치 큼 — best-practices §11.1·11.2) |
| UI 모킹 (Grafana·Jaeger·Kiali 등) | **금지** | 수치 중심이면 SVG 차트, 표 형태면 markdown 표 |
| ASCII 디자인 목업 | **허용** — Design Change Rule 적용 (사용자 승인 후 코드) | — |

**평탄화 우선순위** (박스/다이어그램이 떠오를 때 이 순서로 결정):

1. **PNG/SVG가 본문에 인접해 있다** → ASCII 삭제 (자산 중복)
2. **표 형태 (행/열 의미가 명확)** → markdown 표
3. **체크리스트 박스** → 굵은 헤더 + `- [ ]`
4. **인라인 흐름 (1~2줄)** → 본문 인라인 코드 또는 ` ```text` lang 명시
5. **사이클/루프/데드락** → SVG (`public/diagrams/{slug}-{n}.svg`, 시각화 가치 큼)
6. **다단계 흐름 (3단계 이상 박스 + 분기)** → SVG (시각화 가치 큼)
7. **단순 박스 1~2개** → 굵은 글씨 또는 인라인 코드

5·6번 SVG 경로를 택할 때는 `.claude/plans/diagram-conversion/best-practices.md` (1.1) §1(색상 매핑)과 §11(실작업 패턴 9종)을 참고합니다. 작업 폴더는 51편 / 49 SVG 변환 결과를 누적해 둔 reference입니다.

**자가 점검**: 코드블록을 작성할 때 `┌┐└┘` 박스 문자가 들어가면 한 번 멈추고 위 표를 확인합니다. lang이 `text`/`yaml`/`json`/`hcl`/`promql` 등으로 명시된 실제 코드/로그/설정 출력은 박스 문자가 없는 한 그대로 유지합니다.

---

*버전: 1.4 | 최종 수정: 2026-10-21 (Codex·Claude 공통 말투 기준 연결, 설명 분량 강제 제거)*
