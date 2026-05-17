---
title: "GOMEMLIMIT — Go 서비스가 컨테이너 메모리 한계를 인지하는 방법"
excerpt: "Go 기본 GC는 컨테이너 메모리 limit을 모르기 때문에 OOM Kill 직전까지 GC를 거의 발동하지 않습니다 GOMEMLIMIT soft limit이 GC를 앞당겨 이 문제를 해결하는 원리를 설명합니다"
category: monitoring
tags:
  - go-ti
  - gomemlimit
  - go-gc
  - gogc
  - oom
  - concept
series:
  name: "goti-deepdive-observability"
  order: 9
date: "2026-03-31"
---

## 한 줄 요약

> Go 기본 GC(GOGC)는 힙 증가율만 보고 동작해 컨테이너 메모리 limit을 인지하지 못합니다 — GOMEMLIMIT은 "이 값을 넘기 전에 GC를 반드시 돌려라"는 soft limit을 추가해 OOM Kill을 예방합니다

---

## 🤔 무엇을 푸는 기술인가

Go 런타임은 힙 메모리 관리를 가비지 컬렉터(GC)가 담당합니다 문제는 **Go GC가 컨테이너 메모리 limit을 알지 못한다**는 점입니다

Go 프로세스가 컨테이너 안에서 실행되면 OS는 프로세스가 보는 총 가용 메모리를 컨테이너 limit으로 제한합니다 그런데 Go 런타임은 이 정보를 자동으로 읽지 않습니다 Go 1.18 이전(GOMEMLIMIT 도입 전)에는 런타임이 GC 발동 시점을 결정할 때 컨테이너 limit을 전혀 참조하지 않았습니다

이 상황에서는 트래픽 spike나 backlog 폭증 시 메모리 사용량이 컨테이너 limit에 근접해도 GC가 충분히 발동하지 않아 OOM Kill을 받습니다

GOMEMLIMIT은 이 간극을 메우는 환경 변수입니다 **"힙이 이 값에 접근하면 GC를 적극적으로 발동하라"**는 soft limit을 런타임에 알려줍니다 Go 1.19(2022년 8월)에 정식 도입된 이 기능은 컨테이너 환경에서 Go 서비스를 안정적으로 운영하는 핵심 설정이 됐습니다

---

## 🔧 동작 원리

### Go GC 기본 동작 — GOGC

Go GC는 기본적으로 `GOGC` 환경 변수로 제어됩니다 `GOGC=100`(기본값)은 **"이전 GC 후 힙 크기 대비 100% 증가 시 GC를 발동한다"**는 의미입니다

예를 들어 GC 직후 힙이 50 MB라면, 힙이 100 MB에 도달할 때 다음 GC가 발동합니다 이 배가(doubling) 규칙은 힙 증가율이 일정하면 GC 빈도도 일정하게 유지되도록 설계됐습니다

```text
GOGC = 100  →  다음 GC 발동 목표 힙 = 이전 GC 완료 힙 × 2
GOGC = 50   →  다음 GC 발동 목표 힙 = 이전 GC 완료 힙 × 1.5
GOGC = 200  →  다음 GC 발동 목표 힙 = 이전 GC 완료 힙 × 3
```

GOGC를 낮추면 GC를 더 자주 발동해 힙을 작게 유지하지만 CPU 오버헤드가 늘어납니다 반대로 높이면 GC 빈도가 줄어 CPU는 절약하지만 힙이 더 크게 자랍니다

### 컨테이너 환경에서 GOGC만으로는 부족한 이유

GOGC는 힙 증가율 기반이기 때문에 **절대값 상한을 보장하지 못합니다** 컨테이너 limit이 2 GiB이고 현재 힙이 1.8 GiB여도, 이전 GC 완료 힙이 1 GiB였다면 다음 GC 발동 목표는 2 GiB입니다 즉, limit을 초과하고 나서야 GC가 발동할 수 있습니다

더 심각한 문제는 Go 힙 외의 메모리 소비입니다 Go 런타임 자체, CGO 할당, 스택, 내부 메타데이터 등은 힙 크기에 포함되지 않습니다 실제 RSS(Resident Set Size)는 힙 크기보다 항상 더 큽니다

결과적으로 GOGC만 의존하면 다음 상황이 발생합니다

```text
컨테이너 limit = 2 GiB
힙 = 1.8 GiB    (GOGC 목표: 아직 안 됨)
RSS = 1.95 GiB  (힙 외 메모리 포함)
→ 컨테이너가 OOM Kill을 보냄
→ GC는 한 번도 발동하지 않은 채 프로세스 종료
```

### GOMEMLIMIT의 동작 방식

`GOMEMLIMIT`은 Go 1.19에서 `runtime/debug.SetMemoryLimit` 함수와 함께 도입됐습니다 이 값은 **Go 런타임이 사용하려는 메모리 총량의 soft limit**입니다

"soft"인 이유는 이 값을 초과해도 런타임이 즉시 패닉하거나 종료하지 않기 때문입니다 다만 이 한계에 접근하면 런타임은 GC를 최대한 자주 발동해 메모리를 줄이려고 시도합니다

내부 동작 순서는 다음과 같습니다

1. Go 런타임이 힙 할당을 처리할 때마다 현재 메모리 사용량을 GOMEMLIMIT과 비교합니다
2. 사용량이 GOMEMLIMIT에 근접하면 GC를 즉시 발동합니다 (`GOGC` 목표 힙과 무관하게)
3. GC가 완료되고도 여전히 GOMEMLIMIT 근처라면 GC를 계속 반복합니다
4. GC를 반복해도 메모리가 줄지 않으면(라이브 힙 자체가 limit보다 큰 경우) 런타임은 더 이상 메모리를 줄일 수 없으므로 GOGC 목표를 임시로 완화해 thrashing을 방지합니다

Go 1.19 릴리즈 노트는 이 4단계 동작을 "ballast 패턴"이라 부릅니다 — 한계에 가까워질수록 GC가 집중적으로 발동하지만, 그래도 안 되면 GC 무한 루프에 빠지지 않도록 보호합니다

### 90% 설정 관행이 생긴 이유

GOMEMLIMIT을 컨테이너 limit과 정확히 같은 값(100%)으로 설정하면 안 됩니다

Go 힙 외에도 다음 항목들이 RSS에 포함됩니다

| 구성 요소 | 설명 |
|---|---|
| Go 런타임 자체 | 스케줄러, GC 메타데이터, 스택 세그먼트 |
| CGO 할당 | C 라이브러리를 호출하는 경우의 힙 외 할당 |
| `mmap` 기반 파일 매핑 | OS가 추적하는 가상 메모리 |
| 커널 스택 | 스레드별 커널 공간 스택 (보통 수십 KB) |

이들의 합이 RSS에서 힙 크기를 뺀 "오버헤드"입니다 일반적인 Go 서비스에서 이 오버헤드는 수십 MB ~ 수백 MB 규모입니다

GOMEMLIMIT을 limit의 90%로 설정하면 나머지 10%가 이 오버헤드를 위한 여유 공간이 됩니다 컨테이너 limit이 2 GiB라면 GOMEMLIMIT = 1.84 GiB로 설정해, 힙이 1.84 GiB에 도달하면 GC가 발동하고 실제 RSS는 2 GiB 아래에서 유지되는 구조입니다

```bash
# 환경 변수로 설정 (바이트 단위 또는 단위 접미사 사용 가능)
GOMEMLIMIT=1932735283   # 1.8 GiB (2Gi × 0.9)

# 또는 런타임에서 동적 설정
import "runtime/debug"
debug.SetMemoryLimit(1932735283)
```

컨테이너 환경에서는 보통 Kubernetes `resources.limits.memory` 값을 기준으로 90%를 계산해 환경 변수로 주입합니다

![GOMEMLIMIT 설정 전후 메모리 곡선 비교|tall](/diagrams/goti-deepdive-gomemlimit-1.svg)

위 다이어그램은 GOMEMLIMIT 미설정과 설정 시의 메모리 거동 차이를 보여줍니다

상단 패널(미설정)에서 메모리는 완만하게 계속 상승합니다 GOGC가 힙 증가율 기반으로 GC를 발동하지만 절대값 상한이 없어, 트래픽이 지속되면 OOM Kill 한계에 도달한 시점에 프로세스가 강제 종료됩니다 이 구간에서 GC는 거의 발동하지 않습니다

하단 패널(설정)에서 메모리는 GOMEMLIMIT 기준선(90%)에 도달하는 순간 GC가 발동하고 메모리가 즉시 내려갑니다 이후 메모리가 다시 기준선에 근접할 때마다 GC가 반복 발동해, 메모리 곡선은 안정 구간 안에서 톱니 패턴을 그립니다 OOM Kill 한계선 아래에서 프로세스가 계속 살아있습니다

---

## 📐 세부 동작과 옵션

### GOMEMLIMIT과 GOGC의 관계

두 설정은 독립적으로 동작하며 서로를 보완합니다

| 설정 | 제어 대상 | 상한 보장 | 주 용도 |
|---|---|---|---|
| `GOGC` | GC 발동 빈도 (힙 증가율) | 없음 (절대값 아님) | CPU-메모리 트레이드오프 조정 |
| `GOMEMLIMIT` | 메모리 총량 soft limit | 있음 (절대값) | 컨테이너 OOM 방지 |

GOGC를 `off`로 설정해도 GOMEMLIMIT이 설정돼 있으면 한계에 근접 시 GC가 발동합니다 반대로 GOMEMLIMIT 없이 GOGC만 사용하면 절대값 보장이 없어 컨테이너 환경에서 OOM이 발생할 수 있습니다

Go 1.19 이후 권장 패턴은 **GOGC와 GOMEMLIMIT을 함께 설정**하는 것입니다 GOGC는 평상시 GC 빈도를 조정하고, GOMEMLIMIT은 최악의 경우 절대값 방어선 역할을 합니다

### GC thrashing 방지 메커니즘

라이브 힙(실제로 해제 불가능한 객체들이 차지하는 힙)이 GOMEMLIMIT보다 크면, GC를 아무리 반복해도 메모리가 줄지 않습니다 이 상태에서 GC를 계속 발동하면 CPU만 소비하는 GC thrashing이 발생합니다

Go 런타임은 이를 감지하면 **GC CPU 사용률을 50% 이하로 제한**합니다 GC에 CPU의 절반 이상을 쓰는 상황이 되면 런타임은 GOGC 목표를 일시 완화해 GC 빈도를 줄입니다 이 경우 결국 OOM Kill을 받지만, 적어도 메모리 해제 여지가 있는 동안은 thrashing 없이 처리됩니다

### Kubernetes에서 GOMEMLIMIT 주입 패턴

Kubernetes Pod spec에서 `resources.limits.memory`와 연동해 `GOMEMLIMIT`을 자동 계산하는 방법은 두 가지입니다

**방법 1 — 고정값 직접 주입:**

```yaml
env:
  - name: GOMEMLIMIT
    value: "1703m"    # 90% of 2Gi (2147483648 × 0.9 = 1932735283 bytes ≈ 1703 MiB)
```

**방법 2 — Downward API로 limit 참조 후 계산 (일반적):**

실제로는 limit 값을 직접 환경 변수로 읽어오는 방법이 없어, 보통 Helm values나 Kustomize 패치에서 계산한 값을 고정값으로 기입합니다 limit이 바뀌면 GOMEMLIMIT도 함께 갱신해야 합니다

Loki와 Tempo 같은 Helm 차트가 있는 서비스는 values.yaml의 `extraEnvVars`나 `env` 섹션에서 설정합니다

```yaml
# Loki values.yaml 예시
loki:
  extraEnvVars:
    - name: GOMEMLIMIT
      value: "1703m"   # 2Gi limit의 90%
```

---

## 🧩 go-ti에서는

go-ti의 관측성 스택에서 Loki와 Tempo는 모두 Go로 작성된 서비스입니다 Kind 클러스터 5노드(32 GB RAM) 환경에서 Prod Loki는 1 GiB, Prod Tempo는 2 GiB 메모리 limit으로 운영 중이었습니다

트래픽 증가 시 두 서비스가 OOM으로 반복 crash했습니다 Loki는 청크를 메모리에 장기 보유하는 구조상, 트래픽 spike 때 힙이 빠르게 증가했지만 GC는 늦게 발동했습니다 `GOMEMLIMIT`이 없는 상태에서 Go 런타임은 컨테이너 limit을 인지하지 못하고 OOM Kill 직전까지 메모리를 쓰다가 강제 종료됐습니다

이를 해결하기 위해 Loki와 Tempo 양쪽에 각각 `GOMEMLIMIT = limit의 90%`를 적용했습니다 Prod Loki(2 GiB limit, 기존 1 GiB에서 증설)는 약 1.8 GiB, Prod Tempo(2 GiB limit)도 약 1.8 GiB로 설정했습니다 이 변경 후 메모리 spike 시 GC가 한계선 근처에서 선제적으로 발동해 OOM 없이 안정화됐습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Loki/Tempo 안정성 튜닝 및 Kafka 연동 개선](/essays/goti-adr-loki-tempo-stability-tuning)에 정리했습니다

---

## 📚 핵심 정리

- Go GC(GOGC)는 힙 증가율 기반으로 동작해 절대값 상한을 보장하지 않습니다 — 컨테이너 limit을 자동으로 인지하지 못해 OOM Kill 직전까지 GC를 미룰 수 있습니다
- `GOMEMLIMIT`은 Go 1.19에서 도입된 soft limit 환경 변수로, 이 값에 힙이 근접하면 GOGC 목표와 무관하게 GC를 즉시 발동합니다
- 컨테이너 limit의 90%를 GOMEMLIMIT으로 설정하는 관행은 Go 힙 외 RSS 오버헤드(런타임, 스택, CGO 등)를 위한 10% 여유 공간을 확보하기 위함입니다
- GOMEMLIMIT은 GOGC와 독립적으로 동작하며 함께 설정하는 것이 권장됩니다 — GOGC는 평상시 빈도 조정, GOMEMLIMIT은 절대값 방어선 역할을 합니다
- 라이브 힙이 GOMEMLIMIT을 초과하는 경우 GC thrashing을 방지하기 위해 런타임이 GC CPU 사용률을 50% 이하로 제한합니다 — 이 상태면 결국 OOM이 발생하므로 limit 자체를 늘리는 것이 근본 해결책입니다
