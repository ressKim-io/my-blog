# D2 다이어그램 가이드 (Claude Code + d2mcp용)

> Claude Code에서 d2mcp MCP 서버를 사용하여 D2 다이어그램을 생성할 때 참고하는 가이드

---

## 1. d2mcp 도구 목록 (10개)

### 기본 도구

| 도구 | 설명 | 주요 파라미터 |
|------|------|---------------|
| `d2_create` | 새 다이어그램 생성 | `id`, `content` (선택) |
| `d2_export` | SVG/PNG/PDF 내보내기 | `diagramId`, `format` |
| `d2_save` | 파일로 저장 | `diagramId`, `format`, `path` |

### Oracle API (점진적 수정용)

| 도구 | 설명 | 주요 파라미터 |
|------|------|---------------|
| `d2_oracle_create` | 도형/연결선 추가 | `diagram_id`, `key` |
| `d2_oracle_set` | 속성 설정 | `diagram_id`, `key`, `value` |
| `d2_oracle_delete` | 요소 삭제 | `diagram_id`, `key` |
| `d2_oracle_move` | 컨테이너 간 이동 | `diagram_id`, `key`, `new_parent` |
| `d2_oracle_rename` | 요소 이름 변경 | `diagram_id`, `key`, `new_name` |
| `d2_oracle_get_info` | 요소 정보 조회 | `diagram_id`, `key`, `info_type` |
| `d2_oracle_serialize` | 현재 D2 텍스트 출력 | `diagram_id` |

---

## 2. D2 기본 문법

### 2.1 Shape (도형) 선언

```d2
# 기본 선언 (자동으로 rectangle)
server

# 라벨 지정
server: Web Server

# shape 타입 지정
database: {
  shape: cylinder
}
```

### 2.2 Shape 종류

| Shape | 용도 | 예시 |
|-------|------|------|
| `rectangle` | 기본 박스 (기본값) | 서비스, 컴포넌트 |
| `square` | 정사각형 | |
| `circle` | 원 | 상태 |
| `oval` | 타원 | |
| `diamond` | 다이아몬드 | 조건 분기 |
| `hexagon` | 육각형 | API Gateway |
| `cylinder` | 실린더 | 데이터베이스, 스토리지 |
| `queue` | 큐 | 메시지 큐 |
| `package` | 패키지 | 모듈 |
| `page` | 페이지 | 문서 |
| `document` | 문서 | |
| `step` | 스텝 | 프로세스 단계 |
| `callout` | 말풍선 | 설명 |
| `stored_data` | 저장 데이터 | |
| `person` | 사람 | 사용자, 액터 |
| `cloud` | 클라우드 | 클라우드 서비스 |
| `text` | 텍스트만 | 라벨, 설명 |
| `code` | 코드 블록 | |
| `class` | UML 클래스 | |
| `sql_table` | SQL 테이블 | ERD |
| `image` | 이미지 | 아이콘 |
| `sequence_diagram` | 시퀀스 다이어그램 | |

### 2.3 Connection (연결선)

```d2
# 단방향 화살표
a -> b

# 양방향 화살표
a <-> b

# 라벨 있는 연결
a -> b: HTTP Request

# 점선 연결 (스타일 적용)
a -> b: optional {
  style.stroke-dash: 3
}

# 연결선 없음 (관계만 표시)
a -- b
```

### 연결선 방향

```d2
a -> b    # a에서 b로
a <- b    # b에서 a로
a <-> b   # 양방향
a -- b    # 방향 없음 (점선 기본)
```

### 화살표 모양 (Arrowhead)

```d2
a -> b: {
  target-arrowhead: {
    shape: triangle    # triangle, arrow, circle, cf-one, cf-many 등
  }
  source-arrowhead: {
    shape: circle
  }
}
```

---

## 3. 컨테이너 (Container)

```d2
# 컨테이너 선언
network: {
  server
  database
}

# 중첩 컨테이너
cloud: {
  aws: {
    ec2
    rds
  }
  gcp: {
    gce
    cloudsql
  }
}

# 컨테이너 간 연결
cloud.aws.ec2 -> cloud.gcp.gce

# 컨테이너 스타일 (점선 테두리)
pod: {
  style.stroke-dash: 3
  style.fill: transparent

  app
  sidecar
}
```

---

## 4. Style (스타일) 옵션

### 4.1 전체 스타일 속성

| 속성 | 타입 | 범위/값 | 설명 |
|------|------|---------|------|
| `fill` | color | hex, CSS color | 배경색 |
| `stroke` | color | hex, CSS color | 테두리색 |
| `stroke-width` | int | 1-15 | 테두리 두께 |
| `stroke-dash` | int | 0-10 | 점선 간격 (0=실선) |
| `border-radius` | int | 0-20 | 모서리 둥글기 |
| `opacity` | float | 0-1 | 투명도 |
| `shadow` | bool | true/false | 그림자 |
| `3d` | bool | true/false | 3D 효과 |
| `multiple` | bool | true/false | 복수 표시 |
| `font-size` | int | 8-100 | 폰트 크기 |
| `font-color` | color | hex, CSS color | 폰트 색상 |
| `bold` | bool | true/false | 굵게 |
| `italic` | bool | true/false | 기울임 |
| `underline` | bool | true/false | 밑줄 |
| `animated` | bool | true/false | 연결선 애니메이션 |
| `fill-pattern` | string | dots, lines, grain, none | 채우기 패턴 |

### 4.2 스타일 적용 방법

```d2
# 방법 1: 인라인 스타일
server: {
  style: {
    fill: "#4a90d9"
    stroke: "#2c5282"
    stroke-width: 2
    border-radius: 8
    shadow: true
  }
}

# 방법 2: 점 표기법
server.style.fill: "#4a90d9"
server.style.stroke: "#2c5282"

# 방법 3: 글로벌 스타일 (모든 요소에 적용)
*.style.border-radius: 8
*.style.font-size: 14
```

### 4.3 자주 쓰는 색상 조합

```d2
# 파란 계열 (서비스, API)
service.style.fill: "#e3f2fd"
service.style.stroke: "#1976d2"

# 초록 계열 (성공, 완료)
success.style.fill: "#e8f5e9"
success.style.stroke: "#388e3c"

# 주황 계열 (경고, 진행중)
warning.style.fill: "#fff3e0"
warning.style.stroke: "#f57c00"

# 빨강 계열 (에러, 위험)
error.style.fill: "#ffebee"
error.style.stroke: "#d32f2f"

# 보라 계열 (특별, 하이라이트)
highlight.style.fill: "#f3e5f5"
highlight.style.stroke: "#7b1fa2"

# 회색 계열 (비활성, 배경)
inactive.style.fill: "#f5f5f5"
inactive.style.stroke: "#9e9e9e"
```

---

## 5. 레이아웃 (Layout)

### 5.1 Direction (방향)

```d2
# 전체 다이어그램 방향
direction: right   # right, down, left, up

# 컨테이너별 방향 지정
container: {
  direction: down
  a -> b -> c
}
```

### 5.2 레이아웃 엔진

| 엔진 | 특징 |
|------|------|
| `dagre` | 기본값, 빠름, 계층적 레이아웃 |
| `elk` | 복잡한 다이어그램에 적합, 더 나은 배치 |
| `tala` | 유료, 최고 품질 |

```d2
vars: {
  d2-config: {
    layout-engine: elk
  }
}
```

### 5.3 Grid 레이아웃

```d2
# 그리드 컨테이너
grid: {
  grid-columns: 3
  grid-rows: 2
  grid-gap: 10

  item1
  item2
  item3
  item4
  item5
  item6
}
```

### 5.4 크기 지정

```d2
# 개별 요소 크기
server: {
  width: 200
  height: 100
}

# 사람 shape는 width만 지정
user: {
  shape: person
  width: 130
}
```

---

## 6. 테마 (Theme)

### 6.1 Light 테마

| ID | 이름 | 특징 |
|----|------|------|
| 0 | Neutral Default | 기본, 파란 계열 |
| 1 | Neutral Grey | 회색 계열 |
| 3 | Flagship Terrastruct | 공식 테마 |
| 4 | Cool Classics | 시원한 색상 |
| 5 | Mixed Berry Blue | 파랑+보라 |
| 6 | Grape Soda | 보라 계열 |
| 7 | Aubergine | 가지색 |
| 8 | Colorblind Clear | 색맹 친화적 |
| 100 | Vanilla Nitro Cola | 따뜻한 색상 |
| 101 | Orange Creamsicle | 주황 계열 |
| 102 | Shirley Temple | 핑크 계열 |
| 103 | Earth Tones | 자연 색상 |
| 104 | Everglade Green | 초록 계열 |
| 105 | Buttered Toast | 따뜻한 갈색 |
| 300 | Terminal | 터미널 스타일, 대문자, 점 패턴 |
| 301 | Terminal Grayscale | 터미널 흑백 |
| 302 | Origami | 종이접기 스타일 |
| 303 | C4 | C4 모델용 |

### 6.2 Dark 테마

| ID | 이름 |
|----|------|
| 200 | Dark Mauve |
| 201 | Dark Flagship Terrastruct |

### 6.3 테마 적용

```d2
# d2-config로 테마 지정
vars: {
  d2-config: {
    theme-id: 6
    dark-theme-id: 200
  }
}

# CLI에서 지정
# d2 -t 6 input.d2 output.svg
```

### 6.4 테마 커스터마이징

```d2
vars: {
  d2-config: {
    theme-id: 0
    theme-overrides: {
      B1: "#1a1a2e"
      B2: "#16213e"
      AA2: "#e94560"
    }
  }
}
```

---

## 7. 특수 다이어그램

### 7.1 시퀀스 다이어그램

```d2
shape: sequence_diagram

Client -> Server: HTTP Request
Server -> Database: Query
Database -> Server: Results
Server -> Client: HTTP Response

# 스타일 적용
Client -> Server: {
  style.stroke-dash: 3
}
```

### 7.2 SQL 테이블 (ERD)

```d2
users: {
  shape: sql_table
  id: int {constraint: primary_key}
  name: varchar(255)
  email: varchar(255) {constraint: unique}
  created_at: timestamp
}

posts: {
  shape: sql_table
  id: int {constraint: primary_key}
  user_id: int {constraint: foreign_key}
  title: varchar(255)
  content: text
}

users.id <-> posts.user_id
```

### 7.3 클래스 다이어그램

```d2
Animal: {
  shape: class
  +name: string
  +age: int
  +speak(): void
}

Dog: {
  shape: class
  +breed: string
  +bark(): void
}

Animal <- Dog: extends
```

---

## 8. 아이콘 사용

```d2
# 이미지 shape로 아이콘 사용
aws: {
  shape: image
  icon: https://icons.terrastruct.com/aws/_Group%20Icons/Region_light-bg.svg
}

# 일반 shape에 아이콘 추가
server: {
  icon: https://icons.terrastruct.com/infra/019-network.svg
}
```

### Terrastruct 아이콘 URL 패턴
- AWS: `https://icons.terrastruct.com/aws/...`
- Azure: `https://icons.terrastruct.com/azure/...`
- GCP: `https://icons.terrastruct.com/gcp/...`
- Infra: `https://icons.terrastruct.com/infra/...`
- Dev: `https://icons.terrastruct.com/dev/...`

---

## 9. d2mcp 사용 워크플로우

### 9.1 간단한 다이어그램 (한 번에 생성)

```
d2_create로 다이어그램 만들어줘:

id: "my-diagram"
content: |
  direction: right

  client -> server: HTTP
  server -> db: SQL

  db: {
    shape: cylinder
    style.fill: "#e3f2fd"
  }

SVG로 export 해줘
```

### 9.2 복잡한 다이어그램 (점진적 생성)

```
d2mcp Oracle API로 점진적으로 만들어줘:

1단계: 빈 다이어그램 생성
d2_create({ id: "architecture" })

2단계: 도형 추가
d2_oracle_create({ diagram_id: "architecture", key: "web" })
d2_oracle_create({ diagram_id: "architecture", key: "api" })
d2_oracle_create({ diagram_id: "architecture", key: "db" })

3단계: 스타일 설정
d2_oracle_set({ diagram_id: "architecture", key: "db.shape", value: "cylinder" })
d2_oracle_set({ diagram_id: "architecture", key: "web.style.fill", value: "#e3f2fd" })

4단계: 연결선 추가
d2_oracle_create({ diagram_id: "architecture", key: "web -> api" })
d2_oracle_create({ diagram_id: "architecture", key: "api -> db" })

5단계: 중간 확인
d2_oracle_serialize({ diagram_id: "architecture" })

6단계: 최종 export
d2_export({ diagramId: "architecture", format: "svg" })
```

### 9.3 실전 프롬프트 예시

```
@d2mcp Kubernetes Pod 구조 다이어그램 만들어줘:

요구사항:
1. 두 섹션: "Sidecar Mode", "Ambient Mode"
2. 각 섹션은 점선 테두리 컨테이너
3. 색상:
   - App: 짙은 회색 (#3d3d3d)
   - Envoy/ztunnel: 파란색 (#2196F3)
4. direction: down
5. 테마: Neutral Default (0)

Oracle API로 점진적으로 만들고,
각 단계에서 d2_oracle_serialize로 확인해줘.
마지막에 SVG로 export.
```

---

## 10. 팁 & 트러블슈팅

### 10.1 명명 규칙

```d2
# 좋은 예 (언더스코어 또는 공백)
web_server
"Web Server"

# 나쁜 예 (하이픈 주의!)
a-b          # 이건 연결선으로 인식됨!
a--b         # 방향 없는 연결선

# 특수문자 포함 시 따옴표 사용
"Server (Primary)": Primary Server
```

### 10.2 주석

```d2
# 한 줄 주석
server  # 인라인 주석도 가능
```

### 10.3 자주 발생하는 오류

| 문제 | 원인 | 해결 |
|------|------|------|
| 연결선 안됨 | 컨테이너 경로 누락 | `container.child` 형식 사용 |
| 스타일 안됨 | 대소문자 | shape 값은 소문자 |
| 레이아웃 이상 | 복잡한 연결 | `direction` 명시적 지정 |
| PNG/PDF 안됨 | 도구 미설치 | `librsvg` 또는 `imagemagick` 설치 |

### 10.4 투명 배경 설정

```d2
# 루트 레벨 스타일로 배경 투명화
style.fill: transparent
```

---

## 11. 참고 링크

- **D2 공식 문서**: https://d2lang.com/tour/intro/
- **D2 Playground**: https://play.d2lang.com/
- **D2 Cheat Sheet**: https://d2lang.com/tour/cheat-sheet/
- **D2 GitHub**: https://github.com/terrastruct/d2
- **d2mcp GitHub**: https://github.com/i2y/d2mcp
- **Terrastruct 아이콘**: https://icons.terrastruct.com/

---

## 12. Quick Reference

```
┌─────────────────────────────────────────────────────────────┐
│                    D2 Quick Reference                       │
├─────────────────────────────────────────────────────────────┤
│ 도형: shape: rectangle|cylinder|person|cloud|hexagon|...    │
│ 연결: a -> b | a <- b | a <-> b | a -- b                    │
│ 방향: direction: right|down|left|up                         │
│ 스타일: style.fill|stroke|stroke-dash|opacity|shadow|...    │
│ 복수: style.multiple: true                                  │
│ 점선: style.stroke-dash: 3                                  │
│ 테마: vars: { d2-config: { theme-id: 0 } }                  │
│ 레이아웃: vars: { d2-config: { layout-engine: elk } }       │
├─────────────────────────────────────────────────────────────┤
│ d2mcp: d2_create → d2_oracle_* → d2_export                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 13. 블로그 다이어그램 실전 가이드 (istio-ambient 프로젝트)

### 13.1 기본 설정

```d2
# 권장 폰트 크기
*.style.font-size: 16        # 글로벌 기본
*.style.border-radius: 6     # 모서리 둥글게

# 컨테이너 제목: 18-20px
# 내부 요소: 16px
# 설명 텍스트: 14px
```

### 13.2 나란히 비교 (Grid 레이아웃)

두 개념을 비교할 때 **Grid 레이아웃** 사용:

```d2
# ✅ 좋은 예: Grid로 정렬
grid-rows: 1
grid-columns: 2
grid-gap: 50

sidecar: Sidecar Mode { ... }
ambient: Ambient Mode { ... }
```

```d2
# ❌ 나쁜 예: 연결선으로 비교 (대각선 레이아웃 발생)
sidecar -> ambient: vs   # 이러면 삐뚤어짐!
```

### 13.3 컨테이너 중첩 최소화

```d2
# ❌ 나쁜 예: 과도한 중첩 (여백 많아짐)
outer: {
  style.fill: transparent
  title: Title { ... }
  inner: { ... }
  desc: Description { ... }
}

# ✅ 좋은 예: 단순 구조
pod: Pod (Sidecar Mode) {
  style.fill: "#4A90D9"
  app: App { ... }
  envoy: Envoy { ... }
}
```

### 13.4 설명은 마크다운으로

다이어그램 내 텍스트는 **최소화**, 상세 설명은 **마크다운 테이블**로:

```markdown
![Diagram](/images/istio-ambient/diagram-name.svg)

| 구분 | Sidecar Mode | Ambient Mode |
|------|--------------|--------------|
| 프록시 위치 | Pod 내부 | Node 레벨 |
| 리소스 | 높음 | 80-90% 절감 |
```

### 13.5 다크/라이트 모드 대응 색상

```d2
# 양쪽 모드에서 잘 보이는 색상
pod.style.fill: "#4A90D9"      # 파란색 (주요 요소)
pod.style.font-color: "#FFFFFF"

app.style.fill: "#6C757D"      # 회색 (내부 요소)
envoy.style.fill: "#F5A623"    # 주황 (Sidecar/프록시)
ztunnel.style.fill: "#7ED321"  # 초록 (Ambient 컴포넌트)

# 투명 배경 컨테이너
container.style.fill: transparent
container.style.stroke: "#666666"

# 설명 텍스트
desc.style.font-color: "#888888"
```

### 13.6 이미지 저장 규칙

```
경로: public/images/istio-ambient/*.svg
형식: SVG (투명 배경)
마크다운: ![Alt](/images/istio-ambient/filename.svg)

# 개발 모드: /images/... (basePath 없음)
# 프로덕션: /my-blog/images/... (자동 처리)
```

### 13.7 완성 예시

```d2
direction: right

*.style.font-size: 16
*.style.border-radius: 6

sidecar_pod: Pod (Sidecar Mode) {
  style.fill: "#4A90D9"
  style.stroke: "#3A7ABD"
  style.font-color: "#FFFFFF"
  style.font-size: 16
  direction: down

  app: App {
    style.fill: "#6C757D"
    style.font-color: "#FFFFFF"
  }

  envoy: Envoy Sidecar {
    style.fill: "#F5A623"
    style.font-color: "#FFFFFF"
  }

  app -> envoy
}

ambient_pod: Pod (Ambient Mode) {
  style.fill: "#4A90D9"
  style.stroke: "#3A7ABD"
  style.font-color: "#FFFFFF"
  style.font-size: 16

  app: App {
    style.fill: "#6C757D"
    style.font-color: "#FFFFFF"
  }
}

ztunnel: ztunnel {
  style.fill: "#7ED321"
  style.font-color: "#FFFFFF"
}

ambient_pod -> ztunnel: eBPF
```

### 13.8 다이어그램 + 설명 조합

다이어그램만으로는 이해하기 어렵습니다. **마크다운 설명**과 함께 제공해야 합니다.

#### 기본 구조

```markdown
![다이어그램 제목](/images/series-name/diagram-name.svg)

| 구분 | A | B |
|------|---|---|
| 항목1 | 값 | 값 |
| 항목2 | 값 | 값 |

도입 문장으로 시작합니다.

첫 번째 개념을 설명하는 문단입니다. 구체적인 예시나 수치를 포함합니다.

두 번째 개념을 설명하는 문단입니다. "왜 그런지"를 설명합니다.

마무리 문장으로 핵심을 강조합니다.
```

#### 설명 분량 기준

| 다이어그램 유형 | 설명 분량 |
|----------------|----------|
| 개념 비교 (A vs B) | 3-4 문단 |
| 아키텍처 | 4-6 문단 + 컴포넌트 역할 목록 |
| 트래픽 흐름 | 단계별 번호 목록 (5-7단계) + 1-2 문단 |
| 기능 현황표 | 지원/미지원 분류 목록 + 2-3 문단 |

#### 좋은 예시

```markdown
![L4 Traffic Flow](/images/istio-ambient/l4-traffic-flow.svg)

- mTLS (SPIFFE ID 검증)
- L4 AuthorizationPolicy
- TCP 메트릭

L4 Only 모드가 Ambient의 기본이자 가장 효율적인 경로입니다.

트래픽 흐름을 따라가봅시다. Pod A에서 Pod B로 요청을 보내면:

1. Pod A의 요청이 나갑니다.
2. Node A의 ztunnel이 이 트래픽을 eBPF로 가로챕니다.
3. ztunnel이 Pod A의 SPIFFE ID로 mTLS 암호화를 수행합니다.
4. 암호화된 트래픽이 네트워크를 통해 Node B로 전달됩니다.
5. Node B의 ztunnel이 트래픽을 받아 mTLS 복호화합니다.
6. Pod B의 SPIFFE ID를 검증하고, L4 AuthorizationPolicy를 확인합니다.
7. 정책을 통과하면 Pod B로 트래픽을 전달합니다.

이 과정에서 **HTTP 헤더를 전혀 파싱하지 않습니다**. TCP 레벨에서 암호화/복호화와 IP 기반 인가만 수행하므로 오버헤드가 최소화됩니다.
```

### 13.9 체크리스트

**다이어그램**:
- [ ] 폰트 크기 16px 이상
- [ ] 비교 시 Grid 레이아웃 사용
- [ ] 컨테이너 간 연결선 제거 (대각선 방지)
- [ ] 다이어그램 내 한글 최소화 (영어/숫자)
- [ ] SVG 형식, 투명 배경
- [ ] 다크/라이트 양쪽에서 확인

**설명**:
- [ ] 도입 문장 포함 ("~를 살펴봅시다", "~를 따라가봅시다")
- [ ] 문단 분리 (한 줄에 모든 내용 X)
- [ ] 구체적 수치/예시 포함
- [ ] "왜 그런지" 설명
- [ ] 마무리 문장으로 핵심 강조
- [ ] 프로세스는 번호 목록으로
- [ ] 기능은 굵은 제목 + 설명 형식
