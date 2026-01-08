# 블로그 글 목록

> 마지막 업데이트: 2026-01-08
> 총 62개 글

## 전체 글 (최신순)

| 날짜 | 제목 | 시리즈 | 요약 |
|------|------|--------|------|
| 2026-01-06 | ops-portal 메트릭이 모두 0인 이유: Prometheus Route Prefix | observability #2 | Prometheus --web.route-prefix와 ArgoCD 토큰 설정 |
| 2026-01-05 | 트레이스에서 메트릭 자동 생성: OpenTelemetry Connectors | observability #1 | spanmetrics, servicegraph connector 활용 |
| 2026-01-05 | Multi-Pod 환경에서 JWT 인증이 50% 확률로 실패한다면 | eks-security #1 | Pod 스케일링 시 RSA 키 불일치 문제 |
| 2026-01-05 | Istio Ambient에서 Sidecar로 돌아온 이유 | istio-ambient #7 | 카나리 배포, Circuit Breaker 필요로 전환 |
| 2026-01-05 | GitOps의 Bootstrap 문제: ArgoCD가 자기 의존성을 배포할 수 없다 | argocd-troubleshooting #2 | ESO와 ArgoCD 순환 의존성을 Terraform으로 해결 |
| 2026-01-02 | WebSocket 재연결 시 토큰 갱신 안 되는 이유 | eks-security #2 | WebSocket은 Axios 인터셉터 미적용 |
| 2026-01-02 | Storage 페이지가 HTML을 반환한다: 3층 원인 분석 | eks-infra #1 | CloudFront S3 Fallback, HTTPRoute Rewrite 문제 |
| 2026-01-02 | CI 빌드 시간을 15분에서 3분으로: QEMU 에뮬레이션 제거 | - | TARGETARCH로 arm64 빌드 최적화 |
| 2026-01-02 | ArgoCD가 9시간 동안 멈춘 이유: App of Apps 순환 참조 | argocd-troubleshooting #1 | root-app.yaml 자기 감시로 인한 deadlock |
| 2025-12-31 | Go 의존성 지옥: genproto ambiguous import 해결 | - | grpc-gateway v1/v2 충돌 해결 |
| 2025-12-31 | Go 마이크로서비스 EKS 배포 삽질기 | eks-troubleshooting #7 | OAuth2, genproto 충돌, OTel Schema 문제 |
| 2025-12-31 | EKS 모니터링 구축기 (2): S3로 전환하기 | eks-troubleshooting #6 | PVC→S3 전환, Pod Identity 설정 |
| 2025-12-31 | ArgoCD + Helm 실전 문제들 | eks-troubleshooting #8 | Synced인데 적용 안 됨, OutOfSync 무한 루프 |
| 2025-12-30 | External Secrets Operator의 함정들 | eks-troubleshooting #4 | apiVersion부터 ArgoCD OutOfSync까지 |
| 2025-12-30 | EKS 모니터링 구축기 (1): Prometheus가 안 뜬다 | eks-troubleshooting #5 | 이미지, 스토리지, 권한 문제 해결 |
| 2025-12-29 | Istio Ambient 모드 실전기 (2): HTTPS 붙이기까지 3번의 삽질 | eks-troubleshooting #3 | Gateway API, NLB + ACM 설정 |
| 2025-12-29 | Istio Ambient 모드 실전기 (1): Gateway가 없다 | eks-troubleshooting #2 | Ingress Gateway 누락, 메트릭 수집 실패 |
| 2025-12-27 | EKS 첫 배포 D-Day: 4개의 장애가 동시에 터졌다 | eks-troubleshooting #1 | Redis 연결, ALB 미설치 등 동시 장애 해결 |
| 2025-12-26 | Service Mesh 비교: Istio vs Linkerd vs Cilium | - | 3대장 철학, 아키텍처, 리소스 비교 |
| 2025-12-25 | Istio Ambient Part 6: EnvoyFilter 없이 Rate Limiting 구현하기 | istio-ambient #6 | Redis 기반 애플리케이션 레벨 Rate Limiting |
| 2025-12-25 | Istio Ambient Part 5: JWT 인증 구현과 HS512→RSA 전환기 | istio-ambient #5 | Ambient에서 JWT 인증, HS512→RSA 전환 |
| 2025-12-24 | WSL2에서 k3s가 계속 재시작? | - | WSL2에서는 k3d 사용 권장 |
| 2025-12-24 | Istio Ambient Part 4: Wealist를 Ambient로 마이그레이션하기 | istio-ambient #4 | Sidecar→Ambient 전환 과정과 주의사항 |
| 2025-12-24 | Istio Ambient Part 3: Sidecar vs Ambient 기능 비교 | istio-ambient #3 | Istio 1.24 GA 기준 기능 비교, 제한사항 |
| 2025-12-23 | Istio Ambient Part 2: L4/L7 분리와 Sidecar 아키텍처 비교 | istio-ambient #2 | ztunnel과 waypoint 역할, HBONE 프로토콜 |
| 2025-12-22 | Istio Ambient Part 1: Sidecar 없는 Service Mesh | istio-ambient #1 | ztunnel과 waypoint로 80-90% 리소스 절감 |
| 2025-12-21 | Istio Observability Part 4: Kiali로 Service Mesh 시각화하기 | istio-observability #4 | 서비스 토폴로지 시각화, 설정 검증 |
| 2025-12-20 | Istio Observability Part 3: Envoy Access Log로 문제 진단하기 | istio-observability #3 | Response Flags 이해와 문제 진단 |
| 2025-12-19 | Istio Observability Part 2: 분산 트레이싱으로 요청 흐름 추적하기 | istio-observability #2 | Jaeger, 헤더 전파의 중요성 |
| 2025-12-18 | Istio Observability Part 1: 코드 수정 없이 메트릭 수집하기 | istio-observability #1 | 자동 메트릭 수집, Prometheus/Grafana 연동 |
| 2025-12-17 | Istio Traffic Part 5: Traffic Mirroring으로 안전하게 테스트하기 | istio-traffic #5 | 실제 트래픽 복제로 Shadow Testing |
| 2025-12-16 | Istio Traffic Part 4: Retry와 Timeout으로 복원력 높이기 | istio-traffic #4 | VirtualService retry/timeout 설정 |
| 2025-12-15 | Istio Traffic Part 3: Circuit Breaker로 장애 격리하기 | istio-traffic #3 | outlierDetection, connectionPool 설정 |
| 2025-12-14 | Istio Traffic Part 2: Canary 배포와 A/B Testing 완전 가이드 | istio-traffic #2 | VirtualService weight와 match 활용 |
| 2025-12-13 | Istio Traffic Part 1: 트래픽 관리 4대 리소스 총정리 | istio-traffic #1 | Gateway, VirtualService, DestinationRule, ServiceEntry |
| 2025-12-12 | Istio Security Part 4: JWT 인증으로 API 보호하기 | istio-security #4 | RequestAuthentication + AuthorizationPolicy |
| 2025-12-11 | AuthorizationPolicy 완전 정복 | istio-security #3 | from/to/when 조건, ALLOW vs DENY 평가 순서 |
| 2025-12-10 | SPIFFE로 이해하는 서비스 신원(Identity) | istio-security #2 | SPIFFE ID 구조, 인증서 발급/갱신 과정 |
| 2025-12-09 | Zero Trust 보안, Istio mTLS로 구현하기 | istio-security #1 | 경계 보안 한계, PeerAuthentication 모드 |
| 2025-12-08 | Kubernetes Service vs Istio: 뭐가 다른가? | istio-intro #3 | kube-proxy 한계, L4 vs L7 로드밸런싱 |
| 2025-12-07 | Istio 아키텍처 완전 정복 | istio-intro #2 | Control/Data Plane, Sidecar 트래픽 가로채기 |
| 2025-12-06 | Service Mesh가 필요한 이유 | istio-intro #1 | Spring Cloud vs Istio 인프라 방식 차이 |
| 2025-11-15 | Docker Compose 환경변수 대통합 | - | 멀티 서비스 .env 파일 정리 |
| 2025-10-26 | 여러 레포지토리를 한 서버에 배포하기 | - | 중앙 배포 레포지토리 패턴, GitOps |
| 2025-10-23 | Service Mesh 완벽 이해 Part 4 - 트래픽 제어의 마법 | istio #4 | VirtualService, DestinationRule 활용 |
| 2025-10-23 | Service Mesh 완벽 이해 Part 3 - Gateway와 JWT 인증의 진짜 장점 | istio #3 | Gateway에서 JWT 검증하는 이유 |
| 2025-10-23 | Service Mesh 완벽 이해 Part 2 - 아키텍처와 동작 원리 | istio #2 | Control/Data Plane, Pod 간 요청 경로 |
| 2025-10-23 | Service Mesh 완벽 이해 Part 1 - Kong과 뭐가 다를까? | istio #1 | Kong API Gateway와 비교, 선택 기준 |
| 2025-10-20 | 팀 프로젝트 K8s 마이그레이션 Part 5: 트러블슈팅 & Helm | wealist-migration #5 | 5가지 에러 해결, Helm 도입 |
| 2025-10-20 | 팀 프로젝트 K8s 마이그레이션 Part 4: 프론트엔드 & Ingress | wealist-migration #4 | nginx로 React 서빙, 라우팅 설정 |
| 2025-10-20 | 팀 프로젝트 K8s 마이그레이션 Part 3: 백엔드 배포 & Secret | wealist-migration #3 | 로컬 이미지, OOMKilled 해결 |
| 2025-10-20 | 팀 프로젝트 K8s 마이그레이션 Part 2: PostgreSQL StatefulSet | wealist-migration #2 | DB에 StatefulSet이 필요한 이유 |
| 2025-10-20 | 팀 프로젝트 K8s 마이그레이션 Part 1: 프로젝트 분석 & 전략 | wealist-migration #1 | Docker Compose → K8s 전환 계획 |
| 2025-10-17 | 게임 서버 K8s 배포 Part 7: Ingress | game-server #7 | 여러 서비스 URL 통합 |
| 2025-10-17 | 게임 서버 K8s 배포 Part 6: HPA | game-server #6 | 부하 기반 자동 스케일링 |
| 2025-10-17 | 게임 서버 K8s 배포 Part 5: 나머지 서비스 | game-server #5 | 게임 룸, 채팅, 랭킹 배포 |
| 2025-10-17 | 게임 서버 K8s 배포 Part 4: Service | game-server #4 | Pod 간 통신, 외부 통신 |
| 2025-10-17 | 게임 서버 K8s 배포 Part 3: Deployment | game-server #3 | 게임 로비 서비스 배포 |
| 2025-10-17 | 게임 서버 K8s 배포 Part 2: Namespace & ConfigMap | game-server #2 | 서비스별 설정 관리 |
| 2025-10-17 | 게임 서버 K8s 배포 Part 1: k3s → k3d | game-server #1 | WSL2에서 k3d 선택 이유 |
| 2025-10-14 | Pod는 Running인데 왜 접근이 안 돼? K8s Service 트러블슈팅 | - | Service 트러블슈팅 가이드 |
| 2025-10-13 | Pod 생성 플로우 완벽 가이드 Part 1 | - | kubectl → Pod Running까지 전체 흐름 |

---

## 시리즈별 보기

### EKS Troubleshooting (8편)
EKS 프로덕션 배포 시 발생한 문제 해결 기록

| # | 제목 | 날짜 |
|---|------|------|
| 1 | EKS 첫 배포 D-Day: 4개의 장애가 동시에 터졌다 | 2025-12-27 |
| 2 | Istio Ambient 모드 실전기 (1): Gateway가 없다 | 2025-12-29 |
| 3 | Istio Ambient 모드 실전기 (2): HTTPS 붙이기까지 3번의 삽질 | 2025-12-29 |
| 4 | External Secrets Operator의 함정들 | 2025-12-30 |
| 5 | EKS 모니터링 구축기 (1): Prometheus가 안 뜬다 | 2025-12-30 |
| 6 | EKS 모니터링 구축기 (2): S3로 전환하기 | 2025-12-31 |
| 7 | Go 마이크로서비스 EKS 배포 삽질기 | 2025-12-31 |
| 8 | ArgoCD + Helm 실전 문제들 | 2025-12-31 |

### ArgoCD Troubleshooting (2편)
GitOps 환경에서 발생하는 ArgoCD 문제 해결

| # | 제목 | 날짜 |
|---|------|------|
| 1 | ArgoCD가 9시간 동안 멈춘 이유: App of Apps 순환 참조 | 2026-01-02 |
| 2 | GitOps의 Bootstrap 문제: ArgoCD가 자기 의존성을 배포할 수 없다 | 2026-01-05 |

### EKS Security (2편)
EKS 환경에서의 보안 문제 해결

| # | 제목 | 날짜 |
|---|------|------|
| 1 | Multi-Pod 환경에서 JWT 인증이 50% 확률로 실패한다면 | 2026-01-05 |
| 2 | WebSocket 재연결 시 토큰 갱신 안 되는 이유 | 2026-01-02 |

### Istio Ambient (7편)
Sidecar 없는 Service Mesh, Istio Ambient Mode

| # | 제목 | 날짜 |
|---|------|------|
| 1 | Sidecar 없는 Service Mesh | 2025-12-22 |
| 2 | L4/L7 분리와 Sidecar 아키텍처 비교 | 2025-12-23 |
| 3 | Sidecar vs Ambient 기능 비교 (2024.12 기준) | 2025-12-24 |
| 4 | Wealist를 Ambient로 마이그레이션하기 | 2025-12-24 |
| 5 | JWT 인증 구현과 HS512→RSA 전환기 | 2025-12-25 |
| 6 | EnvoyFilter 없이 Rate Limiting 구현하기 | 2025-12-25 |
| 7 | Ambient에서 Sidecar로 돌아온 이유 | 2026-01-05 |

### Istio Introduction (3편)
Istio 입문자를 위한 기초 개념

| # | 제목 | 날짜 |
|---|------|------|
| 1 | Service Mesh가 필요한 이유 | 2025-12-06 |
| 2 | Istio 아키텍처 완전 정복 | 2025-12-07 |
| 3 | Kubernetes Service vs Istio: 뭐가 다른가? | 2025-12-08 |

### Istio Security (4편)
Istio를 활용한 보안 구현

| # | 제목 | 날짜 |
|---|------|------|
| 1 | Zero Trust 보안, Istio mTLS로 구현하기 | 2025-12-09 |
| 2 | SPIFFE로 이해하는 서비스 신원(Identity) | 2025-12-10 |
| 3 | AuthorizationPolicy 완전 정복 | 2025-12-11 |
| 4 | JWT 인증으로 API 보호하기 | 2025-12-12 |

### Istio Traffic (5편)
Istio 트래픽 관리 심화

| # | 제목 | 날짜 |
|---|------|------|
| 1 | 트래픽 관리 4대 리소스 총정리 | 2025-12-13 |
| 2 | Canary 배포와 A/B Testing 완전 가이드 | 2025-12-14 |
| 3 | Circuit Breaker로 장애 격리하기 | 2025-12-15 |
| 4 | Retry와 Timeout으로 복원력 높이기 | 2025-12-16 |
| 5 | Traffic Mirroring으로 안전하게 테스트하기 | 2025-12-17 |

### Istio Observability (4편)
Istio 관측성 구현

| # | 제목 | 날짜 |
|---|------|------|
| 1 | 코드 수정 없이 메트릭 수집하기 | 2025-12-18 |
| 2 | 분산 트레이싱으로 요청 흐름 추적하기 | 2025-12-19 |
| 3 | Envoy Access Log로 문제 진단하기 | 2025-12-20 |
| 4 | Kiali로 Service Mesh 시각화하기 | 2025-12-21 |

### Istio 완벽 이해 (4편)
Istio 전반 개념 정리 (초기 시리즈)

| # | 제목 | 날짜 |
|---|------|------|
| 1 | Kong과 뭐가 다를까? | 2025-10-23 |
| 2 | 아키텍처와 동작 원리 | 2025-10-23 |
| 3 | Gateway와 JWT 인증의 진짜 장점 | 2025-10-23 |
| 4 | 트래픽 제어의 마법 | 2025-10-23 |

### Observability (2편)
모니터링 및 관측성

| # | 제목 | 날짜 |
|---|------|------|
| 1 | 트레이스에서 메트릭 자동 생성: OpenTelemetry Connectors | 2026-01-05 |
| 2 | ops-portal 메트릭이 모두 0인 이유 | 2026-01-06 |

### Game Server 배포 (7편)
부트캠프 챌린지 - 게임 서버 K8s 배포

| # | 제목 | 날짜 |
|---|------|------|
| 1 | k3s → k3d | 2025-10-17 |
| 2 | Namespace & ConfigMap | 2025-10-17 |
| 3 | Deployment | 2025-10-17 |
| 4 | Service | 2025-10-17 |
| 5 | 나머지 서비스 | 2025-10-17 |
| 6 | HPA | 2025-10-17 |
| 7 | Ingress | 2025-10-17 |

### Wealist 마이그레이션 (5편)
부트캠프 챌린지 - 팀 프로젝트 K8s 마이그레이션

| # | 제목 | 날짜 |
|---|------|------|
| 1 | 프로젝트 분석 & 전략 | 2025-10-20 |
| 2 | PostgreSQL StatefulSet | 2025-10-20 |
| 3 | 백엔드 배포 & Secret 관리 | 2025-10-20 |
| 4 | 프론트엔드 & Ingress | 2025-10-20 |
| 5 | 트러블슈팅 & Helm | 2025-10-20 |

---

## 통계

| 항목 | 수 |
|------|-----|
| 총 글 수 | 62 |
| 시리즈 수 | 12 |
| 단독 글 | 8 |
