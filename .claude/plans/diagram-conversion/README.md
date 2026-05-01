# Diagram Conversion 작업 폴더

ASCII keep 블록 105개를 SVG 다이어그램으로 변환하는 작업 워크스페이스입니다. ASCII Cleanup(`.claude/plans/ascii-cleanup/`)의 후속 작업입니다.

## 파일 구성

- `README.md` — 이 파일
- `plan.md` — Phase 1~6 전체 계획 (그룹 산출, 진행 단위 권장)
- `state.md` — todo list (재개 시 진입점, 체크박스로 진행 추적)
- `best-practices.md` — 디자인 토큰·접근성·반응형 규칙 (외부 검색 정리, 작업 시 참조)
- `decisions.md` — 그룹별 처리 결정 로그 (Phase 진행하며 누적)

## 재개 방법

1. `state.md` 열어 가장 위의 미완료 그룹 확인
2. `plan.md`의 해당 그룹 작업 절차 확인
3. `best-practices.md`로 디자인 토큰 참조
4. 작업 후 `state.md` 체크박스 업데이트, 그룹 단위 commit

## 운영 패턴

`.claude/plans/audit/`, `.claude/plans/ascii-cleanup/`과 동일한 패턴(README/plan/state/criteria/decisions)으로 운영합니다.
