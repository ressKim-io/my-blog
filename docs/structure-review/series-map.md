# 글 사이의 설명 역할과 편집 순서

71편의 [글별 검토서](index.md)를 함께 적용할 때 사용할 안내입니다
현재 게시된 시리즈 순서나 URL을 바꾸는 계획은 아닙니다
아래 연결은 편집자가 선행 개념과 중복을 확인할 경로이며, 독자에게 모든 선행 글의 완독을 요구하지 않습니다

## 전체에서 반복된 문제

문장만으로 AI 작성 여부를 판단하지 않았습니다
읽기를 어렵게 하는 것으로 본 지점은 대체로 다음 세 가지입니다

1. 기본 동작을 끝까지 보기 전에 버전·구현·빈 값·호환 예외를 길게 읽어야 합니다
2. 도입에서 제기한 질문을 잠시 멈추고 다른 주제로 넘어간 뒤 후반에서 다시 답합니다
3. 사용 목적과 입력·출력을 알기 전에 자료구조·필드·설정 목록을 구분해야 합니다

모든 글에 같은 문제가 있는 것은 아닙니다
CPU quota의 시간 예제, attach·stage·publish의 두 Pod 사례, 확장 기능 종합 글의 네 요구 사례처럼 유지할 중심 흐름도 검토서에 적었습니다
이 문서는 새로운 기술 사실을 검증한 결과가 아니라, 고정한 원문을 읽고 제안한 편집 판단입니다

## API 23편

중심 연결은 요청 접수·저장, 저장된 상태의 관찰, 그 상태를 바꾸는 조정입니다

- [API 요청](posts/k8s-theory-api-request-path.md)은 한 CREATE 요청이 저장될 때까지의 지도 역할을 맡습니다. 인증·인가·admission·APF의 세부 구현을 모두 이 글에서 끝내지 않습니다
- [resourceVersion](posts/k8s-theory-resource-version.md)과 [watch](posts/k8s-theory-watch.md)는 변경을 이어 읽고 복구하는 조건을 설명합니다
- [informer](posts/k8s-theory-informer.md)는 이 관찰 결과를 로컬 사본과 알림으로 사용하는 이유를 설명합니다
- [reconcile](posts/k8s-theory-reconcile.md)은 이벤트를 현재 상태의 재판단으로 바꾸는 원리를 설명합니다. 라이브러리 설정은 확장 시리즈의 controller-runtime 글이 맡습니다
- 신원·삭제·SSA는 각각 오브젝트 수명과 필드 쓰기의 경계입니다. 같은 resourceVersion이 등장해도 소유권·UID·버전의 의미를 한 단어로 합치지 않습니다
- 인증서·접근·HA·저장 변환·이벤트·추적 글에서는 위 기본 경로를 한 문단으로 연결하고 해당 글의 운영 질문으로 좁힙니다

참고 전개는 카카오페이의 한 배포 사건 추적과 Learnk8s의 필요에서 캐시 추상화로 이어지는 구성입니다
구체적인 비교와 링크는 [외부 글 비교](references.md)에 있습니다

## 노드 19편

배치할 수 있는지, 노드에서 실행할 수 있는지, 실행 뒤 어떻게 관찰·교체하는지를 구분합니다

- [스케줄링 사이클](posts/k8s-theory-scheduling-binding-cycles.md)은 후보 선택과 바인딩의 큰 경로를 맡습니다. 제약·선점·자원 점수는 그 경로에서 다른 질문을 깊게 다룹니다
- [kubelet Pod 수명](posts/k8s-theory-kubelet-pod-lifecycle.md)은 노드의 준비 순서와 관찰 상태를 맡고, [CRI·OCI](posts/k8s-theory-cri-oci-boundary.md)는 호출자와 실행 구현의 경계를 맡습니다
- [QoS·cgroup](posts/k8s-theory-qos-cgroups.md)은 Kubernetes의 자원 선언이 실행 제어로 바뀌는 위치를 설명합니다. 커널의 예산 차감·회수 알고리즘은 커널 시리즈로 연결합니다
- [Eviction·OOM](posts/k8s-theory-eviction-oom.md)과 [Node heartbeat](posts/k8s-theory-node-heartbeat-taint-eviction.md)는 각각 자원 압박과 연락 두절의 판단을 맡습니다. 모두 같은 Pod 종료 절차로 합치지 않습니다
- rollout·Job·HPA는 각 워크로드의 목표와 완료 판단을 중심으로 읽습니다. 공통 controller 원리를 매번 길게 반복하지 않습니다
- 관측 소스·로그·임시 컨테이너는 무엇을 볼 수 있는지와 볼 수 없는지를 연결합니다. 운영체제 계측과 API 상태가 같은 순간을 보장한다고 쓰지 않습니다

각 글의 첫 기본 경로를 완료한 뒤 별도 구현·기능 게이트로 확장합니다
필수 적용 범위인 OS·런타임·요청 종류는 기본 경로 앞에 남깁니다

## 네트워크 11편

주소를 준비하는 것, 패킷을 전달하는 것, 전달을 허용하는 것은 다른 질문입니다

- [CNI 계약](posts/k8s-theory-cni-contract.md)은 런타임과 플러그인의 입력·출력·정리 책임을 맡습니다
- [sandbox·pause](posts/k8s-theory-pod-sandbox-pause.md)는 앱 재시작과 공유 네트워크 수명을 설명합니다. 커널 참조의 상세는 namespace 수명 글로 넘깁니다
- [Overlay·native routing](posts/k8s-theory-overlay-native-routing.md)은 노드 간 전달 경로를 먼저 끝낸 뒤 주소 공급을 별도 단위로 설명합니다
- [Service](posts/k8s-theory-service-kube-proxy.md)는 백엔드 목록과 기본 연결 왕복을 맡습니다. 커널 hook·해시·만료는 netfilter 글, 지역 후보·주소군은 traffic locality 글, 주소 확보 쓰기는 ServiceCIDR 글이 맡습니다
- [DNS](posts/k8s-theory-dns-ndots.md)는 이름에서 후보 질의와 응답·재시도로 이어갑니다. Service 전달을 필요한 만큼만 연결합니다
- Ingress·Gateway와 CCM은 외부 진입 설정 및 클라우드 작업의 책임을 구분합니다. 둘을 반드시 같은 구현 경로로 엮지 않습니다
- 표준 NetworkPolicy를 먼저 설명한 뒤 관리자 정책의 우선순위·위임을 대비합니다. 표준 허용 합집합을 모든 확장 정책에 일반화하지 않습니다

Cloudflare 글에서 참고한 것은 특정 네트워크 구현이 아니라 목적·대표 경로·구현 심화의 연결입니다

## 스토리지 7편

각 글에서 완료했다고 말하는 대상이 다릅니다

| 글 | 이 글이 답할 질문 | 이어서 남는 질문 |
|---|---|---|
| [PVC·StorageClass](posts/k8s-theory-pvc-storageclass-binding.md) | 요청이 어느 PV와 어떻게 연결되는가 | 실제 드라이버에 누가 요청하는가 |
| [CSI 구조](posts/k8s-theory-csi-architecture.md) | sidecar·kubelet이 어떤 계약으로 호출하는가 | 노드와 Pod 경로는 어떤 순서로 준비하는가 |
| [attach·stage·publish](posts/k8s-theory-volume-attach-stage-publish.md) | 연결·공용 준비·Pod별 준비와 해제는 어떻게 다른가 | mount가 같은 데이터를 여러 경로에 어떻게 제공하는가 |
| [StatefulSet 수명](posts/k8s-theory-statefulset-volume-lifecycle.md) | 복제본 교체와 삭제에서 PVC는 무엇을 따르는가 | PVC 삭제 뒤 실제 저장소는 누가 회수하는가 |
| [확장·스냅샷·임시 볼륨](posts/k8s-theory-volume-expansion-snapshots-ephemeral.md) | 변경·복원·임시 사용이 기본 수명을 어떻게 바꾸는가 | 각 기능의 실제 완료와 지원 조건은 무엇인가 |
| [볼륨 개수](posts/k8s-theory-volume-attachment-limits.md) | 노드·드라이버별 고유 볼륨 상한을 누가 보고·소비하는가 | 낡은 상한과 attach 실패를 어떻게 조정하는가 |
| [공급 용량](posts/k8s-theory-storage-capacity-scheduling.md) | 아직 없는 볼륨의 요청 바이트를 무엇과 비교하는가 | Filter 통과 뒤 실제 생성이 왜 실패할 수 있는가 |

PV·PVC Bound, VolumeAttachment attached, Pod target 준비, 실제 저장소 삭제를 같은 완료 표시로 줄이지 않습니다
스토리지의 구조 개선은 이 완료 경계를 독자가 앞에서부터 이해하도록 연결하는 작업입니다

## 확장 6편

- [CRD 스키마](posts/k8s-theory-crd-schema-pruning.md)는 데이터가 어떻게 받아들여지고 남는지 설명합니다
- [CRD 버전](posts/k8s-theory-crd-version-conversion.md)은 같은 데이터의 표현과 기존 저장본 이행을 설명합니다
- [controller-runtime](posts/k8s-theory-controller-runtime-reconcile.md)은 저장된 의도를 반복해 실행 상태로 맞추는 한 번의 조정을 먼저 보여줍니다
- [정책 계층](posts/k8s-theory-policy-layers.md)은 요청 거절·요청 중 변경·저장 뒤 변경을 비교합니다
- [aggregation](posts/k8s-theory-aggregated-api-server.md)은 왜 별도 서버가 필요한지부터 시작해 요청·신뢰·목록 경계를 설명합니다
- [확장 장애 경계](posts/k8s-theory-extension-failure-boundaries.md)는 앞선 설명을 요구사항 선택으로 종합합니다. 개별 글의 옵션 표를 다시 모두 싣지 않습니다

토스의 Operator 글처럼 요구에서 역할을 도출하는 전개를 참고하되, 원문에 없는 운영 경험을 추가하지 않습니다

## 커널 5편

Kubernetes 글에서 남은 질문을 커널 동작으로 풀어주는 심화입니다
커널 자료구조 자체를 읽는 이유를 먼저 만듭니다

| 연결하는 글 | 커널 글의 중심 질문 |
|---|---|
| QoS·자원 제어 → [CPU quota](posts/k8s-theory-cgroup-v2-cpu-quota.md) | 평균이 낮아도 기간별 합산 실행 예산이 소진되는가 |
| Service → [Netfilter·conntrack](posts/k8s-theory-netfilter-conntrack.md) | 주소 변환과 응답·후속 패킷의 상태가 어디에 남는가 |
| CSI 준비 → [mount·bind](posts/k8s-theory-mount-bind-mount.md) | 경로를 늘리는 것과 데이터를 복제하는 것이 왜 다른가 |
| 메모리 관측·OOM → [page cache·회수](posts/k8s-theory-page-cache-reclaim-oom.md) | 그래프에 잡힌 값과 회수 비용·실제 한도 범위가 어떻게 다른가 |
| sandbox·CNI 정리 → [namespace 수명](posts/k8s-theory-namespace-lifetime.md) | 프로세스가 없어도 무엇이 객체를 유지하며 어떤 정리가 남는가 |

NAVER D2에서 참고한 것은 동작을 먼저 관찰·해석한 뒤 Kubernetes 선언에 연결하는 방식입니다
현재 글은 소스 해설이므로 계산 예제와 실제 실행 결과를 분명히 구분합니다

## 중복을 줄일 때 남겨야 할 것

링크는 해당 글의 필수 설명을 대체하지 않습니다
예를 들어 CSI 글은 VolumeAttachment의 역할을 자체적으로 이해할 수 있어야 하지만 attach의 모든 오류 분기까지 반복할 필요는 없습니다

선행 개념은 한두 문장으로 연결하고, 결과를 바꾸는 조건은 그 주장 옆에 둡니다
자세한 구현·검증은 담당 글로 보내되, 링크를 읽지 않으면 앞의 주장이 무조건적인 보장으로 보이는 축약은 하지 않습니다

실제 작업은 [편집 묶음](batches.md)에서 한 묶음을 고르고 [후속 편집 지침](handoff.md)에 따라 진행합니다
