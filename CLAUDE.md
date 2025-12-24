# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

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
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server (after build)
npm start
```

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Homepage (profile, series, categories)
│   ├── layout.tsx            # Root layout with theme script
│   ├── globals.css           # CSS variables, light/dark mode
│   └── blog/
│       ├── page.tsx          # Blog list with category filter
│       └── [slug]/page.tsx   # Individual post page
├── components/
│   ├── Header.tsx            # Navigation + Search + Theme toggle
│   ├── Sidebar.tsx           # Left sidebar (posts by category/series)
│   ├── BlogList.tsx          # Blog list with category tabs
│   ├── TOC.tsx               # Table of contents (right sidebar)
│   ├── SeriesNav.tsx         # Series navigation (prev/next)
│   ├── Search.tsx            # Search modal (Cmd+K)
│   ├── ThemeToggle.tsx       # Light/dark mode toggle
│   ├── CodeBlock.tsx         # Code block with copy button
│   └── MDXComponents.tsx     # Custom MDX component mappings
├── content/                  # MDX blog posts
│   ├── istio-part1-*.md
│   ├── challenge1-game-server-*.md
│   └── ...
├── lib/
│   └── posts.ts              # Post utilities (getAllPosts, extractHeadings)
└── public/
    └── images/               # Blog post images
```

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

### Current Series

- `istio` (4 parts) - Istio 서비스 메시
- `game-server` (7 parts) - 게임 서버 배포 챌린지
- `wealist-migration` (5 parts) - Wealist 마이그레이션

### Adding New Posts

1. Create `.md` file in `src/content/`
2. Add front matter with required fields
3. For series posts, include `series.name` and `series.order`
4. Images go in `public/images/`

## Styling

### Theme System

- **Light mode** (default): Cloud Dancer inspired, clean white
- **Dark mode**: Deep dark with indigo accent
- Toggle via `data-theme` attribute on `<html>`
- CSS variables defined in `globals.css`

### Key CSS Variables

```css
--bg-primary      /* Main background */
--bg-secondary    /* Card/sidebar background */
--text-primary    /* Main text */
--text-secondary  /* Secondary text */
--accent          /* Accent color (indigo) */
--border          /* Border color */
```

## Deployment

- Deployed to GitHub Pages at `https://resskim-io.github.io/my-blog/`
- GitHub Actions workflow in `.github/workflows/deploy.yml`
- Static export with `output: 'export'` in `next.config.ts`
- Base path: `/my-blog`

## Key Features

1. **Search**: `Cmd+K` to open, fuzzy search by title/excerpt/tags
2. **TOC**: Right sidebar, auto-highlight current section
3. **Series Navigation**: Prev/next within series
4. **Left Sidebar**: Collapsible category/series navigation
5. **Theme Toggle**: Light/dark mode with system preference detection
6. **Code Copy**: Copy button on code blocks

## Blog Writing Style (한국어)

- **해요체 위주 (80%)**: 설명, 안내, 지시
- **반말 (20%)**: 강한 결론, 깨달음, 내면 독백
- **이모지 섹션 헤더**: 🔥 상황, 🤔 원인, ✅ 해결, 📚 배운 점
- **ASCII 다이어그램**: 아키텍처 설명용
- **실제 명령어 출력**: $ prompt 포함
