---
title: "OTel HikariCP 스킬 보강 — BPP 6줄이 60줄이 된 이유"
excerpt: "HikariCP OTel 메트릭 미수집 트러블슈팅에서 발견한 BeanPostProcessor 초기화 순서 패턴을, 증상 → 원인 → 해결 → 검증 구조로 observability-otel 스킬 2개에 반영했습니다."
category: monitoring
tags:
  - go-ti
  - Meta
  - OpenTelemetry
  - HikariCP
  - Spring-Boot
  - Skill
series:
  name: "goti-meta"
  order: 5
date: "2026-03-11"
---

## 한 줄 요약

> go-ti 서버에서 HikariCP OTel 메트릭이 수집되지 않는 트러블을 해결했지만, 그 과정에서 발견한 `BeanPostProcessor` 초기화 순서 패턴이 기존 스킬에 충분히 반영되어 있지 않았습니다. `observability-otel-optimization.md`의 BPP 섹션을 6줄에서 ~60줄로 확장하고 `observability-otel.md`에 버전 레퍼런스와 Anti-Patterns 2건을 추가했습니다

---

## 🔥 문제: 트러블은 풀었지만 스킬에는 핵심 패턴이 빠져 있었다

HikariCP OTel 메트릭 미수집 트러블슈팅(`2026-03-09-hikaricp-otel-beanpostprocessor.md`)을 해결한 뒤 스킬을 점검했습니다
기존 `observability-otel-optimization.md`의 `BeanPostProcessor` 섹션은 **6줄**에 불과했고, 다음 항목들이 빠져 있었습니다

- BPP 미작동 시 나타나는 **WARN 로그 패턴**
- 세 가지 핵심 실수 유형(`static`, `ObjectProvider`, `Before` vs `After`)의 원인·해결 매핑
- HikariCP 수동 계측 의존성(`opentelemetry-hikaricp-3.0`, `opentelemetry-instrumentation-bom`)
- 검증용 Prometheus 쿼리

같은 문제가 다음에 또 나와도, 스킬 6줄로는 Claude가 "BPP 관련이다"까지만 판단하고 구체적 수정 방향을 제시하기 어려웠습니다

---

## 🤔 원인: 스킬이 "개념"에만 머물러 있었다

기존 BPP 섹션은 "`BeanPostProcessor`는 Spring Bean 초기화 훅이다" 수준이었습니다
OTel 계측에서 자주 부딪히는 세 가지 패턴이 스킬에 없었습니다

- **`static` 필드에 OpenTelemetry 주입 시도** → 인스턴스 생성 시점에 아직 OTel Bean이 없어 null
- **`ObjectProvider` 없이 직접 주입** → BPP 자체가 OTel Bean보다 먼저 초기화되어 실패
- **`postProcessAfterInitialization`에서 처리** → HikariDataSource는 `Before` 훅에서만 metric 등록이 정상적으로 잡힘

이 세 패턴은 시행착오로 배워야 했는데, 스킬에 들어가 있지 않았습니다

---

## ✅ 해결: 스킬 파일 2개 보강

### `observability-otel-optimization.md` — BPP 섹션 6줄 → ~60줄

네 가지 블록을 추가했습니다

1. **증상 식별 — WARN 로그 패턴**

```text
Bean 'openTelemetry' of type [...] is not eligible for getting processed by all BeanPostProcessors
```

이 WARN이 뜨면 BPP 순서 문제일 가능성이 높습니다. 스킬 상단에 증상 패턴을 넣어 검색성을 높였습니다

2. **3가지 핵심 문제 — 원인·해결 테이블**

| 문제 | 원인 | 해결 |
|------|------|------|
| `static` 필드 주입 | 클래스 로딩 시점에 OTel Bean 미존재 | 인스턴스 필드 + 생성자 주입 |
| 직접 주입 | BPP가 OTel Bean보다 먼저 초기화 | `ObjectProvider<OpenTelemetry>` 사용 |
| `After` 훅 사용 | HikariDataSource 초기화 완료 후엔 metric 등록 훅 미작동 | `Before` 훅에서 metric 등록 |

3. **검증된 코드 예제 — `hikariMetricsPostProcessor`**

go-ti 서버에서 실제로 동작 확인된 Bean 정의를 그대로 넣었습니다

```java
@Bean
public static BeanPostProcessor hikariMetricsPostProcessor(
        ObjectProvider<OpenTelemetry> openTelemetryProvider) {
    return new BeanPostProcessor() {
        @Override
        public Object postProcessBeforeInitialization(Object bean, String beanName) {
            if (bean instanceof HikariDataSource ds) {
                OpenTelemetry otel = openTelemetryProvider.getIfAvailable();
                if (otel != null) {
                    HikariTelemetry.create(otel).registerMetrics(ds);
                }
            }
            return bean;
        }
    };
}
```

핵심 포인트는 세 가지입니다

- `static` Bean 메서드로 선언해 BPP를 일찍 등록합니다
- `ObjectProvider`로 지연 조회해 OTel Bean 부재 상황을 null-safe 처리합니다
- `postProcessBeforeInitialization`에서 metric을 등록합니다

4. **검증 방법과 Anti-Patterns**

Prometheus 쿼리 `hikaricp_connections_active{service_namespace="go-ti"}`로 메트릭이 실제 나오는지 확인합니다
Anti-Patterns로는 직접 주입, `After` 사용, `@DependsOn`으로 순서를 강제하는 시도를 기록했습니다

### `observability-otel.md` — 의존성 + 버전 레퍼런스

**의존성 섹션 확장:**

- `opentelemetry-instrumentation-bom` platform 추가
- `opentelemetry-hikaricp-3.0` 의존성 명시

**버전 레퍼런스 섹션 신규 추가:**

2026-03 기준으로 OTel Java SDK 1.60.1, Instrumentation BOM 2.25.0을 기록했습니다
다음 세션에서 버전 호환성을 재확인할 필요 없이 바로 참조할 수 있습니다

**Anti-Patterns 2건 추가:**

- BOM 없이 개별 버전 관리 → 의존성 간 버전 드리프트 위험
- alpha artifact 버전 미고정 → 빌드 재현성 붕괴 위험

---

## 📚 배운 점

- **"증상 → 원인 → 해결 → 검증"의 4단 구조가 스킬 가독성을 크게 높입니다.** 추후 Claude가 같은 증상을 만나면 흐름대로 내려가면서 답을 찾을 수 있습니다
- **동작 확인된 코드는 반드시 스킬에 박아둡니다.** 일반 지식으로 해결하려 하면 BPP `static`/`Before`/`ObjectProvider` 같은 트리플 조건을 한 번에 맞추지 못합니다
- **버전 레퍼런스는 "작성일 기준"으로 명시합니다.** 2026-03 기준이라고 박아두면, 미래 세션에서 "버전 오래됐을 수 있음"을 인지하고 재검증을 트리거합니다
- **Anti-Patterns는 구체 사례와 함께 기록합니다.** "`@DependsOn`으로 순서 강제 시도"처럼 실제 시도했다가 실패한 접근을 남기면, 다음에 같은 우회를 반복하지 않게 됩니다
