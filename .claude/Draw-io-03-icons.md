# Draw.io AWS 아이콘 레퍼런스

> AWS 서비스별 resIcon 및 fillColor 빠른 참조

---

## 목적

AWS 아이콘 생성 시 resIcon과 fillColor 값 빠른 조회

---

## Compute & Containers

| 서비스 | resIcon | fillColor |
|--------|---------|-----------|
| EC2 | `mxgraph.aws4.ec2` | `#D05C17` |
| Lambda | `mxgraph.aws4.lambda` | `#D05C17` |
| ECS | `mxgraph.aws4.ecs` | `#ED7100` |
| EKS | `mxgraph.aws4.eks` | `#ED7100` |
| ECR | `mxgraph.aws4.ecr` | `#ED7100` |
| Fargate | `mxgraph.aws4.fargate` | `#ED7100` |
| Batch | `mxgraph.aws4.batch` | `#D05C17` |

---

## Database & Cache

| 서비스 | resIcon | fillColor |
|--------|---------|-----------|
| RDS | `mxgraph.aws4.rds` | `#C925D1` |
| Aurora | `mxgraph.aws4.aurora` | `#C925D1` |
| DynamoDB | `mxgraph.aws4.dynamodb` | `#C925D1` |
| ElastiCache | `mxgraph.aws4.elasticache` | `#C925D1` |
| ElastiCache for Redis | `mxgraph.aws4.elasticache_for_redis` | `#C925D1` |
| ElastiCache for Memcached | `mxgraph.aws4.elasticache_for_memcached` | `#C925D1` |
| DocumentDB | `mxgraph.aws4.documentdb_with_mongodb_compatibility` | `#C925D1` |
| Neptune | `mxgraph.aws4.neptune` | `#C925D1` |
| Redshift | `mxgraph.aws4.redshift` | `#8C4FFF` |

> ⚠️ 2023년부터 Database 아이콘이 Blue → Purple로 변경됨

---

## Networking

| 서비스 | resIcon | fillColor |
|--------|---------|-----------|
| Route 53 | `mxgraph.aws4.route_53` | `#8C4FFF` |
| CloudFront | `mxgraph.aws4.cloudfront` | `#8C4FFF` |
| API Gateway | `mxgraph.aws4.api_gateway` | `#E7157B` |
| VPC | `mxgraph.aws4.vpc` | `#8C4FFF` |
| NLB | `mxgraph.aws4.network_load_balancer` | `#8C4FFF` |
| ALB | `mxgraph.aws4.application_load_balancer` | `#8C4FFF` |
| Internet Gateway | `mxgraph.aws4.internet_gateway` | `#8C4FFF` |
| NAT Gateway | `mxgraph.aws4.nat_gateway` | `#8C4FFF` |

---

## Storage

| 서비스 | resIcon | fillColor |
|--------|---------|-----------|
| S3 | `mxgraph.aws4.s3` | `#7AA116` |
| EBS | `mxgraph.aws4.elastic_block_store` | `#7AA116` |
| EFS | `mxgraph.aws4.elastic_file_system` | `#7AA116` |

---

## Security

| 서비스 | resIcon | fillColor |
|--------|---------|-----------|
| IAM | `mxgraph.aws4.identity_and_access_management` | `#DD344C` |
| Cognito | `mxgraph.aws4.cognito` | `#DD344C` |
| Secrets Manager | `mxgraph.aws4.secrets_manager` | `#DD344C` |
| WAF | `mxgraph.aws4.waf` | `#DD344C` |
| KMS | `mxgraph.aws4.key_management_service` | `#DD344C` |
| Certificate Manager | `mxgraph.aws4.certificate_manager` | `#DD344C` |

---

## Management & Monitoring

| 서비스 | resIcon | fillColor |
|--------|---------|-----------|
| CloudWatch | `mxgraph.aws4.cloudwatch` | `#BC1356` |
| Step Functions | `mxgraph.aws4.step_functions` | `#BC1356` |
| CloudFormation | `mxgraph.aws4.cloudformation` | `#BC1356` |
| Systems Manager | `mxgraph.aws4.systems_manager` | `#BC1356` |
| Config | `mxgraph.aws4.config` | `#BC1356` |

---

## Application Integration

| 서비스 | resIcon | fillColor |
|--------|---------|-----------|
| SQS | `mxgraph.aws4.sqs` | `#E7157B` |
| SNS | `mxgraph.aws4.sns` | `#E7157B` |
| EventBridge | `mxgraph.aws4.eventbridge` | `#E7157B` |
| MQ | `mxgraph.aws4.mq` | `#E7157B` |

---

## AWS 그룹 스타일

| 그룹 | grIcon | strokeColor |
|------|--------|-------------|
| AWS Cloud | `mxgraph.aws4.group_aws_cloud` | `#232F3E` |
| Region | `mxgraph.aws4.group_region` | `#147EBA` |
| VPC | `mxgraph.aws4.group_vpc` | `#248814` |
| Public Subnet | `mxgraph.aws4.group_public_subnet` | `#7AA116` |
| Private Subnet | `mxgraph.aws4.group_private_subnet` | `#147EBA` |
| Security Group | `mxgraph.aws4.group_security_group` | `#DD3522` |
| Auto Scaling | `mxgraph.aws4.group_auto_scaling_group` | `#ED7100` |
| Availability Zone | `mxgraph.aws4.group_availability_zone` | `#147EBA` |

---

## 아이콘 스타일 템플릿

```
shape=mxgraph.aws4.resourceIcon;resIcon={resIcon};fillColor={fillColor};strokeColor=#FFFFFF;
```

**예시**:
```
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.rds;fillColor=#C925D1;strokeColor=#FFFFFF;
```

---

*버전: 1.0 | 최종 수정: 2026-01-09*
