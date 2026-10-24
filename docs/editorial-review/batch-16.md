# Batch 16 — Service/kube-proxy·DNS ndots·Ingress/Gateway API

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-service-kube-proxy.md`

NodePort 자체가 바뀌는 듯한 문장을 접속 가능한 주소의 변화로 명확히 했습니다

- 원문: 따라서 모드만 바꿨는데 특정 보조 주소로 접속하던 NodePort가 달라질 수 있습니다
- 수정: 따라서 모드만 바꿔도 NodePort에 접속할 수 있는 주소가 달라질 수 있습니다

### `k8s-theory-dns-ndots.md`

두 조각 이름이라는 압축 표현을 앞에 나온 실제 Service 이름 예시로 연결했습니다

- 원문: 낮은 ndots가 두 조각 Service 이름을 항상 실패시키는 것은 아닙니다
- 수정: 따라서 ndots를 낮췄다고 `my-svc.my-ns` 조회가 항상 실패하는 것은 아닙니다

### `k8s-theory-ingress-gateway-api.md`

차이·경계라는 추상어를 역할별로 편집하는 설정과 리소스로 풀었습니다

- 원문: Gateway API는 이 차이를 리소스 경계로 표현합니다
- 수정: Gateway API는 역할별로 편집할 설정을 서로 다른 리소스에 나눠 담습니다

## 독립 검수와 보완

별도 reviewer가 원문·수정본 전문을 대조했고 추가 수정 사항은 없었습니다. NodePort 주소·소켓 변환, resolver별 조건, Gateway의 허가 경계가 유지됐음을 확인했습니다

## 보존과 검증

Service 규칙·conntrack·NodePort 조건, DNS resolver·재시도·캐시 위치, Gateway RBAC·부착·교차 참조 허가를 보존했습니다. 미확인 사항과 문서·소스 차이도 남겼습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 변경 헤더로 향하는 저장소 내 fragment 링크 파손은 발견하지 못했습니다
- PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 35편 편집 뒤 메인 채팅에서 실행합니다
- lint·별도 테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링을 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
