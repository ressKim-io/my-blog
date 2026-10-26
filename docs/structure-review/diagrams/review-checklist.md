# Kubernetes 추가 그림 독립 검토 기준

검토 준비: AGENTS.md·docs/writing-voice.md, 대상 8편의 본문 전체, 기존 SVG 16개의 title·desc·표시 라벨을 읽음
제작자의 목업은 읽지 않은 상태에서 정리한 기준이며, 기존 그림의 시각 렌더링·새 그림 검수·외부 기술 재검증을 완료했다는 기록은 아님
아래 파일명은 모두 `src/content/essays/kubernetes/k8s-theory-` 접두사와 `.md` 접미사를 생략함

## resource-accounting-scoring

위치: 「Pod 요청은 실행 시점별로 계산합니다」(23행)

- 그림의 시간축은 선언된 **requests 집계의 동시 실행 구간**이어야 함. 실측 사용량·실행 소요 시간으로 읽히는 축·면적·곡선은 피함
- 일반 init은 순차 실행, restartable init sidecar는 시작 뒤 후속 init·app와 함께 실행 가능. 각 init 단계에는 해당 init과 앞서 시작한 sidecar를 합산하고, 정상 app 단계에는 app와 계속 실행하는 sidecar를 합산
- 자원별로 단계 합계의 최댓값을 선택하므로 CPU와 memory의 최댓값이 서로 다른 단계에서 나올 수 있음. 모든 init을 한 번에 합산하거나 마지막 단계만 선택하면 안 됨
- Pod-level 자원이 지원되는 자원을 대체하는 조건과 overhead를 **선택 뒤 더하는** 순서를 보존. 그림을 컨테이너 집계만의 예로 제한한다면 그 조건을 명시. DRA·resize 호출 옵션까지 단일 무조건 공식으로 확장하지 않음
- 기존 1번은 admission→Filter→Score, 2번은 균형 점수 비교. 추가 그림은 init·sidecar의 실행 구간 관계에 집중하고 새 숫자는 가정임을 표시

## hpa-scale-subresource

위치: 「안정화 창은 과거의 추천값을 기억합니다」(149행)

- 시간선의 7·3은 **변경 제한 전 추천값**이며 실제 replica 수·Ready Pod 수·최종 저장 목표가 아님. 이 세 종류를 한 선으로 연결하지 않음
- down 창에서는 최근 추천의 최댓값, up은 기본 창 0이며 양수 설정 시 최솟값. 가정이 down인지 그림 안에 표시
- 300초는 기본 축소 안정화 설정의 예이며 300초 뒤 반드시 3으로 감소하는 타이머가 아님. 이전 7이 창 밖으로 나간 뒤에도 새 추천·정책·min/max를 다시 평가
- 안정화 창과 변경 속도 정책의 기간, 기본 동기화 15초는 서로 다른 시간. 시간축에서 샘플 간격·창 폭을 같은 동작으로 표현하지 않음
- 기존 두 그림은 전체 계산→scale 저장과 같은 replicas의 두 쓰기 경로. 추가 그림은 움직이는 창 안팎의 추천값 선택만 설명하면 중복이 적음

## page-cache-reclaim-oom

위치: 「working set과 available은 회계 모델입니다」

- 범위는 확인한 cAdvisor/lib v0.60.5의 cgroup v2에서 `inactive_file` 항목이 있는 계산. `working set = max(usage - inactive_file, 0)`의 바닥 0을 보존
- usage 안에서 관측상 제외한 inactive_file은 **빈 메모리도, 비용 없이 즉시 회수 가능한 메모리도 아님**. free/여유 공간처럼 흰색 구멍으로 표시하지 않음
- 잔여 working set을 오직 앱 heap·RSS·회수 불가능 영역으로 표시하지 않음. file·shmem·file_mapped 등 겹칠 수 있는 memory.stat 필드를 배타적 조각으로 더하지 않음
- limit과 working set 사이 공간을 할당 성공/OOM 없음의 보장으로 표시하지 않음. 부모 cgroup 한도·회수 비용·할당 제약은 본문에서 계속 유효
- 기존 그림은 회수/OOM과 kubelet 축출의 별도 경로, 부모 cgroup 한도. 새 그림은 회계의 뺄셈을 설명하며 임의 수치를 쓰면 가정 표시

## device-resource-allocation

위치: 「NUMA 정렬은 개수 검사 뒤의 노드 내부 판단입니다」

- 큰 외곽은 **Kubernetes Node 한 대**, 내부 NUMA 0·1은 같은 서버의 하드웨어 위치. 서버 두 대나 스케줄러가 선택하는 별도 Node로 그리지 않음
- 노드 전체 GPU 두 개의 수량 여유와 CPU·메모리·GPU를 한 NUMA에 맞출 수 있다는 조건을 분리. topology 정보가 없는 자원까지 강제 위치 제약을 가진 것으로 그리지 않음
- 실패 사례라면 scope와 정책을 명시. `best-effort`는 정렬 실패만으로 거절하지 않으며 `single-numa-node`의 preferred 힌트 실패와 기본 수량 검사 통과를 구분
- GPU를 받으면 전용 CPU·메모리까지 자동 배정되는 것처럼 연결하지 않음. CPU static의 Guaranteed·정수 CPU 조건, Memory Static의 예약·자격 조건이 다르고 Pod-level gate 예외도 존재
- 기존 그림은 device plugin·DRA·Topology Manager의 주체 흐름. 추가 그림은 서버 내부의 배치 관계에 집중하며 특정 하드웨어 배치를 실측으로 꾸미지 않음

## netfilter-conntrack

위치: 「Conntrack은 같은 연결을 양방향 키로 찾습니다」

- Linux kube-proxy iptables의 일반 IPv4 ClusterIP, **추가 SNAT 없음**을 표시. 원문의 IP·port를 그대로 사용
- Original 조회 키: `10.244.1.5:33445 → 10.96.0.10:80`; DNAT 뒤 요청: `10.244.1.5:33445 → 10.244.2.9:8080`
- Reply 조회 키: `10.244.2.9:8080 → 10.244.1.5:33445`; 역변환 뒤 응답: `10.96.0.10:80 → 10.244.1.5:33445`. reply 키를 original의 단순 역순으로 그리지 않음
- 양방향 키가 **하나의 연결 객체·NAT 상태**를 찾는다는 관계를 표현. kube-proxy가 요청/응답 패킷을 직접 중계하거나 conntrack이 패킷 데이터 자체를 보관하는 그림은 피함
- 기존 그림은 hook 분기와 새 NAT 바인딩 선택. 새 그림의 후속 패킷 재사용을 그릴 경우 규칙으로 백엔드를 매번 다시 고르지 않는다는 의미이며 conntrack·주소 변환·filter가 전부 생략되는 것은 아님

## overlay-native-routing

위치: 「MTU의 50바이트 계산에는 바깥 주소군 조건이 있습니다」

- underlay IP MTU 1500, 추가 암호화·IP 옵션 없음이라는 원문 가정. 바깥 주소군이 IPv4/IPv6이며 Pod의 안쪽 주소군으로 오인하지 않도록 라벨
- IPv4 추가 공간은 outer IP 20 + UDP 8 + VXLAN 8 + **inner Ethernet 14** = 50. IPv6는 outer IP 40이 되어 합 70
- **outer Ethernet은 IP MTU 예산 바깥**. 단면도에 그린다면 1500 괄호 밖이어야 함
- 1450/1430은 내부 **IP 패킷 예산**이며 앱 payload·TCP data가 아님. 안쪽 IP/TCP 헤더도 그 안에 포함됨. 비례가 아닌 헤더 폭이면 개념도임을 표시
- 기존 그림은 전달·주소 경로 비교. 새 그림은 크기 예산만 설명하며 모든 Pod eth0 MTU가 1450이라는 확정, 모든 tunnel이 VXLAN과 같은 overhead라는 일반화는 금지

## crd-schema-pruning

위치: 「pruning과 unknown-field 요청 거절은 다른 동작입니다」와 하위 구조 절

- 전후 그림은 **가지치기 단계의 개념 예**임을 표시. Ignore/Warn으로 진행 가능한 경로와 Strict의 HTTP 400 거절을 구분하며 Strict에서도 성공 저장되는 것처럼 보이지 않게 함
- 미선언 가지 제거, 선언된 필드 보존, `x-kubernetes-preserve-unknown-fields: true`의 미선언 하위 데이터 보존을 구별. 그 아래 properties/additionalProperties로 구조를 선언한 지점에서는 정상 가지치기 재개
- 간략 schema를 보여줄 경우 그 예에 어떤 필드를 선언했는지 독자가 추정하지 않게 표시. 보존 flag가 붙은 **스키마 노드**와 요청 JSON 데이터의 위치를 혼동시키지 않음
- 가지치기 뒤 JSON을 최종 etcd 저장 바이트로 단정하지 않음. webhook 이후 항상 두 번째 pruning 보장도 아님. 조회 결과와 저장 바이트는 구분
- 기존 그림은 생성 처리 흐름과 subresource 저장 관계. 새 그림은 필드의 남음/제거만 설명하며 defaulting·null·CEL 허용까지 색 하나로 묶지 않음

## volume-expansion-snapshots-ephemeral

위치: 「스냅샷은 요청·실물·클래스를 별도 API로 둡니다」와 「복원은 새 PVC를 채우는 요청입니다」

- VolumeSnapshot은 namespaced API 요청, VolumeSnapshotContent는 cluster 범위 API 오브젝트, 실제 스냅샷은 스토리지 시스템의 실체. 같은 상자나 단순 이름 변경으로 그리지 않음
- 동적 생성 경로라면 snapshot-controller의 Content 생성·바인딩과 csi-snapshotter가 드라이버에 요청하는 CreateSnapshot을 구분. 화살표는 API 참조·제어 호출·데이터 관계 중 무엇인지 명시
- 복원은 external-provisioner가 snapshot source로 CreateVolume을 요청하여 **새 PVC·새 볼륨**을 준비함. 원본 PVC/볼륨으로 되돌아가는 화살표나 원본 덮어쓰기는 금지
- 같은 네임스페이스의 dataSource 예이며 바인딩·driver 일치·readyToUse·handle 등의 조건이 있음. Snapshot 오브젝트 생성만으로 준비 성공·앱 일관성·즉시 복원을 보장하지 않음
- 기존 그림은 확장·두 임시 볼륨 수명. 새 그림은 원본→snapshot→새 볼륨 관계에 집중. 삭제를 넣는다면 Delete/Retain·비동기 처리 조건이 필요하므로 핵심 질문에 불필요하면 제외

## 제작 후 독립 검토 순서

1. 먼저 수정된 본문을 앞에서부터 읽고 새 그림이 필요한 질문이 앞 문맥에서 생기는지 확인
2. 그림만 보았을 때 읽히는 인과·시간·범위·수치와 주변 본문을 대조. 위 조건이 그림에 직접 필요하거나 바로 옆에서 충분히 설명되는지 판단
3. 원문과 기존 SVG를 대조하여 내용 누락·과도한 보장·중복·지시어·번호·alt·본문 연결을 확인
4. 모바일와 데스크톱으로 실제 렌더링하여 글자 크기·가독성·겹침·잘림·화살표 방향·범례·Cocoon 의미색·title/desc 확인
5. 문제는 파일/절 또는 SVG 요소 위치, 독자가 오해할 이유, 최소 수정 방향으로 작성하여 제작자에게 반송. 수정 부분과 앞뒤 흐름을 재검토

이 문서는 내용 검토 준비 기록임. SVG XML·자산 참조·MDX·링크·빌드 실행 검증은 별도로 기록해야 함

## 승인 전 목업 검토 결과

대상: `/tmp/k8s-diagram-plan-a.md`와 `/tmp/k8s-diagram-plan-b.md`의 8개 목업 전체

판정: 사용자 승인 전에 반드시 수정해야 할 기술 문제는 발견하지 않음

- init·sidecar 그림은 컨테이너 집계 범위를 명시하고 Pod-level 대체·overhead를 인접 본문에 남김
- HPA는 실제 replica 대신 추천값을 표시하고, 두 번째 장면의 추가 추천 가정·이후 정책 평가를 명시함. SVG에서는 두 시간축의 동일 좌표·같은 창 폭을 유지한다는 계획대로 구현해야 함
- working set은 usage 안의 inactive_file을 회계에서만 제외하며 해칭을 남김. inactive_file ≤ usage의 개념 예와 max(..., 0) 일반식을 구분함
- NUMA는 서버 하나의 가정 배치를 명시하고 free·전용 할당·admission 성공/실패를 주장하지 않음. CPU A→GPU B 선의 정확한 시작점은 SVG 렌더 검토 대상
- conntrack의 요청/응답 전후 주소·두 조회 키·연결 객체 하나가 원문과 일치함
- MTU는 outer Ethernet을 1500 예산 밖에 두고 inner Ethernet을 50/70 안에 포함함. 내부 IP 예산과 앱 데이터·장치 MTU를 구분함
- CRD의 root 미선언 필드·preserve 하위 loose·다시 선언한 typed.extra의 처리와 Strict 거절·저장 바이트 한계가 구분됨. SVG JSON 표기는 따옴표 있는 데이터 또는 트리 중 하나로 통일한다는 계획을 실제 결과에서 확인해야 함
- Snapshot은 API 객체와 저장 실체, 두 참조 방향, 요청 주체, 새 복원 볼륨을 구분하고 준비 조건·물리 복사 방식의 미가정을 유지함

이 판정은 목업의 기술 의미와 삽입 문맥에 대한 검토이며, SVG 구현·모바일 가독성·본문 반영·실행 검증의 완료 판정은 아님
