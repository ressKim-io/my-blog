# Ress Blog — 방문자 분석 (Cloudflare Worker + D1)

블로그 본체(GitHub Pages·정적)와 **별도로** 배포되는 방문자 분석 백엔드입니다.

- 데이터 흐름: `블로그 → 비콘(sendBeacon) → Worker /collect → D1`
- 조회: `GET /stats` (비밀번호 보호 HTML 대시보드)
- 프라이버시: 쿠키 없음, IP 원본 미저장(일일 salt 해시), 알려진 봇 제외

## 구성 파일

- `worker.ts` — 수집(`/collect`) + 대시보드(`/stats`)
- `schema.sql` — D1 `pageviews` 테이블
- `wrangler.toml` — Worker·D1 바인딩·변수

## 배포 순서

모두 `analytics/` 디렉토리 안에서 실행합니다.

```bash
cd analytics
npm install                 # wrangler 설치
npx wrangler login          # 브라우저로 Cloudflare 로그인
```

로그인은 대화형이라 세션에서 직접 실행해야 합니다. 프롬프트에 `! npx wrangler login` 처럼 입력하면 편합니다.

```bash
# 1) D1 데이터베이스 생성 → 출력된 database_id 복사
npx wrangler d1 create ress-blog-analytics
```

출력에서 `database_id = "..."` 값을 `wrangler.toml`의 `PASTE_DATABASE_ID_HERE` 자리에 붙여넣습니다.

```bash
# 2) 스키마 적용 (원격 D1)
npm run db:init

# 3) 시크릿 등록 (프롬프트에 값 입력)
npx wrangler secret put DASHBOARD_PASSWORD   # /stats 로그인 비밀번호
npx wrangler secret put HASH_SALT            # 아무 긴 랜덤 문자열 (예: openssl rand -hex 32)

# 4) 배포 → 출력된 https://ress-blog-analytics.<계정>.workers.dev URL 복사
npm run deploy
```

## 블로그와 연결

배포로 나온 Worker URL을 블로그 빌드 시 `NEXT_PUBLIC_ANALYTICS_URL`로 주입합니다. GitHub Actions 워크플로의 빌드 스텝에 env로 추가하세요(값은 비밀 아님):

```yaml
      - run: npm run build
        env:
          NEXT_PUBLIC_ANALYTICS_URL: https://ress-blog-analytics.<계정>.workers.dev
```

- 컴포넌트는 이 URL 뒤에 `/collect`를 붙여 전송합니다
- env가 없으면(로컬·미설정) 비콘을 보내지 않습니다 → 안전
- `wrangler.toml`의 `ALLOWED_ORIGIN`이 블로그 origin(`https://resskim-io.github.io`)과 일치해야 합니다. GitHub 사용자명이 다르면 수정 후 재배포하세요

## 대시보드 보기

`https://ress-blog-analytics.<계정>.workers.dev/stats` 접속 → 로그인 창에서
아이디는 아무거나, 비밀번호는 `DASHBOARD_PASSWORD`로 등록한 값을 입력합니다.

## 로컬 확인 (선택)

```bash
npx wrangler dev            # 로컬에서 Worker 실행
```

`.dev.vars` 파일에 `DASHBOARD_PASSWORD`·`HASH_SALT`를 넣으면 로컬 시크릿으로 쓰입니다(이미 .gitignore 처리됨).
