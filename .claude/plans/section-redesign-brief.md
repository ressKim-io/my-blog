# 블로그 글 섹션 디자인 개선 — 작업 브리프

> 새 세션 인수인계용. 이 파일만 보고 작업을 시작할 수 있도록 작성됨

## 목표

블로그 글 본문의 섹션(`## 헤더` 단위)을 **흔한 기술 블로그처럼 시각적으로 잘 구분되게** 개선한다. 지금은 섹션이 칸/박스 없이 헤더+여백으로만 나뉘어, 섹션이 많은 긴 글에서 구조가 잘 안 보인다. **외부 검색으로 좋은 레퍼런스를 참고**해서 개선안을 만든다.

## 현황 (지금 글이 보이는 방식)

- 글 본문은 `src/components/PostDetail.tsx`의 `<div className="prose">` 안에서 MDX로 렌더링
- `.prose` 스타일(`src/app/globals.css` 111~245줄) 기준:
  - 섹션 헤더(`## `) = font-size 1.625rem·굵게 + margin-top 2.75rem. **배경·테두리·박스 없음**
  - `---` = 얇은 가로 구분선 (border-top 1px)
  - 위→아래로 쭉 흐르는 일반 문서 형태
- 칸(박스)처럼 보이는 요소는 인용구(`>` — 연보라 배경+좌측 보라 테두리), 표(테두리 격자), 코드블록(검정 배경)뿐
- 섹션 자체는 독립 칸에 담기지 않음

## 대상 글 구조

- go-ti 기술 해설글 59편: `🤔 무엇을 푸는 기술인가 / 🔧 동작 원리 / 📐 세부 동작 / 🧩 go-ti에서는 / 📚 핵심 정리` 5섹션 + 이모지 헤더
- 트러블슈팅 글: `🔥 문제 / 🤔 원인 / ✅ 해결 / 📚 배운 점`
- **이모지가 섹션 헤더 앞에 붙음** — 디자인 개선 시 이모지와 충돌·중복 없는지 확인 필요
- 전체 규모: essays 100편 + logs 200여 편. `globals.css` 한 곳 수정이 전체 글에 일괄 적용됨

## 핵심 파일

- `src/app/globals.css` — `.prose` 스타일이 본문 디자인 SSOT. 111~245줄에 타이포·헤더·요소 스타일. 색 토큰은 `:root`(--accent `#7C3AED`, --surface, --border 등)
- `src/components/MDXComponents.tsx` — `h2`/`h3` 컴포넌트 (앵커 링크 `#` 부착). 섹션 헤더에 래퍼 div·배경을 넣으려면 여기 수정
- `src/components/PostDetail.tsx` — `.prose` 컨테이너, article 레이아웃 (max-width 720px)

## 제약 (반드시 지킬 것)

- **CLAUDE.md Design Change Rule**: 디자인/레이아웃 변경은 **반드시 ASCII 목업을 먼저 보여주고 사용자 승인 후 코드 작성**. 여러 안이면 각 안을 ASCII로 비교
- 라이트 테마 기준 (블로그는 light only — globals.css 주석 참고)
- 글 300여 편에 일괄 적용되므로, 변경이 짧은 글·긴 글·이모지 헤더·`---` 구분선과 모두 자연스러운지 검토

## 진행 방식

1. **외부 검색** — "기술 블로그 article 섹션 디자인", "blog post section visual hierarchy", "documentation section styling" 등으로 흔히 쓰는 패턴 수집 (예: 섹션 헤더 좌측 액센트 바, 헤더 배경 강조, 섹션 카드 박스, 헤더 위 구분선 등)
2. 검색 결과를 토대로 **2~3개 안을 ASCII 목업으로 제시**해 비교
3. 사용자가 선택·승인하면 `globals.css`(필요 시 `MDXComponents.tsx`) 수정
4. `npm run build`로 검증, `npm run dev`로 실제 렌더링 확인 (`http://localhost:3000/essays/goti-deepdive-pglogical-logical-replication` 등 해설글로 확인)

## 배경

go-ti ADR 28개에서 기술 해설글 59편을 새로 작성·발행한 직후의 후속 작업이다 (직전 작업 기록: `.claude/plans/tech-explainer/inventory.md`·`spec.md`). 섹션이 많은 해설글이 늘어났으므로, 섹션 구분을 시각적으로 강화해 가독성을 높이는 것이 목적이다.
