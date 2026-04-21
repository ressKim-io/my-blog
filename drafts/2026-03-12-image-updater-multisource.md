---
date: 2026-03-12
type: troubleshoot
tags: [argocd, image-updater, multi-source, goti-server, externalsecret]
---

# [TROUBLE] argocd-image-updater가 multi-source Application에서 이미지 감지 못함

## 증상
- ECR에 `dev-b08daa9` 이미지 push 완료
- argocd-image-updater 로그: `images_considered=0 images_skipped=1 images_updated=0`
- goti-server pod가 `ImagePullBackOff` (존재하지 않는 `dev-latest` 태그 참조)

## 원인

**argocd-image-updater v0.16.0은 multi-source Application을 지원하지 않음**

goti-server-dev Application이 `sources` (복수) 구조를 사용:
```yaml
# multi-source — image-updater가 인식 못함
sources:
  - path: charts/goti-server
    helm:
      valueFiles:
        - $values/environments/dev/goti-server/values.yaml
  - ref: values
    repoURL: https://github.com/Team-Ikujo/Goti-k8s.git
```

image-updater는 `source` (단수)만 인식하므로, `sources` 구조에서는 이미지를 skip.

## 해결

### 즉시 수정
`environments/dev/goti-server/values.yaml`에서 태그를 수동 변경:
```yaml
image:
  tag: "dev-b08daa9"  # dev-latest → dev-b08daa9
```

### 근본 수정 — single-source 전환
같은 레포(`Goti-k8s`)에서 chart와 values를 모두 참조하므로 `$values` ref 불필요.
상대 경로로 직접 참조:

```yaml
# Before (multi-source)
sources:
  - path: charts/goti-server
    helm:
      valueFiles:
        - "$values/environments/dev/goti-server/values.yaml"
  - ref: values
    repoURL: https://github.com/Team-Ikujo/Goti-k8s.git

# After (single-source)
source:
  path: charts/goti-server
  helm:
    valueFiles:
      - "../../environments/dev/goti-server/values.yaml"
```

## 영향 범위
- `goti-server-appset.yaml`만 해당 (monitoring AppSet은 Helm chart repo가 별도라 multi-source 필수)
- 같은 레포 내 chart + values 조합만 single-source 전환 가능

## 추가 이슈: ExternalSecret 이름 불일치

### 증상
- Pod가 Secret `goti-server-secrets`를 찾지 못해 기동 실패

### 원인
- ExternalSecret 템플릿이 Helm release 이름을 포함하여 Secret 생성: `goti-server-dev-secrets`
- values.yaml의 `envFrom.secretRef.name`은 `-dev-` 없이 `goti-server-secrets`로 설정

### 해결
```yaml
# Before
envFrom:
  - secretRef:
      name: goti-server-secrets

# After
envFrom:
  - secretRef:
      name: goti-server-dev-secrets
```

### 패턴
모니터링 VirtualService destination host 불일치와 동일한 패턴. **Helm release 이름에 환경 suffix가 붙으면 생성되는 리소스 이름도 변경됨**. values.yaml에서 리소스를 이름으로 직접 참조할 때 반드시 실제 생성 이름 확인 필요.

## 추가 이슈: ExternalSecret dataFrom.find key prefix 문제

### 증상
- Pod 환경변수에 `JWT_SECRET`이 아닌 `_dev_server_JWT_SECRET`으로 주입됨
- SSM 파라미터 path가 Secret key에 포함되어 애플리케이션에서 인식 불가

### 원인
- `dataFrom.find`의 `path: /dev/server`로 SSM 파라미터 발견 시, 전체 경로(`/dev/server/JWT_SECRET`)가 key로 사용됨
- K8s Secret key에 `/`는 허용되지 않아 `_`로 치환 → `_dev_server_JWT_SECRET`

### 해결 — rewrite regexp
ExternalSecret 템플릿에 `rewrite` 필드를 추가하여 path prefix 자동 strip:

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

values에서 `path: /dev/server`를 설정하면:
- `^/dev/server/(.*)$` → `$1`
- `/dev/server/JWT_SECRET` → `JWT_SECRET` ✅
- `/dev/server/DB_PASSWORD` → `DB_PASSWORD` ✅

### 왜 이 방법이 근본적인가
- values.yaml의 `remoteRef.path` 값을 그대로 rewrite source에 사용 → **경로가 바뀌어도 자동 대응**
- 환경별로 path가 다르더라도 (`/prod/server`, `/staging/server`) 동일한 템플릿으로 동작
- 개별 `data[]` 항목을 나열할 필요 없음 → 파라미터 추가/삭제 시 ExternalSecret 수정 불필요

## 교훈
1. **argocd-image-updater + multi-source 비호환** — v0.16.0 기준. 향후 버전에서 지원 예정이지만 현재 미지원
2. **같은 레포 chart + values는 single-source로** — `$values` ref 없이 상대 경로 사용
3. **image-updater 로그 확인** — `images_skipped=1`이면 Application 구조 문제 의심
4. **Helm release 이름 suffix 주의** — release명에 환경명(-dev)이 붙으면 생성되는 Secret/Service 등 리소스 이름도 변경됨. `kubectl get secret -n <ns>`로 실제 이름 확인 후 참조
5. **ExternalSecret dataFrom.find에는 rewrite 필수** — SSM path prefix가 key에 포함되므로, `rewrite` regexp로 strip해야 애플리케이션이 올바른 환경변수명으로 인식
