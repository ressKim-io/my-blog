---
title: "JWE — 암호화 토큰이 서명 토큰보다 강한 이유"
excerpt: "JSON Web Encryption의 5-part 구조와 AES-256-GCM AEAD 원리를 설명하고, JWS(서명만)와 비교해 JWE가 기밀성과 무결성을 동시에 보장하는 방식을 살펴봅니다"
category: challenge
tags:
  - go-ti
  - JWE
  - AES-256-GCM
  - AEAD
  - stateless
  - concept
series:
  name: "goti-deepdive-edge"
  order: 4
date: "2026-04-04"
---

## 한 줄 요약

> JWE는 페이로드를 AES-256-GCM으로 암호화해 기밀성과 무결성을 한 번에 보장하며, 복호화 키만 있으면 서버 상태 없이 사용자를 식별할 수 있습니다

---

## 🤔 무엇을 푸는 기술인가

웹 서비스에서 사용자를 식별하는 방법은 크게 두 가지입니다

첫 번째는 **서버 세션**: 서버가 사용자 정보를 저장하고, 클라이언트에는 세션 ID만 발급합니다 매 요청마다 서버가 세션 저장소를 조회해 사용자를 확인합니다

두 번째는 **토큰**: 사용자 정보를 토큰 안에 담아 클라이언트에 발급합니다 서버는 토큰을 검증하는 것만으로 사용자를 식별하고, 별도 저장소 조회가 필요 없습니다

토큰 방식은 서버 상태가 필요 없다는 점(stateless)에서 수평 확장에 유리하지만, "토큰 안의 정보가 안전한가"라는 문제가 남습니다

JWT 생태계에는 두 종류가 있습니다

- **JWS (JSON Web Signature)**: 페이로드에 서명을 붙여 위변조를 탐지합니다 — 하지만 페이로드 자체는 Base64url 인코딩에 불과해 누구나 읽을 수 있습니다
- **JWE (JSON Web Encryption)**: 페이로드 전체를 암호화합니다 — 복호화 키 없이는 내용을 읽지도, 위변조하지도 못합니다

JWE가 해결하는 핵심 문제는 **토큰 안의 민감 정보를 외부에 노출하지 않으면서 stateless 식별을 유지하는 것**입니다

---

## 🔧 동작 원리

### JWE 5-segment 구조

JWE 토큰은 마침표(`.`)로 구분된 5개의 segment로 구성됩니다

```text
BASE64URL(Protected Header)
  .BASE64URL(Encrypted Key)
  .BASE64URL(IV)
  .BASE64URL(Ciphertext)
  .BASE64URL(Authentication Tag)
```

각 segment의 역할을 순서대로 살펴봅니다

**Protected Header** — 알고리즘 명세를 담습니다 `alg`는 CEK(Content Encryption Key)를 어떤 방식으로 암호화했는지를, `enc`는 실제 콘텐츠를 어떤 알고리즘으로 암호화했는지를 나타냅니다 예를 들어 `{"alg":"dir","enc":"A256GCM"}`은 직접 키 합의 + AES-256-GCM 조합을 의미합니다

**Encrypted Key** — CEK(콘텐츠 암호화에 사용된 대칭 키)를 수신자의 공개 키나 공유 키로 암호화한 값입니다 `alg: dir`(직접 키 합의)을 사용하는 경우 이 segment는 비어있습니다

**IV (Initialization Vector)** — 랜덤하게 생성된 96-bit(12-byte) 값입니다 동일한 키와 평문으로도 매번 다른 암호문이 만들어지도록 보장합니다 같은 키를 반복 사용해도 IV가 다르면 암호문 패턴이 달라져 재사용 공격을 막습니다

**Ciphertext** — AES-256-GCM으로 암호화된 실제 페이로드입니다 키 없이는 어떠한 정보도 추출할 수 없습니다

**Authentication Tag** — AES-GCM이 암호화 과정에서 생성하는 128-bit MAC(Message Authentication Code)입니다 이 태그가 AEAD의 핵심입니다

![JWE vs JWS 구조 비교|tall](/diagrams/goti-deepdive-jwe-token-1.svg)

위 구조 비교 다이어그램의 왼쪽은 JWS이고 오른쪽은 JWE입니다 JWS의 Payload는 초록색 박스로 표시되어 있는데, 이는 Base64url 디코딩만으로 누구나 내용을 읽을 수 있다는 의미입니다 서명(빨간 박스)은 위변조를 탐지하지만 내용을 감추지는 않습니다

JWE는 오른쪽의 보라색 박스들이 모두 암호화 영역입니다 Ciphertext는 키 없이 해독 불가능하고, Authentication Tag는 키 없이 검증조차 할 수 없습니다 JWS에서 "서명만" 제공하던 것을 JWE는 "암호화 + 인증"으로 한 단계 올립니다

### AES-256-GCM — AEAD가 기밀성과 무결성을 동시에 주는 원리

AES-256-GCM의 GCM은 **Galois/Counter Mode**의 약자입니다 이 모드는 단순 암호화를 넘어 **AEAD(Authenticated Encryption with Associated Data)**를 구현합니다

일반 대칭 암호화(AES-CBC 등)는 암호화만 수행합니다 위변조 탐지는 별도의 HMAC을 추가해야 합니다 이 두 단계를 따로 구현하면 "Encrypt-then-MAC인가, MAC-then-Encrypt인가"라는 순서 문제와 키 관리 이슈가 생깁니다

GCM은 이를 하나의 연산으로 해결합니다

```text
AES-256-GCM 암호화 입력:
  - Key (256-bit 대칭 키)
  - IV  (96-bit 랜덤 Nonce)
  - Plaintext (암호화할 페이로드)
  - AAD (Additional Authenticated Data — Protected Header)

AES-256-GCM 암호화 출력:
  - Ciphertext (암호화된 페이로드)
  - Auth Tag   (128-bit MAC, 무결성 증거)
```

Counter Mode(CTR)가 스트림 암호처럼 평문을 암호화하는 동안, Galois Mode의 GHASH 함수가 암호문과 AAD를 함께 처리해 인증 태그를 생성합니다 이 태그는 Ciphertext와 Header 양쪽에 묶여 있어서, 어느 한 바이트라도 변조되면 태그 검증이 실패합니다

복호화 시 서버는 같은 키와 IV로 역연산을 수행하고 Auth Tag를 재계산합니다 전달된 태그와 일치하면 복호화된 페이로드를 신뢰하고, 불일치하면 전체를 즉시 거부합니다

이 구조 덕분에 **키를 가진 서버만 복호화할 수 있고**, **복호화에 성공했다면 위변조되지 않았음이 함께 증명**됩니다 두 연산이 하나의 패스로 완료되므로 별도 HMAC 추가가 필요 없습니다

### JWS와의 결정적 차이

JWS(JSON Web Signature)는 다음 구조를 가집니다

```text
BASE64URL(Header).BASE64URL(Payload).BASE64URL(Signature)
```

Payload 부분은 **암호화가 아닌 인코딩**입니다 Base64url은 단방향이 아니라 언제든 디코딩 가능합니다 JWS 토큰을 가로채면 서명 검증 없이도 `{"sub":"user_123","role":"admin"}` 같은 페이로드 내용을 그대로 읽을 수 있습니다

서명은 위변조 탐지에만 쓰입니다 HTTPS 위에서 운용하면 전송 중 도청은 막을 수 있지만, 토큰이 클라이언트 localStorage나 로그에 남으면 내용이 노출됩니다

JWE는 페이로드 자체가 암호문입니다 토큰을 탈취해도 복호화 키 없이는 내용을 알 수 없습니다 사용자 식별자, 권한, 만료 시각 같은 민감 정보를 토큰에 담으면서도 클라이언트에는 암호문만 보여줍니다

### Stateless 검증 — 서버 상태 없이 사용자를 식별하는 방법

JWE 기반 stateless 검증의 흐름은 다음과 같습니다

서버는 사용자에게 JWE 토큰을 발급할 때 user_id, exp(만료 시각), 필요한 claim을 평문으로 구성한 뒤 서버가 보유한 대칭 키로 AES-256-GCM 암호화합니다 이 암호문을 클라이언트에 발급합니다

클라이언트가 이후 요청에 이 토큰을 포함하면, 서버는 다음 두 단계만 수행합니다

```text
1. AES-256-GCM 복호화 (키 + IV + Auth Tag 검증)
   → 성공하면 페이로드 추출, 실패하면 즉시 401
2. exp claim 확인
   → 현재 시각 < exp 이면 유효, 만료면 401
```

세션 저장소를 조회하지 않습니다 Redis나 DB에 "이 토큰이 유효한가"를 물어볼 필요가 없습니다 서버가 들고 있는 복호화 키 하나만으로 사용자 신원과 만료 여부를 동시에 확인합니다

이것이 stateless의 핵심입니다 요청이 어느 서버 인스턴스에 도달하든, 같은 키를 가진 인스턴스라면 동일하게 검증합니다 수평 확장 시 세션 동기화나 sticky session이 필요 없습니다

---

## 📐 세부 동작과 옵션

### 알고리즘 조합 선택

JWE에서 `alg`(키 암호화)와 `enc`(콘텐츠 암호화)는 독립적으로 선택합니다

| `alg` | 방식 | 사용 시나리오 |
|---|---|---|
| `dir` | 사전 공유 키를 CEK로 직접 사용 | 서버-서버 간 공유 비밀키가 있을 때 (가장 단순) |
| `A256KW` | AES Key Wrap으로 CEK 암호화 | CEK를 별도로 관리하고 싶을 때 |
| `RSA-OAEP` | 수신자 공개키로 CEK 암호화 | 비대칭 키 배포 환경 |
| `ECDH-ES` | ECDH 키 합의로 CEK 유도 | 키 전달 없이 합의가 필요할 때 |

| `enc` | 알고리즘 | 키 길이 |
|---|---|---|
| `A256GCM` | AES-256-GCM (AEAD) | 256-bit |
| `A128GCM` | AES-128-GCM (AEAD) | 128-bit |
| `A256CBC-HS512` | AES-CBC + HMAC-SHA512 | 256+256-bit |

실무에서 `dir` + `A256GCM` 조합은 대칭 키를 직접 사용하는 가장 단순한 형태입니다 키 관리가 단순한 대신 키 유출 시 전체 토큰이 위험하므로, 키 회전 계획이 필수입니다

### exp Claim과 토큰 만료

JWE 내부 페이로드는 표준 JWT claim을 그대로 포함합니다 `exp`(만료 시각), `iat`(발급 시각), `sub`(사용자 식별자) 등을 암호화된 페이로드 안에 담습니다

```json
{
  "sub": "user_7829",
  "exp": 1743864000,
  "iat": 1743860400,
  "queue_pos": 142
}
```

서버가 복호화 후 `exp`를 확인하면 세션 저장소에 별도 만료 관리 레코드를 두지 않아도 됩니다 heartbeat API로 세션을 갱신할 필요도 없습니다 `exp`가 지난 토큰은 복호화 이후 claim 확인 단계에서 자동으로 거부됩니다

이 특성이 CDN 캐싱과 결합될 때 중요해집니다 상태 변화(대기열 순번 승격, 입장 완료)는 origin에서만 일어나고, CDN은 상태 없이 캐시 응답만 제공합니다 사용자 식별은 JWE가 담당하므로 CDN은 토큰 내용을 해석하지 않아도 됩니다

### 키 회전과 토큰 무효화

JWE의 단점은 키를 회전하면 기존 토큰이 즉시 무효화된다는 점입니다 세션 방식에서는 세션 저장소의 레코드를 삭제하면 되지만, JWE는 토큰을 발급한 뒤 서버가 토큰 목록을 보관하지 않습니다

키 유출이나 보안 이벤트가 발생하면 다음 절차가 필요합니다

```text
1. 새 키 생성
2. 신규 토큰은 새 키로 발급
3. 구 키를 즉시 비활성화 → 구 토큰 복호화 실패 → 사용자 재로그인 필요
```

운영에서는 키 회전 런북과 즉시 무효화 경로를 미리 갖춰두는 것이 필수입니다

---

## 🧩 go-ti에서는

go-ti의 대기열 구현(ADR-0022)에서 JWE는 핵심 식별 수단이었습니다 대기열 참가자의 순번 상태를 polling으로 확인하는 구조에서 `GET /queue/status` 응답을 Cloudflare CDN이 캐싱했는데, CDN이 사용자별로 다른 응답을 캐싱하려면 Cache Key에 사용자 식별자가 포함되어야 했습니다

JWE 토큰은 이 문제를 깔끔하게 해결했습니다 서버는 `user_id`와 `exp`를 JWE로 암호화해 발급하고, 클라이언트는 매 polling 요청에 이 토큰을 포함했습니다 Cloudflare는 URL path + JWE sub claim을 Cache Key로 삼아 사용자별 순번 응답을 분리했습니다

origin 서버는 Cache MISS일 때만 요청을 받았고, JWE를 복호화해 user_id와 exp를 추출한 뒤 Redis에서 순번을 조회했습니다 세션 저장소 조회가 없어 수평 확장이 자유로웠고, heartbeat API도 필요 없었습니다 JWE exp가 자동 만료 역할을 했습니다

CDN HIT 상태에서 origin Redis가 받는 QPS는 사용자 수와 무관하게 수십 req/s 수준으로 유지되었고, 3000VU 부하 테스트에서 `queue_status` avg 220ms / p95 334ms를 달성했습니다

![JWE Stateless 검증 흐름 — 클라이언트, CDN, Origin 상호작용|tall](/diagrams/goti-deepdive-jwe-token-2.svg)

위 시퀀스 다이어그램은 go-ti 대기열에서 JWE가 동작한 전체 흐름입니다 왼쪽부터 Client, Cloudflare CDN, Origin 세 참여자입니다

첫 번째 단계에서 Client가 `POST /queue/enter`로 대기열에 진입하면 Origin은 `user_id`와 `exp`를 담은 JWE 토큰을 반환합니다 이 토큰은 클라이언트가 저장합니다

두 번째 단계는 polling입니다 Client가 JWE 토큰을 포함해 `GET /queue/status`를 요청하면 CDN이 Cache HIT인 경우 즉시 응답합니다 Origin에 요청이 전달되지 않습니다

세 번째 단계는 TTL이 만료된 Cache MISS 상황입니다 CDN이 Origin으로 요청을 포워딩하고, Origin은 AES-256-GCM으로 복호화한 뒤 exp를 확인하고 Redis에서 순번을 조회합니다 이 검증 전체가 서버 상태 없이 진행됩니다 Origin이 응답에 `Cache-Control: max-age=N`을 포함하면 CDN이 캐시를 갱신해 다음 TTL 동안 다시 HIT 응답을 제공합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [대기열 구현 방식 선택 — CDN 캐싱 채택, POC A/B/C 비교](/logs/goti-queue-implementation-cdn-caching-adr)에 정리했습니다

---

## 📚 핵심 정리

- **JWS는 서명만, JWE는 암호화 + 인증입니다** JWS Payload는 Base64url 디코딩으로 누구나 읽을 수 있고, JWE Ciphertext는 복호화 키 없이 해독 불가능합니다
- **AES-256-GCM(AEAD)은 기밀성과 무결성을 한 번의 연산으로 보장합니다** 별도 HMAC 없이 Authentication Tag가 위변조를 탐지합니다
- **Stateless 검증은 키 보유만으로 완결됩니다** 복호화 성공 + exp 확인의 두 단계로 세션 저장소 없이 사용자를 식별합니다
- **IV(Nonce)가 동일 키의 재사용 위험을 막습니다** 매 토큰 발급 시 랜덤 96-bit IV로 같은 평문도 다른 암호문이 됩니다
- **키 회전 시 기존 토큰이 즉시 무효화됩니다** Stateless의 대가로 강제 로그아웃 경로가 필요합니다 — 키 회전 런북을 미리 준비해야 합니다
