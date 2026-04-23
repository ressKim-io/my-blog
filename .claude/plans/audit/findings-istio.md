# findings-istio (34편)

## Level × Type 분포 (추정)

- **L1 기본**: istio-part1~4 (4편), istio-intro-part1~3 (3편) = 7편
- **L2 심화**: istio-ambient (7), istio-traffic (5), istio-security (4), istio-observability (4) = 20편
- **L3 실무통합**: goti- 접두 (7편)

## 🔴 핵심 관찰: istio-part* 시리즈 전면 중복

`istio-part*` 4편이 `istio-intro-part*` 3편과 동일 주제(서비스 메시 입문·아키텍처·게이트웨이·트래픽)를 다룹니다. 본인이 이미 각 글 상단에 다음 경고를 넣은 상태입니다

> "⚠️ 이 글은 초기 학습 기록입니다. 더 체계적인 내용은 istio-intro 시리즈를 참고하세요. 이 시리즈는 학습 과정의 기록으로 남겨둡니다."

**즉 본인이 이미 중복임을 인지하고 있으며, "학습 과정 보존"을 이유로 삭제하지 않은 상태**

### 권장 결정

| slug | 현재 date | 권장 | 근거 |
|------|-----------|------|------|
| istio-part1-concept-and-comparison | 2025-10-23 | **삭제** 또는 **병합(intro-part1에 흡수)** | istio-intro-part1-why-service-mesh와 동일 주제, 본인이 체계적 재작성본 명시 |
| istio-part2-architecture | 2025-10-23 | **삭제** 또는 **병합(intro-part2에 흡수)** | istio-intro-part2-architecture와 태그 0.86 겹침 |
| istio-part3-gateway-jwt | 2025-10-24 | **삭제** 또는 리라이트 후 1편으로 유지 | JWT는 istio-security-part4-jwt가 더 상세 |
| istio-part4-traffic-control | 2025-10-25 | **삭제** | istio-traffic 시리즈 5편이 더 상세 |

**병합 vs 삭제 판단 포인트**: "학습 과정의 기록"이라는 독자적 가치가 있다고 판단하면 유지하되, `/blog?filter=초기기록` 같은 탭으로 분리하거나 시리즈 명을 `istio-learning-log`로 리네이밍하는 대안도 가능합니다. Phase 2에서 사용자 결정 필요

## 리라이트 후보

서사 결여 의심 (narrThin):
- `istio-intro-part1-why-service-mesh` (narr 7, ctx 11) — 기본 글이라 서사 요구 낮출 수 있음. L1-C로 재분류 시 유지

## 기타 관찰

- istio-ambient 7편, istio-traffic 5편, istio-security 4편, istio-observability 4편은 L2 심화로 각각 완결성 있음. **유지 권장**
- goti- 접두의 istio 글 (7편)은 L3 실무통합. Phase 2에서 서사 3요소 개별 점검

## 날짜 이동 후보 (2월)

- `istio-part*`를 유지한다면 이동 논외 (2025-10)
- goti-auth 시리즈 L3 글들 (order=1인 `goti-jwks-distribution-automation-adr` 2026-04-12) → 2월 이동 검토 가능
