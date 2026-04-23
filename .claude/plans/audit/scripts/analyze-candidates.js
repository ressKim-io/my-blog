#!/usr/bin/env node
// inventory.json을 읽어 후보군을 자동 추출
// 출력: candidates.md (후보 목록) + duplicates.md (제목/태그 유사도)

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..');
const inv = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'inventory.json'), 'utf8'));

// 글 유형 추정
// A. 단순 트러블슈팅: 제목에 에러/코드/오류, troubleshoot/error/fail, 404/500/401/OOM 등 또는 category=monitoring/kubernetes와 slug에 -troubleshoot/-error/-fail
// B. 의사결정 서사: ADR flag 또는 narr>=10 또는 slug에 adr/selection/comparison/strategy/decision
// C. 학습/정리: category=istio, kubernetes이면서 intro/part1/concept/architecture
// D. 기록/로그: category=challenge이면서 meta/retrospective/summary

function classify(row) {
  const s = row.slug.toLowerCase();
  const t = (row.title || '').toLowerCase();

  // B 먼저 (ADR은 확실)
  if (row.hasADR) return 'B';
  if (/adr|selection|comparison|strategy|decision|-vs-|why-/.test(s)) return 'B';
  if (row.narrativeHits >= 15 && row.contextHits >= 3) return 'B';

  // A: 트러블슈팅
  if (/troubleshoot|-error|-fail|404|500|401|403|oom|timeout|crashloop|mismatch|conflict|escape|missing/.test(s))
    return 'A';
  if (/에러|오류|장애|문제/.test(t)) return 'A';

  // C: 학습/정리
  if (/intro|part1|concept|architecture|overview/.test(s)) return 'C';

  // D: 메타/기록
  if (/meta|retrospective|learning|workflow/.test(s)) return 'D';

  // 디폴트: 시리즈면 A, 아니면 D
  if (row.seriesName) return 'A';
  return 'D';
}

const classified = inv.map((r) => ({ ...r, type: classify(r) }));

// 후보 플래그
const flags = classified.map((r) => {
  const f = {
    short: r.bodyLen < 3000, // 너무 짧음 (마크다운 문자수 기준, 약 1500-2000 한글자)
    veryShort: r.bodyLen < 2000,
    codeHeavy: r.codeRatio >= 0.6 && r.bodyLen < 6000, // 코드 과다 + 설명 적음
    narrativeThin: r.type === 'B' && r.narrativeHits < 10,
    contextThin: r.type === 'B' && r.contextHits < 3,
    marchAprilHeavy: /^(2026-03|2026-04)/.test(r.date || ''),
  };
  f.lowValue = f.veryShort || f.codeHeavy;
  f.needsRewrite = f.narrativeThin || f.contextThin;
  return { ...r, flags: f };
});

// ============ 중복 의심: 제목·태그 유사도 ============
function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function titleTokens(t) {
  return (t || '')
    .toLowerCase()
    .replace(/[^\w가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

const duplicatePairs = [];
for (let i = 0; i < classified.length; i++) {
  for (let j = i + 1; j < classified.length; j++) {
    const a = classified[i];
    const b = classified[j];
    // 같은 카테고리에서만
    if (a.category !== b.category) continue;
    const titleSim = jaccard(titleTokens(a.title), titleTokens(b.title));
    const tagSim = jaccard(a.tags, b.tags);
    // 시리즈 중복: 서로 다른 시리즈인데 제목 유사
    const diffSeries = a.seriesName !== b.seriesName;
    if ((titleSim >= 0.4 && diffSeries) || tagSim >= 0.7) {
      duplicatePairs.push({
        a: a.slug,
        b: b.slug,
        titleA: a.title,
        titleB: b.title,
        titleSim: +titleSim.toFixed(2),
        tagSim: +tagSim.toFixed(2),
        diffSeries,
        category: a.category,
      });
    }
  }
}
duplicatePairs.sort((x, y) => y.titleSim - x.titleSim);

// ============ 날짜 재분배: 3~4월 → 2월 이동 후보 ============
// 시리즈 연속성 보호: 같은 시리즈 내 order=1이거나 독립 글 우선
const byDate = {};
for (const r of classified) {
  const m = (r.date || '').slice(0, 7);
  byDate[m] = byDate[m] || [];
  byDate[m].push(r);
}

const marchApril = (byDate['2026-03'] || []).concat(byDate['2026-04'] || []);
const movableToFeb = marchApril
  .filter((r) => {
    // 독립 글 (series 없음) → 우선 이동 후보
    if (!r.seriesName) return true;
    // 시리즈 시작점 (order=1) → 이동 가능
    if (r.seriesOrder === 1) return true;
    return false;
  })
  .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

// ============ 출력 ============
const lines = [];
lines.push('# 후보 플래그 (자동 추출)');
lines.push('');
lines.push(`생성일: ${new Date().toISOString().slice(0, 10)}`);
lines.push('');

// 유형 분포
const typeDist = {};
for (const r of classified) typeDist[r.type] = (typeDist[r.type] || 0) + 1;
lines.push('## 유형 추정 분포');
lines.push('');
lines.push('| 유형 | 글 수 | 설명 |');
lines.push('|------|------|------|');
lines.push(`| A (단순 트러블슈팅) | ${typeDist.A || 0} | 서사구조 강요 X |`);
lines.push(`| B (의사결정 서사) | ${typeDist.B || 0} | 3요소 필수 |`);
lines.push(`| C (학습/정리) | ${typeDist.C || 0} | 독창성·깊이 평가 |`);
lines.push(`| D (기록/로그) | ${typeDist.D || 0} | 인사이트 유무 |`);
lines.push('');
lines.push('> 추정은 키워드 기반이므로 Phase 2에서 수동 확정 필요');
lines.push('');

// 저가치 후보
const lowValue = classified
  .map((r) => ({
    ...r,
    flags: {
      veryShort: r.bodyLen < 2000,
      codeHeavy: r.codeRatio >= 0.6 && r.bodyLen < 6000,
    },
  }))
  .filter((r) => r.flags.veryShort || r.flags.codeHeavy);

lines.push(`## 저가치 의심 (${lowValue.length}편)`);
lines.push('');
lines.push('기준: 본문 <2000자 OR (코드비중 ≥60% AND <6000자)');
lines.push('');
lines.push('| cat | type | date | slug | len | code% | 플래그 |');
lines.push('|-----|------|------|------|-----|-------|-------|');
for (const r of lowValue) {
  const fs = [];
  if (r.flags.veryShort) fs.push('짧음');
  if (r.flags.codeHeavy) fs.push('코드과다');
  lines.push(
    `| ${r.category} | ${r.type} | ${r.date} | ${r.slug} | ${r.bodyLen} | ${(r.codeRatio * 100).toFixed(0)}% | ${fs.join(',')} |`,
  );
}
lines.push('');

// 서사 결여 (B 유형)
const narrThin = classified.filter((r) => r.type === 'B' && r.narrativeHits < 10);
lines.push(`## 의사결정 서사 결여 의심 (B 유형, ${narrThin.length}편)`);
lines.push('');
lines.push('기준: 유형=B AND 서사 키워드 <10회');
lines.push('');
lines.push('| date | slug | narr | ctx | ADR |');
lines.push('|------|------|------|-----|-----|');
for (const r of narrThin) {
  lines.push(`| ${r.date} | ${r.slug} | ${r.narrativeHits} | ${r.contextHits} | ${r.hasADR ? 'Y' : ''} |`);
}
lines.push('');

// 컨텍스트 결여 (B 유형)
const ctxThin = classified.filter((r) => r.type === 'B' && r.contextHits < 3);
lines.push(`## 프로젝트 맥락 why 결여 의심 (B 유형, ${ctxThin.length}편)`);
lines.push('');
lines.push('기준: 유형=B AND 컨텍스트 키워드 <3회');
lines.push('');
lines.push('| date | slug | narr | ctx | ADR |');
lines.push('|------|------|------|-----|-----|');
for (const r of ctxThin) {
  lines.push(`| ${r.date} | ${r.slug} | ${r.narrativeHits} | ${r.contextHits} | ${r.hasADR ? 'Y' : ''} |`);
}
lines.push('');

// 2월 이동 후보
lines.push(`## 2월 이동 후보 (${movableToFeb.length}편)`);
lines.push('');
lines.push('기준: 2026-03 OR 04 AND (독립글 OR 시리즈 order=1)');
lines.push('');
lines.push('| 현재 date | cat | series | slug |');
lines.push('|-----------|-----|--------|------|');
for (const r of movableToFeb) {
  lines.push(`| ${r.date} | ${r.category} | ${r.seriesName || '-'} | ${r.slug} |`);
}
lines.push('');

// 중복 의심
lines.push(`## 중복 의심 페어 (${duplicatePairs.length}개)`);
lines.push('');
lines.push('기준: 같은 카테고리 AND (제목 유사도≥0.4 AND 다른 시리즈) OR 태그 유사도≥0.7');
lines.push('');
lines.push('| cat | titleSim | tagSim | A | B |');
lines.push('|-----|----------|--------|---|---|');
for (const p of duplicatePairs) {
  lines.push(`| ${p.category} | ${p.titleSim} | ${p.tagSim} | ${p.a} | ${p.b} |`);
}

fs.writeFileSync(path.join(OUT_DIR, 'candidates.md'), lines.join('\n'), 'utf8');

// 요약 JSON
const summary = {
  total: classified.length,
  typeDist,
  lowValueCount: lowValue.length,
  narrThinCount: narrThin.length,
  ctxThinCount: ctxThin.length,
  movableToFebCount: movableToFeb.length,
  duplicatePairsCount: duplicatePairs.length,
  monthDist: Object.fromEntries(Object.entries(byDate).map(([k, v]) => [k, v.length])),
};
fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

console.log('✔ 분석 완료');
console.log(JSON.stringify(summary, null, 2));
