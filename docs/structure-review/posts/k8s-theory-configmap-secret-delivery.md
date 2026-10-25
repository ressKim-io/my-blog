# ConfigMap과 Secret 전달 — 환경 변수와 볼륨 파일의 갱신 경계 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-configmap-secret-delivery.md](../../../src/content/essays/kubernetes/k8s-theory-configmap-secret-delivery.md)
- 시리즈: `k8s-theory-node` / 11
- 원문 SHA256: `d860ad00bdef5abc1d4671d07a95ff9c10c9dd8b7f2bec3bb20e4409db5901f4`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 변경 전달 경로를 완성한 뒤 참조 문법과 다른 볼륨을 보충

## 독자와 중심 질문

ConfigMap/Secret 변경이 env·일반 파일·subPath에서 왜 다르게 보이는지 이해합니다

선행 개념: 컨테이너 환경 변수와 파일, kubelet의 볼륨 준비

## 현재 전개

- L24: 환경 변수는 생성 때 복사하고 볼륨은 다시 투영합니다
- L41: envFrom으로 가져온 값은 env로 덮어쓸 수 있습니다
- L96: AtomicWriter는 공개할 디렉터리를 링크로 전환합니다
- L129: 파일 반영 시간은 재처리와 변경 전달을 함께 봅니다
- L153: immutable은 데이터 변경을 막고 감시 비용을 줄입니다
- L171: Secret의 비밀성은 저장·권한·전달을 나눠 봅니다
- L215: projected volume은 여러 source를 한 디렉터리에 투영합니다
- L259: EnvFiles도 실행 중 환경 변수를 갱신하지는 않습니다
- L288: 갱신되지 않는 증상은 서로 다른 경계에서 발생합니다

## 원문 근거와 개선점

### L41 갱신 질문 사이에 환경 변수 조립 규칙이 길게 끼어듭니다

> ## envFrom으로 가져온 값은 env로 덮어쓸 수 있습니다

첫 비교표 뒤 env 우선순위·optional·키 문법을 읽고 나서야 AtomicWriter로 넘어갑니다. 같은 변경을 세 경로에서 비교하려면 앞 표로 되돌아가야 합니다

수정 방향: env의 생성 시 복사→일반 volume 재투영→subPath 고정→앱 재읽기를 먼저 연결합니다. env 조립·참조 오류는 후반에 묶습니다

### L246 설정 갱신에서 일반 볼륨 종류 설명으로 넓어집니다

> ### emptyDir과 hostPath도 PVC를 거치지 않습니다

projected 구현에 Memory emptyDir 설명은 필요하지만 hostPath 보안과 일반 emptyDir 크기 계산은 도입의 갱신 문제에서 벗어납니다

수정 방향: 투영 저장 매체에 필요한 설명만 이 위치에 남기고 일반 볼륨 설명은 보충·관련 글 이동 후보로 지정합니다

## 권장 설명 순서

1. 기존 env/volume/subPath 비교표와 앱 재읽기의 차이를 유지합니다
2. ConfigMap 값 하나의 변경이 각 경로에서 어디까지 전달되는지 비교합니다
3. AtomicWriter 링크 전환과 subPath bind mount·열린 파일의 차이를 설명합니다
4. watch/cache/get·Pod 재처리·immutable로 갱신 지연 또는 중단 조건을 풉니다
5. env 우선순위·optional·EnvFiles를 생성 시 조립이라는 공통 단위로 묶습니다
6. Secret 저장/권한·projected sources·tmpfs 조건은 별도 보충 후 전달 단계별 진단으로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

일반 볼륨의 새 경로가 준비되어도 프로세스가 기존 파일을 계속 읽을 수 있습니다
파일을 공개한 시점과 애플리케이션이 다시 열어 적용한 시점을 나눠 확인해야 합니다

## 유지할 내용과 조건

- 첫 표·AtomicWriter/subPath 그림
- 링크 원자성과 여러 파일 snapshot 보장은 다름
- immutable 같은 이름 재생성 조건, Secret base64/암호화·tmpfs swap 구분, EnvFiles 현재 범위

## 편집 후 독자 확인

- API 값·kubelet 사본·공개 파일·프로세스 설정 중 어디서 멈췄는지 구분하는가?
- subPath가 새 링크를 따라가지 않는 이유를 설명하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
