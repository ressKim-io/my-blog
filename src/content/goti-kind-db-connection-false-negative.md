---
title: "sh /dev/tcp 함정 — 잘못된 진단 도구가 만든 1.5시간 삽질"
excerpt: "보안 설정 후 DB 연결이 실패한다고 판단했지만, 진단 도구 자체가 잘못됐다. sh에서 /dev/tcp는 지원되지 않아 항상 false negative를 반환하고 있었다"
category: kubernetes
tags:
  - go-ti
  - Kind
  - PostgreSQL
  - NetworkPolicy
  - Debugging
  - OOM
  - Troubleshooting
date: "2026-02-20"
---

## 한 줄 요약

> 7개 가설을 검증하며 1.5시간을 썼는데, 진단 도구가 잘못됐다. `sh -c '/dev/tcp'`는 bash 전용 기능이라 항상 실패를 반환했고, Pod가 죽은 실제 원인은 DB가 아니라 OOMKilled였다.

## Impact

- **영향 범위**: MSA 5서비스 (user, payment, ticketing, resale, stadium)
- **증상**: CrashLoopBackOff, DB 연결 실패 로그
- **소요 시간**: 약 1.5시간 (7개 가설 검증)
- **발생일**: 2026-03-20

---

## 🔥 증상: 보안 설정 후 DB 연결 실패

Istio mTLS STRICT + deny-all AuthorizationPolicy + NetworkPolicy defense-in-depth를 적용한 뒤, 새로 생성된 Pod들이 CrashLoopBackOff에 빠졌습니다.

```
Caused by: org.postgresql.util.PSQLException: The connection attempt failed.
Caused by: java.net.SocketTimeoutException: Connect timed out
```

"보안 설정이 DB 연결을 차단했구나"라고 판단했습니다.

---

## 🤔 가설 7개, 순차 검증

### 가설 1: NetworkPolicy egress에 DB 포트 누락

`allow-goti-egress`에 5432/6379 포트가 없었습니다. ipBlock 규칙을 추가했는데 **여전히 실패**.

### 가설 2: Istio mTLS가 비-mesh DB 연결 차단

`excludeOutboundPorts: "5432,6379"` annotation으로 Envoy sidecar를 우회하도록 설정되어 있었습니다.
istio-proxy 컨테이너에서도 TCP 테스트 실패 → **Istio가 원인이 아님**.

### 가설 3: 호스트 방화벽(UFW) 차단

UFW에 이미 `172.20.0.0/16 → 5432 ALLOW` 규칙이 존재. 추가 규칙을 넣어도 **여전히 실패**.

### 가설 4: PostgreSQL listen_addresses / pg_hba.conf

`listen_addresses = '*'`, `0.0.0.0:5432` 바인딩 확인. pg_hba.conf에도 허용 규칙 존재. **설정 문제 없음**.

### 가설 5: Kind 노드 → 호스트 라우팅

Kind 노드에서 직접 테스트: `docker exec worker bash -c "echo > /dev/tcp/172.20.0.1/5432"` → **성공**.
Kind 노드 레벨은 정상입니다.

### 가설 6: NetworkPolicy 자체가 차단

NetworkPolicy를 **전체 삭제**해도 Pod에서 TCP 테스트 실패. **NetworkPolicy가 원인이 아님 확정**.

### 가설 7 (최종): 진단 도구 자체가 잘못됨

여기서 드디어 깨달았습니다.

모든 이전 테스트에서 이렇게 확인했기 때문입니다:

```bash
sh -c 'cat < /dev/tcp/172.20.0.1/5432'  # 항상 FAIL
```

`/dev/tcp`는 **bash 전용 기능**입니다.
컨테이너의 `sh`는 dash나 busybox라서 `/dev/tcp`를 지원하지 않습니다.
**네트워크와 무관하게 항상 FAIL**을 반환합니다.

```bash
# sh (dash) — 항상 실패 (false negative)
sh -c 'cat < /dev/tcp/172.20.0.1/5432'   → FAIL

# bash — 정상 작동
bash -c 'echo > /dev/tcp/172.20.0.1/5432' → OK
```

가설 5에서 Kind 노드 테스트가 성공한 이유도 설명됩니다 — Kind 노드 이미지에는 bash가 설치되어 있었기 때문입니다.

---

## 🤔 그런데 Pod는 왜 죽은 거야?

TCP 연결이 정상이면 CrashLoopBackOff의 **실제 원인**은 뭘까요?

```bash
$ kubectl describe pod goti-payment-xxx
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
```

**OOMKilled**였습니다.

payment, resale, stadium Pod의 memory limit 512Mi가 OTel Java Agent + Spring Boot 조합에 부족했습니다.
DB 연결 실패 로그는 OOM 직전의 메모리 부족 상태에서 발생한 **증상(symptom)**이었지, 근본 원인(cause)이 아니었습니다.

실제 인과 관계는 다음과 같습니다.

1. 메모리 부족이 시작점입니다.
2. JVM이 불안정해지면서 DB 연결 시도가 타임아웃으로 실패하고 로그에 `PSQLException`이 찍힙니다.
3. 결국 OOMKilled로 컨테이너가 종료됩니다.
4. 재시작이 반복되며 CrashLoopBackOff에 빠집니다.

---

## ✅ 수정

### Memory limit 증가

```yaml
# 256Mi/512Mi → 384Mi/768Mi
resources:
  requests:
    memory: 384Mi
  limits:
    memory: 768Mi
```

OTel Java Agent + Spring Boot 조합은 최소 768Mi limit을 권장합니다.
`MaxRAMPercentage=60.0` 설정으로 JVM이 limit의 60%를 사용하면 768Mi * 0.6 = ~460Mi heap.

### NetworkPolicy ipBlock 규칙 추가 (방어적)

가설 1에서 발견한 5432/6379 포트 누락도 함께 수정했습니다.
현재는 Envoy 경유 경로로 동작하지만, `excludeOutboundPorts` 직접 연결을 위한 안전망입니다.

---

## 📚 배운 점

### 진단 도구부터 검증하라

이번 트러블슈팅에서 가장 큰 실수는 **진단 도구 자체를 검증하지 않은 것**입니다.

`sh /dev/tcp` 테스트가 항상 FAIL을 반환했지만, "네트워크가 문제다"라는 가설에 매몰되어 테스트 도구의 정확성을 의심하지 않았습니다.

잘못된 측정 → 잘못된 가설 → 잘못된 수정 → 시간 낭비.

TCP 연결 테스트는 이렇게 하세요:

```bash
# ❌ sh에서 /dev/tcp 미지원 → false negative
sh -c 'cat < /dev/tcp/HOST/PORT'

# ✅ bash 명시
bash -c 'echo > /dev/tcp/HOST/PORT'

# ✅ 셸 의존성 없는 방법
curl -s --connect-timeout 3 telnet://HOST:PORT
```

### 증상보다 종료 사유를 먼저 확인하라

CrashLoopBackOff를 만나면 로그부터 보기 쉽습니다.
하지만 로그의 에러 메시지는 **증상**일 수 있습니다.

`kubectl describe pod`의 `lastState.terminated.reason`을 **먼저** 확인하세요.
OOMKilled인데 DB 에러 로그만 보고 네트워크를 뒤지면 1.5시간을 날립니다.

### 관련 팁: NetworkPolicy에서 K8s API ClusterIP가 안 되는 이유

이 작업 중에 하나 더 발견한 건데, NetworkPolicy에서 kube-apiserver ClusterIP(10.96.0.1)를 egress 허용해도 동작하지 않습니다.

```yaml
# ❌ 동작 안 함
- to:
    - ipBlock:
        cidr: 10.96.0.1/32
  ports:
    - port: 443

# ✅ DNAT 후 실제 IP 사용
- to:
    - ipBlock:
        cidr: 172.20.0.0/24   # Kind docker network 대역
  ports:
    - port: 6443              # API 서버 실제 포트
```

이유는 **kube-proxy DNAT가 NetworkPolicy 평가보다 먼저 발생**하기 때문입니다.
`10.96.0.1:443`으로 보낸 패킷이 DNAT으로 `172.20.0.6:6443`으로 변환된 뒤 NetworkPolicy가 평가됩니다.
ClusterIP는 이미 사라진 상태라 `ipBlock: 10.96.0.1/32`에 매칭되지 않습니다.

K8s 공식 문서에서도 DNAT과 NetworkPolicy의 순서가 **정의되지 않음(undefined)**이라고 명시하고 있습니다.
