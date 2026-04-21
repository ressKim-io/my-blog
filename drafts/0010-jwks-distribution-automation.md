# ADR-0010: JWKS 배포 자동화 — Go 서비스 inline jwks 제거

- **Status**: Proposed (Revision 2 — 2026-04-12, Option A 기각 후 Option E 채택)
- **Date**: 2026-04-12
- **Decision Makers**: ress
- **Related**: Team-Ikujo/Goti-k8s#192, Phase 6.5 W4 (Team-Ikujo/Goti-Terraform#8)

## 개정 이력

| Rev | 일자 | 변경 |
|-----|------|------|
| 1 | 2026-04-12 | 초안 — Option A(jwksUri) 채택 권고 |
| 2 | 2026-04-12 | **Option A 기각** — Istio STRICT mTLS + 내부 jwksUri 구조적 제약 확인. **Option E(GitHub Actions 자동화) 채택** |

## Context

Go 서비스의 Istio `RequestAuthentication` JWT 검증용 JWKS(JSON Web Key Set)가 각 서비스 Helm values에 **inline으로 하드코딩**되어 있다. Phase 6.5에서 stadium-go가 추가되며 하드코딩 지점이 6개로 늘어났고, Phase 6.5 4서비스 일괄 적용 시 10개까지 증가한다.

### 현재 구조

```yaml
# environments/prod/goti-stadium-go/values.yaml
requestAuthentication:
  issuer: "goti-user-service"
  jwks: '{"keys":[{"alg":"RS256","kty":"RSA","kid":"goti-jwt-key-1","e":"AQAB","n":"tXlfi..."}]}'
```

JWT 서명용 RSA 키는 Terraform `tls_private_key.jwt_rsa`가 생성하여:
- Private key → SSM `/prod/user/JWT_RSA_PRIVATE_KEY` (user-service 전용)
- Public key → SSM `/prod/server/JWT_RSA_PUBLIC_KEY` + 각 Go 서비스 `/prod/{svc}-go/*_JWT_PUBLIC_KEY_PEM`

### 문제점

| 문제 | 영향 |
|------|------|
| 키 회전 시 전체 values 수동 동기화 | 10개 서비스 PR 작성 + 머지 필요, 운영 부담 |
| 동기화 누락 시 특정 서비스만 JWT 401 | 부분 장애 추적 어려움 |
| ArgoCD는 CR lookup 불가 | Helm values에서 K8s Secret 참조 불가 |
| 6서비스 inline 불일치 가능성 | 복사/붙여넣기 오류 시 일부 서비스만 구버전 키 |

### 요구사항

| 요구사항 | 우선순위 |
|----------|----------|
| 키 회전 시 values.yaml 수정 불필요 | P0 |
| user-service 재배포 없이 다른 서비스 JWT 검증 계속 가능 | P0 |
| Istio `RequestAuthentication`과 호환 | P0 |
| Multi-Cloud(AWS + GCP) 동일 구조 | P0 |
| 키 캐싱 + TTL 제어 | P1 |
| 키 노출 시 즉시 무효화 가능 | P1 |

## Options

### Option A: user-service JWKS 엔드포인트 + Istio `jwksUri` [REJECTED]

> **기각 근거 (Rev 2, 2026-04-12)**: Istio의 구조적 제약으로 STRICT mTLS 환경에서 mesh 내부 `jwksUri` 작동 불가 확인. Goti 환경은 전체 mesh `PeerAuthentication: STRICT`이므로 본 옵션 채택 시 보안 정책 완화 강제됨.

user-service에 `/.well-known/jwks.json` 엔드포인트를 구현하고, 각 Go 서비스 `RequestAuthentication`이 `jwks` 대신 `jwksUri`로 참조한다.

```yaml
requestAuthentication:
  issuer: "goti-user-service"
  jwksUri: "http://goti-user-prod.goti.svc.cluster.local:8080/.well-known/jwks.json"
```

- **장점 (이론상)**:
  - OIDC 표준 준수 (`.well-known/jwks.json`)
  - Istiod가 자동 캐싱 (`jwks_fetch_interval` 기본 20분)
  - values.yaml에서 jwks 완전 제거
- **치명적 단점 (실제 제약)**:
  - **istiod의 JWKS 요청은 Envoy sidecar를 거치지 않음** — istiod discovery container가 표준 HTTP 클라이언트로 직접 호출 (아키텍처 고정)
  - **STRICT mTLS 환경에서 mesh 내부 jwksUri fetch 불가** — istiod는 mTLS 클라이언트 인증서 없이 호출
  - **AuthorizationPolicy principal 없어서 RBAC 403** — istiod 호출은 workload identity 미발급
  - Istio 1.29 / 2026-04 기준 미해결 feature request 상태
  - Workaround(mesh 외부 호스팅, PERMISSIVE 완화, IP block, 공개 도메인 노출)는 모두 보안 trade-off

**참고**: [Istio Issue #40553](https://github.com/istio/istio/issues/40553), [#26984](https://github.com/istio/istio/issues/26984), [#45138](https://github.com/istio/istio/issues/45138), [Discussion #50578](https://github.com/istio/istio/discussions/50578)

### Option B: ConfigMap 기반 JWKS + Istio `jwks` ConfigMapRef

공통 ConfigMap `goti-jwks`에 JWKS를 저장하고 모든 서비스 `requestAuthentication.jwks`가 동일 ConfigMap을 참조.

```yaml
# goti-common Library Chart에 ConfigMap 추가
apiVersion: v1
kind: ConfigMap
metadata:
  name: goti-jwks
data:
  jwks.json: '{"keys":[...]}'
```

- **장점**:
  - 구현 간단, 외부 의존성 없음
  - ConfigMap 업데이트만으로 전체 서비스 키 회전
- **단점**:
  - Istio `RequestAuthentication`은 `jwks` string만 받음. ConfigMap 참조 **불가**
  - Helm template 단계에서 `{{ .Values.common.jwks }}` 패턴으로 공통 values 주입 필요 → 여전히 values 변경 발생
  - `helm template` 의존성 체인 복잡화

### Option C: ExternalSecret 기반 jwks → values template 주입

ExternalSecret으로 `/prod/server/JWT_JWKS` 조회 후 Istio CR annotation trick으로 주입.

- **장점**: 키 회전이 ExternalSecret `refreshInterval`만큼 반영
- **단점**:
  - Istio `RequestAuthentication.spec.jwks`는 annotation이나 env 치환 **지원 안 함**
  - 동작 안 함. 사실상 옵션 불가

### Option D: 현 상태 유지 (script 자동 동기화) [REJECTED]

values 파일을 스크립트로 일괄 패치하는 Makefile target.

- **장점**: 인프라 변경 불필요
- **단점**: GitOps 원칙 위반(스크립트 실행 결과가 git에 커밋), 키 회전 drift 여전히 가능, PR 필요

### Option E: GitHub Actions 자동화 PR — values 일괄 치환 [ACCEPTED]

JWT 키 회전 이벤트를 GitHub Actions로 감지하여 Goti-k8s 6개 values.yaml을 일괄 수정하는 PR을 자동 생성한다.

```
Terraform apply / user-service key rotation
  → SSM /prod/server/JWT_JWKS 업데이트 (Terraform outputs)
  → GitHub Actions (schedule 또는 repository_dispatch)
     - SSM JWKS pull
     - 현재 values.yaml inline jwks와 비교
     - 차이 있으면 6개 values 일괄 sed/yq 치환
     - peter-evans/create-pull-request 로 PR 생성
  → Renovate automerge 또는 수동 머지
  → ArgoCD sync → Istio 재적용
```

- **장점**:
  - Istio STRICT mTLS 제약 우회 (mesh 외부 도구로 처리)
  - GitOps 원칙 준수 (모든 변경이 git 커밋으로 추적)
  - 기존 도구 활용 (GitHub Actions + peter-evans/create-pull-request + Renovate)
  - values.yaml은 여전히 self-contained (ArgoCD lookup 의존 없음)
  - 감사 로그 — 모든 키 회전이 PR 기록으로 보존
- **단점**:
  - 키 회전 적용 시간 = PR 생성 + 머지 + ArgoCD sync (30분~1시간)
  - 롤아웃 중 일시적 401 가능 — Istio `RequestAuthentication`은 구키/신키 동시 등록 불가 (kid 기반 다중 키 JWKS로 완화)
  - GitHub Actions workflow + OIDC 권한 + SSM 읽기 IAM role 추가 필요
  - Renovate automerge 설정 시 리뷰 생략 — 보안 검토 포인트 필요

### Option F: mesh 외부 namespace JWKS 전용 파드 + `jwksUri` [검토됨, Option E 대비 열위]

`istio-injection` 없는 별도 namespace에 JWKS 전용 파드를 배포해 istiod가 plain HTTP로 가져가게 함.

- **장점**: values.yaml 전환 불필요 (Option A 이론상 장점 유지)
- **단점**:
  - 별도 파드/배포 운영 부담 (가용성, 모니터링, 스케일링)
  - mesh 외부라서 observability/policy 누락
  - JWKS 업데이트 메커니즘이 여전히 필요 (파드 재배포 or hot reload) — 결국 본 문제가 파드 안으로 이동만

## Decision

**Option E 채택 (GitHub Actions 자동화 PR)**.

### 이유

1. **Istio 제약 우회** — mesh 외부 도구(GitHub Actions)로 처리하여 STRICT mTLS 정책 유지
2. **GitOps 원칙 유지** — 모든 키 변경이 git 커밋/PR로 추적, 감사성 확보
3. **기존 자산 재활용** — Renovate, peter-evans/create-pull-request 이미 프로젝트 사용 중
4. **단일 진실원 유지** — JWT key는 Terraform state + SSM에만 존재, values.yaml은 자동 동기화
5. **롤백 용이** — PR revert로 즉시 이전 키 복귀 가능

### 구현 범위

| 작업 | 레포 | 추정 규모 |
|------|------|----------|
| SSM `/prod/server/JWT_JWKS` 추가 (Terraform outputs → Parameter) | Goti-Terraform | +20 LoC |
| GitHub Actions workflow `rotate-jwks.yml` | Goti-k8s | ~150 LoC |
| SSM 읽기 IAM role + OIDC trust | Goti-Terraform | +30 LoC |
| values 치환 스크립트 (yq 기반) | Goti-k8s/scripts | ~50 LoC |
| Renovate automerge 규칙 (`rotate-jwks` 라벨) | Goti-k8s/.github | +10 LoC |
| 키 회전 런북 | docs/runbook | 1 문서 |
| 복수 kid 지원 JWKS 포맷 — 구키/신키 동시 등록 | user-service | +50 LoC |

### Acceptance Criteria

- [ ] SSM `/prod/server/JWT_JWKS`에 현재 JWT 공개키 저장됨
- [ ] GitHub Actions workflow schedule (1일 1회) + manual dispatch 작동
- [ ] workflow 실행 시 SSM ↔ values.yaml 차이 검출 정확도 100%
- [ ] 차이 감지 시 PR 생성 (제목: `chore(jwks): rotate keys [YYYY-MM-DD]`)
- [ ] Renovate automerge는 CI 통과 + 1 approval 이후에만
- [ ] 키 회전 리허설 — 의도적 SSM 값 변경 → PR 생성 → 머지 → ArgoCD sync → Istio 신 키로 JWT 검증 E2E 성공
- [ ] 롤아웃 중 구키 JWT 일시적 401 발생 비율 < 1% (복수 kid JWKS로 완화)

## Consequences

### 긍정적

- JWT 키 회전 운영 비용 대폭 감소 — 수동 PR 10개 → 자동 PR 1개
- 신규 Go 서비스 추가 시 values 복사 부담 해소 (파일 추가만 하면 자동 동기화)
- GitOps 감사성 확보 — 모든 키 변경이 git history에 남음
- Istio 보안 정책(STRICT mTLS) 그대로 유지

### 부정적

- 키 회전 적용 시간 지연 — SSM 업데이트 → PR 생성 → 머지 → ArgoCD sync까지 30분~1시간
  - 완화: schedule 간격을 5분으로 설정 + manual dispatch 지원 + 복수 kid JWKS
- GitHub Actions workflow 장애 시 자동 동기화 중단 — 탐지 알림 필요
  - 완화: workflow 실패 시 Discord alert, `last_successful_run` 메트릭 Prometheus export
- 초기 구축 작업 (Terraform + workflow + user-service JWKS 포맷 수정)

### 중립적

- Multi-Cloud — AWS/GCP 별 SSM/Secret Manager 서로 다른 소스. workflow matrix로 양쪽 처리 or 단일 SSM(AWS)을 진실원으로 두고 GCP 쪽은 동일 values 공유
- user-service 코드 변경 — JWKS 엔드포인트는 불필요해졌으나 복수 kid 지원은 여전히 필요

## 실행 타임라인

| Phase | 작업 | 선행 조건 |
|-------|------|----------|
| **Phase 6.5 PoC 검증 후** | SSM `/prod/server/JWT_JWKS` 추가 + IAM role (Goti-Terraform) | stadium-go 배포 검증 |
| **Phase 6.5 4서비스 확대 전** | `rotate-jwks.yml` workflow 구현 + yq 치환 스크립트 | SSM 소스 확정 |
| **Phase 6.5 4서비스 확대 시** | 6~10개 values에 복수 kid 포맷 JWKS 일괄 적용 | workflow 실가동 검증 |
| **Phase 7 진입 전** | 키 회전 리허설 + 런북 작성 | 전환 완료 |

## Alternatives Considered

- **SPIFFE/SPIRE** — workload identity 표준이나 JWT 검증 구조와 독립적, 과도한 복잡도
- **cert-manager + cluster-issuer** — X.509 기반 mTLS는 Istio 자체 CA가 이미 담당, JWKS와 무관
- **Keycloak 도입** — user-service 자체를 IdP로 교체하는 큰 변경, Phase 8 이후 검토

## References

### Istio 구조적 제약 (Option A 기각 근거)
- [Istio Issue #40553 — istiod/proxy jwksUri with STRICT mTLS](https://github.com/istio/istio/issues/40553)
- [Istio Issue #26984 — internal jwksUri with internally signed certificate](https://github.com/istio/istio/issues/26984)
- [Istio Issue #45138 — Jwks remote fetch failed](https://github.com/istio/istio/issues/45138)
- [Istio Discussion #50578 — in-mesh jwksUri with authorizationpolicy principal](https://github.com/istio/istio/discussions/50578)
- [Istio Security Common Problems](https://istio.io/latest/docs/ops/common-problems/security-issues/)

### 표준/참조
- [Istio `RequestAuthentication` API](https://istio.io/latest/docs/reference/config/security/request_authentication/)
- [RFC 7517 — JSON Web Key (JWK)](https://www.rfc-editor.org/rfc/rfc7517)
- [peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request)

### 내부 참조
- Goti-k8s PR #192 — Phase 6.5 stadium-go, 하드코딩 6서비스로 확대됨
- Goti-Terraform PR #8 — `/prod/{svc}-go/*_JWT_PUBLIC_KEY_PEM` (기존 구조, Option E에서도 유지)
- Memory `project_jwks_automation_todo.md` — STRICT mTLS 제약 기존 검토 기록 (Option A 기각 근거 제공)
