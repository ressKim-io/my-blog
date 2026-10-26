# 추가 SVG 제작 B 기록

상태: 담당 4편의 SVG 제작·본문 삽입·자체 시각 확인·독립 검토 완료
기준: 승인된 plan.md, design-notes-b.md, review-checklist.md
담당 파일 외의 기존 글·SVG·공유 기록은 수정하지 않았습니다
최종 독립 판정은 [독립 검토 기록](independent-review.md), 최종 통합 실행 검증은 [통합 검증 기록](verification.md)을 참조합니다

## 글별 제작과 삽입

| 글 | 새 자산 | 삽입 위치 | 제작 | 독립 검토 |
|---|---|---|---|---|
| `k8s-theory-netfilter-conntrack` | `public/diagrams/k8s-theory-netfilter-conntrack-3.svg` | 「Conntrack은 같은 연결을 양방향 키로 찾습니다」의 마지막 문단 뒤, 97행 | 완료 | 완료 |
| `k8s-theory-overlay-native-routing` | `public/diagrams/k8s-theory-overlay-native-routing-2.svg` | MTU 비교표와 내부 IP·TCP 헤더 설명 뒤, 114행 | 완료 | 완료 |
| `k8s-theory-crd-schema-pruning` | `public/diagrams/k8s-theory-crd-schema-pruning-3.svg` | 하위 구조 선언·CEL 접근 제한 설명 뒤, 92행 | 완료 | 완료 |
| `k8s-theory-volume-expansion-snapshots-ephemeral` | `public/diagrams/k8s-theory-volume-expansion-snapshots-ephemeral-3.svg` | 복원 dataSource와 getSnapshotSource 조건 설명 뒤, 190행 | 완료 | 완료 |

본문 위치는 모두 `src/content/essays/kubernetes/{글}.md`입니다
각 글에는 alt가 있는 이미지 참조 하나를 추가했습니다. CRD 글에만 새 가정의 범위를 밝히는 문장 하나를 추가했습니다

## 자체 내용 검토

### Conntrack

- 원문의 클라이언트·Service·백엔드 IP와 port를 그대로 사용했습니다
- Original과 Reply 키의 O·R 배지를 변환 전 요청·응답에도 붙여 같은 기록의 조회 관계를 표시했습니다
- 요청의 DST와 응답의 SRC만 강조하고, 추가 SNAT이 없는 같은 프로토콜의 가정임을 그림에 남겼습니다
- 패킷이 conntrack 기록 안으로 이동하거나 kube-proxy가 직접 중계하는 선은 사용하지 않았습니다
- hook·체인 선택을 보여주는 기존 그림과 별도로 주소 전후 변화에 집중했습니다

### MTU

- 바깥 Ethernet을 1500 B 괄호 밖, 안쪽 Ethernet 14 B를 50/70 B 괄호 안에 두었습니다
- 바깥 IPv4/IPv6와 20/40 B, UDP 8 B, VXLAN 8 B, 내부 IP 1450/1430 B의 합을 표시했습니다
- 추가 암호화·IP 옵션 없음, 비례가 아닌 헤더 확대, 내부 IP와 앱 데이터 구분, Pod eth0의 확정 MTU가 아니라는 조건을 그림 안에 남겼습니다
- 새로운 측정값이나 처리량 비교는 추가하지 않았습니다

### CRD

- 상단 스키마 선언과 하단 요청/결과 데이터 트리를 나눴습니다. 보존 flag를 요청 JSON 필드처럼 표시하지 않았습니다
- 원문의 json과 someRandomField: 42를 재사용했습니다. typed/loose/extra는 보존 범위를 설명하는 가정임을 본문·그림·desc에 명시했습니다
- 보존 노드 안에서 선언한 property 아래 pruning이 다시 적용되는 관계는 [공식 CRD Field pruning 문서](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/#field-pruning)의 json/spec 예시와 대조했습니다
- 루트 미선언 필드와 typed.extra는 제거하고 json.loose는 보존하는 결과입니다
- Ignore/Warn의 가지치기 단계 예시와 Strict HTTP 400 거절을 구별했습니다. 최종 etcd 저장 바이트로 단정하지 않았습니다

### Snapshot

- API 오브젝트를 사각형, 스토리지 실물을 원통으로 나눴습니다
- 원본 PVC와 새 PVC를 별도 배치하고 source·dataSource 참조선에 S·D 배지와 범례를 붙였습니다
- snapshot-controller의 Content 생성·바인딩, csi-snapshotter의 CreateSnapshot, external-provisioner의 CreateVolume을 구별했습니다
- readyToUse·driver·바인딩·handle 조건과 앱 일관성·즉시 완료를 보장하지 않는 범위를 그림에 남겼습니다
- 스토리지 복사 방식, 삭제 정책, 성능 수치는 추가하지 않았습니다

## 실행·시각 확인

실행한 확인:

- 기존 `sharp` 0.34.5로 SVG 4장을 각각 560px desktop과 335px mobile PNG로 렌더했습니다. 새 의존성은 추가하지 않았습니다
- `view_image`로 desktop 4장과 mobile 4장을 실제 확인했습니다
- Snapshot의 바인딩 연결선이 라벨을 통과하던 부분을 끊고 controller 설명을 API 열 아래로 옮긴 뒤 재렌더했습니다
- XML 파싱 4/4, role/title/desc 존재·중복 ID 없음 4/4, 본문 자산 참조 확인 4/4가 통과했습니다
- 각 글에서 이번에 추가한 이미지 참조와 CRD 가정 문장을 제거한 결과가 `git show HEAD:<path>`와 같은지 비교했습니다. 4/4 일치하여 기존 본문·front matter·코드·기존 이미지·출처가 보존됐습니다
- 담당 본문 4편의 `git diff --check`가 통과했습니다

렌더 파일:

| 그림 | Desktop | Mobile |
|---|---|---|
| Conntrack | `/tmp/k8s-diagram-renders/k8s-theory-netfilter-conntrack-3-desktop.png` | `/tmp/k8s-diagram-renders/k8s-theory-netfilter-conntrack-3-mobile.png` |
| MTU | `/tmp/k8s-diagram-renders/k8s-theory-overlay-native-routing-2-desktop.png` | `/tmp/k8s-diagram-renders/k8s-theory-overlay-native-routing-2-mobile.png` |
| CRD | `/tmp/k8s-diagram-renders/k8s-theory-crd-schema-pruning-3-desktop.png` | `/tmp/k8s-diagram-renders/k8s-theory-crd-schema-pruning-3-mobile.png` |
| Snapshot | `/tmp/k8s-diagram-renders/k8s-theory-volume-expansion-snapshots-ephemeral-3-desktop.png` | `/tmp/k8s-diagram-renders/k8s-theory-volume-expansion-snapshots-ephemeral-3-mobile.png` |

제작자 자체검증 단계에서는 전체 MDX·링크 검사, lint, 정적 빌드를 실행하지 않았습니다. 메인의 최종 통합 실행 결과는 [통합 검증 기록](verification.md)을 참조합니다
클러스터 실행·패킷 캡처·etcd 저장 바이트·CSI 복원 실험은 수행하지 않았습니다

## 반송과 수정

### 1차 — 메인 시각 검토

- 위치: Snapshot 그림의 원본 볼륨과 CreateSnapshot 요청 구간
- 문제: 짧은 연결선만으로는 원본 볼륨이 입력 소스라는 관계가 약하고, API의 source 참조를 따라가야 의미가 분명해질 수 있었습니다
- 수정: 원본 볼륨과 생성 요청 사이 연결선에 `소스` 라벨을 추가했습니다. RPC 호출 주체의 `csi-snapshotter → driver` 표기는 그대로 유지했습니다
- 확인: 560px·335px PNG를 다시 만들고 두 크기 모두 `view_image`로 확인했습니다. 소스 라벨과 선, 호출 주체가 겹치지 않습니다
- 판정: 제작자 재확인 및 독립 검토자의 최종 확인 완료, 해결

### 2차 — 메인 편집 검토

- 위치: Conntrack·MTU·Snapshot의 새 연결 문장 3개와 SVG 4개의 desc
- 문제: 새 연결 문장이 인접 본문이나 alt와 중복되고, desc의 반말체 서술이 공통 말투 기준과 달랐습니다
- 수정: 해당 본문 연결 문장 3개를 삭제하고 이미지 삽입만 남겼습니다. CRD의 새 가정 설명은 유지했습니다. desc 4개를 격식체로 바꾸고 모든 기술 조건을 보존했습니다
- 확인: 본문에서 삽입분만 제거하면 원문과 같은지 다시 비교했습니다. XML도 다시 파싱했습니다. desc 변경은 시각 요소를 바꾸지 않았습니다

## 최종 상태와 통합 검증

- 독립 검토자가 B 4편의 수정 본문·렌더·원문 대조와 반송 해결을 확인했습니다. 담당 제작·내용 검토에서 남은 문제는 없습니다
- 본문 연결 문장 삭제와 desc 격식체 수정도 독립 검토를 통과했습니다. 글별 판정은 [독립 검토 기록](independent-review.md)에 있습니다
- 8장 표현의 일관성과 문서·링크·MDX·lint·빌드의 최종 실행 결과는 메인의 [통합 검증 기록](verification.md)에 구분해 기록합니다
- 이 담당자는 커밋·push를 수행하지 않았습니다
