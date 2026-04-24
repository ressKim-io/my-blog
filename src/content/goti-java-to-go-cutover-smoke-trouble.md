---
title: "Java → Go cutover 첫 스모크 — 46분 안에 만난 5가지 블로커"
excerpt: "6서비스 전체 Go 전환 후 첫 cutover 스모크에서 OAuth 누락·PG DATE 타입 오류·viper 침묵·JSON 필드명 불일치·JWT issuer 불일치가 연쇄 발생했습니다. 모두 계약·설정 누락에서 비롯된 문제였습니다."
category: challenge
tags:
  - go-ti
  - Go
  - Java
  - Migration
  - Cutover
  - Smoke-Test
  - troubleshooting
series:
  name: goti-java-to-go
  order: 2
date: "2026-04-13"
---

## 왜 이 스모크 테스트를 하고 있었는가

go-ti 프로젝트의 핵심 목표 중 하나는 동시 접속 50만을 안정적으로 처리하는 것입니다. 초기 Java 기반 서비스는 JVM 메모리 오버헤드와 콜드스타트 지연이 Kind 5노드 로컬 환경의 리소스 압박을 가중시켰고, 프로덕션 EKS에서도 스케일 여유가 줄어드는 문제가 있었습니다.

전환 근거는 실측 데이터에서 나왔습니다. ticketing-go PoC에서 동일 부하 조건 대비 **메모리 6배 절감**이 확인됐습니다. 이 결과를 기반으로 4a안(ticketing-go 선행)을 기각하고 Step 4b, 즉 user·ticketing·payment·resale·stadium·queue 6서비스 전체를 한 번에 Go로 전환하는 방향을 확정했습니다.

Phase 0~6 구현을 완료하고 Phase 6.5에서 Go 전용 prod 인프라(Helm values·SSM ExternalSecret·ApplicationSet·KEDA)를 신설한 뒤, 이 날(2026-04-13) PR #219를 머지하며 첫 cutover 스모크를 시작했습니다. 기대와 달리 5건의 블로커가 연쇄로 터졌고, 46분 동안 4개의 prod 이미지를 빌드했습니다.

---

## 한 줄 요약

> Java → Go cutover 첫 스모크에서 OAuth env 누락 / PG DATE scan 오류 / viper SetDefault 침묵 / JSON 필드명 불일치 / JWT issuer 불일치가 연쇄 발생했습니다. 모두 계약·설정 누락이 원인이었고, 런타임 500·401로만 드러났습니다

---

## 전체 발생 현황

| # | 증상 | 근본 원인 | 수정 위치 |
|---|------|-----------|-----------|
| 1 | Google 로그인 `AUTH_INVALID` | OAUTH_\* env 9개 prod values 누락 | Goti-k8s `environments/prod/goti-user-go/values.yaml` |
| 2 | `verify` 500 `cannot scan date (OID 1082) into *string` | pgx v5 binary mode, PG DATE → `*string` scan 불가 | Goti-go `member_repo.go`, `social_provider_repo.go` — `to_char` 캐스팅 |
| 3 | `verify` 500 `RSA private key not configured` | viper `Unmarshal`+`AutomaticEnv` 조합에서 `SetDefault` 미등록 key는 env 바인딩 미적용 | Goti-go `pkg/config/config.go` — `SetDefault` 추가 |
| 4 | 전 경기 잔여석 0석 렌더 | Go JSON 태그 `remainingSeats` vs Java·프론트 계약 `remainingSeatCount` 불일치 | Goti-go `internal/ticketing/domain/dto_game.go` |
| 5 | `/queue/enter` 401 `Jwt issuer is not configured` | Go default `jwt.issuer="goti"` vs Istio RequestAuthentication `issuer: "goti-user-service"` 불일치 | Goti-k8s `prod/goti-user-go/values.yaml` — env 주입 |

---

## 🔥 문제 1: OAuth env 누락 → Google 로그인 401

### 발견한 문제

PR #219 머지 직후 Google 소셜 로그인을 시도하자 `POST /api/v1/auth/GOOGLE/social/verify`에서 401 `AUTH_INVALID`가 반환됐습니다. goti-user-go 컨테이너 로그에 `"oauth token exchange failed"`가 찍혔습니다.

### 🤔 원인

Go 서비스는 `os.Getenv("OAUTH_GOOGLE_CLIENT_ID")` 등 9개의 OAuth 환경변수를 직접 읽습니다. 그런데 prod/goti-user-go/values.yaml에 이 변수들이 전혀 없었습니다.

Java 서비스용 prod-gcp/goti-user/values.yaml에는 9개가 모두 존재했습니다. AWS prod 설정으로 마이그레이션하는 과정에서 누락됐습니다. Pod env를 조회하면 `OAUTH_*` 변수가 0개인 상태였습니다.

추가로 goti-ticketing-go에도 스케줄러 관련 env 3개(hold expiry interval·batch, inventory sync interval)가 누락되어 있어 같은 커밋에서 함께 추가했습니다.

### ✅ 해결

기존 Java 시크릿 `goti-user-prod-secrets`를 재사용했습니다. 단, 키명이 다릅니다.

```yaml
# Java 시크릿 키명 → Go env 키명 매핑
GOOGLE_CLIENT       → OAUTH_GOOGLE_CLIENT_ID
GOOGLE_SECRET       → OAUTH_GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI → OAUTH_GOOGLE_REDIRECT_URI
# KAKAO, NAVER도 동일 패턴 (각 3개씩, 총 9개)
```

Goti-k8s commit `7cc45d2`로 values.yaml에 ExternalSecret 참조를 추가하고 ArgoCD sync했습니다.

---

## 🔥 문제 2: PG DATE scan 오류 → verify 500

### 발견한 문제

OAuth env 추가 후 verify를 재시도하니 이번에는 500이 반환됐습니다. 에러 메시지는 다음과 같았습니다.

```text
finding social provider: can't scan into dest[12] (col: birth_date):
cannot scan date (OID 1082) in binary format into *string
```

### 🤔 원인

Go struct에서 `BirthDate` 필드를 `string` 타입으로 선언했습니다. pgx v5는 기본적으로 binary wire protocol을 사용하며, PostgreSQL의 DATE 타입(OID 1082)을 binary format으로 수신하면 `*string`에 직접 스캔할 수 없습니다.

Java JPA는 이 변환을 자동 처리합니다. Go 이식 시 이 차이가 드러났습니다.

### ✅ 해결

SELECT 및 RETURNING 절에서 `to_char(birth_date, 'YYYY-MM-DD')`로 명시적 캐스팅을 추가했습니다.

```sql
-- 변경 전
SELECT ..., birth_date, ...

-- 변경 후
SELECT ..., to_char(birth_date, 'YYYY-MM-DD') AS birth_date, ...
```

수정이 필요한 위치는 다음과 같습니다.

- `member_repo.go`: FindByID / FindByMobile / Create(RETURNING) — 3곳
- `social_provider_repo.go`: FindByProviderIDAndProvider — 1곳

**대안으로 검토한 방법 — 미채택**: Go struct의 `BirthDate` 필드를 `time.Time` 또는 `pgtype.Date`로 변경하는 방법도 있었습니다. 그러나 이 경우 JSON 직렬화 결과가 `"birthDate": "YYYY-MM-DD"` 형식을 벗어나 프론트엔드와의 API 계약이 깨지므로 기각했습니다. SQL 레이어에서 캐스팅하는 방법이 Go 내부 타입 변경 없이 계약을 유지하면서 문제를 해결합니다.

---

## 🔥 문제 3: viper SetDefault 누락 → RSA private key 침묵

### 발견한 문제

PG DATE 수정 후 배포하니 로그인 verify에서 또 500이 발생했습니다.

```text
RSA private key not configured
```

Pod 기동 자체는 성공했습니다. parse 에러가 아니라 런타임에서 빈 값이 사용된 상황입니다.

### 🤔 원인

viper의 알려진 동작 특성이 원인입니다.

`AutomaticEnv()` + `Unmarshal()`을 조합하면 **`SetDefault` 또는 config 파일에 명시적으로 등록된 key에 대해서만** env 바인딩이 적용됩니다.

`jwt.private_key_pem`은 `SetDefault`에 등록되지 않았습니다. yaml 파일에는 `"${JWT_PRIVATE_KEY_PEM}"` 리터럴이 있었지만, viper는 `${VAR}` 형식을 자동으로 expand하지 않습니다. 결과적으로 `Unmarshal()` 경로에서 env가 바인딩되지 않아 `cfg.PrivateKeyPEM`이 빈 문자열로 설정됐습니다.

다른 서비스(ticketing·payment·resale 등)에서 같은 문제가 발생하지 않은 이유가 있습니다. 이 서비스들은 JWT **검증**을 Istio sidecar의 inline JWKS로 처리합니다. Go 코드의 `cfg.PublicKeyPEM`은 실제로 참조되지 않습니다. goti-user-go만 토큰 **서명**을 위해 private key가 실제로 필요하므로 유일하게 증상이 드러났습니다.

### ✅ 해결

`config.go`에 두 key에 대한 `SetDefault`를 추가했습니다.

```go
// pkg/config/config.go
v.SetDefault("jwt.private_key_pem", "")
v.SetDefault("jwt.public_key_pem", "")
```

이후 `USER_JWT_PRIVATE_KEY_PEM` env를 주입하고 pod를 재시작하면 정상적으로 키를 읽습니다.

---

## 🔥 문제 4: JSON 필드명 불일치 → 잔여석 전부 0 렌더

### 발견한 문제

로그인에 성공했으나 티켓팅 페이지에서 모든 경기 잔여석이 0석으로 표시됐습니다. 실제 API 응답을 확인하면 값이 존재합니다.

### 🤔 원인

Java와 Go의 JSON 필드명이 달랐습니다.

```text
Java 계약: GameScheduleSearchResponse.remainingSeatCount (Long)
Go 응답:   RemainingSeats int64 `json:"remainingSeats"`
```

프론트엔드는 `game.remainingSeatCount`를 읽습니다. Go 응답에 해당 key가 없어 `undefined`로 평가되고, 렌더 시 0으로 표시됐습니다.

### ✅ 해결

Go struct의 JSON 태그만 수정했습니다. Go 내부 필드명은 유지해 callsite 영향이 없습니다.

```go
// 변경 전
RemainingSeats int64 `json:"remainingSeats"`

// 변경 후
RemainingSeats int64 `json:"remainingSeatCount"`
```

같은 비교에서 `homeTeamDisplayName`/`awayTeamDisplayName`도 Go에 없고 `homeTeamName`만 있음을 확인했습니다. 프론트엔드의 `displayName ?? teamName ?? code ?? id` fallback 체인 덕분에 당장은 표시되지만, 별도 이슈로 추후 통일이 필요합니다.

---

## 🔥 문제 5: JWT issuer 불일치 → /queue/enter 401

### 발견한 문제

재로그인 후 `/api/v1/queue/enter`를 호출하자 Envoy에서 401을 반환했습니다.

```text
Jwt issuer is not configured
```

토큰의 `iss` 클레임 값은 `goti`였습니다.

### 🤔 원인

Go 기본값과 Istio RequestAuthentication의 issuer 설정이 달랐습니다.

```text
Go config.go 기본값:          jwt.issuer = "goti"
Istio RequestAuthentication:  issuer: "goti-user-service"  (전 서비스 동일 설정)
```

Istio RequestAuthentication은 `issuer: "goti-user-service"`로 서명된 토큰만 수용합니다. Go user-go가 `iss=goti`로 서명한 토큰을 발급하므로 Envoy가 모든 요청을 거부했습니다.

### ✅ 해결

이미지 리빌드 없이 Goti-k8s values에 env를 주입해 해결했습니다.

```yaml
# environments/prod/goti-user-go/values.yaml
env:
  USER_JWT_ISSUER: "goti-user-service"
```

기존 `iss=goti`로 발급된 토큰은 여전히 유효하지 않아 모든 사용자가 재로그인해야 합니다. 스모크 환경이므로 허용 가능한 상황이었습니다.

---

## 별건: Redis 잔여 대기열 초기화

같은 세션에서 재로그인 직후 `/queue/enter`에서 "나의 대기 순서 5,196번째"가 표시됐습니다. 이전 부하 테스트의 잔존 데이터였습니다. queue의 `INCR sequence` counter는 cleanup 시에도 reset되지 않아 좀비 사용자가 waiting ZSET에 남아 있었습니다.

스모크 전이므로 debug pod를 띄워 `FLUSHALL`로 초기화했습니다.

```bash
# debug pod (Kyverno 정책 통과 spec: app/version 레이블, runAsNonRoot, resource limits, probes)
$ kubectl exec -it redis-flush -- redis-cli --tls -h <redis-host> FLUSHALL

# 결과
BEFORE: DB0=6 keys
AFTER:  전 DB 0
```

이 문제는 별도 개선이 필요합니다.

1. **티켓팅 종료 시 자동 CleanupGame** — `game_ticketing_statuses`가 `CLOSED`로 바뀌는 스케줄러에서 `CleanupService.CleanupGame(gameID)` 호출 hook 추가
2. **INCR sequence 키도 cleanup 대상 포함** — `goti:queue:seq:<gameID>` DEL 추가
3. **waiting ZSET 기반 fallback cleanup** — `expirationUsersKey` ZSET 등록 실패 케이스 복구
4. **maxCapacity drain 이슈 전수 검사** — admit 후 browser close 등으로 leave 미호출 시 `activeCount` 영구 점유, heartbeat 또는 짧은 TTL 검토
5. **Cleanup API를 prod 기본 enable** — `Queue.CleanupAPIEnabled=true` default, 인증은 Istio AuthorizationPolicy로 처리

---

## 타임라인

| UTC | 이벤트 |
|-----|--------|
| 11:09 | PR #219 (Java→Go cutover 1차) merged |
| 11:17 | Google 로그인 → 401, 문제 1 발견 |
| 11:20 | OAuth env 누락 + ticketing 스케줄러 env 누락 파악 |
| 11:21 | Goti-k8s commit `7cc45d2` push, ArgoCD sync |
| 11:22 | 재시도 → 500, 문제 2 birth_date scan |
| 11:24 | Goti-go commit `b6519b5` push → prod-9 배포 |
| 11:27 | 재시도 → 500, 문제 3 RSA private key |
| 11:31 | Goti-go commit `a2b7aea` push → prod-10 배포 |
| 11:33 | 로그인 성공, 잔여석 0석 문제 4 보고 |
| 11:42 | 프론트·Java 비교 → 필드명 불일치 확인, commit `3f7ee7c` → prod-11 배포 |
| 11:45 | OTel SDK 초기화 커밋 감지 → 6서비스 리빌드 prod-12 |
| 11:48 | 재로그인 → `/queue/enter` 401, 문제 5 JWT issuer |
| 11:53 | Goti-k8s values에 USER_JWT_ISSUER 추가, sync |
| 11:55+ | Redis FLUSHALL, debug pod 삭제 |

**총 소요: 약 46분 / 5단계 연쇄 수정 / 4개 prod 이미지 빌드**

---

## 📚 배운 점

**1. prod-gcp → prod 양방향 diff를 자동화해야 합니다**

prod-gcp가 먼저 안정화된 상태에서 AWS prod로 컷오버하는 구조였습니다. 오늘 수정은 대부분 "prod를 prod-gcp 수준으로 맞추기"였습니다. environments overlay를 base + 최소 diff 구조로 설계해 두 환경이 자동 동기화되도록 하는 것이 근본 해결입니다

**2. viper SetDefault 누락 패턴을 반복하지 않아야 합니다**

`AutomaticEnv()` + `Unmarshal()` 조합에서 `SetDefault`를 빠뜨리면 env 바인딩이 **침묵**합니다. 에러 없이 pod가 기동되므로 발견이 어렵습니다. 모든 env 바인딩 key에 `v.BindEnv(...)`를 명시적으로 호출하는 헬퍼 패턴으로 통일하는 것이 안전합니다

**3. 계약 차이는 런타임 500/401로만 드러납니다**

필드명 불일치·issuer·env 키명 차이 모두 컴파일·배포 시점에 잡히지 않습니다. Java spec → Go spec 전환 시점에 자동 diff 리포트가 필요합니다. OpenAPI export + schemathesis, 또는 Java DTO에서 JSON schema 덤프 → Go 응답과 contract test가 후보입니다

**4. DB 타입 매핑 체크리스트가 필요합니다**

Java JPA는 DATE↔String 변환을 자동 처리합니다. Go + pgx v5에서는 직접 처리해야 합니다. 이식 시 DATE, TIMESTAMP WITH TZ, JSONB, NUMERIC, BYTEA 각 타입에 대해 Go struct 타입과 scan 방법을 사전에 매핑해야 합니다

**5. Kyverno 정책과 debug pod 사이의 마찰을 줄여야 합니다**

debug pod 작성 시 Kyverno 정책이 6개 동시 차단했습니다. app/version 레이블, runAsNonRoot, resource limits, probes를 모두 맞춰야 pod를 띄울 수 있었습니다. 내부 debug 용도를 위한 Kyverno exception label(예: `goti.io/debug=true`)을 정의하면 긴급 상황 대응 속도를 높일 수 있습니다
