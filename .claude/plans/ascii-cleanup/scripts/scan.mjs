#!/usr/bin/env node
// 코드블록(```) 내부의 ASCII 박스/트리 다이어그램을 추출해 인벤토리화
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '../../../..');
const CONTENT_DIR = path.join(ROOT, 'src/content');
const OUT_JSON = path.resolve(path.dirname(__filename), '../inventory.json');
const OUT_MD = path.resolve(path.dirname(__filename), '../inventory.md');

const BOX_CHARS = /[┌└├│─┐┘┤┬┴┼╔╚╠║═╗╝╣╦╩╬]/;
const ARROW_CHARS = /[→←↑↓⇒⇐]/;
const TREE_TOKEN = /(├──|└──|^[\s│]+├|^[\s│]+└)/;

// 코드/슈도코드로 분류해야 할 lang (다이어그램 의도가 아닐 가능성 높음)
const CODE_LANGS = new Set([
  'bash', 'sh', 'shell', 'zsh',
  'go', 'java', 'python', 'py', 'typescript', 'ts', 'javascript', 'js',
  'rust', 'kotlin', 'cpp', 'c',
  'sql', 'json', 'yaml', 'yml', 'toml',
  'dockerfile', 'makefile', 'nginx',
  'html', 'css', 'scss',
]);

// 블록의 처리 방식 자동 추천 (사용자가 수동으로 override 가능)
// - flatten: 평탄화 (표/문장으로 변환 또는 삭제)
// - keep: 보존 (디자인 개편 세션에서 재처리)
// - skip: 다이어그램 의도 아닐 가능성 높음 (코드 슈도코드 등) — 검토 후 무시
function recommendDecision(kind, lineCount) {
  // 디렉토리 트리는 ASCII가 자연스러움 — 보존
  if (kind === 'tree') return 'keep';
  // 코드 슈도코드는 다이어그램 아님 — skip (자동 변환 대상 아님)
  if (kind === 'code-arrow') return 'skip';
  // 박스 포함 + 5줄 초과 = 시각화 가치 있음 → 디자인 개편까지 보존
  if ((kind === 'flow-diagram' || kind === 'architecture') && lineCount > 5) return 'keep';
  // 작은 박스 / 짧은 화살표 / 기타 = 평탄화
  return 'flatten';
}

function classifyBlock(lines, lang) {
  const text = lines.join('\n');
  const hasBox = /[┌┐└┘├┤┬┴┼]/.test(text);
  const hasArrow = ARROW_CHARS.test(text) || /\s->\s|\s=>\s|<-\s|<=\s/.test(text);
  const treeTokenCount = lines.filter((l) => TREE_TOKEN.test(l)).length;

  // 1. 디렉토리/의존성 트리 — `├──` `└──` 토큰 3개 이상이면 tree
  if (treeTokenCount >= 3 && !/[┌┐]/.test(text)) return 'tree';

  // 2. 코드 lang 블록 안의 화살표는 다이어그램이 아니라 슈도코드/주석일 가능성
  if (CODE_LANGS.has((lang || '').toLowerCase()) && !hasBox) return 'code-arrow';

  // 3. 박스 + 화살표 (흐름도)
  if (hasBox && hasArrow) return 'flow-diagram';

  // 4. 박스 다수 (아키텍처)
  if (hasBox && lines.length >= 15) return 'architecture';

  // 5. 단순 박스
  if (hasBox) return 'box-small';

  // 6. 박스 없는 화살표 시퀀스 (text/없는 lang에서)
  if (hasArrow) return 'arrow-only';

  return 'misc';
}

function extractBlocks(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  const lines = raw.split('\n');
  const blocks = [];
  let inFence = false;
  let fenceLang = null;
  let buf = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceLang = fenceMatch[1] || '';
        buf = [];
        startLine = i + 1;
      } else {
        // 펜스 종료 — buf 내용 검사
        if (buf.some((l) => BOX_CHARS.test(l) || ARROW_CHARS.test(l))) {
          const lineCount = buf.length;
          const kind = classifyBlock(buf, fenceLang);
          const decision = recommendDecision(kind, lineCount);
          blocks.push({
            startLine,
            endLine: i,
            lang: fenceLang,
            lineCount,
            kind,
            decision,
            sample: buf.slice(0, 3).join(' / ').slice(0, 120),
          });
        }
        inFence = false;
        fenceLang = null;
        buf = [];
      }
    } else if (inFence) {
      buf.push(line);
    }
  }
  return blocks;
}

function loadFrontmatter(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = m[1];
  const cat = fm.match(/^category:\s*(.+)$/m)?.[1]?.trim().replace(/['"]/g, '');
  const series = fm.match(/^\s+name:\s*(.+)$/m)?.[1]?.trim().replace(/['"]/g, '');
  const title = fm.match(/^title:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  return { cat, series, title };
}

function main() {
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(CONTENT_DIR, f));

  const inventory = [];
  for (const f of files) {
    const blocks = extractBlocks(f);
    if (blocks.length === 0) continue;
    const fm = loadFrontmatter(f);
    const totalAsciiLines = blocks.reduce((a, b) => a + b.lineCount, 0);
    inventory.push({
      file: path.basename(f),
      category: fm.cat,
      series: fm.series,
      title: fm.title,
      blockCount: blocks.length,
      totalAsciiLines,
      blocks,
    });
  }

  inventory.sort((a, b) => b.totalAsciiLines - a.totalAsciiLines);
  fs.writeFileSync(OUT_JSON, JSON.stringify(inventory, null, 2));

  // markdown 인벤토리 생성
  const byKind = new Map();
  const byDecision = new Map();
  for (const item of inventory) {
    for (const b of item.blocks) {
      byKind.set(b.kind, (byKind.get(b.kind) ?? 0) + 1);
      byDecision.set(b.decision, (byDecision.get(b.decision) ?? 0) + 1);
    }
  }

  const lines = [];
  lines.push('# ASCII Cleanup — Inventory');
  lines.push('');
  lines.push(`> 자동 생성: \`.claude/plans/ascii-cleanup/scripts/scan.mjs\``);
  lines.push(`> 생성 시각: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## 요약`);
  lines.push('');
  lines.push(`- ASCII 블록 포함 글: **${inventory.length}편**`);
  lines.push(`- 전체 ASCII 블록 수: **${inventory.reduce((a, b) => a + b.blockCount, 0)}개**`);
  lines.push(`- 전체 ASCII 라인 합계: **${inventory.reduce((a, b) => a + b.totalAsciiLines, 0)}줄**`);
  lines.push('');
  lines.push(`## 자동 처리 추천 분포 (decision)`);
  lines.push('');
  lines.push(`| 결정 | 개수 | 설명 |`);
  lines.push(`|---|---|---|`);
  const decisionDesc = {
    flatten: '평탄화 (표/문장으로 변환 또는 삭제)',
    keep: '보존 (디자인 개편 세션에서 재처리)',
    skip: '다이어그램 의도 아님 (코드 슈도코드 등) — 무시',
  };
  for (const [d, n] of [...byDecision.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${d}\` | ${n} | ${decisionDesc[d] ?? ''} |`);
  }
  lines.push('');
  lines.push(`## 블록 유형 분포 (kind)`);
  lines.push('');
  lines.push(`| 유형 | 개수 | 설명 |`);
  lines.push(`|---|---|---|`);
  const kindDesc = {
    tree: '디렉토리/의존성 트리 (├ └ │ ─)',
    'flow-diagram': '박스 + 화살표 (흐름도/시퀀스)',
    architecture: '박스 다수 (아키텍처/스택)',
    'box-small': '단순 박스 (≤14줄)',
    'arrow-only': '박스 없는 화살표 시퀀스',
    'code-arrow': '코드 lang 안의 화살표 (슈도코드 가능성)',
    misc: '기타',
  };
  for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${k}\` | ${n} | ${kindDesc[k] ?? ''} |`);
  }
  lines.push('');
  lines.push(`## 글별 상세 (총 라인 수 내림차순)`);
  lines.push('');
  lines.push(`| 글 | 카테고리 | 시리즈 | 블록 | 총 라인 | flatten/keep/skip | 주요 유형 |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const item of inventory) {
    const kinds = [...new Set(item.blocks.map((b) => b.kind))].join(', ');
    const dCount = { flatten: 0, keep: 0, skip: 0 };
    for (const b of item.blocks) dCount[b.decision] = (dCount[b.decision] ?? 0) + 1;
    const decStr = `${dCount.flatten}/${dCount.keep}/${dCount.skip}`;
    lines.push(
      `| \`${item.file}\` | ${item.category ?? '-'} | ${item.series ?? '-'} | ${item.blockCount} | ${item.totalAsciiLines} | ${decStr} | ${kinds} |`
    );
  }
  lines.push('');
  lines.push(`## 블록 단위 상세`);
  lines.push('');
  for (const item of inventory) {
    lines.push(`### \`${item.file}\``);
    lines.push('');
    lines.push(`- 카테고리: ${item.category ?? '-'} / 시리즈: ${item.series ?? '-'}`);
    lines.push(`- 블록 ${item.blockCount}개 / ASCII ${item.totalAsciiLines}줄`);
    lines.push('');
    for (const b of item.blocks) {
      lines.push(
        `- L${b.startLine}-${b.endLine} (${b.lineCount}줄, lang=\`${b.lang || '-'}\`, kind=**${b.kind}**, decision=**${b.decision}**)`
      );
      lines.push(`  - 샘플: \`${b.sample.replace(/`/g, '\\`')}\``);
    }
    lines.push('');
  }

  fs.writeFileSync(OUT_MD, lines.join('\n'));
  console.log(`[scan] inventory.json + inventory.md 생성 — ${inventory.length}편, ${inventory.reduce((a, b) => a + b.blockCount, 0)}블록`);
}

main();
