# Batch 15 — 임시 컨테이너·Pod sandbox·overlay/native routing

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-ephemeral-containers.md`

어색한 조건 명사문을 kubelet의 동작으로 풀었습니다

- 원문: 시작 목록을 만드는 조건은 같은 이름의 런타임 컨테이너 상태가 없는지입니다
- 수정: kubelet은 같은 이름의 런타임 컨테이너 상태가 없을 때 시작 목록에 넣습니다

### `k8s-theory-pod-sandbox-pause.md`

namespace 생성과 CNI setup에 각각 맞는 동사를 사용했습니다

- 원문: 별도 network namespace와 앞 절의 CNI setup을 수행하지 않습니다
- 수정: 별도 network namespace를 만들거나 앞 절의 CNI setup을 수행하지 않습니다

### `k8s-theory-overlay-native-routing.md`

전달 방식 설명을 nodeipam 설정보다 앞에 두고 자동 편입의 성립 조건을 풀었습니다

- 원문: 자동 편입도 노드 간 도달성과 터널 패킷을 허용하는 방화벽이라는 조건 위에서 동작합니다
- 수정: 새 노드가 자동으로 편입되려면 노드끼리 통신할 수 있고 방화벽도 터널 패킷을 허용해야 합니다

## 독립 검수와 보완

별도 reviewer 전문 대조에서 의미 보존 오류는 없었습니다. 임시 컨테이너의 '컨테이너를 … 의존하는 용도로 사용'이라는 연결을 '상시 작업의 실행을 임시 컨테이너에 의존하지 않도록'으로 고쳤습니다. 상태 기록·재시작 제약의 인접 문맥을 다시 확인했습니다

## 보존과 검증

임시 컨테이너 API·실행·상태 기록 제약, pause의 PID 공유와 sandbox 재생성, hostNetwork 적용 범위, IPAM·전달 경로·MTU 예외를 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 변경 헤더로 향하는 저장소 내 fragment 링크 파손은 발견하지 못했습니다
- PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 35편 편집 뒤 메인 채팅에서 실행합니다
- lint·별도 테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링을 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
