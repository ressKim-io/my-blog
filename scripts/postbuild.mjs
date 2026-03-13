import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const SITE_URL = 'https://resskim-io.github.io/my-blog';
const OUT_DIR = path.join(process.cwd(), 'out');
const CONTENT_DIR = path.join(process.cwd(), 'src/content');

// Read and sort all posts by date (newest first)
function getAllPosts() {
  const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.md'));
  const posts = files.map(file => {
    const slug = file.replace(/\.md$/, '');
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const { data } = matter(raw);
    return { slug, ...data };
  });
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// --- sitemap.xml ---
function generateSitemap(posts) {
  const staticPages = ['/', '/blog/'];
  const urls = [
    ...staticPages.map(p => `  <url><loc>${SITE_URL}${p}</loc></url>`),
    ...posts.map(p => `  <url><loc>${SITE_URL}/blog/${p.slug}/</loc><lastmod>${p.date}</lastmod></url>`),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}

// --- robots.txt ---
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

// --- feed.xml (RSS 2.0) ---
function generateFeed(posts) {
  const escapeXml = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const recentPosts = posts.slice(0, 20);
  const items = recentPosts.map(p => {
    const link = `${SITE_URL}/blog/${p.slug}/`;
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

// --- Main ---
const posts = getAllPosts();

fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), generateSitemap(posts));
fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'), generateRobots());
fs.writeFileSync(path.join(OUT_DIR, 'feed.xml'), generateFeed(posts));

console.log(`✓ sitemap.xml (${posts.length} posts)`);
console.log(`✓ robots.txt`);
console.log(`✓ feed.xml (${Math.min(posts.length, 20)} items)`);
