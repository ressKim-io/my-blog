# Batch 04 — watch·오브젝트 식별과 소유 관계·삭제 수명주기

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-watch.md`

삭제 이벤트를 놓친 로컬 사본의 문제를 기본 LIST·watch 설명 다음으로 옮겨 전체 snapshot 재수집의 이유를 먼저 설명했습니다

- 원문: 캐시에 요구하는 신선도 번호
- 수정: 캐시가 따라잡아야 할 resourceVersion

### `k8s-theory-object-identity-ownership.md`

소유자 조회에 쓰는 정보와 큐 작업을 처리하는 주체를 구체적으로 적었습니다

- 원문: 참조 좌표
- 수정: 조회 대상을 식별하는 API version·kind·name·UID·namespace

### `k8s-theory-deletion-lifecycle.md`

DELETE 뒤 객체가 남는 이유를 제목에 드러내고, 삭제 전제와 Namespace 정리 절의 대상 표현을 풀었습니다

- 원문: Namespace는 안의 내용을 확인한 뒤 자기 finalizer를 제거합니다
- 수정: Namespace 안의 객체를 정리한 뒤 finalizer를 제거합니다

## 독립 검수와 보완

작성하지 않은 reviewer가 원문·수정본 3편을 전문 대조했습니다. 의미 보존 오류는 발견하지 못했습니다. GC 캐시에 있는 자식이 '부모 삭제를 기다리게 한다'는 문장의 주체가 모호해 '부모 삭제를 보류시킬 수 있다'로 고친 뒤 foreground/background 문맥을 다시 확인했습니다

## 보존과 검증

watch 복구의 전체 snapshot·410 발생 위치, UID와 이름의 구분, GC 캐시와 blockOwnerDeletion 조건, discovery 실패의 범위, finalizer·유예 종료·generation의 적용 조건을 보존했습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 바뀐 헤더로 향하는 저장소 내 fragment 링크를 확인했고, 끊어진 연결은 발견하지 못했습니다
- 현재 PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 30편 편집 뒤 별도로 실행합니다
- lint·테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링 검사는 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
