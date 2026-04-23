#!/usr/bin/env node
// 196편 전수 메타데이터 + 신호(글자수, 코드비중, 서사 키워드) 추출
// 실행: node .claude/plans/audit/scripts/extract-inventory.js
// 출력: .claude/plans/audit/inventory.json + inventory.md

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const ROOT = path.resolve(__dirname, '../../../../');
const CONTENT_DIR = path.join(ROOT, 'src/content');
const OUT_DIR = path.resolve(__dirname, '..');

const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));

const NARRATIVE_KEYWORDS = [
  '대안', '비교', '선택', '결정', '왜', '이유', '그래서',
  'A vs B', 'vs ', 'ADR', '장단점', '트레이드오프', '배제', '실패',
  '포기', '검토', '고민',
];

const CONTEXT_KEYWORDS = [
  '우리', '프로젝트', 'go-ti', '요구', '제약', '목표',
  '트래픽', '규모', '무중단', '장애', '리전', '비용', '팀',
];

function countMatches(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.reduce((n, kw) => {
    const hits = lower.split(kw.toLowerCase()).length - 1;
    return n + hits;
  }, 0);
}

function countCodeBlockChars(body) {
  const re = /```[\s\S]*?```/g;
  let total = 0;
  let m;
  while ((m = re.exec(body)) !== null) total += m[0].length;
  return total;
}

const rows = [];
for (const f of files) {
  const fp = path.join(CONTENT_DIR, f);
  const raw = fs.readFileSync(fp, 'utf8');
  const parsed = matter(raw);
  const body = parsed.content;
  const bodyLen = body.length;
  const codeLen = countCodeBlockChars(body);
  const codeRatio = bodyLen > 0 ? codeLen / bodyLen : 0;

  const fm = parsed.data || {};
  rows.push({
    slug: f.replace(/\.md$/, ''),
    title: fm.title || '',
    category: fm.category || '',
    date: fm.date || '',
    seriesName: fm.series?.name || '',
    seriesOrder: fm.series?.order || '',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    tagsStr: Array.isArray(fm.tags) ? fm.tags.join(',') : '',
    bodyLen,
    codeLen,
    codeRatio: +codeRatio.toFixed(3),
    narrativeHits: countMatches(body, NARRATIVE_KEYWORDS),
    contextHits: countMatches(body, CONTEXT_KEYWORDS),
    hasADR: /ADR|adr/.test(body) || /ADR|adr/.test(fm.title || ''),
    excerptLen: (fm.excerpt || '').length,
  });
}

// JSON 저장
fs.writeFileSync(
  path.join(OUT_DIR, 'inventory.json'),
  JSON.stringify(rows, null, 2),
  'utf8',
);

// Markdown 테이블 생성
rows.sort((a, b) => {
  const c = (a.category || '').localeCompare(b.category || '');
  if (c !== 0) return c;
  const s = (a.seriesName || 'zz').localeCompare(b.seriesName || 'zz');
  if (s !== 0) return s;
  return (a.seriesOrder || 0) - (b.seriesOrder || 0);
});

const lines = [];
lines.push('# 블로그 인벤토리 (자동 생성)');
lines.push('');
lines.push(`**총 ${rows.length}편** · 생성일: ${new Date().toISOString().slice(0, 10)}`);
lines.push('');
lines.push('## 컬럼 설명');
lines.push('');
lines.push('- `len`: 본문 글자수');
lines.push('- `code%`: 코드블록이 본문에서 차지하는 비율');
lines.push('- `narr`: 의사결정 서사 키워드 히트 (대안/비교/선택/이유 등)');
lines.push('- `ctx`: 프로젝트 맥락 키워드 히트 (우리/프로젝트/go-ti/요구/규모 등)');
lines.push('- `ADR`: ADR 언급 여부');
lines.push('');

// 카테고리별 집계
const byCat = {};
for (const r of rows) {
  byCat[r.category] = (byCat[r.category] || 0) + 1;
}
lines.push('## 카테고리 분포');
lines.push('');
lines.push('| 카테고리 | 글 수 |');
lines.push('|---------|------|');
for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${cat} | ${n} |`);
}
lines.push('');

// 월별 분포
const byMonth = {};
for (const r of rows) {
  const m = (r.date || '').slice(0, 7);
  byMonth[m] = (byMonth[m] || 0) + 1;
}
lines.push('## 월별 분포');
lines.push('');
lines.push('| 년-월 | 글 수 |');
lines.push('|------|------|');
for (const [m, n] of Object.entries(byMonth).sort()) {
  lines.push(`| ${m} | ${n} |`);
}
lines.push('');

// 카테고리별 표
for (const cat of Object.keys(byCat).sort()) {
  lines.push(`## [${cat}] (${byCat[cat]}편)`);
  lines.push('');
  lines.push('| date | series | ord | slug | len | code% | narr | ctx | ADR |');
  lines.push('|------|--------|-----|------|-----|-------|------|-----|-----|');
  for (const r of rows.filter((x) => x.category === cat)) {
    lines.push(
      `| ${r.date} | ${r.seriesName || '-'} | ${r.seriesOrder || '-'} | ${r.slug} | ${r.bodyLen} | ${(r.codeRatio * 100).toFixed(0)}% | ${r.narrativeHits} | ${r.contextHits} | ${r.hasADR ? 'Y' : ''} |`,
    );
  }
  lines.push('');
}

fs.writeFileSync(path.join(OUT_DIR, 'inventory.md'), lines.join('\n'), 'utf8');

console.log(`✔ ${rows.length}편 처리 완료`);
console.log(`  - ${path.join(OUT_DIR, 'inventory.json')}`);
console.log(`  - ${path.join(OUT_DIR, 'inventory.md')}`);
