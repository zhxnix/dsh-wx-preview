import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { precompileProject } from './precompile.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(pluginRoot, 'web');

const VIRTUAL_MANIFEST = 'virtual:wxpreview-manifest';
const VIRTUAL_IDENTITY = 'virtual:wxpreview-identity';
const VIRTUAL_APP = 'virtual:wxpreview-app';
const VIRTUAL_DEFINITIONS = 'virtual:wxpreview-definitions';
const resolved = (id) => `\0${id}`;

function jsonResponse(res, value, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

export async function startPreview(inputPath, options = {}) {
  let compiled = await precompileProject(inputPath, { force: Boolean(options.force) });
  const logs = [];
  let viteServer;
  let rebuilding = null;

  const invalidateAndReload = () => {
    if (!viteServer) return;
    for (const id of [VIRTUAL_MANIFEST, VIRTUAL_IDENTITY, VIRTUAL_APP, VIRTUAL_DEFINITIONS]) {
      const module = viteServer.moduleGraph.getModuleById(resolved(id));
      if (module) viteServer.moduleGraph.invalidateModule(module);
    }
    viteServer.ws.send({ type: 'full-reload', path: '*' });
  };

  const rebuild = async (settings = {}) => {
    if (rebuilding) return rebuilding;
    rebuilding = precompileProject(compiled.project, { force: true, identity: settings.identity })
      .then((next) => { compiled = next; return next; })
      .finally(() => { rebuilding = null; });
    return rebuilding;
  };

  const previewPlugin = {
    name: 'wxpreview-native-project',
    enforce: 'pre',
    resolveId(id) {
      if ([VIRTUAL_MANIFEST, VIRTUAL_IDENTITY, VIRTUAL_APP, VIRTUAL_DEFINITIONS].includes(id)) return resolved(id);
      return null;
    },
    load(id) {
      if (id === resolved(VIRTUAL_MANIFEST)) return `export default ${JSON.stringify(compiled.manifest)};`;
      if (id === resolved(VIRTUAL_IDENTITY)) return `export default ${JSON.stringify(compiled.identity)};`;
      if (id === resolved(VIRTUAL_APP)) return compiled.bundles.app;
      if (id === resolved(VIRTUAL_DEFINITIONS)) return compiled.bundles.definitions;
      return null;
    },
    configureServer(server) {
      viteServer = server;
      server.middlewares.use('/__wxpreview/status', (_req, res) => jsonResponse(res, {
        ready: true,
        url: session?.url || '',
        project: compiled.manifest.project,
        state: compiled.state
      }));
      server.middlewares.use('/__wxpreview/log', (req, res) => {
        if (req.method !== 'POST') return jsonResponse(res, { logs });
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            logs.push({ at: new Date().toISOString(), ...JSON.parse(body || '{}') });
            while (logs.length > 500) logs.shift();
            jsonResponse(res, { ok: true });
          } catch (error) {
            jsonResponse(res, { ok: false, error: error.message }, 400);
          }
        });
      });
      server.watcher.add(path.join(compiled.project.sourceRoot, '**', '*'));
      server.watcher.on('all', async (event, file) => {
        if (!file.startsWith(compiled.project.sourceRoot)) return;
        if (!/\.(?:js|json|wxml|wxss|wxs)$/.test(file)) return;
        if (!['add', 'change', 'unlink'].includes(event)) return;
        try {
          await rebuild();
          invalidateAndReload();
        } catch (error) {
          logs.push({ at: new Date().toISOString(), level: 'error', message: `预编译失败：${error.message}` });
        }
      });
    }
  };

  const server = await createServer({
    root: webRoot,
    publicDir: compiled.project.sourceRoot,
    appType: 'spa',
    plugins: [previewPlugin],
    server: {
      host: '127.0.0.1',
      port: Number(options.port) || 0,
      strictPort: Boolean(options.port),
      fs: { allow: [pluginRoot, compiled.project.projectRoot, compiled.project.sourceRoot] }
    },
    clearScreen: false,
    logLevel: options.logLevel || 'warn'
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : Number(options.port);
  const route = options.route || compiled.manifest.pageRoutes[0];
  const url = `http://127.0.0.1:${port}/?route=${encodeURIComponent(route)}`;
  const session = {
    id: compiled.project.id,
    project: compiled.project,
    get compiled() { return compiled; },
    get logs() { return logs.slice(); },
    port,
    url,
    async refresh() { const result = await rebuild(); invalidateAndReload(); return result; },
    async updateIdentity(identityPatch) {
      const result = await rebuild({ identity: identityPatch });
      invalidateAndReload();
      return result.identity;
    },
    async close() { await server.close(); }
  };
  return session;
}

export { pluginRoot, webRoot };
