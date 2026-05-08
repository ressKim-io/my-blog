---
title: "OTel SDK 버전 충돌로 Spring Boot 기동 실패"
excerpt: "Spring Boot dependency-management 플러그인이 OTel SDK 버전을 다운그레이드해서 ClassNotFoundException이 발생한 트러블슈팅"
category: monitoring
tags:
  - go-ti
  - OpenTelemetry
  - Spring Boot
  - Gradle
  - Troubleshooting
  - Docker
series:
  name: "goti-otel-prometheus"
  order: 1
date: "2026-02-28"
---

## 🎯 한 줄 요약

> Spring Boot의 `io.spring.dependency-management` 플러그인이 OTel SDK 버전을 강제 다운그레이드해서 `ClassNotFoundException`이 발생했습니다. `platform()` 대신 `dependencyManagement` 블록을 써야 합니다

## 📊 Impact

- **영향 범위**: goti-server EC2 배포 완전 실패 (컨테이너 무한 재시작)
- **소요 시간**: 약 3시간
- **발생일**: 2026-02-28

---

## 🔥 상황

Goti-server에 OTel 관측성을 통합하고 첫 EC2 배포를 진행했습니다.
Spring Boot 3.5.10에 `opentelemetry-instrumentation-bom:2.25.0`을 추가한 상태였습니다.

EC2에서 `docker ps`를 확인하니 goti-server만 이상했습니다.

```bash
$ docker ps
CONTAINER ID   IMAGE              STATUS                             NAMES
abc123...      goti-server:latest Up 4 seconds (health: starting)    goti-server
def456...      postgres:16        Up 2 hours (healthy)               goti-postgres
ghi789...      redis:7            Up 2 hours (healthy)               goti-redis
```

다른 서비스(PostgreSQL, Redis, 모니터링 스택)는 모두 healthy인데, goti-server만 `restart: unless-stopped` 정책으로 무한 재시작하고 있었습니다.

컨테이너 로그를 확인해봤습니다.

```
Caused by: java.lang.NoClassDefFoundError: io/opentelemetry/common/ComponentLoader
  at java.base/java.lang.Class.getDeclaredMethods0(Native Method)
  ...
Caused by: java.lang.ClassNotFoundException: io.opentelemetry.common.ComponentLoader
  at java.base/java.net.URLClassLoader.findClass(Unknown Source)
  at org.springframework.boot.loader.launch.LaunchedClassLoader.loadClass(LaunchedClassLoader.java:91)
```

`ComponentLoader`라는 클래스를 못 찾겠다는 에러입니다.
로컬에서는 정상 빌드되었는데, EC2에서만 크래시가 발생하는 상황이었습니다.

---

## 🤔 원인

### 가설 1: OTel BOM 버전 자체가 문제다

`opentelemetry-instrumentation-bom:2.25.0`의 POM을 확인했습니다.
내부적으로 `opentelemetry-bom:1.59.0` (SDK)을 의존하고 있었습니다.

이 조합 자체는 정상입니다. **기각**.

### 가설 2: Spring Boot가 SDK 버전을 덮어쓴다

Gradle 의존성 트리를 확인해봤습니다.

```bash
$ ./gradlew :api:dependencies --configuration runtimeClasspath | grep opentelemetry-sdk
opentelemetry-sdk-extension-autoconfigure:1.59.0 -> 1.49.0
```

1.59.0을 선언했는데 **1.49.0으로 다운그레이드**되고 있었습니다.

Spring Boot 3.5.x가 OTel SDK를 자체 관리 버전(~1.49.0)으로 강제하고 있었습니다.

### 근본 원인

`io.spring.dependency-management` 플러그인(1.1.7)이 Spring Boot BOM의 OTel 버전을 우선 적용한 것이 원인이었습니다.

| 구성요소 | 요구 버전 | 실제 해소 버전 | 결과 |
|---------|----------|--------------|------|
| `opentelemetry-spring-boot-starter` 2.25.0 | SDK 1.59.0 | SDK 1.49.0 | `ComponentLoader` 없음 |

`ComponentLoader` 인터페이스는 SDK 1.55.0+에서 도입되었습니다.
1.49.0에는 이 클래스가 존재하지 않습니다.

여기서 중요한 점이 있습니다.

Gradle에서 `implementation platform()`으로 BOM을 선언하면, `io.spring.dependency-management` 플러그인의 버전 관리를 오버라이드하지 **못합니다**.
`dependencyManagement` 블록의 `mavenBom`으로 선언해야 Spring Boot BOM보다 우선순위를 가집니다.

---

## ✅ 해결

`api/build.gradle`을 수정했습니다.

**Before** (동작 안 함):

```gradle
dependencies {
    implementation platform('io.opentelemetry:opentelemetry-bom:1.59.0')
    implementation platform('io.opentelemetry.instrumentation:opentelemetry-instrumentation-bom:2.25.0')
    implementation 'io.opentelemetry.instrumentation:opentelemetry-spring-boot-starter'
}
```

`platform()`은 Gradle 네이티브 BOM 지원 기능입니다.
하지만 `io.spring.dependency-management` 플러그인이 활성화된 프로젝트에서는 이 선언이 무시됩니다.

**After** (정상 동작):

```gradle
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

`dependencyManagement` 블록으로 선언하면 Spring Boot BOM보다 우선 적용됩니다.

수정 후 의존성 트리를 다시 확인했습니다.

```bash
$ ./gradlew :api:dependencies --configuration runtimeClasspath | grep opentelemetry-sdk
opentelemetry-sdk-extension-autoconfigure:1.59.0
```

모든 OTel SDK 아티팩트가 1.59.0으로 통일된 걸 확인했습니다.
빌드도 정상 통과했습니다.

```bash
$ ./gradlew :api:bootJar
BUILD SUCCESSFUL in 12s
```

---

## 📚 배운 점

### platform() vs dependencyManagement 블록

Spring Boot 프로젝트에서 외부 BOM의 우선순위를 높이려면 반드시 `dependencyManagement` 블록을 사용해야 합니다.

| 선언 방식 | Spring dependency-management 플러그인과 관계 |
|-----------|---------------------------------------------|
| `implementation platform()` | 플러그인이 무시함 |
| `dependencyManagement { imports { mavenBom } }` | 플러그인이 우선 적용함 |

이것이 Spring Boot + OTel 조합에서 가장 흔한 함정입니다.

### 재발 방지

OTel 버전을 업그레이드할 때마다 아래 명령어로 다운그레이드 여부를 반드시 확인해야 합니다.

```bash
$ ./gradlew :api:dependencies --configuration runtimeClasspath | grep opentelemetry
```

버전 뒤에 `->` 화살표가 보이면 다운그레이드가 발생한 것입니다.
이걸 놓치면 EC2에서 컨테이너 크래시 루프를 겪게 됩니다.
