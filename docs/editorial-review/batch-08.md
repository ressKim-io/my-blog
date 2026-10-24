# Batch 08 — 버전 emulation과 롤백·컨트롤 플레인 이중화·Event 압축

실행일: 2026-10-24
상태: 편집·독립 검수·배치 렌더링 확인 완료

## 대상과 실제 교정

### `k8s-theory-version-emulation-rollback.md`

세 버전과 minor 차이를 일상적인 수 표현으로 풀고, min compat의 저장 데이터 영향을 헤더에 드러냈습니다

- 원문: binary에서 minor 셋을 뺀 값
- 수정: binary보다 마이너 버전 세 단계 낮은 값

### `k8s-theory-control-plane-high-availability.md`

learner 요청 처리와 외부 etcd 의존성의 적용 범위를 더 직접적으로 적었습니다

- 원문: 외부 etcd도 저장소 장애와 API 서버의 연결을 없애지는 않습니다
- 수정: 외부 etcd를 써도 API 서버의 저장소 의존성은 남습니다

### `k8s-theory-event-compression.md`

Event를 묶는 기준, 메모리 카운트 반영, 처리기 채널별 전송 결과를 구체화했습니다

- 원문: 동형 이벤트 튜플
- 수정: 같은 이벤트로 묶을 필드 조합

## 독립 검수와 보완

작성하지 않은 reviewer가 원문·수정본 3편을 전문 대조했습니다. 의미·조건 누락은 발견하지 못했습니다. 5분에 보충되는 대상이 Event가 아니라 토큰임을 드러내도록 '약 5분마다 토큰 하나가 보충됩니다'로 고쳤습니다. 앞의 QPS 1/300 표와 뒤의 화면 표시 간격 설명을 함께 재확인했습니다

## 보존과 검증

버전 설정과 저장 데이터의 관계, etcd·API 서버·컨트롤러의 장애 범위, Event의 집계·전송·TTL·토큰 버킷 조건을 보존했습니다. 문서와 소스의 차이 및 실제 응답 미확인 표시도 남겼습니다

- 기준본과 source URL·이미지 경로의 개수와 값, 코드 블록, title·excerpt 외 front matter가 같습니다
- 바뀐 헤더로 향하는 저장소 내 fragment 링크를 확인했고, 끊어진 연결은 발견하지 못했습니다
- 현재 PostDetail과 같은 remark-gfm (`singleTilde: false`)·remark-cjk-friendly 설정으로 3편을 compileMDX 컴파일한 뒤 React 정적 HTML 렌더링에 성공했습니다
- 보호 대상 hash가 기준과 같습니다. 전체 빌드는 30편 편집 뒤 별도로 실행합니다
- lint·테스트 스위트·외부 기술 사실 재검증은 실행하지 않았습니다. 렌더링 검사는 문장 품질 판정으로 사용하지 않았습니다

## 남은 사항

미해결 편집 차단 항목은 없습니다
