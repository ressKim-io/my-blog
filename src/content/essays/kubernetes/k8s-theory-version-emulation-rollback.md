---
title: "버전 셋과 롤백 — 바이너리 교체와 기능 활성화를 나누는 이유"
excerpt: "컨트롤 플레인의 binary·emulated·min compat 버전이 현재 동작과 이후 데이터를 읽을 서버를 어떻게 구분하는지 살펴봅니다. 게이트 기본값, 저장 버전의 두 단계 선택, CEL 환경과 롤백의 한계를 연결합니다"
category: "kubernetes"
tags: ["Kubernetes", "CompatibilityVersion", "FeatureGate", "CEL", "Upgrade", "concept"]
series:
  name: "k8s-theory-api"
  order: 19
date: "2026-08-20"
---

새 바이너리를 배포한 순간 새 API와 저장 형식까지 모두 사용한다면, 실행 파일을 되돌리는 것만으로 롤백할 수 있을까요?
그 사이 이전 서버가 읽지 못하는 데이터를 저장했다면 바이너리 교체를 취소해도 문제가 남습니다

Kubernetes는 실행 파일의 버전, 동작을 맞출 버전, 호환 범위를 정하는 최소 버전을 나눕니다
[서빙 버전과 저장 버전을 구분한 앞 글](/essays/k8s-theory-serialization-version-conversion)에서 이어지는 질문은 이 두 버전의 선택 기준이 왜 다른가입니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 세 버전은 실행·동작·호환 범위를 나눕니다

**binary**는 배포한 실행 파일의 버전입니다
**emulated**는 그 실행 파일이 API와 기능 동작을 맞출 Kubernetes 버전입니다
**min compat**은 저장 버전과 검증 규칙 등에서 호환을 유지할 최소 버전입니다

[`--min-compatibility-version`의 소스 주석](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/compatibility/registry.go)은 이 값을 서버의 수명 동안 함께 실행할 것으로 예상하는 컨트롤 플레인 컴포넌트의 최소 바이너리 버전으로 설명합니다
현재 서버의 동작뿐 아니라, 함께 실행하거나 롤백 뒤 실행할 서버가 데이터를 읽을 조건을 정합니다

![binary는 실행 파일을, emulated는 현재 API 동작을, min compat은 저장과 검증의 호환 범위를 정하는 관계](/diagrams/k8s-theory-version-emulation-rollback-1.svg)

major·minor 기준의 관계는 `binary >= emulated >= min compat`입니다
v1.37.1 바이너리도 emulated를 1.36으로 두고, min compat을 1.35로 두는 구성이 허용 범위 안에 있습니다
실행 파일을 교체하는 시점과 API 동작·호환 범위를 바꾸는 시점을 나눌 수 있다는 뜻입니다

단, 이 설정이 실제 클러스터에 있는 모든 컴포넌트의 버전을 자동으로 조사해 일치시켜 주는 것은 아닙니다
이 글에서 다루는 검증은 각 프로세스에 설정한 버전 값의 범위 검증입니다

## 하한과 기본값은 함께 계산합니다

[공식 compatibility 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/cluster-administration/compatibility-version.md)는 버전 호환성과 emulation 옵션이 v1.32부터 도입되었다고 설명합니다
소스의 최소 버전 상수 `1.31`은 설정 하한을 계산할 때 쓰는 값이며, 기능이 도입된 릴리스와 구분해야 합니다

[`kubeEffectiveVersionFloors`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/compatibility/version.go)는 binary에서 minor 셋을 뺀 값과 `1.31` 중 더 높은 값을 하한으로 고릅니다
v1.37 계열에서는 이 값이 `1.34`입니다

| 값 | 설정 방법 | 기본값 | v1.37.1 바이너리의 허용 범위 |
|---|---|---|---|
| binary | 빌드로 결정 | 배포한 실행 파일의 버전 | 고정 |
| emulated | `--emulated-version` | binary의 major·minor | `1.34 .. 1.37` |
| min compat | `--min-compatibility-version` | `emulated - 1`, 하한보다 낮으면 하한으로 보정 | `1.34 .. emulated` |

[`SetEmulationVersion`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/compatibility/version.go)은 emulated를 설정하면서 기본 min compat도 다시 계산합니다
emulated가 1.37이면 기본 min compat은 1.36이고, emulated가 하한인 1.34이면 기본 min compat도 1.34입니다
1.33으로 더 내려가지는 않습니다

플래그 값은 `major.minor` 형식입니다
컴포넌트 이름을 생략하면 `kube`로 해석하므로 `--emulated-version=1.36`과 `--emulated-version=kube=1.36`은 같은 대상을 지정합니다

두 플래그는 kube-apiserver, kube-controller-manager, kube-scheduler의 옵션에 연결되어 있습니다
kubelet은 이 emulation 플래그를 제공하지 않습니다
컨트롤 플레인의 설정을 바꿨다고 kubelet 바이너리가 이전 버전 동작을 흉내 내는 것은 아닙니다

[`effectiveVersion.Validate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/compatibility/version.go)는 emulated가 하한과 binary 사이인지, min compat이 하한과 emulated 사이인지 검사합니다
도움말에 min compat의 범위가 binary까지 표시되어 있어도, 실제로 낮춰 둔 emulated보다 큰 min compat을 지정하면 검증에서 거부합니다

## emulated가 게이트의 단계와 기본값을 고릅니다

**Feature gate**는 기능의 활성 여부를 제어하는 스위치입니다
기능마다 하나의 기본값만 두는 것이 아니라, 버전별 `FeatureSpec` 목록에 단계와 기본값을 기록합니다

[`featureSpecAtEmulationAndMinCompatVersion`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/featuregate/feature_gate.go)은 목록의 뒤에서부터 다음 조건을 검사합니다

1. 항목의 `Version`이 emulated보다 높으면 건너뜁니다
2. 항목에 `MinCompatibilityVersion`이 있고 설정한 min compat이 그보다 낮으면 건너뜁니다
3. 두 조건을 통과한 첫 항목을 선택합니다

뒤에서 시작하므로 조건에 맞는 가장 최근 스펙을 바로 선택할 수 있습니다
모든 항목을 건너뛰면 `Default: false`, `PreRelease: PreAlpha`를 반환합니다
PreAlpha는 선택한 버전에 아직 없는 기능을 나타내며, 이를 `--feature-gates`로 지정하려고 하면 오류가 납니다

실제 예로 [`ComponentStatusz`의 버전 목록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/zpages/features/kube_features.go)에는 두 항목이 있습니다
`/statusz`는 컴포넌트의 시작 시각과 버전 등 상태 정보를 제공하는 경로입니다

| emulated | 선택되는 스펙 | 기본값 |
|---|---|---|
| 1.34 또는 1.35 | v1.32부터의 Alpha 항목 | off |
| 1.36 또는 1.37 | v1.36부터의 Beta 항목 | on |

같은 v1.37.1 바이너리에서도 emulated에 따라 선택이 달라집니다
문서에서 기본 on이라고 읽었어도 낮은 emulated로 실행한다면 이전 항목이 선택될 수 있습니다
기본값을 읽을 때는 binary뿐 아니라 emulated와 명시적인 gate 설정을 함께 확인해야 합니다

### min compat 때문에 Beta의 기본 활성화가 미뤄질 수도 있습니다

`Version`은 기능의 단계와 기본값을 적용할 동작 버전 조건입니다
`MinCompatibilityVersion`은 같은 버전의 다른 기본값을 선택하기 위한 추가 호환 조건입니다
Beta라는 단계와 기본 on은 같은 의미가 아닙니다

v1.37.1의 [`DRAFractionalCapacityRange`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)에는 같은 `Version: 1.37`에 다음 두 스펙이 있습니다

```go
{Version: version.MustParse("1.37"), Default: false, PreRelease: featuregate.Beta},
{Version: version.MustParse("1.37"), Default: true, PreRelease: featuregate.Beta, MinCompatibilityVersion: version.MustParse("1.37")},
```

| emulated | min compat | 선택 결과 |
|---|---|---|
| 1.36 | 1.35 | 1.37 스펙을 모두 건너뛰므로 PreAlpha |
| 1.37 | 1.36, 기본 설정 | 뒤 항목의 호환 조건을 충족하지 못하므로 Beta·기본 off |
| 1.37 | 1.37 | 뒤 항목을 선택하므로 Beta·기본 on |

이는 기본값 선택에 대한 설명입니다
min compat 조건이 있는 항목을 건너뛰었다고 해서 기능을 명시적으로 켜는 모든 경로까지 차단된다는 뜻은 아닙니다
선택된 Beta 항목의 기본값을 바꾸는 것과, 호환 범위를 바꿔 다른 항목이 선택되게 하는 것은 별도 동작입니다

이 필드의 사용 여부는 대상 버전의 실제 게이트 정의에서 확인해야 합니다

## 서빙 API도 emulated를 기준으로 걸러냅니다

서빙 API는 클라이언트가 요청할 수 있도록 서버가 제공하는 API입니다
기본 규칙은 emulated 이후에 도입된 API를 제외하고, emulated 이후에 제거된 API는 해당 시점의 동작에 맞춰 제공하는 것입니다
이 범위는 해당 바이너리에 구현이 남아 있는 기능을 전제로 합니다

[`InstallAPIs`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controlplane/apiserver/apis.go)는 API 수명 판정기에 `EffectiveVersion.EmulationVersion()`을 전달합니다
[`RemoveUnavailableKinds`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/deleted_kinds.go)는 리소스 타입의 `APILifecycleIntroduced`·`APILifecycleRemoved`를 대조해 서빙 대상의 저장소 맵을 정리합니다

여기의 저장소 맵은 요청을 처리할 REST storage handler의 등록 목록입니다
etcd에 이미 기록된 오브젝트를 지운다는 뜻은 아닙니다
제공할 API 경로를 고르는 일과 저장할 API 버전을 고르는 일을 구분해야 합니다

### 이후 버전을 함께 여는 경로는 두 가지입니다

| 플래그 | 적용 방식 |
|---|---|
| `--emulation-forward-compatible` | 켜져 있는 beta 이상의 API를 바탕으로 같은 리소스의 우선순위가 더 높은 후속 버전을 자동 활성화 |
| `--runtime-config-emulation-forward-compatible` | `--runtime-config`에서 명시적으로 활성화한 이후 API의 서빙을 허용 |

첫 경로는 같은 리소스의 낮은 우선순위 버전이 이미 켜져 있어야 합니다
예를 들어 v1beta1이 활성화되어 있을 때 후속 v1을 함께 제공할 수 있지만, 켜진 버전이 없는 그룹을 새로 여는 방식은 아닙니다
Alpha API는 이 자동 활성화의 출발점에서 제외됩니다

두 번째 경로 없이 emulated 이후 API를 runtime-config로 명시하면 기동 오류가 날 수 있습니다
구현은 이후에 도입된 개별 리소스의 명시적 활성화와, 버전 안의 리소스가 모두 제외되는 경우를 검사합니다
두 플래그 모두 emulated가 binary보다 낮은 경우에만 켤 수 있습니다

명시적으로 Alpha API를 켠 상태에서 이전 버전을 emulation하면 [`APIEnablementOptions.ApplyTo`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/api_enablement.go)가 경고를 남깁니다
경고의 `unsupported, proceed at your own risk`는 호환성이 보장되지 않는다는 뜻입니다
자동 활성화의 범위와 명시적 활성화 후 경고를 같은 결과로 취급하면 안 됩니다

### OpenAPI의 버전 정보도 emulated를 받습니다

OpenAPI는 API의 경로와 데이터 구조를 설명하는 문서입니다
[`Config.Complete`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/config.go)는 OpenAPI v2·v3를 완성하는 함수에 emulated를 전달합니다
두 함수는 별도 지정이 없는 `info.version`을 이 값으로 채웁니다

제공하지 않을 리소스를 REST storage 등록에서 제외하는 처리도 OpenAPI 모델 설치 전에 수행됩니다
다만 `info.version`을 채우는 코드만으로 모든 필드 스키마가 과거 릴리스와 완전히 같아진다고 결론 내릴 수는 없습니다
문서에 표시되는 버전과 API·필드별 동작의 호환 조건은 나눠 확인해야 합니다

## 저장 버전은 min compat을 먼저 보지만 예외가 있습니다

저장한 데이터는 현재 API 서버가 종료된 뒤에도 남습니다
그 데이터를 함께 실행하는 서버나 롤백한 서버가 다시 읽어야 하므로, 현재 서빙 동작만으로 저장 버전을 고르면 충분하지 않습니다

앞 글의 `StorageVersion`이 어떤 API 버전으로 기록할지를 나타냈다면, 여기서는 그 버전을 선택할 기준을 살펴봅니다
v1.37.1의 [`emulatedStorageVersion`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/storage/resource_encoding_config.go)은 우선순위가 높은 버전부터 **두 차례** 탐색합니다

![min compat 이하의 비 Alpha 저장 버전을 먼저 찾고, 없으면 emulated 이하의 버전에서 Alpha까지 포함해 다시 찾는 두 단계 선택](/diagrams/k8s-theory-version-emulation-rollback-2.svg)

첫 탐색에서는 내부 버전과 Alpha 버전을 건너뜁니다
남은 후보 중 도입 버전이 min compat 이하인 첫 버전을 선택합니다
Alpha API에는 버전 간 호환 보장이 없으므로 롤백 호환성을 남길 대상으로 우선 선택하지 않습니다

첫 탐색에서 후보를 찾지 못하면 두 번째 탐색으로 넘어갑니다
이번에는 내부 버전만 제외하고, emulated 이하에 도입된 버전 중 우선순위가 가장 높은 것을 고릅니다
Alpha만 있는 Kind나, 이전 버전이 Alpha인 새 Beta가 이 경로를 사용할 수 있습니다

두 번째 탐색도 실패하면 함수에 전달된 바이너리 기준 버전을 반환합니다
이때는 모든 버전이 emulated 이후에 도입된 경우이므로, 해당 리소스가 원래 서빙 대상에서 제외되어야 한다는 전제가 있습니다

타입에 도입 시점 정보가 없으면 그 조건으로 후보를 배제하지 않습니다
리소스별 저장 버전 override가 설정되어 있으면 이 탐색보다 override가 우선합니다
따라서 모든 리소스의 저장 버전이 예외 없이 min compat 이하라고 일반화하면 안 됩니다

## CEL도 새로 저장할 규칙과 이미 저장된 규칙을 나눕니다

**CEL(Common Expression Language)**은 오브젝트의 값이 조건을 만족하는지 표현하는 언어입니다
CRD(CustomResourceDefinition)는 커스텀 리소스의 종류와 스키마를 정의하는 API입니다
CRD의 `x-kubernetes-validations`에는 필드 값이나 필드 사이의 관계를 검사할 표현식을 문자열로 저장할 수 있습니다
API 서버는 커스텀 리소스의 생성·갱신 요청을 검증할 때 이 규칙을 평가합니다

표현식 문자열이 JSON으로 읽힌다고 해서 그 안의 함수를 구버전 서버가 이해하는 것은 아닙니다
저장 형식의 호환성과 표현식의 컴파일·평가 가능성은 별도 조건입니다

[`DefaultCompatibilityVersion`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/cel/environment/base.go)은 CEL 환경의 기본 호환 버전으로 min compat을 사용합니다
여기서 환경은 표현식에 쓸 수 있는 함수·변수·타입과 언어 옵션의 집합입니다

| 환경 | 사용하는 때 | 호환 범위 |
|---|---|---|
| `NewExpressions` | 새로 쓰거나 수정하는 표현식의 파싱·컴파일·타입 검사 | 지정한 호환 버전까지 도입된 옵션으로 제한 |
| `StoredExpressions` | 이미 저장된 표현식의 컴파일·실행 | 현재 구현이 아는 저장 표현식을 처리할 수 있도록 더 넓은 환경 사용 |

[`EnvSet`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/cel/environment/environment.go)은 두 환경을 함께 관리합니다
새 표현식을 저장하기 전에 제한하는 이유는, 그 문자열을 이후 구버전 서버도 읽고 평가할 가능성이 있기 때문입니다

`StoredExpressions`가 넓은 환경이라는 것은 현재 바이너리가 아는 범위의 설명입니다
이전 바이너리에 존재하지 않았던 최신 함수를 롤백 뒤에도 처리해 준다는 뜻은 아닙니다
min compat을 올려 최신 함수를 사용하는 규칙을 저장하면, 구버전이 그 규칙을 컴파일하지 못할 수 있습니다

## min compat을 올리는 결정은 저장 데이터까지 남습니다

min compat을 binary까지 올리면 지원하는 이전 버전으로의 롤백 범위를 남기지 않게 됩니다
관계식상 이 설정을 하려면 emulated도 binary의 major·minor와 같아야 합니다

[`registry.go`의 주석](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/compatibility/registry.go)은 모든 컨트롤 플레인 컴포넌트의 업그레이드 뒤 min compat을 binary와 같게 올릴 수 있다고 설명합니다
이후 호환성에 영향을 주는 기능과 최신 CEL 기능을 사용할 수 있지만, 롤백은 더 이상 지원되지 않는다고 명시합니다

이 설정 변경만으로 모든 롤백이 즉시 실패하는 것은 아닙니다
문제가 드러나는 시점은 이후 새 저장 버전으로 기록한 데이터나 새 CEL 함수를 사용한 규칙을 이전 서버가 읽거나 평가할 때일 수 있습니다

min compat을 다시 낮춰도 이미 저장된 바이트와 CEL 표현식이 자동으로 이전 형태로 돌아가지는 않습니다
설정을 되돌리는 것과 그 설정으로 남긴 오브젝트를 되돌리는 것은 별개입니다

저장 버전 마이그레이션도 이 차이를 없애지는 않습니다
`StorageVersionMigration`은 이미 저장한 데이터를 현재 저장 버전으로 옮기는 장치이며, 이전 바이너리로 돌아가기 위한 자동 역변환 절차가 아닙니다

이처럼 호환 범위를 남기기 위해 새 기능 사용을 미루는 것을 [초기 문서의 min compat 설명](https://github.com/kubernetes/website/commit/f0ca297ac692c70f20a0519a3e2d345707e4639d)에서는 *feature availability delay*라고 불렀습니다
저장 버전, 새 CEL 표현식 환경, 호환 조건이 붙은 gate의 기본값에서 그 지연이 나타날 수 있습니다

## 구현과 문서, 실제 응답을 구분해야 합니다

`--min-compatibility-version`은 [현재 고정 소스의 플래그 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/compatibility/registry.go)와 [공식 kube-apiserver CLI 참조](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/command-line-tools-reference/kube-apiserver.md)에 모두 있습니다
반면 같은 website 저장본의 compatibility 개념 페이지에는 emulated 설명만 있습니다

이 차이는 플래그가 없다는 근거가 되지 않습니다
[2024년 11월 5일의 문서 커밋](https://github.com/kubernetes/website/commit/f0ca297ac692c70f20a0519a3e2d345707e4639d)은 min compat 절을 삭제했고, [KEP-4330](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-architecture/4330-compatibility-versions/README.md#graduation-criteria)은 min compatibility version의 N-3 지원을 Beta 기준에 두고 있습니다
이는 문서의 삭제 이력과 설계 단계에 대한 근거이며, 현재 플래그 구현 여부는 현재 소스에서 따로 확인해야 합니다

### statusz의 문서 예시에도 차이가 남아 있습니다

[고정 z-pages 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/instrumentation/zpages.md)의 구조체 예시에는 `minimumCompatibilityVersion`이 있습니다
그러나 v1.37.1의 [`v1alpha1.Statusz`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/statusz/api/v1alpha1/types.go)와 [`v1beta1.Statusz`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/statusz/api/v1beta1/types.go)에는 이 필드가 없습니다

[두 응답을 생성하는 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/statusz/statusz.go)와 [텍스트 serializer](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/statusz/textserializer.go)도 binary와 emulated 정보를 사용하며 min compat 항목은 넣지 않습니다
소스와 문서의 차이는 확인했지만 실제 서버의 응답은 확인하지 않았습니다

경로를 여는 `ComponentStatusz`도 v1.35와 현재 기준을 나눠야 합니다
v1.37.1에서 emulated가 1.36 이상이면 Beta·기본 on이고, 1.34 또는 1.35로 낮추면 Alpha·기본 off인 항목을 선택합니다

## 증상은 어떤 선택에서 나왔는지 나눠 봅니다

다음 표는 실행한 실험 결과가 아니라 소스의 분기와 오류 문구를 바탕으로 한 확인 기준입니다

| 증상 또는 오류 문구 | 먼저 확인할 선택 |
|---|---|
| `emulation version ... is not between [...]` | emulated가 해당 binary의 하한과 상한 사이인지 |
| `minCompatibilityVersion version ... is not between [...]` | min compat이 하한 이상이고 emulated 이하인지 |
| emulated를 하한까지 내렸는데 min compat이 더 내려가지 않음 | 기본값이 같은 하한으로 보정되는지 |
| 이전에 보이던 API가 없음 | emulated 이후 도입된 리소스로 제외되었는지 |
| 제거된 것으로 알던 API가 보임 | 제거 시점보다 낮은 emulated를 유지하는지 |
| runtime-config 활성화 뒤 기동 오류 | 이후 도입된 리소스와 forward-compatible 플래그 조건 |
| `feature is PreAlpha at emulated version ...` | 조건을 만족하는 FeatureSpec이 하나도 없는지 |
| Beta인데 기본 off | 이전 버전 스펙 또는 min compat 조건에 따라 선택했는지 |
| 새 CEL 함수가 컴파일되지 않음 | 새 표현식 환경의 호환 버전이 해당 함수의 도입 버전보다 낮은지 |
| 저장 버전이 예상과 다름 | override, 비 Alpha 우선 탐색, emulated 기준 재탐색 중 어느 경로인지 |
| 롤백 뒤 오브젝트 읽기·평가 실패 | 새 저장 버전이나 CEL 기능을 사용한 데이터가 남았는지 |
| statusz에서 min compat 항목을 찾지 못함 | 문서 예시와 실제 바이너리의 응답 타입이 같은지 |

binary는 실행할 코드를 정하지만, emulated와 min compat은 그 코드가 지금 무엇을 제공하고 이후 어느 서버와 데이터를 공유할지를 나눕니다
업그레이드와 롤백의 조건을 판단할 때는 세 설정값에 더해, 그 설정으로 이미 저장한 오브젝트까지 함께 확인해야 합니다
