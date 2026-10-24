# 잔여 35편 연속 편집

시작일: 2026-10-24
상태: 편집·독립 검수·렌더링·전체 빌드 확인 완료

사용자는 Kubernetes 이론 글의 잔여 35편도 이전과 같은 방식으로 모두 진행하도록 승인했습니다
Batch 12~22는 3편씩, Batch 23은 2편을 다룹니다
이전 36편과 기존 코드 변경은 보호하며 이 실행에서 다시 편집하지 않습니다

## 진행 방식

- 편집자는 각 글의 전문을 읽고 자연스러운 한국어와 독자가 따라갈 설명 순서를 필요한 만큼 다듬습니다
- 다른 검수자가 원문·수정본 전문을 대조하고, 보완과 문맥 재확인 및 렌더링을 마친 뒤 다음 배치로 넘어갑니다
- 기술 조건·수치·불확실성·출처·이미지·코드·title/excerpt 외 front matter를 보존합니다
- 기술 사실 전체를 새로 검증하거나 경험·측정·주장을 추가하는 작업은 아닙니다
- lint·정량 문체 판정·일괄 템플릿 적용·새 의존성·자산·코드 변경·commit·push·배포는 하지 않습니다

## 배치

| 배치 | 대상 | 상태 |
|---|---|---|
| 12 | 노드 하트비트·ConfigMap/Secret 전달·CRI/OCI | 편집·검수·렌더링 완료 |
| 13 | 장치 자원 할당·런타임 격리·자원 계산과 점수 | 편집·검수·렌더링 완료 |
| 14 | 노드 swap·컨테이너 로그·HPA scale | 편집·검수·렌더링 완료 |
| 15 | 임시 컨테이너·Pod sandbox·overlay/native routing | 편집·검수·렌더링 완료 |
| 16 | Service/kube-proxy·DNS ndots·Ingress/Gateway API | 편집·검수·렌더링 완료 |
| 17 | NetworkPolicy·관리자 네트워크 정책·클라우드 컨트롤러 | 편집·검수·렌더링 완료 |
| 18 | 트래픽 지역성/dual stack·Service CIDR/IPAddress·PVC 바인딩 | 편집·검수·렌더링 완료 |
| 19 | CSI 구조·StatefulSet 볼륨·볼륨 확장/스냅샷/임시 볼륨 | 편집·검수·렌더링 완료 |
| 20 | 볼륨 연결 제한·스토리지 용량 스케줄링·CRD 스키마/pruning | 편집·검수·렌더링 완료 |
| 21 | CRD 버전 변환·controller-runtime reconcile·정책 계층 | 편집·검수·렌더링 완료 |
| 22 | 집계 API 서버·netfilter/conntrack·mount/bind mount | 편집·검수·렌더링 완료 |
| 23 | page cache/reclaim/OOM·namespace 수명 | 편집·검수·렌더링 완료 |

기준본·manifest.json·protected.json은 `/private/tmp/my-blog-editorial-20261024-run35/`에 있습니다

## 결과

완료 35/35편, 누적 71/71편
전체 Next.js 빌드는 35편 편집 후 메인 채팅에서 실행해 통과했습니다
배치별 실제 교정·검수·검증 내용은 batch-12.md부터 batch-23.md까지 기록합니다

독립 검수에서 발견한 주어·서술어 호응, 한정 대상, 소켓 역할과 OOM 집계 표현 6곳을 보완했습니다
검수자가 보완한 6곳과 인접 문맥을 다시 확인했고 남은 문제는 발견하지 못했습니다
원문의 기술 사실 전체나 외부 소스의 정확성을 새로 검증한 결과는 아닙니다

마지막에 35편 전체를 PostDetail과 같은 remark 설정으로 MDX 컴파일·정적 HTML 렌더링했습니다
source URL·이미지 경로·코드 블록·title/excerpt 외 front matter 보존 검사에 모두 통과했습니다
변경 헤더로 향하는 저장소 내 fragment 링크 파손은 발견하지 못했습니다
보호 대상 398개 파일의 hash가 기준과 같고 Git 상태에도 지정 범위 밖 추가 변경은 없습니다
대기열의 71편 모두 검수 완료 상태이며 이전 Batch 01~11 기록과 run-30.md는 수정하지 않았습니다

메인 채팅에서 `node node_modules/next/dist/bin/next build --webpack`을 실행했고 TypeScript 검사와 정적 페이지 640개 생성에 성공했습니다
`node scripts/postbuild.mjs`도 성공했습니다
글 수·분류가 바뀌지 않아 통계 파일을 갱신하는 prebuild 훅은 실행하지 않았습니다
빌드 뒤에도 보호 파일 398개와 검수를 마친 본문 35개의 hash가 그대로임을 확인했습니다
대기열 71/71편 완료 상태와 지정 범위 밖 추가 변경이 없음을 다시 확인했습니다
lint·별도 테스트 스위트·commit·push·배포는 실행하지 않았습니다
