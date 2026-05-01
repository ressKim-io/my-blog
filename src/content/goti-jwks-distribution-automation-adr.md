---
title: "JWKS 배포 자동화 (ADR) — Istio STRICT mTLS가 jwksUri를 막은 이유"
excerpt: "각 Helm values에 inline 하드코딩된 JWKS를 자동화하려 했습니다. Istio STRICT mTLS 제약으로 jwksUri 옵션이 구조적으로 불가능해 GitHub Actions 자동화 PR(Option E)을 채택한 과정과 근거를 정리했습니다"
category: istio
tags:
  - go-ti
  - Architecture Decision Record
  - JWT
  - JWKS
  - Istio
  - GitHub-Actions
  - mTLS
  - adr
series:
  name: "goti-auth"
  order: 1
date: "2026-04-12"
---

## 한 줄 요약

> Go 서비스 6개(Phase 6.5 4서비스 확대 시 10개)에 inline 하드코딩된 JWKS를 자동화해야 했습니다. 1차 초안에서 Option A(Istio `jwksUri`)를 권고했지만, Istio STRICT mTLS 환경에서 istiod의 JWKS fetch가 **Envoy sidecar를 거치지 않고 직접 호출**되는 구조적 제약이 있어 기각했습니다. 최종적으로 Option E(GitHub Actions 자동화 PR)를 채택했습니다

---

## 🔥 배경: 키 회전 때마다 10개 values를 수동 동기화했다

Go 서비스의 Istio `RequestAuthentication` JWT 검증용 JWKS가 각 서비스의 Helm values에 **inline으로 하드코딩**되어 있었습니다
Phase 6.5에서 stadium-go가 추가되며 하드코딩 지점이 6개로 늘었고, Phase 6.5 4서비스 일괄 적용 시 10개까지 증가할 예정이었습니다

### 현재 구조

```yaml
# environments/prod/goti-stadium-go/values.yaml
requestAuthentication:
  issuer: "goti-user-service"
  jwks: '{"keys":[{"alg":"RS256","kty":"RSA","kid":"goti-jwt-key-1","e":"AQAB","n":"..."}]}'
```

JWT 서명용 RSA 키는 Terraform `tls_private_key.jwt_rsa`가 생성하여 SSM에 저장하고, 각 Go 서비스는 자체 SSM 경로에서 공개키를 가져가고 있었습니다

### 문제점

| 문제 | 영향 |
|------|------|
| 키 회전 시 전체 values 수동 동기화 | 10개 서비스 PR 작성·머지 필요, 운영 부담 |
| 동기화 누락 시 특정 서비스만 JWT 401 | 부분 장애 추적 어려움 |
| ArgoCD는 CR lookup 불가 | Helm values에서 K8s Secret 참조 불가 |
| 6서비스 inline 불일치 가능성 | 복사·붙여넣기 오류 시 일부 서비스만 구버전 키 |

### 요구사항

| 요구사항 | 우선순위 |
|----------|----------|
| 키 회전 시 values.yaml 수정 불필요 | P0 |
| user-service 재배포 없이 다른 서비스 JWT 검증 계속 가능 | P0 |
| Istio `RequestAuthentication`과 호환 | P0 |
| Multi-Cloud(AWS + GCP) 동일 구조 | P0 |
| 키 캐싱 + TTL 제어 | P1 |
| 키 노출 시 즉시 무효화 가능 | P1 |

---

## 🧭 선택지 비교

| 옵션 | 구성 | 결과 |
|------|------|------|
| A. user-service JWKS 엔드포인트 + `jwksUri` | user-service에 `/.well-known/jwks.json` 구현, Istio CR이 jwksUri로 참조 | **기각** — Istio STRICT mTLS 제약 |
| B. ConfigMap 기반 JWKS | 공통 ConfigMap을 모든 서비스가 참조 | 기각 — Istio `RequestAuthentication`은 jwks string만 받고 ConfigMap 참조 불가 |
| C. ExternalSecret → values template 주입 | ExternalSecret으로 SSM 조회 후 annotation trick | 기각 — Istio CR은 annotation/env 치환 미지원 |
| D. 현 상태 유지 (수동 스크립트) | Makefile target으로 일괄 패치 | 기각 — GitOps 원칙 위반, drift 여전 |
| **E. GitHub Actions 자동화 PR** | SSM 변경 감지 → Actions → 6개 values 치환 → PR 생성 → 머지 | **채택** |
| F. mesh 외부 namespace + JWKS 전용 파드 | istio-injection 없는 namespace에 JWKS 파드 배포 | 검토됨, Option E 대비 열위 |

### Option A가 기각된 구조적 이유

Option A는 이론상 가장 깔끔했습니다. OIDC 표준(`.well-known/jwks.json`) 준수, istiod 자동 캐싱, values에서 JWKS 완전 제거가 가능했습니다

그러나 실제 환경에서는 치명적 제약이 있었습니다

- **istiod의 JWKS 요청은 Envoy sidecar를 거치지 않습니다.** istiod discovery container가 표준 HTTP 클라이언트로 직접 호출하는 것이 아키텍처 고정 사항입니다
- **STRICT mTLS 환경에서 mesh 내부 jwksUri fetch가 불가능합니다.** istiod는 mTLS 클라이언트 인증서 없이 호출합니다
- **AuthorizationPolicy principal이 없어 RBAC 403이 발생합니다.** istiod 호출은 workload identity가 발급되지 않습니다
- Istio 1.29 / 2026-04 기준 미해결 feature request 상태입니다

Workaround로 mesh 외부 호스팅, PERMISSIVE 완화, IP block, 공개 도메인 노출이 있었지만 모두 보안 trade-off를 동반했습니다
현재 go-ti 환경은 전체 mesh `PeerAuthentication: STRICT`이므로 Option A 채택 시 보안 정책 완화를 강제하게 되어 기각했습니다

(참고: Istio Issue #40553, #26984, #45138, Discussion #50578)

### Option B/C/D가 기각된 이유

- **B**: Istio `RequestAuthentication.spec.jwks`는 ConfigMap 참조를 지원하지 않습니다. Helm template 단계에서 `{{ .Values.common.jwks }}` 패턴으로 주입해도 여전히 values 변경이 발생합니다
- **C**: Istio CR의 `spec.jwks`는 annotation이나 env 치환을 **지원하지 않습니다**. 동작 자체가 안 됩니다
- **D**: GitOps 원칙 위반입니다. 스크립트 실행 결과가 git에 커밋되는 구조는 drift를 막지 못합니다

### 결정 기준

1. **Istio STRICT mTLS 정책 유지** — 보안 정책을 완화하지 않음. (1순위)
2. **GitOps 추적성 확보** — 모든 키 변경이 git 커밋으로 추적
3. **기존 자산 재활용** — Renovate, peter-evans/create-pull-request 이미 사용 중
4. **values.yaml self-contained** — ArgoCD lookup 의존 없음

Option E가 이 네 축을 모두 만족합니다

---

## ✅ 결정: Option E 채택 (GitHub Actions 자동화 PR)

JWT 키 회전 이벤트를 GitHub Actions로 감지해 Goti-k8s 6개 values.yaml을 일괄 수정하는 PR을 자동 생성합니다.

자동화 흐름은 다음 단계로 동작합니다.

1. Terraform apply 또는 user-service 키 회전이 일어납니다
2. Terraform outputs가 `/prod/server/JWT_JWKS` SSM 파라미터를 업데이트합니다
3. GitHub Actions가 schedule 또는 `repository_dispatch`로 트리거됩니다 — SSM JWKS를 pull하고 현재 values.yaml의 inline jwks와 비교한 뒤, 차이가 있으면 6개 values를 일괄 sed/yq로 치환하고 `peter-evans/create-pull-request`로 PR을 생성합니다
4. Renovate가 automerge하거나 수동으로 머지합니다
5. ArgoCD가 sync해 Istio에 재적용됩니다

### 장점

- Istio STRICT mTLS 제약을 mesh 외부 도구로 우회
- GitOps 원칙 준수 (모든 변경이 git 커밋으로 추적)
- 기존 도구 활용 (GitHub Actions + peter-evans/create-pull-request + Renovate)
- values.yaml은 여전히 self-contained (ArgoCD lookup 의존 없음)
- 감사 로그 — 모든 키 회전이 PR 기록으로 보존

### 단점

- 키 회전 적용 시간 = PR 생성 + 머지 + ArgoCD sync (30분~1시간)
- 롤아웃 중 일시적 401 가능 — Istio `RequestAuthentication`은 구키·신키 동시 등록 불가 (**kid 기반 복수 키 JWKS**로 완화)
- GitHub Actions workflow + OIDC 권한 + SSM 읽기 IAM role 추가 필요
- Renovate automerge 설정 시 리뷰 생략 — 보안 검토 포인트 필요

### 구현 범위

| 작업 | 레포 | 추정 규모 |
|------|------|----------|
| SSM `/prod/server/JWT_JWKS` 추가 | Terraform | +20 LoC |
| GitHub Actions workflow `rotate-jwks.yml` | K8s 레포 | ~150 LoC |
| SSM 읽기 IAM role + OIDC trust | Terraform | +30 LoC |
| values 치환 스크립트 (yq 기반) | K8s 레포/scripts | ~50 LoC |
| Renovate automerge 규칙 (`rotate-jwks` 라벨) | K8s 레포/.github | +10 LoC |
| 키 회전 런북 | docs/runbook | 1 문서 |
| 복수 kid 지원 JWKS 포맷 — 구키·신키 동시 등록 | user-service | +50 LoC |

### Acceptance Criteria

- [ ] SSM `/prod/server/JWT_JWKS`에 현재 JWT 공개키 저장됨
- [ ] GitHub Actions workflow schedule(1일 1회) + manual dispatch 작동
- [ ] workflow 실행 시 SSM ↔ values.yaml 차이 검출 정확도 100%
- [ ] 차이 감지 시 PR 생성 (제목: `chore(jwks): rotate keys [YYYY-MM-DD]`)
- [ ] Renovate automerge는 CI 통과 + 1 approval 이후에만
- [ ] 키 회전 리허설 — 의도적 SSM 값 변경 → PR 생성 → 머지 → ArgoCD sync → Istio 신 키로 JWT 검증 E2E 성공
- [ ] 롤아웃 중 구키 JWT 일시적 401 발생 비율 < 1% (복수 kid JWKS로 완화)

---

## Consequences

### 긍정적

- JWT 키 회전 운영 비용 대폭 감소 — 수동 PR 10개 → 자동 PR 1개
- 신규 Go 서비스 추가 시 values 복사 부담 해소 (파일 추가만 하면 자동 동기화)
- GitOps 추적성 확보 — 모든 키 변경이 git history에 남음
- Istio 보안 정책(STRICT mTLS) 그대로 유지

### 부정적

- 키 회전 적용 시간 지연 — SSM 업데이트 → PR 생성 → 머지 → ArgoCD sync까지 30분~1시간
  - **완화**: schedule 간격을 5분으로 설정 + manual dispatch 지원 + 복수 kid JWKS
- GitHub Actions workflow 장애 시 자동 동기화 중단 — 탐지 알림 필요
  - **완화**: workflow 실패 시 Discord alert, `last_successful_run` 메트릭 Prometheus export
- 초기 구축 작업 (Terraform + workflow + user-service JWKS 포맷 수정)

### 중립적

- Multi-Cloud — AWS/GCP별 SSM/Secret Manager 소스가 다릅니다. workflow matrix로 양쪽 처리하거나, 단일 SSM(AWS)을 진실원으로 두고 GCP 쪽은 동일 values를 공유합니다
- user-service 코드 변경 — JWKS 엔드포인트 자체는 불필요해졌으나 복수 kid 지원은 여전히 필요합니다

---

## 실행 타임라인

| Phase | 작업 | 선행 조건 |
|-------|------|----------|
| Phase 6.5 PoC 검증 후 | SSM `/prod/server/JWT_JWKS` 추가 + IAM role | stadium-go 배포 검증 |
| Phase 6.5 4서비스 확대 전 | `rotate-jwks.yml` workflow 구현 + yq 치환 스크립트 | SSM 소스 확정 |
| Phase 6.5 4서비스 확대 시 | 6~10개 values에 복수 kid 포맷 JWKS 일괄 적용 | workflow 실가동 검증 |
| Phase 7 진입 전 | 키 회전 리허설 + 런북 작성 | 전환 완료 |

---

## 검토했으나 기각된 대안

- **SPIFFE/SPIRE** — workload identity 표준이지만 JWT 검증 구조와 독립적, 과도한 복잡도
- **cert-manager + cluster-issuer** — X.509 기반 mTLS는 Istio 자체 CA가 이미 담당, JWKS와 무관
- **Keycloak 도입** — user-service 자체를 IdP로 교체하는 큰 변경, Phase 8 이후 검토

---

## 📚 배운 점

- **"이론상 깔끔한 옵션"이 구조적으로 불가능한 경우가 있습니다.** Istio `jwksUri`는 OIDC 표준 준수와 자동 캐싱이라는 이론적 장점을 갖지만, istiod가 Envoy를 거치지 않는 아키텍처 고정 사항 때문에 STRICT mTLS 환경에서 작동하지 않습니다. 공식 문서에서 잘 드러나지 않아 issue tracker까지 파야 확인됩니다
- **mesh 외부 도구로 제약을 우회하는 편이 깔끔할 때가 있습니다.** Istio 내부에서 모든 것을 해결하려다 보안 정책을 완화하는 것보다, GitHub Actions 같은 mesh 외부 도구로 처리하는 쪽이 정책을 지키면서 자동화를 확보합니다
- **복수 kid JWKS는 롤아웃 일시 401의 유일한 완화책입니다.** 단일 키만 등록하면 교체 순간 401이 발생합니다. 구키·신키를 동시에 등록하고 순차적으로 제거하는 구조를 미리 설계합니다
- **ADR 개정 이력은 "기각된 옵션"의 근거를 남기는 데 유용합니다.** Rev 1에서 Option A를 권고했다가 Rev 2에서 기각한 기록을 남겨두면, 나중에 누군가 "왜 jwksUri 안 써요?"를 물었을 때 바로 참조 가능합니다
