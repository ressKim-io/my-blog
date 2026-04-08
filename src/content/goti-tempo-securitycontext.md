---
title: "Tempo securityContext 스키마 에러: Pod-level vs Container-level 혼동"
excerpt: "ArgoCD sync가 Unknown 상태 — allowPrivilegeEscalation을 Pod-level securityContext에 넣으면 structured merge diff 스키마 에러가 발생한다"
category: "kubernetes"
tags:
  - go-ti
  - tempo
  - securityContext
  - argocd
  - helm
  - troubleshooting
  - kind
series:
  name: "goti-kind-monitoring"
  order: 3
date: "2026-03-13"
---

## 🎯 한 줄 요약

> Tempo의 securityContext에 `allowPrivilegeEscalation`을 넣었더니 ArgoCD sync가 Unknown. Pod-level과 container-level securityContext는 허용하는 필드가 다르다.

## 📊 Impact

- **영향 범위**: Tempo 배포 불가 (ArgoCD Unknown 상태)
- **증상**: ArgoCD structured merge diff 스키마 에러
- **발생일**: 2026-03-13

---

## 🔥 상황: Tempo만 Unknown 상태

ArgoCD에서 모니터링 앱들의 sync 상태를 확인하고 있었습니다.
다른 앱들은 정상인데, `tempo-dev`만 `Unknown` 상태로 남아 있었습니다.

---

## 🤔 원인 분석: 스키마 에러

ArgoCD 에러 메시지를 확인했습니다:

```
Failed to compare desired state to live state:
failed to calculate diff:
error calculating structured merge diff:
error building typed value from config resource:
.spec.template.spec.securityContext.allowPrivilegeEscalation:
field not declared in schema
```

에러 메시지가 매우 명확합니다.
`.spec.template.spec.securityContext`에 `allowPrivilegeEscalation` 필드가 **스키마에 선언되어 있지 않다**고 합니다.

### 두 가지 가설

**가설 1: ArgoCD repo credential 미등록**

기각. 다른 앱들은 Synced 상태이고, 에러 메시지가 명확히 스키마 관련입니다.

**가설 2: securityContext 필드가 잘못된 위치에 있음**

채택. 이것이 정확한 원인이었습니다.

---

## 🤔 근본 원인: Pod-level vs Container-level securityContext

`helm show values grafana-community/tempo --version 1.24.4`로 chart 구조를 확인했습니다.

Tempo chart에는 securityContext를 설정하는 곳이 두 군데 있습니다:

| 위치 | Kubernetes 매핑 | 허용 필드 |
|------|-----------------|----------|
| 최상위 `securityContext` | Pod-level (`spec.securityContext`) | `runAsUser`, `runAsGroup`, `fsGroup`, `runAsNonRoot` |
| `tempo.securityContext` | Container-level (`spec.containers[].securityContext`) | `allowPrivilegeEscalation`, `capabilities`, `readOnlyRootFilesystem` 등 |

이 두 가지는 Kubernetes에서 완전히 다른 스키마입니다.

**Pod-level** securityContext는 `PodSecurityContext` 타입이고, **container-level**은 `SecurityContext` 타입입니다.
이름은 비슷하지만 허용하는 필드가 다릅니다.

`allowPrivilegeEscalation`과 `capabilities`는 `SecurityContext` (container-level)에만 존재하는 필드입니다.
이걸 `PodSecurityContext` (Pod-level)에 넣으면, Kubernetes 스키마에서 해당 필드를 인식하지 못합니다.

Helm template 렌더링은 통과하지만, ArgoCD가 structured merge diff를 계산할 때 스키마 검증에서 실패하는 것입니다.
**helm template으로는 이 에러를 감지할 수 없다는 것**이 까다로운 점입니다.

---

## ✅ 해결: 필드를 올바른 위치로 이동

Pod-level에는 Pod-level 전용 필드만, container-level에는 container-level 전용 필드를 넣었습니다:

```yaml
# Pod-level securityContext (최상위)
securityContext:
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
  runAsNonRoot: true

# Container-level securityContext (tempo.securityContext)
tempo:
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop:
        - ALL
    readOnlyRootFilesystem: true
```

수정 후 ArgoCD가 정상적으로 sync되어 Synced 상태를 확인했습니다.

---

## 📚 배운 점

### Pod-level vs Container-level securityContext 정리

Kubernetes securityContext는 두 가지 레벨이 있습니다.
이름이 비슷해서 헷갈리기 쉽지만, 허용하는 필드가 다릅니다.


**Pod-level (`PodSecurityContext`)**:

Pod 전체에 적용되는 보안 설정입니다.
- `runAsUser` / `runAsGroup`: Pod 내 모든 컨테이너의 실행 UID/GID
- `fsGroup`: 볼륨 마운트 시 그룹 소유권
- `runAsNonRoot`: root 실행 차단

**Container-level (`SecurityContext`)**:

개별 컨테이너에 적용되는 보안 설정입니다.
- `allowPrivilegeEscalation`: 권한 상승 허용 여부
- `capabilities`: Linux capability 추가/제거
- `readOnlyRootFilesystem`: 읽기 전용 루트 파일시스템

### helm template으로 감지 불가

이 에러의 까다로운 점은 `helm template` dry-run으로는 감지할 수 없다는 것입니다.
Helm은 YAML 렌더링만 수행하고, Kubernetes 스키마 검증은 하지 않습니다.

ArgoCD의 structured merge diff가 실제 Kubernetes 스키마와 비교할 때 비로소 에러가 발생합니다.
CI에서 `helm template`을 돌려도 이 문제는 통과합니다.

### 재발 방지

Helm chart에서 securityContext를 설정할 때 주석으로 레벨을 명시하는 패턴을 적용하기로 했습니다:

```yaml
# Pod-level (PodSecurityContext) — runAsUser, fsGroup 등만 허용
securityContext:
  runAsUser: 10001

# Container-level (SecurityContext) — allowPrivilegeEscalation, capabilities 등
tempo:
  securityContext:
    allowPrivilegeEscalation: false
```

주석 한 줄이 혼동을 방지해줍니다.
