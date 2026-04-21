# PR #192 (Goti-k8s) Claude vs Gemini 리뷰 비교

**일자**: 2026-04-12
**PR**: [Team-Ikujo/Goti-k8s#192](https://github.com/Team-Ikujo/Goti-k8s/pull/192) — `feat(goti-stadium-go): add Phase 6.5 prod helm values (PoC)`
**리뷰어**: Claude Code (3-agent 병렬 K8s 리뷰) + Gemini Code Assist

---

## 비교 요약

| 항목 | Claude (총 11건) | Gemini (총 5건) | 비고 |
|------|------------------|------------------|------|
| Major/Critical 발견 | 5 (Major) | 0 (모두 medium) | |
| Minor 발견 | 6 | 5 | |
| 양쪽 일치 | 0 | 0 | 같은 파일 다른 각도 위주 |
| 서로 모순 | 1 (FQDN 방향 반대) | 1 | |

## 양쪽이 같은 라인을 지적했지만 **방향이 반대**인 항목

### FQDN 일관성 (`.cluster.local` 포함 여부)
- **Claude (CR-004)**: 같은 파일 내 mimir(짧은형식)와 OTel(긴형식) 혼용 → **긴형식으로 통일 권장** (Istio sidecar/DNS proxy 엣지케이스 안전성)
- **Gemini (line 122/129)**: OTel을 짧은형식(`monitoring.svc`)으로 변경 → mimir와 일치 권장 (가독성)
- **결정**: 운영 안전성 우선 → **긴형식(`svc.cluster.local`)으로 통일**. ticketing-go도 후속 동기 수정 필요(별도 PR).

### excludePaths 표현 방식
- **Claude (CR-001)**: 보안 관점 — JWT 우회 위험. method별 분리 + GET만 명시
- **Gemini (line 168)**: 가독성 관점 — wildcard로 통합
- **결정**: 두 관점 통합 — wildcard 통합 + "public read API 의도" 주석 명시. method 제한은 chart template 변경 필요해 후속.

## Gemini만 발견 (Claude 누락)

| Gemini 지적 | 적용 결정 | 사유 |
|-------------|-----------|------|
| `~/*.amazonaws.com` Istio 비표준 형식 | `*.amazonaws.com`으로 변경 + ticketing-go 동기 TODO | Istio Sidecar `hosts`에서 `~`는 sidecar 자체 namespace 의미라 외부 도메인엔 부적절 |
| `/api/v1/stadiums` exact → prefix | prefix로 변경 | `/stadiums/{id}` 하위 리소스 매칭 표준. Java values와 갭 발생 — Java도 후속 통일 |
| OTel 짧은형식 통일 | 거부 (Claude 결정 채택) | 위 FQDN 결정 참조 |
| excludePaths wildcard | 채택 (Claude와 통합) | 가독성 + 의도 주석 |

## Claude만 발견 (Gemini 누락)

| CR-ID | 항목 | 적용 |
|-------|------|------|
| CR-002 | VS host/path 충돌 — Istio 라우팅 비결정적 | TODO 주석 |
| CR-003 | KEDA cron stadium 특성 미반영 | TODO 주석 (관측 후 튜닝) |
| CR-005 | Swagger 라우팅 누락 | 의도 주석 (Go Swagger 미구현 가정) |
| CR-006 | JWKS inline 하드코딩 6서비스 동기화 | TODO 주석 |
| CR-007 | ExternalSecret 선행 의존성 | W7 PR에서 처리 |
| CR-008 | AuthPolicy `from-ticketing` sunset 조건 | TODO 주석 (Phase 7 Step 4b 후 제거) |
| CR-009 | requestAuthentication.issuer Java 비일관 | TODO 주석 |
| CR-010 | image.tag placeholder GitOps drift | 변경 없음 (SG1 보호) |
| CR-011 | liveness initialDelaySeconds 3초 | TODO 주석 |

## 결론 — 각 도구 강점

| 도구 | 강점 | 약점 |
|------|------|------|
| **Claude (3-agent 병렬)** | 아키텍처/패턴 일관성, Phase 6.5 컨텍스트 이해, 보안 관점 깊이 (JWT 우회, mTLS principal sunset), 운영 리스크(VS 충돌) | 형식 미세 차이 (`~` 형식, exact vs prefix) 놓침 |
| **Gemini Code Assist** | 라인 단위 형식 검토 정확, Istio/REST API 표준 형식 인지 | 컨텍스트(Phase 6.5, Java 공존) 모름, 보안 우회 위험 미발견, 패턴 원본(ticketing-go)과의 비교 불가 |

**결론**: 두 도구 상호보완적. Claude는 시스템 관점, Gemini는 라인 관점. 같은 라인 지적해도 방향이 반대일 수 있으니 머지 전 사람이 결정해야 함.

## 후속 작업

1. 본 PR — 11건 중 즉시 적용 가능한 것 모두 반영 (아래 커밋)
2. ticketing-go FQDN 통일 (별도 PR)
3. JWKS 자동화 ADR (Phase 6.5 4서비스 확대 전)
4. AuthPolicy sunset Phase 7 체크리스트 등록
