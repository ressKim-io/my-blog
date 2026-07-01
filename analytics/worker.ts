/**
 * Ress Blog — 방문자 분석 Worker
 *
 *   POST /collect : 블로그가 보낸 페이지뷰 비콘을 D1에 적재
 *   GET  /stats   : 비밀번호(Basic auth)로 보호된 집계 대시보드(HTML)
 *
 * 프라이버시: 쿠키 없음, IP 원본 미저장(일일 salt 해시만), 알려진 봇 제외.
 */

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;     // wrangler.toml [vars]
  DASHBOARD_PASSWORD: string; // wrangler secret
  HASH_SALT: string;          // wrangler secret
}

const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pagespeed|gptbot|ccbot|claudebot|anthropic|bytespider|preview|scanner|monitor/i;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (url.pathname === '/collect' && request.method === 'POST') return collect(request, env);
    if (url.pathname === '/stats' && request.method === 'GET') return stats(request, env);
    return new Response('Not found', { status: 404 });
  },
};

function cors(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

// ---- 수집 ----

async function collect(request: Request, env: Env): Promise<Response> {
  const headers = cors(env);
  const ua = request.headers.get('user-agent') ?? '';
  if (BOT_RE.test(ua)) return new Response(null, { status: 204, headers });

  let path = '';
  let referrer = '';
  try {
    const data = JSON.parse(await request.text()) as { p?: unknown; r?: unknown };
    if (typeof data.p === 'string') path = data.p.slice(0, 512);
    if (typeof data.r === 'string') referrer = data.r.slice(0, 512);
  } catch {
    return new Response(null, { status: 204, headers });
  }
  if (!path.startsWith('/')) return new Response(null, { status: 204, headers });

  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const country = ((request as unknown as { cf?: { country?: string } }).cf?.country) ?? 'XX';
  const device = /mobile|android|iphone|ipad|ipod/i.test(ua) ? 'mobile' : 'desktop';
  const session = await dailyHash(ip, ua, env.HASH_SALT);
  const ref = refHost(referrer, env.ALLOWED_ORIGIN);

  try {
    await env.DB.prepare(
      'INSERT INTO pageviews (ts, path, referrer, country, device, session) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(Date.now(), path, ref, country, device, session)
      .run();
  } catch {
    // 적재 실패해도 방문자 경험엔 영향 없도록 조용히 204
  }
  return new Response(null, { status: 204, headers });
}

// IP 원본을 저장하지 않기 위해 (IP + UA + salt + 날짜)를 해시. 날짜가 바뀌면
// 해시도 바뀌어 하루 단위 순 방문 추정만 가능하고 개인 식별은 불가능하다.
async function dailyHash(ip: string, ua: string, salt: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const buf = new TextEncoder().encode(`${ip}|${ua}|${salt}|${day}`);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 외부 유입 호스트만 남긴다(내부 이동·직접 방문은 '').
function refHost(ref: string, allowedOrigin: string): string {
  if (!ref) return '';
  try {
    const host = new URL(ref).hostname;
    let selfHost = '';
    try {
      selfHost = new URL(allowedOrigin).hostname;
    } catch {
      /* noop */
    }
    return host && host !== selfHost ? host : '';
  } catch {
    return '';
  }
}

// ---- 대시보드 ----

async function stats(request: Request, env: Env): Promise<Response> {
  if (!authed(request, env)) {
    return new Response('Auth required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Ress Blog Analytics"' },
    });
  }
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS views, COUNT(DISTINCT session) AS uniques FROM pageviews WHERE ts >= ?',
  )
    .bind(since)
    .first<{ views: number; uniques: number }>();

  const byDay = await env.DB.prepare(
    "SELECT date(ts/1000, 'unixepoch') AS d, COUNT(*) AS v FROM pageviews WHERE ts >= ? GROUP BY d ORDER BY d",
  )
    .bind(since)
    .all<{ d: string; v: number }>();

  const topPaths = await env.DB.prepare(
    'SELECT path, COUNT(*) AS v FROM pageviews WHERE ts >= ? GROUP BY path ORDER BY v DESC LIMIT 20',
  )
    .bind(since)
    .all<{ path: string; v: number }>();

  const topRef = await env.DB.prepare(
    "SELECT referrer, COUNT(*) AS v FROM pageviews WHERE ts >= ? AND referrer != '' GROUP BY referrer ORDER BY v DESC LIMIT 10",
  )
    .bind(since)
    .all<{ referrer: string; v: number }>();

  const topCountry = await env.DB.prepare(
    'SELECT country, COUNT(*) AS v FROM pageviews WHERE ts >= ? GROUP BY country ORDER BY v DESC LIMIT 10',
  )
    .bind(since)
    .all<{ country: string; v: number }>();

  const html = render(
    totals,
    byDay.results ?? [],
    topPaths.results ?? [],
    topRef.results ?? [],
    topCountry.results ?? [],
  );
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function authed(request: Request, env: Env): boolean {
  const h = request.headers.get('Authorization') ?? '';
  if (!h.startsWith('Basic ')) return false;
  try {
    const decoded = atob(h.slice(6));
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    return !!env.DASHBOARD_PASSWORD && pass === env.DASHBOARD_PASSWORD;
  } catch {
    return false;
  }
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function bars(rows: { label: string; v: number }[]): string {
  const max = rows.reduce((m, r) => Math.max(m, r.v), 1);
  return (
    rows
      .map((r) => {
        const pct = Math.round((r.v / max) * 100);
        return `<div class="row"><span class="lbl">${esc(r.label || '(direct)')}</span><span class="bar" style="width:${pct}%"></span><span class="val">${r.v}</span></div>`;
      })
      .join('') || '<p class="muted">데이터 없음</p>'
  );
}

function render(
  totals: { views: number; uniques: number } | null,
  byDay: { d: string; v: number }[],
  paths: { path: string; v: number }[],
  refs: { referrer: string; v: number }[],
  countries: { country: string; v: number }[],
): string {
  const t = totals ?? { views: 0, uniques: 0 };
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Ress Blog — Analytics</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 860px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; color: #7C3AED; }
  .totals { display: flex; gap: 16px; margin: 16px 0; }
  .card { background: #7C3AED; color: #fff; border-radius: 10px; padding: 14px 20px; }
  .card b { display: block; font-size: 26px; }
  .row { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
  .lbl { flex: 0 0 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .bar { height: 14px; min-width: 2px; background: #7C3AED; border-radius: 3px; opacity: .7; }
  .val { margin-left: auto; font-variant-numeric: tabular-nums; color: #888; }
  .muted { color: #999; font-size: 12px; }
</style></head><body>
<h1>Ress Blog — 방문자 분석</h1>
<p class="muted">최근 30일 · 쿠키 없음 · IP 원본 미저장</p>
<div class="totals">
  <div class="card"><b>${t.views}</b>페이지뷰</div>
  <div class="card"><b>${t.uniques}</b>순 방문(추정)</div>
</div>
<h2>일별 페이지뷰</h2>${bars(byDay.map((r) => ({ label: r.d, v: r.v })))}
<h2>인기 페이지</h2>${bars(paths.map((r) => ({ label: r.path, v: r.v })))}
<h2>유입 경로</h2>${bars(refs.map((r) => ({ label: r.referrer, v: r.v })))}
<h2>국가</h2>${bars(countries.map((r) => ({ label: r.country, v: r.v })))}
</body></html>`;
}
