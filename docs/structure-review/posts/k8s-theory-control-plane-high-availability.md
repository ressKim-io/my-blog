# 컨트롤 플레인 이중화 — etcd·API 서버·컨트롤러의 다른 역할 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-control-plane-high-availability.md](../../../src/content/essays/kubernetes/k8s-theory-control-plane-high-availability.md)
- 시리즈: `k8s-theory-api` / 20
- 원문 SHA256: `8cfb8627b2cccd220e19b9420e7cab1835b538d7660d84443f957e3d21ade0ce`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 역할 비교 유지, 세부 장애 경로를 후속 배치

## 독자와 중심 질문

컨트롤 플레인 호스트 하나가 멈췄을 때 저장 합의·요청 처리·조정 작업이 각각 어떻게 이어지는지 이해합니다

선행 개념: API 서버·etcd·controller, 기본 Lease 역할

## 현재 전개

- L22: 노드 하나의 장애가 세 역할에 영향을 줍니다
- L36: etcd는 투표 멤버의 과반으로 상태를 확정합니다
- L76: quorum을 잃었을 때 읽기는 요청 조건에 따라 달라집니다
- L134: API 서버는 저장소를 공유하고 캐시와 APF 용량은 따로 둡니다
- L165: API 서버 명단을 기록하는 두 장치는 서로 다릅니다
- L200: 컨트롤러는 Lease를 다투지만 모든 동시 행동을 차단하지는 못합니다
- L232: 같은 Lease Kind라도 단독 갱신과 경쟁은 다릅니다
- L247: 외부 etcd를 써도 API 서버의 저장소 의존성은 남습니다
- L266: 증상을 보면 먼저 어느 역할의 문제인지 나눕니다

## 원문 근거와 개선점

### L76 세 역할 비교 중 저장소 읽기 예외가 길어집니다

> ## quorum을 잃었을 때 읽기는 요청 조건에 따라 달라집니다

도입은 세 역할의 차이를 잘 보여 줍니다. 그러나 quorum 설명 뒤 learner·최신 LIST·watch 재초기화까지 읽어야 API 서버와 controller로 넘어갑니다

수정 방향: quorum의 기본 역할 뒤 API 서버 분배와 controller 인계를 먼저 연결해 호스트 장애 사례를 완성합니다. quorum 상실 시 읽기 조건은 그다음 심화로 둡니다

### L165 인스턴스 명단이 controller 리더 선출을 늦춥니다

> ## API 서버 명단을 기록하는 두 장치는 서로 다릅니다

TTL 주소와 identity Lease의 차이는 유용하지만, 세 역할 중 마지막 역할을 만나기 전에 여러 Lease 용도와 gate 이력을 읽습니다

수정 방향: controller 리더 선출을 앞당기고 명단·heartbeat·leader Lease 비교를 한 보충 단위에 모읍니다

## 권장 설명 순서

1. 기존 stacked 호스트 장애 사례와 세 역할 구분을 유지합니다
2. etcd 과반 유지, API 서버로의 요청 재분배, controller Lease 인계를 차례로 따라갑니다
3. 역할별 복구가 다른 시점에 일어나며 API 성공이 조정 완료는 아님을 정리합니다
4. quorum 상실의 읽기·watch cache 조건과 APF의 인스턴스별 용량을 풉니다
5. learner와 external etcd를 장애 범위·증설의 별도 선택으로 설명합니다
6. 주소 TTL·identity·리더 Lease를 비교하고 상태 검사·진단 지표를 연결합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

저장소가 요청을 확정할 수 있어도 그 요청이 살아 있는 API 서버에 도착해야 합니다
또 저장이 끝난 뒤 실제 상태를 맞추는 controller의 인계는 별도로 진행됩니다

## 유지할 내용과 조건

- 도입의 단일 호스트 장애와 세 역할 비교
- 캐시 존재가 최신성 보장은 아님, quorum은 etcd 투표 멤버 기준
- APF는 프로세스별 용량, Lease는 fencing 아님, probe 시간은 단순 합산 보장 아님

## 편집 후 독자 확인

- API 서버 수 증가와 etcd quorum 증가가 같은 효과가 아닌 이유를 설명하는가?
- 저장은 성공하지만 조정이 잠시 멈춘 상황을 해석할 수 있는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
