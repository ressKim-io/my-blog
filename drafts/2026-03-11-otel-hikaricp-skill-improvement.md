# OTel HikariCP 스킬 보강

- **날짜**: 2026-03-11
- **타입**: meta (스킬 개선)
- **관련 트러블슈팅**: `2026-03-09-hikaricp-otel-beanpostprocessor.md`

## 배경

Goti-server에서 HikariCP OTel 메트릭 미수집 트러블슈팅 후,
해결 과정에서 발견한 패턴이 기존 스킬에 충분히 반영되지 않아 보강.

## 수정 파일

### 1. `observability-otel-optimization.md`

**변경**: BPP 섹션 6줄 → ~60줄 확장

추가 내용:
- **증상 식별**: WARN 로그 패턴 (`Bean 'openTelemetry' ... is not eligible`)
- **3가지 핵심 문제**: static / ObjectProvider / Before vs After — 원인과 해결을 테이블로 정리
- **검증된 코드 예제**: Goti-server에서 실제 동작 확인된 `hikariMetricsPostProcessor`
- **검증 방법**: Prometheus 쿼리
- **Anti-patterns**: 직접 주입, After 사용, @DependsOn 시도

### 2. `observability-otel.md`

**변경 1**: 의존성 섹션 확장
- `opentelemetry-instrumentation-bom` platform 추가
- `opentelemetry-hikaricp-3.0` 의존성 추가

**변경 2**: 버전 레퍼런스 섹션 신규 추가
- OTel Java SDK 1.60.1, Instrumentation BOM 2.25.0 등 2026-03 기준 버전

**변경 3**: Anti-patterns 테이블 2건 추가
- BOM 없이 개별 버전 관리 위험
- alpha artifact 버전 미고정 위험

## 개선 효과

- BPP 초기화 순서 문제를 **증상→원인→해결→검증** 흐름으로 안내 가능
- HikariCP 수동 계측 의존성을 별도 검색 없이 참조 가능
- OTel 버전 레퍼런스로 호환성 확인 시간 단축
