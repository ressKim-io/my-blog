import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = path.join(root, 'src/content');

try {
  const event = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (typeof event.cwd !== 'string' || typeof event.tool_input?.command !== 'string') {
    throw new Error('lint-post hook requires cwd and tool_input.command');
  }

  const files = new Set();
  // apply_patch can update several files and rename a post in the same call.
  for (const match of event.tool_input.command.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)\r?$/gm)) {
    const candidate = path.resolve(event.cwd, match[1].trim());
    if (!fs.existsSync(candidate)) continue;
    const file = fs.realpathSync(candidate);
    const relative = path.relative(contentRoot, file);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
    if (file.endsWith('.md') && fs.statSync(file).isFile()) files.add(file);
  }

  if (files.size > 0) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/lint-post.mjs'), ...files], {
      cwd: root,
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.stderr.write(result.stdout + result.stderr);
      if (result.signal) process.stderr.write(`lint-post terminated by ${result.signal}\n`);
      process.exitCode = 2;
    }
  }
} catch (error) {
  console.error(`lint-post hook: ${error.message}`);
  process.exitCode = 2;
}
