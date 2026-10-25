# attach·stage·publish — 볼륨 연결부터 Pod가 사용할 경로까지 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-volume-attach-stage-publish.md](../../../src/content/essays/kubernetes/k8s-theory-volume-attach-stage-publish.md)
- 시리즈: `k8s-theory-storage` / 3
- 원문 SHA256: `4c51359e2fd1b9fadee8da093299ba44e29bfa5bda9981859b9b297774851b33`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기본 흐름 유지·정상 수명과 복구 배치 조정

## 독자와 중심 질문

같은 노드의 두 Pod가 볼륨을 쓸 때 공유되는 준비와 Pod별 준비는 무엇이고, 한 Pod 또는 노드 전체의 사용이 끝나면 어떤 순서로 정리할까요?

선행 개념: CSI Controller·Node 호출자와 VolumeAttachment를 전제합니다. 파일시스템 persistent volume이라는 기본 사례 범위를 먼저 표시합니다

## 현재 전개

- L21: 노드에서 준비한 볼륨을 Pod별 경로에 제공합니다
- L74: attach와 stage는 서로 다른 조건에서 생략합니다
- L100: kubelet은 목표 상태와 준비 상태를 계속 대조합니다
- L117: 정상 해제는 Pod target부터 되돌립니다
- L136: 코어의 Multi-Attach 검사를 통과해도 드라이버가 거절할 수 있습니다
- L157: ContainerCreating만으로 어느 준비가 남았는지 알 수 없습니다
- L197: force-detach의 6분은 장애 발생부터 재는 시간이 아닙니다
- L240: 참고 자료

## 원문 근거와 개선점

### L100 명확한 준비 흐름을 정상 해제까지 먼저 연결합니다

> ## kubelet은 목표 상태와 준비 상태를 계속 대조합니다

attach·stage·publish를 준비 대상의 단위로 구분한 전개가 좋습니다. 다만 단계 생략·Block 예외·내부 상태 캐시를 지나서 정상 해제를 읽어야 공유 경로의 수명을 완결할 수 있습니다

수정 방향: 세 준비 단계 직후 두 Pod 중 하나가 끝나는 경우와 마지막 사용이 끝나는 경우의 정상 해제를 배치합니다. DSW·ASW는 이 준비·해제를 반복 조정하는 기전으로 그 뒤에 설명합니다

### L197 강제 복구를 정상 해제와 대비한 뒤 관측표로 연결합니다

> ## force-detach의 6분은 장애 발생부터 재는 시간이 아닙니다

현재는 오류 접두어와 자원 상한 설명 뒤에 force-detach가 나옵니다. 복구 설명을 읽고 다시 앞의 정상 해제와 진단 기준을 찾아 비교해야 합니다

수정 방향: 정상 해제와 reconcile 기전을 설명한 후 Multi-Attach·응답 없는 노드·force-detach의 조건을 묶습니다. 마지막에 전체 단계별 상태·오류 단서를 정리해 진단 절이 글 전체를 포괄하게 합니다

## 권장 설명 순서

1. 같은 볼륨을 같은 노드의 두 Pod가 쓰는 사례와 각 단계의 준비 대상을 제시합니다
2. attach의 볼륨·노드 연결, stage의 노드 공용 경로, publish의 Pod별 target과 runtime 노출을 따라갑니다
3. 한 Pod 종료와 마지막 Pod 종료를 비교해 unpublish·unstage·detach의 정상 해제 순서를 설명합니다
4. kubelet의 목표·준비 상태와 반복 호출·멱등성으로 생성·해제가 계속 조정되는 이유를 설명합니다
5. attach·stage 생략, Block·ephemeral, Multi-Attach의 사전 검사와 드라이버 판단을 기본 경로의 조건으로 묶습니다
6. 응답 없는 노드의 force-detach 조건과 위험을 정상 해제와 대비한 뒤 ContainerCreating·오류 접두어·상한의 확인 순서로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

Pod A의 사용이 끝나도 Pod B가 같은 노드의 준비 경로를 계속 쓸 수 있습니다
따라서 Pod별 target을 해제하는 일과 노드 공용 준비를 해제하는 일은 같은 시점에 수행하지 않습니다

## 유지할 내용과 조건

- 현재의 두 Pod 사례와 attach·stage·publish 단위 구분을 유지합니다
- publish가 모든 드라이버에서 bind mount라는 일반화를 하지 않습니다
- 6분은 detach 요청 경과 조건이며 전체 장애 복구 완료 시간이 아니라는 설명을 보존합니다
- 강제 분리나 out-of-service taint가 실제 전원 차단·남은 쓰기 중단의 증거는 아니라는 조건을 유지합니다

## 편집 후 독자 확인

- 두 Pod 중 하나가 끝나도 남겨야 할 경로를 설명할 수 있나요?
- 정상 해제와 force-detach에서 확인할 수 있는 완료 상태의 차이를 알 수 있나요?
- ContainerCreating만으로 특정 CSI 단계 실패를 확정하지 않나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
