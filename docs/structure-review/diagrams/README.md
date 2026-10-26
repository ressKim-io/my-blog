# Kubernetes 이론 글의 추가 그림 8장

2026-10-26, 승인된 목업의 제작 8/8·독립 검토 8/8을 완료했습니다
Kubernetes 이론 71편에서 참조하는 고유 SVG는 145장에서 153장으로 늘었습니다
기존 그림과 본문은 유지하고, 아래 8편에 그림과 필요한 가정 설명만 추가했습니다

| 글 | 추가 그림 | 제작 | 독립 검토 |
|---|---|---|---|
| [자원 계산과 점수](../../../src/content/essays/kubernetes/k8s-theory-resource-accounting-scoring.md) | [init·sidecar·앱 실행 구간](../../../public/diagrams/k8s-theory-resource-accounting-scoring-3.svg) | 완료 | 완료 |
| [HPA와 scale](../../../src/content/essays/kubernetes/k8s-theory-hpa-scale-subresource.md) | [움직이는 축소 안정화 창](../../../public/diagrams/k8s-theory-hpa-scale-subresource-3.svg) | 완료 | 완료 |
| [페이지 캐시와 OOM](../../../src/content/essays/kubernetes/k8s-theory-page-cache-reclaim-oom.md) | [usage와 working set의 회계](../../../public/diagrams/k8s-theory-page-cache-reclaim-oom-3.svg) | 완료 | 완료 |
| [장치 자원 할당](../../../src/content/essays/kubernetes/k8s-theory-device-resource-allocation.md) | [서버 한 대 안의 NUMA 배치](../../../public/diagrams/k8s-theory-device-resource-allocation-4.svg) | 완료 | 완료 |
| [Netfilter와 conntrack](../../../src/content/essays/kubernetes/k8s-theory-netfilter-conntrack.md) | [요청·응답의 NAT 주소 변화](../../../public/diagrams/k8s-theory-netfilter-conntrack-3.svg) | 완료 | 완료 |
| [Overlay와 native routing](../../../src/content/essays/kubernetes/k8s-theory-overlay-native-routing.md) | [VXLAN 패킷의 MTU 단면](../../../public/diagrams/k8s-theory-overlay-native-routing-2.svg) | 완료 | 완료 |
| [CRD 스키마와 가지치기](../../../src/content/essays/kubernetes/k8s-theory-crd-schema-pruning.md) | [필드 보존과 제거의 경계](../../../public/diagrams/k8s-theory-crd-schema-pruning-3.svg) | 완료 | 완료 |
| [볼륨 확장과 스냅샷](../../../src/content/essays/kubernetes/k8s-theory-volume-expansion-snapshots-ephemeral.md) | [API·실제 스냅샷·새 볼륨](../../../public/diagrams/k8s-theory-volume-expansion-snapshots-ephemeral-3.svg) | 완료 | 완료 |

두 제작자가 4편씩 담당했고, 별도 검토자가 8편 모두 수정 본문 전문과 desktop·mobile 렌더를 먼저 읽은 뒤 원문·기존 그림·목업을 대조했습니다
메인 검토에서 반송한 제목, 스냅샷 소스 연결, 반복 설명·접근성 서술을 수정한 뒤 다시 확인했습니다
미해결 제작·내용 검토 사항은 없습니다

- [승인 목업](plan.md)
- [제작 A와 반송 기록](production-a.md) · [제작 B와 반송 기록](production-b.md)
- [독립 내용·시각 검토](independent-review.md)
- [실제 실행 검증](verification.md)

이 문서는 2026-10-26의 게시 전 제작·로컬 검증 기록입니다
해당 검증 시점에는 커밋·push·배포를 실행하지 않았습니다
