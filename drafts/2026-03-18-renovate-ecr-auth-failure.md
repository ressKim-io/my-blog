---
date: 2026-03-18
category: troubleshoot
project: Goti-k8s
tags: [renovate, ecr, docker, github-actions, auth, unresolved]
---

# Renovate custom regex manager + ECR private registry 인증 실패 — 미해결

## Context

Goti-k8s에서 Renovate를 사용하여 ECR private registry의 컨테이너 이미지 태그를 자동 업데이트하려는 작업.
goti-server CD가 ECR에 이미지를 push → Renovate가 ECR에서 새 태그를 감지 → Goti-k8s values.yaml 태그 업데이트 PR 생성 → automerge → ArgoCD sync 파이프라인.

- **Renovate**: v43.77.7 → v43.77.8 (renovatebot/github-action@v46.1.5)
- **ECR**: 707925622666.dkr.ecr.ap-northeast-2.amazonaws.com
- **Manager**: custom.regex (Helm values.yaml에서 image tag 추출)
- **AWS 인증**: GitHub Actions OIDC → AssumeRole

## Issue

Renovate가 ECR Docker v2 API (`/v2/{repo}/tags/list`) 호출 시 **403 Forbidden** 반환.

```
DEBUG: GET https://707925622666.dkr.ecr.ap-northeast-2.amazonaws.com/v2/goti-user/tags/list?n=1000
  = (code=ERR_NON_2XX_3XX_RESPONSE, statusCode=403 retryCount=0, duration=222)
DEBUG: Datasource unauthorized
DEBUG: Failed to look up docker package goti-user
DEBUG: 0 flattened updates found
```

ECR 이미지/태그는 정상 존재 확인:
```
goti-user: dev-32-e0b1257, dev-41af00e, dev-71183b5
goti-server: dev-41af00e, dev-71183b5, dev-72873ea
```

## Action

### 1차: regex versioning 설정 오류 (해결)
- **가설**: `versioningTemplate`에 `major` group만 있어 validation 실패
- **결과**: `compatibility` group 추가 + optional major로 수정 → config validation 에러 해결, 이슈 #46 자동 닫힘
- **하지만**: ECR lookup은 여전히 403

### 2차: registryUrl 캡처 그룹 → registryUrlTemplate 전환 (해결)
- **가설**: matchStrings의 `registryUrl` 캡처 그룹이 프로토콜 없이 호스트명만 잡아 invalid
- **결과**: `registryUrlTemplate: "https://..."` 고정으로 전환 → "Invalid regex manager registryUrl" 경고 해결
- **하지만**: ECR lookup은 여전히 403

### 3차: hostRules 중복 제거 (부분 해결)
- **가설**: renovate.json의 hostRules(password 없음)가 env의 RENOVATE_HOST_RULES를 덮어씀
- **결과**: renovate.json에서 hostRules 제거 → env 설정만 사용
- **하지만**: ECR lookup은 여전히 403

### 4차: AWS 환경변수 Docker 컨테이너 전달 (해결)
- **가설**: renovatebot/github-action이 `RENOVATE_*` prefix만 Docker 컨테이너에 전달, AWS env 누락
- **결과**: `env-regex`에 `AWS_\\w+` 추가 → `--env AWS_ACCESS_KEY_ID` 등 컨테이너 전달 확인
- **하지만**: ECR lookup은 여전히 403

### 5차: matchHost 프로토콜 일치 (변화 없음)
- **가설**: registryUrlTemplate `https://`와 matchHost 프로토콜 불일치
- **결과**: matchHost에 `https://` 추가 → 변화 없음

### 6차: AWS SDK 자동 인증 (ECR getAuthorizationToken error)
- **가설**: hostRules 제거하고 AWS SDK가 env에서 자격증명 읽어 자동 인증
- **결과**: `ECR getAuthorizationToken error` 발생 — AWS SDK가 컨테이너 내부에서 자격증명을 읽지만 인증 실패

### 7차: get-authorization-token + token 필드 (Bearer/Basic 불일치)
- **가설**: Base64 authorization token을 hostRules `token` 필드로 전달
- **결과**: Renovate가 `token` 필드를 `Bearer` 스킴으로 전송 (ECR은 Basic 필요) → 403

### 8차: Renovate 소스코드 분석 후 최종 시도
- **발견**: `getECRAuthToken` 함수에서 `username === "AWS" && password` 조건 시 Base64 Basic auth 직접 반환
- **가설**: matchHost에서 `https://` 제거 + username/password 방식으로 ECR 감지 분기 유도
- **결과**: `Adding password authentication` 로그 확인, 하지만 `encoding basic auth credentials for ECR registry` 로그 미출현 → ECR 감지 안 됨 → 여전히 403

### registryUrlTemplate https:// 제거 시도
- **결과**: Renovate가 Docker Hub로 fallback (`hub.docker.com/v2/repositories/library/goti-payment`) → 더 나쁜 결과
- `registryUrlTemplate`에 `https://`는 필수

## Root Cause (추정)

Renovate custom regex manager의 `registryUrlTemplate`이 `https://` prefix를 포함해야 하지만, Renovate Docker datasource의 `ecrRegex` 패턴은 **호스트명만** 매칭한다. `registryUrlTemplate` → internal registryUrl → `getAuthHeaders(registryHost)` 과정에서 URL 파싱/호스트 추출이 custom regex manager와 built-in Docker manager 사이에 다르게 동작하는 것으로 추정.

**핵심 문제**: Renovate custom.regex manager + ECR private registry 조합에서 Docker v2 인증 flow가 정상 작동하지 않음. ECR 자동 감지(`ecrRegex`)가 `registryUrlTemplate` 경유 시 트리거되지 않아 Basic auth 분기를 타지 못함.

## Result

**미해결** — 8회 이상 시도 후 Renovate 경유 방식 포기.

### 대안 결정
goti-server CD에서 Goti-k8s values.yaml을 **직접 업데이트**하는 방식으로 전환:
1. goti-server CD 이미지 빌드 완료
2. GitHub API로 Goti-k8s values.yaml 파일 직접 수정 커밋
3. ArgoCD가 변경 감지 → 자동 배포

Renovate 중간 단계를 제거하여 ECR 인증 문제를 우회.

### 향후 참고
- Renovate built-in Docker manager (Dockerfile, docker-compose)에서는 ECR 인증이 정상 동작할 수 있음
- custom.regex manager + ECR 조합은 커뮤니티에서도 해결 사례가 부족
- Renovate v44+ 에서 개선될 가능성 있음 — 추후 재시도 고려

## Related Files
- `Goti-k8s/renovate.json` — custom regex manager 설정
- `Goti-k8s/.github/workflows/renovate.yml` — Renovate GitHub Actions workflow
- `Goti-k8s/environments/dev/goti-*/values.yaml` — 이미지 태그 대상 파일

## References
- [Renovate Docker datasource ECR auth 소스코드](https://github.com/renovatebot/renovate/blob/main/lib/modules/datasource/docker/ecr.ts)
- [Renovate getAuthHeaders 소스코드](https://github.com/renovatebot/renovate/blob/main/lib/modules/datasource/docker/common.ts)
- [ECR getAuthorizationToken - Discussion #11001](https://github.com/renovatebot/renovate/discussions/11001)
- [Private ECR repositories Failed to look up - Issue #11322](https://github.com/renovatebot/renovate/issues/11322)
- [renovatebot/github-action env-regex](https://deepwiki.com/renovatebot/github-action/2.2-environment-variables)
