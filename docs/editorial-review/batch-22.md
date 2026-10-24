# Batch 22 — 집계 API 서버·netfilter/conntrack·mount/bind mount

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-aggregated-api-server.md`

설명 방식에 대한 경고를 실제 동작 구분으로 바꾸고 SAR·401 설명을 위임 인가 절로 옮겼습니다

- 원문: 여기서 추가 subresource를 “새로운 verb”로 설명하면 범위가 넓어집니다
- 수정: 추가 subresource를 만든다고 새로운 요청 verb까지 생기는 것은 아닙니다

### `k8s-theory-netfilter-conntrack.md`

재사용하는 상태와 변환을 적용하는 패킷을 명확히 했습니다

- 원문: 정확한 응답 역변환을 위한 상태가 후속 패킷의 선택 결과를 재사용하는 데도 쓰이는 구조입니다
- 수정: 응답을 역변환할 때 쓰는 NAT 상태는 이후 패킷에 같은 변환을 적용하는 데도 쓰입니다

### `k8s-theory-mount-bind-mount.md`

추상적인 연결 표현을 호스트에서 mount를 볼 수 있는 조건으로 풀었습니다

- 원문: 드라이버 컨테이너 안에서 만든 mount를 호스트가 보려면 무엇이 필요한지도 mount namespace와 전파 관계로 이어집니다
- 수정: 드라이버 컨테이너 안에서 만든 mount를 호스트가 볼 수 있는지는 mount namespace와 전파 관계에 달려 있습니다

## 독립 검수와 보완

별도 reviewer 전문 대조에서 추가 수정 사항은 없었습니다. SAR·401 설명 이동이 자연스럽고 NAT 가정·상태 재사용과 mount 관찰·전파 조건도 유지됐음을 확인했습니다

## 보존과 검증

집계 API의 신뢰·부분 실패·위임 인가, NAT 바인딩·conntrack 수치와 회수 조건, mount 전파·재귀 읽기 전용·열린 fd 참조·해제 조건을 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 변경 헤더로 향하는 저장소 내 fragment 링크 파손은 발견하지 못했습니다
- PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 35편 편집 뒤 메인 채팅에서 실행합니다
- lint·별도 테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링을 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
