---
title: "로그인 세션 수시 만료 — 근본 원인 감사 (P0~P2 8건 + 5개 완화책)"
excerpt: "로그인 직후인데도 세션이 튕기고 탭을 비활성화했다 돌아오면 로그아웃되는 체감 증상을 근본 원인 감사로 풀었습니다. 클라이언트 1h vs 서버 30m JWT 미스매치, shouldKeepSessionAlivePath 범위 협소 등 P0 2건 + P1 4건 + P2 2건을 정리하고 5개 완화책을 우선순위대로 제시했습니다."
category: challenge
tags:
  - go-ti
  - JWT
  - Session
  - Frontend
  - Auth
  - Audit
series:
  name: "goti-auth"
  order: 7
date: "2026-04-19"
---

## 한 줄 요약

> "로그인 직후인데 갑자기 세션 만료로 튕긴다", "탭을 잠시 비활성화했다 돌아오면 로그아웃 상태다"라는 사용자 체감 증상을 근본 원인 감사로 풀었습니다. 가장 유력한 범인은 **클라이언트 세션 수명 1시간 vs 서버 JWT exp 30분의 미스매치**와 **auto-reissue 경로가 3개 path만 대상으로 하는 범위 협소** 두 가지(P0)였습니다. 그 외 이차 원인 4건(P1), 관찰 사항 2건(P2)을 정리하고, 권장 완화책 5개를 우선순위대로 제시합니다

---

## 🔥 사용자 체감 증상

- 로그인 직후인데도 갑자기 세션 만료로 튕긴다
- 탭을 잠시 비활성화했다가 돌아오면 로그아웃 상태다
- 정확한 재현 스텝은 미확보

### 이미 처리된 이슈 (중복 배제)

- 시크릿 모드 첫 방문 시 `/session-expired` 튕김 → 커밋 `1e3b9fb` (FE)에서 `currentUserId !== null` 가드로 해결
- RS256 마이그레이션 + AWS/GCP JWT 키 통일 (2026-04-17)
- JWT issuer SoT = K8s values (ADR-0015)

위 3건은 이번 감사에서 제외합니다

---

## 🔴 P0 — 가장 유력한 범인

### 1. 클라이언트 세션 수명(1h) vs 서버 JWT exp(30m) 미스매치

**클라이언트** (`Goti-front`)

```ts
// src/entities/auth/model/authStore.ts:15
const AUTH_SESSION_DURATION_MS = 60 * 60 * 1000;  // 1시간 하드코딩
```

```ts
// authStore.ts:27-28  getNextAuthExpiresAt
// 서버 JWT의 실제 exp 무시, 항상 Date.now() + 1h로 재설정
```

```ts
// authStore.ts:180-195  syncAuthSession
// remainingSeconds <= 0 → reissue 시도 없이 즉시 clearAuth('expired')
```

**서버** (`Goti-go`)

```go
// pkg/config/config.go:267 (추정 라인)
v.SetDefault("jwt.access_ttl_sec", 1800)     // 30분 기본값
v.SetDefault("jwt.refresh_ttl_sec", 604800)  // 7일
```

K8s `goti-user` values(`dev`/`prod`/`prod-gcp`)에 `USER_JWT_ACCESS_TTL_SEC`·`USER_JWT_REFRESH_TTL_SEC` **env 주입이 없습니다**

결과:

- 서버는 30분마다 JWT 만료
- 클라이언트 타이머는 1시간 기준
- 실제 API 401이 발생하는데 클라이언트는 "아직 유효" 판단

**체감 매핑**: "로그인 직후처럼 느끼는데"는 실제 30분이 경과한 후 백엔드가 401을 반환하면서 reissue 실패 또는 비대응 경로로 들어가 `/session-expired`로 튕기는 것입니다

### 2. `shouldKeepSessionAlivePath` 범위가 너무 좁다

```ts
// src/app/providers/router/ui/AuthSessionController.tsx:7-8
const shouldKeepSessionAlivePath = (pathname: string) =>
   pathname.startsWith('/books') ||
   pathname.startsWith('/resell-books') ||
   pathname.startsWith('/tickets');
```

만료 60초 이내일 때 auto-reissue를 시도하는 `useEffect`(동일 파일 `:142-188`)가 **위 3개 경로에서만** 동작합니다

- **메인페이지/마이페이지/팀페이지/Queue 등 모든 다른 경로는 자동 연장 없음**
- 사용자가 탭을 비활성화 → 30분~1시간 뒤 복귀 → books 외 경로에서 API 호출 → 401 → reissue 1회 시도 후 실패 → 로그아웃

**체감 매핑**: "탭 잠깐 닫았다 돌아오면 로그아웃"

---

## 🟠 P1 — 이차 원인

### 3. `isManualLogout` localStorage persist 잔존

- `authStore.ts:165`: `clearAuth()` 모든 케이스에서 `isManualLogout: true` 설정 (수동·자동 로그아웃 구분 없이)
- `:296-298` `partialize`: `isManualLogout`을 localStorage에 persist
- `reissueAccessToken.ts:11-12`: reissue 자체를 `isManualLogout=true`면 차단

**시나리오**:

1. 사용자가 로그아웃 버튼 누름 → `isManualLogout: true` persist
2. 다시 로그인 → `setAccessToken`이 `isManualLogout: false`로 덮어씀
3. 그러나 브라우저 강제 종료 등으로 `setAccessToken` 전에 새로고침 → localStorage에 아직 `true` 잔존 → 초기 reissue 차단

### 4. axios 401 interceptor — `sessionRemainingSeconds > 60`이면 reissue 건너뜀

- **의도**: "좌석·결제 화면에서 모든 401을 즉시 로그아웃으로 해석하지 않기 위한 방어"
- **부작용**: 서버 JWT는 만료인데 클라이언트가 "아직 1h 남음"으로 보면 reissue 안 하고 그냥 에러를 내 앱이 어색한 상태로 방치됩니다

### 5. 탭 백그라운드 시 `setInterval` throttle

- `authStore.ts:211-212`: 1초 간격 `syncAuthSession` 타이머
- 브라우저가 백그라운드 탭의 timer를 throttle → 복귀 시 `remainingSeconds`가 급격히 음수로 점프 가능
- `syncAuthSession`은 `<= 0` 시 경고 없이 `clearAuth('expired')` 호출 → `/session-expired` 튕김

### 6. 403 "issuer is not configured"도 `clearAuth` 트리거

- `client.ts:200` `isAuthorizationConflictMessage()` 분기
- Istio `RequestAuthentication` issuer 불일치 시 403 → 클라이언트가 JWT 만료로 오판 → `clearAuth`
- 현재 issuer는 양쪽 `goti-user-service`로 일치 확인됐지만, 키 rotation·값 drift가 발생하면 재발 가능합니다

---

## 🟡 P2 — 관찰 사항

### 7. Refresh token cookie `Path=/api/v1/auth/reissue`

- `auth_handler.go:135` — 쿠키 Path가 `/api/v1/auth/reissue`로 매우 좁음
- 단, `SameSite=Lax` + `credentials: include`로 교차도메인 구성에서는 현재 정상 동작 중

### 8. Reissue 응답이 새 exp를 안 내려줌

- `authApi.ts:35-37` `ReissueAccessTokenResponse { accessToken }` 단일 필드
- 서버가 새 JWT의 exp를 별도 필드로 주면 클라이언트가 `getNextAuthExpiresAt`을 JWT 기반으로 맞출 수 있습니다

---

## ✅ 즉시 효과 큰 완화책 (권장 우선순위)

### 권장 #1 — K8s values에 JWT TTL 명시 (한 줄로 70% 체감 개선 기대)

```yaml
# Goti-k8s/environments/prod-gcp/goti-user/values.yaml (및 dev/prod 동일)
env:
  USER_JWT_ACCESS_TTL_SEC: "3600"   # 클라이언트 1시간과 맞춤
  USER_JWT_REFRESH_TTL_SEC: "604800"
```

Goti-go의 config가 `USER_` prefix env를 자동 로드하는지 우선 확인이 필요합니다 (viper prefix 설정 점검)

### 권장 #2 — `shouldKeepSessionAlivePath` 확대 또는 제거

```ts
// AuthSessionController.tsx 수정 방향
const shouldKeepSessionAlivePath = () => true;
// 모든 로그인 상태 경로에서 만료 60초 전 reissue 시도
```

### 권장 #3 — 클라이언트에서 JWT exp를 실제 파싱

```ts
// authStore.ts setAccessToken 수정
const exp = parseJwtExp(accessToken);  // atob + JSON.parse
const nextAuthExpiresAt = exp ? exp * 1000 : Date.now() + AUTH_SESSION_DURATION_MS;
```

서버 TTL이 변경되면 클라이언트가 자동으로 따라갑니다. 미스매치 원천 제거

### 권장 #4 — `isManualLogout`을 persist에서 제거

```ts
partialize: state => ({
   recentLoginProvider: state.recentLoginProvider,
   currentUserId: state.currentUserId,
   // isManualLogout 제거 — 메모리만 유지
})
```

### 권장 #5 — `clearAuth('expired')` 전에 reissue 1회 강제 시도

`syncAuthSession`에서 `<= 0` 진입 시 바로 `clearAuth`를 호출하지 않고 reissue를 한 번 시도한 뒤, 실패하면 그때 `clearAuth`를 호출합니다

---

## 재현 추천 절차 (검증용)

1. **30분 대기 테스트**
   - 로그인 → 메인·마이페이지에서 30분간 아무 조작 없이 대기 → 아무 링크 클릭 → `/session-expired` 이동 여부 확인

2. **백그라운드 탭 테스트**
   - 로그인 → 다른 탭으로 15분 이상 이동 → 원래 탭 복귀 → 로그아웃 상태 확인

3. **로그아웃 후 즉시 새로고침**
   - 로그아웃 → F5 → 강제 종료 → 다시 진입 → localStorage `auth-store.isManualLogout` 값 확인

4. **개발자도구 Application → LocalStorage**
   - key `auth-store` 안 `isManualLogout`, `currentUserId` 값 캡처

---

## 확인 필요 (코드만으론 판단 불가)

1. 서버 JWT access TTL 실제 런타임 값은?
   - `kubectl exec ... -- env | grep JWT` 또는 `/metrics`로 노출된 값
2. viper가 `USER_` prefix env를 자동 매핑하는지?
   - 매핑되지 않으면 values.yaml 추가해도 서버에 적용 안 됩니다
3. 사용자 체감 타이밍의 실제 중앙값은 얼마?
   - 5분 후? 30분 후? 1시간 후? → 원인 좁힘에 결정적

---

## 📚 배운 점

- **체감 증상을 근본 원인에 매핑합니다.** "로그인 직후처럼 느끼는데"가 실제로는 "30분 경과 후 401"이라는 것을 데이터로 확정해야 완화책이 제대로 작동합니다. 체감만 듣고 "세션 로직이 이상한 것 같다"고 방향을 잡으면 엉뚱한 수정을 하게 됩니다
- **양쪽 설정이 일치하지 않는 곳은 항상 의심합니다.** 클라이언트 1h vs 서버 30m처럼 두 레이어의 수명이 다르면 특정 시점에 반드시 미스매치가 드러납니다. 한쪽을 바꿀 때 다른 쪽도 명시적으로 함께 조정해야 합니다
- **`clearAuth` 전 reissue 1회는 저비용 완화책입니다.** 만료 시 바로 로그아웃 처리하지 않고 한 번의 reissue를 시도하는 것만으로도 대부분의 "예상 밖 만료" 체감이 줄어듭니다
- **localStorage에 persist하는 키는 최소화합니다.** `isManualLogout`처럼 상태 분기에 쓰는 플래그가 persist되면 탭 간·세션 간 edge case가 폭발적으로 늘어납니다. 메모리 전용으로 유지할 수 있는지 먼저 검토합니다
- **브라우저 백그라운드 탭의 timer throttle을 기억합니다.** `setInterval`로 세션 타이머를 돌릴 때 복귀 시점의 점프를 `<= 0` 한 번으로 잘라버리면 사용자 체감이 "나도 모르는 사이 로그아웃"이 됩니다. 가시성(`visibilitychange`) 이벤트와 함께 재계산 로직을 넣습니다
