# 글별 구조 검토 작업 목록

구조 검토와 실제 본문 편집의 상태를 구분합니다

## api 23편

| 순서 | 글별 검토서 | 검토안 | 본문 편집 | 독립 검토 |
|---:|---|---|---|---|
| 1 | [Kubernetes API 서버의 생성 요청 처리 과정](posts/k8s-theory-api-request-path.md) | 완료 | 완료 | [완료](execution/reviews/B01.md) |
| 2 | [Kubernetes 인증: 신원은 어디서 만들어지는가](posts/k8s-theory-authentication.md) | 완료 | 완료 | [완료](execution/reviews/B04.md) |
| 3 | [Kubernetes 인가: 요청을 허용하는 기준과 RBAC의 범위](posts/k8s-theory-authorization.md) | 완료 | 완료 | [완료](execution/reviews/B04.md) |
| 4 | [Admission 실행 순서 — 누가 값을 바꾸고, 누가 거부하는가](posts/k8s-theory-admission-order.md) | 완료 | 완료 | [완료](execution/reviews/B04.md) |
| 5 | [Admission webhook과 CEL 정책 — 판단 실패는 어떻게 처리할까](posts/k8s-theory-admission-webhook-failure.md) | 완료 | 완료 | [완료](execution/reviews/B05.md) |
| 6 | [resourceVersion — 오래된 상태로 덮어쓰는 일을 막는 번호](posts/k8s-theory-resource-version.md) | 완료 | 완료 | [완료](execution/reviews/B06.md) |
| 7 | [watch와 410 Gone — 놓친 변경은 커서만 옮겨 복구할 수 없습니다](posts/k8s-theory-watch.md) | 완료 | 완료 | [완료](execution/reviews/B06.md) |
| 8 | [이름·UID·ownerReferences — 같은 이름이어도 같은 소유자는 아닙니다](posts/k8s-theory-object-identity-ownership.md) | 완료 | 완료 | [완료](execution/reviews/B07.md) |
| 9 | [DELETE 이후 객체가 남는 이유 — finalizer와 유예 종료](posts/k8s-theory-deletion-lifecycle.md) | 완료 | 완료 | [완료](execution/reviews/B07.md) |
| 10 | [Server-Side Apply — 필드별 소유권으로 변경 충돌을 판단합니다](posts/k8s-theory-server-side-apply.md) | 완료 | 완료 | [완료](execution/reviews/B08.md) |
| 11 | [SSA 소유권 이전 — 필드를 뺐는데 값이 바뀌는 이유](posts/k8s-theory-apply-ownership-migration.md) | 완료 | 완료 | [완료](execution/reviews/B08.md) |
| 12 | [informer — 로컬 사본은 언제부터 믿을 수 있을까요?](posts/k8s-theory-informer.md) | 완료 | 완료 | [완료](execution/reviews/B03.md) |
| 13 | [reconcile — 캐시가 방금 보낸 쓰기를 아직 모를 때](posts/k8s-theory-reconcile.md) | 완료 | 완료 | [완료](execution/reviews/B09.md) |
| 14 | [API 확장 지점 — 타입 등록과 기능 활성은 다른 일입니다](posts/k8s-theory-api-extension-points.md) | 완료 | 완료 | [완료](execution/reviews/B05.md) |
| 15 | [APF 내부 — 요청 수 대신 처리 자리를 나누는 방식](posts/k8s-theory-api-priority-fairness.md) | 완료 | 완료 | [완료](execution/reviews/B05.md) |
| 16 | [직렬화와 버전 변환 — 요청·메모리·저장의 모양이 다른 이유](posts/k8s-theory-serialization-version-conversion.md) | 완료 | 완료 | [완료](execution/reviews/B10.md) |
| 17 | [인증서 발급과 사칭: 조회할 수 없는 리소스 이름으로 권한을 묻는 이유](posts/k8s-theory-certificate-signing-delegation.md) | 완료 | 완료 | [완료](execution/reviews/B11.md) |
| 18 | [kubelet 접속과 인가 — 같은 logs 요청에서 주체가 바뀝니다](posts/k8s-theory-kubelet-access.md) | 완료 | 완료 | [완료](execution/reviews/B11.md) |
| 19 | [세 가지 버전과 롤백 — 바이너리 교체와 기능 활성화를 나누는 이유](posts/k8s-theory-version-emulation-rollback.md) | 완료 | 완료 | [완료](execution/reviews/B10.md) |
| 20 | [컨트롤 플레인 이중화 — etcd·API 서버·컨트롤러의 다른 역할](posts/k8s-theory-control-plane-high-availability.md) | 완료 | 완료 | [완료](execution/reviews/B12.md) |
| 21 | [Kubernetes 저장 암호화 — 새 키를 설정해도 기존 데이터가 그대로인 이유](posts/k8s-theory-storage-transformations.md) | 완료 | 완료 | [완료](execution/reviews/B12.md) |
| 22 | [Kubernetes Event는 어디서 묶이고 버려지는가](posts/k8s-theory-event-compression.md) | 완료 | 완료 | [완료](execution/reviews/B13.md) |
| 23 | [분산 추적의 계측 지점 — 문맥 전파와 기록을 나눠 봅니다](posts/k8s-theory-distributed-tracing.md) | 완료 | 완료 | [완료](execution/reviews/B13.md) |

## node 19편

| 순서 | 글별 검토서 | 검토안 | 본문 편집 | 독립 검토 |
|---:|---|---|---|---|
| 1 | [스케줄링과 바인딩 사이클 — 노드 선택과 기록을 나누는 이유](posts/k8s-theory-scheduling-binding-cycles.md) | 완료 | 완료 | [완료](execution/reviews/B14.md) |
| 2 | [Pod 배치 제약 — 노드를 제외하는 조건과 점수를 높이는 조건](posts/k8s-theory-scheduling-constraints.md) | 완료 | 완료 | [완료](execution/reviews/B14.md) |
| 3 | [Preemption과 PDB — 희생자 선정과 삭제 허용은 다른 판단입니다](posts/k8s-theory-preemption-pdb.md) | 완료 | 완료 | [완료](execution/reviews/B14.md) |
| 4 | [kubelet과 Pod 수명주기 — 실행 중과 준비 완료는 다릅니다](posts/k8s-theory-kubelet-pod-lifecycle.md) | 완료 | 완료 | [완료](execution/reviews/B15.md) |
| 5 | [QoS와 cgroup — request가 배치 계산에, limit이 실행 상한에 쓰이는 과정](posts/k8s-theory-qos-cgroups.md) | 완료 | 완료 | [완료](execution/reviews/B16.md) |
| 6 | [Eviction과 OOM — 컨테이너 종료와 Pod 삭제를 구분합니다](posts/k8s-theory-eviction-oom.md) | 완료 | 완료 | [완료](execution/reviews/B17.md) |
| 7 | [Kubernetes 자원 지표 — 같은 Pod의 숫자가 다른 이유](posts/k8s-theory-node-observability-sources.md) | 완료 | 완료 | [완료](execution/reviews/B18.md) |
| 8 | [Deployment와 DaemonSet — 롤아웃의 가용성과 되돌리기 이력](posts/k8s-theory-workload-rollout-revisions.md) | 완료 | 완료 | [완료](execution/reviews/B19.md) |
| 9 | [Job과 CronJob — 성공 집계와 실행 시각은 다른 판단입니다](posts/k8s-theory-job-cronjob-completion.md) | 완료 | 완료 | [완료](execution/reviews/B19.md) |
| 10 | [노드 하트비트와 taint 축출 — 관찰 실패와 실제 종료는 다릅니다](posts/k8s-theory-node-heartbeat-taint-eviction.md) | 완료 | 완료 | [완료](execution/reviews/B17.md) |
| 11 | [ConfigMap과 Secret 전달 — 환경 변수와 볼륨 파일의 갱신 경계](posts/k8s-theory-configmap-secret-delivery.md) | 완료 | 완료 | [완료](execution/reviews/B20.md) |
| 12 | [CRI와 OCI — 실행 요청과 bundle 설정의 경계를 구분합니다](posts/k8s-theory-cri-oci-boundary.md) | 완료 | 완료 | [완료](execution/reviews/B15.md) |
| 13 | [장치 자원 할당 — 수량에 따른 노드 선택과 DRA의 장치 선택](posts/k8s-theory-device-resource-allocation.md) | 완료 | 완료 | [완료](execution/reviews/B21.md) |
| 14 | [런타임 격리 — 생략한 보안 설정은 필드마다 다르게 적용됩니다](posts/k8s-theory-runtime-isolation.md) | 완료 | 완료 | [완료](execution/reviews/B15.md) |
| 15 | [자원 계산과 점수 전략 — Pod 요청을 세고 노드를 고르는 기준](posts/k8s-theory-resource-accounting-scoring.md) | 완료 | 완료 | [완료](execution/reviews/B16.md) |
| 16 | [노드 swap — 기동 허용과 컨테이너 한도, 배치 계산을 구분하기](posts/k8s-theory-node-swap.md) | 완료 | 완료 | [완료](execution/reviews/B16.md) |
| 17 | [컨테이너 로그 파일: 경로를 정한 쪽은 그 파일을 쓰지 않습니다](posts/k8s-theory-container-log-files.md) | 완료 | 완료 | [완료](execution/reviews/B18.md) |
| 18 | [HPA와 scale subresource — replica 계산과 필드 소유권의 경계](posts/k8s-theory-hpa-scale-subresource.md) | 완료 | 완료 | [완료](execution/reviews/B19.md) |
| 19 | [임시 컨테이너 — 추가 전용 API와 실행·상태 집계의 경계](posts/k8s-theory-ephemeral-containers.md) | 완료 | 완료 | [완료](execution/reviews/B18.md) |

## network 11편

| 순서 | 글별 검토서 | 검토안 | 본문 편집 | 독립 검토 |
|---:|---|---|---|---|
| 1 | [CNI 호출 규약 — 런타임은 Pod 네트워크를 어떻게 준비할까](posts/k8s-theory-cni-contract.md) | 완료 | 완료 | [완료](execution/reviews/B22.md) |
| 2 | [Pod sandbox와 pause — 네트워크를 앱 재시작과 분리하는 과정](posts/k8s-theory-pod-sandbox-pause.md) | 완료 | 완료 | [완료](execution/reviews/B22.md) |
| 3 | [Overlay와 native routing — 노드 간 경로와 주소 공급을 구분하기](posts/k8s-theory-overlay-native-routing.md) | 완료 | 완료 | [완료](execution/reviews/B22.md) |
| 4 | [Service와 kube-proxy — 고정 주소 뒤의 목록·규칙·연결 상태](posts/k8s-theory-service-kube-proxy.md) | 완료 | 완료 | [완료](execution/reviews/B23.md) |
| 5 | [DNS와 ndots — 이름 하나가 여러 질의로 이어지는 조건](posts/k8s-theory-dns-ndots.md) | 완료 | 완료 | [완료](execution/reviews/B24.md) |
| 6 | [Ingress와 Gateway API — 역할에 따라 라우팅 설정 나누기](posts/k8s-theory-ingress-gateway-api.md) | 완료 | 완료 | [완료](execution/reviews/B25.md) |
| 7 | [NetworkPolicy — Pod와 방향을 고르고 허용 규칙을 합칩니다](posts/k8s-theory-network-policy.md) | 완료 | 완료 | [완료](execution/reviews/B26.md) |
| 8 | [관리자 네트워크 정책 — 허용·거부와 다음 계층으로의 위임](posts/k8s-theory-admin-network-policy.md) | 완료 | 완료 | [완료](execution/reviews/B26.md) |
| 9 | [CCM과 클라우드 경계 — 노드 초기화와 외부 자원 정리](posts/k8s-theory-cloud-controller-boundary.md) | 완료 | 완료 | [완료](execution/reviews/B25.md) |
| 10 | [트래픽 지역성과 dual-stack — 후보 제한과 선호, 주소군별 경로](posts/k8s-theory-traffic-locality-dual-stack.md) | 완료 | 완료 | [완료](execution/reviews/B24.md) |
| 11 | [ServiceCIDR와 IPAddress — 주소를 확보한 뒤 Service를 저장합니다](posts/k8s-theory-service-cidr-ip-address.md) | 완료 | 완료 | [완료](execution/reviews/B23.md) |

## storage 7편

| 순서 | 글별 검토서 | 검토안 | 본문 편집 | 독립 검토 |
|---:|---|---|---|---|
| 1 | [PVC 바인딩과 StorageClass — PV의 claimRef를 먼저 쓰는 이유](posts/k8s-theory-pvc-storageclass-binding.md) | 완료 | 완료 | [완료](execution/reviews/B02.md) |
| 2 | [CSI 구조 — sidecar의 Controller 호출과 kubelet의 Node 호출](posts/k8s-theory-csi-architecture.md) | 완료 | 완료 | [완료](execution/reviews/B27.md) |
| 3 | [attach·stage·publish — 볼륨 연결부터 Pod가 사용할 경로까지](posts/k8s-theory-volume-attach-stage-publish.md) | 완료 | 완료 | [완료](execution/reviews/B27.md) |
| 4 | [StatefulSet과 볼륨 수명 — PVC를 지우기 전에 주인을 정합니다](posts/k8s-theory-statefulset-volume-lifecycle.md) | 완료 | 완료 | [완료](execution/reviews/B28.md) |
| 5 | [확장·스냅샷·임시 볼륨 — 요청 뒤의 주체와 수명](posts/k8s-theory-volume-expansion-snapshots-ephemeral.md) | 완료 | 완료 | [완료](execution/reviews/B28.md) |
| 6 | [볼륨 개수 상한 — 드라이버가 말한 숫자를 누가 고치나](posts/k8s-theory-volume-attachment-limits.md) | 완료 | 완료 | [완료](execution/reviews/B29.md) |
| 7 | [용량 기반 스케줄링 — 아직 없는 볼륨의 크기를 무엇과 비교하나](posts/k8s-theory-storage-capacity-scheduling.md) | 완료 | 완료 | [완료](execution/reviews/B29.md) |

## extension 6편

| 순서 | 글별 검토서 | 검토안 | 본문 편집 | 독립 검토 |
|---:|---|---|---|---|
| 1 | [CRD 구조 — 스키마가 검사하고 남기는 필드](posts/k8s-theory-crd-schema-pruning.md) | 완료 | 완료 | [완료](execution/reviews/B30.md) |
| 2 | [CRD 버저닝 — 저장 목표와 기존 저장본을 나눕니다](posts/k8s-theory-crd-version-conversion.md) | 완료 | 완료 | [완료](execution/reviews/B30.md) |
| 3 | [controller-runtime과 reconcile — 큐에는 이름이 들어갑니다](posts/k8s-theory-controller-runtime-reconcile.md) | 완료 | 완료 | [완료](execution/reviews/B31.md) |
| 4 | [정책 계층 — 요청을 막는 판정과 나중에 고치는 변경](posts/k8s-theory-policy-layers.md) | 완료 | 완료 | [완료](execution/reviews/B33.md) |
| 5 | [Aggregated API server — 경로 위임과 장애의 범위](posts/k8s-theory-aggregated-api-server.md) | 완료 | 완료 | [완료](execution/reviews/B32.md) |
| 6 | [Kubernetes 확장 기능 — 장애가 나면 어디까지 영향을 받을까](posts/k8s-theory-extension-failure-boundaries.md) | 완료 | 완료 | [완료](execution/reviews/B33.md) |

## kernel 5편

| 순서 | 글별 검토서 | 검토안 | 본문 편집 | 독립 검토 |
|---:|---|---|---|---|
| 1 | [cgroup v2 CPU quota — 평균 사용률이 낮아도 실행이 멈추는 이유](posts/k8s-theory-cgroup-v2-cpu-quota.md) | 완료 | 완료 | [완료](execution/reviews/B34.md) |
| 2 | [Netfilter와 conntrack — Service의 주소 변환을 기억하는 곳](posts/k8s-theory-netfilter-conntrack.md) | 완료 | 완료 | [완료](execution/reviews/B35.md) |
| 3 | [mount와 bind mount — 같은 볼륨을 다른 경로에 제공하는 방법](posts/k8s-theory-mount-bind-mount.md) | 완료 | 완료 | [완료](execution/reviews/B36.md) |
| 4 | [페이지 캐시·회수·OOM — working set이 limit 아래여도 느려지고 종료되는 이유](posts/k8s-theory-page-cache-reclaim-oom.md) | 완료 | 완료 | [완료](execution/reviews/B34.md) |
| 5 | [Namespace 수명 — 프로세스가 없어도 남는 참조](posts/k8s-theory-namespace-lifetime.md) | 완료 | 완료 | [완료](execution/reviews/B35.md) |

구조 검토안 71/71편. 본문 편집 71/71편. 독립 검토 71/71편
