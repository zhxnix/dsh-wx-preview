import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildManifest, bundleProjectScripts } from './compiler.mjs';
import { fingerprintProject, listRelevantFiles, resolveNativeProject } from './project.mjs';

const CACHE_VERSION = 2;
const cloneJson = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const DEFAULT_AVATAR_URL = 'cloud://wxpreview-local/avatar.png';

export function wxpreviewHome() {
  return path.resolve(process.env.DSH_WX_PREVIEW_HOME || path.join(os.homedir(), '.dsh-wx-preview'));
}

export function cacheDirectoryFor(project) {
  return path.join(wxpreviewHome(), 'projects', project.id);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function stableToken(projectId) {
  return `wxpreview_${crypto.createHash('sha256').update(projectId).digest('hex').slice(0, 24)}`;
}

function defaultIdentity(project, compatibility) {
  const token = stableToken(project.id);
  const profile = {
    nickName: '预览用户',
    avatarUrl: DEFAULT_AVATAR_URL,
    gender: 0,
    country: 'China',
    province: '',
    city: '',
    language: 'zh_CN'
  };
  const storage = { userInfo: profile };
  const discovered = new Set(compatibility.storageKeys || []);
  for (const key of discovered) {
    if (/^(?:token|access[_-]?token|session|session[_-]?key|jwt)$/i.test(key)) storage[key] = token;
    else if (/^(?:openid|openId)$/i.test(key)) storage[key] = `openid_${project.id}`;
    else if (/^(?:isLogin|isLoggedIn|loggedIn|hasLogin|authorized)$/i.test(key)) storage[key] = true;
    else if (/^(?:user|userInfo|profile|currentUser)$/i.test(key)) storage[key] = profile;
  }
  const scopes = {
    'scope.userInfo': true,
    'scope.userLocation': true,
    'scope.writePhotosAlbum': true,
    'scope.camera': true,
    'scope.record': true
  };
  for (const scope of compatibility.authScopes || []) scopes[scope] = true;
  return {
    version: 1,
    autoLogin: true,
    profile,
    openid: `openid_${project.id}`,
    unionid: `unionid_${project.id}`,
    token,
    scopes,
    storage,
    globalData: {
      userInfo: profile,
      openid: `openid_${project.id}`,
      token,
      isLogin: true,
      loggedIn: true
    },
    loginRoutes: compatibility.loginRoutes || [],
    requestMocks: [],
    cloudFunctionMocks: {}
  };
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) output[key] = deepMerge(output[key], value);
    else output[key] = value;
  }
  return output;
}

function identityFor(project, compatibility, override) {
  const file = path.join(cacheDirectoryFor(project), 'identity.json');
  const defaults = defaultIdentity(project, compatibility);
  const existing = readJson(file, {});
  const identity = deepMerge(deepMerge(defaults, existing), override || {});
  if (identity.autoLogin !== false && !identity.profile?.avatarUrl) {
    identity.profile = { ...(identity.profile || {}), avatarUrl: DEFAULT_AVATAR_URL };
  }
  identity.scopes = identity.scopes || {};
  identity.storage = identity.storage || {};
  identity.globalData = identity.globalData || {};
  if (!override?.storage || !Object.prototype.hasOwnProperty.call(override.storage, 'userInfo')) {
    identity.storage.userInfo = cloneJson(identity.profile);
  }
  if (!override?.globalData || !Object.prototype.hasOwnProperty.call(override.globalData, 'userInfo')) {
    identity.globalData.userInfo = cloneJson(identity.profile);
  }
  writeJson(file, identity);
  return identity;
}

export async function precompileProject(inputPath, options = {}) {
  const project = typeof inputPath === 'object' && inputPath.sourceRoot
    ? inputPath
    : resolveNativeProject(inputPath);
  const cacheDir = cacheDirectoryFor(project);
  fs.mkdirSync(cacheDir, { recursive: true });
  const fingerprint = fingerprintProject(project);
  const stateFile = path.join(cacheDir, 'precompile.json');
  const previous = readJson(stateFile, {});
  const canReuse = !options.force
    && previous.cacheVersion === CACHE_VERSION
    && previous.fingerprint === fingerprint
    && fs.existsSync(path.join(cacheDir, 'manifest.json'))
    && fs.existsSync(path.join(cacheDir, 'app.bundle.js'))
    && fs.existsSync(path.join(cacheDir, 'definitions.bundle.js'));

  let manifest;
  let bundles;
  if (canReuse) {
    manifest = readJson(path.join(cacheDir, 'manifest.json'));
    bundles = {
      app: fs.readFileSync(path.join(cacheDir, 'app.bundle.js'), 'utf8'),
      definitions: fs.readFileSync(path.join(cacheDir, 'definitions.bundle.js'), 'utf8')
    };
  } else {
    const files = listRelevantFiles(project.sourceRoot);
    manifest = buildManifest(project, files);
    bundles = await bundleProjectScripts(project, manifest);
    writeJson(path.join(cacheDir, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(cacheDir, 'app.bundle.js'), bundles.app);
    fs.writeFileSync(path.join(cacheDir, 'definitions.bundle.js'), bundles.definitions);
  }

  const identity = identityFor(project, manifest.compatibility, options.identity);
  const generatedAt = new Date().toISOString();
  const state = {
    cacheVersion: CACHE_VERSION,
    pluginVersion: '0.1.0',
    generatedAt,
    reused: canReuse,
    fingerprint,
    project: manifest.project,
    counts: {
      pages: manifest.pageRoutes.length,
      components: manifest.componentRoutes.length,
      templates: Object.values(manifest.pages).reduce((sum, item) => sum + Object.keys(item.templates || {}).length, 0)
        + Object.values(manifest.components).reduce((sum, item) => sum + Object.keys(item.templates || {}).length, 0)
    },
    compatibility: manifest.compatibility
  };
  writeJson(stateFile, state);
  return { project, cacheDir, fingerprint, manifest, bundles, identity, state };
}

export async function updateProjectIdentity(inputPath, patch) {
  return precompileProject(inputPath, { identity: patch });
}

export function loadCachedProject(project) {
  const cacheDir = cacheDirectoryFor(project);
  return {
    cacheDir,
    manifest: readJson(path.join(cacheDir, 'manifest.json')),
    identity: readJson(path.join(cacheDir, 'identity.json')),
    state: readJson(path.join(cacheDir, 'precompile.json')),
    bundles: {
      app: fs.readFileSync(path.join(cacheDir, 'app.bundle.js'), 'utf8'),
      definitions: fs.readFileSync(path.join(cacheDir, 'definitions.bundle.js'), 'utf8')
    }
  };
}
