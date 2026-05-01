---
title: "ServiceMonitor release 라벨 누락 — Prometheus가 scrape를 안 하는 이유"
excerpt: "Alloy·Loki·Tempo Pod는 정상인데 Prometheus가 scrape하지 않았습니다. kube-prometheus-stack의 serviceMonitorSelector가 요구하는 release 라벨이 외부 chart의 ServiceMonitor에 없었기 때문입니다"
category: monitoring
tags:
  - go-ti
  - Prometheus
  - ServiceMonitor
  - Helm
  - Kind
  - Troubleshooting
date: "2026-02-17"
---

## 한 줄 요약

> kube-prometheus-stack의 Prometheus가 `release: kube-prometheus-stack-dev` 라벨이 있는 ServiceMonitor만 인식합니다. Alloy·Loki·Tempo는 별도 chart라 이 라벨이 없어서 scrape 대상에 등록되지 않았습니다

## Impact

- **영향 범위**: Monitoring Stack Health 대시보드, Alloy/Loki/Tempo 메트릭 전체
- **증상**: scrape target에 alloy/loki/tempo job 없음, PrometheusTargetMissing 알림 Firing
- **발생일**: 2026-03-13

---

## 🔥 증상: 대시보드 데이터 없음 + 알림 폭주

Monitoring Stack Health 대시보드에서 Alloy 메모리/CPU, Loki Ingestion Rate, Tempo Spans 패널이 전부 비어있었습니다.

동시에 Kind 컴포넌트 관련 알림이 Firing 상태:

```
ALERTS etcdInsufficientMembers    firing  severity=critical
ALERTS PrometheusTargetMissing    firing  job=kube-proxy     severity=warning
ALERTS PrometheusTargetMissing    firing  job=kube-etcd      severity=warning
```

---

## 🤔 원인: ServiceMonitor selector 불일치

Pod는 전부 Running, 2/2 Ready였습니다. 문제는 **Prometheus가 ServiceMonitor를 인식하지 못하는 것**이었습니다.

```bash
# Prometheus가 요구하는 라벨
$ kubectl get prometheus -n monitoring -o jsonpath='{.spec.serviceMonitorSelector}'
{"matchLabels":{"release":"kube-prometheus-stack-dev"}}

# Alloy/Loki/Tempo ServiceMonitor의 라벨
$ kubectl get servicemonitor alloy-dev loki-dev tempo-dev -o jsonpath='{.metadata.labels.release}'
# (빈 값)
```

kube-prometheus-stack의 Prometheus CR이 `serviceMonitorSelector`를 설정하면, **이 라벨이 있는 ServiceMonitor만** scrape 대상으로 등록합니다.

Alloy, Loki, Tempo는 별도 Helm chart로 배포되니까 이 라벨이 자동 부여되지 않습니다.
ServiceMonitor는 존재하지만 Prometheus가 무시하고 있었던 것입니다.

---

## ✅ 수정

### ServiceMonitor에 release 라벨 추가

각 chart의 values에 라벨을 추가했습니다. chart마다 키 이름이 다릅니다:

```yaml
# alloy-values.yaml
serviceMonitor:
  additionalLabels:
    release: kube-prometheus-stack-dev

# tempo-values.yaml
serviceMonitor:
  additionalLabels:
    release: kube-prometheus-stack-dev

# loki-values.yaml — 키 이름이 다름!
monitoring:
  serviceMonitor:
    labels:
      release: kube-prometheus-stack-dev
```

`additionalLabels` vs `labels` vs `monitoring.serviceMonitor.labels` — chart마다 달라서 `helm show values`로 사전 확인이 필요합니다.

### Kind 전용: scrape 불가 컴포넌트 비활성화

etcd, kube-proxy, kube-scheduler, kube-controller-manager는 Kind에서 **localhost에만 바인딩**되어 외부 scrape가 불가능합니다.
PrometheusTargetMissing 알림이 계속 Firing되니까 비활성화했습니다.

```yaml
# kube-prometheus-stack-values.yaml
kubeEtcd:
  enabled: false
kubeProxy:
  enabled: false
kubeScheduler:
  enabled: false
kubeControllerManager:
  enabled: false
```

---

## 📚 배운 점

### 새 모니터링 컴포넌트 추가 시 ServiceMonitor 라벨 확인 필수

kube-prometheus-stack의 `serviceMonitorSelector`가 특정 라벨을 요구하면, 모든 외부 chart의 ServiceMonitor에 이 라벨을 명시적으로 추가해야 합니다.

체크리스트:
1. `kubectl get prometheus -o jsonpath='{.spec.serviceMonitorSelector}'`로 요구 라벨 확인
2. 새 chart의 values에서 ServiceMonitor 라벨 설정 키 이름 확인 (`helm show values`)
3. 배포 후 `up{job="xxx"}` 쿼리로 scrape 등록 확인

### Kind 환경의 제한

Kind에서 control plane 컴포넌트는 localhost 바인딩이라 Prometheus가 scrape할 수 없습니다.
이것은 Kind의 알려진 제한이고, 이 컴포넌트들의 ServiceMonitor를 비활성화하는 것이 정답입니다.
prod(EKS)에서는 이 설정을 다시 활성화해야 합니다.
