# Batch 14 인계 — 2026-10-23

3편 검수 완료, SVG 5장. 콘텐츠 커밋 `36b28e6`
이번 요청 누적 24/30편, 전체 시리즈 누적 50편

## 원본·결과 대응

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
읽기 전용으로 사용했으며 작업 전후 hash 일치를 검증했다
작성 기준일은 2026-10-23이며 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 3-5 | `Phase 3-5 · Ingress 와 Gateway API · 한 오브젝트에 세 사람이 있었다.md` | 381 | `5b7a5f2c27ff52aaf1b077255ba976111c19216f0fcc47df806831a97ac1f42d` | `k8s-theory-ingress-gateway-api` | `k8s-theory-network` / 6 |
| 3-6 | `Phase 3-6 · NetworkPolicy · 기본값을 뒤집는 스위치.md` | 437 | `37b49e26ec7f5506d88aacb57b15129fe27d6b9fe62ecd4bbe38ec548496300f` | `k8s-theory-network-policy` | `k8s-theory-network` / 7 |
| 3-7 | `Phase 3-7 · ANP 와 BANP · 정하지 않겠다고 적는 칸이 필요했다.md` | 663 | `18d7f426427fc3be88aa7003fb2e22c2c24bed8d66aa3ad8b9e548e47ad74521` | `k8s-theory-admin-network-policy` | `k8s-theory-network` / 8 |

글 경로는 `src/content/essays/kubernetes/{slug}.md`, SVG는 `public/diagrams/{slug}-{n}.svg`다

## 작성자의 근거 대조·편집 기록

아래는 작성 단계의 기록이다. 이후 보완·정정은 별도 검수와 지적 반영 기록을 우선한다

# Batch 14 · 3-7 관리자 네트워크 정책 인계

- 상태: 작성·개별 검사 통과, 별도 reviewer 및 배치 lint·build·정적 출력 검증 대기
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-7 · ANP 와 BANP · 정하지 않겠다고 적는 칸이 필요했다.md` 전문 663줄
- 원본 SHA-256: `18d7f426427fc3be88aa7003fb2e22c2c24bed8d66aa3ad8b9e548e47ad74521` 최종 재확인 일치
- 출력: `src/content/essays/kubernetes/k8s-theory-admin-network-policy.md`, 같은 slug SVG 1개 / 표 4개
- series `k8s-theory-network` order 8 / date `2026-10-23` / 첫 태그 Kubernetes
- 최신 progress·Phase 3 source-map 및 plan/source-format, draft-to-post 공동 절차·voice·선택지 가이드·SVG 기준 읽고 적용. 공통 파일 수정 없음

## 실제 확인한 ref·공식 근거

- [Network Policy API 최신 공식 릴리스](https://github.com/kubernetes-sigs/network-policy-api/releases/tag/v0.2.0): v0.2.0, `a17adecd0316b8ff1c3f83939ec0441d68cd6cce`, published 2026-04-21. Go 1.25.0·k8s modules v0.35.3은 이 외부 모듈의 의존성이며 Kubernetes v1.37 내장 기능이라는 근거로 쓰지 않음
- [현재 v1alpha2 타입](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/apis/v1alpha2/clusternetworkpolicy_types.go): Admin/NetworkPolicy/Baseline 순서·Accept/Deny 최종성·Pass의 다음 tier, priority 0~1000 작은 값 우선·동순위 미정·목록 순서·방향별 25규칙/peer·protocols 상한, subject/peer·hostNetwork 제외 범위, domainNames Accept 전용·접두 wildcard, 포트·fail-closed 계약
- [Standard CRD](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/config/crd/standard/policy.networking.k8s.io_clusternetworkpolicies.yaml)·[Experimental CRD](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/config/crd/experimental/policy.networking.k8s.io_clusternetworkpolicies.yaml): YAML을 실제 파싱해 kind/group/scope/v1alpha2/tier/action/limits 및 egress peer 집합 대조. nodes·domainNames는 experimental에만 존재; 결과 `schema-comparison.json`
- [구형 v0.1.7 타입](https://github.com/kubernetes-sigs/network-policy-api/tree/0638d394d89ddb61dded975b502391a122fc762c/apis/v1alpha1)·BANP CRD: ref `0638d394d89ddb61dded975b502391a122fc762c`, Allow/Deny/Pass·ANP 방향별 100규칙, BANP priority/Pass 없음·이름 default CEL 확인
- [현행 시작 안내](https://github.com/kubernetes-sigs/network-policy-api/blob/730bd5474d82a2cf82be8b0c6c2a5515598cc44e/site-src/getting-started.md)·[API 분류](https://github.com/kubernetes-sigs/network-policy-api/blob/730bd5474d82a2cf82be8b0c6c2a5515598cc44e/site-src/index.md): 현재 개발 CNP와 이전 ANP/BANP를 구분, release-0.1 유지·잠재 버그수정 안내. v0.2.0 CRD tree는 CNP만 제공, 구형 Go 타입 존재와 배포본 구분
- [NPEP-285](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/npeps/npep-285-combine-crds.md) 및 [공식 변경 안내 저장본](https://github.com/kubernetes-sigs/network-policy-api/blob/730bd5474d82a2cf82be8b0c6c2a5515598cc44e/site-src/blog/posts/ClusterNetworkPolicy.md): singleton 완화·tier 대안·Pass와 도메인 기본정책의 변경 배경
- Kubernetes website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`의 [NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)·[field validation](https://kubernetes.io/docs/reference/using-api/api-concepts/#setting-the-field-validation-level): 방향별 격리·명시적 거부/로그의 core 한계, Strict/Warn/Ignore 및 kubectl validate 기본 strict. 원본의 release-1.35 전체 grep 0건을 현행 조사로 재사용하지 않음
- [KEP-2091 메타](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-network/2091-admin-network-policy/kep.yaml): 과거 milestone과 stage alpha/latest-milestone v1.24를 구분
- [현재 구현 목록 고정본](https://github.com/kubernetes-sigs/network-policy-api/blob/730bd5474d82a2cf82be8b0c6c2a5515598cc44e/site-src/implementations.md): 2026-04-21 갱신 표시. CNP의 kube-network-policies/Kube-OVN experimental/Calico v3.32 standard와 구형 ANP/BANP 구현 목록을 별도로 읽음
- Cilium 최신 공식 릴리스 v1.20.3, `bf1aba7b34ab6d9c711315d78d8eefbea81962d1`: [values.yaml](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/install/kubernetes/cilium/values.yaml) `k8sClusterNetworkPolicy.enabled: false` 및 [go.mod](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/go.mod) network-policy-api v0.2.0 실제 확인
- [공개 conformance 보고서](https://github.com/kubernetes-sigs/network-policy-api/blob/730bd5474d82a2cf82be8b0c6c2a5515598cc44e/conformance/reports/v0.2.0/kube-network-policies.yaml): kube-network-policies v1.1.1-12-g9984dcd·API v0.2.0의 시험 범위 기록. 공개 결과와 이 작업의 미실행을 구분

## 원본 대비 정정·보존

- ‘v0.1.7에서 멈췄다’는 표현을 새 API 개발과 구형 유지 경로로 세분화. v1alpha2·standard를 stable/core API로 부르지 않음
- CNP 약자가 겹치는 `policy.networking.k8s.io ClusterNetworkPolicy`와 `cilium.io CiliumNetworkPolicy`를 첫 설명·표·설정 문맥에서 구분
- NetworkPolicy의 해당 방향 격리·암묵적 거부도 최종 판정이며 ‘허용 규칙 불일치→Baseline’으로 내려가지 않는 조건을 그림과 본문에 유지
- Pass와 단순 규칙 불일치, CIDR 외부 전용 가정의 오류, 모든 hostNetwork 주소가 제외된다는 일반화, CRD 저장과 집행·fail-closed 단계의 혼동을 방지
- 구현 목록의 Cilium tracking 및 원본 CFP 종료 기록을 현재 미지원/전체 구현의 근거로 쓰지 않음. 설정·의존성 확인 이상으로 활성화·conformance를 주장하지 않음
- 미확인 보존: Allow→Accept 개명 이유, domainNames Accept 전용 제한의 설계 이유, NPEP 숫자 대안과 Pass 예시의 부호 불일치에서 저자의 의도. 현재 API 계약과 분리해 본문에 고지
- 대표 문장: 원본 ‘다음 층이 허용 여부를 결정하므로 Pass 자체가 그 Pod 통신을 허용하는 것은 아니다’ → ‘다음 계층이 거부할 수 있으므로 Pass 자체가 통신을 허용하지도 않습니다’

## 실제 검증·한계

- 원본 전문·핵심 개념·조건 대조, 격식체·마침표·과장·반복·내부 편집 경위 검토. 미실행 LAB 7개를 실행 경험으로 만들지 않음
- 전 섹션 시각화 재검토: tier 판정만 SVG로, 버전·peer·실패 조건은 표, 설계 선택은 산문으로 표현
- SVG XML·role/title/desc 검사 및 sharp 600px/375px 렌더 성공. 두 렌더 직접 육안 검사해 겹침/잘림 없음, 모바일 최소 13.125px
- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-admin-network-policy.md` 실제 실행 error 0 / warn 1(100자 초과 17곳, URL·표·조건 문맥 검토)
- 성공 근거 파일 22개 SHA-256 및 원본 최종 hash 검증. 파일별 URL/ref/hash는 `manifest.json`, ref 메타는 `refs.json`, CRD 대조와 검증 요약은 `schema-comparison.json`·`verification.json`
- 선택지 비교 포함: 원본 NPEP의 tier 필드 대 숫자 범위 대안·기각 이유만 보존, 개인 선택 서사나 새 대안 없음
- 실제 CRD 설치·구현 활성화·정책 패킷 집행·지연/차단 로그·클러스터 실습은 실행 안 함. 핵심 API 근거의 보류 사유는 없고 위 역사적/설계 미확인은 유지
- 전체 lint·build·정적 출력·독립 검수·커밋은 parent 담당이며 이 보고서의 개별 검사와 구분


# Batch 14 · Ingress/Gateway API 작성 인계

- 작성 상태: 본문·SVG·작성자 검증 완료, 독립 reviewer·배치 build/export·commit은 parent 담당
- 글: `src/content/essays/kubernetes/k8s-theory-ingress-gateway-api.md`
- series: `k8s-theory-network` / order 6 / date `2026-10-23`
- tags: `kubernetes`, `ingress`, `gateway-api`, `networking`, `rbac`, `concept`
- 본문 230줄, SVG 2장, 표 4개. 원본 ASCII의 역할·부착 관계를 SVG로 변환하고 2번에 대상 네임스페이스의 Grant 패널을 보강
- 공통 plan/README·다른 글·원본·의존성 수정, commit/push/build 실행 없음

## 원본과 최신 문맥

원본 전문 381줄을 읽고 도입·기전·설계 이유·실패 판별·현재 정정 근거를 대조했습니다

- 원본 정확한 파일명: `Phase 3-5 · Ingress 와 Gateway API · 한 오브젝트에 세 사람이 있었다.md`
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-5 · Ingress 와 Gateway API · 한 오브젝트에 세 사람이 있었다.md`
- SHA-256: `5b7a5f2c27ff52aaf1b077255ba976111c19216f0fcc47df806831a97ac1f42d` (작업 전후 동일)
- 최신 `☸️ progress.md`: 1122줄, `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5` — 3-5 행·등급·후속 범위 확인
- 최신 `☸️ source-map.md`: 123줄, `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae` — 현재 v1.37 대조와 과거 v1.35 구분 확인
- 최신 `☸️ source-map · Phase 3.md`: 1265줄, `0458c79aa9dd7996a03d7babffc63068c5c3b5a7b16bc6906fc690b920f651bd` — 3-5 및 v1.37 정정에서 Gateway API v1.6.2·실제 Standard CRD와 overview 불일치·회수 시간 상한 부재 확인
- `2026-10-05 세부 학습 글 편집 계획과 인계.md`의 독자 자립성·관계 그림/실행 경로 구분·관리 경위 분리 기준 확인
- `.agents/skills/draft-to-post/SKILL.md`, 연결된 `.claude/skills/draft-to-post/SKILL.md`·decision-tradeoff, `docs/writing-voice.md`, plan/source-format, SVG 가이드, 기존 network 시리즈 Service/kube-proxy 글을 읽고 적용

## 실제 확인한 현재 기준과 근거

기존 캐시의 결론만 옮기지 않고 이번 대상의 공식 원문을 각 고정 ref에서 새로 받아 읽었습니다
전체 파일 URL·SHA는 `manifest.json`, 추가 문서는 `manifest-extra.json`, 공통 어노테이션 검증은 `manifest-objectmeta.json`에 있습니다

### Kubernetes

- Kubernetes v1.37.1 tag target: `f78e722310e50bcaca9276be22276d9e91d91308`
- website 고정 ref: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
- [IngressSpec·IngressTLS](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/networking/v1/types.go#L285-L345): className의 IngressClass 참조, 기존 class annotation deprecated/호환성, TLS 443, Secret 참조와 SNI/Host 경계 확인
- [DefaultIngressClass](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/network/defaultingressclass/admission.go#L60-L155): `newPlugin`은 Create만 처리, subresource 제외, className non-nil 또는 기존 class 어노테이션 키가 있으면 default 주입 생략, default 없음은 그대로 유지
- 같은 소스 `getDefaultClass` L129–155: `is-default-class == "true"`만 후보, CreationTimestamp 내림차순, 동률 Name 오름차순, 다중 후보에서도 최신 하나 반환. 다중 default라는 이유로 거절하지 않음
- [고정 website Ingress](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/ingress.md#L370-L386): 다중 default 시 생성을 거절한다는 문장이 실제 v1.37.1 소스와 다름. 소스 결과와 문서 설명을 본문에서 구분했고 실행 관찰로 쓰지 않음
- 같은 문서: Ingress만 생성해도 처리 효과가 생기지 않음, 컨트롤러 필요, HTTP/HTTPS 범위, frozen/GA/제거 계획 없음 확인
- [Ingress validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/validation/validation.go#L293-L315) → [ObjectMeta validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/api/validation/objectmeta.go#L47-L65): 공통 메타데이터 형식·어노테이션 qualified name/총 크기 검증. 구현별 키 의미 검사와 구분. Ingress create에서 class annotation과 className이 함께 있으면 값 일치 검사도 확인

### Gateway API

- GitHub [latest release API](https://api.github.com/repos/kubernetes-sigs/gateway-api/releases/latest)와 [release](https://github.com/kubernetes-sigs/gateway-api/releases/tag/v1.6.3)를 실제 조회: `v1.6.3`, published `2026-10-06T20:35:29Z`
- `/commits/v1.6.3` 실제 target: `c0836133e24073fcdcdbb1713aba3cc73a89d0b5` (`gateway-release.json`, `gateway-commit.json`)
- [go.mod](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/go.mod): Go 1.26.0, apimachinery/client-go v0.36.1, k8s.io/api v0.36.1. 이 모듈 의존성을 설치 클러스터나 컨트롤러의 지원 버전으로 확대하지 않음
- [GatewayClass 타입](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/apis/v1/gatewayclass_types.go): Cluster scope, `controllerName`과 명세/컨트롤러 책임 구분
- [Gateway 타입](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/apis/v1/gateway_types.go): `gatewayClassName`, listener, TLS mode/certificateRefs, 타 네임스페이스 Secret의 Grant·listener `ResolvedRefs=False/RefNotPermitted`, `AllowedRoutes`의 Same 기본값·kinds/protocol·namespace selector 확인
- [HTTPRoute 타입](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/apis/v1/httproute_types.go): 요청 매칭·backendRefs·Service 연결, `Timeouts`가 Extended 지원임을 확인
- [shared_types.go](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/apis/v1/shared_types.go#L341-L555): `Accepted`/`NotAllowedByListeners`, `ResolvedRefs`/`RefNotPermitted`, 부모·컨트롤러별 RouteParentStatus, 컨트롤러 가시성 부족 시 Accepted가 없을 수도 있다는 조건 확인
- [ReferenceGrant 타입](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/apis/v1/referencegrant_types.go)·[공식 문서 고정본](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/site/content/en/reference/api-types/referencegrant.md): 대상 네임스페이스, from/to·to.name, 변경/삭제 재계산·접근 회수, 허가 없는 대상 존재 정보 노출 금지, Route→Gateway의 allowedRoutes 예외, 대체 보안 수단 MAY의 동등성/문서화 조건 확인. 고정 회수 시간 상한은 제시하지 않음
- [역할](https://gateway-api.sigs.k8s.io/docs/concepts/roles-and-personas/)·[보안 모델](https://gateway-api.sigs.k8s.io/docs/concepts/security/): 세 역할의 리소스 편집 범위·리소스별 RBAC, 부착 handshake, namespace label 권한 영향 확인
- [TLS 가이드](https://gateway-api.sigs.k8s.io/guides/user-guides/tls/): downstream/upstream 독립, HTTPS 종료와 TLS passthrough, BackendTLSPolicy의 별도 역할 확인. backend TLS 상세 실습이나 인증서 발급 경험은 추가 안 함
- [채널·버전 문서](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/site/content/en/docs/concepts/versioning.md)·[적합성](https://gateway-api.sigs.k8s.io/docs/concepts/conformance/)·[구현 목록](https://gateway-api.sigs.k8s.io/docs/implementations/list/): bundle/API version/channel/support level의 차이, Gateway/Mesh·Route·Extended별 지원 확인 필요를 명시. 특정 구현의 전 기능 지원·실제 설치·conformance 실행을 주장하지 않음

### CRD 실제 대조

[v1.6.3 Standard 디렉터리](https://github.com/kubernetes-sigs/gateway-api/tree/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/config/crd/standard)의 8종 파일과 Experimental HTTPRoute 파일을 실제 읽었습니다
모두 bundle `v1.6.3`/channel `standard`인 8종에서 version/served/storage를 대조했습니다

| 리소스 | served true | storage true |
|---|---|---|
| GatewayClass·Gateway·HTTPRoute | v1, v1beta1 | v1 |
| GRPCRoute | v1 | v1 |
| TCPRoute·UDPRoute | v1 (v1alpha2는 served false) | v1 |
| TLSRoute | v1 (v1alpha2/v1alpha3는 served false) | v1 |
| ReferenceGrant | v1, v1beta1 | v1beta1 |

같은 ref overview의 TCPRoute/UDPRoute Alpha·Experimental 설명과 versioning 문서의 ReferenceGrant beta 예상은 실제 배포 CRD와 다릅니다
본문의 API 버전 표는 실제 CRD를 기준으로 했고, overview와의 차이를 기술 설명 옆에 남겼습니다

## 원본 대비 정정·편집

1. 원본의 역할 분리·어노테이션 확장/호환성·필드별 RBAC 부재·Secret 참조 편집과 데이터 권한 차이를 보존
2. Gateway API 기준을 원본 v1.6.2에서 실제 최신 v1.6.3으로 갱신. 이를 Kubernetes 버전 변경으로 쓰지 않음
3. 원본의 TCPRoute Standard/v1 정정은 현행 CRD로 재검증하고 TLSRoute·UDPRoute·ReferenceGrant의 served/storage 구분을 추가
4. DefaultIngressClass는 실제 생성 admission 분기와 문서 불일치를 확인해 보강. 새 클러스터에서 재현한 결과로 쓰지 않음
5. 두 SVG의 화살표는 설정 참조/허가이며 패킷 경로가 아님을 명시. CRD만 설치해도 데이터 경로가 생긴다는 설명 없음
6. LAB TODO·자가 종료 판정·CKA 커리큘럼·Phase·내부 편집 경위는 본문에서 제외. 실습·측정·기능 사용 경험 창작 없음
7. 원본의 단순 HTTP 관리 부담과 역할 분리 이점을 비교하는 문단 유지. 새 대안·실제 선정 경험은 추가 안 함

대표 문장:
- 원문: `ReferenceGrant 모델에서 Gateway에 다른 네임스페이스의 Secret을 쓰겠다고 적는 것은 참조 요청이다. 대상의 허가까지 그 요청으로 대신하면 Secret 소유 쪽이 접근을 통제할 수 없다.`
- 변환: `요청자가 자기 네임스페이스에 Grant를 만들어 다른 쪽의 리소스 사용을 허가할 수는 없습니다` / `자원을 참조하고 싶다는 요청과 그 자원 소유자의 허가를 분리하기 때문입니다`

## 실제 실행한 검증과 결과

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-ingress-gateway-api.md` 최종 exit 0, error 0/warn 1 — 긴 줄 12곳(긴 URL·기술 식별자 포함). 형식 통과와 별도로 문맥·원본 대조 수행
- `git diff --check -- <소유 본문·SVG 2개>` exit 0
- Python ElementTree로 SVG 2개 XML 파싱·title/desc/role 검사 통과. 본문 이미지 참조 2개 파일 실존 확인
- SVG text 수 13/16, 최소 font-size 23/22px. 한글 라벨·기술 식별자 원어, Cocoon light 팔레트 적용
- `sharp` 기존 설치본 0.34.5, `pnpm-lock.yaml`의 고정 버전 확인. 2개 SVG를 각각 800px/375px PNG로 렌더한 최종 명령 exit 0
- `diagram-{1,2}-{800,375}.png` 네 파일 모두 view_image로 육안 확인: 글자·선 겹침과 잘림 없음, 375px에서 역할·참조 방향·대상 네임스페이스 판별 가능
- 최초 렌더 명령은 네 PNG 생성 뒤 없는 package-lock.json 조회로 exit 1. 실제 pnpm-lock.yaml을 확인하고 조회를 바로잡아 동일 렌더를 exit 0으로 재실행함
- 최초 문서 경로 3건 404는 fixed tree에서 실제 `docs/implementations/list.md`, `guides/user-guides/tls.md`, `docs/concepts/security.md`를 찾아 해소. 404 내용을 근거로 사용하지 않음
- 원본 최신 SHA 최종 재확인. 글·SVG 최종 SHA는 `content-final.json`, 원본/context는 `source-final.json`
- 작성자 문맥 검토: 공식체·마침표·이모지·반복·조건·주체·내부 맥락 검사, 전체 섹션의 시각화 필요성 재판단 완료

## 남은 문제와 인계

- 보류 사유 없음. 문서/소스 불일치는 본문과 위 근거로 구분했으므로 reviewer가 실제 고정 파일과 재대조 가능
- 실제 컨트롤러 버전·클러스터 설치·트래픽·Grant 회수 지연·conformance 시험은 확인하지 않았고 실행 경험으로 쓰지 않음
- 전체 lint/build/정적 export/독립 검수는 이 작성 단계에서 실행 안 함. 배치 통과·완료 편수 반영은 parent의 최종 검증 뒤 결정


# Batch 14 · Phase 3-6 작성 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-6 · NetworkPolicy · 기본값을 뒤집는 스위치.md`
- 2026-10-23 최신 437줄 전문 읽음. SHA-256 `37b49e26ec7f5506d88aacb57b15129fe27d6b9fe62ecd4bbe38ec548496300f`, sources.json과 실제 파일 일치
- 최신 progress의 현행 후속 및 source-map Phase 3의 3-6 본절·외부 자료·v1.37 대조 확인. progress SHA `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, source-map SHA `0458c79aa9dd7996a03d7babffc63068c5c3b5a7b16bc6906fc690b920f651bd`
- 글: `src/content/essays/kubernetes/k8s-theory-network-policy.md`, 266줄. plan의 3-6 매핑과 동일한 `k8s-theory-network` / order 7 / date 2026-10-23
- tags: Kubernetes, NetworkPolicy, CNI, Security, Networking, concept
- SVG 2개: 방향별 허용 합집합·양끝 AND 개념도, 같은 peer와 별도 peer의 선택 집합 비교. 원본의 방향 스위치·selector ASCII를 재구성했고 별도 신규 주제 그림 0개. 표 3개, YAML 필드 설명 조각 3개
- draft-to-post 진입점·공동 절차·voice·plan/source-format·SVG 기준 적용. 같은 series의 Service 글 참조. 공통 문서·타인 파일 수정, commit/build/push 실행 안 함

## 실제 대조한 근거

| 대상 | 버전·ref |
|---|---|
| Kubernetes | v1.37.1 · `f78e722310e50bcaca9276be22276d9e91d91308` |
| website | 공식 저장본 · `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` |
| Cilium | v1.20.3 · `bf1aba7b34ab6d9c711315d78d8eefbea81962d1` |

이전 배치에서 확인한 고정 ref를 재사용하되 아래 파일은 이번에 실제 다운로드하고 본문에 필요한 절·심볼을 읽었다. 현재 공개 Kubernetes·Cilium 문서도 열어 v1.37·Cilium 1.20.3 표시와 경계를 대조했다. `manifest.json`에 11파일 URL/ref/hash 보존, 11/11 hash 일치, 다운로드 실패 0건

- https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/network-policies.md — 전문 확인. 방향별 격리·합집합·양끝 허용·응답, selector/NAT, SCTP/endPort, resident-node 양방향·self 예외, 기존 연결·hostNetwork·ICMP/ARP, 적용 시점의 API 관측 한계
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/networking/v1/types.go — NetworkPolicy에 실제 status가 없음, spec.podSelector 생략/빈 값, PolicyTypes·Ingress/Egress, Rule의 peer/ports OR·두 조건 AND, NetworkPolicyPort·IPBlock·NetworkPolicyPeer 주석
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/v1/defaults.go — SetDefaults_NetworkPolicy의 len(PolicyTypes)==0·len(Egress)!=0, SetDefaults_NetworkPolicyPort의 TCP 기본값. 파일 전문 확인
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/validation/validation.go — ValidateNetworkPolicyPort/Peer/Spec·ValidateIPBlock 및 신규/갱신 검증 경로. 빈 peer 오류, ipBlock과 selector 배타성, endPort 숫자·시작 포트·포함 범위 조건, except 진부분집합 검사
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/networking/networkpolicy/strategy.go — NamespaceScoped, Validate/ValidateUpdate, WarningsOnCreate/Update·networkPolicyWarnings, generation 변경. 전문 확인
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/networking/networkpolicy/storage/storage.go — NewREST의 generic store·strategy 연결, netpol short name. 전문 확인
- https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/security/policy/index.rst — 표준 NP·CNP·CCNP 및 L7/DNS/Deny/host 문서 범위. 전문 확인
- https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/security/policy/kubernetes.rst — CNP namespace·CCNP cluster 범위와 namespace peer 경계. 원본에서 상세 확인 못 했던 이 범위만 이번에 닫았고 기능별 상세 지원을 모두 검증했다고 쓰지 않음
- https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/security/policy/intro.rst — enforcement default/always/never와 enableDefaultDeny·L7 예외를 확인. 이 설정의 설치 상태는 모르므로 core NP 기본 허용을 모든 Cilium 환경의 보장으로 쓰지 않음
- https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/ebpf/intro.rst — TC host-side veth·Endpoint Policy의 신원/정책 조회, 소켓 가속 경로도 존재하므로 모든 플러그인의 공통 hook으로 일반화하지 않음
- https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/routing.rst — encapsulation의 source security identity 전달은 수신 측 identity lookup을 줄이는 최적화. 바깥 노드 IP가 Pod selector의 입력을 완전히 대신한다는 설명은 하지 않음

현재 공개 문서: https://kubernetes.io/docs/concepts/services-networking/network-policies/ · https://docs.cilium.io/en/stable/security/policy/

## 원본 대비 보존·정정·한정

1. v1.35·이전 release-1.37·Cilium v1.20.2 자료를 현재 고정본과 대조했다. 표준 NP는 내장 API이며 CNP/CCNP는 확장 CRD라는 차이, API 생성과 외부 집행의 차이를 명시했다
2. 방향별 격리·같은 방향 허용 합집합·양끝 허용·resident-node 양방향/self 예외는 이미 최신 원본이 보존한 조건이며 그대로 유지했다. 응답 트래픽의 암묵적 허용을 추가 대조해 반대 방향 새 연결과 구분했다
3. policyTypes는 `Ingress` 기본과 nonempty egress 목록의 `Egress` 추가로 설명했다. 빈 `egress: []`와 빈 규칙 한 개 `[{}]`를 나눴다. 원본의 egress 도입 역사 인과는 현재 필드 주석만으로 설계 이유까지 재확정하지 않고 현재 문서·함수로 확인한 비대칭 규칙에 집중했다
4. 원본 LAB의 최상위 podSelector 생략 비교는 관측 결과로 만들지 않았다. 현재 API의 값 타입·주석을 근거로 생략 시 빈 selector가 되어 정책 namespace 전체를 선택함을 설명했다. peer의 selector 생략·빈 selector·빈 peer는 별개다
5. 빈 ingress/egress 규칙 목록과 빈 규칙 한 개, 규칙 안의 빈 from/to/ports 목록을 구분했다. `from: [{}]`는 ValidateNetworkPolicyPeer가 거부하므로 모든 상대를 뜻하는 유효한 표현으로 쓰지 않았다
6. 같은 peer의 namespace·Pod AND와 별도 peer의 OR, 후자의 Pod peer는 정책 자신의 namespace라는 범위를 YAML·SVG에서 유지했다. 그림은 정책 namespace에 team=blue가 없다는 가정임을 표시했다
7. ipBlock/selector 배타성·except 진부분집합과 포트 검증을 보존·구체화했다. except는 해당 허용 규칙의 제외일 뿐 다른 정책의 허용을 취소하지 않는다. protocol 기본 TCP, ports 생략과 항목의 port 생략 차이, endPort 숫자·포함 범위·플러그인 지원을 대조했다
8. NAT 전후 관찰 주소·기존 연결 변경·hostNetwork·ICMP/ARP는 구현 조건을 남겼다. DNS egress를 항상 특정 CoreDNS Pod로 간다고 가정하지 않고 실제 resolver·노드 로컬 경로·NAT를 확인하도록 한정했다
9. 원본의 코어 디렉터리 전체에서 NetworkPolicy 참조 0건이라는 과거 검색 결과를 이번 버전에서 재검색한 것처럼 쓰지 않았다. 공식 계약과 현재 API·registry에서 확인한 저장/검증·집행 책임으로 설명했다. 경고·Event가 절대 없다는 주장도 하지 않음
10. Cilium을 모든 플러그인의 hook·신원 전달 방식으로 일반화하지 않았다. 확장 API의 상세 동작·상호 우선순위는 다음 글의 범위로 넘겼으며 writer_c에게 core NP 경계와 사용 ref를 공유했다. 자가 판정·미실행 LAB·내부 Phase/편집 경위·가상 경험은 본문에서 제외했다

## 대표 문장

원문: “빈 selector `{}`는 해당 selector의 범위 전체를 선택한다. selector 필드의 생략과 빈 selector는 다른 표현이며, 위 표의 namespace 범위와 함께 읽어야 한다”

변환: “peer의 빈 podSelector: {}는 해당 namespace 범위의 모든 Pod를 고릅니다 / 빈 namespaceSelector: {}는 모든 namespace를 고르므로 둘을 함께 쓰면 모든 namespace의 모든 Pod가 대상입니다 / peer 전체가 빈 {}인 경우와는 다릅니다”

이유: 일반적인 빈 값 설명을 실제 필드 위치·namespace 범위·빈 peer 검증 조건으로 나눠 독자가 YAML만 보고도 구분하도록 했다

## 검증·잔여 문제

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-network-policy.md` 최종 실제 실행 exit 0, error 0 / warn 1. 긴 줄 17곳은 대부분 고정 근거 URL이며 조건·문맥 검토 후 보존. `lint-post.log`
- SVG 2개 XML 파싱·title/desc·참조 실존 통과. 최소 20px / 560폭으로 375폭 명목 최소 13.39px. sharp 원본·375폭 PNG 4개 렌더 후 모두 육안 검사, 잘림·겹침 없음. text 개수 14/16이며 두 번째 그림의 footer를 tspan으로 정리해 text 과밀 경고 해소
- 전 섹션 시각화 재검토: 방향별 합집합/양끝 판정과 selector 집합은 SVG, 기본값/빈 목록/실패 근거는 표, 집행 책임·예외·구현 경계는 산문. 표의 행을 반복해 읽는 설명과 별도 용어 사전·상투적인 예고를 덜어냄
- 원본·문체·조건·과장·실측 창작·끝마침표 문맥 검토. YAML 3개 언어 명시·닫힘, 내부 링크 2개·이미지 2개 실존, 문단 끝 마침표 0. `output-checks.json`에 글/SVG/source hash와 검사 기록
- Decision section 미포함: 실제 도구 선정이나 대안 검토 경험이 없는 API·동작 해설
- 핵심 근거 부족 보류 없음. 실제 CNI/Cilium 설치·enforcement mode·Event/로그·적용 지연·기존 연결 종료·패킷 결과·성능은 확인하지 않았고 보장하지 않음. egress 도입 당시의 설계 인과는 추가 역사 자료로 검증하지 않았으며 본문에서 확정하지 않음
- 전체 lint·build·정적 출력·별도 reviewer 실행 안 함. 독립 검수와 parent 통합 검증 대기이며 완료 편수 포함은 해당 검증 이후에 판정


## 별도 blog-reviewer 검수

# Review: Batch 14 · 3 posts / 5 SVG

## P0 필수 수정

- 미해결 0건

## P1 확인 필요·권장

- 미해결 확인 필요 0건 / 권장 0건
- 원본의 Allow→Accept 개명 이유·domainNames Accept 전용 설계 의도·NPEP 부호 불일치의 작성 의도는 본문에서 미확인으로 구분했으며 현재 API 계약의 근거로 사용하지 않음

## 수정 후 재검토

- `k8s-theory-admin-network-policy.md:146` — [맥락/권장] 숫자 목적지 포트 설명만 제시 → 별도 `destinationNamedPort`가 빠져 API 전체 형식으로 오해 가능 → TCP·UDP·SCTP의 숫자 포트로 범위를 좁히고 Pod의 `ContainerPort` 이름 선택을 추가한 최종 문맥 확인
- `k8s-theory-admin-network-policy.md:150` — [근거/필수] “도메인·노드·CIDR peer와 이름 있는 포트의 조합…CRD 검증으로 제한” → v0.2.0 egress 조합 CEL은 experimental에만 있고 standard에는 없음 → API 사용 계약, experimental의 `networks`·`nodes`·`domainNames`+`destinationNamedPort` 거부, standard의 해당 CEL 부재를 분리한 수정 확인
- 근거: [v1alpha2 타입](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/apis/v1alpha2/clusternetworkpolicy_types.go), 같은 ref의 [standard CRD](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/config/crd/standard/policy.networking.k8s.io_clusternetworkpolicies.yaml)·[experimental CRD](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/config/crd/experimental/policy.networking.k8s.io_clusternetworkpolicies.yaml)를 직접 대조

## 원본·기술·문체

- `sources.json`의 정확한 Vault 원본 3개 전문 381·437·663줄과 최종 글을 대조, 실제 SHA-256·줄 수 모두 일치
- Ingress: [v1.37.1 admission 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/network/defaultingressclass/admission.go)의 Create·class 필드/어노테이션 존재 분기와 다중 default의 최신 생성 시각/이름 순 선택 확인. [현행 문서](https://kubernetes.io/docs/concepts/services-networking/ingress/#default-ingressclass)의 거절 설명과 구분함
- Gateway API: [v1.6.3 실제 standard CRD 8종](https://github.com/kubernetes-sigs/gateway-api/tree/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/config/crd/standard)을 YAML 파싱해 channel·served·storage 대조. TCP/TLS/UDPRoute v1, ReferenceGrant v1·v1beta1 served와 v1beta1 storage가 본문 표와 일치하며 overview와 차이를 명시함
- [AllowedRoutes 타입](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/apis/v1/gateway_types.go), [RouteParentStatus](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/apis/v1/shared_types.go), [ReferenceGrant 명세](https://gateway-api.sigs.k8s.io/reference/api-types/referencegrant/)의 부착·교차 참조·회수·정보 노출·대안 보호 예외와 HTTPS/TLS 구간 설명 확인. CRD 등록·컨트롤러 지원·반영 상태를 분리함
- NetworkPolicy: [공식 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/network-policies.md), [API 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/networking/v1/types.go), 같은 ref 기본값·검증·storage/strategy와 대조. 방향별 격리·합집합/양끝 허용, 목록과 빈 규칙, selector AND/OR, endPort·strict subset, 노드/자기 자신·NAT·기존 연결·hostNetwork·프로토콜·지원 조건을 유지함
- Cilium [v1.20.3 데이터 경로](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/ebpf/intro.rst)·encapsulation 신원 전달은 구현 예시로 제한했으며 보편적인 hook·성능 주장으로 확대하지 않음
- 관리자 정책: [현재/이전 API 안내](https://network-policy-api.sigs.k8s.io/), v0.2.0 타입·CRD와 v0.1.7 ANP/BANP 타입·singleton CEL, [NPEP-285](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/npeps/npep-285-combine-crds.md) 대조. Admin/NetworkPolicy/Baseline의 방향별 최종성·Pass·priority·peer·fail closed와 변경 배경이 근거 범위에 맞음
- Cilium `k8sClusterNetworkPolicy.enabled: false`와 network-policy-api v0.2.0 의존성을 실제 values/go.mod에서 확인. CiliumNetworkPolicy 약자 충돌과 구현 목록·conformance·활성화의 범위를 구분함
- 공통 voice·draft-to-post·source-format 적용 확인. 원본의 질문·설계 이유·실패 판별을 보존하고 LAB TODO를 실행 경험으로 만들지 않았으며 내부 관리 기록·과장·반복·설명 없는 단계 표기 문제 없음
- 세 slug가 유일하고 essays/kubernetes에 위치, series `k8s-theory-network` order 6·7·8이 계획과 일치하며 시리즈 트랙 분리 없음

## 실제 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-ingress-gateway-api.md src/content/essays/kubernetes/k8s-theory-network-policy.md src/content/essays/kubernetes/k8s-theory-admin-network-policy.md`: exit 0 / error 0 / warn 3
- 원시 경고: 100자 초과 줄 각각 12·17·18곳. URL·표·기술 식별자와 조건 문맥을 읽었으며 필수 분리 항목 없음
- SVG 5개 XML·role/title/desc 확인. sharp로 각각 800px·375px 재렌더하고 PNG 10개를 모두 실제 육안 확인: 역할/허가 방향·selector 범위·한 방향 tier 판정이 본문과 일치, 겹침·잘림 없음
- 렌더 입력 SHA-256과 최종 SVG 동일성 확인. PNG와 입력 해시는 `reviewer-render/`, 최종 글·SVG 8개 해시는 `review-hashes.json`
- 원본 3개와 유효 근거 캐시 65개 SHA-256 모두 일치(gateway 32, policy 11, admin-policy 22). gateway의 최초 404 경로 3건은 성공 근거에서 제외하고 해소한 실제 경로를 사용함
- 근거·CRD·메타 결과: `reviewer-evidence-checks.json`, 파일별 URL/ref/hash: 각 작성 폴더의 `manifest*.json`
- 최초 Python YAML 구조검사는 PyYAML 미설치로 실패했으며 새 의존성 없이 기존 Node `yaml`로 재실행해 통과. 해시/XML 검사는 표준 Python으로 통과
- 전체 lint·build·정적 출력·클러스터 패킷 실습·commit은 reviewer가 실행하지 않았으며 parent의 통합 검증 대상

## 요약

- 최종 미해결 필수 수정 0건 / 확인 필요 0건 / 권장 0건
- 수정·재검토 완료: 필수 1건, 권장 1건 / 검토 대상: 글 3개·SVG 5개, 레거시 제외 0개


### 지적 반영·재검토

- reviewer의 P1 권장: 숫자 포트 두 형태만 전체 포트 표현처럼 읽히고 이름 포트가 정의 없이 나오는 문단을 보완했다
- `protocols`의 숫자 목적지 포트 설명으로 범위를 한정하고, 별도 `destinationNamedPort`가 Pod의 `ContainerPort` 이름으로 선택한다는 문장을 추가했다
- 실제 v0.2.0 고정 타입 `clusternetworkpolicy_types.go:433–454`를 확인했다. 기존 도메인·노드·CIDR peer와 이름 포트 조합 제한은 유지했다
- reviewer가 수정 저장본을 재검토한 뒤 최종 hash를 확정한다

- 추가 필수 수정: 이름 포트와 peer 조합 금지를 모든 CRD의 저장 검증처럼 쓴 문장을 수정했다
- 실제 standard/experimental YAML을 비교해 `destinationNamedPort`는 양쪽에 존재하나 `networks/nodes/domainNames` 조합 금지 CEL은 experimental에만 있음을 확인했다
- API 계약의 사용 제한과 experimental의 CEL 거부, standard의 해당 저장 검증 부재를 별도로 설명했다


## 실제 최종 검증

- `npm run lint:post -- <이 배치 3편>`: exit 0, error 0 / warn 3
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 628 pages
- 원본 SHA-256·검수 후 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- `getAllPosts`·`getEssaysList`·`getSearchIndex` 실제 실행: 3편 모두 essays로 등록, 목록·검색 객체에 content 없음
- HTML 3개·SVG 5개 실제 export 및 `/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 3편 반영, RSS는 기존 최신 20편 정책과 실제 출력 일치
- `git diff --check` 통과
- prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원, Vault 원본 변경 없음
- build의 Node `DEP0205 module.register()` 및 로컬 TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 남아 있으며 애플리케이션 설정을 범위 밖에서 바꾸지 않았다
- 클러스터 실습·통합 테스트·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·임시 근거 저장본: `/tmp/k8s-batch14/`
영구 재확인 경로는 위 글과 작성 기록의 공식 소스 URL이다

## 다음 대상

- `Phase 3-8 · CCM 과 클라우드 경계 · 밖이 채울 칸은 안에서 먼저 잠근다.md` → `k8s-theory-cloud-controller-boundary` (`k8s-theory-network` / 9)
- `Phase 3-9 · 트래픽 지역성과 dual-stack · 앞자리가 비면 떨어뜨리거나 되돌아간다.md` → `k8s-theory-traffic-locality-dual-stack` (`k8s-theory-network` / 10)
- `Phase 3-10 · ServiceCIDR 와 IPAddress · 이름이 곧 자물쇠다.md` → `k8s-theory-service-cidr-ip-address` (`k8s-theory-network` / 11)
