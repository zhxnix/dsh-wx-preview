import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'src/project.mjs',
  'src/compiler.mjs',
  'src/precompile.mjs',
  'src/preview-server.mjs',
  'mcp/server.mjs',
  'web/backend.js',
  'web/main.js',
  'web/runtime.js',
  'scripts/cli.mjs',
  'scripts/mcp-smoke.mjs',
  'scripts/self-test.mjs'
];
for (const relative of files) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`缺少文件：${relative}`);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${relative} 语法检查失败：\n${result.stderr || result.stdout}`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
if (manifest.name !== 'wxpreview') throw new Error('插件名称必须是 wxpreview');
process.stdout.write(`wxpreview syntax check passed (${files.length} files)\n`);
