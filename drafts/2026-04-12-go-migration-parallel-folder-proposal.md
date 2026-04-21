# Go 마이그레이션 — 팀원 "병렬 폴더 + 딸깍 토글" 제안

- **날짜**: 2026-04-12
- **맥락**: 오늘 capacity planning 부하테스트로 Stadium p95 6.8s / 5xx 10.88% 확인 → Java 병목 공식화 → Go 전환 타당성 입증. 다음 단계 전환 전략 논의.
- **관련 문서**:
  - `docs/load-test/2026-04-12-capacity-planning-keda.md` (병목 측정 결과 + Go 체크리스트)
  - `docs/migration/java-to-go/phase7-go-readiness-audit-sdd.md`
  - `docs/migration/java-to-go/phase6.5-go-prod-infra-sdd.md`

---

## 팀원 제안

> **"prod 환경에서 Go로 전환할 때 Java 코드 건들지 말고, 폴더를 하나 더 만들어서 그쪽으로 전환하면 어떠냐. 딸깍 변수 바꾸면 다시 Java로 돌아갈 수 있게."**

### 핵심 포인트
1. **Java 코드 무수정 원칙** — 기존 `Goti-server/` 그대로 유지
2. **병렬 Go 배포** — 별도 폴더/디렉토리에서 Go 구현 배포
3. **변수 토글 기반 스위치** — 값 하나 바꾸면 Java ↔ Go 즉시 전환
4. **빠른 롤백** — Go 문제 시 딸깍 한 번으로 Java 복귀

---

## 현재 아키텍처 상태 (2026-04-12 기준)

제안이 **부분적으로 이미 구현 중**. 현재 구조:

| 레이어 | Java | Go |
|---|---|---|
| 코드 레포 | `Goti-server/` (그대로) | `Goti-go/` (별도 레포) |
| Helm values | `Goti-k8s/environments/prod/goti-ticketing/` | `Goti-k8s/environments/prod/goti-ticketing-go/` |
| Deployment | `goti-ticketing-prod` | `goti-ticketing-go-prod` |
| Service | `goti-ticketing-prod` | `goti-ticketing-go-prod` |
| ArgoCD App | `goti-ticketing-prod` | `goti-ticketing-go-prod` |
| ApplicationSet | `prod` | `prod` (elements에서 주석 처리 중 — Phase 6.5 완료까지) |

→ 즉 **"Java 코드 무수정 + 별도 폴더/배포"는 이미 확립됨**.

미해결 요소: **"딸깍 토글" 메커니즘**이 구체적으로 무엇인지.

---

## 제안 해석 3가지

### 해석 A — Istio VirtualService weight 기반 라우팅

```yaml
# charts/goti-common/templates/_virtualservice.tpl (가상)
http:
  - route:
      - destination: { host: goti-ticketing-prod }
        weight: 100   # Java (현재)
      - destination: { host: goti-ticketing-go-prod }
        weight: 0     # Go (대기)
```

- **토글 방법**: Helm values의 `weight` 값 변경 → PR → ArgoCD sync (수분 내 전환)
- **점진 롤아웃 가능**: 100/0 → 90/10 → 50/50 → 0/100
- **실시간 A/B 메트릭 비교 가능**

### 해석 B — ApplicationSet elements 주석 토글

```yaml
# Goti-k8s/environments/prod/apps/applicationset.yaml
generators:
  - list:
      elements:
        - name: goti-ticketing         # Java
        # - name: goti-ticketing-go    # Go — 주석 처리
```

- **토글 방법**: 주석 처리/해제 → PR
- 현재 `ticketing-go`가 **이 방식으로 주석 처리된 상태**임 (memory 기록)

### 해석 C — Feature Flag / 환경변수 기반

- Gateway 앞단에서 `IMPL_MODE=java|go` 같은 환경변수로 라우팅 분기
- LaunchDarkly/GrowthBook 같은 외부 flag 서비스 연동
- 100% 무중단 전환 가능하지만 구현 복잡

---

## 분석: 제안의 장단점

### ✅ 장점
1. **안전한 롤백** — Go 구현에 숨은 버그 있어도 즉시 복귀
2. **점진 전환** — weight 기반이면 10% 사용자부터 노출, 문제 없으면 확대
3. **Java 팀원 부담 없음** — Java 코드 수정 PR 리뷰 부담 사라짐
4. **A/B 메트릭 실시간 비교** — Grafana에서 두 버전 p95/에러율 나란히 관찰
5. **실전 환경 검증** — staging이 아닌 prod에서 실사용자 트래픽으로 검증

### ⚠️ 단점 / 고려사항
1. **DB 공유로 인한 schema drift 위험** — Java/Go가 같은 PostgreSQL 스키마 사용 → migration 시 양쪽 호환 필요
2. **Config 이중 관리** — values, secrets, Istio policy 두 세트 유지
3. **인프라 비용 2배 (전환 기간)** — 두 배포가 동시에 실행
4. **Observability 분리 표시 필요** — 대시보드에서 두 버전 label 분리 (이미 `service_name` 변수 있음)
5. **Queue 토큰 호환성** — Java enter → Go seat-enter 가능해야 함 (JWE 동일 secret)
6. **트랜잭션 경계 복잡** — 한 요청이 Java ticketing + Go payment 섞이면 정합성 이슈

---

## 현재 Phase 6.5/7 전략과의 관계

### Phase 7 (Go Readiness Audit) SDD — "인플레이스 컷오버"
- 기존 계획: Java → Go 단일 전환 (weight 100→0 순식간)
- 롤백: weight 복귀 or PR revert

### Phase 6.5 (Go prod 인프라) — "병렬 유지"
- 이미 `goti-ticketing-go-prod` Helm values 별도 폴더에 존재
- ApplicationSet elements에서 Go 주석 처리로 **현재 Java만 활성**
- W7 이전까지 Java/Go 공존하는 설계 진행 중

→ **팀원 제안은 Phase 6.5의 연장선** (이미 방향 맞음)

---

## 결정 대기 사항

1. **"딸깍 토글" 구체 구현**:
   - 옵션 A (Istio VS weight) vs 옵션 B (ApplicationSet elements 주석) 중 선택
   - 혹은 둘 다 병행 (initial cutover=elements, fine-tuning=weight)

2. **점진 롤아웃 정책**:
   - 0→10→50→100% 단계 설정
   - 각 단계 관찰 기간 / 롤백 조건 (5xx > 1% 시 자동 롤백 등)

3. **DB schema evolution**:
   - Go flyway/goose migration이 Java와 호환성 유지하는 방법
   - 읽기/쓰기 호환 순서 (expand-contract 패턴 권장)

4. **Java 유지 기간**:
   - Go 100% 전환 후 Java Deployment 제거 시점
   - Phase 8 (Cleanup) 범위 확정

---

## 다음 액션 (내일 이후)

1. 팀원과 "딸깍 토글"의 구체적 의미 협의 (옵션 A/B/C 중 어느 것)
2. Phase 6.5 SDD에 토글 메커니즘 명문화
3. Istio VS 가중치 라우팅 PoC (옵션 A 채택 시)
4. Expand-contract migration 정책 ADR 초안

## 참고
- 오늘 부하테스트로 **Java 최적화 포기 + Go 가속화** 공식 결정
- 팀원 제안 == 이미 진행 중인 방향 (무의식적으로 같은 답 도출) + 구체 토글 방식만 미확정
- 리더(kimhj)가 팀원 제안 청취 후 Phase 6.5 정책에 반영 예정

---

## 🔚 2026-04-12 심야 결정 (기존 제안 기각)

**최종 채택: 병렬 배포 없이 one-shot full cutover.**

- prod에서 **Java 완전 철수 + Go 전면 배포**
- Java-Go **호환성 검증 안 함** (시간/리소스 부족)
- "딸깍 토글" 기반 병렬 운영도 **하지 않음**
- 쿠버네티스/Helm 상에서 Java Deployment 제거 + Go Deployment만 배포

### 채택 근거
1. 시간 제약 — capacity test로 하루 소진, 팀이 호환성 검증할 여력 없음
2. 리스크 허용 — staging에서 충분히 검증 가정 → prod cutover 단일 이벤트로 처리
3. 운영 부담 감소 — 병렬 운영 시 DB schema drift, config 이중 관리 피함
4. Java 코드가 이미 병목 확정 → 빨리 치우는 게 나음

### 영향 / 전제
- **Staging에서 Go 전체 E2E 검증 완료**가 전제 (위험 완화)
- **roll-forward only** — 문제 발생 시 Java 복귀 대신 **Go에서 hotfix**
- **DB 마이그레이션** — Go가 읽고 쓸 수 있는 상태로 이미 맞춰져 있음을 전제 (같은 스키마)
- **Queue 토큰/세션 호환성 불필요** — 전환 순간 모든 세션 무효화 수용

### 리스크 수용
- prod 사용자 세션 일시 끊김 (전환 순간)
- Go 잠재 버그 드러나면 Java 롤백 불가 → Go에서 즉시 수정 배포
- 병렬 A/B 메트릭 비교 불가 — 부하테스트 baseline(이 문서)으로 비교
