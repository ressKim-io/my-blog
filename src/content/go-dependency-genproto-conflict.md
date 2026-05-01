---
title: "Go 의존성 지옥: genproto ambiguous import 해결"
excerpt: "grpc-gateway v1과 v2가 공존할 때 발생하는 genproto 충돌을 exclude 블록으로 해결하는 방법"
category: challenge
tags:
  - Go
  - gRPC
  - Dependency
  - Troubleshooting
date: '2025-12-31'
---

## 한 줄 요약

> `ambiguous import: found package in multiple modules` 에러는 Go 의존성 체인에서 같은 패키지가 두 모듈에서 제공될 때 발생합니다. `exclude` 블록으로 구버전을 차단해야 합니다.

## Impact

- **영향 범위**: board-service CI 빌드
- **증상**: PR 머지 불가
- **소요 시간**: 약 4시간
- **발생일**: 2025-12-31

---

## 🔥 증상: CI 빌드 실패

### 에러 메시지

```bash
go: downloading google.golang.org/genproto v0.0.0-20210310155132-4ce2db91004e

/go/pkg/mod/github.com/grpc-ecosystem/grpc-gateway/v2@v2.23.0/runtime/handler.go:13:2:
ambiguous import: found package google.golang.org/genproto/googleapis/api/httpbody in multiple modules:
    google.golang.org/genproto v0.0.0-20210310155132-4ce2db91004e
    google.golang.org/genproto/googleapis/api v0.0.0-20241104194629-dd2ea8efbc28
```

**핵심**: 같은 패키지(`googleapis/api/httpbody`)가 두 모듈에서 발견됨.

---

## 🤔 원인: genproto 패키지 분리

### Google의 genproto 분리

2021년경 Google은 `genproto`를 monolithic 패키지에서 submodule로 분리했습니다:

| 구조 | 모듈 경로 | 포함 패키지 |
|------|----------|------------|
| 구버전 (monolithic) | `google.golang.org/genproto` | 모든 googleapis |
| 신버전 (분리) | `google.golang.org/genproto/googleapis/api` | api 관련만 |
| 신버전 (분리) | `google.golang.org/genproto/googleapis/rpc` | rpc 관련만 |

**문제**: 두 버전이 동시에 존재하면 동일 패키지가 두 곳에서 발견되어 `ambiguous import` 발생.

### board-service 의존성 체인 분석

```text
gopter v0.2.11 (property-based testing)
  └── goconvey v1.8.1
      └── gopherjs v1.17.2
          └── cobra v1.2.1
              └── viper v1.8.1
                  └── crypt v0.0.4
                      └── etcd/api v3.5.0
                          └── grpc-gateway v1.16.0  ← 범인!
                              └── genproto v0.0.0-20200513103714 (구버전)
```

**동시에 common package에서:**
```text
wealist-advanced-go-pkg
  └── grpc-gateway/v2 v2.23.0
      └── genproto/googleapis/api v0.0.0-20241104 (신버전)
```

grpc-gateway **v1**과 **v2**가 공존하면서 구/신 genproto가 충돌!

---

## 진단 명령어

```bash
cd services/board-service

# genproto를 가져오는 패키지 확인
go mod graph | grep genproto

# grpc-gateway v1 사용 여부 확인
go mod graph | grep "grpc-gateway" | grep -v "v2"

# 전체 의존성 체인 추적
go mod graph | grep "gopter"
go mod graph | grep "etcd"
```

---

## ✅ 해결: exclude 블록 + 문제 의존성 제거

### Step 1: gopter 의존성 제거

property test를 임시 비활성화합니다:

```bash
# go.mod에서 gopter 제거
# github.com/leanovate/gopter v0.2.11  # 삭제

# property test 파일들 이동
mkdir -p internal/service/property_tests_disabled
mv internal/service/*property*.go internal/service/property_tests_disabled/

# 파일 확장자 변경 (Go가 파싱하지 않도록)
cd internal/service/property_tests_disabled
for f in *.go; do mv "$f" "${f%.go}.go.disabled"; done
```

### Step 2: go.mod에 exclude 블록 추가

구버전 genproto와 grpc-gateway v1을 명시적으로 제외합니다:

```go
// go.mod

// Exclude old genproto to avoid ambiguous import errors
// Root cause: gopter → goconvey → gopherjs → cobra → viper → crypt → etcd → grpc-gateway v1 → old genproto
exclude (
    // Exclude grpc-gateway v1 (the direct source of old genproto)
    github.com/grpc-ecosystem/grpc-gateway v1.16.0

    // Exclude all old genproto versions that conflict with googleapis/api submodule
    google.golang.org/genproto v0.0.0-20210602131652-f16073e35f0c
    google.golang.org/genproto v0.0.0-20210402141018-6c239bbf2bb1
    google.golang.org/genproto v0.0.0-20210319143718-93e7006c17a6
    google.golang.org/genproto v0.0.0-20210310155132-4ce2db91004e
    google.golang.org/genproto v0.0.0-20200825200019-8632dd797987
    google.golang.org/genproto v0.0.0-20200806141610-86f49bd18e98
    google.golang.org/genproto v0.0.0-20200526211855-cb27e3aa2013
    google.golang.org/genproto v0.0.0-20200513103714-09dca8ec2884
    google.golang.org/genproto v0.0.0-20200423170343-7949de9c1215
    google.golang.org/genproto v0.0.0-20200115191322-ca5a22157cba
    google.golang.org/genproto v0.0.0-20191108220845-16a3f7862a1a
    google.golang.org/genproto v0.0.0-20190911173649-1774047e7e51
    google.golang.org/genproto v0.0.0-20190819201941-24fa4b261c55
    google.golang.org/genproto v0.0.0-20190801165951-fa694d86fc64
    google.golang.org/genproto v0.0.0-20190502173448-54afdca5d873
    google.golang.org/genproto v0.0.0-20190425155659-357c62f0e4bb
    google.golang.org/genproto v0.0.0-20190418145605-e7d98fc518a7
    google.golang.org/genproto v0.0.0-20190307195333-5fe7a883aa19
    google.golang.org/genproto v0.0.0-20180817151627-c66870c02cf8
)
```

### Step 3: 의존성 정리

```bash
go mod tidy
```

---

## 검증

```bash
cd services/board-service

# go.work로 빌드 테스트 (로컬)
cd ../.. && go build ./services/board-service/cmd/api
# 성공 시 출력 없음

# CI 환경 시뮬레이션 (GOWORK=off)
cd services/board-service
echo 'replace github.com/OrangesCloud/wealist-advanced-go-pkg => ../../packages/wealist-advanced-go-pkg' >> go.mod
GOWORK=off go mod tidy
GOWORK=off go build ./cmd/api
# 성공 시 출력 없음

# 테스트 실행
go test ./...
```

---

## 📚 배운 점

### 왜 board-service만 문제였나?

다른 Go 서비스는 gopter를 사용하지 않았습니다:

```bash
for svc in user chat noti storage video; do
  grep -l "gopter" services/$svc-service/go.mod 2>/dev/null || echo "$svc: not using gopter"
done
# 모두 "not using gopter" 출력
```

board-service만 property-based testing을 위해 gopter를 사용했고, 이것이 유일한 grpc-gateway v1 의존성 경로였습니다.

### exclude vs replace

| 지시어 | 용도 | 예시 |
|--------|------|------|
| `exclude` | 특정 버전 완전 차단 | 충돌하는 구버전 제거 |
| `replace` | 다른 버전/경로로 대체 | 로컬 개발, 포크 사용 |

**주의**: `exclude`는 간접 의존성에도 적용되지만, 해당 버전을 필요로 하는 의존성이 대체 버전을 찾지 못하면 빌드 실패할 수 있습니다.

### 의존성 분석 팁

```bash
# 특정 패키지가 왜 들어왔는지 추적
go mod graph | grep "package-name"

# 전체 의존성 트리 시각화
go mod graph | dot -Tpng -o deps.png  # graphviz 필요

# 의존성 이유 확인
go mod why -m google.golang.org/genproto
```

---

## 요약

| 문제 | 원인 | 해결 |
|------|------|------|
| `ambiguous import` | grpc-gateway v1/v2 공존 | gopter 제거 + exclude 블록 |
| genproto 충돌 | 구/신 버전 혼재 | 구버전 exclude |

---

## 관련 파일

| 파일 | 변경 내용 |
|------|----------|
| `services/board-service/go.mod` | gopter 제거, exclude 블록 추가 |
| `services/board-service/go.sum` | 의존성 업데이트 |
| `services/board-service/internal/service/property_tests_disabled/` | 테스트 파일 이동 |

---

## 참고

- [Go Modules - exclude directive](https://go.dev/ref/mod#go-mod-file-exclude)
- [google.golang.org/genproto 분리 히스토리](https://github.com/googleapis/go-genproto)
- [grpc-gateway v1 → v2 마이그레이션](https://grpc-ecosystem.github.io/grpc-gateway/docs/mapping/customizing_your_gateway/)
