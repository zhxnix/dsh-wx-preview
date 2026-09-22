import fs from 'node:fs';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { parseDocument } from 'htmlparser2';
import postcss from 'postcss';

const BUILTIN_SELECTOR_NAMES = [
  'ad', 'audio', 'button', 'camera', 'canvas', 'checkbox', 'checkbox-group',
  'cover-image', 'cover-view', 'editor', 'form', 'icon', 'image', 'input',
  'label', 'live-player', 'live-pusher', 'map', 'match-media', 'movable-area',
  'movable-view', 'navigator', 'official-account', 'open-data', 'page-container',
  'picker', 'picker-view', 'picker-view-column', 'progress', 'radio', 'radio-group',
  'rich-text', 'root-portal', 'scroll-view', 'share-element', 'slider', 'slot',
  'swiper', 'swiper-item', 'switch', 'text', 'textarea', 'video', 'view', 'web-view'
];

const SUPPORTED_WX_APIS = new Set([
  'authorize', 'canIUse', 'checkSession', 'clearStorage', 'clearStorageSync',
  'createAnimation', 'createSelectorQuery', 'downloadFile',
  'getAccountInfoSync', 'getAppBaseInfo', 'getClipboardData', 'getDeviceInfo',
  'getFileSystemManager', 'getMenuButtonBoundingClientRect', 'getNetworkType',
  'getPrivacySetting', 'getSetting', 'getStorage', 'getStorageInfo', 'getStorageInfoSync', 'getStorageSync',
  'getSystemInfo', 'getSystemInfoSync', 'getUserInfo', 'getUserProfile', 'getWindowInfo', 'hideLoading',
  'login', 'navigateBack', 'navigateTo', 'openSetting', 'redirectTo', 'reLaunch',
  'removeStorage', 'removeStorageSync', 'request', 'requirePrivacyAuthorize', 'setClipboardData',
  'setNavigationBarColor', 'setNavigationBarTitle', 'setStorage', 'setStorageSync', 'showActionSheet', 'showLoading', 'showModal', 'showToast',
  'stopPullDownRefresh', 'switchTab', 'uploadFile'
]);

const readOptional = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const readJsonOptional = (file) => readOptional(file) ? JSON.parse(readOptional(file)) : {};
const normalizeRoute = (value) => String(value || '').replace(/^\/+/, '').replace(/\.(?:js|json|wxml|wxss)$/, '');
const toPosix = (value) => value.split(path.sep).join('/');

function templateAst(source, file, sourceRoot) {
  const document = parseDocument(source, {
    xmlMode: true,
    decodeEntities: false,
    recognizeSelfClosing: true,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    withStartIndices: true
  });
  const lineAt = (index) => {
    if (!Number.isInteger(index) || index < 0) return undefined;
    let line = 1;
    for (let cursor = 0; cursor < index; cursor += 1) {
      if (source.charCodeAt(cursor) === 10) line += 1;
    }
    return line;
  };
  const serialize = (node) => {
    if (node.type === 'text') return { type: 'text', value: node.data || '' };
    if (!['tag', 'script', 'style'].includes(node.type)) return null;
    const attrs = { ...(node.attribs || {}) };
    for (const name of ['src', 'poster']) {
      const value = attrs[name];
      if (!value || value.includes('{{') || /^(?:data:|https?:|\/\/|cloud:\/\/|\/)/.test(value)) continue;
      const absolute = path.resolve(path.dirname(file), value);
      const relative = toPosix(path.relative(sourceRoot, absolute));
      if (!relative.startsWith('..')) attrs[name] = `/${relative}`;
    }
    return {
      type: 'element',
      name: node.name,
      attrs,
      sourceFile: path.resolve(file),
      sourceLine: lineAt(node.startIndex),
      children: (node.children || []).map(serialize).filter(Boolean)
    };
  };
  const nodes = (document.children || []).map(serialize).filter(Boolean);
  if (!nodes.length && source.trim()) throw new Error(`无法解析 WXML：${file}`);
  return nodes;
}

function resolveWxmlRequest(fromFile, request) {
  const withExtension = path.extname(request) ? request : `${request}.wxml`;
  return path.resolve(path.dirname(fromFile), withExtension);
}

function collectTemplates(file, sourceRoot, stack = new Set()) {
  if (!fs.existsSync(file)) return { nodes: [], templates: {}, dependencies: [] };
  const resolved = path.resolve(file);
  if (stack.has(resolved)) return { nodes: [], templates: {}, dependencies: [] };
  const nextStack = new Set(stack).add(resolved);
  const ast = templateAst(fs.readFileSync(resolved, 'utf8'), resolved, sourceRoot);
  const templates = {};
  const dependencies = [resolved];
  const processNodes = (nodes) => {
    const output = [];
    for (const node of nodes) {
      if (node.type !== 'element') { output.push(node); continue; }
      if (node.name === 'wxs') continue;
      if (node.name === 'import' && node.attrs?.src) {
        const imported = collectTemplates(resolveWxmlRequest(resolved, node.attrs.src), sourceRoot, nextStack);
        Object.assign(templates, imported.templates);
        dependencies.push(...imported.dependencies);
        continue;
      }
      if (node.name === 'include' && node.attrs?.src) {
        const included = collectTemplates(resolveWxmlRequest(resolved, node.attrs.src), sourceRoot, nextStack);
        output.push(...included.nodes);
        Object.assign(templates, included.templates);
        dependencies.push(...included.dependencies);
        continue;
      }
      if (node.name === 'template' && node.attrs?.name) {
        templates[node.attrs.name] = processNodes(node.children || []);
        continue;
      }
      output.push({ ...node, children: processNodes(node.children || []) });
    }
    return output;
  };
  const output = processNodes(ast);
  return { nodes: output, templates, dependencies: Array.from(new Set(dependencies)) };
}

function inlineWxss(file, stack = new Set()) {
  if (!file || !fs.existsSync(file)) return '';
  const resolved = path.resolve(file);
  if (stack.has(resolved)) return '';
  const nextStack = new Set(stack).add(resolved);
  const source = fs.readFileSync(resolved, 'utf8');
  return source.replace(/@import\s+["']([^"']+)["']\s*;?/g, (_, request) => {
    const imported = path.resolve(path.dirname(resolved), request);
    return inlineWxss(imported, nextStack);
  });
}

function rewriteCssUrls(source, wxssFile, sourceRoot) {
  const directory = path.dirname(wxssFile);
  return source.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (all, quote, request) => {
    const value = request.trim();
    if (/^(?:data:|https?:|\/\/|#|var\()/.test(value)) return all;
    const absolute = value.startsWith('/') ? path.join(sourceRoot, value) : path.resolve(directory, value);
    const relative = toPosix(path.relative(sourceRoot, absolute));
    if (relative.startsWith('..')) return all;
    return `url(${quote}/${relative}${quote})`;
  });
}

function isInsideKeyframes(rule) {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name || '')) return true;
    parent = parent.parent;
  }
  return false;
}

const builtinPattern = new RegExp(`(^|[\\s>+~,(])(${BUILTIN_SELECTOR_NAMES.join('|')})(?=$|[\\s>+~.#:[,)])`, 'g');

function transformWxss(source, scope, wxssFile, sourceRoot) {
  if (!source.trim()) return '';
  const safeAreaVariables = { top: '--mp-safe-area-top', bottom: '--mp-safe-area-bottom', left: '--mp-safe-area-left', right: '--mp-safe-area-right' };
  const normalized = rewriteCssUrls(source, wxssFile, sourceRoot)
    .replace(/(?:env|constant)\(safe-area-inset-(top|bottom|left|right)(?:\s*,[^)]*)?\)/g, (_, edge) => `var(${safeAreaVariables[edge]}, 0px)`)
    .replace(/(-?(?:\d+\.?\d*|\.\d+))rpx\b/g, 'calc($1 * var(--rpx))')
    .replace(/(-?(?:\d+\.?\d*|\.\d+))vh\b/g, 'calc($1 * var(--mp-vh))')
    .replace(/(-?(?:\d+\.?\d*|\.\d+))vw\b/g, 'calc($1 * var(--mp-vw))');
  const root = postcss.parse(normalized, { from: wxssFile });
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;
    rule.selectors = (rule.selectors || [rule.selector]).map((rawSelector) => {
      const selector = rawSelector.trim()
        .replace(/(^|[\s>+~,])page(?=$|[\s>+~.#:[,])/g, '$1.mp-page')
        .replace(builtinPattern, (_, prefix, name) => `${prefix}:where([data-mp-builtin="${name}"])`);
      if (!scope) return selector;
      if (selector.includes(':host')) return selector.replace(/:host/g, scope);
      return `${scope} ${selector}`;
    });
  });
  return root.toString();
}

function allPageRoutes(appConfig) {
  const pages = (appConfig.pages || []).map(normalizeRoute);
  for (const group of appConfig.subpackages || appConfig.subPackages || []) {
    const root = normalizeRoute(group.root || '');
    for (const page of group.pages || []) pages.push(normalizeRoute(`${root}/${page}`));
  }
  return Array.from(new Set(pages));
}

function resolveComponentTarget(sourceRoot, ownerRoute, target) {
  if (!target || /^(?:plugin|ext):\/\//.test(target)) return target;
  const ownerDirectory = path.posix.dirname(ownerRoute);
  let relative;
  if (target.startsWith('/')) relative = normalizeRoute(target);
  else if (target.startsWith('.')) relative = normalizeRoute(path.posix.normalize(path.posix.join(ownerDirectory, target)));
  else {
    const npmCandidate = path.join(sourceRoot, 'miniprogram_npm', target);
    relative = fs.existsSync(`${npmCandidate}.json`) || fs.existsSync(path.join(npmCandidate, 'index.json'))
      ? normalizeRoute(toPosix(path.relative(sourceRoot, npmCandidate)))
      : normalizeRoute(target);
  }
  if (fs.existsSync(path.join(sourceRoot, `${relative}.json`))) return relative;
  if (fs.existsSync(path.join(sourceRoot, relative, 'index.json'))) return `${relative}/index`;
  return relative;
}

function normalizedUsingComponents(config, sourceRoot, ownerRoute) {
  return Object.fromEntries(Object.entries(config.usingComponents || {}).map(([tag, target]) => [
    tag,
    resolveComponentTarget(sourceRoot, ownerRoute, target)
  ]));
}

function discoverComponents(sourceRoot, appConfig, pageRoutes, warnings) {
  const queue = [];
  const found = new Set();
  const enqueueFrom = (config, ownerRoute) => {
    for (const [tag, target] of Object.entries(normalizedUsingComponents(config, sourceRoot, ownerRoute))) {
      if (/^(?:plugin|ext):\/\//.test(target)) {
        warnings.push({ code: 'EXTERNAL_COMPONENT', file: `${ownerRoute}.json`, message: `${tag} 使用 ${target}，浏览器预览只显示占位。` });
      } else if (!found.has(target)) queue.push(target);
    }
  };
  enqueueFrom(appConfig, 'app');
  for (const route of pageRoutes) enqueueFrom(readJsonOptional(path.join(sourceRoot, `${route}.json`)), route);
  if (fs.existsSync(path.join(sourceRoot, 'custom-tab-bar', 'index.json'))) queue.push('custom-tab-bar/index');
  while (queue.length) {
    const route = normalizeRoute(queue.shift());
    if (!route || found.has(route)) continue;
    const configFile = path.join(sourceRoot, `${route}.json`);
    if (!fs.existsSync(configFile)) {
      warnings.push({ code: 'MISSING_COMPONENT', file: configFile, message: `找不到组件 ${route}` });
      continue;
    }
    found.add(route);
    enqueueFrom(readJsonOptional(configFile), route);
  }
  return Array.from(found).sort();
}

function makeArtifact(sourceRoot, route, kind, inheritedUsingComponents = {}) {
  const base = path.join(sourceRoot, route);
  const config = readJsonOptional(`${base}.json`);
  const wxmlFile = `${base}.wxml`;
  const wxssFile = `${base}.wxss`;
  const parsed = collectTemplates(wxmlFile, sourceRoot);
  const scope = kind === 'page' ? `[data-mp-page="${route}"]` : `[data-mp-component="${route}"]`;
  return {
    route,
    kind,
    directory: toPosix(path.posix.dirname(route)),
    config: {
      ...config,
      usingComponents: {
        ...inheritedUsingComponents,
        ...normalizedUsingComponents(config, sourceRoot, route)
      }
    },
    template: parsed.nodes,
    templates: parsed.templates,
    style: transformWxss(inlineWxss(wxssFile), scope, wxssFile, sourceRoot)
  };
}

function scanSource(project, files) {
  const warnings = [];
  const usedWxApis = new Set();
  const storageKeys = new Set();
  const authScopes = new Set();
  let wxsCount = 0;
  for (const file of files) {
    const extension = path.extname(file);
    if (extension === '.wxs') wxsCount += 1;
    if (!['.js', '.ts', '.wxml'].includes(extension)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bwx\.([A-Za-z_$][\w$]*)/g)) usedWxApis.add(match[1]);
    for (const match of source.matchAll(/(?:get|set|remove)Storage(?:Sync)?\(\s*["']([^"']+)["']/g)) storageKeys.add(match[1]);
    for (const match of source.matchAll(/scope\s*:\s*["']([^"']+)["']/g)) authScopes.add(match[1]);
  }
  if (wxsCount) warnings.push({ code: 'WXS_UNSUPPORTED', message: `发现 ${wxsCount} 个 WXS 文件；v0.1 暂不执行 WXS。` });
  const unsupportedWxApis = Array.from(usedWxApis).filter((name) => !SUPPORTED_WX_APIS.has(name) && name !== 'cloud').sort();
  unsupportedWxApis.forEach((name) => warnings.push({ code: 'WX_API_PARTIAL', message: `wx.${name} 尚未专门适配，将使用通用失败回调。` }));
  const loginRoutes = allPageRoutes(project.appConfig).filter((route) => /(?:^|\/)(?:login|signin|sign-in|auth|authorize)(?:\/|$)/i.test(route));
  return {
    usedWxApis: Array.from(usedWxApis).sort(),
    unsupportedWxApis,
    storageKeys: Array.from(storageKeys).sort(),
    authScopes: Array.from(authScopes).sort(),
    loginRoutes,
    warnings
  };
}

export function buildManifest(project, files) {
  const warnings = [];
  const appConfig = project.appConfig;
  const pageRoutes = allPageRoutes(appConfig);
  if (!pageRoutes.length) throw new Error('app.json 没有声明 pages 或 subpackages 页面。');
  const componentRoutes = discoverComponents(project.sourceRoot, appConfig, pageRoutes, warnings);
  const globalComponents = normalizedUsingComponents(appConfig, project.sourceRoot, 'app');
  const pages = Object.fromEntries(pageRoutes.map((route) => [route, makeArtifact(project.sourceRoot, route, 'page', globalComponents)]));
  const components = Object.fromEntries(componentRoutes.map((route) => [route, makeArtifact(project.sourceRoot, route, 'component', globalComponents)]));
  const compatibility = scanSource(project, files);
  compatibility.warnings.unshift(...warnings);
  return {
    version: 'wxpreview/0.1',
    project: {
      id: project.id,
      name: project.name,
      appId: project.projectConfig?.appid || '',
      projectRoot: project.projectRoot,
      sourceRoot: project.sourceRoot
    },
    app: {
      config: appConfig,
      style: transformWxss(inlineWxss(path.join(project.sourceRoot, 'app.wxss')), null, path.join(project.sourceRoot, 'app.wxss'), project.sourceRoot)
    },
    pageRoutes,
    componentRoutes,
    pages,
    components,
    compatibility
  };
}

function absoluteImportPlugin(sourceRoot) {
  return {
    name: 'wxpreview-absolute-imports',
    setup(build) {
      build.onResolve({ filter: /^\// }, (args) => {
        if (args.kind === 'entry-point') return null;
        if (args.path === sourceRoot || args.path.startsWith(`${sourceRoot}${path.sep}`)) {
          return { path: args.path };
        }
        return { path: path.join(sourceRoot, args.path.replace(/^\/+/, '')) };
      });
    }
  };
}

export async function bundleProjectScripts(project, manifest) {
  const scriptFile = (route) => {
    const js = path.join(project.sourceRoot, `${route}.js`);
    return fs.existsSync(js) ? js : path.join(project.sourceRoot, `${route}.ts`);
  };
  const bundleEntry = async (entries, sourcefile) => {
    const contents = entries.map(({ key, file }) => [
      `globalThis.__mpSetLoading(${JSON.stringify(key)});`,
      fs.existsSync(file)
        ? `require(${JSON.stringify(file)});`
        : (key === 'app' ? 'App({});' : key.startsWith('component:') ? 'Component({});' : 'Page({});')
    ].join('\n')).join('\n');
    if (!contents) return 'export {};';
    const result = await esbuild({
      stdin: { contents, resolveDir: project.sourceRoot, sourcefile, loader: 'js' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: ['es2020', 'safari16'],
      charset: 'utf8',
      sourcemap: 'inline',
      logLevel: 'silent',
      plugins: [absoluteImportPlugin(project.sourceRoot)],
      define: { 'process.env.NODE_ENV': '"development"' }
    });
    return result.outputFiles[0].text;
  };
  const appFile = scriptFile('app');
  const app = await bundleEntry([{ key: 'app', file: appFile }], 'wxpreview-app-entry.js');
  const definitions = await bundleEntry([
    ...manifest.componentRoutes.map((route) => ({ key: `component:${route}`, file: scriptFile(route) })),
    ...manifest.pageRoutes.map((route) => ({ key: `page:${route}`, file: scriptFile(route) }))
  ], 'wxpreview-definitions-entry.js');
  return { app, definitions };
}

export { SUPPORTED_WX_APIS, normalizeRoute };
