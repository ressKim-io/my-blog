# 추가 그림의 통합 검증

검증일: 2026-10-26
기준 커밋: `bd696ac17cae6855a34562160b5f4bd9f47cd206`
범위: 본문 8편, 새 SVG 8개, `docs/structure-review/diagrams/` 작업 기록

## 내용과 시각 검토

제작 A·B와 분리된 검토자가 8편 모두 수정 본문 전문과 새 그림을 먼저 읽었습니다
이후 작업 시작 원문·기존 그림·승인 목업을 대조하고 기술 조건·본문 연결·중복을 확인했습니다
560px desktop과 335px mobile PNG 16개를 실제로 열어 글자·선·방향·겹침·잘림을 확인했습니다
메인도 mobile 8장과 본문 삽입 diff를 확인했습니다

메인 검토의 반송 사항은 모두 해결했습니다

- 자원 계산: 요청 자체가 실행되는 듯한 제목을 실행 구간별 요청 합계로 명확히 했습니다
- 스냅샷: 원본 볼륨과 생성 요청 사이의 입력 관계에 `소스`를 표시했습니다
- 본문과 접근성 설명: 반복되는 새 연결 문장 3개를 제거하고 B 그림의 desc를 격식체로 맞췄습니다

반송 이후 수정 부분과 앞뒤 흐름을 독립 검토자가 재확인했습니다
최종 내용 검토는 8/8 완료이며 미해결 사항은 없습니다
상세 근거와 글별 상태는 [독립 검토](independent-review.md)에 있습니다

메인 연결 확인에서는 자원 집계·HPA·메모리 회계·NUMA·NAT·MTU·CRD·스냅샷이 서로 다른 관계를 설명하는지 확인했습니다
기존 컴포넌트 흐름도와 함께 읽을 때 실행 구간·주소 전후·크기 경계·위치·API/실물 관계를 추가하며, 기존 그림을 다시 그리지 않았습니다
새 가정 설명은 자원 집계와 CRD 두 편에만 남겼고 나머지는 앞 문맥 뒤에 그림을 직접 연결했습니다

## 실제 실행 결과

| 검사 | 결과 |
|---|---|
| MDX 컴파일 | 8/8 통과, 실제 렌더러의 remark-gfm·remark-cjk-friendly 옵션 사용 |
| 본문 로컬 링크·이미지 | 36개 대상·anchor 검사 통과 |
| 작업 Markdown 링크·공백 | 검사 통과 |
| SVG XML·접근성 메타·ID 참조 | 8/8 통과 |
| 기존 front matter·코드·본문 줄 순서 | 8/8 보존, 기존 내용 삭제 없음 |
| 기존 SVG·사이트 코드·과거 manifest 등 범위 밖 추적 파일 | 1,952개 SHA256 유지 |
| 글 lint | exit 0, error 0·warn 17 |
| ESLint | exit 0, error 0·warning 1 |
| publication 테스트 | exit 0, 4개 통과 |
| Next.js 정적 빌드·postbuild | exit 0, 670개 정적 페이지 및 sitemap·robots·RSS·llms.txt 생성 |
| 대상 빌드 HTML의 새 이미지 | 8/8 정확히 한 번 참조, alt의 크기 힌트 제거 확인 |
| 빌드 SVG와 검토한 원본 SVG | 8/8 바이트 단위 일치 |
| 본문·SVG·Markdown의 diff 공백 검사 | 통과 |

[MDX·보존·링크 결과](validation.json), [SVG 검사](svg-validation.json), [빌드 출력 대조](build-output.json)를 저장했습니다
내용·시각 검토를 lint 통과로 대신하지 않았습니다

### 실행 명령과 환경

```bash
node /tmp/k8s-diagrams-validate.mjs
python3 /tmp/k8s-diagrams-svg-check.py
node scripts/lint-post.mjs <대상 8개 source 경로>
npm run lint
node --test scripts/publication.test.mjs
./node_modules/.bin/next build && node scripts/postbuild.mjs
git diff --check
```

기준 원문과 보호 해시는 `/tmp/k8s-add-diagrams-baseline/`에 보관해 대조했습니다
새 그림의 최종 SHA256은 검증 JSON에, 독립 검토한 파일의 SHA256은 [검토 JSON](independent-review.json)에 있습니다
기존 `sharp` 0.34.5로 PNG를 렌더했고 새 의존성은 추가하지 않았습니다
PNG는 `/tmp/k8s-diagram-renders/`에 있으며 [제작 A](production-a.md)와 [제작 B](production-b.md)에 개별 경로를 기록했습니다

`npm run build`의 prebuild는 범위 밖 `CLAUDE.md`를 갱신하므로 package.json의 build 본문을 직접 실행했습니다
이전 작업에서 확인한 Turbopack의 샌드박스 로컬 포트 바인딩 제한 때문에 이번 빌드는 승인된 제한 밖 실행으로 수행했습니다
사이트 코드·빌드 설정은 변경하지 않았습니다

### 경고 구분

- 글 lint는 추가 전 error 0·warn 9에서 추가 후 error 0·warn 17로 바뀌었습니다. 기존 문장 길이 경고 8개와 기존 SVG 경고 1개는 유지됐고, 새 SVG 8장의 text 노드 수가 목표 16개를 넘는 경고가 추가됐습니다. 수치·주소·조건 라벨을 삭제하지 않고 335px 렌더로 가독성을 별도 확인했습니다
- ESLint의 1개 경고는 기존 `src/app/layout.tsx:80`의 `@next/next/no-page-custom-font`입니다
- 빌드의 Node `module.register()` deprecation 경고가 있었으며 컴파일·TypeScript·정적 생성은 성공했습니다
- 커밋 준비 중 원시 로그까지 포함한 `git diff --cached --check`는 exit 2였습니다. build.log의 진행 출력 3줄에 남은 공백·CR과 eslint.log의 마지막 빈 줄 때문입니다. 로그 원형은 보존했고 로그를 제외한 본문·SVG·Markdown의 공백 검사는 통과했습니다

로그: [글 lint 기준](checks/post-lint-baseline.log) · [글 lint 최종](checks/post-lint.log) · [ESLint](checks/eslint.log) · [publication 테스트](checks/publication-test.log) · [빌드](checks/build.log)

## 범위와 남은 사항

승인된 8장 제작·본문 삽입·독립 검토·실행 검증에서 남은 항목은 없습니다
기존 구조 검토 manifest와 원문 해시는 과거 기준 그대로 보존했습니다
이번 원문 보존 검사는 새 기준 커밋과 별도 검증 기록을 사용했습니다
기술 동작의 클러스터 재현, 실제 패킷 캡처·etcd 저장 바이트·CSI 복원 실험은 실행 안 함입니다
이 문서는 게시 전 로컬 검증 시점의 기록입니다
해당 시점에는 커밋·push·배포 및 이번 변경의 실제 블로그 반영 확인을 실행하지 않았습니다
