# 3편씩 10개 배치 최종 인계 — 2026-10-23

추가 **30편 완료·보류 0편**, SVG **60장**
기존 26편과 합쳐 k8s-theory 글 56편이며, 현재 원본 71개 중 다음 미착수는 4-4다

| 배치 | 좌표 | 콘텐츠 커밋 | 진행 기록 커밋 | SVG | build pages | 검증 |
|---|---|---|---|---:|---:|---|
| 07 | 2-4, 2-5, 2-6 | `cc7ff41` | `62c33a2` | 6 | 586 | post lint error 0/warn 3, lint 0/1, build/export 통과 |
| 08 | 2-7, 2-8.1, 2-8.2 | `4db7801` | `4acc3a3` | 7 | 592 | post lint error 0/warn 3, lint 0/1, build/export 통과 |
| 09 | 2-9, 2-10, 2-11 | `fbcd25e` | `d14b474` | 6 | 598 | post lint error 0/warn 3, lint 0/1, build/export 통과 |
| 10 | 2-12, 2-13, 2-14 | `2167f11` | `cf70b1e` | 7 | 604 | post lint error 0/warn 3, lint 0/1, build/export 통과 |
| 11 | 2-15, 2-16, 2-17 | `31c4495` | `6442419` | 5 | 610 | post lint error 0/warn 3, lint 0/1, build/export 통과 |
| 12 | 2-18, 3-1, 3-2.1 | `3c62d6a` | `7e6a39f` | 6 | 616 | post lint error 0/warn 3, lint 0/1, build/export 통과 |
| 13 | 3-2.2, 3-3, 3-4 | `a999ddc` | `ab8dae0` | 6 | 622 | post lint error 0/warn 3, lint 0/1, build/export 통과 |
| 14 | 3-5, 3-6, 3-7 | `36b28e6` | `8a5280a` | 5 | 628 | post lint error 0/warn 3, lint 0/1, build/export 통과 |
| 15 | 3-8, 3-9, 3-10 | `28a9375` | `d293d21` | 6 | 634 | post lint error 0/warn 3, lint 0/1, build/export 통과 |
| 16 | 4-1, 4-2, 4-3 | `c5f8353` | `2f29cf1` | 6 | 640 | post lint error 0/warn 4, lint 0/1, build/export 통과 |

별도 blog-reviewer가 각 배치 원본·기술 정확성·문체·SVG를 검토했고, 지적 수정 뒤 최종 저장본으로 lint·build·정적 출력 검증을 실행했다
각 편의 정확한 원본 이름·SHA-256·공식 URL·버전 정정·검수 결과·대표 문장은 `batch-07.md`~`batch-16.md`에 보존했다

최종 통합 점검은 30개 HTML·모든 SVG의 export 참조와 바이트·내부링크·sitemap·llms·검수 후 파일 hash·원본 hash·허용된 변경경로를 확인했다
RSS는 최신 20편 정책을 배치별로 검증했다. CLAUDE.md의 이번 자동 통계 변경만 복원했고 원본 Vault 변경은 없다

- 남은 경고는 긴 줄·SVG 텍스트 수 권장, 기존 `layout.tsx:80`의 custom font 1건, Node `DEP0205`와 TS 직접 import 경고다. SVG 텍스트 수 경고는 독립 검수자가 375px 렌더를 확인해 가독성 문제 없음으로 판단했다
- DNS의 역사적 KEP에 적힌 3회 재시도는 환경과 산출 근거를 확인하지 못했다. glibc 기본 `attempts=2`와의 차이를 유보로 기록했으며 현재의 보편적 재시도 횟수·30초 지연 계산에 사용하지 않았다. [Batch 13 근거](batch-13.md)
- ServiceCIDR KEP의 역사적 IPv6 `/112`·약 32k 수치 산출 이유와 관리자 정책의 일부 설계 의도도 미확인으로 보존했다. 현재 주소 범위와 정책 동작은 확인한 구현을 기준으로 설명하며, 이 역사적 수치나 설계 의도를 추정하지 않았다. [Batch 14](batch-14.md) · [Batch 15](batch-15.md)
- 공식 문서와 고정 구현의 차이, 구현별 지원·기능 게이트·조건은 각 배치 인계에 남겼다. 실제 클러스터에 설치된 버전이나 동작을 실험한 결과로 일반화하지 않는다
- 새 의존성 추가·push·배포·시리즈 카드 등록·클러스터 실습·성능 실측은 실행 안 함

## 다음 3편 (이번 요청 범위 밖·미착수)

| 좌표 | 정확한 원본 파일 | 예정 slug | series/order | 상태 |
|---|---|---|---|---|
| 4-4 | `Phase 4-4 · StatefulSet과 볼륨 수명 · 지우는 대신 주인을 바꾼다.md` | `k8s-theory-statefulset-volume-lifecycle` | `k8s-theory-storage`/4 | 미착수 |
| 4-5 | `Phase 4-5 · 확장과 스냅샷과 임시 볼륨 · 나중에 하는 일에 새 장치는 없다.md` | `k8s-theory-volume-expansion-snapshots-ephemeral` | `k8s-theory-storage`/5 | 미착수 |
| 4-6 | `Phase 4-6 · 볼륨 개수 상한 · 드라이버가 말한 숫자를 누가 고치나.md` | `k8s-theory-volume-attachment-limits` | `k8s-theory-storage`/6 | 미착수 |
