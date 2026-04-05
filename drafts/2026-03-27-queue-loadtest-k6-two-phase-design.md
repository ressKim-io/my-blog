---
date: 2026-03-27
category: decision
project: goti-team-controller
tags: [k6, load-test, queue, architecture, QUEUE_IMPL]
---

# 대기열 부하테스트 K6 스크립트 2-Phase 설계 — E2E 3인분 + 비교 시나리오 3종

## Context

goti-server에 3명이 각각 다른 대기열을 구현했다 (PR #309 Josuyeon, #311 AkiStory, #312 junsang).
내일 오전 부하테스트 예정. 두 가지 목적이 있었다:

1. **E2E 검증**: 각 구현체가 대기열→예매→결제 전체 플로우에서 정상 동작하는지
2. **성능 비교**: 구현체 간 순수 대기열 처리량, Redis 명령 분포, TTL 회수 속도 차이

이를 2개의 Plan으로 분리하여 순차 구현했다.

## Issue

### 파일 구조 설계

#### Option A: 사람별 × 시나리오별 개별 파일 (9+6=15파일)
- 장점: 파일별 독립성, 수정 시 영향 범위 최소
- 단점: 코드 중복 극심 (시나리오 로직 동일, import만 다름), 파일 수 폭발

#### Option B: 시나리오 타입별 1파일 + QUEUE_IMPL 환경변수 (3+6=9파일)
- 장점: 코드 중복 최소화, 3파일로 9조합 커버
- 단점: K6 static import 제약으로 3개 헬퍼 모두 import 필요 (초기화 오버헤드)

#### Option C: E2E는 사람별 파일 + 비교 시나리오만 QUEUE_IMPL 패턴 (혼합)
- 장점: E2E는 사람별 커스터마이징 가능 + 비교 시나리오는 중복 제거
- 단점: 두 가지 패턴 혼재

### 폴링 간격 설계

- 하드코딩 1초 vs 환경변수 `POLL_INTERVAL`로 조절 가능하게
- 대기열 비교에서 폴링 빈도가 Redis 부하 차이를 극대화하는 핵심 축이므로 조절 필수

## Action

**Option C 선택** — E2E는 사람별 파일, 비교 시나리오는 QUEUE_IMPL 패턴.

### Phase 1: E2E 대기열 스크립트 (완료)

사람별 헬퍼 3개 + 시나리오 3개 = 6파일. 공통 인터페이스 설계:

```
enterQueue() → waitForAdmission() → enterSeat() → [ticketing] → leaveQueue()
```

각 헬퍼가 PR별 API 차이를 내부 처리:
- josuyeon: POST /queue/enter, queueNumber ≤ publishedRank 판단
- akistory: POST /queues/enter?gameId=, heartbeat 병행, secureToken 기반
- junsang: POST /queue/validate, enterSeat=no-op(Interceptor), leaveQueue=no-op(Spring Event)

### Phase 2: 비교 시나리오 3종 (완료)

QUEUE_IMPL 환경변수 패턴으로 3파일 생성:
- `spike-queue.js` — 5000 VU 스파이크, 순수 대기열 처리 한계
- `queue-only.js` — 순수 대기열 처리량 + 50% TTL 회수 테스트
- `soldout-queue.js` — 매진 시뮬레이션, 대기열 생명주기 전체

**핵심 환경변수**: `POLL_INTERVAL` (폴링 간격, 기본 1초) — 0.5초~2초 조절로 Redis SCAN vs O(1) 차이 극명화.

### run.sh 확장

- `help` 명령 추가 (시나리오별 상세 설명)
- 9개 case 추가 (spike/queueonly/soldout × josuyeon/akistory/junsang)
- `QUEUE_IMPL`, `POLL_INTERVAL`, `SOLDOUT_AT_SEC` 환경변수 전달

## Result

### 최종 파일 구조

```
load-tests/
  helpers/
    queue-josuyeon.js    # PR #309 대기열 액션
    queue-akistory.js    # PR #311 대기열 액션
    queue-junsang.js     # PR #312 대기열 액션
  scenarios/
    queue-josuyeon.js    # E2E (대기열→예매→결제)
    queue-akistory.js    # E2E
    queue-junsang.js     # E2E
    spike-queue.js       # 비교: 스파이크 (QUEUE_IMPL 패턴)
    queue-only.js        # 비교: 대기열만 (QUEUE_IMPL 패턴)
    soldout-queue.js     # 비교: 매진 (QUEUE_IMPL 패턴)
  run.sh                 # help 명령 + 18개 시나리오 지원
```

### 실행 방법

```bash
# E2E (사람별)
./load-tests/run.sh queue-josuyeon

# 비교 시나리오 (QUEUE_IMPL 자동 설정)
./load-tests/run.sh spike-josuyeon
VUS=2000 POLL_INTERVAL=0.5 ./load-tests/run.sh queueonly-junsang
```

### 후속 작업
- goti-load-observer(metrics-collector) 모니터링 연동 — Redis 메트릭 수집 (별도 Phase)
- redis-cli commandstats before/after diff — 수동 측정으로 충분
- 대기열 진입→통과만 하는 단축 시나리오 — 추후 추가 예정

### 제약 사항
- K6 static import 제약: 비교 시나리오에서 3개 헬퍼 모두 import (사용하지 않는 구현체도)
- 매진 시나리오: 매진 신호는 외부 수동 트리거 필요 (K6는 측정만)
- API 필드명은 PR diff 기반 추정 — 내일 테스트 전 curl로 검증 필요

## Related Files

- `load-tests/helpers/queue-josuyeon.js`
- `load-tests/helpers/queue-akistory.js`
- `load-tests/helpers/queue-junsang.js`
- `load-tests/scenarios/queue-josuyeon.js`
- `load-tests/scenarios/queue-akistory.js`
- `load-tests/scenarios/queue-junsang.js`
- `load-tests/scenarios/spike-queue.js`
- `load-tests/scenarios/queue-only.js`
- `load-tests/scenarios/soldout-queue.js`
- `load-tests/run.sh`
