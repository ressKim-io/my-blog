# Draw.io MCP 규칙 가이드

> Claude Code에서 draw.io MCP로 다이어그램 생성 시 필수 규칙

---

## 목적

MCP 도구를 사용해 일관된 아키텍처 다이어그램을 생성할 때 참조

---

## MCP 도구 개요

| 도구 | 용도 |
|------|------|
| `new_diagram` | 새 다이어그램 생성 |
| `add_nodes` | 노드(박스, 아이콘) 배치 추가 |
| `link_nodes` | 노드 간 연결선 배치 추가 |
| `get_diagram_info` | 현재 다이어그램 분석/조회 |

---

## 규칙

### 필수

```
[MUST] 작업 순서: new_diagram → 외부 그룹 → 내부 노드 → 연결선
[MUST] 노드 생성 시 x, y 좌표 필수 지정 (겹침 방지)
[MUST] AWS 아이콘은 fillColor 필수 (없으면 안 보임)
[MUST] 연결선 전에 source/target 노드가 먼저 존재해야 함
[MUST] 기존 다이어그램 수정 시 get_diagram_info로 먼저 분석
```

### 권장

```
[SHOULD] 배치 작업 활용 - add_nodes로 여러 노드 한번에 추가
[SHOULD] 그룹 박스는 내부 노드보다 먼저 생성
[SHOULD] 노드 간격 최소 50px 유지
[SHOULD] 파일 경로: docs/images/{project}_{type}.drawio
```

### 금지

```
[NEVER] 노드 없이 연결선 먼저 생성
[NEVER] 좌표 없이 노드 추가 (무조건 겹침)
[NEVER] 하나의 add_nodes에 50개 이상 노드 (타임아웃)
```

---

## 작업 순서 (워크플로우)

```
1. new_diagram
   └─ 파일 경로, 캔버스 크기 지정

2. add_nodes (외부 → 내부 순서)
   ├─ 1차: 최외곽 그룹 (AWS Cloud, VPC)
   ├─ 2차: 중간 그룹 (Subnet, Security Group)
   └─ 3차: 실제 노드 (서비스, 아이콘, 라벨)

3. link_nodes
   └─ 트래픽/의존성 방향에 맞게 연결

4. (선택) get_diagram_info로 검증
```

---

## 네이밍 컨벤션

| 요소 | 패턴 | 예시 |
|------|------|------|
| 서비스 박스 | `svc-{name}` | `svc-auth`, `svc-user` |
| AWS 아이콘 | `{service}` | `eks`, `rds-primary` |
| 그룹/영역 | `{area}-{type}` | `vpc`, `public-subnet` |
| 라벨 | `label-{purpose}` | `label-needs` |
| 흐름 번호 | `flow-{n}` | `flow-1`, `flow-2` |

---

## 캔버스 크기

| 다이어그램 유형 | 권장 크기 |
|----------------|----------|
| 서비스 의존성 | 1400 x 900 |
| 클러스터 아키텍처 | 1200 x 800 |
| AWS 전체 아키텍처 | 1600 x 1200 |
| 문제 진단 (Before/After) | 1400 x 900 |

---

## 트러블슈팅

| 문제 | 원인 | 해결 |
|------|------|------|
| 노드 겹침 | 좌표 미지정/간격 부족 | x,y 명시, 최소 50px 간격 |
| 연결선 이상 | 경유점 없음 | `orthogonalLoop=1` 추가 |
| AWS 아이콘 안 보임 | fillColor 누락 | `fillColor=#ED7100` 필수 |
| 타임아웃 | 한번에 너무 많은 노드 | 배치 나눠서 실행 |

---

## 기존 다이어그램 수정 패턴

```
[MUST] 수정 전 get_diagram_info 실행
[MUST] 기존 노드 ID 확인 후 중복 방지
[SHOULD] 수정할 영역만 재생성 (전체 재생성 X)
```

---

*버전: 1.0 | 최종 수정: 2026-01-09*
