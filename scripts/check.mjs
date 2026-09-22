#!/usr/bin/env node

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
  'src/host-service.mjs',
  'src/client.js',
  'lib/index.js',
  'lib/engine.js',
  'lib/client.js',
  'web/backend.js',
  'web/main.js',
  'web/runtime.js',
  'scripts/cli.mjs',
  'scripts/self-test.mjs',
  'scripts/install.mjs'
];
for (const relative of files) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`缺少文件：${relative}`);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${relative} 语法检查失败：\n${result.stderr || result.stdout}`);
}
if (fs.existsSync(path.join(root, 'mcp'))) throw new Error('独立插件不应携带 Codex MCP 目录');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.name !== 'dsh-wx-preview') throw new Error('插件名称必须是 dsh-wx-preview');
if (pkg.dependencies?.['@modelcontextprotocol/sdk']) throw new Error('不应依赖 Codex MCP SDK');
process.stdout.write(`dsh-wx-preview syntax check passed (${files.length} files)\n`);
