---
date: 2026-03-25
category: troubleshoot
project: Goti-k8s
tags: [kafka, networkpolicy, crashloopbackoff, strimzi, k8s-api, egress, kraft]
---

# Kafka CrashLoopBackOff — NetworkPolicy egress 누락으로 K8s API 서버 접근 불가

## Context
Kind dev 환경에서 Kafka 브로커 3개(goti-kafka-combined-0/1/2) 모두 CrashLoopBackOff. 3일 이상 지속(277회 재시작).
Strimzi 0.51 + Kafka 4.2.0 KRaft 모드. kafka namespace에 `default-deny-all` NetworkPolicy(Ingress+Egress 차단) 적용 중.

## Issue

```
io.fabric8.kubernetes.client.KubernetesClientException: Operation: [get]  for kind: [Secret]  with name: [goti-kafka-combined-0]  in namespace: [kafka]  failed.
Caused by: java.io.IOException: HTTP connect timed out
Caused by: java.net.http.HttpConnectTimeoutException: HTTP connect timed out
Exception in thread "main" org.apache.kafka.common.config.ConfigException: Failed to retrieve Secret goti-kafka-combined-0 from Kubernetes namespace kafka
```

Kafka 브로커 시작 시 `KubernetesSecretConfigProvider`가 K8s Secret을 읽으려 하지만, K8s API 서버(172.20.0.6:6443)에 접근하지 못해 2분 타임아웃 후 crash.

재현 조건: `default-deny-all` Egress 차단 + Kafka 브로커 Pod에 API 서버 egress 규칙 없음

## Action

1. 가설: OOM → `lastState.terminated.reason` 확인 → `Error` (exit code 1), OOMKilled 아님
2. 가설: Secret 미존재 → `kubectl get secret goti-kafka-combined-0 -n kafka` → 존재 확인
3. 가설: RBAC 권한 부족 → Role/RoleBinding 확인 → `goti-kafka-kafka-role` 정상
4. 가설: NetworkPolicy 차단 → **확인됨**

**근본 원인 (Root Cause)**:
- `kafka-netpol.yaml`의 `allow-kafka-internal` 정책에서 Kafka 브로커 Pod의 egress를 같은 클러스터 Pod + DNS만 허용
- K8s API 서버로의 egress가 빠져있음
- Strimzi operator(`allow-strimzi-operator`)에는 API 서버 egress가 있었지만, 브로커 Pod 자체에는 없었음
- Strimzi `KubernetesSecretConfigProvider`가 브로커 시작 시 Secret을 읽는 동작은 브로커 Pod 내부에서 직접 실행됨

**적용 수정**:
- `kafka-netpol.yaml`의 `allow-kafka-internal` egress에 K8s API 서버 접근 규칙 추가:
  ```yaml
  - to:
      - ipBlock:
          cidr: 0.0.0.0/0
          except:
            - 169.254.169.254/32
    ports:
      - port: 443
        protocol: TCP
      - port: 6443
        protocol: TCP
  ```
- 추가로 3개 브로커 Pod 동시 삭제 (`kubectl delete pod`) — BackOff 5분 타이머 리셋 + KRaft quorum 동시 성립

## Result

- 3개 브로커 모두 1/1 Running, KRaft leader 선출 완료 (ISR=[0,1,2])
- entity-operator, kafka-exporter 모두 정상
- **회귀 테스트**: `validate-queries.sh`의 kafka_consumergroup_lag 쿼리로 간접 검증 (consumer group 생성 후)
- **재발 방지**: `kafka-netpol.yaml`에 주석으로 `KubernetesSecretConfigProvider` 의존성 명시

## Related Files
- `Goti-k8s/infrastructure/dev/network-policies/kafka-netpol.yaml` — allow-kafka-internal egress 수정
