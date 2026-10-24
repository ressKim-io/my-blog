# Batch 10 — preemption과 PDB·kubelet과 Pod 수명주기·QoS와 cgroup

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-preemption-pdb.md`

제목과 흐름은 유지하고 종료 유예 중 자원을 쓰는 주체, 예산 검사를 적용하는 대상을 구체화했습니다

- 원문: 종료 유예 동안 자원이 남아 있을 수 있으므로
- 수정: 종료 유예 동안 희생자가 자원을 계속 사용할 수 있으므로

### `k8s-theory-kubelet-pod-lifecycle.md`

주기적으로 이뤄지는 일이 Pod 실행 자체가 아니라 동기화임을 명시하고 종료 시간 설명의 대상을 밝혔습니다

- 원문: 모든 Pod가 정확히 1분마다 실행된다는
- 수정: 모든 Pod의 동기화가 정확히 1분마다 이뤄진다는

### `k8s-theory-qos-cgroups.md`

배치 계산과 cgroup 집행의 예약량 차이를 Pod의 메모리 사용과 연결해 풀었습니다

- 원문: 예약 구간에 Pod의 초과 사용이 들어갈 수 있습니다
- 수정: Pod가 request를 초과해 메모리를 쓰면 배치 계산에서 제외했던 eviction 예약분까지 사용할 수 있습니다

## 독립 검수와 보완

작성하지 않은 reviewer가 원문·수정본 3편을 전문 대조했습니다. 필수 의미 보존 오류는 발견하지 못했습니다. QoS 글의 '예약분'이 system·kube 예약분까지 포함하는 것으로 읽힐 수 있어 'eviction 예약분'으로 좁혔습니다. 바로 앞 allocatable/cgroup 계산표와 설정 조건을 함께 재확인했습니다

## 보존과 검증

preemption과 Eviction API의 PDB 적용 차이, 종료 중 희생자의 자원 사용, kubelet 동기화 재예약·종료 유예 조건, QoS·cgroup·resize 설정과 예약량 계산 차이를 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 바뀐 헤더로 향하는 저장소 내 fragment 링크를 확인했고, 끊어진 연결은 발견하지 못했습니다
- 현재 PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 30편 편집 뒤 별도로 실행합니다
- lint·테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링 검사는 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
