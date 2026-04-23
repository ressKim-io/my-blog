# findings-cicd (13편)

## Level × Type 분포 (추정)

- **L2 심화**: 기존 CI/CD 글 2~3편 (multi-repo-cicd-strategy, github-actions-multi-platform-optimization)
- **L3 실무통합**: goti- 접두 대부분

## 주요 관찰

- `multi-repo-cicd-strategy` (narr 8, ctx 3): B유형인데 서사 10 미만. 리라이트 검토 필요
- 전반적으로 글자수·코드비중 양호
- L3 cicd는 goti-cd-ssm-*, goti-renovate-*, goti-cloudfront-* 등 실전 트러블슈팅 (L3-A)

## 병합/삭제 후보

없음 (뚜렷한 중복 감지 없음)

## 리라이트 후보

| slug | 문제 | 권장 보강 |
|------|------|----------|
| multi-repo-cicd-strategy | 서사 키워드 8개, 컨텍스트 3개. B유형치곤 얕음 | 대안 ABCD 명시(mono vs multi, 중앙화 vs 분산), 우리 프로젝트가 왜 multi-repo를 택했는지 컨텍스트 추가 |

## 날짜 이동 후보 (2월)

| 현재 date | slug | 비고 |
|-----------|------|------|
| 2026-03-06 | goti-cloudfront-swagger-403 | 시리즈 order=1, 초기 CloudFront 설정 |
| 2026-03-18 | goti-renovate-ecr-auth-failure | 독립 글, 초기 Renovate 도입 단계 |

## 결론

cicd는 **1편 리라이트 + 2편 이동** 권장. 그 외는 유지
