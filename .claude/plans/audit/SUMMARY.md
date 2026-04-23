# Phase 1 진단 요약

**작성일**: 2026-04-24
**대상**: 블로그 196편 전수

## 블로그 구조 이해 (사용자 확인)

블로그는 3단 성장 서사를 가집니다

1. **L1 기본** (7~10편) — 개념·기초 (istio-intro, k8s-pod-flow 등)
2. **L2 심화** (30~40편) — 특정 영역 깊이 (istio-ambient, istio-traffic, game-server 등)
3. **L3 실무통합 = go-ti** (127편, 2026-01~04 4개월) — 대용량 트래픽/무중단 프로젝트

이 구조 자체가 "기본 → 심화 → 실전"의 학습 성장 내러티브이며, 블로그 브랜딩 핵심 자산입니다

## 숫자로 본 현황

| 지표 | 값 |
|------|-----|
| 총 글 | 196 |
| 카테고리 | 6개 (challenge 51, monitoring 46, kubernetes 43, istio 34, cicd 13, argocd 9) |
| 유형 추정 | A(단순 TS) 113 / B(의사결정) 62 / C(학습) 8 / D(기록) 13 |
| 월별 몰림 | 2026-03: 73 / 2026-04: 59 / 2026-02: 2 |
| 평균 글자수 | ~7000자 (카테고리별 6500~8800) |

## 주요 발견 (우선순위 순)

### 🔴 1. istio-part* 4편 중복 (istio findings)

`istio-part1~4` 시리즈가 `istio-intro-part*` 시리즈와 동일 주제를 다루며, **본인이 이미 각 글 상단에 "초기 학습 기록" 경고를 명시**한 상태. 4편 전체가 병합/삭제 후보

- 의사결정 서사 관점: L1 기본이 2회 쓰여진 상태는 "많지만 영양가 없다" 비판 타격점
- 해결: 4편 삭제 또는 `istio-learning-log` 별도 시리즈로 격리

### 🔴 2. goti-meta "스킬 보강" 4편 동일 패턴 (challenge findings)

2026-03-11 같은 날 올린 스킬 보강 회고 4편 (K8s / monitoring / OTel HikariCP / EC2 CD). 동일 구조·톤. 1편으로 병합 가능

- 의사결정 서사 관점: 메타 회고가 반복되면 "자기 복제" 느낌. 병합하면 "AI 스킬 보강 통합 회고"로 질 높아짐
- 4편 → 1편 (3편 감소)

### 🔴 3. Error Tracking Dashboard 2편 동일 날짜 (monitoring findings)

`goti-error-tracking-dashboard-logql-traceql-fix` (order 10) + `goti-error-tracking-dashboard-loki-nodata` (order 11). 같은 날, 같은 대시보드. 독자 관점에선 1편으로 병합 자연스러움

- 2편 → 1편 (1편 감소)

### 🟡 4. Claude vs Gemini 비교 2편 (challenge findings)

`goti-claude-vs-gemini-k8s-pr-176` + `goti-claude-vs-gemini-k8s-pr-192`. 같은 컨셉 2회. 지속 시리즈면 유지, 1회성이면 병합 검토

### 🟡 5. wsl2-k3s-troubleshooting 저가치 의심 (kubernetes findings)

4047자 · 코드 64% · 설명 비중 낮음. 리라이트 또는 삭제

### 🟢 6. 월별 극단적 몰림 — 2026-03 (73편) vs 2026-02 (2편)

**2월 이동 가능 후보 총 ~30편** (카테고리별 합산):
- argocd 2편
- cicd 2편
- challenge 4편
- kubernetes 7~10편
- monitoring 12편

시리즈 중간 편은 제외하고 **독립 글·시리즈 시작점·ADR성 글** 위주로 선정. L3 go-ti 프로젝트 타임라인(2026-01~04) 내에서 자연스러움

### 🟢 7. 서사·컨텍스트 결여 의심 (B 유형, 10편)

자동 플래그 10편 중 3편은 실제 B 유형 문제 글이고 7편은 분류 오탐 (A 유형으로 재분류 가능). Phase 2에서 수동 확정

**실제 리라이트 후보** (추정):
- `multi-repo-cicd-strategy` (2025-10-26) — 대안 비교·프로젝트 맥락 보강
- `goti-queue-poc-performance-comparison` (2026-03-30) — ctx 2로 낮음, 우리 프로젝트 요구 보강
- `queue-poc-loadtest-part3-selection` (2026-04-04) — ctx 1, 선택 이유 + 맥락 보강

## 예상 변동량 (Phase 3 실행 후)

| 구분 | 현재 | 변동 | 이후 |
|------|------|------|------|
| 총 글 수 | 196 | -7~9편 (중복 병합·삭제) | 187~189 |
| 리라이트 | - | 3~5편 | - |
| 2월 신규 배정 | 2 | +~30편 | ~32 |
| 3월 집중 | 73 | -~15편 | ~58 |
| 4월 집중 | 59 | -~15편 | ~44 |

**목표 a(품질)·b(개수 정리) 둘 다 달성 가능**

## 세션 간 복구

이 문서와 `state.md`, `findings-*.md`, `candidates.md`, `criteria.md`를 읽으면 어느 세션이든 재개 가능합니다
