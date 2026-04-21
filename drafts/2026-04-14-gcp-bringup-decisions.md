---
date: 2026-04-14
category: decision
project: Goti-k8s / Goti-Terraform / Cloudflare / Cloud SQL
tags: [gcp, cloudflare, dns, tls, postgres, migration, quota, monitoring, istio]
---

# GCP prod-gcp bring-up 5대 의사결정

## Context

2026-04-13 AWS → GCP 마이그레이션 bring-up 작업 중, 5개의 독립적인 선택 지점에서 트레이드오프 판단이 필요했다. 각 결정은 프로덕션 안전성(롤백 가능성), 작업 시간, 장기 운영 부담, AWS/GCP 간 일관성의 균형을 고려했다.

---

## 1. DNS 네이밍: gcp-api.go-ti.shop 분리 vs api.go-ti.shop 즉시 교체

### Issue

#### Option A: `api.go-ti.shop` A record만 GCP IP로 교체
- 장점: 추가 hostname 없음, 프론트 수정 불필요, 빠른 전환
- 단점: GCP 장애 시 즉시 프론트 장애. 테스트 endpoint 없음. 추후 AWS 복구 시 동시 운영 경로 불명확

#### Option B: `gcp-api.go-ti.shop` 추가 + `api.go-ti.shop` 유지
- 장점: 디버깅/부하테스트 전용 endpoint 확보. 프로덕션 영향 0에서 검증 가능. 나중에 `api-aws.go-ti.shop` 추가 → Cloudflare Load Balancing으로 multi-cloud 라우팅 가능
- 단점: DNS 레코드 관리 +1. Istio hosts 추가 PR 필요

### Action

**Option B 채택** (`gcp-api.go-ti.shop` 추가).

근거:
- bring-up 단계라 검증 실패 가능성 높음 → 프로덕션 hostname 즉시 교체는 위험
- 향후 AWS 복구 시 `api-aws.go-ti.shop` 추가하면 자연스럽게 Cloudflare LB 구조로 확장 가능
- AWS EKS가 현재 scale-down 상태라 사실상 프로덕션 트래픽 없음 → A/B 선택 부담 낮지만, **습관적으로 안전 경로 선택**

### Result

- DNS: `gcp-api.go-ti.shop` A 34.22.80.226 (Cloudflare proxied) 생성 (사용자 수동)
- Goti-k8s PR #203: 7개 MSA values.yaml의 `gateway.hosts`에 `gcp-api.go-ti.shop` 추가
- 검증 성공 후 `api.go-ti.shop`도 동일 IP로 교체 (별도 작업)
- 장기 계획: AWS 복구 시 `api.go-ti.shop` 뒤에 Cloudflare Load Balancing pool(AWS + GCP) 구성

### Related Files
- `Goti-k8s/environments/prod-gcp/goti-{user,stadium,ticketing,payment,resale,queue,queue-gate}/values.yaml`

---

## 2. Cloudflare SSL/TLS 모드: Flexible vs Full (Strict) + Origin Cert

### Issue

상황: Cloudflare → Origin HTTPS 연결 시 525 SSL handshake failed. Istio Gateway가 port 443을 **HTTP protocol**로 받도록 설정됨 (TLS 종료 안 함).

#### Option A: Cloudflare SSL 모드 `Flexible` (클라↔Cloudflare HTTPS, Cloudflare↔Origin HTTP)
- 장점: 설정 1분. AWS prod와 동일 구조 (AWS Gateway도 동일하게 HTTP:443). 인증서 관리 불필요
- 단점: Cloudflare → Origin 구간 평문. Cloudflare 우회 접근 시 평문 노출 (Cloudflare proxy IP 허용만 해도 mitigable)

#### Option B: Istio Gateway에 TLS 추가 + Cloudflare `Full (Strict)`
- B1: Cloudflare Origin Certificate (15년 유효, 수동 관리): 10분
- B2: cert-manager + Let's Encrypt HTTP01: 30분+ (90일 자동 갱신)
- B3: cert-manager + DNS01 + wildcard: 45분+
- 장점: end-to-end TLS. Cloudflare 우회 공격에도 평문 노출 없음
- 단점: AWS와 구조 비대칭 → 운영 비일관. cert 갱신 운영 부담. AWS도 함께 바꾸려면 일관성 확보에 추가 작업

### Action

**Option A 채택** (Flexible).

근거:
- AWS prod 팀원이 이미 **같은 구조(Flexible)**로 운영 중 → 프로젝트 일관성
- 실제 보안 위협은 Cloudflare proxy 우회 — 이건 **GCP Firewall에 Cloudflare IP allowlist**로 더 효과적으로 차단 가능 (별도 작업)
- B로 가려면 AWS/GCP 동시 전환해야 운영 비대칭 방지 → 지금은 범위 확대 비효율
- 15년 Cloudflare Origin Cert는 유효하나 **프로젝트 종료일(2026-06-23) 맞춰 2개월짜리**로 발급한 이력이 있어 관리 번거로움 확인

**의사결정 히스토리**: 최초엔 "근본 해결" 맥락에서 B1 접근 (Origin Cert 발급 시도) → Private Key 보관 여부 불확실 → AWS가 Flexible로 운영 중이었다는 사실 재확인 후 A로 전환.

### Result

- Cloudflare SSL/TLS → **Custom SSL/TLS → Flexible** 명시 설정 (Automatic 아님)
  - Automatic의 origin probe에 의한 Full 자동 승격 가능성 제거
- `curl https://gcp-api.go-ti.shop/api/v1/auth/login` 525 → 정상 응답 전환
- TODO: GCP VPC Firewall에 Cloudflare IP allowlist 추가 (Cloudflare 우회 직접 접근 차단)
- TODO: 장기 리팩터링 — AWS/GCP 동시 Origin Cert 도입 (별도 프로젝트)

### Related Files
- Cloudflare 대시보드 (SSL/TLS → Overview)
- `Goti-k8s/infrastructure/prod/istio/gateway/templates/shared-gateway.yaml` (protocol: HTTP 유지)

---

## 3. DB 마이그레이션: FK drop/recreate 패턴 vs Java 임시 배포

### Issue

상황: Cloud SQL에 AWS 스키마 restore 후 `pg_restore --data-only` 실행 시 FK constraint violation. `--disable-triggers` 플래그는 **Cloud SQL `cloudsqlsuperuser`도 시스템 트리거 조작 불가**로 실패. `SET session_replication_role = replica`도 권한 거부.

#### Option A: FK drop → data restore → FK recreate
- 장점: 매니지드 PG 간 마이그레이션 표준 패턴. 권한 문제 없음. 재실행 가능
- 단점: FK 30개 DROP + 데이터 적재 + FK 30개 재생성 (인덱스 rebuild 포함) 3 단계. 총 25-40분 소요

#### Option B: Java ticketing 이미지 1회 임시 배포 → JPA `ddl-auto: update`로 테이블+데이터 자동 적용
- 장점: DDL 추출 불필요. Java 서비스 검증된 방식
- 단점: Java 이미지를 GCP AR에 푸시해야 함 (Goti-server Docker build). CPU quota 이미 tight. 스키마는 가능하지만 **데이터는 여전히 AWS에서 가져와야 함** → 궁극적 문제 해결 안 됨

#### Option C: AWS DMS 또는 RDS snapshot → S3 export → Cloud Storage → Cloud SQL import
- 장점: Google 내부망 전송 (빠름)
- 단점: `gcloud sql import`는 pg_restore `-Fc` 포맷 미지원 → 재덤프 필요. DMS는 오버킬 + 요금

### Action

**Option A 채택** (FK drop/recreate).

근거:
- 매니지드 PG 간 마이그레이션에서 **superuser 미보유는 AWS/GCP 공통 제약** → 표준 패턴을 그대로 활용
- Option B는 **데이터 마이그레이션 문제를 해결하지 못함** (스키마만 해결) → 결국 Option A 절차 필요
- Option C는 재덤프 시간 + `gcloud sql import` 포맷 변환 오버헤드로 총 시간 비슷 또는 더 김

**핵심 인사이트**: 매니지드 PG는 양쪽 모두 진짜 superuser 미부여. 이건 회피 불가한 아키텍처 제약. "근본 해결은 self-managed PG" 결론.

### Result

- AWS RDS → pg_dump `-Fc` (1.9GB 압축, 2분 19초)
- FK 30개 DROP → data-only restore → FK recreate (진행 중)
- 매니지드 PG 한계 메모리 기록: `memory/project_gcp_ci_wif_todo.md`에 pglogical 기반 향후 상시 sync 계획 연계
- 향후 데이터 sync는 **pglogical** 기반 (결정 완료, 별도 세션에서 구현)

### Related Files
- `/tmp/goti-migration/schema.dump` (83KB)
- `/tmp/goti-migration/data.dump` (1.9GB)
- `/tmp/goti-migration/drop_fks.sql` (30개 FK)

---

## 4. 모니터링 스택: 전체 off vs 부분 유지

### Issue

상황: SSD quota 300GB 이미 100% 소진 (GKE 노드 부팅 디스크). CPU도 tight. goti MSA pod 전부 Pending. `299281a` 커밋에서 이미 tempo/mimir/pyroscope는 off됨. 남은 건 kube-prometheus-stack, loki, blackbox-exporter, otel-collector-front/back.

#### Option A: 전체 off (elements: [])
- 장점: CPU 약 960m 회수 + PVC 해제 추가 SSD 확보. 즉시 pod 스케줄링 가능
- 단점: 앱 동작 관찰 불가 (메트릭/로그/트레이스 전부 없음). bring-up 시점 검증이 어려움

#### Option B: kube-prometheus-stack + Grafana만 유지, loki/otel collector만 off
- 장점: 최소한의 기본 메트릭 + 대시보드 유지
- 단점: 여전히 ~500m+ CPU 점유. SSD quota 회수 적음. 부분 해소로 효과 미지근함

#### Option C: 현 상태 유지 + 앱 replicaCount 강제 감소
- 장점: 모니터링 유지
- 단점: goti MSA 다운사이징은 bring-up 목표(정상 운영)와 배치됨. HPA와 상충

### Action

**Option A 채택** (전체 off).

근거:
- 사용자 명시 요청: "일단 server부터 띄우고 생각하자"
- **bring-up 시점 최우선은 앱 동작 검증** — 모니터링은 quota 승인 후 순차 복구 가능
- CPUS_ALL_REGIONS=16 글로벌 quota로 노드 추가도 막힘 → 기존 노드 쥐어짜기 외 방법 없음
- AWS prod monitoring은 별도 appset이라 영향 없음 (prod-gcp 전용 off)

**의사결정 히스토리**: 사용자 메모리에 "모니터링 최우선"이 있었으나, 리소스 압박 상황에서 예외적으로 off 선택. 복구 순서 명시:
1. SSD 500GB+ 승인 → kube-prometheus-stack, loki
2. SSD 1000GB+ 승인 → tempo, mimir, pyroscope
3. OTel 송신 검증 완료 후 → otel-collector

### Result

- Goti-k8s PR #201: `monitoring-appset.yaml` elements 빈 리스트 + 전체 component 주석
- ApplicationSet이 Application 5개 자동 prune
- goti MSA 스케줄링 여유 확보
- **cloudflare-exporter만 별도 app으로 잔존** (monitoring namespace)
- 복구는 SSD quota 증설 48h 대기 후 단계적 진행

### Related Files
- `Goti-k8s/gitops/prod-gcp/applicationsets/monitoring-appset.yaml`

---

## 5. GCP Quota 증설: 300→500 vs 300→1000

### Issue

상황: SSD_TOTAL_GB 300GB 소진. 오전 1차 요청 300→1000GB: **자동 거절** (48h 신규 billing 대기 정책).

#### Option A: 300 → 500 (1.67배, 보수적)
- 장점: 신규 계정 허용 범위 내. 자동 승인 확률 높음
- 단점: 실제 필요량(Mimir/Tempo/Loki/Pyroscope + Redis + PG replica + App SS = ~1TB) 대비 부족 → 재요청 필요

#### Option B: 300 → 1000 (3.3배, 실수요 기반)
- 장점: 실제 필요량에 한 번에 도달
- 단점: 오전 이미 거절된 값 → 재시도해도 같은 결과 예상

#### Option C: 48시간 대기 후 재시도 + 사유 템플릿 상세화
- 장점: billing 이력 쌓인 후 자동 승인 가능성 ↑
- 단점: 이틀 대기

### Action

**최초 Option A 추천 → 사용자 판단으로 Option B (1000)로 재요청 → 거절 → Option C (48h 대기) 전환**.

근거:
- 자동 거절의 실제 이유는 **사유가 아니라 billing account 신규성** (48h trust window)
- 거절 메일 명시: "If this is a new project please wait 48h until you resubmit the request"
- 따라서 값 크기는 2차 요소 — 사용자의 "실제 필요한 값으로 요청" 판단이 합리적
- 장기적으로 B1 approach가 맞음 (중간 Step 자체가 불필요)

**사용자 입력 전환**: "1000GB로 요청하는 게 맞습니다. 사유만 제대로 쓰면 승인됩니다" → 실제로는 48h 정책이 1차 요인이었음을 거절 메일로 확인

### Result

- 1차 요청 300→1000GB: 거절 (fb40f3d3668d4cb097)
- 2차 요청 300→1000GB + 상세 사유: 동일 템플릿 거절 (c8331e1391eb43f180)
- 48h 대기 후 재시도 예정 (2026-04-15 오후 이후)
- 응급 조치: monitoring 전체 off로 quota 압박 우회
- 장기 옵션: Support Case 경로로 회신 가능 ("If urgent, please respond to this message")

### Related Files
- GCP Console → IAM Admin → Quotas (사용자 수동)
- Email: `cloudquota@google.com` (support case 회신 대기)

---

## 종합 교훈

1. **"안전 경로 우선" 원칙**: Option A(즉시 교체)보다 Option B(분리 검증)를 선택한 경우 2건(DNS, DB 마이그레이션). bring-up 단계 공통 지침으로 내재화.
2. **AWS prod와 일관성 유지**: TLS 모드 결정에서 팀원 기존 설정 존중. 환경 비대칭은 장기 운영 비용 증가.
3. **매니지드 서비스 제약 조기 인지**: Cloud SQL superuser 제약은 회피 불가. FK drop 패턴이 표준.
4. **quota 거절은 사유보다 policy가 우선**: 신규 billing 48h 대기는 사유 무관. 사전 증설 요청이 정답.
5. **모니터링 최우선 원칙의 예외**: 리소스 압박 시 일시적 off는 허용. 단, 복구 계획 명시 필수.

## Related Documents

- 트러블슈팅 체인: `2026-04-14-gcp-bringup-troubleshooting-chain.md`
- Queue 배포 plan: `~/.claude/plans/idempotent-enchanting-treasure.md`
- WIF CI TODO: `memory/project_gcp_ci_wif_todo.md`
- Goti-go autonomy: `memory/feedback_goti_go_autonomy.md`
