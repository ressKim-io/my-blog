# 블로그 문장·흐름 편집 진행표

이 채팅은 작업 범위와 편집 방향을 조정하는 역할을 맡고, 글의 검토·수정과 독립 검수는 에이전트가 분담합니다
채팅에는 배치 결과와 판단이 필요한 문제만 간단히 보고하며, 세부 내용은 이 폴더에 남깁니다

## 사용자 요청과 현재 범위

- 2026-10-24: Kubernetes 글 표본의 자연스러운 한국어와 블로그 적합성을 검토했습니다
- 사용자는 lint로 잡을 수 없는 문장·설명 흐름을 원하며, lint 결과를 품질 판단으로 사용하지 말라고 명시했습니다
- 같은 채팅에서 에이전트를 이용해 여러 글을 점검하고 다듬기로 했습니다
- 이전 36편과 이번 잔여 작업 0편의 편집·독립 검수를 마쳤습니다. 누적 36/71편, 남은 35편입니다
- 다른 카테고리의 글도 이어서 다룰 수 있지만, 현재 배치에 포함하지 않습니다
- 후속 요청에 따라 다음 30편을 3편씩 10개 배치로 연속 편집했습니다. 매 배치 검수·보완 뒤 다음으로 진행했습니다

- 추가 요청: 잔여 35편 전체를 Batch 12~23으로 나누어 순차 편집·독립 검수합니다

## 편집·검수 방식

1. 담당 파일을 나눠 전문을 읽고 문장과 설명 순서를 편집합니다
2. 제목이 던진 질문에 본문이 적절한 시점에 답하는지, 용어 풀이 전에 예외가 쌓이지 않는지 확인합니다
3. 추상 명사를 실제 주체와 행동으로 풀고, 중복은 새로운 정보가 있는지를 보고 판단합니다
4. 기술적 조건·수치·출처·가정·미확인 사항을 보존합니다. 사실 확인이 필요한 문제는 문체 수정과 분리해 기록합니다
5. 다른 에이전트가 원문과 수정본을 대조하고, 의미 변화와 어색한 연결을 검토합니다
6. 빌드·MDX 검증은 렌더링 파손을 확인하는 보조 수단입니다. 문장의 자연스러움을 판정하는 수단으로 사용하지 않습니다

공통 기준은 [글쓴이 말투와 편집 기준](../writing-voice.md)을 따릅니다
단어를 일괄 치환하거나 모든 글에 같은 도입·결론을 붙이지 않습니다
실제 경험이 없는 이론 글에 개인 경험을 만들지 않습니다
slug·게시 날짜·시리즈 순서·코드·출처 URL은 편집 과정에서 임의로 바꾸지 않습니다
커밋·push·배포는 별도의 명시적 요청이 있을 때 실행합니다

## 배치 현황

[Kubernetes 이론 글 71편의 검토 대기열](queue.md)

| 배치 | 대상 | 상태 | 세부 기록 |
|---|---|---|---|
| 01 | API·노드·네트워크·스토리지·확장·커널의 표본 6편 | 편집·독립 검수 완료 | [batch-01.md](batch-01.md) |
| 02 | API 요청 경로·인증·인가 3편 | 편집·독립 검수·렌더링 완료 | [batch-02.md](batch-02.md) |
| 03 | Admission 순서·webhook 실패·resourceVersion 3편 | 편집·독립 검수·렌더링 완료 | [batch-03.md](batch-03.md) |
| 04 | watch·오브젝트 식별과 소유 관계·삭제 수명주기 3편 | 편집·독립 검수·렌더링 완료 | [batch-04.md](batch-04.md) |
| 05 | Server-Side Apply·소유권 이행·informer 3편 | 편집·독립 검수·렌더링 완료 | [batch-05.md](batch-05.md) |
| 06 | reconcile·API 확장 지점·APF 3편 | 편집·독립 검수·렌더링 완료 | [batch-06.md](batch-06.md) |
| 07 | 직렬화와 버전 변환·인증서 발급과 위임·kubelet 접속 3편 | 편집·독립 검수·렌더링 완료 | [batch-07.md](batch-07.md) |
| 08 | 버전 emulation과 롤백·컨트롤 플레인 이중화·Event 압축 3편 | 편집·독립 검수·렌더링 완료 | [batch-08.md](batch-08.md) |
| 09 | 분산 추적·스케줄링과 바인딩·배치 제약 3편 | 편집·독립 검수·렌더링 완료 | [batch-09.md](batch-09.md) |
| 10 | preemption과 PDB·kubelet과 Pod 수명주기·QoS와 cgroup 3편 | 편집·독립 검수·렌더링 완료 | [batch-10.md](batch-10.md) |
| 11 | Eviction과 OOM·워크로드 롤아웃·Job과 CronJob 3편 | 편집·독립 검수·렌더링 완료 | [batch-11.md](batch-11.md) |
| 12 | 노드 하트비트·ConfigMap/Secret 전달·CRI/OCI 3편 | 편집·독립 검수·렌더링 완료 | [batch-12.md](batch-12.md) |
| 13 | 장치 자원 할당·런타임 격리·자원 계산과 점수 3편 | 편집·독립 검수·렌더링 완료 | [batch-13.md](batch-13.md) |
| 14 | 노드 swap·컨테이너 로그·HPA scale 3편 | 편집·독립 검수·렌더링 완료 | [batch-14.md](batch-14.md) |
| 15 | 임시 컨테이너·Pod sandbox·overlay/native routing 3편 | 편집·독립 검수·렌더링 완료 | [batch-15.md](batch-15.md) |
| 16 | Service/kube-proxy·DNS ndots·Ingress/Gateway API 3편 | 편집·독립 검수·렌더링 완료 | [batch-16.md](batch-16.md) |
| 17 | NetworkPolicy·관리자 네트워크 정책·클라우드 컨트롤러 3편 | 편집·독립 검수·렌더링 완료 | [batch-17.md](batch-17.md) |
| 18 | 트래픽 지역성/dual stack·Service CIDR/IPAddress·PVC 바인딩 3편 | 편집·독립 검수·렌더링 완료 | [batch-18.md](batch-18.md) |
| 19 | CSI 구조·StatefulSet 볼륨·볼륨 확장/스냅샷/임시 볼륨 3편 | 편집·독립 검수·렌더링 완료 | [batch-19.md](batch-19.md) |
| 20 | 볼륨 연결 제한·스토리지 용량 스케줄링·CRD 스키마/pruning 3편 | 편집·독립 검수·렌더링 완료 | [batch-20.md](batch-20.md) |
| 21 | CRD 버전 변환·controller-runtime reconcile·정책 계층 3편 | 편집·독립 검수·렌더링 완료 | [batch-21.md](batch-21.md) |
| 22 | 집계 API 서버·netfilter/conntrack·mount/bind mount 3편 | 편집·독립 검수·렌더링 완료 | [batch-22.md](batch-22.md) |
| 23 | page cache/reclaim/OOM·namespace 수명 2편 | 편집·독립 검수·렌더링 완료 | [batch-23.md](batch-23.md) |

## 기존 작업 보호

시작 시 아래 변경은 이미 작업 트리에 있었으며 이번 편집 범위가 아닙니다

- `.github/workflows/deploy.yml`
- `scripts/postbuild.mjs`
- `src/lib/posts.ts`
- `scripts/publication.test.mjs`
- `src/lib/publication.mjs`

## 완료 현황

[이전 30편](run-30.md)에 이어 [잔여 35편](run-35.md)의 편집·독립 검수·렌더링·전체 빌드 확인을 마쳤습니다
이번 실행 35/35편, 누적 71/71편의 편집·독립 검수를 마쳤습니다
전체 Next.js 빌드와 postbuild가 통과했고, 미해결 편집 항목은 없습니다
배치별 실제 교정 사례와 독립 검수 결과는 위 기록에 남겼습니다
