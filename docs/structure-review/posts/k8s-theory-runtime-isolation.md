# 런타임 격리 — 생략한 보안 설정은 필드마다 다르게 적용됩니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-runtime-isolation.md](../../../src/content/essays/kubernetes/k8s-theory-runtime-isolation.md)
- 시리즈: `k8s-theory-node` / 14
- 원문 SHA256: `974cd690cb877aa61f34d57c56f9b743b0d9fde7d57dbc2b624842e60c074f42`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 보안 기전의 의미를 필드 병합보다 먼저 설명

## 독자와 중심 질문

보안 필드를 생략한 결과와 API 정책 통과·노드 적용의 차이를 이해합니다

선행 개념: 컨테이너 프로세스·Linux 권한, API admission과 runtime

## 현재 전개

- L24: API 허용과 노드에서의 적용은 다른 판단입니다
- L35: securityContext의 위치는 적용 범위와 연결됩니다
- L70: capability·seccomp·AppArmor·SELinux는 제한하는 대상이 다릅니다
- L116: privileged는 여러 제약을 함께 바꾸는 요청입니다
- L137: baseline의 금지와 restricted의 명시 요구를 나눠 봅니다
- L178: kubelet은 runAsNonRoot에 따라 이미지 사용자도 검사합니다
- L191: user namespace는 남은 capability의 유효 범위를 제한합니다
- L230: SELinux의 프로세스 라벨과 볼륨 적용 방식도 구분합니다
- L242: RuntimeClass는 핸들러를 고르고 PSA는 필드를 검사합니다
- L269: 거절 메시지와 적용 실패 메시지를 나눠 읽습니다

## 원문 근거와 개선점

### L54 기전의 역할 전에 우선순위부터 배웁니다

> ### 공통 병합과 프로필 선택은 별도 경로입니다

securityContext 위치 뒤 seccomp/AppArmor의 선택 순서가 나오지만 두 기전이 무엇을 제한하는지는 다음 절에 있습니다

수정 방향: capability·syscall 필터·접근 정책·UID 범위의 짧은 역할 비교를 먼저 둡니다. 그다음 어느 필드에서 값을 고르는지 설명합니다

### L107 생략 값의 의미 설명 중 경로 수 세부로 들어갑니다

> 기본 procMount는 고정된 masked 경로 12개에 노드에서 존재하는 CPU별 `thermal_throttle` 경로가 더해질 수 있습니다

capability 생략과 drop ALL의 핵심 차이를 이해하는 중 실제 masked path 목록 규모가 끼어듭니다

수정 방향: 생략 값→런타임 기본값/명시적 제한의 비교를 먼저 끝내고 procMount 세부는 해당 필드의 보충 설명에 둡니다

## 권장 설명 순서

1. API 허용과 노드 적용의 기존 그림을 유지합니다
2. capability·seccomp·AppArmor/SELinux·user namespace가 제한하는 대상을 간단히 구분합니다
3. capability 생략과 drop ALL, seccomp 생략과 명시 프로필을 예로 기본값 차이를 풉니다
4. Pod/컨테이너 위치와 병합·프로필 선택 우선순위를 설명합니다
5. PSA baseline/restricted 요구와 runAsNonRoot 이미지 검사를 같은 Pod의 두 단계로 비교합니다
6. privileged·user namespace·SELinux·RuntimeClass의 지원/예외를 묶고 실패 단계로 진단합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

API에서 필드를 허용했다는 것은 노드가 그 제한을 적용했다는 뜻은 아닙니다
kubelet이 생략 값을 해석하고 런타임이 필요한 프로필과 커널 기능을 사용할 수 있어야 합니다

## 유지할 내용과 조건

- capability 생략과 ALL 제거 차이
- PSA 수준·정책 버전·면제와 node 지원은 별도
- user namespace의 현재 정책 완화 조건, privileged와 개별 프로필의 효과 관계

## 편집 후 독자 확인

- baseline 통과가 seccomp나 drop ALL 적용을 보장하지 않는 이유를 말하는가?
- PSA 거부와 kubelet 이미지 사용자 검사 실패를 나눌 수 있는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
