# 컨테이너 이미지 자동 업데이트 전략 아키텍처 결정 (ADR)

작성일: 2026-03-16
상태: Abandoned — Renovate 도입을 시도했으나, 설정 복잡도와 시간 부족으로 포기. 현재 이미지 업데이트는 수동으로 진행 중.
프로젝트: Goti (대규모 티켓팅 서비스)

---

## Decision Summary

| 결정 항목 | 선택 | 대안 | 핵심 근거 |
|-----------|------|------|-----------|
| 이미지 자동 업데이트 도구 | **Renovate (self-hosted)** | ArgoCD Image Updater, CI/CD 직접 Push | Kind 환경 독립, Harbor/GCP 확장 용이, PR 기반 감사 추적 |
| 실행 환경 | **GitHub Actions (self-hosted Renovate)** | K8s 클러스터 내 Pod | 클러스터 상태 무관하게 동작, OIDC 인증 활용 |
| write-back 방식 | **PR 생성 → automerge** | git 직접 commit, ArgoCD parameter override | 감사 추적 명확, 문제 시 PR revert로 복구 |

---

## 1. 배경 (Context)

### 현재 상황

Goti-server가 MSA로 전환되면서 6개 서비스(user, stadium, ticketing, payment, resale + 모놀리식)의 컨테이너 이미지가 ECR에 push되고 있다. 이 이미지들이 K8s 클러스터에 자동 배포되려면 Goti-k8s 레포의 Helm values에서 `image.tag`가 업데이트되어야 한다.

| 항목 | 상태 |
|------|------|
| ECR 이미지 | 6개 서비스 모두 `dev-f1c1d61` 태그로 push 완료 |
| ArgoCD ApplicationSet | MSA 5개 + 모놀리식 1개 App 정상 생성 |
| MSA Pod 상태 | **ImagePullBackOff** — values에 `tag: "latest"` 초기값, ECR에 `latest` 없음 |
| ArgoCD Image Updater | 설치되어 있으나 **한 번도 정상 동작한 적 없음** |

### Image Updater 미작동 근본 원인 분석

| 문제 | 상세 | 심각도 |
|------|------|--------|
| ArgoCD API 통신 실패 | `argocd-image-updater-secret` 없음, 시작 시 `error while communicating with ArgoCD` | Blocker |
| Git write-back 인증 없음 | SSH key도 Git creds도 미설정 → Goti-k8s에 커밋 불가 | Blocker |
| Goti-k8s repo secret 미등록 | ArgoCD repo secret에 Goti-monitoring만 등록 | Blocker |
| ApplicationSet 호환 이슈 | annotation 기반 설정이 ApplicationSet과 무한 sync loop 발생 가능 ([Issue #547](https://github.com/argoproj/applicationset/issues/547), [#1108](https://github.com/argoproj-labs/argocd-image-updater/issues/1108)) | Critical |
| ECR 12시간 토큰 만료 | Kind에서 IRSA 불가, CronJob 갱신 의존 | Major |

---

## 2. 요구사항

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| goti-server 코드 미수정 | 팀 레포라 PR 승인 필요, 즉각 관리 불가 | **필수** |
| Kind 환경 독립 | 클러스터 꺼져도 이미지 업데이트 감지/준비 가능 | **필수** |
| ECR 호환 | 현재 사용 중인 AWS ECR 지원 | **필수** |
| Harbor 호환 | 도입 검토 중인 Harbor 지원 | **중요** |
| GCP Artifact Registry 호환 | 향후 GCP 환경 사용 고려 | **중요** |
| 멀티 레지스트리 동시 사용 | ECR + Harbor 병행 가능 | **중요** |
| 감사 추적 | 어떤 이미지가 언제 왜 업데이트됐는지 추적 | 중요 |
| MSA 확장성 | 6+ 서비스 동시 관리 | 중요 |
| 배포 속도 | dev 환경에서 합리적인 지연 (30분 이내) | 선택 |

---

## 3. 대안 비교

### 3-1. 비교 매트릭스 — 기능/호환성

| 항목 | A. ArgoCD Image Updater | B. CI/CD 직접 Push | C. Renovate |
|------|------------------------|-------------------|-------------|
| **수정 대상 레포** | Goti-k8s만 | goti-server (팀 레포) | Goti-k8s만 |
| **팀원 승인 필요** | 불필요 | **필요** | 불필요 |
| **동작 위치** | K8s 클러스터 내 Pod | GitHub Actions | **GitHub 클라우드** |
| **Kind 의존성** | **있음** — 클러스터 꺼지면 멈춤 | 없음 | **없음** |
| **배포 속도** | ~2분 (polling) | ~1분 (즉시) | ~5-15분 (automerge) |
| **감사 추적** | `.argocd-source` 파일 (리뷰 없음) | bot 커밋 | **PR 히스토리** |
| **ApplicationSet 호환** | **문제 있음** (sync loop, write-back 미작동) | 무관 | 무관 |
| **Helm values 지원** | Helm, Kustomize만 | 어떤 형식이든 가능 | Helm, Kustomize, plain YAML, Dockerfile |
| **디버깅 용이성** | 어려움 (`images_skipped`만 표시) | CI 로그로 명확 | PR 로그로 명확 |

### 3-2. 비교 매트릭스 — 레지스트리 호환성

| 레지스트리 | A. Image Updater | B. CI/CD Push | C. Renovate |
|-----------|-----------------|--------------|-------------|
| **AWS ECR** | CronJob 토큰 갱신 필요, Kind 불안정 | CI에서 이미 ECR push 중 | hostRules + AWS SDK 자동 갱신 |
| **Harbor** | 지원하나 DNS/인증 이슈 사례 ([#585](https://github.com/argoproj-labs/argocd-image-updater/issues/585)) | 추가 설정 필요 | **안정적** — Docker v2 API 완전 호환 |
| **GCP Artifact Registry** | 내장 지원 | 추가 설정 필요 | hostRules로 SA key 또는 WIF |
| **멀티 레지스트리 동시** | registries.conf에 여러 항목 | 각 CI마다 개별 설정 | **hostRules 배열로 간단** |
| **레지스트리 전환 시** | ConfigMap 수정 + Pod 재시작 | 모든 서비스 CI 수정 | **hostRules 1~2줄 변경** |

### 3-3. 비교 매트릭스 — 운영/안정성

| 항목 | A. Image Updater | B. CI/CD Push | C. Renovate |
|------|-----------------|--------------|-------------|
| **운영 부담** | Pod + CRD + ECR 인증 관리 | CI 파이프라인 복잡도 증가 | renovate.json만 |
| **MSA 확장 (10+ 서비스)** | registry rate limit, sync loop 위험 | **race condition 심각** (동시 push 충돌) | PR grouping으로 관리 |
| **장애 시 복구** | Pod 재시작 + 디버깅 어려움 | CI 재실행 | Renovate 재실행 / PR revert |
| **학습 곡선** | 중간 | 낮음 | 높음 (설정 옵션 방대) |
| **ArgoCD 다운 시** | git write-back은 동작, 복구 시 sync | 커밋 존재, 복구 시 sync | **영향 없음** — PR은 Git에 존재 |
| **잘못된 이미지 배포** | 자동 롤백 없음, 수동 개입 | git revert | **PR revert로 명확한 롤백** |

### 3-4. 비교 매트릭스 — 장애/실패 시나리오

| 시나리오 | A. Image Updater | B. CI/CD Push | C. Renovate |
|----------|-----------------|--------------|-------------|
| Registry 인증 실패 | 업데이트 중단, 로그에 skip만 표시 | 이미지 push는 성공, GitOps push만 실패 | PR 생성 실패, 에러 로그 |
| Git 레포 접근 불가 | write-back 중단 | GitOps 레포 push 실패 → 이미지만 registry에 존재 | PR 생성 불가 |
| 동시 업데이트 충돌 | sync loop 가능 | **git push 충돌 — 가장 심각** | PR별 격리 (안전) |
| 클러스터 다운 | **전체 중단** | 영향 없음 | **영향 없음** |
| 도구 자체 다운 | 업데이트 완전 중단 | 해당 없음 (CI 내장) | 다음 주기에 catch-up |

### 3-5. 실무 트렌드 (2025-2026)

| 패턴 | 사용 빈도 | 주요 사용처 |
|------|----------|-----------|
| **CI/CD 직접 Push** | 가장 많음 | 중소팀, 서비스 수 적을 때 |
| **Renovate** | **상승 추세** | PR 기반 감사 추적 필요, 멀티 레지스트리 |
| **ArgoCD Image Updater** | 보통 | ArgoCD 네이티브 환경, Application 단위 관리 |
| **Flux Image Automation** | Flux 사용자만 | Flux GitOps 환경 |

---

## 4. 결정 (Decision)

**Renovate (self-hosted, GitHub Actions)를 선택한다.**

### 핵심 근거

| # | 근거 | 상세 |
|---|------|------|
| 1 | **goti-server 수정 불필요** | Goti-k8s(인프라 레포)에 `renovate.json`만 추가. 팀 레포 승인 절차 불필요 |
| 2 | **Kind 환경 독립** | GitHub Actions에서 실행되므로 클러스터 상태 무관 |
| 3 | **ApplicationSet 호환** | Git PR 방식이라 ArgoCD Application 구조와 무관 — sync loop 위험 없음 |
| 4 | **레지스트리 확장 용이** | hostRules 배열 구조로 ECR → Harbor → GCP AR 전환 시 1~2줄 변경 |
| 5 | **PR 기반 감사 추적** | MSA 전환 중 이미지 변경 이력이 PR로 명확히 남음 |
| 6 | **롤백 용이** | 문제 시 PR revert로 즉시 복구 |

### 트레이드오프 인정

| 단점 | 수용 근거 |
|------|----------|
| 배포 속도 5-15분 지연 | dev 환경에서 수용 가능. prod에서도 automerge로 최소화 |
| renovate.json 학습 곡선 | 초기 설정 1회, 이후 유지보수 최소 |
| automerge 시 리뷰 없이 배포 | dev 환경 한정. prod는 수동 merge로 전환 가능 |
| ECR 인증 설정 복잡 | self-hosted + GitHub Actions OIDC로 해결 |

---

## 5. 구현 계획

### 배포 흐름 (최종)

```
goti-server CI/CD
  → ECR에 dev-{sha} 태그로 이미지 push
  → (기존 흐름, 변경 없음)

Renovate (GitHub Actions, 주기적 실행)
  → ECR 이미지 태그 스캔
  → 새 태그 감지 시 Goti-k8s에 PR 생성
    (environments/dev/goti-{service}/values.yaml의 image.tag 업데이트)
  → automerge → ArgoCD auto-sync → Pod 배포
```

### 작업 항목

| # | 작업 | 대상 레포 | 상세 |
|---|------|----------|------|
| 1 | Renovate self-hosted workflow 생성 | Goti-k8s | `.github/workflows/renovate.yml` |
| 2 | Renovate 설정 파일 생성 | Goti-k8s | `renovate.json` — ECR hostRules, Helm values manager |
| 3 | GitHub Actions secrets 설정 | Goti-k8s | AWS credentials (OIDC) + Renovate PAT |
| 4 | MSA values 초기 태그 수정 | Goti-k8s | `tag: "latest"` → `tag: "dev-f1c1d61"` (즉시 ImagePullBackOff 해결) |
| 5 | Image Updater annotation 제거 | Goti-k8s | ApplicationSet에서 `argocd-image-updater.argoproj.io/*` 제거 |
| 6 | Image Updater 제거 검토 | Goti-k8s | 더 이상 불필요 시 Helm release 삭제 |

---

## 6. 결과 (Consequences)

### 긍정적 영향

| 영향 | 상세 |
|------|------|
| 완전 자동화된 이미지 배포 파이프라인 | ECR push → Renovate PR → automerge → ArgoCD sync |
| 레지스트리 전환 유연성 | ECR → Harbor → GCP AR 전환 시 hostRules만 수정 |
| 인프라 레포 자율 관리 | goti-server 팀원 승인 없이 배포 파이프라인 관리 가능 |
| 감사 추적 | PR 히스토리로 모든 이미지 변경 추적 |
| Kind 환경 독립 | 클러스터 상태 무관하게 동작 |

### 부정적 영향 / 리스크

| 리스크 | 완화 방안 |
|--------|----------|
| 배포 지연 (5-15분) | automerge 활성화, Renovate schedule 조정 |
| renovate.json 복잡도 | 최소 설정으로 시작, 점진적 확장 |
| GitHub Actions 비용 | self-hosted runner 또는 무료 한도 내 운영 (월 2,000분) |
| automerge 안전성 | dev만 automerge, prod는 수동 merge |
| Renovate ECR 인증 | GitHub Actions OIDC + AWS credentials 활용 |

### 향후 과제

| 과제 | 시점 |
|------|------|
| Harbor 도입 시 hostRules 추가 | Harbor 도입 시점 |
| GCP Artifact Registry 전환 시 hostRules 수정 | GCP 전환 시점 |
| prod 환경 Renovate 설정 (수동 merge) | prod 환경 구축 시 |
| Image Updater 완전 제거 | Renovate 안정화 확인 후 |
| Renovate Dashboard PR 활성화 | 서비스 10+ 시 |

---

## 7. 참고 자료

### 공식 문서
- [Renovate Helm Values Manager](https://docs.renovatebot.com/modules/manager/helm-values/)
- [Renovate Docker Datasource](https://docs.renovatebot.com/modules/datasource/docker/)
- [Renovate Self-Hosted Configuration](https://docs.renovatebot.com/self-hosted-configuration/)
- [ArgoCD Image Updater Documentation](https://argocd-image-updater.readthedocs.io/)

### 실무 사례 및 비교
- [From Keel to Renovate: Better Container Image Updates](https://www.rustybower.com/posts/keel-to-renovate-kubernetes-image-updates/)
- [CNCF: Mastering ArgoCD Image Updater with Helm](https://www.cncf.io/blog/2024/11/05/mastering-argo-cd-image-updater-with-helm-a-complete-configuration-guide/)
- [Sokube: Advanced GitOps Pipeline with ArgoCD Image Updater](https://www.sokube.io/en/blog/advanced-gitops-cloud-native-pipeline-with-argocd-image-updater-en)

### ArgoCD Image Updater Known Issues
- [ApplicationSet sync loop — Issue #547](https://github.com/argoproj/applicationset/issues/547)
- [ApplicationSet write-back 미작동 — Issue #1108](https://github.com/argoproj-labs/argocd-image-updater/issues/1108)
- [ECR 인증 — Issue #112](https://github.com/argoproj-labs/argocd-image-updater/issues/112)
- [Harbor DNS 이슈 — Issue #585](https://github.com/argoproj-labs/argocd-image-updater/issues/585)
- [Sync loop — Issue #1237](https://github.com/argoproj-labs/argocd-image-updater/issues/1237)

### Renovate Known Issues
- [Harbor robot account $ sign — Discussion #32194](https://github.com/renovatebot/renovate/discussions/32194)
- [ECR 환경변수 미전달 — Discussion #18755](https://github.com/renovatebot/renovate/discussions/18755)
- [Helm bumpVersion 충돌 — Issue #8919](https://github.com/renovatebot/renovate/issues/8919)

### 관련 ADR
- [ADR-0001: Istio 서비스 메시 도입](0001-istio-service-mesh.md)
