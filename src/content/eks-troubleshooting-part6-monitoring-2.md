---
title: "EKS 모니터링 구축기 (2): S3로 전환하기"
excerpt: "PVC에서 S3로 모니터링 스토리지 전환 - Pod Identity, 버전 호환성, 이미지 문제"
category: monitoring
tags:
  - EKS
  - Troubleshooting
  - Prometheus
  - Loki
  - Tempo
  - S3
  - Pod-Identity
series:
  name: "eks-troubleshooting"
  order: 6
date: '2025-12-31'
---

## 🎯 한 줄 요약

> 모니터링 스토리지를 PVC에서 S3로 전환하면서, Pod Identity 미지원, 버전 호환성, 이미지 태그 문제를 겪었다.

## 📊 Impact

- **영향 범위**: Loki, Tempo 스토리지 전환 실패
- **소요 시간**: 약 6시간
- **발생일**: 2025-12-31

---

## 💡 왜 S3로 전환했나?

PVC 기반 스토리지의 문제점:

| 문제 | 설명 |
|------|------|
| **확장성** | EBS 볼륨 크기 제한, 수동 확장 필요 |
| **비용** | gp3도 장기 보관에는 비쌈 |
| **가용성** | AZ 장애 시 데이터 접근 불가 |
| **Lock 충돌** | RWO로 인한 Pod 업데이트 문제 |

S3 기반 스토리지의 장점:

- **무제한 확장**
- **저렴한 비용** (S3 Intelligent-Tiering)
- **멀티 AZ 내구성**
- **Lock 충돌 없음**

**Before**: Prometheus / Loki / Tempo → PVC (gp3)

**After**:
- Prometheus → PVC (메트릭, 단기)
- Loki → S3 (로그, 장기)
- Tempo → S3 (트레이스, 장기)

---

## 🔥 1. Tempo S3 Access Denied - Pod Identity 미지원

### 증상

Tempo를 S3로 전환했는데:

```bash
$ kubectl logs deploy/tempo -n wealist-prod
unexpected error from ListObjects on wealist-prod-tempo-traces: Access Denied
```

`Access Denied`. S3 접근 권한이 없습니다.

### 원인 분석

**1단계: S3 버킷 확인**

```bash
$ aws s3 ls s3://wealist-prod-tempo-traces
(정상 출력)
```

버킷은 있습니다.

**2단계: Pod Identity 확인**

```bash
$ kubectl get pods -n wealist-prod -l app=tempo -o yaml | grep serviceAccountName
serviceAccountName: tempo

$ kubectl get sa tempo -n wealist-prod
Error: serviceaccounts "tempo" not found
```

ServiceAccount가 없습니다!

**3단계: ServiceAccount 생성 후 재시도**

ServiceAccount를 생성하고 Pod Identity를 연결했습니다. 그런데 여전히 Access Denied.

**4단계: Pod 내부에서 AWS CLI 테스트**

```bash
$ kubectl exec -n wealist-prod deploy/tempo -- aws s3 ls s3://wealist-prod-tempo-traces
2025-12-31 09:00:00 wealist-prod-tempo-traces
```

AWS CLI는 성공합니다! 그런데 Tempo 자체는 실패합니다.

**5단계: 근본 원인 발견**

Tempo 2.3.1은 내부적으로 `minio-go` 라이브러리를 사용합니다. 이 버전의 minio-go는 **EKS Pod Identity를 지원하지 않습니다**.

- EKS Pod Identity는 2023년 출시되었습니다.
- minio-go는 7.0.70+ 부터 Pod Identity를 지원합니다.
- Tempo 2.3.1은 내부적으로 minio-go 7.0.50을 사용 → Pod Identity 미지원.

### 해결

**Tempo 버전 업그레이드**:

```yaml
# k8s/helm/environments/prod.yaml
tempo:
  image:
    repository: grafana/tempo
    tag: "2.6.1"  # 2.3.1 → 2.6.1 (Pod Identity 지원)
```

Tempo 2.6.1은 minio-go 7.0.70+를 사용하여 Pod Identity를 지원합니다.

### Pod Identity vs IRSA

| 방식 | 출시 | 장점 | 단점 |
|------|------|------|------|
| IRSA | 2019 | 성숙, 안정적 | OIDC 설정 복잡 |
| **Pod Identity** | 2023 | 간단, EKS 통합 | 라이브러리 호환성 |

새 프로젝트에서는 Pod Identity가 더 간단하지만, 라이브러리 호환성을 확인해야 합니다.

### 핵심 포인트

- **Pod Identity는 비교적 새로운 기능이라 모든 라이브러리가 지원하지 않는다**
- **AWS CLI 동작 ≠ 애플리케이션 동작** - 인증 메커니즘이 다를 수 있음
- **버전 업그레이드로 해결 가능한 경우가 많다**

---

## 🔥 2. Loki 3.x 설정 호환성 오류

### 증상

Loki를 2.9.2에서 3.6.3으로 업그레이드했더니:

```bash
$ kubectl logs deploy/loki -n wealist-prod
failed parsing config: yaml: unmarshal errors:
line 42: field enforce_metric_name not found in type validation.plain
```

설정 파일 파싱 오류입니다.

### 원인 분석

Loki 3.x에서 `enforce_metric_name` 필드가 deprecated 되었습니다:

```yaml
# 기존 설정 (2.x 호환)
limits_config:
  enforce_metric_name: false  # ← 3.x에서 삭제됨!
  reject_old_samples: true
```

### 해결

**deprecated 필드 제거**:

```yaml
# 수정된 설정 (3.x 호환)
limits_config:
  reject_old_samples: true
  reject_old_samples_max_age: 168h
  # enforce_metric_name 삭제
```

**Loki 3.x 추가 변경사항**:

```yaml
# Before (2.x)
schema_config:
  configs:
    - from: 2020-10-24
      store: boltdb-shipper
      object_store: s3
      schema: v11

# After (3.x)
schema_config:
  configs:
    - from: 2020-10-24
      store: tsdb
      object_store: s3
      schema: v13
      index:
        prefix: loki_index_
        period: 24h
```

| 항목 | 2.x | 3.x |
|------|-----|-----|
| store | boltdb-shipper | **tsdb** |
| schema | v11 | **v13** |
| enforce_metric_name | 있음 | **삭제** |

### 핵심 포인트

- **메이저 버전 업그레이드 시 breaking changes 확인 필수**
- **Loki 3.x는 TSDB 기반으로 완전히 변경됨**
- 공식 Migration Guide를 반드시 확인

---

## 🔥 3. 이미지 태그가 존재하지 않는다

### 증상

모니터링 컴포넌트들이 ImagePullBackOff:

```bash
$ kubectl get pods -n wealist-prod
prometheus-xxx   0/1   ImagePullBackOff
loki-xxx         0/1   ImagePullBackOff
alloy-xxx        0/1   ImagePullBackOff
```

```bash
$ kubectl describe pod prometheus-xxx -n wealist-prod | grep -A3 Events
Failed to pull image "prom/prometheus:v2.56.1": not found
```

`v2.56.1` 태그가 없습니다.

### 원인 분석

prod.yaml에 지정된 버전들:

```yaml
prometheus:
  image:
    tag: "v2.56.1"  # 존재하지 않음!
loki:
  image:
    tag: "2.10.6"   # 존재하지 않음!
alloy:
  image:
    tag: "1.5.0"    # 존재하지 않음!
```

Docker Hub에서 실제 태그 확인:

```bash
$ curl -s "https://hub.docker.com/v2/repositories/prom/prometheus/tags" | \
  jq -r '.results[].name' | grep "^v2\." | head -5
v2.55.1
v2.55.0
v2.54.1
...
```

**v2.56.1은 존재하지 않습니다!** (아직 릴리스 안 됨)

### 해결

실제 존재하는 최신 태그로 변경:

```yaml
# k8s/helm/environments/prod.yaml

prometheus:
  image:
    tag: "v2.55.1"  # 실제 최신

loki:
  image:
    tag: "3.6.3"    # 3.x 최신

alloy:
  image:
    tag: "v1.12.1"  # v 접두사 포함
```

### 태그 확인 방법

```bash
# Docker Hub API
curl -s "https://hub.docker.com/v2/repositories/<org>/<repo>/tags" | jq '.results[].name'

# skopeo
skopeo list-tags docker://<org>/<repo>

# crane
crane ls <org>/<repo>
```

### 최종 버전 매트릭스

| 컴포넌트 | 잘못된 버전 | 실제 최신 |
|----------|------------|----------|
| Prometheus | v2.56.1 | **v2.55.1** |
| Loki | 2.10.6 | **3.6.3** |
| Alloy | 1.5.0 | **v1.12.1** |
| Grafana | 10.2.2 | **10.4.12** |

### 핵심 포인트

- **이미지 태그는 존재 여부를 꼭 확인해야 한다**
- **v 접두사 유무가 다를 수 있다** (1.5.0 vs v1.12.1)
- **CI/CD에서 이미지 존재 확인 단계 추가 권장**

---

## 🔥 4. OTEL Collector 바이너리 경로 변경

### 증상

OTEL Collector를 업그레이드했더니:

```bash
$ kubectl logs deploy/otel-collector -n wealist-prod
exec /otelcol-contrib: no such file or directory
```

바이너리 파일이 없습니다.

### 원인 분석

OTEL Collector 이미지의 엔트리포인트가 버전마다 다릅니다:

```
0.92.0: /otelcol-contrib
0.116.0: /otelcol  # 또는 다른 경로
```

### 해결

**안정 버전 유지**:

```yaml
otelCollector:
  image:
    repository: otel/opentelemetry-collector-contrib
    tag: "0.92.0"  # 현재 동작하는 버전 유지
```

업그레이드가 필요하다면 릴리스 노트에서 breaking changes 확인 후 진행.

### 핵심 포인트

- **컨테이너 이미지의 엔트리포인트가 버전마다 다를 수 있다**
- **급하게 업그레이드하지 말고 릴리스 노트 확인**
- **동작하는 버전을 명시적으로 고정하는 것도 전략**

---

## 📚 종합 정리

### S3 전환 체크리스트

```
[ ] S3 버킷 생성 (Terraform)
[ ] Pod Identity 또는 IRSA 설정
[ ] ServiceAccount 생성 및 연결
[ ] 애플리케이션의 AWS SDK/라이브러리 버전 확인
[ ] 설정 파일 호환성 확인 (버전 업그레이드 시)
[ ] 이미지 태그 존재 여부 확인
```

### 최종 아키텍처

![개선된 Monitoring Stack 최종 아키텍처](/diagrams/eks-troubleshooting-part6-monitoring-2-1.svg)

### 버전 호환성 매트릭스

| 컴포넌트 | 버전 | Pod Identity | S3 지원 |
|----------|------|--------------|---------|
| Tempo | 2.6.1+ | ✅ | ✅ |
| Loki | 3.x | ✅ | ✅ |
| Prometheus | 2.x | N/A | 로컬 저장 |
| Grafana | 10.x | N/A | N/A |

---

## 🤔 스스로에게 던지는 질문

### 1. PVC vs S3, 모니터링 스토리지 선택 기준은?

**PVC 사용:**
- 단기 보관 (Prometheus 메트릭)
- 빠른 쿼리 응답 필요
- 데이터량이 적을 때

**S3 사용:**
- 장기 보관 (로그, 트레이스)
- 비용 최적화 필요
- 대용량 데이터

### 2. Pod Identity vs IRSA, 언제 뭘 선택할까?

**Pod Identity:**
- 새 프로젝트
- EKS 1.24+
- 간단한 설정 원할 때

**IRSA:**
- 기존 프로젝트
- 라이브러리 호환성 문제 시
- 더 세밀한 제어 필요

### 3. 버전 업그레이드 전 확인해야 할 것은?

```bash
# 1. 릴리스 노트에서 breaking changes 확인
# 2. 이미지 태그 존재 확인
skopeo list-tags docker://grafana/loki | grep 3.6

# 3. 설정 파일 호환성 체크
# 4. 라이브러리/SDK 버전 확인 (Pod Identity 등)
# 5. 스테이징에서 먼저 테스트
```

### 4. 모니터링 스택 업그레이드 전략은?

1. **한 번에 하나씩** - Prometheus → Loki → Tempo
2. **스테이징 먼저** - Production 전에 테스트
3. **롤백 계획** - 이전 버전으로 빠른 복구
4. **데이터 백업** - S3 버전 관리 활성화

---

## 🔗 다음 편 예고

다음 편에서는 **Go 마이크로서비스 EKS 배포**에서 겪은 문제들을 다룹니다:
- OAuth2 세션 문제 (Multiple Pods 환경)
- Go genproto 모듈 충돌 (ambiguous import)
- OTel Schema URL 충돌 (GORM 플러그인 버전)

예상치 못한 Go 의존성 지옥을 공유하겠습니다.

---

## 🔗 참고

- [Loki 3.0 Migration Guide](https://grafana.com/docs/loki/latest/setup/migrate/)
- [Tempo S3 Backend](https://grafana.com/docs/tempo/latest/configuration/#storage)
- [EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html)
- [minio-go EKS Pod Identity Support](https://github.com/minio/minio-go/releases/tag/v7.0.70)
