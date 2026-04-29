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
1. MDX posts in `src/content/*.md` → parsed by `gray-matter` → rendered via `next-mdx-remote/rsc`
2. `src/lib/posts.ts` provides `getAllPosts()`, `getPostBySlug()`, `getSeriesPosts()`, `extractHeadings()`
3. Static generation: `generateStaticParams()` in `[slug]/page.tsx` creates all post pages at build time

### Key Directories
- `src/content/` - MDX blog posts (filename becomes slug)
- `src/lib/posts.ts` - Post utilities (getAllPosts, getSeriesPosts, extractHeadings)
- `src/components/MDXComponents.tsx` - Custom MDX rendering (code blocks, tables, headings with anchors)
- `public/images/` - Blog post images (PNG)
- `docs/drawio/` - Draw.io diagram source files

### Static Export
- `next.config.ts`: `output: 'export'` for GitHub Pages
- Production uses `/my-blog` base path; development uses root

<!-- STATS:START -->
<!-- 자동 생성: scripts/update-stats.mjs (prebuild 훅), 수동 편집 금지 -->
## Blog Content Stats (2026-04-28 기준, 자동 생성)

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

### Diagram Workflow (Draw.io)

```
Draw.io MCP → .drawio 파일 생성 (docs/drawio/)
→ 사용자 수정/검토 → PNG 내보내기 (public/images/)
→ 블로그 글에서 사용
```

**다이어그램 텍스트는 반드시 영어로 작성합니다.** 한글은 폰트 문제로 깨질 수 있습니다.

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

> 기술 블로그 글 작성 시 Claude가 따라야 할 규칙 (브라우저/Claude Code 공통)

## 목적

- 기술 블로그 글 (개인 블로그, 팀 블로그, Medium, velog 등)
- 학습 내용 정리, 트러블슈팅 기록, 튜토리얼 작성

## 규칙

### 기본 어조

```
[MUST] 격식체 (100%): ~합니다, ~입니다, ~했습니다
[MUST] 문장·문단·bullet 끝 마침표(.) 생략 — URL/버전/소수점/약어/코드블록 내부는 예외, ?/! 유지
[SHOULD] 이모지 섹션 헤더: 🔥 상황, 🤔 원인, ✅ 해결, 📚 배운 점
[NEVER] 해요체 (~해요, ~했어요, ~돼요)
[NEVER] 반말체 (~한다, ~했다, ~이다)
```

**격식체 예시:**
```
"이 숫자가 실제로 의미하는 바를 생각해보겠습니다."
"작아 보이지만, Pod 수가 늘어나면 이야기가 달라집니다."
"Sidecar 방식에서 Envoy 하나당 CPU 10~50m를 사용합니다."
"트래픽 흐름을 따라가보겠습니다."
"이것이 Ambient가 효율적인 이유입니다."
"이 선택적 배포가 리소스 절감의 핵심입니다."
```

### 문체

```
[MUST] 간결한 문장 (한 문장 50자 이내 권장)
[MUST] 문장·문단·bullet 끝 마침표(.) 생략 (한국어 블로그 관행, ?/! 유지)
[MUST] 모든 코드 블록에 언어 명시 (```bash, ```yaml 등)
[SHOULD] 기술 용어는 첫 등장 시 간단히 설명
[NEVER] "~해요", "~했어요" 해요체 사용
[NEVER] "~한다", "~했다", "~이다" 반말체 사용
[NEVER] 불필요한 영어 표현 남발
[NEVER] 요청 없이 장황한 서론/결론
```

## 표/다이어그램 설명 원칙

표나 다이어그램 아래에는 **상세한 설명**을 추가한다. 단순 요약이 아니라, 처음 보는 사람도 이해할 수 있도록 자세히 풀어쓴다.

### 1. 문단 나누기

한 줄에 모든 내용을 쓰지 않는다. 개념별로 문단을 분리한다.

```markdown
❌ 나쁜 예 (한 줄 요약):
Sidecar 방식에서 각 Envoy는 기본적으로 CPU 10~50m, Memory 128~512Mi를 사용합니다. 100개 Pod가 있으면 Sidecar만으로 최대 5 CPU, 50Gi 메모리가 필요합니다.

✅ 좋은 예 (문단 분리):
이 숫자가 실제로 의미하는 바를 생각해보겠습니다.

Sidecar 방식에서 Envoy 하나당 기본 설정으로 CPU 10~50m, Memory 128~512Mi를 사용합니다.
작아 보이지만, Pod 수가 늘어나면 이야기가 달라집니다.
100개 Pod 클러스터에서는 Sidecar만으로 CPU 1~5 코어, 메모리 12.8~50Gi가 필요합니다.

더 심각한 문제는 **Sidecar가 앱보다 리소스를 더 쓰는 상황**입니다.
가벼운 마이크로서비스(CPU 50m, Memory 64Mi)에 Sidecar(CPU 100m, Memory 128Mi)가 붙으면,
프록시가 앱의 2배 리소스를 소비하게 됩니다.
```

### 2. 구체적 예시 포함

추상적인 설명 대신 **구체적인 수치나 시나리오**를 제시한다.

```markdown
❌ 나쁜 예:
업그레이드 문제가 큽니다. Pod를 재시작해야 합니다.

✅ 좋은 예:
**업그레이드 문제**가 가장 큽니다.
Istio 버전을 1.23에서 1.24로 올린다고 가정하겠습니다.
새 Envoy 버전을 적용하려면 모든 Pod를 재시작해야 합니다.
1000개 Pod 클러스터에서 Rolling Restart를 하면 수 시간이 걸릴 수 있고,
그 동안 서비스 안정성에 영향을 줄 수 있습니다.
```

### 3. 흐름 설명 (단계별)

복잡한 프로세스는 **번호 목록**으로 단계별로 설명한다.

```markdown
트래픽 흐름을 따라가보겠습니다. Pod A에서 Pod B로 요청을 보내면:

1. Pod A의 요청이 나갑니다.
2. Node A의 ztunnel이 이 트래픽을 eBPF로 가로챕니다.
3. ztunnel이 Pod A의 SPIFFE ID로 mTLS 암호화를 수행합니다.
4. 암호화된 트래픽이 네트워크를 통해 Node B로 전달됩니다.
5. Node B의 ztunnel이 트래픽을 받아 mTLS 복호화합니다.

이 과정에서 **HTTP 헤더를 전혀 파싱하지 않습니다**.
```

### 4. "왜"를 설명

단순히 "무엇"이 아니라 **"왜 그런지"**를 설명한다.

```markdown
❌ 나쁜 예:
ztunnel은 Rust로 작성되었습니다.

✅ 좋은 예:
기술적으로 흥미로운 점은 **Rust로 작성**되었다는 것입니다.
Envoy는 C++로 작성되어 있고 수년간 최적화되었지만, 여전히 메모리 사용량이 적지 않습니다.
ztunnel은 Rust의 메모리 안전성과 효율성을 활용해 더 적은 리소스로 동작합니다.
```

### 5. 도입부와 마무리

각 설명 블록의 **시작**과 **끝**을 명확히 한다.

**도입부 예시:**
```
"Ambient의 장점을 하나씩 살펴보겠습니다."
"이 숫자가 실제로 의미하는 바를 생각해보겠습니다."
"Sidecar 방식의 운영 복잡성은 실제로 겪어보면 더 크게 느껴집니다."
"트래픽 흐름을 따라가보겠습니다."
```

**마무리 예시:**
```
"이것이 Ambient가 효율적인 이유입니다."
"모든 트래픽에 무거운 L7 처리를 강제하지 않고, 필요한 곳에만 선택적으로 적용합니다."
"이 선택적 배포가 리소스 절감의 핵심입니다."
```

### 6. 기능 목록 구조

기능이나 역할을 설명할 때 **목록 형식**을 활용한다.

```markdown
waypoint가 처리하는 기능들:
- **VirtualService 라우팅**: HTTP 헤더, URI 경로 기반으로 트래픽을 분배합니다.
- **JWT 인증**: Authorization 헤더의 JWT 토큰을 검증합니다.
- **Retry/Timeout**: HTTP 요청 실패 시 재시도하거나, 타임아웃을 설정합니다.
- **Circuit Breaker**: 연속 실패 시 일시적으로 트래픽을 차단합니다.
```

### 7. 지원/미지원 기능 설명

기능 비교표 아래에는 **지원/미지원**을 명확히 분류한다.

```markdown
**완전히 지원되는 기능**:
- mTLS 자동 암호화는 ztunnel에서 기본 제공됩니다.
- VirtualService, DestinationRule 같은 L7 라우팅은 waypoint를 통해 지원됩니다.

**아직 미지원인 기능**:
- **EnvoyFilter**는 현재 Ambient에서 사용할 수 없습니다.
  커스텀 Lua 스크립트나 특수한 Envoy 설정이 필요한 경우 Sidecar를 유지해야 합니다.
- **멀티클러스터** 지원은 로드맵에 있지만 1.24에서는 미지원입니다.
```

## 설명 분량 가이드

| 표/다이어그램 유형 | 권장 설명 분량 |
|-------------------|---------------|
| 핵심 개념 비교표 | 3-4 문단 |
| 아키텍처 다이어그램 | 4-6 문단 + 역할 목록 |
| 트래픽 흐름 다이어그램 | 단계별 번호 목록 + 1-2 문단 |
| 기능 지원 현황표 | 지원/미지원 분류 + 2-3 문단 |
| 요약 정리표 | 2-3 문단 (마무리) |

## 코드 블록 규칙

```
[MUST] 언어 명시: ```yaml, ```bash, ```python
[MUST] 주석으로 핵심 포인트 표시
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

코드블록 안에 `┌┐└┘├┤│─` 박스나 `→←` 화살표로 다이어그램을 그리는 패턴은 1.x 본문 정리(`/.claude/plans/ascii-cleanup/`)에서 224편 중 141편에 211블록을 평탄화한 결과 **재발 방지가 필요**하다고 판단했습니다. 신규 글 작성 시 다음 정책을 따릅니다.

| 패턴 | 정책 | 권장 대안 |
|---|---|---|
| 박스(`┌┐└┘`) + 5줄 이상 | **금지** | markdown 표, 번호 목록, 콜아웃 / 디자인 개편 후 컴포넌트 |
| 박스 + 5줄 이하 | **지양** | 표 또는 굵은 글씨 + 인라인 코드 |
| 디렉토리 트리(`├ └`) | **허용** — 단, 코드블록 ` ```text` 명시 필수 | — |
| 짧은 인라인 흐름(`A → B → C`) | **허용** — 단, 한 줄짜리만 | — |
| 다단계 흐름 (3단계 이상) | **금지** (박스/화살표로 그리지 않음) | 번호 목록 |
| Before/After 비교 박스 | **금지** | markdown 표 (시점 / 상태 2~3열) |
| ASCII 디자인 목업 | **허용** — Design Change Rule 적용 (사용자 승인 후 코드) | — |

**평탄화 우선순위** (박스/다이어그램이 떠오를 때 이 순서로 변환):

1. **인라인** — 1줄 흐름은 본문 인라인 코드로 (`Browser → API → DB`)
2. **번호 목록** — 단계/사이클/인과 사슬은 번호 목록으로
3. **markdown 표** — Before/After·옵션 비교·매핑은 표로
4. **콜아웃/굵은 글씨** — 단일 강조는 본문 강조로
5. **다이어그램 컴포넌트** — 시각화 가치가 큰 경우만 (디자인 개편 세션 입력)

**자가 점검**: 코드블록을 작성할 때 `┌┐└┘` 박스 문자가 들어가면 한 번 멈추고 위 표를 확인합니다. lang이 `text`/`yaml`/`json`/`hcl`/`promql` 등으로 명시된 실제 코드/로그/설정 출력은 박스 문자가 없는 한 그대로 유지합니다.

---

*버전: 1.2 | 최종 수정: 2026-04-30 (ASCII 다이어그램 정책 추가)*
