# Kubernetes 자원 지표 — 같은 Pod의 숫자가 다른 이유 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-node-observability-sources.md](../../../src/content/essays/kubernetes/k8s-theory-node-observability-sources.md)
- 시리즈: `k8s-theory-node` / 7
- 원문 SHA256: `230c9acb53d7ca9fb5682d29d1deb3249cc661612956eee003f2770382c9c4f2`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 질문과 답을 가까이 두는 부분 재배치

## 독자와 중심 질문

kubectl top과 대시보드의 숫자를 정의·수집 범위·시점에 맞춰 비교하는 방법을 이해합니다

선행 개념: Pod CPU·메모리, 메트릭 수집과 API 상태

## 현재 전개

- L23: 선언·실측·최근 표본은 서로 다른 경로에서 나옵니다
- L38: kube-state-metrics는 API에 기록된 필드를 읽습니다
- L60: kubelet 엔드포인트 이름과 통계 원본을 나눠 봅니다
- L103: working set은 usage에서 모든 캐시를 뺀 값이 아닙니다
- L139: metrics-server는 최근 두 표본으로 자원 사용량을 구합니다
- L172: 과거 사용량을 확인하려면 별도로 수집·보관해야 합니다
- L196: 숫자가 다르면 정의·범위·시각부터 맞춥니다
- L216: 확인한 소스

## 원문 근거와 개선점

### L38 top과 대시보드 차이의 답을 주기 전에 선언 지표로 이동합니다

> ## kube-state-metrics는 API에 기록된 필드를 읽습니다

첫 질문은 메모리 숫자의 차이인데 선언 지표 상세와 endpoint/provider 조건을 거쳐 working set에 도달합니다

수정 방향: 세 소스 역할 그림은 유지하되 도입의 usage/working set·최근 표본 차이를 먼저 끝냅니다. kube-state-metrics는 다른 종류의 질문을 푸는 소스로 이어갑니다

### L185 자원 표본 보존 설명에서 로그 회전 설정으로 넓어집니다

> ### 로그 파일에는 프로세스가 출력한 내용이 남습니다

로그가 과거 사용량을 대신하지 않는다는 문장은 필요하지만 크기/파일 수/API 최신 파일 조건은 별도 로그 글의 질문입니다

수정 방향: 기록 종류 차이는 짧게 남기고 회전 세부는 container-log-files로 연결합니다

## 권장 설명 순서

1. top과 대시보드의 두 메모리 숫자가 무엇을 뜻하는지 먼저 비교합니다
2. usage·working set·RSS의 범위를 설명합니다
3. kubelet→metrics-server→Metrics API→top/HPA 경로와 CPU 구간 평균·메모리 마지막 표본을 연결합니다
4. endpoint 이름과 실제 provider·중복 수집 조건을 보충합니다
5. kube-state-metrics의 선언/보고 상태를 다른 질문의 자료로 설명합니다
6. 현재 표본과 과거 시계열의 차이를 정리하고 정의·범위·시점 비교로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

숫자가 다르다고 한쪽의 수집이 틀렸다고 판단하기 전에 같은 메모리를 세고 있는지 확인해야 합니다
usage와 working set을 맞춘 뒤에도 수집 시각과 집계 범위의 차이는 남습니다

## 유지할 내용과 조건

- working set은 모든 캐시를 뺀 값이 아님
- endpoint와 provider 구분, metrics-server 확인 버전·배포 설정 조건
- eviction은 내부 provider 사용, 지표 안정도와 동일 표본 보장은 별개

## 편집 후 독자 확인

- CPU 평균의 Window와 메모리 Timestamp를 구분하는가?
- 과거 피크가 현재 top에 안 보일 때 어떤 저장 자료가 필요한가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
