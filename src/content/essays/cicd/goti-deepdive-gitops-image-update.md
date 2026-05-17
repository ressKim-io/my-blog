---
title: "GitOps 이미지 자동 업데이트 — Renovate·Image Updater·CI Push 동작 원리"
excerpt: "컨테이너 이미지 새 버전을 GitOps 레포에 자동으로 반영하는 세 가지 방식이 각각 어떻게 동작하는지, 레지스트리 polling·PR write-back·직접 commit 메커니즘을 중심으로 설명합니다"
category: cicd
tags:
  - go-ti
  - renovate
  - argocd-image-updater
  - gitops
  - container-image
  - concept
series:
  name: "goti-deepdive-platform"
  order: 4
date: "2026-03-16"
---

## 한 줄 요약

> GitOps에서 새 컨테이너 이미지를 클러스터에 반영하려면 Git 레포의 `image.tag`를 먼저 갱신해야 합니다 — 이 갱신을 자동화하는 방식이 세 가지로 나뉩니다

---

## 🤔 무엇을 푸는 기술인가

GitOps의 핵심 원칙은 **Git이 유일한 상태 소스**라는 것입니다 ArgoCD 같은 GitOps 오퍼레이터는 Git 레포의 선언 상태를 클러스터에 지속적으로 동기화합니다 CI 파이프라인이 새 이미지를 빌드해 레지스트리에 push해도, Git 레포의 `values.yaml`에 있는 `image.tag`가 바뀌지 않으면 클러스터는 이전 이미지를 그대로 유지합니다

이 지점이 GitOps에서 컨테이너 이미지 자동 업데이트 문제의 본질입니다 레지스트리 push와 클러스터 배포 사이에 **Git write-back**이라는 단계가 반드시 필요합니다

Git write-back을 수행하는 방법은 크게 세 가지로 나뉩니다

- **CI Push**: CI 파이프라인이 이미지 빌드 직후 GitOps 레포에 직접 commit
- **ArgoCD Image Updater**: 클러스터 내 Pod이 레지스트리를 polling하다가 새 태그 감지 시 write-back
- **Renovate**: 외부 실행 환경(GitHub Actions)이 datasource를 스캔하고 PR을 생성한 뒤 automerge

세 방식은 동작 위치(클러스터 내부 vs 외부), write-back 방법(직접 commit vs PR), 레지스트리 인증 방식이 모두 다릅니다

---

## 🔧 동작 원리

### GitOps pull 루프와 write-back의 위치

ArgoCD는 주기적으로(기본 3분) Git 레포를 폴링하거나 webhook을 통해 변경을 감지합니다 변경이 있으면 클러스터 상태를 Git 선언 상태와 일치시키는 **reconciliation loop**를 수행합니다

```text
Registry (새 이미지 push)
    ↓  ← 이 구간을 자동화하는 것이 이번 글의 주제
Git (image.tag 갱신)
    ↓  ← ArgoCD가 담당하는 구간
K8s 클러스터 (Pod rolling update)
```

CI가 이미지를 `dev-abc123`으로 빌드해 ECR에 push했다면, `values.yaml`의 `image.tag: dev-abc123` 반영이 없는 한 ArgoCD는 아무것도 하지 않습니다 write-back이 GitOps 자동화의 필수 링크입니다

### 방식 A — CI Push (직접 commit)

가장 단순한 방법입니다 CI 파이프라인의 마지막 단계에서 GitOps 레포에 직접 commit을 만들어 `image.tag`를 갱신합니다

```bash
# GitHub Actions 예시 (이미지 빌드 후)
git clone https://github.com/org/gitops-repo
cd gitops-repo
sed -i "s|image.tag:.*|image.tag: ${NEW_TAG}|" environments/dev/values.yaml
git commit -m "chore: update image.tag to ${NEW_TAG}"
git push
```

배포 지연이 가장 짧습니다(~1분) 그러나 MSA 서비스가 여러 개인 환경에서 동시에 이미지 빌드가 완료되면 여러 CI 잡이 같은 파일에 동시에 commit을 시도해 **git push 충돌**이 발생할 수 있습니다 충돌 처리 로직을 CI에 추가하지 않으면 일부 서비스의 태그 갱신이 유실됩니다

### 방식 B — ArgoCD Image Updater (annotation 기반 polling)

ArgoCD Image Updater는 ArgoCD와 같은 네임스페이스에서 실행되는 별도 Pod입니다 주기적으로 컨테이너 레지스트리를 polling해 새 태그를 감지하면 git write-back을 수행합니다

설정은 Application 또는 ApplicationSet의 annotation으로 선언합니다

```yaml
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: "goti-user=123456789.dkr.ecr.ap-northeast-2.amazonaws.com/goti-user"
    argocd-image-updater.argoproj.io/goti-user.update-strategy: latest
    argocd-image-updater.argoproj.io/write-back-method: git
    argocd-image-updater.argoproj.io/git-branch: main
```

write-back 시에는 Git 레포에 `.argocd-source-{app}.yaml` 파일을 생성하거나 Helm values를 직접 수정합니다 이 방식은 **클러스터 내부에서 동작**한다는 점이 핵심 제약입니다 클러스터가 다운되면 이미지 업데이트도 멈춥니다

ECR처럼 자격증명이 만료되는 레지스트리에서는 토큰 갱신 CronJob을 별도로 운영해야 합니다 ECR 토큰은 12시간마다 만료되며, Image Updater Pod이 갱신된 토큰을 읽도록 시크릿을 주기적으로 교체하는 CronJob이 필요합니다

ApplicationSet 환경에서는 주의가 필요합니다 Image Updater가 `.argocd-source` 파일을 write-back하면, ApplicationSet 컨트롤러가 변경을 감지해 Application을 재생성하려 하고, 이 과정에서 Image Updater가 다시 write-back을 시도하는 **sync loop**가 발생할 수 있습니다

### 방식 C — Renovate (PR 기반 write-back)

Renovate는 의존성 업데이트 도구입니다 npm·Maven·Helm Chart 버전 갱신으로 알려져 있지만, **컨테이너 이미지 태그**도 관리 대상입니다 `manager: helm-values`와 `datasource: docker`를 조합하면 Helm values 파일의 `image.tag`를 컨테이너 레지스트리 태그 변경과 연동할 수 있습니다

Renovate는 클러스터 외부(GitHub Actions 등)에서 실행됩니다 클러스터 상태와 완전히 독립적입니다

![GitOps 이미지 업데이트 세 가지 방식 비교 — CI Push / Image Updater / Renovate|tall](/diagrams/goti-deepdive-gitops-image-update-1.svg)

위 다이어그램은 세 방식이 갈라지는 지점을 나란히 보여줍니다 CI 빌드가 새 이미지를 레지스트리에 push한 뒤, 각 방식이 서로 다른 경로로 GitOps 레포의 `image.tag`를 갱신합니다 CI Push(초록)는 git commit으로 직접 갱신하고, Image Updater(빨강)는 클러스터 내 Pod이 polling 후 write-back을 수행하며, Renovate(파랑)는 외부에서 PR을 생성한 뒤 automerge를 통해 main 브랜치에 반영합니다 세 방식 모두 GitOps 레포의 변경이 완료된 뒤에야 ArgoCD의 reconciliation이 시작됩니다 이 구조에서 write-back의 신뢰성이 전체 파이프라인 안정성을 좌우합니다

### Renovate의 datasource 스캔 메커니즘

![Renovate 동작 원리 — datasource 스캔부터 ArgoCD sync까지|tall](/diagrams/goti-deepdive-gitops-image-update-2.svg)

위 다이어그램은 Renovate의 전체 흐름을 단계별로 보여줍니다

Renovate는 `renovate.json`에 정의된 `manager: helm-values`를 통해 Helm values 파일을 파싱합니다 파일 안에서 `image.tag` 형태로 선언된 이미지 참조를 찾아냅니다 이 참조를 `datasource: docker`로 처리해 컨테이너 레지스트리의 Docker v2 API를 호출합니다

레지스트리에 새 태그가 존재하면 Renovate는 GitOps 레포에 PR을 생성합니다 PR에는 `image.tag: 이전값` → `image.tag: 새값` 변경이 담깁니다 `automerge: true` 설정이 있으면 CI 검사를 통과한 PR이 자동으로 merge됩니다 merge된 commit은 ArgoCD가 감지해 클러스터에 반영합니다

```json
// renovate.json 핵심 구조
{
  "extends": ["config:base"],
  "kubernetes": {
    "fileMatch": ["environments/.+/values\\.yaml$"]
  },
  "hostRules": [
    {
      "matchHost": "123456789.dkr.ecr.ap-northeast-2.amazonaws.com",
      "hostType": "docker",
      "username": "AWS",
      "password": "{{ env.ECR_TOKEN }}"
    }
  ],
  "packageRules": [
    {
      "matchDatasources": ["docker"],
      "automerge": true,
      "automergeType": "pr"
    }
  ]
}
```

`hostRules` 배열로 여러 레지스트리의 인증 정보를 각각 정의합니다 ECR의 경우 GitHub Actions OIDC로 AWS 자격증명을 얻어 ECR 토큰을 생성한 뒤 환경 변수로 주입하는 방식을 사용합니다 Harbor는 Docker v2 API와 완전히 호환되므로 `username`/`password`로 직접 인증합니다

### 레지스트리 인증의 차이

세 방식은 레지스트리 인증을 처리하는 방식도 다릅니다

Image Updater는 클러스터 내 시크릿으로 레지스트리 자격증명을 관리합니다 ECR처럼 토큰이 주기적으로 만료되는 경우, 토큰 갱신 CronJob이 시크릿을 12시간마다 교체해야 합니다 Kind 환경처럼 IRSA(IAM Role for Service Account)를 사용할 수 없는 환경에서는 이 CronJob 의존도가 높아집니다

Renovate는 GitHub Actions에서 실행되므로 OIDC를 통해 AWS 자격증명을 단기 발급받을 수 있습니다 토큰 갱신 별도 관리가 필요 없습니다 멀티 레지스트리(ECR + Harbor + GCP Artifact Registry)를 동시에 사용하는 경우, `hostRules` 배열에 항목을 추가하는 것만으로 레지스트리를 추가하거나 교체할 수 있습니다

---

## 📐 세부 동작과 옵션

### 세 방식 비교

| 항목 | CI Push | Image Updater | Renovate |
|---|---|---|---|
| 실행 위치 | CI 파이프라인 (외부) | 클러스터 내 Pod | GitHub Actions (외부) |
| write-back 방식 | git commit 직접 | `.argocd-source` 파일 | PR 생성 → automerge |
| 클러스터 의존성 | 없음 | **있음** — 클러스터 다운 시 중단 | 없음 |
| 배포 지연 | ~1분 | ~2분 | 5~15분 |
| ApplicationSet 호환 | 무관 | **sync loop 주의** | 무관 |
| MSA 동시 업데이트 | race condition 위험 | registry rate limit | PR grouping으로 격리 |
| 레지스트리 인증 관리 | CI 환경에서 처리 | 클러스터 시크릿 + CronJob | hostRules 배열 |
| 감사 추적 | bot commit 이력 | `.argocd-source` (리뷰 없음) | PR 히스토리 |
| 문제 시 롤백 | git revert | 수동 개입 | PR revert |

### Renovate automerge 전략

`automergeType`에는 `pr`과 `branch` 두 가지 값이 있습니다 `pr`(기본)은 PR을 생성하고 CI 검사를 통과한 뒤 automerge합니다 `branch`는 PR 없이 브랜치에 직접 commit합니다 GitOps 환경에서는 PR 이력을 감사 추적에 활용할 수 있는 `pr` 방식이 일반적입니다

`schedule` 옵션으로 Renovate 실행 주기를 제어합니다 `"every 30 minutes"` 같은 자연어 형식을 지원합니다 `"dev 환경은 30분마다, prod 환경은 수동 merge"` 같은 환경별 전략을 `packageRules`로 구분할 수 있습니다

```json
{
  "packageRules": [
    {
      "matchFileNames": ["environments/dev/**"],
      "automerge": true
    },
    {
      "matchFileNames": ["environments/prod/**"],
      "automerge": false
    }
  ]
}
```

### Image Updater write-back 모드

Image Updater의 write-back 방법은 두 가지 annotation으로 제어합니다

| annotation | 값 | 동작 |
|---|---|---|
| `write-back-method` | `git` | Git 레포에 `.argocd-source` 파일 생성 |
| `write-back-method` | `argocd` | ArgoCD Application Parameter override (Git 변경 없음) |

`git` 방식은 Git 레포에 실제 파일을 commit합니다 ArgoCD 재시작 후에도 상태가 보존됩니다 `argocd` 방식은 Git 레포를 변경하지 않고 Application 오브젝트의 parameter에만 반영합니다 GitOps 원칙에서 벗어나는 방식이므로 일반적으로 `git` 방식을 권장합니다

---

## 🧩 go-ti에서는

go-ti는 6개 MSA 서비스(user, stadium, ticketing, payment, resale, 모놀리식)의 이미지가 ECR에 push됩니다 ArgoCD Image Updater가 이미 설치되어 있었지만, `argocd-image-updater-secret` 누락, git write-back 인증 미설정, Goti-k8s 레포 시크릿 미등록 등 세 가지 Blocker로 한 번도 정상 동작하지 못한 상태였습니다 ApplicationSet과의 sync loop 가능성도 확인된 상황이었습니다

Kind 환경에서 클러스터 독립성이 요구됐고, 향후 ECR → Harbor → GCP Artifact Registry 전환 가능성도 있었습니다 Renovate의 `hostRules` 배열 구조는 레지스트리 추가를 1~2줄 변경으로 처리할 수 있어 이 요건에 부합했습니다 MSA 6개 서비스의 동시 이미지 업데이트도 PR별로 격리되므로 CI Push의 race condition 위험을 피할 수 있었습니다

결국 Renovate(self-hosted, GitHub Actions)를 선택했지만, 설정 복잡도와 시간 부족으로 실제 도입은 완료하지 못했습니다 현재는 수동으로 `image.tag`를 갱신하고 있습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [컨테이너 이미지 자동 업데이트 전략 — Renovate vs Image Updater vs CI Push](/essays/goti-container-image-update-strategy-adr)에 정리했습니다

---

## 📚 핵심 정리

- GitOps에서 새 이미지를 클러스터에 반영하려면 ArgoCD가 참조하는 Git 레포의 `image.tag`를 먼저 갱신해야 합니다 — CI의 registry push만으로는 클러스터 상태가 바뀌지 않습니다
- CI Push는 즉각적이지만 MSA 다중 서비스 환경에서 동시 push 충돌이 발생할 수 있습니다
- ArgoCD Image Updater는 클러스터 내 Pod으로 동작하므로 클러스터 다운 시 중단됩니다 ApplicationSet 환경에서는 sync loop 가능성을 사전에 확인해야 합니다 ECR처럼 토큰이 만료되는 레지스트리는 갱신 CronJob이 별도로 필요합니다
- Renovate는 외부(GitHub Actions)에서 실행되어 클러스터 독립성을 갖고, PR 기반 write-back으로 감사 추적과 롤백이 명확합니다 `hostRules` 배열로 멀티 레지스트리 인증을 한 곳에서 관리합니다
- 배포 지연(CI Push ~1분 vs Renovate 5~15분)과 감사 추적·안정성 사이의 트레이드오프가 도구 선택의 핵심입니다
