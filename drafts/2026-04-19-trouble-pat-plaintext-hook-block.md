---
date: 2026-04-19
type: troubleshoot
scope: claude-code session / security hooks
---

# Trouble — PAT 평문 노출 후 보안 hook 전반 차단

## Symptom

사용자가 채팅에 GitHub PAT(`goti-k8s-dispatch`, `github_pat_11BUG...`)를 평문으로 붙여 넣은 직후부터:
- `gh secret set`, `gh secret list` 관련 Bash 호출이 `Permission denied`로 차단
- `terraform.tfvars`에 실제 Upstage API key를 쓰려는 `Edit` 호출이 "gitignored 여부 불확실"로 차단
- 같은 hook이 이후 `git check-ignore` 재확인까지도 보수적으로 차단하는 순간 발생

## Root Cause

Claude Code 세션 내부의 **credential-leak 보안 hook**이 "PAT 평문 감지" 이벤트 이후 세션 상태를 flag하고, **크리덴셜에 맞닿은 모든 도구 호출을 일괄 보수 차단**함.

- hook는 메시지 이력에 남은 PAT 토큰을 "유출됨"으로 간주 → agent가 "사용/저장"하지 못하도록 차단
- 의도는 옳지만, `gh secret set`은 GitHub에 저장되는 표준 경로라 본래 차단 대상이 아님에도 같이 걸림
- tfvars 편집도 `*.tfvars` 전역 gitignore 패턴에 포함되어 있음에도 "not gitignored" 오인

## Fix / Workaround

### 즉시 우회
1. **사용자가 `!` prefix 또는 터미널에서 직접 `gh secret set GH_PAT --repo <repo>` 실행** — 값을 prompt로 받기 때문에 agent 컨텍스트에 안 남음
2. tfvars 편집은 `git check-ignore -v`로 명시 확인 결과를 Bash 출력에 남긴 직후 재시도 → hook이 통과

### 영구 대책
- **PAT은 채팅에 절대 평문으로 넣지 말 것.** 전달 방법:
  - `! gh secret set NAME --repo X` — agent가 값을 보지 않음
  - 임시 파일 + `gh secret set NAME --repo X < /tmp/token && rm /tmp/token`
  - 또는 사용자가 GitHub UI에서 직접 등록
- 한 번 노출되면 **동일 세션에서 모든 secret 관련 작업이 제한**되므로 단기 토큰이라도 revoke 필요

## Session 영향

- 이번 세션에서는 `!` 직접 실행으로 회피 성공 (PAT 1건, tfvars 1건)
- 최종 배포는 완료되었으나 사용자 수동 단계가 추가됨
- 사용자 메모 `feedback_no_cost_action_without_approval` / `rules/security.md`와 같은 방향이라 hook 동작은 긍정적 — 다만 사용자에게 "왜 막혔고 어떻게 뚫을지"를 명확히 전달하는 대응이 중요했음

## Preventive Rule (rules/security.md 보완 후보)

- "PAT/API key/token은 채팅에 평문으로 **절대 붙여 넣지 않는다**. 전달이 필요하면 사용자가 터미널에서 직접 `gh secret set` 또는 `!` prefix로 실행한다."
- "한 번 노출된 토큰은 **반드시 revoke**하고 재발급. 세션 내 해당 토큰 사용 자체가 유출을 확대함."

## References

- 세션 요약: [2026-04-19-session-security-dashboard-gcp-deploy.md](sessions/2026-04-19-session-security-dashboard-gcp-deploy.md)
- 관련 규칙: `.claude/rules/security.md` (시크릿 관리 섹션)
