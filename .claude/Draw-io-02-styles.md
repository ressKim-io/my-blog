# Draw.io MCP 스타일 가이드

> 색상 체계, 노드/연결선 스타일 정의

---

## 목적

일관된 시각적 스타일로 전문적인 다이어그램 생성

---

## 색상 체계

### AWS 서비스 카테고리별

| 카테고리 | fillColor | gradientColor | 서비스 예시 |
|----------|-----------|---------------|------------|
| **Compute** | `#D05C17` | `#F78E04` | EC2, Lambda, ECS, Batch |
| **Containers** | `#ED7100` | `#F78E04` | EKS, ECR, ECS, Fargate |
| **Database** | `#C925D1` | `#F15BB5` | RDS, Aurora, DynamoDB, ElastiCache |
| **Storage** | `#7AA116` | `#7AA116` | S3, EBS, EFS |
| **Networking** | `#8C4FFF` | `#BF80FF` | Route53, CloudFront, VPC, API Gateway |
| **Security** | `#DD344C` | `#FF5566` | IAM, Cognito, Secrets Manager, WAF |
| **Management** | `#BC1356` | `#FF4F8B` | CloudWatch, Step Functions, Systems Manager |
| **Analytics** | `#8C4FFF` | `#BF80FF` | Athena, Redshift, Kinesis |
| **App Integration** | `#E7157B` | `#FF4F8B` | SQS, SNS, EventBridge |

### Database 서비스

> ⚠️ 2023년부터 Database 아이콘이 Blue → Purple(`#C925D1`)로 변경됨

RDS, Aurora, DynamoDB, ElastiCache 등 모두 `fillColor=#C925D1` 사용

### 그룹/경계 색상

| 용도 | strokeColor | fillColor |
|------|-------------|-----------|
| VPC 경계 | `#248814` | `none` |
| Public Subnet | `#7AA116` | `none` |
| Private Subnet | `#147EBA` | `none` |
| Security Group | `#DD3522` | `none` |
| AWS Cloud | `#232F3E` | `none` |
| Region | `#147EBA` | `none` |

### Kubernetes

| 용도 | HEX |
|------|-----|
| K8s 기본 | `#326CE5` |
| Spring Boot | `#1E4D8C` |
| Istio | `#466BB0` |
| Prometheus | `#E6522C` |
| Grafana | `#F46800` |
| Loki | `#C9A227` |

### 상태 표현

| 상태 | HEX | 용도 |
|------|-----|------|
| 오류 | `#FF4444` | 문제, NOT FOUND |
| 의존성 연결 | `#FF6B6B` | 서비스 간 연결선 |
| 성공 | `#4CAF50` | 생성 완료 |
| 경고 | `#FF9800` | ESO, ExternalSecret |
| 비활성 | `#666666` | ops-service 등 |

---

## 노드 생성 패턴

### 서비스 박스

```json
{"id": "svc-auth", "label": "auth-service\n:8080",
 "style": "rounded=1;fillColor=#1E4D8C;strokeColor=none;fontColor=#FFFFFF;fontSize=14;fontStyle=1;",
 "x": 100, "y": 280, "width": 140, "height": 50}
```

### AWS 아이콘

```json
{"id": "eks", "label": "",
 "style": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.eks;fillColor=#ED7100;strokeColor=#FFFFFF;",
 "x": 170, "y": 525, "width": 55, "height": 55}
```

### 그룹 박스 (VPC)

```json
{"id": "vpc", "label": "VPC (10.0.0.0/16)",
 "style": "shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc;strokeColor=#248814;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontStyle=1;fontColor=#248814;",
 "x": 100, "y": 280, "width": 840, "height": 680}
```

### 텍스트 라벨

```json
{"id": "label-needs", "label": "needs",
 "style": "text;html=1;strokeColor=none;fillColor=none;align=center;fontSize=13;fontColor=#FF4444;fontStyle=1;",
 "x": 465, "y": 230, "width": 50, "height": 20}
```

### 흐름 번호 뱃지

```json
{"id": "flow-1", "label": "1",
 "style": "ellipse;fillColor=#E74C3C;fontColor=#FFFFFF;fontSize=16;fontStyle=1;",
 "x": 50, "y": 100, "width": 30, "height": 30}
```

---

## 연결선 패턴

### 기본 연결선

```json
{"source": "svc-board", "target": "svc-user",
 "style": "edgeStyle=orthogonalEdgeStyle;rounded=0;strokeColor=#FF6B6B;strokeWidth=2;endArrow=classic;"}
```

### 양방향

```json
{"source": "observability", "target": "wealist-ns",
 "style": "edgeStyle=orthogonalEdgeStyle;strokeColor=#E6522C;strokeWidth=1.5;dashed=1;endArrow=classic;startArrow=classic;"}
```

### 점선 (문제 표시)

```json
{"source": "argocd", "target": "argocd-secret",
 "style": "edgeStyle=orthogonalEdgeStyle;strokeColor=#FF4444;strokeWidth=3;dashed=1;endArrow=classic;"}
```

---

## AWS 아이콘

> 상세 목록은 `draw-io-3-icons.md` 참조

### 자주 쓰는 아이콘 (빠른 참조)

| 서비스 | resIcon | fillColor |
|--------|---------|-----------|
| EKS | `mxgraph.aws4.eks` | `#ED7100` |
| RDS | `mxgraph.aws4.rds` | `#C925D1` |
| ElastiCache | `mxgraph.aws4.elasticache` | `#C925D1` |
| S3 | `mxgraph.aws4.s3` | `#7AA116` |
| Route 53 | `mxgraph.aws4.route_53` | `#8C4FFF` |
| CloudFront | `mxgraph.aws4.cloudfront` | `#8C4FFF` |
| Secrets Manager | `mxgraph.aws4.secrets_manager` | `#DD344C` |
| CloudWatch | `mxgraph.aws4.cloudwatch` | `#BC1356` |

---

## AWS 그룹 스타일

| 그룹 | grIcon | strokeColor |
|------|--------|-------------|
| VPC | `mxgraph.aws4.group_vpc` | `#248814` |
| Public Subnet | `mxgraph.aws4.group_public_subnet` | `#7AA116` |
| Private Subnet | `mxgraph.aws4.group_private_subnet` | `#147EBA` |
| Security Group | `mxgraph.aws4.group_security_group` | `#DD3522` |

---

## 추가 노드 타입 (kind)

| kind | 용도 |
|------|------|
| `Rectangle` | 기본 사각형 |
| `RoundedRectangle` | 둥근 모서리 (corner_radius 옵션) |
| `Ellipse` | 원/타원 |
| `Cylinder` | 데이터베이스, 스토리지 |
| `Cloud` | 클라우드 영역 |
| `Actor` | 사용자, 외부 시스템 |

---

*버전: 1.0 | 최종 수정: 2026-01-09*
