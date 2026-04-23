#!/usr/bin/env node
// 유형 메타 태그 자동 분류 + frontmatter tags[] 마지막에 추가
// 출력: type-assignments.md (분류 결과 + 사유)

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const CONTENT_DIR = path.resolve(__dirname, '../../../../src/content');
const OUT_DIR = path.resolve(__dirname, '..');

const TYPE_TAGS = ['troubleshooting', 'adr', 'concept', 'retrospective'];

function classify(fm, body, slug) {
  const s = slug.toLowerCase();
  const t = (fm.title || '').toLowerCase();
  const tags = (fm.tags || []).map((x) => String(x).toLowerCase());
  const seriesName = (fm.series?.name || '').toLowerCase();

  // 이미 유형 태그 있으면 skip
  for (const tt of TYPE_TAGS) {
    if (tags.includes(tt)) return { type: tt, reason: 'already-tagged', skipped: true };
  }

  // 1. ADR 명시 (B)
  if (/\badr\b/.test(s) || /\badr\b/.test(t)) {
    return { type: 'adr', reason: 'adr-keyword' };
  }

  // 2. ADR 패턴 (B)
  if (/selection|comparison|strategy|-vs-|\bwhy-|-choice\b|rightsizing|redis-sot-d2-d3-d4-rollout|session-dropout-root-cause|jwt-issuer-sot|queue-poc-performance|loadtest-part3-selection|container-image-update-strategy|queue-poc-1000vu/.test(s)) {
    return { type: 'adr', reason: 'adr-pattern' };
  }

  // 3. 메타/회고 시리즈 (D)
  if (seriesName === 'goti-meta' || seriesName === 'goti-ai-review-comparison') {
    return { type: 'retrospective', reason: 'meta-series' };
  }

  // 4. Meta 태그 or 메타 슬러그 (D)
  if (
    tags.includes('meta') ||
    /-(workflow|retrospective|learning|consolidation)|goti-ai-skills-consolidation|goti-ai-workflow-large-improvement|goti-opus-4-7-migration|goti-claude-code-config-optimization|goti-review-pr-gap-learning/.test(s)
  ) {
    return { type: 'retrospective', reason: 'meta-pattern' };
  }

  // 5. wealist-migration (D): 작업 후기 story
  if (/wealist-migration/.test(s)) {
    return { type: 'retrospective', reason: 'migration-story' };
  }

  // 6. istio-intro series (C)
  if (seriesName === 'istio-intro') {
    return { type: 'concept', reason: 'intro-series' };
  }

  // 7. 개념/기초 (C)
  if (/^k8s-pod-flow|^service-mesh-comparison|multi-repo-cicd-strategy|otel-monitoring-v3|docker-compose-env-management|ops-portal-metrics-collection|websocket-token-refresh|multi-repo-cicd|github-actions-multi-platform/.test(s)) {
    // 이 글들은 일반 학습/가이드성 → concept
    if (/comparison|strategy/.test(s)) {
      // 이미 adr로 분류되었어야 함 — 여기 도달 시 concept fallback 아님
      return { type: 'adr', reason: 'adr-pattern-late' };
    }
    return { type: 'concept', reason: 'concept-guide' };
  }

  // 8. istio-ambient/traffic/security/observability 시리즈 — 대부분 심화 개념 (C)
  if (
    /^istio-(ambient|traffic|security|observability)-part/.test(s) &&
    !/troubleshoot|error|mismatch|missing|conflict/.test(s)
  ) {
    return { type: 'concept', reason: 'istio-deep-dive' };
  }

  // 9. 트러블슈팅 키워드 (A)
  if (
    /troubleshoot|-error|-fail|-missing|-conflict|-mismatch|-crash|-timeout|-oom|-escape|-retry|-cascading|-pitfalls|-fix$|-fixes$|\b(404|500|401|403|502|503|nodata)\b/.test(s)
  ) {
    return { type: 'troubleshooting', reason: 'ts-keyword' };
  }

  // 10. eks-troubleshooting 시리즈 (A)
  if (seriesName === 'eks-troubleshooting') {
    return { type: 'troubleshooting', reason: 'eks-ts-series' };
  }

  // 11. 게임서버·queue-poc 등 PoC/Test 시리즈: 대부분 A
  if (/^challenge1-game-server|^queue-poc-loadtest/.test(s)) {
    return { type: 'troubleshooting', reason: 'challenge-series-default' };
  }

  // 기본값: A
  return { type: 'troubleshooting', reason: 'default' };
}

function addTypeTag(raw, typeTag) {
  // 블록 스타일: tags:\n  - a\n  - b\n
  const blockMatch = raw.match(/^(tags:\s*\n(?:\s+-\s+.+\n)+)/m);
  if (blockMatch) {
    const block = blockMatch[1];
    const indent = (block.match(/\n(\s+)-/)?.[1]) || '  ';
    const newBlock = block + `${indent}- ${typeTag}\n`;
    return raw.replace(block, newBlock);
  }
  // 인라인 스타일: tags: [a, b]
  const inlineMatch = raw.match(/^(tags:\s*\[)([^\]]*)(\])/m);
  if (inlineMatch) {
    const current = inlineMatch[2].trim();
    const newBody = current ? `${current}, ${typeTag}` : typeTag;
    return raw.replace(/^(tags:\s*\[)([^\]]*)(\])/m, `$1${newBody}$3`);
  }
  // tags 필드가 없으면 frontmatter에 추가
  return raw.replace(/^(---\n(?:[^\n]*\n)*?)(---)/m, `$1tags:\n  - ${typeTag}\n$2`);
}

const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));
const assignments = [];
let changed = 0;
let skipped = 0;

for (const f of files) {
  const fp = path.join(CONTENT_DIR, f);
  const raw = fs.readFileSync(fp, 'utf8');
  const parsed = matter(raw);
  const slug = f.replace(/\.md$/, '');
  const result = classify(parsed.data, parsed.content, slug);
  assignments.push({
    slug,
    category: parsed.data.category || '',
    series: parsed.data.series?.name || '',
    ...result,
  });
  if (result.skipped) {
    skipped++;
    continue;
  }
  const updated = addTypeTag(raw, result.type);
  if (updated !== raw) {
    fs.writeFileSync(fp, updated, 'utf8');
    changed++;
  }
}

// 출력
const lines = ['# 유형 태그 자동 부여 결과', ''];
lines.push(`총 ${files.length}편 중 ${changed}편 수정, ${skipped}편 skip (이미 태그 있음)`);
lines.push('');

const byType = {};
for (const a of assignments) byType[a.type] = (byType[a.type] || 0) + 1;
lines.push('## 분포');
lines.push('');
lines.push('| type | 편수 |');
lines.push('|------|-----|');
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  lines.push(`| \`${k}\` | ${v} |`);
}
lines.push('');
lines.push('## 분류 결과 (유형별 정렬)');
lines.push('');
lines.push('| type | reason | category | series | slug |');
lines.push('|------|--------|----------|--------|------|');
const sorted = assignments.sort((a, b) => a.type.localeCompare(b.type) || a.slug.localeCompare(b.slug));
for (const a of sorted) {
  lines.push(`| \`${a.type}\` | ${a.reason} | ${a.category} | ${a.series || '-'} | ${a.slug} |`);
}

fs.writeFileSync(path.join(OUT_DIR, 'type-assignments.md'), lines.join('\n'), 'utf8');
console.log(`✔ ${changed}/${files.length}편 수정, ${skipped}편 skip`);
console.log(`  → ${path.join(OUT_DIR, 'type-assignments.md')}`);
console.log('\n분포:', JSON.stringify(byType, null, 2));
