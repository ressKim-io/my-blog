# CCM과 클라우드 경계 — 노드 초기화와 외부 자원 정리 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-cloud-controller-boundary.md](../../../src/content/essays/kubernetes/k8s-theory-cloud-controller-boundary.md)
- 시리즈: `k8s-theory-network` / 9
- 원문 SHA256: `55bb661ac4761c36ede4a930ddcf0e3f2dce77303f0c4ff1dcc148aa5c271300`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

Node와 Service를 저장한 뒤 클라우드 쪽에 남은 작업은 누가 진행하고, 어느 상태를 보면 그 작업의 경계를 알 수 있을까요?

선행 개념: Node의 Ready 조건, Service의 ClusterIP, taint와 finalizer의 기본 용도를 전제합니다

## 현재 전개

- L26: external 모드의 새 Node는 초기화 미완료를 표시합니다
- L55: 초기화 값과 taint 제거는 같은 Node Update입니다
- L87: CCM에는 서로 다른 네 컨트롤러 경로가 있습니다
- L121: LoadBalancer Service는 세 시점의 값을 함께 가집니다
- L156: loadBalancerClass는 신규 LB 처리 주체를 가릅니다
- L182: LB 생성 전에 Service에 정리 finalizer를 붙입니다
- L205: NotReady 노드도 LB 후보 목록에 남을 수 있습니다
- L237: Pod CIDR 할당과 클라우드 경로 생성은 별도 작업입니다
- L261: 코어에서 분리됐지만 cloud provider 계약은 Go 인터페이스입니다
- L282: 실패한 단계는 상태·taint·담당 컨트롤러를 연결해 찾습니다

## 원문 근거와 개선점

### L87 전체 책임 지도를 상세 초기화보다 먼저 둡니다

> ## CCM에는 서로 다른 네 컨트롤러 경로가 있습니다

새 Node의 초기화 사례는 좋은 출발점입니다. 그러나 providerID 인터페이스별 예외와 주소 patch까지 읽은 뒤 네 컨트롤러를 소개해 CCM이 담당하는 전체 범위를 뒤늦게 파악하게 됩니다

수정 방향: 도입 직후 네 경로의 책임 표를 안내로 둡니다. 이후 Node 초기화·생존 판단·경로 관리와 Service LB 생명주기를 큰 단위로 묶어 표의 행을 따라가게 합니다

### L237 Node 관련 경계가 LB 설명 뒤에서 다시 등장합니다

> ## Pod CIDR 할당과 클라우드 경로 생성은 별도 작업입니다

Node 초기화와 연락·존재 판단 뒤에 LB 생성·class·finalizer·후보 선택을 읽고 다시 Node CIDR·NetworkUnavailable·taint로 돌아옵니다. Node 상태가 서로 다른 이유로 남는다는 관계를 한곳에서 비교하기 어렵습니다

수정 방향: route controller 절을 Node 초기화·cloud node lifecycle 설명 뒤로 옮깁니다. taint 세 종류와 Ready의 차이를 그 단위에서 정리한 후 Service의 생성·갱신·삭제로 이동합니다

## 권장 설명 순서

1. API 오브젝트 저장과 클라우드 작업 완료가 다르다는 두 도입 사례를 제시하고 CCM 네 경로의 책임 표를 보여줍니다
2. 새 Node 등록·메타데이터 조회·초기화 필드와 taint의 같은 Update·별도 주소 patch를 순서대로 설명합니다
3. 연락 상태와 인스턴스 존재를 구분하고 route controller의 경로 관리와 NetworkUnavailable을 붙입니다
4. Service 선언·API 할당·외부 LB 반영의 세 시점을 따라 기본 LB 생성 경로를 설명합니다
5. loadBalancerClass의 처리자 선택, LB 후보 노드와 health check, 삭제 finalizer를 생성·갱신·정리의 조건으로 배치합니다
6. KCM에서의 분리와 Go 인터페이스 계약을 보충하고 상태·taint·담당 컨트롤러를 연결한 진단표로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

Node가 Ready라는 사실만으로 클라우드 초기화나 경로 설정이 모두 끝난 것은 아닙니다
각 작업의 담당 컨트롤러와 상태를 구분한 다음, Service에서도 저장 성공 뒤 외부 작업이 어떻게 이어지는지 보겠습니다

## 유지할 내용과 조건

- 초기화 필드와 taint 제거는 같은 Update이고 주소 status는 별도 patch라는 구분을 보존합니다
- 클라우드 조회 오류를 인스턴스 부재로 처리하지 않는 조건을 유지합니다
- LB 후보의 Ready 제외 여부와 실제 health check는 별도이며 구현 범위가 있음을 유지합니다
- CCM route 사용이 모든 CNI의 필수 조건은 아니며 nodeipam이 KCM에 남는다는 설명을 보존합니다

## 편집 후 독자 확인

- 남은 taint를 보고 초기화·경로·종료 중 어떤 작업과 관련되는지 찾을 수 있나요?
- EXTERNAL-IP의 pending만으로 처리자 부재나 클라우드 오류를 확정하지 않나요?
- LB 생성 전 finalizer가 필요한 이유를 생성·삭제 순서로 설명할 수 있나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
