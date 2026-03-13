---
date: 2026-03-03
category: meta
project: goti-team-controller
tags: [command, review-pr, code-review, gemini-gap, agent-improvement]
---

# /review-pr 커맨드 — Gemini 갭 분석 기반 3개 에이전트 학습 체크 추가

## Context
Goti-k8s PR #11~#14 멀티 관점 리뷰 수행 중, 매 PR마다 Gemini가 잡고 Claude가 놓치는 항목 5건 누적.
review-gaps.md에 기록된 갭 패턴을 분석하여 /review-pr 커맨드의 에이전트 프롬프트를 개선.

## Issue
3가지 근본 약점 확인:
1. **보안 에이전트 "works = OK" 편향**: 동작하면 OK로 판단, 습관/컨벤션 수준 보안 경고 누락
   - 예: `image.tag: "latest"` (PR #12), dev 환경 `insecure: true` (PR #11)
2. **패턴 에이전트 파일 내부 일관성 미체크**: cross-file DRY만 검사, 같은 파일 내 형식 혼용 미발견
   - 예: FQDN vs short name 혼용 (PR #11), Makefile 내부 하드코딩 (PR #14)
3. **보안 에이전트 패턴 집계 부재**: 개별 항목은 지적하되 전체적 패턴(여러 그룹에서 kind:* 반복) 미인식
   - 예: AppProject kind:* 와일드카드 남용 (PR #13)

## Action
`.claude/commands/review-pr.md`에 3개 에이전트 모두 "학습된 추가 체크 (review-gaps 기반)" 섹션 추가:

### Agent 1 (보안 + 권한) — 4개 체크
- `image.tag: "latest"` 무조건 경고 (의도적이라도 주석 사유 요구)
- `kind: "*"` 와일드카드 2개 이상 API 그룹 사용 시 "전체적 최소 권한 위반" 상위 경고
- dev 환경 보안 비활성화(`insecure: true`, TLS 끔) 시 "dev 한정" 명시 또는 대안 제시 요구
- stdout에 비밀번호/토큰 직접 출력하는 스크립트 경고

### Agent 2 (운영 + 성능) — 4개 체크
- Makefile/스크립트 내 하드코딩 설정값(namespace, 서비스명, 포트) → 변수 중앙화 가능 여부
- 스크립트 안전성: `trap` cleanup, background process 정리, 변수 quoting(`"${VAR}"`)
- 환경변수 fallback 패턴 `${VAR:-default}` 미사용 시 경고
- Makefile 변수 선언 `?=` vs `:=` 적절성 검토

### Agent 3 (패턴 + 일관성) — 4개 체크
- 파일 내부 서비스 주소 형식 일관성 (FQDN vs short name 혼용 검출)
- DRY 범위 확장: cross-file뿐 아니라 file-internal 하드코딩 문자열도 변수 추출 체크
- 변수 quoting 일관성: 같은 파일 내 `$VAR` vs `"$VAR"` vs `${VAR}` 혼용 경고
- Makefile ↔ 스크립트 간 설정값 동기화 여부

## Result
- 총 12개 학습된 체크 항목이 /review-pr 프롬프트에 반영
- 다음 PR부터 3개 에이전트가 자동으로 갭 패턴을 체크
- Gemini 대비 누락률 감소 기대 (5건 갭 모두 커버하는 체크 포함)
- 갭 추적 → 분석 → 프롬프트 개선 사이클 1차 완료

## Related Files
- `.claude/commands/review-pr.md` — 3개 에이전트 학습 체크 추가
- `docs/review-gaps.md` — 누적 갭 5건 (PR #11~#14)
- `docs/dev-logs/sessions/2026-03-03-session-2.md` — 갭 분석 세션 기록
