---
title: "CloudFront가 API 404를 HTML 200으로 바꾼다 — distribution 레벨 설정의 함정"
excerpt: "E2E 테스트에서 좌석 예약 API가 React 프론트엔드 HTML을 200으로 돌려줬습니다. SPA 라우팅을 위해 넣은 Custom Error Response가 distribution 전체에 걸려 있어 API 에러까지 삼키고 있었고, 도메인을 분리해 구조적으로 해결한 기록입니다"
category: cicd
tags:
  - go-ti
  - CloudFront
  - AWS
  - Route53
  - Istio
  - Troubleshooting
series:
  name: "goti-cloudfront-alb"
  order: 4
date: "2026-03-24"
---

## 한 줄 요약

> API 404가 `200 OK / text/html`로 돌아오는 이상 증상을 추적하니 CloudFront Custom Error Response가 원인이었습니다. SPA 라우팅에 반드시 필요한 설정인데 distribution 레벨이라 특정 behavior만 제외할 수 없었고, API 전용 도메인을 분리해 해결했습니다

---

## 🔥 문제: 유효한 JWT로 호출하면 HTML이 돌아옴

### 증상

E2E 테스트 중 좌석 예약 호출에서 아래 응답이 돌아왔습니다

```text
POST https://dev.go-ti.shop/api/v1/seat-reservations/seats/{seatId}
→ 200 OK, Content-Type: text/html
→ <!DOCTYPE html><html>...<title>Rsbuild App</title>...
```

JWT를 유효하지 않게 넣으면 401 JSON이 정상 반환되는데, **유효한 JWT로 호출하면 200 HTML**이 돌아왔습니다. 응답 헤더에 `x-amz-server-side-encryption: AES256`과 `x-cache: Error from cloudfront`가 찍혀 있어 S3 origin에서 응답이 내려온 흔적이 보였습니다

### 가설 제거 과정

가장 먼저 의심한 것은 CloudFront 캐시였습니다. `/api/*` behavior를 확인했으나 `CachingDisabled`(TTL=0)에 POST도 허용돼 있어 캐시 문제는 아니었습니다

다음으로 Istio VirtualService 경로 누락을 의심했습니다. `/api/v1/seat-reservations` prefix는 ticketing VirtualService에 있었지만 관련 API인 `/api/v1/game-seats` prefix가 누락돼 있었습니다. 다만 이것만으로는 "404가 HTML 200으로 바뀌는" 현상을 설명할 수 없었습니다

---

## 🤔 원인: Custom Error Response는 behavior가 아니라 distribution 레벨

근본 원인은 CloudFront의 Custom Error Response 설정이었습니다

```json
[
  {"ErrorCode": 403, "ResponsePagePath": "/index.html", "ResponseCode": "200"},
  {"ErrorCode": 404, "ResponsePagePath": "/index.html", "ResponseCode": "200"}
]
```

이 설정은 React SPA 라우팅과 Google OAuth 콜백에 반드시 필요해 제거할 수 없었습니다. 문제는 **Custom Error Response가 distribution 레벨 설정이라 특정 behavior만 예외로 둘 수 없다**는 점입니다

흐름을 따라가면 이렇습니다

1. 클라이언트가 `POST /api/v1/seat-reservations/...`를 호출합니다
2. Istio VirtualService에 경로가 없거나 AuthorizationPolicy에서 거부돼 404 또는 403을 반환합니다
3. CloudFront가 이 에러 응답을 가로채 S3의 `index.html`을 대신 내려보냅니다
4. 응답 코드는 200, Content-Type은 `text/html`로 바뀝니다

**API와 프론트엔드가 같은 distribution을 쓰는 한 이 문제는 구조적으로 해결되지 않습니다.** 게다가 이 증상은 백엔드 에러를 성공 응답으로 위장하기 때문에, 진짜 라우팅 오류를 디버깅하는 것 자체를 막고 있었습니다

---

## ✅ 해결: API 전용 도메인 분리

기존에 사용하지 않던 `kind.go-ti.shop` CloudFront 배포를 `api.go-ti.shop`으로 재활용했습니다

- `api.go-ti.shop` → 별도 CloudFront 배포 (Custom Error Response 없음, Kind PC origin 전용)
- Route53 A record를 `d2zfttm14phznh.cloudfront.net`으로 지정
- ACM은 `*.go-ti.shop` 와일드카드 인증서 사용
- E2E 스크립트 `BASE_URL`을 `https://api.go-ti.shop`으로 변경

역할 분리 결과는 다음과 같습니다

| 도메인 | 용도 | Custom Error Response |
|--------|------|----------------------|
| `dev.go-ti.shop` | 프론트엔드(React SPA) | 유지(OAuth 콜백용) |
| `api.go-ti.shop` | API 전용 | 없음(JSON 그대로 반환) |

분리 후 API 404가 JSON 그대로 돌아오게 되었고, 가려져 있던 Istio 라우팅 오류도 즉시 재현할 수 있는 상태가 되었습니다

---

## 📚 교훈

**배포 플랫폼의 전역 설정이 특정 엔드포인트의 의미를 바꿉니다.** CloudFront Custom Error Response처럼 distribution 레벨에 걸린 설정은 API와 프론트엔드를 같은 도메인에 묶는 순간 반드시 충돌합니다. 역할이 다른 트래픽은 처음부터 도메인을 분리하는 편이 안전합니다

**에러를 성공으로 바꾸는 설정이 가장 위험합니다.** 404가 404로 오면 바로 고쳤을 문제인데, 200으로 위장되면서 그 뒤의 라우팅 오류까지 함께 숨었습니다. 상태 코드를 덮어쓰는 설정은 적용 범위를 항상 좁게 잡아야 합니다

### 관련 파일

- `Goti-k8s/infrastructure/dev/istio/gateway/values-dev.yaml` — `api.go-ti.shop` 호스트 추가
- `Goti-k8s/environments/dev/goti-*/values.yaml` — 전 서비스 VirtualService hosts 추가 (6파일)
- `goti-team-controller/scripts/e2e-api-test.sh` — 헬스체크 경로와 `CURL_RESOLVE` 지원
