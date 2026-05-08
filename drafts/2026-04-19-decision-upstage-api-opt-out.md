---
date: 2026-04-19
type: decision
scope: prod-gcp / security-dashboard
---

# Decision — UPSTAGE Solar API 주입 제외 (security-dashboard GCP)

## Context

- `Go-ti-security-dashboard/macro-dashboard-api/analysis.go`의 `/api/v1/analysis/*` 계열 엔드포인트는 Upstage Solar LLM을 호출하여 탐지 이벤트/매크로 세션/IP를 AI 분석하는 기능.
- 환경변수 `UPSTAGE_API_KEY` 필요.
- 영상 추가촬영용으로 GCP prod에 올리는 과정에서 최초 계획은 AWS SSM(`/prod/security-dashboard/UPSTAGE_API_KEY`)과 동일 값을 GCP Secret Manager(`goti-prod-security-dashboard-UPSTAGE_API_KEY`)로 이관.
- 사용자(팀 리더) 판단: **Upstage Solar는 유료 API**라 prod 주입 시 호출당 비용 발생. 프로젝트 종료가 다음주(~2026-04-24)라 비용 발생 차단 우선.

## Decision

**UPSTAGE_API_KEY를 GCP prod에 주입하지 않는다.**

- Goti-Terraform: `security_dashboard_upstage_api_key` 변수/맵/모듈 인자 전량 제거 (#14)
- Goti-k8s `environments/prod-gcp/goti-security-dashboard/values.yaml`:
  - `externalSecret.enabled: false`
  - `envFrom.secretRef` 블록 삭제
- `terraform/prod-gcp/terraform.tfvars` 로컬 값 제거
- 코드(analysis.go)는 수정하지 않음 → 엔드포인트는 존재하지만 env 미설정으로 500 반환

## Alternatives 검토

| 옵션 | 선택 안 한 이유 |
|---|---|
| A. 기존 AWS SSM 값 그대로 이관 | 호출당 유료 비용 발생 |
| B. 코드에서 `/api/v1/analysis/*` 핸들러 아예 삭제 | 영상 이후 복구 난이도 증가, 시간 부족 |
| C. env 주입만 빼고 코드 유지 ← **채택** | 복구 시 env 주입만 추가, 코드 변경 0 |

## Consequences

- 대시보드 프론트(Streamlit)가 "AI 분석" 버튼을 누르면 500 에러. 영상에서 해당 기능 시연 회피 필요.
- 다른 엔드포인트(dashboard/overview, detections, stats, mouse-macro, analytics, alerts)는 정상 작동 — 검증 완료 (200 응답, 더미 seed 22/15/7)
- Terraform state 오염 없음 — PR #13 merge 후 apply 실행 전 PR #14로 코드 롤백.

## Rollback

향후 UPSTAGE 재도입 시:
1. Goti-Terraform에 `security_dashboard_upstage_api_key` 변수 복구 + Secret Manager 리소스 추가 → apply
2. Goti-k8s values.yaml에서 `externalSecret.enabled: true` + ExternalSecret override regex + `envFrom.secretRef` 복원
3. pod 롤아웃 → `/api/v1/analysis/*` 자동 복구

## References

- Goti-Terraform PR #13 (add) / #14 (remove) — 같은 세션 내 add→remove
- Goti-k8s PR #303 (최종 버전엔 externalSecret disabled)
- 세션 요약: [2026-04-19-session-security-dashboard-gcp-deploy.md](sessions/2026-04-19-session-security-dashboard-gcp-deploy.md)
