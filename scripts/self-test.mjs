#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(root, 'examples', 'native-mini-miniprogram');
const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-wx-preview-test-'));
const previousHome = process.env.DSH_WX_PREVIEW_HOME;
process.env.DSH_WX_PREVIEW_HOME = temporaryHome;

try {
  const { discoverNativeProjects, resolveNativeProject } = await import('../src/project.mjs');
  const { precompileProject } = await import('../src/precompile.mjs');
  const { startPreview } = await import('../src/preview-server.mjs');

  const discovered = discoverNativeProjects(example);
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].framework, 'native');
  assert.equal(discovered[0].name, 'dsh-wx-preview-example');
  const project = resolveNativeProject(example);
  assert.equal(path.basename(project.sourceRoot), 'miniprogram');

  const compiled = await precompileProject(project, { force: true });
  assert.deepEqual(compiled.manifest.pageRoutes, ['pages/index/index']);
  assert.equal(compiled.manifest.project.sourceRoot, project.sourceRoot);
  const nodes = compiled.manifest.pages['pages/index/index'].template;
  assert.equal(nodes[0].sourceFile, path.join(project.sourceRoot, 'pages/index/index.wxml'));
  assert.equal(nodes[0].sourceLine, 1);
  assert.match(compiled.bundles.app, /__mpSetLoading/);

  const cached = await precompileProject(project);
  assert.equal(cached.state.reused, true);
  assert.equal(cached.identity.profile.nickName, '预览用户');

  const session = await startPreview(project, { route: 'pages/index/index' });
  try {
    const endpoint = new URL('/__wxpreview/status', session.url).href;
    const response = await fetch(endpoint);
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.ready, true);
    assert.equal(status.project.id, project.id);
  } finally {
    await session.close();
  }

  console.log('dsh-wx-preview self-test passed');
  console.log(`  project: ${project.projectRoot}`);
  console.log(`  pages: ${compiled.manifest.pageRoutes.length}`);
  console.log(`  source marker: ${nodes[0].sourceFile}:${nodes[0].sourceLine}`);
} finally {
  if (previousHome === undefined) delete process.env.DSH_WX_PREVIEW_HOME;
  else process.env.DSH_WX_PREVIEW_HOME = previousHome;
  fs.rmSync(temporaryHome, { recursive: true, force: true });
}
