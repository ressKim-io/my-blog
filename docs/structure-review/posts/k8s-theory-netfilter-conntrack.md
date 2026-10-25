# Netfilter와 conntrack — Service의 주소 변환을 기억하는 곳 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-netfilter-conntrack.md](../../../src/content/essays/kubernetes/k8s-theory-netfilter-conntrack.md)
- 시리즈: `k8s-theory-kernel` / 2
- 원문 SHA256: `449d3c4fdb8b1380a8ae755e101ca070d5b4e8edc6f044ef984e6fdb55c8d894`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

Service로 보낸 패킷은 커널의 어디서 목적지가 바뀌며, 응답과 후속 패킷은 어떤 기록을 사용해 같은 연결로 처리될까요?

선행 개념: Service·kube-proxy의 iptables 대표 경로와 IP 주소·포트의 의미를 전제합니다. hook·chain·conntrack은 첫 사용 위치에서 정의합니다

## 현재 전개

- L20: 다섯 hook은 모든 패킷이 차례로 지나는 다섯 단계가 아닙니다
- L66: 목적지가 바뀌면 라우팅 판단도 달라집니다
- L83: ClusterIP의 DNAT은 endpoint 체인의 규칙에서 일어납니다
- L105: Conntrack은 같은 연결을 양방향 키로 찾습니다
- L148: 후속 패킷은 유지 중인 NAT 바인딩을 재사용합니다
- L165: 연결 기록에는 용량과 만료 조건이 있습니다
- L207: Timeout은 생성 시각부터 고정된 수명이 아닙니다
- L246: 같은 Netfilter 기반과 같은 패킷 경로는 다릅니다
- L260: 확인한 근거

## 원문 근거와 개선점

### L36 패킷 경로를 완결하기 전에 규칙 구조와 전체 우선순위를 읽습니다

> ### Hook과 table, chain은 구분해야 합니다

다섯 hook이 직렬 단계가 아니라는 그림은 필요한 안내입니다. 이어 table·chain·nftables·priority와 ACCEPT 전파까지 설명해 원문의 Service 요청이 DNAT되는 지점까지 거리가 생깁니다

수정 방향: 기본 hook 지도를 짧게 보여준 뒤 일반 Pod의 Service 새 연결을 따라 DNAT과 라우팅을 연결합니다. hook·table·chain 정의는 사용 시점에 짧게 넣고 전체 priority와 nftables 비교는 그 뒤에 둡니다

### L129 양방향 튜플와 NAT 재사용 사이의 세부를 뒤로 옮깁니다

> ### 연결 상태는 TCP 소켓 상태와 같은 분류가 아닙니다

original·reply 튜플의 주소 예시는 응답이 돌아오는 이유를 잘 보여줍니다. 하지만 NEW·ESTABLISHED·namespace 공유 범위를 거친 뒤 후속 패킷의 NAT 재사용으로 돌아옵니다

수정 방향: 튜플 예시 직후 응답 역변환과 유지 중인 바인딩 재사용을 완결합니다. 그다음 NEW가 새 NAT 선택과 같지 않은 이유, namespace·zone의 조회 범위를 확장합니다

## 권장 설명 순서

1. 수신·전달·로컬 송신의 hook 지도를 짧게 보여주고 일반 Pod의 Service 호출을 중심 사례로 둡니다
2. PREROUTING에서 Service·endpoint 체인으로 가는 새 연결과 DNAT 후 라우팅을 따라갑니다
3. 원문의 original·reply 튜플 예시로 conntrack 기록·응답 역변환·후속 패킷 재사용을 연결합니다
4. 로컬 송신의 OUTPUT 진입과 재라우팅, 필요한 SNAT를 기본 경로와 비교합니다
5. hook·table·chain·priority, conntrack 상태·namespace·zone의 범위를 상세화합니다
6. 표 용량·버킷·만료·UDP stale 정리와 kube-proxy 설정을 운영 단위로 묶고 nftables·대체 경로의 적용 범위로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

백엔드에서 돌아오는 패킷의 출발지는 Service IP가 아니라 실제 백엔드 IP입니다
Conntrack이 reply 튜플로 같은 연결을 찾고 NAT 상태를 재사용하기 때문에 클라이언트에는 Service와 통신한 응답으로 돌려줄 수 있습니다

## 유지할 내용과 조건

- 모든 패킷이 다섯 hook을 차례로 지나는 구조가 아니라는 현재 설명을 보존합니다
- 한 연결의 양방향 키와 연결 객체 수를 구분합니다
- NAT 바인딩 재사용이 모든 conntrack·filter 비용을 없애는 뜻이 아님을 유지합니다
- 표 포화·만료·UDP stale, 커널 기본값·kube-proxy 적용값·실제 노드값의 차이를 보존합니다

## 편집 후 독자 확인

- 전체 priority 표를 외우기 전에 Service 요청과 응답의 주소 변화를 따라갈 수 있나요?
- NEW 상태와 새 NAT 바인딩 선택을 같은 것으로 읽지 않나요?
- iptables의 체인 구성을 모든 Service 구현에 적용하지 않나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
