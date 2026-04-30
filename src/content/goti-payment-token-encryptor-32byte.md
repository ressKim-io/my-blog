---
title: "AES-256 Secret Key 31바이트 — 눈에 띄지 않는 1바이트 버그"
excerpt: "EKS 롤링 업데이트 후 payment POC Pod만 CrashLoopBackOff가 지속된 원인은 SSM Parameter에 수동 등록된 31바이트 Secret Key였습니다. 32바이트 정확히 맞추는 1바이트 차이가 Spring Boot 기동을 막았습니다."
type: troubleshooting
category: kubernetes
tags:
  - go-ti
  - Security
  - Encryption
  - Payment
  - Troubleshooting
date: "2026-02-16"
---

## 한 줄 요약

> EKS 롤링 업데이트 후 payment POC Pod만 CrashLoopBackOff가 지속되었고, 원인은 SSM Parameter Store에 수동 등록된 `QUEUE_TOKEN_SECRET_KEY`가 32바이트가 아니라 31바이트였다는 것이었습니다.

---

## 🔥 문제: payment POC Pod만 CrashLoopBackOff가 풀리지 않았습니다

### 기대 동작

EKS 롤링 업데이트 후 `goti` 네임스페이스의 모든 워크로드가 `Ready=true`로 복구되어야 합니다.

실제로 대부분의 서비스는 Pod 재생성 후 정상 기동했고, 네임스페이스 전체가 Ready 상태로 수렴하는 것이 자연스러운 결과입니다.

### 발견한 문제

복구 과정에서 유독 `goti-payment-sungjeon-prod`(payment 서비스 POC B 브랜치 배포본)만 `CrashLoopBackOff`가 지속되었습니다.

Pod 로그를 확인하면 Spring Boot 기동 초기 단계에서 다음 예외가 발생하고 있었습니다.

```text
Caused by: java.lang.IllegalArgumentException: AES-256 Secret Key는 반드시 32바이트여야 합니다.
    at com.goti.global.utils.TokenEncryptor.<init>(TokenEncryptor.java:37)
```

`TokenEncryptor` Bean을 생성하는 단계에서 예외가 던져지며 `ApplicationContext` 초기화가 실패합니다. 그 결과 앱은 부팅 자체를 완료하지 못하고 재시작을 반복하는 루프에 빠져 있었습니다.

문제 범위를 먼저 좁혔습니다.

- `deploy/prod` 브랜치에는 `TokenEncryptor` 클래스가 존재하지 않았습니다.
- 해당 클래스는 payment 서비스 담당자(POC B)의 두 POC 브랜치(`poc/queue-waiting-sungjeon`, `poc/queue-sungjeon-loadtest`)에만 있었습니다.
- 따라서 일반 `payment-prod`를 비롯한 다른 서비스는 영향을 받지 않았습니다.

즉, 대기열 POC B(Kafka 기반 구현)를 위해 추가된 토큰 암호화 컴포넌트가 POC 브랜치에서만 활성화되었고, 이 브랜치에 필요한 환경 값이 올바르게 준비되지 않았다는 의미였습니다.

---

## 🤔 원인: SSM Parameter Store에 수동으로 넣은 값이 정확히 1바이트 부족했습니다

`TokenEncryptor`는 기동 시점에 주입되는 `queue.token.secret-key` 값이 AES-256 키 길이(32바이트)인지 검증합니다. 이 검증은 방어적으로 작성된 안전 장치로, 잘못된 키 길이가 배포되면 즉시 기동을 막는 역할을 합니다.

해당 프로퍼티는 SSM Parameter Store → Kubernetes Secret → 환경 변수 `QUEUE_TOKEN_SECRET_KEY` 순으로 흘러 Pod 안에서 읽힙니다. 그래서 기동 시 읽히는 값이 32바이트가 아니면 검증이 실패하며 앱이 올라오지 않습니다.

SSM 값을 확인해 보니 실제로 등록되어 있던 문자열은 다음과 같았습니다.

```text
goti-prod-2026-queue-token-32ch    # 실제 길이: 31바이트
```

문자열 끝이 `32ch`로 끝나 "32 characters"를 의도한 것처럼 보이지만, 실제 바이트 수를 세어 보면 31바이트입니다. 사람이 직접 값을 입력할 때 흔히 발생하는 오프바이원(off-by-one) 실수였습니다.

왜 이런 상황이 만들어졌는지 이어서 확인했습니다.

- 이 키는 POC 전용으로 급하게 추가되었고, **Terraform으로 관리되지 않았습니다**.
- SSM 콘솔에서 담당자가 수동 등록한 값이 그대로 배포 파이프라인을 타고 Secret으로 내려왔습니다.
- 두 POC 브랜치가 동일한 SSM 경로를 공유하고 있었기 때문에, 한 값이 틀리면 두 배포가 모두 같은 방식으로 실패합니다.

정리하면 원인은 단순합니다. **32바이트여야 할 대칭키가 31바이트였고**, 그 1바이트 차이 때문에 `TokenEncryptor`의 길이 검증이 실패해 Bean 생성이 불가능했으며, 그 결과 Spring Boot 컨텍스트 초기화 자체가 중단되었습니다.

---

## ✅ 해결: 정확히 32바이트 문자열로 교체하고 Secret을 재생성했습니다

수정은 다음 순서로 진행했습니다.

1. SSM Parameter Store에서 `QUEUE_TOKEN_SECRET_KEY` 값을 32바이트 문자열로 교체했습니다.

```text
goti-prod-2026-queue-token-32chr   # 실제 길이: 32바이트
```

"ch" 뒤에 `r` 한 글자를 붙여 정확히 32바이트를 맞춘 값입니다.

2. Kubernetes Secret을 삭제하고 Deployment를 재시작해 새 값이 Pod에 주입되도록 강제했습니다.

```bash
kubectl delete secret goti-payment-sungjeon-prod-secrets -n goti
kubectl rollout restart deploy goti-payment-sungjeon-prod -n goti
```

Secret을 먼저 지운 이유는, 동일한 환경 변수 이름이 이미 캐시된 상태로 Pod에 마운트될 가능성을 없애기 위해서입니다. 배포 도구가 SSM → Secret 동기화를 다시 수행하게 되어 새 32바이트 값이 깔끔하게 반영됩니다.

재기동 후 결과는 다음과 같았습니다.

- Pod가 정상 기동했고, HikariPool의 DB 커넥션과 Redisson 클라이언트 초기화 로그가 확인했습니다.
- `goti` 네임스페이스가 `15/15` Ready 상태로 수렴했습니다.
- 기존에 발급된 토큰은 키 변경으로 모두 무효화되었지만, POC 환경이라 사용자 영향은 없었습니다.

---

## 📚 배운 점

- **대칭키 길이는 "글자 수"가 아니라 "바이트 수"로 검증해야 합니다.** 사람은 "32ch"라는 접미사를 보고 32바이트라고 착각하기 쉽지만, 실제 문자열 길이와 바이트 수는 별개입니다. 저장 시점과 사용 시점 모두에서 바이트 수를 다시 세는 습관이 필요합니다.
- **수동 등록 Secret은 버그의 온상이 됩니다.** SSM Parameter Store에 사람이 직접 타이핑한 값은 오탈자가 들어가도 검증할 수단이 없습니다. 가능하다면 Terraform이나 별도 스크립트로 "길이가 정확히 32바이트"를 강제 검증한 뒤 등록해야 합니다.
- **방어적 검증은 반드시 필요합니다.** `TokenEncryptor`가 생성자에서 길이를 검사하지 않았다면, 잘못된 키로 암호화된 토큰이 프로덕션에 새어 나갔을 것입니다. Bean 생성 단계에서 실패하는 편이 운영 관점에서는 훨씬 안전합니다.
- **POC 브랜치 한정 이슈를 조기에 식별하려면 "공통 vs POC" 코드 경로를 분리된 구성으로 보여줄 필요가 있습니다.** 이번처럼 POC 브랜치에만 존재하는 클래스 때문에 발생한 장애는, 전체 서비스 장애로 오인되기 쉬우므로 CI/CD 메타데이터나 Helm values로 영향 범위를 빠르게 식별할 수 있게 만드는 것이 좋습니다.
- **1바이트 차이가 서비스 전체를 막을 수 있습니다.** 작은 상수값 하나가 전체 Bean 그래프 초기화를 실패시키는 구조는 드물지 않습니다. 크리티컬한 값(암호화 키, 토큰 서명 시크릿 등)은 단위 테스트에서라도 길이/형식을 한 번 더 확인해 두는 것이 투자 대비 효과가 큽니다.
