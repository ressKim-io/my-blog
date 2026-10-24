# Batch 18 — 트래픽 지역성/dual stack·Service CIDR/IPAddress·PVC 바인딩

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-traffic-locality-dual-stack.md`

이름에 달린 주소라는 표현을 실제 비교 대상인 백엔드 주소로 명확히 했습니다

- 원문: Service 이름에 달린 전체 주소 수만 보고 이 노드가 사용할 후보를 알 수는 없습니다
- 수정: Service의 전체 백엔드 주소 수만으로 이 노드가 사용할 후보를 알 수는 없습니다

### `k8s-theory-service-cidr-ip-address.md`

주소 재할당처럼 읽힐 수 있던 예약의 대상이 재검사임을 밝혔습니다

- 원문: 또 IPAddress가 기존 Service보다 나중에 생겼고 생성 뒤 5초 미만이면 별도로 재예약합니다
- 수정: 또 IPAddress가 기존 Service보다 나중에 생겼고 생성 뒤 5초 미만이면, 다시 검사하도록 예약합니다

### `k8s-theory-pvc-storageclass-binding.md`

그 PVC가 가리키는 대상을 현재 요청으로 한정했습니다

- 원문: 다른 PVC를 가리키는 `claimRef`가 있으면 그 PVC의 후보로 가져오지 않습니다
- 수정: 다른 PVC를 가리키는 `claimRef`가 있으면 현재 요청한 PVC의 후보로 선택하지 않습니다

## 독립 검수와 보완

별도 reviewer 전문 대조에서 추가 수정 사항은 없었습니다. trafficDistribution 헤더가 본문의 힌트·모드 조건과 맞고 IPAddress 확보·repair 조건, PVC 가정과 관측 조건도 보존됐음을 확인했습니다

## 보존과 검증

지역성 후보 제한·선호·힌트 조건, dual stack 구분, bitmap/IPAddress 확보 순서·5초 재검사 유예, PVC 캐시 임시 반영·API 쓰기·바인딩 관측 조건을 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 변경 헤더로 향하는 저장소 내 fragment 링크 파손은 발견하지 못했습니다
- PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 35편 편집 뒤 메인 채팅에서 실행합니다
- lint·별도 테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링을 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
