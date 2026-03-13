# K8s Skills + `/review-pr:k8s` 전문 리뷰 커맨드 개선

- **날짜**: 2026-03-11
- **유형**: meta (AI 워크플로우 개선)
- **범위**: K8s/Helm/ArgoCD 스킬 + 전문 리뷰 커맨드

---

## 배경

모니터링 영역 개선 (2026-03-11) 완료 후 K8s 영역 차례.
기존 스킬 파일이 범용 지식 중심 → 프로젝트에서 실제 부딪힌 K8s 실무 이슈 미반영.

## 분석한 데이터 소스

| 소스 | 건수 | 주요 내용 |
|------|------|----------|
| Review Gaps (PR #11~#19) | 12건 | RBAC create+resourceNames, AppProject 와일드카드, targetRevision:main, YAML anchor 오판, AWS 종속값 하드코딩 등 |
| 트러블슈팅 로그 | 1건 | kubectl secret `$` shell escaping (2026-03-11) |
| 세션 로그 | 8건 | Library Chart, ArgoCD에서 Helm 역할, Bootstrap sync-wave, Kind 매핑, ESO sync-wave 등 |

## 수정 파일 상세

### 스킬 파일 (5개)

| 파일 | 수정 전 | 수정 후 | 추가 내용 |
|------|---------|---------|----------|
| `k8s-helm.md` | 189줄 | ~320줄 | Library Chart, ArgoCD+Helm 역할, values.schema.json, YAML anchor, 멀티 환경 values |
| `k8s-security.md` | 362줄 | ~440줄 | RBAC create+resourceNames 제약, AppProject 최소 권한, kubectl secret 특수문자 |
| `gitops-argocd.md` | 347줄 | ~420줄 | targetRevision 위험성 상세, Bootstrap sync-wave 패턴 |
| `gitops-argocd-advanced.md` | 443줄 | ~470줄 | AppProject 와일드카드 검증, ApplicationSet 하이브리드. 시크릿 섹션 → helm 파일로 이동 |
| `gitops-argocd-helm.md` | 344줄 | ~460줄 | ESO sync-wave 순서, Sealed Secrets 흡수, ECR CronJob, AWS 종속값 변수화 |

### 리뷰 커맨드 (2개)

| 파일 | 작업 | 내용 |
|------|------|------|
| `review-pr-k8s.md` | 신규 | 3 에이전트 병렬: ⎈ Helm Chart/values, 🔒 ArgoCD GitOps/보안, ⚙️ 운영/패턴 일관성 |
| `review-pr.md` | 수정 | Auto-Routing k8s 영역 → `/review-pr:k8s` 체크 항목 연결 |

## Review Gaps → 스킬 반영 매핑

| Gap | 스킬 반영 |
|-----|----------|
| #4 AppProject `kind: "*"` | `k8s-security.md` AppProject 섹션 + `gitops-argocd-advanced.md` |
| #8 targetRevision: main | `gitops-argocd.md` Anti-Patterns 확장 |
| #10 YAML anchor 오판 | `k8s-helm.md` YAML Anchor/Alias 섹션 |
| #11 RBAC create+resourceNames | `k8s-security.md` RBAC 섹션 확장 |
| #12 AWS 종속값 하드코딩 | `gitops-argocd-helm.md` AWS 변수화 섹션 |

## 향후 동일 범위 재분석 불필요

이 문서에 매핑된 Review Gaps, 트러블슈팅 로그, 세션 로그는 모두 스킬 파일에 반영 완료.
새로운 K8s PR에서 추가 gap이 발견되면 별도 개선 사이클 진행.

## 미반영/TODO

- `/review-pr:k8s`의 `helm lint` 자동 실행: 범용 `/review-pr` 1.6 섹션과 중복. 향후 통합 필요
- Kyverno 정책 검증 체크: 실제 Kyverno 도입 후 추가
- ApplicationSet Matrix Generator 패턴: 아직 프로젝트에서 미사용
