---
title: "모니터링 파이프라인 검증용 Synthetic Traffic — 대시보드를 살아있게 만드는 CronJob 설계"
excerpt: "부하 도구가 아닙니다. dev 환경 대시보드가 '데이터 없어 비어보이는' 문제를 해소하기 위해 K6 CronJob으로 상시 합성 트래픽을 발생시킨 설계와 운영 기록입니다."
category: monitoring
tags:
  - go-ti
  - Synthetic-Traffic
  - Observability
  - CronJob
  - k6
  - troubleshooting
series:
  name: "goti-loadtest"
  order: 1
date: "2026-03-24"
---

## 한 줄 요약

> 메트릭/로그/트레이스/대시보드가 살아있는지 확인하기 위해 K6 CronJob으로 상시 합성 트래픽을 구성했습니다. 부하 테스트 도구가 아니라 모니터링 파이프라인 검증 장치입니다.

---

## 배경: 대시보드가 비어보이는 문제

MSA 전환과 모니터링 안정화(Phase 1.5 ~ 2)를 마치고 나면 한 가지 문제가 반복됩니다.

**대시보드에 데이터가 없습니다.**

서비스는 올라가 있는데 아무도 호출하지 않으면 메트릭이 쌓이지 않습니다.
Grafana 대시보드를 열면 패널이 비어 있고, 쿼리가 올바른지 파이프라인이 끊겼는지 구분이 안 됩니다.
이 상태에서 새 대시보드를 만들거나 LogQL/TraceQL을 검증하는 것은 사실상 불가능합니다.

해결 방법은 단순합니다.
상시 트래픽을 만들어두면 됩니다.

단, 이 트래픽은 **부하 테스트가 아닙니다.**
1000 VU를 던져 한계를 측정하는 것이 아니라, 실제 사용 패턴과 유사한 요청을 지속적으로 흘려보내 파이프라인이 정상 동작하는지 확인하는 것이 목적입니다.

이 글은 그 설계와 운영 방법을 기록합니다.

---

## 구성 개요

- **도구**: K6 (`grafana/k6:0.56.0`)
- **실행 방식**: Kind 클러스터 내부 CronJob (`*/5 * * * *`, 4분간 실행)
- **VU**: 100 (동시 사용자 50~100명 규모 시뮬레이션)
- **API 범위**: 프론트엔드 실제 호출 빈도 기반 9개 GET + 2개 POST
- **관리**: `goti-k8s` Helm chart + ArgoCD (`enabled` on/off로 환경별 제어)

5분마다 CronJob이 기동되고, 4분 동안 트래픽을 발생시킨 뒤 종료합니다.
다음 실행은 1분 뒤에 다시 시작됩니다.
이 주기가 유지되는 한 Grafana 대시보드에는 항상 최근 데이터가 존재합니다.

---

## 트래픽 패턴

프론트엔드(`goti-front`) 페이지별 API 호출 빈도를 분석하여 가중치를 설정했습니다.
실제 사용자가 어떤 비율로 어떤 API를 호출하는지를 반영한 것입니다.

| API | 비중 | 타입 | 대상 서비스 | 프론트 페이지 |
|-----|------|------|------------|-------------|
| `GET /api/v1/games/schedules` | 22% | 조회 | ticketing | 홈, 티켓목록 |
| `GET /api/v1/baseball-teams/{id}` | 8% | 조회 | stadium | 홈 (팀 정보) |
| `GET /api/v1/stadium-seats/.../seat-grades` | 13% | 조회 | ticketing | 구역 선택 |
| `GET /api/v1/stadium-seats/.../seat-sections` | 9% | 조회 | ticketing | 구역 선택 |
| `GET /api/v1/teams/{id}/ticket-pricing-policies` | 5% | 조회 | ticketing | 구역 선택 (가격) |
| `GET /api/v1/seats/seat-sections/{id}/seats` | 9% | 조회 | ticketing | 좌석맵 |
| `GET /api/v1/game-seats/{id}/sections/{id}/seat-statuses` | 14% | 조회 | ticketing | 좌석 상태 |
| `GET /api/v1/orders` | 5% | 조회 | ticketing | 마이페이지 |
| `GET /api/v1/games/schedules?today=true` | 5% | 조회 | ticketing | 오늘 경기 |
| `POST /api/v1/seat-reservations/seats/{id}` | **7%** | 쓰기 | ticketing | 좌석 HOLD |
| `POST /api/v1/test/users` | **3%** | 쓰기 | user | 유저 생성 (로그인 시뮬레이션) |

가중치 합계는 100%입니다.
홈 화면 진입과 좌석 선택 흐름이 상대적으로 비중이 높습니다.
이는 실제 티켓팅 서비스에서 대부분의 사용자가 경기 조회 → 구역 선택 → 좌석맵 확인 순서로 이동하는 패턴을 반영한 결과입니다.

각 호출 사이에는 **2~5초 대기**를 넣었습니다.
브라우저에서 사용자가 페이지를 읽고 다음 동작을 취하는 속도를 흉내낸 것입니다.
대기 없이 연속 호출하면 실제 사용 패턴과 다른 메트릭이 나오고, 파이프라인 검증이 아닌 스트레스 테스트가 되어버립니다.

**쓰기 트래픽 안전성**에 대해 설명합니다.
POST 요청이 2개 포함되어 있지만 모두 데이터 소모가 없습니다.

- **좌석 HOLD**: TTL 만료로 자동 해제됩니다. 실제 좌석이 점유되지 않습니다.
- **테스트 유저 생성**: dev 환경 전용 API입니다. prod에서는 비활성화되어 있습니다.

---

## 아키텍처

```text
┌──────────────────────────────────┐
│  CronJob: synthetic-traffic      │
│  (*/5 * * * *, 4분 duration)     │
│                                  │
│  ┌──────────┐  ┌──────────────┐  │
│  │ K6 (VU)  │  │ istio-proxy  │  │
│  │          │──│  (sidecar)   │  │
│  └──────────┘  └──────┬───────┘  │
│                       │ mTLS     │
└───────────────────────┼──────────┘
                        │
          ┌─────────────┼──────────────┐
          │             │              │
          ▼             ▼              ▼
   goti-ticketing  goti-user    goti-stadium
     (8080)         (8080)        (8080)
```

CronJob 내부에 K6 컨테이너와 Istio sidecar 컨테이너가 함께 뜹니다.
Istio STRICT mTLS 모드로 운영 중인 goti 네임스페이스에 접근하려면 sidecar가 반드시 inject되어야 합니다.
sidecar 없이 클러스터 내부 서비스를 직접 호출하면 연결이 차단됩니다.

### 보안 구성

| 구성요소 | 설명 |
|----------|------|
| `ServiceAccount: k6-synthetic` | K6 전용 ServiceAccount |
| `AuthorizationPolicy: allow-k6-synthetic` | k6-synthetic SA → goti 전체 서비스 ALLOW |
| Istio sidecar | mTLS 통신 (STRICT 모드 호환) |
| JWT | `setup()`에서 테스트 유저 JWT 발급 → 모든 호출에 포함 |

보안 구성을 한 줄로 정리하면, K6 전용 ServiceAccount를 만들고 해당 SA에서 오는 요청만 goti 서비스로 통과시키는 AuthorizationPolicy를 적용했습니다.
JWT는 `setup()` 단계에서 테스트 유저를 생성하고 토큰을 발급받아 VU 전체가 공유합니다.

---

## 파일 구조

```text
load-tests/
├── k8s/
│   └── synthetic-traffic.yaml      # K8s 리소스 전체 (SA + AuthzPolicy + ConfigMap + CronJob)
├── scenarios/
│   └── synthetic-traffic.js        # 로컬 실행용 스크립트 (동일 로직)
├── config/
│   └── environments.js             # 환경 설정 (k8s-internal 포함)
└── helpers/
    ├── http-client.js
    ├── auth.js
    └── data-setup.js
```

K8s 리소스는 `synthetic-traffic.yaml` 하나로 관리합니다.
K6 스크립트는 ConfigMap에 인라인으로 포함되어 있어, 스크립트를 수정하면 `kubectl apply` 한 번으로 다음 CronJob 실행에 반영됩니다.

---

## 운영 명령어

### 배포

```bash
kubectl apply -f load-tests/k8s/synthetic-traffic.yaml
```

### 상태 확인

```bash
# CronJob 상태 확인
kubectl get cronjob -n goti synthetic-traffic

# 실행 중인 Job 목록
kubectl get jobs -n goti -l app=synthetic-traffic

# 최근 실행 로그 (마지막 50줄)
kubectl logs -n goti -l app=synthetic-traffic -c k6 --tail=50
```

### 수동 실행 (즉시 테스트)

```bash
kubectl create job synthetic-traffic-manual \
  --from=cronjob/synthetic-traffic -n goti
```

### 일시 중지 / 재개 / 삭제

```bash
# CronJob 일시 중지 (리소스 유지)
kubectl patch cronjob synthetic-traffic -n goti -p '{"spec":{"suspend":true}}'

# CronJob 재개
kubectl patch cronjob synthetic-traffic -n goti -p '{"spec":{"suspend":false}}'

# 전체 삭제
kubectl delete -f load-tests/k8s/synthetic-traffic.yaml
```

### 로컬 실행

```bash
# dev.go-ti.shop 대상 (CloudFront 경유)
k6 run load-tests/scenarios/synthetic-traffic.js \
  -e BASE_URL=https://dev.go-ti.shop

# duration/VU 오버라이드
k6 run load-tests/scenarios/synthetic-traffic.js \
  -e BASE_URL=https://dev.go-ti.shop \
  --duration 1m --vus 1
```

---

## 스크립트 수정 방법

`synthetic-traffic.yaml`의 ConfigMap `data.synthetic-traffic.js` 부분을 직접 수정합니다.

```bash
kubectl apply -f load-tests/k8s/synthetic-traffic.yaml
```

다음 CronJob 실행 시 자동 반영됩니다.
즉시 확인하려면 수동 Job을 생성합니다.

---

## 성능 기준

초기 검증은 3 VU로 진행했습니다.

| 지표 | 기준 | 실측 (3VU, 2026-03-24) |
|------|------|----------------------|
| 성공률 | > 95% | **100%** (212/212) |
| p95 응답시간 | < 2000ms | **82ms** |
| 평균 응답시간 | — | **24ms** |
| 4분당 총 호출 수 | — | **약 210회** |

이 수치는 파이프라인 검증 목적이므로 성능 한계와는 무관합니다.
중요한 것은 성공률입니다.
성공률이 95% 미만이면 서비스 연결 문제 또는 인증 설정 오류를 먼저 의심합니다.

100 VU 실측은 ArgoCD 배포 완료 후 확인 예정입니다.

---

## 전제 조건

이 CronJob이 정상 동작하려면 다음이 선행되어야 합니다.

- **시드 데이터**: 경기 일정, 구장, 좌석 구역 데이터가 DB에 존재해야 합니다. `scripts/seed-kbo-data.sh`와 `scripts/seed-kbo-games.sh` 실행이 필요합니다
- **테스트 유저 API**: `POST /api/v1/test/users` 엔드포인트가 dev 환경에서 활성화되어 있어야 합니다
- **Istio STRICT mTLS**: sidecar inject가 필수입니다. YAML에 설정이 포함되어 있습니다

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| iterations 0, 빈 루프 | setup() 실패 (서비스 연결 불가) | `kubectl logs -c k6` 확인, SA/AuthzPolicy 점검 |
| `dial: i/o timeout` | sidecar 없이 mTLS 서비스 호출 | `sidecar.istio.io/inject: "true"` 설정 확인 |
| 403 Forbidden | AuthorizationPolicy 누락 | `allow-k6-synthetic` 리소스 존재 여부 확인 |
| 401 Unauthorized | JWT 만료 또는 미전달 | setup()의 token이 모든 VU에 전달되는지 확인 |
| Job 완료 안 됨 (hang) | sidecar가 종료되지 않음 | `EXIT_ON_ZERO_ACTIVE_CONNECTIONS` annotation 확인 |
| `no exported functions` | ConfigMap 플레이스홀더 잔존 | `kubectl get cm k6-synthetic-scripts -n goti -o yaml` 확인 |

증상별로 가장 자주 발생하는 경우는 **sidecar 미주입**과 **AuthorizationPolicy 누락** 두 가지입니다.
CronJob을 처음 배포할 때 이 두 가지를 먼저 점검하면 대부분의 연결 오류를 해소할 수 있습니다.

---

## 📚 배운 점

### 파이프라인 검증과 부하 테스트는 다른 도구입니다

부하 테스트는 한계를 찾는 것이고, 파이프라인 검증은 정상 동작을 확인하는 것입니다.
이 둘을 같은 도구로 구성하되 목적을 명확히 구분하지 않으면, 대시보드가 "과부하 상태의 데이터"로 채워지거나 반대로 데이터가 전혀 없는 상태가 반복됩니다.
synthetic traffic은 실제 사용 패턴 수준의 트래픽을 상시 유지하는 것이 핵심입니다.

### 쓰기 트래픽을 안전하게 포함하는 방법이 있습니다

PUT/DELETE 없이 POST만 쓰고, 그 POST도 TTL 만료로 자동 해제되는 HOLD와 dev 전용 테스트 유저 생성으로 한정했습니다.
이렇게 하면 데이터 소모 없이 쓰기 경로의 메트릭과 트레이스까지 검증할 수 있습니다.

### Istio STRICT 모드에서 CronJob 트래픽을 허용하는 패턴

CronJob에 전용 ServiceAccount를 부여하고, AuthorizationPolicy에서 해당 SA를 명시적으로 허용하는 방식이 가장 안전합니다.
네임스페이스 레벨 ALLOW-ALL은 보안 정책을 우회하고, Principal 없는 규칙은 mTLS 환경에서 동작하지 않습니다.

### sidecar 종료 문제는 annotation으로 해결합니다

Istio sidecar가 포함된 Pod에서 main 컨테이너가 완료되어도 sidecar가 살아있으면 Job이 완료 상태가 되지 않습니다.
`EXIT_ON_ZERO_ACTIVE_CONNECTIONS` annotation을 추가하면 K6가 종료될 때 sidecar도 함께 종료됩니다.
CronJob에 sidecar를 inject할 때는 이 annotation이 필수입니다.
