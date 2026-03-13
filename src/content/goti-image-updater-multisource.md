---
title: "argocd-image-updater가 이미지를 무시한다: multi-source의 함정"
excerpt: "argocd-image-updater가 multi-source Application에서 이미지를 감지하지 못하는 문제와 ExternalSecret 이름/키 불일치까지 연쇄 트러블슈팅"
category: argocd
tags:
  - go-ti
  - ArgoCD
  - GitOps
  - Troubleshooting
  - image-updater
  - ExternalSecrets
  - Helm
series:
  name: "goti-argocd-gitops"
  order: 2
date: '2026-03-12'
---

## 한 줄 요약

> argocd-image-updater가 `images_skipped=1`을 출력하며 이미지를 무시했다. v0.16.0은 multi-source Application을 지원하지 않는다. single-source로 전환하고, ExternalSecret 이름 불일치와 key prefix 문제까지 연쇄로 해결.

## Impact

- **영향 범위**: goti-server-dev 배포 파이프라인 전체
- **증상**: 새 이미지 push 후 자동 배포 안 됨, Pod ImagePullBackOff
- **소요 시간**: 약 4시간
- **발생일**: 2026-03-12

---

## 🔥 증상: 이미지를 push했는데 배포가 안 된다

ECR에 `dev-b08daa9` 태그로 이미지를 push했습니다.
argocd-image-updater가 자동으로 이미지 태그를 업데이트해야 하는데, 아무 일도 일어나지 않았어요.

### image-updater 로그 확인

```bash
$ kubectl logs deploy/argocd-image-updater -n argocd | grep goti
```

```
time="2026-03-12T10:30:00Z" level=info msg="Processing results: applications=1 images_considered=0 images_skipped=1 images_updated=0"
```

핵심은 `images_skipped=1`입니다.
image-updater가 이미지를 발견했지만 **의도적으로 건너뛰었다**는 뜻이에요.

### Pod 상태

```bash
$ kubectl get pods -n goti-dev
NAME                           READY   STATUS             RESTARTS   AGE
goti-server-xxx                0/1     ImagePullBackOff   0          10m
```

Pod는 존재하지 않는 `dev-latest` 태그를 참조하고 있었습니다.
새 이미지 태그(`dev-b08daa9`)로 업데이트되어야 하는데, image-updater가 동작하지 않으니 계속 실패하는 거예요.

---

## 🤔 원인: argocd-image-updater는 multi-source를 지원하지 않는다

### Application 구조 확인

goti-server-dev Application의 manifest를 확인해봤습니다:

```yaml
# multi-source 구조
spec:
  sources:   # ← 복수형 (sources)
    - path: charts/goti-server
      repoURL: https://github.com/Team-Ikujo/Goti-k8s.git
      helm:
        valueFiles:
          - $values/environments/dev/goti-server/values.yaml
    - ref: values
      repoURL: https://github.com/Team-Ikujo/Goti-k8s.git
```

`sources` (복수형)를 사용하고 있었습니다.
첫 번째 source는 Helm chart 경로, 두 번째는 `$values` ref로 values 파일을 참조하는 구조예요.

### 왜 skip되는가

**argocd-image-updater v0.16.0은 `source` (단수)만 인식합니다.**

```yaml
# image-updater가 인식하는 구조
spec:
  source:    # ← 단수형만 지원
    path: charts/goti-server

# image-updater가 무시하는 구조
spec:
  sources:   # ← 복수형은 미지원
    - path: charts/goti-server
    - ref: values
```

image-updater는 Application을 처리할 때 `source` 필드를 찾습니다.
`sources` 필드를 만나면 이 Application은 처리할 수 없다고 판단하고 skip 해버려요.

이건 argocd-image-updater의 알려진 제한사항입니다. 향후 버전에서 지원 예정이지만, v0.16.0 기준으로는 미지원이에요.

---

## ✅ 해결: single-source로 전환

### 즉시 수정: 수동 태그 변경

배포를 먼저 복구하기 위해 values 파일에서 태그를 직접 변경했습니다:

```yaml
# environments/dev/goti-server/values.yaml
image:
  tag: "dev-b08daa9"  # dev-latest → dev-b08daa9
```

### 근본 수정: multi-source → single-source 전환

잘 생각해보면, chart와 values가 **같은 레포**(`Goti-k8s`)에 있습니다.
같은 레포 내에서 `$values` ref를 사용할 필요가 없어요. 상대 경로로 직접 참조하면 됩니다.

```yaml
# Before (multi-source) — image-updater가 무시함
spec:
  sources:
    - path: charts/goti-server
      repoURL: https://github.com/Team-Ikujo/Goti-k8s.git
      helm:
        valueFiles:
          - "$values/environments/dev/goti-server/values.yaml"
    - ref: values
      repoURL: https://github.com/Team-Ikujo/Goti-k8s.git
```

```yaml
# After (single-source) — image-updater가 정상 동작
spec:
  source:
    path: charts/goti-server
    repoURL: https://github.com/Team-Ikujo/Goti-k8s.git
    helm:
      valueFiles:
        - "../../environments/dev/goti-server/values.yaml"
```

`charts/goti-server` 기준으로 `../../environments/dev/goti-server/values.yaml`을 참조하면 됩니다.
두 번째 source가 완전히 사라지니 `source` (단수형)가 되어 image-updater가 정상 동작해요.

### 영향 범위

모든 Application을 전환할 수 있는 건 아닙니다:

| Application | 전환 가능 | 이유 |
|-------------|----------|------|
| goti-server-dev | O | 같은 레포에 chart + values |
| monitoring AppSet | X | Helm chart repo가 별도 (외부 저장소) |

**같은 레포 내에서 chart + values를 사용하는 경우에만** single-source 전환이 가능합니다.
외부 Helm chart repo를 사용하는 경우에는 multi-source가 필수예요.

---

## 🔥 추가 이슈 1: ExternalSecret 이름 불일치

single-source 전환 후 배포가 진행되었지만, Pod가 기동에 실패했습니다.

### 증상

```bash
$ kubectl describe pod goti-server-xxx -n goti-dev
Events:
  Warning  Failed  1m  kubelet  Error: secret "goti-server-secrets" not found
```

Pod가 `goti-server-secrets`라는 Secret을 찾지 못했어요.

### 원인

ExternalSecret 템플릿이 Helm release 이름을 포함하여 Secret을 생성합니다.
release 이름이 `goti-server-dev`이므로, 실제 생성되는 Secret 이름은 `goti-server-dev-secrets`입니다.

그런데 values.yaml에서는 `-dev-` 없이 참조하고 있었어요:

```yaml
# values.yaml — 잘못된 참조
envFrom:
  - secretRef:
      name: goti-server-secrets      # 실제: goti-server-dev-secrets
```

### 해결

```yaml
# values.yaml — 올바른 참조
envFrom:
  - secretRef:
      name: goti-server-dev-secrets  # Helm release 이름 포함
```

이건 이전에도 겪었던 패턴입니다.
모니터링 VirtualService에서 destination host 이름이 불일치했던 것과 동일한 문제예요.

**Helm release 이름에 환경 suffix(-dev, -prod)가 붙으면, 생성되는 리소스 이름도 변경된다.**
values.yaml에서 리소스를 이름으로 직접 참조할 때 반드시 `kubectl get` 으로 실제 생성 이름을 확인해야 합니다.

---

## 🔥 추가 이슈 2: ExternalSecret dataFrom.find key prefix 문제

Secret 이름을 수정하고 나니 Pod는 기동되었지만, 애플리케이션이 환경변수를 인식하지 못했습니다.

### 증상

```bash
$ kubectl exec deploy/goti-server -n goti-dev -- env | grep JWT
_dev_server_JWT_SECRET=xxx
```

`JWT_SECRET`이어야 할 환경변수가 `_dev_server_JWT_SECRET`으로 주입되고 있었습니다.
SSM 파라미터 path가 key에 포함되어 애플리케이션에서 인식할 수 없어요.

### 원인

ExternalSecret의 `dataFrom.find`가 SSM 파라미터를 경로로 검색합니다.

```
SSM 파라미터: /dev/server/JWT_SECRET
                          ↓
K8s Secret key: _dev_server_JWT_SECRET
```

`path: /dev/server`로 파라미터를 찾으면, 전체 경로(`/dev/server/JWT_SECRET`)가 key로 사용됩니다.
K8s Secret key에 `/`는 허용되지 않아 `_`로 치환되면서 `_dev_server_JWT_SECRET`이 되어버린 거예요.

### 해결: rewrite regexp로 path prefix 제거

ExternalSecret 템플릿에 `rewrite` 필드를 추가합니다:

```yaml
# charts/goti-server/templates/externalsecret.yaml
dataFrom:
  - find:
      path: {{ .Values.externalSecret.remoteRef.path }}
      name:
        regexp: ".*"
    rewrite:
      - regexp:
          source: "^{{ .Values.externalSecret.remoteRef.path }}/(.*)$"
          target: "$1"
```

동작 원리를 살펴봅시다. values에서 `path: /dev/server`를 설정하면:

1. SSM에서 `/dev/server/*` 경로의 모든 파라미터를 찾습니다
2. rewrite regexp `^/dev/server/(.*)$`가 path prefix를 strip합니다
3. `/dev/server/JWT_SECRET` → `JWT_SECRET`
4. `/dev/server/DB_PASSWORD` → `DB_PASSWORD`

### 왜 이 방법이 근본적인가

단순히 하드코딩으로 prefix를 제거할 수도 있지만, `remoteRef.path` 값을 그대로 rewrite source에 사용하는 게 핵심이다.

- 경로가 바뀌어도 자동 대응 (`/prod/server`, `/staging/server`)
- 환경별로 path가 달라도 동일한 템플릿으로 동작
- 파라미터 추가/삭제 시 ExternalSecret 수정 불필요

개별 `data[]` 항목을 하나씩 나열하는 방식은 파라미터가 추가될 때마다 ExternalSecret을 수정해야 합니다.
`dataFrom.find` + `rewrite`를 사용하면 SSM에 파라미터만 추가하면 자동으로 반영돼요.

---

## 📚 배운 점

### 1. argocd-image-updater + multi-source 비호환

v0.16.0 기준으로 image-updater는 `source` (단수)만 지원합니다.
`images_skipped=1` 로그가 보이면 Application의 source 구조를 먼저 의심해야 해요.

### 2. 같은 레포의 chart + values는 single-source로

같은 Git 레포 안에 chart와 values가 있다면 `$values` ref가 필요 없습니다.
상대 경로(`../../environments/dev/...`)로 직접 참조하는 게 더 단순하고, image-updater 호환성도 확보됩니다.

### 3. Helm release 이름 suffix 주의

release 이름에 환경명(-dev, -prod)이 붙으면 생성되는 Secret, Service 등 리소스 이름도 변경됩니다.
`kubectl get secret -n <ns>`로 실제 이름을 확인한 뒤 참조해야 해요.

### 4. ExternalSecret dataFrom.find에는 rewrite 필수

SSM path prefix가 key에 포함되는 건 ExternalSecret의 기본 동작입니다.
`rewrite` regexp로 prefix를 strip하지 않으면 애플리케이션이 환경변수를 인식하지 못합니다.

---

## 요약

| 문제 | 원인 | 해결 |
|------|------|------|
| image-updater가 이미지 skip | multi-source Application 미지원 (v0.16.0) | single-source로 전환 |
| Pod가 Secret 못 찾음 | Helm release 이름 suffix로 인한 이름 불일치 | 실제 생성 이름으로 수정 |
| 환경변수명에 path prefix 포함 | dataFrom.find가 전체 경로를 key로 사용 | rewrite regexp로 prefix strip |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `goti-server-appset.yaml` | ArgoCD Application (source 구조 변경) |
| `charts/goti-server/templates/externalsecret.yaml` | ExternalSecret rewrite 추가 |
| `environments/dev/goti-server/values.yaml` | 이미지 태그, Secret 이름 참조 |
