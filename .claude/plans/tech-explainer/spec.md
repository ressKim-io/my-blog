# go-ti 기술 해설글 — 작성 사양 (spec.md)

> Phase C 산출물 (2026-05-16). blog-writer 서브에이전트가 해설글을 쓸 때 읽는 기준 문서
> 인벤토리·우선순위: `inventory.md` / 계획: `/Users/ress/.claude/plans/lovely-percolating-finch.md`

## 0. 이 글은 무엇인가 — ADR 글과의 차이

- **ADR 글**(기존 27편) = "왜 이 기술을 골랐나" — 배경·대안·기각 이유·결정
- **해설글**(이번 작업) = "그 기술이 무엇이고 내부적으로 어떻게 동작하나" — 동작 원리 중심
- 둘은 공존하며 상호 링크한다. 해설글은 결정 서사를 반복하지 않는다

## 1. 트랙·디렉토리·카테고리

- 트랙: **essays** 고정 (해설글 = 다듬은 개념 정리)
- 경로: `src/content/essays/{category}/{slug}.md`
- category: inventory.md의 각 항목 `category` 값 그대로. 디렉토리와 frontmatter `category` 일치
- DB(PostgreSQL·pglogical·PgBouncer) 항목은 `challenge`

## 2. 네이밍

- 파일명 = slug = **`goti-deepdive-{topic}.md`**
- topic은 영문 kebab-case, ADR 번호 없음. 예:
  - TE-024 → `goti-deepdive-pglogical-logical-replication.md`
  - TE-037 → `goti-deepdive-redis-single-thread-lua.md`
  - TE-057 → `goti-deepdive-kafka-kraft.md`
- 기존 ADR 글(`goti-*-adr.md`)과 slug로 명확히 구분됨. slug는 전역 유일

## 3. Frontmatter

```yaml
---
title: "기술명 — 동작 원리를 드러내는 부제"   # 60자 이내
excerpt: "이 기술이 무엇이고 내부적으로 어떻게 동작하는지 1~2문장"
category: <inventory의 category — 디렉토리와 일치>
tags:
  - go-ti          # tags[0] 절대 규칙
  - <기술명>        # 예: pglogical
  - <세부개념1>
  - <세부개념2>
  - concept        # 유형 메타 — 해설글은 concept (ADR 글은 adr)
series:
  name: "goti-deepdive-<도메인>"   # §5 시리즈 표 참조
  order: <§5 표의 order>
date: "YYYY-MM-DD"   # backdating — inventory.md의 adr_date 그대로
---
```

- **date backdating**: inventory.md `adr_date` 값. 통합 글(TE-005=2026-03-27, TE-036=2026-04-14)은 가장 이른 출처 ADR 날짜
- title 60자 이내. excerpt 1~2문장
- tags[0]은 반드시 `go-ti`, 마지막에 `concept` 포함. 중간은 기술명·세부개념 3~5개

## 4. 글 구조 템플릿 (기술 원리 중심)

```markdown
## 한 줄 요약

> 이 기술이 무엇이고 왜 이렇게 동작하는지 1~2문장

---

## 🤔 무엇을 푸는 기술인가

- 이 기술이 해결하는 일반적 문제 (프로젝트 무관, 교과서적)
- 핵심 개념 정의
- 분량 비중 ~15%

## 🔧 동작 원리

- 내부 구조·메커니즘을 깊게 — 이 글의 본체
- 다이어그램 1~2개로 구조·흐름 시각화
- 구체적 자료구조·프로토콜·알고리즘
- 분량 비중 50% 이상 (가장 김)

## 📐 세부 동작과 옵션  (해당 주제만)

- 모드·파라미터·엣지케이스
- 비교는 markdown 표
- 분량 비중 ~20%

## 🧩 go-ti에서는

- 이 기술을 go-ti에서 어떻게 썼는지 1~2문단 — 의도적으로 짧게
- 끝에 ADR 글 링크 (§7)
- 분량 비중 ~10%

## 📚 핵심 정리

- 일반화된 요점 3~5개 (bullet)
```

- `🔧 동작 원리`가 본체. ADR의 "배경→대안→결정" 4섹션 구조를 쓰지 않는다
- `🧩 go-ti에서는`은 짧게. 결정 과정·트레이드오프는 ADR 글 몫이므로 링크로 넘긴다
- 이모지 헤더는 위 5종(🤔🔧📐🧩📚)만. 장식 이모지 금지

## 5. 시리즈 구조 (7개)

`series.name` + `order`. order는 시리즈 내 ADR 날짜 오름차순

| 시리즈 name | 도메인 | 소속 TE-id (order 순) |
|---|---|---|
| `goti-deepdive-observability` | 관측성 LGTM·OTel | TE-001·002·003·004·005·006·007·008·009·010·011 |
| `goti-deepdive-istio` | Istio 서비스 메시·JWT | TE-012·013·017·053·018 |
| `goti-deepdive-database` | PostgreSQL·복제 | TE-021·022·023·024·025·026·027·028·029·030·031 |
| `goti-deepdive-redis` | Redis | TE-032·033·034·035·036·037·038·039·040·041·042 |
| `goti-deepdive-edge` | Cloudflare·CDN·큐 | TE-015·016·043·044·045·052 |
| `goti-deepdive-runtime` | Go·컨테이너·부하 테스트 | TE-049·050·051·046·047·048 |
| `goti-deepdive-platform` | CI/CD·GitOps·Kafka·스케일링 | TE-056·057·058·014·054·055·019·020·059 |

order는 위 나열 순서대로 1부터. 예: istio 시리즈 → TE-012=1, TE-013=2, TE-017=3, TE-053=4, TE-018=5

- 전체 해설글 모아보기는 `concept` 태그(`/essays?tag=concept`), go-ti 전체는 `tags[0]=go-ti`(`/essays?tag=go-ti`)
- 우선순위 순으로 작성하므로 시리즈에 글이 부분적으로 채워진다 — order는 최종 전체 기준 고정값

## 6. 분량·문체

- 분량(공백 제외 본문): importance 4 주제 2500자 이상, importance 5 주제 3500자 이상. 동작 원리를 깊게 푸는 것이 목적이라 상한은 엄격히 두지 않음 — 다만 한 글이 8000자를 크게 넘으면 주제 범위가 넓은 것이니 분할을 검토
- 표·다이어그램 뒤에는 반드시 상세 설명 — **다이어그램 뒤 최소 2문단(아키텍처 구조도는 3문단+역할 목록 권장), 표 뒤 최소 1~2문장**. "위 그림 참조" 한 줄로 끝내지 않는다 (SKILL.md 분량표 준수)
- 격식체 100% (~합니다/~입니다)
- **★ 문장·문단·bullet 끝에 마침표(.)를 찍지 않는다** — 가장 자주 놓치는 규칙. `~습니다`·`~입니다`·`~합니다` 뒤에 `.` 없음. 표 셀 안 문장도 동일. 예외: 코드블록·인라인 코드 내부, 소수점·버전·URL·약어. `?`·`!`는 유지. **톤 참조 글이 마침표를 쓰더라도 절대 따라하지 말 것**
- 한 문장 50자 이내 권장. 모든 코드블록에 언어 명시 (` ```bash`/` ```yaml`/` ```text` 등)
- 요청 없는 장황한 서론·결론 금지
- ASCII 박스/다단계 흐름 금지 — 다이어그램은 SVG (§9), 디렉토리 트리·1줄 인라인 흐름만 허용

## 7. 상호 링크

- 해설글 `🧩 go-ti에서는` 섹션 끝에 고정 형식으로 ADR 글 링크:

```markdown
> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [<ADR 글 제목>](/essays/<slug>)에 정리했습니다
```

- 링크 경로: inventory.md `짝 ADR 글` 컬럼 참조. `e:`는 `/essays/{slug}`, `l:`는 `/logs/{slug}`
- ADR 글 → 해설글 역링크는 Phase F에서 별도 처리 (해설글 작성 시에는 하지 않음)

## 8. 사실성 규칙 (환각 방지)

- 일반 기술 원리 서술은 공개된 표준 지식 범위에서 자유롭게
- **"go-ti에서 X였다"** 같은 프로젝트 사실은 반드시 출처 ADR draft에 근거. 없는 수치·구성을 지어내지 않는다
- 출처 ADR draft 경로: `drafts/{NNNN}-*.md` (inventory `출처` 컬럼). 통합 글은 출처 ADR 복수
- 웹 검색으로 얻은 내용을 go-ti 사실로 둔갑시키지 않는다

## 9. 다이어그램

- 글당 1~2개 (구조도 1 + 흐름도 1이 표준). importance 5 주제는 최대 3개
- 경로: `public/diagrams/{slug}-{n}.svg` (n=1부터, 평탄 구조)
- 본문 참조: `![설명|tall](/diagrams/{slug}-{n}.svg)` — 다이어그램 이미지는 `|tall` 힌트를 기본 적용 (구조도·흐름도는 크게 봐야 가독)
- 색상: Cocoon 6색 팔레트 (`.claude/plans/diagram-conversion/best-practices.md` §1), 글당 2~4색
- 패턴: best-practices.md §11 (사이클·데드락·워터폴·Before/After 등 9종)
- **SVG 직접 작성이므로 한글 텍스트 사용 가능** (Pretendard 폰트 지정). "텍스트 영어" 규칙은 Draw.io PNG 한정
- 필수: `<svg role="img" aria-labelledby>`, `<title>`, `<desc>`
- blog-writer가 본문과 함께 SVG를 작성. 박스 10개+ 복잡 아키텍처도는 메인 스레드가 별도 작성

## 10. blog-writer 작업 절차

한 blog-writer 호출이 받는 입력:
1. inventory.md의 해당 TE-id 행 (주제·출처 ADR·category·adr_date·동작 원리 키워드)
2. 출처 ADR draft 경로 — `drafts/{NNNN}-*.md` (사실 출처)
3. 이 spec.md 경로
4. 톤 참조용 기존 글 1편 (같은/유사 도메인의 essays 글)
5. 짝 ADR 글 slug·트랙 (상호 링크용)

절차: 출처 ADR 정독 → §4 템플릿으로 본문 작성 → §9 SVG 작성 → frontmatter(§3) →
`src/content/essays/{category}/goti-deepdive-{topic}.md` Write → SVG를 `public/diagrams/`에 Write

## 11. 파일럿 3편 (Phase D)

도메인을 섞어 패턴 검증:
- **TE-024** pglogical 논리 복제 (database, importance 5)
- **TE-037** Redis 단일 스레드·Lua 원자성 (redis, importance 5)
- **TE-057** Kafka KRaft (platform, importance 5)

파일럿 검증 후 이 spec.md를 필요 시 교정하고 Phase E 배치 확장
