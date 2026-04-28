---
title: "GCP bring-up 트러블 체인 — 8단계 연쇄 장애 해소 기록"
excerpt: "AWS → GCP 마이그레이션 당일 마주친 8개 독립 이슈의 복합 장애. arm64 이미지부터 Istio default-deny, pg_restore FK 제약까지 6시간의 실전 트러블 체인"
category: kubernetes
tags:
  - go-ti
  - Multi-Cloud
  - GCP
  - Troubleshooting
  - Bringup
series:
  name: "goti-multicloud"
  order: 3
date: "2026-04-14"
---

## 한 줄 요약

> GCP prod-gcp bring-up 당일 **8개 독립 이슈가 복합**으로 발생했습니다. arm64/amd64 미스매치, viper defaults 누락, GCP quota, Istio gatewayRef/host 오기재, `goti-istio-policy` 누락, pg_restore FK 제약까지 — 6시간 만에 공개 API 200까지 복원한 연쇄 트러블슈팅 기록입니다.

## Impact

- **영향 범위**: prod-gcp 클러스터 전체 MSA 6종, 공개 API 진입점, DB 데이터 이관
- **증상**: ImagePullBackOff, CrashLoopBackOff, 403 RBAC, pg_restore 실패
- **소요 시간**: 약 6시간 (04:17-10:17 KST)
- **발생일**: 2026-04-13

---

## 🔥 문제: 빈 GKE 클러스터에서 한꺼번에 터진 8가지 장애

AWS → GCP 마이그레이션 bring-up 당일 세션이었습니다.
Goti-go의 6개 MSA(user/stadium/ticketing/payment/resale/queue)를 GKE prod-gcp 클러스터에 배포하고, AWS RDS → GCP Cloud SQL로 DB를 이식하고, Cloudflare → Istio 경로까지 end-to-end로 검증해야 했습니다.

### 초기 증상 스냅샷

```
goti-load-observer    ImagePullBackOff  (tag dev-9-ee6198a not in GAR)
goti-queue-gate       ImagePullBackOff  (tag bootstrap-20260413 not in GAR)
goti-ticketing (x2)   CrashLoopBackOff  panic: non-positive interval for NewTicker
goti-queue            아예 배포 안 됨 (ApplicationSet 누락)
```

queue가 배포되지 않은 문제부터 해결하자 다음 증상이 드러났습니다.

```
goti-queue            ImagePullBackOff  "no match for platform in manifest"
```

노드를 늘려보려 했지만 scale-up 자체가 실패했습니다.

```
FailedScaleUp: GCE quota exceeded (Quota 'SSD_TOTAL_GB' exceeded. Limit: 300)
```

Cloudflare 경로를 뚫으려 하자 또 다른 에러가 이어졌습니다.

- HTTP/2 525 (SSL handshake failed)
- HTTP/2 404 (no route)
- HTTP/2 403 `RBAC: access denied` (Istio default-deny)

마지막으로 DB restore 단계에서 권한 에러가 쏟아졌습니다.

```
pg_restore: COPY failed for seat_statuses: FK constraint violation
pg_restore: permission denied: RI_ConstraintTrigger is a system trigger
ERROR: permission denied to set parameter "session_replication_role"
```

재현 조건은 단순합니다. **빈 GKE 클러스터 + 매니지드 DB + Cloudflare proxy orange-cloud** 환경에서의 첫 배포입니다.

---

## 🤔 오진 기록: 세 번의 가설이 틀렸던 이유

본격적으로 근본 원인을 다루기 전에, 먼저 잘못 짚었던 가설 세 개를 짚고 넘어가겠습니다.

| # | 가설 | 결과 | 소요 | 교훈 |
|---|------|------|------|------|
| 1 | CPU quota 초과가 queue pod Pending 원인 | rejected — 실제 원인은 `SSD_TOTAL_GB` quota 초과로 신규 노드 생성 불가 | 15min | `kubectl get events -n kube-system` 먼저 확인. autoscaler가 구체적 quota 이름을 로그에 남김 |
| 2 | falco 제거하면 노드 확보됨 | rejected — CPU 600m 회수는 맞지만 새 노드 추가는 여전히 SSD quota에 막힘 | 20min | 노드별 Allocated vs Pod request 계산 먼저. cluster-level 여유 ≠ node-level 여유 |
| 3 | Cloudflare Automatic SSL이 AWS에서도 자동 설정돼 있었을 것 | partial — 맞지만 Automatic이 origin probe 결과에 따라 Full로 승격시킬 수 있는 간헐적 버그 가능 | 5min | Cloudflare Automatic은 zone-level이며 probe 기반. 명시적 고정이 운영 안정성에 유리 |

세 가설 모두 **상위 계층 증상만 보고 짐작**한 공통점이 있습니다.
실제 autoscaler events를 읽었다면 처음부터 SSD quota를 원인으로 지목할 수 있었고, 노드별 allocated 리소스를 계산했다면 falco 제거만으로 부족하다는 사실도 미리 알 수 있었습니다.

---

## 🤔 원인: 8개 독립 이슈의 복합

전체 장애는 서로 연결된 하나의 문제가 아니라, **8개의 독립 이슈가 같은 시점에 겹친 것**이었습니다. 각 단계를 하나씩 살펴보겠습니다.

### 1. arm64/amd64 이미지 미스매치

Mac(Apple Silicon)에서 `docker build`를 실행하면 이미지 manifest가 arm64로 태깅됩니다.
Dockerfile 안에 `GOARCH=amd64`를 써 두더라도 그 설정은 **바이너리만** amd64로 컴파일할 뿐, manifest는 빌드 머신 플랫폼을 기준으로 찍힙니다.

그 결과 GKE 노드(linux/amd64)가 이미지를 pull할 때 `ErrImagePull: no match for platform in manifest`로 실패합니다.

근본 해결은 `docker buildx build --platform linux/amd64 --push` 사용입니다.
일반 `docker build`는 cross-platform 빌드를 하지 않습니다.

### 2. viper ticketing.* defaults 누락

`pkg/config/config.go`의 `setDefaults()`에 `queue.*`, `resale.*`는 있었지만 **`ticketing.*`가 완전히 빠져 있었습니다**.

viper의 `AutomaticEnv()`는 **SetDefault 또는 BindEnv로 등록된 key만** env var lookup을 수행합니다.
이 사실을 모르면 Helm values에 env var만 주입해도 동작할 것이라 기대하기 쉽습니다.

실제 흐름을 단계별로 풀면 다음과 같습니다.

1. Helm values가 `TICKETING_TICKETING_HOLD_EXPIRY_INTERVAL_MS=1000`을 주입합니다
2. viper는 해당 key를 SetDefault/BindEnv로 등록하지 않았으므로 무시합니다
3. Unmarshal 시 zero value (0)이 들어갑니다
4. `time.NewTicker(0)`이 `panic: non-positive interval for NewTicker`로 터집니다

Goti-k8s 커밋 `664a39f`에서 env var만 주입했던 시도가 왜 무효했는지, 이 구조를 이해하면 바로 설명이 됩니다.
**viper의 정적 binding 필요성**이 핵심입니다. Unmarshal + nested struct + AutomaticEnv는 자동 매핑되지 않습니다.

### 3. GCP SSD_TOTAL_GB quota 300GB 소진

GKE 노드의 부팅 디스크는 PD-SSD 기반입니다.
5 노드 × 약 60GB = **정확히 300GB**로 quota가 소진되었습니다.

새 노드 생성 시 quota 초과로 cluster-autoscaler의 scale-up이 전부 실패했습니다.
300 → 1000GB 1차 증설 요청을 했지만 **48시간 대기 정책으로 자동 거절**되었습니다.

원인은 단순합니다. 무료 → 유료 전환 직후 48시간 trust window가 존재합니다.
사유와 무관하게 자동 거절됩니다. 당일 대응책은 monitoring 전체를 off로 내려 노드 압박을 완화하는 방향밖에 없었습니다.

### 4. Istio VS `gatewayRef` namespace 오기재

VS 매니페스트에 `gatewayRef: istio-system/goti-shared-gateway`가 들어 있었지만, 실제 Gateway는 `istio-ingress/goti-shared-gateway`에 있었습니다.

AWS prod에서는 Gateway를 istio-system에 배포했습니다.
반면 GCP에서는 istio-ingress에 배포했습니다 (이 배치 차이는 bootstrap Terraform 결정사항입니다).

VS 정의의 절대 경로 참조가 AWS 복사본 그대로 남아 있었던 것입니다.
**환경 간 namespace 위치 차이를 values에 반영하지 않은** 것이 근본 원인입니다.

### 5. Istio VS `destination.host` service name 오기재

`host: goti-{svc}-prod`로 적혀 있었지만 실제 Service는 `goti-{svc}-prod-gcp`였습니다.
Helm chart에 `fullnameOverride`가 없어서 release name이 host 이름에 포함된 결과입니다.

VS destination이 존재하지 않는 service를 참조하면, Istio는 503이 아닌 **route match 실패로 처리해 404를 반환**합니다.
Helm release name에 환경 접미어가 들어가면 VS 대상도 동적으로 바뀌어야 한다는 점을 놓쳤습니다.

### 6. `goti-istio-policy` Application이 prod-gcp에 완전 부재 (가장 중요)

이번 트러블 체인에서 **가장 크리티컬한 원인**입니다.

AWS prod에는 `gitops/prod/applicationsets/goti-istio-policy.yaml`이 있어서 `allow-istio-gateway` AuthorizationPolicy가 배포되었습니다.
prod-gcp에는 **해당 ApplicationSet 자체가 존재하지 않았습니다**.

한편 goti-common chart의 `_authorizationpolicy.tpl`은 서비스마다 `from-mesh-internal` ALLOW를 자동 생성합니다.
Istio semantics상 **ALLOW 규칙이 하나라도 있으면 default-deny가 활성화**됩니다.

결국 Gateway → service 트래픽을 허용하는 ALLOW가 어디에도 없는 상태가 되었고, 모든 외부 요청이 **403 RBAC**로 차단되었습니다.

근본 원인은 멀티 환경 ApplicationSet 복제 시 `goti-istio-policy`를 누락한 것입니다.
chart 정책과 환경 정책이 분리된 구조가 이런 사각지대를 만들었습니다.

### 7. `goti-istio-policy` values `gatewaySA` AWS 하드코딩

6번 문제를 고치려 ApplicationSet을 추가했는데, `values.yaml`의 `gatewaySA`가 AWS에 하드코딩되어 있었습니다.

```yaml
gatewaySA: "cluster.local/ns/istio-system/sa/istio-gateway"  # AWS namespace
```

GCP의 실제 SA는 `istio-ingress/sa/istio-gateway`입니다.
`allow-istio-gateway` AP의 principals에 매칭되지 않아 여전히 403이 떴습니다.

환경별 SA principal override가 필요합니다. `values-gcp.yaml`로 분리했습니다.

### 8. pg_restore FK 제약 + session_replication_role 차단

Cloud SQL의 `goti` 유저는 `cloudsqlsuperuser` 역할이지만 **진짜 superuser는 아닙니다**.

- `ALTER TABLE DISABLE TRIGGER ALL` 권한 없음 (RI_ConstraintTrigger는 시스템 트리거)
- `SET session_replication_role = replica`도 권한 거부 (AWS RDS의 rds_superuser도 동일)

pg_restore의 `--disable-triggers` 옵션은 내부적으로 위 명령에 의존합니다.
즉 명령이 실패하면서 FK violation으로 COPY가 중단됩니다.

**매니지드 PG 간 마이그레이션은 FK drop → data restore → FK recreate 패턴이 필수**라는 사실을 확인한 순간이었습니다.

---

## ✅ 해결: 8개 이슈별 PR 매핑

각 이슈를 별도 PR로 분리해 처리했습니다.

| # | 이슈 | PR | 핵심 변경 |
|---|---|---|---|
| 1 | queue 누락 | Goti-k8s#198 | goti-msa-appset + prod-gcp/goti-queue/values.yaml 신규 |
| 2 | arm64 이미지 | Goti-k8s#199 | buildx amd64 재빌드 → `bootstrap-20260414-amd64` 태그 |
| 3 | CPU quota 완화 | Goti-k8s#200 | falco Application 제외 (goti-gcp-infra-ops exclude 추가) |
| 4 | 전체 monitoring off | Goti-k8s#201 | monitoring-appset elements 빈 리스트 |
| 5 | viper ticketing defaults | Goti-go#2 + Goti-k8s#202 | setDefaults에 ticketing.* 10개 추가 + HoldExpiryInterval guard |
| 6 | gcp-api 서브도메인 | Goti-k8s#203 | 7개 values.yaml hosts에 `gcp-api.go-ti.shop` 추가 |
| 7 | VS gatewayRef + host | Goti-k8s#204 | istio-system → istio-ingress, goti-X-prod → goti-X-prod-gcp |
| 8 | goti-istio-policy 누락 | Goti-k8s#205 | Application + values-gcp.yaml 신규 (gatewaySA override) |

### 추가 수동 작업

PR만으로는 마무리되지 않는 운영 작업도 있었습니다.

- Goti-go 이미지를 수동으로 빌드+푸시 (CD 워크플로는 `GCP_WIF_PROVIDER` secret 미설정으로 실패)
- `kubectl delete namespace falco` (Application이 finalizer 없이 제거된 이후의 orphan cleanup)
- GRANT 문 실행 (5개 `goti_{svc}_ro` 유저에게 INSERT/UPDATE/DELETE/sequence 권한 부여)
- DB FK drop → data-only pg_restore → FK recreate (진행 중)
- AWS RDS public access 임시 window (SG + route + publicly-accessible 토글)
- GCP Cloud SQL public IP 임시 window (`gcloud sql instances patch --assign-ip --authorized-networks`)
- Cloudflare SSL/TLS 모드 Automatic → **Flexible** (zone level 고정)

### 검증 결과

모든 서비스가 Running 상태로 돌아왔습니다.

```bash
goti-user          3/3 Running
goti-stadium       2/2 Running
goti-ticketing     2/2 Running   # viper fix 적용
goti-payment       2/2 Running
goti-resale        2/2 Running
goti-queue         2/2 Running   # 신규 배포
```

공개 API도 정상 응답을 돌려주었습니다.

```bash
$ curl -X POST https://gcp-api.go-ti.shop/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"x","password":"y"}'
{"code":"BAD_REQUEST","message":"잘못된 요청입니다."}   # 앱 validation 응답, 정상

$ curl https://gcp-api.go-ti.shop/api/v1/members/me
RBAC: access denied   # JWT 없는 protected path, 정상 차단
```

DB는 스키마 41 테이블 복원이 완료되었고, 데이터 restore는 seat_statuses 3.6M rows 기준 87% 진행 중이었습니다.

### 회귀 테스트 / 재발 방지책

장기적으로 같은 체인이 반복되지 않도록 재발 방지 항목을 정리했습니다.

| 대응 | 상태 |
|---|---|
| `docker buildx` CI 표준화 (CD 워크플로 활성화 필요) | TODO: `project_gcp_ci_wif_todo.md` |
| viper defaults lint 룰 (mapstructure 필드 vs setDefaults diff 체크) | TODO (논의 필요) |
| prod-gcp ApplicationSet vs prod ApplicationSet diff 정기 점검 | TODO (env-diff CI 스크립트) |
| Cloudflare SSL mode 명시적 고정 (Flexible) | 적용 완료 |
| SSD/CPU quota monitoring alert | TODO (quota 승인 후) |
| FK drop/recreate 마이그레이션 스크립트 보관 | TODO (`scripts/migrate-pg-managed.sh`) |
| AuthorizationPolicy 렌더링 diff 검증 (helm template + conftest) | TODO (장기) |

### 비용/시간 메트릭

- 총 소요: 약 6시간 (04:17-10:17 KST)
- AWS egress: 약 1.9GB dump 전송, 무료 tier 안
- GCP Cloud SQL public IP window: 약 40분 (allowlist 내 IP만)
- AWS RDS public window: 약 10분 + 30분(재오픈) = 40분
- 수동 개입 횟수: 8회 (kubectl delete, docker push 2회, GRANT, 임시 SG rule, 임시 route, gcloud patch 2회)

---

## 📚 배운 점

### 1. 환경 간 ApplicationSet 복제 시 전수 diff가 필수입니다

한 개만 빠져도 Istio default-deny처럼 **catastrophic한 장애**가 됩니다.
`goti-istio-policy` 하나가 빠진 것 때문에 전체 API가 403으로 죽었습니다.
CI에서 prod ApplicationSet과 prod-gcp ApplicationSet diff를 자동으로 비교해야 합니다.

### 2. 매니지드 PG 마이그레이션은 FK drop/recreate 패턴을 기본으로 씁니다

Cloud SQL도, AWS RDS도 **진짜 superuser 권한은 주지 않습니다**.
`DISABLE TRIGGER ALL`이나 `session_replication_role = replica`가 막힙니다.
pg_restore `--disable-triggers`에 기대지 말고, 처음부터 FK drop → data restore → FK recreate 스크립트를 준비해야 합니다.

### 3. Mac 로컬 docker build는 cross-platform에서 실패합니다

Apple Silicon에서 `docker build`는 arm64 manifest를 만듭니다.
`GOARCH=amd64`는 바이너리에만 영향을 줍니다.
`docker buildx build --platform linux/amd64 --push`가 유일한 정답입니다.

### 4. viper AutomaticEnv는 SetDefault 선행이 필수입니다

viper는 SetDefault/BindEnv로 등록된 key만 env var lookup을 수행합니다.
nested struct에 대한 env 자동 매핑은 없습니다.
Unmarshal + nested + AutomaticEnv 조합을 쓸 거라면 **setDefaults 함수에 모든 key를 등록**해야 합니다.

### 5. Cloudflare Automatic SSL mode는 간헐 버그 가능성이 있습니다

Automatic은 zone-level이고 origin probe 기반으로 동작합니다.
probe 결과에 따라 Full로 승격될 수 있는 간헐적 버그 가능성이 있어, **명시적 Flexible/Full 고정**이 운영 안정성에 유리합니다.

### 6. GCP 무료 → 유료 전환 직후 48h quota trust window가 존재합니다

사유와 무관하게 자동 거절됩니다.
이 사실을 몰랐다가 당일 quota 증설 요청을 넣으면 무조건 막힙니다.
유료 전환을 미리 해두고 48시간을 기다린 뒤 quota 증설을 요청하는 순서가 맞습니다.

### 7. cluster-autoscaler 실패 원인은 autoscaler 자체 events로 확인합니다

상위 계층 증상(Pod Pending)만 보면 CPU 부족으로 오해하기 쉽습니다.
`kubectl get events -n kube-system`에 autoscaler가 구체적 quota 이름(`SSD_TOTAL_GB`)을 로그로 남깁니다.
화면 Stat만 보지 말고 **autoscaler events를 먼저 읽는 습관**이 시간을 절약합니다.
