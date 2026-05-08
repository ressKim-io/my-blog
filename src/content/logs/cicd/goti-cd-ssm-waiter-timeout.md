---
title: "CD 파이프라인이 5번 연속 실패한 이유: SSM Waiter 100초 제한"
excerpt: "aws ssm wait command-executed의 숨겨진 100초 타임아웃 때문에 배포가 계속 실패한 트러블슈팅"
category: cicd
tags:
  - go-ti
  - github-actions
  - aws
  - ssm
  - cd
  - ec2
  - troubleshooting
series:
  name: "goti-ec2-deploy"
  order: 2
date: "2026-03-01"
---

## 한 줄 요약

> `aws ssm wait command-executed`의 기본 대기 시간은 100초(5초 × 20회)인데, 실제 배포는 150~400초가 걸려서 waiter가 먼저 포기했습니다

---

## 🔥 상황

Go-Ti 프로젝트의 CD 파이프라인은 GitHub Actions에서 SSM SendCommand로 EC2에 배포 스크립트를 실행하는 구조입니다.

Server와 Monitoring 레포 모두 **5번 이상 연속 실패**하고 있었습니다.

```bash
$ gh run list --workflow=cd.yml --limit=5
STATUS  TITLE           BRANCH
X       Deploy to EC2   main
X       Deploy to EC2   main
X       Deploy to EC2   main
X       Deploy to EC2   main
X       Deploy to EC2   main
```

---

## 🤔 원인: 숨겨진 100초 제한

### 에러 메시지

```
Waiter CommandExecuted failed: Max attempts exceeded.
Previously accepted state: For expression "Status" we matched expected path: "InProgress"
##[error]배포 실패 (Status: InProgress)
##[error]Process completed with exit code 1.
```

핵심은 **Status가 InProgress**라는 점입니다.
SSM 명령은 아직 실행 중인데, waiter가 먼저 타임아웃된 것입니다.

### 가설 검증

**가설 1: SSM send-command의 timeout-seconds가 부족한가?**

아닙니다. Server는 300초, Monitoring은 900초로 충분히 설정되어 있었어요.
실제로 SSM 명령 자체는 잘 실행되고 있었습니다.

**가설 2: `aws ssm wait command-executed`의 기본 대기 시간이 부족한가?**

이것이 정답이었습니다.

### aws ssm wait의 기본 설정

`aws ssm wait command-executed`의 내부 동작을 살펴보겠습니다:

| 설정 | 값 |
|------|-----|
| polling interval | 5초 |
| max attempts | 20회 |
| **총 대기 시간** | **100초** |

이 값은 AWS CLI에 하드코딩되어 있습니다.
`--cli-read-timeout` 같은 옵션으로도 변경할 수 없습니다.

### 실제 배포 소요 시간과 비교

| 레포 | 배포 작업 | 예상 소요 시간 |
|------|-----------|:-:|
| Server | Docker pull + 컨테이너 기동 + healthcheck(20회 × 5초) | **150~200초** |
| Monitoring | Docker pull(6개 이미지) + 6개 서비스 기동 + healthcheck | **200~400초** |

두 경우 모두 100초를 훨씬 초과합니다.
waiter가 100초 시점에 포기하면서 아직 InProgress인 상태를 실패로 보고한 것입니다.

추가로 Server에서는 OTel SDK 크래시로 healthcheck가 무한 실패하는 별도 이슈도 있었습니다.
SSM 명령이 300초 후 TimedOut이 되어야 하는데, waiter는 이미 100초에 포기해서 `InProgress` 상태로 에러를 보고했습니다.

---

## ✅ 해결: Shell Polling 루프로 교체

`aws ssm wait`는 대기 시간을 커스터마이즈할 수 없으니, 직접 polling 루프를 구현했습니다.

### Before: 100초 고정 대기

```yaml
# GitHub Actions CD workflow
- name: Wait for deployment
  run: |
    aws ssm wait command-executed \
      --command-id "$COMMAND_ID" \
      --instance-id "$INSTANCE_ID" || true
    STATUS=$(aws ssm get-command-invocation ... --query "Status")
    # InProgress면 즉시 실패 판정
```

### After: 충분한 시간 동안 polling

```bash
MAX_WAIT=300   # Server: 300초 / Monitoring: 600초
INTERVAL=10    # Server: 10초 / Monitoring: 15초
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --query "Status" --output text)

  case "$STATUS" in
    "Success")
      echo "✅ 배포 성공"
      exit 0
      ;;
    "Failed"|"TimedOut"|"Cancelled")
      echo "❌ 배포 실패 (Status: $STATUS)"
      # stdout + stderr 출력
      aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$INSTANCE_ID" \
        --query "[StandardOutputContent, StandardErrorContent]" \
        --output text
      exit 1
      ;;
    *)
      echo "⏳ 대기 중... (${ELAPSED}s / ${MAX_WAIT}s, Status: $STATUS)"
      sleep $INTERVAL
      ELAPSED=$((ELAPSED + INTERVAL))
      ;;
  esac
done

echo "❌ 타임아웃 (${MAX_WAIT}초 초과)"
exit 1
```

### 레포별 설정값

| 레포 | MAX_WAIT | INTERVAL | 이유 |
|------|:--------:|:--------:|------|
| Server | 300초 | 10초 | send-command timeout과 동일 |
| Monitoring | 600초 | 15초 | 6개 이미지 pull + 서비스 기동 여유 |

### 개선 포인트

기존 `aws ssm wait` 대비 개선된 점을 정리하겠습니다:

- **명시적 대기 시간 제어**: MAX_WAIT로 원하는 만큼 대기 가능
- **상태별 정확한 분기**: Success/Failed/TimedOut/Cancelled 각각 처리
- **진행 로그**: `대기 중... (30s / 300s, Status: InProgress)` 형태로 진행 상황 확인 가능
- **실패 시 상세 로그**: stdout + stderr 모두 출력

---

## 📚 배운 점

### aws ssm wait를 믿지 마라

`aws ssm wait command-executed`는 편리하지만, 100초라는 숨겨진 제한이 있습니다.
Docker pull + healthcheck가 포함된 배포는 100초를 쉽게 넘기기 때문에 실무에서는 거의 쓸 수 없습니다.

AWS CLI 공식 문서에서도 이 제한을 명시적으로 설명하지 않습니다.
`--max-attempts`나 `--delay` 같은 waiter 옵션도 `ssm wait`에서는 지원하지 않습니다.

### polling 루프가 더 안전한 이유

| 방식 | 대기 시간 | 상태 분기 | 로그 |
|------|:-:|:-:|:-:|
| `aws ssm wait` | 100초 고정 | InProgress만 감지 | 없음 |
| Shell polling | 커스터마이즈 가능 | 모든 상태 처리 | 있음 |

**대기 시간을 제어할 수 없는 waiter보다, 직접 polling하는 것이 항상 더 안전합니다.**
