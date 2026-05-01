---
title: "JWT issuer의 Source of Truth를 K8s IaC로 일원화 (ADR)"
excerpt: "prod-gcp /queue 전수 401 장애의 근본 원인은, 같은 개념인 JWT issuer가 Goti-go와 Goti-k8s 양쪽에 하드코딩되어 drift된 것이었습니다. K8s values의 env를 유일한 SoT로 승격하고, Go 서비스는 env가 주입되지 않으면 fail-fast하는 구조로 바꿨습니다"
type: troubleshooting
category: istio
tags:
  - go-ti
  - Architecture Decision Record
  - JWT
  - Istio
  - Configuration
  - viper
  - adr
series:
  name: "goti-auth"
  order: 2
date: "2026-04-17"
---

## 한 줄 요약

> prod-gcp에서 JWT가 필요한 모든 API가 401을 반환하는 장애가 발생했습니다. JWT의 `iss`가 `"goti"`로 발급됐는데 Istio `RequestAuthentication`은 `"goti-user-service"`로 구성되어 매칭 실패. 같은 개념이 **두 레포·두 레이어**에 중복 정의되어 drift된 것이 근본 원인이었습니다. K8s values를 유일한 SoT로 승격하고, Go 서비스는 env 미주입 시 fail-fast하는 구조로 변경했습니다

---

## 🔥 배경: 같은 개념이 두 곳에 정의되어 drift됐다

프로덕션 GCP 클러스터에서 `/queue` 진입 및 기타 JWT 보호 API가 전수 401을 반환하는 장애가 발생했습니다
Envoy 응답 헤더에 `www-authenticate: Bearer ... error="invalid_token"` + 본문 `Jwt issuer is not configured`가 찍혔습니다

### drift의 실체

| 레이어 | 값 | 위치 |
|--------|----|----|
| Goti-go 기본값 | `goti` | `pkg/config/config.go:269` (`SetDefault`) |
| Goti-go 파일 설정 | `goti` | `configs/{user,payment,stadium}.yaml` (중복, dead 포함) |
| Goti-go runtime env | `goti-user-service` (K8s에서 주입 중) | — |
| Goti-k8s `RequestAuthentication` | `goti-user-service` | `environments/prod*/goti-*/values.yaml` (12개) |

viper의 설정 우선순위(`Set > Flag > Env > Config > Default`)에 의해 `configs/user.yaml`의 하드코딩이 K8s env를 덮어썼습니다
토큰이 `iss: "goti"`로 발급되어 Istio `RequestAuthentication`(`issuer: "goti-user-service"`)와 매칭되지 않아 401이 발생했습니다

---

## 🤔 원인 분석 — 3층 구조

| 층위 | 문제 |
|-----|-----|
| L1 (표면) | JWT `iss` ≠ Istio `RequestAuth` `issuer` → 401 |
| L2 (중간) | `pkg/config/config.go`의 default가 `"goti"` + `configs/{user,payment,stadium}.yaml`에 `issuer: "goti"` 중복. `configs/{queue,ticketing,resale}`에는 필드 자체가 없어 default 상속 |
| L3 (근본) | **issuer 값에 대한 SoT가 없음.** Goti-go와 Goti-k8s가 서로 다른 값을 보유하며 drift 불가피 |

L1만 수정하면 다음에 누군가 `configs/user.yaml`을 수정했을 때 또 같은 일이 벌어집니다
L3 근본 원인인 "SoT 부재"를 해결해야 drift가 원천 차단됩니다

---

## 🧭 선택지 비교

### 고려한 옵션

| 옵션 | 아이디어 | 평가 |
|------|---------|------|
| A. K8s values 12개를 `"goti"`로 일괄 변경 (hotfix) | 5분 내 401 해소 | **기각** — 의미 퇴보 + drift 유지 |
| B. Goti-go configs를 `"goti-user-service"`로 변경 | Go 서비스 6개 재빌드 | 기각 — 여전히 두 곳에 동일 값 반복 |
| **C. issuer 값을 K8s IaC 한 곳에서만 정의** | Go는 env 주입만, 미주입 시 fail-fast | **채택** |

### 기각 이유

**A 탈락**: 빠르게 401은 해소되지만 의미적으로 퇴보합니다
- `goti`는 브랜드명에 가깝고, 토큰 발급 주체가 여러 서비스로 확장될 때(`guardrail`, `queue-gate` 등) 구분이 불가능합니다
- 무엇보다 drift를 없애지 못합니다. SoT가 여전히 두 곳(Goti-go + Goti-k8s)에 존재합니다

**B 탈락**: Goti-go 재빌드만 필요하고 값 의미도 보존되지만, 여전히 `configs/*.yaml`과 K8s values 두 곳에 같은 값을 중복 유지합니다. **drift 잠재 원인이 사라지지 않습니다.**

### 결정 기준

1. **단일 진실원(SoT) 확보** — 값 변경이 한 곳에서만 이뤄지도록. (1순위)
2. **사일런트 폴백 방지** — env 미주입 시 startup 자체를 거부해 drift 재발 차단
3. **기존 Istio `RequestAuthentication` 구조 유지** — 동일 values 파일 내에서 env와 CR이 같은 값을 공유

Option C만이 세 축을 모두 만족합니다

---

## ✅ 결정: Option C 채택

**issuer 값을 K8s IaC 한 곳에서만 정의하고, Go 서비스는 env 주입만 읽습니다.**

- **SoT**: `environments/*/goti-user/values.yaml`의 `env[].USER_JWT_ISSUER.value`
- **값**: `goti-user-service`
- Istio `RequestAuthentication`의 issuer도 같은 values 파일 내에 병기되어 동일 값을 공유합니다. 후속 작업으로 chart template 내부에서 한 값을 양쪽에 참조하도록 리팩토링합니다
- Goti-go는 이 env를 viper로 읽고, 비어 있으면 startup 시 fatal로 종료합니다(`NewJwtProvider` 내 validation)

### 구현 체크리스트

- [x] `pkg/config/config.go:269` default를 `""`로 변경, 주석으로 사유 명시
- [x] `internal/user/service/jwt_provider.go:NewJwtProvider` fail-fast 추가
- [x] `configs/user.yaml`의 `issuer` 필드 제거, 주석만 남김
- [x] `configs/payment.yaml`, `configs/stadium.yaml`의 dead `jwt.issuer` 블록 제거
- [x] `environments/prod-gcp/goti-user/values.yaml`에 `USER_JWT_ISSUER` env 추가
- [x] ArgoCD sync 후 `/queue` 재접속 검증
- [ ] 후속: chart template에서 `env.USER_JWT_ISSUER`와 `requestAuthentication.issuer`를 동일 value 참조로 통합 (Phase 2 리팩토링)
- [ ] 후속: dev 환경 Go 전환 시 `USER_JWT_ISSUER` env 주입 반영

---

## Result

- 프로덕션 401 해소
- issuer 값을 바꾸려면 K8s values 한 곳만 수정하면 됩니다. Goti-go는 env를 신뢰하므로 drift 발생이 불가능합니다
- user 서비스는 issuer 미주입 시 **시작 자체를 거부**합니다. 사일런트 폴백이 없습니다

### 롤백

Goti-go `977130c` revert + Goti-k8s `f41b5ba` revert로 원복 가능합니다
롤백 시 기존 `"goti"` 발급 상태로 복귀하므로 모든 JWT API가 재차 401이 됨에 주의합니다

---

## 📚 배운 점

- **"같은 개념을 두 곳에 정의"한 순간 drift는 시간문제입니다.** 한 레포 안에서 중복은 PR 리뷰에서 잡히지만, 두 레포(예: 앱 + IaC)를 넘나드는 중복은 리뷰에서도 잡히지 않습니다. SoT를 명시적으로 한 곳에 둬야 합니다
- **viper 우선순위를 기억합니다.** `Set > Flag > Env > Config > Default`. configs 파일에 값이 있으면 env 주입은 무시됩니다. env로 주입하고 싶다면 configs에서 반드시 필드를 제거해야 합니다
- **hotfix와 근본 해결을 구분합니다.** Option A(K8s values 전부 `"goti"`로 변경)는 5분이면 끝나지만 drift 구조는 그대로 남습니다. 근본 해결을 위해서는 "어디가 SoT인가"를 먼저 결정하는 것이 필요합니다
- **fail-fast는 drift를 원천 차단합니다.** env가 비어 있을 때 silent fallback으로 default를 쓰면 같은 드리프트가 재발합니다. startup 자체를 거부하면 배포 단계에서 바로 drift가 드러나 prod까지 가지 못합니다
