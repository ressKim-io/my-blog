# Draw.io MCP 템플릿 가이드

> 다이어그램 유형별 구조와 예시

---

## 목적

자주 사용하는 다이어그램 유형의 표준 구조 제공

---

## 1. 클러스터 아키텍처

**구조**: Cluster → Node Group → Node → Pods

**계층**:
```
eks-cluster (외곽, 점선, strokeColor=#ED7100)
├── control-plane (fillColor=#F5F5F5)
├── node-group (aws4.group_auto_scaling_group)
│   ├── node1
│   │   └── node1-pods (Pod 목록)
│   └── node2
└── AZ 라벨 (fontColor=#147EBA)
```

**핵심 스타일**:
- 클러스터 외곽: `strokeColor=#ED7100;dashed=1;`
- Control Plane: `fillColor=#F5F5F5;strokeColor=#666666;`
- Node Group: `grIcon=mxgraph.aws4.group_auto_scaling_group;`

---

## 2. AWS 전체 아키텍처

**구조**: Users → Route53 → CloudFront → VPC → EKS → RDS/Redis

**계층**:
```
aws-cloud (group_aws_cloud)
├── Route53, CloudFront (외부)
├── vpc (group_vpc, strokeColor=#248814)
│   ├── public-subnet (group_public_subnet)
│   │   └── NAT Gateway, NLB
│   ├── private-subnet (group_private_subnet)
│   │   ├── eks-sg (group_security_group, dashed)
│   │   │   └── EKS, 서비스들
│   │   └── rds-sg
│   │       └── RDS, ElastiCache
└── 흐름 번호 (flow-1, flow-2...)
```

**포트 뱃지 스타일**:
```
rounded=1;fillColor=#FFFFFF;strokeColor=#DD3522;fontColor=#DD3522;fontSize=12;fontStyle=1;
```

---

## 3. 서비스 의존성

**구조**: 단순 서비스 박스 + 연결선

**서비스별 색상**:
| 서비스 타입 | fillColor |
|------------|-----------|
| auth (Spring) | `#1E4D8C` |
| Go 서비스 | `#326CE5` |
| ops/유틸 | `#666666` |

**예시 구조**:
```
svc-auth ──→ svc-user
    │
    └──→ svc-board ──→ svc-comment
```

**연결선**: `strokeColor=#FF6B6B;strokeWidth=2;`

---

## 4. 문제 진단 (Before/After)

**파일 분리**: 문제 상황과 해결책을 별도 파일로

```
eso_argocd_circular_dependency.drawio  (Before)
eso_argocd_solution.drawio             (After)
```

**Before 다이어그램 요소**:
- 문제 노드: `fillColor=#FF6B6B;` (NOT FOUND)
- 순환 화살표: `shape=flexArrow;fillColor=#FF4444;opacity=30;`
- 문제 배지: `fillColor=#FF4444;` ("순환 의존성 발생!")

**After 다이어그램 요소**:
- 해결 노드: `fillColor=#4CAF50;` (SUCCESS)
- 정상 흐름: `strokeColor=#4CAF50;`

**라벨 예시**:
- `label-needs`, `label-deploys`, `label-creates`, `label-processes`

---

## 5. 마이크로서비스 상세

**구조**: 서비스 내부 컴포넌트 표현

```
svc-user (외곽 박스)
├── API Layer
├── Service Layer
├── Repository Layer
└── External Connections (DB, Cache, MQ)
```

**내부 레이어 스타일**:
```
rounded=1;fillColor=#E3F2FD;strokeColor=#1976D2;
```

---

## 기존 다이어그램 위치

```
docs/images/
├── wealist_k8s_cluster.drawio       # EKS 클러스터
├── wealist_k8s_workloads.drawio     # K8s 워크로드
├── wealist_aws_arch_v2.drawio       # AWS 전체 (트래픽)
├── wealist_aws_dev_arch.drawio      # AWS 개발 환경
├── wealist_vpc_security_aws.drawio  # VPC Security Group
├── wealist_vpc_traffic_aws.drawio   # VPC 트래픽 흐름
├── wealist_service_dependency.drawio # 서비스 의존성
├── wealist_microservices.drawio     # 마이크로서비스 상세
├── eso_argocd_circular_dependency.drawio  # 문제 상황
└── eso_argocd_solution.drawio       # 해결책
```

---

## 빠른 시작 예시

### 서비스 의존성 다이어그램

```
1. new_diagram
   - path: docs/images/my_service_dep.drawio
   - width: 1400, height: 900

2. add_nodes (서비스 박스들)
   - svc-auth (x:100, y:200)
   - svc-user (x:300, y:200)
   - svc-board (x:500, y:200)

3. link_nodes
   - svc-auth → svc-user
   - svc-board → svc-user
```

### AWS 아키텍처 다이어그램

```
1. new_diagram (1600x1200)

2. add_nodes (순서 중요!)
   - aws-cloud (그룹)
   - vpc (그룹)
   - public-subnet, private-subnet (그룹)
   - eks-sg (Security Group)
   - eks, rds, elasticache (아이콘)
   - 서비스 박스들

3. link_nodes (흐름 순서대로)
```

---

*버전: 1.0 | 최종 수정: 2026-01-09*
