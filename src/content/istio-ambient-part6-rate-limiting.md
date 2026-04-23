---
title: "Istio Ambient Part 6: EnvoyFilter 없이 Rate Limiting 구현하기"
excerpt: "Ambient Mode에서 EnvoyFilter 미지원 문제를 Redis 기반 애플리케이션 레벨 Rate Limiting으로 해결"
category: istio
tags: ["istio", "ambient-mesh", "rate-limiting", "redis", "go", "kubernetes", concept]
series:
  name: "istio-ambient"
  order: 6
date: "2025-12-25"
---

## 🎯 시작하며

Part 5에서 JWT 인증을 구현했습니다. 이번에는 Ambient Mode의 **가장 큰 제한사항 중 하나**인 EnvoyFilter 미지원 문제를 다룹니다.

### 문제 상황

| 방식 | Rate Limiting 구현 | 상태 |
|------|-------------------|------|
| **Sidecar** | EnvoyFilter + Ratelimit 서비스 | ✅ 지원 |
| **Ambient (ztunnel)** | L4만 처리, Rate Limiting 불가 | ❌ 미지원 |
| **Ambient (waypoint)** | EnvoyFilter 미지원 | ❌ 미지원 |
| **해결책** | 애플리케이션 레벨에서 직접 구현 | ✅ 선택 |

Sidecar 모드에서는 EnvoyFilter를 사용해 Envoy 프록시 레벨에서 Rate Limiting을 처리할 수 있습니다. 별도의 Ratelimit 서비스를 띄우고, EnvoyFilter로 Envoy가 요청마다 해당 서비스에 쿼리하도록 설정하면 됩니다.

하지만 Ambient Mode에서는 이 방식이 불가능합니다. ztunnel은 L4만 처리하고, waypoint는 Envoy 기반이지만 EnvoyFilter 적용을 지원하지 않습니다. 결국 Rate Limiting을 인프라가 아닌 애플리케이션 레벨에서 직접 구현해야 합니다.

---

## 💡 Rate Limiting 선택지

### 옵션 비교

| 옵션 | 장점 | 단점 | Ambient 호환 |
|------|------|------|:------------:|
| EnvoyFilter + Ratelimit | 인프라 레벨 처리 | Sidecar 전용 | ❌ |
| API Gateway (Kong 등) | 전용 솔루션, 풍부한 기능 | 추가 인프라, 비용 증가 | ✅ |
| **애플리케이션 레벨** | 유연한 커스터마이징, 최소 인프라 | 각 서비스에 구현 필요 | ✅ |

세 가지 옵션을 검토했습니다.

1. **EnvoyFilter + Ratelimit**: 가장 일반적인 Istio 방식이지만, Ambient에서는 사용할 수 없습니다.
2. **API Gateway**: Kong, APISIX 같은 API Gateway는 Rate Limiting을 기본 제공합니다. 하지만 별도 인프라가 필요하고, 이미 Istio를 사용하는데 또 다른 프록시 레이어를 추가하는 것은 복잡도를 높입니다.
3. **애플리케이션 레벨**: Redis와 미들웨어만 있으면 됩니다. 각 서비스에 구현해야 하지만, 공통 패키지로 만들면 재사용 가능합니다.

Wealist에서는 3번을 선택했습니다. Redis는 이미 사용 중이었고, Go 미들웨어로 구현하면 엔드포인트별로 다른 제한을 유연하게 적용할 수 있습니다.

---

## 🔧 아키텍처

### 전체 구조

![Rate Limiting Architecture|tall](/images/istio-ambient/ratelimit-arch.svg)

| 레이어 | 컴포넌트 | 역할 |
|--------|----------|------|
| Istio Ambient | ztunnel → waypoint | mTLS, JWT, L7 라우팅 |
| Go Service | Middleware Chain | Recovery → Logger → CORS → **RateLimit** |
| Storage | Redis | Sliding Window Counter 저장 |

트래픽 흐름을 따라가보면:

1. **Istio Ambient 레이어**: ztunnel이 mTLS를 처리하고, waypoint가 JWT 검증과 L7 라우팅을 담당합니다. 여기까지는 Istio 영역입니다.
2. **Go Service 레이어**: Gin 미들웨어 체인을 통해 요청이 처리됩니다. Recovery(패닉 복구), Logger(로깅), CORS(교차 출처) 후에 **RateLimit 미들웨어**가 실행됩니다.
3. **Redis**: RateLimit 미들웨어가 Redis에 현재 요청 수를 조회/갱신합니다. Sliding Window Counter 알고리즘으로 정확한 제한을 적용합니다.

Rate Limiting이 비즈니스 로직 전에 실행되므로, 제한 초과 시 불필요한 처리 없이 즉시 429 응답을 반환합니다.

---

## 📊 Sliding Window Counter 알고리즘

### 알고리즘 설명

**Fixed Window의 문제**

| 시간 | Window 1 끝 | Window 2 시작 | 결과 |
|------|-------------|---------------|------|
| 설정 | 100 RPM (분당 100개) | | |
| 실제 | 90 req (마지막 10초) | 90 req (처음 10초) | ❌ 경계에서 180 req 발생! |

Fixed Window는 정해진 시간 구간(예: 0-1분, 1-2분)별로 카운트합니다. 문제는 구간 경계입니다. 첫 번째 윈도우 끝에 90개, 두 번째 윈도우 시작에 90개 요청이 오면, 실제로는 20초 안에 180개 요청이 처리되는 셈입니다.

**Sliding Window의 해결**

| 항목 | 설명 |
|------|------|
| 방식 | 현재 시점 기준 "과거 1분"을 실시간 계산 |
| 장점 | 언제 요청해도 공정하게 제한 |
| 구현 | Redis ZSET (Sorted Set) 사용 |

Sliding Window는 고정된 구간이 아니라, 요청 시점을 기준으로 "과거 1분"을 계산합니다. Redis ZSET을 사용하면 효율적으로 구현할 수 있습니다:

| Redis ZSET 구조 | 설명 |
|-----------------|------|
| Score | 요청 timestamp (밀리초) |
| Member | 요청 고유 ID |
| 조회 | `ZRANGEBYSCORE`로 과거 1분간 요청 수 계산 |
| 정리 | `ZREMRANGEBYSCORE`로 오래된 항목 자동 제거 |

---

## 🛠️ 구현

### 프로젝트 구조

```
packages/wealist-advanced-go-pkg/
└── ratelimit/
    ├── config.go         # 설정
    ├── limiter.go        # 인터페이스
    ├── redis_limiter.go  # Redis 구현
    └── middleware.go     # Gin 미들웨어
```

### config.go

```go
package ratelimit

import (
    "time"
)

type Config struct {
    // 제한 설정
    RequestsPerMinute int           // 분당 요청 수
    BurstSize         int           // 버스트 허용량
    Window            time.Duration // 윈도우 크기

    // Redis 설정
    RedisAddr     string
    RedisPassword string
    RedisDB       int

    // 동작 설정
    FailOpen      bool   // Redis 실패 시 허용 여부
    KeyPrefix     string // Redis 키 접두사
}

func DefaultConfig() *Config {
    return &Config{
        RequestsPerMinute: 100,
        BurstSize:         10,
        Window:            time.Minute,
        FailOpen:          true,  // 가용성 우선
        KeyPrefix:         "ratelimit:",
    }
}
```

### limiter.go

```go
package ratelimit

import "context"

type Limiter interface {
    // Allow checks if request is allowed
    // key: 제한 기준 (IP, user ID 등)
    Allow(ctx context.Context, key string) (allowed bool, remaining int, err error)

    // Close closes the limiter
    Close() error
}

type Result struct {
    Allowed   bool
    Remaining int
    ResetAt   int64
}
```

### redis_limiter.go

```go
package ratelimit

import (
    "context"
    "fmt"
    "time"

    "github.com/go-redis/redis/v8"
)

type RedisLimiter struct {
    client *redis.Client
    config *Config
}

func NewRedisLimiter(config *Config) (*RedisLimiter, error) {
    client := redis.NewClient(&redis.Options{
        Addr:     config.RedisAddr,
        Password: config.RedisPassword,
        DB:       config.RedisDB,
    })

    // 연결 확인
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    if err := client.Ping(ctx).Err(); err != nil {
        return nil, fmt.Errorf("redis connection failed: %w", err)
    }

    return &RedisLimiter{
        client: client,
        config: config,
    }, nil
}

func (r *RedisLimiter) Allow(ctx context.Context, key string) (bool, int, error) {
    now := time.Now()
    windowStart := now.Add(-r.config.Window)

    redisKey := r.config.KeyPrefix + key

    // Lua 스크립트로 원자적 처리
    script := redis.NewScript(`
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window_start = tonumber(ARGV[2])
        local limit = tonumber(ARGV[3])
        local expire = tonumber(ARGV[4])

        -- 오래된 항목 제거
        redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

        -- 현재 카운트
        local count = redis.call('ZCARD', key)

        if count < limit then
            -- 허용: 새 요청 추가
            redis.call('ZADD', key, now, now .. '-' .. math.random())
            redis.call('EXPIRE', key, expire)
            return {1, limit - count - 1}
        else
            -- 거부
            return {0, 0}
        end
    `)

    result, err := script.Run(ctx, r.client, []string{redisKey},
        now.UnixMilli(),
        windowStart.UnixMilli(),
        r.config.RequestsPerMinute,
        int(r.config.Window.Seconds())+1,
    ).Result()

    if err != nil {
        // Fail-open: Redis 실패 시 허용
        if r.config.FailOpen {
            return true, r.config.RequestsPerMinute, nil
        }
        return false, 0, err
    }

    values := result.([]interface{})
    allowed := values[0].(int64) == 1
    remaining := int(values[1].(int64))

    return allowed, remaining, nil
}

func (r *RedisLimiter) Close() error {
    return r.client.Close()
}
```

### middleware.go

```go
package ratelimit

import (
    "net/http"
    "strconv"

    "github.com/gin-gonic/gin"
)

// Middleware creates a Gin rate limiting middleware
func Middleware(limiter Limiter, keyFunc func(*gin.Context) string) gin.HandlerFunc {
    return func(c *gin.Context) {
        // 키 생성 (IP, User ID 등)
        key := keyFunc(c)

        allowed, remaining, err := limiter.Allow(c.Request.Context(), key)

        // 헤더 설정
        c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))

        if err != nil {
            // 에러 로깅
            c.Next()
            return
        }

        if !allowed {
            c.Header("Retry-After", "60")
            c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
                "error":   "rate limit exceeded",
                "message": "Too many requests. Please try again later.",
            })
            return
        }

        c.Next()
    }
}

// IPKeyFunc extracts client IP for rate limiting
func IPKeyFunc(c *gin.Context) string {
    // X-Forwarded-For 또는 실제 IP
    ip := c.GetHeader("X-Forwarded-For")
    if ip == "" {
        ip = c.ClientIP()
    }
    return "ip:" + ip
}

// UserKeyFunc extracts user ID from JWT for rate limiting
func UserKeyFunc(c *gin.Context) string {
    // JWT에서 추출한 user ID (미들웨어에서 설정)
    userID := c.GetString("userID")
    if userID == "" {
        return IPKeyFunc(c) // fallback to IP
    }
    return "user:" + userID
}
```

---

## 🔧 사용 예시

### 서비스에 적용

```go
package main

import (
    "log"
    "os"

    "github.com/gin-gonic/gin"
    "github.com/wealist/wealist-advanced-go-pkg/ratelimit"
)

func main() {
    // Rate Limiter 설정
    config := ratelimit.DefaultConfig()
    config.RedisAddr = os.Getenv("REDIS_ADDR")
    config.RequestsPerMinute = 100
    config.FailOpen = true  // Redis 장애 시에도 서비스 동작

    limiter, err := ratelimit.NewRedisLimiter(config)
    if err != nil {
        log.Fatalf("Failed to create limiter: %v", err)
    }
    defer limiter.Close()

    // Gin 라우터
    r := gin.Default()

    // 미들웨어 순서: Recovery → Logger → CORS → RateLimit
    r.Use(gin.Recovery())
    r.Use(gin.Logger())
    r.Use(corsMiddleware())
    r.Use(ratelimit.Middleware(limiter, ratelimit.IPKeyFunc))

    // 라우트
    r.GET("/api/products", getProducts)
    r.POST("/api/orders", createOrder)

    r.Run(":8080")
}
```

### 엔드포인트별 다른 제한

```go
// 엔드포인트별 다른 제한 설정
func setupRoutes(r *gin.Engine) {
    // 일반 API: 100 RPM
    api := r.Group("/api")
    api.Use(ratelimit.Middleware(generalLimiter, ratelimit.IPKeyFunc))
    {
        api.GET("/products", getProducts)
        api.GET("/users/:id", getUser)
    }

    // 인증 API: 10 RPM (브루트포스 방지)
    auth := r.Group("/auth")
    auth.Use(ratelimit.Middleware(authLimiter, ratelimit.IPKeyFunc))
    {
        auth.POST("/login", login)
        auth.POST("/register", register)
    }

    // 검색 API: 30 RPM
    search := r.Group("/search")
    search.Use(ratelimit.Middleware(searchLimiter, ratelimit.UserKeyFunc))
    {
        search.GET("/", searchProducts)
    }
}
```

---

## 📊 Fail-Open 패턴

### 가용성 우선

| Redis 상태 | Fail-Open = true | Fail-Open = false |
|------------|------------------|-------------------|
| 정상 | 정상 체크 → 허용/거부 | 정상 체크 → 허용/거부 |
| 장애 | ✅ **허용** (가용성 우선) | ❌ **거부** (보안 우선) |

Fail-Open은 Redis 장애 시 어떻게 동작할지 결정하는 패턴입니다.

**Fail-Open = true (기본값, 권장)**

Redis에 연결할 수 없을 때 요청을 허용합니다. Rate Limiting은 보호 기능이지 핵심 기능이 아닙니다. Redis 장애 때문에 서비스 전체가 멈추는 것은 과도한 대응입니다. 잠시 제한 없이 동작해도 대부분의 경우 괜찮습니다.

**Fail-Open = false (특수 케이스)**

Redis 장애 시 요청을 거부합니다. 다음과 같은 경우에 사용합니다:
- **결제 API**: 악용 방지가 가용성보다 중요
- **인증 API**: 브루트포스 공격 방지가 필수
- **보안 민감 엔드포인트**: 제한 없는 접근이 위험한 경우

| 사용 케이스 | Fail-Open 설정 | 이유 |
|-------------|---------------|------|
| 일반 API | `true` | 가용성 우선 |
| 결제 API | `false` | 악용 방지 중요 |
| 인증 API | `false` | 브루트포스 방지 |

---

## 🧪 테스트

### 단위 테스트

```go
func TestRateLimiter(t *testing.T) {
    config := &ratelimit.Config{
        RequestsPerMinute: 10,
        Window:            time.Minute,
        RedisAddr:         "localhost:6379",
        FailOpen:          false,
    }

    limiter, err := ratelimit.NewRedisLimiter(config)
    require.NoError(t, err)
    defer limiter.Close()

    ctx := context.Background()
    key := "test-user"

    // 10번 허용
    for i := 0; i < 10; i++ {
        allowed, _, err := limiter.Allow(ctx, key)
        require.NoError(t, err)
        assert.True(t, allowed)
    }

    // 11번째는 거부
    allowed, _, err := limiter.Allow(ctx, key)
    require.NoError(t, err)
    assert.False(t, allowed)
}
```

### 부하 테스트

```bash
# wrk로 테스트
$ wrk -t12 -c400 -d30s http://localhost:8080/api/products

# 결과 확인
# - 429 응답 비율
# - X-RateLimit-Remaining 헤더
```

---

## 📈 모니터링

### 메트릭 추가

```go
var (
    rateLimitAllowed = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "ratelimit_requests_allowed_total",
            Help: "Total allowed requests",
        },
        []string{"key"},
    )

    rateLimitDenied = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "ratelimit_requests_denied_total",
            Help: "Total denied requests",
        },
        []string{"key"},
    )
)
```

---

## 📚 정리

### 왜 애플리케이션 레벨인가?

| 문제 | 설명 |
|------|------|
| EnvoyFilter 미지원 | Ambient Mode에서 사용 불가 |
| 인프라 레벨 불가 | ztunnel/waypoint에서 Rate Limiting 기능 없음 |

### 구현 방식

| 항목 | 선택 |
|------|------|
| 알고리즘 | Sliding Window Counter |
| 저장소 | Redis ZSET |
| 프레임워크 | Go/Gin 미들웨어 |
| 장애 대응 | Fail-Open 패턴 (가용성 우선) |

### 장점과 단점

| 장점 | 단점 |
|------|------|
| Ambient 호환 | 각 서비스에 구현 필요 |
| 유연한 커스터마이징 | Redis 의존성 |
| 엔드포인트별 다른 제한 | |
| 사용자 기반 제한 가능 | |

애플리케이션 레벨 Rate Limiting은 Ambient Mode의 EnvoyFilter 미지원이라는 제약을 우회하는 실용적인 해결책입니다. 공통 패키지로 만들어두면 새 서비스에도 쉽게 적용할 수 있고, 비즈니스 로직과 통합된 세밀한 제어가 가능합니다.

단점인 "각 서비스에 구현 필요"는 공통 Go 패키지로 해결했습니다. 새 서비스에서는 미들웨어만 추가하면 됩니다.

---

## 🎯 핵심 정리

| 항목 | 설명 |
|------|------|
| **알고리즘** | Sliding Window Counter |
| **저장소** | Redis ZSET |
| **구현** | Go/Gin 미들웨어 |
| **Fail-Open** | Redis 장애 시 허용 (가용성 우선) |
| **키** | IP 또는 User ID 기반 |

Ambient Mode에서 EnvoyFilter가 미지원되어 인프라 레벨 Rate Limiting이 불가능하지만, 애플리케이션 레벨에서 충분히 대체할 수 있습니다.

핵심 구현 요소는 세 가지입니다. 첫째, Sliding Window Counter 알고리즘으로 공정한 제한을 적용합니다. Fixed Window의 경계 문제를 해결하고, 언제 요청하든 동일한 기준으로 제한됩니다. 둘째, Redis ZSET(Sorted Set)을 저장소로 사용해 효율적인 카운팅과 자동 만료 처리가 가능합니다. 셋째, Gin 미들웨어로 구현해 요청 처리 체인에 자연스럽게 통합됩니다.

Fail-Open 패턴은 중요한 설계 결정입니다. Redis 장애 시 Rate Limiting 없이 요청을 허용함으로써 가용성을 우선합니다. 결제나 인증 같은 보안 민감 엔드포인트에서는 Fail-Open을 false로 설정해 보안을 우선할 수 있습니다.

이 구현을 공통 Go 패키지로 만들어두면, 새 서비스에서는 미들웨어만 추가하면 됩니다. EnvoyFilter를 사용할 수 없다는 제약이 오히려 더 유연하고 비즈니스 친화적인 Rate Limiting을 구현할 기회가 되었습니다.

---

## 🔗 다음 편 예고

Part 7에서는 **Istio vs Linkerd vs Cilium: Service Mesh 비교**를 다룹니다:
- 각 솔루션의 철학
- 리소스 사용량 비교
- 선택 기준

---

## 🔗 참고 자료

- [Redis Rate Limiting](https://redis.io/glossary/rate-limiting/)
- [Sliding Window Algorithm](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)
- [Go Redis Client](https://github.com/go-redis/redis)
