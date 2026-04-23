---
title: "Renovate + ECR Private Registry 인증 실패 — 8회 시도 후 경로를 바꾼 이유"
excerpt: "custom.regex manager + ECR 조합에서 Docker v2 인증이 풀리지 않아 Renovate 경유를 포기하고, CD에서 values.yaml을 직접 업데이트하는 방식으로 전환한 기록입니다."
category: cicd
tags:
  - go-ti
  - Renovate
  - ECR
  - AWS
  - Troubleshooting
date: "2026-03-18"
---

## 한 줄 요약

> Renovate `custom.regex` manager가 ECR private registry를 조회할 때 **403 Forbidden**이 반복됐습니다. 8회에 걸쳐 원인을 좁혔지만 끝내 인증 flow를 통과시키지 못했고, Renovate를 중간 단계에서 제거하고 **CD에서 values.yaml을 직접 업데이트**하는 방식으로 전환했습니다.

---

## 🔥 문제: ECR 태그 조회가 403으로 떨어진다

### 기대한 파이프라인

goti-server CD에서 ECR에 새 이미지 태그를 push하면, Renovate가 ECR을 감지해 Goti-k8s 저장소의 `values.yaml` 태그를 업데이트하는 PR을 여는 구조입니다. automerge로 병합되면 ArgoCD가 sync하여 배포가 완결됩니다.

```text
goti-server CD → ECR push
              → Renovate: ECR 태그 조회
              → Goti-k8s values.yaml 태그 업데이트 PR
              → automerge → ArgoCD sync
```

- **Renovate**: v43.77.7 → v43.77.8 (`renovatebot/github-action@v46.1.5`)
- **ECR**: `<account>.dkr.ecr.ap-northeast-2.amazonaws.com`
- **Manager**: `custom.regex` (Helm values.yaml에서 image tag 추출)
- **AWS 인증**: GitHub Actions OIDC → AssumeRole

### 발견한 문제

Renovate가 ECR Docker v2 API (`/v2/{repo}/tags/list`)를 호출하는 단계에서 **403 Forbidden**이 반복됐습니다.

```text
DEBUG: GET https://<account>.dkr.ecr.ap-northeast-2.amazonaws.com/v2/goti-user/tags/list?n=1000
  = (code=ERR_NON_2XX_3XX_RESPONSE, statusCode=403 retryCount=0, duration=222)
DEBUG: Datasource unauthorized
DEBUG: Failed to look up docker package goti-user
DEBUG: 0 flattened updates found
```

ECR에는 대상 태그가 정상적으로 존재했습니다.

```text
goti-user:   dev-32-e0b1257, dev-41af00e, dev-71183b5
goti-server: dev-41af00e,    dev-71183b5, dev-72873ea
```

즉 리소스가 없거나 권한이 빠진 것이 아니라, **인증 헤더가 ECR이 요구하는 형태로 전달되지 않아** 403이 내려오는 상태였습니다.

---

## 🤔 원인: custom.regex manager에서 ECR 감지 분기가 타지지 않는다

Renovate는 Docker datasource 내부에 **`ecrRegex`** 를 두고 있고, 이 패턴에 매칭되면 AWS SDK로 `getAuthorizationToken`을 호출해 Base64 Basic 자격증명을 헤더로 붙입니다. built-in Docker manager(Dockerfile, docker-compose)에서는 이 분기가 정상적으로 동작합니다.

문제는 `custom.regex` manager에서 `registryUrlTemplate`을 사용할 때 나타났습니다.

- `registryUrlTemplate`은 스킴(`https://`)을 포함해야 PR 검증이 통과합니다.
- 그런데 Renovate 내부의 `ecrRegex`는 **호스트명만** 매칭합니다.
- `registryUrlTemplate` → internal registryUrl → `getAuthHeaders(registryHost)` 흐름을 거치면서, custom manager와 built-in Docker manager 사이에 URL 파싱/호스트 추출 경로가 달라진 것으로 추정됩니다.

결과적으로 ECR 감지(ecrRegex) 분기가 트리거되지 않아 **Basic 인증 경로를 타지 못하고**, Bearer 시도 혹은 익명 요청이 그대로 나가 ECR에서 403을 돌려주는 상황입니다.

---

## 🧭 선택지 비교

### 고려한 옵션

| 옵션 | 구성 | 결과 |
|------|------|------|
| A. Renovate `custom.regex` + ECR 인증 flow 수정 | `registryUrlTemplate`·`matchHost`·`hostRules`·`env-regex` 조합을 조정해 ECR Basic auth를 태워 보냄 | 8회 시도 끝에도 ECR 감지 분기가 동작하지 않아 **탈락** |
| B. Renovate built-in Docker manager로 전환 | values.yaml 대신 Dockerfile/compose 같은 built-in 인식 파일을 사용 | 값 관리 경로를 바꿔야 하고 Helm values 구조와 맞지 않아 **범위 밖** |
| C. Renovate 경유 제거, CD에서 values.yaml 직접 커밋 | goti-server CD가 이미지 빌드 후 GitHub API로 Goti-k8s `values.yaml`을 직접 수정 커밋 → ArgoCD sync | 인증 문제 근본 우회, 단계 단축 → **채택** |

### A를 포기하기까지의 8회 시도

원본 로그 그대로, 시도와 결과를 요약합니다.

1. **regex versioning 오류**: `versioningTemplate`에 `major` 그룹만 있어 validation 실패. `compatibility` 그룹 추가 + optional major로 수정해 validation 에러는 해소, **하지만 lookup은 여전히 403**.
2. **`registryUrl` 캡처 그룹 → `registryUrlTemplate` 전환**: matchStrings의 캡처 그룹이 스킴 없이 호스트만 잡아 invalid. `registryUrlTemplate: "https://..."` 고정으로 전환, "Invalid regex manager registryUrl" 경고 해소, **하지만 여전히 403**.
3. **hostRules 중복 제거**: `renovate.json`의 hostRules(password 없음)가 env의 `RENOVATE_HOST_RULES`를 덮어쓴다고 보고 제거. env 설정만 사용하도록 단일화, **하지만 여전히 403**.
4. **AWS 환경변수를 Docker 컨테이너에 전달**: `renovatebot/github-action`이 `RENOVATE_*` prefix만 전달해 AWS env가 누락됐다고 판단. `env-regex`에 `AWS_\w+`를 추가해 `--env AWS_ACCESS_KEY_ID` 등이 컨테이너로 들어가는 것을 확인, **하지만 여전히 403**.
5. **matchHost 프로토콜 일치**: `registryUrlTemplate`(`https://`)과 `matchHost`의 프로토콜 표기를 맞춤. `matchHost`에 `https://` 추가, **변화 없음**.
6. **AWS SDK 자동 인증**: hostRules를 제거하고 AWS SDK가 env에서 자격증명을 읽어 자동으로 인증하도록 유도. `ECR getAuthorizationToken error`가 발생, AWS SDK가 컨테이너 내부에서 자격증명을 보지만 **인증 단계에서 실패**.
7. **get-authorization-token + `token` 필드**: Base64 authorization token을 hostRules `token` 필드로 전달. Renovate가 이 필드를 **Bearer 스킴**으로 전송, ECR은 Basic을 요구하므로 **403**.
8. **소스코드 분석 후 최종 시도**: `getECRAuthToken` 함수가 `username === "AWS" && password` 조건일 때 Base64 Basic auth를 직접 반환함을 확인. `matchHost`에서 `https://` 제거 + `username`/`password` 방식으로 ECR 감지 분기를 유도. 로그에 `Adding password authentication`은 찍혔지만, `encoding basic auth credentials for ECR registry` 로그가 **끝내 나오지 않았습니다**. 즉 ECR 감지 분기가 여전히 타지지 않아 403.

추가로 `registryUrlTemplate`에서 `https://`를 빼보기도 했습니다. 이 경우 Renovate가 Docker Hub로 fallback해 `hub.docker.com/v2/repositories/library/goti-payment`를 조회했고, 더 나쁜 결과가 나왔습니다. `https://`는 필수라는 점만 재확인한 셈입니다.

### B를 고려하지 않은 이유

built-in Docker manager로 옮기려면 관리 대상 파일을 Dockerfile/compose로 바꿔야 합니다. 하지만 이 프로젝트의 배포 단위는 Helm values.yaml이고, ArgoCD도 values 기준으로 sync합니다. 인증 문제 하나를 풀자고 **배포 계약 전체를 뒤집는 비용**은 정당화되지 않았습니다.

### 결정 기준과 최종 선택

**C (CD에서 values.yaml 직접 커밋)를 채택했습니다.**

결정 기준은 다음 우선순위입니다.

1. **막힌 인증 flow를 근본적으로 우회할 수 있는가** — A는 8회 시도에도 ECR 감지 분기를 끝내 타지 못했습니다. C는 아예 Renovate를 경로에서 제거하므로 이 문제가 사라집니다.
2. **파이프라인 단계가 짧아지는가** — `CD → Renovate → PR → automerge → ArgoCD` 5단계를 `CD → values 커밋 → ArgoCD`의 3단계로 축소합니다.
3. **배포 계약을 바꾸지 않는가** — 관리 대상 파일이 여전히 `values.yaml`이라 ArgoCD·Helm 구조에 영향이 없습니다.

A가 이상적이긴 했지만 "ECR 감지 분기가 타지 않는다"는 본질적 제약이 해소되지 않는 이상 시간을 더 태울 근거가 없었습니다.

---

## ✅ 결정: CD에서 Goti-k8s values.yaml을 직접 커밋한다

goti-server CD 파이프라인이 다음 순서로 동작합니다.

1. goti-server CD가 이미지 빌드를 마치고 ECR에 push합니다.
2. 동일 워크플로우에서 **GitHub API로 Goti-k8s의 `values.yaml`을 직접 수정**해 커밋합니다.
3. ArgoCD가 Goti-k8s 저장소 변경을 감지해 자동 배포합니다.

이 경로에서는 ECR에 대한 Docker v2 인증을 거치지 않습니다. 이미지는 **EKS 노드에서 image pull 시에만** ECR 인증이 필요하고, 이 쪽은 노드에 부여된 IAM Role로 이미 정상 동작하는 경로입니다. 즉 Renovate 인증 문제는 **CD 쪽에서 태그 값을 안다는 사실**만으로 완전히 우회됩니다.

---

## 📚 배운 점

- **custom.regex + ECR 조합은 아직 fragile합니다.** Renovate built-in Docker manager는 ECR을 문제없이 다루지만, `registryUrlTemplate` 경유 시 `ecrRegex` 감지가 꺾이는 경계가 존재합니다. 동일 조합을 시도한다면 v44+ 개선 여부를 먼저 확인하는 편이 낫습니다.
- **"중간 단계"는 실패 지점을 늘립니다.** Renovate는 버전 감지 + PR 생성 + automerge를 얹어주는 유용한 레이어이지만, 실패 시 디버깅 포인트가 하나 더 늘어납니다. CD가 이미 **새 태그 값을 알고 있는 상황**이라면, 중간에서 다시 조회하는 경로보다 직접 커밋이 단순합니다.
- **8회 시도는 탈출 신호입니다.** 같은 층위에서 설정을 바꿔가며 실패가 반복되면, 제약 조건 자체(custom.regex 경로의 ECR 감지 불능)가 고정이라는 뜻입니다. 접근 경로를 바꾸는 결정을 앞당길 수 있었습니다.
- **로그 한 줄로 분기 감지를 확인할 수 있습니다.** ECR 분기가 타졌는지는 `encoding basic auth credentials for ECR registry` 로그 한 줄로 판정 가능합니다. 이 로그가 없으면 인증 헤더를 어떻게 조합해도 ECR에서는 Basic으로 받아들이지 않습니다.
- **우회는 패배가 아닙니다.** 근본 원인을 풀지 못했더라도, 파이프라인을 단순화하고 배포 계약을 유지했다면 실질적 이득이 있는 결정입니다. 미해결 이슈는 `v44+ 재시도 후보`로 기록해 두고, 현실은 배포가 돌아가게 합니다.

## 관련 파일

- `Goti-k8s/renovate.json` — custom regex manager 설정
- `Goti-k8s/.github/workflows/renovate.yml` — Renovate GitHub Actions workflow
- `Goti-k8s/environments/dev/goti-*/values.yaml` — 이미지 태그 대상 파일

## 참고

- [Renovate Docker datasource ECR auth 소스코드](https://github.com/renovatebot/renovate/blob/main/lib/modules/datasource/docker/ecr.ts)
- [Renovate getAuthHeaders 소스코드](https://github.com/renovatebot/renovate/blob/main/lib/modules/datasource/docker/common.ts)
- [ECR getAuthorizationToken — Discussion #11001](https://github.com/renovatebot/renovate/discussions/11001)
- [Private ECR repositories Failed to look up — Issue #11322](https://github.com/renovatebot/renovate/issues/11322)
- [renovatebot/github-action env-regex](https://deepwiki.com/renovatebot/github-action/2.2-environment-variables)
