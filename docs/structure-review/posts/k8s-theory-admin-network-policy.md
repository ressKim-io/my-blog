# 관리자 네트워크 정책 — 허용·거부와 다음 계층으로의 위임 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-admin-network-policy.md](../../../src/content/essays/kubernetes/k8s-theory-admin-network-policy.md)
- 시리즈: `k8s-theory-network` / 8
- 원문 SHA256: `621a832622785ee7a04301aa0d186527e8fac1405148ae4f1a740c7b782cbfc6`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

관리자가 최종 허용·거부할 범위와 namespace 정책에 넘길 범위를 어떻게 구분하고, 한 방향의 판정은 어디서 끝날까요?

선행 개념: 표준 NetworkPolicy의 방향별 격리와 허용 합집합을 전제합니다. 이 글의 API 그룹·버전을 도입에 명확히 표시합니다

## 현재 전개

- L24: 한 방향의 정책 판정을 끝까지 따라갑니다
- L52: ANP와 BANP의 역할이 한 Kind의 tier가 됐습니다
- L79: Pass는 허용이 아니라 현재 계층의 평가를 끝냅니다
- L101: priority와 규칙 목록 순서는 서로 다른 범위에서 적용됩니다
- L121: subject와 peer는 고르는 대상이 다릅니다
- L154: standard와 experimental은 저장 스키마가 다릅니다
- L184: 계층을 합치면서 구형 BANP의 제약도 바뀌었습니다
- L215: API 설치와 패킷 집행 지원을 따로 확인합니다
- L235: 실패한 위치에 따라 확인할 대상이 달라집니다
- L251: 참고 자료

## 원문 근거와 개선점

### L52 현재 평가 흐름 사이에 API 변천사가 끼어 있습니다

> ## ANP와 BANP의 역할이 한 Kind의 tier가 됐습니다

한 방향의 판정을 먼저 보여주는 도입은 좋습니다. 그러나 tier 그림 뒤에 구형·현재 Kind와 버전 비교가 길게 나오고, 그림의 중요한 액션인 Pass의 의미는 그 뒤에서 설명합니다

수정 방향: 도입에는 현재 ClusterNetworkPolicy의 API 그룹·버전과 외부 CRD라는 범위만 둡니다. 현재의 Accept·Deny·Pass와 priority를 완결한 다음 구형 ANP/BANP 대응과 변경 이유를 별도 비교 단위로 모읍니다

### L121 한 판정 사례에 필요한 대상 정의를 평가 앞부분에 둡니다

> ## subject와 peer는 고르는 대상이 다릅니다

Pass와 priority를 읽은 뒤에 subject·peer가 나옵니다. 단순 계층 그림은 이해되지만 실제로 어떤 연결이 규칙에 매치하는지 확인하려면 뒤로 이동해야 합니다

수정 방향: 현재 API의 간단한 한 방향 사례에서 subject·peer·action의 최소 의미를 먼저 짚습니다. 기본 평가를 마친 뒤 선택자 종류·domainNames·protocols와 채널별 스키마 제약을 확장합니다

## 권장 설명 순서

1. 표준 NetworkPolicy만으로 표현하기 어려운 관리자 거부와 기본 정책이라는 두 요구를 제시합니다
2. 현재 API의 그룹·버전·외부 구현 의존성을 밝히고 한 방향 사례의 subject·peer·action을 정의합니다
3. Admin·NetworkPolicy·Baseline 평가를 끝까지 따라가며 Accept·Deny·Pass와 암묵적 거부의 종료 지점을 설명합니다
4. 같은 tier의 priority와 한 정책 안의 규칙 순서, 중복 priority의 불확정 조건을 붙입니다
5. 선택자·protocols·배포 채널·저장 검증과 구현의 fail closed를 판정 전제의 확장으로 설명합니다
6. 구형 ANP/BANP와 현재 모델의 차이, BANP 제약 변화와 tier 설계 대안을 한 비교 단위로 모읍니다
7. API 설치·구현 지원·집행·관측을 구분한 실패 확인 순서로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

이 연결이 규칙에 매치했을 때 Accept와 Deny는 해당 방향의 판정을 끝냅니다
Pass는 그 결정을 뒤 계층에 넘기므로, 다음에 평가되는 NetworkPolicy의 격리 여부까지 따라가야 최종 결과를 알 수 있습니다

## 유지할 내용과 조건

- Pass와 규칙 불일치, 최종 허용을 서로 구분하는 원문의 핵심을 유지합니다
- NetworkPolicy가 방향을 격리해 판정하면 Baseline으로 내려가지 않는 조건을 보존합니다
- CiliumNetworkPolicy와 ClusterNetworkPolicy의 Kind·API 그룹을 구분합니다
- 구형 API·현재 API·standard 채널·안정성·실제 구현 지원을 하나의 최신 여부로 합치지 않습니다

## 편집 후 독자 확인

- 구형 API 역사를 읽지 않고도 현재 한 방향의 최종 판정을 따라갈 수 있나요?
- Pass 뒤에 통신이 거부될 수 있는 이유를 설명할 수 있나요?
- 필드가 저장되지 않은 경우와 저장된 peer를 집행기가 모르는 경우를 구분할 수 있나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
