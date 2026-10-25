# Kubernetes 인가: 요청을 허용하는 기준과 RBAC의 범위 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-authorization.md](../../../src/content/essays/kubernetes/k8s-theory-authorization.md)
- 시리즈: `k8s-theory-api` / 3
- 원문 SHA256: `0a1e497cb2908205504a4ef5aadd1ee58fb72bfa2267104ff236f922a4a073aa`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기본 흐름 유지와 연결 보완

## 독자와 중심 질문

prod의 ServiceAccount가 Pod 목록 요청을 허용받는 과정과 RBAC이 제한할 수 있는 범위를 이해합니다

선행 개념: 인증 결과의 이름·그룹, namespace와 API resource

## 현재 전개

- L24: Pod 목록 요청은 어떻게 허용되나
- L46: RBAC 규칙은 무엇을 비교하나
- L83: Role과 Binding이 권한 범위를 나누는 방식
- L106: RBAC의 허용 누적과 체인의 첫 결론은 다르다
- L147: 이름과 selector를 붙이면 목록 권한은 어떻게 달라지나
- L180: 규칙을 만들고 위임하는 일도 검사한다
- L198: Node authorizer와 system:masters가 다른 이유
- L230: can-i가 yes인데 실제 요청은 왜 막힐까
- L254: 더 확인할 소스와 문서

## 원문 근거와 개선점

### L39 사례에서 사용하는 Role과 Binding의 관계를 늦게 풀이

> 이 ServiceAccount에 Binding으로 `prod`의 `list pods` 권한이 주어졌다면 RBAC이 `Allow`를 낼 수 있습니다

요청 예제는 구체적이지만 규칙과 신원을 연결하는 Binding의 역할이 뒤의 긴 규칙 설명 이후에 정리됩니다

수정 방향: 첫 사례 옆에 Role은 허용 동작, Binding은 적용 신원·범위라는 관계를 짧게 붙이고 상세 규칙 조각 전에 기본 연결을 설명합니다

### L180 집계와 권한 위임 검사가 한 절에 섞임

> ## 규칙을 만들고 위임하는 일도 검사한다

역할을 자동 합치는 aggregation과 스스로 권한을 확대하지 못하게 하는 bind/escalate는 서로 다른 질문입니다

수정 방향: 역할 재사용·집계와 역할 관리 권한의 검사를 구분하고 후자는 Role/Binding 이해 뒤 별도 심화로 연결합니다

## 권장 설명 순서

1. 현재 Pod 목록 요청과 속성 표를 유지합니다
2. 그 요청을 허용할 Role·Binding·namespace 관계를 먼저 완성합니다
3. verb·subresource·이름 조건과 허용 누적을 같은 요청의 변형으로 설명합니다
4. RBAC 바깥의 authorizer 체인을 소개하고 NoOpinion·거부·호출 오류를 구분합니다
5. selector·위임 권한·Node authorizer·특권 그룹을 각 적용 범위별 심화로 둡니다
6. can-i와 실제 요청을 비교하며 인가 이후의 admission 경계로 마무리합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

규칙에 동작을 적는 것만으로 특정 사용자가 그 권한을 얻지는 않습니다
앞의 web 신원과 이 규칙을 연결하는 Binding을 먼저 확인하겠습니다

## 유지할 내용과 조건

- 처음의 구체적 list 요청과 요청 속성 표는 유지합니다
- NoOpinion과 Deny, Decision과 호출 오류, 403과 500의 조건을 보존합니다
- 목록 결과의 객체별 필터가 아니라는 점과 system:masters의 범위를 유지합니다

## 편집 후 독자 확인

- RoleBinding의 namespace와 ServiceAccount의 namespace 역할을 구분할 수 있는가
- can-i의 yes가 실제 저장 성공을 보장하지 않는 이유를 설명할 수 있는가

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
