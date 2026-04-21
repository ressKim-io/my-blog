# Java → Go cutover 첫 smoke — 5가지 트러블슈팅

날짜: 2026-04-13 (PR #219 머지 직후 ~ JWT issuer 수정까지)
환경: AWS prod (EKS, goti ns, Harbor 이미지)
관련 세션: `docs/dev-logs/sessions/2026-04-13-session-2.md`

---

## 요약

Java → Go 전환 첫 smoke 테스트에서 5건의 블로커가 연쇄 발생. 모두 **계약(contract) 누락 / 설정 누락 / 기본값 불일치**가 원인.

| # | 증상 | 근본 원인 | 수정 위치 |
|---|---|---|---|
| 1 | Google 로그인 `AUTH_INVALID` | OAuth env (OAUTH_GOOGLE/KAKAO/NAVER_*) 9개 prod/goti-user-go values에 누락 | Goti-k8s `environments/prod/goti-user-go/values.yaml` |
| 2 | `verify` 500 `cannot scan date (OID 1082) into *string` | pgx v5 binary mode는 PG DATE → `*string` scan 불가 | Goti-go `internal/user/repository/{member,social_provider}_repo.go` — `to_char(birth_date,'YYYY-MM-DD')` 캐스팅 |
| 3 | `verify` 500 `RSA private key not configured` | viper `AutomaticEnv`+`Unmarshal`은 `SetDefault` 등록 key만 env 바인딩. `jwt.private_key_pem` default 없어서 yaml의 `"${JWT_PRIVATE_KEY_PEM}"` 리터럴이 그대로 unmarshal됨 | Goti-go `pkg/config/config.go` — `SetDefault("jwt.private_key_pem","")` / `public_key_pem` 추가 |
| 4 | `/schedules?today=false` 전 경기 잔여 0석 | Go JSON 태그 `remainingSeats` vs Java/프론트 계약 `remainingSeatCount` 불일치. 프론트 undefined → 0 렌더 | Goti-go `internal/ticketing/domain/dto_game.go` |
| 5 | `/queue/enter` 401 `Jwt issuer is not configured` | Go default `jwt.issuer="goti"` vs Istio RequestAuthentication issuer `"goti-user-service"` (전 서비스 동일) | Goti-k8s `prod/goti-user-go/values.yaml` — `USER_JWT_ISSUER=goti-user-service` env 주입 |

추가로 `goti-ticketing-go`에 스케줄러 env 3개 누락 발견 (hold expiry interval/batch, inventory sync interval) → 같은 커밋에서 추가.

---

## 1. OAuth env 누락

**증상**: Google 로그인 시 `POST /api/v1/auth/GOOGLE/social/verify` → 401 `AUTH_INVALID`. user-go 로그에 `"oauth token exchange failed"`.

**원인**: Java → Go 전환 시 prod/goti-user-go/values.yaml에 OAUTH env 마이그레이션 누락. pod env에 `OAUTH_*` 변수가 **0개**.
- Go 코드: `os.Getenv("OAUTH_GOOGLE_CLIENT_ID")` 등 요구 (cmd/user/main.go:175)
- prod-gcp/goti-user/values.yaml에는 OAuth 9개 모두 있음 → AWS prod만 누락

**수정**: 기존 Java 시크릿 `goti-user-prod-secrets` 재사용. 키명 매핑:
- Java: `GOOGLE_CLIENT / GOOGLE_SECRET / GOOGLE_REDIRECT_URI`
- Go env: `OAUTH_GOOGLE_CLIENT_ID / OAUTH_GOOGLE_CLIENT_SECRET / OAUTH_GOOGLE_REDIRECT_URI`

KAKAO/NAVER 동일 패턴.

**교훈**: 서비스 전환 시 prod-gcp ↔ prod env 양방향 diff를 **계약 테스트 성격으로 자동화 필요**.

---

## 2. PG DATE scan 오류

**증상**: verify 통과 후 500 `finding social provider: can't scan into dest[12] (col: birth_date): cannot scan date (OID 1082) in binary format into *string`.

**원인**: `Member.BirthDate` Go struct 타입이 `string`. pgx v5가 DATE를 binary format으로 가져오면서 `*string` scan 실패.

**수정**: SELECT/RETURNING에서 `to_char(birth_date, 'YYYY-MM-DD')` 캐스팅.
- `member_repo.go`: FindByID / FindByMobile / Create(RETURNING) 3곳
- `social_provider_repo.go`: FindByProviderIDAndProvider 1곳

**대안 (미채택)**: struct를 `time.Time` / `pgtype.Date`로 변경 — JSON 계약 `"birthDate": "YYYY-MM-DD"` 깨뜨림.

**교훈**: Java JPA는 DATE↔String 자동 변환. Go 이식 시 **DB 타입 매핑 체크리스트** 필요 (DATE, TIMESTAMP WITH TZ, JSONB, NUMERIC, BYTEA).

---

## 3. viper SetDefault 누락 → env 바인딩 침묵

**증상**: 로그인 verify 500 `RSA private key not configured`. pod 기동은 성공 (parse error가 아님).

**원인**: viper 알려진 동작.
- `AutomaticEnv()` + `Unmarshal()`은 **SetDefault 또는 config 파일에 등록된 key만** env 바인딩 적용
- `jwt.private_key_pem`은 default 미설정, yaml에 `"${JWT_PRIVATE_KEY_PEM}"` 리터럴만 존재
- viper는 `${VAR}` 자동 expand 안 함 → 리터럴 "${JWT_PRIVATE_KEY_PEM}" 이 cfg에 그대로 들어갈 것 같지만…
- 실제로는 `v.Get()` 경로에서는 env 바인딩이 동작하고 `Unmarshal()`에서는 동작 안 함 → cfg.PrivateKeyPEM=""

**수정**: `config.go`에 `SetDefault("jwt.private_key_pem","")` / `public_key_pem` 추가. env 주입 후 pod 재시작하면 정상.

**왜 ticketing/payment/resale 등 다른 서비스는 같은 문제를 안 겪었나**: JWT **검증**은 Istio sidecar의 inline jwks로 수행, Go 코드의 cfg.PublicKeyPEM은 실제로 사용 안 됨. user-go만 **서명**을 위해 privateKey 필요 → 유일하게 증상 발현.

**교훈**: yaml에서 `${VAR}` 스타일 env 참조는 viper 단독으로는 작동 안 함. 모든 env 주입 key는 `SetDefault`로 명시 등록하는 패턴으로 통일.

---

## 4. JSON 필드명 불일치 (`remainingSeats` vs `remainingSeatCount`)

**증상**: `/api/v1/games/schedules?today=false` 호출 시 프론트가 모든 경기 잔여 0석으로 표시. 실제 API 응답에는 값이 있음.

**원인**:
- Java 계약: `GameScheduleSearchResponse.remainingSeatCount: Long`
- Go 응답: `RemainingSeats int64 \`json:"remainingSeats"\``
- 프론트: `game.remainingSeatCount` 읽음 → undefined → 0 렌더

**수정**: Go JSON 태그만 `"remainingSeatCount"`로 복원. Go 내부 필드명(`RemainingSeats`)은 유지 (callsite 영향 없음).

**부수 발견**: `homeTeamDisplayName`/`awayTeamDisplayName`도 Go에는 없음 (`homeTeamName`만). 프론트가 `displayName ?? teamName ?? code ?? id` fallback 체인으로 읽어서 당장은 표시됨. 별도 이슈로 추후 통일 필요.

**교훈**: Java→Go 전환은 **필드 단위 계약 차이를 자동 검증**해야 함. 후보:
- OpenAPI spec을 Java 시점에 freeze → Go에서 `oapi-codegen`으로 코드 생성
- 또는 Java DTO에서 JSON schema 덤프 → Go 응답과 contract test

---

## 5. JWT issuer 불일치

**증상**: 재로그인 후 `/api/v1/queue/enter` 401 `Jwt issuer is not configured` (envoy). JWT `iss=goti`.

**원인**: Go default `jwt.issuer = "goti"` (config.go:213) vs Istio RequestAuthentication 전 서비스 `issuer: "goti-user-service"`.

**수정**: Goti-k8s values에 `USER_JWT_ISSUER=goti-user-service` env 주입. 이미지 리빌드 불필요. 기존 로그인 토큰은 무효 → 재로그인 필수.

**교훈**: JWT issuer는 **RequestAuthentication과 발급자 간 계약**. 양측이 같은 source (예: Helm values 한 곳)를 참조하도록 리팩터가 필요.

---

## 6. Redis 잔여 대기열 (별건이지만 같은 세션에 처리)

**증상**: 재로그인 직후 `/queue/enter`에서 "나의 대기 순서 5,196번째" 표시.

**원인**: 이전 부하 테스트 잔존 데이터. queue의 `INCR sequence` counter는 cleanup 시에도 reset 안 됨. 좀비 사용자가 waiting ZSET에 남음.

**처리**: smoke 전이라 `FLUSHALL`로 초기화. debug pod (`redis-flush`, redis:7-alpine) 띄워서 `redis-cli --tls` 로 실행. Kyverno 정책(app/version 레이블, runAsNonRoot, resource limits, probes) 통과하도록 pod spec 작성.

```
BEFORE: DB0=6 keys
AFTER:  전 DB 0
```

### 근본 개선 TODO (별도 SDD/PR)

1. **티켓팅 종료 시 자동 CleanupGame** — game_ticketing_statuses가 `CLOSED`로 바뀌는 스케줄러에서 `CleanupService.CleanupGame(gameID)` 호출 hook 추가
2. **INCR sequence 키도 cleanup 대상 포함** — `goti:queue:seq:<gameID>` DEL 추가
3. **waiting ZSET 기반 fallback cleanup** — `expirationUsersKey` ZSET 등록 실패 케이스 복구
4. **maxCapacity drain 이슈 전수 검사** — admit 후 browser close 등으로 leave 호출 누락 시 `activeCount` 영구 점유. heartbeat 또는 짧은 TTL 검토
5. **Cleanup API를 prod 기본 enable** — `Queue.CleanupAPIEnabled=true` default, 인증은 Istio AuthorizationPolicy로 (`/internal/*` 현재 require-jwt 제외 경로)

---

## 타임라인

- 11:09 UTC: PR #219 (Java→Go cutover 1차) merged
- 11:17: Google 로그인 시도 → 401 (증상 1) 발견
- 11:20: 원인 파악 — OAuth env 누락 + ticketing 스케줄러 env 누락
- 11:21: Goti-k8s commit `7cc45d2` push, ArgoCD sync
- 11:22: 재시도 → 500 (증상 2) birth_date scan
- 11:24: Goti-go commit `b6519b5` push → deploy/prod (workflow_dispatch, 첫 push라 diff 실패) → prod-9 배포
- 11:27: 재시도 → 500 (증상 3) RSA private key
- 11:31: Goti-go commit `a2b7aea` push → prod-10 배포
- 11:33: 로그인 성공! 잔여석 0석 (증상 4) 보고
- 11:42: 프론트/Java 비교 → 필드명 불일치 확인, commit `3f7ee7c` → prod-11 배포
- 11:45: OTel SDK 초기화 커밋 `c96e1d8` 추가 감지 → 6서비스 리빌드 prod-12
- 11:48: 재로그인 → /queue/enter 401 (증상 5) Jwt issuer
- 11:53: Goti-k8s values에 USER_JWT_ISSUER 추가, sync
- 11:55+: Redis FLUSHALL 실행, debug pod 삭제

총 소요: **약 46분 / 5단계 연쇄 수정 / 4개 prod 이미지 빌드**.

---

## 커밋/PR 기록

### Goti-go (main + deploy/prod)
- `b6519b5` fix(user): PG date를 text로 캐스팅해 BirthDate scan 오류 해결
- `a2b7aea` fix(config): jwt private/public key SetDefault 추가
- `3f7ee7c` fix(ticketing): schedules 응답 잔여석 필드명을 Java 계약으로 복원
- `c96e1d8` feat(observability): OTel SDK 초기화 및 gin 계측 추가 (사용자 병행 작업)

### Goti-k8s (main)
- `7cc45d2` fix(goti-user-go,goti-ticketing-go): prod env 누락 보충 (OAuth 9 + scheduler 3)
- PR #220 prod-9 image bump (auto)
- PR #221 prod-10 image bump (auto)
- PR #222 prod-11 image bump (auto)
- PR #223 prod-12 image bump (auto, 6서비스)
- `fe038db` fix(goti-user-go): JWT issuer를 Istio RequestAuthentication과 일치

---

## 회고 포인트

1. **prod-gcp가 먼저 안정화되어 있어서 오늘 수정은 "prod를 prod-gcp 수준으로 맞추기" 성격** — 차라리 environments overlay를 base + 최소 diff로 구조화해서 둘이 자동 동기화되게 설계하는 게 정답. 현재는 두 벌 유지 중
2. **viper SetDefault 누락이 2번이나 발생** (ticketing 스케줄러 env, JWT 키) — viper Unmarshal+AutomaticEnv 조합 대신 `v.BindEnv(...)`를 모든 env 바인딩 key에 명시적으로 호출하는 헬퍼 도입 필요
3. **계약 차이(필드명, issuer, env 명)가 "런타임에서 500/401로만 드러남"** — Java spec → Go spec 변환 시점에 자동 diff 리포트 필요. OpenAPI export + schemathesis 같은 도구 검토
4. **Kyverno 정책이 디버그 pod 작성 시 6개 동시 차단** — 내부 debug 용도 pod를 위한 Kyverno exception label (예: `goti.io/debug=true`) 정의하면 작업 속도 향상
