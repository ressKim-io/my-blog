# DNS와 ndots — 이름 하나가 여러 질의로 이어지는 조건 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-dns-ndots.md](../../../src/content/essays/kubernetes/k8s-theory-dns-ndots.md)
- 시리즈: `k8s-theory-network` / 5
- 원문 SHA256: `a4d6ab02382d3b58ce4b7384434761d980b51f9b1d7ac29892aef2ae1331d6bc`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

애플리케이션이 넘긴 이름 하나가 어떤 후보 질의로 바뀌고, 추가 질의와 응답 유실에 따른 대기는 어떻게 다를까요?

선행 개념: 일반 Service와 headless Service가 돌려주는 주소의 차이, DNS 질의·응답의 기본 의미를 전제합니다. resolver는 첫 등장 때 정의합니다

## 현재 전개

- L23: kubelet은 설정을 계산하고 resolver는 후보를 만듭니다
- L80: ndots는 이름의 성공 여부보다 조회 순서를 정합니다
- L119: CoreDNS는 이름 종류와 설정에 따라 답합니다
- L167: 5초와 재시도 횟수는 resolver의 조건입니다
- L199: NodeLocal DNSCache는 로컬 구간의 경로를 바꿉니다
- L217: 지연과 실패를 관측한 위치부터 나눕니다
- L233: 참고 자료

## 원문 근거와 개선점

### L47 ndots 예시에 도달하기 전에 설정 분기가 길어집니다

> ### dnsPolicy와 hostNetwork를 함께 확인합니다

도입의 이름 하나가 여러 질의가 되는 질문은 명확합니다. 그러나 기본 search를 소개한 직후 정책별 분기·hostNetwork·fallback·설정 상한을 읽어야 실제 후보 이름 예시로 갈 수 있습니다

수정 방향: 일반 Linux ClusterFirst라는 조건을 먼저 고정하고 search와 ndots의 후보 예시를 바로 연결합니다. 정책별 구성과 합쳐진 설정의 상한은 이 예시의 입력이 달라지는 경우로 뒤에 배치합니다

### L119 서버의 모든 이름 형식보다 도입의 질의가 받을 응답을 먼저 설명합니다

> ## CoreDNS는 이름 종류와 설정에 따라 답합니다

후보 이름 예시 뒤에 주소형 Pod 이름과 hostname·subdomain의 레코드 조건까지 확장됩니다. 질의 증가와 timeout을 구분하려던 독자는 재시도 설명까지 다시 긴 경로를 지나갑니다

수정 방향: 기본 예시의 NXDOMAIN과 최종 주소 응답, 캐시 위치, 응답 유실과 재시도를 먼저 연결합니다. Pod 이름별 레코드 조건은 서버가 답할 수 있는 이름의 보충 단위로 묶습니다

## 권장 설명 순서

1. kubelet이 DNS 설정을 계산하고 앱의 resolver가 질의를 만든다는 역할을 구분합니다
2. Linux ClusterFirst·search 세 개·특정 resolver라는 조건을 고정해 이름 하나의 후보 순서를 보여줍니다
3. ndots 변경과 끝의 점을 같은 예시에 적용하고 후보 수·A/AAAA 질의 수·패킷 수가 다름을 설명합니다
4. 그 질의에 CoreDNS가 답하거나 상위 DNS로 전달하는 흐름, 캐시 위치와 부정 응답 캐시를 연결합니다
5. 응답 유실 시 resolver의 대기·재시도를 설명하고 후보 증가만으로 timeout을 확정하지 못하는 이유를 정리합니다
6. NodeLocal DNSCache가 바꾸는 구간을 보여준 뒤 dnsPolicy·hostNetwork·설정 상한과 이름별 레코드 조건을 보충합니다
7. 관측 위치별로 후보·질의·상위 요청·패킷 수를 구분하는 확인 기준으로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

앞의 예시는 각 후보에 응답이 돌아온다는 조건에서 질의 수를 센 것입니다
응답이 사라지면 resolver가 기다리고 재시도하는 과정이 추가되므로, 후보가 많은 문제와 timeout이 발생한 문제를 따로 봐야 합니다

## 유지할 내용과 조건

- glibc·musl 등 resolver별 fallback과 재시도 차이를 보존합니다
- 8개 질의는 명시한 조건의 계산 예이며 실측 패킷 수가 아님을 유지합니다
- CoreDNS의 API 관찰 상태와 DNS 응답 캐시, startup timeout과 resolver timeout을 구분합니다
- NodeLocal이 모든 NAT·conntrack을 제거한다는 일반화를 피합니다

## 편집 후 독자 확인

- 설정 상한 표를 읽기 전에 search와 ndots의 후보 생성 과정을 설명할 수 있나요?
- NXDOMAIN을 빨리 받은 경우와 응답을 잃은 경우의 차이를 이해할 수 있나요?
- 캐시가 어디에 있는지에 따라 줄어드는 질의가 다름을 알 수 있나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
