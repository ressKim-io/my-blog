# CSI 구조 — sidecar의 Controller 호출과 kubelet의 Node 호출 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-csi-architecture.md](../../../src/content/essays/kubernetes/k8s-theory-csi-architecture.md)
- 시리즈: `k8s-theory-storage` / 2
- 원문 SHA256: `7f983ff67e7b3f01dd23220370918f8e0bb99137db2bb62e354523e30398f729`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

PVC를 본 controller sidecar와 노드의 kubelet은 각각 어떤 CSI 요청을 보내며, 등록·attach·사용 준비의 결과는 어디에 남을까요?

선행 개념: PVC 공급과 바인딩의 역할을 전제합니다. RPC는 다른 프로세스에 정해진 형식으로 작업을 요청하는 호출로 설명합니다

## 현재 전개

- L27: 두 호출 경로는 서로 다른 일을 시작합니다
- L55: 규격의 선언과 코어의 호출 범위를 나눕니다
- L79: sidecar는 오브젝트와 CSI 호출을 연결합니다
- L117: 등록용 소켓과 CSI 호출용 소켓은 역할이 다릅니다
- L152: Kubernetes 오브젝트는 서로 다른 경계를 기록합니다
- L202: capability와 inline·migration 조건이 호출을 바꿉니다
- L228: 실패 위치는 오브젝트와 호출 주체를 함께 봅니다
- L246: 확인한 근거

## 원문 근거와 개선점

### L55 호출자 지도를 이해하기 전에 전체 RPC 수를 셉니다

> ## 규격의 선언과 코어의 호출 범위를 나눕니다

두 호출 경로의 첫 그림은 유용합니다. 이어 외부화의 역사와 서비스별 RPC 개수를 읽고 나서야 sidecar가 어떤 오브젝트를 어떤 요청으로 잇는지 나옵니다

수정 방향: 첫 그림 뒤에 provisioner·attacher·kubelet의 대표 오브젝트와 호출을 바로 대응시킵니다. 전체 RPC 선언 수와 실험 서비스는 규격이 곧 실제 사용 범위는 아니라는 후반 보충 절에 둡니다

### L152 오브젝트를 실제로 쓰는 순간에 함께 정의합니다

> ## Kubernetes 오브젝트는 서로 다른 경계를 기록합니다

등록 흐름에서 CSINode·NodeGetInfo를 읽고 나서 오브젝트 설명을 다시 접합니다. VolumeAttachment도 앞 그림과 sidecar 표에서 여러 번 나오지만 의도·결과를 잇는 이유는 뒤에서 풀립니다

수정 방향: 등록 흐름에는 CSINode의 노드 식별자 대응을, attach 흐름에는 VolumeAttachment의 spec·status를 인접시킵니다. CSIDriver는 호출 전에 읽는 설정으로 소개한 뒤 capability와의 차이를 연결합니다

## 권장 설명 순서

1. 클러스터 측 볼륨 생성과 노드 측 사용 준비라는 두 호출 경로를 제시합니다
2. PVC·StorageClass를 본 provisioner가 Controller RPC를 호출하고 PV를 기록하는 대표 흐름을 설명합니다
3. VolumeAttachment를 통한 attach 의도·외부 호출·결과 전달과 attacher의 역할을 연결합니다
4. 노드 등록 소켓과 CSI 소켓, NodeGetInfo, CSINode·Node 반영을 따라 kubelet이 드라이버를 찾는 과정을 설명합니다
5. CSIDriver 설정과 capability에 따라 Node 호출과 생략 단계가 달라지는 조건을 정리합니다
6. sidecar 배치·권한, 전체 규격 범위, 과거 외부화·migration·ephemeral 차이를 보충합니다
7. 등록 성공·attach 완료·Pod 사용 가능을 구분하는 상태 확인 순서로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

클러스터의 attacher는 다른 노드의 드라이버 소켓을 직접 찾아가는 대신 VolumeAttachment에 기록된 의도와 결과를 사용합니다
노드에서 실제 사용 경로를 준비하는 kubelet은 별도로 등록된 로컬 CSI endpoint를 호출합니다

## 유지할 내용과 조건

- sidecar가 kubelet을 차례로 호출하는 직렬 파이프라인이 아니라는 현재 그림의 설명을 보존합니다
- in-tree CSI 어댑터와 out-of-tree 드라이버, 등록 프로토콜과 CSI Identity RPC를 구분합니다
- nodeID·volumeHandle·Kubernetes 오브젝트 이름이 서로 다른 식별자임을 유지합니다
- attach 생략·stage 생략·CSI inline ephemeral·generic ephemeral·migration 조건을 합치지 않습니다

## 편집 후 독자 확인

- RPC 전체 개수를 몰라도 생성·attach·노드 준비의 호출자를 찾을 수 있나요?
- 등록 소켓이 있다는 사실만으로 볼륨 사용 가능을 확정하지 않나요?
- CSIDriver·CSINode·VolumeAttachment를 쓰는 시점과 주체를 설명할 수 있나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
