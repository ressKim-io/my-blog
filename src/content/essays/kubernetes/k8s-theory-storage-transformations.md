---
title: "Kubernetes 저장 암호화 — 새 키를 설정해도 기존 데이터가 그대로인 이유"
excerpt: "API 서버가 저장된 데이터를 읽을 때와 새로 쓸 때 어떤 provider와 키를 고르는지 살펴봅니다. 키를 교체한 뒤 기존 데이터를 다시 기록해야 하는 이유와 저장 위치 검증, 암호화 설정을 다시 읽는 조건도 확인합니다"
category: "kubernetes"
tags: ["Kubernetes", "EncryptionAtRest", "etcd", "KMS", "StorageTransformer", "concept"]
series:
  name: "k8s-theory-api"
  order: 21
date: "2026-08-22"
---

저장 암호화를 켜도 이미 저장한 오브젝트가 즉시 암호문으로 바뀌지는 않습니다
반대로 키를 바꾸고 오브젝트를 같은 내용으로 갱신하면, 내용은 그대로인데 저장된 바이트는 새 키로 다시 기록될 수 있습니다

이 차이는 오브젝트를 직렬화하는 codec과 etcd 사이에 있는 **저장 변환기(storage transformer)**에서 나옵니다
저장 변환기는 쓸 때 직렬화된 바이트를 바꾸고, 읽을 때 저장된 바이트를 원래 형태로 되돌립니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 직렬화 다음에 저장 변환이 적용됩니다

[앞 글에서 살펴본 직렬화와 버전 변환](/essays/k8s-theory-serialization-version-conversion)은 어느 API 버전의 표현을 어떤 바이트 형식으로 적을지 정합니다
저장 변환은 그렇게 만든 바이트를 암호화하거나 그대로 통과시킬지 정합니다
따라서 저장 버전을 바꾸는 것과 저장 암호화 방식·키를 바꾸는 것은 별도 결정입니다

![쓰기에서는 codec 뒤에 저장 변환을 적용하고 읽기에서는 저장 변환을 되돌린 뒤 codec으로 복원하는 두 방향](/diagrams/k8s-theory-storage-transformations-1.svg)

[`value.Transformer`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/value/transformer.go)는 두 방향의 메서드를 묶습니다

| 메서드 | 입력과 결과 |
|---|---|
| `TransformToStorage` | 직렬화된 바이트를 받아 저장할 바이트와 오류 반환 |
| `TransformFromStorage` | 저장 바이트를 받아 복원한 바이트·`stale`·오류 반환 |

[`etcd3/store.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go)의 Get·Create·GuaranteedUpdate·LIST 처리와 [`watcher.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/watcher.go)의 이벤트 복원이 이 인터페이스를 호출합니다
API 서버가 etcd에서 값을 읽고 쓰는 지점의 설명이며, 캐시에서 응답하는 모든 API 요청마다 복호화를 다시 한다는 뜻은 아닙니다

암호화하지 않은 바이트를 이 글에서는 평문이라고 부릅니다
이는 사람이 바로 읽을 수 있는 JSON만 뜻하지 않으며, protobuf 등으로 직렬화했지만 암호화하지 않은 값도 포함합니다

## 접두사가 변환 방식과 읽을 키를 알려 줍니다

암호화한 값은 처음에 **접두사(prefix)**를 붙여 어느 변환기로 읽을지 표시합니다
접두사를 제거한 나머지가 실제 변환기의 입력이 됩니다

[`encryptionconfig/config.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/encryptionconfig/config.go)가 구성하는 다섯 provider의 차이는 다음과 같습니다
provider는 저장 변환 방식의 설정 항목입니다

| provider | 키를 얻는 곳 | 저장 값의 접두사 |
|---|---|---|
| `identity` | 키 없음, 암호화 없이 통과 | 빈 문자열 |
| `aescbc` | 설정 파일의 키 자료 | `k8s:enc:aescbc:v1:<키 이름>:` |
| `aesgcm` | 설정 파일의 키 자료 | `k8s:enc:aesgcm:v1:<키 이름>:` |
| `secretbox` | 설정 파일의 키 자료 | `k8s:enc:secretbox:v1:<키 이름>:` |
| `kms`, v2 기준 | 외부 키 관리 서비스와 KMS plugin | `k8s:enc:kms:v2:<provider 이름>:` |

직접 키를 설정하는 세 방식은 접두사에 **키 이름**을 넣습니다
KMS v2가 넣는 것은 **provider 이름**이며 외부 암호화 키의 식별자인 KeyID와 다릅니다
KeyID는 접두사 뒤의 암호화 오브젝트 안에 저장합니다

키를 직접 설정한 경우에는 접두사를 두 단계로 확인합니다
예를 들어 바깥 변환기는 `k8s:enc:aescbc:v1:`로 provider를 고르고, 안쪽 변환기는 `key1:` 같은 접두사로 그 provider의 키를 고릅니다
전체 저장 값의 모양을 설명하면 다음과 같습니다

```text
k8s:enc:aescbc:v1:key1:<암호화한 바이트>
```

이는 저장 형식을 설명하는 표기이며 실제 etcd 출력은 아닙니다

## 읽기 후보와 쓰기 대상은 같은 목록에서 나옵니다

`EncryptionConfiguration`의 `providers`는 순서가 있는 목록입니다
[공식 암호화 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/administer-cluster/encrypt-data.md#understanding-the-encryption-at-rest-configuration)도 첫 provider를 쓰기에 사용하고, 읽기는 저장 데이터와 맞는 provider를 순서대로 시도한다고 설명합니다

[`prefixTransformers.TransformToStorage`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/value/transformer.go)는 목록의 `transformers[0]`만 사용합니다
변환에 성공하면 그 변환기의 접두사를 결과 앞에 붙여 저장합니다
첫 변환기가 쓰기에 실패했다고 뒤의 옛 키나 평문 방식으로 바꿔 쓰지는 않습니다

읽기는 앞에서부터 접두사를 대조합니다
맞는 접두사를 제거하고 읽기를 시도한 뒤, 성공한 첫 결과를 반환합니다

같은 provider를 키만 다르게 두 번 설정하면 바깥 접두사는 겹칠 수 있습니다
앞의 `aescbc` 항목에 새 키만 있고 뒤의 `aescbc` 항목에 옛 키만 있다면, 옛 값은 앞 항목의 바깥 접두사에 맞아도 안쪽 키 선택에서 실패합니다

그래서 접두사가 한 번 맞았다는 이유만으로 탐색을 끝내지 않습니다
변환 오류가 나면 다음 후보도 시도하며, 이 규칙으로 새 방식으로 쓰면서 옛 방식으로 쓴 값도 계속 읽을 수 있습니다

### identity는 빈 접두사와 암호문 검사로 동작합니다

빈 문자열은 모든 바이트의 접두사입니다
따라서 `identity`를 단순 통과 변환기로만 구현하면 앞에 있을 때 암호문까지 평문으로 넘길 수 있습니다

[`identityTransformer.TransformFromStorage`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/value/encrypt/identity/identity.go)는 입력이 `k8s:enc:`로 시작하면 오류를 반환합니다
바깥 접두사 목록은 빈 접두사의 변환이 실패한 경우 다음 후보로 넘어가도록 처리합니다

| identity의 위치 | 앞으로 쓰는 값 | 읽을 수 있도록 남기는 값 |
|---|---|---|
| 첫 번째 항목 | 암호화하지 않은 직렬화 바이트 | 뒤의 암호화 provider로 읽는 기존 암호문 |
| 암호화 provider 뒤 | 첫 암호화 provider로 변환한 값 | 아직 암호화하지 않은 기존 값 |

이 순서 변경은 이후 쓰기의 방식을 바꿉니다
기존 값을 암호화하거나 다시 평문으로 바꾸는 작업까지 자동으로 수행하지는 않습니다

## stale은 읽기 실패와 다른 판정입니다

`TransformFromStorage`가 돌려주는 `stale`은 값을 복원했지만 현재 쓰는 방식으로 다시 기록할 필요가 있다는 신호입니다
내용이 잘못되었다는 뜻이 아닙니다

접두사 목록의 반환식은 `stale || i != 0`입니다
안쪽 변환기가 이미 stale이라고 판정했거나, 목록의 두 번째 이후 항목으로 읽었다면 최종 판정도 true입니다

이 규칙은 provider 목록뿐 아니라 직접 키 방식의 안쪽 키 목록에도 적용됩니다
같은 `aescbc` provider 안에서 두 번째 키로 읽었어도 바깥으로 stale 판정이 전달됩니다
키 목록 순서가 바뀌는 경우까지 포함해야 새 키로 재기록하는 동작을 설명할 수 있습니다

### 내용이 같아도 갱신 경로는 다시 쓸 수 있습니다

[`store.GuaranteedUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go)는 새로 직렬화한 바이트가 원래 바이트와 같으면 쓰기를 생략할 수 있습니다
이 최적화에는 `!origState.stale`이라는 조건이 함께 붙어 있습니다

![갱신한 내용이 같고 stale이 false일 때는 쓰기를 생략하며, stale이 true이면 현재 첫 변환기로 다시 쓰는 분기](/diagrams/k8s-theory-storage-transformations-2.svg)

stale이 true이면 내용이 같아도 이 조건을 통과하지 않습니다
현재 첫 변환기로 바이트를 만든 뒤 etcd에 쓰기를 시도합니다

이것이 오브젝트를 읽어 같은 내용으로 갱신해도 새 키로 다시 암호화할 수 있는 이유입니다
GET·LIST·watch는 복원 과정에서 받은 stale 값을 이용해 저장 값을 다시 쓰지 않습니다
읽기만 반복해도 암호화 방식이나 키가 바뀌지는 않습니다

쓰기 생략과 동시 수정 검사는 별개입니다
`GuaranteedUpdate`는 etcd에 쓸 때 기존 revision을 조건으로 사용하며, 다른 쓰기가 먼저 반영되어 충돌하면 현재 값을 다시 읽고 반복합니다
stale이 true라고 이 동시성 검사를 건너뛰지는 않습니다

## 키 회전은 새 키를 고르는 일과 기존 값을 다시 쓰는 일입니다

새 키를 키 목록의 맨 앞에 두면 이후 쓰기는 새 키를 사용합니다
옛 키를 읽기 후보로 남겨 두면 기존 값도 계속 복원할 수 있습니다
이 공존 구간에는 새 키로 쓴 값과 옛 키로 쓴 값이 함께 있습니다

기존 값까지 옮기려면 갱신이 필요합니다
그 값의 내용이 같아도 stale 때문에 쓰기 생략이 해제되므로 현재 쓰기 키로 다시 기록할 수 있습니다

API 서버가 여러 대라면 각 서버에 키를 배포하는 순서도 중요합니다
[공식 키 회전 절차](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/administer-cluster/encrypt-data.md#rotating-a-decryption-key)는 새 키를 먼저 두 번째 키로 모든 API 서버에 배포해 읽을 수 있게 한 뒤, 첫 키로 올리도록 설명합니다
어떤 서버가 새 키로 쓰기 시작했는데 다른 서버가 그 키를 모르면 서로 같은 데이터를 읽지 못할 수 있기 때문입니다

옛 키를 읽기 후보에서 제거하는 것은 기존 값의 재기록 뒤에 해야 합니다
재기록을 건너뛰고 제거하면 옛 키로 저장한 값은 그 키가 목록에 없는 동안 읽히지 않습니다

키 자료와 설정을 복구해 읽기 후보에 넣을 수 있는 경우와 키 자료 자체를 잃은 경우도 구분해야 합니다
특히 과거 백업에는 당시 키로 쓴 값이 남아 있을 수 있으므로, 현재 데이터의 재기록 여부만으로 예전 키의 보관 필요까지 판단하면 안 됩니다

## KMS v2는 설정 순서를 바꾸지 않아도 stale을 만들 수 있습니다

**KMS(Key Management Service)**는 암호화 키를 관리하는 외부 서비스입니다
API 서버는 KMS plugin을 통해 키 자료를 암호화·복호화하고, 데이터 자체는 내부 데이터 암호화 키로 변환합니다

KMS v2의 [`envelopeTransformer.TransformFromStorage`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/value/encrypt/envelope/kmsv2/envelope.go)는 저장한 오브젝트의 KeyID를 현재 쓰기 상태의 KeyID와 비교합니다
다르면 같은 provider로 읽기에 성공했어도 stale로 표시합니다
현재 구현은 `EncryptedDEKSourceType`이 달라진 경우와 내부 변환기의 stale 판정도 합칩니다
이 필드는 데이터 암호화 키 자료를 어떤 형태로 저장했는지 구분합니다

| stale 판정의 출처 | 비교 대상 |
|---|---|
| 바깥 provider 목록 | 읽기에 성공한 항목이 목록의 첫 번째인지 |
| 직접 키 방식의 안쪽 키 목록 | 읽기에 성공한 키가 첫 키인지 |
| KMS v2 내부 상태 | 저장한 KeyID·키 자료 유형이 현재 쓰기 상태와 같은지 |

따라서 KMS 키를 교체하면 암호화 설정 파일의 순서가 그대로여도 기존 값을 다시 기록해야 한다고 판단할 수 있습니다
파일 재적재와 KMS의 현재 키 상태 갱신을 같은 사건으로 취급하면 안 됩니다

[공식 KMS 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/administer-cluster/kms-provider.md)는 KMS v1이 v1.28부터 deprecated, v1.29부터 기본 off이고 KMS v2는 v1.29부터 stable이라고 설명합니다
v1.37.1에도 KMSv1 gate와 명시적 활성화 경로는 남아 있습니다
기본 비활성화와 구현 제거를 구분해야 하며, 이 글의 외부 키·캐시 설명은 KMS v2를 기준으로 합니다

### 복호화 캐시를 쓰기 키 상태로 재사용하지 않습니다

KMS v2는 복호화한 데이터 암호화 키 또는 그 키를 만들 seed에 대응하는 변환기를 캐시합니다
캐시에서 찾으면 이를 사용하고, 없으면 외부 서비스로 키 자료의 복호화를 요청합니다

[`simpleCache`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/value/encrypt/envelope/kmsv2/cache.go)는 `value.Transformer` 전체 대신 읽기 인터페이스인 `value.Read`만 보관합니다
저장소에서 복구한 키 자료로 만든 변환기는 암호화 nonce의 카운터 상태를 이어서 유지할 수 없으므로, 이 캐시의 변환기를 쓰기에 사용하지 못하게 타입으로 제한합니다
nonce는 같은 키로 암호화할 때 겹치지 않도록 다루는 값입니다

[`cacheTTL`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/value/encrypt/envelope/kmsv2/envelope.go)의 기본값은 24시간입니다
다만 캐시는 `AllowExpiredGet = true`로 구성되므로 이 숫자를 정확히 24시간 뒤마다 원격 복호화를 다시 한다는 보장으로 읽으면 안 됩니다
설정의 `cachesize`도 [KMS v1에만 허용되는 필드](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/apis/apiserver/v1/types_encryption.go)입니다

## 저장소의 키 문자열을 인증하는지는 provider마다 다릅니다

여기서 저장소의 키는 암호화 키가 아니라 etcd 안에서 오브젝트를 찾는 경로 문자열입니다
`etcd3/store.go`의 `authenticatedDataString`은 이 문자열을 `Context.AuthenticatedData()`로 변환기에 전달합니다

**AAD(Additional Authenticated Data)**는 암호화 대상 바이트 밖에서 무결성 검증에 함께 사용하는 데이터입니다
저장소 경로를 AAD로 쓰면 그 경로와 암호문이 함께 검증되므로, 값을 다른 경로로 옮긴 경우 복호화가 실패할 수 있습니다

[`aesgcm` 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/value/encrypt/aes/aes.go)은 `AEAD.Seal`과 `AEAD.Open`에 이 문맥을 전달합니다
KMS v2도 내부 AES-GCM 계열 변환기에 같은 문맥을 전달합니다

| provider | 저장소 경로 문맥의 사용 |
|---|---|
| `aesgcm` | AAD로 전달 |
| KMS v2 | 내부 데이터 변환기로 전달해 사용 |
| `aescbc` | 문맥 인자를 사용하지 않음 |
| `secretbox` | 문맥 인자를 사용하지 않음 |
| `identity` | 암호화하지 않음 |

[`secretbox`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/value/encrypt/secretbox/secretbox.go)가 저장소 경로를 인증하지 않는다는 것은 암호문 자체의 인증까지 없다는 뜻은 아닙니다
이 표가 구분하는 것은 provider별 **저장 위치와 암호문의 결합 여부**입니다
암호화를 켰다는 사실만으로 모든 provider에 같은 위치 검증을 기대하면 안 됩니다

## 자동 재적재는 새 변환기를 확인한 뒤 교체합니다

`--encryption-provider-config`는 설정 파일 경로를 지정합니다
`--encryption-provider-config-automatic-reload`는 그 파일의 변경을 자동으로 다시 읽게 합니다

[`EtcdOptions.Validate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/etcd.go)는 파일 경로 없이 자동 재적재만 켠 설정을 거부합니다
재적재를 켜지 않으면 실행 중인 프로세스는 파일을 고쳤다는 이유만으로 새 구성을 사용하지 않습니다

![기본 1분 주기로 설정 파일을 확인하고 새 변환기 구성과 상태 검사에 성공해야 교체하며 실패하면 기존 구성을 유지하는 흐름](/diagrams/k8s-theory-storage-transformations-3.svg)

[`DynamicEncryptionConfigContent`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/encryptionconfig/controller/controller.go)는 기본 1분 주기로 작업을 넣어 파일 내용 해시를 확인합니다
해시가 같으면 교체하지 않고, 다르면 새 변환기 집합을 만든 뒤 상태 검사를 수행합니다

구성과 검사에 성공해야 `dynamicTransformers.Set`을 호출합니다
실패하면 새 구성은 적용하지 않고 기존 변환기를 유지합니다
오류를 기록하고 작업을 다시 큐에 넣습니다
재시도 간격은 rate limit으로 조절합니다
다음 시도가 반드시 1분 뒤에만 이루어진다는 뜻은 아닙니다

재적재 오류나 상태 검사 실패가 있다면 서버는 계속 이전 방식으로 쓸 수 있습니다

## LIST의 손상 오류 처리는 게이트에 따라 달라집니다

etcd에서 읽은 항목 하나를 복원하지 못했을 때, 그 항목을 빼고 나머지만 정상 목록으로 반환하는 것은 아닙니다
다만 오류를 처음 만났을 때 즉시 멈출지, 손상된 항목 정보를 더 모을지는 버전과 gate에 따라 다릅니다

v1.35에서는 이 기능이 Alpha·기본 off였습니다
v1.37.1의 [`AllowUnsafeMalformedObjectDeletion`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/features/kube_features.go)은 emulated 1.37에서 Beta·기본 on입니다
[버전별 gate 선택](/essays/k8s-theory-version-emulation-rollback)에 따라 emulated를 1.36 이하로 낮추면 이전 Alpha·기본 off 스펙을 선택합니다

| gate 상태 | 저장소 LIST 오류 처리 |
|---|---|
| off | `abortOnFirstError`로 첫 오류에서 중단 |
| on | 손상 오브젝트 오류를 최대 100개까지 모으며, 다른 종류의 오류나 수집 한도에 도달하면 중단 |

[`corruptObjErrAggregator`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/corrupt_obj_deleter.go)는 항목의 저장소 키와 오류를 함께 모읍니다
LIST 마지막에는 모은 오류를 확인해 요청을 실패로 반환하므로, 수집 기능이 켜졌다고 손상된 항목을 제외한 정상 목록을 보장하지는 않습니다
이 설명은 해당 etcd 저장소 경로에 대한 것이며 캐시를 거친 응답이 항상 동일한 형식으로 오류 세부를 노출한다는 뜻도 아닙니다

이 기능은 복호화·디코딩하지 못하는 오브젝트를 별도의 조건으로 삭제할 수 있는 경로도 제공합니다
여기서는 삭제 절차가 아니라 손상 판정과 LIST 오류의 경계까지만 살펴봅니다

## 오류 문구가 가리키는 층을 구분합니다

다음은 소스의 오류 문구와 조건을 정리한 표이며 실제 수집한 로그는 아닙니다

| 증상 또는 문구 | 확인할 경계 |
|---|---|
| `data from the storage is not transformable` | 저장 변환 실패를 손상 오류로 감싼 경로. 키 부재·변환 오류 등의 내부 원인 확인 |
| `object not decodable` | 저장 변환 뒤 codec의 오브젝트 복원 단계 |
| `no matching prefix found` | 암호화 설정의 바깥 provider 목록에서 읽을 후보를 찾지 못함 |
| `no matching key was found for the provided AES transformer` | provider 접두사 뒤의 AES 키 이름 선택 |
| 옛 키를 뺀 뒤 일부 오브젝트를 읽지 못함 | 재기록 전에 읽기 후보를 제거했는지 |
| 파일을 고쳤는데 이전 방식으로 계속 씀 | 자동 재적재 활성 여부, 파일 감지와 새 구성·상태 검사 결과 |
| 암호화 설정 후에도 이전 값이 평문 | 설정 이후 그 값에 실제 갱신 쓰기가 있었는지 |
| 백업 복구 뒤 읽기 실패 | 백업 시점의 변환 방식과 키 자료가 남아 있는지 |
| 다른 저장소 경로로 복사한 암호문을 읽지 못함 | 해당 provider가 경로를 인증 데이터로 사용하는지 |

범용 `NewPrefixTransformers`의 기본 오류는 `the provided value does not match any of the supported transformers`입니다
암호화 설정의 바깥 목록과 안쪽 키 목록은 각각 별도의 오류를 전달하므로, 이 기본 문구 하나가 모든 접두사 실패에서 나온다고 가정하면 안 됩니다

## API로 읽을 권한과 저장 암호화의 역할은 다릅니다

저장 변환은 쓰기에서는 etcd에 넣기 전에 적용하고, 읽기에서는 etcd 값을 오브젝트로 복원하기 전에 되돌립니다
API 응답은 복원한 오브젝트에서 만들므로 암호화를 켜도 읽을 권한이 있는 사용자가 얻는 API 표현은 그대로입니다
Secret을 YAML로 읽으면 `data`의 값은 여전히 base64로 표현되며, 저장 암호문이 그대로 응답하는 것은 아닙니다

[API 요청 경로](/essays/k8s-theory-api-request-path)에서 인증·인가는 저장소 접근보다 앞에 있습니다
CREATE는 그 뒤 admission·validation도 거치지만 GET은 오브젝트를 생성하는 그 단계를 거치지 않습니다
저장 암호화가 RBAC의 읽기 권한을 추가로 제한해 주는 것은 아닙니다

저장 암호화는 etcd 데이터 파일이나 백업처럼 API 권한 검사를 거치지 않고 데이터에 접근하는 경우를 다룹니다
암호화 설정을 점검할 때는 실제 암호화 여부뿐 아니라 provider의 인증 조건, 읽기 후보에 남긴 키, 기존 값의 재기록 상태까지 함께 봐야 합니다
