# 용량 기반 스케줄링 — 아직 없는 볼륨의 크기를 무엇과 비교하나 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-storage-capacity-scheduling.md](../../../src/content/essays/kubernetes/k8s-theory-storage-capacity-scheduling.md)
- 시리즈: `k8s-theory-storage` / 7
- 원문 SHA256: `266243d9f2be9ade903180835adfc48c6cbd5afc69ff4f63aeea66f49be3857c`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

WFFC에서 아직 만들지 않은 볼륨의 용량을 스케줄러는 무엇과 비교하며, 검사를 통과해도 생성이 실패할 수 있는 이유는 무엇일까요?

선행 개념: WFFC의 노드 선택과 동적 공급, 스케줄러 Filter·Score의 차이를 전제합니다. topology는 접근 가능한 노드 조건으로 정의합니다

## 현재 전개

- L21: 용량 검사는 새 볼륨을 만들어야 할 때 나옵니다
- L47: 일반적인 CSI 배포에서는 external-provisioner가 용량을 기록합니다
- L79: 정보가 없는 경우와 검사에 참여하지 않는 경우는 다릅니다
- L107: Filter는 단일 볼륨 한도를 우선 비교합니다
- L141: v1.37에서는 용량 점수도 기본으로 사용합니다
- L178: 보고 주기와 정리는 external-provisioner 설정에 달려 있습니다
- L211: 후보 노드 선택은 공간 예약이 아닙니다
- L233: Pending 사유에서 다음 확인으로 이어갑니다
- L247: 확인한 근거

## 원문 근거와 개선점

### L211 Filter 통과의 한계를 설정 상세보다 먼저 닫습니다

> ## 후보 노드 선택은 공간 예약이 아닙니다

적용 경로·정보 생산·참여 여부·크기 비교까지는 중심 질문에 맞습니다. 그러나 선택 뒤 실제 생성과 실패가 어떻게 이어지는지는 Score와 producer 설정·소유 참조를 읽은 뒤에 나옵니다

수정 방향: 기본 Filter 설명 직후 selected-node·PreBind·CreateVolume으로 이어지는 흐름과 예약이 아니라는 한계를 설명합니다. Score와 보고 주기는 그 한계를 이해한 뒤 읽을 확장 단위로 둡니다

### L178 정보의 생산과 운영 수명을 구분합니다

> ## 보고 주기와 정리는 external-provisioner 설정에 달려 있습니다

전반부에서는 producer가 GetCapacity 결과를 기록한다고 설명하고, 후반부에서 활성화 기본값·topology 수집·ownerRef가 함께 나옵니다. 기본 검사를 사용하려면 producer 활성화가 필요하다는 연결은 일찍 알아야 하지만 상세 정리 정책까지 먼저 읽을 필요는 없습니다

수정 방향: 정보 생산 소개와 참여 선언 절에서 producer 활성화와 실제 게시 여부를 간단히 연결합니다. 주기·namespace·ownerRef·정리는 별도 운영 절로 유지하고 최대 지연 보장으로 오해하지 않게 합니다

## 권장 설명 순서

1. WFFC 동적 공급에서만 새 볼륨의 용량 검사를 사용하는 범위를 기존 PV 경로와 대비합니다
2. provisioner의 GetCapacity·API 기록·scheduler 캐시와 producer 활성화·소비 옵트인의 두 조건을 설명합니다
3. 정보 없음과 미참여를 구분하고 StorageClass·크기·접근 조건 및 maximumVolumeSize 우선 비교를 풉니다
4. 선택 노드 전달·PreBind·실제 생성까지 따라가며 Filter 통과가 예약이 아닌 이유와 조건부 재선택을 설명합니다
5. Filter와 다른 입력을 쓰는 용량 Score, 정적·동적 분기, 다른 점수와의 관계를 확장합니다
6. 보고 주기·topology 수집·정보 오브젝트 정리를 보충한 뒤 Pending의 실제 공간 부족과 미보고를 구분합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

이 검사는 보고된 정보를 읽어 후보 노드를 고를 뿐 저장소 공간을 차감하지 않습니다
따라서 선택 결과가 provisioner에 전달된 뒤 실제 볼륨을 만들기 전까지 다른 요청이 공간을 사용할 수 있습니다

## 유지할 내용과 조건

- 기능 미참여와 참여 후 정보 미보고의 서로 다른 결과를 보존합니다
- Filter의 maximumVolumeSize 우선 비교와 Score의 capacity 입력을 합치지 않습니다
- 정적·동적 혼합 Score의 실제 분기, nodeTopology nil·빈 selector 차이를 유지합니다
- ResourceExhausted와 다른 생성 오류의 재선택 조건, 여러 볼륨의 부분 생성 한계를 보존합니다

## 편집 후 독자 확인

- producer 설정 전체를 읽기 전에 Filter 통과 후 무엇이 남는지 설명할 수 있나요?
- 용량 부족 사유만으로 실제 저장소가 꽉 찼다고 확정하지 않나요?
- Reserve라는 이름을 백엔드 공간 예약으로 오해하지 않나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
