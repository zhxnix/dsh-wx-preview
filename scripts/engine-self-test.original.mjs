#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '..');
const nativeFixture = path.join(pluginRoot, 'tests', 'fixtures', 'native-project');
const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wxpreview-self-test-'));
const previousHome = process.env.WXPREVIEW_HOME;
process.env.WXPREVIEW_HOME = temporaryHome;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

async function main() {
  let projectModule;
  let precompileModule;
  try {
    projectModule = await import('../src/project.mjs');
    precompileModule = await import('../src/precompile.mjs');
  } catch (error) {
    throw new Error(`无法加载 wxpreview 运行时依赖，请先在插件目录安装依赖：${error.message}`);
  }

  const { discoverNativeProjects, resolveNativeProject } = projectModule;
  const { precompileProject, cacheDirectoryFor } = precompileModule;

  // 1. 项目识别：project.config.json + miniprogramRoot 应解析为原生项目。
  const discovered = discoverNativeProjects(nativeFixture);
  assert.equal(discovered.length, 1, '应识别出一个原生小程序项目');
  assert.equal(discovered[0].framework, 'native');
  assert.equal(discovered[0].name, 'wxpreview-native-fixture');
  assert.equal(path.basename(discovered[0].sourceRoot), 'miniprogram');

  const project = resolveNativeProject(nativeFixture);
  assert.equal(project.sourceRoot, discovered[0].sourceRoot);
  assert.equal(project.appConfig.subpackages[0].root, 'pkg');

  // 2. 首次预编译：页面、分包页面、自定义组件和兼容性信息均应进入 manifest。
  const first = await precompileProject(nativeFixture, { force: true });
  assert.equal(first.state.reused, false, '强制首次预编译不应复用旧缓存');
  assert.deepEqual(first.manifest.pageRoutes, [
    'pages/login/login',
    'pages/home/home',
    'pkg/detail/detail'
  ]);
  assert.deepEqual(first.manifest.componentRoutes, ['components/preview-card/index']);
  assert.ok(first.manifest.pages['pages/login/login']);
  assert.ok(first.manifest.pages['pkg/detail/detail']);
  assert.ok(first.manifest.components['components/preview-card/index']);
  assert.ok(first.manifest.app.config.tabBar.list.some((item) => item.pagePath === 'pages/home/home'));

  const compatibility = first.manifest.compatibility;
  for (const api of ['getStorageSync', 'setStorageSync', 'getUserProfile', 'login']) {
    assert.ok(compatibility.usedWxApis.includes(api), `应扫描到 wx.${api}`);
  }
  assert.ok(compatibility.storageKeys.includes('token'));
  assert.ok(compatibility.storageKeys.includes('isLoggedIn'));
  assert.ok(compatibility.authScopes.includes('scope.userInfo'));
  assert.deepEqual(compatibility.loginRoutes, ['pages/login/login']);

  // 3. 首次预编译生成本地身份；第二次应命中指纹缓存并保留身份。
  assert.equal(first.identity.autoLogin, true);
  assert.equal(first.identity.profile.nickName, '预览用户');
  assert.match(first.identity.profile.avatarUrl, /^cloud:\/\//, '自动登录身份应包含可通过常见资料完整性检查的本地头像');
  assert.equal(first.identity.storage.userInfo.avatarUrl, first.identity.profile.avatarUrl);
  assert.equal(first.identity.storage.token, first.identity.token);
  assert.equal(first.identity.storage.isLoggedIn, true);
  assert.equal(first.identity.scopes['scope.userInfo'], true);
  assert.ok(fs.existsSync(path.join(cacheDirectoryFor(project), 'identity.json')));
  assert.ok(fs.existsSync(path.join(cacheDirectoryFor(project), 'manifest.json')));

  const second = await precompileProject(nativeFixture);
  assert.equal(second.state.reused, true, '源码未变化时第二次预编译应复用缓存');
  assert.equal(second.identity.token, first.identity.token, '本地身份 token 应跨预编译保持稳定');
  assert.equal(second.identity.profile.nickName, '预览用户');

  // 4. 当前版本明确拒绝 uni-app；这里用临时项目避免污染 native fixture。
  const uniProject = fs.mkdtempSync(path.join(os.tmpdir(), 'wxpreview-uni-fixture-'));
  try {
    writeJson(path.join(uniProject, 'project.config.json'), {
      projectname: 'wxpreview-uni-fixture',
      miniprogramRoot: '.'
    });
    writeJson(path.join(uniProject, 'app.json'), { pages: ['pages/index/index'] });
    writeFile(path.join(uniProject, 'app.js'), 'import { createSSRApp } from "vue";\ncreateSSRApp({});\n');
    assert.throws(
      () => resolveNativeProject(uniProject),
      (error) => /只支持原生微信小程序/.test(error.message) && /uni-app/.test(error.message),
      'uni-app 项目应被明确拒绝'
    );
  } finally {
    fs.rmSync(uniProject, { recursive: true, force: true });
  }

  console.log('wxpreview self-test passed');
  console.log(`  native project: ${project.projectRoot}`);
  console.log(`  pages: ${first.manifest.pageRoutes.length}`);
  console.log(`  components: ${first.manifest.componentRoutes.length}`);
  console.log(`  cached identity: ${first.identity.profile.nickName}`);
}

try {
  await main();
} catch (error) {
  console.error(`wxpreview self-test failed: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  if (previousHome === undefined) delete process.env.WXPREVIEW_HOME;
  else process.env.WXPREVIEW_HOME = previousHome;
  fs.rmSync(temporaryHome, { recursive: true, force: true });
}
