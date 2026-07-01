-- Ress Blog 방문자 분석 D1 스키마
-- 적용: npx wrangler d1 execute ress-blog-analytics --remote --file schema.sql
CREATE TABLE IF NOT EXISTS pageviews (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,              -- 수집 시각 (unix ms)
  path     TEXT    NOT NULL,              -- 논리 경로 (/essays/xxx/)
  referrer TEXT    NOT NULL DEFAULT '',   -- 외부 유입 호스트만 (내부/직접은 '')
  country  TEXT    NOT NULL DEFAULT 'XX', -- CF edge 국가코드
  device   TEXT    NOT NULL DEFAULT '',   -- mobile | desktop
  session  TEXT    NOT NULL DEFAULT ''    -- 일일 salt 해시 (IP 원본 저장 안 함)
);
CREATE INDEX IF NOT EXISTS idx_pageviews_ts   ON pageviews(ts);
CREATE INDEX IF NOT EXISTS idx_pageviews_path ON pageviews(path);
