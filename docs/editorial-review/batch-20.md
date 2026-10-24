# Batch 20 — 볼륨 연결 제한·스토리지 용량 스케줄링·CRD 스키마/pruning

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-volume-attachment-limits.md`

고리라는 비유가 가리키는 작업을 갱신으로 명시했습니다

- 원문: 주기가 바뀌면 기존 고리를 멈추고 새 주기로 시작하며
- 수정: 주기가 바뀌면 기존 갱신 작업을 멈추고 새 주기로 시작하며

### `k8s-theory-storage-capacity-scheduling.md`

좌표라는 비유를 오브젝트의 실제 변경 대상인 필드로 바꿨습니다

- 원문: 조회 조건이 달라지면 같은 오브젝트의 좌표를 고치는 대신 새 오브젝트로 표현해야 합니다
- 수정: 조회 조건이 달라지면 기존 오브젝트의 필드를 고치는 대신 새 오브젝트로 표현해야 합니다

### `k8s-theory-crd-schema-pruning.md`

topology가 이 문맥에서 뜻하는 관리 단위를 풀었습니다

- 원문: 필드 타입이 같다는 이유만으로 topology 변경을 안전한 설명 수정으로 취급하면 안 됩니다
- 수정: 필드 타입이 같아도 리스트·맵의 관리 단위(topology)를 바꾸는 것은 단순한 설명 수정이 아닙니다

## 독립 검수와 보완

별도 reviewer 전문 대조에서 추가 수정 사항은 없었습니다. 변경한 헤더와 MAP 풀네임이 본문 설명에 맞고 상한·예약·CRD 처리 조건도 유지됐음을 확인했습니다

## 보존과 검증

볼륨 상한 nil·0·계산 예외·갱신 조건, 용량 Filter·Score와 공간 예약의 구분, CRD pruning·보존·defaulting·CEL·subresource 조건을 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 변경 헤더로 향하는 저장소 내 fragment 링크 파손은 발견하지 못했습니다
- PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 35편 편집 뒤 메인 채팅에서 실행합니다
- lint·별도 테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링을 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
