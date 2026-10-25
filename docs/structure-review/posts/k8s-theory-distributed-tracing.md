# 분산 추적의 계측 지점 — 문맥 전파와 기록을 나눠 봅니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-distributed-tracing.md](../../../src/content/essays/kubernetes/k8s-theory-distributed-tracing.md)
- 시리즈: `k8s-theory-api` / 23
- 원문 SHA256: `d4162803fdeda6ec297288000252873b84a395f666a6e7ec187d883d5ec3491c`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기록 선택 경로와 시간 해석을 나눠 재배치

## 독자와 중심 질문

추적 헤더·Trace 로그·span이 각각 무엇을 뜻하며 span이 수집되지 않는 원인을 어떻게 나누는지 이해합니다

선행 개념: API 요청 경로, 로그·메트릭, span/collector의 최소 정의

## 현재 전개

- L26: 요청 하나에서 서로 다른 기록이 남습니다
- L45: 필터 메트릭과 filter span은 끝나는 지점이 다릅니다
- L83: 문맥을 전달하는 것과 span을 내보내는 것은 다릅니다
- L97: 내보내기 설정은 API 서버와 kubelet에서 다르게 넣습니다
- L146: 표본 수를 생략하거나 0으로 두어도 부모의 표본 결정을 따릅니다
- L165: 들어온 traceparent를 부모로 쓸지는 신원으로 정합니다
- L190: span 이름은 처리 계층을 보여 줍니다
- L215: kubelet은 HTTP·CRI뿐 아니라 내부 작업도 계측합니다
- L234: collector 내보내기는 별도 배치 루프에서 처리합니다
- L282: 기록이 없을 때는 빠진 조건부터 구분합니다
- L315: 더 확인할 소스와 문서

## 원문 근거와 개선점

### L45 span이 생기고 전송되는 경로보다 측정 종료 구현이 먼저입니다

> ## 필터 메트릭과 filter span은 끝나는 지점이 다릅니다

첫 표 다음에 TrackCompleted·defer·로그 시간 기준을 상세히 읽습니다. 초심자는 아직 설정·표본·전파·내보내기의 관계를 잡지 못했습니다

수정 방향: 세 기록의 차이는 간단히 유지하고 span 생성→표본 선택→종료→배치 전송을 먼저 완성합니다. 필터 시간 경계는 span을 읽는 두 번째 단위로 옮깁니다

### L165 부모를 따르는 표본 결정 뒤에 부모 선택 조건을 배웁니다

> ## 들어온 traceparent를 부모로 쓸지는 신원으로 정합니다

앞의 표에서 유효한 부모라고 이해했던 헤더가 신원에 따라 link가 될 수 있음을 뒤에서 수정해야 합니다

수정 방향: 문맥을 받음→부모로 신뢰할지 결정→ParentBased 표본 결정 순으로 연결합니다. 로컬 인증 span 예외는 그다음에 붙입니다

## 권장 설명 순서

1. Trace 로그·집계 metric·exported span의 차이를 도입 표로 유지합니다
2. 설정 유무에 따른 실제 tracer/noop과 문맥 전파를 구분합니다
3. 받은 문맥의 부모/link 선택 후 표본 결정을 따라갑니다
4. span 종료→배치 큐→exporter→collector의 성공·드롭·실패 경로를 설명합니다
5. API 서버·kubelet의 계측 범위와 filter span/metric의 시간 경계를 비교합니다
6. TLS·SDK 환경 설정·head/tail sampling 조건을 보충하고 누락된 단계별로 진단합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

헤더를 받았다고 그 문맥을 반드시 부모로 쓰지는 않습니다
먼저 부모를 선택한 뒤 그 부모의 표본 결정이나 새 루트의 비율을 적용합니다

## 유지할 내용과 조건

- Trace 로그가 OTel 설정 증거는 아님
- sampling 0과 noop 차이, 신원별 부모/link 및 로컬 부모 조건
- collector 실패는 요청 성공과 별개, 전송 큐 손실·SDK TLS 조건·미검증 실측 범위

## 편집 후 독자 확인

- traceparent가 있는데도 같은 trace의 span이 안 보이는 조건을 설명하는가?
- authorization span 길이를 인가 함수만의 시간으로 읽지 않는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
