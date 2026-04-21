---
date: 2026-03-09
category: troubleshoot
project: Goti-server
tags: [hikaricp, opentelemetry, beanpostprocessor, spring-boot, datasource-proxy, bean-initialization-order]
---

# HikariCP OTel 메트릭 미수집 — BeanPostProcessor 빈 초기화 순서 + DataSource 프록시 문제

## Context
- Goti-server (Spring Boot 3.5.10 + OTel Spring Boot Starter 2.25.0)
- Micrometer 브릿지(`opentelemetry-micrometer-1.5`) 제거 후 순수 OTel 계측(`opentelemetry-hikaricp-3.0`)으로 전환
- `HikariOtelConfig`에서 `BeanPostProcessor`로 `HikariDataSource`에 `MetricsTrackerFactory` 설정

## Issue
Prometheus에서 `db_client_connections_usage` 등 HikariCP 메트릭이 수집되지 않음.

```
# 서버 로그 — OTel 빈 전부 조기 초기화 WARN 대량 발생
Bean 'openTelemetry' of type [SpringOpenTelemetrySdk] is not eligible for getting processed by all BeanPostProcessors.
Is this bean getting eagerly injected/applied to a currently created BeanPostProcessor [hikariMetricsPostProcessor]?

# Prometheus 쿼리 결과
{"status":"success","data":{"resultType":"vector","result":[]}}
```

우리의 INFO 로그 `OTel HikariCP metrics attached`가 전혀 출력되지 않음.

재현 조건: `@Configuration` 클래스의 non-static `@Bean` 메서드에서 `OpenTelemetry`를 직접 주입받아 `BeanPostProcessor`를 반환하면 발생.

## Action

1. 가설 1: `BeanPostProcessor`가 `OpenTelemetry`를 직접 주입 → OTel 관련 빈 조기 초기화 → 결과: WARN 로그로 확인. OTel 빈들이 다른 BPP의 처리를 받지 못함.

2. 가설 2: OTel `DataSourcePostProcessor`가 `postProcessAfterInitialization`에서 `HikariDataSource`를 프록시(`OpenTelemetryDataSource`)로 래핑 → 우리 BPP의 `instanceof HikariDataSource` 실패 → 결과: INFO/WARN 로그 모두 미출력으로 확인. `instanceof` 체크 자체를 통과하지 못함.

**근본 원인 (Root Cause)**
2가지가 복합:
1. non-static `@Bean` 메서드 → `@Configuration` 클래스 인스턴스화 → `OpenTelemetry` 빈 조기 초기화 체인
2. `postProcessAfterInitialization`에서 실행 → OTel의 DataSource 프록시 래핑 이후에 실행되어 원본 `HikariDataSource` 타입 체크 실패

**적용한 수정**
- `static` 팩토리 메서드: `@Configuration` 클래스 조기 초기화 방지 (Spring 공식 권장)
- `ObjectProvider<OpenTelemetry>`: 지연 로딩으로 빈 순서 문제 해결 (Spring Boot `MeterRegistryPostProcessor`와 동일 패턴)
- `postProcessBeforeInitialization`: OTel `DataSourcePostProcessor`의 프록시 래핑(`After`) 전에 원본 빈에 접근

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

## Result
수정 후 서버 로그:
```
INFO  c.g.c.observability.HikariOtelConfig : OTel HikariCP metrics attached to dataSource
```

Prometheus 검증:
```
db_client_connections_usage{state="used"} = 0
db_client_connections_usage{state="idle"} = 10
db_client_connections_max = 10
```

WARN 로그 완전 제거. 모든 HikariCP 메트릭 정상 수집 확인.

**재발 방지책**
- `BeanPostProcessor`에서 다른 빈 주입 시 반드시 `static` + `ObjectProvider` 패턴 사용
- 프록시 래핑 전 원본 빈 접근이 필요하면 `postProcessBeforeInitialization` 사용
- Spring 공식 문서: [Container Extension Points](https://docs.spring.io/spring-framework/reference/core/beans/factory-extension.html)

## Related Files
- `Goti-server/api/src/main/java/com/goti/config/observability/HikariOtelConfig.java`
- `Goti-server/api/build.gradle`
