# Ingress와 Gateway API — 역할에 따라 라우팅 설정 나누기 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-ingress-gateway-api.md](../../../src/content/essays/kubernetes/k8s-theory-ingress-gateway-api.md)
- 시리즈: `k8s-theory-network` / 6
- 원문 SHA256: `96938d00ed29b51039bc769cc9dc73a7ef3ff50ea5699b404a8671f9f92762bc`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

운영자는 진입점과 인증서를 맡고 앱 팀은 경로만 바꾸려면, Ingress와 Gateway API의 설정·허가 관계가 어떻게 달라질까요?

선행 개념: Service가 백엔드 접점을 제공한다는 점과 namespace·RBAC의 뜻을 전제합니다. listener는 요청을 받는 포트·프로토콜 설정으로 소개합니다

## 현재 전개

- L21: Ingress는 HTTP 요청과 Service를 연결합니다
- L58: 어노테이션으로 확장한 기능과 편집 권한
- L77: GatewayClass·Gateway·Route로 역할을 나눕니다
- L117: parentRefs는 부착 요청, allowedRoutes는 수락 범위입니다
- L139: ReferenceGrant는 참조 대상 쪽의 허가입니다
- L171: CRD 버전과 컨트롤러 지원을 따로 확인합니다
- L202: 생성 성공 뒤에는 부착과 참조 상태를 확인합니다
- L221: 단순한 라우팅과 역할 분리의 관리 비용

## 원문 근거와 개선점

### L38 역할 분리의 문제를 보기 전에 클래스 예외가 앞섭니다

> ### 어떤 컨트롤러가 처리할지 고르는 경로

Ingress의 기본 역할을 설명한 흐름은 좋습니다. 기본 클래스 선택, 과거 어노테이션, 다중 기본 클래스의 문서·소스 차이가 연달아 나오면서 도입의 편집 권한 문제로 돌아가는 데 시간이 걸립니다

수정 방향: 처음에는 ingressClassName이 처리 컨트롤러 선택과 연결된다는 관계만 둡니다. 기본값·레거시·문서와 소스 차이는 Ingress 처리기 선택의 보충 절로 옮겨 본래 조건을 유지합니다

### L105 리소스 관계를 소개한 뒤 부착 과정을 바로 완결합니다

> ### TLS 설정은 연결 구간별로 구분합니다

GatewayClass·Gateway·Route의 역할 다음에 TLS 종료·passthrough·백엔드 TLS를 설명합니다. Route가 Gateway에 붙을 수 있는지라는 기본 관계는 그 뒤에 나와 설정 관계를 한 번에 연결하기 어렵습니다

수정 방향: 역할 표 직후 parentRefs·allowedRoutes로 정상 부착을 설명합니다. 그다음 교차 namespace의 ReferenceGrant를 붙이고 TLS 구간별 설정을 인증서 참조의 확장 사례로 배치합니다

## 권장 설명 순서

1. 한 Ingress에서 경로와 TLS 설정을 함께 편집하게 되는 상황을 제시하고 일반 HTTP 요청과 Service 연결을 설명합니다
2. 어노테이션의 구현 의존성과 RBAC의 필드 분리 한계로 역할 분리의 필요를 구체화합니다
3. GatewayClass·Gateway·Route를 담당자와 편집 대상에 대응시키고 API 참조와 실제 패킷 경로를 구분합니다
4. 같은 namespace의 기본 부착을 parentRefs·listener·allowedRoutes로 완결합니다
5. 교차 namespace의 부착 허가와 백엔드·Secret 참조 허가를 비교하고 ReferenceGrant의 위치를 설명합니다
6. TLS 연결 구간·Ingress 클래스 예외·CRD 버전과 구현 지원을 필요한 보충 단위로 정리합니다
7. 생성 성공 뒤 status에서 확인할 것과 단순 라우팅·역할 분리의 관리 비용을 연결합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

역할별 리소스를 만들었다고 Route가 바로 연결되는 것은 아닙니다
앱 팀의 부착 요청과 운영자가 정한 수락 범위를 함께 확인해야 이 분리가 실제 위임 구조로 작동합니다

## 유지할 내용과 조건

- 한 사람이 여러 역할을 맡을 수 있고 리소스 분리만으로 RBAC이 설정되지 않는다는 설명을 보존합니다
- allowedRoutes와 ReferenceGrant의 허가 대상을 혼동하지 않습니다
- Ingress frozen은 deprecated나 제거 예정과 다르다는 원문 범위를 보존합니다
- Gateway API 버전·배포 채널·구현 지원·상태 반영은 각각 확인해야 한다는 조건을 유지합니다

## 편집 후 독자 확인

- Route 편집 권한과 Gateway 편집 권한을 나누는 이유를 구체적인 필드로 설명할 수 있나요?
- Gateway 부착과 다른 namespace의 Service 참조에 필요한 허가를 구분할 수 있나요?
- 리소스 참조선을 실제 패킷이 거치는 순서로 오해하지 않나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
