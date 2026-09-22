import manifest from 'virtual:wxpreview-manifest';
import identity from 'virtual:wxpreview-identity';
import { createPreviewBackend } from './backend.js';
import { MiniProgramRuntime } from './runtime.js';
import './preview.css';

const routeSelect = document.getElementById('preview-route');
const currentRouteNode = document.getElementById('preview-current-route');
const debugToggle = document.getElementById('preview-debug-toggle');
const debugPanel = document.getElementById('preview-debug-panel');
const debugList = document.getElementById('preview-debug-list');
const debugCount = document.getElementById('preview-error-count');
const identityBadge = document.getElementById('preview-identity-badge');
const projectBadge = document.getElementById('preview-project-badge');
const compatibilityBadge = document.getElementById('preview-compatibility-badge');
const logs = [];
let errorCount = 0;

document.title = `${manifest.project.name} · DSH 小程序预览`;
projectBadge.textContent = manifest.project.name;
identityBadge.textContent = identity.autoLogin ? `本地身份：${identity.profile?.nickName || '预览用户'}` : '登录模拟关闭';
const compatibilityWarnings = manifest.compatibility?.warnings || [];
compatibilityBadge.textContent = compatibilityWarnings.length ? `兼容警告 ${compatibilityWarnings.length}` : '兼容扫描通过';

function sendLog(level, message, detail) {
  fetch('/__wxpreview/log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level, message, detail })
  }).catch(() => {});
}

function addLog(level, ...values) {
  const message = values.map((value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }).join(' ');
  const entry = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level, message };
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  if (level === 'error') errorCount += 1;
  debugCount.textContent = String(errorCount);
  debugCount.style.background = errorCount ? '#d84e4e' : '#738078';
  const item = document.createElement('li');
  item.dataset.level = level;
  item.textContent = `[${entry.time}] ${level.toUpperCase()} ${entry.message}`;
  debugList.appendChild(item);
  while (debugList.children.length > 200) debugList.firstElementChild.remove();
  debugList.scrollTop = debugList.scrollHeight;
  sendLog(level, message);
}

for (const level of ['warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...values) => { addLog(level, ...values); original(...values); };
}
window.addEventListener('error', (event) => addLog('error', event.error || event.message));
window.addEventListener('unhandledrejection', (event) => addLog('error', event.reason || 'Unhandled promise rejection'));
for (const warning of compatibilityWarnings) addLog('warn', warning.code || 'COMPATIBILITY', warning.message || warning);

const backend = createPreviewBackend(identity, {
  onCall(call) { addLog('info', `${call.kind}:${call.name || call.method || ''}${call.action ? `:${call.action}` : ''}`, call); }
});
const runtime = new MiniProgramRuntime(manifest, backend, {
  identity,
  skipLogin: identity.autoLogin !== false,
  onLog: addLog,
  onRouteChange({ route, query }) {
    routeSelect.value = route;
    currentRouteNode.textContent = route;
    const value = new URLSearchParams(query).toString();
    const url = new URL(window.location.href);
    url.searchParams.set('route', value ? `${route}?${value}` : route);
    history.replaceState({}, '', url);
  }
});

runtime.installGlobals();
await import('virtual:wxpreview-app');
runtime.launchApp();
await import('virtual:wxpreview-definitions');

for (const item of runtime.listRoutes()) {
  const option = document.createElement('option');
  option.value = item.route;
  option.textContent = `${item.title} · ${item.route}`;
  routeSelect.appendChild(option);
}
routeSelect.addEventListener('change', () => runtime.openRoute(routeSelect.value, {}, runtime.isTabRoute(routeSelect.value) ? 'switchTab' : 'reLaunch'));
document.getElementById('preview-back').addEventListener('click', () => runtime.navigateBack());
document.getElementById('preview-reload').addEventListener('click', () => runtime.reloadCurrent());
debugToggle.addEventListener('click', () => {
  const opening = debugPanel.hidden;
  debugPanel.hidden = !opening;
  debugToggle.setAttribute('aria-expanded', String(opening));
});
document.getElementById('preview-debug-clear').addEventListener('click', () => {
  logs.splice(0, logs.length);
  errorCount = 0;
  debugCount.textContent = '0';
  debugCount.style.background = '#738078';
  debugList.replaceChildren();
});

const requested = new URLSearchParams(window.location.search).get('route') || manifest.pageRoutes[0];
runtime.start(document.getElementById('miniprogram-root'), requested);

globalThis.__WXPREVIEW__ = Object.freeze({
  runtime,
  manifest,
  identity,
  backend,
  navigate: (route) => runtime.openRoute(route, {}, runtime.isTabRoute(String(route).split('?')[0]) ? 'switchTab' : 'navigateTo'),
  back: () => runtime.navigateBack(),
  reload: () => runtime.reloadCurrent(),
  getCurrentPage: () => runtime.currentPage(),
  getSnapshot: () => runtime.debugSnapshot(),
  setData: (patch) => runtime.currentPage()?.setData(patch),
  getLogs: () => logs.slice()
});

document.documentElement.dataset.wxpreviewReady = 'true';
window.dispatchEvent(new CustomEvent('wxpreview-ready', { detail: { route: runtime.currentRoute } }));
addLog('info', 'DSH 原生小程序预览运行时已就绪', runtime.currentRoute);
