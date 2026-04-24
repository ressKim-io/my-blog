---
title: "Kafka CrashLoopBackOff — NetworkPolicy egress 누락으로 K8s API 접근 불가"
excerpt: "default-deny-all NetworkPolicy 환경에서 Strimzi KubernetesSecretConfigProvider가 K8s API 서버에 접근하지 못해 Kafka 브로커 3개가 277회 재시작한 트러블슈팅"
category: kubernetes
tags:
  - go-ti
  - Kafka
  - NetworkPolicy
  - CrashLoop
  - troubleshooting
series:
  name: "goti-kafka"
  order: 2
date: "2026-03-25"
---

## 한 줄 요약

> Kafka 브로커 NetworkPolicy에 K8s API 서버 egress 규칙이 빠져 있어, 브로커 시작 시 Secret 조회가 2분 타임아웃 후 실패 → CrashLoopBackOff 277회가 3일간 지속됐습니다.

---

## 🔥 문제: 브로커 3개 동시 CrashLoopBackOff

### 환경

- Strimzi 0.51 + Kafka 4.2.0 KRaft 모드
- kafka namespace에 `default-deny-all` NetworkPolicy(Ingress + Egress 전면 차단) 적용 중
- Kind dev 클러스터

### 증상

Kafka 브로커 3개(`goti-kafka-combined-0/1/2`)가 동시에 CrashLoopBackOff 상태로 진입해 3일 이상 지속됐습니다.
재시작 횟수는 총 277회에 달했습니다.

```text
io.fabric8.kubernetes.client.KubernetesClientException: Operation: [get]  for kind: [Secret]  with name: [goti-kafka-combined-0]  in namespace: [kafka]  failed.
Caused by: java.io.IOException: HTTP connect timed out
Caused by: java.net.http.HttpConnectTimeoutException: HTTP connect timed out
Exception in thread "main" org.apache.kafka.common.config.ConfigException: Failed to retrieve Secret goti-kafka-combined-0 from Kubernetes namespace kafka
```

에러 메시지를 보면 K8s Secret 조회 자체가 실패한 것이 아니라, **HTTP connect timed out**으로 K8s API 서버에 아예 연결을 못 하고 있습니다.
약 2분 타임아웃 후 `ConfigException`이 발생하고 브로커 프로세스가 종료됩니다.

---

## 🤔 원인: 브로커 Pod의 API 서버 egress 규칙 누락

### 진단 과정

증상이 OOM처럼 보일 수 있어 단계적으로 가설을 검증했습니다.

1. **OOM 가설**: `lastState.terminated.reason` 확인 → `Error` (exit code 1), OOMKilled 아님
2. **Secret 미존재 가설**: `kubectl get secret goti-kafka-combined-0 -n kafka` 실행 → Secret 존재 확인
3. **RBAC 권한 부족 가설**: Role/RoleBinding(`goti-kafka-kafka-role`) 확인 → 정상
4. **NetworkPolicy 차단 가설**: egress 규칙 검토 → **확인됨**

### 근본 원인

`kafka-netpol.yaml`의 `allow-kafka-internal` 정책이 문제였습니다.
이 정책은 Kafka 브로커 Pod의 egress를 **같은 클러스터 내 Pod + DNS**만 허용하고 있었습니다.

핵심은 `KubernetesSecretConfigProvider`의 동작 방식에 있습니다.
이 ConfigProvider는 Kafka 브로커 시작 시 Secret 값을 읽어 설정에 주입합니다.
그런데 Secret 조회는 Strimzi operator가 대신 해주는 것이 아니라, **브로커 Pod 내부에서 직접 K8s API 서버로 요청**합니다.

Strimzi operator용 정책(`allow-strimzi-operator`)에는 K8s API 서버 egress 규칙이 있었습니다.
하지만 브로커 Pod 자체에는 이 규칙이 없었기 때문에, 브로커가 시작할 때마다 API 서버(172.20.0.6:6443) 접근이 차단됐습니다.

---

## ✅ 해결: 브로커 egress에 API 서버 규칙 추가

### NetworkPolicy 수정

`kafka-netpol.yaml`의 `allow-kafka-internal` egress 섹션에 K8s API 서버 접근 규칙을 추가했습니다.

```yaml
# kafka-netpol.yaml — allow-kafka-internal egress 추가
- to:
    - ipBlock:
        cidr: 0.0.0.0/0
        except:
          - 169.254.169.254/32  # EC2 metadata endpoint 차단 유지
  ports:
    - port: 443
      protocol: TCP
    - port: 6443  # K8s API 서버
      protocol: TCP
```

`169.254.169.254`는 AWS EC2 메타데이터 엔드포인트로, 불필요한 접근을 막기 위해 예외로 유지했습니다.

### 브로커 Pod 재시작

NetworkPolicy를 적용한 뒤 브로커 3개를 동시에 삭제했습니다.

```bash
$ kubectl delete pod goti-kafka-combined-0 goti-kafka-combined-1 goti-kafka-combined-2 -n kafka
```

단순히 설정이 적용되길 기다리지 않고 동시 삭제한 이유는 두 가지입니다.

첫째, CrashLoopBackOff 상태에서는 BackOff 타이머(최대 5분)가 붙어 있어 즉시 재시작되지 않습니다.
삭제하면 타이머가 초기화되어 곧바로 새 Pod로 시작합니다.

둘째, KRaft 모드에서 quorum을 성립하려면 3개 브로커가 거의 동시에 올라와야 합니다.
순차 재시작하면 quorum 조건을 못 맞춰 다시 실패할 수 있습니다.

### 결과 확인

```bash
$ kubectl get pods -n kafka
NAME                          READY   STATUS    RESTARTS   AGE
goti-kafka-combined-0         1/1     Running   0          3m
goti-kafka-combined-1         1/1     Running   0          3m
goti-kafka-combined-2         1/1     Running   0          3m
goti-kafka-entity-operator-*  2/2     Running   0          2m
goti-kafka-kafka-exporter-*   1/1     Running   0          2m
```

3개 브로커가 모두 Running으로 전환됐고, KRaft leader 선출과 ISR=[0,1,2] 구성이 완료됐습니다.
entity-operator와 kafka-exporter도 정상 기동했습니다.

회귀 검증은 `validate-queries.sh`의 `kafka_consumergroup_lag` 쿼리로 진행했습니다.
consumer group을 생성한 뒤 lag 메트릭이 정상 수집되는지 확인했습니다.

---

## 📚 배운 점

- **operator와 브로커 Pod는 별개의 네트워크 주체**: Strimzi operator egress에 K8s API 규칙이 있어도, 브로커 Pod가 API를 직접 호출한다면 브로커 Pod 자체의 egress도 열어줘야 합니다. `KubernetesSecretConfigProvider` 같이 브로커 내부에서 API를 호출하는 컴포넌트가 있으면 특히 주의해야 합니다

- **NetworkPolicy 추가 시 의존 관계를 먼저 파악**: `default-deny-all` 환경에서는 Secret 조회, ConfigMap 조회, API 서버 heartbeat 등 애플리케이션이 k8s 리소스를 직접 읽는 경우를 먼저 확인해야 합니다

- **CrashLoop 디버깅 순서**: OOM → Secret 미존재 → RBAC → NetworkPolicy 순으로 좁혀가는 것이 효율적입니다. 타임아웃 에러는 권한 문제가 아니라 네트워크 차단일 가능성이 높습니다

- **KRaft quorum 재시작은 동시에**: KRaft 모드에서 브로커를 개별로 재시작하면 quorum 조건 불충족으로 재실패할 수 있습니다. CrashLoop 상태의 브로커는 한꺼번에 삭제하는 것이 안전합니다

- **egress 규칙에 의존성 주석 추가**: `kafka-netpol.yaml`에 `KubernetesSecretConfigProvider`가 K8s API 서버 egress를 필요로 한다는 주석을 추가해 재발을 방지했습니다
