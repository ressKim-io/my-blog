---
title: "JWT issuer 검증 — iss 클레임 매칭과 viper 설정 우선순위 체인"
excerpt: "Istio RequestAuthentication이 JWT iss 클레임을 어떻게 매칭하는지, viper 우선순위 체인이 config drift를 어떻게 일으키는지, 그리고 K8s IaC 단일 SoT로 이를 막는 원리를 설명합니다"
category: istio
tags:
  - go-ti
  - istio
  - jwt
  - viper
  - config-drift
  - RequestAuthentication
  - concept
series:
  name: "goti-deepdive-istio"
  order: 5
date: "2026-04-17"
---

## 한 줄 요약

> JWT issuer 검증은 토큰의 `iss` 클레임과 `RequestAuthentication.issuer` 값을 문자열 비교하는 단순한 구조이지만, 이 값이 여러 레이어에 중복 정의되어 있으면 viper 우선순위 체인에 의해 의도치 않은 값이 선택되고 Istio와 Go 서비스 사이에 config drift가 발생합니다

---

## 🤔 무엇을 푸는 기술인가

JWT(JSON Web Token)는 `iss`(issuer) 클레임으로 **토큰을 발급한 주체**를 명시합니다
검증자는 이 값을 보고 "이 토큰이 내가 신뢰하는 발급자가 만든 것인가"를 판단합니다

서비스 메시에서 이 검증은 두 레이어에 걸쳐 있습니다

- **Go 서비스 레이어**: JWT를 발급할 때 토큰의 `iss` 클레임에 어떤 값을 넣는지 설정 파일로 제어합니다
- **Istio 레이어**: `RequestAuthentication`의 `issuer` 필드에 정의된 값과 토큰 `iss`를 비교합니다

두 레이어의 값이 일치하면 정상, 다르면 Envoy가 즉시 **401 Unauthorized**를 반환합니다
문제는 이 두 값이 서로 다른 레포·서로 다른 설정 레이어에 중복 정의되는 데서 시작합니다

---

## 🔧 동작 원리

### iss 클레임 매칭 — Envoy가 수행하는 단계

Istio JWT 검증의 서명 확인은 `goti-deepdive-istio-jwt-jwks` 글에서 다루었습니다
이 글은 서명 검증 이후 단계, 즉 **issuer 매칭**에 집중합니다

Envoy sidecar는 서명 검증에 성공한 토큰에 대해 추가로 다음을 확인합니다

```text
Payload.iss  ==  RequestAuthentication.jwtRules[].issuer
```

이 비교는 **정확한 문자열 동등 비교**입니다
대소문자를 구분하고, 공백도 구분합니다
`"goti"` ≠ `"Goti"` ≠ `"goti-user-service"` — 어느 하나라도 다르면 Envoy는 요청을 거부합니다

RequestAuthentication 예시는 다음과 같습니다

```yaml
apiVersion: security.istio.io/v1beta1
kind: RequestAuthentication
metadata:
  name: goti-jwt
  namespace: goti
spec:
  jwtRules:
    - issuer: "goti-user-service"
      jwks: '{"keys":[...]}'
```

`issuer` 필드가 매칭 기준이 됩니다
Envoy는 토큰을 받으면 Payload를 디코딩하고 `iss` 클레임이 `"goti-user-service"`와 동일한지 확인합니다
불일치하면 응답 헤더에 `www-authenticate: Bearer realm="...", error="invalid_token"`을 싣고 401을 반환합니다

오류 본문에서 `"Jwt issuer is not configured"`라는 메시지가 나타날 수 있습니다
이 메시지는 "issuer가 아무것도 설정되지 않았다"는 뜻이 아닙니다
"토큰의 iss가 jwtRules에 정의된 어느 issuer와도 일치하지 않는다"는 의미입니다

### viper 우선순위 체인 — 어느 레이어가 어느 값을 덮어쓰는가

Go 서비스가 토큰에 담을 `iss` 값을 어디서 읽는지가 핵심입니다
go-ti의 Go 서비스는 설정 라이브러리로 [viper](https://github.com/spf13/viper)를 사용합니다

viper는 여러 출처에서 설정을 읽어 병합하며, 출처마다 고정된 우선순위가 있습니다

```text
Set()  >  Flag  >  Env  >  Config 파일  >  Default
(최고)                                     (최저)
```

상위 레이어의 값이 존재하면 하위 레이어 값은 무시됩니다
문제는 이 우선순위가 **기대와 반대 방향**으로 작동할 때 발생합니다

go-ti 장애 당시 각 레이어에 정의된 `jwt.issuer` 값은 다음과 같았습니다

| 레이어 | 출처 | 값 |
|---|---|---|
| Set() | 미사용 | — |
| Flag | 미사용 | — |
| **Env** | **K8s values.yaml → Pod env** | **"goti-user-service"** |
| **Config 파일** | **configs/user.yaml** | **"goti"** |
| Default | pkg/config/config.go | "goti" |

이론적으로 Env(3순위)가 Config 파일(4순위)보다 높으므로 `"goti-user-service"`가 선택되어야 합니다
그런데 실제 런타임에서는 `"goti"`가 선택되었습니다

이유는 viper의 `AutomaticEnv()` 호출 방식에 있었습니다
`AutomaticEnv()`는 환경 변수 이름을 `viper.Get()` 키와 자동 매핑하는 기능입니다
그런데 키 이름 변환 규칙(`.` → `_`, 대문자화)이 일치하지 않거나, `SetEnvKeyReplacer`가 설정되지 않으면 viper가 환경 변수를 인식하지 못합니다
`USER_JWT_ISSUER`라는 환경 변수가 주입되어 있어도, viper가 `jwt.issuer` 키와 연결하지 못하면 해당 레이어가 비어있는 것으로 처리됩니다
결과적으로 Config 파일의 `"goti"`가 살아남아 최종값이 됩니다

![viper 설정 우선순위 스택 — jwt.issuer 값이 결정되는 경로|tall](/diagrams/goti-deepdive-jwt-issuer-config-precedence-1.svg)

위 다이어그램은 viper의 5개 우선순위 레이어를 위에서 아래로 나열합니다
초록색 레이어(Env)가 의도된 SoT이지만, 빨간색 레이어(Config 파일)의 하드코딩이 Env를 가려 최종값 `"goti"`가 선택되는 경로를 보여줍니다

핵심은 **레이어 우선순위 자체는 올바르지만 환경 변수 키 매핑이 누락되면 Env 레이어가 투명해진다**는 점입니다
즉, `USER_JWT_ISSUER=goti-user-service`가 Pod에 주입되어 있어도 viper가 이 값을 `jwt.issuer` 키로 읽지 못하면 Config 파일 값이 이긴다는 의미입니다

### 두 레포 정의 → drift 구조

더 근본적인 문제는 issuer 값 자체가 서로 다른 레포에 중복 정의되어 있다는 점입니다

- **Goti-go 레포**: `configs/user.yaml`에 `jwt.issuer: "goti"` 하드코딩
- **Goti-k8s 레포**: `environments/prod*/goti-user/values.yaml` 12개 파일에 `issuer: "goti-user-service"` 정의

두 값이 각자 다른 레포에서 독립적으로 유지되는 구조는 **어느 한 쪽이 변경될 때 다른 쪽에 전파되지 않습니다**
Goti-k8s에서 issuer 값을 `"goti-user-service"`로 마이그레이션했지만, Goti-go의 Config 파일은 여전히 `"goti"`를 가지고 있었습니다

![issuer 값 두 레포 정의 → drift 및 RequestAuthentication 매칭 실패|tall](/diagrams/goti-deepdive-jwt-issuer-config-precedence-2.svg)

위 다이어그램은 장애가 발생한 구조 전체를 보여줍니다
왼쪽 Goti-go 레포에서 `"goti"`로 서명된 토큰이 발급됩니다
오른쪽 Goti-k8s 레포의 `RequestAuthentication`은 `"goti-user-service"`를 기대합니다
두 레포 사이에 drift가 발생한 상태에서 Envoy sidecar에 요청이 도달하면, iss 클레임 비교에서 불일치가 확인되어 전수 401이 반환됩니다

두 레포가 서로 다른 팀 속도·배포 주기로 변경될 때, 공통 값인 issuer를 두 곳에서 각자 관리하면 반드시 이런 drift가 발생합니다
SoT(Source of Truth)가 두 개이면 어느 쪽이 정답인지를 시스템이 알 수 없습니다

### config drift를 막는 두 가지 원칙

drift를 구조적으로 막으려면 두 가지 원칙이 함께 작동해야 합니다

**원칙 1: 값의 정의 지점을 하나로 줄인다**

issuer 값이 K8s values.yaml에서만 정의되면, 다른 레포에서 별도로 유지할 필요가 없습니다
Go 서비스는 `jwt.issuer`를 코드에 적어두지 않고 env 주입만 받습니다
K8s values.yaml 안에서 `env[].USER_JWT_ISSUER.value`와 `istioPolicy.requestAuthentication.issuer`가 같은 파일에 위치하므로, 한 번에 눈으로 확인할 수 있습니다

```yaml
# environments/prod-gcp/goti-user/values.yaml
env:
  - name: USER_JWT_ISSUER
    value: "goti-user-service"

istioPolicy:
  requestAuthentication:
    issuer: "goti-user-service"   # 위 env와 동일 값
```

**원칙 2: 값이 없으면 시작을 거부한다 (fail-fast)**

SoT를 K8s로 단일화해도, env 주입이 누락된 채 Pod가 뜰 수 있습니다
이 경우 Default 값(`""`) 또는 이전 Config 값으로 폴백하면 문제가 런타임에 조용히 나타납니다

fail-fast 검증은 이를 startup 시점에 즉시 드러냅니다

```go
// internal/user/service/jwt_provider.go
func NewJwtProvider(cfg *config.Config) (*JwtProvider, error) {
    issuer := cfg.GetString("jwt.issuer")
    if issuer == "" {
        return nil, fmt.Errorf("jwt.issuer is not set: USER_JWT_ISSUER env required")
    }
    // ...
}
```

Pod가 `USER_JWT_ISSUER` 없이 기동을 시도하면 `NewJwtProvider`에서 즉시 오류를 반환합니다
컨테이너가 CrashLoopBackOff 상태가 되므로, 운영자가 즉시 누락 사실을 인지할 수 있습니다
사일런트 폴백 없이 명시적 실패로 구성 오류를 조기에 발견하는 것이 핵심입니다

---

## 📐 세부 동작과 옵션

### viper 환경 변수 매핑 — 키 변환 규칙

viper가 환경 변수를 설정 키와 연결하려면 키 이름 규칙이 일치해야 합니다
`AutomaticEnv()`는 환경 변수 이름을 자동으로 소문자 변환하고 접두사를 붙이는 방식으로 동작합니다

| viper 설정 키 | 매핑될 환경 변수 이름 (기본 규칙) |
|---|---|
| `jwt.issuer` | `JWT_ISSUER` (`.` → `_`, 대문자) |
| `database.host` | `DATABASE_HOST` |
| `server.port` | `SERVER_PORT` |

`USER_JWT_ISSUER`처럼 접두사(`USER_`)가 붙은 이름은 기본 규칙으로 `jwt.issuer`에 자동 연결되지 않습니다
`SetEnvKeyReplacer`와 `SetEnvPrefix`를 조합하거나, `BindEnv`로 명시 매핑해야 합니다

```go
// 명시 매핑 (권장)
viper.BindEnv("jwt.issuer", "USER_JWT_ISSUER")
```

이 한 줄로 `USER_JWT_ISSUER` 환경 변수가 `jwt.issuer` 키에 연결됩니다
이후 `viper.GetString("jwt.issuer")`는 환경 변수 값을 올바르게 반환합니다

### issuer 값 선택 기준 — 의미론적 고려

issuer 값 자체의 의미도 중요합니다

- `"goti"`: 브랜드 이름에 가깝습니다 — 향후 서비스가 여러 발급자로 분리될 때 발급자를 구분하기 어렵습니다
- `"goti-user-service"`: 발급 주체가 user-service임을 명확히 드러냅니다 — `"guardrail"`, `"queue-gate"` 같은 미래 발급자와도 명확히 구분됩니다

issuer 값에는 **어떤 서비스가 이 토큰을 발급했는가**를 사람이 읽을 수 있는 식별자를 쓰는 것이 좋습니다
이는 권장 사항이지 JWT RFC 표준이 강제하는 형식은 아닙니다

### jwtRules 복수 정의 — 여러 issuer 허용

하나의 `RequestAuthentication`에 `jwtRules`를 복수로 정의하면 복수의 issuer를 모두 허용할 수 있습니다

```yaml
jwtRules:
  - issuer: "goti-user-service"
    jwks: '{"keys":[...]}'
  - issuer: "goti-admin-service"
    jwks: '{"keys":[...]}'
```

이 경우 Envoy는 토큰의 `iss` 클레임을 두 항목과 순서대로 비교하고, 일치하는 항목의 JWKS로 서명을 검증합니다
마이그레이션 과도기에 구 issuer와 신 issuer를 동시에 허용할 때 유용합니다
전환이 완료되면 구 항목을 제거합니다

---

## 🧩 go-ti에서는

프로덕션 GCP 클러스터에서 `/queue` 진입 및 JWT 보호 API 전수 401 장애가 발생했습니다
Envoy 응답 헤더에서 `"Jwt issuer is not configured"` 오류가 확인되었고, 원인 추적 결과 Goti-go configs의 `"goti"`와 Goti-k8s RequestAuthentication의 `"goti-user-service"` 사이에 drift가 발생한 상태였습니다
viper `BindEnv` 누락으로 K8s env 주입이 무시되고 Config 파일 하드코딩이 런타임 issuer를 결정하고 있었습니다

해결 방향은 issuer 값의 SoT를 K8s values.yaml 단일 파일로 일원화하는 것이었습니다
`configs/user.yaml`의 `issuer` 필드를 제거하고, Go의 Default 값도 `""`로 변경했습니다
`NewJwtProvider`에 fail-fast 검증을 추가해 env 미주입 시 컨테이너가 startup에서 즉시 종료되도록 구성했습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [JWT issuer SoT를 K8s IaC로 일원화한 결정](/logs/goti-jwt-issuer-sot-adr)에 정리했습니다

---

## 📚 핵심 정리

- Istio의 issuer 검증은 토큰 `iss` 클레임과 `RequestAuthentication.issuer`를 **정확한 문자열 비교**로 수행합니다 — 대소문자·공백 하나라도 다르면 Envoy가 401을 반환합니다
- viper는 `Set > Flag > Env > Config > Default` 순서로 우선순위를 적용합니다 — Env가 이론적으로 Config보다 높지만, `BindEnv` 없이 `AutomaticEnv()`만 쓰면 키 이름 변환 불일치로 Env 레이어가 무시될 수 있습니다
- issuer 값이 두 레포에 중복 정의되면 어느 한 쪽이 변경될 때 다른 쪽에 전파되지 않아 config drift가 발생합니다 — SoT를 하나의 파일로 제한하는 것이 구조적 해결책입니다
- K8s values.yaml 단일 파일에서 `env[].USER_JWT_ISSUER`와 `requestAuthentication.issuer`를 같이 관리하면 두 값의 일치 여부를 한 번에 확인할 수 있습니다
- fail-fast 검증은 설정 오류를 런타임이 아닌 startup 시점에 드러냅니다. 사일런트 폴백 없이 명시적으로 실패하는 구조가 운영 안전성을 높입니다
