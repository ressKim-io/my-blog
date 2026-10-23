# ☸️ k8s-theory 시리즈 변환 계획

> Obsidian vault의 Kubernetes 이론 노트를 한국어 `essays` 글로 변환하는 계획
> **2026-10-24 갱신: 누적 71편 검수 완료. 현재 후속 요청 15/15편 완료·보류 0편**
> 9월 조사 당시 50편, 2026-10-21에 확인한 `sessions/*.md`는 71개. 파일 존재를 확인한 수이며 내용 검수 완료 수가 아님

관련 문서 — `README.md`(진입점) · `inventory.md`(원본 전수) · `source-format.md`(변환 지침)

## 다음 채팅의 시작점

1. 저장소 [AGENTS.md](../../../AGENTS.md)와 [CLAUDE.md](../../../CLAUDE.md), [공통 말투·편집 기준](../../../docs/writing-voice.md)을 읽는다
2. 사용하는 도구의 `draft-to-post` 스킬을 읽는다
   - Codex: [스킬 진입점](../../../.agents/skills/draft-to-post/SKILL.md)
   - Claude: [변환 스킬](../../skills/draft-to-post/SKILL.md)
3. 이 계획의 절대 제약·변환 절차와 [원본 변환 지침](source-format.md)을 읽고, 7절의 다음 배치를 진행한다

문체는 공통 기준을 우선한다. 과거 계획의 문단 수·SVG 개수·고정 맺음말 요구는 적용하지 않는다
**이전 요청의 Batch 07~16은 30편 검수·로컬 커밋 완료. 현재 후속 요청은 Batch 17~21의 남은 15편을 3편씩 진행한다**
Batch 01·02는 3편, Batch 03~06은 5편씩 진행한 이력이다
각 배치는 blog-writer 3명 분담 → 별도 blog-reviewer 검수 → 지적 수정 → post lint·전체 lint·build·정적 출력 검증 → 로컬 커밋 순서로 진행한다
배치마다 승인 대기를 하지 않는다. 보류 편은 이유를 기록하고 완료 수에서 제외하며 독립 작업은 계속한다
push·배포·시리즈 카드 등록은 범위 밖이다
작성자는 자기 글과 해당 slug의 SVG만 수정하고, 공통 진행표와 최종 검증은 주 담당자가 관리한다
이미 요청된 범위의 문체·slug·편집 선택은 진행하면서 기록한다

---

## 0. 절대 제약 — 실습하지 않은 노트다

원본 `☸️ LAB TODO.md` 첫 줄에 명시되어 있다.

> **쌓아두는 곳.** 이 프로젝트에서는 실습을 하지 않는다.
> 홈랩(Ubuntu + GPU, KinD)에서 한 번에 소화한다.

2026-09-08 조사에서는 LAB TODO 478건이 전부 미실행이었다
이 시리즈는 소스 코드와 공식 문서를 읽고 정리한 이론 해설로 변환한다
현재 첫 3편에는 `release-1.35` 링크가 남아 있지만, 이를 전체 시리즈의 현행 기준으로 확정하지 않는다
배치마다 원본·공식 자료의 버전과 근거를 확인한다

노트 품질이 높아서 실무 기록처럼 읽히기 쉬운 게 바로 위험 지점이다.

### 금지

- "관찰했습니다" · "재현했습니다" · "장애가 났습니다" 류의 실측 서사
- 측정값 · 수치 · 타임라인을 지어내는 것
- 실무 사례로 읽히게 만드는 도입부

### 대신

근거를 소스 경로와 공식 문서에 둔다. 원본이 이미 `[S] staging/src/k8s.io/...` 경로와
문서 URL을 갖고 있으므로 실제 경로와 설명을 대조해 인용한다
원본에 링크가 있다는 사실만으로 그 주장이 검증된 것은 아니다

각 글 상단에 근거 등급을 고지한다 (→ `source-format.md` 7절).

홈랩 실습을 나중에 하면 그 결과는 **별도 logs 트랙 글**로 쓴다.
이 시리즈 본문에 소급해서 끼워 넣지 않는다.

### 추가로, 원본이 근거를 못 잡은 3건

9월 조사에서 남긴 항목은 3-4의 DNS `3 retries`, 4-3의 강제 detach 대기 시간, 5-5의 metrics-server 서술이다
최신 노트에서 해결되었는지는 해당 배치에서 다시 확인한다
원본이 「확인 못 함」으로 유보한 것을 블로그에서 단정형으로 바꾸면 사실 오류가 된다.
상세는 `source-format.md` 8절.

---

## 1. 확정된 방향

| 항목 | 결정 | 근거 |
|---|---|---|
| 원본 취급 | vault는 **읽기 전용**, 블로그 저장소로 복사해 변환 | 노트의 `종료 조건 판정`·`LAB TODO`·`SOURCE DIVE`는 학습 도구로서 가치가 있다. 블로그용으로 고치면 망가진다 |
| ASCII 처리 | **선별 평탄화** — 표/인라인/` ```text `로 내리고 시각화가 필요한 흐름은 SVG | 현행 AGENTS.md·CLAUDE.md ASCII 정책 적용. `source-format.md` 5절은 과거 원본의 분류 사례 |
| 다이어그램 라벨 | **한글**, 기술 용어(authn·APF·GVR 등)는 원어 유지 | 본문이 한글이라 영어 라벨은 이질적. 원본의 영어는 학습용 표기였다 |
| 진행 순서 | **Phase 1부터 원본 좌표 순서로 3편씩**, Phase별 시리즈 6개 | 한 배치에서 원본 확인·작성·검수·진행 기록까지 마친다 |
| 트랙 | `essays` | 다듬은 개념 해설이다. 트러블슈팅 노트가 아니다 |

---

## 2. 원본 현황과 다시 확인할 범위

2026-10-21에 실제 파일명을 확인한 결과다

| 구분 | 현재 원본 파일 수 | 9월 조사 |
|---|---:|---:|
| Phase 1 | 23 | 16 |
| Phase 2 | 19 | 14 |
| Phase 3 | 11 | 7 |
| Phase 4 | 7 | 4 |
| Phase 5 | 6 | 6 |
| 커널 하강 | 5 | 3 |
| 합계 | 71 | 50 |

[inventory.md](inventory.md)는 **2026-09-08의 조사 기록**으로 보존한다
그 문서의 50편·줄 수·코드블록 수·확장 대기 목록을 현재 상태로 사용하지 않는다
한 학습 좌표가 `.1/.2`로 나뉠 수 있으므로 학습 항목 수와 실제 파일 수를 구분한다

Vault의 `2026-10-05 세부 학습 글 편집 계획과 인계.md`도 확인한다
여기에 과거 검수 이력, 독자 관점의 보완 기준, 오래된 v1.35 고정을 현재 기준으로 가져오지 말라는 주의가 있다
Vault 원본 편집 작업과 이 블로그 변환 작업은 별개다. 원본의 완료 표시를 블로그 검수 완료로 옮기지 않는다

매 배치 시작 시 대상 3편의 최신 저장본과 관련 progress·source-map을 확인한다
기록한 원본 hash와 다르면 변경 구간을 먼저 읽는다. 대상 밖의 원본을 매번 전수 재분석하지 않는다

---

## 3. 시리즈 매핑과 기본 편집 결정

| 시리즈 name | 현재 원본 수 | 대응 | 주제 |
|---|---|---|---|
| `k8s-theory-api` | 23 | Phase 1 | 요청 경로, authn/authz, admission, resourceVersion, informer, APF, 직렬화 |
| `k8s-theory-node` | 19 | Phase 2 | 스케줄러, QoS/cgroup, eviction, kubelet, CRI/OCI, 장치 자원, 런타임 격리 |
| `k8s-theory-network` | 11 | Phase 3 | CNI, sandbox/pause, Service/kube-proxy, DNS, Ingress/Gateway, NetworkPolicy |
| `k8s-theory-storage` | 7 | Phase 4 | PVC 바인딩, CSI, attach/stage/publish, StatefulSet 볼륨 |
| `k8s-theory-extension` | 6 | Phase 5 | CRD, conversion, controller-runtime, 정책 계층, Aggregated API server |
| `k8s-theory-kernel` | 5 | 커널 하강 | cgroup/CFS, netfilter/conntrack, mount, 페이지 캐시·OOM, namespace 수명 |

- 경로는 `src/content/essays/kubernetes/k8s-theory-<topic>.md`를 기본으로 한다
- 시리즈 이름은 위 표를 기본값으로 사용하고 기존 글과 충돌하는지만 확인한다
- `series.order`는 시리즈별 1부터 원본 좌표 순으로 부여한다. 원본 좌표는 별도 진행표에 보존한다
- 추가 노트가 생기면 미변환 목록에 반영한다. 이미 연결된 slug·order를 일괄 변경하지 않는다
- 원본 1편을 블로그 1편으로 변환하는 것이 기본이다. 명확한 내용 중복·분할 필요가 발견되면 범위와 이유를 기록한다
- `date`를 원본 학습 완료일이나 배포일로 임의 해석하지 않는다. 저장소 규칙에 맞춰 작성 기준일을 넣고 실제 배포 여부는 따로 기록한다

---

## 4. 이 시리즈에 적용할 말투

상세 기준은 [docs/writing-voice.md](../../../docs/writing-voice.md)에만 유지한다
Codex와 Claude 모두 같은 문서를 읽고 아래처럼 이론 해설에 적용한다

- 원본의 질문, 설명 순서, 판단 근거를 살린다. 개인 경험이 없는 글에는 실패담·감정·실습 경험을 만들지 않는다
- 본문은 `~합니다`, `~입니다`로 쓴다. 짧은 원문 독백은 인용으로 남길 수 있지만 새로 꾸며 넣지 않는다
- `그런데`, `이때`, `그래서`처럼 평범한 연결어를 쓰고, 무엇이 무엇을 바꾸는지 주체와 동작을 드러낸다
- 기술 용어·필드·명령어·심볼은 정확하게 보존한다. 용어는 첫 등장에 풀어 쓰고 영어 문장 구조나 비유를 기계적으로 번역하지 않는다
- 과장, 직역, 근거 없는 단정, 반복 안내, 설명 없는 내부 식별자를 문맥으로 점검한다
- 문장·문단·bullet 끝 마침표를 생략한다. URL·버전·코드 내부는 예외다. 50자는 참고치이며 조건과 인과관계를 잘라 맞추지 않는다
- 짧은 문장과 이유를 설명하는 문장을 섞는다. 표 뒤 문단 수, 편당 그림 수, 매 절의 도입·결론을 채우지 않는다
- 이론 글의 시작은 구체적인 질문과 상황으로 충분하다. `실무에서 직접 겪었습니다` 같은 경험 서사를 붙이지 않는다
- 문체를 고치며 사실·버전·적용 조건·미확인 사항을 삭제하지 않는다

예를 들어 원본이 “요청 본문을 아직 읽지 않아 필드 값을 판단할 수 없다”는 내용이라면,
“정교한 권한 계층이 완벽한 안전망을 제공합니다”로 바꾸지 않는다
“이 단계에서는 요청 본문을 아직 읽지 않았습니다 / 그래서 필드 값은 판단할 수 없습니다”처럼 기전을 설명한다
이는 문장 구조의 예시이며 실제 단계와 주장은 해당 편의 소스로 확인한다

---

## 5. 3편 단위 변환 절차

### 배치 시작

1. 7절의 진행표에서 **검수 완료되지 않은 다음 3편**을 고른다. 마지막에 1~2편만 남으면 남은 편수로 진행한다
2. 대상 파일·예상 SVG·이 계획의 진행 기록을 수정할 범위와 검증 계획으로 알린다. 매 편 승인 대기를 추가하지 않는다
3. Vault 원본은 읽기 전용으로 읽는다. 파일명·좌표·읽은 날짜·SHA-256과 대응 slug·series/order를 진행 기록에 남긴다
4. 각 편에서 핵심 질문, 보존할 기전·조건·출처, 미확인 주장을 추린다. 3편이 나눠 설명할 경계를 정해 같은 도입을 반복하지 않는다

### 한 편씩 작성

1. 원본을 전문으로 읽고 [source-format.md](source-format.md)에 따라 블로그 독자용으로 재구성한다. 평서체 어미만 바꾸는 작업으로 끝내지 않는다
2. 공식 문서·소스에서 버전, API·플래그·기본값과 핵심 주장을 확인한다. 원본 버전과 현재 문서가 다르면 차이를 구분한다
3. 확인한 소스 ref와 URL을 남긴다. 가능한 경우 불변 commit 링크를 사용한다. 확인하지 않은 브랜치나 버전을 고지에 넣지 않는다
4. 설명에 필요한 표·코드·SVG를 만들고 근거 고지와 front matter를 작성한다
5. Vault wikilink는 실제 존재하는 블로그 링크로 바꾸거나 필요한 설명으로 풀어 쓴다. 미작성 글의 URL을 만들지 않는다
6. 원본과 대조해 의미·조건·출처를 검수하고, 공통 기준으로 문체를 검수한다. 고친 부분은 최소 수정으로 반영한다
7. 해당 글에 `npm run lint:post -- <파일>`을 실행한다. 실제 형식 오류를 고친 뒤 다음 편으로 간다

첫 편에서 얻은 용어·문체 선택을 같은 배치의 나머지 글에도 적용한다
원본 파일 누락이나 핵심 근거 충돌이 있으면 해당 편을 보류하고 이유를 기록한다
진행 가능한 다른 편은 계속 처리하되, 보류한 글을 완료 처리하거나 별도 글로 몰래 대체하지 않는다
3편은 처리 단위다. blog-writer 에이전트 3명이 분담하고 별도 blog-reviewer가 검수한다
공통 파일과 최종 통합 검증은 주 담당자가 맡는다

### 배치 마감

- 3편 사이 용어·설명 범위·시리즈 순서와 중복을 확인한다
- front matter, 이미지 참조·SVG 표시, 내부 링크와 코드블록 언어를 확인한다
- 형식 lint와 별도로 사실·문체 검토를 한다. 검토 항목은 `원문 → 문제 이유 → 최소 수정안`으로 정리한다
- `npm run build`를 실행한다. 못 실행했거나 실패한 검사는 그대로 보고하고 검수 완료로 처리하지 않는다
- 빌드 훅이 통계 등 다른 파일을 바꾸면 이번 작업에서 생긴 자동 변경만 확인해 정리한다. 기존 사용자 변경은 보존한다
- 7절의 배치·편별 상태, 실제 검사 결과, 보류 이유, 다음 3편을 갱신한다
- 사용자에게 완성 글 경로, 대표 문장 전후 비교, 확인이 남은 주장, 검사 결과와 다음 대상을 전달한다
- 현재 요청은 **3편씩 5개 배치, 남은 15편**을 처리한다. 배치 검증·커밋 뒤 다음 3편으로 계속한다

이번 요청은 검증을 통과한 콘텐츠·SVG·진행 기록의 `git commit`까지 승인됐다. `git push`·사이트 배포·시리즈 카드 등록은 하지 않는다

### 코드블록 분류 기준

| 원본 성격 | 처리 |
|---|---|
| 행/열 의미가 명확한 2열 대조 | markdown 표 |
| 1~2줄 흐름 | 인라인 코드 |
| 소스 경로 · URL 캐럿 분해 · 디렉토리 트리 | ` ```text ` |
| kubectl 명령 | ` ```bash ` |
| 매니페스트 조각 | ` ```yaml ` |
| 사이클 · 루프 · 3단계 이상 분기 · 서사 흐름 | **SVG** |

### SVG 규칙

- 경로 `public/diagrams/{slug}-{n}.svg`
- `.claude/plans/diagram-conversion/best-practices.md` §1(색상) · §11(패턴 9종) 준수
- 편당 개수 할당은 없다. 표·문장으로 충분하면 SVG를 추가하지 않는다
- 한글 라벨을 기본으로 하고 기술 용어는 원어를 유지한다
- 글자 최소 · 13px 이상 (설명은 이미지 아래 본문에서)
- 요청 흐름은 **story diagram**으로 설명한다. 박스에는 처리 주체·역할을, 화살표에는 전달 정보나 판단 질문을 표시한다
  컴포넌트 이름만 나열하거나 비유 때문에 실제 주체가 사라지지 않게 한다 (`source-format.md` 4절 참조)

---

## 6. 모델 운용 참고 (2026-10-21 조사)

아래는 작업에 맞춘 추천이며 모델 설정 변경이나 사용자의 최종 선택을 뜻하지 않는다
사용 가능한 모델과 설정은 다음 작업 시 실제 도구에서 확인한다

| 용도 | 추천 출발점 | 적용 |
|---|---|---|
| Codex에서 3편 변환·소스 확인·파일 수정·검증 | GPT-6.1 Sol, High | 여러 자료와 도구를 다루는 기본 작업 |
| Claude와 함께 글을 쓸 때 본문·말투 편집 | Claude Opus 5.5 | 같은 원본과 공통 말투 기준을 전달. Codex에서는 주장·버전·참조를 대조 |
| 근거가 충돌하거나 기전 추론이 어려운 부분 | GPT-6 Astra | 해당 쟁점에 한정해 추가 검토. 모든 글을 높은 추론 강도로 돌릴 필요는 없음 |

이 역할 분담은 공개 평가와 작업 성격을 바탕으로 한 판단이지 한국어 Kubernetes 글의 직접 비교 결과는 아니다
첫 배치에서 원본 의미 보존, 과장·반복, 사용자가 다시 고친 문장을 보고 조정한다
어느 모델이 검토했든 공식 자료 확인과 빌드를 대체하지 않는다

- [OpenAI 모델 가이드](https://learn.chatgpt.com/docs/models): Sol은 반복적인 문서·코드 작업, Astra는 더 어려운 추론·도구 작업의 후보. High 추천은 이 작업에 대한 판단
- [Anthropic Opus 5.5 소개](https://www.anthropic.com/claude-opus-5-5): 문체·명료성 개선에 대한 제작사 설명이며 독립 평가와 구분
- [Towards AI ToneBench](https://benchmark.towardsai.com/thinking/claude-code-claude-opus-5-5.html): 10개 대본 과제의 모델별 최고 설정 비교에서 Opus 5.5가 1위. 특정 작가의 대본 재현과 자동 심사 결과이며 한국어 블로그 검증은 아님
- [Braintrust MathTutorBench 비교](https://www.braintrust.dev/evals/gpt-6-1-sol-vs-gpt-6-sol-and-astra): Sol 6.1의 교육적 설명 점수는 개선됐지만 글쓰기 점수는 Sol 6과 비슷. 수학 지도 과제의 결과를 문체 전반의 우열로 확대하지 않음
- [joonlab 개인 공개 실험](https://github.com/joonlab/gpt-6.1-sol-benchmark): 한국어 형식 지시 16개를 2회씩 시험해 Sol 6.1이 모두 통과. 상위 모델 대부분이 만점에 가까워 자연스러운 한국어 문체의 우열을 가리지 못함

---

## 7. 진행 상태와 다음 배치

아래 Batch 01~06은 이전 요청의 완료 이력이며, 현행 상태는 문서 끝의 Batch 17~21 진행표를 따른다

2026-10-23 기준선: Batch 06의 글 5편과 SVG 12장 작성·검수 완료
누적 `k8s-theory-` 글 26편과 SVG 55장이다
로컬 저장·정적 export 검증과 커밋까지 수행했으며 push·배포는 하지 않았다
71개 원본의 존재 확인을 본문 전수 검수나 블로그 발행으로 기록하지 않는다

### Batch 01 — 검수 완료

원본 위치는 [README.md](README.md)를 참고한다
아래 원본의 최신 본문을 2026-10-21에 읽었다. hash는 아래 인계 기록에 보존한다
slug와 order는 전역 충돌을 확인하고 실제 적용했다

| 좌표 | 원본 파일 | 줄 수 | 적용 slug | series / order | 상태 |
|---|---|---:|---|---|---|
| 1-1 | `Phase 1-1 · API 서버 요청 경로 전체.md` | 328 | `k8s-theory-api-request-path` | `k8s-theory-api` / 1 | 검수 완료 |
| 1-2.1 | `Phase 1-2.1 · 인증 (1) · 신원은 어디서 만들어지는가.md` | 337 | `k8s-theory-authentication` | `k8s-theory-api` / 2 | 검수 완료 |
| 1-2.2 | `Phase 1-2.2 · 인가 (2) · 그 신원으로 무엇을 판정할 수 있나.md` | 329 | `k8s-theory-authorization` | `k8s-theory-api` / 3 | 검수 완료 |

첫 편은 요청 전체 경로를, 둘째와 셋째는 인증·인가의 입력과 판단 범위를 설명한다
첫 편에서 상세 설명을 모두 소진하거나 나머지 편에서 전체 소개를 반복하지 않도록 경계를 잡는다

### 배치 기록

| 배치 | 대상 좌표 | 상태 | 실제 검사 결과 | 다음 대상 |
|---|---|---|---|---|
| 01 | 1-1, 1-2.1, 1-2.2 | 검수 완료 | post lint error 0 / warn 3, 전체 lint error 0 / warn 1, 최종 build 성공(534 pages) | 1-3.1, 1-3.2, 1-4.1 — 파일 존재 확인 |
| 02 | 1-3.1, 1-3.2, 1-4.1 | 검수 완료 | post lint error 0 / warn 3, 전체 lint error 0 / warn 1, 최종 build 성공(540 pages) | 1-4.2, 1-5.1, 1-5.2 — 파일 존재 확인 |
| 03 | 1-4.2, 1-5.1, 1-5.2, 1-6.1, 1-6.2 | 검수 완료 | post lint error 0 / warn 8, 전체 lint error 0 / warn 1, 최종 build 성공(550 pages) | 1-7.1, 1-7.2, 1-8, 1-9, 1-10 — 파일 존재 확인 |
| 04 | 1-7.1, 1-7.2, 1-8, 1-9, 1-10 | 검수 완료 | post lint error 0 / warn 5, 전체 lint error 0 / warn 1, 최종 build 성공(560 pages) | 1-11, 1-12, 1-13, 1-14, 1-15 — 파일 존재 확인 |
| 05 | 1-11, 1-12, 1-13, 1-14, 1-15 | 검수 완료 | post lint error 0 / warn 5, 전체 lint error 0 / warn 1, 최종 build 성공(570 pages) | 1-16, 1-17, 2-1, 2-2, 2-3 — 파일 존재 확인 |
| 06 | 1-16, 1-17, 2-1, 2-2, 2-3 | 검수 완료 | post lint error 0 / warn 5, 전체 lint error 0 / warn 1, 최종 build 성공(580 pages) | 2-4, 2-5, 2-6, 2-7, 2-8.1 — 파일 존재 확인 |

편별 상태는 `미착수 → 작성 중 → 검수 대기 → 검수 완료`로 기록한다
막힌 편은 `보류`와 구체적인 이유를 남긴다. 부분 성공은 배치 완료로 표시하지 않는다
배포 여부는 별도 요청으로 실제 확인했을 때만 기록한다

배치를 진행할 때 이 절 아래에 다음 인계를 누적한다

- **원본 대응**: 파일명·좌표·읽은 날짜·SHA-256, 생성한 글·SVG 경로, series/order
- **근거 확인**: 소스 ref·문서 버전·확인 URL, 원본과 달라진 주장 및 근거, 미확인 항목
- **검수 결과**: lint 명령·결과, 빌드 결과, 문체·사실 대조 결과, 남은 문제
- **다음 작업**: 미완료 편을 우선하고 다음 3편의 정확한 원본 파일명·예정 slug를 적는다

다음 채팅 요청 예시:

```text
.claude/plans/k8s-theory-series/README.md와 plan.md를 읽고
진행표의 다음 3편을 Obsidian 원본에서 블로그 글로 변환해줘
공통 말투 기준을 적용하고, 사실 확인·문체 검수·lint·빌드까지 진행해줘
완성 글 경로와 대표 문장 전후 비교를 보여주고 진행표도 갱신해줘
```

### Batch 01 인계 — 2026-10-21

#### 원본 대응과 저장 결과

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
세 편 모두 전문을 읽었고 작업 종료 때 SHA-256이 같음을 재확인했다. Vault 원본은 수정하지 않았다
작성 기준일은 2026-10-21이며 원본 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | SHA-256 |
|---|---|---|
| 1-1 | `Phase 1-1 · API 서버 요청 경로 전체.md` | `53423f7e47ce860313ccb81d237573c5f082097dd09c174f377081467665a975` |
| 1-2.1 | `Phase 1-2.1 · 인증 (1) · 신원은 어디서 만들어지는가.md` | `da5a46722554fa3902c594e38ef5ce3bcbf17404736a2cb33b330f732db2cec7` |
| 1-2.2 | `Phase 1-2.2 · 인가 (2) · 그 신원으로 무엇을 판정할 수 있나.md` | `51b4a1ea9a3d19322e509e067d4356446b5ad8ba6fc22fd57b71bb71212e4229` |

생성한 글과 자산:

- `src/content/essays/kubernetes/k8s-theory-api-request-path.md` — `k8s-theory-api` / 1
  - `public/diagrams/k8s-theory-api-request-path-1.svg` — 일반 CREATE 처리 순서
  - `public/diagrams/k8s-theory-api-request-path-2.svg` — Deployment 저장 뒤 별도 controller 요청
- `src/content/essays/kubernetes/k8s-theory-authentication.md` — `k8s-theory-api` / 2
  - `public/diagrams/k8s-theory-authentication-1.svg` — 명세 주입·토큰 발급·파일·요청·신원 경계
- `src/content/essays/kubernetes/k8s-theory-authorization.md` — `k8s-theory-api` / 3
  - `public/diagrams/k8s-theory-authorization-1.svg` — authorizer 체인의 첫 결론
  - `public/diagrams/k8s-theory-authorization-2.svg` — Node authorizer의 객체 관계

전체 경로·토큰 생성·인가 속성이라는 각 편의 경계를 유지했다
LAB TODO·종료 조건·등급·wikilink 목록은 본문에서 제외하고 설명용 예시임을 명시했다
불필요한 ASCII는 표·산문으로 정리하고 요청 순서·비동기 후속 생성·관계 그래프를 SVG로 옮겼다

#### 근거 버전과 원본에서 달라진 주장

- 현행 근거는 [Kubernetes v1.37.1 commit](https://github.com/kubernetes/kubernetes/commit/8aaeb4e53d1a489570afe94ef5258554de68897a)이다. GitHub commit API에서 2026-09-23의 v1.37.1 changelog commit임을 확인했다
- 공식 문서는 [website 고정 commit](https://github.com/kubernetes/website/commit/1ad9080d7d3ddd79e955b7dd653711c8f2caedb8)의 영어 원문 13개를 읽었다. 당시 기본 branch는 `main`이며 2026-10-20 저장본이다. 전용 v1.37 문서 branch의 존재를 추정하지 않았다
- 원본의 `release-1.35` 링크를 현행 확인 없이 복사하지 않았다. 위 commit에서 실제 파일을 읽고 본문 인용 경로가 내려받은 파일에 대응하는지 확인했다
- `StructuredAuthenticationConfiguration`·`AuthorizeWithSelectors`의 과거 gate 정의는 v1.37.1에서 제거돼 있다. 기능 제거라는 뜻으로 쓰지 않았다
- 두 기능의 v1.34 GA·v1.35 LockToDefault 이력은 [과거 고정 ref의 gate 정의](https://github.com/kubernetes/kubernetes/blob/5671697925fe8d7222c4ab09cb15f28f5f9d0383/staging/src/k8s.io/apiserver/pkg/features/kube_features.go)와 대조했다
- Node token 관련 세 gate는 현행 `pkg/features/kube_features.go`에도 true·LockToDefault로 남아 있음을 확인했다

주요 대조 범위:

| 글 | 실제 대조한 동작·경계 |
|---|---|
| 요청 경로 | DefaultBuildHandlerChain의 역순 래핑, createHandler 디코딩·mutation, Store 내부 create와 BeforeCreate·validating callback, 오류 코드·audit annotation, PATCH operation, scale Kind, dry-run quota 미예약 |
| 인증 | admission 명세 주입과 kubelet 파일 작성 구분, token manager 갱신·오류 조건, 3,607초 연장 경로, client-go 파일 캐시와 별도 401 reset, UID·삭제 상태·Node claim 분기, TokenReview audience, 익명 fallback |
| 인가 | RBAC·ABAC NoOpinion, union의 첫 결론과 오류, Webhook 실패 정책·캐시, RoleBinding 범위·이름 selector, 저장 구현의 bind·escalate 검사, Node 그래프·NodeRestriction, privileged group 선행 허용, can-i 단건·목록 구분 |

핵심 주장 중 근거 충돌로 보류한 항목은 없다
클러스터 설치 버전·실제 설정, 토큰 폐기 전파 시간과 webhook 장애 영향 범위는 실측하지 않았다
캐시·외부 의존성·정책 매칭에 따른 조건을 본문에 남겼으며 소스 확인을 실습 성공으로 표현하지 않았다
다른 좌표의 미확인 항목은 이 배치에서 해결한 것으로 표시하지 않는다

#### 문체·의미 검수

공통 말투 기준과 원본을 대조한 뒤, draft-to-post 절차에 따라 reviewer를 배치당 1회 사용했다
판단 항목 검토 결과 P0 0건, P1 3건이었고 세 권장을 반영했다
reviewer는 파일을 수정하지 않았다

| 위치 | 검토 문장 | 문제 이유 | 반영한 최소 수정 |
|---|---|---|---|
| 인증 / client-go | “캐시된 token source”, “bearer transport” | HTTP 전달 구성요소의 역할이 정의되지 않음 | token source와 transport의 역할을 각 한 문장으로 추가 |
| 인증 / structured authn | “원본의 v1.35 LockToDefault 설명은 당시 이력으로 구분해야 합니다” | 독자에게 없는 원본을 전제한 편집 지시 | 본문에서는 삭제, 버전 정정은 이 인계에 보존 |
| 인가 / selector | “원본의 AuthorizeWithSelectors는…” | 원본 노트에 의존한 도입 | 기능의 GA 이력과 현재 gate 부재를 직접 설명 |

대표 문장 비교:

| 글 | 원본 | 변환 후 |
|---|---|---|
| 요청 경로 | “Deployment 저장에 성공했다면 기록된 것은 우선 Deployment 오브젝트다” | “Deployment 저장까지 성공해도 그 요청에서 Pod를 함께 저장한 것은 아닙니다” |
| 인증 | “파일을 바꾼 뒤 어느 토큰을 요청에 실을지는 애플리케이션의 재읽기에 달려 있다” | “파일을 갱신하는 일과 애플리케이션이 그 파일을 다시 읽는 일은 별개입니다” |
| 인가 | “can-i가 yes인데 실제 요청이 403이면 곧바로 admission 탓으로 돌릴 수 없다” | “그렇다고 yes 뒤의 403을 곧바로 admission 탓으로 돌릴 수도 없습니다” |

#### 실제 검사 결과

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-api-request-path.md src/content/essays/kubernetes/k8s-theory-authentication.md src/content/essays/kubernetes/k8s-theory-authorization.md` — exit 0, error 0 / warn 3
  - 문장길이 경고는 편별 1개이며 100자 초과 줄은 14·14·16곳이다. 긴 URL·front matter와 식별자가 포함된 문장을 문맥으로 검토했다. 경고를 0건으로 바꿔 보고하지 않는다
- `npm run lint` — exit 0, error 0 / warn 1
  - 기존 `src/app/layout.tsx:80`의 `@next/next/no-page-custom-font` 경고. 요청 밖 수정은 하지 않았다
- `npm run build` — 최종 저장본에서 exit 0, TypeScript·정적 생성·postbuild 성공, 534 pages
  - 최초 sandbox 실행은 Turbopack의 로컬 port binding이 `Operation not permitted`로 막혔다. 같은 명령을 권한 조정 후 실행해 성공했고 문체 보완 후 최종 빌드도 성공했다
  - Node의 `DEP0205 module.register()` deprecation warning은 남아 있다
  - 생성한 essays HTML 3개와 `/my-blog/diagrams/` 자산 참조를 확인했다
- SVG 5개 — XML 파싱과 PNG 렌더링·육안 검사. 인가 그림의 첫 연결선과 관계 그림의 라벨·선 겹침을 수정했다
- slug 전역 유일성·series/order·내부 글 링크·wikilink/학습 마커 제거·본문 소스 경로 대응을 확인했다
- 원본 SHA-256 3개는 작업 전후 일치한다
- 빌드 prebuild가 만든 CLAUDE.md 통계만 이번 작업 전 상태로 되돌렸다. 기존 사용자 변경과 바이트가 같은지 확인했다
- commit·push·배포, Kubernetes 실습은 실행 안 함

### Batch 02 — 검수 완료

2026-10-22에 세 원본의 최신 전문을 읽고 아래 slug와 order로 작성했다
원본 hash·근거·검증 결과는 바로 아래 인계 기록에 남긴다

| 좌표 | 정확한 원본 파일명 | 적용 slug | series / order | 상태 |
|---|---|---|---|---|
| 1-3.1 | `Phase 1-3.1 · Admission (1) · 누가, 어떤 순서로 판단하는가.md` | `k8s-theory-admission-order` | `k8s-theory-api` / 4 | 검수 완료 |
| 1-3.2 | `Phase 1-3.2 · Admission (2) · 판단을 밖으로 내보내면 무엇을 잃는가.md` | `k8s-theory-admission-webhook-failure` | `k8s-theory-api` / 5 | 검수 완료 |
| 1-4.1 | `Phase 1-4.1 · resourceVersion (1) · 하나의 숫자는 어디서 오는가.md` | `k8s-theory-resource-version` | `k8s-theory-api` / 6 | 검수 완료 |

Batch 01의 전체 경로·기본 webhook 개요를 반복하지 않고 admission의 실제 순서·외부 판단 실패 조건·저장 버전의 근거를 각각 확대했다

### Batch 02 인계 — 2026-10-22

#### 원본 대응과 저장 결과

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
세 편 모두 전문을 읽었고 종료 시 SHA-256이 같음을 확인했다. Vault 원본은 수정하지 않았다
작성 기준일은 2026-10-22이며 원본 학습일·배포일을 뜻하지 않는다

| 좌표 | 줄 수 | SHA-256 |
|---|---:|---|
| 1-3.1 | 408 | `d08aaff335507f51898d85d2f03ed2bff9e6b0a56f171b36dde68f6434aca3ba` |
| 1-3.2 | 893 | `d4b1be5007c95b167098cbcbb8f93d1a15259e9c5471dd686c681fb6b9741058` |
| 1-4.1 | 268 | `74dbf6adb5de70489613da1abfdbaa8dc5044fde29bb9672ff333ce7a533d1bf` |

생성한 글과 자산:

- `src/content/essays/kubernetes/k8s-theory-admission-order.md` — `k8s-theory-api` / 4
  - `public/diagrams/k8s-theory-admission-order-1.svg` — 일반 CREATE의 변경·저장 전략·검증·저장 순서
  - `public/diagrams/k8s-theory-admission-order-2.svg` — 뒤의 sidecar 변경과 조건부 재호출, 최종 검증
- `src/content/essays/kubernetes/k8s-theory-admission-webhook-failure.md` — `k8s-theory-api` / 5
  - `public/diagrams/k8s-theory-admission-webhook-failure-1.svg` — 변경 webhook 직렬·검증 webhook 병렬 호출
  - `public/diagrams/k8s-theory-admission-webhook-failure-2.svg` — 실패한 webhook이 복구 Pod까지 막는 의존 순환
- `src/content/essays/kubernetes/k8s-theory-resource-version.md` — `k8s-theory-api` / 6
  - `public/diagrams/k8s-theory-resource-version-1.svg` — 같은 번호를 읽은 두 작성자의 갱신 충돌
  - `public/diagrams/k8s-theory-resource-version-2.svg` — API 버전 검사와 etcd 조건부 쓰기·재시도

#### 근거 버전과 원본에서 달라진 주장

- GitHub의 `refs/tags/v1.37.1`을 직접 조회해 annotated tag `d2b770f4c94636a992534a8d3156b6b2d8e82ac3`이 가리키는 [실제 release commit](https://github.com/kubernetes/kubernetes/commit/f78e722310e50bcaca9276be22276d9e91d91308)을 확인했다
- Batch 01의 `8aaeb4e53d1a489570afe94ef5258554de68897a`는 v1.37.1 changelog commit이며 tag target과 구분한다. 이번에 확보한 소스 61개는 두 ref 사이 SHA-256이 모두 같았다. 새 세 글은 tag target `f78e722...`을 인용한다
- [공식 문서 저장본](https://github.com/kubernetes/website/commit/7fde177e22dc98390a6d55d215dd0301b5f6d0bb)의 영어 문서 11개를 확보하고 관련 절을 대조했다. 임시 근거 파일은 `/tmp/k8s-batch02/`에 있으며 영구 재검증 경로는 글 안의 commit 고정 링크다
- MAP는 원본의 v1.35 beta·기본 off에서 v1.36 GA·기본 on으로 바뀌었다. v1.37.1 소스의 gate 이력과 플러그인 기본 설정을 확인했다. 활성 상태와 Policy·Binding·매칭의 실제 적용은 구분한다
- API 기반 webhook의 admissionregistration 6종 면제와 API 기반 CEL policy의 4종 면제를 구분했다. v1.37의 정적 manifest 기반 hook은 해당 설정 리소스도 검사할 수 있다는 예외를 남겼다
- authn/authz 가상 리소스 6종 제외는 정책 종류별 경로와 `ExcludeAdmissionWebhookVirtualResources` gate 조건을 확인했다
- v1.37.1 `CollectParams`는 이름으로 찾은 파라미터가 cache에 없으면 실제 API 조회로 보완한다. selector 조회와 다중 객체의 원자성까지 보장하는 설명으로 확대하지 않았다
- VAP의 false·평가 오류·설정 오류·audit 오류를 구분했다. `addConfigError`의 Fail 경로는 Warn만 지정했어도 직접 거부할 수 있으므로 일반 문서 설명과 구현의 차이를 본문에 명시했다
- resourceVersion은 v1.35부터 같은 API group·resource 안에서 정수 순서 비교를 보장한다. 서로 다른 namespace는 가능하지만 Pod와 Deployment 비교까지 확대하지 않는다. aggregated API의 비숫자 값은 동일성 비교만 한다
- Deployment의 무조건 Update 허용과 CRD의 불허, 누락/0과 오래된 번호의 차이, API 검사와 etcd CAS 재시도, 변경 없는 Update의 쓰기 생략을 소스와 대조했다
- Kubernetes go.mod의 etcd v3.7.0 의존성을 확인하고 [etcd v3.7 데이터 모델](https://etcd.io/docs/v3.7/learning/data_model/)과 [API 보장](https://etcd.io/docs/v3.7/learning/api_guarantees/)을 사용했다. compaction·Event TTL 기본값과 lease 재사용 조건도 확인했다

핵심 주장 중 근거 충돌로 보류한 항목은 없다
실제 클러스터 설정·webhook 장애 시간·정책 비용·etcd 설치 버전은 실측하지 않았다
후속 watch·managedFields 글에서 설명할 범위는 경계만 남겼으며 미작성 글 링크를 만들지 않았다

#### 문체·의미 검수

공통 말투 기준을 적용하고 원본과 대조한 뒤, draft-to-post 절차에 따라 독립 reviewer를 배치당 1회 사용했다
초기 판정 P0 1건·P1 3건을 모두 반영했다. reviewer는 파일을 수정하지 않았다

| 위치 | 검토 문장·상태 | 문제 이유 | 반영한 최소 수정 |
|---|---|---|---|
| webhook / 전송 | “AdmissionReview.request를 POST합니다” | request 필드만 HTTP 본문으로 보내는 것으로 읽힘 | 심사 정보를 request에 담고 AdmissionReview 객체 전체를 POST한다고 명시 |
| webhook / 장애 | 주입과 검증 분리 설명에서 같은 장애 서버 의존 조건 누락 | 역할 분리만으로 가용성이 좋아지는 것으로 읽힐 수 있음 | 같은 서버에 의존하면 검증도 기다리므로 분리만으로 가용성이 개선되지 않는다는 두 문장 복원 |
| webhook / HTTP 500 | “통신 실패” | HTTP 오류 응답도 호출 실패에 포함됨 | “webhook endpoint의 HTTP 500은 호출 실패로 처리합니다” |
| resourceVersion | “opaque 문자열 설명” | 용어의 의미가 설명되지 않음 | 내부 형식·숫자 크기에 의미를 부여하지 않고 동일성을 확인했다는 설명 추가 |

원본 노트를 전제한 “옮기지 않았습니다” 등의 편집 문장은 버전별 동작을 직접 설명하도록 고쳤다
informer는 변경 이벤트를 받아 로컬 사본을 유지하는 구성요소라고 첫 사용에서 풀었다
원본에 없는 개인 경험·실측 수치·감정은 추가하지 않았다

대표 문장 비교:

| 글 | 원본 | 변환 후 |
|---|---|---|
| Admission 순서 | “mutating과 validating을 가르는 기준은 요청 오브젝트를 바꿀 수 있는가다” | “mutating과 validating을 나누는 기준은 요청 오브젝트를 바꿀 수 있는지이며, 양쪽 모두 거부할 수 있습니다” |
| webhook / MAP | “Ignore는 정책 전체를 실행 전 상태로 복원하는 약속이 아니다” | “Ignore는 정책 전체를 실행 전 상태로 되돌리는 약속이 아닙니다” |
| resourceVersion | “현재 번호와 요청의 번호가 같으면, 읽은 뒤 다른 작성자가 바꾸지 않았다는 검사만 통과한다” | “번호가 같다는 것은 그 버전 검사만 통과했다는 뜻입니다” |

#### 실제 검사 결과

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-admission-order.md src/content/essays/kubernetes/k8s-theory-admission-webhook-failure.md src/content/essays/kubernetes/k8s-theory-resource-version.md` — 최종 저장본 exit 0, error 0 / warn 3
  - 100자 초과 줄은 15·17·10곳이다. URL·front matter·표·조건이 긴 문장을 문맥으로 검토했으며 길이만 맞추려고 조건을 삭제하지 않았다
- `npm run lint` — exit 0, error 0 / warn 1
  - 기존 `src/app/layout.tsx:80`의 `@next/next/no-page-custom-font` 경고. 요청 밖 수정은 하지 않았다
- `npm run build` — 문구 보완 후 최종 exit 0, TypeScript·정적 생성·postbuild 성공, 540 pages
  - 최초 sandbox 실행은 Turbopack의 로컬 port binding이 `Operation not permitted`로 막혔다. 권한 조정 후 같은 명령으로 성공했고, 최종 문구에서도 다시 성공했다
  - Node의 `DEP0205 module.register()` deprecation warning은 남아 있다
  - 생성한 essays HTML 3개와 `/my-blog/diagrams/` SVG 6개 참조를 확인했다
- SVG 6개 — XML 파싱·PNG 렌더링·육안 검사. resourceVersion 재시도 그림의 연결선 교차를 수정했다
- slug 전역 유일성·series/order·내부 링크·학습 마커 제거·본문 소스 경로 대응을 확인했다
- 원본 SHA-256 3개는 작업 전후 일치한다
- prebuild가 만든 CLAUDE.md 통계만 되돌렸고, 기존 사용자 변경이 있는 작업 전 파일과 바이트가 같음을 확인했다. AGENTS.md도 작업 전과 같다
- commit·push·배포, Kubernetes 실습은 실행 안 함

### Batch 03 — 검수 완료

2026-10-22에 사용자 요청에 따라 이번 배치를 5편으로 확대했다
작성 에이전트 3명과 주 담당자가 나누어 원본 전문·공식 근거를 대조했고, 별도 reviewer가 5편을 검수했다
각 작성자는 담당 글·SVG만 수정했으며 공통 기록과 최종 lint·build는 주 담당자가 처리했다
5편 모두 검수 완료이며 보류한 편은 없다

| 좌표 | 정확한 원본 파일명 | 적용 slug | series / order | 상태 |
|---|---|---|---|---|
| 1-4.2 | `Phase 1-4.2 · watch (2) · 그 숫자를 놓치면 무엇을 잃는가.md` | `k8s-theory-watch` | `k8s-theory-api` / 7 | 검수 완료 |
| 1-5.1 | `Phase 1-5.1 · 신원과 소유 (1) · 오브젝트는 무엇으로 자기를 가리키고 누구에게 매이는가.md` | `k8s-theory-object-identity-ownership` | `k8s-theory-api` / 8 | 검수 완료 |
| 1-5.2 | `Phase 1-5.2 · 수명 (2) · DELETE 하나는 왜 즉시 끝나지 않는가.md` | `k8s-theory-deletion-lifecycle` | `k8s-theory-api` / 9 | 검수 완료 |
| 1-6.1 | `Phase 1-6.1 · 소유권 (1) · 서버는 필드마다 주인을 어떻게 정하는가.md` | `k8s-theory-server-side-apply` | `k8s-theory-api` / 10 | 검수 완료 |
| 1-6.2 | `Phase 1-6.2 · 이행 (2) · 그 소유권을 넘기고 쓸 때 무엇이 조용히 부서지는가.md` | `k8s-theory-apply-ownership-migration` | `k8s-theory-api` / 11 | 검수 완료 |


### Batch 03 인계 — 2026-10-22

#### 원본 대응과 저장 결과

원본 루트는 `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`다
5편 모두 전문을 읽고 작업 전후 SHA-256이 같음을 확인했다. Vault 원본은 수정하지 않았다
작성 기준일은 2026-10-22이며 원본 학습일·배포일을 뜻하지 않는다

| 좌표 | 줄 수 | SHA-256 |
|---|---:|---|
| 1-4.2 | 337 | `ca579cb4fa957c255979517559ff4e5f063d04fb3c919e9f690259eab3236e98` |
| 1-5.1 | 345 | `e1b9a8b49b3db27630fd86045af088f70afcc6fa59bf4a17698c3e47617ce0c6` |
| 1-5.2 | 469 | `60df70afcf54bd3f557f16ec5cf62bea90899192285e8059b3e75af77558b5aa` |
| 1-6.1 | 387 | `94c782d1d929d36dad5324b0236652f3aec3bd3d7dfedd4ff1ed3bf3010e0cbc` |
| 1-6.2 | 409 | `b838f2cd4c4af54c2e3b57e61b7caef2955afe0c7d5a0365326fc68bf16a01e6` |

글은 위 적용 slug로 `src/content/essays/kubernetes/`에 저장했다
각 글의 그림은 `public/diagrams/{slug}-1.svg`와 `{slug}-2.svg`이며 총 10장이다

| 글 | SVG 1 | SVG 2 |
|---|---|---|
| watch | 변경 이력 손실과 로컬 사본 재구성 | API 서버별 watch cache |
| 신원·소유 | 같은 이름의 다른 UID와 삭제 조건 | GC의 참조·조회·삭제 판단 |
| 삭제 수명 | 삭제 요청·유예 종료·finalizer의 관계 | Namespace 내용 삭제와 finalize |
| SSA | 같은 값·다른 값의 Apply와 Update | granular·atomic 변경 시 소유권 |
| SSA 이행 | HPA 소유권 유무에 따른 필드 생략 | 반복 Apply의 최종 상태·저장 판단 |

#### 근거 버전과 원본에서 달라진 주장

- [Kubernetes v1.37.1 tag target](https://github.com/kubernetes/kubernetes/commit/f78e722310e50bcaca9276be22276d9e91d91308)과 [공식 문서 고정 저장본](https://github.com/kubernetes/website/commit/7fde177e22dc98390a6d55d215dd0301b5f6d0bb)을 사용했다. Batch 02에서 확인한 ref지만 이번 대상 함수·분기·스키마를 실제로 다시 읽었다
- 근거 링크는 글의 해당 주장 가까이에 남겼다. 임시 원본·소스·다운로드 기록·작성자 보고서는 `/tmp/k8s-batch03/`에 있다. watch의 API Concepts는 같은 고정 ref로 확보한 `/tmp/k8s-batch02/website/reference/using-api/api-concepts.md`를 재사용했다
- 생성형 kubectl reference의 raw Markdown 경로 일부가 404여서 CLI 플래그는 실제 `apply.go`·`helpers.go`·`json_yaml_flags.go`로 확인했다. 존재하지 않는 문서 URL은 인용하지 않았다

| 글 | 정정 및 보존한 주요 조건 |
|---|---|
| watch | legacy 빈 RV와 streaming initial events의 신선도 분기, GET의 저장소 위임과 LIST의 캐시 경로를 구분. 이력 구현이 `watch_cache_history.go`로 이동. 75초 이력·60초 BOOKMARK는 API 보장 시간이 아님. `ConsistentListFromCacheSkipTimeoutFallback`은 v1.37 alpha·기본 off이며 활성화 시 freshness timeout의 429 분기를 명시 |
| 신원·소유 | UID precondition, 여러 소유자, dangling·scope 오류·재시도 오류, virtual node와 partial discovery 조건 유지. `OwnerReferencesPermissionEnforcement`는 기본 off. 새 blocking ref의 부모 권한은 현행 구현·admission 문서의 `finalizers` `update`이며 개념 문서의 부모 delete 설명과 구분 |
| 삭제 수명 | finalizer 접두사가 관례뿐이라는 원본을 core 추가 검증으로 정정. finalizer 보류가 언제나 202라는 일반화를 제거하고 handler의 기본 200·호환 202 분기 구분. kubelet 마지막 grace 0·UID DELETE 성공 로그가 저장소 최종 제거까지 보장하지 않음을 명시. Namespace의 Pod 선삭제·discovery 오류와 spec/metadata finalizers 차이 유지 |
| SSA | 같은 값의 공동 소유와 다른 값의 Apply 충돌·Update 소유권 이동 구분. `set` 리스트는 scalar뿐 아니라 atomic object/array도 가능. converter fallback 조건·map/list 추론 차이·스키마 topology 변경·API 버전 부재에 따른 소유권 제거 유지 |
| SSA 이행 | prune에서 Update 매니저의 소유권도 값 보존에 참여. HPA 생성과 실제 scale 쓰기 구분. 같은 매니페스트와 최종 상태의 no-op 조건 구분. 서버의 kubectl 이름 제한과 첫 SSA 성공 뒤 kubectl 클라이언트 이전 경로의 이름 제한 부재를 구분. 공식 문서·원본의 `managedFields: []` 설명과 달리 v1.37.1 구현과 `TestClearManagedFieldsWithUpdateEmptyList`는 초기화를 지원함을 명시 |

마지막 두 SSA 정정은 reviewer도 실제 고정 구현·테스트 소스와 별도로 대조했다
테스트 소스를 읽은 것이며 Kubernetes 통합 테스트 실행 결과로 표현하지 않았다
실제 클러스터 설정·HPA 동작 시점·GC 반응 시간·watch 보존 시간은 실측하지 않았다
핵심 주장 중 근거 충돌로 보류한 항목은 없으며 문서와 구현이 다른 범위는 본문에 남겼다

#### 문체·의미 검수

공통 말투 기준과 원본을 대조하고 독립 reviewer를 배치당 1회 사용했다
판정 P0 0건·P1 1건이며 아래 권장을 반영했다. reviewer는 글을 수정하지 않았다

| 위치 | 검토 문장 | 문제 이유 | 반영한 최소 수정 |
|---|---|---|---|
| SSA / 충돌 응답 | `응답의 status.details.causes[].reason` | REST `Status` 응답의 `status`는 문자열이며 `details`는 루트 필드 | `응답 Status 객체의 details.causes[].reason과 필드 경로를 함께 확인해야 합니다` |

학습 목표·등급·종료 판정·LAB TODO·중복 glossary를 빼고 필요한 기전·조건·예외는 보존했다
실습·개인 경험·감정·실측 수치를 추가하지 않았다. 표 아래 행별 반복보다 인과관계와 조건 설명을 남겼다

대표 문장 비교:

| 글 | 원본 | 변환 후 |
|---|---|---|
| watch | “번호만 최신 값으로 옮겨서는 빠진 변경을 복구할 수 없다” | “커서만 최신 번호로 옮겨서는 로컬 사본을 바로잡을 수 없습니다” |
| 신원·소유 | “이벤트가 아직 없다는 사실만으로 소유자 부재를 확정하지는 않는다” | “이벤트를 못 봤다는 사실은 부재의 증거가 아닙니다” |
| SSA 이행 | “HPA를 설정한 시점과 HPA가 필드를 쓰는 시점은 다르다” | “그런데 HPA를 생성한 시점과 HPA가 실제로 복제본 수를 써서 소유권을 얻는 시점은 다릅니다” |

#### 실제 검사 결과

- 5편을 대상으로 `npm run lint:post -- <5개 파일>` — 최종 저장본 exit 0, error 0 / warn 8
  - 긴 줄 경고는 편별 1개, 100자 초과 줄은 순서대로 8·14·17·12·13곳. URL·front matter·표·기술 조건을 문맥으로 검토했다
  - SVG 텍스트 수 경고 3개: watch-1의 17개, deletion-lifecycle-1의 29개, deletion-lifecycle-2의 23개. PNG 렌더링·육안 검사에서 잘림·겹침 없이 읽히는지 확인했고 경고는 그대로 보고한다
- `npm run lint` — exit 0, error 0 / warn 1
  - 기존 `src/app/layout.tsx:80`의 `@next/next/no-page-custom-font` 경고. 요청 밖 수정은 하지 않았다
- `npm run build` — 검수 수정 반영 후 최종 exit 0, TypeScript·정적 생성·postbuild 성공, 550 pages
  - Turbopack 로컬 포트에 필요한 권한으로 실행했다. Node의 `DEP0205 module.register()` 경고는 남아 있다
  - essays HTML 5개와 `/my-blog/diagrams/` SVG 10개 참조를 확인했다
- SVG 10개 XML 파싱·PNG 렌더링·육안 검사 완료. 연결선·라벨의 겹침을 작성 단계에서 보완했다
- slug 전역 유일성·series/order 7~11·내부 링크·학습 마커 제거·GitHub 인용 경로의 실제 확보 자료 대응을 확인했다
- 원본 SHA-256 5개는 작업 전후 일치한다
- prebuild의 CLAUDE.md 통계 변경만 작업 전 상태로 복구했고 기존 사용자 변경을 보존했다
- commit·push·배포, Kubernetes 클러스터 실습·통합 테스트는 실행 안 함

### Batch 04 — 검수 완료

다음 원본 파일의 존재와 적용 slug 비충돌을 2026-10-22에 확인했다
최신 원본·progress·source-map을 확인하고 원본 SHA-256을 `/tmp/k8s-batch04/sources.json`에 기록했다
작성 에이전트 3명이 informer·reconcile, APF, 직렬화를 분담하고 주 담당자는 API 확장과 통합 검증을 맡았다
별도 reviewer가 원본·공식 근거·문체를 대조했다. 5편 모두 검수 완료이며 보류한 편은 없다

| 좌표 | 정확한 원본 파일명 | 적용 slug | series / order | 상태 |
|---|---|---|---|---|
| 1-7.1 | `Phase 1-7.1 · informer (1) · 로컬 사본은 어떻게 진실을 따라가는가.md` | `k8s-theory-informer` | `k8s-theory-api` / 12 | 검수 완료 |
| 1-7.2 | `Phase 1-7.2 · reconcile (2) · 그 사본을 믿고 행동할 때 무엇이 어긋나는가.md` | `k8s-theory-reconcile` | `k8s-theory-api` / 13 | 검수 완료 |
| 1-8 | `Phase 1-8 · API 확장 지점 개요.md` | `k8s-theory-api-extension-points` | `k8s-theory-api` / 14 | 검수 완료 |
| 1-9 | `Phase 1-9 · APF 내부 · 세는 것은 요청이 아니라 자리다.md` | `k8s-theory-api-priority-fairness` | `k8s-theory-api` / 15 | 검수 완료 |
| 1-10 | `Phase 1-10 · 직렬화와 버전 변환 · 아무도 못 받는 버전이 가운데 있다.md` | `k8s-theory-serialization-version-conversion` | `k8s-theory-api` / 16 | 검수 완료 |

### Batch 04 인계 — 2026-10-22

#### 원본 대응과 저장 결과

원본 루트는 `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`다
5편의 최신 전문과 관련 progress·source-map을 읽고 변환했다. Vault는 읽기 전용으로 사용했다
작성 기준일은 2026-10-22이며 원본 학습일·배포일을 뜻하지 않는다
informer·reconcile, APF, 직렬화를 작성 에이전트가 나누어 맡고 주 담당자는 API 확장과 통합 검증을 맡았다

| 좌표 | 줄 수 | SHA-256 |
|---|---:|---|
| 1-7.1 | 408 | `e999391b3d64ec80eb322ce71b82035f1aad35d814c4c1573882db43a4d2b7ed` |
| 1-7.2 | 424 | `9bfff69d58b3421644a64d4ecda601595f1a68a815ad48e6fdd592c8cbc246ed` |
| 1-8 | 373 | `5db41e32f98390a282a3b51d5ae78e1432bc74d86bd472621e2141175d939ea9` |
| 1-9 | 685 | `f27baac1ff03b31e8d622d69e59a9c576f87da76ba6d4578d6cae036a1461250` |
| 1-10 | 611 | `4ef81414359ca3ad829f77d4cbdfdac4fc6d817a7e2f871cb05948d93c7bc95f` |

글은 위 적용 slug로 `src/content/essays/kubernetes/`에 저장했다
SVG는 `public/diagrams/{slug}-{n}.svg`이며 총 11장이다

| 글 | 그림 |
|---|---|
| informer | 1: 사본 전달 경로, 2: snapshot 교체와 resync의 삭제 인지 차이 |
| reconcile | 1: dirty·processing과 재큐잉, 2: 생성 요청과 watch 관찰의 시간차 |
| API 확장 | 1: CRD와 확장 서버의 구현 책임, 2: API 서빙과 MAP 플러그인 활성의 구분 |
| APF | 1: 요청 분류·자리 추정·큐 흐름, 2: 자리 상한 뒤에도 보존되는 후속 작업량, 3: shuffle sharding의 후보 큐 |
| 직렬화 | 1: 요청·메모리·저장 표현, 2: 외부 버전과 내부 hub의 변환 관계 |

#### 근거 버전과 원본에서 달라진 주장

- [Kubernetes v1.37.1 tag target](https://github.com/kubernetes/kubernetes/commit/f78e722310e50bcaca9276be22276d9e91d91308)과 [website 고정 저장본](https://github.com/kubernetes/website/commit/7fde177e22dc98390a6d55d215dd0301b5f6d0bb)의 관련 함수·문서 절을 실제로 읽었다
- KEP-3352·3136·6164는 GitHub API로 확인한 [enhancements 고정 commit](https://github.com/kubernetes/enhancements/commit/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046)을 인용했다. 단계 계획과 실제 구현 완료를 구분했다
- 작성자별 공식 자료·manifest·보고서는 `/tmp/k8s-batch04/{informer,extension,apf,serialization}/`에 있다. 영구 재확인 경로는 글에 남긴 고정 소스 링크다
- informer의 Kubernetes issue 80289와 API 확장의 현행 Feature Gates 문서는 웹으로 확인했다. GitHub blob 인용 104개는 확보한 공식 파일과 대응했다
- 옛 소스 경로와 일부 생성 문서 경로의 404는 실제 import·공식 트리·현행 문서 경로로 해결했다. 404 URL은 본문에 인용하지 않았다

| 글 | 원본과 구분하거나 보완한 조건 |
|---|---|
| informer | 현행 기본 RealFIFO·AtomicFIFO의 ReplacedAll/SyncAll과 DeltaFIFO 경로를 구분. 캐시 초기 반영과 비동기 handler 완료를 구분. 고아 Pod delete는 입양 후보 ReplicaSet을 깨우지 않음. resync 주기와 초기카운터의 선행 Add 조건 보존 |
| reconcile | expectations 5분 만료는 자동 재큐잉 시한이 아님. 현행 ReplicaSet의 쓰기 RV consistency 검사·feature-off/빈값/미추적 경계 추가. 재시도 limiter를 일반 Add나 전체 API QPS 제한으로 확대하지 않음. 7개 workqueue 메트릭은 현행 BETA. leader election의 fencing 부재 유지 |
| API 확장 | 상태 검사와 사용자 프록시가 BuildTransportConfig를 공유하므로 상태 검사 TLS를 항상 생략한다는 과거 설명 정정. 집계 discovery는 두 endpoint. preferred resource에 다른 버전 항목이 남는 조건과 subresource 제외를 명시. MAP의 현행 GA·기본 on과 별도 API 등록 조건, flowcontrol beta 설정 목록과 실제 v1 설치 차이를 구분 |
| APF | FinalSeats 상한을 줄이면 AdditionalLatency를 늘려 seat-time을 보존. max(InitialSeats,FinalSeats) 예약, LIST의 수준별 요청 상한, 통계 미존재/오래됨 구분. 기본 구성 mandatory/suggested 갱신 조건, 도착 기준 대기 마감, 실제 실행시간으로 가상 시점 보정, Retry-After 변경 조건을 명확히 함 |
| 직렬화 | __internal이 API endpoint가 아니라는 사실을 직렬화 자체 불가능으로 확대하지 않음. 기본값의 nil/빈 문자열 조건 구분. KEP-6164 v1.37 단계는 전체 internal 제거 완료가 아님. CR 본문·Table·PartialObjectMetadata의 protobuf 지원, CR JSON/CBOR encoder와 decoder 차이, continue/remainingItemCount·compaction 조건 보존 |

핵심 자료 부족으로 보류한 편은 없다
클러스터 동작 시간·성능·설정은 실측하지 않았다. Kubernetes 소스·테스트 코드를 읽은 것을 클러스터 실험이나 통합 테스트 실행으로 보고하지 않았다

#### 문체·의미 검수

공통 말투 기준과 원본을 대조하고 독립 reviewer가 5편을 함께 검수했다
판정은 P0 0건·P1 0건·P2 0건이며 추가 수정 요청은 없다
원본에서 바꾼 핵심 설명은 reviewer도 실제 고정 함수·분기·정책과 별도로 대조했다
검토 보고서는 `/tmp/k8s-batch04/review.md`에 있다. 핵심 근거와 결과는 이 기록에도 보존한다
SVG 11개의 의미는 별도로 대조했으며 렌더링·육안 검사는 작성자와 주 담당자가 수행했다

학습 메타·종료 판정·LAB TODO·중복 glossary를 제거하고 기전·조건·예외를 남겼다
원본에 없는 실습·개인 경험·감정·실측 수치를 추가하지 않았다
API 확장은 원본의 CRD/aggregation 선택 기준을 보존했으며 개인의 채택·기각 경험으로 바꾸지 않았다

대표 문장 비교:

| 글 | 원본 | 변환 후 |
|---|---|---|
| reconcile | “기대가 채워지지 않았을 때 건너뛰는 것은 manageReplicas다” | “기대가 아직 남아 있다면 manageReplicas를 건너뜁니다” |
| API 확장 | “등록만으로 백엔드가 응답한다는 뜻은 아니다” | “등록에 성공했다고 백엔드까지 응답하는 것은 아닙니다” |
| APF | “큰 쪽은 저수지이고 작은 쪽은 금고다” | “NCS의 크기만 비교하면 실제로 보존하려는 용량의 차이를 놓칩니다” |
| 직렬화 | “페이징 토큰에는 읽기 위치도 들어 있다” | “페이징은 그 시점에 고정한 목록 안에서 읽을 위치까지 필요합니다” |

#### 실제 검사 결과

- `npm run lint:post -- <5개 파일>` — 최종 저장본 exit 0, error 0 / warn 5
  - 긴 줄 경고만 편별 1개이며 100자 초과 줄은 순서대로 14·15·21·20·32곳이다. URL·front matter·표·조건을 문맥으로 확인했고 길이만 줄이려고 근거·조건을 삭제하지 않았다
- `npm run lint` — exit 0, error 0 / warn 1
  - 기존 `src/app/layout.tsx:80`의 `@next/next/no-page-custom-font` 경고. 요청 밖 수정은 하지 않았다
- `npm run build` — exit 0, TypeScript·정적 생성·postbuild 성공, 560 pages
  - Turbopack 로컬 포트에 필요한 권한으로 실행했다. Node의 `DEP0205 module.register()` 경고는 남아 있다
  - 생성한 essays HTML 5개와 `/my-blog/diagrams/` SVG 11개 참조를 확인했다
  - 독립 검수에서 추가 수정이 없었으며 최종 글·SVG 16개가 성공한 빌드 시점 hash와 같음을 확인했다
- SVG 11개 — XML 파싱·PNG 렌더링·육안 검사 완료
- slug 전역 유일성·series/order 12~16·내부 링크·학습 마커 제거·GitHub blob 인용 104개의 확보 자료 대응을 확인했다
- 원본 SHA-256 5개는 작업 전후 일치한다
- prebuild의 CLAUDE.md 통계만 작업 전 상태로 복구했고 기존 사용자 변경을 보존했다
- 기존 변경 파일의 hash를 대조해 이번 범위인 plan·README 외에는 바이트가 같음을 확인했다
- `git diff --check` 통과
- commit·push·배포, Kubernetes 클러스터 실습·통합 테스트는 실행 안 함

### Batch 05 — 검수 완료 (2026-10-23)

정확한 원본 파일의 존재와 예정 slug 비충돌을 2026-10-22에 확인했다
2026-10-23 최신 원본과 progress·source-map을 확인하고 SHA-256을 `/tmp/k8s-batch05/sources.json`에 기록했다
작성 에이전트 3명이 인증서·kubelet 접속·버전 호환·저장 변환을 분담하고 주 담당자가 이중화와 통합 검증을 맡았다
별도 reviewer가 원본·공식 소스·문체·SVG를 대조했다. 최종 저장본의 lint·독립 검토·빌드를 마쳤으며 보류한 편은 없다

| 좌표 | 정확한 원본 파일명 | 예정 slug | series / order | 상태 |
|---|---|---|---|---|
| 1-11 | `Phase 1-11 · 인증서 발급과 위임 · 없는 리소스에 권한을 건다.md` | `k8s-theory-certificate-signing-delegation` | `k8s-theory-api` / 17 | 검수 완료 |
| 1-12 | `Phase 1-12 · kubelet 접속과 되묻기 · 인가가 두 번 돌고 주체가 바뀐다.md` | `k8s-theory-kubelet-access` | `k8s-theory-api` / 18 | 검수 완료 |
| 1-13 | `Phase 1-13 · 버전 셋과 롤백 · 되돌아갈 자리를 남기면 기능이 늦게 켜진다.md` | `k8s-theory-version-emulation-rollback` | `k8s-theory-api` / 19 | 검수 완료 |
| 1-14 | `Phase 1-14 · 컨트롤 플레인 이중화 · 합의하는 층은 하나뿐이다.md` | `k8s-theory-control-plane-high-availability` | `k8s-theory-api` / 20 | 검수 완료 |
| 1-15 | `Phase 1-15 · 저장 경로의 변환 층 · 읽기는 목록을 훑고 쓰기는 첫 칸만 쓴다.md` | `k8s-theory-storage-transformations` | `k8s-theory-api` / 21 | 검수 완료 |


### Batch 05 인계 — 2026-10-23

#### 원본 대응과 저장 결과

원본 루트는 `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`다
5편의 최신 전문과 관련 progress·source-map을 읽고 Vault는 읽기 전용으로 사용했다
작성 기준일은 2026-10-23이며 원본 학습일이나 실제 배포일을 뜻하지 않는다
인증서·kubelet·버전 호환은 작성 에이전트가 분담하고, 버전 담당자가 저장 변환도 이어서 맡았다
주 담당자는 이중화를 작성하고 공통 기록·통합 검증을 관리했다. 별도 reviewer가 5편을 독립 검토했다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 |
|---|---|---:|---|
| 1-11 | `Phase 1-11 · 인증서 발급과 위임 · 없는 리소스에 권한을 건다.md` | 650 | `9ede13004aef70da772b22fc8547aee8e2d9d3c17d1e2004bd1bb6aeb94f142d` |
| 1-12 | `Phase 1-12 · kubelet 접속과 되묻기 · 인가가 두 번 돌고 주체가 바뀐다.md` | 780 | `a964c31462bd424a517788c09b0a22ffea726e3a776b8e056232eae6f8953bfe` |
| 1-13 | `Phase 1-13 · 버전 셋과 롤백 · 되돌아갈 자리를 남기면 기능이 늦게 켜진다.md` | 570 | `ac89fbdb98ef4c68e03969c1db11cef18e4515f617ceb31e2602ef46d6d6c9af` |
| 1-14 | `Phase 1-14 · 컨트롤 플레인 이중화 · 합의하는 층은 하나뿐이다.md` | 618 | `b2fcd03c935463fa939d570049458892c91843becc6487c8a8f5fc336eb56686` |
| 1-15 | `Phase 1-15 · 저장 경로의 변환 층 · 읽기는 목록을 훑고 쓰기는 첫 칸만 쓴다.md` | 557 | `dc7ce843c3cd3207e7d52c5f98b8147e8709e539789692cb8b020048afb95858` |

위 적용 slug로 `src/content/essays/kubernetes/`에 저장했다
5편은 `k8s-theory-api` order 17~21이며, 전체 시리즈 order 1~21의 중복·누락과 트랙 분리 없음도 확인했다
원본 파일은 작업 전후 hash가 같고, 기존 사용자 수정 파일 12개도 작업 시작 저장본과 같다

| 글 | SVG 구성 |
|---|---|
| 인증서·사칭 | 1: 첫 kubelet 인증서 발급, 2: 사칭 권한과 실제 작업 인가의 주체 |
| kubelet 접속 | 1: logs 요청의 신원 전환, 2: 좁은 권한과 proxy 폴백 |
| 버전·롤백 | 1: 세 버전의 역할, 2: 저장 버전의 두 차례 탐색 |
| 이중화 | 1: 한 호스트 장애와 세 역할, 2: 최신 LIST 기준 revision과 캐시 진행 |
| 저장 변환 | 1: codec·변환기의 양방향 경계, 2: stale 갱신 분기, 3: 재적재 성공·실패 |

SVG 11장은 `public/diagrams/{slug}-{n}.svg`로 저장했다
작성 담당자가 XML·sharp PNG 렌더링과 육안 검사를 수행했고 reviewer도 본문 의미·렌더링을 확인했다
그림 수를 맞추지 않고 기전·구조는 SVG, 수치·설정·조건 비교는 표, 인과 설명은 산문으로 구성했다

#### 근거 버전과 원본에서 달라진 설명

- [Kubernetes v1.37.1 tag target](https://github.com/kubernetes/kubernetes/commit/f78e722310e50bcaca9276be22276d9e91d91308)과 [website 고정 저장본](https://github.com/kubernetes/website/commit/7fde177e22dc98390a6d55d215dd0301b5f6d0bb)의 실제 함수·분기를 읽었다
- KEP-4330은 [enhancements 고정 ref](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-architecture/4330-compatibility-versions/README.md)를 사용했고, [초기 문서 삭제 커밋](https://github.com/kubernetes/website/commit/f0ca297ac692c70f20a0519a3e2d345707e4639d)의 diff를 읽었다
- HA의 etcd 의미는 [v3.6 FAQ](https://etcd.io/docs/v3.6/faq/), [learner 설계](https://etcd.io/docs/v3.6/learning/design-learner/), [progress 요청 이슈](https://github.com/etcd-io/etcd/issues/9855)를 대조했다. 배포된 etcd 버전을 실측한 것이 아니다
- metrics-server RBAC은 [v0.9.0 태그](https://github.com/kubernetes-sigs/metrics-server/blob/v0.9.0/manifests/base/rbac.yaml)를 읽은 범위이며 설치 버전으로 주장하지 않았다
- 자료·manifest·편별 report는 `/tmp/k8s-batch05/{certificate,kubelet,version,ha,storage}/`에 있다. 영구 재확인 경로는 각 글의 고정 소스 링크다
- 기본 sandbox의 DNS 제한은 공식 소스 읽기 권한으로 해결했다. 실제 트리·import로 확인한 경로만 인용했고 실패한 404 경로를 근거로 사용하지 않았다

| 글 | 정정하거나 분명히 한 조건 |
|---|---|
| 인증서·사칭 | CTB/Projection/PCR의 v1.37 GA/on, CTB attest와 PCR sign 구분. 현행 constrained 사칭의 신원+작업 범위 검사·legacy 폴백·성공 캐시·헤더 제거 시점. 생성/자동 승인/서명 주체, self→node 승인 후보, 정상 갱신 70~90%와 예외 보존 |
| kubelet | FineGrainedAuthz의 v1.36 GA·잠김, Deny/NoOpinion 폴백과 오류 500. nodes/proxy 주소 검사와 logs 별도 경로, CA 서명과 self-signed 구분. `--kubelet-timeout` 5초를 실제 TCP 다이얼 상한으로 단정하지 않음 |
| 버전·롤백 | DRA gate의 실제 min compat 조건, 비 Alpha/min compat 우선과 Alpha 포함/emulated 재탐색·override. statusz 두 API 타입과 문서 예시 차이, OpenAPI info.version과 전체 과거 스키마의 동일 보장을 구분 |
| 이중화 | 최신 LIST는 getCurrentRV의 linearizable etcd 읽기가 필요하므로 frozen cache만으로 quorum 상실을 우회하지 않음. identity Lease의 현행 proxy 소비, storage prefix+masterleases baseKey, 3 election timeout·liveness 설정을 정확한 전환 시한으로 일반화하지 않음 |
| 저장 변환 | 안쪽 키 순서와 KMS 키 자료 유형까지 stale에 반영. KMSv1 기본 off와 구현 제거를 구분. 다중 API 서버의 새 키 읽기 후보 선배포, 손상 LIST 최대100 집계 뒤 실패, cache TTL과 AllowExpiredGet 조건 보존 |

보류하거나 새로 확인 필요로 남긴 기술 주장은 없다
실제 클러스터 설정 적용·권한 전파·statusz 응답·장애 전환 시간·키 회전·KMS 호출·손상 응답은 실행하지 않았다
본문은 소스와 문서 기반 설명이며, 예제·오류 문구를 실측 출력이나 개인 경험으로 바꾸지 않았다

#### 문체·의미 검수와 대표 문장

독립 reviewer가 원본 5편·본문 5편 전문과 공식 근거를 직접 읽었다
필수 수정 0건·확인 필요 0건이며, 초기 권장 4건을 반영한 뒤 미반영 권장도 0건이다
GC·CRD 첫 풀이, workqueue/expectations의 역할과 기존 글 연결, 저장 변환 재시도 문장을 보완했다
‘원본 노트는…’ 같은 편집 경위는 덜어내고 독자가 바로 읽을 수 있는 버전별 설명으로 정리했다
reviewer가 변경 구간을 다시 읽었으며, 보고서는 `/tmp/k8s-batch05/review.md`와 `review-hashes.json`에 있다

| 원문 | 변환 후 |
|---|---|
| “CSR 요청 기능과 승인 기능은 따로 갖춰야 한다” | “요청 기능과 승인 기능을 각각 마련해야 합니다” |
| “낡았으면 내용이 같아도 지름길을 안 탄다” | “stale이 true이면 내용이 같아도 이 조건을 통과하지 않습니다” |
| “컨트롤 플레인이 이중화돼 있다는 한 문장인데 층마다 다른 보장을 가리킨다” | “컨트롤 플레인을 여러 인스턴스로 구성했다고 해서 모든 구성요소가 같은 방식으로 장애를 견디는 것은 아닙니다” |

#### 실제 검사 결과

- `npm run lint:post -- <5개 파일>` — 최종 저장본 exit 0, error 0 / warn 5
  - 편별 긴 줄 경고 1개씩이며 100자 초과 줄은 23·26·23·31·22곳이다. 고정 URL·표·조건을 문맥으로 확인했고 길이만 맞추려고 근거를 삭제하지 않았다
- `npm run lint` — exit 0, error 0 / warn 1
  - 기존 `src/app/layout.tsx:80`의 `@next/next/no-page-custom-font` 경고는 요청 밖이므로 수정하지 않았다
- `npm run build` — 최종 저장본 exit 0, TypeScript·정적 생성·postbuild 성공, 570 pages
  - 권장 용어·문장 보완 후 재빌드했고 최종 문장 출력까지 확인했다. Turbopack 로컬 포트 권한으로 실행했으며 Node의 `DEP0205 module.register()` 경고는 남아 있다
- essays HTML 5개, `/my-blog/diagrams/` 이미지 11개 참조와 export SVG 바이트 일치, 내부 링크 실존, sitemap·RSS·llms.txt의 5개 slug 반영 확인
- `git diff --check` 성공. 원본 hash·기존 수정 12개·AGENTS.md 보존 확인. 빌드 훅이 바꾼 CLAUDE.md는 STATS 바깥이 동일함을 확인한 뒤 이번 자동 통계 변경만 복원
- 검수 hash와 현재 글·SVG·원본 hash 일치. 등록은 로컬 콘텐츠 저장과 export 검증까지이며 commit·push·배포는 실행 안 함
- Kubernetes 클러스터 실습·통합 테스트·런타임 실측은 실행 안 함

최종 검수 저장본:

| 글 | 줄 수 | SHA-256 |
|---|---:|---|
| `k8s-theory-certificate-signing-delegation.md` | 380 | `727d31f584a3cafbd0b82851b4c4d7e90b7bffc7a61482c7fa82044c8ca9257d` |
| `k8s-theory-kubelet-access.md` | 368 | `49627c838d59647692b0b54c19cc93787a76294ce3af64c4a07fece5eb551fb7` |
| `k8s-theory-version-emulation-rollback.md` | 273 | `4abdf6192bd99e21aec8660cc456aa8c49ffa8de6dfe8a5d486c87822b63a94e` |
| `k8s-theory-control-plane-high-availability.md` | 286 | `01ae8d1457afdefa96bace808663c6a314bc07fedf5e3f02af752b5aa3906400` |
| `k8s-theory-storage-transformations.md` | 289 | `fc837e40aeb09d4c407799f8ae3df2ca32d6be47dede8dc8049e5b1d68fbbf5d` |

### Batch 06 — 검수 완료 (2026-10-23)

정확한 원본 파일의 존재와 예정 slug 비충돌을 2026-10-23에 확인했다
2026-10-23 최신 원본과 관련 progress·source-map을 확인하고 SHA-256을 `/tmp/k8s-batch06/sources.json`에 기록했다
작성 에이전트 3명이 이벤트·분산 추적·스케줄링·preemption/PDB를 분담하고 주 담당자가 배치 제약과 통합 검증을 맡았다
별도 reviewer가 원본·공식 근거·문체·SVG를 독립 검토했고 최종 저장본의 lint·빌드·export 검증을 마쳤다
Phase 1 마지막 두 편 뒤 Phase 2로 넘어가며, 새 시리즈 `k8s-theory-node`의 order는 1부터 시작한다

| 좌표 | 정확한 원본 파일명 | 예정 slug | series / order | 상태 |
|---|---|---|---|---|
| 1-16 | `Phase 1-16 · 이벤트 압축과 두 그룹 · 한쪽은 눌러서 보내고 한쪽은 안 보낸다.md` | `k8s-theory-event-compression` | `k8s-theory-api` / 22 | 검수 완료 |
| 1-17 | `Phase 1-17 · 분산 추적과 계측 지점 · 스위치는 둘인데 출구는 셋이다.md` | `k8s-theory-distributed-tracing` | `k8s-theory-api` / 23 | 검수 완료 |
| 2-1 | `Phase 2-1 · 스케줄링 사이클과 바인딩 사이클.md` | `k8s-theory-scheduling-binding-cycles` | `k8s-theory-node` / 1 | 검수 완료 |
| 2-2 | `Phase 2-2 · 배치 제약의 표현 방식.md` | `k8s-theory-scheduling-constraints` | `k8s-theory-node` / 2 | 검수 완료 |
| 2-3 | `Phase 2-3 · preemption 과 PDB · 자리를 빼앗는 쪽과 지키는 쪽.md` | `k8s-theory-preemption-pdb` | `k8s-theory-node` / 3 | 검수 완료 |


### Batch 06 인계 — 2026-10-23

#### 원본 대응과 저장 결과

원본 루트는 `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`다
최신 원본 5편 전문과 관련 progress·source-map을 읽었으며 Vault는 읽기 전용으로 사용했다
작성 기준일 2026-10-23은 학습일이나 실제 배포일을 뜻하지 않는다
원본 관리 메타·종료 판정·미실행 LAB TODO·중복 glossary는 빼고 질문·기전·조건·예외를 남겼다
원본에 없는 실습·개인 경험·감정·실측 결과는 추가하지 않았다

| 좌표 | 정확한 원본 파일명 | 줄 수 | SHA-256 |
|---|---|---:|---|
| 1-16 | `Phase 1-16 · 이벤트 압축과 두 그룹 · 한쪽은 눌러서 보내고 한쪽은 안 보낸다.md` | 523 | `23736e0d099d9b6faaf67e81a196926f0fedd6d8aeaec2aeb18722ccae99ff44` |
| 1-17 | `Phase 1-17 · 분산 추적과 계측 지점 · 스위치는 둘인데 출구는 셋이다.md` | 567 | `648dd9aabf6494261464647d39cb46b230c71361ac558f183204772840ef9692` |
| 2-1 | `Phase 2-1 · 스케줄링 사이클과 바인딩 사이클.md` | 685 | `b22dc67e429968fb98f68ad86c5ef839f5bae0703351cee6c76b6284c667b7ac` |
| 2-2 | `Phase 2-2 · 배치 제약의 표현 방식.md` | 589 | `0e893091212f3b2a70fc26c87f372e377a969bc65686faf630a5f8a492a5fa42` |
| 2-3 | `Phase 2-3 · preemption 과 PDB · 자리를 빼앗는 쪽과 지키는 쪽.md` | 684 | `402c0b2bdb92d33bc186776adf608dae82b948b7c864fbcc37143f415026c203` |

위 slug로 `src/content/essays/kubernetes/`에 저장했다
앞 두 편은 `k8s-theory-api` order 22~23, 뒤 세 편은 새 `k8s-theory-node` order 1~3이다
두 시리즈의 전체 order 1~23·1~3에 중복·누락·트랙 분리가 없는지 검사했다

| 글 | SVG 구성 |
|---|---|
| Event | 1: 두 기록기의 큐·집계·시리즈·서버 저장 경로 |
| 분산 추적 | 1: 세 기록과 span 내보내기, 2: 필터 메트릭·span 시간 경계, 3: 외부 문맥의 부모·link 판정 |
| 스케줄링·바인딩 | 1: 직렬 결정과 비동기 바인딩, 2: 큐·재시도 관계, 3: 두 Pod의 결정·바인딩 중첩 |
| 배치 제약 | 1: Filter와 Score 역할, 2: zone·node domain의 차이 |
| preemption·PDB | 1: 기본 Pod preemption 흐름, 2: 제거 후보의 되돌림, 3: DELETE와 Eviction API의 PDB 경계 |

SVG 12장은 평탄한 `public/diagrams/{slug}-{n}.svg` 경로로 저장했다

작성자가 XML 파싱·sharp 렌더링·육안 검사를 수행했고 독립 reviewer가 의미·참조·렌더링을 대조했다
그림 수를 맞추지 않고 흐름·시간 관계·분기에는 SVG, 수치·설정·조건 비교에는 표, 판단 이유에는 산문을 사용했다

#### 근거 버전과 정정한 설명

- [Kubernetes v1.37.1 tag target](https://github.com/kubernetes/kubernetes/commit/f78e722310e50bcaca9276be22276d9e91d91308)과 [website 저장본](https://github.com/kubernetes/website/commit/7fde177e22dc98390a6d55d215dd0301b5f6d0bb)의 실제 함수·설정·기본값을 읽었다
- Event 설계는 [KEP-383 고정본](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-instrumentation/383-new-event-api-ga-graduation/README.md)을 대조했다
- 추적 SDK는 Kubernetes의 go.mod·vendor/modules.txt에서 OTel v1.44.0을 확인하고 포함된 구현을 읽었다. 현재 head/tail sampling은 [OpenTelemetry 공식 문서](https://opentelemetry.io/docs/concepts/sampling/)에서 확인했다
- QueueingHints의 GA 이력만 [v1.36.0 등록부](https://github.com/kubernetes/kubernetes/blob/v1.36.0/pkg/features/kube_features.go)를 별도로 읽었다. 현행 registry에 gate가 없다는 사실과 기능 제거를 구분했다
- 편별 근거·URL·SHA·대표 문장·검사 보고서는 `/tmp/k8s-batch06/{events,tracing,scheduling,constraints,preemption}/`에 있다. 재확인할 영구 경로는 각 글에 인용한 고정 소스 링크다
- 404 경로는 근거로 사용하지 않았다. 실제 tree·import에서 현행 파일을 찾아 다시 읽었다. 기본 sandbox의 DNS 제한은 공식 소스 읽기 권한으로 해결했다

| 글 | 정정하거나 분명히 한 조건 |
|---|---|
| Event | 집계는 저장된 개별 Event를 삭제하지 않으며 기본 600초는 마지막 관측 후의 간격이다. 반복키·집계키·spam키를 구분했다. 시리즈 종료 쓰기 성공과 최대 반영 지연을 보장하지 않으며 컴포넌트별 adapter·leader election 경로, 큐 입구·처리기 채널, 전송 제한·저장 TTL을 구분했다 |
| 분산 추적 | 필터 메트릭은 다음 TrackCompleted 진입까지, span은 하위 핸들러 반환까지다. 완료 지점에 도달해야 메트릭이 남는다. APIServerTracing gate 제거와 설정 필요를 구분했고, sampled 부모·무헤더 특권 요청의 기존 인증 부모, SDK TLS credentials 우선순위, BSP 30초·exporter 10초 제한을 실제 분기로 설명했다 |
| 스케줄링·바인딩 | unschedulableEntities와 두 backoff 힙, 기본 on인 조기 pop 예외를 반영했다. 0/N의 N은 Filter 호출 횟수가 아니며 0/1만으로 실패 단계를 확정하지 않는다. Permit 이후에도 플러그인 반환 코드에 따라 배치 거절로 분류될 수 있고 Unreserve는 성공한 API 쓰기 전체를 원복하지 않는다 |
| 배치 제약 | nodeSelector·required affinity·addedAffinity의 AND 관계와 self-affinity 첫 Pod 예외를 남겼다. 기본 spread는 selector 구성 조건이 있으며 minDomains는 domain을 생성하지 않는다. hostname fast path·집계 정책·admission 조건, NoExecute 삭제 주체와 300초·DaemonSet 예외, 현행 feature gate 조건을 분리했다 |
| preemption·PDB | PriorityClass.value는 immutable이며 기존 Pod의 priority는 클래스 재생성으로 자동 갱신되지 않는다. 기본 preemption은 같은 노드의 낮은 우선순위 Pod를 대상으로 한다. Permit 대기·PreBind 메모리 취소와 일반 DELETE, PDB best effort와 Eviction API의 강제 검사, PDB 계산 보정·nominatedNodeName의 한계를 구분했다 |

클러스터의 실제 전송·드롭·추적 계보·TLS 통신·큐 지연·바인딩·배치·제거·PDB 예산 동작은 실행하지 않았다
소스에서 확인한 조건을 실측이나 통합 테스트 실행으로 보고하지 않았다

#### 문체·의미 검수와 대표 문장

독립 reviewer가 원본 5편·본문 5편·SVG 12개와 주요 정정의 고정 소스를 대조했다
필수 수정 0건·확인 필요 0건이며 권장 2건을 반영한 뒤 해당 문맥을 재검토했다
한 번만 쓰는 preemptor를 한국어로 풀고, Ready=False로 한정한 문장을 Ready가 아닌 Pod로 보완했다

검토 보고서와 최종 hash는 `/tmp/k8s-batch06/review.md`·`review-hashes.json`에 있다
본문은 독자가 바로 읽을 수 있도록 편집 경위 표현을 덜고 정의·기전·조건을 연결했다

| 원문 | 변환 후 |
|---|---|
| “같은 저장 Event를 다른 API 그룹의 스키마로 조회하는 것만으로, 보내는 쪽에서 버린 관측이 복원되지는 않는다” | “같은 저장 Event를 다른 API 그룹으로 읽어도 보내는 쪽에서 버린 관측을 복원하지는 못합니다” |
| “minDomains가 새 도메인을 만들어 주지는 않는다” | “두 번째 설정은 부족한 domain을 생성하는 대신, 최소값을 0으로 보고 조건을 엄격하게 계산합니다” |
| “셋은 같은 필터 구간을 재지만, 각각의 기록 조건과 코드 경로는 다르다” | “이름이 authorization인 span의 전체 길이를 인가 함수만의 실행 시간으로 읽으면 안 됩니다” |

#### 실제 검사 결과

- `npm run lint:post -- <5개 파일>` — 최종 저장본 exit 0, error 0 / warn 5
  - 긴 줄 경고만 편별 1개이며 100자 초과 줄은 원본 대응 순서대로 16·19·22·23·18곳이다. 고정 URL·표·조건을 문맥 검토했고 길이만 맞추려고 근거를 삭제하지 않았다
- `npm run lint` — exit 0, error 0 / warn 1
  - 기존 `src/app/layout.tsx:80`의 `@next/next/no-page-custom-font` 경고는 요청 밖이므로 수정하지 않았다
- `npm run build` — 최종 저장본 exit 0, TypeScript·정적 생성·postbuild 성공, 580 pages

  - Turbopack 로컬 포트 권한으로 실행했다. Node의 `DEP0205 module.register()` 경고는 남아 있다
- essays HTML 5개와 `/my-blog/diagrams/` 이미지 12개 참조·export SVG 바이트 일치, 내부 링크 실존, sitemap·RSS·llms.txt의 5개 slug 반영 확인

- 최종 글·SVG가 검수 및 성공한 빌드 시점 hash와 같고, 원본 SHA-256 5개도 작업 전후 같다
- 기존 변경·직전 배치 결과·AGENTS.md 등 보호한 30개 파일의 hash가 작업 전과 같다. prebuild가 바꾼 CLAUDE.md는 STATS 바깥이 같은지 확인한 뒤 이번 자동 통계 변경만 복원했다
- `git diff --check` 성공
- 로컬 콘텐츠 저장과 정적 export 검증까지 수행했으며 commit·push·배포는 실행 안 함
- Kubernetes 클러스터 실습·통합 테스트·성능 실측은 실행 안 함

최종 검수 저장본:

| 글 | 줄 수 | SHA-256 |
|---|---:|---|
| `k8s-theory-event-compression.md` | 296 | `7d5f67458a633f1dc85a417f73da541bda558168fd103209f3ccb27baf613590` |
| `k8s-theory-distributed-tracing.md` | 324 | `20ccc63408be9c258aa6bae7b55356bb8edd5b4d3ebb1d434aa31c7d8d05d9bf` |
| `k8s-theory-scheduling-binding-cycles.md` | 318 | `9421ec09919b5860fb5b9afe10c6fb4883c303e4b7c923213a192be974aedad0` |
| `k8s-theory-scheduling-constraints.md` | 322 | `1127a1ee05434754c359c449de47a6a94450b9866d5fd2fef2c6ac510dd141ea` |
| `k8s-theory-preemption-pdb.md` | 334 | `b48b361a6ec6f808023d44e526a30289ad567b7db275284671b18d529fb165ef` |

### Batch 07 — 기존 5편 예정표 (아래 3편 배치 진행표로 대체)

정확한 원본 파일의 존재와 예정 slug 비충돌을 2026-10-23에 확인했다
아직 본문·근거를 검수하지 않았다. 다음 요청에서 최신 원본·progress·source-map과 hash를 다시 확인한다

| 좌표 | 정확한 원본 파일명 | 예정 slug | series / order | 상태 |
|---|---|---|---|---|
| 2-4 | `Phase 2-4 · kubelet 과 Pod 수명주기 · 노드 위에서 살아 있다는 판정.md` | `k8s-theory-kubelet-pod-lifecycle` | `k8s-theory-node` / 4 | 미착수 |
| 2-5 | `Phase 2-5 · QoS 와 cgroup · 장부가 되는 숫자와 울타리가 되는 숫자.md` | `k8s-theory-qos-cgroups` | `k8s-theory-node` / 5 | 미착수 |
| 2-6 | `Phase 2-6 · eviction 과 OOM · 죽이는 쪽이 셋이다.md` | `k8s-theory-eviction-oom` | `k8s-theory-node` / 6 | 미착수 |
| 2-7 | `Phase 2-7 · 관측 세 소스 · 같은 것을 묻는 세 개의 창구.md` | `k8s-theory-node-observability-sources` | `k8s-theory-node` / 7 | 미착수 |
| 2-8.1 | `Phase 2-8.1 · Deployment 와 DaemonSet (1) · 되돌리기는 앞으로 간다.md` | `k8s-theory-workload-rollout-revisions` | `k8s-theory-node` / 8 | 미착수 |

### 커밋·등록 점검 — 2026-10-23

사용자의 추가 요청으로 기존 수정과 Batch 05·06 결과를 목적별로 나눠 커밋했다
앞선 배치 기록의 ‘commit 실행 안 함’은 각 검수 시점의 상태다

| 커밋 | 범위 |
|---|---|
| `5806f9c` | 기존 Kubernetes·Go 해설 12편의 표현과 조건 명확화 |
| `b22f593` | API 시리즈 17~21편과 SVG 11장 |
| `e53bad0` | Event·분산 추적 22~23편과 SVG 4장 |
| `754fbd7` | 노드 시리즈 1~3편과 SVG 8장 |
| 이 기록을 반영한 별도 docs 커밋 | Batch 05·06 검수 인계와 등록 상태, 다음 5편 |

글 자체의 등록 누락은 발견하지 못했다
완료 목록의 26편이 모두 `src/content/essays/kubernetes/`에 있고, 실제 `getAllPosts`·`getEssaysList`·`getSearchIndex` 실행 결과에 포함된다
26편의 개별 HTML·목록 payload·sitemap·llms 반영도 확인했다
전체 콘텐츠 380편(essays 174·logs 206)도 정적 출력의 개별 HTML 누락이 없다
다른 완료 계획의 kernel-runtime slug 28개와 tech-explainer 59편도 실존한다
미착수 draft, 통합·이동된 과거 글, 정책상 숨긴 logs를 등록 누락으로 세지 않았다

다만 시리즈 전용 노출과 공개 배포는 다음 상태다

- `src/lib/series.ts`의 `seriesList`에는 `k8s-theory-api`·`k8s-theory-node`가 없다. 홈 시리즈 카드·`/series/` 카드·전용 상세 페이지는 미등록이며 이번 커밋 작업에서 UI나 메타를 추가하지 않았다
- 본문 시리즈 목차·이전/다음 링크는 front matter를 사용하므로 두 시리즈에서도 작동한다
- [공개 sitemap](https://resskim-io.github.io/my-blog/sitemap.xml)을 실제 조회했으며 k8s-theory URL은 0개다. [첫 편](https://resskim-io.github.io/my-blog/essays/k8s-theory-api-request-path/)과 [마지막 편](https://resskim-io.github.io/my-blog/essays/k8s-theory-preemption-pdb/)은 모두 HTTP 404였다
- 공개 GitHub API로 확인한 원격 main은 `908f49c227a67f95102ffd2377d3e2ab7b6d26a5`다. 앞선 16편을 담은 `a5d6e83`도 원격에 반영되지 않았다. 이번 로컬 커밋까지 포함해 push·GitHub Pages 배포는 실행하지 않았다

커밋 직전 변경 글 22편의 post lint는 error 0 / warn 25였다
긴 줄 경고 22개와 기존 SVG 텍스트 수 권장 초과 경고 3개를 확인했으며 요청 밖의 그림 재구성은 하지 않았다
글·SVG 바이트는 직전 성공한 580 pages 빌드 저장본과 같으며, 등록 조사나 커밋을 위해 콘텐츠를 추가 수정하지 않았다
근거·원시 결과는 `/tmp/k8s-commit-audit/`와 독립 조사 결과에 보존했다

## 2026-10-23 연속 변환 — Batch 07~16

현재 요청이 이전 5편 규칙을 대체한다. 완료 목표는 추가 30편이며 작성·검수·lint·build·정적 출력 검증을 모두 통과한 글만 센다
원본 파일 존재와 최초 SHA-256은 시작 시 확인했으며 전문·공식 근거 검수는 배치별로 수행한다

| 배치 | 좌표 | 예정 series / order | 상태 | 검증 | 콘텐츠 커밋 | 다음 대상 |
|---|---|---|---|---|---|---|
| 07 | 2-4, 2-5, 2-6 | k8s-theory-node / 4; k8s-theory-node / 5; k8s-theory-node / 6 | 검수 완료 | post lint 0/3, 전체 lint 0/1, build 586, export 통과; [근거·검수](batches/batch-07.md) | `cc7ff41` | 2-7, 2-8.1, 2-8.2 |
| 08 | 2-7, 2-8.1, 2-8.2 | k8s-theory-node / 7; k8s-theory-node / 8; k8s-theory-node / 9 | 검수 완료 | post lint 0/3, 전체 lint 0/1, build 592, export 통과; [근거·검수](batches/batch-08.md) | `4db7801` | 2-9, 2-10, 2-11 |
| 09 | 2-9, 2-10, 2-11 | k8s-theory-node / 10; k8s-theory-node / 11; k8s-theory-node / 12 | 검수 완료 | post lint 0/3, 전체 lint 0/1, build 598, export 통과; [근거·검수](batches/batch-09.md) | `fbcd25e` | 2-12, 2-13, 2-14 |
| 10 | 2-12, 2-13, 2-14 | k8s-theory-node / 13; k8s-theory-node / 14; k8s-theory-node / 15 | 검수 완료 | post lint 0/3, 전체 lint 0/1, build 604, export 통과; [근거·검수](batches/batch-10.md) | `2167f11` | 2-15, 2-16, 2-17 |
| 11 | 2-15, 2-16, 2-17 | k8s-theory-node / 16; k8s-theory-node / 17; k8s-theory-node / 18 | 검수 완료 | post lint 0/3, 전체 lint 0/1, build 610, export 통과; [근거·검수](batches/batch-11.md) | `31c4495` | 2-18, 3-1, 3-2.1 |
| 12 | 2-18, 3-1, 3-2.1 | k8s-theory-node / 19; k8s-theory-network / 1; k8s-theory-network / 2 | 검수 완료 | post lint 0/3, 전체 lint 0/1, build 616, export 통과; [근거·검수](batches/batch-12.md) | `3c62d6a` | 3-2.2, 3-3, 3-4 |
| 13 | 3-2.2, 3-3, 3-4 | k8s-theory-network / 3; k8s-theory-network / 4; k8s-theory-network / 5 | 검수 완료 | post lint 0/3, 전체 lint 0/1, build 622, export 통과; [근거·검수](batches/batch-13.md) | `a999ddc` | 3-5, 3-6, 3-7 |
| 14 | 3-5, 3-6, 3-7 | k8s-theory-network / 6; k8s-theory-network / 7; k8s-theory-network / 8 | 검수 완료 | post lint 0/3, 전체 lint 0/1, build 628, export 통과; [근거·검수](batches/batch-14.md) | `36b28e6` | 3-8, 3-9, 3-10 |
| 15 | 3-8, 3-9, 3-10 | k8s-theory-network / 9; k8s-theory-network / 10; k8s-theory-network / 11 | 검수 완료 | post lint 0/3, 전체 lint 0/1, build 634, export 통과; [근거·검수](batches/batch-15.md) | `28a9375` | 4-1, 4-2, 4-3 |
| 16 | 4-1, 4-2, 4-3 | k8s-theory-storage / 1; k8s-theory-storage / 2; k8s-theory-storage / 3 | 검수 완료 | post lint 0/4, 전체 lint 0/1, build 640, export 통과; [근거·검수](batches/batch-16.md) | `c5f8353` | 4-4, 4-5, 4-6 |

### 확정한 원본·slug·시리즈 대응

| 배치 | 좌표 | 정확한 원본 파일명 | slug | series / order | 상태 |
|---|---|---|---|---|---|
| 07 | 2-4 | `Phase 2-4 · kubelet 과 Pod 수명주기 · 노드 위에서 살아 있다는 판정.md` | `k8s-theory-kubelet-pod-lifecycle` | `k8s-theory-node` / 4 | 검수 완료 |
| 07 | 2-5 | `Phase 2-5 · QoS 와 cgroup · 장부가 되는 숫자와 울타리가 되는 숫자.md` | `k8s-theory-qos-cgroups` | `k8s-theory-node` / 5 | 검수 완료 |
| 07 | 2-6 | `Phase 2-6 · eviction 과 OOM · 죽이는 쪽이 셋이다.md` | `k8s-theory-eviction-oom` | `k8s-theory-node` / 6 | 검수 완료 |
| 08 | 2-7 | `Phase 2-7 · 관측 세 소스 · 같은 것을 묻는 세 개의 창구.md` | `k8s-theory-node-observability-sources` | `k8s-theory-node` / 7 | 검수 완료 |
| 08 | 2-8.1 | `Phase 2-8.1 · Deployment 와 DaemonSet (1) · 되돌리기는 앞으로 간다.md` | `k8s-theory-workload-rollout-revisions` | `k8s-theory-node` / 8 | 검수 완료 |
| 08 | 2-8.2 | `Phase 2-8.2 · Job 과 CronJob (2) · 끝은 상태가 아니라 개수다.md` | `k8s-theory-job-cronjob-completion` | `k8s-theory-node` / 9 | 검수 완료 |
| 09 | 2-9 | `Phase 2-9 · 노드 하트비트와 taint 축출 · 죽었다는 말은 노드가 하지 않는다.md` | `k8s-theory-node-heartbeat-taint-eviction` | `k8s-theory-node` / 10 | 검수 완료 |
| 09 | 2-10 | `Phase 2-10 · ConfigMap 과 Secret 전달 경로 · 복사한 값은 늙는다.md` | `k8s-theory-configmap-secret-delivery` | `k8s-theory-node` / 11 | 검수 완료 |
| 09 | 2-11 | `Phase 2-11 · CRI 와 OCI 경계 · 두 번째 계약은 API 가 아니라 파일이다.md` | `k8s-theory-cri-oci-boundary` | `k8s-theory-node` / 12 | 검수 완료 |
| 10 | 2-12 | `Phase 2-12 · 장치 자원 · 개수는 어느 것인지를 말하지 못한다.md` | `k8s-theory-device-resource-allocation` | `k8s-theory-node` / 13 | 검수 완료 |
| 10 | 2-13 | `Phase 2-13 · 런타임 격리 · 지정하지 않았다는 말이 필드마다 다르다.md` | `k8s-theory-runtime-isolation` | `k8s-theory-node` / 14 | 검수 완료 |
| 10 | 2-14 | `Phase 2-14 · 자원 회계와 점수 전략 · 세는 쪽도 고르는 쪽도 Pod 밖에 있다.md` | `k8s-theory-resource-accounting-scoring` | `k8s-theory-node` / 15 | 검수 완료 |
| 11 | 2-15 | `Phase 2-15 · 노드의 swap · 나눠주는 쪽만 알고 세는 쪽은 모른다.md` | `k8s-theory-node-swap` | `k8s-theory-node` / 16 | 검수 완료 |
| 11 | 2-16 | `Phase 2-16 · 컨테이너 로그 파일 · 경로를 정한 쪽은 그 파일을 안 쓴다.md` | `k8s-theory-container-log-files` | `k8s-theory-node` / 17 | 검수 완료 |
| 11 | 2-17 | `Phase 2-17 · HPA 와 scale subresource · 같은 칸을 다른 문으로 쓴다.md` | `k8s-theory-hpa-scale-subresource` | `k8s-theory-node` / 18 | 검수 완료 |
| 12 | 2-18 | `Phase 2-18 · 임시 컨테이너와 ephemeralcontainers · 더하기만 되는 문은 아무것도 바꾸지 못한다.md` | `k8s-theory-ephemeral-containers` | `k8s-theory-node` / 19 | 검수 완료 |
| 12 | 3-1 | `Phase 3-1 · CNI spec · 만들지 않고 요구만 한다.md` | `k8s-theory-cni-contract` | `k8s-theory-network` / 1 | 검수 완료 |
| 12 | 3-2.1 | `Phase 3-2.1 · sandbox 와 pause (1) · 주소는 컨테이너가 아니라 그 옆에 붙는다.md` | `k8s-theory-pod-sandbox-pause` | `k8s-theory-network` / 2 | 검수 완료 |
| 13 | 3-2.2 | `Phase 3-2.2 · overlay 와 native routing (2) · 노드를 넘는 순간 k8s 는 말이 없다.md` | `k8s-theory-overlay-native-routing` | `k8s-theory-network` / 3 | 검수 완료 |
| 13 | 3-3 | `Phase 3-3 · Service 와 kube-proxy · 주소가 아니라 규칙이다.md` | `k8s-theory-service-kube-proxy` | `k8s-theory-network` / 4 | 검수 완료 |
| 13 | 3-4 | `Phase 3-4 · DNS 와 ndots · 이름 하나에 패킷 여덟 개.md` | `k8s-theory-dns-ndots` | `k8s-theory-network` / 5 | 검수 완료 |
| 14 | 3-5 | `Phase 3-5 · Ingress 와 Gateway API · 한 오브젝트에 세 사람이 있었다.md` | `k8s-theory-ingress-gateway-api` | `k8s-theory-network` / 6 | 검수 완료 |
| 14 | 3-6 | `Phase 3-6 · NetworkPolicy · 기본값을 뒤집는 스위치.md` | `k8s-theory-network-policy` | `k8s-theory-network` / 7 | 검수 완료 |
| 14 | 3-7 | `Phase 3-7 · ANP 와 BANP · 정하지 않겠다고 적는 칸이 필요했다.md` | `k8s-theory-admin-network-policy` | `k8s-theory-network` / 8 | 검수 완료 |
| 15 | 3-8 | `Phase 3-8 · CCM 과 클라우드 경계 · 밖이 채울 칸은 안에서 먼저 잠근다.md` | `k8s-theory-cloud-controller-boundary` | `k8s-theory-network` / 9 | 검수 완료 |
| 15 | 3-9 | `Phase 3-9 · 트래픽 지역성과 dual-stack · 앞자리가 비면 떨어뜨리거나 되돌아간다.md` | `k8s-theory-traffic-locality-dual-stack` | `k8s-theory-network` / 10 | 검수 완료 |
| 15 | 3-10 | `Phase 3-10 · ServiceCIDR 와 IPAddress · 이름이 곧 자물쇠다.md` | `k8s-theory-service-cidr-ip-address` | `k8s-theory-network` / 11 | 검수 완료 |
| 16 | 4-1 | `Phase 4-1 · PVC 바인딩과 StorageClass · claimRef 를 먼저 쓰는 쪽이 정한다.md` | `k8s-theory-pvc-storageclass-binding` | `k8s-theory-storage` / 1 | 검수 완료 |
| 16 | 4-2 | `Phase 4-2 · CSI 구조 · 코어는 노드 쪽 절반만 부른다.md` | `k8s-theory-csi-architecture` | `k8s-theory-storage` / 2 | 검수 완료 |
| 16 | 4-3 | `Phase 4-3 · attach 와 stage 와 publish · 한 번씩이 서로 다른 한 번이다.md` | `k8s-theory-volume-attach-stage-publish` | `k8s-theory-storage` / 3 | 검수 완료 |

### Batch 07 검수·커밋 완료 — 2026-10-23

좌표 2-4, 2-5, 2-6, 글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `cc7ff41`
근거·원본 hash·정정·별도 검수·검증 상세는 [배치 인계](batches/batch-07.md)에 보존한다
post lint error 0/warn 3, 전체 lint error 0/warn 1, build 586 pages 및 로컬 등록·정적 출력 검증 통과
이번 요청 누적 3/30편, 보류 0편. 다음 대상: 2-7, 2-8.1, 2-8.2

### Batch 08 검수·커밋 완료 — 2026-10-23

좌표 2-7, 2-8.1, 2-8.2, 글 3편·SVG 7장 검수 완료. 콘텐츠 커밋 `4db7801`
근거·원본 hash·정정·별도 검수·검증 상세는 [배치 인계](batches/batch-08.md)에 보존한다
post lint error 0/warn 3, 전체 lint error 0/warn 1, build 592 pages 및 로컬 등록·정적 출력 검증 통과
이번 요청 누적 6/30편, 보류 0편. 다음 대상: 2-9, 2-10, 2-11

### Batch 09 검수·커밋 완료 — 2026-10-23

좌표 2-9, 2-10, 2-11, 글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `fbcd25e`
근거·원본 hash·정정·별도 검수·검증 상세는 [배치 인계](batches/batch-09.md)에 보존한다
post lint error 0/warn 3, 전체 lint error 0/warn 1, build 598 pages 및 로컬 등록·정적 출력 검증 통과
이번 요청 누적 9/30편, 보류 0편. 다음 대상: 2-12, 2-13, 2-14

### Batch 10 검수·커밋 완료 — 2026-10-23

좌표 2-12, 2-13, 2-14, 글 3편·SVG 7장 검수 완료. 콘텐츠 커밋 `2167f11`
근거·원본 hash·정정·별도 검수·검증 상세는 [배치 인계](batches/batch-10.md)에 보존한다
post lint error 0/warn 3, 전체 lint error 0/warn 1, build 604 pages 및 로컬 등록·정적 출력 검증 통과
이번 요청 누적 12/30편, 보류 0편. 다음 대상: 2-15, 2-16, 2-17

### Batch 11 검수·커밋 완료 — 2026-10-23

좌표 2-15, 2-16, 2-17, 글 3편·SVG 5장 검수 완료. 콘텐츠 커밋 `31c4495`
근거·원본 hash·정정·별도 검수·검증 상세는 [배치 인계](batches/batch-11.md)에 보존한다
post lint error 0/warn 3, 전체 lint error 0/warn 1, build 610 pages 및 로컬 등록·정적 출력 검증 통과
이번 요청 누적 15/30편, 보류 0편. 다음 대상: 2-18, 3-1, 3-2.1

### Batch 12 검수·커밋 완료 — 2026-10-23

좌표 2-18, 3-1, 3-2.1, 글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `3c62d6a`
근거·원본 hash·정정·별도 검수·검증 상세는 [배치 인계](batches/batch-12.md)에 보존한다
post lint error 0/warn 3, 전체 lint error 0/warn 1, build 616 pages 및 로컬 등록·정적 출력 검증 통과
이번 요청 누적 18/30편, 보류 0편. 다음 대상: 3-2.2, 3-3, 3-4

### Batch 13 검수·커밋 완료 — 2026-10-23

좌표 3-2.2, 3-3, 3-4, 글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `a999ddc`
근거·원본 hash·정정·별도 검수·검증 상세는 [배치 인계](batches/batch-13.md)에 보존한다
post lint error 0/warn 3, 전체 lint error 0/warn 1, build 622 pages 및 로컬 등록·정적 출력 검증 통과
이번 요청 누적 21/30편, 보류 0편. 다음 대상: 3-5, 3-6, 3-7

### Batch 14 검수·커밋 완료 — 2026-10-23

좌표 3-5, 3-6, 3-7, 글 3편·SVG 5장 검수 완료. 콘텐츠 커밋 `36b28e6`
근거·원본 hash·정정·별도 검수·검증 상세는 [배치 인계](batches/batch-14.md)에 보존한다
post lint error 0/warn 3, 전체 lint error 0/warn 1, build 628 pages 및 로컬 등록·정적 출력 검증 통과
이번 요청 누적 24/30편, 보류 0편. 다음 대상: 3-8, 3-9, 3-10

### Batch 15 검수·커밋 완료 — 2026-10-23

좌표 3-8, 3-9, 3-10, 글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `28a9375`
근거·원본 hash·정정·별도 검수·검증 상세는 [배치 인계](batches/batch-15.md)에 보존한다
post lint error 0/warn 3, 전체 lint error 0/warn 1, build 634 pages 및 로컬 등록·정적 출력 검증 통과
이번 요청 누적 27/30편, 보류 0편. 다음 대상: 4-1, 4-2, 4-3

### Batch 16 검수·커밋 완료 — 2026-10-23

좌표 4-1, 4-2, 4-3, 글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `c5f8353`
근거·원본 hash·정정·별도 검수·검증 상세는 [배치 인계](batches/batch-16.md)에 보존한다
post lint error 0/warn 4, 전체 lint error 0/warn 1, build 640 pages 및 로컬 등록·정적 출력 검증 통과
이번 요청 누적 30/30편, 보류 0편. 다음 대상: 4-4, 4-5, 4-6

## 30편 연속 작업 최종 인계

[배치별 커밋·검증·남은 문제·다음 3편](batches/summary-30.md)

추가 30편 검수·로컬 커밋 완료, 보류 0편. 다음은 Phase 4-4·4-5·4-6이다
push·배포·시리즈 카드 등록은 실행하지 않았다

## 2026-10-23 잔여 15편 변환 — Batch 17~21

사용자가 남은 글도 이전 조건으로 에이전트 분담을 통해 변환하도록 요청했다
기준선은 `cc2bd80`의 56편이며 시작 시 원본 71개 중 미변환 15개를 확인했다
3명 작성 → 별도 검수 → 수정 → 실제 post lint·전체 lint·build·정적 출력 → 로컬 커밋을 반복한다
검증 실패·핵심 근거 부족은 완료 수에서 제외하고 보류 이유를 남긴다
Vault는 읽기 전용이며 push·배포·시리즈 카드 등록은 하지 않는다

| 배치 | 좌표 | 상태 | 검증·근거 기록 | 콘텐츠 커밋 | 다음 대상 |
|---|---|---|---|---|---|
| 17 | 4-4, 4-5, 4-6 | 검수 완료 | post lint 0/5, lint 0/1, build 646·export 통과; [근거·검수](batches/batch-17.md) | `87fe769` | 4-7, 5-1, 5-2 |
| 18 | 4-7, 5-1, 5-2 | 검수 완료 | post lint 0/4, lint 0/1, build 652·export 통과; [근거·검수](batches/batch-18.md) | `7b3ab8b` | 5-3, 5-4, 5-5 |
| 19 | 5-3, 5-4, 5-5 | 검수 완료 | post lint 0/5, lint 0/1, build 658·export 통과; [근거·검수](batches/batch-19.md) | `6cff167` | 5-6, kernel-1, kernel-2 |
| 20 | 5-6, kernel-1, kernel-2 | 검수 완료 | post lint 0/4, lint 0/1, build 664·export 통과; [근거·검수](batches/batch-20.md) | `9e22fbf` | kernel-3, kernel-4, kernel-5 |
| 21 | kernel-3, kernel-4, kernel-5 | 검수 완료 | post lint 0/3, lint 0/1, build 670·export 통과; [근거·검수](batches/batch-21.md) | `02805d1` | 없음 (현재 원본 목록 기준) |

### 잔여 원본·slug·시리즈 대응

| 배치 | 좌표 | 정확한 원본 파일명 | slug | series / order | 상태 |
|---|---|---|---|---|---|
| 17 | 4-4 | `Phase 4-4 · StatefulSet과 볼륨 수명 · 지우는 대신 주인을 바꾼다.md` | `k8s-theory-statefulset-volume-lifecycle` | `k8s-theory-storage` / 4 | 검수 완료 |
| 17 | 4-5 | `Phase 4-5 · 확장과 스냅샷과 임시 볼륨 · 나중에 하는 일에 새 장치는 없다.md` | `k8s-theory-volume-expansion-snapshots-ephemeral` | `k8s-theory-storage` / 5 | 검수 완료 |
| 17 | 4-6 | `Phase 4-6 · 볼륨 개수 상한 · 드라이버가 말한 숫자를 누가 고치나.md` | `k8s-theory-volume-attachment-limits` | `k8s-theory-storage` / 6 | 검수 완료 |
| 18 | 4-7 | `Phase 4-7 · 용량 기반 스케줄링 · 모르면 없다고 치지만 안 켜면 묻지 않는다.md` | `k8s-theory-storage-capacity-scheduling` | `k8s-theory-storage` / 7 | 검수 완료 |
| 18 | 5-1 | `Phase 5-1 · CRD 구조 · 선언한 만큼만 존재한다.md` | `k8s-theory-crd-schema-pruning` | `k8s-theory-extension` / 1 | 검수 완료 |
| 18 | 5-2 | `Phase 5-2 · CRD 버저닝과 conversion · 저장은 한 벌뿐이고 나머지는 그때 만든다.md` | `k8s-theory-crd-version-conversion` | `k8s-theory-extension` / 2 | 검수 완료 |
| 19 | 5-3 | `Phase 5-3 · controller-runtime 과 reconcile · 큐에 담기는 것은 이름뿐이다.md` | `k8s-theory-controller-runtime-reconcile` | `k8s-theory-extension` / 3 | 검수 완료 |
| 19 | 5-4 | `Phase 5-4 · 정책 계층 · 판정은 사라지고 변경은 주인이 없다.md` | `k8s-theory-policy-layers` | `k8s-theory-extension` / 4 | 검수 완료 |
| 19 | 5-5 | `Phase 5-5 · Aggregated API server · 경로 하나를 넘기면 목록 전체가 걸린다.md` | `k8s-theory-aggregated-api-server` | `k8s-theory-extension` / 5 | 검수 완료 |
| 20 | 5-6 | `Phase 5-6 · 통합 · 한 칸 올라갈 때마다 죽을 수 있는 것이 하나 는다.md` | `k8s-theory-extension-failure-boundaries` | `k8s-theory-extension` / 6 | 검수 완료 |
| 20 | kernel-1 | `커널 하강 1 · cgroup v2 인터페이스와 CFS quota.md` | `k8s-theory-cgroup-v2-cpu-quota` | `k8s-theory-kernel` / 1 | 검수 완료 |
| 20 | kernel-2 | `커널 하강 2 · netfilter hook 과 conntrack.md` | `k8s-theory-netfilter-conntrack` | `k8s-theory-kernel` / 2 | 검수 완료 |
| 21 | kernel-3 | `커널 하강 3 · mount 와 bind mount.md` | `k8s-theory-mount-bind-mount` | `k8s-theory-kernel` / 3 | 검수 완료 |
| 21 | kernel-4 | `커널 하강 4 · 페이지 캐시 회수와 OOM.md` | `k8s-theory-page-cache-reclaim-oom` | `k8s-theory-kernel` / 4 | 검수 완료 |
| 21 | kernel-5 | `커널 하강 5 · namespace 수명.md` | `k8s-theory-namespace-lifetime` | `k8s-theory-kernel` / 5 | 검수 완료 |

### Batch 17 검수·커밋 완료 — 2026-10-23

좌표 4-4, 4-5, 4-6, 글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `87fe769`
원본 hash·공식 근거·정정·별도 검수·실제 검증은 [배치 인계](batches/batch-17.md)에 보존한다
post lint error 0/warn 5, 전체 lint error 0/warn 1, build 646 pages와 로컬 등록·정적 출력 검증 통과
다음 대상: 4-7, 5-1, 5-2

### Batch 18 검수·커밋 완료 — 2026-10-23

좌표 4-7, 5-1, 5-2, 글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `7b3ab8b`
원본 hash·공식 근거·정정·별도 검수·실제 검증은 [배치 인계](batches/batch-18.md)에 보존한다
post lint error 0/warn 4, 전체 lint error 0/warn 1, build 652 pages와 로컬 등록·정적 출력 검증 통과
다음 대상: 5-3, 5-4, 5-5

### Batch 19 검수·커밋 완료 — 2026-10-24

좌표 5-3, 5-4, 5-5, 글 3편·SVG 7장 검수 완료. 콘텐츠 커밋 `6cff167`
원본 hash·공식 근거·정정·별도 검수·실제 검증은 [배치 인계](batches/batch-19.md)에 보존한다
post lint error 0/warn 5, 전체 lint error 0/warn 1, build 658 pages와 로컬 등록·정적 출력 검증 통과
다음 대상: 5-6, kernel-1, kernel-2

### Batch 20 검수·커밋 완료 — 2026-10-24

좌표 5-6, kernel-1, kernel-2, 글 3편·SVG 5장 검수 완료. 콘텐츠 커밋 `9e22fbf`
원본 hash·공식 근거·정정·별도 검수·실제 검증은 [배치 인계](batches/batch-20.md)에 보존한다
post lint error 0/warn 4, 전체 lint error 0/warn 1, build 664 pages와 로컬 등록·정적 출력 검증 통과
다음 대상: kernel-3, kernel-4, kernel-5

### Batch 21 검수·커밋 완료 — 2026-10-24

좌표 kernel-3, kernel-4, kernel-5, 글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `02805d1`
원본 hash·공식 근거·정정·별도 검수·실제 검증은 [배치 인계](batches/batch-21.md)에 보존한다
post lint error 0/warn 3, 전체 lint error 0/warn 1, build 670 pages와 로컬 등록·정적 출력 검증 통과
다음 대상: 없음 (현재 원본 목록 기준)
