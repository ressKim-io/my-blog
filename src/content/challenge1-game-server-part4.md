---
title: '게임 서버 K8s 배포 - Part 4: Service'
excerpt: 'K8s에서 Pod끼리, 그리고 외부와 통신하는 방법'
category: challenge
tags:
  - bootcamp
  - service
  - clusterip
  - loadbalancer
  - networking
date: '2025-10-17'
series:
  name: game-server
  order: 4
---

## 🎯 핵심 개념

Deployment로 Pod를 띄웠지만, 아직 접근할 수가 없다. Pod는 언제든 죽고 다시 생길 수 있어서 IP가 계속 바뀐다. 이걸 해결하는 게 **Service**다.

택배로 비유해보자. Pod는 계속 이사를 다니는 사람이다. 매번 새 주소가 생긴다. Service는 이 사람의 "우체국 사서함" 같은 거다. 주소가 바뀌어도 사서함 번호는 고정이니, 택배를 보낼 때는 사서함 번호로 보내면 된다.

## 💡 왜 Service가 필요한가

Pod의 IP는 고정이 아니다.

```bash
# Pod 확인
$ kubectl get pods -n game-prod -o wide
NAME                          IP            NODE
game-lobby-7d9f8c4b5-abc12    10.42.1.23    node-1
game-lobby-7d9f8c4b5-def34    10.42.2.45    node-2

# Pod 재시작하면 IP 바뀜
$ kubectl delete pod game-lobby-7d9f8c4b5-abc12 -n game-prod
$ kubectl get pods -n game-prod -o wide
NAME                          IP            NODE
game-lobby-7d9f8c4b5-xyz99    10.42.1.78    node-1  # IP 변경됨
```

Pod IP로 직접 접근하면 Pod가 재시작될 때마다 연결이 끊긴다. Service는 고정된 IP와 DNS 이름을 제공해서 이 문제를 해결한다.

## 📌 Service 타입

K8s에는 Service 타입이 여러 개 있다. 용도가 다 다르다.

### ClusterIP (기본, 내부 통신용)

클러스터 안에서만 접근 가능한 IP를 만든다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: game-lobby
  namespace: game-prod
spec:
  type: ClusterIP
  selector:
    app: game-lobby
  ports:
  - name: http
    port: 80
    targetPort: 80
    protocol: TCP
```

다른 Pod에서 이렇게 접근할 수 있다.

```bash
# 클러스터 안에서
curl http://game-lobby.game-prod.svc.cluster.local
# 또는 짧게
curl http://game-lobby
```

게임 룸 서비스가 로비 서비스를 호출할 때 이 방식을 쓴다. 외부에는 노출 안 되고, 내부끼리만 통신한다.

### LoadBalancer (외부 노출용)

외부에서 접근할 수 있는 IP를 만든다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: game-lobby-external
  namespace: game-prod
spec:
  type: LoadBalancer
  selector:
    app: game-lobby
  ports:
  - name: http
    port: 80
    targetPort: 80
    protocol: TCP
```

k3d에서는 자동으로 localhost에 매핑된다.

```bash
$ kubectl get svc -n game-prod
NAME                   TYPE           EXTERNAL-IP
game-lobby-external    LoadBalancer   localhost
```

브라우저에서 `http://localhost`로 접근 가능하다.

실제 클라우드(AWS, GCP)에서는 진짜 로드밸런서가 생성되고, 공인 IP가 할당된다. 비용이 발생한다는 게 포인트다.

### NodePort (로컬 개발용)

노드의 특정 포트를 열어서 외부 접근을 허용한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: game-lobby-nodeport
  namespace: game-prod
spec:
  type: NodePort
  selector:
    app: game-lobby
  ports:
  - name: http
    port: 80
    targetPort: 80
    nodePort: 30080  # 30000-32767 범위
    protocol: TCP
```

이렇게 하면 `http://노드IP:30080`으로 접근할 수 있다. 로컬 개발할 때는 편하지만, 프로덕션에서는 잘 안 쓴다. 포트 번호를 외워야 하고, 보안상 좋지 않다.

## 📌 게임 로비 Service 작성

내부 통신용 ClusterIP와 외부 접근용 LoadBalancer 둘 다 만들었다.

```yaml
---
# 내부 통신용
apiVersion: v1
kind: Service
metadata:
  name: game-lobby
  namespace: game-prod
  labels:
    app: game-lobby
spec:
  type: ClusterIP
  selector:
    app: game-lobby
  ports:
  - name: http
    port: 80
    targetPort: 80
    protocol: TCP
---
# 외부 접근용 (테스트용)
apiVersion: v1
kind: Service
metadata:
  name: game-lobby-lb
  namespace: game-prod
  labels:
    app: game-lobby
spec:
  type: LoadBalancer
  selector:
    app: game-lobby
  ports:
  - name: http
    port: 80
    targetPort: 80
    protocol: TCP
```

배포하고 확인해보자.

```bash
# 배포
kubectl apply -f 04-lobby-service.yaml

# 확인
kubectl get svc -n game-prod

# Endpoints 확인 (Service가 어떤 Pod랑 연결됐나)
kubectl get endpoints -n game-prod
```

![Service 목록](/images/challenge1/part4-service-list.png)

Endpoints가 Pod IP 3개를 가리키고 있으면 정상이다.

```bash
NAME         ENDPOINTS
game-lobby   10.42.1.23:80,10.42.2.45:80,10.42.1.78:80
```

## ⚠️ 주의사항

### selector와 Pod labels 일치

Service의 selector는 Deployment의 Pod labels와 같아야 한다.

```yaml
# Service
selector:
  app: game-lobby

# Deployment의 Pod template
labels:
  app: game-lobby
```

이게 안 맞으면 Service가 Pod를 못 찾는다. Endpoints가 비어있으면 이걸 확인해봐야 한다.

### port vs targetPort

```yaml
ports:
- port: 80        # Service가 받는 포트
  targetPort: 80  # Pod가 받는 포트
```

헷갈리는데, Service는 80번으로 받아서 Pod의 80번으로 전달한다는 뜻이다. 서로 다를 수도 있다.

```yaml
ports:
- port: 80          # 외부에선 80번으로 호출
  targetPort: 8080  # 실제 Pod는 8080번에서 대기
```

### LoadBalancer 비용

클라우드에서 LoadBalancer 타입을 쓰면 실제 로드밸런서가 생성되고, 비용이 청구된다. AWS ALB는 시간당 $0.0225 + 트래픽 비용이다.

서비스 10개에 LoadBalancer를 각각 달면 한 달에 $16.2가 나간다. 실무에서는 Ingress로 하나의 LoadBalancer를 공유한다.

## 정리

Service로 Pod에 고정된 네트워크 주소를 부여했다. ClusterIP는 내부 통신용, LoadBalancer는 외부 노출용이다.

다음 글에서는 나머지 서비스(게임 룸, 채팅, 랭킹)도 배포하고, nodeSelector로 워크로드를 분리해볼 예정이다.

## 💭 생각해볼 점

**Q**: Service가 Pod 3개에 트래픽을 분산할 때, 어떤 방식으로 분산할까?

**힌트**: 기본은 라운드로빈이다. 1번 → 2번 → 3번 순서로 돌아가며 보낸다. sessionAffinity를 ClientIP로 설정하면 같은 클라이언트는 항상 같은 Pod로 가게 할 수도 있다.

## 🎯 추가 학습

- Headless Service는 언제 쓰나
- ExternalName Service의 용도
- kube-proxy의 iptables 모드 vs IPVS 모드

## 🔗 참고
- **[📂 프로젝트 GitHub 저장소](https://github.com/ressKim-io/game-server-k8s)**
  - [Service YAML](https://github.com/ressKim-io/game-server-k8s/blob/main/k8s-manifests/04-service.yaml)

- [Kubernetes Service 공식 문서](https://kubernetes.io/docs/concepts/services-networking/service/)
- [Service와 Pod 연결 이해하기](https://kubernetes.io/docs/concepts/services-networking/connect-applications-service/)
