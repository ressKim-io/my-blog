# Phase 2 결정안 초안

**작성일**: 2026-04-24
**상태**: 🟡 사용자 검토 대기

> 이 문서는 Phase 1 findings를 바탕으로 한 **결정 초안**입니다
> 사용자 검토·수정 후 Phase 3(실행)에서 이 결정대로 파일 작업합니다

## 정책 합의 사항 (사용자 확정)

- 글 1개 = 주제 1개 원칙 유지 (묶음 병합 X)
- 유형 메타 태그 도입 (`troubleshooting` / `adr` / `concept` / `retrospective`)
- 기본 플랜 + 서사 글 돋보이게

---

## 🔴 결정 1. istio-part* 4편

**추천**: **삭제**

**근거**
- 본인이 이미 각 글 상단에 "초기 학습 기록" 경고 + "더 체계적인 내용은 istio-intro 시리즈 참고" 명시
- `istio-intro-part1~3`이 정식 입문 시리즈로 존재 (재작성본)
- 블로그 품질 관점에서 중복 시리즈 2개는 "영양가 없다" 비판 타격점
- "학습 과정 보존"은 GitHub 커밋 히스토리에 이미 있음

**대안 옵션 (삭제가 부담스러울 경우)**
- 격리: 시리즈명 `istio-learning-log`로 리네이밍 + 카테고리를 `archive`로 변경 → 공개되지만 메인 istio 트랙에서 분리

**대상 파일**
- `src/content/istio-part1-concept-and-comparison.md`
- `src/content/istio-part2-architecture.md`
- `src/content/istio-part3-gateway-jwt.md`
- `src/content/istio-part4-traffic-control.md`

**영향**: 34편 → 30편 (-4)

---

## 🔴 결정 2. goti-meta "스킬 보강" 4편 병합

**추천**: **병합 → 1편** ("AI 스킬 보강 통합 회고")

**근거**
- 4편 모두 2026-03-11 같은 날 작성
- 동일 구조·톤 (영역만 다름: K8s / 모니터링 / OTel HikariCP / EC2 CD)
- 개별 글로 남으면 "자기 복제" 느낌, 묶으면 "AI 워크플로우 시스템적 보강" 스토리로 질 상승

**통합 글 구조 (제안)**
```
제목: AI 스킬 보강 대규모 회고 — K8s/모니터링/OTel/EC2 CD 4개 영역 동시 개선
한 줄 요약: 갭 분석 → 영역별 체크리스트 → /review-pr:<domain> 커맨드 체계 신설
섹션:
1. 배경: 왜 한 번에 4개 영역을 개선했는가 (컨텍스트 why)
2. K8s 영역 갭 12건 + 체크리스트 (기존 goti-k8s-skill-review-improvement)
3. 모니터링 영역 + /review-pr:monitoring 신설 (기존 goti-monitoring-skill-...)
4. OTel HikariCP — BPP 6→60줄 이유 (기존 goti-otel-hikaricp-skill-...)
5. EC2 CD 파이프라인 — 트러블 4건 체크리스트 (기존 goti-ec2-cd-skill-improvement)
6. 공통 패턴과 배운 점 (새 섹션)
```

**대상 파일**
- 베이스: `goti-k8s-skill-review-improvement.md` (가장 포괄적)
- 흡수 → 삭제: `goti-monitoring-skill-review-improvement.md`, `goti-otel-hikaricp-skill-improvement.md`, `goti-ec2-cd-skill-improvement.md`

**카테고리 조정 필요**: 통합 후 `challenge` 또는 `meta` 카테고리 (기존 goti-meta 시리즈 소속)

**영향**: 51 + 46 + 43 + 13 → 각 카테고리에서 -3편 (도합 -3)

---

## 🔴 결정 3. Error Tracking Dashboard 2편 병합

**추천**: **병합 → 1편**

**근거**
- 같은 날(2026-03-23), 같은 대시보드, 연속된 트러블슈팅
- 독자 관점에서 1편으로 묶어야 자연스러움
- order 10(쿼리 수정) → order 11(No data) 같은 흐름

**통합 글 구조**
```
제목: Error Tracking 대시보드 트러블슈팅 — LogQL/TraceQL 쿼리 수정 + native OTLP No data
섹션:
1. 문제 1: LogQL `count_over_time` 그루핑 + Loki empty-compatible matcher + Tempo traceqlSearch 구조
2. 문제 2: Loki native OTLP `| json` 파이프가 plain text 전량 drop
3. 공통 원인: OTel + LGTM 스택 문법 변화
```

**대상 파일**
- 베이스: `goti-error-tracking-dashboard-loki-nodata.md` (더 긺)
- 흡수 → 삭제: `goti-error-tracking-dashboard-logql-traceql-fix.md`

**영향**: monitoring 46 → 45편 (-1)

---

## 🟡 결정 4. Claude vs Gemini 비교 2편

**추천**: **유지** (둘 다)

**근거**
- 2편이 서로 다른 PR(#176, #192)을 다루며 각각 다른 패턴 발견
- 지속 시리즈로 발전 가능 (PR 비교 시리즈)
- 병합하면 case study 2개의 개별성이 흐려짐

**조치**: 시리즈 명시
- frontmatter에 `series.name: goti-ai-review-comparison` 추가 (order 1, 2)
- 이후 비교 글은 같은 시리즈로

**영향**: 없음 (편수 변동 없음)

---

## 🟡 결정 5. wsl2-k3s-troubleshooting

**추천**: **리라이트**

**근거**
- 4047자 · 코드 64% · 설명 비중 낮음
- L2 로컬 환경 트러블슈팅으로 가치는 있으나 설명 부족

**보강 내용**
- 왜 k3s를 WSL2에서 썼는지 컨텍스트 추가
- 각 에러의 원인 설명 강화 (현재는 해결 커맨드 위주)
- 코드 블록 간 설명 문단 삽입

**영향**: 없음 (편수 변동 없음, 품질 상승)

---

## 🟢 결정 6. B유형 서사/컨텍스트 결여 리라이트 (3편)

| slug | 보강 방향 |
|------|----------|
| `multi-repo-cicd-strategy` (2025-10-26) | mono vs multi-repo 대안 비교 + 우리 프로젝트가 multi를 택한 이유 (부트캠프 맥락) |
| `goti-queue-poc-performance-comparison` (2026-03-30) | ctx 2로 낮음. "우리 프로젝트가 필요로 하는 처리량 목표" 명시 + POC A/B/C 선택 기준 보강 |
| `queue-poc-loadtest-part3-selection` (2026-04-04) | ctx 1. 대용량 트래픽/무중단 목표 → 어느 PoC를 왜 택했는지 결정 스토리 강화 |

**영향**: 편수 변동 없음, B유형 서사 품질 상승

---

## 🟢 결정 7. 날짜 이동 (~30편)

**목표**: 2026-02 분포 2편 → ~30편으로 개선

**카테고리별 이동 후보 (findings-*.md에 상세 목록)**

| 카테고리 | 이동 편수 | 대상 |
|---------|----------|------|
| argocd | 2편 | goti-argocd-gitops 시리즈 초기 2편 |
| cicd | 2편 | goti-cloudfront-swagger-403, goti-renovate-ecr-auth-failure |
| challenge | 4편 | goti-review-pr-gap-learning, goti-queue-loadtest-k6-two-phase-design, goti-redis-first-ticketing-adr, goti-poc-ab-test-dependency-isolation-pattern |
| kubernetes | 7~10편 | 4/1 집중 글 + 독립 ADR 글 |
| monitoring | 12편 | 시리즈 시작점 + 독립 ADR 글 |

**이동 규칙**
- 2월 상순: ADR·PoC 설계 등 초기 단계 글
- 2월 중순: 시리즈 시작점
- 2월 하순: 독립 트러블슈팅
- 시리즈 중간 order는 이동 제외 (연속성 보호)

**영향**: 시각적 몰림 해소, 편수 변동 없음

---

## 🟢 결정 8. 유형 메타 태그 일괄 부여

**방식**
1. `scripts/classify-types.js`로 자동 추정 (ADR flag, narr/ctx 히트, slug 패턴)
2. `type-assignments.md` 목록 생성
3. 사용자 검수 → 수정
4. 196편 frontmatter 일괄 업데이트 (기존 tags 마지막에 유형 태그 추가)

**영향**: 모든 글의 frontmatter 수정

---

## 실행 순서 (Phase 3)

결정 확정 후 다음 순서로 실행

1. **결정 1, 2, 3** (병합·삭제) — 편수 변동 먼저
2. **결정 4** (시리즈 필드 추가) — 단순 frontmatter 수정
3. **결정 7** (날짜 이동) — 30편 frontmatter date 필드 수정
4. **결정 8** (유형 태그 부여) — 196편 frontmatter tags 수정
5. **결정 5, 6** (리라이트) — 공수 큼, 편별로 별도 세션 권장

각 단계마다 `state.md` 업데이트 + 커밋

## 최종 변동 예상

| 지표 | 현재 | Phase 3 이후 |
|------|------|-------------|
| 총 편수 | 196 | **188** (-8) |
| 유형 태그 | 없음 | 전 편 부여 |
| 2월 분포 | 2편 | ~32편 |
| 3월 분포 | 73편 | ~55편 |
| 4월 분포 | 59편 | ~45편 |
| B유형 서사 품질 | 리라이트 대상 3~5편 | 보강 완료 |
