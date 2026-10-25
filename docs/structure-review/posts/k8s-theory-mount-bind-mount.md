# mount와 bind mount — 같은 볼륨을 다른 경로에 제공하는 방법 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-mount-bind-mount.md](../../../src/content/essays/kubernetes/k8s-theory-mount-bind-mount.md)
- 시리즈: `k8s-theory-kernel` / 3
- 원문 SHA256: `65c1c02555234ecb8a90860715859cd730b487c4b8572250363e56339e4e0a10`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기본 흐름 유지·첫 사례와 해제 연결

## 독자와 중심 질문

같은 볼륨을 여러 Pod 경로에 제공해도 파일시스템이 복제되지 않는 이유와, 드라이버가 만든 mount가 호스트에 보이는 조건은 무엇일까요?

선행 개념: CSI stage·publish의 준비 대상과 파일 경로를 전제합니다. mount namespace·전파는 본문에서 새로 설명합니다

## 현재 전개

- L23: mount는 경로와 파일시스템 트리를 연결합니다
- L47: bind mount는 기존 트리에 연결 지점을 더합니다
- L72: CSI stage와 publish는 준비 결과와 제공 경로를 나눕니다
- L103: mount namespace는 프로세스가 보는 mount 목록을 나눕니다
- L125: CSI 드라이버가 만든 mount를 호스트가 보려면
- L155: 읽기 전용과 재귀 적용을 분리합니다
- L180: umount는 경로 연결과 사용 중인 참조를 함께 봅니다
- L197: 확인한 근거

## 원문 근거와 개선점

### L29 bind의 사용 결과보다 VFS 객체가 먼저 늘어납니다

> 여기서 경로 연결과 파일 데이터의 구조는 구분해야 합니다

mount가 경로를 가린다는 설명 뒤에 superblock·inode·dentry·vfsmount 참조를 읽고 나서 bind mount가 등장합니다. 커널 구조를 처음 보는 독자에게는 왜 그 객체들을 구분해야 하는지 아직 구체적이지 않습니다

수정 방향: 기존 트리를 다른 경로에서도 보게 하는 bind의 결과와 데이터 복제가 아니라는 설명을 먼저 둡니다. 이후 같은 데이터와 서로 다른 경로 연결을 VFS 객체 표로 해석합니다

### L180 경로 연결의 수명과 전파 설정을 구분해 읽게 합니다

> ## umount는 경로 연결과 사용 중인 참조를 함께 봅니다

CSI 공유 경로의 생성·정리를 짚은 뒤 namespace·전파·읽기 전용을 길게 거쳐 umount 참조가 나옵니다. 보이는 경로를 없앤 것과 실제 사용이 끝난 것의 관계를 앞의 CSI 정리와 다시 연결해야 합니다

수정 방향: 기본 bind와 CSI 공유 경로 다음에 정상 해제·열린 참조·lazy unmount의 차이를 묶습니다. 이어 namespace를 넘는 전파와 읽기 전용·재귀 조건을 다른 관점의 확장으로 설명합니다

## 권장 설명 순서

1. mount가 경로를 다른 트리에 연결하고 bind가 기존 트리의 접점을 더한다는 결과를 먼저 설명합니다
2. 같은 파일 데이터와 별도 mount를 VFS 객체로 해석하고 비재귀·재귀 bind의 차이를 붙입니다
3. stage에서 준비한 트리를 Pod별 publish target에 bind하는 가정 사례와 공유 소비자의 정리를 연결합니다
4. umount·열린 FD·lazy unmount를 통해 경로에서 사라짐과 실제 해제 완료를 구분합니다
5. mount namespace와 shared·slave 관계를 소개하고 CSI 드라이버에서 호스트로 전달할 mount 사건의 방향을 설명합니다
6. 읽기 전용·재귀 적용·런타임 지원 조건을 보충하며 파일 공유와 mount 사건 전파를 다시 구분합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

bind mount를 추가해도 파일 내용이 한 벌 더 생기는 것은 아닙니다
별도 경로 연결이 같은 트리를 가리키므로, 경로 하나를 해제하는 일과 다른 소비자의 사용까지 끝나는 일도 구분해야 합니다

## 유지할 내용과 조건

- stage mount·publish bind는 특정 구현을 가정한 사례이며 CSI가 동일 syscall을 강제하지 않는다는 범위를 유지합니다
- 재귀 bind와 이후 mount 사건 전파, 파일 내용 공유를 구분합니다
- shared·slave의 조합과 mount별 관계를 단일 namespace 속성으로 단순화하지 않습니다
- readOnly와 재귀 읽기 전용, lazy unmount와 실제 장치·외부 볼륨 정리 완료를 구분합니다

## 편집 후 독자 확인

- VFS 구조체를 읽기 전에 bind mount로 무엇이 늘고 무엇이 복제되지 않는지 설명할 수 있나요?
- 파일은 보이는데 새 mount는 안 보이는 상황을 이해할 수 있나요?
- mount 목록에서 경로가 사라졌다는 사실만으로 모든 사용이 끝났다고 판단하지 않나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
