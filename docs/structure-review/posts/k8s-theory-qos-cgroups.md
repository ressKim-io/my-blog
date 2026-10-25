# QoS와 cgroup — request가 배치 계산에, limit이 실행 상한에 쓰이는 과정 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-qos-cgroups.md](../../../src/content/essays/kubernetes/k8s-theory-qos-cgroups.md)
- 시리즈: `k8s-theory-node` / 5
- 원문 SHA256: `3fb3bbb3aef803beade4f323d6824b131c7c50df23b2ca478bd072fd8876a9d8`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 매니페스트부터 실행 제어까지 기본 경로 연결

## 독자와 중심 질문

같은 request/limit 선언이 배치 계산과 노드의 CPU·메모리 제어에 어떻게 쓰이는지 이해합니다

선행 개념: Pod resources, scheduler와 kubelet

## 현재 전개

- L24: request와 limit은 서로 다른 질문에 답합니다
- L61: limit만 써도 같은 자원의 request가 생깁니다
- L87: QoS는 자원 선언의 관계로 계산합니다
- L118: kubelet은 숫자를 cgroup 제어 값으로 바꿉니다
- L171: CPU 상한은 실행을 미루고 메모리 상한은 회수를 요구합니다
- L197: OOM 보정값은 종료 순서를 보장하지 않습니다
- L245: allocatable과 kubepods 한도는 같은 숫자가 아닙니다
- L263: 자원 변경은 pods/resize로 처리합니다
- L314: 증상을 해석할 때는 판단 주체를 먼저 나눕니다

## 원문 근거와 개선점

### L47 기본 선언의 경로 전에 미지정 예외가 나옵니다

> ### 요청이 없으면 Filter와 Score의 계산이 달라집니다

100m/500m 사례 뒤 곧 Score 보정값·Pod-level 분기로 들어갑니다. 실제 선언이 QoS와 cgroup 값으로 이어지는 흐름을 먼저 보면 예외의 위치가 분명해집니다

수정 방향: 명시적인 단일 컨테이너 선언으로 배치→QoS→CPU 가중치/상한·메모리 상한을 먼저 완성합니다

### L245 배치와 실행의 두 한도를 후반에 다시 연결합니다

> ## allocatable과 kubepods 한도는 같은 숫자가 아닙니다

첫 절에서 allocatable을 설명하지만 메모리 OOM 심화 뒤에서야 노드 cgroup 한도와 다름을 배웁니다

수정 방향: 기본 배치/실행 비교 직후 최소 차이를 붙이고 상세 예약 계산은 보충 절에 둡니다. resize는 기존 선언을 바꾸는 후속 사례로 분리합니다

## 권장 설명 순서

1. 100m request·500m limit의 기존 가정 예를 유지합니다
2. 명시된 선언으로 scheduler 요청량 계산과 QoS 분류를 확인합니다
3. kubelet이 CPU 가중치·quota·메모리 한도로 바꾸는 경로를 설명합니다
4. CPU throttling과 메모리 reclaim/OOM을 비교하고 allocatable과 실행 한도를 구분합니다
5. 미지정 request·defaulting·Pod-level·init/sidecar·MemoryQoS 예외를 붙입니다
6. OOM 보정과 eviction의 차이를 보충하고 resize의 선언/적용 상태를 별도 단위로 설명합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

배치할 수 있다고 판단한 request는 실제 사용량을 그 숫자에 고정하는 장치가 아닙니다
노드에서는 같은 선언을 CPU 가중치와 사용 상한 같은 제어 값으로 다시 해석합니다

## 유지할 내용과 조건

- request는 CPU 경합 가중치에도 쓰임, 특정 코어 확보와 구분
- CPU/메모리 양쪽 QoS 조건 및 Pod-level 경로
- MemoryQoS gate만으로 보호 설정 안 됨, OOM 점수는 종료 순서 보장 아님, resize 적용 지연

## 편집 후 독자 확인

- request·limit·allocatable·cgroup 한도의 역할을 나눌 수 있는가?
- QoS가 Guaranteed라는 사실만으로 모든 OOM·eviction을 피한다고 해석하지 않는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
