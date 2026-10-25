# 본문 구조 편집의 최종 검증 결과

검증일: 2026-10-25

대상 71편의 본문 수정과 독립 검토를 각각 완료했습니다
현재 본문 SHA256이 수정 기록·독립 검토 기록과 71편 모두 일치하며 미해결 편집 사항은 0건입니다
범위는 71편의 본문과 `docs/structure-review/` 진행 기록입니다

## 내용 검토

PVC 바인딩 글 B02를 먼저 편집하고 독립 검토·반송·재확인을 거친 뒤 나머지 묶음을 진행했습니다
수정 담당은 원문 전문과 검토서를 읽고 연결 계획을 기록했습니다
독립 검토자는 글별 검토서·수정 기록보다 수정 본문 전문을 먼저 읽고, 이후 원문 전문과 검토서를 대조했습니다
발견 문제는 위치·독자가 막히는 이유·수정 방향을 기록해 수정자에게 돌려보냈고, 보완 뒤 해당 부분과 앞뒤 문맥을 다시 읽었습니다

| 항목 | 결과 |
|---|---|
| 본문 수정 | 71/71, 36개 묶음 |
| 독립 검토 | 71/71, review_a 25편·review_pilot 46편 |
| 최종 본문·수정 기록·검토 기록 SHA256 | 71/71 일치 |
| 미해결 편집 사항 | 0건 |
| 메인 연결 검토 | 6개 시리즈 전체의 도입·핵심 관련 절·글 사이 연결 대조 |
| 동일 산문 단락 보조 검사 | 새로 늘어난 100자 이상 동일 단락 0개 |

[글별 목록](../index.md)에서 수정 완료와 독립 검토 완료를 따로 확인할 수 있습니다
묶음별 편집 판단과 독해·반송 기록은 `edits/`와 `reviews/`, 메인 대조는 [글 사이 연결 검토](integration-review.md)에 있습니다
기술 주장 보존은 독립 검토의 원문 대조로 확인했고, 아래 자동 검사는 코드·메타데이터·참조 등 기계적으로 비교할 수 있는 항목을 보조합니다

## 실제 실행 검증

| 검사 | 실행 결과 |
|---|---|
| MDX 컴파일 | 71/71 통과, 실제 렌더러의 remark-gfm·remark-cjk-friendly 설정 사용 |
| 본문 로컬 링크·이미지 참조 | 250개 대상 존재 확인, 본문 Markdown anchor 검사 통과 |
| 구조 검토 문서 링크·줄 끝 공백 | 512개 대상 존재 확인, 오류 0 |
| front matter | 71편 원문과 바이트 단위 일치 |
| 코드 fence·기존 외부 출처 URL·이미지 경로 | 원문 대비 누락·변경 없음. 코드 블록은 순서 이동을 허용해 내용 비교 |
| 기준 manifest | 작업 시작 사본과 바이트 단위 일치 |
| 범위 밖 추적 파일 | 1,646개 SHA256 유지 |
| 글 lint | exit 0, error 0·warn 81, 71편 |
| ESLint | exit 0, error 0·warning 1 |
| publication 테스트 | exit 0, 4개 통과 |
| Next.js 정적 빌드·postbuild | exit 0, 전체 670개 정적 페이지 생성 및 sitemap·robots·RSS·llms.txt 생성 성공 |
| 대상 HTML 출력 | 71/71 `/essays/{slug}/index.html` 생성, 각 문서 h1 존재 확인 |
| git diff --check | exit 0 |

검사 결과는 [보존·링크·MDX JSON](validation.json)과 [최종 상태·HTML JSON](final-status.json)에 저장했습니다
내용 검토 통과를 lint 통과로 대신하지 않았고, HTML 존재 검사를 화면 육안 검수로 보고하지 않습니다

실행한 주요 명령은 다음과 같습니다

```bash
node /tmp/k8s-structure-validate.mjs
python3 /tmp/k8s-structure-duplicates.py
node scripts/lint-post.mjs <manifest의 71개 source 경로>
npm run lint
node --test scripts/publication.test.mjs
./node_modules/.bin/next build && node scripts/postbuild.mjs
git diff --check
```

글 lint의 인자는 Python에서 manifest의 `items[].source`를 읽어 subprocess argv로 넘겼습니다
MDX·보존 검사와 동일 단락 검사는 작업용 임시 스크립트로 실행했고, 최종 결과 JSON과 아래 로그를 저장했습니다
검사 기준 원문은 commit `d747a3b1767850670e50cc4cb58d357be019d282` 및 변경하지 않은 manifest의 SHA256입니다
원문 사본과 범위 밖 보호 해시는 작업 중 `/tmp/k8s-structure-20261025-baseline/`, `/tmp/k8s-structure-20261025-protected.json`을 사용했습니다

### 빌드 환경과 경고

`npm run build`의 prebuild 훅은 `scripts/update-stats.mjs`로 범위 밖 `CLAUDE.md`를 갱신합니다
그래서 package.json의 build 명령인 `next build && node scripts/postbuild.mjs`를 직접 실행해 prebuild만 제외했습니다
첫 빌드는 샌드박스가 Turbopack의 로컬 포트 바인딩을 막아 `Operation not permitted (os error 1)`로 실패했습니다
같은 빌드를 샌드박스 제한 밖에서 다시 실행했고 성공했습니다. 사이트 코드나 빌드 설정을 바꾸지 않았습니다

- 글 lint의 81개 경고는 문장 길이 통계 71개와 기존 SVG의 text 노드 수 10개입니다. 이유·조건을 길이 기준으로 잘라내거나 기존 자산을 변경하지 않았습니다
- ESLint 경고는 기존 `src/app/layout.tsx:80`의 `@next/next/no-page-custom-font`입니다. 이 파일은 변경하지 않았습니다
- 빌드 중 Node의 `module.register()` deprecation 경고가 있었습니다. 빌드·TypeScript 검사·정적 페이지 생성은 성공했습니다

로그: [최종 빌드](checks/build.log), [최초 빌드 실패](checks/build-sandbox-failure.log), [글 lint](checks/post-lint.log), [ESLint](checks/eslint.log), [publication 테스트](checks/publication-test.log)

## 과거 검토 기준 검사의 실패 구분

기존 `verify.py`는 편집 전 원문과 최초 검토서의 행 번호·목차·미착수 상태를 검사합니다
최종 본문에 그대로 실행한 결과는 **exit 1 / FAIL**입니다
원문 해시 변경 71편, 행 수 변경 59편, H2 구조 변경 71편, 이동한 원문 인용 위치와 편집 상태 차이 때문에 실패합니다
기준 manifest와 검사를 바꿔서 통과시키지 않았습니다

추가로 `reviews/B16.md`의 `eviction TODO`를 빈 작성 표시로 감지했습니다
이는 원문에 있는 DRA node-allocatable claim 자원량 미반영 TODO를 보존했다는 검토 기록이며, 미작성 편집 항목이 아닙니다
이 검증 문서에서도 같은 표기를 인용하므로 같은 검사에 잡힙니다
또한 원시 `checks/build.log`의 진행 출력에 포함된 줄 끝 공백을 검출합니다. 빌드 로그는 원형을 보존했으며 게시 본문이나 Markdown의 공백 오류는 아닙니다
이 검사 결과를 숨기지 않고 [원시 결과](checks/frozen-verifier.json)에 보관했습니다
최종본의 보존·링크·MDX와 진행 상태는 위 별도 검사로 확인했습니다

```bash
python3 docs/structure-review/verify.py --protected /tmp/k8s-structure-20261025-protected.json
```

## 남은 범위와 한계

요청한 71편의 편집·독립 검토에서 남은 글이나 미해결 편집 사항은 없습니다
원문의 기술 주장 전수 외부 재검증, 모든 외부 URL의 현재 HTTP 응답 확인, 클러스터 재현, 실제 초보 독자 대상의 읽기 시험은 실행 안 함입니다
기존 문서·구현 차이와 미확인 사항은 [기술 재확인 범위](technical-followup.md)에 보존했습니다
slug·날짜·시리즈 순서·기존 자산·사이트 코드는 변경하지 않았습니다
commit·push·배포는 실행하지 않았습니다
