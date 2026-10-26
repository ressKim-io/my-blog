# 추가 다이어그램 독립 검토

상태: 승인된 8편·새 SVG 8장 모두 제작 완료 및 독립 내용·시각 검토 완료
남은 수정 요청은 없습니다

## 글별 상태

| 글 | 제작 | 독립 검토 | 남은 문제 |
|---|---|---|---|
| resource-accounting-scoring | 완료 | 완료 | 없음 |
| hpa-scale-subresource | 완료 | 완료 | 없음 |
| page-cache-reclaim-oom | 완료 | 완료 | 없음 |
| device-resource-allocation | 완료 | 완료 | 없음 |
| netfilter-conntrack | 완료 | 완료 | 없음 |
| overlay-native-routing | 완료 | 완료 | 없음 |
| crd-schema-pruning | 완료 | 완료 | 없음 |
| volume-expansion-snapshots-ephemeral | 완료 | 완료 | 없음 |

## 검토 순서와 판정 범위

각 묶음의 수정 본문 전문과 새 그림의 560px desktop·335px mobile PNG를 먼저 읽었습니다
그다음 원문 기준본·기존 SVG·승인 목업과 대조하여 기술 조건·수치·코드·출처의 보존과 문맥 연결을 확인했습니다
검토 대상은 새 그림 8장과 해당 삽입 문맥이며, 나머지 63편을 새로 전수 검토한 기록은 아닙니다

PNG 16개를 `view_image`로 실제 열어 주요 글자·겹침·잘림·화살표 방향·범례·범위 표시를 확인했습니다
SVG의 title·desc도 본문과 대조했습니다
기존 SVG 16개는 원문 관계와 표시 라벨을 대조하고 기준 해시가 유지되는지 검사했습니다

## 글별 내용·시각 판정

- **resource-accounting-scoring**: 실행 구간·단계 합계·자원별 max가 일치하며 Pod-level 대체와 overhead가 바로 뒤에 보존됨. 메인 반송 제목 수정 후 두 크기 렌더와 앞뒤 본문 재검토 완료
- **hpa-scale-subresource**: 같은 시간 좌표와 같은 창 폭, 창 밖 7과 창 안 3, 추가 추천 가정·실제 replica와 구분을 확인. 앞 추천 예시에서 자연스럽게 이어지고 뒤 scale up·기본값 설명을 유지
- **page-cache-reclaim-oom**: usage의 일부를 계산에서 제외해도 두 표시의 해칭이 유지됨. 0 하한·cAdvisor/cgroup 범위·비축척 가정과 인접 회수 비용 문단을 확인
- **device-resource-allocation**: Kubernetes Node 하나 안의 두 NUMA, CPU 집합→같은 위치 메모리 및 다른 위치 GPU의 방향, 소켓·칩과 1:1 고정이 아님을 확인. 다음 위치 비용·Topology Manager 설명과 연결됨
- **netfilter-conntrack**: 원문 세 주소·port가 유지되고 요청 DST/응답 SRC만 변환됨. O/R 배지가 하나의 연결 기록을 조회하며 패킷이 기록 안으로 이동하는 화살표가 없음. 앞 튜플 설명과 뒤 바인딩 재사용 절이 중복 도입 없이 이어짐
- **overlay-native-routing**: outer Ethernet은 1500 괄호 밖, inner Ethernet 14는 50/70 안에 있음. 1450/1430은 내부 IP 예산이고 앱 payload·Pod eth0 확정값과 구분됨. 표·헤더 설명 뒤에서 단면을 보고 다음 경로 MTU 절로 이어짐
- **crd-schema-pruning**: 스키마와 요청 데이터 트리를 분리하고 루트 someRandomField·typed.extra 제거, json.loose 보존을 확인. 가정 문장·Ignore/Warn·Strict 400·저장 바이트 한계를 유지하며 기존 YAML 자체를 바꾸지 않음
- **volume-expansion-snapshots-ephemeral**: API 사각형과 저장 실체 원통, source/dataSource 참조, 원본 소스 연결, CreateSnapshot/CreateVolume 주체를 구분함. 원본과 다른 새 볼륨을 만들고 readyToUse·driver·handle·일관성 한계를 표시. 앞 복원 조건과 뒤 dataSourceRef 설명이 자연스럽게 이어짐

현재 렌더에서 겹침·잘림·읽기 어려운 주요 라벨·잘못된 화살표 방향은 발견하지 않았습니다
8장은 실행 구간·이동 창·회계·하드웨어 위치·주소 변환·패킷 단면·JSON 트리·API/저장 실체라는 서로 다른 질문을 풀며 기존 처리 흐름도와 역할이 겹치지 않습니다
컨테이너 requests와 working set, 선언·관측·실제 준비 상태를 서로 같은 값으로 연결하지 않습니다

## 수정 반송과 독립 확인

반송은 메인 검토에서 발생했으며 제작 담당자가 수정했습니다
독립 검토자는 수정된 부분과 앞뒤 문맥을 확인했습니다

| ID | 위치·독자가 막히는 이유 | 수정 방향과 확인 결과 |
|---|---|---|
| A-title-1 | 자원 계산 SVG 제목의 “함께 실행되는 요청”이 실행되는 컨테이너와 합산하는 요청을 혼동시킴 | “실행 구간별 요청을 더합니다”와 접근성 title로 수정. 수정 전후 두 크기 렌더와 앞뒤 집계 설명을 재확인하여 해결 |
| B-source-1 | Snapshot의 원본 볼륨과 CreateSnapshot 관계가 약해 API source 참조를 따라가야 입력 소스가 드러남 | 원본 볼륨 연결선에 “소스” 라벨 추가. RPC 호출 주체와 구분되는 선·새 볼륨 관계를 두 크기 렌더와 본문에서 확인하여 해결 |
| B-prose-1 | Conntrack·MTU·Snapshot 새 도입 3개가 인접 설명과 alt를 반복함 | 3개 삭제, 가정 범위를 밝히는 CRD 문장은 유지. 수정 전문과 원문 diff로 삭제 후 흐름·원문 보존을 확인하여 해결 |
| B-voice-1 | B SVG 4개 desc의 반말형 서술이 공통 말투 기준과 다름 | 격식체로 수정한 desc 전문과 기술 조건·수치를 확인하여 해결 |

독립 검토에서 추가 반송이 필요한 문제는 발견하지 않았습니다

## 실행 검증과 한계

독립 검토자가 실행한 검사:

- SVG XML 파싱·title/desc/role 및 접근성 참조 확인: 8/8 통과
- 기준 원문과 front matter·코드 블록 비교: 8/8 일치
- 기존 SVG 해시 비교: 16/16 일치
- 원문 diff: 삭제 없음, 이미지 참조 8개와 새 가정을 밝히는 문장 2개만 추가
- 대상 본문 `git diff --check`: 통과
- 제작자가 sharp로 생성한 560px·335px PNG: 16개를 `view_image`로 확인

전체 문서·링크·MDX·lint·최종 빌드는 메인의 통합 검증으로 별도 기록합니다
이 독립 검토 기록만으로 사이트 실행 검증까지 통과했다고 판정하지 않습니다
원문의 고정 버전 기술 주장을 외부 소스로 전수 재검증하거나 Kubernetes·커널·CSI 실험을 수행한 작업은 아닙니다

본문·SVG·확인 PNG의 SHA-256과 파일별 판정은 `independent-review.json`에 기록했습니다
