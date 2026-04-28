#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const CONTENT_DIR = path.join(ROOT, 'src/content');
const CLAUDE_MD = path.join(ROOT, 'CLAUDE.md');

const MARK_START = '<!-- STATS:START -->';
const MARK_END = '<!-- STATS:END -->';

const CATEGORY_DESC = {
  challenge: '게임서버/POC/부하테스트/AI 워크플로우 경험 시리즈',
  monitoring: 'Prometheus, OpenTelemetry, Grafana, Loki, Tempo, Mimir',
  kubernetes: 'K8s 기본, EKS, Helm, KEDA, Karpenter, 스케일링',
  istio: 'Service Mesh, Traffic/Security/Observability/Ambient, JWT',
  cicd: 'CI/CD, ArgoCD GitOps, EC2 CD 파이프라인',
  argocd: 'ArgoCD, SSA, ApplicationSet',
};

const META_TAGS = ['troubleshooting', 'adr', 'concept', 'retrospective'];

function loadPosts() {
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.md') && f !== '_index.md');
  return files.map((file) => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const { data } = matter(raw);
    return { file, ...data };
  });
}

function countBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (k == null) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function sortDesc(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function buildStats(posts) {
  const total = posts.length;

  const categories = sortDesc(countBy(posts, (p) => p.category ?? 'uncategorized'));

  const metaCount = Object.fromEntries(META_TAGS.map((t) => [t, 0]));
  const tagSet = new Set();
  for (const p of posts) {
    for (const t of p.tags ?? []) {
      tagSet.add(t);
      if (META_TAGS.includes(t)) metaCount[t]++;
    }
  }

  const seriesGoti = new Map();
  const seriesOther = new Map();
  for (const p of posts) {
    const sname = p.series?.name;
    if (!sname) continue;
    const isGoti = (p.tags ?? [])[0] === 'go-ti';
    const bucket = isGoti ? seriesGoti : seriesOther;
    bucket.set(sname, (bucket.get(sname) ?? 0) + 1);
  }

  const months = sortDesc(
    countBy(posts, (p) => (p.date ? String(p.date).slice(0, 7) : null))
  ).sort((a, b) => a[0].localeCompare(b[0]));

  const gotiTotal = [...seriesGoti.values()].reduce((a, b) => a + b, 0);

  return {
    total,
    categories,
    metaCount,
    tagSet,
    seriesGoti: sortDesc(seriesGoti),
    seriesOther: sortDesc(seriesOther),
    months,
    gotiTotal,
  };
}

function fmtSeriesList(entries) {
  return entries.map(([name, n]) => `${name} (${n})`).join(', ');
}

function fmtMonths(entries) {
  return entries.map(([m, n]) => `${m}: ${n}`).join(' / ');
}

function renderBlock(stats) {
  const today = new Date().toISOString().slice(0, 10);

  const catLines = stats.categories.map(([cat, n]) => {
    const desc = CATEGORY_DESC[cat] ?? '';
    return desc
      ? `  - \`${cat}\` (${n}): ${desc}`
      : `  - \`${cat}\` (${n})`;
  });

  const metaParts = META_TAGS.map((t) => `\`${t}\` (${stats.metaCount[t]})`).join(' / ');

  const lines = [
    MARK_START,
    `<!-- 자동 생성: scripts/update-stats.mjs (prebuild 훅), 수동 편집 금지 -->`,
    `## Blog Content Stats (${today} 기준, 자동 생성)`,
    ``,
    `- **총 글 수**: ${stats.total}개 (go-ti 프로젝트 실전 기록 ${stats.gotiTotal}편 포함)`,
    `- **카테고리 (${stats.categories.length}개)**:`,
    ...catLines,
    `- **유형 메타 태그**: ${metaParts}`,
    `  - \`/blog?tag=adr\` — 의사결정 서사 글만 모아보기`,
    `  - \`/blog?tag=troubleshooting\` — 단순 트러블슈팅 모아보기`,
    `  - \`/blog?tag=concept\` — 개념·학습 글`,
    `  - \`/blog?tag=retrospective\` — 메타 회고`,
    `- **태그**: 고유 태그 ${stats.tagSet.size}개 (유형 메타 태그 ${META_TAGS.length}종 포함)`,
    `- **주요 시리즈** (편수 순):`,
    `  - go-ti 프로젝트 (${stats.seriesGoti.length}개 시리즈): ${fmtSeriesList(stats.seriesGoti)}`,
    `  - 기존 시리즈 (${stats.seriesOther.length}개): ${fmtSeriesList(stats.seriesOther)}`,
    `- **월별 분포**: ${fmtMonths(stats.months)}`,
    `- **go-ti 태그 필터**: 모든 goti 글은 \`tags[0] == "go-ti"\`로 \`/blog?tag=go-ti\` 한 번에 조회 가능`,
    MARK_END,
  ];
  return lines.join('\n');
}

function updateClaudeMd(block) {
  const md = fs.readFileSync(CLAUDE_MD, 'utf8');

  if (md.includes(MARK_START) && md.includes(MARK_END)) {
    const re = new RegExp(
      `${MARK_START}[\\s\\S]*?${MARK_END}`,
      'm'
    );
    const next = md.replace(re, block);
    if (next !== md) {
      fs.writeFileSync(CLAUDE_MD, next);
      return 'updated';
    }
    return 'unchanged';
  }

  // 마커 미존재 — 기존 'Blog Content Stats' 섹션 자리에 삽입
  const sectionRe = /## Blog Content Stats[\s\S]*?(?=\n## )/m;
  if (sectionRe.test(md)) {
    const next = md.replace(sectionRe, block + '\n\n');
    fs.writeFileSync(CLAUDE_MD, next);
    return 'inserted-replacing-section';
  }

  // 그래도 못 찾으면 파일 끝에 추가
  fs.writeFileSync(CLAUDE_MD, md.trimEnd() + '\n\n' + block + '\n');
  return 'appended';
}

function main() {
  const posts = loadPosts();
  const stats = buildStats(posts);
  const block = renderBlock(stats);
  const result = updateClaudeMd(block);
  console.log(`[update-stats] ${result} — total ${stats.total} posts`);
}

main();
