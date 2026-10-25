# 기술 재확인 범위와 보존한 의문

이번 작업은 설명 순서와 연결을 개선하고 원문의 사실·조건·근거가 빠지지 않았는지 대조하는 작업입니다
원문에 있는 Kubernetes·라이브러리·커널 주장을 전수 재검증하거나 클러스터에서 재현하지 않았습니다
수정 담당의 최종 보고에서는 새로 발견한 미해결 기술 의문이 없었습니다
아래는 해결한 것으로 바꾸지 않고 보존한 기존 의문·문서와 구현의 차이입니다

| 원문 | 보존한 확인 범위 |
|---|---|
| [직렬화·버전 변환](../../../src/content/essays/kubernetes/k8s-theory-serialization-version-conversion.md) | CR protobuf 지원에 관한 문서 차이와 endpoint·응답 형식 조건 |
| [watch](../../../src/content/essays/kubernetes/k8s-theory-watch.md) | 공식 문서 설명과 고정한 legacy watch 구현 분기의 차이 |
| [버전·롤백](../../../src/content/essays/kubernetes/k8s-theory-version-emulation-rollback.md) | statusz 문서 예시와 소스 응답 타입의 min compat 항목 차이, 실제 서버 응답 미확인 |
| [CRD 버전 변환](../../../src/content/essays/kubernetes/k8s-theory-crd-version-conversion.md) | migration 문서 상단의 단계·기본값과 본문 안내 차이, 현행 구현과 구분 |
| [정책 계층](../../../src/content/essays/kubernetes/k8s-theory-policy-layers.md) | Kyverno clone 원본 삭제에 대한 문서 본문·표 차이와 추적 경로별 실제 삭제 조건 |
| [ServiceCIDR·IPAddress](../../../src/content/essays/kubernetes/k8s-theory-service-cidr-ip-address.md) | 과거 용량 수치가 달라진 이유 미확인, 문서 이벤트 reason과 현행 소스 차이 |
| [DNS](../../../src/content/essays/kubernetes/k8s-theory-dns-ndots.md) | KEP의 재시도 3회에 대한 환경·산출 근거, glibc 기본 attempts와 다른 이유 미확인 |
| [관리자 네트워크 정책](../../../src/content/essays/kubernetes/k8s-theory-admin-network-policy.md) | Allow/Accept의 버전별 명칭, domainNames의 Accept 전용 설계 이유 미확인, 설계 대안의 부호 불일치 |

본문의 원래 버전·고정 ref·불확실성 표시를 유지했습니다
이 목록의 항목을 확인하려면 해당 본문에 남긴 고정 소스와 문서, 필요한 실제 실행 환경을 따로 대조해야 합니다
외부 출처 URL은 보존을 검사하며 이번 작업에서 모든 외부 URL의 현재 HTTP 응답이나 링크된 주장 전체를 재검증하지 않습니다
