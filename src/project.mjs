import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRECTORIES = new Set([
  '.git', '.idea', '.vscode', 'node_modules', 'unpackage', 'dist', 'build',
  'coverage', '.turbo', '.next', '.cache'
]);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 JSON：${file}\n${error.message}`);
  }
}

function realpath(value) {
  const resolved = path.resolve(value);
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
}

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch (_) { return false; }
}

function isDirectory(file) {
  try { return fs.statSync(file).isDirectory(); } catch (_) { return false; }
}

function walkForProjects(root, maxDepth = 4) {
  const queue = [{ directory: root, depth: 0 }];
  const candidates = [];
  while (queue.length) {
    const { directory, depth } = queue.shift();
    const projectConfig = path.join(directory, 'project.config.json');
    const appConfig = path.join(directory, 'app.json');
    if (isFile(projectConfig) || isFile(appConfig)) candidates.push(directory);
    if (depth >= maxDepth) continue;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
      queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
    }
  }
  return candidates;
}

function resolveSourceRoot(projectRoot, projectConfig) {
  const configured = typeof projectConfig?.miniprogramRoot === 'string'
    ? projectConfig.miniprogramRoot.trim()
    : '';
  const sourceRoot = realpath(path.resolve(projectRoot, configured || '.'));
  if (!isFile(path.join(sourceRoot, 'app.json'))) {
    throw new Error(`没有找到原生小程序 app.json：${sourceRoot}`);
  }
  return sourceRoot;
}

function detectFramework(projectRoot, sourceRoot) {
  const appJs = isFile(path.join(sourceRoot, 'app.js'))
    ? fs.readFileSync(path.join(sourceRoot, 'app.js'), 'utf8').slice(0, 200000)
    : '';
  const uniMarkers = [
    /createSSRApp\s*\(/,
    /__uniConfig/,
    /@dcloudio\//,
    /uni-app/i
  ];
  if (uniMarkers.some((pattern) => pattern.test(appJs))) return 'uni-app';
  if (isFile(path.join(projectRoot, 'App.vue')) && isFile(path.join(projectRoot, 'manifest.json'))) return 'uni-app';
  if (/@tarojs\//.test(appJs) || /taro/i.test(appJs) && /createApp/.test(appJs)) return 'taro';
  return 'native';
}

function projectIdFor(sourceRoot) {
  return crypto.createHash('sha256').update(sourceRoot).digest('hex').slice(0, 16);
}

export function discoverNativeProjects(inputPath, options = {}) {
  if (!inputPath) throw new Error('请提供微信小程序项目目录。');
  const requested = realpath(inputPath);
  const start = isFile(requested) ? path.dirname(requested) : requested;
  if (!isDirectory(start)) throw new Error(`目录不存在：${start}`);

  const directCandidates = [];
  let cursor = start;
  for (let depth = 0; depth < 3; depth += 1) {
    if (isFile(path.join(cursor, 'project.config.json')) || isFile(path.join(cursor, 'app.json'))) {
      directCandidates.push(cursor);
      break;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const candidates = directCandidates.length
    ? directCandidates
    : walkForProjects(start, options.maxDepth ?? 4);

  const results = [];
  const seen = new Set();
  for (const candidate of candidates) {
    try {
      const projectConfigFile = path.join(candidate, 'project.config.json');
      const projectConfig = isFile(projectConfigFile) ? readJson(projectConfigFile) : {};
      const sourceRoot = resolveSourceRoot(candidate, projectConfig);
      if (seen.has(sourceRoot)) continue;
      seen.add(sourceRoot);
      const appConfig = readJson(path.join(sourceRoot, 'app.json'));
      const framework = detectFramework(candidate, sourceRoot);
      results.push({
        id: projectIdFor(sourceRoot),
        name: projectConfig.projectname || appConfig.window?.navigationBarTitleText || path.basename(candidate),
        projectRoot: realpath(candidate),
        sourceRoot,
        projectConfigFile: isFile(projectConfigFile) ? projectConfigFile : null,
        projectConfig,
        appConfig,
        framework
      });
    } catch (_) {
      // 搜索模式会遇到不完整目录，交给最终选择阶段报告真正错误。
    }
  }
  return results;
}

export function resolveNativeProject(inputPath) {
  const projects = discoverNativeProjects(inputPath);
  if (!projects.length) {
    throw new Error(`未在 ${path.resolve(inputPath)} 找到原生微信小程序。需要 project.config.json 或 app.json。`);
  }
  if (projects.length > 1) {
    const choices = projects.map((item) => `- ${item.projectRoot}（源码：${item.sourceRoot}）`).join('\n');
    throw new Error(`发现多个小程序，请把 projectPath 指向其中一个项目：\n${choices}`);
  }
  const project = projects[0];
  if (project.framework !== 'native') {
    throw new Error(`wxpreview v0.1 只支持原生微信小程序；检测到 ${project.framework} 项目：${project.projectRoot}`);
  }
  return project;
}

export function listRelevantFiles(sourceRoot) {
  const result = [];
  const extensions = new Set(['.js', '.ts', '.json', '.wxml', '.wxss', '.wxs']);
  const walk = (directory) => {
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(path.join(directory, entry.name));
      } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        result.push(path.join(directory, entry.name));
      }
    }
  };
  walk(sourceRoot);
  return result.sort();
}

export function fingerprintProject(project) {
  const hash = crypto.createHash('sha256');
  for (const file of listRelevantFiles(project.sourceRoot)) {
    hash.update(path.relative(project.sourceRoot, file));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

export { readJson };
