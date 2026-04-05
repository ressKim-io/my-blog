---
date: 2026-04-01
category: troubleshoot
project: Goti-server (payment-sungjeon)
tags: [aes-256, token-encryptor, secret-key, ssm, queue-poc]
---

# payment-sungjeon CrashLoop — QUEUE_TOKEN_SECRET_KEY 31바이트 (32바이트 필요)

## Context
EKS rolling update 후 서비스 복구 과정에서 goti-payment-sungjeon-prod만 CrashLoopBackOff 지속.
성전님 POC 브랜치(`poc/queue-sungjeon-loadtest`)에만 존재하는 `TokenEncryptor` 클래스가 원인.

## Issue

```
Caused by: java.lang.IllegalArgumentException: AES-256 Secret Key는 반드시 32바이트여야 합니다.
    at com.goti.global.utils.TokenEncryptor.<init>(TokenEncryptor.java:37)
```

Spring Boot 기동 시 `TokenEncryptor` Bean 생성 단계에서 실패 → 앱 시작 불가.

재현 조건: `queue.token.secret-key` 프로퍼티가 32바이트가 아닌 값일 때.

## Action

1. SSM 값 확인 → `goti-prod-2026-queue-token-32ch` (31바이트)
2. deploy/prod 브랜치에는 `TokenEncryptor` 없음 → payment-prod 등 다른 서비스는 영향 없음
3. `poc/queue-waiting-sungjeon`, `poc/queue-sungjeon-loadtest` 두 브랜치 모두 동일 코드 확인
4. SSM Parameter Store에서 수동 등록된 값이라 Terraform 미관리

**Root Cause**: SSM에 수동 등록 시 31바이트 문자열 입력 (1바이트 부족).

**수정**: SSM에서 `QUEUE_TOKEN_SECRET_KEY`를 `goti-prod-2026-queue-token-32chr` (32바이트)로 변경.

```bash
kubectl delete secret goti-payment-sungjeon-prod-secrets -n goti
kubectl rollout restart deploy goti-payment-sungjeon-prod -n goti
```

## Result
- payment-sungjeon-prod 정상 기동 확인 (HikariPool 연결 성공, Redisson 시작)
- goti namespace 15/15 전체 ready=true
- 기존 발급 토큰은 키 변경으로 무효화됨 (POC 환경이라 영향 없음)

## Related Files
- `Goti-server/common/src/main/java/com/goti/global/utils/TokenEncryptor.java` (poc/queue-sungjeon-loadtest 브랜치)
