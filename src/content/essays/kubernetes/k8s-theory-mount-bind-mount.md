---
title: "mount와 bind mount — 같은 볼륨을 다른 경로에 제공하는 방법"
excerpt: "mount의 경로 연결과 bind의 트리 재사용을 CSI stage·publish에 연결합니다. mount namespace와 전파 방향, 재귀 bind·읽기 전용의 차이, 열린 파일 참조와 lazy detach의 수명을 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "Linux", "Mount", "CSI", "Namespace", "concept"]
series:
  name: "k8s-theory-kernel"
  order: 3
date: "2026-10-24"
---

같은 노드의 여러 Pod가 한 볼륨을 사용할 때, 각 Pod에 경로를 제공한다고 파일시스템도 매번 새로 만드는 것은 아닙니다
이미 준비한 트리를 다른 경로에 연결하는 **bind mount**를 사용할 수 있기 때문입니다

이 구분을 알면 CSI의 stage와 publish가 왜 다른 경로를 준비하는지 설명할 수 있습니다
드라이버 컨테이너 안에서 만든 mount를 호스트가 보려면 무엇이 필요한지도 mount namespace와 전파 관계로 이어집니다

> **근거**: Linux LTS v6.18.58 `2926d88bb7fc4608fd942453d929c39e4e5ec006`의 공식 소스와 문서를 대조했습니다
> 사용자 공간 인터페이스 문서는 Linux man-pages 6.20 공식 배포본을 확인했습니다. 커널 버전과 man-pages 버전은 별개입니다
> Kubernetes는 v1.37.1과 공식 문서 고정본, CSI는 해당 코어가 의존하는 규격을 기준으로 확인했습니다
> mount 명령이나 노드 실습을 실행한 기록은 포함하지 않습니다

## mount는 경로와 파일시스템 트리를 연결합니다

디렉터리 위에 파일시스템을 mount하면 그 경로를 새로 탐색하는 접근은 붙인 파일시스템 쪽으로 이어집니다
원래 디렉터리와 그 내용이 삭제되는 것은 아닙니다
해당 mount가 해제되면 가려져 있던 경로가 다시 보일 수 있습니다

여기서 경로 연결과 파일 데이터의 구조는 구분해야 합니다
Linux의 VFS(Virtual Filesystem)는 여러 파일시스템을 공통 인터페이스로 다루며 다음 객체를 사용합니다

| 객체 | 여기서 필요한 역할 |
|---|---|
| superblock | 파일시스템 인스턴스의 정보와 루트 등을 관리 |
| inode | 파일·디렉터리의 메타데이터와 연산 등을 표현 |
| dentry | 부모·이름과 inode의 연결을 표현, 아직 inode가 없는 항목도 가능 |
| mount | 어느 파일시스템 트리의 어느 지점을 경로에 연결할지 표현 |

커널의 `struct vfsmount`는 `mnt_sb`로 superblock을, `mnt_root`로 연결할 트리의 루트 dentry를 참조합니다
`struct path`는 mount와 dentry의 쌍입니다
같은 파일을 가리키더라도 어느 mount를 통해 접근하느냐가 경로와 mount 속성에 영향을 줍니다

mount 하나가 늘었다고 새 superblock·inode·파일 내용이 한 벌씩 만들어진다고 볼 수는 없습니다
일반 파일시스템 mount에서도 준비된 superblock을 연결하는 과정과 mount 객체를 만드는 과정은 다릅니다
bind mount는 기존 트리를 재사용한다는 차이가 더 직접적으로 드러납니다

## bind mount는 기존 트리에 연결 지점을 더합니다

Bind mount는 이미 접근할 수 있는 파일이나 디렉터리 하위 트리를 다른 지점에도 보이게 합니다
파일 데이터를 복사하거나 새 파일시스템을 포맷하는 동작이 아닙니다

Linux v6.18.58의 `__do_loopback`은 비재귀 bind에 `clone_mnt`를 사용합니다
새 mount 객체를 만들면서 원본 경로의 dentry를 루트로 연결하고, 그 dentry의 superblock을 참조합니다
원본 mount 전체의 루트 대신 그 안의 하위 디렉터리를 bind할 수도 있습니다

연결한 것은 원본 경로의 문자열을 매번 다시 해석하는 링크가 아닙니다
어떤 트리를 참조하는지와 그 트리에 도달하는 경로의 이름은 별개입니다
파일 내용의 일관성·접근 권한·동시 쓰기 안전성까지 bind가 새로 보장하는 것도 아닙니다

### 하위 mount를 포함할지는 별도입니다

기본 bind는 비재귀입니다
원본 디렉터리 아래에 다른 파일시스템이 mount돼 있다면 그 하위 mount까지 그대로 복제하지 않습니다
그 mount가 덮고 있던 디렉터리가 bind 대상에서 보일 수 있습니다

`MS_BIND`에 `MS_REC`를 함께 주면 재귀 bind가 되어 하위 mount도 대응하는 위치에 복제합니다
단, `unbindable`인 하위 mount는 재귀 복제에서 제외됩니다

이후 새로운 mount가 생겼을 때 어디까지 보이는지는 다시 전파 관계의 문제입니다
재귀 bind로 현재의 하위 mount를 복제한 것과, 앞으로의 mount 사건을 전파하는 것은 같은 설정이 아닙니다

## CSI stage와 publish는 준비 결과와 제공 경로를 나눕니다

[attach·stage·publish](/essays/k8s-theory-volume-attach-stage-publish)의 경로 분리를 mount 관점에서 볼 수 있습니다
stage는 노드의 볼륨 준비 경로를, publish는 워크로드가 사용할 target path를 준비합니다
드라이버가 `STAGE_UNSTAGE_VOLUME` capability를 제공하면 `NodeStageVolume`이 성공한 뒤 `NodePublishVolume`을 호출해야 합니다
제공하지 않는 드라이버에는 stage RPC를 생략합니다

현재 kubelet의 `csiAttacher.MountDevice`는 이 capability를 확인해 stage 호출 여부를 나눕니다
`csiMountMgr.SetUpAt`은 Pod UID 등을 사용해 정한 target path를 `NodePublishVolume`에 전달합니다
이 코드가 모든 드라이버 대신 같은 mount syscall을 실행하는 구조는 아닙니다

다음은 **stage에서 파일시스템을 mount하고 publish마다 bind mount하는 구현을 가정한 예시**입니다
볼륨의 접근 모드와 드라이버가 같은 노드의 여러 target을 허용한다는 전제가 있습니다

![노드의 staging mount 하나를 Pod A와 Pod B의 publish target에 bind하는 구현 예시|tall](/diagrams/k8s-theory-mount-bind-mount-1.svg)

이 예시에서 Pod마다 target 하나와 bind mount 하나를 만들면 staging mount 하나와 Pod별 bind 둘을 셉니다
`1 + Pod 수`라는 계산은 이 구현과 집계 범위에서만 성립합니다
stage를 생략한 드라이버·블록 볼륨·여러 publish target, 전파로 복제된 mount·컨테이너 런타임의 mount까지 묶는 보편식은 아닙니다

CSI는 경로·순서·멱등성을 정하고 실제 준비 방식은 드라이버에 맡깁니다
장치를 여는지, 파일시스템을 준비하는지, 이미 준비된 경로를 bind하는지는 해당 구현을 봐야 합니다
같은 장치를 두 번 mount하면 반드시 파일시스템이 깨진다는 결론도 이 계약에서 나오지 않습니다

RPC가 실패하거나 결과가 불명확하면 같은 요청을 다시 보낼 수 있습니다
따라서 stage의 “한 번”을 mount syscall 호출 횟수와 같게 읽으면 안 됩니다

정리할 때는 해당 볼륨의 모든 `NodeUnpublishVolume`이 성공한 뒤 `NodeUnstageVolume`을 호출합니다
예시 구현에서는 Pod별 bind를 먼저 풀고 마지막에 공용 staging 경로를 정리하는 모양입니다
경로를 공유하는 소비자가 남아 있는지와 정리 성공을 함께 관리해야 합니다

## mount namespace는 mount 목록의 뷰를 나눕니다

같은 mount namespace에 속한 프로세스는 같은 mount 목록을 봅니다
새 mount namespace를 만들면 호출자 쪽 목록을 복사해 시작하지만 파일 데이터까지 복제하는 것은 아닙니다
그 뒤의 mount·umount가 다른 namespace에 보이는지는 전파 관계에 따라 달라집니다

전파 속성은 namespace 전체에 하나로 붙는 값이 아니라 mount별 관계입니다
같은 namespace 안에도 서로 다른 속성을 가진 mount가 있을 수 있고, 서로 다른 namespace의 mount가 같은 전파 관계에 참여할 수도 있습니다

| 속성 | mount·umount 사건의 전달 |
|---|---|
| shared | 같은 peer group에서 양방향 전파 |
| slave | master 쪽 사건을 받고 그쪽으로 되돌려 보내지 않음 |
| private | 전파를 주고받지 않음 |
| unbindable | private처럼 동작하며 bind 원본으로 사용할 수 없음 |

하나의 mount가 상위 peer group의 slave이면서 자기 peer들과 shared일 수도 있습니다
네 값을 모든 관계에서 배타적인 단일 상태처럼 읽으면 이 조합을 놓칩니다

전파는 파일 내용의 복사가 아니라 하위 mount·umount 사건의 복제입니다
이를 구분해야 “파일은 같이 보이는데 새 mount는 보이지 않는” 상황도 설명할 수 있습니다

## CSI 드라이버가 만든 mount를 호스트가 보려면

별도 mount namespace의 CSI node plugin이 호스트와 연결한 경로 아래에 mount를 만든다고 가정하겠습니다
호스트의 kubelet이 그 결과를 보려면 해당 mount 사건이 호스트 쪽으로 전달될 관계가 필요합니다
같은 namespace를 사용하거나 다른 방법으로 경로를 준비하는 배포까지 똑같은 전파 구성을 요구하는 것은 아닙니다

Kubernetes의 `volumeMounts[*].mountPropagation`은 이 방향을 선택합니다

| 값 | Linux 전파 방식과 확인할 조건 |
|---|---|
| `None` | 기본값, 의도한 대응은 `rprivate`. CRI 런타임이 적용할 수 없는 경우 `rslave`를 선택할 수 있음 |
| `HostToContainer` | `rslave`, 호스트 쪽 mount를 받아 보며 컨테이너에서 호스트로는 보내지 않음 |
| `Bidirectional` | `rshared`, 필요한 peer 관계 아래에서 양방향으로 전달 |

여기서 `r`은 하위 mount까지 전파 속성을 재귀적으로 바꾼다는 뜻입니다
앞서 `MS_BIND | MS_REC`로 하위 mount를 복제한 것과 `MS_REC`를 사용하는 호출 맥락이 다릅니다

![호스트에서 컨테이너로만 mount 사건을 보내는 HostToContainer와 양방향으로 보내는 Bidirectional의 비교](/diagrams/k8s-theory-mount-bind-mount-2.svg)

이 배포에서 `HostToContainer`는 호스트가 만든 mount를 드라이버에 보여 줍니다
드라이버가 만든 mount를 호스트의 kubelet에 보여 주는 반대 방향에는 충분하지 않습니다
CSI 배포 문서가 이 경우의 드라이버 mount 경로에 `Bidirectional`을 요구하는 이유입니다

Kubernetes는 `Bidirectional`을 사용하는 컨테이너에 `securityContext.privileged: true`를 요구합니다
이는 그 전파 방식을 쓰는 컨테이너에 대한 검증이며 모든 CSI sidecar와 controller에 같은 권한을 요구한다는 뜻은 아닙니다
호스트 경로의 mount를 바꾸는 영향이 있으므로 생성한 mount의 정리도 배포가 책임져야 합니다

공식 문서는 전파가 모든 볼륨 타입에서 일관되게 동작하지 않는다고 설명합니다
사용 권장 범위도 `hostPath` 또는 메모리 기반 `emptyDir`로 좁혀 안내하므로, 모든 볼륨에 같은 효과를 보장하는 옵션으로 보면 안 됩니다

## 읽기 전용과 재귀 적용을 분리합니다

기존 `mount(2)`의 bind 생성에서는 `MS_RDONLY` 같은 나머지 플래그가 새 읽기 전용 설정으로 적용되지 않습니다
원본 mount의 속성을 이어받습니다
이 API로 별도 읽기 전용 bind를 만들려면 bind 후 `MS_REMOUNT | MS_BIND`와 읽기 전용 플래그로 해당 mount의 속성을 바꾸는 방법을 사용합니다

이때 바뀌는 것은 그 mount를 통한 접근입니다
같은 파일시스템을 가리키는 원본 경로나 다른 mount까지 모두 읽기 전용으로 만드는 것은 아닙니다
기존 보안·접근 속성을 유지하려면 remount 때 보존할 플래그도 함께 다뤄야 합니다

이 설명을 모든 최신 mount API의 필수 syscall 횟수로 일반화하면 안 됩니다
Linux에는 `mount_setattr(2)`도 있습니다
`MOUNT_ATTR_RDONLY`로 mount 속성을 바꾸고 `AT_RECURSIVE`로 mount 트리 전체에 적용할 수 있습니다
지원 여부와 권한·잠긴 속성 등 실제 호출 조건은 별도로 확인해야 합니다

Kubernetes의 `readOnly: true`도 Linux에서 하위 mount까지 자동으로 읽기 전용으로 만드는 설정은 아닙니다
그 아래 읽기·쓰기가 가능한 다른 파일시스템이 mount돼 있으면 해당 하위 경로는 쓰기가 가능할 수 있습니다

현재 Kubernetes의 재귀 읽기 전용 설정은 `recursiveReadOnly`로 구분합니다
`Enabled`나 `IfPossible`을 쓰려면 `readOnly: true`와 `mountPropagation` 미설정 또는 `None`이 필요합니다

`Enabled`는 Linux 5.12 이상과 이를 지원하는 CRI·OCI 런타임이 필요하며 조건을 충족하지 못하면 실패합니다
`IfPossible`은 커널·런타임 지원이 없을 때 `Disabled`로 대체할 수 있지만, readOnly·전파 값의 API 검증 조건까지 무시하지는 않습니다
기능 게이트가 기본 활성인 것과 실제 런타임에서 적용된 것은 구분해야 합니다

## umount는 경로 연결과 사용 중인 참조를 함께 봅니다

경로 위에 새 mount를 올리거나 연결을 해제해도 이미 열린 파일은 경로 문자열을 매번 처음부터 찾지 않습니다
커널의 `struct file`은 `f_path`에 mount·dentry의 참조를 보관합니다
따라서 경로에서 보이지 않게 된 것과 열린 파일의 참조가 사라진 것은 다른 시점입니다

일반 umount는 사용 중인 mount에 `EBUSY`로 실패할 수 있습니다
열린 파일이나 작업 디렉터리 같은 참조, 하위 mount와 전파 관계도 확인할 대상입니다
단순히 mount 목록에 한 줄이 있는지만으로 정리 가능 여부를 판단할 수는 없습니다

`MNT_DETACH`를 사용하는 lazy unmount는 해당 mount 트리를 경로 목록에서 먼저 떼어 냅니다
기존 참조가 남아 있으면 실제 자원 정리는 나중까지 미뤄질 수 있습니다
기존 fd에서 가능한 접근까지 모두 즉시 끊었다거나, 파일시스템·장치·외부 볼륨의 정리가 완료됐다는 뜻은 아닙니다

해제 사건 역시 shared·slave 관계를 따라 전파될 수 있습니다
한 namespace에서 경로가 사라졌다는 관측만으로 다른 namespace의 mount나 CSI 소비자 참조가 전부 정리됐다고 판단해서는 안 됩니다

## 확인한 근거

- [Linux v6.18.58 namespace.c](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/fs/namespace.c): `setup_mnt`·`clone_mnt`·`__do_loopback`·`do_umount`·`mount_setattr_prepare/commit`
- [vfsmount 정의](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/linux/mount.h), [path 정의](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/linux/path.h), [file·inode·superblock 정의](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/linux/fs.h), [dentry 정의](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/linux/dcache.h)
- [LTS 커널의 Shared Subtrees 문서](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/filesystems/sharedsubtree.rst), [Linux man-pages 6.20 공식 배포](https://www.kernel.org/pub/linux/docs/man-pages/): `mount(2)`·`mount_setattr(2)`·`umount(2)`·`mount_namespaces(7)`
- [Kubernetes의 mount 전파·읽기 전용 문서 고정본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/volumes.md), [전파·재귀 읽기 전용 API 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)
- [CSI stage 호출](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_attacher.go), [Pod별 target과 publish 호출](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_mounter.go), [코어의 CSI 의존 버전](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/go.mod)
- [해당 CSI 고정 규격](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md): stage·publish·unpublish·unstage 순서와 멱등성, [CSI 드라이버 배포 문서 고정본](https://github.com/kubernetes-csi/docs/blob/67fe654a3246ad5c5cd212a0f4859706f9970353/book/src/deploying.md): 별도 namespace에서 만든 mount를 호스트에 제공하는 경로
