# 노드 하트비트와 taint 축출 — 관찰 실패와 실제 종료는 다릅니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-node-heartbeat-taint-eviction.md](../../../src/content/essays/kubernetes/k8s-theory-node-heartbeat-taint-eviction.md)
- 시리즈: `k8s-theory-node` / 10
- 원문 SHA256: `21c8dce7da0422136fc0981d746551fd2e9ae9812df62f66c6356299aa3a9461`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 한 노드의 기본 장애 경로를 먼저 이어서 설명

## 독자와 중심 질문

하트비트 관찰 실패가 Node 상태·taint·Pod 삭제로 이어져도 실제 노드 종료를 증명하지 못하는 이유를 이해합니다

선행 개념: Node Ready, taint/toleration, Pod 삭제와 프로세스 종료

## 현재 전개

- L23: 하트비트 부재부터 Pod 정리까지 주체가 바뀝니다
- L38: kubelet은 작은 Lease와 큰 Node status를 따로 갱신합니다
- L76: 판정 시간은 컨트롤러의 마지막 관찰 시각으로 계산합니다
- L134: Ready=False와 Unknown은 다른 taint로 이어집니다
- L155: 속도 제한은 Pod 수가 아니라 NoExecute를 붙이는 노드 수에 적용합니다
- L185: 기본 300초는 admission이 Pod에 기록합니다
- L231: Pod 삭제 요청 뒤에도 정리할 조건이 남습니다
- L277: 예고된 노드 종료는 kubelet이 먼저 알립니다
- L311: 원인 조사에서는 조건·요청·정리 상태를 함께 봅니다
- L328: 확인한 소스와 문서

## 원문 근거와 개선점

### L63 하트비트 역할 뒤 설정 기본값 예외가 경로를 끊습니다

> ### update만 명시해도 report 기본값이 달라집니다

작은 Lease와 큰 status를 나눈 이유는 좋지만 곧 필드 조합과 클라이언트 QPS로 들어가 마지막 관찰 시각의 판단이 늦습니다

수정 방향: Lease/status 갱신→관찰 시각→유예·실제 Lease 재확인→Unknown을 먼저 묶습니다. 필드 기본값·보고 최적화는 뒤에 둡니다

### L155 한 Pod의 삭제 시간을 보기 전에 zone 전체 정책으로 확장합니다

> ## 속도 제한은 Pod 수가 아니라 NoExecute를 붙이는 노드 수에 적용합니다

Ready→taint 다음에 zone 비율·속도·전면 장애를 거쳐야 toleration과 삭제를 만납니다

수정 방향: 기본 한 노드 사례에서 toleration→일반 DELETE→종료 대기를 먼저 끝내고 여러 노드/zone일 때 지연되는 조건을 확장합니다

## 권장 설명 순서

1. 관찰 실패와 실제 전원 종료의 차이를 유지합니다
2. Lease/status 갱신과 controller 관찰을 연결합니다
3. 유예 초과 시 실제 Lease 재확인 및 Node 조건·taint 변경을 설명합니다
4. Pod별 toleration 뒤 일반 DELETE, kubelet 마무리와 Terminating을 따라갑니다
5. 여러 노드의 zone별 속도 제한·전면 관찰 실패를 보충합니다
6. podGC·out-of-service·예고된 shutdown을 서로 다른 추가 증거와 경로로 비교합니다
7. 각 시간은 삭제 완료 보장이 아님을 상태별 확인표로 정리합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

컨트롤러가 노드를 관찰하지 못했다는 판단 뒤에도 바로 모든 Pod를 지우지는 않습니다
NoExecute taint를 붙이고 각 Pod의 toleration을 확인하는 다음 주체가 따로 있습니다

## 유지할 내용과 조건

- 기본 50초와 Lease 40초·Pod 300초의 다른 의미
- 현재 Lease circuit breaker와 전체 판정 중단 조건
- zone 단위 속도, PDB 경로 아님, out-of-service는 실제 종료 확인 필요

## 편집 후 독자 확인

- 50+300초를 실제 컨테이너 종료 시각으로 계산하지 않는가?
- Node Unknown과 Node 객체 부재에 따른 podGC를 구분하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
