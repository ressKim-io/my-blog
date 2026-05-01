import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const SITE_URL = 'https://resskim-io.github.io/my-blog';
const OUT_DIR = path.join(process.cwd(), 'out');
const CONTENT_DIR = path.join(process.cwd(), 'src/content');

// === 트랙/타입 추론 — lib/posts.ts의 inferType/inferTrack과 동기화 유지 필요 ===
const TYPE_TAGS = ['troubleshooting', 'adr', 'concept', 'retrospective'];

const TROUBLESHOOT_SLUG_PATTERNS = [
  /troubleshoot/i,
  /crashloop/i,
  /-fix(-|$)/i,
  /-bug(-|$)/i,
  /-debug(-|$)/i,
  /(^|-)error(-|$)/i,
  /-?exception(-|$)/i,
  /-?failure(-|$)/i,
  /-?timeout(-|$)/i,
  /-?missing(-|$)/i,
  /-?investigation(-|$)/i,
  /-?audit(-|$)/i,
  /-?recovery(-|$)/i,
  /-?regression(-|$)/i,
  /-?incident(-|$)/i,
  /-?outage(-|$)/i,
  /-?broken(-|$)/i,
  /(^|-)oom(-|$)/i,
  /-?deadlock(-|$)/i,
  /-?mismatch(-|$)/i,
  /-?conflict(-|$)/i,
  /-?nodata(-|$)/i,
  /-?imagepullbackoff(-|$)/i,
  /-?(40[0-9]|50[0-9])(-|$)/,
  /syntax-error/i,
  /parsing-error/i,
  /not-found/i,
  /false-negative/i,
];

function looksLikeTroubleshooting(slug, seriesName) {
  return TROUBLESHOOT_SLUG_PATTERNS.some(
    (re) => re.test(slug) || (seriesName !== undefined && re.test(seriesName)),
  );
}

function inferType(data, slug) {
  if (typeof data.type === 'string' && TYPE_TAGS.includes(data.type)) return data.type;
  if (Array.isArray(data.tags)) {
    const lowerTags = data.tags.map((tag) => String(tag).toLowerCase());
    for (const t of TYPE_TAGS) if (lowerTags.includes(t)) return t;
  }
  if (/-adr(-|$)/i.test(slug)) return 'adr';
  if (looksLikeTroubleshooting(slug, data.series?.name)) return 'troubleshooting';
  return undefined;
}

function inferTrack(type) {
  return type === 'troubleshooting' ? 'logs' : 'essays';
}

// === posts ===
function getAllPosts() {
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));
  const posts = files.map((file) => {
    const slug = file.replace(/\.md$/, '');
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const { data, content } = matter(raw);
    const type = inferType(data, slug);
    const track = inferTrack(type);
    return { slug, content, type, track, ...data };
  });
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const escapeXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// === sitemap.xml — logs 트랙은 격리 정책에 따라 제외 ===
function generateSitemap(posts) {
  const staticPages = [
    '/',
    '/essays/',
    '/projects/',
    '/about/',
    '/projects/go-ti/',
    '/projects/ai-improvement/',
  ];
  const visiblePosts = posts.filter((p) => p.track !== 'logs');
  const urls = [
    ...staticPages.map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`),
    ...visiblePosts.map(
      (p) => `  <url><loc>${SITE_URL}/${p.track}/${p.slug}/</loc><lastmod>${p.date}</lastmod></url>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}

// === robots.txt — llms.txt 위치 추가 ===
function generateRobots() {
  return `User-agent: *
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Bytespider
Disallow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

// === feed.xml — logs 트랙은 격리 정책에 따라 제외 ===
function generateFeed(posts) {
  const visiblePosts = posts.filter((p) => p.track !== 'logs');
  const recentPosts = visiblePosts.slice(0, 20);
  const items = recentPosts.map((p) => {
    const link = `${SITE_URL}/${p.track}/${p.slug}/`;
    const pubDate = new Date(p.date).toUTCString();
    return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${link}</link>
      <guid>${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(p.excerpt)}</description>
      <category>${escapeXml(p.category)}</category>
    </item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Ress Blog</title>
    <link>${SITE_URL}/</link>
    <description>Learning by doing, documenting the journey</description>
    <language>ko</language>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>`;
}

// === llms.txt — AI/LLM-friendly 사이트 인덱스 (Markdown). logs 트랙은 격리 정책에 따라 제외 ===
function generateLLMs(posts) {
  const essays = posts.filter((p) => p.track === 'essays');

  const fmtPost = (p) =>
    `- [${p.title}](${SITE_URL}/${p.track}/${p.slug}/)${p.excerpt ? `: ${p.excerpt}` : ''}`;

  return `# Ress Blog

> Learning by doing, documenting the journey

DevOps · Kubernetes · Istio · Observability 학습 과정을 정리한 기록입니다.
모든 글은 한국어로 작성됩니다.

## Site Structure

- **/essays/** — 다듬은 글 (개념·ADR·회고). 한 번 정리한 뒤 거의 고치지 않는 형태.
- **/projects/** — 장기 프로젝트의 의사결정과 회고 모음.

## Projects

- [go-ti](${SITE_URL}/projects/go-ti/): 실시간 티켓팅 시스템 — Spring Boot 모놀리스에서 출발해 Kafka·Redis·다중 클러스터로 확장
- [AI 개선](${SITE_URL}/projects/ai-improvement/): Claude Code · Skill · Agent 워크플로우

## Essays (${essays.length})

${essays.map(fmtPost).join('\n')}

## Optional

- [RSS Feed](${SITE_URL}/feed.xml)
- [Sitemap](${SITE_URL}/sitemap.xml)
- [GitHub](https://github.com/ressKim-io/my-blog)
`;
}

// === Main ===
const posts = getAllPosts();

fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), generateSitemap(posts));
fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'), generateRobots());
fs.writeFileSync(path.join(OUT_DIR, 'feed.xml'), generateFeed(posts));
fs.writeFileSync(path.join(OUT_DIR, 'llms.txt'), generateLLMs(posts));

const essaysCount = posts.filter((p) => p.track === 'essays').length;
const logsCount = posts.filter((p) => p.track === 'logs').length;

console.log(`✓ sitemap.xml (${essaysCount} posts, logs ${logsCount}편 격리 제외)`);
console.log(`✓ robots.txt`);
console.log(`✓ feed.xml (essays only, ${Math.min(essaysCount, 20)} items)`);
console.log(`✓ llms.txt (essays only: ${essaysCount}편, logs ${logsCount}편 격리 제외)`);
