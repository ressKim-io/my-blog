# 후속 편집 작업 묶음

71편을 빠짐없이 한 번씩 배정한 36개 묶음입니다
본문 편집과 독립 검토 상태를 따로 표시합니다. 글별 상세는 [작업 목록](index.md)과 [실행 기록](execution/README.md)을 확인합니다

## 적용 방법

- B01·B02·B03은 서로 다른 설명 유형을 비교할 초기 후보입니다. 우선 한 편을 편집해 조건 보존과 독자 질문을 확인합니다
- 이후 묶음은 관련 개념을 함께 대조하기 위한 1~3편 단위입니다. 실제 편집과 검증은 글 한 편씩 진행해도 됩니다
- 묶음 번호는 필수 선행 관계나 공개 시리즈 순서가 아닙니다. 한 묶음의 여러 글도 같은 목차로 맞추지 않습니다
- 각 작업에서는 공통 기준·해당 검토서·원문 전문만 기본 입력으로 읽고, 필요한 선행 설명만 추가로 확인합니다
- 2026-10-25 후속 사용자 요청에 따라 71편 전체를 실제 편집·독립 검토 대상으로 진행합니다

기계가 읽을 목록은 [batches.json](batches.json), 원문·해시는 [manifest.json](manifest.json)에 있습니다

## 작업 목록

| 묶음 | 함께 확인할 질문 | 글별 검토서 | 본문 편집 | 독립 검토 |
|---|---|---|---|---|
| B01 | 첫 기준: 한 CREATE 요청의 기본 경로 | [Kubernetes API 서버의 생성 요청 처리 과정](posts/k8s-theory-api-request-path.md) | 완료 | 완료 |
| B02 | 첫 기준: PVC 요청과 바인딩의 기본 사례 | [PVC 바인딩과 StorageClass — PV의 claimRef를 먼저 쓰는 이유](posts/k8s-theory-pvc-storageclass-binding.md) | 완료 | 완료 |
| B03 | 첫 기준: 필요에서 로컬 캐시·알림으로 연결 | [informer — 로컬 사본은 언제부터 믿을 수 있을까요?](posts/k8s-theory-informer.md) | 완료 | 완료 |
| B04 | 인증·인가·admission의 서로 다른 판단 | [Kubernetes 인증: 신원은 어디서 만들어지는가](posts/k8s-theory-authentication.md) · [Kubernetes 인가: 요청을 허용하는 기준과 RBAC의 범위](posts/k8s-theory-authorization.md) · [Admission 실행 순서 — 누가 값을 바꾸고, 누가 거부하는가](posts/k8s-theory-admission-order.md) | 완료 | 완료 |
| B05 | 요청 중 확장 호출과 과부하 제어 | [Admission webhook과 CEL 정책 — 판단 실패는 어떻게 처리할까](posts/k8s-theory-admission-webhook-failure.md) · [API 확장 지점 — 타입 등록과 기능 활성은 다른 일입니다](posts/k8s-theory-api-extension-points.md) · [APF 내부 — 요청 수 대신 처리 자리를 나누는 방식](posts/k8s-theory-api-priority-fairness.md) | 완료 | 완료 |
| B06 | 변경 버전과 연속 관찰·복구 | [resourceVersion — 오래된 상태로 덮어쓰는 일을 막는 번호](posts/k8s-theory-resource-version.md) · [watch와 410 Gone — 놓친 변경은 커서만 옮겨 복구할 수 없습니다](posts/k8s-theory-watch.md) | 완료 | 완료 |
| B07 | 오브젝트 신원·소유와 삭제 수명 | [이름·UID·ownerReferences — 같은 이름이어도 같은 소유자는 아닙니다](posts/k8s-theory-object-identity-ownership.md) · [DELETE 이후 객체가 남는 이유 — finalizer와 유예 종료](posts/k8s-theory-deletion-lifecycle.md) | 완료 | 완료 |
| B08 | 필드 소유권과 apply 전환 | [Server-Side Apply — 필드별 소유권으로 변경 충돌을 판단합니다](posts/k8s-theory-server-side-apply.md) · [SSA 소유권 이전 — 필드를 뺐는데 값이 바뀌는 이유](posts/k8s-theory-apply-ownership-migration.md) | 완료 | 완료 |
| B09 | 상태를 다시 판단하는 조정 원리 | [reconcile — 캐시가 방금 보낸 쓰기를 아직 모를 때](posts/k8s-theory-reconcile.md) | 완료 | 완료 |
| B10 | API 표현·저장과 버전 이행 | [직렬화와 버전 변환 — 요청·메모리·저장의 모양이 다른 이유](posts/k8s-theory-serialization-version-conversion.md) · [세 가지 버전과 롤백 — 바이너리 교체와 기능 활성화를 나누는 이유](posts/k8s-theory-version-emulation-rollback.md) | 완료 | 완료 |
| B11 | 인증서와 kubelet 접근의 신뢰 경계 | [인증서 발급과 사칭: 조회할 수 없는 리소스 이름으로 권한을 묻는 이유](posts/k8s-theory-certificate-signing-delegation.md) · [kubelet 접속과 인가 — 같은 logs 요청에서 주체가 바뀝니다](posts/k8s-theory-kubelet-access.md) | 완료 | 완료 |
| B12 | 제어 평면 가용성과 저장 변환 | [컨트롤 플레인 이중화 — etcd·API 서버·컨트롤러의 다른 역할](posts/k8s-theory-control-plane-high-availability.md) · [Kubernetes 저장 암호화 — 새 키를 설정해도 기존 데이터가 그대로인 이유](posts/k8s-theory-storage-transformations.md) | 완료 | 완료 |
| B13 | 이벤트·추적으로 확인할 수 있는 범위 | [Kubernetes Event는 어디서 묶이고 버려지는가](posts/k8s-theory-event-compression.md) · [분산 추적의 계측 지점 — 문맥 전파와 기록을 나눠 봅니다](posts/k8s-theory-distributed-tracing.md) | 완료 | 완료 |
| B14 | 배치 후보·제약·선점 | [스케줄링과 바인딩 사이클 — 노드 선택과 기록을 나누는 이유](posts/k8s-theory-scheduling-binding-cycles.md) · [Pod 배치 제약 — 노드를 제외하는 조건과 점수를 높이는 조건](posts/k8s-theory-scheduling-constraints.md) · [Preemption과 PDB — 희생자 선정과 삭제 허용은 다른 판단입니다](posts/k8s-theory-preemption-pdb.md) | 완료 | 완료 |
| B15 | 노드의 실행 준비와 runtime 경계 | [kubelet과 Pod 수명주기 — 실행 중과 준비 완료는 다릅니다](posts/k8s-theory-kubelet-pod-lifecycle.md) · [CRI와 OCI — 실행 요청과 bundle 설정의 경계를 구분합니다](posts/k8s-theory-cri-oci-boundary.md) · [런타임 격리 — 생략한 보안 설정은 필드마다 다르게 적용됩니다](posts/k8s-theory-runtime-isolation.md) | 완료 | 완료 |
| B16 | 자원 선언·회계·실행 제어 | [QoS와 cgroup — request가 배치 계산에, limit이 실행 상한에 쓰이는 과정](posts/k8s-theory-qos-cgroups.md) · [자원 계산과 점수 전략 — Pod 요청을 세고 노드를 고르는 기준](posts/k8s-theory-resource-accounting-scoring.md) · [노드 swap — 기동 허용과 컨테이너 한도, 배치 계산을 구분하기](posts/k8s-theory-node-swap.md) | 완료 | 완료 |
| B17 | 자원 압박과 연락 두절의 별도 종료 판단 | [Eviction과 OOM — 컨테이너 종료와 Pod 삭제를 구분합니다](posts/k8s-theory-eviction-oom.md) · [노드 하트비트와 taint 축출 — 관찰 실패와 실제 종료는 다릅니다](posts/k8s-theory-node-heartbeat-taint-eviction.md) | 완료 | 완료 |
| B18 | 관측 소스·로그·실행 중 진단 | [Kubernetes 자원 지표 — 같은 Pod의 숫자가 다른 이유](posts/k8s-theory-node-observability-sources.md) · [컨테이너 로그 파일: 경로를 정한 쪽은 그 파일을 쓰지 않습니다](posts/k8s-theory-container-log-files.md) · [임시 컨테이너 — 추가 전용 API와 실행·상태 집계의 경계](posts/k8s-theory-ephemeral-containers.md) | 완료 | 완료 |
| B19 | 워크로드 교체·완료·자동 크기 조정 | [Deployment와 DaemonSet — 롤아웃의 가용성과 되돌리기 이력](posts/k8s-theory-workload-rollout-revisions.md) · [Job과 CronJob — 성공 집계와 실행 시각은 다른 판단입니다](posts/k8s-theory-job-cronjob-completion.md) · [HPA와 scale subresource — replica 계산과 필드 소유권의 경계](posts/k8s-theory-hpa-scale-subresource.md) | 완료 | 완료 |
| B20 | 설정 전달과 앱이 관찰하는 시점 | [ConfigMap과 Secret 전달 — 환경 변수와 볼륨 파일의 갱신 경계](posts/k8s-theory-configmap-secret-delivery.md) | 완료 | 완료 |
| B21 | 장치 요청·할당·실행 준비 | [장치 자원 할당 — 수량에 따른 노드 선택과 DRA의 장치 선택](posts/k8s-theory-device-resource-allocation.md) | 완료 | 완료 |
| B22 | attachment·sandbox 수명·노드 간 전달 | [CNI 호출 규약 — 런타임은 Pod 네트워크를 어떻게 준비할까](posts/k8s-theory-cni-contract.md) · [Pod sandbox와 pause — 네트워크를 앱 재시작과 분리하는 과정](posts/k8s-theory-pod-sandbox-pause.md) · [Overlay와 native routing — 노드 간 경로와 주소 공급을 구분하기](posts/k8s-theory-overlay-native-routing.md) | 완료 | 완료 |
| B23 | Service 주소 확보와 백엔드 전달 | [Service와 kube-proxy — 고정 주소 뒤의 목록·규칙·연결 상태](posts/k8s-theory-service-kube-proxy.md) · [ServiceCIDR와 IPAddress — 주소를 확보한 뒤 Service를 저장합니다](posts/k8s-theory-service-cidr-ip-address.md) | 완료 | 완료 |
| B24 | 이름 조회·주소군과 사용할 후보 | [DNS와 ndots — 이름 하나가 여러 질의로 이어지는 조건](posts/k8s-theory-dns-ndots.md) · [트래픽 지역성과 dual-stack — 후보 제한과 선호, 주소군별 경로](posts/k8s-theory-traffic-locality-dual-stack.md) | 완료 | 완료 |
| B25 | 외부 진입 설정과 클라우드 작업 주체 | [Ingress와 Gateway API — 역할에 따라 라우팅 설정 나누기](posts/k8s-theory-ingress-gateway-api.md) · [CCM과 클라우드 경계 — 노드 초기화와 외부 자원 정리](posts/k8s-theory-cloud-controller-boundary.md) | 완료 | 완료 |
| B26 | 표준 정책과 관리자 판정·위임 | [NetworkPolicy — Pod와 방향을 고르고 허용 규칙을 합칩니다](posts/k8s-theory-network-policy.md) · [관리자 네트워크 정책 — 허용·거부와 다음 계층으로의 위임](posts/k8s-theory-admin-network-policy.md) | 완료 | 완료 |
| B27 | CSI 호출자와 준비·정리 단계 | [CSI 구조 — sidecar의 Controller 호출과 kubelet의 Node 호출](posts/k8s-theory-csi-architecture.md) · [attach·stage·publish — 볼륨 연결부터 Pod가 사용할 경로까지](posts/k8s-theory-volume-attach-stage-publish.md) | 완료 | 완료 |
| B28 | 복제본·PVC 수명과 변경·복원 | [StatefulSet과 볼륨 수명 — PVC를 지우기 전에 주인을 정합니다](posts/k8s-theory-statefulset-volume-lifecycle.md) · [확장·스냅샷·임시 볼륨 — 요청 뒤의 주체와 수명](posts/k8s-theory-volume-expansion-snapshots-ephemeral.md) | 완료 | 완료 |
| B29 | 볼륨 개수와 공급 바이트의 배치 판단 | [볼륨 개수 상한 — 드라이버가 말한 숫자를 누가 고치나](posts/k8s-theory-volume-attachment-limits.md) · [용량 기반 스케줄링 — 아직 없는 볼륨의 크기를 무엇과 비교하나](posts/k8s-theory-storage-capacity-scheduling.md) | 완료 | 완료 |
| B30 | CR 필드 처리와 저장본 버전 이행 | [CRD 구조 — 스키마가 검사하고 남기는 필드](posts/k8s-theory-crd-schema-pruning.md) · [CRD 버저닝 — 저장 목표와 기존 저장본을 나눕니다](posts/k8s-theory-crd-version-conversion.md) | 완료 | 완료 |
| B31 | 라이브러리 위에서 한 번의 조정 완결 | [controller-runtime과 reconcile — 큐에는 이름이 들어갑니다](posts/k8s-theory-controller-runtime-reconcile.md) | 완료 | 완료 |
| B32 | 별도 API 서버의 필요와 요청·목록 경계 | [Aggregated API server — 경로 위임과 장애의 범위](posts/k8s-theory-aggregated-api-server.md) | 완료 | 완료 |
| B33 | 정책 실행 시점과 플랫폼 확장 선택 | [정책 계층 — 요청을 막는 판정과 나중에 고치는 변경](posts/k8s-theory-policy-layers.md) · [Kubernetes 확장 기능 — 장애가 나면 어디까지 영향을 받을까](posts/k8s-theory-extension-failure-boundaries.md) | 완료 | 완료 |
| B34 | CPU 예산·메모리 압박과 관측값 | [cgroup v2 CPU quota — 평균 사용률이 낮아도 실행이 멈추는 이유](posts/k8s-theory-cgroup-v2-cpu-quota.md) · [페이지 캐시·회수·OOM — working set이 limit 아래여도 느려지고 종료되는 이유](posts/k8s-theory-page-cache-reclaim-oom.md) | 완료 | 완료 |
| B35 | 패킷 연결 상태와 namespace 정리 수명 | [Netfilter와 conntrack — Service의 주소 변환을 기억하는 곳](posts/k8s-theory-netfilter-conntrack.md) · [Namespace 수명 — 프로세스가 없어도 남는 참조](posts/k8s-theory-namespace-lifetime.md) | 완료 | 완료 |
| B36 | 공유 데이터·경로 연결·mount 전파 | [mount와 bind mount — 같은 볼륨을 다른 경로에 제공하는 방법](posts/k8s-theory-mount-bind-mount.md) | 완료 | 완료 |

## 다음 작업에서 넘길 예

```text
docs/structure-review/README.md와 handoff.md를 읽어줘
이번에는 batches.json의 B02에 속한 글만 실제로 수정해줘
해당 검토서와 원문 전문을 대조하고, 조건·근거·코드·가정을 보존하며 설명 순서를 개선해줘
독자 확인 질문에 본문으로 답할 수 있는지 검토하고 실제 실행한 검증 결과를 보고해줘
다른 글·메타데이터·자산·코드는 수정하지 말고 commit과 push도 하지 마
```

기술 사실을 다시 확인해야 하면 구조 편집과 구분해 기록합니다
이번 검토서의 원문 버전 표기를 현재 클러스터의 사실로 대신하지 않습니다
