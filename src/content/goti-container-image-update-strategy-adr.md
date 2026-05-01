---
title: "컨테이너 이미지 자동 업데이트 — Renovate vs ArgoCD Image Updater"
excerpt: "ArgoCD Image Updater의 ApplicationSet 호환 이슈와 Kind 의존성을 피하려고 Renovate(self-hosted) 기반 PR 워크플로우를 선택한 아키텍처 결정 과정입니다"
category: argocd
tags:
  - go-ti
  - Renovate
  - ImageUpdater
  - ArgoCD
  - ADR
date: "2026-03-16"
---

## 한 줄 요약

> ArgoCD Image Updater가 ApplicationSet과 충돌하고 Kind 클러스터 상태에 종속되는 문제를 확인했습니다. 대안으로 Renovate(self-hosted, GitHub Actions)를 검토해 PR 기반 이미지 자동 업데이트 전략을 수립했습니다

이 글은 **결정 시점의 기록**입니다. 실제 도입은 이후 Renovate 설정 복잡도와 일정 제약으로 보류되었고, 현재 이미지 업데이트는 수동으로 운영 중입니다. 의사결정 구조 자체는 동일한 제약을 마주한 팀이 참고할 만해 글로 남깁니다.

---

## 배경: MSA 전환과 이미지 태그 자동화 과제

go-ti 서버가 MSA로 전환되면서 6개 서비스(user, stadium, ticketing, payment, resale + 모놀리식)의 컨테이너 이미지가 ECR에 지속적으로 push되고 있었습니다.

이 이미지를 Kubernetes 클러스터에 자동 배포하려면, 인프라 레포(goti-k8s)의 Helm values에 있는 `image.tag`가 새 태그로 갱신되어야 합니다. 즉 **registry push → GitOps 레포 반영**의 연결 고리가 필요했습니다.

현재 상태를 정리하면 다음과 같습니다.

| 항목 | 상태 |
|------|------|
| ECR 이미지 | 6개 서비스 모두 `dev-f1c1d61` 태그로 push 완료 |
| ArgoCD ApplicationSet | MSA 5개 + 모놀리식 1개 App 정상 생성 |
| MSA Pod 상태 | ImagePullBackOff — values의 초기값이 `tag: "latest"`인데 ECR에는 `latest` 태그 없음 |
| ArgoCD Image Updater | 설치만 되어 있고 한 번도 정상 동작한 적 없음 |

이미 설치된 ArgoCD Image Updater를 정상화할지, 다른 도구로 갈아탈지를 결정해야 했습니다.

### ArgoCD Image Updater가 동작하지 않는 근본 원인

Image Updater를 그대로 살릴 수 있는지 먼저 확인했습니다. 로그와 이슈 트래커를 따라가 보면 블로커가 한두 개가 아니었습니다.

| 문제 | 상세 | 심각도 |
|------|------|--------|
| ArgoCD API 통신 실패 | `argocd-image-updater-secret` 미등록, 기동 시 `error while communicating with ArgoCD` | Blocker |
| Git write-back 인증 누락 | SSH key/Git creds 모두 미설정, goti-k8s 레포에 커밋 불가 | Blocker |
| goti-k8s repo secret 미등록 | ArgoCD repo secret에 goti-monitoring만 등록되어 있음 | Blocker |
| ApplicationSet 호환 이슈 | annotation 기반 설정이 ApplicationSet과 무한 sync loop를 일으킬 수 있음 | Critical |
| ECR 12시간 토큰 만료 | Kind 환경에서는 IRSA 사용 불가, CronJob으로 토큰을 주기 갱신해야 함 | Major |

Blocker 세 개는 설정을 채워 넣으면 해결 가능하지만, Critical로 분류한 ApplicationSet 호환 이슈는 설정만으로 해결되지 않습니다. 관련 이슈는 다음과 같습니다.

- [argoproj/applicationset#547](https://github.com/argoproj/applicationset/issues/547) — ApplicationSet sync loop
- [argoproj-labs/argocd-image-updater#1108](https://github.com/argoproj-labs/argocd-image-updater/issues/1108) — ApplicationSet 환경에서 write-back 미작동
- [argoproj-labs/argocd-image-updater#1237](https://github.com/argoproj-labs/argocd-image-updater/issues/1237) — sync loop 재현 케이스

ApplicationSet을 걷어내는 선택지는 없습니다. MSA 전환의 전제이기 때문입니다. 그래서 "Image Updater 정상화"는 Critical 이슈가 해결되기 전까지는 불완전한 옵션이 됩니다.

---

## 요구사항

이번 결정이 만족해야 하는 조건을 먼저 정리했습니다.

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| goti-server 코드 미수정 | 팀 레포라 PR 승인 절차가 필요, 즉각 관리 불가 | 필수 |
| Kind 환경 독립 | 클러스터가 꺼져 있어도 이미지 업데이트 감지/준비가 가능해야 함 | 필수 |
| ECR 호환 | 현재 사용 중인 AWS ECR 지원 | 필수 |
| Harbor 호환 | 도입 검토 중인 Harbor 지원 | 중요 |
| GCP Artifact Registry 호환 | 향후 GCP 환경 고려 | 중요 |
| 멀티 레지스트리 동시 사용 | ECR + Harbor 병행 가능 | 중요 |
| 감사 추적 | 어떤 이미지가 언제 왜 업데이트됐는지 추적 가능 | 중요 |
| MSA 확장성 | 6+ 서비스 동시 관리 | 중요 |
| 배포 속도 | dev 환경에서 30분 이내 반영 | 선택 |

필수 조건 3개 중에서 **Kind 환경 독립**이 가장 까다로운 제약이었습니다. 현재 클러스터는 개인 PC 위의 Kind로 돌아가고 있어서, PC를 꺼 두는 시간이 길 수 있습니다. 클러스터 안에서 동작하는 도구는 이 조건에서 자동으로 감점입니다.

---

## 🧭 선택지 비교

이미지 자동 업데이트를 구현하는 대표적인 패턴 세 가지를 비교했습니다.

### 고려한 옵션

| 옵션 | 핵심 아이디어 | 동작 위치 |
|------|---------------|----------|
| A. ArgoCD Image Updater | ArgoCD 기반, K8s 클러스터 내 Pod가 주기적으로 registry를 polling | K8s 클러스터 내부 |
| B. CI/CD 직접 Push | goti-server CI가 이미지 push 직후 GitOps 레포에 직접 commit | GitHub Actions (goti-server) |
| C. Renovate (self-hosted) | GitHub Actions에서 주기 실행, 새 태그 감지 시 goti-k8s에 PR 생성 | GitHub Actions (goti-k8s) |

### 기능/호환성 비교

| 항목 | A. Image Updater | B. CI/CD Push | C. Renovate |
|------|-----------------|---------------|-------------|
| 수정 대상 레포 | goti-k8s만 | goti-server(팀 레포) | goti-k8s만 |
| 팀원 승인 필요 | 불필요 | 필요 | 불필요 |
| 동작 위치 | K8s 클러스터 내 Pod | GitHub Actions | GitHub 클라우드 |
| Kind 의존성 | 있음 — 클러스터 꺼지면 멈춤 | 없음 | 없음 |
| 배포 속도 | 약 2분 (polling) | 약 1분 (즉시) | 5~15분 (automerge) |
| 감사 추적 | `.argocd-source` 파일 (리뷰 없음) | bot 커밋 | PR 히스토리 |
| ApplicationSet 호환 | 문제 있음 (sync loop, write-back 미작동) | 무관 | 무관 |
| Helm values 지원 | Helm, Kustomize만 | 어떤 형식이든 가능 | Helm, Kustomize, plain YAML, Dockerfile |
| 디버깅 용이성 | 어려움 (`images_skipped`만 출력) | CI 로그로 명확 | PR 로그로 명확 |

표에서 갈리는 포인트는 크게 세 가지입니다.

먼저 **Kind 의존성**입니다. Image Updater는 K8s 클러스터 내부 Pod로 동작합니다. 개인 PC 기반 Kind 환경에서는 PC가 꺼져 있는 동안 이미지 업데이트가 감지되지 않습니다. 반면 CI/CD Push와 Renovate는 모두 GitHub 측에서 실행되므로 클러스터 상태와 독립적입니다.

다음은 **ApplicationSet 호환**입니다. Image Updater는 Application에 붙이는 annotation 기반으로 동작하는데, ApplicationSet은 템플릿에서 Application을 생성하므로 annotation 관리 모델이 맞지 않고 sync loop가 발생합니다. CI/CD Push와 Renovate는 Git을 통해 values 파일을 수정하므로 Application 구조와 무관합니다.

마지막은 **수정 대상 레포**입니다. CI/CD Push 방식은 goti-server 레포의 파이프라인을 건드려야 합니다. goti-server는 팀 레포라 PR 승인이 필요해 인프라 쪽에서 단독으로 관리하기 어렵습니다. Image Updater와 Renovate는 둘 다 goti-k8s만 수정하면 됩니다.

### 레지스트리 호환성

| 레지스트리 | A. Image Updater | B. CI/CD Push | C. Renovate |
|-----------|-----------------|---------------|-------------|
| AWS ECR | CronJob 토큰 갱신 필요, Kind에서 불안정 | CI에서 이미 ECR push 중 | hostRules + AWS SDK 자동 갱신 |
| Harbor | DNS/인증 이슈 사례 존재 ([#585](https://github.com/argoproj-labs/argocd-image-updater/issues/585)) | 추가 설정 필요 | Docker v2 API 완전 호환, 안정적 |
| GCP Artifact Registry | 내장 지원 | 추가 설정 필요 | hostRules로 SA key 또는 Workload Identity Federation |
| 멀티 레지스트리 동시 사용 | `registries.conf`에 여러 항목 기입 | CI마다 개별 설정 | hostRules 배열로 간단 구성 |
| 레지스트리 전환 시 변경량 | ConfigMap 수정 + Pod 재시작 | 모든 서비스 CI 수정 | hostRules 1~2줄 변경 |

레지스트리 관점에서 중요한 것은 **전환 비용**입니다.

Harbor 도입 검토 중이고, 이후 GCP Artifact Registry로도 갈 가능성이 있는 프로젝트에서는 레지스트리를 바꿀 때마다 얼마나 많은 코드를 고쳐야 하는지가 실제 비용으로 이어집니다.

CI/CD Push 방식은 모든 서비스의 CI를 각각 수정해야 합니다. 서비스가 늘어날수록 비용도 선형으로 증가합니다. Image Updater는 ConfigMap 수정 후 Pod 재시작이 필요합니다. Renovate는 `renovate.json`의 hostRules 몇 줄만 바꾸면 됩니다.

### 운영/안정성 비교

| 항목 | A. Image Updater | B. CI/CD Push | C. Renovate |
|------|-----------------|---------------|-------------|
| 운영 부담 | Pod + CRD + ECR 인증 관리 | CI 파이프라인 복잡도 증가 | `renovate.json`만 |
| MSA 확장 (10+ 서비스) | registry rate limit, sync loop 위험 | race condition 심각 (동시 push 충돌) | PR grouping으로 관리 |
| 장애 시 복구 | Pod 재시작 + 디버깅 어려움 | CI 재실행 | Renovate 재실행 또는 PR revert |
| 학습 곡선 | 중간 | 낮음 | 높음 (설정 옵션 방대) |
| ArgoCD 다운 시 영향 | git write-back은 동작, 복구 시 sync | 커밋 존재, 복구 시 sync | 영향 없음 — PR이 Git에 존재 |
| 잘못된 이미지 배포 복구 | 자동 롤백 없음, 수동 개입 필요 | git revert | PR revert로 명확한 롤백 |

CI/CD Push 방식의 가장 큰 문제는 **동시 push race condition**입니다. 6개 서비스가 같은 시점에 빌드를 완료하면, 각각이 goti-k8s에 동시에 push를 시도합니다. 첫 번째 push가 성공하면 뒤에 오는 push는 non-fast-forward 에러로 실패하고, 이를 해결하려면 CI 쪽에 retry 로직과 rebase 로직을 직접 넣어야 합니다. MSA 확장 시 이 race condition은 서비스 수에 비례해 빈번해집니다.

Renovate는 한 프로세스가 여러 태그를 묶어 순차적으로 PR을 만들기 때문에 이 문제가 구조적으로 발생하지 않습니다.

### 장애 시나리오 비교

| 시나리오 | A. Image Updater | B. CI/CD Push | C. Renovate |
|----------|-----------------|---------------|-------------|
| Registry 인증 실패 | 업데이트 중단, 로그에 skip만 표시 | 이미지 push는 성공, GitOps push만 실패 | PR 생성 실패, 에러 로그 |
| Git 레포 접근 불가 | write-back 중단 | 이미지만 registry에 존재 | PR 생성 불가 |
| 동시 업데이트 충돌 | sync loop 가능 | git push 충돌 — 가장 심각 | PR별 격리 (안전) |
| 클러스터 다운 | 전체 중단 | 영향 없음 | 영향 없음 |
| 도구 자체 다운 | 업데이트 완전 중단 | 해당 없음 (CI 내장) | 다음 주기에 catch-up |

시나리오 표에서 돋보이는 차이는 **"무엇이 진실의 원천인가"**입니다. CI/CD Push 방식은 이미지 push가 성공하고 GitOps push가 실패하면 registry와 Git이 어긋난 상태로 남습니다. Renovate는 이미지가 registry에 존재하는 한 다음 주기에 반드시 catch-up 하므로, 일시적 장애가 누락으로 이어지지 않습니다.

### 기각 이유

- **A. Image Updater 탈락**: ApplicationSet sync loop(Critical)는 설정으로 해결 불가. Kind 의존성으로 개인 PC 기반 환경의 필수 조건을 충족 못 함.
- **B. CI/CD Push 탈락**: goti-server 팀 레포 수정이 필요해 즉각 관리 불가. MSA 확장 시 동시 push race condition이 구조적으로 발생.

### 결정 기준과 최종 선택

**C. Renovate를 채택합니다.**

결정 기준은 다음 우선순위입니다.

1. **Kind 환경 독립**: 클러스터 상태와 무관하게 이미지 감지/준비가 동작해야 합니다. 개인 PC 기반 Kind에서 PC가 꺼져 있는 시간이 운영 전제이기 때문입니다.
2. **ApplicationSet 호환**: MSA 전환의 기반이므로 ApplicationSet은 걷어낼 수 없습니다.
3. **레지스트리 확장성**: Harbor, GCP Artifact Registry 전환이 로드맵에 있어 hostRules 수준의 변경으로 처리 가능해야 합니다.

Renovate는 세 기준을 모두 만족합니다. GitHub Actions에서 실행되므로 클러스터와 완전히 분리되고, Git PR 방식이라 ArgoCD 내부 구조와 무관하며, hostRules 배열로 레지스트리 전환 비용이 최소화됩니다.

### 트레이드오프 인정

| 단점 | 수용 근거 |
|------|----------|
| 배포 속도 5~15분 지연 | dev 환경에서는 수용 가능. prod에서도 automerge로 최소화 가능 |
| `renovate.json` 학습 곡선 | 초기 설정 1회 후 유지보수 최소 |
| automerge 시 리뷰 없이 배포 | dev 환경 한정. prod는 수동 merge로 전환 가능 |
| ECR 인증 설정 복잡 | GitHub Actions OIDC + self-hosted Renovate로 해결 |

배포 속도 5~15분은 "즉시 배포"를 포기한 비용이지만, 대신 PR 감사 추적과 롤백 용이성을 얻습니다. dev 환경에서는 이 트레이드오프가 합리적이라고 판단했습니다.

---

## 결정 근거 정리

| # | 근거 | 상세 |
|---|------|------|
| 1 | goti-server 수정 불필요 | goti-k8s(인프라 레포)에 `renovate.json`만 추가, 팀 레포 승인 절차 불필요 |
| 2 | Kind 환경 독립 | GitHub Actions에서 실행되므로 클러스터 상태와 무관 |
| 3 | ApplicationSet 호환 | Git PR 방식이라 ArgoCD Application 구조와 무관, sync loop 위험 없음 |
| 4 | 레지스트리 확장 용이 | hostRules 배열 구조로 ECR → Harbor → GCP AR 전환 시 1~2줄 변경 |
| 5 | PR 기반 감사 추적 | MSA 전환 중 이미지 변경 이력이 PR로 명확히 남음 |
| 6 | 롤백 용이 | 문제 시 PR revert로 즉시 복구 |

여섯 가지 근거 중 1·2·3번은 **탈락한 옵션들의 약점**과 직접 대응되고, 4·5·6번은 **앞으로의 확장/운영 시나리오**에 대응됩니다. 단순히 "좋아 보여서"가 아니라 현재와 미래의 제약 양쪽을 기준으로 뽑은 선택입니다.

---

## 구현 계획

### 목표 배포 흐름

목표 흐름은 두 파이프라인이 ECR을 매개로 비동기 연결되는 구조입니다.

**goti-server CI/CD (기존, 변경 없음)**

1. ECR에 `dev-{sha}` 태그로 이미지 push

**Renovate (GitHub Actions, 주기적 실행)**

1. ECR 이미지 태그 스캔
2. 새 태그 감지 시 `goti-k8s`에 PR 생성 (`environments/dev/goti-{service}/values.yaml`의 `image.tag` 업데이트)
3. automerge
4. ArgoCD auto-sync
5. Pod 배포

goti-server 측 파이프라인은 기존 그대로 두고, goti-k8s에 Renovate 레이어만 추가하는 구조입니다. 기존 팀의 작업을 차단하지 않는 것이 1순위였습니다.

### 작업 항목

| # | 작업 | 대상 레포 | 상세 |
|---|------|----------|------|
| 1 | Renovate self-hosted workflow 생성 | goti-k8s | `.github/workflows/renovate.yml` |
| 2 | Renovate 설정 파일 생성 | goti-k8s | `renovate.json` — ECR hostRules, Helm values manager 설정 |
| 3 | GitHub Actions secrets 설정 | goti-k8s | AWS credentials(OIDC) + Renovate PAT |
| 4 | MSA values 초기 태그 수정 | goti-k8s | `tag: "latest"` → `tag: "dev-f1c1d61"`로 즉시 ImagePullBackOff 해결 |
| 5 | Image Updater annotation 제거 | goti-k8s | ApplicationSet에서 `argocd-image-updater.argoproj.io/*` annotation 제거 |
| 6 | Image Updater Helm release 제거 검토 | goti-k8s | Renovate 안정화 후 불필요하면 삭제 |

작업 4번은 **Renovate 도입과 독립적으로 즉시 해결해야 하는 현재 장애**입니다. ImagePullBackOff가 이미 발생 중이라, Renovate 구축과는 별개로 values 초기 태그를 올바른 값으로 수동 업데이트하고 시작해야 합니다.

---

## 예상 결과 (Consequences)

### 기대하는 긍정적 영향

- **완전 자동화된 이미지 배포 파이프라인**: ECR push → Renovate PR → automerge → ArgoCD sync가 하나의 흐름으로 연결됩니다.
- **레지스트리 전환 유연성**: ECR → Harbor → GCP AR 전환 시 hostRules만 수정합니다.
- **인프라 레포 자율 관리**: goti-server 팀원 승인 없이 배포 파이프라인을 관리할 수 있습니다.
- **감사 추적**: PR 히스토리로 모든 이미지 변경을 추적합니다.
- **Kind 환경 독립**: 클러스터 상태와 무관하게 동작합니다.

### 리스크와 완화 방안

| 리스크 | 완화 방안 |
|--------|----------|
| 배포 지연 (5~15분) | automerge 활성화, Renovate schedule 조정 |
| `renovate.json` 복잡도 | 최소 설정으로 시작해 점진적 확장 |
| GitHub Actions 비용 | self-hosted runner 또는 무료 한도(월 2,000분) 내 운영 |
| automerge 안전성 | dev만 automerge, prod는 수동 merge |
| Renovate ECR 인증 | GitHub Actions OIDC + AWS credentials 조합 |

### 향후 과제

- Harbor 도입 시 hostRules 추가
- GCP Artifact Registry 전환 시 hostRules 수정
- prod 환경 Renovate 설정(수동 merge 전제)
- Image Updater 완전 제거(Renovate 안정화 후)
- 서비스 10+ 시 Renovate Dashboard PR 활성화

---

## 📚 배운 점

이 결정을 정리하면서 얻은 교훈을 일반화해 남깁니다.

- **"설치되어 있음"과 "동작함"은 다릅니다.** Image Updater는 설치만 된 상태였고, Blocker 3개와 Critical 1개가 쌓여 있었습니다. 도입 전 최소한의 smoke test가 없으면 이런 좀비 컴포넌트가 생깁니다.
- **컨트롤 플레인의 위치가 제약 조건이 됩니다.** 클러스터 내부에서 도는 도구는 클러스터 상태에 종속됩니다. 개인 PC 기반 Kind 환경처럼 "컨트롤 플레인 가용성이 낮은" 조건에서는 외부(GitHub 등)에서 동작하는 도구가 구조적으로 유리합니다.
- **ApplicationSet과 annotation 기반 도구는 궁합을 먼저 확인해야 합니다.** ApplicationSet 템플릿이 생성하는 Application에 외부 도구가 annotation을 덧붙이는 순간 sync loop가 발생할 수 있습니다. 이는 특정 도구의 버그라기보다 두 추상화의 책임 경계가 겹쳐서 생기는 구조적 문제입니다.
- **race condition은 "흔치 않은" 문제가 아닙니다.** MSA 서비스 수가 늘어나는 순간 동시 push 충돌이 일상이 됩니다. CI에서 GitOps 레포에 직접 쓰는 구조는 서비스 수에 비례해 복잡해집니다. PR 기반 직렬화가 이 문제를 구조적으로 풉니다.
- **ADR은 채택된 선택지만큼 기각 이유가 중요합니다.** "Renovate가 좋아서"보다 "왜 Image Updater·CI/CD Push를 탈락시켰는가"가 더 많은 맥락을 남깁니다. 1년 뒤 같은 결정을 되살펴볼 때 필요한 정보는 후자입니다.
- **결정한다고 해서 반드시 실행되지는 않습니다.** 이 ADR의 결정은 Renovate였지만, 실제 도입은 설정 복잡도와 일정 제약으로 보류되었습니다. 결정 시점의 기준과 실행 시점의 제약이 다를 수 있다는 것도 솔직하게 기록할 가치가 있습니다.

---

## 참고 자료

### 공식 문서

- [Renovate Helm Values Manager](https://docs.renovatebot.com/modules/manager/helm-values/)
- [Renovate Docker Datasource](https://docs.renovatebot.com/modules/datasource/docker/)
- [Renovate Self-Hosted Configuration](https://docs.renovatebot.com/self-hosted-configuration/)
- [ArgoCD Image Updater Documentation](https://argocd-image-updater.readthedocs.io/)

### 실무 사례 및 비교

- [From Keel to Renovate: Better Container Image Updates](https://www.rustybower.com/posts/keel-to-renovate-kubernetes-image-updates/)
- [CNCF: Mastering ArgoCD Image Updater with Helm](https://www.cncf.io/blog/2024/11/05/mastering-argo-cd-image-updater-with-helm-a-complete-configuration-guide/)
- [Sokube: Advanced GitOps Pipeline with ArgoCD Image Updater](https://www.sokube.io/en/blog/advanced-gitops-cloud-native-pipeline-with-argocd-image-updater-en)

### ArgoCD Image Updater 알려진 이슈

- [ApplicationSet sync loop — Issue #547](https://github.com/argoproj/applicationset/issues/547)
- [ApplicationSet write-back 미작동 — Issue #1108](https://github.com/argoproj-labs/argocd-image-updater/issues/1108)
- [ECR 인증 — Issue #112](https://github.com/argoproj-labs/argocd-image-updater/issues/112)
- [Harbor DNS 이슈 — Issue #585](https://github.com/argoproj-labs/argocd-image-updater/issues/585)
- [Sync loop — Issue #1237](https://github.com/argoproj-labs/argocd-image-updater/issues/1237)

### Renovate 알려진 이슈

- [Harbor robot account `$` sign — Discussion #32194](https://github.com/renovatebot/renovate/discussions/32194)
- [ECR 환경변수 미전달 — Discussion #18755](https://github.com/renovatebot/renovate/discussions/18755)
- [Helm bumpVersion 충돌 — Issue #8919](https://github.com/renovatebot/renovate/issues/8919)
