# StatefulSet과 볼륨 수명 — PVC를 지우기 전에 주인을 정합니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-statefulset-volume-lifecycle.md](../../../src/content/essays/kubernetes/k8s-theory-statefulset-volume-lifecycle.md)
- 시리즈: `k8s-theory-storage` / 4
- 원문 SHA256: `3e2207b865646db99abe87f33f6145e31bca555340a7eb2de7cfc482c614e78f`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

StatefulSet 복제본을 줄였다가 늘릴 때 같은 PVC를 다시 쓰는 조건과, PVC·PV·실제 저장소가 삭제되는 계기는 어떻게 다를까요?

선행 개념: PVC 바인딩·PV 회수 정책·오브젝트 UID의 기본 뜻을 전제합니다. ownerReferences는 삭제 수명을 연결하는 참조로 다시 짚습니다

## 현재 전개

- L22: 같은 서수가 새 Pod를 기존 PVC에 연결합니다
- L59: PVC를 먼저 만들고 Pod를 생성합니다
- L84: 두 보존 정책은 삭제 계기를 나눕니다
- L113: 삭제 정책은 PVC의 소유 참조로 바뀝니다
- L153: Pod의 종료 순서와 PVC 삭제 조건을 구분합니다
- L184: PVC 다음에는 PV의 회수 정책이 남습니다
- L205: Deployment와 비교할 기준은 복제본과 PVC의 대응입니다
- L222: PVC가 예상과 다르게 남을 때 확인할 것
- L236: 확인한 근거

## 원문 근거와 개선점

### L46 저장소 재사용 사례 중간에 DNS 성립 조건으로 벗어납니다

> DNS 이름에는 별도 조건이 있습니다

web-2와 data-web-2의 대응은 도입 질문을 잘 구체화합니다. 바로 뒤에 governing Service·selector·readiness·DNS 게시 조건이 이어져 PVC 생성과 재사용으로 돌아오기 전 다른 선행 개념이 늘어납니다

수정 방향: 첫 표에서는 복제본·PVC의 대응을 중심으로 설명하고 DNS 조건은 신원 안정성의 보충 절로 옮깁니다. 같은 UID가 아니라 같은 서수로 PVC를 찾는다는 흐름을 바로 생성·재사용과 연결합니다

### L78 stale 소유 참조 예외가 보존 정책보다 먼저 등장합니다

> 같은 이름만으로 재사용해도 되는지 추가 검사하는 경우도 있습니다

whenScaled: Delete와 이전 Pod UID 때문에 생성이 기다린다는 설명을 읽은 뒤에야 whenScaled·whenDeleted의 의미가 나옵니다. 예외의 원인을 뒤에서 소급 이해해야 합니다

수정 방향: 기본 Retain 재사용을 먼저 완결하고 두 삭제 정책과 ownerReferences 변환을 설명합니다. 이후 이전 UID의 삭제 예정 PVC를 재사용하면 안 되는 이유를 stale 검사와 연결합니다

## 권장 설명 순서

1. 3개에서 2개로 줄였다가 다시 늘리는 web-2 사례로 Pod UID 변화와 PVC 이름 대응을 보여줍니다
2. volumeClaimTemplates로 PVC를 먼저 만들고 Pod를 생성하며 기본 Retain에서 기존 PVC를 재사용하는 흐름을 설명합니다
3. whenScaled·whenDeleted를 삭제 계기별로 비교하고 ownerReferences가 StatefulSet·Pod 사이에서 바뀌는 이유를 풉니다
4. 이전 UID·소유권 충돌·stale PVC와 삭제 중 재사용 대기를 기본 흐름의 예외로 붙입니다
5. Pod 종료 순서·PVC 사용 중 보호·PV 회수·실제 저장소 삭제를 이어가며 각 완료 시점을 구분합니다
6. DNS 신원 조건과 Deployment·generic ephemeral 비교를 보충하고 PVC가 남은 이유를 확인하는 기준으로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

기본 Retain에서는 새 web-2가 같은 이름의 PVC를 다시 찾습니다
스케일다운 시 Delete를 선택했다면 그 PVC가 이전 Pod의 삭제를 따라갈 수 있으므로, 같은 이름이라는 이유만으로 바로 재사용할 수는 없습니다

## 유지할 내용과 조건

- Pod 이름·서수의 안정성과 오브젝트 UID의 변화, 데이터 영구 보장을 구분합니다
- 보존 정책의 ownerReferences 변환 표와 정상 반영 순서를 유지합니다
- PVC 보호가 실제 unmount 완료의 증거가 아니며 강제 삭제·orphan은 별도 조건임을 보존합니다
- Retain은 백업이 아니고 StatefulSet 정책과 PV reclaimPolicy가 다른 삭제 단계를 다룬다는 설명을 유지합니다

## 편집 후 독자 확인

- 기본 재사용 과정을 DNS 세부 없이 설명할 수 있나요?
- stale 검사 전에 whenScaled와 ownerReferences의 관계를 이해할 수 있나요?
- PVC 삭제와 실제 디스크 삭제의 담당자를 구분할 수 있나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
