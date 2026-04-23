---
title: "K8s 스킬 보강 + /review-pr:k8s 전문 리뷰 커맨드 — 갭 12건을 구조화하기"
excerpt: "PR #11~#19에서 누적된 리뷰 갭 12건과 K8s 트러블슈팅·세션 로그를 5개 스킬 파일에 반영하고, 3에이전트 병렬 구조의 /review-pr:k8s 전문 리뷰 커맨드를 신설했습니다."
category: kubernetes
tags:
  - go-ti
  - Meta
  - Kubernetes
  - Helm
  - ArgoCD
  - Code-Review
  - Skill
series:
  name: "goti-meta"
  order: 3
date: "2026-03-11"
---

## 한 줄 요약

> 모니터링 영역 스킬 보강(2026-03-11)에 이어 K8s 차례였습니다. PR #11~#19에서 누적된 리뷰 갭 12건, K8s 트러블슈팅 로그, 세션 로그 8건을 5개 스킬 파일에 반영하고, 3에이전트 병렬 구조의 `/review-pr:k8s` 전문 리뷰 커맨드를 신설했습니다

---

## 🔥 문제: K8s 스킬이 범용 지식에 머물러 있었다

기존 K8s/Helm/ArgoCD 스킬 파일들은 공식 문서 수준의 범용 설명 중심이었습니다
프로젝트에서 실제 부딪힌 다음과 같은 실무 이슈가 **스킬 본문에 반영되어 있지 않았습니다**

- RBAC의 `create` verb는 `resourceNames` 제약과 호환되지 않습니다
- AppProject에서 `kind: "*"` 와일드카드가 최소 권한 원칙을 무너뜨립니다
- `targetRevision: main`은 GitOps에서 해시 고정이 풀려 위험합니다
- YAML anchor/alias가 오판의 원인이 됩니다
- AWS 계정·리전 종속값이 Helm values에 하드코딩됩니다

이런 항목들은 Gemini가 잡고 Claude가 놓친 갭으로 `docs/review-gaps.md`에 누적되어 있었지만, 스킬 파일에 들어가지 않으면 다음 PR에서 또 같은 실수를 반복하게 됩니다

### 분석한 데이터 소스

| 소스 | 건수 | 주요 내용 |
|------|------|----------|
| Review Gaps (PR #11~#19) | 12건 | RBAC create+resourceNames, AppProject 와일드카드, targetRevision:main, YAML anchor 오판, AWS 종속값 하드코딩 등 |
| 트러블슈팅 로그 | 1건 | kubectl secret `$` shell escaping (2026-03-11) |
| 세션 로그 | 8건 | Library Chart, ArgoCD에서 Helm 역할, Bootstrap sync-wave, Kind 매핑, ESO sync-wave 등 |

---

## 🤔 원인: 범용 지식 ↔ 프로젝트 패턴의 구분이 없었다

기존 스킬은 "Helm이란 무엇인가"를 잘 설명했지만, "이 프로젝트에서 Helm을 어떻게 쓰는가", "어떤 실수가 반복됐는가"를 담지 못했습니다

리뷰 커맨드 구조도 한계가 있었습니다
`/review-pr` 범용 리뷰 하나로 모든 영역을 처리하다 보니, K8s 전용 체크(Helm values 계층화, AppProject 와일드카드, sync-wave)가 충분한 비중을 받지 못했습니다

---

## ✅ 해결: 스킬 5개 수정 + 리뷰 커맨드 2개 손질

### 스킬 파일 5개 (줄수 전/후)

| 파일 | Before | After | 추가 내용 |
|------|--------|-------|----------|
| `k8s-helm.md` | 189줄 | ~320줄 | Library Chart, ArgoCD+Helm 역할 분담, `values.schema.json`, YAML anchor, 멀티 환경 values |
| `k8s-security.md` | 362줄 | ~440줄 | RBAC `create`+`resourceNames` 제약, AppProject 최소 권한, kubectl secret 특수문자 |
| `gitops-argocd.md` | 347줄 | ~420줄 | `targetRevision` 위험성 상세, Bootstrap sync-wave 패턴 |
| `gitops-argocd-advanced.md` | 443줄 | ~470줄 | AppProject 와일드카드 검증, ApplicationSet 하이브리드. 시크릿 섹션은 helm 파일로 이동 |
| `gitops-argocd-helm.md` | 344줄 | ~460줄 | ESO sync-wave 순서, Sealed Secrets 흡수, ECR CronJob, AWS 종속값 변수화 |

다섯 파일 모두 "원칙 설명 + 구체적 안티패턴 + 프로젝트 내 실제 사례"라는 3단 구조로 재편했습니다
특히 `gitops-argocd-advanced.md`의 시크릿 섹션은 `gitops-argocd-helm.md`로 이동시켜 주제를 합쳤습니다. 시크릿 관리와 Helm 렌더링은 실제 운영에서 불가분이기 때문입니다

### 리뷰 커맨드 2개

| 파일 | 작업 | 내용 |
|------|------|------|
| `review-pr-k8s.md` | **신규** | 3에이전트 병렬 구조 — ⎈ Helm Chart/values, 🔒 ArgoCD GitOps/보안, ⚙️ 운영/패턴 일관성 |
| `review-pr.md` | 수정 | Auto-Routing — K8s 영역 감지 시 `/review-pr:k8s` 체크 항목 연결 |

3에이전트 병렬 구조는 모니터링 리뷰(2026-03-11 앞 섹션)에서 이미 검증된 패턴이었습니다
K8s는 Helm/ArgoCD/운영 세 축이 자연스럽게 나뉘므로 그대로 이식하되, 각 에이전트의 학습된 체크를 `review-gaps.md` 기반으로 채웠습니다

### Review Gaps → 스킬 반영 매핑

| Gap | 스킬 반영 위치 |
|-----|---------------|
| #4 AppProject `kind: "*"` | `k8s-security.md` AppProject 섹션 + `gitops-argocd-advanced.md` |
| #8 `targetRevision: main` | `gitops-argocd.md` Anti-Patterns 확장 |
| #10 YAML anchor 오판 | `k8s-helm.md` YAML Anchor/Alias 섹션 |
| #11 RBAC create+resourceNames | `k8s-security.md` RBAC 섹션 확장 |
| #12 AWS 종속값 하드코딩 | `gitops-argocd-helm.md` AWS 변수화 섹션 |

"어떤 갭이 어떤 스킬에 반영됐는지" 매핑 표를 스킬 개선 문서 상단에 두는 이유는 **추적 가능성** 때문입니다
다음 PR에서 같은 항목이 또 놓이면 "스킬에 들어갔는데도 실패했다"는 증거가 되어, 스킬 자체의 표현을 더 강한 경고로 고칠 근거가 됩니다

---

## 📚 배운 점

- **스킬 업데이트와 리뷰 커맨드 업데이트는 세트입니다.** 스킬에만 넣으면 에이전트가 늘 참조하지는 않습니다. 리뷰 커맨드의 학습된 체크에 동시에 추가하면 강제 로딩됩니다
- **전문 리뷰 커맨드는 3에이전트 병렬이 효과적이었습니다.** Helm/보안/운영처럼 축이 자연스럽게 나뉘는 도메인에서 한 에이전트가 모든 축을 동시에 보는 것보다 깊이가 유지됩니다
- **"매핑 표"는 회귀 감지 도구입니다.** gap → 스킬 파일 매핑을 문서화해두면, 같은 gap이 재발할 때 "스킬 표현이 충분히 강하지 않았다"는 교훈으로 이어집니다
- **동일 범위는 재분석하지 않습니다.** 이번 사이클에서 매핑된 review-gap/트러블슈팅/세션 로그는 "완료"로 표시하고, 새 PR에서 나오는 신규 gap만 다음 사이클에서 다룹니다
