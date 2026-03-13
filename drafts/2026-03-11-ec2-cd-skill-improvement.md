# EC2 CD 파이프라인 스킬 보강

- **날짜**: 2026-03-11
- **유형**: meta (AI 워크플로우 개선)
- **범위**: EC2 기반 CD 파이프라인, CloudFront, ALB, Docker 환경변수

---

## 배경

K8s 스킬 개선 후 EC2 CD 파이프라인 영역 점검. dev 서버 계속 운영하므로 기록 필요.
기존 CI/CD 스킬이 ArgoCD/GitOps 중심 → GitHub Actions + SSM + ALB + CloudFront 패턴 부재.

## 분석한 데이터 소스

| 소스 | 파일 | 핵심 |
|------|------|------|
| 트러블슈팅 | `cd-ssm-waiter-timeout` | `aws ssm wait` 기본 100초 → polling 루프 교체 |
| 트러블슈팅 | `cloudfront-swagger-403` | CloudFront behavior 누락 → S3 폴백 403 |
| 트러블슈팅 | `jwt-social-verify-time` | Docker env 기본값 누락 → Spring Boot Duration 파싱 실패 |
| 트러블슈팅 | `dev-monitoring-502` | ALB healthcheck 경로 + Docker 포트 바인딩 (이전 개선에서 docker.md 반영 완료) |

## 수정 파일 상세

| 파일 | 작업 | 내용 |
|------|------|------|
| `docker.md` | 수정 | 환경변수 `${VAR:-default}` 필수 패턴, docker-compose ↔ application.yml 3곳 동기화 |
| `ec2-cd-pipeline.md` | **신규** | SSM polling 패턴, CloudFront behavior, ALB healthcheck, CD 검증 체크리스트 |

## 트러블 → 스킬 반영 매핑

| 트러블 | 스킬 반영 |
|--------|----------|
| SSM waiter 100초 타임아웃 | `ec2-cd-pipeline.md` SSM polling 섹션 |
| CloudFront Swagger 403 | `ec2-cd-pipeline.md` CloudFront behavior 섹션 |
| JWT env 기본값 누락 | `docker.md` 환경변수 기본값 패턴 섹션 |
| ALB healthcheck 401 | `ec2-cd-pipeline.md` ALB healthcheck 섹션 (+ docker.md 이전 반영) |

## 미반영/TODO

- GitHub Actions workflow 자체의 best practice (matrix, caching 등) → 별도 스킬 필요 시 추가
- SSM Parameter Store 활용 패턴 → 현재 .env 기반, 전환 시 추가
- `hikaricp-otel-beanpostprocessor` → Spring/OTel 영역, 별도 개선 사이클
