# findings-kubernetes (43편)

## Level × Type 분포 (추정)

- **L1 기본**: k8s-pod-flow-part1 (1편)
- **L2 심화**: eks-troubleshooting (4), pod-service-troubleshooting, wsl2-k3s-troubleshooting 등
- **L3 실무통합**: goti- 접두 35+편

## 월별 분포

- 2025-10/12: 6편 / 2026-01: 2 / 2026-03: 11 / **2026-04: 24 (집중)**

## 🔴 핵심 관찰: 4월 1일 하루에 4편 작성

| 2026-04-01 | len | slug |
|------------|-----|------|
| - | 5890 | goti-observer-db-auth-failure-readonly-user |
| - | 3732 | goti-payment-token-encryptor-32byte |
| - | 15220 | goti-redis-serialization-classcastexception |
| - | 12967 | goti-ssm-manual-config-troubleshooting |

실제 같은 날 여러 버그를 잡은 기록이면 자연스럽지만, 월별 분포 관점에선 **2월 이동 후보**로 강력함

## 리라이트 후보

없음 (B 유형 중 서사/컨텍스트 결여 의심 감지 안 됨)

## 저가치 의심

| slug | len | 판정 |
|------|-----|------|
| goti-k8s-skill-review-improvement | 3489 | goti-meta 시리즈에 속함 — challenge findings에서 병합 처리됨 |
| goti-kubectl-toleration-imagepullbackoff | 3282 | 단순 트러블슈팅 L3-A. 3000자 넘으므로 유지 가능 |
| goti-virtualservice-fqdn-503 | 3500 미만 | 단순 트러블슈팅. 유지 |
| wsl2-k3s-troubleshooting | 4047, 코드 64% | L2 로컬 트러블슈팅. 설명 비중 낮음 → **리라이트(설명 보강) 권장** 또는 삭제 |

## 2월 이동 후보 (대량)

4월 1일 4편 + 독립 글 중심으로:

| 현재 date | slug | 이동 근거 |
|-----------|------|----------|
| 2026-04-01 | goti-observer-db-auth-failure-readonly-user | 4/1 집중 분산 |
| 2026-04-01 | goti-payment-token-encryptor-32byte | 4/1 집중 분산 |
| 2026-04-01 | goti-ssm-manual-config-troubleshooting | 4/1 집중 분산 |
| 2026-03-14 | goti-adr-istio-service-mesh | ADR, 초기 설계 단계 → 2월 상순 적합 |
| 2026-03-20 | goti-kind-db-connection-false-negative | 독립 L3-A |
| 2026-03-22 | goti-kubectl-toleration-imagepullbackoff | 독립 L3-A |
| 2026-04-04 | goti-gcp-terraform-cross-cloud-review | ADR성, 초기 멀티클라우드 검토 |

**주의**: goti-multicloud, goti-multicloud-db, goti-scaling, goti-cloudflare-migration 시리즈는 연속성 보존을 위해 내부 order 유지하고 전체 시리즈 시작일만 앞당기는 방식 권장

## 결론

- **리라이트 1편**: wsl2-k3s-troubleshooting (또는 삭제)
- **2월 이동 7~10편**: 4월 1일 집중 + ADR 초기 글
