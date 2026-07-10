#!/usr/bin/env node
/**
 * 블로그 글 0토큰 기계 검증 — 직역투 렉시콘 + 문체·구조 규칙
 *
 * 사용:  node scripts/lint-post.mjs <file.md ...>     (repo 루트에서 실행)
 *        npm run lint:post -- src/content/essays/runtime/foo.md
 * exit:  0 = error 없음 / 1 = error 존재 (warn은 exit code에 영향 없음)
 *
 * 렉시콘(LEXICON)을 바꾸면 .claude/skills/draft-to-post/SKILL.md의 어휘 표도 함께 갱신할 것.
 * 파일 인자 필수 — 레거시 300+편 일괄 스캔용이 아님 (runtime 시리즈 등 신규 문체 글 대상).
 */
import fs from 'node:fs';
import path from 'node:path';

// ── 직역투 렉시콘: 빈도·성능을 온도·신체동작으로 옮긴 영어 은유 직역 ──
// unless: 같은 줄에서 매치되면 허용 (keep-list — 자연스러운 한국어 용법)
const LEXICON = [
  {
    id: '직역:hot', level: 'error',
    re: /뜨거운|뜨겁|뜨거워/,
    fix: '자주 실행되는 · 자주 불리는 · 핫(hot, 첫 등장에 풀이 병기)',
  },
  {
    id: '직역:crawl', level: 'error',
    re: /기어가|기어간|기어갑/,
    fix: '크게 느려진다 · 한참 걸린다',
  },
  {
    id: '직역:paralyze', level: 'error',
    re: /마비/,
    unless: /서비스\s?(?:가|는|를)?\s?마비/, // "서비스 마비"급 대규모 장애 서술은 자연스러운 한국어
    fix: '감당하지 못한다 · 큐가 밀린다',
  },
  {
    id: '직역:steal', level: 'error',
    re: /훔쳐|훔치/,
    unless: /훔쳐\s?[보볼봤]|훔쳐\s?[오옵온올]|훔치기/, // 엿보다 뜻 "훔쳐보다", work stealing 풀이 "훔쳐 오다"
    fix: '가져가 쓴다 · 잠식한다',
  },
  {
    id: '직역:feed', level: 'error',
    re: /(?:컴파일|빌드)에\s?되?먹이|되먹이|되먹입/,
    fix: '반영한다 · 입력으로 준다',
  },
  {
    id: '직역:expensive', level: 'warn', // 개발자 관용 수준이라 warn — 신규 글부터 지양
    re: /(?:연산|컴파일|호출|콜)[은는이가을]?\s?(?:특히\s?)?비싸/,
    fix: '비용이 크다 · 시간이 많이 든다',
  },
];

// 파일럿(1.1)은 마침표 유지 상태로 발행 승인됨 — 마침표 검사만 제외
const LEGACY_PERIOD_OK = new Set(['syscall-mode-switch-cost']);

const BOX_CHARS = /[┌┐└┘├┤│─]/;
// 격식체 위반 — 종결 위치의 해요체만 (어요/아요/세요/네요/이에요/예요 등).
// '필요·중요' 같은 명사는 앞 글자 제한으로 제외, 허용 표현 ~죠·~까요?는 검출하지 않음
const POLITE_INFORMAL = /(?:[어아여워봐줘돼해세네데래예]|이에)요(?=[\s.,!?~")\]]|$)/;
const SVG_TEXT_WARN_MAX = 16;
const SVG_FONT_MIN = 13;
const LINE_LEN_WARN = 100;

const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (files.length === 0) {
  console.error('사용법: node scripts/lint-post.mjs <file.md ...>');
  process.exit(2);
}

let totalErrors = 0;
let totalWarns = 0;

function snippet(line, re) {
  const m = line.match(re);
  if (!m) return line.slice(0, 40);
  const i = Math.max(0, m.index - 12);
  return (i > 0 ? '…' : '') + line.slice(i, m.index + m[0].length + 14).trim() + '…';
}

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`✗ 파일 없음: ${file}`);
    totalErrors++;
    continue;
  }
  const slug = path.basename(file, '.md');
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const findings = []; // {line, level, id, msg}

  // ── 상태 추적: front matter / 코드블록 ──
  let inCode = false;
  let inFm = false;
  let fmDone = false;
  let fmText = '';
  let longLines = 0;

  lines.forEach((line, idx) => {
    const n = idx + 1;

    // front matter 경계
    if (!fmDone && line.trim() === '---') {
      if (n === 1) { inFm = true; return; }
      if (inFm) { inFm = false; fmDone = true; return; }
    }
    if (inFm) { fmText += line + '\n'; }

    // 코드 펜스
    const fence = line.match(/^\s*```(\S*)/);
    if (fence) {
      if (!inCode && !inFm) {
        if (fence[1] === '') findings.push({ line: n, level: 'error', id: '펜스lang', msg: '코드블록 언어 미지정 (```bash, ```text 등 명시)' });
        inCode = true;
      } else if (inCode) {
        inCode = false;
      }
      return;
    }
    if (inCode) return; // 코드블록 내부는 문체·렉시콘 검사 제외

    // 직역투 렉시콘 (front matter의 title/excerpt 포함 전체 산문)
    for (const rule of LEXICON) {
      if (rule.re.test(line) && !(rule.unless && rule.unless.test(line))) {
        findings.push({ line: n, level: rule.level, id: rule.id, msg: `"${snippet(line, rule.re)}" → ${rule.fix}` });
      }
    }

    // 해요체
    if (POLITE_INFORMAL.test(line)) {
      findings.push({ line: n, level: 'error', id: '해요체', msg: `"${snippet(line, POLITE_INFORMAL)}" — 격식체(-습니다)로` });
    }

    if (inFm) return; // 이하 구조 검사는 본문만

    // 박스 문자
    if (BOX_CHARS.test(line)) {
      findings.push({ line: n, level: 'error', id: '박스문자', msg: '코드블록 밖 박스 문자 — 표/SVG/산문으로 평탄화' });
    }

    // 문단·불릿 끝 마침표
    if (!LEGACY_PERIOD_OK.has(slug)) {
      const t = line.trimEnd();
      if (/\.$/.test(t) && !/https?:\/\/\S+\.$/.test(t)) {
        findings.push({ line: n, level: 'error', id: '끝마침표', msg: `"…${t.slice(-30)}" — 단락 끝 마침표 생략` });
      }
    }

    // 100자 초과 (통계용 warn)
    if (!line.startsWith('|') && !line.startsWith('![') && [...line].length > LINE_LEN_WARN) longLines++;
  });

  if (longLines > 0) {
    findings.push({ line: 0, level: 'warn', id: '문장길이', msg: `${LINE_LEN_WARN}자 초과 줄 ${longLines}곳 — 분리 검토` });
  }

  // ── front matter 필수 필드 ──
  if (!fmDone) {
    findings.push({ line: 1, level: 'error', id: 'frontmatter', msg: 'front matter 블록(---) 없음' });
  } else {
    for (const key of ['title', 'excerpt', 'category', 'tags', 'date']) {
      if (!new RegExp(`^${key}:`, 'm').test(fmText)) {
        findings.push({ line: 1, level: 'error', id: 'frontmatter', msg: `필수 필드 누락: ${key}` });
      }
    }
    if (/^series:/m.test(fmText)) {
      if (!/^\s+name:/m.test(fmText) || !/^\s+order:/m.test(fmText)) {
        findings.push({ line: 1, level: 'error', id: 'frontmatter', msg: 'series에 name/order 쌍 누락' });
      }
    }
  }

  // ── 이미지 참조 실존 + SVG 품질 ──
  const imgRe = /!\[[^\]]*\]\((\/(?:diagrams|images)\/[^)]+?)\)/g;
  let m;
  while ((m = imgRe.exec(raw)) !== null) {
    const ref = m[1];
    const lineNo = raw.slice(0, m.index).split('\n').length;
    const p = path.join('public', ref);
    if (!fs.existsSync(p)) {
      findings.push({ line: lineNo, level: 'error', id: '이미지', msg: `참조 파일 없음: ${ref}` });
      continue;
    }
    if (ref.endsWith('.svg')) {
      const svg = fs.readFileSync(p, 'utf8');
      if (!svg.trimEnd().endsWith('</svg>')) {
        findings.push({ line: lineNo, level: 'error', id: 'SVG', msg: `${ref} — </svg>로 끝나지 않음 (파손 의심)` });
      }
      const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((x) => parseFloat(x[1]));
      const minFont = sizes.length ? Math.min(...sizes) : null;
      if (minFont !== null && minFont < SVG_FONT_MIN) {
        findings.push({ line: lineNo, level: 'error', id: 'SVG', msg: `${ref} — 폰트 ${minFont}px < 하한 ${SVG_FONT_MIN}px` });
      }
      const texts = (svg.match(/<text[\s>]/g) || []).length;
      if (texts > SVG_TEXT_WARN_MAX) {
        findings.push({ line: lineNo, level: 'warn', id: 'SVG', msg: `${ref} — <text> ${texts}개 > 목표 ${SVG_TEXT_WARN_MAX}` });
      }
    }
  }

  // ── 리포트 ──
  const errs = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  totalErrors += errs.length;
  totalWarns += warns.length;

  if (findings.length === 0) {
    console.log(`✓ ${file}`);
  } else {
    console.log(`${file}`);
    findings.sort((a, b) => a.line - b.line);
    for (const f of findings) {
      const loc = f.line > 0 ? `L${String(f.line).padStart(3)}` : '  — ';
      console.log(`  ${loc} ${f.level === 'error' ? '✗' : '△'} [${f.id}] ${f.msg}`);
    }
    console.log(`  요약: error ${errs.length} · warn ${warns.length}`);
  }
}

console.log(`\n전체: error ${totalErrors} · warn ${totalWarns} (파일 ${files.length}개)`);
process.exit(totalErrors > 0 ? 1 : 0);
