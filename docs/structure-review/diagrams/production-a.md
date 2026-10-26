# 추가 다이어그램 제작 A

상태: 4편 SVG 제작·본문 삽입·자체 렌더 확인·독립 내용·시각 검토 완료

독립 검토 결과와 제목 반송 재확인은 [독립 검토 기록](independent-review.md)에, 최종 통합 실행 검증은 [검증 기록](verification.md)에 기록합니다

승인된 plan.md·design-notes-a.md와 review-checklist.md를 기준으로 작업했습니다
담당 원문 4편 전문과 기존 SVG 9장을 읽은 뒤 기존 설명을 삭제하거나 교체하지 않고 새 이미지와 필요한 연결 한 문장만 추가했습니다

## 제작과 삽입 위치

| 글 | 새 SVG | 본문 삽입 위치 | 자체 내용 검토 | 독립 검토 |
|---|---|---|---|---|
| resource-accounting-scoring | `public/diagrams/k8s-theory-resource-accounting-scoring-3.svg` | `src/content/essays/kubernetes/k8s-theory-resource-accounting-scoring.md:39`, 기본 init·sidecar 집계 설명 뒤 | A·B 순차 실행, S의 후속 구간 겹침, S 단독 시작 단계, 자원별 최댓값, 컨테이너 수준 범위 보존 | 완료 |
| hpa-scale-subresource | `public/diagrams/k8s-theory-hpa-scale-subresource-3.svg` | `src/content/essays/kubernetes/k8s-theory-hpa-scale-subresource.md:157`, 추천 7·3 예시 뒤 | 제한 전 추천 이력, 같은 시간 좌표와 328px의 같은 창 폭, 두 번째 장면의 추가 추천 가정, 이후 정책 평가 표시 | 완료 |
| page-cache-reclaim-oom | `public/diagrams/k8s-theory-page-cache-reclaim-oom-3.svg` | `src/content/essays/kubernetes/k8s-theory-page-cache-reclaim-oom.md:34`, working set 계산식 뒤 | 같은 메모리 상태의 두 표시, 제외한 캐시의 해칭 유지, 빈 메모리가 아니라는 설명, 0 하한·cAdvisor 계산 범위·비축척 가정 표시 | 완료 |
| device-resource-allocation | `public/diagrams/k8s-theory-device-resource-allocation-4.svg` | `src/content/essays/kubernetes/k8s-theory-device-resource-allocation.md:207`, NUMA와 Kubernetes Node 정의 뒤 | 서버 외곽 하나, CPU 집합의 중립 표시, CPU A에서 GPU B로 출발·도착하는 선, 수량과 위치 조건 분리, 정책별 admission 결과 미단정 | 완료 |

자원 집계 글에 가정 배치 한 문장만 추가했으며 나머지 세 글에는 이미지 참조만 추가했습니다
CPU·메모리 최대 단계가 다를 수 있다는 설명과 Pod-level 대체·overhead 순서는 인접 본문에 남겼습니다
HPA의 기본 300초·scale up 조건, working set의 회수 비용·할당 제약, NUMA의 정책·scope·전용 할당 조건도 그대로 유지했습니다

## 실제 렌더 확인

저장소에 설치된 `sharp` 0.34.5로 원본 폭 560px와 모바일 본문 폭 335px PNG를 생성했습니다
추가 의존성은 설치하지 않았습니다
아래 PNG 8개를 `view_image`로 실제 확인했습니다

| SVG 이름 | desktop PNG | mobile PNG | 결과 |
|---|---|---|---|
| resource-accounting-scoring-3 | `/tmp/k8s-diagram-renders/k8s-theory-resource-accounting-scoring-3-desktop.png` | `/tmp/k8s-diagram-renders/k8s-theory-resource-accounting-scoring-3-mobile.png` | 요청 합계의 열 정렬·지속 막대·최댓값 식·하단 조건 확인 |
| hpa-scale-subresource-3 | `/tmp/k8s-diagram-renders/k8s-theory-hpa-scale-subresource-3-desktop.png` | `/tmp/k8s-diagram-renders/k8s-theory-hpa-scale-subresource-3-mobile.png` | 창 안팎 구분·같은 폭·추천 숫자와 범례·후속 조건 확인 |
| page-cache-reclaim-oom-3 | `/tmp/k8s-diagram-renders/k8s-theory-page-cache-reclaim-oom-3-desktop.png` | `/tmp/k8s-diagram-renders/k8s-theory-page-cache-reclaim-oom-3-mobile.png` | 상하 같은 해칭·집계 제외 라벨·0 하한·버전 조건 확인 |
| device-resource-allocation-4 | `/tmp/k8s-diagram-renders/k8s-theory-device-resource-allocation-4-desktop.png` | `/tmp/k8s-diagram-renders/k8s-theory-device-resource-allocation-4-mobile.png` | CPU 집합·선 시작점·다른 NUMA 접근 방향·서버 경계 확인 |

글자 잘림·겹침·잘못된 화살표 도착점은 자체 렌더 확인에서 발견하지 않았습니다
NUMA 각주는 “NUMA와 소켓·칩의 경계는 항상 같지 않음”으로 고쳐 고정된 일대일 관계나 항상 다른 관계로 읽히지 않게 했고, 두 크기로 다시 렌더해 확인했습니다
4장 모두 고정 라이트 배경을 사용하며 의미 색 외에 라벨·모양·실선/점선·해칭을 함께 사용합니다

## 자체 실행 검증과 통합 검증

실행한 검사:

- Python XML 파싱: 새 SVG 4개 통과
- role=img·title·desc 존재: 새 SVG 4개 통과
- front matter·코드 블록·기존 이미지 참조 보존 비교: 대상 4편 통과
- 본문 diff 확인: 삭제 없음, 이미지 4개와 가정 연결문 1개만 추가
- `git diff --check` 대상 본문 4편: 통과
- sharp 렌더링: 560px·335px 각각 4개 성공

독립 내용·시각 검토는 4편 모두 완료했으며 제목 반송 A-title-1도 해결됐습니다
자체 제작 검증 당시 사이트 전체 문서·링크·MDX 검사, lint, 최종 빌드는 이 제작 담당자가 실행하지 않았습니다
최종 통합 검증의 실행 결과는 [검증 기록](verification.md)을 참조합니다
이 제작 담당자는 커밋·push를 실행하지 않았습니다

## 메인 시각 검토 반송 반영

- 위치: `k8s-theory-resource-accounting-scoring-3.svg`의 표시 제목
- 문제: “함께 실행되는 요청을 더합니다”는 request 자체가 실행되는 것으로 읽힐 수 있음
- 수정: 표시 제목을 “실행 구간별 요청을 더합니다”로, 접근성 title을 “init·sidecar·앱의 실행 구간별 요청 합계”로 변경
- 범위: 제목 두 곳만 변경했으며 본문·도형·배치·다른 담당 변경은 유지
- 재확인: 기존 경로의 desktop 560px·mobile 335px PNG를 다시 생성하고 `view_image`로 두 크기를 모두 확인함. 글자 잘림·겹침 없음

- 독립 재검토: 수정 제목·접근성 title·desktop/335px 렌더·앞뒤 집계 문맥을 다시 확인하여 A-title-1 해결 및 A 4편 통과 판정을 받았습니다
