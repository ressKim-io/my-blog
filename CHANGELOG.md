# Changelog

이 블로그의 주요 변경 이력입니다.

## 2026-05-17

### 메인 페이지 V2 리디자인 + 시리즈 페이지

- 홈을 **시리즈 쇼케이스 + 카테고리 탭 피드** 구조로 전면 재작성 — 기술 해설 7개 시리즈(59편)를
  첫 화면에서 1클릭 거리로 노출
- `/series` 인덱스·`/series/[id]` 상세 라우트 신설. 헤더에 `Series` 메뉴 추가
- 신규: `src/lib/series.ts` + `SeriesCard`·`SeriesFeaturedCard`·`SeriesShowcase`·
  `SeriesRailMobile`·`HomeCategoryFeed` 컴포넌트
- 모바일 시리즈 가로 스와이프 레일 (CSS scroll-snap)

### RSC 페이로드 경량화

- 클라이언트 컴포넌트로 글 본문(`content`)이 직렬화되던 문제 수정 — 헤더 검색·글 목록·프로젝트 뷰 3곳
- `posts.ts`에 `getSearchIndex()`·`getEssaysList()`·`toListItem()`·`PostListItem` 추가
- 결과: `projects/go-ti` 3.2MB → 375KB, `/essays` 1.58MB → 271KB, 전 페이지 검색 인덱스 약 106KB↓

### 글 본문 섹션 헤더 밴드

- `.prose h2` 섹션 헤더에 연보라 배경 밴드 + 좌측 액센트 바 적용 — 섹션 구분·가독성 강화
- `## ` 헤더 앞 중복 `---` 구분선 자동 숨김 (`hr:has(+ h2)`)

### 콘텐츠

- go-ti 기술 해설글 59편 발행 — deepdive 7개 시리즈 (Redis·관측성·데이터베이스·플랫폼·런타임·Edge·Istio)
- SVG 다이어그램 100여 개 추가, 기존 ADR 글에 해설글 역링크
