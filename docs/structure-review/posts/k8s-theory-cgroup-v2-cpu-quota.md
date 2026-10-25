# cgroup v2 CPU quota — 평균 사용률이 낮아도 실행이 멈추는 이유 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-cgroup-v2-cpu-quota.md](../../../src/content/essays/kubernetes/k8s-theory-cgroup-v2-cpu-quota.md)
- 시리즈: `k8s-theory-kernel` / 1
- 원문 SHA256: `79189c285464bd32d7938960cb9e358b02f77a2db14ff91db05c6a08bd4bcaf0`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기본 사례 유지·기전과 구현 분리

## 독자와 중심 질문

평균 CPU 사용률이 낮아도 quota가 소진될 수 있는 이유와, 이때 어떤 cgroup의 어떤 시간 지표를 확인해야 하는지 설명할 수 있을까요?

선행 개념: CPU 시간과 벽시계 시간, request·limit·cgroup 계층의 기본 뜻을 전제합니다. throttling은 실행 예산 소진에 따른 제한으로 정의합니다

## 현재 전개

- L23: 낮은 평균과 throttling은 함께 나타날 수 있습니다
- L42: kubelet의 계산과 컨테이너 파일 기록을 구분합니다
- L81: cpu.max는 기간과 CPU 시간을 함께 지정합니다
- L130: weight는 경합할 때 나누는 몫입니다
- L152: 전체 예산은 공유하고 실행 시간은 CPU별로 차감합니다
- L204: cpu.stat에서 사용량과 대역폭 통계를 나눠 읽습니다
- L250: 메모리는 다음 기간을 기다려도 사용량이 줄지 않습니다
- L278: 참고 자료

## 원문 근거와 개선점

### L42 좋은 도입 사례와 커널 원리 사이에 구현 경로가 끼어 있습니다

> ## kubelet의 계산과 컨테이너 파일 기록을 구분합니다

20ms quota와 21ms 작업의 가정 예시는 낮은 평균과 throttling의 공존을 잘 보여줍니다. 이어 kubelet·CRI·파일 작성자·CFS와 EEVDF 범위를 읽고 나서야 cpu.max를 구체적으로 해석합니다

수정 방향: 도입 사례 바로 뒤에 cpu.max의 quota·period와 여러 CPU의 합산 예산을 연결합니다. 그다음 부모 제한과 weight를 구분하고, Kubernetes가 이 값을 만드는 경로는 별도 구현 단위로 옮깁니다

### L250 CPU 질문을 마무리하는 곳에서 새 메모리 설명이 길어집니다

> ## 메모리는 다음 기간을 기다려도 사용량이 줄지 않습니다

CPU 카운터를 해석한 뒤 memory.high·min·low·MemoryQoS·oom.group까지 소개합니다. CPU 시간과 점유 메모리의 차이는 유용하지만 새 설정들의 적용 조건까지 읽으면 마무리의 중심이 옮겨갑니다

수정 방향: CPU와 메모리의 차이는 짧은 비교로 남기고 상세 제어는 페이지 캐시·회수·OOM 글로 연결합니다. 이 글은 quota·period·상위 cgroup·같은 구간의 카운터로 처음 질문에 답하며 닫습니다

## 권장 설명 순서

1. 20ms quota·100ms period·21ms 작업이라는 원문의 가정 예시로 평균 2.1%와 throttling을 대비합니다
2. cpu.max의 시간 단위와 합산 예산을 설명하고 병렬 실행 때 벽시계 소진 시간이 달라짐을 연결합니다
3. 전역 예산·CPU별 실행 시간·보충과 잔여, 부모 한도, weight의 경합 배분을 구분합니다
4. kubelet의 request·limit 변환과 Pod·컨테이너 파일 작성 경로, limit 생략·독점 CPU 등의 조건을 설명합니다
5. cpu.stat과 cAdvisor 지표의 단위·집계 범위·구간 증가량을 읽고 요청 지연과 일대일 대응하지 않는 이유를 풉니다
6. fair-class·커널 설정·burst·변환식 차이는 보충하고 CPU 제한 원인을 확인하는 순서와 짧은 메모리 비교로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

앞의 20ms는 한 CPU를 계속 20% 속도로 실행한다는 뜻이 아니라 한 주기에 사용할 CPU 시간의 합계입니다
이 값을 cpu.max에서 어떻게 표현하고 여러 CPU와 부모 cgroup이 어떻게 나눠 쓰는지 보면 평균과 제한이 다른 이유가 이어집니다

## 유지할 내용과 조건

- 도입의 수치는 실측이 아닌 조건을 고정한 가정 예시라는 표기를 유지합니다
- 로컬 잔여 시간·명시적 burst·부모 quota를 서로 다른 기전으로 보존합니다
- 컨테이너 limit·파일 값·실제 런타임 변환식을 동일시하지 않습니다
- throttled 시간과 개별 요청 지연, period 수와 단순 벽시계 기간 수를 구분합니다

## 편집 후 독자 확인

- CRI 필드와 EEVDF를 알기 전에 낮은 평균과 throttling을 설명할 수 있나요?
- 자식 cpu.max가 max여도 제한될 수 있는 이유를 이해할 수 있나요?
- limit 증가가 p99 개선을 보장한다고 오해하지 않나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
