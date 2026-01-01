---
title: "Go 마이크로서비스 EKS 배포 삽질기"
excerpt: "예상치 못한 Go 의존성 지옥 - OAuth2 세션, genproto 충돌, OTel Schema"
category: kubernetes
tags:
  - Go
  - OAuth2
  - OpenTelemetry
  - EKS
  - microservices
date: '2025-12-31'
---

## 🎯 한 줄 요약

> Go 마이크로서비스를 EKS에 배포하면서 예상치 못한 문제들을 만났다. OAuth2 세션 충돌, genproto 모듈 충돌, OTel Schema URL 충돌.

## 📊 Impact

- **영향 범위**: 로그인 간헐적 실패, CI 빌드 실패, 트레이싱 안 됨
- **소요 시간**: 약 8시간
- **발생일**: 2025-12-29 ~ 2025-12-31

---

## 💡 서비스 구성

우리 프로젝트의 Go 마이크로서비스들:

```
┌─────────────────────────────────────────────────────────────┐
│                     Go Microservices                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │user-service│  │board-service│  │chat-service│             │
│  │   (Go)     │  │    (Go)     │  │   (Go)     │             │
│  └────────────┘  └────────────┘  └────────────┘             │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │noti-service│  │storage-svc │  │video-service│            │
│  │   (Go)     │  │    (Go)    │  │    (Go)     │            │
│  └────────────┘  └────────────┘  └────────────┘             │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              auth-service (Java/Spring)                 │ │
│  │                   OAuth2 + Redis                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔥 1. OAuth2 로그인이 간헐적으로 실패한다

### 증상

Google 로그인이 어떨 때는 성공하고, 어떨 때는 실패합니다:

```
성공 → 성공 → 실패 → 성공 → 실패 → 실패 → 성공
```

완전 랜덤입니다.

```bash
$ kubectl logs deploy/auth-service -n wealist-prod | grep -i csrf
CSRF detected - state parameter was required but no state could be found
```

`CSRF detected`. state 파라미터를 찾을 수 없다고 합니다.

### 원인 분석

auth-service Pod가 몇 개인지 확인:

```bash
$ kubectl get pods -n wealist-prod -l app=auth-service
NAME                            READY   STATUS
auth-service-7b9f8c6d4-abc12    1/1     Running
auth-service-7b9f8c6d4-def34    1/1     Running
```

2개입니다.

**OAuth2 흐름을 생각해보면:**

```
1. 사용자 → Google 로그인 요청 → Pod A (state=abc123 메모리에 저장)
2. Google OAuth 완료
3. Google → 콜백 → Pod B (state를 찾을 수 없음 → 실패!)
```

Spring Security OAuth2는 state 파라미터를 **HttpSession(메모리)**에 저장합니다.

```
Pod A: HttpSession{state=abc123}
Pod B: HttpSession{} (state 없음)
```

로드밸런서가 콜백을 다른 Pod로 보내면 state를 찾을 수 없습니다!

### 해결

**Spring Session Redis로 세션 공유**:

**1. build.gradle에 의존성 추가:**

```gradle
implementation 'org.springframework.boot:spring-boot-starter-data-redis'
implementation 'org.springframework.session:spring-session-data-redis'
```

**2. RedisSessionConfig.java 생성:**

```java
package com.example.authservice.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.session.data.redis.config.annotation.web.http.EnableRedisHttpSession;

@Configuration
@EnableRedisHttpSession(maxInactiveIntervalInSeconds = 1800) // 30분
public class RedisSessionConfig {
    // Spring Session이 자동으로 Redis에 세션 저장
}
```

**3. application.yml에 세션 설정:**

```yaml
spring:
  session:
    store-type: redis
    redis:
      namespace: wealist:auth:session
```

### 동작 원리

```
Before (문제):
  Pod A: HttpSession{state=abc123} (메모리)
  Pod B: HttpSession{} (state 없음)
  → 콜백이 Pod B로 가면 실패

After (해결):
  Redis: wealist:auth:session:xyz → {state=abc123}
  Pod A/B 모두 Redis에서 동일 세션 조회
  → 어느 Pod로 가도 state 검증 성공
```

### 검증

```bash
# Google 로그인 10회 연속 테스트
for i in {1..10}; do
  result=$(curl -s -o /dev/null -w '%{http_code}' \
    "https://api.wealist.co.kr/oauth2/authorization/google")
  echo "Test $i: $result"
done
# 모두 302 (정상 리다이렉트)

# Redis에서 세션 키 확인
kubectl exec -it redis-0 -n wealist-prod -- redis-cli KEYS "wealist:auth:session:*"
```

### OAuth2 Multiple Pods 체크리스트

```
[ ] spring-session-data-redis 의존성
[ ] @EnableRedisHttpSession 어노테이션
[ ] Redis 연결 설정 (호스트, 포트)
[ ] 세션 만료 시간 설정
```

### 핵심 포인트

- **다중 Pod 환경에서 세션 기반 인증은 세션 공유가 필수**
- **Spring Session Redis로 간단하게 해결 가능**
- **OAuth2 state 파라미터는 세션에 저장됨**

---

## 🔥 2. Go genproto 모듈 충돌 - CI 빌드 실패

### 증상

board-service CI 빌드가 계속 실패합니다:

```bash
$ go build ./cmd/api
/go/pkg/mod/github.com/grpc-ecosystem/grpc-gateway/v2@v2.23.0/runtime/handler.go:13:2:
ambiguous import: found package google.golang.org/genproto/googleapis/api/httpbody in multiple modules:
    google.golang.org/genproto v0.0.0-20210310155132-4ce2db91004e
    google.golang.org/genproto/googleapis/api v0.0.0-20241104194629-dd2ea8efbc28
```

`ambiguous import`. 같은 패키지가 두 곳에서 발견됩니다.

### 원인 분석

Google은 2021년경 genproto를 분리했습니다:

```
Before (monolithic):
  google.golang.org/genproto (모든 googleapis 포함)

After (분리):
  google.golang.org/genproto/googleapis/api
  google.golang.org/genproto/googleapis/rpc
```

두 버전이 동시에 의존성에 있으면 충돌합니다.

**의존성 체인 추적:**

```bash
$ go mod graph | grep genproto
gopter → goconvey → gopherjs → cobra → viper → crypt → etcd → grpc-gateway v1 → genproto (구버전)
```

```
board-service
  └── gopter (property-based testing)
        └── goconvey
              └── gopherjs
                    └── cobra
                          └── viper
                                └── crypt
                                      └── etcd
                                            └── grpc-gateway v1  ← 범인!
                                                  └── genproto v0.0.0-20200513... (구버전)

동시에:
  └── wealist-advanced-go-pkg
        └── grpc-gateway/v2
              └── genproto/googleapis/api (신버전)
```

### 해결

**1. gopter 의존성 제거 (property test 임시 비활성화):**

```bash
# go.mod에서 gopter 제거
# property test 파일들 이동
mkdir -p internal/service/property_tests_disabled
mv internal/service/*property*.go internal/service/property_tests_disabled/
```

**2. go.mod에 exclude 블록 추가:**

```go
// go.mod
exclude (
    // grpc-gateway v1 제외 (구버전 genproto 의존)
    github.com/grpc-ecosystem/grpc-gateway v1.16.0

    // 구버전 genproto 제외
    google.golang.org/genproto v0.0.0-20210602131652-f16073e35f0c
    google.golang.org/genproto v0.0.0-20210402141018-6c239bbf2bb1
    google.golang.org/genproto v0.0.0-20210319143718-93e7006c17a6
    google.golang.org/genproto v0.0.0-20210310155132-4ce2db91004e
    // ... 더 많은 구버전
)
```

**3. 정리:**

```bash
go mod tidy
go build ./cmd/api
# 성공!
```

### 왜 board-service만 문제였나?

```bash
# 다른 서비스들 확인
for svc in user chat noti storage video; do
  grep -l "gopter" services/$svc-service/go.mod 2>/dev/null || \
    echo "$svc: not using gopter"
done
# 모두 "not using gopter"
```

board-service만 property-based testing을 위해 gopter를 사용했고, 이것이 유일한 grpc-gateway v1 의존 경로였습니다.

### 핵심 포인트

- **Go의 의존성 충돌은 간접 의존성에서 발생하는 경우가 많다**
- **`go mod graph`로 의존성 체인 추적**
- **`exclude` 블록으로 특정 버전 제외 가능**
- **테스트 라이브러리도 의존성 충돌을 일으킬 수 있다**

---

## 🔥 3. OTel Schema URL 충돌 - 트레이싱 실패

### 증상

모든 Go 서비스에서 OTel 초기화 실패:

```bash
$ kubectl logs deploy/user-service -n wealist-prod
{"level":"warn","msg":"Failed to initialize OpenTelemetry, continuing without tracing",
 "error":"conflicting Schema URL: https://opentelemetry.io/schemas/1.26.0 and https://opentelemetry.io/schemas/1.32.0"}
```

Schema URL 충돌. 1.26.0과 1.32.0이 충돌합니다.

### 원인 분석 (3단계)

**1차: semconv 버전 확인**

```go
// 문제 코드
import semconv "go.opentelemetry.io/otel/semconv/v1.27.0"
```

semconv v1.27.0은 Schema 1.26.0/1.27.0을 사용합니다. OTel SDK v1.32.0과 충돌.

```go
// 수정
import semconv "go.opentelemetry.io/otel/semconv/v1.32.0"
```

그런데 여전히 에러!

**2차: GORM 플러그인 확인**

```bash
$ go mod graph | grep "gorm.io/plugin/opentelemetry"
gorm.io/plugin/opentelemetry@v0.1.8 go.opentelemetry.io/otel/sdk@v1.19.0
```

`gorm.io/plugin/opentelemetry v0.1.8`이 OTel SDK v1.19.0 (Schema 1.26.0)을 사용!

```bash
go get gorm.io/plugin/opentelemetry@v0.1.16
```

v0.1.16은 OTel SDK v1.32.0을 사용합니다.

그런데 여전히 에러!

**3차: resource.Merge() 확인**

```go
// 문제 코드
func newResource(cfg *Config) (*resource.Resource, error) {
    return resource.Merge(
        resource.Default(),        // ← 내부 Schema URL
        resource.NewWithAttributes(
            semconv.SchemaURL,     // ← v1.32.0 Schema URL
            // ...
        ),
    )
}
```

`resource.Default()`와 `resource.NewWithAttributes()`가 각각 다른 Schema URL을 가지고 있어서 Merge 시 충돌!

### 최종 해결

`resource.New()`로 직접 생성하여 단일 Schema URL 사용:

```go
func newResource(cfg *Config) (*resource.Resource, error) {
    return resource.New(
        context.Background(),
        resource.WithSchemaURL(semconv.SchemaURL),  // 단일 Schema URL
        resource.WithAttributes(
            semconv.ServiceName(cfg.ServiceName),
            semconv.ServiceVersion(cfg.ServiceVersion),
            semconv.DeploymentEnvironmentName(cfg.Environment),
        ),
        resource.WithTelemetrySDK(),
        resource.WithHost(),
        resource.WithOS(),
        resource.WithProcess(),
    )
}
```

### API 변경 대응 (GORM 플러그인)

v0.1.16에서 `tracing.WithDBName()` 삭제됨:

```go
// Before (v0.1.8)
opts := []tracing.Option{
    tracing.WithDBName(cfg.DBName),
}

// After (v0.1.16)
opts := []tracing.Option{
    tracing.WithAttributes(attribute.String("db.name", cfg.DBName)),
    tracing.WithDBSystem("postgresql"),
}
```

### 버전 호환성 매트릭스

| 패키지 | 이전 버전 | 최종 버전 |
|--------|----------|----------|
| semconv | v1.27.0 | **v1.32.0** |
| OTel SDK | v1.32.0 | v1.32.0 (유지) |
| GORM OTel Plugin | v0.1.8 | **v0.1.16** |

### 핵심 포인트

- **OTel Schema URL은 모든 컴포넌트에서 일치해야 한다**
- **resource.Merge()는 Schema URL 충돌을 일으킬 수 있다**
- **GORM 플러그인 같은 간접 의존성도 OTel 버전을 확인해야 한다**
- **버전 업그레이드 시 API 변경 확인 필수**

---

## 📚 종합 정리

### Go 서비스 EKS 배포 체크리스트

```
[ ] 다중 Pod 환경 세션 공유 (Redis 등)
[ ] 의존성 충돌 확인 (go mod graph)
[ ] OTel SDK 버전 통일
[ ] 간접 의존성의 OTel 버전 확인
[ ] CI 빌드 테스트
```

### 이 경험에서 배운 것들

1. **다중 Pod = 세션 공유 필수** - 메모리 세션은 사용 불가
2. **Go 의존성은 간접 의존성이 문제** - `go mod graph`로 추적
3. **OTel은 버전 통일이 핵심** - Schema URL 충돌 주의
4. **테스트 라이브러리도 의존성 충돌 원인** - gopter 사례

---

## 🤔 스스로에게 던지는 질문

### 1. 다중 Pod 환경에서 세션 관리 전략은?

| 방식 | 장점 | 단점 |
|------|------|------|
| **Redis Session** | 간단, 검증됨 | Redis 의존성 |
| Sticky Session | 설정 간단 | Pod 장애 시 세션 손실 |
| JWT (Stateless) | 확장성 최고 | 토큰 크기, 무효화 어려움 |
| DB Session | Redis 없이 가능 | 느림 |

**권장**: OAuth2는 Redis Session, API 인증은 JWT

### 2. Go 의존성 충돌 디버깅 방법은?

```bash
# 1. 충돌하는 패키지 찾기
go mod graph | grep <package-name>

# 2. 어떤 모듈이 가져오는지 추적
go mod why <package-name>

# 3. 특정 버전 제외
# go.mod에 exclude 블록 추가

# 4. 정리
go mod tidy
```

### 3. OTel SDK 버전 호환성 관리 방법은?

```bash
# 1. 현재 사용 중인 OTel 버전 확인
go list -m all | grep opentelemetry

# 2. 플러그인들의 OTel 버전 확인
go mod graph | grep "otel/sdk"

# 3. 모든 OTel 관련 패키지 버전 통일
go get go.opentelemetry.io/otel@v1.32.0
go get go.opentelemetry.io/otel/sdk@v1.32.0
go get go.opentelemetry.io/otel/trace@v1.32.0
```

### 4. Property-based testing 라이브러리 선택 시 고려사항?

- 의존성 체인 확인 (gopter의 goconvey 문제)
- 활발한 유지보수 여부
- 최신 Go 버전 지원

**대안**: `rapid` (의존성 적음), `testify` (표준적)

---

## 🔗 다음 편 예고

다음 편에서는 **ArgoCD + Helm 실전 문제들**을 다룹니다:
- db-init Job이 생성 안 됨 (PreSync Hook)
- ConfigMap 변경 시 Pod 자동 재시작 안 됨
- metrics-server APIService OutOfSync
- HPA Scale Down 속도 개선

GitOps가 완벽하지 않은 이유를 공유하겠습니다.

---

## 🔗 참고

- [Spring Session Redis](https://spring.io/projects/spring-session-data-redis)
- [Go Modules - exclude directive](https://go.dev/ref/mod#go-mod-file-exclude)
- [OpenTelemetry Go - Resource](https://pkg.go.dev/go.opentelemetry.io/otel/sdk/resource)
- [GORM OpenTelemetry Plugin](https://github.com/go-gorm/opentelemetry)
