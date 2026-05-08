#!/usr/bin/env node
/**
 * [일회성 마이그레이션 스크립트 — 2026-05-08 실행 완료]
 *
 * src/content/*.md (단일 평탄) → src/content/{track}/{category}/{slug}.md (2단계)
 * 244편 이동 완료. 재실행 시 이미 분리된 디렉토리 구조에서는 의도와 다르게
 * 동작할 수 있으므로 반드시 `--dry-run --report`로 결과를 먼저 확인.
 *
 * 보존 이유: 향후 분류 재배치(--force-series-track)·신규 글 일괄 정리에 재활용 가능.
 *
 * 사용법:
 *   node scripts/migrate-content.mjs                           # dry-run 기본
 *   node scripts/migrate-content.mjs --apply                   # 실제 이동
 *   node scripts/migrate-content.mjs --report                  # 분류 리포트 자세히
 *   node scripts/migrate-content.mjs --force-series-track <name> <track>
 *
 * track 결정: inferType → inferTrack
 *   - frontmatter.type 명시 → 그대로
 *   - tags 배열에 troubleshooting/adr/concept/retrospective 첫 매칭
 *   - slug에 -adr → adr / slug 트러블슈팅 패턴 → troubleshooting
 *   - 그 외 undefined → essays
 *   - type === 'troubleshooting' → logs, 그 외 → essays
 *
 * category: frontmatter.category (누락 시 에러)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const CONTENT_DIR = path.join(ROOT, 'src/content');

// === inferType/inferTrack — lib/posts.ts와 동기화 ===
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
    const lowerTags = data.tags.map((t) => String(t).toLowerCase());
    for (const t of TYPE_TAGS) if (lowerTags.includes(t)) return t;
  }
  if (/-adr(-|$)/i.test(slug)) return 'adr';
  if (looksLikeTroubleshooting(slug, data.series?.name)) return 'troubleshooting';
  return undefined;
}

function inferTrack(type) {
  return type === 'troubleshooting' ? 'logs' : 'essays';
}

// === CLI parsing ===
function parseArgs(argv) {
  const args = { dryRun: true, report: false, forceSeries: new Map() };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.dryRun = false;
    else if (a === '--report') args.report = true;
    else if (a === '--force-series-track') {
      const name = argv[++i];
      const track = argv[++i];
      if (!name || !['essays', 'logs'].includes(track)) {
        console.error('--force-series-track <name> <essays|logs>');
        process.exit(1);
      }
      args.forceSeries.set(name, track);
    }
  }
  return args;
}

// === 분류 ===
function classify(args) {
  const entries = fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== '_index.md');

  const items = entries.map((e) => {
    const slug = e.name.replace(/\.md$/, '');
    const fullPath = path.join(CONTENT_DIR, e.name);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const { data } = matter(raw);

    const type = inferType(data, slug);
    let track = inferTrack(type);

    // --force-series-track 적용
    const seriesName = data.series?.name;
    if (seriesName && args.forceSeries.has(seriesName)) {
      track = args.forceSeries.get(seriesName);
    }

    const category = data.category;
    const reasons = [];
    if (typeof data.type === 'string' && TYPE_TAGS.includes(data.type)) {
      reasons.push(`type=${data.type}`);
    } else if (Array.isArray(data.tags)) {
      const matched = data.tags
        .map((t) => String(t).toLowerCase())
        .find((t) => TYPE_TAGS.includes(t));
      if (matched) reasons.push(`tag=${matched}`);
    }
    if (/-adr(-|$)/i.test(slug)) reasons.push('slug=-adr');
    if (looksLikeTroubleshooting(slug, seriesName)) reasons.push('slug~troubleshoot');
    if (seriesName && args.forceSeries.has(seriesName)) {
      reasons.push(`forced(${args.forceSeries.get(seriesName)})`);
    }
    if (reasons.length === 0) reasons.push('default(essays)');

    return {
      slug,
      fileName: e.name,
      fromPath: fullPath,
      toPath: category
        ? path.join(CONTENT_DIR, track, category, e.name)
        : null,
      track,
      category,
      type,
      seriesName,
      gotiTag: Array.isArray(data.tags) && data.tags[0] === 'go-ti',
      reasons,
    };
  });

  return items;
}

// === 검증 3종 ===
function validate(items) {
  const errors = [];
  const warnings = [];

  // 1. category 누락
  const missingCategory = items.filter((it) => !it.category);
  if (missingCategory.length > 0) {
    errors.push(
      `CATEGORY MISSING (${missingCategory.length}):\n` +
        missingCategory.map((it) => `  ${it.fileName}`).join('\n'),
    );
  }

  // 2. 슬러그 충돌 — 신규 경로 basename 기준
  const slugMap = new Map();
  for (const it of items) {
    if (!it.toPath) continue;
    const list = slugMap.get(it.slug) ?? [];
    list.push(it.fromPath);
    slugMap.set(it.slug, list);
  }
  const collisions = [...slugMap.entries()].filter(([, paths]) => paths.length > 1);
  if (collisions.length > 0) {
    errors.push(
      `SLUG COLLISIONS (${collisions.length}):\n` +
        collisions
          .map(([slug, paths]) => `  ${slug}\n    - ${paths.join('\n    - ')}`)
          .join('\n'),
    );
  }

  // 3. 시리즈 분리 경고
  const seriesTracks = new Map();
  for (const it of items) {
    if (!it.seriesName) continue;
    const trackSet = seriesTracks.get(it.seriesName) ?? new Set();
    trackSet.add(it.track);
    seriesTracks.set(it.seriesName, trackSet);
  }
  const splitSeries = [...seriesTracks.entries()].filter(([, set]) => set.size > 1);
  if (splitSeries.length > 0) {
    const detail = splitSeries
      .map(([name, set]) => {
        const counts = [...set]
          .map((t) => {
            const n = items.filter((i) => i.seriesName === name && i.track === t).length;
            return `${t}=${n}`;
          })
          .join(', ');
        return `  ${name}: ${counts}`;
      })
      .join('\n');
    warnings.push(`SERIES SPLIT WARNINGS (${splitSeries.length}):\n${detail}`);
  }

  return { errors, warnings };
}

// === 리포트 ===
function buildReport(items, args) {
  const essays = items.filter((it) => it.track === 'essays');
  const logs = items.filter((it) => it.track === 'logs');

  const groupByCat = (arr) => {
    const m = new Map();
    for (const it of arr) {
      const k = it.category ?? 'uncategorized';
      const list = m.get(k) ?? [];
      list.push(it);
      m.set(k, list);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  const lines = [];
  lines.push(`총 ${items.length}편 분류 결과`);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`ESSAYS (${essays.length}):`);
  for (const [cat, list] of groupByCat(essays)) {
    lines.push(`  ${cat} (${list.length}):`);
    if (args.report) {
      for (const it of list) lines.push(`    - ${it.slug}`);
    }
  }
  lines.push('');
  lines.push(`LOGS (${logs.length}):`);
  for (const [cat, list] of groupByCat(logs)) {
    lines.push(`  ${cat} (${list.length}):`);
    if (args.report) {
      for (const it of list) lines.push(`    - ${it.slug}  [${it.reasons.join(',')}]`);
    }
  }
  lines.push('');

  // 모호 케이스: type 미명시 + slug 패턴으로만 logs 분류된 글
  const ambiguousLogs = logs.filter((it) => {
    const reasonsSet = new Set(it.reasons);
    return ![...reasonsSet].some((r) => r.startsWith('type=') || r.startsWith('tag=') || r === 'forced(logs)');
  });
  if (ambiguousLogs.length > 0) {
    lines.push(`AMBIGUOUS-LOGS (${ambiguousLogs.length}) — type/tags 미명시, slug 패턴으로만 logs 분류:`);
    for (const it of ambiguousLogs) {
      lines.push(`  ${it.slug}  [${it.reasons.join(',')}] → logs/${it.category}/`);
    }
    lines.push('');
  }

  // goti 글 중 essays로 분류된 것 (goti는 대부분 logs라 검증 필요)
  const gotiEssays = essays.filter((it) => it.gotiTag);
  if (gotiEssays.length > 0) {
    lines.push(`GOTI-ESSAYS (${gotiEssays.length}) — go-ti 태그 글 중 essays 분류 (검증 권장):`);
    for (const it of gotiEssays) {
      lines.push(`  ${it.slug}  [${it.reasons.join(',')}] → essays/${it.category}/`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// === 실행 ===
function apply(items) {
  const created = new Set();
  let moved = 0;
  for (const it of items) {
    const dir = path.dirname(it.toPath);
    if (!created.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.add(dir);
    }
    fs.renameSync(it.fromPath, it.toPath);
    moved++;
  }
  return { moved, dirs: created.size };
}

function main() {
  const args = parseArgs(process.argv);

  console.log(`[migrate-content] mode=${args.dryRun ? 'DRY-RUN' : 'APPLY'}`);
  if (args.forceSeries.size > 0) {
    console.log(`[migrate-content] force-series:`);
    for (const [name, track] of args.forceSeries) {
      console.log(`  ${name} → ${track}`);
    }
  }
  console.log('');

  const items = classify(args);
  const { errors, warnings } = validate(items);

  console.log(buildReport(items, args));

  if (warnings.length > 0) {
    console.log('--- WARNINGS ---');
    for (const w of warnings) console.log(w);
    console.log('');
  }

  if (errors.length > 0) {
    console.error('--- ERRORS ---');
    for (const e of errors) console.error(e);
    console.error('');
    console.error('검증 실패. apply 차단.');
    process.exit(1);
  }

  if (args.dryRun) {
    console.log('DRY-RUN — 실제 이동 안 함. --apply 로 실행.');
    return;
  }

  const { moved, dirs } = apply(items);
  console.log(`이동 완료: ${moved}편 → ${dirs}개 디렉토리 생성`);
}

main();
