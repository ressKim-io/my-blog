---
title: "HikariCP OTel 메트릭이 안 나온다: BeanPostProcessor 초기화 순서 함정"
excerpt: "Spring Boot에서 순수 OTel 계측 전환 후 HikariCP 메트릭이 사라진 원인을 추적했습니다. static 팩토리·ObjectProvider·postProcessBeforeInitialization 세 가지 조합으로 해결한 기록입니다"
type: troubleshooting
category: monitoring
tags:
  - go-ti
  - OpenTelemetry
  - Spring Boot
  - HikariCP
  - BeanPostProcessor
  - Troubleshooting
series:
  name: "goti-spring-otel"
  order: 1
date: "2026-02-02"
---

## 한 줄 요약

> HikariCP OTel 메트릭이 수집되지 않는 문제가 발생했습니다. BeanPostProcessor의 빈 초기화 순서 + DataSource 프록시 래핑이 복합 원인이었고, `static` + `ObjectProvider` + `postProcessBeforeInitialization` 조합으로 해결했습니다

## Impact

- **영향 범위**: HikariCP 커넥션 풀 메트릭 전체
- **증상**: Prometheus에서 `db_client_connections_usage` 등 메트릭 미수집
- **소요 시간**: 약 3시간
- **발생일**: 2026-03-09

---

## 🔥 상황: Prometheus에서 HikariCP 메트릭이 비어 있다

### 배경

Goti-server(Spring Boot 3.5.10)에서 Micrometer 브릿지(`opentelemetry-micrometer-1.5`)를 제거하고, 순수 OTel 계측(`opentelemetry-hikaricp-3.0`)으로 전환했습니다.

`HikariOtelConfig`에서 `BeanPostProcessor`를 만들어 `HikariDataSource`에 `MetricsTrackerFactory`를 설정하는 구조입니다.

### 에러 메시지

서버를 올리니 WARN 로그가 대량으로 쏟아졌습니다:

```
Bean 'openTelemetry' of type [SpringOpenTelemetrySdk] is not eligible for getting processed by all BeanPostProcessors.
Is this bean getting eagerly injected/applied to a currently created BeanPostProcessor [hikariMetricsPostProcessor]?
```

Prometheus 쿼리 결과는 텅 비어 있었습니다:

```json
{"status":"success","data":{"resultType":"vector","result":[]}}
```

우리가 심어둔 `"OTel HikariCP metrics attached"` INFO 로그도 전혀 출력되지 않았습니다.

---

## 🤔 원인: 2가지가 복합적으로 작용했다

### 가설 1: BeanPostProcessor가 OTel 빈을 조기 초기화시킨다

`@Configuration` 클래스의 non-static `@Bean` 메서드에서 `OpenTelemetry`를 직접 주입받아 `BeanPostProcessor`를 반환하고 있었습니다.

이것이 왜 문제일까요?

Spring은 `BeanPostProcessor`를 매우 이른 시점에 초기화합니다.
non-static 메서드라면 `@Configuration` 클래스 자체를 먼저 인스턴스화해야 합니다.
이때 `OpenTelemetry` 빈도 함께 끌려 올라옵니다.

결과적으로 OTel 관련 빈들이 **다른 BeanPostProcessor의 처리를 받지 못하는** 상태가 됩니다.
WARN 로그가 바로 이 상황을 알려주고 있었습니다.

### 가설 2: DataSource 프록시 래핑으로 타입 체크 실패

OTel의 `DataSourcePostProcessor`는 `postProcessAfterInitialization`에서 `HikariDataSource`를 `OpenTelemetryDataSource`로 래핑합니다.

우리 BeanPostProcessor도 `postProcessAfterInitialization`을 사용하고 있었습니다.
문제는 OTel의 BPP가 먼저 실행되면, 우리 BPP가 받는 빈은 이미 프록시로 래핑된 상태라는 것입니다

1. OTel `DataSourcePostProcessor` (After)가 `HikariDataSource`를 `OpenTelemetryDataSource`로 래핑
2. 우리 BPP (After)가 호출되지만 `bean instanceof HikariDataSource`가 **false** → 아무것도 안 함

INFO 로그도, WARN 로그도 찍히지 않은 이유가 이것이었습니다.
`instanceof` 체크 자체를 통과하지 못했기 때문입니다.

### 근본 원인 정리

| # | 원인 | 영향 |
|---|------|------|
| 1 | non-static `@Bean` → OTel 빈 조기 초기화 | OTel 빈이 다른 BPP 처리를 받지 못함 |
| 2 | `postProcessAfterInitialization` → 프록시 래핑 이후 실행 | `instanceof HikariDataSource` 실패 |

두 문제가 동시에 발생하면서 메트릭 설정 코드가 아예 실행되지 않은 것입니다.

---

## ✅ 해결: 3가지 변경으로 완전히 해결

### 1. `static` 팩토리 메서드

`@Configuration` 클래스의 조기 인스턴스화를 방지합니다.
Spring 공식 문서에서도 `BeanPostProcessor`를 반환하는 `@Bean` 메서드는 `static`으로 선언하라고 권장합니다.

### 2. `ObjectProvider<OpenTelemetry>`

`OpenTelemetry` 빈을 직접 주입받지 않고, `ObjectProvider`로 감싸서 **지연 로딩**합니다.
실제로 `getIfAvailable()`을 호출하는 시점에 빈을 가져오기 때문에, 초기화 순서 문제가 사라집니다.

이 패턴은 Spring Boot의 `MeterRegistryPostProcessor`에서도 동일하게 사용하고 있습니다.

### 3. `postProcessBeforeInitialization`

`After` 대신 `Before`를 사용하면, OTel의 `DataSourcePostProcessor`가 프록시로 래핑하기 **전에** 원본 `HikariDataSource`에 접근할 수 있습니다.

### 최종 코드

```java
@Bean
static BeanPostProcessor hikariMetricsPostProcessor(ObjectProvider<OpenTelemetry> openTelemetryProvider) {
    return new BeanPostProcessor() {
        @Override
        public Object postProcessBeforeInitialization(Object bean, String beanName) {
            if (bean instanceof HikariDataSource ds) {
                OpenTelemetry openTelemetry = openTelemetryProvider.getIfAvailable();
                if (openTelemetry != null) {
                    HikariTelemetry telemetry = HikariTelemetry.create(openTelemetry);
                    ds.setMetricsTrackerFactory(telemetry.createMetricsTrackerFactory());
                }
            }
            return bean;
        }
    };
}
```

세 가지 변경 포인트를 정리하면:

1. **`static`** → `@Configuration` 클래스 조기 초기화 방지
2. **`ObjectProvider<OpenTelemetry>`** → 지연 로딩으로 빈 순서 문제 해결
3. **`postProcessBeforeInitialization`** → 프록시 래핑 전 원본 빈에 접근

---

## 검증

수정 후 서버를 올리니 기다리던 INFO 로그가 출력됐습니다:

```
INFO  c.g.c.observability.HikariOtelConfig : OTel HikariCP metrics attached to dataSource
```

Prometheus에서도 메트릭이 정상적으로 수집되고 있었습니다:

```
db_client_connections_usage{state="used"} = 0
db_client_connections_usage{state="idle"} = 10
db_client_connections_max = 10
```

WARN 로그도 완전히 사라졌습니다.

---

## 📚 배운 점

### BeanPostProcessor에서 다른 빈 주입 시 필수 패턴

`BeanPostProcessor`는 Spring 컨테이너에서 가장 먼저 초기화되는 빈 중 하나입니다.
여기서 다른 빈을 직접 주입받으면 그 빈도 조기 초기화 체인에 끌려 들어갑니다.

이 문제를 피하려면 반드시 **`static` + `ObjectProvider`** 패턴을 사용해야 합니다.

### Before vs After — 프록시 래핑을 고려하라

`postProcessAfterInitialization`은 다른 BPP가 프록시로 래핑한 후에 실행될 수 있습니다.
원본 빈의 타입을 체크해야 하는 경우, `postProcessBeforeInitialization`을 사용하는 것이 안전합니다.

### 참고 문서

- [Spring Container Extension Points](https://docs.spring.io/spring-framework/reference/core/beans/factory-extension.html)
- [OpenTelemetry HikariCP Instrumentation](https://github.com/open-telemetry/opentelemetry-java-instrumentation/tree/main/instrumentation/hikaricp-3.0/library)
