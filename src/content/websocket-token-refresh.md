---
title: "WebSocket 재연결 시 토큰 갱신 안 되는 이유"
excerpt: "WebSocket은 Axios 인터셉터가 적용되지 않는다. 재연결 로직에서 직접 refreshAccessToken 호출이 필요한 이유"
category: kubernetes
tags:
  - WebSocket
  - JWT
  - Authentication
  - Frontend
series:
  name: "eks-security"
  order: 2
date: '2026-01-02'
---

## 한 줄 요약

> WebSocket 연결은 Axios 인터셉터를 거치지 않는다. 재연결 시 수동으로 토큰 갱신을 호출해야 한다.

## Impact

- **영향 범위**: 채팅, 보드, 프레즌스 WebSocket 기능
- **증상**: 채팅 전송 버튼 동작 안 함
- **소요 시간**: 약 2시간
- **발생일**: 2026-01-02

---

## 🔥 증상: WebSocket 재연결 5회 모두 실패

### 콘솔 로그

```
🔌 [Chat WS] 연결 시도: wss://wealist.co.kr/api/svc/chat/...?token=eyJ...
❌ WebSocket connection failed
🔌 [Chat WS] 연결 닫힘: 1006
🔄 [Chat WS] 재연결 시도 1/5...
🔌 [Chat WS] 연결 시도: wss://...?token=eyJ...  ← 같은 만료된 토큰!
❌ WebSocket connection failed
...
❌ [Chat WS] 최대 재연결 시도 초과
```

**관찰 포인트**: 재연결할 때마다 **같은 토큰**을 사용하고 있었습니다.

---

## 🤔 원인: WebSocket은 Axios를 사용하지 않는다

### Axios 인터셉터 (HTTP 요청)

일반 HTTP 요청은 Axios 인터셉터가 401 응답을 가로채서 자동으로 토큰을 갱신합니다:

```typescript
// apiConfig.ts - Axios 인터셉터
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    if (status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const newToken = await refreshAccessToken();  // ✅ 자동 갱신
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return client(originalRequest);
    }
    return Promise.reject(error);
  }
);
```

### WebSocket (문제 코드)

WebSocket은 Axios를 사용하지 않고 브라우저의 `WebSocket` API를 직접 사용합니다:

```typescript
// chatWebsocket.ts - Before (문제)
const connect = () => {
  const token = localStorage.getItem('token');
  ws = new WebSocket(`wss://wealist.co.kr/ws/chat?token=${token}`);

  ws.onclose = (event) => {
    if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      setTimeout(connect, 3000);  // ❌ 만료된 토큰으로 재시도
    }
  };
};
```

### 문제의 흐름

```
1. 토큰 만료됨 (exp: 30분 전)
2. WebSocket 연결 끊김 (code: 1006)
3. 재연결 시도 → localStorage에서 만료된 토큰 읽음
4. 서버에서 401 → 연결 거부
5. 3~4 반복 5회
6. 최대 재시도 초과 → 채팅 사용 불가
```

---

## ✅ 해결: 재연결 전 토큰 갱신

### 수정된 코드

```typescript
// chatWebsocket.ts - After
import { getChatWebSocketUrl, refreshAccessToken } from '../api/apiConfig';

const connect = async () => {
  const url = getChatWebSocketUrl(workspaceId, channelId);
  ws = new WebSocket(url);

  ws.onclose = async (event) => {
    if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;

      // 🔥 재연결 전 토큰 갱신 시도
      try {
        console.log('🔄 [Chat WS] 토큰 갱신 시도...');
        await refreshAccessToken();
        console.log('✅ [Chat WS] 토큰 갱신 성공');
      } catch (error) {
        console.error('❌ [Chat WS] 토큰 갱신 실패, 재연결 중단');
        // refreshAccessToken 실패 시 로그아웃 처리됨
        return;
      }

      setTimeout(connect, reconnectDelay);
    }
  };
};
```

### refreshAccessToken 함수 export

```typescript
// apiConfig.ts
export const refreshAccessToken = async (): Promise<string> => {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) {
    throw new Error('No refresh token');
  }

  const response = await axios.post('/api/auth/refresh', { refreshToken });
  const { accessToken } = response.data;

  localStorage.setItem('token', accessToken);
  return accessToken;
};
```

---

## 적용 대상

3개의 WebSocket 클라이언트 모두 수정:

| 파일 | 용도 |
|------|------|
| `src/utils/chatWebsocket.ts` | 채팅 메시지 |
| `src/utils/boardWebsocket.ts` | 실시간 보드 협업 |
| `src/utils/presenceWebsocket.ts` | 사용자 온라인 상태 |

---

## 📚 배운 점

### WebSocket 인증 방식 비교

| 방식 | 설명 | 장단점 |
|------|------|--------|
| Query String Token | URL에 토큰 포함 | 간단하지만 로그에 노출 |
| First Message Auth | 연결 후 첫 메시지로 인증 | 안전하지만 추가 핸드셰이크 |
| Cookie (httpOnly) | 브라우저가 자동 전송 | XSS 방어, CORS 복잡 |

### 토큰 갱신 핵심 원칙

1. **재연결 시 반드시 토큰 갱신 시도**: 만료된 토큰으로 재시도하면 계속 실패
2. **401과 네트워크 에러 구분**: 401은 토큰 문제, 네트워크 에러는 재시도 가능
3. **갱신 실패 시 graceful logout**: 무한 루프 방지

### 증상 패턴

다음 패턴이 보이면 WebSocket 토큰 갱신 문제를 의심하세요:

- WebSocket 연결 실패 후 동일 에러로 계속 재시도
- 콘솔에 같은 토큰으로 5회 연속 실패 로그
- HTTP API는 정상 동작 (Axios 인터셉터 덕분)

---

## 요약

| 문제 | 원인 | 해결 |
|------|------|------|
| 재연결 5회 모두 실패 | 만료된 토큰으로 재시도 | 재연결 전 `refreshAccessToken()` 호출 |
| HTTP는 정상, WS만 실패 | Axios 인터셉터 미적용 | WebSocket에서 직접 토큰 갱신 |

---

## 관련 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/api/apiConfig.ts` | `refreshAccessToken` 함수 export |
| `src/utils/chatWebsocket.ts` | 재연결 전 토큰 갱신 추가 |
| `src/utils/boardWebsocket.ts` | 재연결 전 토큰 갱신 추가 |
| `src/utils/presenceWebsocket.ts` | 재연결 전 토큰 갱신 추가 |

---

## 참고

- [WebSocket API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc7519)
