# findings-argocd (9편)

## Level × Type 분포 (추정)

- **L2 심화**: argocd-troubleshooting 5편 + eks-troubleshooting-part8 1편 = 6편
- **L3 실무통합**: goti-argocd-gitops 2편 + goti-container-image-update-strategy-adr 1편 = 3편

## 주요 관찰

- 전반적으로 글자수·서사 키워드 양호
- ADR 글 `goti-container-image-update-strategy-adr` (len 13417, narr 45, ctx 31, ADR=Y) — L3-B의 모범. 프로젝트 맥락 why 탄탄함
- argocd-troubleshooting 시리즈 5편은 전형적 L2-A (트러블슈팅). 현재 구조 유지 OK

## 병합/삭제 후보

없음. 9편 모두 고유 주제

## 리라이트 후보

없음 (서사·컨텍스트 결여 의심 글 없음)

## 날짜 이동 후보 (2월)

| 현재 date | slug | 비고 |
|-----------|------|------|
| 2026-03-11 | goti-ecr-secret-dollar-escape | 시리즈 order=1, 초기 GitOps 설정 → 2월 초 자연스러움 |
| 2026-03-12 | goti-image-updater-multisource | order=2. 위와 연결 |

argocd-troubleshooting 시리즈는 2026-01~03에 분산 → 추가 이동 불필요

## 결론

argocd 카테고리는 **건강한 상태**. 9편 유지 + 2편 2월 이동만 제안
