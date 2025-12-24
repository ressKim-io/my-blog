---
title: "Istio Ambient Part 6: EnvoyFilter 없이 Rate Limiting 구현하기"
excerpt: "Ambient Mode에서 EnvoyFilter 미지원 문제를 Redis 기반 애플리케이션 레벨 Rate Limiting으로 해결"
category: "kubernetes"
tags: ["istio", "ambient-mesh", "rate-limiting", "redis", "go", "kubernetes"]
series:
  name: "istio-ambient"
  order: 6
date: "2024-12-24"
---

## 🎯 시작하며

Part 5에서 JWT 인증을 구현했습니다. 이번에는 Ambient Mode의 **가장 큰 제한사항 중 하나**인 EnvoyFilter 미지원 문제를 다룹니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    문제 상황                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Sidecar 방식의 Rate Limiting:                                 │
│   ══════════════════════════════                                │
│                                                                 │
│   EnvoyFilter + Ratelimit 서비스                                │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐                   │
│   │ Client  │────▶│  Envoy  │────▶│  App    │                   │
│   │         │     │(Sidecar)│     │         │                   │
│   └─────────┘     └────┬────┘     └─────────┘                   │
│                        │                                        │
│                        ▼                                        │
│                   ┌─────────┐                                   │
│                   │Ratelimit│                                   │
│                   │ Service │                                   │
│                   └─────────┘                                   │
│                                                                 │
│   Ambient 방식:                                                 │
│   ═════════════                                                 │
│                                                                 │
│   ❌ EnvoyFilter 미지원                                         │
│   ❌ ztunnel에서 Rate Limiting 불가                             │
│   ❌ waypoint에서도 EnvoyFilter 미지원                          │
│                                                                 │
│   ✅ 해결: 애플리케이션 레벨에서 구현                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💡 Rate Limiting 선택지

### 옵션 비교

```
┌─────────────────────────────────────────────────────────────────┐
│              Rate Limiting 구현 옵션                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. EnvoyFilter + Ratelimit (Sidecar)                          │
│      ════════════════════════════════                           │
│      ✅ 인프라 레벨 처리                                        │
│      ❌ Ambient에서 미지원                                      │
│                                                                 │
│   2. API Gateway (Kong, APISIX 등)                              │
│      ════════════════════════════════                           │
│      ✅ 전용 솔루션                                             │
│      ❌ 추가 인프라 필요                                        │
│      ❌ 비용 증가                                               │
│                                                                 │
│   3. 애플리케이션 레벨 (미들웨어)                               │
│      ════════════════════════════════                           │
│      ✅ Ambient 호환                                            │
│      ✅ 유연한 커스터마이징                                     │
│      ✅ 추가 인프라 최소화 (Redis만)                            │
│      ⚠️ 각 서비스에 구현 필요                                   │
│                                                                 │
│   선택: 3번 (Go + Redis)                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 아키텍처

### 전체 구조

```
┌─────────────────────────────────────────────────────────────────┐
│              Rate Limiting 아키텍처                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   Istio Ambient                         │   │
│   │                                                         │   │
│   │   ztunnel ──▶ waypoint (L7)                             │   │
│   │     │          │                                        │   │
│   │     │          │ mTLS, JWT, 라우팅                      │   │
│   │     │          │                                        │   │
│   └─────┼──────────┼────────────────────────────────────────┘   │
│         │          │                                            │
│         ▼          ▼                                            │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              Go Service (Gin)                           │   │
│   │                                                         │   │
│   │   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│   │   │Recovery │→│ Logger  │→│  CORS   │→│ RateLimit   │   │   │
│   │   │         │ │         │ │         │ │ Middleware  │   │   │
│   │   └─────────┘ └─────────┘ └─────────┘ └──────┬──────┘   │   │
│   │                                              │          │   │
│   │                                              ▼          │   │
│   │   ┌─────────────────────────────────────────────────┐   │   │
│   │   │              비즈니스 로직                      │   │   │
│   │   └─────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────┘   │
│                          │                                      │
│                          ▼                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                     Redis                               │   │
│   │              (Sliding Window Counter)                   │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Sliding Window Counter 알고리즘

### 알고리즘 설명

```
┌─────────────────────────────────────────────────────────────────┐
│            Sliding Window Counter                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Fixed Window 문제:                                            │
│   ═══════════════════                                           │
│                                                                 │
│   설정: 100 RPM (분당 100개)                                    │
│                                                                 │
│   Window 1         │ Window 2                                   │
│   [──────────────]│[──────────────]                            │
│          90 req   │  90 req                                     │
│              ↑ 경계에서 180 req! (위반)                         │
│                                                                 │
│   Sliding Window 해결:                                          │
│   ═══════════════════                                           │
│                                                                 │
│   시간 ──────────────────────────────▶                          │
│   │          Sliding Window (1분)    │                          │
│   │◀────────────────────────────────▶│                          │
│   │                                  │                          │
│   과거 1분간의 요청 수를 실시간 계산                            │
│   언제 요청해도 공정하게 제한                                   │
│                                                                 │
│   Redis ZSET 사용:                                              │
│   ═══════════════                                               │
│   • Score: timestamp (밀리초)                                   │
│   • Member: 요청 ID (unique)                                    │
│   • 범위 쿼리로 과거 1분간 요청 수 계산                         │
│   • 오래된 항목 자동 정리                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

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

```
┌─────────────────────────────────────────────────────────────────┐
│                    Fail-Open 패턴                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Redis 정상:                                                   │
│   ═══════════                                                   │
│   요청 → Rate Limiter → Redis 체크 → 허용/거부                  │
│                                                                 │
│   Redis 장애 (Fail-Open = true):                                │
│   ═══════════════════════════════                               │
│   요청 → Rate Limiter → Redis 실패 → ✅ 허용!                   │
│                                                                 │
│   이유:                                                         │
│   • Rate Limiting은 보호 기능이지 핵심 기능 아님                │
│   • Redis 장애로 서비스 전체 중단은 과도함                      │
│   • 잠시 제한 없이 동작해도 괜찮음                              │
│   • 가용성 > 엄격한 제한                                        │
│                                                                 │
│   Redis 장애 (Fail-Open = false):                               │
│   ════════════════════════════════                              │
│   요청 → Rate Limiter → Redis 실패 → ❌ 거부                    │
│                                                                 │
│   사용 케이스:                                                  │
│   • 결제 API (악용 방지 중요)                                   │
│   • 보안이 가용성보다 중요한 경우                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

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

```
┌─────────────────────────────────────────────────────────────────┐
│              애플리케이션 레벨 Rate Limiting                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   왜 필요?                                                      │
│   ═══════                                                       │
│   • Ambient Mode에서 EnvoyFilter 미지원                         │
│   • 인프라 레벨 Rate Limiting 불가                              │
│                                                                 │
│   구현 방식                                                     │
│   ═══════════                                                   │
│   • Redis ZSET + Sliding Window Counter                         │
│   • Gin 미들웨어                                                │
│   • Fail-Open 패턴 (가용성 우선)                                │
│                                                                 │
│   장점                                                          │
│   ═════                                                         │
│   • Ambient 호환                                                │
│   • 유연한 커스터마이징                                         │
│   • 엔드포인트별 다른 제한                                      │
│   • 사용자 기반 제한 가능                                       │
│                                                                 │
│   단점                                                          │
│   ═════                                                         │
│   • 각 서비스에 구현 필요                                       │
│   • Redis 의존성                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 핵심 정리

| 항목 | 설명 |
|------|------|
| **알고리즘** | Sliding Window Counter |
| **저장소** | Redis ZSET |
| **구현** | Go/Gin 미들웨어 |
| **Fail-Open** | Redis 장애 시 허용 (가용성 우선) |
| **키** | IP 또는 User ID 기반 |

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
