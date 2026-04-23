---
title: "Redis Exporter 배포 결정 — Kind 내 Deployment + 호스트 IP 직접 지정"
excerpt: "Kind 외부 호스트에 설치된 Redis를 스크래핑하기 위한 세 가지 배치안을 저울질하고, GitOps 일관성을 우선한 Kind 내 Deployment를 선택한 기록입니다."
category: monitoring
tags:
  - go-ti
  - Redis
  - Exporter
  - Prometheus
  - Deployment
date: "2026-03-25"
---

## 한 줄 요약

> redis-deep-dive와 war-room 대시보드의 `redis_*` 메트릭 17건이 전부 비어 있었습니다. Kind 외부 호스트에 설치된 Redis를 스크래핑하기 위해 세 가지 배치안을 비교한 뒤, GitOps 일관성을 우선해 **Kind 내 Deployment + 호스트 IP 직접 지정**을 채택했습니다.

## 배경

Redis는 Kind 클러스터 외부의 호스트 PC에 직접 설치되어 있습니다. 접근 정보는 다음과 같습니다.

- 주소: `172.20.0.1:6379` (Kind Docker bridge gateway)
- `bind 0.0.0.0`, `protected-mode off`

대시보드에서는 `redis_up`, `redis_connected_clients` 등 17개 패널이 모두 "no data" 상태였습니다. 원인은 단순했습니다. redis-exporter 자체가 어디에도 배포되어 있지 않았기 때문입니다.

문제는 **exporter를 어디에, 어떤 방식으로 배치할지**였습니다. Redis가 Kind 외부에 있고 나머지 관측 스택(Alloy, Prometheus, ServiceMonitor)은 전부 Kind 내부에 있다는 비대칭 구조가 판단을 복잡하게 만들었습니다.

---

## 🧭 선택지 비교

### 고려한 옵션

| 옵션 | 배치 위치 | 스크래핑 방식 |
|------|-----------|---------------|
| A. Kind 내 Deployment + 호스트 IP | Kind 내부 Pod | ServiceMonitor로 Alloy 자동 스크래핑 |
| B. 호스트 PC에 직접 설치 | 호스트 OS | Alloy가 외부 static target으로 스크래핑 |
| C. ExternalName Service + ServiceMonitor | Kind 내부 Service 추상화 | ServiceMonitor |

각 옵션의 장단점은 다음과 같았습니다.

**A. Kind 내 Deployment + 호스트 IP 직접 지정**
- 장점: K8s 네이티브 패턴(Deployment + Service + ServiceMonitor), ArgoCD GitOps로 관리 가능, Alloy가 ServiceMonitor를 통해 자동 스크래핑
- 단점: NetworkPolicy에 호스트 IP 쪽 egress 규칙을 추가해야 하고, `172.20.0.1`을 하드코딩해야 함

**B. 호스트 PC에 redis-exporter 직접 설치**
- 장점: 네트워크 경로가 단순(localhost), NetworkPolicy 불필요
- 단점: GitOps 관리 불가, 호스트 PC 상태에 의존, Alloy 설정에 static target을 직접 추가해야 하므로 기존 ServiceMonitor 패턴과 어긋남

**C. ExternalName Service + ServiceMonitor**
- 장점: K8s Service 추상화를 그대로 사용할 수 있음
- 단점: ExternalName은 IP 주소를 직접 지원하지 않고 CNAME만 받습니다. 결국 Endpoints를 수동으로 정의해야 하는데, 그 순간 옵션 A와 구조적으로 동일해집니다.

### 기각 이유

- **B 탈락**: GitOps 관리 범위 밖으로 빠져나가면 redis-exporter만 운영 경로가 달라집니다. 이미 동일 구조로 운영 중인 kafka-exporter와 일관성이 깨지고, 호스트 PC 재설치/재부팅에 exporter 상태가 종속됩니다.
- **C 탈락**: ExternalName이 IP를 받지 못하는 제약 때문에 Endpoints 수동 정의로 귀결됩니다. 겉보기에만 다른 방식이고 실질적 구성은 옵션 A와 같아, 굳이 선택할 이유가 없었습니다.

### 결정 기준과 최종 선택

**옵션 A를 채택했습니다.**

결정 기준은 다음 우선순위입니다.

1. **GitOps 일관성**: 모든 exporter가 ArgoCD auto-sync로 관리되어야 합니다. 호스트 PC에 설치된 바이너리가 운영 범위를 벗어나면 안 됩니다.
2. **기존 패턴 재사용**: kafka-exporter와 동일한 구조(Deployment + Service + ServiceMonitor)를 따르면 학습 비용과 유지보수 비용이 낮아집니다.
3. **주소 안정성**: Kind Docker bridge gateway `172.20.0.1`은 Kind를 재생성해도 동일하게 유지됩니다. 하드코딩은 제약이지만 실제로는 안정적인 식별자입니다.

옵션 A는 NetworkPolicy에 egress 규칙 한 줄(`172.20.0.1/32:6379`)만 추가하면 되고, 하드코딩 제약도 Deployment 환경변수로 국소화되어 재설정이 쉽습니다. 이 기준을 가장 잘 만족하는 안이었습니다.

---

## ✅ 결정: Kind 내 Deployment로 배포, 호스트 IP는 env로 주입

### 배치 구조

`infrastructure/dev/redis-exporter/` 디렉토리에 다음 리소스를 두었습니다.

- `deployment.yaml`: redis-exporter 컨테이너, `REDIS_ADDR=172.20.0.1:6379`
- `service.yaml`: ClusterIP, exporter 9121 포트 노출
- `servicemonitor.yaml`: Alloy가 자동 스크래핑할 라벨 셀렉터 지정
- `application.yaml`: ArgoCD Application 정의

`goti-infrastructure` App of Apps가 `*application.yaml`을 재귀 탐색하기 때문에 별도 등록 없이 자동으로 동기화됩니다.

### NetworkPolicy 최소 권한 규칙

NetworkPolicy는 호스트 IP에 대해 **TCP 6379만** 허용하는 egress 규칙을 추가했습니다.

```yaml
# monitoring-netpol.yaml egress 규칙 발췌
egress:
  - to:
      - ipBlock:
          cidr: 172.20.0.1/32
    ports:
      - protocol: TCP
        port: 6379
```

호스트 네트워크 전체가 아니라 특정 IP/포트 쌍만 열어 블라스트 반경을 줄였습니다.

### 재현 확인

롤아웃 후 상태는 다음과 같았습니다.

```bash
$ kubectl get pods -n monitoring -l app=redis-exporter
NAME                              READY   STATUS    RESTARTS   AGE
redis-exporter-xxxxxxxxx-xxxxx    1/1     Running   0          2m
```

메트릭이 정상 수집되고 있는지도 확인했습니다.

```text
redis_up                 1
redis_connected_clients  252
```

`validate-queries.sh` 기준으로 redis 관련 쿼리가 15건 추가로 PASS했습니다.

---

## 📚 배운 점

- **"외부 리소스도 GitOps 경계 안에 두는 것"이 운영 일관성을 만듭니다.** exporter 같은 보조 컴포넌트를 호스트에 설치하면 당장은 간단하지만, 관리 경로가 분기되는 순간 운영 부담이 비선형적으로 증가합니다.
- **ExternalName Service는 IP를 직접 받지 못합니다.** 이를 모른 채 설계하면 결국 Endpoints를 수동 정의해 옵션 A와 같아집니다. 의사결정 초기에 제약을 확인해 분기를 빠르게 줄일 수 있었습니다.
- **Kind Docker bridge gateway `172.20.0.1`은 안정적입니다.** Kind 재생성에도 동일 IP가 유지되므로 하드코딩의 부담이 실제로는 크지 않습니다. 다만 Prod 전환 시 Redis가 클러스터 내부 Pod로 이동하면 `REDIS_ADDR`만 교체하면 됩니다.
- **NetworkPolicy는 IP/포트 단위로 좁힙니다.** 호스트 네트워크 전체를 여는 것이 아니라 `172.20.0.1/32:6379`만 허용해 exporter가 필요한 경로 외에는 어떤 egress도 할 수 없게 묶었습니다.
- **기존 패턴과의 일관성은 그 자체로 결정 기준이 됩니다.** kafka-exporter와 동일한 4리소스 구조로 맞추면 신규 팀원이 redis-exporter를 읽을 때 추가 학습이 필요 없습니다.
