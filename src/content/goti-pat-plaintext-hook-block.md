---
title: "PAT 평문 노출 후 Claude Code 보안 hook이 모든 secret 작업을 막은 이유"
excerpt: "GitHub PAT를 채팅에 평문으로 붙여 넣은 직후 credential-leak hook이 gh secret set과 tfvars 편집까지 보수 차단했습니다. 의도는 옳지만 우회 방법과 영구 대책을 정리합니다"
type: troubleshooting
category: cicd
tags:
  - go-ti
  - Claude Code
  - Security
  - GitHub
  - PAT
  - Secrets
  - troubleshooting
date: "2026-04-19"
---

## 한 줄 요약

> GitHub PAT를 채팅에 평문으로 붙여 넣자마자 Claude Code의 credential-leak 보안 hook이 발동해 `gh secret set`과 `terraform.tfvars` 편집까지 일괄 차단됐습니다. 세션 내 `!` 직접 실행으로 우회했으며, 근본 대책은 "PAT는 채팅에 절대 평문으로 넣지 않는 것"입니다

---

## 🔥 문제: secret 관련 작업이 전부 Permission denied로 막힘

### 상황

GitHub PAT(`github_pat_11BUG...`)를 채팅 메시지에 그대로 붙여 넣은 직후부터 세 가지 작업이 연달아 차단됐습니다.

- `gh secret set` 및 `gh secret list` Bash 호출 → `Permission denied`
- `terraform.tfvars`에 Upstage API key를 쓰는 `Edit` 호출 → "gitignored 여부 불확실"로 차단
- 차단을 확인하기 위한 `git check-ignore` 재확인 호출도 보수적으로 차단

### 이상한 점

`gh secret set`은 값을 GitHub 저장소에 안전하게 등록하는 **표준 경로**입니다. 평문 저장이 아님에도 차단됐습니다.

`terraform.tfvars`의 경우 `.gitignore`에 `*.tfvars` 패턴이 이미 포함되어 있었지만, hook이 "not gitignored"로 오인해 편집을 막았습니다.

---

## 🤔 원인: credential-leak hook의 세션 flag 동작

Claude Code 세션 내부의 **credential-leak 보안 hook**은 메시지 이력에서 PAT 토큰을 감지하면 해당 세션을 "크리덴셜 유출 발생" 상태로 flag합니다.

flag 이후의 동작 흐름은 다음과 같습니다.

1. PAT 평문이 대화 이력에 남음
2. hook이 이 토큰을 "유출된 크리덴셜"로 간주
3. 이후 크리덴셜에 맞닿을 가능성이 있는 **모든 도구 호출을 일괄 보수 차단**

hook의 의도 자체는 옳습니다. 노출된 토큰을 agent가 재사용하거나 어딘가에 기록하지 못하도록 막는 것입니다.

문제는 **표준 비밀 관리 경로(`gh secret set`)까지 같이 걸린다**는 점입니다. hook은 "이 작업이 안전한가"를 세밀하게 판단하지 않고, 크리덴셜 관련 맥락에서 발생하는 작업이면 보수적으로 전부 차단합니다.

---

## ✅ 해결: 즉시 우회와 영구 대책

### 즉시 우회

**방법 1 — `!` prefix로 터미널에서 직접 실행**

Claude Code에서 `!` 접두사를 붙이면 agent 컨텍스트를 거치지 않고 사용자 터미널에서 직접 실행됩니다. 값을 prompt로 입력받기 때문에 토큰이 agent 이력에 남지 않습니다.

```bash
! gh secret set GH_PAT --repo <owner>/<repo>
# 실행 후 터미널에서 값을 직접 입력
```

**방법 2 — `git check-ignore` 결과를 Bash 출력에 먼저 남긴 뒤 재시도**

tfvars 편집의 경우, `git check-ignore -v` 결과가 Bash 출력에 명시적으로 남으면 hook이 "gitignored 확인됨"으로 판단해 통과시킵니다.

```bash
$ git check-ignore -v terraform.tfvars
.gitignore:5:*.tfvars   terraform.tfvars
# 이 출력이 남은 상태에서 Edit 재시도 → 통과
```

이번 세션에서는 두 방법으로 PAT 1건, tfvars 1건 모두 우회에 성공했고 최종 배포가 완료됐습니다. 다만 사용자가 직접 개입해야 하는 수동 단계가 추가됐습니다.

### 영구 대책

**PAT는 채팅에 절대 평문으로 넣지 않습니다.** 전달 방법은 세 가지입니다.

| 방법 | 설명 |
|------|------|
| `! gh secret set NAME --repo X` | agent가 값을 보지 않음, 터미널 prompt로 입력 |
| 임시 파일 경유 | `gh secret set NAME --repo X < /tmp/token && rm /tmp/token` |
| GitHub UI 직접 등록 | 브라우저에서 Settings → Secrets → Actions |

한 번 채팅에 노출된 토큰은 **동일 세션 내 모든 secret 관련 작업을 제한**하는 원인이 됩니다. 단기 토큰이라도 노출 즉시 revoke하고 재발급하는 것이 안전합니다.

---

## 📚 배운 점

- **PAT/API key/token은 채팅에 평문으로 붙여 넣지 않습니다** — 이것이 이번 트러블슈팅에서 얻은 가장 중요한 규칙입니다
- Claude Code의 credential-leak hook은 노출 감지 이후 세션 전체를 보수 상태로 전환합니다. 개별 작업의 안전성과 무관하게 크리덴셜 맥락이면 차단하는 설계입니다
- hook 동작이 틀린 것이 아닙니다. "왜 막혔는지"와 "어떻게 뚫을 수 있는지"를 빠르게 파악하면 불필요한 시간 낭비를 줄일 수 있습니다
- `! prefix`는 Claude Code에서 agent 컨텍스트를 우회해 터미널에서 직접 실행하는 유용한 탈출구입니다. 크리덴셜이 필요한 작업은 이 방식을 기본으로 사용하는 것이 좋습니다
- 노출된 토큰은 세션을 끝내더라도 **반드시 revoke**합니다. 세션 내에서만 제한되는 게 아니라 해당 토큰 자체가 위험 상태입니다
