# 상시 합성 트래픽 (Synthetic Traffic)

최종 업데이트: 2026-03-24

---

## 1. 개요

dev 환경에 **상시 트래픽을 발생**시켜 모니터링 파이프라인(메트릭/로그/트레이스)이 정상 동작하는지 검증하고, Grafana 대시보드에 의미 있는 데이터를 채운다.

- **도구**: K6 (grafana/k6:0.56.0)
- **실행 방식**: Kind 클러스터 내부 CronJob (5분마다 4분간)
- **VU**: 100 (동시 사용자 50~100명 규모)
- **API**: 프론트엔드 실제 사용 패턴 기반 9개 GET + 2개 POST 엔드포인트
- **관리**: Goti-k8s Helm chart + ArgoCD (환경별 `enabled` on/off)

## 2. 트래픽 패턴

프론트엔드(goti-front) 페이지별 API 호출 빈도를 분석하여 가중치를 설정했다.

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
| `POST /api/v1/seat-reservations/seats/{id}` | **7%** | **쓰기** | ticketing | 좌석 HOLD (자연 만료) |
| `POST /api/v1/test/users` | **3%** | **쓰기** | user | 유저 생성 (로그인 시뮬레이션) |

각 호출 사이에 **2~5초 대기** (실제 사용자 브라우징 시뮬레이션).

**쓰기 트래픽 안전성**: 좌석 HOLD는 TTL 만료로 자동 해제되어 데이터 소모 없음.

## 3. 아키텍처

```
┌──────────────────────────────────┐
│  CronJob: synthetic-traffic      │
│  (*/5 * * * *, 4분 duration)     │
│                                  │
│  ┌──────────┐  ┌──────────────┐  │
│  │ K6 (3VU) │  │ istio-proxy  │  │
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

### 보안

| 구성요소 | 설명 |
|----------|------|
| `ServiceAccount: k6-synthetic` | K6 전용 SA |
| `AuthorizationPolicy: allow-k6-synthetic` | k6-synthetic SA → goti 전체 서비스 ALLOW |
| Istio sidecar | mTLS 통신 (STRICT 모드 호환) |
| JWT | setup()에서 테스트 유저 JWT 발급 → 모든 호출에 포함 |

## 4. 파일 구조

```
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

**K8s 리소스는 `synthetic-traffic.yaml` 하나로 관리.** 스크립트는 ConfigMap에 인라인.

## 5. 운영 명령어

### 배포

```bash
kubectl apply -f load-tests/k8s/synthetic-traffic.yaml
```

### 상태 확인

```bash
# CronJob 상태
kubectl get cronjob -n goti synthetic-traffic

# 실행 중인 Job
kubectl get jobs -n goti -l app=synthetic-traffic

# 최근 실행 로그
kubectl logs -n goti -l app=synthetic-traffic -c k6 --tail=50
```

### 수동 실행 (테스트)

```bash
kubectl create job synthetic-traffic-manual \
  --from=cronjob/synthetic-traffic -n goti
```

### 중지

```bash
# CronJob만 중지 (리소스 유지)
kubectl patch cronjob synthetic-traffic -n goti -p '{"spec":{"suspend":true}}'

# 재개
kubectl patch cronjob synthetic-traffic -n goti -p '{"spec":{"suspend":false}}'

# 전체 삭제
kubectl delete -f load-tests/k8s/synthetic-traffic.yaml
```

### 로컬 실행

```bash
# dev.go-ti.shop 대상 (CloudFront 경유)
k6 run load-tests/scenarios/synthetic-traffic.js \
  -e BASE_URL=https://dev.go-ti.shop

# 시간/VU 오버라이드
k6 run load-tests/scenarios/synthetic-traffic.js \
  -e BASE_URL=https://dev.go-ti.shop \
  --duration 1m --vus 1
```

## 6. 스크립트 수정 방법

`synthetic-traffic.yaml`의 ConfigMap `data.synthetic-traffic.js` 부분을 직접 수정 후:

```bash
kubectl apply -f load-tests/k8s/synthetic-traffic.yaml
```

다음 CronJob 실행 시 자동 반영. 즉시 확인하려면 수동 Job 생성.

## 7. 성능 기준

| 지표 | 기준 | 실측 (3VU, 2026-03-24) |
|------|------|----------------------|
| 성공률 | > 95% | **100%** (212/212) |
| p95 응답시간 | < 2000ms | **82ms** |
| 평균 응답시간 | - | **24ms** |
| 4분당 총 호출 수 | - | **~210회** |

100 VU 실측은 ArgoCD 배포 후 확인 예정.

## 8. 전제 조건

- **시드 데이터**: 경기 일정 + 구장 + 좌석 구역이 DB에 존재해야 함
  - `scripts/seed-kbo-data.sh`, `scripts/seed-kbo-games.sh` 실행 완료
- **테스트 유저 API**: `POST /api/v1/test/users` 활성화 (dev 환경 전용)
- **Istio STRICT mTLS**: sidecar inject 필수 (YAML에 설정됨)

## 9. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| iterations 0, 빈 루프 | setup 실패 (서비스 연결 불가) | `kubectl logs -c k6` 확인, SA/AuthzPolicy 점검 |
| `dial: i/o timeout` | sidecar 없이 mTLS 서비스 호출 | `sidecar.istio.io/inject: "true"` 확인 |
| 403 Forbidden | AuthorizationPolicy 누락 | `allow-k6-synthetic` 존재 확인 |
| 401 Unauthorized | JWT 만료 또는 미전달 | setup의 token이 모든 호출에 전달되는지 확인 |
| Job 완료 안 됨 (hang) | sidecar가 종료 안 됨 | `EXIT_ON_ZERO_ACTIVE_CONNECTIONS` annotation 확인 |
| `no exported functions` | ConfigMap 플레이스홀더 잔존 | `kubectl get cm k6-synthetic-scripts -n goti -o yaml` 확인 |
