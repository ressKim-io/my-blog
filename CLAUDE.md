# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
1. MDX posts in `src/content/*.md` → parsed by `gray-matter` → rendered via `next-mdx-remote/rsc`
2. `src/lib/posts.ts` provides `getAllPosts()`, `getPostBySlug()`, `getSeriesPosts()`, `extractHeadings()`
3. Static generation: `generateStaticParams()` in `[slug]/page.tsx` creates all post pages at build time

### Key Directories
- `src/content/` - MDX blog posts (filename becomes slug)
- `src/lib/posts.ts` - Post utilities (getAllPosts, getSeriesPosts, extractHeadings)
- `src/components/MDXComponents.tsx` - Custom MDX rendering (code blocks, tables, headings with anchors)
- `public/images/` - Blog post images

### Static Export
- `next.config.ts`: `output: 'export'` for GitHub Pages
- Production uses `/my-blog` base path; development uses root

## Content (Blog Posts)

### Front Matter Format

```yaml
---
title: "Post Title"
excerpt: "Brief description"
category: "kubernetes"  # kubernetes, challenge, cicd
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

### SVG Diagram Guidelines

**다이어그램 텍스트는 반드시 영어로 작성합니다.** 한글은 폰트 임베딩 문제로 깨질 수 있습니다.

**테두리(stroke) 스타일링**: D2로 다이어그램을 만들 때, 가시성을 위해 테두리를 명시적으로 설정합니다.
```
shape.style.stroke: "#color"
shape.style.stroke-width: 2
```

### Image Size Hints

이미지(특히 SVG 다이어그램)의 높이를 조절하려면 alt 텍스트에 사이즈 힌트를 추가합니다.

```markdown
![설명](/image.svg)           # 기본 (max-height: 800px)
![설명|short](/image.svg)     # 작은 이미지 (max-height: 600px)
![설명|tall](/image.svg)      # 세로로 긴 이미지 (max-height: 1100px)
![설명|xtall](/image.svg)     # 매우 세로로 긴 이미지 (max-height: 1600px)
![설명|auto](/image.svg)      # 제한 없음 (원본 크기)
```

**사이즈 선택 기준** (SVG viewBox 비율 기준):
| 비율 (height/width) | 권장 힌트 |
|---------------------|----------|
| < 1.5 | 기본 (힌트 없음) |
| 1.5 ~ 2.5 | `\|tall` |
| > 2.5 | `\|xtall` |

**SVG 비율 확인 명령어**:
```bash
# viewBox에서 width, height 추출하여 비율 계산
grep -o 'viewBox="[^"]*"' file.svg
# viewBox="0 0 500 1000" → 비율 = 1000/500 = 2.0 → |tall 사용
```

## Theme System

- Toggle via `data-theme` attribute on `<html>` (light/dark)
- CSS variables in `globals.css`: `--bg-primary`, `--bg-secondary`, `--text-primary`, `--accent`, `--border`
- Theme script in `layout.tsx` prevents FOUC by setting theme before render

## Blog Writing Style (한국어)

### 기본 어조
- **해요체 위주 (80%)**: 설명, 안내, 지시
- **반말 (20%)**: 강한 결론, 깨달음, 내면 독백
- **이모지 섹션 헤더**: 🔥 상황, 🤔 원인, ✅ 해결, 📚 배운 점
- **실제 명령어 출력**: $ prompt 포함

### 표/다이어그램 설명 작성 원칙

표나 다이어그램 아래에는 **상세한 설명**을 추가합니다. 단순 요약이 아니라, 처음 보는 사람도 이해할 수 있도록 자세히 풀어씁니다.

#### 1. 문단 나누기

한 줄에 모든 내용을 쓰지 않습니다. 개념별로 문단을 분리합니다.

```markdown
❌ 나쁜 예 (한 줄 요약):
Sidecar 방식에서 각 Envoy는 기본적으로 CPU 10~50m, Memory 128~512Mi를 사용합니다. 100개 Pod가 있으면 Sidecar만으로 최대 5 CPU, 50Gi 메모리가 필요합니다.

✅ 좋은 예 (문단 분리):
이 숫자가 실제로 의미하는 바를 생각해봅시다.

Sidecar 방식에서 Envoy 하나당 기본 설정으로 CPU 10~50m, Memory 128~512Mi를 사용합니다. 작아 보이지만, Pod 수가 늘어나면 이야기가 달라집니다. 100개 Pod 클러스터에서는 Sidecar만으로 CPU 1~5 코어, 메모리 12.8~50Gi가 필요합니다.

더 심각한 문제는 **Sidecar가 앱보다 리소스를 더 쓰는 상황**입니다. 가벼운 마이크로서비스(CPU 50m, Memory 64Mi)에 Sidecar(CPU 100m, Memory 128Mi)가 붙으면, 프록시가 앱의 2배 리소스를 소비하게 됩니다.
```

#### 2. 구체적 예시 포함

추상적인 설명 대신 **구체적인 수치나 시나리오**를 제시합니다.

```markdown
❌ 나쁜 예:
업그레이드 문제가 큽니다. Pod를 재시작해야 합니다.

✅ 좋은 예:
**업그레이드 문제**가 가장 큽니다. Istio 버전을 1.23에서 1.24로 올린다고 가정해봅시다. 새 Envoy 버전을 적용하려면 모든 Pod를 재시작해야 합니다. 1000개 Pod 클러스터에서 Rolling Restart를 하면 수 시간이 걸릴 수 있고, 그 동안 서비스 안정성에 영향을 줄 수 있습니다.
```

#### 3. 흐름 설명 (단계별)

복잡한 프로세스는 **번호 목록**으로 단계별로 설명합니다.

```markdown
트래픽 흐름을 따라가봅시다. Pod A에서 Pod B로 요청을 보내면:

1. Pod A의 요청이 나갑니다.
2. Node A의 ztunnel이 이 트래픽을 eBPF로 가로챕니다.
3. ztunnel이 Pod A의 SPIFFE ID로 mTLS 암호화를 수행합니다.
4. 암호화된 트래픽이 네트워크를 통해 Node B로 전달됩니다.
5. Node B의 ztunnel이 트래픽을 받아 mTLS 복호화합니다.
6. Pod B의 SPIFFE ID를 검증하고, L4 AuthorizationPolicy를 확인합니다.
7. 정책을 통과하면 Pod B로 트래픽을 전달합니다.

이 과정에서 **HTTP 헤더를 전혀 파싱하지 않습니다**.
```

#### 4. "왜"를 설명

단순히 "무엇"이 아니라 **"왜 그런지"**를 설명합니다.

```markdown
❌ 나쁜 예:
ztunnel은 Rust로 작성되었습니다.

✅ 좋은 예:
기술적으로 흥미로운 점은 **Rust로 작성**되었다는 것입니다. Envoy는 C++로 작성되어 있고 수년간 최적화되었지만, 여전히 메모리 사용량이 적지 않습니다. ztunnel은 Rust의 메모리 안전성과 효율성을 활용해 더 적은 리소스로 동작합니다.
```

#### 5. 도입부와 마무리

각 설명 블록의 **시작**과 **끝**을 명확히 합니다.

```markdown
# 도입부 예시
"Ambient의 장점을 하나씩 살펴봅시다."
"이 숫자가 실제로 의미하는 바를 생각해봅시다."
"Sidecar 방식의 운영 복잡성은 실제로 겪어보면 더 크게 느껴집니다."

# 마무리 예시
"이것이 Ambient가 효율적인 이유입니다. 모든 트래픽에 무거운 L7 처리를 강제하지 않고, 필요한 곳에만 선택적으로 적용합니다."
"이 선택적 배포가 리소스 절감의 핵심입니다."
```

#### 6. 기능 목록 구조

기능이나 역할을 설명할 때 **목록 형식**을 활용합니다.

```markdown
waypoint가 처리하는 기능들:
- **VirtualService 라우팅**: HTTP 헤더, URI 경로 기반으로 트래픽을 분배합니다.
- **JWT 인증**: Authorization 헤더의 JWT 토큰을 검증합니다.
- **Retry/Timeout**: HTTP 요청 실패 시 재시도하거나, 타임아웃을 설정합니다.
- **Circuit Breaker**: 연속 실패 시 일시적으로 트래픽을 차단합니다.
```

#### 7. 지원/미지원 기능 설명

기능 비교표 아래에는 **지원/미지원**을 명확히 분류합니다.

```markdown
**완전히 지원되는 기능**:
- mTLS 자동 암호화는 ztunnel에서 기본 제공됩니다.
- VirtualService, DestinationRule 같은 L7 라우팅은 waypoint를 통해 지원됩니다.

**아직 미지원인 기능**:
- **EnvoyFilter**는 현재 Ambient에서 사용할 수 없습니다. 커스텀 Lua 스크립트나 특수한 Envoy 설정이 필요한 경우 Sidecar를 유지해야 합니다.
- **멀티클러스터** 지원은 로드맵에 있지만 1.24에서는 미지원입니다.
```

### 설명 분량 가이드

| 표/다이어그램 유형 | 권장 설명 분량 |
|-------------------|---------------|
| 핵심 개념 비교표 | 3-4 문단 |
| 아키텍처 다이어그램 | 4-6 문단 + 역할 목록 |
| 트래픽 흐름 다이어그램 | 단계별 번호 목록 + 1-2 문단 |
| 기능 지원 현황표 | 지원/미지원 분류 + 2-3 문단 |
| 요약 정리표 | 2-3 문단 (마무리) |
