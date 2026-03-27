---
date: 2026-03-23
category: troubleshoot
project: Goti-k8s
tags: [networkpolicy, kube-apiserver, dnat, iptables, ecr-credential-renewer, kind]
---

# NetworkPolicy에서 K8s API 서버 ClusterIP egress가 동작하지 않는 문제

## Context

ecr-credential-renewer CronJob이 `kubectl apply`로 K8s API 서버에 접근할 때,
NetworkPolicy egress에 `ipBlock: 10.96.0.1/32 + port 443`을 추가했지만 차단됨.

## 증상

- ecr-credential-renewer Pod에서 `kubectl apply` 실행 시 API 서버 접속 실패
- NetworkPolicy에 ClusterIP(10.96.0.1/32) egress 허용이 있는데도 동작 안 함

## Root Cause

### DNAT vs NetworkPolicy 평가 순서

Kubernetes 공식 문서에 따르면 NetworkPolicy 평가와 kube-proxy DNAT 중 어느 것이 먼저인지 **정의되지 않음(undefined)**.

> "Cluster ingress and egress mechanisms often require rewriting the source or destination IP of packets. In cases where this happens, it is not defined whether this happens before or after NetworkPolicy processing"

실제 iptables 기반 kube-proxy에서의 netfilter 처리 순서:

```
nat OUTPUT (DNAT 발생) → filter OUTPUT (NetworkPolicy 평가)
```

1. Pod이 `10.96.0.1:443`으로 요청
2. kube-proxy iptables가 목적지를 **실제 API 서버 IP** `172.20.0.6:6443`으로 DNAT
3. NetworkPolicy는 **변환된** `172.20.0.6:6443` 기준으로 평가
4. `ipBlock: 10.96.0.1/32`에 매칭 안 됨 → **차단**

### namespaceSelector도 불가

kube-apiserver는 `hostNetwork: true`로 실행되어 노드 네트워크를 공유.
공식 문서: "hostNetwork Pod는 podSelector/namespaceSelector에서 무시(ignore)된다"
→ CNI가 트래픽을 일반 Pod과 구분 불가 → namespaceSelector 매칭 불가능

## Fix

DNAT 후 실제 목적지 IP(노드 IP)를 ipBlock으로 허용:

```yaml
# Before (동작 안 함)
- to:
    - ipBlock:
        cidr: 10.96.0.1/32
  ports:
    - port: 443
      protocol: TCP

# After (동작함)
- to:
    - ipBlock:
        cidr: 172.20.0.0/24    # Kind docker network 대역
  ports:
    - port: 6443               # API 서버 실제 포트
      protocol: TCP
```

- `172.20.0.0/24`: Kind Docker bridge 대역. `/32` 대신 `/24`로 클러스터 재생성 시 IP 변동 대응
- `6443`: DNAT 후 실제 API 서버 포트 (ClusterIP의 443이 아님)
- 현재 endpoint: `172.20.0.6:6443` (`kubectl get endpoints kubernetes -n default`)

## Prod (EKS) 참고

| CNI | 방법 |
|-----|------|
| Cilium | `CiliumNetworkPolicy`의 `toEntities: [kube-apiserver]` — IP 불필요 |
| Calico / VPC CNI | EKS control plane endpoint IP CIDR + port 443 |

## 검증 방법

```bash
# ArgoCD sync 후
kubectl create job ecr-test --from=cronjob/ecr-credential-renewer -n goti
kubectl logs -n goti job/ecr-test -f
```

## Regression Test

- ecr-credential-renewer CronJob이 정상적으로 Secret 갱신하는지 확인
- 다른 goti namespace Pod의 K8s API 접근이 필요한 경우 동일 패턴 적용

## References

- https://kubernetes.io/docs/concepts/services-networking/network-policies/
- https://github.com/kubernetes/kubernetes/issues/96341
- https://github.com/cilium/cilium/issues/20550

## 변경 파일

- `Goti-k8s/infrastructure/dev/network-policies/goti-netpol.yaml`
