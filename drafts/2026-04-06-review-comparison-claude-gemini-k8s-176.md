# Claude vs Gemini 리뷰 비교 — Goti-k8s PR #176

- **날짜**: 2026-04-06
- **PR**: Team-Ikujo/Goti-k8s#176 (queue-gate K8s 배포 + values 계층화)
- **Claude**: 3관점 병렬 리뷰 (Helm/보안/운영), 9건 발견
- **Gemini**: code-assist bot inline 리뷰, 4건 발견

## 비교표

| 이슈 | Claude | Gemini | 판정 |
|------|--------|--------|------|
| prod latest tag | Blocker (conf:100) | Critical | 일치 |
| base values AWS 종속 (계층화 불일치) | Blocker (conf:95) | 미언급 | Claude만 발견 |
| prod-gcp appset 누락 | Critical (conf:90) | 미언급 | Claude만 발견 |
| authorizationPolicy 비활성화 | Critical (conf:82) | 미언급 | Claude만 발견 |
| replicaCount 1 (prod) | Major (conf:75) | 미언급 | Claude만 발견 |
| serviceMonitor.release 누락 | Major (conf:85) | 미언급 | Claude만 발견 |
| WHY 주석 삭제 | Major (conf:80) | 미언급 | Claude만 발견 |
| dev Redis IP 하드코딩 | Minor (conf:72) | High | 일치 (Gemini 과잉) |
| POC cloudValuesFile 중복 | Minor | Medium | 일치 |

## 분석

### Claude 강점 (Gemini 대비)
- **아키텍처 패턴 일관성**: 5개 MSA가 계층화했는데 queue-gate만 안 한 불일치를 정확히 짚음. Gemini는 개별 파일만 보고 전체 패턴을 비교하지 못함
- **Multi-Cloud 관점**: prod-gcp ApplicationSet 누락을 발견. Gemini는 AWS 파일만 리뷰
- **보안 정책 맥락**: authorizationPolicy가 다른 서비스는 전부 enabled인데 queue-gate만 disabled인 불일치 감지
- **운영 관점**: replicaCount 1의 SPOF 위험, serviceMonitor selector 누락 등 실제 배포 시 문제 될 이슈 선제 발견

### Gemini 강점 (Claude 대비)
- **inline 코드 제안**: 수정 코드 블록을 직접 제공하여 즉시 적용 가능
- **빠른 실행**: PR 생성 즉시 자동 리뷰

### Gemini 오탐
- dev Redis IP를 K8s Service DNS로 변경 제안 → Kind 호스트 PC Redis(`172.20.0.1`)라서 DNS 해결 불가. 환경 맥락을 모르는 generic한 제안

### 정량 비교
- Claude: 9건 (Blocker 2, Critical 2, Major 3, Minor 2)
- Gemini: 4건 (Critical 2, High 1, Medium 1)
- **Claude만 발견한 이슈**: 5건 (계층화 불일치, GCP 누락, 보안, replica, 주석)
- **공통**: 3건 (latest tag, Redis 하드코딩, POC 중복)
- **Gemini만 발견**: 0건

## 결론

K8s 리뷰에서 Claude의 3관점 병렬 리뷰가 Gemini 대비 더 깊은 아키텍처/보안/운영 이슈를 발견함.
Gemini는 파일 단위 정적 분석에 강하지만, 레포 전체의 패턴 일관성이나 Multi-Cloud 맥락을 놓침.
