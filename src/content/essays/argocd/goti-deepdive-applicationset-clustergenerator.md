---
title: "ApplicationSet clusterGenerator — 멀티클러스터 배포를 DRY하게 유지하는 원리"
excerpt: "ArgoCD ApplicationSet의 clusterGenerator가 등록된 클러스터마다 Application을 어떻게 자동 생성하는지, cluster-overrides 패턴으로 base values와 CSP 편차 오버라이드를 어떻게 병합하는지 설명합니다"
category: argocd
tags:
  - go-ti
  - argocd
  - applicationset
  - clustergenerator
  - gitops
  - concept
series:
  name: "goti-deepdive-platform"
  order: 5
date: "2026-04-15"
---

## 한 줄 요약

> ApplicationSet clusterGenerator는 ArgoCD에 등록된 클러스터 목록을 순회하며 각 클러스터에 맞는 Application을 자동 생성합니다 — 매니페스트를 클러스터별로 복사하지 않아도 됩니다

---

## 🤔 무엇을 푸는 기술인가

멀티클러스터 GitOps에서 가장 먼저 맞닥뜨리는 문제는 **매니페스트 이중 관리**입니다 서비스가 두 클러스터에 배포된다면 `values.yaml`도 두 벌, ArgoCD Application도 두 개를 직접 만들어야 합니다 새 서비스를 추가하거나 공통 설정을 바꿀 때마다 두 파일을 동시에 수정해야 하고, 한 쪽을 빠뜨리는 순간 두 클러스터의 상태가 조용히 벌어집니다

**ArgoCD ApplicationSet**은 이 문제를 해결하기 위해 만들어진 컨트롤러입니다 ApplicationSet은 일종의 "Application을 찍어내는 틀"입니다 틀 안에 `generator`를 지정하면, 컨트롤러가 generator에서 얻은 목록을 순회하며 Application을 자동 생성합니다

`clusterGenerator`는 그 generator 중 하나입니다 ArgoCD에 등록된 클러스터 목록을 데이터 소스로 삼아, 클러스터마다 Application 오브젝트를 하나씩 만들어냅니다 운영자가 직접 Application 두 개를 정의할 필요가 없습니다 클러스터 하나를 ArgoCD에 추가하기만 하면, ApplicationSet 컨트롤러가 이를 감지하고 대응하는 Application을 자동으로 생성합니다

---

## 🔧 동작 원리

### ApplicationSet과 generator 구조

ApplicationSet은 Kubernetes CRD로 정의됩니다 핵심 구조는 두 부분입니다

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: goti-services
  namespace: argocd
spec:
  generators:       # 목록을 공급하는 소스
    - clusters: {}  # clusterGenerator
  template:         # 각 항목으로 Application을 찍어낼 틀
    metadata:
      name: '{{name}}-goti-services'
    spec:
      project: default
      source:
        repoURL: https://github.com/go-ti/Goti-k8s
        targetRevision: main
        path: environments/prod
      destination:
        server: '{{server}}'
        namespace: goti
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

`generators` 아래에 `clusters: {}`를 선언하면 clusterGenerator가 활성화됩니다 `{}` — 빈 오브젝트 — 는 "ArgoCD에 등록된 모든 클러스터"를 의미합니다 각 클러스터 항목은 `name`, `server`, `metadata` 등의 변수를 제공하며, `template` 안에서 `{{name}}`, `{{server}}`처럼 참조할 수 있습니다

### clusterGenerator가 클러스터를 감지하는 방법

ArgoCD는 외부 클러스터를 등록할 때 `argocd` 네임스페이스에 Secret을 생성합니다 이 Secret에는 `argocd.argoproj.io/secret-type: cluster` 레이블이 붙습니다

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: eks-ap-northeast-2
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: cluster
stringData:
  name: eks-ap-northeast-2
  server: https://XXXXXXXX.gr7.ap-northeast-2.eks.amazonaws.com
  config: |
    { "bearerToken": "...", "tlsClientConfig": {...} }
```

clusterGenerator는 이 레이블을 가진 Secret을 모두 열거합니다 EKS Secret과 GKE Secret이 각각 하나씩 있다면, 컨트롤러는 두 클러스터를 감지하고 `template`을 두 번 렌더링하여 Application 두 개를 만들어냅니다 클러스터 Secret을 삭제하면 대응하는 Application도 함께 삭제됩니다

`clusters: {}` 대신 `clusters: {selector: {matchLabels: {env: prod}}}` 형태로 특정 레이블을 가진 클러스터만 대상으로 지정할 수도 있습니다

### 단일 prod/ 소스 + cluster-overrides 병합

clusterGenerator로 Application 생성을 자동화하더라도, 두 클러스터 사이에 반드시 다른 값이 있습니다 AWS ElastiCache endpoint와 GCP Memorystore endpoint는 서로 다르고, IRSA 어노테이션과 Workload Identity 어노테이션도 다릅니다 이 차이를 어디에 담을지가 레포 구조의 핵심 결정입니다

![단일 prod/ 소스와 cluster-overrides가 ApplicationSet을 통해 두 클러스터에 분배되는 흐름|tall](/diagrams/goti-deepdive-applicationset-clustergenerator-1.svg)

위 다이어그램은 전체 흐름을 보여줍니다 Git 레포의 `environments/prod/`에는 두 클러스터가 공유하는 기본값이 담겨 있습니다 `cluster-overrides/eks.yaml`과 `cluster-overrides/gke.yaml`에는 각 CSP에만 해당하는 편차값이 존재합니다 ApplicationSet clusterGenerator가 두 클러스터를 순회하며 Application을 생성할 때, 각 Application은 `prod/`의 base values와 해당 클러스터의 override 파일을 병합한 결과로 Helm 릴리스를 수행합니다

Helm values 파일을 여러 개 지정하는 방법은 `spec.source.helm.valueFiles` 배열로 구현됩니다

```yaml
spec:
  generators:
    - clusters:
        selector:
          matchLabels:
            env: prod
  template:
    spec:
      source:
        repoURL: https://github.com/go-ti/Goti-k8s
        targetRevision: main
        path: environments/prod
        helm:
          valueFiles:
            - values.yaml                              # base (공통)
            - ../../cluster-overrides/{{metadata.labels.cloud}}.yaml  # 클러스터별 override
```

`{{metadata.labels.cloud}}`는 클러스터 Secret의 메타데이터 레이블에서 가져온 값입니다 EKS Secret에 `cloud: eks` 레이블이, GKE Secret에 `cloud: gke` 레이블이 붙어 있으면, 각 Application은 자신에게 맞는 override 파일을 자동으로 참조합니다

ArgoCD는 `valueFiles`를 순서대로 읽고 후행 파일이 선행 파일을 덮어씁니다 `values.yaml`에서 `redis.endpoint: ""`로 기본값을 정의하고, `eks.yaml`에서 `redis.endpoint: "elasticache.xxxxx.cache.amazonaws.com"`으로 덮어쓰는 방식입니다

---

## 📐 세부 동작과 옵션

### 완전 분리 구조 vs 단일+override 구조 비교

![완전 분리 구조와 단일+override 구조의 Before/After 비교|tall](/diagrams/goti-deepdive-applicationset-clustergenerator-2.svg)

위 다이어그램은 두 구조를 나란히 비교합니다

왼쪽의 완전 분리 구조(`prod-aws/` + `prod-gcp/`)에서는 서비스 설정 파일이 두 벌 존재합니다 `service-a`의 `replicas`를 변경하면 두 디렉토리의 파일을 각각 수정해야 합니다 실수로 한 쪽만 수정하면 두 클러스터의 선언 상태가 달라지고, ArgoCD는 이를 정상으로 인식합니다 — 각 Application이 각자의 소스를 보기 때문입니다 이 상태에서 장애가 발생하면 두 클러스터 중 한 곳은 오래된 설정으로 운영되고 있었다는 사실을 뒤늦게 발견하게 됩니다

오른쪽의 단일+override 구조에서는 공통 설정이 `prod/`에 한 벌만 존재합니다 `replicas` 변경은 파일 하나에만 적용하면 두 클러스터가 동시에 반영받습니다 CSP 편차(`eks.yaml`, `gke.yaml`)는 실제로 다른 값만 담습니다 이 파일들은 얇습니다 — 보통 수십 줄 이하입니다

| 항목 | 완전 분리 | 단일+override |
|---|---|---|
| 공통 설정 수정 범위 | 2회 (각 디렉토리) | 1회 (`prod/`) |
| 동기화 누락 가능성 | 높음 (수동 관리) | 낮음 (구조적 차단) |
| CSP 편차 위치 | 각 디렉토리 전체에 산재 | `cluster-overrides/` 에 집중 |
| ArgoCD Application 수 | 수동 정의 필요 | clusterGenerator 자동 생성 |
| 신규 클러스터 추가 | Application + 디렉토리 신규 작성 | 클러스터 Secret 추가만으로 완결 |

### clusterGenerator 필터링 옵션

`clusters` 필드에 `selector`를 붙이면 대상을 좁힐 수 있습니다

```yaml
generators:
  - clusters:
      selector:
        matchLabels:
          env: prod
          region: asia
```

staging 클러스터와 prod 클러스터를 모두 ArgoCD에 등록해 두되, ApplicationSet은 `env: prod` 레이블이 붙은 클러스터에만 배포하도록 제한할 수 있습니다 레이블 관리가 클러스터 배포 스코프를 통제하는 단일 지점이 됩니다

### Template 변수 참조 범위

clusterGenerator가 제공하는 변수는 다음과 같습니다

| 변수 | 내용 |
|---|---|
| `{{name}}` | 클러스터 Secret의 `name` 필드 |
| `{{server}}` | 클러스터 API 서버 URL |
| `{{metadata.labels.<key>}}` | 클러스터 Secret 메타데이터 레이블 |
| `{{metadata.annotations.<key>}}` | 클러스터 Secret 메타데이터 어노테이션 |

`metadata.labels`와 `metadata.annotations`를 활용하면 변수 하나로 다양한 커스텀 값을 template에 주입할 수 있습니다 클러스터별 AWS 계정 ID, 네임스페이스명, 이미지 레지스트리 주소 등을 레이블에 담아두는 패턴이 자주 쓰입니다

### 삭제 보호 (Orphan 정책)

클러스터 Secret이 삭제되면 대응 Application도 연쇄 삭제됩니다 이를 제어하는 옵션이 `syncPolicy.preserveResourcesOnDeletion`입니다

```yaml
syncPolicy:
  preserveResourcesOnDeletion: true
```

이 옵션이 `true`이면 ApplicationSet이나 Application이 삭제되어도 클러스터에 배포된 실제 리소스는 그대로 남습니다 Production 환경에서는 이 옵션을 기본으로 켜두고, 삭제는 반드시 수동 확인 후 진행하는 것이 안전합니다

---

## 🧩 go-ti에서는

go-ti는 AWS EKS(ap-northeast-2)와 GCP GKE(asia-northeast3)에 동일한 Go MSA 서비스 6종을 배포합니다 ADR-0025에서 K8s 레포 구조를 결정할 때, `environments/prod-aws/` + `environments/prod-gcp/` 완전 분리 구조는 이미 개발 단계에서 동기화 누락 사고를 반복적으로 일으킨 경험이 있었습니다 동일한 서비스의 `replicas`나 resource limit을 한 쪽에만 반영한 채 PR을 머지하는 사고가 복수 발생했습니다

이를 해결하기 위해 `environments/prod/` 단일 구조 + `cluster-overrides/{eks,gke}.yaml` 패턴을 채택했습니다 ApplicationSet clusterGenerator가 EKS Secret과 GKE Secret을 자동으로 감지하여 Application 두 개를 생성합니다 공통 설정 변경은 `prod/` 한 곳에만 하면 두 클러스터에 동시 반영됩니다 `cluster-overrides/`에는 Redis endpoint, ExternalSecret 참조명, IAM 어노테이션처럼 실제로 CSP 간에 다른 값만 담겨 있습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Multi-Cloud 상위 아키텍처 — Active-Passive + CF Worker 팀 코드 라우팅을 택한 이유](/logs/goti-multicloud-high-level-architecture-adr)에 정리했습니다

---

## 📚 핵심 정리

- ApplicationSet은 "Application을 찍어내는 틀"입니다 `clusterGenerator`를 사용하면 ArgoCD에 등록된 클러스터 Secret(`argocd.argoproj.io/secret-type: cluster`)을 순회하며 Application을 자동 생성합니다
- 클러스터를 추가하려면 Secret 하나만 등록하면 됩니다 ApplicationSet이 이를 감지하고 대응 Application을 생성합니다 — Application 매니페스트를 직접 작성할 필요가 없습니다
- `environments/prod/`(공통) + `cluster-overrides/{csp}.yaml`(편차) 구조를 `helm.valueFiles` 순서 병합으로 구현하면, 공통 설정 수정이 양 클러스터에 자동으로 전파됩니다
- 클러스터별 편차를 `cluster-overrides/` 에만 집중시키면, 어떤 값이 CSP 간에 다른지 한눈에 파악됩니다 완전 분리 구조에서는 편차가 디렉토리 전체에 산재합니다
- `selector.matchLabels`로 대상 클러스터를 좁히면, prod/staging 분리나 리전별 배포 스코프 제어를 레이블 관리 하나로 통제할 수 있습니다
