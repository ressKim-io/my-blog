# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `src/content/{track}/{category}/` - MDX blog posts. track ∈ {essays, logs}, category ∈ {kubernetes, istio, challenge, monitoring, argocd, cicd, network, rust, runtime}
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
## Blog Content Stats (2026-07-14 기준, 자동 생성)

- **총 글 수**: 335개 (go-ti 프로젝트 실전 기록 210편 포함)
- **카테고리 (9개)**:
  - `challenge` (118): 게임서버/POC/부하테스트/AI 워크플로우 경험 시리즈
  - `monitoring` (65): Prometheus, OpenTelemetry, Grafana, Loki, Tempo, Mimir
  - `kubernetes` (51): K8s 기본, EKS, Helm, KEDA, Karpenter, 스케일링
  - `istio` (40): Service Mesh, Traffic/Security/Observability/Ambient, JWT
  - `runtime` (19)
  - `argocd` (15): ArgoCD, SSA, ApplicationSet
  - `cicd` (14): CI/CD, ArgoCD GitOps, EC2 CD 파이프라인
  - `rust` (7)
  - `network` (6)
- **유형 메타 태그**: `troubleshooting` (109) / `adr` (40) / `concept` (84) / `retrospective` (11)
  - `/blog?tag=adr` — 의사결정 서사 글만 모아보기
  - `/blog?tag=troubleshooting` — 단순 트러블슈팅 모아보기
  - `/blog?tag=concept` — 개념·학습 글
  - `/blog?tag=retrospective` — 메타 회고
- **태그**: 고유 태그 694개 (유형 메타 태그 4종 포함)
- **주요 시리즈** (편수 순):
  - go-ti 프로젝트 (37개 시리즈): goti-multicloud (15), goti-observability-ops (15), goti-queue-poc (12), goti-deepdive-database (11), goti-deepdive-observability (11), goti-deepdive-redis (11), goti-deepdive-platform (9), goti-auth (7), goti-java-to-go (7), goti-multicloud-db (7), goti-redis-sot (7), goti-deepdive-edge (6), goti-deepdive-runtime (6), goti-argocd (5), goti-deepdive-istio (5), goti-ec2-deploy (5), goti-meta (5), goti-observability-stack (5), goti-portfolio-meta (5), goti-resale (5), goti-ticketing-phase (5), goti-kind-dev-bootstrap (4), goti-loadtest (4), goti-otel-prometheus (4), goti-scaling (4), goti-cloudfront-alb (3), goti-eks (3), goti-istio-ops (3), goti-kafka (3), goti-kind-monitoring (3), goti-otel-instrumentation (3), goti-ai-review-comparison (2), goti-argocd-gitops (2), goti-cloudflare-migration (2), goti-metrics-collector (2), goti-pgbouncer (2), goti-spring-otel (2)
  - 기존 시리즈 (16개): kernel-runtime-tradeoffs (19), eks-troubleshooting (9), game-server (7), istio-ambient (7), rust-cs-layer (7), packet-journey (6), argocd-troubleshooting (5), challenge-2-wealist-migration (5), istio-traffic (5), istio-observability (4), istio-security (4), istio-intro (3), queue-poc-loadtest (3), eks-security (2), observability (2), eks-infra (1)
- **월별 분포**: 2025-10: 15 / 2025-11: 1 / 2025-12: 33 / 2026-01: 9 / 2026-02: 29 / 2026-03: 77 / 2026-04: 139 / 2026-06: 18 / 2026-07: 14
- **go-ti 태그 필터**: 모든 goti 글은 `tags[0] == "go-ti"`로 `/blog?tag=go-ti` 한 번에 조회 가능
<!-- STATS:END -->

## Content (Blog Posts)

### Front Matter Format

```yaml
---
title: "Post Title"
excerpt: "Brief description"
category: "kubernetes"  # istio, kubernetes, challenge, argocd, monitoring, cicd, network, rust, runtime
tags: ["tag1", "tag2"]
series:
  name: "series-name"
  order: 1
date: "2025-01-01"
---
```

### Adding New Posts

1. **트랙 결정**: 다듬은 글(개념·ADR·회고) → `essays`, 트러블슈팅·작업 노트 → `logs`
2. **카테고리 폴더 선택**: kubernetes / istio / challenge / monitoring / argocd / cicd / network / rust / runtime 중 택1
3. `src/content/{track}/{category}/{slug}.md` 경로에 파일 생성 (파일명이 URL slug, 디렉토리는 분류용)
4. Front matter 필수 필드 작성
5. 시리즈 글이라면 `series.name` + `series.order`. 한 시리즈는 한 트랙으로 통일(혼합 시 시리즈 navigation이 logs↔essays 양쪽으로 흩어짐)
6. 이미지/다이어그램은 `public/images/`, `public/diagrams/`에 평탄 구조로

**디렉토리 위치가 track의 1순위 SSOT**입니다. frontmatter `type` 필드는 글 본질 표시용 메타로만 쓰이며, 트랙 격리에는 영향 없음.

### Diagrams & Images

- **SVG 직접 작성(기본)**: `public/diagrams/{slug}-{n}.svg`. 라이트 테마 + Cocoon 6색 매핑. 상세 가이드 `.claude/plans/diagram-conversion/best-practices.md`
- **Draw.io (복잡 아키텍처)**: `docs/drawio/` → PNG 내보내기 → `public/images/`. 텍스트는 **반드시 영어** (한글 폰트 깨짐). 스타일 `.claude/Draw-io-*.md`
- **이미지 사이즈 힌트** alt 텍스트로: `|short`(600px) · 기본(800px) · `|tall`(1100px) · `|xtall`(1600px) · `|auto`(제한 없음)

## Theme System

- Toggle via `data-theme` attribute on `<html>` (light/dark)
- CSS variables in `globals.css`: `--bg-primary`, `--bg-secondary`, `--text-primary`, `--accent`, `--border`
- Theme script in `layout.tsx` prevents FOUC by setting theme before render

---

# 블로그 글 작성 핵심 규칙

> 모든 글에 항상 적용되는 절대 규칙. 변환 절차·섹션 템플릿·설명 분량 가이드 등 상세는 `.claude/skills/draft-to-post/SKILL.md` 참조.

## 절대 규칙

- **격식체 100%**: ~합니다, ~입니다, ~했습니다 (해요체·반말체 0건)
- **문장·문단·bullet 끝 마침표(.) 생략** — URL/버전/소수점/약어/코드블록 내부는 예외, `?`/`!`는 유지
- **한 문장 50자 이내 권장**, 간결하게
- **모든 코드 블록에 언어 명시**: ` ```bash`, ` ```yaml`, ` ```python`, 로그/에러는 ` ```text`
- **요청 없는 장황한 서론/결론 금지**

## 어휘

직역체("근본 원인 감사", "감사 스크립트", "전략 수립" 등 — audit의 일반 의미)는 자연스러운 한글(분석·점검·세우다)로 변환. 단, **보안·회계 도메인 표준 용어**(audit log/audit trail, 정산/감사/환불)는 그대로 유지. 표준어 `검증·진단·점검·반영·분석·검토`는 변경 대상 아님.

**영어 은유 직역 금지** (2026-07-11 신설): "뜨거운 메서드"(hot)·"시동이 기어간다"(crawl)·"스레드 마비"(paralyze)·"CPU를 훔쳐 간다"(steal)·"프로파일을 먹인다"(feed) 류는 한글에 존재하지 않는 말투 — 자주 실행되는·크게 느려진다·감당하지 못한다·가져가 쓴다·반영한다로. 렉시콘·자동 검사는 `npm run lint:post -- <file>`(`scripts/lint-post.mjs`), 대체어 상세는 draft-to-post 스킬.

## ASCII 박스/다이어그램 — 재발 방지 정책

코드블록에 `┌┐└┘├┤│─` 박스나 다단계 `→` 흐름은 **금지**. 아래 우선순위로 평탄화:

1. PNG/SVG가 인접 → ASCII 삭제 (중복)
2. 행/열 의미 명확 → markdown 표
3. 1~2줄 인라인 흐름 → 인라인 코드 또는 ` ```text` 명시
4. 사이클/루프/데드락, 3단계 이상 분기 → SVG (`public/diagrams/{slug}-{n}.svg`)
5. 단순 박스 1~2개 → 굵은 글씨 또는 인라인 코드

**허용**: 디렉토리 트리(` ```text` 명시), 짧은 한 줄 인라인 흐름(`A → B → C`), Design Change Rule 적용 ASCII 목업. SVG 작성 시 `.claude/plans/diagram-conversion/best-practices.md` §1(색상)과 §11(실작업 패턴 9종) 참고.

자가 점검: 박스 문자가 들어가면 멈추고 위 우선순위 확인. lang이 명시된 실제 코드/로그/설정 출력은 그대로 유지.

---

*버전: 2.0 | 디렉토리 SSOT 도입(2026-05-08) — 어조·어휘·ASCII 정책 압축, 상세 절차는 skill로 이동*
