---
title: "Claude vs Gemini 리뷰 비교 — go-ti K8s PR #176 (9건 vs 4건)"
excerpt: "queue-gate K8s 배포 + values 계층화 PR에서 Claude 3관점 병렬 리뷰는 9건(Blocker 2·Critical 2·Major 3·Minor 2)을, Gemini는 4건을 발견했습니다. Claude만 발견한 5건이 전부 아키텍처 일관성과 Multi-Cloud 맥락 이슈였습니다."
category: challenge
tags:
  - go-ti
  - Meta
  - Claude
  - Gemini
  - Code-Review
  - Kubernetes
series:
  name: "goti-meta"
  order: 7
date: "2026-04-06"
---

## 한 줄 요약

> 같은 K8s PR(#176, queue-gate 배포 + values 계층화)을 Claude 3관점 병렬 리뷰와 Gemini Code Assist가 동시에 리뷰했습니다. Claude는 9건(Blocker 2·Critical 2·Major 3·Minor 2), Gemini는 4건(Critical 2·High 1·Medium 1)을 발견했습니다. 공통 3건을 제외하면 Claude만 발견한 5건이 전부 아키텍처 일관성과 Multi-Cloud 맥락 이슈였습니다

---

## 🔥 대상: queue-gate K8s 배포 + values 계층화 PR

- **PR**: Team-Ikujo/Goti-k8s#176
- **내용**: queue-gate 서비스의 K8s 배포 추가 + values 계층화
- **Claude**: Helm / 보안 / 운영 3관점 병렬 리뷰 (`/review-pr:k8s`)
- **Gemini**: code-assist bot inline 리뷰 (자동)

---

## 🤔 발견 건 비교표

| 이슈 | Claude | Gemini | 판정 |
|------|--------|--------|------|
| prod `latest` tag | Blocker (conf:100) | Critical | 일치 |
| base values AWS 종속 (계층화 불일치) | Blocker (conf:95) | 미언급 | Claude만 발견 |
| prod-gcp ApplicationSet 누락 | Critical (conf:90) | 미언급 | Claude만 발견 |
| authorizationPolicy 비활성화 | Critical (conf:82) | 미언급 | Claude만 발견 |
| replicaCount 1 (prod) | Major (conf:75) | 미언급 | Claude만 발견 |
| serviceMonitor.release 누락 | Major (conf:85) | 미언급 | Claude만 발견 |
| WHY 주석 삭제 | Major (conf:80) | 미언급 | Claude만 발견 |
| dev Redis IP 하드코딩 | Minor (conf:72) | High | 일치 (Gemini 과잉) |
| POC cloudValuesFile 중복 | Minor | Medium | 일치 |

### 정량 요약

- Claude: 9건 (Blocker 2, Critical 2, Major 3, Minor 2)
- Gemini: 4건 (Critical 2, High 1, Medium 1)
- **Claude만 발견**: 5건 (계층화 불일치, GCP 누락, 보안, replica, 주석)
- **공통**: 3건 (latest tag, Redis 하드코딩, POC 중복)
- **Gemini만 발견**: 0건

---

## ✅ 각 도구의 강점 분석

### Claude 강점

**1. 아키텍처 패턴 일관성**

다른 5개 MSA는 values 계층화를 했는데 queue-gate만 하지 않은 불일치를 정확히 짚어냈습니다
Gemini는 개별 파일만 보고 "전체 레포 패턴"을 비교하지 못했습니다

**2. Multi-Cloud 관점**

`prod-gcp` ApplicationSet 누락을 발견했습니다
Gemini는 AWS 파일만 리뷰했고 GCP 쪽은 범위에 들어오지 않았습니다

**3. 보안 정책 맥락**

`authorizationPolicy`가 다른 서비스는 전부 enabled인데 queue-gate만 disabled인 불일치를 감지했습니다
"이 서비스는 보안 비활성"이 아니라 "전체 패턴에서 혼자 빠져 있음"으로 상위 레벨 경고를 냈습니다

**4. 운영 관점**

`replicaCount: 1`의 SPOF 위험, `serviceMonitor` selector 누락 등 실제 배포 시 문제가 될 이슈를 선제 발견했습니다

### Gemini 강점

- **Inline 코드 제안**: 수정 코드 블록을 직접 제공해 즉시 적용 가능합니다
- **빠른 실행**: PR 생성 즉시 자동 리뷰가 붙습니다

### Gemini 오탐 사례

dev Redis IP(`172.20.0.1`)를 K8s Service DNS로 변경 제안했습니다
하지만 Kind 호스트 PC의 Redis를 Pod에서 참조하는 구조였기 때문에 DNS 해결이 불가능합니다
환경 맥락(Kind 호스트 네트워크)을 모르는 generic 제안이었습니다

---

## 📚 배운 점

- **레포 전체 패턴 비교는 Claude 쪽이 확실히 강합니다.** 5개 MSA 중 4개가 계층화했는데 1개만 빠진 상황은 개별 파일 정적 분석으로는 잡히지 않습니다. "동종 리소스와의 일관성"을 리뷰 체크 항목으로 명시한 덕이었습니다
- **Multi-Cloud는 별도 관점으로 분리해야 합니다.** AWS 쪽 변경에만 집중하면 GCP ApplicationSet 누락이 보이지 않습니다. `/review-pr:k8s`의 에이전트 하나를 Multi-Cloud 파일 커버리지 전용으로 두면 유효합니다
- **Gemini의 inline 수정은 빠른 피드백 루프에 강합니다.** 환경 맥락이 필요한 이슈에서는 오탐이 섞이므로 맹목 적용은 피하고, Claude의 맥락 검증을 거친 뒤 채택하는 방식이 안전합니다
- **"공통 3건만 신뢰, 나머지는 상호 보완"이 작업 패턴이 됩니다.** 두 도구 모두 잡은 건은 거의 확실한 이슈. 한쪽만 잡은 건은 도구 특성과 PR 맥락을 보고 사람이 최종 판단합니다
