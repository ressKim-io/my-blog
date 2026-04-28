# ASCII Cleanup — 작업 폴더

블로그 224편 중 ASCII 박스/화살표 다이어그램이 박혀 있는 글을 시각화 자산(drawio SVG, Mermaid)이나 markdown 표/문장으로 평탄화하는 작업.

## 폴더 구조

| 파일 | 용도 |
|---|---|
| `README.md` | 이 파일 (작업 폴더 안내) |
| `plan.md` | 전체 작업 계획 (Phase 1~4) |
| `state.md` | 진행 상황 todo list (작업 시작 시 항상 먼저 읽음) |
| `criteria.md` | 어떤 ASCII를 어떻게 처리할지 결정 기준 |
| `inventory.md` | 141편 ASCII 블록 인벤토리 (`scripts/scan.mjs`로 자동 생성) |
| `inventory.json` | 인벤토리 raw 데이터 (그룹 분류 등 재처리용) |
| `groups.md` | (Phase 3 진입 시 생성) 그룹별 글 묶음 자동 산출 |
| `decisions.md` | (작업 진행 중) 그룹별 처리 로그 |
| `scripts/scan.mjs` | 인벤토리 자동 추출 + decision 추천 스크립트 |

## 작업 원칙

- **한 번에 하지 않는다**: 시리즈/카테고리 단위로 묶어서 점진적으로 진행
- **분류 → 결정 → 적용 순서**: criteria 확정 전에 본문 수정 금지
- **diff 검토 가능하게**: 큰 변경은 시리즈 단위로 커밋 분리
- **신규 글은 ASCII 금지**: 작업 마무리 시 `CLAUDE.md`에 규칙 추가

## 사용 방법

```bash
# 인벤토리 재생성 (글 추가/수정 후)
node .claude/plans/ascii-cleanup/scripts/scan.mjs

# 진행 상황 확인
cat .claude/plans/ascii-cleanup/state.md
```
