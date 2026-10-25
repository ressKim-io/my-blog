# 페이지 캐시·회수·OOM — working set이 limit 아래여도 느려지고 종료되는 이유 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-page-cache-reclaim-oom.md](../../../src/content/essays/kubernetes/k8s-theory-page-cache-reclaim-oom.md)
- 시리즈: `k8s-theory-kernel` / 4
- 원문 SHA256: `1fa4a86c24d87b622040786a10e70585533228f972f23fd55ecef43c8e431702`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 큰 단위 재배치

## 독자와 중심 질문

working set 그래프가 limit 아래인데도 작업이 느려지거나 OOM으로 종료될 수 있는 이유를 사용량·회수 비용·한도 범위로 나눠 설명할 수 있을까요?

선행 개념: cgroup 메모리 limit, 프로세스와 컨테이너의 차이를 전제합니다. working set은 물리적인 비회수 메모리 그 자체가 아니라 계산한 관측값으로 정의합니다

## 현재 전개

- L23: 캐시를 회수할 수 있어도 비용은 남습니다
- L46: 커널의 회수와 kubelet의 축출은 별도 경로입니다
- L65: LRU는 다음 접근을 아는 대신 추정합니다
- L97: 메모리를 사용하는 주체와 charge된 cgroup은 다를 수 있습니다
- L161: working set과 available은 회계 모델입니다
- L201: OOM의 범위와 희생 프로세스를 나눠 봅니다
- L250: PSI는 사용량 대신 진행하지 못한 시간을 봅니다
- L276: 참고 자료

## 원문 근거와 개선점

### L161 제목의 관측값을 해석하는 식이 너무 늦게 나옵니다

> ## working set과 available은 회계 모델입니다

working set을 사용량을 가공한 값이라고 도입하지만 실제 계산과 inactive_file의 의미는 L161 이후에 나옵니다. 그전에 회수·LRU·charge·MemoryQoS를 읽으며 어떤 그래프와 비교하고 있는지 계속 추정해야 합니다

수정 방향: 도입 직후 working set의 간단한 식과 그 값이 보장하지 않는 것을 제시합니다. inactive_file을 뺄 수 있어도 비용 없이 회수된다는 뜻은 아니라는 질문으로 page cache·회수에 연결합니다

### L65 한도와 회계 범위보다 회수 알고리즘 세부가 앞섭니다

> ## LRU는 다음 접근을 아는 대신 추정합니다

커널 회수와 kubelet 축출을 나눈 뒤 MGLRU·scan·steal을 읽고, 그다음 누구에게 charge되는지와 부모 한도를 접합니다. 어떤 범위가 압박을 받는지 정하기 전에 회수 후보 알고리즘으로 들어갑니다

수정 방향: page cache의 비용 다음에 charge된 cgroup·부모 한도·high/max를 설명합니다. 이후 회수·재읽기·PSI로 지연을, OOM 범위와 이벤트로 종료를 풀고 MGLRU·MemoryQoS·hugetlb는 관련 보충으로 둡니다

## 권장 설명 순서

1. working set의 계산과 limit 아래라는 관측이 할당 성공을 보장하지 않는 이유를 문제로 제시합니다
2. file-backed·dirty·anonymous 등 회수 대상과 재읽기 비용을 구분합니다
3. 메모리 소비자와 charge 대상, 부모·자식 계층, high·max·보호 설정으로 압박의 범위를 정합니다
4. direct reclaim·scan/steal·refault·PSI를 이어 느려지는 경로와 각각의 관측 단위를 설명합니다
5. memcg·전역 OOM·희생 프로세스·events·런타임 종료 이유를 연결하고 kubelet eviction과 구분합니다
6. MGLRU·MemoryQoS·hugetlb/THP·swap의 조건을 앞의 회수·회계·한도에 대응하는 보충 단위로 정리합니다
7. 같은 실행 인스턴스와 시각의 사용량·회수·정지·종료 기록을 연결해 처음 질문에 답합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

working set은 사용량에서 inactive_file을 뺀 관측값이므로, 뺀 메모리를 아무 비용 없이 즉시 회수할 수 있다는 뜻은 아닙니다
이제 어떤 페이지를 회수할 수 있는지와 그 과정에서 누가 기다리는지를 보면 그래프 아래에서 생기는 지연을 설명할 수 있습니다

## 유지할 내용과 조건

- reclaim·kswapd·kubelet eviction·OOM을 고정된 직렬 순서로 만들지 않습니다
- 부모·자식 current 중복 합산과 file·shmem 항목 중복을 피합니다
- MemoryQoS gate만으로 모든 보호가 생기지 않으며 hugetlb·THP·swap은 다른 회계 경로임을 보존합니다
- oom_kill·OOMKilled·종료 코드 137·PSI를 각각 단독 원인 증명이나 요청 지연으로 일반화하지 않습니다

## 편집 후 독자 확인

- LRU 구현을 읽기 전에 working set과 실제 한도의 범위 차이를 설명할 수 있나요?
- OOM이 없어도 메모리 압박으로 느려질 수 있는 경로를 알 수 있나요?
- 현재 컨테이너 그래프만으로 부모 한도나 전역 OOM을 배제하지 않나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
