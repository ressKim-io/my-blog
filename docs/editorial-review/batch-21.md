# Batch 21 — CRD 버전 변환·controller-runtime reconcile·정책 계층

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-crd-version-conversion.md`

finalizer 자체가 조회·삭제하는 듯한 문장을 처리 컨트롤러의 동작으로 고쳤습니다

- 원문: CRD 삭제의 정리 finalizer도 남은 CR을 목록 조회하고 삭제합니다
- 수정: CRD의 삭제 finalizer를 처리하는 컨트롤러도 남은 CR을 목록 조회하고 삭제합니다

### `k8s-theory-controller-runtime-reconcile.md`

앞 문장의 여러 필드 중 뒤처진 값을 observedGeneration으로 밝혔습니다

- 원문: 이 값이 뒤처졌다면 condition의 상태가 현재 spec을 관찰한 결과인지 따로 확인해야 합니다
- 수정: observedGeneration이 뒤처졌다면 condition의 상태가 현재 spec을 관찰한 결과인지 따로 확인해야 합니다

### `k8s-theory-policy-layers.md`

운영 권한의 관리자와 혼동되지 않도록 field manager를 명시했습니다

- 원문: 관리자 이름은 요청의 `fieldManager` 또는 User-Agent에서 유래할 수 있으므로 실제 `managedFields`를 확인해야 합니다
- 수정: field manager 이름은 요청의 `fieldManager` 또는 User-Agent에서 유래할 수 있으므로 실제 `managedFields`를 확인해야 합니다

## 독립 검수와 보완

별도 reviewer 전문 대조에서 추가 수정 사항은 없었습니다. finalizer·webhook 응답 주체, defaulting·HPA·observedGeneration, 정책 거절 대상과 field manager 구분이 원래 의미를 유지한다고 확인했습니다

## 보존과 검증

CRD 변환과 실제 재쓰기·storedVersions 구분, 큐·캐시·재시도 보장 범위, 정책 설정 오류·규칙 위반·별도 쓰기와 소유권 조건을 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 변경 헤더로 향하는 저장소 내 fragment 링크 파손은 발견하지 못했습니다
- PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 35편 편집 뒤 메인 채팅에서 실행합니다
- lint·별도 테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링을 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
