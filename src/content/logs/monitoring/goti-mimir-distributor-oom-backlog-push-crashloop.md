---
title: "Mimir distributor OOM 168회 — 복구 직후 backlog 일괄 push가 만든 2차 장애"
excerpt: "512Mi 한계에서 20시간 동안 OOM 루프를 돌던 distributor를 복구하자, 그동안 Alloy가 쌓아둔 메트릭이 한꺼번에 밀려들어 Kafka record 크기 한계를 넘겼습니다. 수습하려 넣은 설정 키가 해당 버전에 존재하지 않아 Mimir 전체를 CrashLoop에 빠뜨린 기록입니다"
category: monitoring
tags:
  - go-ti
  - Mimir
  - Grafana-Alloy
  - OOM
  - Kafka
  - Observability
  - Troubleshooting
series:
  name: "goti-observability-ops"
  order: 11
date: "2026-03-24"
---

## 한 줄 요약

> Mimir distributor가 512Mi 한계에서 20시간 동안 168회 재시작했습니다. 메모리를 올려 복구하자 Alloy가 축적해 둔 backlog가 일괄 push되며 Kafka record 15MB 한계를 넘겼고, 이를 막으려 추가한 설정 키가 Mimir 3.0.1에 존재하지 않아 스택 전체가 CrashLoop에 빠졌습니다

---

## 🔥 문제: 애플리케이션을 진단하려는데 관측 스택이 먼저 죽어 있음

### 증상

E2E 테스트가 막혀 원인을 추적하려고 Grafana를 열었습니다. 그런데 `service_name` 변수에 `All`만 표시되고 모든 패널이 `No data` 상태였습니다

모니터링 네임스페이스를 확인하니 Mimir distributor가 CrashLoopBackOff 중이었습니다

```text
Last State: Terminated
  Reason: OOMKilled
  Exit Code: 137
  Restart Count: 168
  Limits: memory=512Mi
```

재시작 횟수 168회, 약 20시간 동안 OOM 루프를 돌고 있었습니다. 애플리케이션 장애를 추적하려던 참인데 그 도구가 먼저 멈춰 있는 상황이었습니다

---

## 🤔 원인: OOM → 복구 시 일괄 push → record 크기 초과 → 설정 오류로 전체 확산

distributor의 메모리 limit 512Mi가 부족해 OOM이 반복되고 있었습니다. 메모리를 올려 복구하자 이번에는 다른 에러가 쏟아졌습니다

```text
err-mimir-distributor-max-write-request-data-item-size
the write request contains a timeseries or metadata item which is larger
than the maximum allowed size of 15983616 bytes
```

흐름을 따라가면 이렇습니다

1. distributor가 20시간 동안 OOM 상태였습니다
2. 그 사이 Alloy는 WAL에 메트릭을 계속 축적했습니다
3. distributor가 복구되자 Alloy가 backlog를 일괄 push했습니다
4. 단일 Kafka record가 Mimir 기본 제한 15MB를 초과해 거부되었습니다

**복구 자체가 2차 장애의 방아쇠였다는 점이 핵심입니다.** 백엔드가 살아나는 순간이 가장 위험한 구간인데, 그 구간을 보호하는 장치가 없었습니다

여기서 수습을 시도하다 3차 사고가 났습니다. `max_write_request_data_item_size` 값을 Mimir `structuredConfig.limits`에 추가했는데, **Mimir 3.0.1에는 해당 config key가 존재하지 않았습니다**

```text
error loading config from /etc/mimir/mimir.yaml:
line 83: field max_write_request_data_item_size not found
       in type validation.plainLimits
```

이 파싱 에러 하나로 distributor뿐 아니라 ingester와 querier를 포함한 Mimir 전체가 CrashLoop에 빠졌습니다

---

## ✅ 해결

세 단계로 복구했습니다

**1. distributor 메모리 상향** — 512Mi에서 768Mi로 올렸습니다

**2. 긴급 롤백** — 존재하지 않는 설정을 제거했습니다. ArgoCD sync가 ConfigMap을 즉시 반영하지 않아 kubectl로 직접 패치했습니다

```bash
kubectl get cm mimir-dev-config -n monitoring -o yaml | \
    sed '/max_write_request_data_item_size/d' | kubectl apply -f -
```

**3. Alloy queue_config 추가** — 재발 방지를 위해 remote_write 측에서 분할 전송을 강제했습니다

```alloy
prometheus.remote_write "default" {
  endpoint {
    queue_config {
      max_samples_per_send = 500   # 기본 2000 → 축소
      max_shards = 50              # 동시 전송 제한
      capacity = 10000
    }
  }
}
```

복구 후 Mimir 전체가 Running으로 안정화되었고, Alloy backlog도 작은 단위로 나뉘어 정상 ingestion되었습니다

---

## 📚 교훈

**백엔드 복구 순간이 가장 위험합니다.** 장애 중 producer 측에 쌓인 데이터는 백엔드가 살아나는 즉시 최대 속도로 밀려듭니다. 유입 제어 없이 메모리만 올리면 같은 사고가 규모만 키워 반복됩니다. `queue_config`는 장애 대응용 옵션이 아니라 기본값으로 넣어 둘 안전장치입니다

**존재하지 않는 설정 키 하나가 스택 전체를 내립니다.** Mimir `structuredConfig`는 알 수 없는 필드를 무시하지 않고 파싱 자체를 실패시킵니다. 설정을 추가하기 전에 운영 중인 버전의 문서나 소스에서 필드 존재를 먼저 확인해야 합니다

**긴급 상황에서 GitOps는 한 박자 늦습니다.** ArgoCD가 Helm chart의 ConfigMap을 즉시 갱신하지 않는 경우가 있습니다. drift를 감수하고 kubectl로 직접 패치한 뒤 소스에 반영하는 편이 빠릅니다

같은 시기 ingester 쪽에서도 OOM이 있었지만 기전이 다릅니다. 그쪽은 WAL replay와 Kafka catch-up이 겹친 경우이며 [별도 글](/logs/goti-monitoring-msa-and-mimir-crash/)에 정리했습니다

### 관련 파일

- `Goti-monitoring/values-stacks/dev/mimir-values.yaml` — distributor memory 512Mi→768Mi
- `Goti-monitoring/values-stacks/dev/alloy-values.yaml` — queue_config 추가
