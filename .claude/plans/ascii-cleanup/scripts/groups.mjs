#!/usr/bin/env node
// inventory.json을 읽어 그룹별로 묶은 groups.md 생성
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '../../../..');
const INV_PATH = path.resolve(path.dirname(__filename), '../inventory.json');
const OUT_PATH = path.resolve(path.dirname(__filename), '../groups.md');

function main() {
  const inv = JSON.parse(fs.readFileSync(INV_PATH, 'utf8'));

  // flatten 블록이 있는 글만 작업 대상
  const targets = inv
    .map((item) => {
      const flattenBlocks = item.blocks.filter((b) => b.decision === 'flatten');
      const keepBlocks = item.blocks.filter((b) => b.decision === 'keep');
      const skipBlocks = item.blocks.filter((b) => b.decision === 'skip');
      return { ...item, flattenBlocks, keepBlocks, skipBlocks };
    })
    .filter((item) => item.flattenBlocks.length > 0);

  // 그룹화 기준: series가 있으면 series, 없으면 category
  const groups = new Map();
  for (const item of targets) {
    const key = item.series ? `series:${item.series}` : `cat:${item.category ?? 'uncategorized'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  // 그룹 정렬: flatten 블록 합계 내림차순
  const sortedGroups = [...groups.entries()]
    .map(([key, items]) => ({
      key,
      items,
      flattenTotal: items.reduce((a, b) => a + b.flattenBlocks.length, 0),
      flattenLines: items.reduce(
        (a, b) => a + b.flattenBlocks.reduce((x, y) => x + y.lineCount, 0),
        0
      ),
    }))
    .sort((a, b) => b.flattenLines - a.flattenLines);

  const out = [];
  out.push('# ASCII Cleanup — 그룹별 작업 묶음');
  out.push('');
  out.push(`> 자동 생성: \`scripts/groups.mjs\``);
  out.push(`> 생성 시각: ${new Date().toISOString()}`);
  out.push('');
  out.push('## 요약');
  out.push('');
  out.push(`- 작업 대상 글 수 (flatten 블록 보유): **${targets.length}편**`);
  out.push(`- 그룹 수: **${sortedGroups.length}개**`);
  out.push(`- 작업 대상 flatten 블록 총합: **${sortedGroups.reduce((a, b) => a + b.flattenTotal, 0)}개**`);
  out.push(`- flatten 라인 총합: **${sortedGroups.reduce((a, b) => a + b.flattenLines, 0)}줄**`);
  out.push('');
  out.push('## 그룹 목록 (flatten 라인 수 내림차순)');
  out.push('');
  out.push('| # | 그룹 키 | 글 수 | flatten 블록 | flatten 라인 |');
  out.push('|---|---|---|---|---|');
  sortedGroups.forEach((g, idx) => {
    out.push(`| G${idx + 1} | \`${g.key}\` | ${g.items.length} | ${g.flattenTotal} | ${g.flattenLines} |`);
  });
  out.push('');
  out.push('## 그룹 상세');
  out.push('');
  sortedGroups.forEach((g, idx) => {
    out.push(`### G${idx + 1} — \`${g.key}\``);
    out.push('');
    out.push(`- 글 ${g.items.length}편 / flatten ${g.flattenTotal} 블록 / ${g.flattenLines}줄`);
    out.push('');
    out.push('| 글 | flatten | keep | skip | 카테고리 |');
    out.push('|---|---|---|---|---|');
    for (const item of g.items.sort((a, b) => b.flattenBlocks.length - a.flattenBlocks.length)) {
      out.push(
        `| \`${item.file}\` | ${item.flattenBlocks.length} | ${item.keepBlocks.length} | ${item.skipBlocks.length} | ${item.category ?? '-'} |`
      );
    }
    out.push('');
    out.push('**flatten 블록 위치**:');
    out.push('');
    for (const item of g.items) {
      if (item.flattenBlocks.length === 0) continue;
      out.push(`- \`${item.file}\``);
      for (const b of item.flattenBlocks) {
        out.push(
          `  - L${b.startLine}-${b.endLine} (${b.lineCount}줄, kind=\`${b.kind}\`, lang=\`${b.lang || '-'}\`)`
        );
      }
    }
    out.push('');
  });

  fs.writeFileSync(OUT_PATH, out.join('\n'));
  console.log(
    `[groups] groups.md 생성 — ${targets.length}편, ${sortedGroups.length}그룹, flatten ${sortedGroups.reduce((a, b) => a + b.flattenTotal, 0)}블록`
  );
}

main();
