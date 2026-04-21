---
title: "GCP prod-gcp bring-up 5가지 의사결정 — 안전 경로가 이긴 하루"
excerpt: "AWS에서 GCP로 넘어가는 bring-up 작업 중 마주친 DNS, SSL, DB 마이그레이션, 모니터링, Quota 5가지 선택 지점. 각 결정의 트레이드오프와 실제로 고른 길을 정리했습니다."
category: challenge
tags:
  - go-ti
  - Multi-Cloud
  - GCP
  - Bringup
  - Terraform
  - Cloudflare
  - PostgreSQL
  - Architecture Decision Record
series:
  name: "goti-multicloud"
  order: 2
date: "2026-04-14"
---

## 한 줄 요약

> AWS → GCP 마이그레이션 bring-up 중 5개의 독립된 선택 지점에서 트레이드오프 판단이 필요했습니다. DNS 분리·SSL Flexible 유지·FK drop/recreate·모니터링 전체 off·Quota 48시간 대기를 선택한 이유와 그 근거를 기록했습니다.

---

## 배경

2026-04-13부터 시작한 AWS → GCP 마이그레이션 bring-up 작업에서, 같은 날 5개의 독립적인 결정 지점이 연달아 등장했습니다. 각 결정은 단독으로 보면 작지만, 공통으로 **프로덕션 안전성(롤백 가능성)**, **작업 시간**, **장기 운영 부담**, **AWS/GCP 간 일관성** 4가지 축을 따져야 했습니다.

이번 글은 각 결정을 그 자체로 해부하기보다, 같은 상황에 놓인 엔지니어가 어떤 축으로 고민하면 되는지 남기는 데 목적이 있습니다. 5건 모두 "안전 경로 우선"이라는 공통 패턴이 드러났고, 이는 앞으로 bring-up 단계 공통 지침으로 내재화할 만한 교훈입니다.

---

## 1. DNS 네이밍: 분리 hostname vs 즉시 교체

### 선택지

**Option A**: `api.go-ti.shop` A record만 GCP IP로 교체

- 장점: 추가 hostname 없음, 프론트 수정 불필요, 빠른 전환입니다.
- 단점: GCP 장애 시 즉시 프론트 장애로 이어집니다. 테스트 endpoint가 없습니다. AWS 복구 시 동시 운영 경로가 불명확합니다.

**Option B**: `gcp-api.go-ti.shop` 추가 + `api.go-ti.shop` 유지

- 장점: 디버깅/부하테스트 전용 endpoint를 확보할 수 있습니다. 프로덕션 영향 0에서 검증 가능합니다. 이후 `api-aws.go-ti.shop`을 추가하면 Cloudflare Load Balancing으로 multi-cloud 라우팅이 자연스럽게 확장됩니다.
- 단점: DNS 레코드 관리가 +1 늘어납니다. Istio hosts 추가 PR이 필요합니다.

### 결정과 근거

**Option B 채택** — `gcp-api.go-ti.shop` 전용 hostname을 추가했습니다.

근거는 세 가지입니다.

첫째, bring-up 단계라 검증 실패 가능성이 높습니다. 프로덕션 hostname을 즉시 교체하는 방식은 실패 시 사용자 영향이 즉각적입니다.

둘째, 향후 AWS 복구 시 `api-aws.go-ti.shop`을 추가하면 `api.go-ti.shop` 뒤에 Cloudflare Load Balancing pool(AWS + GCP)을 구성하는 구조로 자연스럽게 확장됩니다. 지금의 작은 결정이 6개월 뒤 multi-cloud 라우팅의 토대가 됩니다.

셋째, AWS EKS가 현재 scale-down 상태라 사실상 프로덕션 트래픽은 없습니다. A/B 선택의 부담은 낮지만, **습관적으로 안전 경로를 선택**하는 것이 장기적으로 바람직합니다.

### 실행 결과

- DNS: `gcp-api.go-ti.shop` A 레코드 `34.22.80.226`으로 생성, Cloudflare proxied 활성화(사용자 수동)
- Goti-k8s PR #203: 7개 MSA의 `values.yaml`에서 `gateway.hosts`에 `gcp-api.go-ti.shop` 추가
- 검증 성공 후 `api.go-ti.shop`도 동일 IP로 교체(별도 작업)
- 장기 계획: AWS 복구 시 `api.go-ti.shop` 뒤에 Cloudflare Load Balancing pool 구성

관련 파일은 `Goti-k8s/environments/prod-gcp/goti-{user,stadium,ticketing,payment,resale,queue,queue-gate}/values.yaml` 입니다.

---

## 2. Cloudflare SSL/TLS 모드: Flexible vs Full Strict

### 상황

Cloudflare → Origin HTTPS 연결 시 525 SSL handshake failed가 발생했습니다. Istio Gateway가 port 443을 **HTTP protocol**로 받도록 설정되어 있었기 때문입니다. 즉, Gateway에서 TLS 종단을 하지 않는 구조였습니다.

### 선택지

**Option A**: Cloudflare SSL 모드 `Flexible` — 클라이언트↔Cloudflare는 HTTPS, Cloudflare↔Origin은 HTTP

- 장점: 설정 1분. AWS prod와 동일 구조입니다(AWS Gateway도 동일하게 HTTP:443). 인증서 관리가 불필요합니다.
- 단점: Cloudflare ↔ Origin 구간이 평문입니다. Cloudflare를 우회한 접근 시 평문이 노출됩니다(단, Cloudflare proxy IP allowlist로 완화 가능).

**Option B**: Istio Gateway에 TLS 추가 + Cloudflare `Full (Strict)`

- B1: Cloudflare Origin Certificate(15년 유효, 수동 관리) — 약 10분
- B2: cert-manager + Let's Encrypt HTTP01 — 30분 이상, 90일 자동 갱신
- B3: cert-manager + DNS01 + wildcard — 45분 이상
- 장점: end-to-end TLS. Cloudflare 우회 공격에도 평문이 노출되지 않습니다.
- 단점: AWS와 구조 비대칭 → 운영 비일관. cert 갱신 운영 부담. AWS도 함께 바꾸려면 일관성 확보에 추가 작업이 필요합니다.

### 결정과 근거

**Option A 채택** — Flexible 모드를 명시 설정했습니다.

근거는 다음과 같습니다.

AWS prod를 담당하는 팀원이 이미 **같은 구조(Flexible)**로 운영 중이었습니다. 프로젝트 일관성을 깨면 양쪽을 동시에 바꿔야 하고, bring-up 단계에서 그 범위 확대는 비효율입니다.

실제 보안 위협은 Cloudflare proxy 우회입니다. 이건 **GCP Firewall에 Cloudflare IP allowlist**를 적용하면 더 효과적으로 차단할 수 있습니다(별도 작업). TLS 자체를 전환하는 것은 과한 대응입니다.

B로 가려면 AWS/GCP 동시 전환을 해야 운영 비대칭을 방지할 수 있는데, 지금은 범위 확대가 비효율입니다.

Cloudflare Origin Cert는 최대 15년이 유효하지만, **프로젝트 종료일(2026-06-23) 맞춰 2개월짜리**로 발급했던 이력이 있어 관리가 의외로 번거로웠습니다.

### 의사결정 히스토리

최초엔 "근본 해결" 맥락에서 B1 접근(Origin Cert 발급)을 시도했습니다. 그러다 Private Key 보관 여부가 불확실해졌고, 팀 AWS가 Flexible로 운영 중이었다는 사실을 재확인하면서 A로 전환했습니다. "근본 해결"이 항상 옳지는 않고, 환경 간 일관성이 더 중요한 경우가 있습니다.

### 실행 결과

- Cloudflare SSL/TLS → **Custom SSL/TLS → Flexible**로 명시 설정(Automatic 아님)
  - Automatic의 origin probe에 의한 Full 자동 승격 가능성을 제거했습니다.
- `curl https://gcp-api.go-ti.shop/api/v1/auth/login` 응답: 525 → 정상
- TODO: GCP VPC Firewall에 Cloudflare IP allowlist 추가(우회 직접 접근 차단)
- TODO: 장기 리팩터링 — AWS/GCP 동시 Origin Cert 도입(별도 프로젝트)

관련 파일은 Cloudflare 대시보드(SSL/TLS → Overview)와 `Goti-k8s/infrastructure/prod/istio/gateway/templates/shared-gateway.yaml`(protocol: HTTP 유지) 입니다.

---

## 3. DB 마이그레이션: FK drop/recreate vs Java 임시 배포

### 상황

Cloud SQL에 AWS 스키마를 restore한 뒤 `pg_restore --data-only`를 실행하자 FK constraint violation이 발생했습니다. `--disable-triggers` 플래그는 **Cloud SQL `cloudsqlsuperuser`로도 시스템 트리거를 조작할 수 없어** 실패했고, `SET session_replication_role = replica`도 권한 거부로 실패했습니다.

### 선택지

**Option A**: FK drop → data restore → FK recreate

- 장점: 매니지드 PG 간 마이그레이션의 표준 패턴입니다. 권한 문제가 없고 재실행이 가능합니다.
- 단점: FK 30개 DROP → 데이터 적재 → FK 30개 재생성(인덱스 rebuild 포함) 3단계. 총 25~40분 소요됩니다.

**Option B**: Java ticketing 이미지 1회 임시 배포 → JPA `ddl-auto: update`로 테이블+데이터 자동 적용

- 장점: DDL 추출이 불필요합니다. Java 서비스의 검증된 방식입니다.
- 단점: Java 이미지를 GCP AR에 푸시해야 합니다(Goti-server Docker build). CPU quota가 이미 tight합니다. 결정적으로 **스키마는 가능하지만 데이터는 여전히 AWS에서 가져와야 함** → 궁극적 문제 해결이 안 됩니다.

**Option C**: AWS DMS 또는 RDS snapshot → S3 export → Cloud Storage → Cloud SQL import

- 장점: Google 내부망 전송으로 빠릅니다.
- 단점: `gcloud sql import`는 pg_restore `-Fc` 포맷을 미지원 → 재덤프가 필요합니다. DMS는 오버킬이며 추가 요금이 발생합니다.

### 결정과 근거

**Option A 채택** — FK drop/recreate 표준 패턴을 그대로 썼습니다.

매니지드 PG 간 마이그레이션에서 **superuser 미보유는 AWS/GCP 공통 제약**입니다. 이건 회피 불가한 아키텍처 제약이니 표준 패턴을 그대로 활용하는 것이 가장 안전합니다.

Option B는 **데이터 마이그레이션 문제를 해결하지 못합니다**. 스키마만 해결되고 결국 Option A 절차가 필요해집니다.

Option C는 재덤프 시간 + `gcloud sql import` 포맷 변환 오버헤드로 총 시간이 비슷하거나 오히려 더 깁니다.

### 핵심 인사이트

매니지드 PG는 AWS RDS/Cloud SQL 양쪽 모두 진짜 superuser를 부여하지 않습니다. 이것은 회피 불가한 아키텍처 제약이며, "근본 해결은 self-managed PG"라는 결론으로 이어집니다. 지금 단계에서 self-managed PG로 돌아갈 수는 없으므로, FK drop 패턴을 표준으로 받아들이는 편이 현실적입니다.

### 실행 결과

- AWS RDS → pg_dump `-Fc` (1.9GB 압축, 2분 19초)
- FK 30개 DROP → data-only restore → FK recreate (진행 중)
- 매니지드 PG 한계는 `memory/project_gcp_ci_wif_todo.md`에 기록, pglogical 기반 향후 상시 sync 계획과 연계
- 향후 데이터 sync는 **pglogical** 기반(결정 완료, 별도 세션에서 구현)

관련 파일:

- `/tmp/goti-migration/schema.dump` (83KB)
- `/tmp/goti-migration/data.dump` (1.9GB)
- `/tmp/goti-migration/drop_fks.sql` (30개 FK)

---

## 4. 모니터링 스택: 전체 off vs 부분 유지

### 상황

SSD quota 300GB를 이미 100% 소진한 상태였습니다(GKE 노드 부팅 디스크). CPU도 tight했고, goti MSA pod가 전부 Pending이었습니다. 앞선 커밋 `299281a`에서 이미 tempo/mimir/pyroscope는 off된 상태였고, 남은 건 kube-prometheus-stack, loki, blackbox-exporter, otel-collector-front/back 입니다.

### 선택지

**Option A**: 전체 off (`elements: []`)

- 장점: CPU 약 960m 회수 + PVC 해제로 추가 SSD 확보. 즉시 pod 스케줄링이 가능합니다.
- 단점: 앱 동작 관찰이 불가능합니다(메트릭/로그/트레이스 전부 없음). bring-up 시점의 검증이 어려워집니다.

**Option B**: kube-prometheus-stack + Grafana만 유지, loki/otel collector만 off

- 장점: 최소한의 기본 메트릭과 대시보드가 유지됩니다.
- 단점: 여전히 500m 이상의 CPU를 점유합니다. SSD quota 회수도 적어서 부분 해소가 미지근합니다.

**Option C**: 현 상태 유지 + 앱 `replicaCount` 강제 감소

- 장점: 모니터링이 유지됩니다.
- 단점: goti MSA 다운사이징은 bring-up 목표(정상 운영)와 배치됩니다. HPA와도 상충합니다.

### 결정과 근거

**Option A 채택** — 모니터링 전체를 off 했습니다.

사용자 명시 요청이 있었습니다: "일단 server부터 띄우고 생각하자".

**bring-up 시점의 최우선은 앱 동작 검증**입니다. 모니터링은 quota 승인 후 순차 복구가 가능합니다.

CPUS_ALL_REGIONS=16 글로벌 quota로 노드 추가도 막혀있었습니다. 기존 노드를 쥐어짜는 것 외에 방법이 없는 상황입니다.

AWS prod monitoring은 별도 appset이라 이번 결정의 영향을 받지 않습니다(prod-gcp 전용 off).

### 의사결정 히스토리와 복구 순서

사용자 메모리에 "모니터링 최우선"이 있었지만, 리소스 압박 상황에서 예외적으로 off를 선택했습니다. 다만 복구 순서를 명확히 명시했습니다.

1. SSD 500GB 이상 승인 → kube-prometheus-stack, loki
2. SSD 1000GB 이상 승인 → tempo, mimir, pyroscope
3. OTel 송신 검증 완료 후 → otel-collector

### 실행 결과

- Goti-k8s PR #201: `monitoring-appset.yaml`의 `elements`를 빈 리스트로 + 전체 component 주석 처리
- ApplicationSet이 Application 5개를 자동 prune
- goti MSA 스케줄링 여유 확보
- **cloudflare-exporter만 별도 app으로 잔존**(monitoring namespace)
- 복구는 SSD quota 증설 48h 대기 후 단계적 진행

관련 파일은 `Goti-k8s/gitops/prod-gcp/applicationsets/monitoring-appset.yaml` 입니다.

---

## 5. GCP Quota 증설: 300→500 vs 300→1000

### 상황

SSD_TOTAL_GB 300GB가 소진된 상태였습니다. 오전에 1차 요청으로 300→1000GB를 올렸으나, **자동 거절**됐습니다. 이유는 48h 신규 billing 대기 정책이었습니다.

### 선택지

**Option A**: 300 → 500 (1.67배, 보수적)

- 장점: 신규 계정 허용 범위 내입니다. 자동 승인 확률이 높습니다.
- 단점: 실제 필요량(Mimir/Tempo/Loki/Pyroscope + Redis + PG replica + App SS = 약 1TB) 대비 부족 → 재요청 필요합니다.

**Option B**: 300 → 1000 (3.3배, 실수요 기반)

- 장점: 실제 필요량에 한 번에 도달합니다.
- 단점: 오전에 이미 거절된 값입니다. 재시도해도 같은 결과가 예상됩니다.

**Option C**: 48시간 대기 후 재시도 + 사유 템플릿 상세화

- 장점: billing 이력이 쌓인 후에는 자동 승인 가능성이 높아집니다.
- 단점: 이틀 대기가 발생합니다.

### 결정과 근거

**최초 Option A 추천 → 사용자 판단으로 Option B(1000)로 재요청 → 거절 → Option C(48h 대기) 전환** 순서로 진행됐습니다.

자동 거절의 실제 이유는 **사유가 아니라 billing account 신규성**이었습니다(48h trust window).

거절 메일에 이렇게 명시되어 있었습니다: "If this is a new project please wait 48h until you resubmit the request".

따라서 값 크기는 2차 요소입니다. 사용자의 "실제 필요한 값으로 요청" 판단이 합리적이었고, 장기적으로 B가 맞습니다(중간 Step 자체가 불필요).

### 사용자 입력 전환

사용자가 "1000GB로 요청하는 게 맞습니다. 사유만 제대로 쓰면 승인됩니다"라고 판단했지만, 실제로는 48h 정책이 1차 요인이었음을 거절 메일로 확인했습니다. 결과적으로 값 크기 논쟁보다 정책 이해가 먼저였습니다.

### 실행 결과

- 1차 요청 300→1000GB: 거절 (case `fb40f3d3668d4cb097`)
- 2차 요청 300→1000GB + 상세 사유: 동일 템플릿 거절 (case `c8331e1391eb43f180`)
- 48h 대기 후 재시도 예정(2026-04-15 오후 이후)
- 응급 조치: monitoring 전체 off로 quota 압박 우회
- 장기 옵션: Support Case 경로로 회신 가능("If urgent, please respond to this message")

관련 파일: GCP Console → IAM Admin → Quotas(사용자 수동), Email: `cloudquota@google.com`(support case 회신 대기).

---

## 📚 종합 교훈

5건의 결정을 한 발 떨어져서 보면 몇 가지 공통 패턴이 드러납니다.

### 1. "안전 경로 우선" 원칙

Option A(즉시 교체)보다 Option B(분리 검증)를 선택한 경우가 2건이었습니다(DNS, DB 마이그레이션). bring-up 단계에서는 검증 실패 가능성이 항상 높으니, 롤백 가능한 경로를 공통 지침으로 내재화할 만합니다.

### 2. AWS prod와 일관성 유지

TLS 모드 결정에서 팀원의 기존 설정을 존중했습니다. 환경 비대칭은 장기 운영 비용을 증가시키기 때문입니다. "근본 해결"이 항상 옳지는 않고, 양쪽을 동시에 바꿀 여력이 없으면 일관성이 우선입니다.

### 3. 매니지드 서비스 제약의 조기 인지

Cloud SQL superuser 제약은 회피 불가합니다. AWS RDS도 동일합니다. 따라서 FK drop 패턴은 우회책이 아니라 **표준**입니다. 매니지드 서비스를 쓰기로 한 이상, 제약을 먼저 확인하고 설계를 맞춰야 합니다.

### 4. Quota 거절은 사유보다 policy가 우선

신규 billing 48h 대기는 사유와 무관합니다. 따라서 프로젝트 초기에 quota 증설을 **사전**에 요청해 두는 것이 정답입니다. 긴급할 때 사유를 다듬어도 이미 늦습니다.

### 5. 모니터링 최우선 원칙의 예외

평소에는 모니터링을 최우선으로 유지하지만, 리소스 압박 상황에서는 일시적 off가 허용됩니다. 단, **복구 계획을 명시**하는 것이 필수입니다. "잠시 내려둔다"가 "영구히 내려둔다"로 바뀌는 걸 막는 안전장치입니다.

---

## 관련 문서

- 같은 날 트러블슈팅 체인: `2026-04-14-gcp-bringup-troubleshooting-chain.md`
- Queue 배포 계획: `~/.claude/plans/idempotent-enchanting-treasure.md`
- WIF CI TODO: `memory/project_gcp_ci_wif_todo.md`
