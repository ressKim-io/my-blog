# ADR 0015 — JWT issuer 의 Source of Truth 를 K8s IaC 로 일원화

- 상태: Accepted
- 결정일: 2026-04-17
- 관련 문서: `docs/dev-logs/2026-04-17-jwt-issuer-401-root-fix.md`
- 영향 레포: Goti-go, Goti-k8s

## 컨텍스트

프로덕션 GCP 클러스터에서 /queue 진입 및 기타 JWT 보호 API 가 전수 401 을 반환하는 장애가 발생했다. Envoy 응답 헤더에 `www-authenticate: Bearer ... error="invalid_token"` + 본문 `Jwt issuer is not configured` 가 찍혔다.

원인을 추적한 결과 동일 개념인 JWT 의 issuer 값이 서로 다른 레포·서로 다른 레이어에 두 번 정의되어 있었고, 두 값이 drift 된 상태에서 그 어느 쪽도 SoT 역할을 하지 못하고 있었다.

| 레이어 | 값 | 파일 |
|---|---|---|
| Goti-go 기본값 | `goti` | `pkg/config/config.go:269` (`SetDefault`) |
| Goti-go 파일 설정 | `goti` | `configs/{user,payment,stadium}.yaml` (중복, dead 포함) |
| Goti-go runtime env | (K8s values 에 이미 `goti-user-service` 주입 중) | — |
| Goti-k8s RequestAuthentication | `goti-user-service` | `environments/prod*/goti-*/values.yaml` (12개) |

viper 의 설정 우선순위(Set > Flag > Env > **Config** > Default)에 의해 `configs/user.yaml` 의 하드코딩이 K8s env 를 덮어썼고, 토큰은 `iss: "goti"` 로 발급되어 Istio RequestAuthentication(`issuer: "goti-user-service"`) 과 매칭되지 않아 401 이 발생했다.

## 고려한 대안

### A. K8s values 12개 를 `"goti"` 로 일괄 변경 (hotfix)
- 5 분 내 401 해소 가능.
- 하지만 의미적으로 퇴보한다. `goti` 는 브랜드 명에 가깝고, 토큰 발급 주체가 여러 서비스로 확장될 때 `guardrail`, `queue-gate` 등 미래 발급자와 구분할 수 없다.
- drift 를 없애지 못한다. SoT 가 여전히 두 곳(Goti-go + Goti-k8s)에 존재.

### B. Goti-go configs 를 `"goti-user-service"` 로 변경
- Go 서비스 6개 재빌드 필요.
- 여전히 두 곳(configs + K8s values)에 동일 값 반복 → drift 잠재 유지.

### C. (채택) issuer 값을 K8s IaC 한 곳에서만 정의 — Go 는 env 주입만
- Goti-go 는 `jwt.issuer` default 를 제거하고 주입이 없으면 fail-fast.
- `configs/*.yaml` 에서 `issuer:` 필드를 완전히 제거.
- K8s values 의 `env[].USER_JWT_ISSUER` 값이 유일한 SoT.
- 같은 파일의 `istioPolicy.requestAuthentication.issuer` 와 값이 일치하도록 유지하며, 후속 작업으로 chart template 내부에서 한 값을 양쪽에 참조하도록 리팩토링한다.

## 결정

대안 C 를 채택한다.

- SoT: `environments/*/goti-user/values.yaml` 의 `env[].USER_JWT_ISSUER.value`
- 값: `goti-user-service`
- Istio RequestAuthentication 의 issuer 도 동일 값 유지 (현재 K8s values 에 병기).
- Goti-go 는 이 env 를 viper 로 읽고, 비어있으면 startup 시 fatal 로 종료한다 (`NewJwtProvider` 내 validation).

## 구현 체크리스트

- [x] `pkg/config/config.go:269` default `""` 로 변경, 주석으로 사유 명시
- [x] `internal/user/service/jwt_provider.go:NewJwtProvider` fail-fast 추가
- [x] `configs/user.yaml` `issuer` 필드 제거, 주석만 남김
- [x] `configs/payment.yaml`, `configs/stadium.yaml` 의 dead `jwt.issuer` 블록 제거
- [x] `environments/prod-gcp/goti-user/values.yaml` 에 `USER_JWT_ISSUER` env 추가
- [x] ArgoCD sync 후 /queue 재접속 검증
- [ ] 후속: chart template 에서 `env.USER_JWT_ISSUER` 와 `requestAuthentication.issuer` 를 동일 value 참조로 통합 (Phase 2 리팩토링)
- [ ] 후속: dev 환경 Go 전환 시 `USER_JWT_ISSUER` env 주입 반영

## 결과

- 프로덕션 401 해소.
- issuer 값을 바꾸려면 K8s values 한 곳만 수정하면 된다. Goti-go 는 env 를 신뢰하므로 drift 발생 불가.
- user 서비스는 issuer 미주입 시 시작 자체를 거부한다. 사일런트 폴백 없음.

## 롤백

Goti-go `977130c` revert + Goti-k8s `f41b5ba` revert 로 원복 가능. 롤백 시 기존 "goti" 발급 상태로 복귀하므로 모든 JWT API 재차 401 이 됨에 유의.
