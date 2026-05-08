---
title: "Upstage Solar API GCP prod 주입 제외 — 프로젝트 종료 직전 비용 차단 결정"
excerpt: "영상 추가촬영용 GCP prod 배포 시 유료 LLM API 키를 주입하지 않기로 결정했습니다. 코드는 그대로 두고 env만 제거해 복구 비용을 0으로 유지했습니다"
category: challenge
tags:
  - go-ti
  - GCP
  - Cost
  - Decision
  - SecretManager
  - adr
series:
  name: "goti-multicloud"
  order: 13
date: "2026-04-19"
---

## 한 줄 요약

> 프로젝트 종료(2026-04-24) 직전 영상 추가촬영을 위해 GCP prod에 security-dashboard를 올리면서, Upstage Solar API 키를 주입하지 않기로 결정했습니다. 코드는 수정하지 않고 env 주입 경로만 차단해 비용 발생을 막고 복구 경로를 단순하게 유지했습니다

---

## 배경

go-ti security-dashboard는 `analysis.go`의 `/api/v1/analysis/*` 엔드포인트에서 Upstage Solar LLM을 호출합니다.
탐지 이벤트, 매크로 세션, 의심 IP를 AI로 분석하는 기능이며, 실행에 `UPSTAGE_API_KEY` 환경변수가 필요합니다.

AWS prod에서는 SSM Parameter Store(`/prod/security-dashboard/UPSTAGE_API_KEY`)에 키를 보관 중이었습니다.
2026-04-19, 영상 추가촬영을 위해 GCP prod에 security-dashboard를 신규 배포하는 과정에서 동일 값을 GCP Secret Manager(`goti-prod-security-dashboard-UPSTAGE_API_KEY`)로 이관하는 방안이 최초 계획이었습니다.

그러나 프로젝트 종료 시점이 약 5일 남은 상황이었습니다.
Upstage Solar는 호출당 비용이 발생하는 유료 API입니다.
영상 촬영 중 시연자나 외부 접속자가 AI 분석 기능을 반복 호출하면, 잔여 기간 동안 비용이 의도치 않게 발생할 수 있습니다.

---

## 🧭 선택지 비교

### 고려한 옵션

| 옵션 | 핵심 아이디어 | 결과 |
|------|---------------|------|
| A. AWS SSM 값 이관 | 기존 AWS 키를 GCP Secret Manager로 그대로 복사 후 주입 | 호출당 유료 비용 발생 → 기각 |
| B. 핸들러 삭제 | `analysis.go`의 `/api/v1/analysis/*` 핸들러를 코드에서 제거 | 복구 시 코드 변경 필요, 시간 부족 → 기각 |
| C. env 주입만 제외 (채택) | 코드는 유지하되 env 주입 경로(Terraform + k8s ExternalSecret)만 차단 | 복구 시 env 주입만 추가, 코드 변경 0 |

### 기각 이유

**A 탈락**: Upstage Solar는 호출당 과금 구조입니다.
영상 촬영 기간 5일 동안 AI 분석 엔드포인트가 활성화되면, 팀원 테스트·시연·외부 접속 등 의도치 않은 호출이 누적되어 불필요한 비용이 발생합니다.
프로젝트가 이미 종료 단계에 들어선 상황에서 신규 비용 항목을 열 이유가 없습니다.

**B 탈락**: 영상 이후 UPSTAGE 기능을 다시 쓸 가능성이 남아 있었습니다.
핸들러를 삭제하면 복구 시 코드 변경 + PR + 배포 전 과정이 필요합니다.
잔여 일정이 촉박한 상황에서 재작업 비용이 옵션 C보다 높았습니다.

### 결정 기준과 최종 선택

**C를 채택했습니다.**

결정 기준은 다음 우선순위로 세웠습니다.

1. **비용 차단**: 잔여 5일간 유료 API 호출이 발생하지 않아야 합니다
2. **복구 용이성**: 향후 UPSTAGE 기능이 다시 필요할 때 코드 변경 없이 env 주입만으로 복구 가능해야 합니다
3. **작업 최소화**: 촉박한 일정에서 변경 범위를 최소화해야 합니다

env만 빼는 방식은 세 기준을 동시에 충족합니다.
코드를 건드리지 않아 엔드포인트 구조는 살아있고, env가 없으면 키 초기화 실패로 `500`을 반환하므로 실질적인 호출 차단 효과를 얻습니다.

---

## 결정 내용

**`UPSTAGE_API_KEY`를 GCP prod에 주입하지 않습니다.**

### Terraform 변경

`Goti-Terraform` PR #14에서 다음 항목을 제거했습니다.

- `security_dashboard_upstage_api_key` 변수 선언
- `terraform/prod-gcp/terraform.tfvars` 로컬 값
- Secret Manager 리소스 참조 및 모듈 인자

PR #13(add)과 PR #14(remove)는 같은 세션 내에서 연속 처리됩니다.
Terraform state에는 Secret Manager 리소스가 생성되지 않으므로 state 오염이 없습니다.

### k8s values 변경

`Goti-k8s environments/prod-gcp/goti-security-dashboard/values.yaml` 변경 사항입니다.

```yaml
# 변경 전
externalSecret:
  enabled: true
envFrom:
  - secretRef:
      name: goti-security-dashboard-secret

# 변경 후
externalSecret:
  enabled: false
# envFrom secretRef 블록 삭제
```

`externalSecret.enabled: false`로 설정하면 ExternalSecret 오브젝트 자체가 생성되지 않아, Secret Manager에서 키를 당겨오는 과정이 시작되지 않습니다.

### 코드 변경 없음

`analysis.go`의 `/api/v1/analysis/*` 핸들러는 수정하지 않습니다.
env가 비어있으면 Upstage 클라이언트 초기화가 실패하고 요청 시 `500`을 반환합니다.

---

## 영향 범위

이 변경이 미치는 영향을 정리하면 다음과 같습니다.

**영향받는 기능 — AI 분석 엔드포인트**

프론트(Streamlit 대시보드)의 "AI 분석" 버튼을 누르면 `500` 에러를 반환합니다.
영상 촬영 시 해당 기능 시연은 회피해야 합니다.

**정상 작동 확인 — 나머지 엔드포인트**

아래 엔드포인트는 Upstage API와 무관하며, 검증 결과 모두 `200` 응답을 확인했습니다.

| 엔드포인트 | 검증 결과 | 시드 데이터 |
|---|---|---|
| `/dashboard/overview` | 200 | — |
| `/detections` | 200 | 22건 |
| `/stats` | 200 | — |
| `/mouse-macro` | 200 | 15건 |
| `/analytics` | 200 | — |
| `/alerts` | 200 | 7건 |

---

## 롤백 절차

향후 UPSTAGE 기능을 다시 활성화할 때는 다음 세 단계만 진행하면 됩니다.

1. `Goti-Terraform`에 `security_dashboard_upstage_api_key` 변수 및 Secret Manager 리소스 복구 → `apply`
2. `Goti-k8s values.yaml`에서 `externalSecret.enabled: true` + ExternalSecret override 설정 + `envFrom.secretRef` 블록 복원
3. Pod 롤아웃 → `/api/v1/analysis/*` 자동 복구

코드 변경이 전혀 없어 복구 경로가 infra/k8s 레이어에만 국한됩니다.

---

## 📚 배운 점

- **종료 직전 비용 제어는 env 레이어가 가장 빠릅니다** — 코드를 수정하지 않고 env 주입 경로만 끊으면 유료 외부 API 호출을 즉시 차단할 수 있습니다. 코드 삭제보다 복구 비용이 훨씬 낮습니다
- **PRD 단계에서도 add→remove 같은 즉각 반전 PR이 생길 수 있습니다** — PR #13(추가)과 PR #14(제거)를 같은 세션 내에 연속으로 냈습니다. 단순 실수가 아니라 "결정이 바뀌었음"을 명시적으로 PR로 남기는 편이 이력 추적에 유리합니다
- **ExternalSecret.enabled 플래그는 강력한 킬 스위치입니다** — `enabled: false` 하나로 Secret Manager 연동 전체를 끊을 수 있고, 나중에 `true`로 되돌리기만 하면 복구됩니다. 비용 민감한 기능에는 이런 토글 구조를 처음부터 갖추는 것이 좋습니다
