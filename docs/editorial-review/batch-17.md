# Batch 17 — NetworkPolicy·관리자 네트워크 정책·클라우드 컨트롤러

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-network-policy.md`

범위에 포함되는 대상과 양 끝 포트의 관계를 명확히 했습니다

- 원문: 범위를 지정하는 `endPort`는 시작 `port`와 끝을 모두 포함합니다
- 수정: `port`부터 `endPort`까지의 범위에는 양 끝 포트가 모두 포함됩니다

### `k8s-theory-admin-network-policy.md`

설치 경계라는 압축 표현을 CRD 배포본별 필드 차이로 풀었습니다

- 원문: 코어 API 필드를 feature gate로 켜고 끄는 것과는 설치 경계가 다릅니다
- 수정: 코어 API에서 feature gate로 필드를 켜고 끄는 것과 달리, 여기서는 설치한 CRD 배포본에 따라 사용할 필드가 달라집니다

### `k8s-theory-cloud-controller-boundary.md`

판단과 경우가 어긋난 문장을 Node 변경 조건과 동기화 동작으로 정리했습니다

- 원문: Node 갱신이 즉시 LB 동기화를 요청하는 판단도 제외 조건의 결과가 바뀌거나 `providerID`가 바뀌는 경우입니다
- 수정: Node 갱신 때는 제외 조건의 결과나 `providerID`가 바뀌어야 즉시 LB 동기화를 요청합니다

## 독립 검수와 보완

별도 reviewer가 전문 대조했고 추가 수정 사항은 없었습니다. 방향별 격리·포트 범위·정책 판정과 CCM의 주소 기록·LB 동기화 조건이 원문과 일치함을 확인했습니다

## 보존과 검증

NetworkPolicy의 L3/L4·방향별 판정·노드 예외, Admin/Baseline의 최종 판정과 Pass, CRD 배포본 차이, CCM taint 제거·주소 기록의 분리·외부 자원 정리 조건을 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 변경 헤더로 향하는 저장소 내 fragment 링크 파손은 발견하지 못했습니다
- PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 35편 편집 뒤 메인 채팅에서 실행합니다
- lint·별도 테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링을 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
