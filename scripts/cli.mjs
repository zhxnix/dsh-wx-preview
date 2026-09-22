#!/usr/bin/env node
import process from 'node:process';
import { discoverNativeProjects } from '../src/project.mjs';
import { precompileProject, updateProjectIdentity } from '../src/precompile.mjs';
import { startPreview } from '../src/preview-server.mjs';

function parseArguments(values) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const [rawKey, inline] = value.slice(2).split('=', 2);
    const next = values[index + 1];
    if (inline !== undefined) flags[rawKey] = inline;
    else if (next && !next.startsWith('--')) { flags[rawKey] = next; index += 1; }
    else flags[rawKey] = true;
  }
  return { positional, flags };
}

function help() {
  process.stdout.write(`dsh-wx-preview · 原生微信小程序 DSH 预览\n\n`);
  process.stdout.write(`用法：\n`);
  process.stdout.write(`  wxpreview discover <目录>\n`);
  process.stdout.write(`  wxpreview precompile <项目目录> [--force]\n`);
  process.stdout.write(`  dsh-wx-preview serve <项目目录> [--port 4173] [--route pages/index/index]\n`);
  process.stdout.write(`  dsh-wx-preview identity <项目目录> [--nickname 预览用户] [--auto-login true]\n`);
}

const { positional, flags } = parseArguments(process.argv.slice(2));
const command = positional[0];
const projectPath = positional[1] || process.cwd();

try {
  if (!command || flags.help || ['help', '-h', '--help'].includes(command)) {
    help();
  } else if (command === 'discover') {
    process.stdout.write(`${JSON.stringify(discoverNativeProjects(projectPath), null, 2)}\n`);
  } else if (command === 'precompile') {
    const result = await precompileProject(projectPath, { force: Boolean(flags.force) });
    process.stdout.write(`${JSON.stringify({ cacheDir: result.cacheDir, ...result.state }, null, 2)}\n`);
  } else if (command === 'identity') {
    const patch = {};
    if (flags.nickname) patch.profile = { nickName: String(flags.nickname) };
    if (flags['auto-login'] !== undefined) patch.autoLogin = !['false', '0', 'no'].includes(String(flags['auto-login']).toLowerCase());
    const result = await updateProjectIdentity(projectPath, patch);
    process.stdout.write(`${JSON.stringify({ cacheDir: result.cacheDir, identity: result.identity }, null, 2)}\n`);
  } else if (command === 'serve') {
    const session = await startPreview(projectPath, {
      port: flags.port ? Number(flags.port) : 0,
      route: flags.route ? String(flags.route) : undefined,
      force: Boolean(flags.force),
      logLevel: 'info'
    });
    process.stdout.write(`wxpreview ready: ${session.url}\n`);
    process.stdout.write(`project: ${session.project.projectRoot}\n`);
    const stop = async () => { await session.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    await new Promise(() => {});
  } else {
    help();
    process.exitCode = 1;
  }
} catch (error) {
    process.stderr.write(`dsh-wx-preview: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
