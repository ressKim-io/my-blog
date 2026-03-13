---
date: 2026-03-01
category: troubleshoot
project: Goti-server, Goti-monitoring
tags: [github-actions, ssm, aws, cd, timeout, polling]
---

# CD 파이프라인 SSM wait 기본 타임아웃(100초)으로 배포 실패

## Context
- Goti-server, Goti-monitoring 양쪽 CD 파이프라인 (GitHub Actions)
- SSM SendCommand로 EC2에 배포 스크립트 실행 후 `aws ssm wait command-executed`로 완료 대기
- 양쪽 모두 5번 이상 연속 실패

## Issue

```
Waiter CommandExecuted failed: Max attempts exceeded.
Previously accepted state: For expression "Status" we matched expected path: "InProgress"
##[error]배포 실패 (Status: InProgress)
##[error]Process completed with exit code 1.
```

SSM SendCommand는 아직 실행 중인데(`InProgress`), waiter가 먼저 타임아웃되어 실패 판정.

Server는 5번, Monitoring도 5번 연속 실패 확인:
```
gh run list --workflow=cd.yml --limit=5         # Server: 전부 failure
gh run list --limit=5                            # Monitoring: 전부 failure
```

## Action

### 가설 1: SSM send-command의 --timeout-seconds 부족 → 결과: 아님
- Server: 300초, Monitoring: 900초 — 충분한 값
- 실제로 SSM 명령 자체는 실행 중(InProgress)이었음

### 가설 2: `aws ssm wait command-executed` 기본 대기 시간 부족 → **적중**

`aws ssm wait command-executed`의 기본 설정:
- **polling interval**: 5초
- **max attempts**: 20회
- **총 대기**: 5초 × 20 = **100초**

deploy.sh의 실제 소요 시간:
- Server: Docker pull + 컨테이너 기동 + healthcheck(20회 × 5초 = 100초) = **150~200초**
- Monitoring: Docker pull(6개 이미지) + 6개 서비스 기동 + healthcheck = **200~400초**

두 경우 모두 100초를 초과하여 waiter가 먼저 포기함.

### 근본 원인 (Root Cause)
`aws ssm wait command-executed`의 기본 max-attempts(20회, 100초)가 배포 소요 시간보다 짧음.
AWS CLI의 waiter는 `--cli-read-timeout` 같은 커스텀 옵션을 지원하지 않아, 기본값을 변경할 수 없음.

추가로 Server에서는 OTel SDK 크래시로 healthcheck가 무한 실패 → SSM 명령이 300초 후 TimedOut →
그러나 waiter가 100초 시점에 이미 포기해서 `InProgress` 상태로 에러 보고.

### 적용한 수정

`aws ssm wait` → **shell polling 루프**로 교체 (양쪽 모두):

```yaml
# Before — 100초 고정 대기
aws ssm wait command-executed \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID" || true
STATUS=$(aws ssm get-command-invocation ... --query "Status")
# InProgress면 즉시 실패 판정

# After — 충분한 시간 동안 polling
MAX_WAIT=300  # Server: 300초 / Monitoring: 600초
INTERVAL=10   # Server: 10초 / Monitoring: 15초
while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS=$(aws ssm get-command-invocation ... --query "Status")
  case "$STATUS" in
    Success)     exit 0 ;;
    Failed|...)  # stdout+stderr 출력 후 exit 1 ;;
    *)           sleep $INTERVAL ;;
  esac
done
```

| 레포 | MAX_WAIT | INTERVAL | 이유 |
|------|----------|----------|------|
| Server | 300초 | 10초 | send-command timeout과 동일 |
| Monitoring | 600초 | 15초 | 6개 이미지 pull + 서비스 기동 여유 |

개선 사항:
- `Success/Failed/TimedOut/Cancelled` 등 상태별 정확한 분기 처리
- 진행 로그: `대기 중... (30s / 300s, Status: InProgress)`
- 실패 시 stdout + stderr 모두 출력

## Result
- 로컬 수정 완료, commit/push 대기 (다음 세션에서 배포와 함께 검증)
- 회귀 테스트: 실제 배포로만 검증 가능 (CD 파이프라인)
- 재발 방지: `aws ssm wait`를 사용하지 않고 polling 루프로 통일 — 대기 시간을 명시적으로 제어

## Related Files
- `Goti-server/.github/workflows/cd.yml` — Wait for deployment 스텝 교체
- `Goti-monitoring/.github/workflows/deploy.yml` — Wait for deployment 스텝 교체
