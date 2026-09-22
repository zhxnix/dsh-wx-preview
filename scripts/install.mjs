#!/usr/bin/env node

import { lstat, mkdir, readFile, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const PLUGIN_ID = 'dsh-wx-preview';
const START = `# ${PLUGIN_ID}:start`;
const END = `# ${PLUGIN_ID}:end`;
const BLOCK = [
  START,
  '- insert:',
  `    - id: ${PLUGIN_ID}`,
  `      name: './plugins/${PLUGIN_ID}/lib/index.js'`,
  END
].join('\n');

function usage() {
  console.log(`Usage:\n  node scripts/install.mjs [--profile PATH]\n  node scripts/install.mjs --uninstall [--profile PATH]\n\nOptions:\n  --profile PATH   DSH profile directory or desktop/web/headless name\n  --uninstall      Remove this checkout link and marked loader block\n  --help           Show this message\n\nEnvironment:\n  DSH_PROFILE_DIR  Profile used when --profile is omitted`);
}

function parse(argv) {
  const options = {
    profile: process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh', 'profiles', 'desktop'),
    uninstall: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--uninstall') options.uninstall = true;
    else if (arg === '--profile') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--profile requires a value');
      options.profile = value;
    } else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function profilePath(value) {
  if (['desktop', 'web', 'headless'].includes(value)) return resolve(join(homedir(), '.dsh', 'profiles', value));
  return isAbsolute(value) ? resolve(value) : resolve(value);
}

async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function readOrEmpty(file) {
  try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

function addBlock(text) {
  const base = text && !text.endsWith('\n') ? `${text}\n` : text;
  return `${base}${BLOCK}\n`;
}

function removeBlock(text) {
  const escaped = BLOCK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(?:^|\\n)${escaped}(?:\\n|$)`), (match, offset) => offset === 0 ? '' : '\n');
}

async function install(profile) {
  const pluginLink = join(profile, 'plugins', PLUGIN_ID);
  const patchPath = join(profile, 'cordis.patch.yml');
  await mkdir(join(profile, 'plugins'), { recursive: true });
  if (await exists(pluginLink)) {
    const current = await realpath(pluginLink).catch(() => '');
    if (current !== root) throw new Error(`refusing to replace existing ${pluginLink}; it belongs to ${current || 'another file'}`);
  } else {
    await symlink(root, pluginLink);
    console.log(`Linked ${PLUGIN_ID} into ${profile}`);
  }
  const patch = await readOrEmpty(patchPath);
  if (patch.includes(START) || new RegExp(`id:\s*${PLUGIN_ID}`).test(patch)) {
    console.log(`Profile already loads ${PLUGIN_ID}`);
  } else {
    await writeFile(patchPath, addBlock(patch), 'utf8');
    console.log(`Added a marked loader block to ${patchPath}`);
  }
}

async function uninstall(profile) {
  const pluginLink = join(profile, 'plugins', PLUGIN_ID);
  if (await exists(pluginLink)) {
    const current = await realpath(pluginLink).catch(() => '');
    if (current !== root) throw new Error(`refusing to remove ${pluginLink}; it does not point to this checkout`);
    await unlink(pluginLink);
  }
  const patchPath = join(profile, 'cordis.patch.yml');
  const patch = await readOrEmpty(patchPath);
  const next = removeBlock(patch);
  if (next !== patch) await writeFile(patchPath, next, 'utf8');
  console.log(`Removed ${PLUGIN_ID}; restart DSH to unload it.`);
}

const options = parse(process.argv.slice(2));
if (options.help) usage();
else {
  const profile = profilePath(options.profile);
  if (options.uninstall) await uninstall(profile);
  else {
    execFileSync(process.execPath, [join(root, 'scripts', 'check.mjs')], { stdio: 'inherit' });
    await install(profile);
    console.log(`Installed ${PLUGIN_ID}; restart DSH to load it.`);
  }
}
