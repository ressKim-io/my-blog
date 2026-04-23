---
title: "Claude vs Gemini 리뷰 비교 — go-ti K8s PR #192 (11건 vs 5건, 반대 방향 1건 포함)"
excerpt: "Phase 6.5 prod helm values PR에서 Claude 3관점 병렬 리뷰는 11건, Gemini Code Assist는 5건을 발견했습니다. 양쪽이 같은 라인을 지적했지만 방향이 반대인 케이스(FQDN 일관성) 2건이 나와 머지 전 사람이 최종 결정해야 했습니다."
category: challenge
tags:
  - go-ti
  - Meta
  - Claude
  - Gemini
  - Code-Review
  - Istio
  - Helm
series:
  name: "goti-meta"
  order: 9
date: "2026-04-12"
---

## 한 줄 요약

> PR #192(`goti-stadium-go` Phase 6.5 prod helm values PoC)를 Claude 3관점 병렬 리뷰와 Gemini Code Assist가 동시에 봤습니다. Claude 11건(Major 5 + Minor 6), Gemini 5건(모두 medium). **양쪽이 같은 라인을 지적했는데 방향이 반대**인 케이스가 2건 나왔고, 최종 결정은 사람이 내려야 했습니다

---

## 🔥 대상: Phase 6.5 prod Helm values PoC PR

- **PR**: [Team-Ikujo/Goti-k8s#192](https://github.com/Team-Ikujo/Goti-k8s/pull/192)
- **제목**: `feat(goti-stadium-go): add Phase 6.5 prod helm values (PoC)`
- **Claude**: 3관점 병렬 K8s 리뷰 (`/review-pr:k8s`)
- **Gemini**: Gemini Code Assist (자동)

### 비교 요약

| 항목 | Claude (총 11건) | Gemini (총 5건) |
|------|------------------|------------------|
| Major/Critical 발견 | 5 (Major) | 0 (모두 medium) |
| Minor 발견 | 6 | 5 |
| 양쪽 일치 | 0 | 0 |
| 서로 모순 | 1 (FQDN 방향 반대) | 1 |

"일치 0"이 눈에 띕니다. 같은 PR을 보는데도 두 도구가 본 각도가 거의 겹치지 않았습니다

---

## 🤔 방향이 반대였던 항목 (핵심)

### FQDN 일관성 (`.cluster.local` 포함 여부)

같은 라인을 지적했지만 권고 방향이 정반대였습니다

- **Claude (CR-004)**: 같은 파일 내 mimir(짧은 형식)와 OTel(긴 형식)이 혼용 → **긴 형식으로 통일** 권장 (Istio sidecar/DNS proxy 엣지케이스 안전성)
- **Gemini (line 122/129)**: OTel을 짧은 형식(`monitoring.svc`)으로 변경 → **짧은 형식으로 통일** 권장 (가독성)

**최종 결정**: 운영 안전성 우선으로 긴 형식(`svc.cluster.local`) 통일 채택

결정 기준은 "Istio sidecar가 DNS proxy를 사용할 때 짧은 형식이 해석 실패로 이어진 경험이 있었다"는 **과거 인시던트**였습니다. 가독성보다 안전성을 위에 두는 것이 프로젝트 내 합의입니다. `ticketing-go`도 후속 동기 수정이 필요하지만 별도 PR로 분리했습니다

### excludePaths 표현 방식

- **Claude (CR-001)**: 보안 관점 — JWT 우회 위험. **method별 분리 + GET만 명시** 권장
- **Gemini (line 168)**: 가독성 관점 — **wildcard로 통합** 권장

**최종 결정**: 두 관점 통합 — wildcard로 통합하되 **"public read API 의도" 주석 명시**. method 제한은 chart template 변경이 필요해 후속 작업으로 분리

---

## ✅ Gemini만 발견 vs Claude만 발견

### Gemini만 발견 (Claude 누락)

| Gemini 지적 | 적용 결정 | 사유 |
|-------------|-----------|------|
| `~/*.amazonaws.com` Istio 비표준 형식 | `*.amazonaws.com`으로 변경 + `ticketing-go` 동기 TODO | Istio Sidecar `hosts`에서 `~`는 sidecar 자체 namespace 의미라 외부 도메인엔 부적절 |
| `/api/v1/stadiums` exact → prefix | prefix로 변경 | `/stadiums/{id}` 하위 리소스 매칭 표준. Java values와 갭 발생 — Java도 후속 통일 |
| OTel 짧은 형식 통일 | **거부** | FQDN 결정으로 Claude 방향 채택 |
| excludePaths wildcard | 채택 (Claude와 통합) | 가독성 + 의도 주석 |

Gemini가 잡은 `~` 형식 문제는 Istio Sidecar `hosts` 필드의 **문법 규칙**이었습니다
`~`는 sidecar 자체 namespace를 뜻하는 Istio 전용 문법이므로 외부 도메인에 붙이면 의미가 왜곡됩니다
Claude는 이런 라인 단위 문법 디테일은 놓쳤습니다

### Claude만 발견 (Gemini 누락)

| CR-ID | 항목 | 적용 |
|-------|------|------|
| CR-002 | VirtualService host/path 충돌 — Istio 라우팅 비결정적 | TODO 주석 |
| CR-003 | KEDA cron `stadium` 특성 미반영 | TODO 주석 (관측 후 튜닝) |
| CR-005 | Swagger 라우팅 누락 | 의도 주석 (Go Swagger 미구현 가정) |
| CR-006 | JWKS inline 하드코딩 6서비스 동기화 | TODO 주석 |
| CR-007 | ExternalSecret 선행 의존성 | W7 PR에서 처리 |
| CR-008 | AuthPolicy `from-ticketing` sunset 조건 | TODO 주석 (Phase 7 Step 4b 후 제거) |
| CR-009 | `requestAuthentication.issuer` Java 비일관 | TODO 주석 |
| CR-010 | `image.tag` placeholder GitOps drift | 변경 없음 (SG1 보호) |
| CR-011 | liveness `initialDelaySeconds: 3` | TODO 주석 |

Claude가 발견한 이슈는 공통적으로 **Phase 6.5 컨텍스트**가 있어야 감지되는 것이었습니다
- `from-ticketing` sunset 조건은 Phase 7 Step 4b 이후 제거 예정이라는 로드맵 정보가 필요합니다
- JWKS inline 하드코딩은 6서비스 동기화 비용을 보려면 레포 전체 맥락이 필요합니다
- `image.tag` placeholder는 GitOps drift 이슈인데 SG1(Safe Guard 1) 보호 정책을 알아야 유지 결정이 가능합니다

Gemini는 이런 프로젝트 맥락 없이 파일 단위로만 보기 때문에 누락됐습니다

---

## 📚 배운 점 — 각 도구의 강점

| 도구 | 강점 | 약점 |
|------|------|------|
| **Claude (3-agent 병렬)** | 아키텍처/패턴 일관성, Phase 6.5 컨텍스트 이해, 보안 관점 깊이 (JWT 우회, mTLS principal sunset), 운영 리스크(VS 충돌) | 형식 미세 차이(`~` 형식, exact vs prefix) 놓침 |
| **Gemini Code Assist** | 라인 단위 형식 검토 정확, Istio/REST API 표준 형식 인지 | 컨텍스트(Phase 6.5, Java 공존) 모름, 보안 우회 위험 미발견, 패턴 원본(ticketing-go)과의 비교 불가 |

- **두 도구는 상호 보완적입니다.** Claude는 시스템 관점, Gemini는 라인 관점이라는 특성이 드러났습니다
- **같은 라인 지적에서 방향이 반대인 케이스가 존재합니다.** FQDN처럼 운영 안전성 ↔ 가독성이 충돌할 때, 프로젝트 내부의 **과거 인시던트·합의**를 기준으로 사람이 최종 판단해야 합니다
- **"일치 0"은 이상한 수치가 아니었습니다.** 관점이 다르면 같은 PR에서도 발견 집합이 겹치지 않을 수 있습니다. 양쪽 결과를 모두 리뷰 머지 전 확인하는 워크플로우가 필요합니다
- **후속 작업을 명시합니다.** 본 PR에서는 11건 중 즉시 적용 가능한 것만 반영하고, 나머지는 `ticketing-go FQDN 통일`, `JWKS 자동화 ADR`, `AuthPolicy sunset Phase 7 체크리스트`처럼 구체적 후속 작업으로 분리했습니다
