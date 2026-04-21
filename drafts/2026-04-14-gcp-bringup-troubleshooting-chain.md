---
date: 2026-04-14
category: troubleshoot
project: Goti-k8s / Goti-go / Goti-Terraform
tags: [gcp, istio, cloudflare, postgres, rbac, quota, amd64, viper, cert-manager, fk-constraint]
failure_type: [env-difference, manual-config-blind, dependency-unknown, context-missing]
misdiagnosis_count: 3
time_to_resolve: 6h
related_changes: [Goti-k8s#198, Goti-k8s#199, Goti-k8s#200, Goti-k8s#201, Goti-k8s#202, Goti-k8s#203, Goti-k8s#204, Goti-k8s#205, Goti-go#2]
---

# GCP prod-gcp bring-up 트러블슈팅 체인 — 8단계 장애 해소

## Context

2026-04-13 AWS → GCP 마이그레이션 bring-up 당일 세션. Goti-go 6개 MSA(user/stadium/ticketing/payment/resale/queue)를 GKE prod-gcp 클러스터에 배포하고, AWS RDS에서 GCP Cloud SQL로 DB 이식, Cloudflare → Istio 트래픽 경로 구성까지 end-to-end 검증을 수행했다. 초기 상태: **queue 서비스 누락 + 3개 서비스 CrashLoop/ImagePullBackOff + 전체 API 403**. 최종 상태: **6/6 Running + 공개 API 200**.

GCP 계정은 당일 무료→유료 전환됨 → quota 제약(SSD 300GB, CPUS_ALL_REGIONS 16) 지속 간섭. `kubectl delete namespace falco` / `GRANT` 같은 수동 개입 포함.

## Issue

초기 증상 스냅샷:

```
goti-load-observer    ImagePullBackOff  (tag dev-9-ee6198a not in GAR)
goti-queue-gate       ImagePullBackOff  (tag bootstrap-20260413 not in GAR)
goti-ticketing (x2)   CrashLoopBackOff  panic: non-positive interval for NewTicker
goti-queue            ❌ 아예 배포 안 됨 (ApplicationSet 누락)

# 이후 queue 배포 후
goti-queue            ImagePullBackOff  "no match for platform in manifest"

# 이후 노드 scale-up 불가
FailedScaleUp: GCE quota exceeded (Quota 'SSD_TOTAL_GB' exceeded. Limit: 300)

# 이후 Cloudflare 접근
HTTP/2 525  (SSL handshake failed)
→ HTTP/2 404 (no route)
→ HTTP/2 403 RBAC: access denied  (Istio default-deny)

# DB restore
pg_restore: COPY failed for seat_statuses: FK constraint violation
pg_restore: permission denied: RI_ConstraintTrigger is a system trigger
ERROR: permission denied to set parameter "session_replication_role"
```

재현: 빈 GKE 클러스터 + 매니지드 DB + Cloudflare proxy orange-cloud 환경 첫 배포.

## Action

### 오진 기록 (Misdiagnosis Log)

| # | 가설 | 결과 | 소요 | 교훈 |
|---|------|------|------|------|
| 1 | **CPU quota 초과가 queue pod Pending 원인** | rejected — 실제 원인은 `SSD_TOTAL_GB` quota 초과로 신규 노드 생성 불가. 기존 노드 CPU는 tight하지만 주된 블로커는 스토리지 | 15min | `kubectl get events -n kube-system` 먼저 확인 — autoscaler가 구체적 quota 이름을 로그에 남김. 화면 Stat만 보지 말 것 |
| 2 | **falco 제거하면 노드 확보됨** | rejected — falco 제거로 CPU 600m 회수는 맞지만 **새 노드 추가는 여전히 SSD quota에 막힘**. 기존 노드에 200m 연속 여유 없음 → pod 스케줄링 여전히 실패 | 20min | 노드별 `Allocated resources` vs Pod request 계산 먼저. cluster-level 여유 ≠ node-level 여유 |
| 3 | **Cloudflare `Automatic SSL`이 AWS에서도 자동 설정돼 있었을 것** | partial — 맞지만 Automatic이 origin probe 결과에 따라 **Full로 승격시킬 수 있는 간헐적 버그** 가능. 명시적 Flexible 설정이 안전 | 5min | Cloudflare Automatic 모드는 zone-level이며 probe 기반. 명시적 고정이 운영 안정성에 유리 |

### 근본 원인 (Root Cause)

전체 장애가 **8개 독립 이슈의 복합**이었음. 각 단계별:

1. **arm64/amd64 이미지 미스매치**
   - Mac(Apple Silicon)에서 `docker build` → 이미지 manifest가 arm64로 태깅
   - Dockerfile 내 `GOARCH=amd64`는 바이너리만 amd64 컴파일, manifest는 빌드 머신 플랫폼 기준
   - GKE 노드(linux/amd64) → `ErrImagePull: no match for platform in manifest`
   - **근본**: `docker buildx build --platform linux/amd64 --push` 필요. 일반 `docker build`는 cross-platform 안 됨

2. **viper ticketing.* defaults 누락**
   - `pkg/config/config.go setDefaults()`에 `queue.*`, `resale.*`는 있으나 **`ticketing.*`가 완전히 빠짐**
   - viper `AutomaticEnv()`는 **SetDefault/BindEnv로 등록된 key만** env var lookup 수행
   - Helm values의 `TICKETING_TICKETING_HOLD_EXPIRY_INTERVAL_MS=1000` 주입 → viper가 key를 모름 → 무시 → zero value (0) → `time.NewTicker(0)` panic
   - Goti-k8s 커밋 `664a39f`에서 env var만 주입했던 시도가 무효했던 이유
   - **근본**: Go viper의 정적 binding 필요성. Unmarshal + nested struct + AutomaticEnv는 자동 매핑 안 됨

3. **GCP SSD_TOTAL_GB quota 300GB (free→paid 전환 직후)**
   - GKE 노드 부팅 디스크가 PD-SSD 기반 → 5 노드 × ~60GB = 300GB 정확히 소진
   - 새 노드 생성 시 quota 초과 → cluster-autoscaler scale-up 전부 실패
   - 1차 증설 요청 300→1000GB: **48시간 대기 정책으로 자동 거절**
   - **근본**: 무료→유료 전환 직후 48h trust window 존재. 사유와 무관. 대응: monitoring 전체 off로 노드 압박 완화

4. **Istio VS `gatewayRef` namespace 오기재**
   - `gatewayRef: istio-system/goti-shared-gateway` → 실제 Gateway는 `istio-ingress/goti-shared-gateway`
   - AWS prod에서는 Gateway를 istio-system에 배포 → GCP에서는 istio-ingress로 배포 (왜 다른지는 bootstrap Terraform 결정)
   - VS 정의의 절대 경로 참조가 AWS 복사본 그대로 남아 있었음
   - **근본**: 환경 간 namespace 위치 차이 미반영 values

5. **Istio VS `destination.host` service name 오기재**
   - `host: goti-{svc}-prod` → 실제 Service는 `goti-{svc}-prod-gcp` (Helm release name 기반)
   - chart의 fullnameOverride 부재로 release name이 host에 포함됨
   - VS destination이 존재하지 않는 service 참조 → NR 503 대신 404 (Istio가 route match 실패로 처리)
   - **근본**: Helm release name이 환경 접미어 포함 → VS 대상 동적 변경 필요

6. **`goti-istio-policy` Application이 prod-gcp에 완전 부재** ⭐ 가장 중요
   - AWS prod에는 `gitops/prod/applicationsets/goti-istio-policy.yaml` 존재 → `allow-istio-gateway` AP 배포
   - prod-gcp에는 **해당 ApplicationSet 자체가 없음**
   - goti-common chart의 `_authorizationpolicy.tpl`이 서비스마다 `from-mesh-internal` ALLOW 자동 생성 → Istio semantics상 **default-deny 활성화**
   - Gateway → service 트래픽을 허용하는 ALLOW가 어디에도 없음 → 모든 외부 요청 **403 RBAC**
   - **근본**: 멀티 환경 ApplicationSet 복제 시 `goti-istio-policy` 누락. chart 정책과 환경 정책 분리 구조가 사각지대 만듦

7. **`goti-istio-policy` values `gatewaySA` AWS 하드코딩**
   - `values.yaml`의 `gatewaySA: "cluster.local/ns/istio-system/sa/istio-gateway"` — AWS namespace
   - GCP는 `istio-ingress/sa/istio-gateway` → `allow-istio-gateway` AP의 principals에 매칭 안 됨 → 여전히 차단
   - **근본**: 환경별 SA principal override 필요 (values-gcp.yaml)

8. **pg_restore FK 제약 + session_replication_role 차단 (매니지드 PG)**
   - Cloud SQL의 `goti` 유저(cloudsqlsuperuser)는 **진짜 superuser 아님**
   - `ALTER TABLE DISABLE TRIGGER ALL` 권한 없음 (RI_ConstraintTrigger 시스템 트리거)
   - `SET session_replication_role = replica`도 권한 거부 (AWS RDS rds_superuser도 동일)
   - pg_restore --disable-triggers 내부가 위 명령에 의존 → 실패 → FK violation으로 COPY 중단
   - **근본**: 매니지드 PG 간 마이그레이션은 **FK drop → data restore → FK recreate** 패턴 필수

### 적용한 수정

각 이슈별 PR:

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

추가 수동 작업:
- Goti-go 이미지 수동 빌드+푸시 (CD 워크플로는 `GCP_WIF_PROVIDER` secret 미설정으로 실패)
- `kubectl delete namespace falco` (orphan cleanup — Application이 finalizer 없이 제거된 이후)
- GRANT 문 실행 (5개 `goti_{svc}_ro` 유저에게 INSERT/UPDATE/DELETE/sequence 권한)
- DB FK drop → data-only pg_restore → FK recreate (진행 중)
- AWS RDS public access 임시 window (SG + route + publicly-accessible 토글)
- GCP Cloud SQL public IP 임시 window (`gcloud sql instances patch --assign-ip --authorized-networks`)
- Cloudflare SSL/TLS 모드 Automatic → **Flexible** (zone level)

## Result

**모든 서비스 Running + public API 200**:
```
goti-user          3/3 Running
goti-stadium       2/2 Running
goti-ticketing     2/2 Running   (viper fix 적용)
goti-payment       2/2 Running
goti-resale        2/2 Running
goti-queue         2/2 Running   (신규 배포)
```

검증:
```
$ curl -X POST https://gcp-api.go-ti.shop/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"x","password":"y"}'
{"code":"BAD_REQUEST","message":"잘못된 요청입니다."}   # ← 앱 validation 응답, 정상

$ curl https://gcp-api.go-ti.shop/api/v1/members/me
RBAC: access denied   # ← JWT 없는 protected path, 정상 차단
```

DB: 스키마 41 테이블 복원 완료. 데이터 restore 진행 중 (seat_statuses 3.6M rows, 87%).

### 회귀 테스트 / 재발 방지책

| 대응 | 상태 |
|---|---|
| `docker buildx` CI 표준화 (CD 워크플로 활성화 필요) | TODO: `project_gcp_ci_wif_todo.md` |
| viper defaults lint 룰 (mapstructure 필드 vs setDefaults diff 체크) | TODO (논의 필요) |
| prod-gcp ApplicationSet vs prod ApplicationSet diff 정기 점검 | TODO (env-diff CI 스크립트) |
| Cloudflare SSL mode 명시적 고정 (Flexible) | ✅ 적용됨 |
| SSD/CPU quota monitoring alert | TODO (quota 승인 후) |
| FK drop/recreate 마이그레이션 스크립트 보관 | TODO (`scripts/migrate-pg-managed.sh`) |
| AuthorizationPolicy 렌더링 diff 검증 (helm template + conftest) | TODO (장기) |

### 비용/시간 메트릭

- 총 소요: 약 6시간 (04:17-10:17 KST)
- AWS egress: ~1.9GB dump 전송, 무료 tier 안
- GCP Cloud SQL public IP window: 약 40분 (allowlist 내 IP만)
- AWS RDS public window: 약 10분 + 30분(재오픈) = 40분
- 수동 개입 횟수: 8회 (kubectl delete, docker push 2회, GRANT, 임시 SG rule, 임시 route, gcloud patch 2회)

## Related Files

### Goti-k8s
- `gitops/prod-gcp/applicationsets/goti-msa-appset.yaml` (#198)
- `environments/prod-gcp/goti-queue/values.yaml` (#198, #199)
- `environments/prod-gcp/goti-ticketing/values.yaml` (#202)
- `environments/prod-gcp/goti-{user,stadium,ticketing,payment,resale,queue,queue-gate}/values.yaml` (#203, #204)
- `clusters/prod-gcp/bootstrap/root-app.yaml` (#200, falco exclude)
- `gitops/prod-gcp/applicationsets/monitoring-appset.yaml` (#201)
- `gitops/prod-gcp/applicationsets/goti-istio-policy.yaml` (신규, #205)
- `infrastructure/prod/istio/goti-policy/values-gcp.yaml` (신규, #205)

### Goti-go
- `pkg/config/config.go` (#2 — setDefaults + HoldExpiryInterval guard)

### 메모리/계획
- `memory/project_gcp_ci_wif_todo.md` (신규)
- `memory/feedback_goti_go_autonomy.md` (신규)
- `/Users/ress/.claude/plans/idempotent-enchanting-treasure.md` (queue 배포 plan)

## 교훈 (핵심)

1. **환경 간 ApplicationSet 복제 시 전수 diff** — 한 개 빠지면 Istio default-deny 같은 catastrophic 장애
2. **매니지드 PG 마이그레이션은 FK drop/recreate 패턴 필수** — superuser 권한 없음이 전제
3. **Mac 로컬 docker build는 cross-platform 실패** — `buildx --platform linux/amd64 --push` 필수
4. **viper AutomaticEnv는 SetDefault 선행 필수** — nested struct env 자동 매핑 안 됨
5. **Cloudflare Automatic SSL mode는 간헐 버그 가능** — 명시적 Flexible/Full 고정이 안전
6. **GCP 무료→유료 전환 직후 48h quota trust window** — 사유 무관 자동 거절, 사전 증설 요청이 맞음
7. **cluster-autoscaler 실패 원인은 autoscaler 자체 events로** — 상위 계층 증상만 보지 말 것
