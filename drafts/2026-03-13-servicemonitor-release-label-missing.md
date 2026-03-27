---
date: 2026-03-13
category: troubleshoot
project: Goti-monitoring
tags: [prometheus, servicemonitor, release-label, kind, kube-prometheus-stack, alloy, loki, tempo]
---

# ServiceMonitor release 라벨 누락으로 Alloy/Loki/Tempo scrape 미등록 + Kind PrometheusTargetMissing 알림

## Context
Kind 클러스터 모니터링 스택 정상화 작업 중. Grafana "Monitoring Stack Health" 대시보드에서 Alloy/Loki/Tempo 메트릭이 표시되지 않음. 동시에 etcd/kube-proxy/kube-scheduler/kube-controller-manager에 대한 PrometheusTargetMissing 알림이 지속 Firing.

## Issue

### 증상 1: Monitoring Stack Health 대시보드 데이터 없음
Alloy 메모리/CPU, Loki Ingestion Rate, Tempo Spans 패널 등이 비어있음. Prometheus scrape target에서 alloy/loki/tempo job이 아예 없음.

```
$ kubectl exec prometheus-0 -- wget -qO- '.../api/v1/targets'
# alloy, loki, tempo job 없음
# alloy-dev, loki-dev, tempo-dev ServiceMonitor는 존재하지만 Prometheus가 인식 안 함
```

### 증상 2: Kind 컴포넌트 Firing 알림
```
ALERTS etcdInsufficientMembers firing   endpoint=http-metrics  severity=critical
ALERTS PrometheusTargetMissing  firing   job=kube-proxy         severity=warning
ALERTS PrometheusTargetMissing  firing   job=kube-etcd          severity=warning
ALERTS PrometheusTargetMissing  firing   job=kube-scheduler     severity=warning
```

### 증상 3: 에러 분석 대시보드 parse error
```
queries require at least one regexp or equality matcher that does not have an empty-compatible value.
For instance, app=~".*" does not meet this requirement, but app=~".+" will
```
대시보드 변수 `$svc`가 `label_values(http_server_request_duration_seconds_count, job)`으로 조회하는데, remote_write 404(별도 이슈)로 메트릭이 없어 빈 값 → Loki 쿼리 실패.

재현 조건: Prometheus `serviceMonitorSelector`가 특정 라벨을 요구하는 환경에서 외부 chart(Alloy/Loki/Tempo)의 ServiceMonitor에 해당 라벨 미설정.

## Action

### 증상 1 진단

1. 가설: Alloy/Loki/Tempo pod 문제 → 결과: 기각 (모든 pod Running, 2/2 Ready)
2. 가설: ServiceMonitor selector 불일치 → 결과: 채택

```bash
# Prometheus가 요구하는 ServiceMonitor 라벨
$ kubectl get prometheus -n monitoring -o jsonpath='{.spec.serviceMonitorSelector}'
{"matchLabels":{"release":"kube-prometheus-stack-dev"}}

# Alloy/Loki/Tempo ServiceMonitor의 release 라벨
$ kubectl get servicemonitor alloy-dev loki-dev tempo-dev -o jsonpath='{.metadata.labels.release}'
# (빈 값) — release 라벨 없음
```

**근본 원인**: kube-prometheus-stack의 Prometheus CR이 `serviceMonitorSelector: {matchLabels: {release: kube-prometheus-stack-dev}}`로 설정되어 있어, 이 라벨이 없는 ServiceMonitor는 scrape target으로 등록되지 않음. Alloy/Loki/Tempo는 별도 Helm chart로 배포되므로 이 라벨이 자동 부여되지 않음.

### 증상 2 진단

Kind 클러스터의 etcd, kube-proxy, kube-scheduler, kube-controller-manager는 localhost에만 바인딩되어 외부에서 메트릭 수집 불가. Kind의 알려진 제한.

### 적용한 수정

**수정 1: ServiceMonitor release 라벨 추가**

각 chart의 values에 라벨 추가 (chart마다 키 이름이 다름):

- `alloy-values.yaml`: `serviceMonitor.additionalLabels.release: kube-prometheus-stack-dev`
- `tempo-values.yaml`: `serviceMonitor.additionalLabels.release: kube-prometheus-stack-dev`
- `loki-values.yaml`: `monitoring.serviceMonitor.labels.release: kube-prometheus-stack-dev`

**수정 2: Kind scrape 불가 컴포넌트 비활성화**

`kube-prometheus-stack-values.yaml`에 추가:
```yaml
kubeEtcd:
  enabled: false
kubeProxy:
  enabled: false
kubeScheduler:
  enabled: false
kubeControllerManager:
  enabled: false
```

## Result
수정 후 ArgoCD sync 완료:
- `alloy-dev` ServiceMonitor에 `release: kube-prometheus-stack-dev` 라벨 반영 → Prometheus scrape target 등록 (`up=1`)
- `loki-dev`, `tempo-dev` 동일 반영
- etcd/kube-proxy/kube-scheduler/kube-controller-manager ServiceMonitor 제거 → PrometheusTargetMissing 알림 해소
- 에러 분석 대시보드: 메트릭 유입 시작으로 변수 정상 조회 → parse error 해소

회귀 테스트: `kubectl get servicemonitor -n monitoring -o jsonpath`로 release 라벨 존재 확인.

재발 방지: **새 모니터링 컴포넌트를 Helm chart로 추가할 때, Prometheus serviceMonitorSelector가 요구하는 라벨을 ServiceMonitor values에 반드시 설정**. chart마다 키 이름이 다르므로 (`additionalLabels` vs `labels`) `helm show values`로 사전 확인 필요.

## Related Files
- Goti-monitoring/values-stacks/dev/alloy-values.yaml
- Goti-monitoring/values-stacks/dev/loki-values.yaml
- Goti-monitoring/values-stacks/dev/tempo-values.yaml
- Goti-monitoring/values-stacks/dev/kube-prometheus-stack-values.yaml
