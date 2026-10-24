# Kubernetes 이론 글 검토 대기열

대상은 `k8s-theory-*` 71편입니다. 상태는 새 문체 검토 작업의 진행 상태이며 과거 작성·검수 이력과 별개입니다

표본 6편은 Batch 01로 먼저 다듬고, 후속 배치는 시리즈 순서와 글 간 연결을 고려해 정합니다

## k8s-theory-api

| 순서 | 글 | 상태 |
|---|---|---|
| 1 | [k8s-theory-api-request-path](../../src/content/essays/kubernetes/k8s-theory-api-request-path.md) | Batch 02 검수 완료 |
| 2 | [k8s-theory-authentication](../../src/content/essays/kubernetes/k8s-theory-authentication.md) | Batch 02 검수 완료 |
| 3 | [k8s-theory-authorization](../../src/content/essays/kubernetes/k8s-theory-authorization.md) | Batch 02 검수 완료 |
| 4 | [k8s-theory-admission-order](../../src/content/essays/kubernetes/k8s-theory-admission-order.md) | Batch 03 검수 완료 |
| 5 | [k8s-theory-admission-webhook-failure](../../src/content/essays/kubernetes/k8s-theory-admission-webhook-failure.md) | Batch 03 검수 완료 |
| 6 | [k8s-theory-resource-version](../../src/content/essays/kubernetes/k8s-theory-resource-version.md) | Batch 03 검수 완료 |
| 7 | [k8s-theory-watch](../../src/content/essays/kubernetes/k8s-theory-watch.md) | Batch 04 검수 완료 |
| 8 | [k8s-theory-object-identity-ownership](../../src/content/essays/kubernetes/k8s-theory-object-identity-ownership.md) | Batch 04 검수 완료 |
| 9 | [k8s-theory-deletion-lifecycle](../../src/content/essays/kubernetes/k8s-theory-deletion-lifecycle.md) | Batch 04 검수 완료 |
| 10 | [k8s-theory-server-side-apply](../../src/content/essays/kubernetes/k8s-theory-server-side-apply.md) | Batch 05 검수 완료 |
| 11 | [k8s-theory-apply-ownership-migration](../../src/content/essays/kubernetes/k8s-theory-apply-ownership-migration.md) | Batch 05 검수 완료 |
| 12 | [k8s-theory-informer](../../src/content/essays/kubernetes/k8s-theory-informer.md) | Batch 05 검수 완료 |
| 13 | [k8s-theory-reconcile](../../src/content/essays/kubernetes/k8s-theory-reconcile.md) | Batch 06 검수 완료 |
| 14 | [k8s-theory-api-extension-points](../../src/content/essays/kubernetes/k8s-theory-api-extension-points.md) | Batch 06 검수 완료 |
| 15 | [k8s-theory-api-priority-fairness](../../src/content/essays/kubernetes/k8s-theory-api-priority-fairness.md) | Batch 06 검수 완료 |
| 16 | [k8s-theory-serialization-version-conversion](../../src/content/essays/kubernetes/k8s-theory-serialization-version-conversion.md) | Batch 07 검수 완료 |
| 17 | [k8s-theory-certificate-signing-delegation](../../src/content/essays/kubernetes/k8s-theory-certificate-signing-delegation.md) | Batch 07 검수 완료 |
| 18 | [k8s-theory-kubelet-access](../../src/content/essays/kubernetes/k8s-theory-kubelet-access.md) | Batch 07 검수 완료 |
| 19 | [k8s-theory-version-emulation-rollback](../../src/content/essays/kubernetes/k8s-theory-version-emulation-rollback.md) | Batch 08 검수 완료 |
| 20 | [k8s-theory-control-plane-high-availability](../../src/content/essays/kubernetes/k8s-theory-control-plane-high-availability.md) | Batch 08 검수 완료 |
| 21 | [k8s-theory-storage-transformations](../../src/content/essays/kubernetes/k8s-theory-storage-transformations.md) | Batch 01 검수 완료 |
| 22 | [k8s-theory-event-compression](../../src/content/essays/kubernetes/k8s-theory-event-compression.md) | Batch 08 검수 완료 |
| 23 | [k8s-theory-distributed-tracing](../../src/content/essays/kubernetes/k8s-theory-distributed-tracing.md) | Batch 09 검수 완료 |

## k8s-theory-node

| 순서 | 글 | 상태 |
|---|---|---|
| 1 | [k8s-theory-scheduling-binding-cycles](../../src/content/essays/kubernetes/k8s-theory-scheduling-binding-cycles.md) | Batch 09 검수 완료 |
| 2 | [k8s-theory-scheduling-constraints](../../src/content/essays/kubernetes/k8s-theory-scheduling-constraints.md) | Batch 09 검수 완료 |
| 3 | [k8s-theory-preemption-pdb](../../src/content/essays/kubernetes/k8s-theory-preemption-pdb.md) | Batch 10 검수 완료 |
| 4 | [k8s-theory-kubelet-pod-lifecycle](../../src/content/essays/kubernetes/k8s-theory-kubelet-pod-lifecycle.md) | Batch 10 검수 완료 |
| 5 | [k8s-theory-qos-cgroups](../../src/content/essays/kubernetes/k8s-theory-qos-cgroups.md) | Batch 10 검수 완료 |
| 6 | [k8s-theory-eviction-oom](../../src/content/essays/kubernetes/k8s-theory-eviction-oom.md) | Batch 11 검수 완료 |
| 7 | [k8s-theory-node-observability-sources](../../src/content/essays/kubernetes/k8s-theory-node-observability-sources.md) | Batch 01 검수 완료 |
| 8 | [k8s-theory-workload-rollout-revisions](../../src/content/essays/kubernetes/k8s-theory-workload-rollout-revisions.md) | Batch 11 검수 완료 |
| 9 | [k8s-theory-job-cronjob-completion](../../src/content/essays/kubernetes/k8s-theory-job-cronjob-completion.md) | Batch 11 검수 완료 |
| 10 | [k8s-theory-node-heartbeat-taint-eviction](../../src/content/essays/kubernetes/k8s-theory-node-heartbeat-taint-eviction.md) | Batch 12 검수 완료 |
| 11 | [k8s-theory-configmap-secret-delivery](../../src/content/essays/kubernetes/k8s-theory-configmap-secret-delivery.md) | Batch 12 검수 완료 |
| 12 | [k8s-theory-cri-oci-boundary](../../src/content/essays/kubernetes/k8s-theory-cri-oci-boundary.md) | Batch 12 검수 완료 |
| 13 | [k8s-theory-device-resource-allocation](../../src/content/essays/kubernetes/k8s-theory-device-resource-allocation.md) | Batch 13 검수 완료 |
| 14 | [k8s-theory-runtime-isolation](../../src/content/essays/kubernetes/k8s-theory-runtime-isolation.md) | Batch 13 검수 완료 |
| 15 | [k8s-theory-resource-accounting-scoring](../../src/content/essays/kubernetes/k8s-theory-resource-accounting-scoring.md) | Batch 13 검수 완료 |
| 16 | [k8s-theory-node-swap](../../src/content/essays/kubernetes/k8s-theory-node-swap.md) | Batch 14 검수 완료 |
| 17 | [k8s-theory-container-log-files](../../src/content/essays/kubernetes/k8s-theory-container-log-files.md) | Batch 14 검수 완료 |
| 18 | [k8s-theory-hpa-scale-subresource](../../src/content/essays/kubernetes/k8s-theory-hpa-scale-subresource.md) | Batch 14 검수 완료 |
| 19 | [k8s-theory-ephemeral-containers](../../src/content/essays/kubernetes/k8s-theory-ephemeral-containers.md) | Batch 15 검수 완료 |

## k8s-theory-network

| 순서 | 글 | 상태 |
|---|---|---|
| 1 | [k8s-theory-cni-contract](../../src/content/essays/kubernetes/k8s-theory-cni-contract.md) | Batch 01 검수 완료 |
| 2 | [k8s-theory-pod-sandbox-pause](../../src/content/essays/kubernetes/k8s-theory-pod-sandbox-pause.md) | Batch 15 검수 완료 |
| 3 | [k8s-theory-overlay-native-routing](../../src/content/essays/kubernetes/k8s-theory-overlay-native-routing.md) | Batch 15 검수 완료 |
| 4 | [k8s-theory-service-kube-proxy](../../src/content/essays/kubernetes/k8s-theory-service-kube-proxy.md) | Batch 16 검수 완료 |
| 5 | [k8s-theory-dns-ndots](../../src/content/essays/kubernetes/k8s-theory-dns-ndots.md) | Batch 16 검수 완료 |
| 6 | [k8s-theory-ingress-gateway-api](../../src/content/essays/kubernetes/k8s-theory-ingress-gateway-api.md) | Batch 16 검수 완료 |
| 7 | [k8s-theory-network-policy](../../src/content/essays/kubernetes/k8s-theory-network-policy.md) | Batch 17 검수 완료 |
| 8 | [k8s-theory-admin-network-policy](../../src/content/essays/kubernetes/k8s-theory-admin-network-policy.md) | Batch 17 검수 완료 |
| 9 | [k8s-theory-cloud-controller-boundary](../../src/content/essays/kubernetes/k8s-theory-cloud-controller-boundary.md) | Batch 17 검수 완료 |
| 10 | [k8s-theory-traffic-locality-dual-stack](../../src/content/essays/kubernetes/k8s-theory-traffic-locality-dual-stack.md) | Batch 18 검수 완료 |
| 11 | [k8s-theory-service-cidr-ip-address](../../src/content/essays/kubernetes/k8s-theory-service-cidr-ip-address.md) | Batch 18 검수 완료 |

## k8s-theory-storage

| 순서 | 글 | 상태 |
|---|---|---|
| 1 | [k8s-theory-pvc-storageclass-binding](../../src/content/essays/kubernetes/k8s-theory-pvc-storageclass-binding.md) | Batch 18 검수 완료 |
| 2 | [k8s-theory-csi-architecture](../../src/content/essays/kubernetes/k8s-theory-csi-architecture.md) | Batch 19 검수 완료 |
| 3 | [k8s-theory-volume-attach-stage-publish](../../src/content/essays/kubernetes/k8s-theory-volume-attach-stage-publish.md) | Batch 01 검수 완료 |
| 4 | [k8s-theory-statefulset-volume-lifecycle](../../src/content/essays/kubernetes/k8s-theory-statefulset-volume-lifecycle.md) | Batch 19 검수 완료 |
| 5 | [k8s-theory-volume-expansion-snapshots-ephemeral](../../src/content/essays/kubernetes/k8s-theory-volume-expansion-snapshots-ephemeral.md) | Batch 19 검수 완료 |
| 6 | [k8s-theory-volume-attachment-limits](../../src/content/essays/kubernetes/k8s-theory-volume-attachment-limits.md) | Batch 20 검수 완료 |
| 7 | [k8s-theory-storage-capacity-scheduling](../../src/content/essays/kubernetes/k8s-theory-storage-capacity-scheduling.md) | Batch 20 검수 완료 |

## k8s-theory-extension

| 순서 | 글 | 상태 |
|---|---|---|
| 1 | [k8s-theory-crd-schema-pruning](../../src/content/essays/kubernetes/k8s-theory-crd-schema-pruning.md) | Batch 20 검수 완료 |
| 2 | [k8s-theory-crd-version-conversion](../../src/content/essays/kubernetes/k8s-theory-crd-version-conversion.md) | Batch 21 검수 완료 |
| 3 | [k8s-theory-controller-runtime-reconcile](../../src/content/essays/kubernetes/k8s-theory-controller-runtime-reconcile.md) | Batch 21 검수 완료 |
| 4 | [k8s-theory-policy-layers](../../src/content/essays/kubernetes/k8s-theory-policy-layers.md) | Batch 21 검수 완료 |
| 5 | [k8s-theory-aggregated-api-server](../../src/content/essays/kubernetes/k8s-theory-aggregated-api-server.md) | Batch 22 검수 완료 |
| 6 | [k8s-theory-extension-failure-boundaries](../../src/content/essays/kubernetes/k8s-theory-extension-failure-boundaries.md) | Batch 01 검수 완료 |

## k8s-theory-kernel

| 순서 | 글 | 상태 |
|---|---|---|
| 1 | [k8s-theory-cgroup-v2-cpu-quota](../../src/content/essays/kubernetes/k8s-theory-cgroup-v2-cpu-quota.md) | Batch 01 검수 완료 |
| 2 | [k8s-theory-netfilter-conntrack](../../src/content/essays/kubernetes/k8s-theory-netfilter-conntrack.md) | Batch 22 검수 완료 |
| 3 | [k8s-theory-mount-bind-mount](../../src/content/essays/kubernetes/k8s-theory-mount-bind-mount.md) | Batch 22 검수 완료 |
| 4 | [k8s-theory-page-cache-reclaim-oom](../../src/content/essays/kubernetes/k8s-theory-page-cache-reclaim-oom.md) | Batch 23 검수 완료 |
| 5 | [k8s-theory-namespace-lifetime](../../src/content/essays/kubernetes/k8s-theory-namespace-lifetime.md) | Batch 23 검수 완료 |
