# 2026-04-27 — 포트폴리오 일괄 리파인먼트 + AI Dev Platform 포지셔닝 정리

## 배경

`slides/` 메인 포트폴리오 (21장) 톤·사실관계 일괄 점검. "단독 책임", "Go 전환", "팀 15명 적용" 등 사실과 안 맞는 표현이 여러 페이지에 흩어져 있어 페이지간 일관성이 깨진 상태였다. 마지막에 AI Dev Platform addendum 포트폴리오(14장) 평가까지 진행.

## 페이지별 변경

### 레이아웃/겹침 수정

| Page | 이슈 | 조치 |
|------|------|------|
| 04 m02-target | `~250K req/s`가 callout 침범 | target-row padding space-5→3, 폰트 34→30, 그리드 margin 압축 |
| 05 m02-poc | 카드와 callout 겹침 + VU 1,000 → 3,000 정정 | poc-grid gap space-7→5, padding 28→22, diagram max-h 180→150 |
| 11 m05-verify | 도넛 카드 메트릭 텍스트 잘림 | 헤드라인 44→38, 카드 padding/font 압축 |
| 17 closing | 숫자 뱃지가 "부하 · LOAD"/"안정성 · RESILIENCE" role 텍스트와 좌측 겹침 | 뱃지 좌상단 → 우상단 이동, 28×28 |

### 사실관계 정정 (포트폴리오 톤 일관화)

핵심: **단독 책임 ≠ 사실 (7직군 16명 팀, 클라우드 네이티브 팀장으로 주도)**, **Go 전환은 팀 작업이라 본인 기여로 강조 부적절**, **대시보드는 백엔드만 일상 사용 (15명 전체 X)**.

- **00a-intro 재구성**
  - 이름에서 `· ressKim` 닉네임 제거
  - "ABOUT THE SPEAKER" 라벨 제거 → 이름 80px로 키워 첫 시선 확보
  - 역할 한 줄 → 2단 분리 ("DevOps · Infra Lead" 26px 블루 + "Goti — Korean Baseball Ticketing" sub)
  - TEAM: "DevOps / Infra **단독** 책임" → "**클라우드 네이티브 팀장** · DevOps / Infra 주도"
  - **CODE 행 삭제** (8 repos · 5 MSA · Java→Go) — 코드 메인 아님
  - **COLLAB 행 추가**: "**7직군 협업** — 클라우드 · PD · PM · FE · BE · AI · 보안" (스타트업 규모 어필)

- **01-overview**
  - "ressKim · DevOps" → "**김혁준** · DevOps"
  - "16명 팀 · 16주 · **8 repos**" → "16명 · **7직군 협업** · 16주"
  - "LGTM 단독 구축" → "LGTM **직접** 구축"

- **07-m02-arch**: "**전 세계** 280+ PoP" → "**글로벌** 280+ PoP" (KBO 도메인 부합)

- **09-m04 통째 재작성** (**가장 큰 변경**)
  - Before: "JVM 한계 + Thundering Herd → 5 MSA 전면 **Go 전환**"
  - After: "스파이크 트래픽 대응 — **인프라 영역 기여**"
  - 본인 기여만 남김:
    - ① **KEDA + Karpenter 30분 선대응** (Cron Job, Pod·Node 사전 확장)
    - ② **PgBouncer 도메인 Proxy** (RDS 임계치 300 방어)
  - KPI: 5xx 0%대, 10만 동시접속, RDS 커넥션 <300
  - 회고: "성능은 **팀이 함께 풀었습니다** — 인프라가 먼저 받쳐주도록 책임졌습니다"
  - 근거: 팀 발표자료에서 본인이 한 부분이 인프라 영역(스파이크 대응 인프라 재설계)임을 사용자가 명시

- **10/11-m05** (Multi-Cloud)
  - "전 세계 트래픽" → "**전국 야구팬**" (KBO 국내 도메인)
  - "트래픽 분배 **진실은** Workers 에만" → "트래픽 분배의 **단일 관리점은** Workers" (자연스러운 표현)
  - 10페이지 "학습이 아니라 실제 운영 필요성" → "대비하는 **실제 운영 구조**"

- **16-m06-events 대규모 리팩토링**
  - 헤드라인: "대시보드가 진짜 사건을 발견 — 단독 설계, 팀 15명 적용" → "**모든 개선 의사결정은 '모니터링'으로 관측·확인**했습니다"
  - 상단 KPI 3-카드 → 2-카드 ("백엔드 일상 사용" 텍스트 카드는 숫자 카드 옆에 어색해 제거, 37 대시보드 / 380 패널만)
  - 4개 사건 카드 모두 자연어 재작성:
    - 01 N+1: "→ Go 전환 P0" 제거 → "N+1 쿼리 패턴을 발견·해결"
    - 02 Karpenter: "측정 → 코드 → 인프라 순서가 습관" 제거 → "발견 → PR 복구 → 대시보드에서 다시 확인" 플로우
    - 03 Tempo OOM: "**Kafka** 버퍼와 tail sampling" → "tail sampling + 파이프라인 재설계" (Kafka 프로젝트에서 제거됐으므로 언급 제거)
    - 04 OTel: "관측성의 메타 사례" 추상 표현 제거 → "Pod 기동 순서가 꼬여 발생, 전체 rollout 후 정상화"
  - 하단 보조: "외 2건..." → "**대표 사례 4건** · 외에도 팀이 로그/트레이스로 발견·수정한 케이스 다수"

- **17-closing**
  - 숫자 뱃지 우상단 이동 (role 텍스트 겹침 해소)
  - 카드 1 sub: "CDN Edge 97.7% 흡수 · **Go 전환** p50 18ms" → "...· **p50 18ms 응답**"
  - 카드 2: "학습이 아니라 실제 운영 필요성" → "학습이 아닌 **실제 운영을 위한 선택**"
  - 카드 3 sub: "Stadium 사건이 **증거**" → "Stadium 같은 **실제 사건을 잡았습니다**"

- **18-module-index 전면 톤 재작성** (PPT 마지막 결과 요약 페이지)
  - Eyebrow: "정량 임팩트" → "**16주가 남긴 결과**"
  - 헤드라인: "단독 책임 영역의 측정 가능한 결과" → "**모든 변경에 숫자가 따라왔습니다**"
  - Subhead: "8 repos · 5 MSA · 단독으로 설계" → "**7직군 협업** — 인프라부터 관측성까지 직접 설계하고 운영"
  - KPI 5장 모두 단어 정정:
    - "GO 전환 P50" → "**API 응답 P50**"
    - "MSA 전환 6/6 · Java → Go" → "**MSA 분리 운영 6/6** · Istio Canary 무중단 전환"
    - 대시보드 sub: "팀 15명 적용 · 진짜 사건 4건" → "**백엔드가 매일 보는 화면 · 모든 개선을 모니터링으로 검증**"
  - 책임 영역 4장 body 자연어로 다시 쓰기 ("MSA 분리"의 Go 단어 제거, "관측성"의 단독/15명 제거)
  - 하단 quote: "단독 설계 → 팀 15명 적용" → "**측정 → 코드 → 인프라** — 모든 의사결정을 모니터링으로 검증"
  - 섹션 라벨: "단독 책임 영역" → "**직접 만든 영역**"

## AI Dev Platform Addendum (14 슬라이드) 평가

PDF 직접 읽고 평가 — 처음에 일반론으로 "AI 활용은 기본기"라 답했다가 사용자 피드백으로 정정.

**실제 평가**: 단순 AI 활용이 아니라 **Internal AI Platform** 구축. 주요 시그널:
- **Harness Engineering 선행** — Anthropic이 2026-02에 명명한 framework (tools/context/guardrails/workflow/sensors/self-correcting)를 그 전에 이미 구현
- **자기 개선 사이클** — log-trouble → pattern analysis → skill design → skill update (89건 누적 → Rules 5+Skills 5 환원)
- **OSS 공개 검증** — 160+ skills, 26 agents 외부 공개
- **메타 증명** — "이 포트폴리오 자체가 시스템 산출물" (architect-agent / code-reviewer / log-decision으로 자기 자신을 빌드)

**제출 전략 권고**: 메인 포트폴리오 + Addendum **둘 다 보냄**. Addendum은 차별화 자산이라 빼지 않음. 컨설턴트 피드백 받기 전 본인 판단으로 깎는 건 위험.

## 결과

- 메인 포트폴리오 21 슬라이드 톤 일관화 완료
- "단독", "Go 전환", "팀 15명 적용" 잔류 표현 전수 점검 후 정리 (8건 일괄 정정)
- PPTX 6.4MB 재빌드 (`slides/dist/goti-portfolio.pptx`)
- 컨설턴트 피드백 단계로 진입 준비 완료

## 다음

- 컨설턴트 피드백 수령 후 재돌입
- 피드백 받을 포인트 미리 정리:
  - 메인/Addendum 순서·비중
  - Harness Engineering 포지셔닝의 시장 통용성
  - "단독 → 주도" 톤이 면접에서 약하게 보일 위험
  - 두 PDF 분리 유지 vs 통합

## 교훈

- **사용자 피드백 받기 전 자기 검열로 자산을 깎는 위험**: AI Addendum을 처음에 일반론으로 평가절하했다가 정정. 차별화 자산은 시장 반응으로 검증해야지 본인 판단으로 깎으면 안 됨.
- **사실관계 ≠ 톤**: "단독", "팀 15명 적용" 같은 표현은 한 페이지만 봐서는 자연스러워 보이지만, 다른 페이지의 사실(7직군 협업, 백엔드만 일상 사용)과 충돌하면 면접에서 모순으로 노출됨. 페이지 간 일관성 점검이 페이지별 검토보다 중요.
- **여러 사이클을 한 번에 뽑지 말 것**: 사용자가 한 줄 피드백("이 표현 어색해") 줄 때마다 1개 페이지씩 사이클 돌리는 게 결과적으로 빠르고 정확. 한 번에 5건 일괄 적용하면 사용자가 검토를 놓침.

---

# 2026-04-27 (후속) — 포트폴리오 레포 public 전환 1단계: fork + 시크릿 스캔

## 목적

포트폴리오 18페이지 "직접 만든 영역" 4개 카드(IaC/CI-CD/MSA/관측성)에 GitHub 코드 링크를 붙여 검증 가능성 확보. 채용 담당자가 코드 직접 확인 가능 → 신뢰도 손실 차단.

## 진행

### 1. Goti-Terraform fork 생성

```bash
gh repo fork Team-Ikujo/Goti-Terraform --clone=false
# → https://github.com/ressKim-io/Goti-Terraform (PRIVATE, isFork=true)
```

monitoring/k8s는 이미 ressKim-io 계정에 fork 있음 — 추가 fork 불필요.

로컬 remote 재구성 (Terraform):
```
origin    git@github.com:ressKim-io/Goti-Terraform.git    # push 대상 (fork)
upstream  git@github.com:Team-Ikujo/Goti-Terraform.git    # 원본 (동기화용)
```

monitoring/k8s 로컬 remote는 이번 단계에선 그대로 두고, README 작업 직전에 함께 재구성 예정.

### 2. gitleaks 설치 + 3개 레포 스캔

```bash
brew install gitleaks   # 8.30.1
```

각 레포에서 history (`--log-opts="--all"`) + worktree (`--no-git`) 두 종류 스캔:

| 레포 | history finding | worktree finding | 실제 leak |
|------|-----------------|------------------|-----------|
| Goti-Terraform | 6 | 42 | **0** (전부 false positive) |
| Goti-monitoring | 0 | 0 | **0** |
| Goti-k8s | 0 | 0 | **0** |

### 3. Terraform false positive 분석

**워킹트리 42건** — `.gitignore`에 `*.tfvars`, `**/.terraform/*` 모두 등록되어 있어 git에 트래킹된 적 없음:
- `terraform/{dev,prod-aws,prod-gcp}/terraform.tfvars` (38건) — gitignored
- `.terraform/modules/eks.eks.kms/{README.md,examples/...}` (4건) — 외부 모듈 다운로드물
- `prod-gcp/terraform.tfvars.example` (트래킹) — 검사 결과 모두 `CHANGE_ME`/`YOUR_*` 플레이스홀더

**main.tf:176 1건** (`hashicorp-tf-password`) — 실제 코드:
```hcl
db_password = "unused-post-phase3e"
```
ADR-0018 Phase 3e 이후 placeholder. 실제 값은 `db_password_override`(pg-primary VM 라우팅)가 사용. gitleaks가 변수명에만 매칭한 false positive.

**config/main.tf history 4건** (`generic-api-key`, xaczxzz commits) — 실제 코드:
```hcl
"user-jwt-rsa-private-key" = tls_private_key.jwt_rsa.private_key_pem_pkcs8
"user-JWT_RSA_PRIVATE_KEY" = tls_private_key.jwt_rsa.private_key_pem_pkcs8
```
**Terraform `tls_private_key` 리소스의 attribute 참조**. 키 자체는 코드에 한 번도 들어간 적 없음, `terraform apply` 시 동적 생성 → Secret Manager에 직접 저장. gitleaks가 `private_key` 키워드를 시크릿으로 오인.

monitoring/k8s가 0건인 이유: GitOps 레포는 시크릿이 ExternalSecrets/ESO를 통해 외부(SSM/Secret Manager)에서 주입되어 코드에 일절 들어가지 않음.

### 4. 결정: history rewrite 불필요

- 6건 모두 false positive 확정 → `git filter-repo` 작업 취소
- `.gitleaksignore` 추가도 스킵 (사용자 결정) — 외부 검토자가 돌려도 Terraform 코드 읽으면 false positive임이 자명
- 키 노출 자체가 없으므로 rotate도 불필요 (프로젝트 종료로 어차피 운영 중인 키도 없음)

### 5. 도구 설치

세션에 추가된 도구:
- `gitleaks` 8.30.1 (brew)
- `git-filter-repo` (brew, 결과적으로 사용 안 함)

## 다음 단계

1. ~~Terraform history rewrite~~ — 취소 (false positive)
2. **README 3종 작성** — 본인 기여 영역 + 팀원 작업 명시
   - Goti-Terraform: VPC/EKS/RDS/PgBouncer/multi-cloud 인프라 IaC, ADR 기반
   - Goti-k8s: ApplicationSet/Istio mesh/goti-common Library Chart
   - Goti-monitoring: LGTM stack, dashboards, OTel Collector 마이그레이션
3. 팀원 동의 — `xaczxzz`(GCP 모듈 commits) 누구인지 확인 후 매너 메시지
4. Public 전환 (3개 일괄): `gh repo edit ressKim-io/{repo} --visibility public`
5. PPTX 18페이지 카드에 GitHub 링크 추가 + dev-log 후속 기록

## 교훈

- **gitleaks finding은 "원인" 아니라 "신호"**: redacted 매칭 라인만 보고 history rewrite로 직행하지 말고, 실제 코드 컨텍스트를 확인해 false positive 여부부터 판단해야 함. `tls_private_key.jwt_rsa.private_key_pem_pkcs8` 같은 IaC 리소스 참조는 모든 secret scanner가 잡지만 실제 leak 아님.
- **GitOps + ESO 패턴의 부산물**: monitoring/k8s에서 0건이 나온 건 우연이 아님. 시크릿을 처음부터 코드 밖(SSM/SM)에 두는 설계가 public 전환 코스트를 0으로 만든다 — public을 염두에 둔 설계가 아니어도 그 효과를 본 사례.
- **3-step 정찰 전 history rewrite 명령 보류**: 사용자가 A안(filter-repo) 승인 후에도 실제 매칭 라인 컨텍스트 확인 단계를 한 번 더 넣은 게 결과적으로 헛작업 차단. 비가역 작업(force push) 전 정찰 한 단계는 항상 추가할 가치 있음.
