---
date: 2026-02-28
category: troubleshoot
project: Goti-server
tags: [opentelemetry, spring-boot, dependency-management, classnotfound, docker, ec2]
---

# OTel SDK 버전 충돌로 Spring Boot 기동 실패 (ComponentLoader ClassNotFoundException)

## Context
- Goti-server Issue #43: OTel 관측성 통합 후 첫 EC2 배포
- Spring Boot 3.5.10 + `opentelemetry-instrumentation-bom:2.25.0`
- EC2에서 goti-server 컨테이너가 `restart: unless-stopped` 정책으로 무한 재시작

## Issue

```
Caused by: java.lang.NoClassDefFoundError: io/opentelemetry/common/ComponentLoader
  at java.base/java.lang.Class.getDeclaredMethods0(Native Method)
  ...
Caused by: java.lang.ClassNotFoundException: io.opentelemetry.common.ComponentLoader
  at java.base/java.net.URLClassLoader.findClass(Unknown Source)
  at org.springframework.boot.loader.launch.LaunchedClassLoader.loadClass(LaunchedClassLoader.java:91)
```

EC2에서 `docker ps` 확인 시 goti-server만 `Up 4 seconds (health: starting)` — 크래시 루프 상태.
다른 서비스(postgres, redis, monitoring 스택)는 모두 healthy.

## Action

### 가설 1: OTel BOM 버전 자체 문제 → 결과: 아님
- `opentelemetry-instrumentation-bom:2.25.0`의 POM 확인
- 내부적으로 `opentelemetry-bom:1.59.0` (SDK)을 의존 → 정상 조합

### 가설 2: Spring Boot dependency-management 플러그인이 SDK 버전 덮어쓰기 → **적중**
- `./gradlew :api:dependencies --configuration runtimeClasspath` 실행
- `opentelemetry-sdk-extension-autoconfigure:1.59.0 -> 1.49.0` 다운그레이드 확인
- Spring Boot 3.5.x가 OTel SDK를 자체 관리 버전(~1.49.0)으로 강제

### 근본 원인 (Root Cause)
`io.spring.dependency-management` 플러그인(1.1.7)이 Spring Boot BOM의 OTel 버전을 우선 적용.

| 구성요소 | 요구 버전 | 실제 해소 버전 | 결과 |
|---------|----------|--------------|------|
| `opentelemetry-spring-boot-starter` 2.25.0 | SDK 1.59.0 | SDK 1.49.0 | `ComponentLoader` 클래스 없음 |

`ComponentLoader` 인터페이스는 SDK 1.55.0+ 에서 도입됨. 1.49.0에는 존재하지 않음.

**중요**: Gradle에서 `implementation platform('io.opentelemetry:opentelemetry-bom:1.59.0')` 선언은 `io.spring.dependency-management` 플러그인의 버전 관리를 오버라이드하지 **못한다**. `dependencyManagement` 블록의 `mavenBom`으로 선언해야 함.

### 적용한 수정

`api/build.gradle` — `platform()` → `dependencyManagement` 블록으로 변경:

```gradle
// Before (동작 안 함 — spring dependency-management가 무시)
dependencies {
    implementation platform('io.opentelemetry:opentelemetry-bom:1.59.0')
    implementation platform('io.opentelemetry.instrumentation:opentelemetry-instrumentation-bom:2.25.0')
    implementation 'io.opentelemetry.instrumentation:opentelemetry-spring-boot-starter'
}

// After (정상 동작 — spring dependency-management보다 우선)
dependencyManagement {
    imports {
        mavenBom 'io.opentelemetry:opentelemetry-bom:1.59.0'
        mavenBom 'io.opentelemetry.instrumentation:opentelemetry-instrumentation-bom:2.25.0'
    }
}
dependencies {
    implementation 'io.opentelemetry.instrumentation:opentelemetry-spring-boot-starter'
}
```

## Result
- `./gradlew :api:dependencies` — 모든 OTel SDK 아티팩트가 1.59.0으로 통일 확인
- `./gradlew :api:bootJar` — BUILD SUCCESSFUL
- EC2 재배포는 미완료 (commit/push 대기)

### 재발 방지책
- `scripts/validate-deploy.sh` 생성 — 배포 전 설정 정합성 자동 검증
- OTel 버전 업그레이드 시 반드시 `./gradlew :api:dependencies | grep opentelemetry` 로 다운그레이드 여부 확인
- **교훈**: Spring Boot + OTel 조합에서 `io.spring.dependency-management` 사용 시 `platform()` 대신 반드시 `dependencyManagement { imports { mavenBom } }` 사용

## Related Files
- `Goti-server/api/build.gradle` — dependencyManagement 블록 추가
