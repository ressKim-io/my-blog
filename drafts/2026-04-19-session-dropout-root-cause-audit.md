# 로그인 세션 수시 만료 — 근본 원인 감사 (2026-04-19)

## 사용자 체감
- 로그인 직후인데도 갑자기 세션 만료로 튕김
- 탭을 잠시 비활성화했다가 돌아오면 로그아웃 상태
- 정확한 재현 스텝은 미확보

## 이미 처리된 이슈 (중복 배제)
- 시크릿 모드 첫 방문 시 `/session-expired` 튕김 → commit `1e3b9fb` (FE) 에서 `currentUserId !== null` 가드로 해결
- RS256 마이그레이션 + AWS/GCP JWT 키 통일 (2026-04-17)
- JWT issuer SoT = K8s values (ADR-0015)

---

## 🔴 P0 — 가장 유력한 범인

### 1. 클라이언트 세션 수명(1h) vs 서버 JWT exp(30m) 미스매치

**클라이언트** (`Goti-front`)
- `src/entities/auth/model/authStore.ts:15`
  ```ts
  const AUTH_SESSION_DURATION_MS = 60 * 60 * 1000;  // 1시간 하드코딩
  ```
- `src/entities/auth/model/authStore.ts:27-28` `getNextAuthExpiresAt`
  - 서버 JWT 의 실제 `exp` 무시, 항상 `Date.now() + 1h` 로 재설정
- `src/entities/auth/model/authStore.ts:180-195` `syncAuthSession`
  - `remainingSeconds <= 0` → **reissue 시도 없이** 즉시 `clearAuth('expired')`

**서버** (`Goti-go`)
- `pkg/config/config.go:267` (추정 라인, 전체 감사 기준)
  ```go
  v.SetDefault("jwt.access_ttl_sec", 1800)      // 30분 기본값
  v.SetDefault("jwt.refresh_ttl_sec", 604800)   // 7일
  ```
- K8s `goti-user` values (prod/prod-gcp/dev) 에 `USER_JWT_ACCESS_TTL_SEC` / `USER_JWT_REFRESH_TTL_SEC` **env 주입 없음**
- 결과: 서버는 30분마다 JWT 만료. 클라이언트 타이머는 1시간 기준 → 실제 API 401 이 발생하는데 클라이언트는 "아직 유효" 판단.

**체감 매핑**: "로그인 직후처럼 느끼는데" = 실제 30분 경과 → 백엔드 401 → reissue 실패 or 비대응 경로 → `/session-expired`.

### 2. `shouldKeepSessionAlivePath` 범위가 너무 좁음

**위치**: `src/app/providers/router/ui/AuthSessionController.tsx:7-8`
```ts
const shouldKeepSessionAlivePath = (pathname: string) =>
   pathname.startsWith('/books') || pathname.startsWith('/resell-books') || pathname.startsWith('/tickets');
```

- 만료 60초 이내일 때 auto-reissue 를 시도하는 `useEffect` (동일 파일 `:142-188`) 가 위 3개 경로에서만 동작
- **메인페이지/마이페이지/팀페이지/Queue 등 모든 다른 경로는 자동 연장 없음**
- 사용자가 탭 비활성 → 30분~1h 뒤 복귀 → books 외 경로에서 API 호출 → 401 → reissue 1회 시도 후 실패 → 로그아웃

**체감 매핑**: "탭 잠깐 닫았다 돌아오면 로그아웃".

---

## 🟠 P1 — 이차 원인

### 3. `isManualLogout` localStorage persist 잔존

- `src/entities/auth/model/authStore.ts:165`: `clearAuth()` 모든 케이스에서 `isManualLogout: true` 설정 (수동/자동 로그아웃 구분 없이)
- `:296-298` `partialize`: `isManualLogout` 를 localStorage 에 persist
- `src/shared/lib/reissueAccessToken.ts:11-12`: reissue 자체를 `isManualLogout=true` 면 차단

**시나리오**:
1. 사용자가 로그아웃 버튼 누름 → `isManualLogout: true` persist
2. 다시 로그인 → setAccessToken 이 `isManualLogout: false` 로 덮어씀 ✓
3. 그러나 브라우저 강제 종료 등으로 `setAccessToken` 전에 새로고침 → localStorage 에 아직 `true` 잔존 → 초기 reissue 차단

### 4. axios 401 interceptor — `sessionRemainingSeconds > 60` 이면 reissue 건너뜀

**위치**: `src/shared/api/client.ts:77-101, 283-295`
- 의도: "좌석/결제 화면에서 모든 401 을 즉시 로그아웃으로 해석하지 않기 위한 방어"
- 부작용: 서버 JWT 는 만료인데 클라이언트가 "아직 1h 남음" 으로 보면 reissue 안 하고 그냥 에러 → 앱이 어색한 상태로 방치

### 5. 탭 백그라운드 시 setInterval throttle

- `src/entities/auth/model/authStore.ts:211-212`: 1초 간격 `syncAuthSession` 타이머
- 브라우저가 백그라운드 탭의 timer 를 throttle → 복귀 시 `remainingSeconds` 가 급격히 음수로 점프 가능
- `syncAuthSession` 은 `<= 0` 시 경고 없이 `clearAuth('expired')` 호출 → `/session-expired` 튕김

### 6. 403 "issuer is not configured" 도 clearAuth 트리거

- `src/shared/api/client.ts:200` `isAuthorizationConflictMessage()` 분기
- Istio `RequestAuthentication` issuer 불일치 시 403 → 클라이언트가 JWT 만료로 오판 → clearAuth
- 현재 issuer 는 양쪽 `goti-user-service` 로 일치 확인됐으나, 키 rotation/값 drift 발생하면 재발 가능

---

## 🟡 P2 — 관찰사항

### 7. Refresh token cookie Path=/api/v1/auth/reissue
- `Goti-go/internal/user/handler/auth_handler.go:135` — 쿠키 Path 가 `/api/v1/auth/reissue` 로 매우 좁음
- 단, `SameSite=Lax` + `credentials: include` 로 교차도메인 구성에서는 현재 정상 동작 중인 걸로 보임

### 8. Reissue 응답이 새 exp 를 안 내려줌
- `features/auth/api/authApi.ts:35-37` `ReissueAccessTokenResponse { accessToken }` 단일 필드
- 서버가 새 JWT 의 exp 를 별도 필드로 주면 클라이언트가 `getNextAuthExpiresAt` 을 JWT 기반으로 맞출 수 있음

---

## 즉시 효과 큰 완화책 (권장 우선순위)

### 권장 #1 — K8s values 에 JWT TTL 명시 (한 줄로 70% 체감 개선 기대)
```yaml
# Goti-k8s/environments/prod-gcp/goti-user/values.yaml (및 dev/prod 동일)
env:
  USER_JWT_ACCESS_TTL_SEC: "3600"   # 클라이언트 1시간과 맞춤
  USER_JWT_REFRESH_TTL_SEC: "604800"
```
→ Goti-go 의 config 가 `USER_` prefix env 를 자동으로 로드하는지 우선 확인 필요. (viper prefix 설정 점검)

### 권장 #2 — `shouldKeepSessionAlivePath` 확대 또는 제거
```ts
// AuthSessionController.tsx 수정 방향
const shouldKeepSessionAlivePath = () => true;
// 모든 로그인 상태 경로에서 만료 60초 전 reissue 시도
```

### 권장 #3 — 클라이언트에서 JWT exp 를 실제 파싱
```ts
// authStore.ts setAccessToken 수정
const exp = parseJwtExp(accessToken);  // atob + JSON.parse
const nextAuthExpiresAt = exp ? exp * 1000 : Date.now() + AUTH_SESSION_DURATION_MS;
```
→ 서버 TTL 변경 시 클라이언트가 자동으로 따라감. 미스매치 원천 제거.

### 권장 #4 — `isManualLogout` 을 persist 에서 제거
```ts
partialize: state => ({
   recentLoginProvider: state.recentLoginProvider,
   currentUserId: state.currentUserId,
   // isManualLogout 제거 — 메모리만 유지
})
```

### 권장 #5 — `clearAuth('expired')` 전에 reissue 1회 강제 시도
`syncAuthSession` 에서 `<= 0` 진입 시 바로 clearAuth 하지 말고 reissue 한번 해보고 실패하면 그때 clearAuth.

---

## 재현 추천 절차 (사용자 검증용)

1. **30분 대기 테스트**
   - 로그인 → 메인/마이페이지에서 30분간 아무 조작 없이 대기 → 아무 링크 클릭 → `/session-expired` 이동 여부 확인

2. **백그라운드 탭 테스트**
   - 로그인 → 다른 탭으로 15분 이상 이동 → 원래 탭 복귀 → 로그아웃 상태 확인

3. **로그아웃 후 즉시 새로고침**
   - 로그아웃 → F5 → 강제 종료 → 다시 진입 → localStorage `auth-store.isManualLogout` 값 확인

4. **개발자도구 Application → LocalStorage**
   - key `auth-store` 안 `isManualLogout`, `currentUserId` 값 캡처

---

## 확인 필요 (코드만으론 판단 불가)

1. 서버 JWT access TTL 실제 런타임 값은?
   - `kubectl exec ... -- env | grep JWT` 또는 `/metrics` 로 노출된 값
2. viper 가 `USER_` prefix env 를 자동 매핑하는지?
   - 매핑 안 되면 values.yaml 추가해도 서버에 적용 안 됨
3. 사용자 체감 타이밍의 실제 중앙값은 얼마?
   - 5분 후? 30분 후? 1시간 후? → 원인 좁힘에 결정적

---

## 새 세션에서 이어갈 작업 체크리스트

- [ ] `config.Load("user")` viper prefix 확인 (Goti-go)
- [ ] `kubectl exec goti-user-pod -- env | grep -i jwt` 로 현재 TTL 확인
- [ ] 위 **권장 #1** Goti-k8s PR 작성 (dev/prod/prod-gcp 3곳)
- [ ] 위 **권장 #2**, **#3**, **#4** FE 수정 PR (Goti-front deploy/prod)
- [ ] 배포 후 재현 절차로 회귀 검증

---

분석: Claude (Opus 4.7) / 후속 세션 계속 작업 예정.
관련: `docs/dev-logs/2026-04-19-resale-fe-be-contract-audit.md` (동일일자 별건)
