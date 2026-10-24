import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getPublicationDate, isPostPublished } from '../src/lib/publication.mjs';

test('한국 자정 직전까지 다음 날 글을 숨깁니다', () => {
  const today = getPublicationDate(new Date('2026-10-24T14:59:59.999Z'));
  assert.equal(today, '2026-10-24');
  assert.equal(isPostPublished('2026-10-23', today), true);
  assert.equal(isPostPublished('2026-10-24', today), true);
  assert.equal(isPostPublished('2026-10-25', today), false);
});

test('한국 자정부터 해당 날짜의 글을 공개합니다', () => {
  const today = getPublicationDate(new Date('2026-10-24T15:00:00.000Z'));
  assert.equal(today, '2026-10-25');
  assert.equal(isPostPublished('2026-10-25', today), true);
});

test('연도 변경과 윤년에도 비교 가능한 날짜를 반환합니다', () => {
  assert.equal(getPublicationDate(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
  assert.equal(getPublicationDate(new Date('2028-02-28T15:00:00Z')), '2028-02-29');
});

test('postbuild는 미래 글과 logs를 공개 인덱스에서 제외합니다', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'out'));

  const today = getPublicationDate();
  const future = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const fixtures = [
    ['essays', 'past-post', '2000-01-01'],
    ['essays', 'today-post', today],
    ['essays', 'future-post', future],
    ['logs', 'private-log', today],
    ['logs', 'future-log', future],
  ];
  for (const [track, slug, date] of fixtures) {
    const directory = path.join(root, 'src/content', track, 'kubernetes');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, `${slug}.md`),
      `---\ntitle: "${slug}"\ncategory: kubernetes\ndate: "${date}"\n---\n본문\n`,
    );
  }

  execFileSync(process.execPath, [fileURLToPath(new URL('./postbuild.mjs', import.meta.url))], {
    cwd: root,
    stdio: 'pipe',
  });

  for (const file of ['sitemap.xml', 'feed.xml', 'llms.txt']) {
    const output = fs.readFileSync(path.join(root, 'out', file), 'utf8');
    assert(output.includes('/essays/past-post/'), file);
    assert(output.includes('/essays/today-post/'), file);
    assert(!output.includes('future-post'), file);
    assert(!output.includes('private-log'), file);
    assert(!output.includes('future-log'), file);
  }
});
