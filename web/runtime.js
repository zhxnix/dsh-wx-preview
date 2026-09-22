const CONTROL_ATTRIBUTES = new Set([
  'wx:if',
  'wx:elif',
  'wx:else',
  'wx:for',
  'wx:for-item',
  'wx:for-index',
  'wx:key'
]);

const BUILTIN_TAGS = new Set([
  'ad', 'audio', 'button', 'camera', 'canvas', 'checkbox', 'checkbox-group',
  'cover-image', 'cover-view', 'editor', 'form', 'icon', 'image', 'input',
  'label', 'live-player', 'live-pusher', 'map', 'match-media', 'movable-area',
  'movable-view', 'navigator', 'official-account', 'open-data', 'page-container',
  'picker', 'picker-view', 'picker-view-column', 'progress', 'radio', 'radio-group',
  'rich-text', 'root-portal', 'scroll-view', 'share-element', 'slider', 'swiper',
  'swiper-item', 'switch', 'text', 'textarea', 'video', 'view', 'web-view'
]);

const EVENT_NAME_MAP = Object.freeze({
  tap: 'click',
  input: 'input',
  change: 'change',
  blur: 'blur',
  focus: 'focus',
  submit: 'submit',
  confirm: 'keydown',
  scroll: 'scroll',
  scrolltolower: 'scroll',
  scrolltoupper: 'scroll',
  touchstart: 'pointerdown',
  touchmove: 'pointermove',
  touchend: 'pointerup',
  touchcancel: 'pointercancel',
  longpress: 'contextmenu',
  longtap: 'contextmenu',
  load: 'load',
  error: 'error',
  play: 'play',
  pause: 'pause',
  ended: 'ended'
});

const DEFAULT_PREVIEW_PROFILE = Object.freeze({
  nickName: '预览用户',
  avatarUrl: 'cloud://wxpreview-local/avatar.png',
  gender: 0,
  language: 'zh_CN'
});

const DEFAULT_PREVIEW_SCOPES = Object.freeze({
  'scope.userInfo': true,
  'scope.userLocation': true
});

const normalizeRoutePath = (value) => String(value || '')
  .trim()
  .replace(/^\/+/, '')
  .replace(/\.(?:js|json|wxml|wxss)$/, '')
  .replace(/\/+$/, '');

function normalizeIdentity(value) {
  const source = value && typeof value === 'object' ? value : {};
  const profile = { ...DEFAULT_PREVIEW_PROFILE, ...(source.profile || {}) };
  if (source.autoLogin !== false && !profile.avatarUrl) profile.avatarUrl = DEFAULT_PREVIEW_PROFILE.avatarUrl;
  const scopes = { ...DEFAULT_PREVIEW_SCOPES, ...(source.scopes || {}) };
  const storage = { ...(source.storage || {}) };
  const globalData = { ...(source.globalData || {}) };
  const normalizeUserInfo = (candidate) => {
    const result = candidate && typeof candidate === 'object' ? { ...profile, ...candidate } : { ...profile };
    if (source.autoLogin !== false && !result.avatarUrl) result.avatarUrl = profile.avatarUrl;
    return result;
  };
  storage.userInfo = normalizeUserInfo(storage.userInfo);
  globalData.userInfo = normalizeUserInfo(globalData.userInfo);
  return {
    ...source,
    autoLogin: source.autoLogin !== false,
    profile,
    scopes,
    storage,
    globalData,
    loginRoutes: Array.from(new Set((source.loginRoutes || []).map(normalizeRoutePath).filter(Boolean)))
  };
}

const clone = (value) => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) { /* functions are intentionally kept below */ }
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const output = {};
  Object.keys(value).forEach((key) => { output[key] = clone(value[key]); });
  return output;
};

const camelCase = (value) => String(value).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const routeLabel = (route) => route
  .replace(/^pages\//, '')
  .replace(/\/index$/, '')
  .split('/')
  .map((part) => part.replace(/-/g, ' '))
  .join(' / ');

function parseRouteUrl(value) {
  const raw = String(value || '').trim();
  const [routePart, queryPart = ''] = raw.split('?');
  const route = routePart.replace(/^\/+/, '').replace(/\.(?:js|json|wxml|wxss)$/, '');
  const query = {};
  const params = new URLSearchParams(queryPart);
  params.forEach((item, key) => { query[key] = item; });
  return { route, query };
}

function normalizeEventBindingName(name) {
  const match = String(name).match(/^(bind|catch):?(.+)$/);
  if (!match) return null;
  return { mode: match[1], event: match[2].toLowerCase() };
}

function defaultPropertyValue(spec) {
  if (spec && typeof spec === 'object' && Object.prototype.hasOwnProperty.call(spec, 'value')) {
    return clone(spec.value);
  }
  const type = spec && typeof spec === 'object' ? spec.type : spec;
  if (type === String) return '';
  if (type === Number) return 0;
  if (type === Boolean) return false;
  if (type === Array) return [];
  if (type === Object) return {};
  return null;
}

function coerceProperty(value, spec) {
  const type = spec && typeof spec === 'object' ? spec.type : spec;
  if (type === Boolean) {
    if (value === '' || value === true || value === 'true') return true;
    if (value === false || value === 'false' || value === null || value === undefined) return false;
    return Boolean(value);
  }
  if (type === Number && value !== '' && value !== null && value !== undefined) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (type === String && value !== null && value !== undefined) return String(value);
  return value;
}

function pathParts(value) {
  return String(value).match(/[^.[\]]+/g) || [];
}

function applyDataPatch(target, key, value) {
  const parts = pathParts(key);
  if (!parts.length) return;
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const nextPart = parts[index + 1];
    if (!cursor[part] || typeof cursor[part] !== 'object') {
      cursor[part] = /^\d+$/.test(nextPart) ? [] : {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function behaviorHooks(definition) {
  const source = definition || {};
  return {
    attached: [source.attached, source.lifetimes && source.lifetimes.attached].filter((item) => typeof item === 'function'),
    detached: [source.detached, source.lifetimes && source.lifetimes.detached].filter((item) => typeof item === 'function'),
    pageShow: [source.pageLifetimes && source.pageLifetimes.show].filter((item) => typeof item === 'function'),
    pageHide: [source.pageLifetimes && source.pageLifetimes.hide].filter((item) => typeof item === 'function')
  };
}

function mergeHooks(target, source) {
  for (const key of Object.keys(target)) target[key].push(...source[key]);
}

function createInstanceBlueprint(definition, type) {
  const data = {};
  const values = {};
  const hooks = { attached: [], detached: [], pageShow: [], pageHide: [] };

  function applyBehavior(behavior) {
    if (!behavior || typeof behavior !== 'object') return;
    Object.assign(data, clone(behavior.data || {}));
    Object.assign(values, behavior.methods || {});
    mergeHooks(hooks, behaviorHooks(behavior));
  }

  for (const behavior of definition.behaviors || []) applyBehavior(behavior);
  Object.assign(data, clone(definition.data || {}));

  if (type === 'component') {
    Object.assign(values, definition.methods || {});
    mergeHooks(hooks, behaviorHooks(definition));
  } else {
    for (const [key, value] of Object.entries(definition)) {
      if (['data', 'behaviors', 'methods', 'properties', 'options', 'lifetimes', 'pageLifetimes', 'observers'].includes(key)) continue;
      values[key] = value;
    }
  }

  return { data, values, hooks };
}

export class MiniProgramRuntime {
  constructor(manifest, backend, options = {}) {
    this.manifest = manifest || {};
    this.backend = backend;
    this.options = options;
    this.identity = normalizeIdentity(options.identity || backend?.identity || {});
    this.registry = { app: null, pages: new Map(), components: new Map() };
    this.loadingKey = '';
    this.app = null;
    this.stack = [];
    this.root = null;
    this.toastTimer = null;
    this.expressionFailures = new Set();
    this.renderPending = false;
    this.currentRoute = '';
    this.skipLogin = options.skipLogin !== false;
    this.tabBarHidden = false;
    this.tabBarBadges = new Map();
    this.tabBarItemOverrides = new Map();
    this.tabBarStyle = {};
    this.styleElement = null;
    this.pageStyleElement = null;
    this.loginBypassActive = false;
    this.wx = this.createWxApi();
  }

  log(level, ...args) {
    this.options.onLog?.(level, ...args);
  }

  installGlobals() {
    const runtime = this;
    globalThis.__mpSetLoading = (key) => { runtime.loadingKey = key || ''; };
    globalThis.App = (definition) => {
      runtime.registry.app = definition || {};
      return definition;
    };
    globalThis.Page = (definition) => {
      const route = runtime.loadingKey.replace(/^page:/, '');
      if (!route) throw new Error('Page 定义缺少预览路由');
      runtime.registry.pages.set(route, definition || {});
      return definition;
    };
    globalThis.Component = (definition) => {
      const route = runtime.loadingKey.replace(/^component:/, '');
      if (!route) throw new Error('Component 定义缺少预览路由');
      runtime.registry.components.set(route, definition || {});
      return definition;
    };
    globalThis.Behavior = (definition) => definition || {};
    globalThis.getApp = () => runtime.app;
    globalThis.getCurrentPages = () => runtime.stack.map((entry) => entry.instance);
    globalThis.wx = this.wx;
    globalThis.__wxConfig = {
      envVersion: 'develop',
      accountInfo: { miniProgram: { appId: this.manifest.project?.appId || '' } }
    };
    this.seedPreviewIdentity();
  }

  seedPreviewIdentity() {
    if (!this.skipLogin) return;
    for (const [key, value] of Object.entries(this.identity.storage || {})) {
      this.wx.setStorageSync(key, clone(value));
    }
  }

  launchApp() {
    const definition = this.registry.app || {};
    const blueprint = createInstanceBlueprint(definition, 'app');
    const instance = { ...blueprint.values };
    instance.globalData = clone(definition.globalData || {});
    if (this.skipLogin) Object.assign(instance.globalData, clone(this.identity.globalData || {}));
    for (const [key, value] of Object.entries(instance)) {
      if (typeof value === 'function') instance[key] = value.bind(instance);
    }
    this.app = instance;
    this.safeInvoke(instance, instance.onLaunch, [], 'App.onLaunch');
    return instance;
  }

  start(root, initialRoute) {
    this.root = root;
    this.installStyles();
    const fallbackRoute = this.manifest.pageRoutes?.[0] || '';
    const parsed = parseRouteUrl(initialRoute || fallbackRoute);
    const route = this.manifest.pages?.[parsed.route] ? parsed.route : fallbackRoute;
    if (!route) {
      this.log('error', '项目没有可预览的页面');
      return this;
    }
    const mode = this.isLoginRoute(route) ? 'explicitPreview' : 'reLaunch';
    this.openRoute(route, parsed.query, mode);
    return this;
  }

  installStyles() {
    this.styleElement = document.createElement('style');
    this.styleElement.dataset.mpPreview = 'app-and-components';
    this.styleElement.textContent = [
      this.manifest.app?.style || '',
      ...Object.values(this.manifest.components || {}).map((component) => component.style || '')
    ].join('\n');
    document.head.appendChild(this.styleElement);
    this.pageStyleElement = document.createElement('style');
    this.pageStyleElement.dataset.mpPreview = 'page';
    document.head.appendChild(this.pageStyleElement);
  }

  currentEntry() {
    return this.stack[this.stack.length - 1] || null;
  }

  currentPage() {
    return this.currentEntry()?.instance || null;
  }

  listRoutes() {
    return (this.manifest.pageRoutes || []).map((route) => ({
      route,
      title: this.manifest.pages?.[route]?.config?.navigationBarTitleText || routeLabel(route)
    }));
  }

  isLoginRoute(route) {
    if (!this.skipLogin) return false;
    const normalized = normalizeRoutePath(route);
    return (this.identity.loginRoutes || []).includes(normalized)
      || /(?:^|\/)(?:login|signin|sign-in|auth|authorize)(?:\/|$)/i.test(normalized);
  }

  authenticatedRoute() {
    const loginRoutes = new Set((this.identity.loginRoutes || []).map(normalizeRoutePath));
    const routes = this.manifest.pageRoutes || [];
    const configuredTabs = this.tabBarItems().map((item) => item.route);
    const tabRoute = configuredTabs.find((route) => !this.isLoginRoute(route) && !loginRoutes.has(route));
    return tabRoute
      || routes.find((route) => !this.isLoginRoute(route) && !loginRoutes.has(route))
      || routes[0]
      || '';
  }

  openRoute(route, query = {}, mode = 'navigateTo') {
    const parsedInput = parseRouteUrl(route);
    const normalized = normalizeRoutePath(parsedInput.route);
    const resolvedQuery = query && Object.keys(query).length ? query : parsedInput.query;
    if (!this.manifest.pages?.[normalized]) {
      this.log('error', `页面不存在: ${normalized}`);
      this.showToast({ title: `页面不存在：${normalized}`, icon: 'none' });
      return false;
    }
    if (this.isLoginRoute(normalized) && mode !== 'explicitPreview') {
      this.seedPreviewIdentity();
      if (this.app?.globalData) Object.assign(this.app.globalData, clone(this.identity.globalData || {}));
      const currentEntry = this.currentEntry();
      if (this.loginBypassActive || (currentEntry && currentEntry.route !== normalized)) {
        this.log('warn', `已用本地身份拦截登录跳转: ${normalized}`);
        return true;
      }
      const authenticated = this.authenticatedRoute();
      if (authenticated && authenticated !== normalized) {
        this.loginBypassActive = true;
        try { return this.openRoute(authenticated, {}, 'reLaunch'); }
        finally { this.loginBypassActive = false; }
      }
    }

    if (mode === 'navigateBack') return this.navigateBack();
    const current = this.currentEntry();
    if (mode === 'navigateTo' && current) this.hideEntry(current);
    if (mode === 'redirectTo' && current) {
      this.unloadEntry(current);
      this.stack.pop();
    }
    if (mode === 'reLaunch' || mode === 'switchTab') {
      while (this.stack.length) this.unloadEntry(this.stack.pop());
    }

    const entry = this.createPageEntry(normalized, resolvedQuery);
    if (mode === 'explicitPreview') {
      entry.staticPreview = true;
      if (this.isLoginRoute(normalized)) {
        for (const key of ['loading', 'submitting', 'authorizing']) {
          if (Object.prototype.hasOwnProperty.call(entry.instance.data, key)) entry.instance.data[key] = false;
        }
      }
    }
    this.stack.push(entry);
    this.currentRoute = normalized;
    this.showEntry(entry, true);
    this.render();
    queueMicrotask(() => {
      if (this.currentEntry() !== entry || entry.staticPreview) return;
      this.safeInvoke(entry.instance, entry.instance.onReady, [], `${normalized}.onReady`);
    });
    this.options.onRouteChange?.({ route: normalized, query: clone(resolvedQuery), mode });
    return true;
  }

  createPageEntry(route, query) {
    const definition = this.registry.pages.get(route);
    if (!definition) throw new Error(`页面 JS 尚未注册: ${route}`);
    const blueprint = createInstanceBlueprint(definition, 'page');
    const instance = {
      route,
      __route__: route,
      data: clone(blueprint.data),
      __hooks: blueprint.hooks,
      __components: new Map(),
      __query: clone(query)
    };
    Object.assign(instance, blueprint.values);
    this.attachInstanceMethods(instance, 'page');
    instance.getTabBar = () => this.ensureTabBar(instance);
    return { route, query: clone(query), instance };
  }

  attachInstanceMethods(instance, type) {
    instance.setData = (patch, callback) => {
      if (!patch || typeof patch !== 'object') return;
      for (const [key, value] of Object.entries(patch)) applyDataPatch(instance.data, key, value);
      this.requestRender();
      if (typeof callback === 'function') queueMicrotask(() => callback.call(instance));
    };
    if (type === 'component') {
      instance.triggerEvent = (name, detail = {}, options = {}) => {
        const binding = instance.__eventBindings?.[String(name).toLowerCase()];
        if (!binding) return;
        const event = {
          type: name,
          detail,
          target: { dataset: clone(instance.__hostDataset || {}) },
          currentTarget: { dataset: clone(instance.__hostDataset || {}) },
          bubbles: options.bubbles !== false,
          composed: Boolean(options.composed)
        };
        this.callHandler(binding.context, binding.handler, event, `component:${instance.__route__}.triggerEvent(${name})`);
      };
    }
    for (const [key, value] of Object.entries(instance)) {
      if (typeof value === 'function' && !['setData', 'triggerEvent'].includes(key)) {
        instance[key] = value.bind(instance);
      }
    }
  }

  showEntry(entry, firstShow) {
    const page = entry.instance;
    if (firstShow) {
      for (const hook of page.__hooks.attached) this.safeInvoke(page, hook, [], `${entry.route}.behavior.attached`);
      if (!entry.staticPreview) this.safeInvoke(page, page.onLoad, [clone(entry.query)], `${entry.route}.onLoad`);
    }
    if (!entry.staticPreview) {
      for (const hook of page.__hooks.pageShow) this.safeInvoke(page, hook, [], `${entry.route}.behavior.pageShow`);
      this.safeInvoke(page, page.onShow, [], `${entry.route}.onShow`);
    }
    for (const component of page.__components.values()) {
      for (const hook of component.__hooks.pageShow) this.safeInvoke(component, hook, [], `${component.__route__}.pageShow`);
    }
  }

  hideEntry(entry) {
    for (const hook of entry.instance.__hooks.pageHide) this.safeInvoke(entry.instance, hook, [], `${entry.route}.behavior.pageHide`);
    this.safeInvoke(entry.instance, entry.instance.onHide, [], `${entry.route}.onHide`);
    for (const component of entry.instance.__components.values()) {
      for (const hook of component.__hooks.pageHide) this.safeInvoke(component, hook, [], `${component.__route__}.pageHide`);
    }
  }

  unloadEntry(entry) {
    if (!entry) return;
    this.hideEntry(entry);
    this.safeInvoke(entry.instance, entry.instance.onUnload, [], `${entry.route}.onUnload`);
    for (const hook of entry.instance.__hooks.detached) this.safeInvoke(entry.instance, hook, [], `${entry.route}.behavior.detached`);
    for (const component of entry.instance.__components.values()) this.detachComponent(component);
    entry.instance.__components.clear();
  }

  navigateBack(delta = 1) {
    if (this.stack.length <= 1) return false;
    const count = Math.max(1, Number(delta) || 1);
    for (let index = 0; index < count && this.stack.length > 1; index += 1) {
      this.unloadEntry(this.stack.pop());
    }
    const entry = this.currentEntry();
    this.currentRoute = entry.route;
    this.showEntry(entry, false);
    this.render();
    this.options.onRouteChange?.({ route: entry.route, query: clone(entry.query), mode: 'navigateBack' });
    return true;
  }

  reloadCurrent() {
    const current = this.currentEntry();
    if (!current) return;
    this.openRoute(current.route, current.query, 'redirectTo');
  }

  ensureTabBar(page) {
    if (page.__tabBar) return page.__tabBar;
    const route = this.customTabBarRoute();
    if (!route || !this.registry.components.has(route)) return null;
    page.__tabBar = this.createComponentInstance(route, {}, {}, {}, page, `${page.route}:__tabbar`);
    page.__components.set(`${page.route}:__tabbar`, page.__tabBar);
    return page.__tabBar;
  }

  safeInvoke(context, fn, args, label) {
    if (typeof fn !== 'function') return undefined;
    try {
      const result = fn.apply(context, args);
      if (result && typeof result.then === 'function') {
        result.catch((error) => this.log('error', label, error));
      }
      return result;
    } catch (error) {
      this.log('error', label, error);
      return undefined;
    }
  }

  requestRender() {
    if (this.renderPending) return;
    this.renderPending = true;
    queueMicrotask(() => {
      this.renderPending = false;
      this.render();
    });
  }

  render() {
    if (!this.root) return;
    const entry = this.currentEntry();
    if (!entry) return;
    const artifact = this.manifest.pages?.[entry.route];
    if (!artifact) return;
    const windowConfig = this.pageWindowConfig(entry.route);
    const nativeNavigation = this.isNativeNavigation(entry.route);
    this.pageStyleElement.textContent = artifact.style || '';
    const activeKeys = new Set();
    entry.instance.__activeComponentKeys = activeKeys;

    const wrapper = document.createElement('div');
    const hasTabBar = this.isTabRoute(entry.route);
    const hasCustomTabBar = hasTabBar && this.hasCustomTabBar();
    wrapper.className = [
      'mp-page',
      hasTabBar ? 'has-tabbar' : 'no-tabbar',
      hasCustomTabBar ? 'has-custom-tabbar' : (hasTabBar ? 'has-standard-tabbar' : ''),
      nativeNavigation ? 'has-native-navigation' : 'has-custom-navigation'
    ].filter(Boolean).join(' ');
    wrapper.dataset.mpPage = entry.route;
    wrapper.dataset.route = entry.route;
    wrapper.style.setProperty('--mp-page-background', windowConfig.backgroundColor || '#f7f7f7');
    wrapper.style.setProperty('--mp-native-navigation-background', windowConfig.navigationBarBackgroundColor || '#f7f7f7');
    wrapper.style.setProperty('--mp-native-navigation-text', (windowConfig.navigationBarTextStyle || 'black') === 'black' ? '#000' : '#fff');
    this.syncDeviceChrome(windowConfig);

    if (nativeNavigation) wrapper.appendChild(this.createNativeNavigation(entry, windowConfig));

    const contentHost = document.createElement('div');
    contentHost.className = 'mp-page-content';
    const context = {
      instance: entry.instance,
      artifact,
      locals: {},
      slots: {},
      slotPresence: {},
      ownerPage: entry.instance
    };
    this.renderNodeList(artifact.template, context, contentHost, `page:${entry.route}`);
    wrapper.appendChild(contentHost);

    if (hasCustomTabBar && !this.tabBarHidden) {
      const tabBar = this.ensureTabBar(entry.instance);
      if (tabBar) {
        const tabRoute = this.customTabBarRoute();
        activeKeys.add(`${entry.route}:__tabbar`);
        const tabArtifact = this.manifest.components?.[tabRoute];
        const tabHost = document.createElement('div');
        tabHost.className = 'mp-component';
        tabHost.dataset.mpComponent = tabRoute;
        this.renderNodeList(tabArtifact.template, {
          instance: tabBar,
          artifact: tabArtifact,
          locals: {},
          slots: {},
          slotPresence: {},
          ownerPage: entry.instance
        }, tabHost, `${entry.route}:__tabbar`);
        wrapper.appendChild(tabHost);
      }
    } else if (hasTabBar && !this.tabBarHidden) {
      wrapper.appendChild(this.createStandardTabBar(entry));
    }

    for (const [key, component] of entry.instance.__components.entries()) {
      if (activeKeys.has(key)) continue;
      this.detachComponent(component);
      entry.instance.__components.delete(key);
    }
    this.root.replaceChildren(wrapper);
  }

  pageWindowConfig(route) {
    const appWindow = this.manifest.app?.config?.window || {};
    const pageConfig = this.manifest.pages?.[route]?.config || {};
    return { ...appWindow, ...pageConfig };
  }

  isNativeNavigation(route) {
    return this.pageWindowConfig(route).navigationStyle !== 'custom';
  }

  syncDeviceChrome(windowConfig) {
    const device = this.root?.closest('.preview-device');
    if (!device) return;
    device.dataset.navigationTextStyle = (windowConfig.navigationBarTextStyle || 'black') === 'black' ? 'black' : 'white';
    device.dataset.navigationStyle = windowConfig.navigationStyle === 'custom' ? 'custom' : 'native';
  }

  createNativeNavigation(entry, windowConfig) {
    const navigation = document.createElement('div');
    navigation.className = 'mp-native-navigation';
    const row = document.createElement('div');
    row.className = 'mp-native-navigation-row';

    if (this.stack.length > 1) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'mp-native-back';
      back.setAttribute('aria-label', '返回');
      back.textContent = '‹';
      back.addEventListener('click', () => this.navigateBack());
      row.appendChild(back);
    }

    const title = document.createElement('span');
    title.className = 'mp-native-navigation-title';
    title.textContent = windowConfig.navigationBarTitleText || routeLabel(entry.route);
    row.appendChild(title);
    navigation.appendChild(row);
    return navigation;
  }

  isTabRoute(route) {
    return this.tabBarItems().some((item) => item.route === normalizeRoutePath(route));
  }

  tabBarConfig() {
    return this.manifest.app?.config?.tabBar || {};
  }

  tabBarItems() {
    return (this.tabBarConfig().list || [])
      .map((item) => {
        const route = normalizeRoutePath(item.pagePath);
        return { ...item, ...(this.tabBarItemOverrides.get(route) || {}), route };
      })
      .filter((item) => item.route);
  }

  customTabBarRoute() {
    const configured = this.manifest.customTabBarRoute;
    if (configured && this.manifest.components?.[configured]) return configured;
    if (this.manifest.components?.['custom-tab-bar/index']) return 'custom-tab-bar/index';
    return (this.manifest.componentRoutes || []).find((route) => /(?:^|\/)custom-tab-bar\/index$/i.test(route)) || '';
  }

  hasCustomTabBar() {
    const config = this.tabBarConfig();
    return Boolean(config.custom && this.customTabBarRoute());
  }

  createStandardTabBar(entry) {
    const config = this.tabBarConfig();
    const bar = document.createElement('nav');
    bar.className = 'mp-standard-tabbar';
    bar.dataset.mpBuiltin = 'tab-bar';
    bar.setAttribute('aria-label', '底部导航');
    const style = { ...config, ...this.tabBarStyle };
    if (style.backgroundColor) bar.style.backgroundColor = String(style.backgroundColor);
    if (style.borderStyle) bar.dataset.borderStyle = String(style.borderStyle);
    const selectedColor = style.selectedColor || '#07c160';
    const unselectedColor = style.color || '#666';
    const pageContext = { artifact: { directory: '' } };
    for (const item of this.tabBarItems()) {
      const active = item.route === entry.route;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `mp-standard-tabbar-item${active ? ' is-active' : ''}`;
      button.dataset.route = item.route;
      button.style.color = active ? String(selectedColor) : String(unselectedColor);
      button.setAttribute('aria-current', active ? 'page' : 'false');
      const iconPath = active ? (item.selectedIconPath || item.iconPath) : item.iconPath;
      if (iconPath) {
        const icon = document.createElement('img');
        icon.className = 'mp-standard-tabbar-icon';
        icon.alt = '';
        icon.src = this.resolveAssetUrl(iconPath, pageContext);
        button.appendChild(icon);
      }
      const label = document.createElement('span');
      label.className = 'mp-standard-tabbar-label';
      label.textContent = item.text || routeLabel(item.route);
      button.appendChild(label);
      const badge = this.tabBarBadges.get(item.route);
      if (badge) {
        const badgeNode = document.createElement('span');
        badgeNode.className = 'mp-standard-tabbar-badge';
        badgeNode.textContent = badge;
        button.appendChild(badgeNode);
      }
      button.addEventListener('click', () => this.openRoute(item.route, {}, 'switchTab'));
      bar.appendChild(button);
    }
    return bar;
  }

  renderNodeList(nodes, context, parent, keyPrefix) {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.type === 'text') {
        if (node.value) parent.appendChild(document.createTextNode(this.interpolate(node.value, context)));
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(node.attrs || {}, 'wx:if')) {
        const chain = [{ node, index }];
        let cursor = index + 1;
        while (cursor < nodes.length) {
          const candidate = nodes[cursor];
          if (candidate.type === 'text' && !candidate.value.trim()) {
            cursor += 1;
            continue;
          }
          if (candidate.type === 'element' && (
            Object.prototype.hasOwnProperty.call(candidate.attrs || {}, 'wx:elif')
            || Object.prototype.hasOwnProperty.call(candidate.attrs || {}, 'wx:else')
          )) {
            chain.push({ node: candidate, index: cursor });
            cursor += 1;
            continue;
          }
          break;
        }
        const chosen = chain.find(({ node: candidate }) => {
          if (Object.prototype.hasOwnProperty.call(candidate.attrs, 'wx:else')) return true;
          const expression = candidate.attrs['wx:if'] ?? candidate.attrs['wx:elif'];
          return Boolean(this.evaluateAttribute(expression, context));
        });
        if (chosen) this.renderNode(chosen.node, context, parent, `${keyPrefix}.${chosen.index}`, new Set(['wx:if', 'wx:elif', 'wx:else']));
        index = Math.max(index, cursor - 1);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(node.attrs || {}, 'wx:elif') || Object.prototype.hasOwnProperty.call(node.attrs || {}, 'wx:else')) continue;
      this.renderNode(node, context, parent, `${keyPrefix}.${index}`);
    }
  }

  renderNode(node, context, parent, key, omitted = new Set()) {
    const attrs = node.attrs || {};
    if (Object.prototype.hasOwnProperty.call(attrs, 'wx:for') && !omitted.has('wx:for')) {
      const source = this.evaluateAttribute(attrs['wx:for'], context);
      const values = Array.isArray(source)
        ? source
        : (Number.isFinite(Number(source)) ? Array.from({ length: Math.max(0, Number(source)) }, (_, index) => index) : []);
      const itemName = attrs['wx:for-item'] || 'item';
      const indexName = attrs['wx:for-index'] || 'index';
      const keyName = attrs['wx:key'];
      values.forEach((item, itemIndex) => {
        let stableKey = itemIndex;
        if (keyName === '*this') stableKey = item;
        else if (keyName && item && typeof item === 'object' && item[keyName] !== undefined) stableKey = item[keyName];
        const childContext = {
          ...context,
          locals: { ...context.locals, [itemName]: item, [indexName]: itemIndex }
        };
        this.renderNode(node, childContext, parent, `${key}[${String(stableKey)}]`, new Set([...omitted, 'wx:for', 'wx:for-item', 'wx:for-index', 'wx:key']));
      });
      return;
    }

    if (node.name === 'block') {
      this.renderNodeList(node.children || [], context, parent, key);
      return;
    }
    if (node.name === 'slot') {
      const name = attrs.name || 'default';
      const slot = context.slots?.[name];
      if (slot) this.renderNodeList(slot.nodes, slot.context, parent, `${key}:slot:${name}`);
      return;
    }
    if (node.name === 'template' && attrs.is) {
      const templateName = String(this.evaluateAttribute(attrs.is, context) || '');
      const templateNodes = context.artifact.templates?.[templateName];
      if (!templateNodes) {
        this.log('warn', `找不到 WXML template：${templateName}`, context.artifact.route);
        return;
      }
      const templateData = attrs.data ? this.evaluateAttribute(attrs.data, context) : {};
      const locals = templateData && typeof templateData === 'object'
        ? { ...context.locals, ...templateData }
        : { ...context.locals };
      this.renderNodeList(templateNodes, { ...context, locals }, parent, `${key}:template:${templateName}`);
      return;
    }

    const componentRoute = context.artifact?.config?.usingComponents?.[node.name];
    if (componentRoute) {
      this.renderCustomComponent(node, context, parent, key, componentRoute, omitted);
      return;
    }
    if (!BUILTIN_TAGS.has(node.name)) {
      const fallback = document.createElement('div');
      fallback.dataset.unknownMiniProgramTag = node.name;
      this.applyAttributes(fallback, node, context, omitted);
      this.bindDomEvents(fallback, node, context);
      this.renderNodeList(node.children || [], context, fallback, key);
      parent.appendChild(fallback);
      return;
    }
    this.renderBuiltin(node, context, parent, key, omitted);
  }

  renderCustomComponent(node, parentContext, parent, key, componentRoute, omitted) {
    const artifact = this.manifest.components?.[componentRoute];
    const definition = this.registry.components.get(componentRoute);
    if (!artifact || !definition) {
      this.log('warn', `组件未注册，显示占位: ${node.name} -> ${componentRoute}`);
      const fallback = document.createElement('div');
      fallback.dataset.unknownMiniProgramComponent = node.name;
      fallback.dataset.componentRoute = componentRoute;
      this.markSource(fallback, node);
      this.applyAttributes(fallback, node, parentContext, omitted);
      this.renderNodeList(node.children || [], parentContext, fallback, key);
      parent.appendChild(fallback);
      return;
    }
    const properties = {};
    const hostDataset = {};
    const eventBindings = {};
    for (const [name, rawValue] of Object.entries(node.attrs || {})) {
      if (CONTROL_ATTRIBUTES.has(name) || omitted.has(name)) continue;
      const binding = normalizeEventBindingName(name);
      if (binding) {
        eventBindings[binding.event] = { handler: rawValue, context: parentContext };
        continue;
      }
      if (name.startsWith('data-')) {
        hostDataset[camelCase(name.slice(5))] = this.evaluateAttribute(rawValue, parentContext);
        continue;
      }
      if (['class', 'style', 'slot', 'id'].includes(name)) continue;
      const propertyName = camelCase(name);
      properties[propertyName] = this.evaluateAttribute(rawValue, parentContext);
    }

    const slots = {};
    for (const child of node.children || []) {
      const slotName = child.type === 'element' && child.attrs?.slot ? child.attrs.slot : 'default';
      if (!slots[slotName]) slots[slotName] = { nodes: [], context: parentContext };
      if (child.type === 'element' && child.attrs?.slot) {
        slots[slotName].nodes.push({ ...child, attrs: Object.fromEntries(Object.entries(child.attrs).filter(([name]) => name !== 'slot')) });
      } else {
        slots[slotName].nodes.push(child);
      }
    }

    const page = parentContext.ownerPage;
    const cacheKey = `${key}:${componentRoute}`;
    page.__activeComponentKeys.add(cacheKey);
    let component = page.__components.get(cacheKey);
    if (!component || component.__route__ !== componentRoute) {
      if (component) this.detachComponent(component);
      component = this.createComponentInstance(componentRoute, properties, eventBindings, hostDataset, page, cacheKey);
      page.__components.set(cacheKey, component);
    } else {
      this.updateComponent(component, properties, eventBindings, hostDataset);
    }

    const host = document.createElement('div');
    host.className = 'mp-component';
    host.dataset.mpComponent = componentRoute;
    host.dataset.mpTag = node.name;
    this.markSource(host, node);
    if (node.attrs.class) host.classList.add(...String(this.evaluateAttribute(node.attrs.class, parentContext) || '').split(/\s+/).filter(Boolean));
    if (node.attrs.style) host.setAttribute('style', String(this.evaluateAttribute(node.attrs.style, parentContext) || ''));
    if (node.attrs.id) host.id = String(this.evaluateAttribute(node.attrs.id, parentContext) || '');

    this.renderNodeList(artifact.template, {
      instance: component,
      artifact,
      locals: {},
      slots,
      slotPresence: Object.fromEntries(Object.keys(slots).map((name) => [name, slots[name].nodes.length > 0])),
      ownerPage: page
    }, host, cacheKey);
    parent.appendChild(host);
  }

  createComponentInstance(route, properties, eventBindings, hostDataset, ownerPage, cacheKey) {
    const definition = this.registry.components.get(route) || {};
    const blueprint = createInstanceBlueprint(definition, 'component');
    const instance = {
      __route__: route,
      __cacheKey: cacheKey,
      __ownerPage: ownerPage,
      __hooks: blueprint.hooks,
      __eventBindings: eventBindings,
      __hostDataset: hostDataset,
      __propertySpecs: definition.properties || {},
      data: clone(blueprint.data),
      properties: {}
    };
    Object.assign(instance, blueprint.values);
    for (const [name, spec] of Object.entries(instance.__propertySpecs)) {
      const value = Object.prototype.hasOwnProperty.call(properties, name)
        ? coerceProperty(properties[name], spec)
        : defaultPropertyValue(spec);
      instance.properties[name] = clone(value);
      instance.data[name] = clone(value);
    }
    this.attachInstanceMethods(instance, 'component');
    for (const [name, spec] of Object.entries(instance.__propertySpecs)) {
      const observer = spec && typeof spec === 'object' ? spec.observer : null;
      if (observer) this.invokeObserver(instance, observer, instance.properties[name], undefined, name);
    }
    for (const hook of instance.__hooks.attached) this.safeInvoke(instance, hook, [], `${route}.attached`);
    for (const hook of instance.__hooks.pageShow) this.safeInvoke(instance, hook, [], `${route}.pageShow`);
    return instance;
  }

  updateComponent(instance, properties, eventBindings, hostDataset) {
    instance.__eventBindings = eventBindings;
    instance.__hostDataset = hostDataset;
    for (const [name, spec] of Object.entries(instance.__propertySpecs)) {
      const next = Object.prototype.hasOwnProperty.call(properties, name)
        ? coerceProperty(properties[name], spec)
        : defaultPropertyValue(spec);
      const previous = instance.properties[name];
      if (Object.is(previous, next) || JSON.stringify(previous) === JSON.stringify(next)) continue;
      instance.properties[name] = clone(next);
      instance.data[name] = clone(next);
      const observer = spec && typeof spec === 'object' ? spec.observer : null;
      if (observer) this.invokeObserver(instance, observer, next, previous, name);
    }
  }

  invokeObserver(instance, observer, value, previous, name) {
    const fn = typeof observer === 'function' ? observer : instance[observer];
    this.safeInvoke(instance, fn, [value, previous, name], `${instance.__route__}.observer(${name})`);
  }

  detachComponent(instance) {
    if (!instance) return;
    for (const hook of instance.__hooks.detached) this.safeInvoke(instance, hook, [], `${instance.__route__}.detached`);
  }

  markSource(element, node) {
    if (!element || !node || node.type !== 'element') return;
    if (node.sourceFile) element.setAttribute('data-dsh-source-file', String(node.sourceFile));
    if (Number.isInteger(node.sourceLine) && node.sourceLine > 0) {
      element.setAttribute('data-dsh-source-line', String(node.sourceLine));
    }
    element.setAttribute('data-dsh-source-kind', 'wxml');
  }

  renderBuiltin(node, context, parent, key, omitted) {
    if (node.name === 'picker') {
      const label = document.createElement('label');
      label.className = 'mp-picker';
      label.dataset.mpBuiltin = 'picker';
      this.markSource(label, node);
      const pickerOmitted = new Set([...omitted, 'mode', 'range', 'range-key', 'value', 'start', 'end', 'disabled']);
      this.applyAttributes(label, node, context, pickerOmitted);
      this.renderNodeList(node.children || [], context, label, key);
      const mode = String(this.evaluateAttribute(node.attrs.mode || 'selector', context) || 'selector');
      const control = document.createElement(mode === 'date' ? 'input' : 'select');
      control.className = 'mp-picker-control';
      if (mode === 'date') control.type = 'date';
      const value = this.evaluateAttribute(node.attrs.value || '', context);
      if (mode === 'date') {
        if (value !== undefined && value !== null) control.value = String(value);
        if (node.attrs.start) control.min = String(this.evaluateAttribute(node.attrs.start, context) || '');
        if (node.attrs.end) control.max = String(this.evaluateAttribute(node.attrs.end, context) || '');
      } else {
        const range = this.evaluateAttribute(node.attrs.range || '', context);
        const rangeKey = node.attrs['range-key']
          ? String(this.evaluateAttribute(node.attrs['range-key'], context) || '')
          : '';
        const options = Array.isArray(range) ? range : [];
        options.forEach((item, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          const labelValue = rangeKey && item && typeof item === 'object' ? item[rangeKey] : item;
          option.textContent = labelValue === undefined || labelValue === null ? '' : String(labelValue);
          control.appendChild(option);
        });
        const selectedIndex = Number(value);
        control.value = String(Number.isFinite(selectedIndex) && selectedIndex >= 0 ? selectedIndex : 0);
      }
      control.disabled = Boolean(this.evaluateAttribute(node.attrs.disabled || '', context));
      this.bindDomEvents(control, node, context);
      label.appendChild(control);
      parent.appendChild(label);
      return;
    }

    let element;
    switch (node.name) {
      case 'view': element = document.createElement('div'); break;
      case 'cover-view': element = document.createElement('div'); break;
      case 'text': element = document.createElement('span'); break;
      case 'icon': element = document.createElement('span'); element.className = 'mp-icon'; break;
      case 'button': element = document.createElement('button'); element.type = 'button'; break;
      case 'image': element = document.createElement('img'); break;
      case 'cover-image': element = document.createElement('img'); break;
      case 'scroll-view': element = document.createElement('div'); break;
      case 'swiper': element = document.createElement('div'); element.className = 'mp-swiper'; break;
      case 'swiper-item': element = document.createElement('div'); element.className = 'mp-swiper-item'; break;
      case 'movable-area': element = document.createElement('div'); break;
      case 'movable-view': element = document.createElement('div'); break;
      case 'input': element = document.createElement('input'); break;
      case 'textarea': element = document.createElement('textarea'); break;
      case 'form': element = document.createElement('form'); break;
      case 'label': element = document.createElement('label'); break;
      case 'checkbox-group': element = document.createElement('div'); break;
      case 'checkbox': element = document.createElement('input'); element.type = 'checkbox'; element.className = 'mp-checkbox'; break;
      case 'radio-group': element = document.createElement('div'); break;
      case 'radio': element = document.createElement('input'); element.type = 'radio'; element.className = 'mp-radio'; break;
      case 'switch': element = document.createElement('input'); element.type = 'checkbox'; element.className = 'mp-switch'; break;
      case 'slider': element = document.createElement('input'); element.type = 'range'; element.className = 'mp-slider'; break;
      case 'progress': element = document.createElement('progress'); break;
      case 'navigator': element = document.createElement('a'); element.href = '#'; break;
      case 'video': element = document.createElement('video'); element.controls = true; break;
      case 'audio': element = document.createElement('audio'); element.controls = true; break;
      case 'canvas': element = document.createElement('canvas'); break;
      case 'rich-text': element = document.createElement('div'); break;
      case 'open-data': element = document.createElement('span'); element.className = 'mp-open-data'; break;
      case 'match-media':
      case 'page-container':
      case 'picker-view':
      case 'picker-view-column':
      case 'root-portal':
      case 'share-element':
        element = document.createElement('div');
        break;
      case 'ad': case 'editor': case 'official-account': case 'map': case 'camera':
      case 'live-player': case 'live-pusher': case 'web-view':
        element = document.createElement('div');
        element.className = 'mp-native-placeholder';
        break;
      default: element = document.createElement('div');
    }
    element.dataset.mpBuiltin = node.name;
    this.markSource(element, node);
    this.applyAttributes(element, node, context, omitted);
    if (node.name === 'radio' && parent?.dataset?.mpBuiltin === 'radio-group') {
      element.name = parent.dataset.mpRadioGroup || `radio-group-${key}`;
    }
    if (node.name === 'radio-group') {
      element.dataset.mpRadioGroup = key;
    }
    this.bindDomEvents(element, node, context);

    if (node.name === 'scroll-view') {
      if (this.evaluateAttribute(node.attrs['scroll-y'], context)) element.classList.add('mp-scroll-y');
      if (this.evaluateAttribute(node.attrs['scroll-x'], context)) element.classList.add('mp-scroll-x');
    }
    if (node.name === 'navigator') {
      element.addEventListener('click', (event) => {
        event.preventDefault();
        const openType = String(this.evaluateAttribute(node.attrs['open-type'] || 'navigate', context));
        const mode = { redirect: 'redirectTo', switchTab: 'switchTab', reLaunch: 'reLaunch', navigateBack: 'navigateBack' }[openType] || 'navigateTo';
        if (mode === 'navigateBack') {
          this.navigateBack();
          return;
        }
        const url = this.evaluateAttribute(node.attrs.url || '', context);
        if (!url) return;
        this.openRoute(String(url), {}, mode);
      });
    }
    if (node.name === 'button') {
      this.bindOpenType(element, node, context);
    }
    if (node.name === 'open-data') {
      const type = String(this.evaluateAttribute(node.attrs.type || '', context));
      if (type === 'userNickName') element.textContent = this.identity.profile?.nickName || '预览用户';
      if (type === 'userAvatarUrl') {
        element.textContent = '';
        const avatar = document.createElement('img');
        avatar.alt = this.identity.profile?.nickName || '预览用户';
        avatar.src = this.identity.profile?.avatarUrl || '';
        element.appendChild(avatar);
      }
    }
    if (element.classList.contains('mp-native-placeholder')) {
      element.textContent = `${node.name} · 需微信环境终验`;
    }
    if (node.name === 'rich-text') {
      const nodes = this.evaluateAttribute(node.attrs.nodes || '', context);
      this.renderRichText(nodes, element);
    } else if (!['image', 'cover-image', 'input', 'textarea', 'checkbox', 'radio', 'switch', 'slider', 'progress', 'video', 'audio', 'canvas', 'open-data', 'map', 'camera', 'live-player', 'live-pusher', 'web-view', 'editor'].includes(node.name)) {
      this.renderNodeList(node.children || [], context, element, key);
    }
    parent.appendChild(element);
  }

  bindOpenType(element, node, context) {
    const openType = String(this.evaluateAttribute(node.attrs['open-type'] || '', context) || '').trim();
    if (!openType) return;
    element.addEventListener('click', (event) => {
      if (node.attrs.disabled && this.evaluateAttribute(node.attrs.disabled, context)) return;
      if (openType === 'navigateBack') {
        event.preventDefault();
        this.navigateBack();
        return;
      }
      if (openType === 'navigate' || openType === 'redirect' || openType === 'switchTab' || openType === 'reLaunch') {
        const url = String(this.evaluateAttribute(node.attrs.url || '', context) || '').trim();
        if (!url) return;
        event.preventDefault();
        const mode = { navigate: 'navigateTo', redirect: 'redirectTo', switchTab: 'switchTab', reLaunch: 'reLaunch' }[openType];
        this.openRoute(url, {}, mode);
        return;
      }
      if (openType === 'getUserProfile') {
        this.wx.getUserProfile({ desc: node.attrs['lang'] || '用于完善公开资料' });
      } else if (openType === 'getPhoneNumber') {
        this.callHandler(context, node.attrs['bindgetphonenumber'] || node.attrs['bind:getphonenumber'], {
          type: 'getphonenumber',
          detail: { code: this.identity.token || '', encryptedData: '', iv: '' },
          target: { dataset: {} },
          currentTarget: { dataset: {} }
        }, `${context.instance.route || context.instance.__route__}.getPhoneNumber`);
      }
    });
  }

  resolveAssetUrl(value, context) {
    const source = String(value || '').trim();
    if (!source || /^(?:data:|blob:|https?:|\/\/)/.test(source)) return source;
    if (source.startsWith('cloud://')) {
      this.log('warn', 'cloud:// 资源无法在本地预览中读取', source);
      return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"%3E%3Crect width="160" height="100" rx="12" fill="%23eef4f1"/%3E%3Ctext x="80" y="54" text-anchor="middle" font-size="12" fill="%23708078"%3Ecloud asset%3C/text%3E%3C/svg%3E';
    }
    const match = source.match(/^([^?#]*)([?#].*)?$/);
    const path = match?.[1] || source;
    const suffix = match?.[2] || '';
    if (path.startsWith('/')) return `${path}${suffix}`;
    const directory = context.artifact?.directory && context.artifact.directory !== '.'
      ? context.artifact.directory
      : '';
    const parts = `${directory}/${path}`.split('/');
    const normalized = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') normalized.pop();
      else normalized.push(part);
    }
    return `/${normalized.join('/')}${suffix}`;
  }

  applyAttributes(element, node, context, omitted = new Set()) {
    for (const [name, rawValue] of Object.entries(node.attrs || {})) {
      if (CONTROL_ATTRIBUTES.has(name) || omitted.has(name) || normalizeEventBindingName(name)) continue;
      if (['mode', 'scroll-y', 'scroll-x', 'enable-back-to-top', 'nodes', 'slot', 'open-type'].includes(name)) continue;
      const value = this.evaluateAttribute(rawValue, context);
      if (name === 'class') {
        element.classList.add(...String(value || '').split(/\s+/).filter(Boolean));
      } else if (name === 'style') {
        if (value) element.setAttribute('style', String(value));
      } else if (name === 'src') {
        const src = this.resolveAssetUrl(String(value || ''), context);
        element.setAttribute('src', src);
        if (['image', 'cover-image'].includes(node.name)) {
          const mode = node.attrs.mode || '';
          if (mode === 'aspectFit') element.style.objectFit = 'contain';
          if (mode === 'aspectFill') element.style.objectFit = 'cover';
        }
      } else if (name === 'disabled' || name === 'checked' || name === 'hidden' || name === 'loading') {
        const enabled = Boolean(value);
        if (name === 'hidden') element.hidden = enabled;
        else if (name === 'loading') element.dataset.loading = String(enabled);
        else element[name] = enabled;
      } else if (name === 'form-type') {
        if (value === 'submit') element.type = 'submit';
        else if (value === 'reset') element.type = 'reset';
      } else if (name === 'type' && ['input', 'textarea'].includes(node.name)) {
        const supported = ['text', 'number', 'password', 'email', 'tel', 'date', 'search'];
        element.type = supported.includes(String(value)) ? String(value) : 'text';
      } else if (name === 'size' && node.name === 'button') {
        if (String(value) === 'mini') element.classList.add('mp-button-mini');
      } else if (name === 'color' && ['checkbox', 'radio', 'switch'].includes(node.name)) {
        if (value) element.style.setProperty('--mp-control-color', String(value));
      } else if (name === 'maxlength' && ['input', 'textarea'].includes(node.name)) {
        const maximum = Number(value);
        if (Number.isFinite(maximum)) element.maxLength = maximum;
      } else if (name === 'value') {
        element.value = value === null || value === undefined ? '' : String(value);
      } else if (name === 'id') {
        element.id = String(value || '');
      } else if (name.startsWith('aria-') || name === 'role' || name === 'title' || name === 'placeholder' || name === 'name') {
        if (value !== false && value !== null && value !== undefined) element.setAttribute(name, String(value));
      } else if (name.startsWith('data-')) {
        if (value !== undefined && value !== null) element.setAttribute(name, String(value));
      } else if (!['hover-class', 'confirm-type', 'adjust-position', 'cursor-spacing'].includes(name)) {
        if (value !== false && value !== null && value !== undefined && typeof value !== 'object') element.setAttribute(name, String(value));
      }
    }
  }

  bindDomEvents(element, node, context) {
    const dataset = {};
    for (const [name, rawValue] of Object.entries(node.attrs || {})) {
      if (name.startsWith('data-')) dataset[camelCase(name.slice(5))] = this.evaluateAttribute(rawValue, context);
    }
    for (const [name, handler] of Object.entries(node.attrs || {})) {
      const binding = normalizeEventBindingName(name);
      if (!binding) continue;
      const domEvent = EVENT_NAME_MAP[binding.event];
      if (!domEvent) continue;
      element.addEventListener(domEvent, (nativeEvent) => {
        if (binding.mode === 'catch') nativeEvent.stopPropagation();
        if (binding.event === 'confirm' && nativeEvent.key !== 'Enter') return;
        if (binding.event === 'scrolltolower') {
          const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
          if (!atBottom) return;
        }
        if (binding.event === 'scrolltoupper' && element.scrollTop > 8) return;
        if (binding.event === 'submit') nativeEvent.preventDefault();
        let detailValue = element.value;
        if (node.name === 'switch') detailValue = Boolean(element.checked);
        if (node.name === 'checkbox') detailValue = element.checked ? [element.value] : [];
        if (node.name === 'checkbox-group') {
          detailValue = Array.from(element.querySelectorAll('input[data-mp-builtin="checkbox"]:checked'))
            .map((control) => control.value);
        }
        if (node.name === 'form') {
          detailValue = Object.fromEntries(new FormData(element).entries());
        }
        const event = {
          type: binding.event,
          timeStamp: nativeEvent.timeStamp,
          detail: {
            value: detailValue,
            checked: Boolean(element.checked),
            scrollTop: element.scrollTop || 0,
            scrollHeight: element.scrollHeight || 0
          },
          target: { id: element.id || '', dataset: clone(dataset), value: detailValue },
          currentTarget: { id: element.id || '', dataset: clone(dataset) }
        };
        this.callHandler(context, handler, event, `${context.instance.route || context.instance.__route__}.${handler}`);
      });
    }
  }

  callHandler(context, handler, event, label) {
    const instance = context.instance || context;
    const fn = typeof handler === 'function' ? handler : instance?.[handler];
    if (typeof fn !== 'function') {
      this.log('warn', `未找到事件处理函数 ${handler}`, label);
      return;
    }
    this.safeInvoke(instance, fn, [event], label);
  }

  scopeFor(context) {
    return {
      ...(context.instance?.data || {}),
      ...(context.instance?.properties || {}),
      ...(context.locals || {}),
      $slot: context.slotPresence || {},
      Math,
      Date,
      JSON
    };
  }

  evaluateExpression(expression, context) {
    const source = String(expression || '').trim();
    if (!source) return '';
    try {
      const evaluator = new Function('scope', `with (scope) { return (${source}); }`);
      return evaluator(this.scopeFor(context));
    } catch (error) {
      if (error instanceof TypeError && /Cannot read properties of (?:null|undefined)/.test(error.message)) {
        return undefined;
      }
      const failureKey = `${context.instance?.route || context.instance?.__route__}:${source}:${error.message}`;
      if (!this.expressionFailures.has(failureKey)) {
        this.expressionFailures.add(failureKey);
        this.log('warn', `表达式解析失败: ${source}`, error.message);
      }
      return undefined;
    }
  }

  evaluateAttribute(value, context) {
    if (value === undefined) return true;
    const source = String(value);
    if (!source.includes('{{')) return source;
    const expressions = [...source.matchAll(/{{([\s\S]*?)}}/g)];
    if (
      expressions.length === 1
      && source.slice(0, expressions[0].index).trim() === ''
      && source.slice(expressions[0].index + expressions[0][0].length).trim() === ''
    ) {
      return this.evaluateExpression(expressions[0][1], context);
    }
    return source.replace(/{{([\s\S]*?)}}/g, (_, expression) => {
      const result = this.evaluateExpression(expression, context);
      return result === null || result === undefined ? '' : String(result);
    });
  }

  interpolate(value, context) {
    return String(this.evaluateAttribute(value, context) ?? '');
  }

  renderRichText(nodes, parent) {
    const values = Array.isArray(nodes) ? nodes : (nodes === null || nodes === undefined ? [] : [nodes]);
    for (const node of values) {
      if (typeof node === 'string' || typeof node === 'number') {
        parent.appendChild(document.createTextNode(String(node)));
        continue;
      }
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'text' || Object.prototype.hasOwnProperty.call(node, 'text')) {
        parent.appendChild(document.createTextNode(String(node.text || '')));
        continue;
      }
      const safeTags = new Set(['p', 'div', 'span', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'code', 'pre', 'br', 'a']);
      const name = safeTags.has(node.name) ? node.name : 'span';
      const element = document.createElement(name);
      for (const [key, value] of Object.entries(node.attrs || {})) {
        if (['class', 'style', 'href', 'title'].includes(key)) element.setAttribute(key, String(value));
      }
      this.renderRichText(node.children || [], element);
      parent.appendChild(element);
    }
  }

  createWxApi() {
    const runtime = this;
    const projectId = this.manifest.project?.id || 'project';
    const storagePrefix = `__wxpreview:${projectId}:`;
    const storageKey = (key) => `${storagePrefix}${key}`;
    const finish = (options, result, success = true) => {
      try { options?.[success ? 'success' : 'fail']?.(result); } finally { options?.complete?.(result); }
      return result;
    };
    const backendCallFunction = (options = {}) => {
      try {
        if (typeof runtime.backend?.callFunction === 'function') {
          return Promise.resolve(runtime.backend.callFunction(options));
        }
      } catch (error) {
        runtime.log('warn', '本地云函数适配器调用失败', error);
      }
      return Promise.resolve({
        result: {
          success: false,
          preview: true,
          message: 'wxpreview 未配置本地云函数适配器'
        }
      });
    };
    const navigate = (mode) => (options = {}) => {
      const parsed = parseRouteUrl(options.url || '');
      const succeeded = mode === 'navigateBack'
        ? runtime.navigateBack(options.delta || 1)
        : runtime.openRoute(parsed.route, parsed.query, mode);
      return finish(options, { errMsg: `${mode}:${succeeded ? 'ok' : 'fail'}` }, succeeded);
    };
    const systemInfo = () => {
      const screenWidth = runtime.root?.clientWidth || 390;
      const screenHeight = runtime.root?.clientHeight || 844;
      const scale = screenWidth / 390;
      const statusBarHeight = 47 * scale;
      const safeAreaBottom = screenHeight - (34 * scale);
      const nativeNavigationHeight = runtime.isNativeNavigation(runtime.currentRoute) ? 91 * scale : 0;
      return {
        brand: 'Apple',
        model: 'iPhone 12/13 (Pro)',
        platform: 'devtools',
        system: 'iOS 17.0',
        language: 'zh_CN',
        version: '8.0.50',
        SDKVersion: '3.7.12',
        windowWidth: screenWidth,
        windowHeight: screenHeight - nativeNavigationHeight,
        screenWidth,
        screenHeight,
        statusBarHeight,
        pixelRatio: 3,
        safeArea: {
          left: 0,
          right: screenWidth,
          top: statusBarHeight,
          bottom: safeAreaBottom,
          width: screenWidth,
          height: safeAreaBottom - statusBarHeight
        }
      };
    };
    const userResult = () => {
      const userInfo = clone(runtime.identity.profile || { nickName: '预览用户', avatarUrl: '' });
      return {
        userInfo,
        rawData: JSON.stringify(userInfo),
        signature: 'wxpreview-signature',
        encryptedData: 'wxpreview-encrypted-data',
        iv: 'wxpreview-iv',
        cloudID: 'wxpreview-cloud-id',
        errMsg: 'getUserProfile:ok'
      };
    };
    const animation = () => {
      const steps = [];
      const chain = new Proxy({}, {
        get(_target, property) {
          if (property === 'step') return (options = {}) => { steps.push({ type: 'step', options }); return chain; };
          if (property === 'export') return () => ({ actions: clone(steps) });
          return (...args) => { steps.push({ type: property, args }); return chain; };
        }
      });
      return chain;
    };

    const api = {
      cloud: {
        init() {},
        callFunction(options = {}) {
          return backendCallFunction(options);
        },
        callContainer(options = {}) {
          const functionName = options.path?.split('/').filter(Boolean).pop() || 'unknown';
          return backendCallFunction({ name: functionName, data: options.data })
            .then((response) => ({ statusCode: 200, data: response.result }));
        },
        uploadFile(options = {}) {
          const result = { fileID: `cloud://wxpreview/${Date.now()}.png`, statusCode: 200, errMsg: 'uploadFile:ok' };
          finish(options, result, true);
          return Promise.resolve(result);
        }
      },
      login(options = {}) {
        return finish(options, { code: runtime.identity.token || `wxpreview_${projectId}`, errMsg: 'login:ok' }, true);
      },
      checkSession(options = {}) {
        return finish(options, { errMsg: 'checkSession:ok' }, true);
      },
      getUserProfile(options = {}) {
        return finish(options, userResult(), true);
      },
      getUserInfo(options = {}) {
        return finish(options, userResult(), true);
      },
      getSetting(options = {}) {
        return finish(options, { authSetting: clone(runtime.identity.scopes || {}), subscriptionsSetting: {}, errMsg: 'getSetting:ok' }, true);
      },
      authorize(options = {}) {
        if (options.scope) runtime.identity.scopes[options.scope] = true;
        return finish(options, { errMsg: 'authorize:ok' }, true);
      },
      openSetting(options = {}) {
        return finish(options, { authSetting: clone(runtime.identity.scopes || {}), errMsg: 'openSetting:ok' }, true);
      },
      canIUse() { return true; },
      getStorageSync(key) {
        const raw = localStorage.getItem(storageKey(key));
        if (raw === null) return '';
        try { return JSON.parse(raw); } catch (_) { return raw; }
      },
      setStorageSync(key, value) {
        localStorage.setItem(storageKey(key), JSON.stringify(value));
      },
      removeStorageSync(key) {
        localStorage.removeItem(storageKey(key));
      },
      clearStorageSync() {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith(storagePrefix)) localStorage.removeItem(key);
        }
      },
      getStorage(options = {}) {
        const data = api.getStorageSync(options.key);
        const found = data !== '';
        return finish(options, found ? { data, errMsg: 'getStorage:ok' } : { errMsg: 'getStorage:fail data not found' }, found);
      },
      setStorage(options = {}) {
        api.setStorageSync(options.key, options.data);
        return finish(options, { errMsg: 'setStorage:ok' }, true);
      },
      removeStorage(options = {}) {
        api.removeStorageSync(options.key);
        return finish(options, { errMsg: 'removeStorage:ok' }, true);
      },
      clearStorage(options = {}) {
        api.clearStorageSync();
        return finish(options, { errMsg: 'clearStorage:ok' }, true);
      },
      getStorageInfoSync() {
        const keys = Object.keys(localStorage).filter((key) => key.startsWith(storagePrefix)).map((key) => key.slice(storagePrefix.length));
        return { keys, currentSize: Math.max(1, JSON.stringify(localStorage).length / 1024), limitSize: 10240 };
      },
      getStorageInfo(options = {}) {
        return finish(options, { ...api.getStorageInfoSync(), errMsg: 'getStorageInfo:ok' }, true);
      },
      navigateTo: navigate('navigateTo'),
      redirectTo: navigate('redirectTo'),
      switchTab: navigate('switchTab'),
      reLaunch: navigate('reLaunch'),
      navigateBack: navigate('navigateBack'),
      showToast(options = {}) { return runtime.showToast(options); },
      showLoading(options = {}) { return runtime.showLoading(options); },
      hideLoading(options = {}) { return runtime.hideLoading(options); },
      showModal(options = {}) { return runtime.showModal(options); },
      showActionSheet(options = {}) {
        const result = { tapIndex: 0, errMsg: 'showActionSheet:ok' };
        return finish(options, result, true);
      },
      stopPullDownRefresh(options = {}) { return finish(options, { errMsg: 'stopPullDownRefresh:ok' }, true); },
      getSystemInfoSync: systemInfo,
      getSystemInfo(options = {}) { return finish(options, { ...systemInfo(), errMsg: 'getSystemInfo:ok' }, true); },
      getWindowInfo() { return systemInfo(); },
      getDeviceInfo() {
        const info = systemInfo();
        return { brand: info.brand, model: info.model, platform: info.platform, system: info.system };
      },
      getAppBaseInfo() {
        const info = systemInfo();
        return { SDKVersion: info.SDKVersion, language: info.language, version: info.version, theme: 'light' };
      },
      getMenuButtonBoundingClientRect() {
        const width = runtime.root?.clientWidth || 390;
        const scale = width / 390;
        const menuWidth = 87 * scale;
        const menuHeight = 32 * scale;
        const top = 51 * scale;
        const right = width - (8 * scale);
        return { width: menuWidth, height: menuHeight, top, right, bottom: top + menuHeight, left: right - menuWidth };
      },
      getAccountInfoSync() {
        return {
          miniProgram: {
            appId: runtime.manifest.project?.appId || 'wxpreview',
            envVersion: 'develop',
            version: 'preview'
          },
          plugin: { appId: '', version: '' }
        };
      },
      getPrivacySetting(options = {}) {
        return finish(options, { needAuthorization: false, privacyContractName: 'wxpreview 本地预览', errMsg: 'getPrivacySetting:ok' }, true);
      },
      requirePrivacyAuthorize(options = {}) {
        return finish(options, { errMsg: 'requirePrivacyAuthorize:ok' }, true);
      },
      getNetworkType(options = {}) {
        return finish(options, { networkType: 'wifi', errMsg: 'getNetworkType:ok' }, true);
      },
      onNetworkStatusChange() {},
      offNetworkStatusChange() {},
      setClipboardData(options = {}) {
        runtime.__clipboard = String(options.data || '');
        return finish(options, { errMsg: 'setClipboardData:ok' }, true);
      },
      getClipboardData(options = {}) {
        return finish(options, { data: runtime.__clipboard || '', errMsg: 'getClipboardData:ok' }, true);
      },
      createAnimation: animation,
      nextTick(callback) { queueMicrotask(() => callback?.()); },
      setNavigationBarTitle(options = {}) {
        const title = String(options.title || '');
        const node = document.querySelector('.mp-native-navigation-title');
        if (node) node.textContent = title;
        document.title = title ? `${title} · wxpreview` : document.title;
        return finish(options, { errMsg: 'setNavigationBarTitle:ok' }, true);
      },
      setNavigationBarColor(options = {}) { return finish(options, { errMsg: 'setNavigationBarColor:ok' }, true); },
      pageScrollTo(options = {}) {
        const page = runtime.root?.querySelector('.mp-page');
        page?.scrollTo({ top: Number(options.scrollTop) || 0, behavior: options.duration ? 'smooth' : 'auto' });
        return finish(options, { errMsg: 'pageScrollTo:ok' }, true);
      },
      setTabBarBadge(options = {}) {
        const route = normalizeRoutePath(options.pagePath || options.index || '');
        if (route) runtime.tabBarBadges.set(route, String(options.text ?? ''));
        runtime.requestRender();
        return finish(options, { errMsg: 'setTabBarBadge:ok' }, true);
      },
      removeTabBarBadge(options = {}) {
        const route = normalizeRoutePath(options.pagePath || options.index || '');
        if (route) runtime.tabBarBadges.delete(route);
        runtime.requestRender();
        return finish(options, { errMsg: 'removeTabBarBadge:ok' }, true);
      },
      showTabBar(options = {}) {
        runtime.tabBarHidden = false;
        runtime.requestRender();
        return finish(options, { errMsg: 'showTabBar:ok' }, true);
      },
      hideTabBar(options = {}) {
        runtime.tabBarHidden = true;
        runtime.requestRender();
        return finish(options, { errMsg: 'hideTabBar:ok' }, true);
      },
      setTabBarStyle(options = {}) {
        runtime.tabBarStyle = { ...runtime.tabBarStyle, ...options };
        runtime.requestRender();
        return finish(options, { errMsg: 'setTabBarStyle:ok' }, true);
      },
      setTabBarItem(options = {}) {
        const route = normalizeRoutePath(options.pagePath || '');
        if (route && runtime.tabBarItems().some((candidate) => candidate.route === route)) {
          runtime.tabBarItemOverrides.set(route, { ...runtime.tabBarItemOverrides.get(route), ...options });
        }
        runtime.requestRender();
        return finish(options, { errMsg: 'setTabBarItem:ok' }, true);
      },
      vibrateShort(options = {}) { return finish(options, { errMsg: 'vibrateShort:ok' }, true); },
      getUpdateManager() {
        return {
          onCheckForUpdate(callback) { queueMicrotask(() => callback?.({ hasUpdate: false })); },
          onUpdateReady() {},
          onUpdateFailed() {},
          applyUpdate() {}
        };
      },
      getFileSystemManager() {
        const unavailable = (name) => (options = {}) => finish(options, { errMsg: `${name}:fail wxpreview only exposes project assets over HTTP` }, false);
        return {
          getFileInfo(options = {}) { return finish(options, { size: 0, errMsg: 'getFileInfo:ok' }, true); },
          readFile: unavailable('readFile'),
          writeFile: unavailable('writeFile'),
          saveFile: unavailable('saveFile'),
          unlink: unavailable('unlink')
        };
      },
      createSelectorQuery() {
        let selector = '';
        const operations = [];
        const apiObject = {
          select(value) { selector = value; return apiObject; },
          selectAll(value) { selector = value; apiObject.__all = true; return apiObject; },
          fields(_fields, callback) {
            operations.push(() => {
              const nodes = apiObject.__all ? Array.from(runtime.root?.querySelectorAll(selector) || []) : [runtime.root?.querySelector(selector)].filter(Boolean);
              const result = nodes.map((node) => ({ id: node.id, dataset: clone(node.dataset), value: node.value || '', ...node.getBoundingClientRect().toJSON?.() }));
              callback?.(apiObject.__all ? result : result[0] || null);
              return apiObject.__all ? result : result[0] || null;
            });
            return apiObject;
          },
          boundingClientRect(callback) {
            operations.push(() => {
              const nodes = apiObject.__all ? Array.from(runtime.root?.querySelectorAll(selector) || []) : [runtime.root?.querySelector(selector)].filter(Boolean);
              const result = nodes.map((node) => node.getBoundingClientRect());
              callback?.(apiObject.__all ? result : result[0] || null);
              return apiObject.__all ? result : result[0] || null;
            });
            return apiObject;
          },
          scrollOffset(callback) {
            operations.push(() => {
              const node = runtime.root?.querySelector(selector);
              const result = node ? { scrollLeft: node.scrollLeft, scrollTop: node.scrollTop } : null;
              callback?.(result);
              return result;
            });
            return apiObject;
          },
          exec(callback) { const results = operations.map((operation) => operation()); callback?.(results); return apiObject; },
          in() { return apiObject; }
        };
        return apiObject;
      },
      request(options = {}) {
        let mocked = null;
        try {
          mocked = typeof runtime.backend?.request === 'function' ? runtime.backend.request(options) : null;
        } catch (error) {
          runtime.log('warn', '本地网络适配器调用失败', error);
        }
        if (mocked) {
          const result = { statusCode: mocked.statusCode || 200, header: mocked.header || {}, data: mocked.data ?? mocked, errMsg: 'request:ok' };
          finish(options, result, true);
        } else {
          const result = { errMsg: `request:fail wxpreview 没有为 ${options.url || ''} 配置本地响应` };
          runtime.log('warn', result.errMsg);
          finish(options, result, false);
        }
        return { abort() {} };
      },
      uploadFile(options = {}) {
        const result = { statusCode: 200, data: '{}', errMsg: 'uploadFile:ok' };
        finish(options, result, true);
        return { abort() {}, onProgressUpdate() {} };
      },
      downloadFile(options = {}) {
        const result = { errMsg: 'downloadFile:fail wxpreview 未下载远程文件' };
        finish(options, result, false);
        return { abort() {}, onProgressUpdate() {} };
      }
    };

    const unknown = new Set();
    const unsupportedApi = (name) => {
      let chain;
      const callable = (...args) => {
        if (!unknown.has(name)) {
          unknown.add(name);
          runtime.log('warn', `wx.${name} 尚未适配，已降级为空操作`);
        }
        const options = args[0];
        const result = { errMsg: `${name}:fail wxpreview unsupported API` };
        if (options && typeof options === 'object') finish(options, result, false);
        return chain;
      };
      chain = new Proxy(callable, {
        get(_target, property) {
          if (property === 'then') return undefined;
          if (property === 'abort' || property === 'cancel') return () => {};
          if (property === 'onProgressUpdate' || property === 'onHeadersReceived' || property === 'onChunkReceived') return () => chain;
          return unsupportedApi(`${name}.${String(property)}`);
        }
      });
      return chain;
    };
    api.cloud = new Proxy(api.cloud, {
      get(target, property) {
        if (property in target) return target[property];
        return unsupportedApi(`cloud.${String(property)}`);
      }
    });
    return new Proxy(api, {
      get(target, property) {
        if (property in target) return target[property];
        if (property === 'then') return undefined;
        return unsupportedApi(String(property));
      }
    });
  }

  showToast(options = {}) {
    const node = document.getElementById('preview-toast');
    if (!node) return;
    clearTimeout(this.toastTimer);
    node.textContent = options.title || '';
    node.hidden = false;
    this.toastTimer = setTimeout(() => {
      node.hidden = true;
      options.complete?.({ errMsg: 'showToast:ok' });
    }, Number(options.duration) || 1600);
    options.success?.({ errMsg: 'showToast:ok' });
    return { errMsg: 'showToast:ok' };
  }

  showLoading(options = {}) {
    const node = document.getElementById('preview-loading');
    const text = document.getElementById('preview-loading-text');
    if (text) text.textContent = options.title || '加载中…';
    if (node) node.hidden = false;
    options.success?.({ errMsg: 'showLoading:ok' });
    options.complete?.({ errMsg: 'showLoading:ok' });
    return { errMsg: 'showLoading:ok' };
  }

  hideLoading(options = {}) {
    const node = document.getElementById('preview-loading');
    if (node) node.hidden = true;
    options.success?.({ errMsg: 'hideLoading:ok' });
    options.complete?.({ errMsg: 'hideLoading:ok' });
    return { errMsg: 'hideLoading:ok' };
  }

  showModal(options = {}) {
    const root = document.getElementById('preview-modal-root');
    if (!root) return Promise.resolve({ confirm: true, cancel: false });
    root.replaceChildren();
    const overlay = document.createElement('div');
    overlay.className = 'preview-native-modal';
    const card = document.createElement('div');
    card.className = 'preview-native-modal-card';
    const copy = document.createElement('div');
    copy.className = 'preview-native-modal-copy';
    const title = document.createElement('strong');
    title.textContent = options.title || '提示';
    const content = document.createElement('p');
    content.textContent = options.content || '';
    copy.append(title, content);
    const actions = document.createElement('div');
    actions.className = 'preview-native-modal-actions';
    card.append(copy, actions);
    overlay.appendChild(card);
    root.appendChild(overlay);
    return new Promise((resolve) => {
      const close = (result) => {
        root.replaceChildren();
        options.success?.(result);
        options.complete?.(result);
        resolve(result);
      };
      if (options.showCancel !== false) {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = options.cancelText || '取消';
        cancel.addEventListener('click', () => close({ confirm: false, cancel: true }));
        actions.appendChild(cancel);
      }
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.textContent = options.confirmText || '确定';
      confirm.addEventListener('click', () => close({ confirm: true, cancel: false }));
      actions.appendChild(confirm);
    });
  }

  debugSnapshot() {
    const page = this.currentPage();
    return {
      route: this.currentRoute,
      stack: this.stack.map((entry) => entry.route),
      data: clone(page?.data || {}),
      html: this.root?.innerHTML || ''
    };
  }
}
