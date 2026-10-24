# Batch 06 — reconcile·API 확장 지점·APF

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-reconcile.md`

설명 순서를 유지하고 expectations가 기다리는 대상이 자식 이벤트임을 구체화했습니다

- 원문: 기대 개수를 기록
- 수정: 기다릴 생성 이벤트 수를 기록

### `k8s-theory-api-extension-points.md`

요청의 종류와 버전 간에 지켜야 할 조건을 문장 안에서 밝혔습니다

- 원문: 다섯 시도를 병렬로 보내
- 수정: GET 요청을 다섯 번 병렬로 보내며

### `k8s-theory-api-priority-fairness.md`

요청의 폭과 캐시 신선도를 처리 자리 수와 필요한 revision으로 풀어 썼습니다

- 원문: 현재 한도보다 넓은 요청
- 수정: 현재 동시성 한도보다 많은 자리가 필요한 요청

## 독립 검수와 보완

작성하지 않은 reviewer가 원문·수정본 3편을 전문 대조했습니다. 수정이 필요한 문제는 발견하지 못했습니다. expectations 풀이가 관찰 대상과 일치하고 APF 표현도 기존 처리 폭·캐시 신선도의 뜻을 보존한다고 확인했습니다

## 보존과 검증

expectations의 만료·실패 요청 차감, reconcile 보호 범위, API 등록·서빙·기능 활성의 구분, APF의 추정값·상한·예외와 버전별 적용 조건을 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 바뀐 헤더로 향하는 저장소 내 fragment 링크를 확인했고, 끊어진 연결은 발견하지 못했습니다
- 현재 PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 30편 편집 뒤 별도로 실행합니다
- lint·테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링 검사는 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
