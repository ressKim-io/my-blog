# Batch 19 — CSI 구조·StatefulSet 볼륨·볼륨 확장/스냅샷/임시 볼륨

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-csi-architecture.md`

의도라는 추상어를 연결 요청으로 풀어 VolumeAttachment가 전달하는 대상을 밝혔습니다

- 원문: attach가 필요한 경우에는 그 사이의 의도와 결과를 VolumeAttachment로 전달합니다
- 수정: attach가 필요한 경우에는 연결 요청과 처리 결과를 VolumeAttachment로 전달합니다

### `k8s-theory-statefulset-volume-lifecycle.md`

사용자가 사람이 아니라 PVC를 쓰는 Pod임을 명시하고 web-0 예시를 생성 조건에 붙였습니다

- 원문: 사용자를 찾지 못하면 API 조회도 확인합니다
- 수정: 사용하는 Pod를 찾지 못하면 API 조회도 확인합니다

### `k8s-theory-volume-expansion-snapshots-ephemeral.md`

처리 중 차이가 나는 두 용량을 요청값과 상태 기록으로 구체화했습니다

- 원문: 명세와 용량 상태 사이에 진행 중인 차이가 남을 수 있습니다
- 수정: 처리하는 동안 요청한 용량과 상태에 기록된 용량이 다를 수 있습니다

## 독립 검수와 보완

별도 reviewer 전문 대조에서 필수 의미 보존 오류는 없었습니다. 원문 excerpt의 '두 등록 소켓'이 둘 다 등록용이라는 인상을 줄 수 있어 '등록용·CSI 호출용 소켓'으로 고쳤습니다. 본문의 등록과 호출 역할 구분에 다시 맞춰 확인했습니다

## 보존과 검증

CSI 호출 주체·등록/호출 소켓·capability, PVC 소유 참조·삭제 순서·OrderedReady 조건, 확장 요청/상태 용량과 임시 볼륨별 정리 조건을 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 변경 헤더로 향하는 저장소 내 fragment 링크 파손은 발견하지 못했습니다
- PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 35편 편집 뒤 메인 채팅에서 실행합니다
- lint·별도 테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링을 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
