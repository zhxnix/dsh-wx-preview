import { defineTool } from '@deepseek-ai/dsh-tools';
import { createPreviewService } from '../src/host-service.mjs';

export const name = 'dsh-wx-preview';
export const inject = ['tools', 'webServer'];
export const CONFIG_PATH = '/dsh-wx-preview/config';
export const HEALTH_PATH = '/dsh-wx-preview/health';

const output = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
};

function registerLifetime(ctx, setup, label) {
  if (typeof ctx?.effect === 'function') return ctx.effect(setup, label);
  return setup();
}

function writeJson(response, statusCode, value) {
  const text = JSON.stringify(value);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(text);
}

function tool(name, description, parameters, execute) {
  return defineTool({ name, description, parameters, output, isConcurrencySafe: () => false, execute });
}

function conversationIdOf(exec) {
  const id = exec?.agent?.session?.id;
  return typeof id === 'string' ? id : '';
}

function toolsFor(service) {
  return [
    tool(
      'wxpreview_discover',
      '发现一个目录中的原生微信小程序项目。只读取 project.config.json/app.json，不修改目标项目。',
      {
        projectPath: { type: 'string', required: true, description: '项目目录，或包含项目的目录。' },
        maxDepth: { type: 'integer', description: '搜索子目录最大深度，默认 4。' }
      },
      async (args, exec) => { exec.signal?.throwIfAborted?.(); return service.discover(args.projectPath, args.maxDepth); }
    ),
    tool(
      'wxpreview_precompile',
      '读取并预编译原生微信小程序源码，生成本地缓存和兼容性报告；不会修改目标项目。',
      {
        projectPath: { type: 'string', required: true, description: '原生小程序项目目录。' },
        force: { type: 'boolean', description: '忽略缓存并重新编译。' }
      },
      async (args, exec) => { exec.signal?.throwIfAborted?.(); return service.precompile(args.projectPath, { force: args.force }); }
    ),
    tool(
      'wxpreview_open',
      '预编译并启动本机原生微信小程序预览，返回可在 DSH 右栏打开的 URL。',
      {
        projectPath: { type: 'string', required: true, description: '原生小程序项目目录。' },
        route: { type: 'string', description: '首次打开的页面路径，例如 pages/index/index。' },
        port: { type: 'integer', description: '可选本机端口；不传则分配空闲端口。' },
        force: { type: 'boolean', description: '忽略缓存并重新预编译。' }
      },
      async (args, exec) => { exec.signal?.throwIfAborted?.(); return service.open(args.projectPath, args, conversationIdOf(exec)); }
    ),
    tool(
      'wxpreview_status',
      '查看当前 DSH 小程序预览会话；传项目或会话 ID 时返回单个会话。',
      {
        projectPath: { type: 'string', description: '项目目录。' },
        sessionId: { type: 'string', description: '预览会话 ID。' }
      },
      async (args, exec) => { exec.signal?.throwIfAborted?.(); return service.status(args); }
    ),
    tool(
      'wxpreview_logs',
      '读取小程序预览页面上报的运行时日志。',
      {
        projectPath: { type: 'string', description: '项目目录。' },
        sessionId: { type: 'string', description: '预览会话 ID。' },
        limit: { type: 'integer', description: '最多返回的日志数量，默认 100。' }
      },
      async (args, exec) => { exec.signal?.throwIfAborted?.(); return service.logs(args); }
    ),
    tool(
      'wxpreview_update_identity',
      '更新仅用于本地预览的模拟身份、storage 和权限结果；不会调用真实微信授权。',
      {
        projectPath: { type: 'string', required: true, description: '原生小程序项目目录。' },
        autoLogin: { type: 'boolean' },
        profile: { type: 'json' },
        scopes: { type: 'json' },
        storage: { type: 'json' },
        globalData: { type: 'json' },
        loginRoutes: { type: 'json' },
        requestMocks: { type: 'json' },
        cloudFunctionMocks: { type: 'json' }
      },
      async (args, exec) => {
        exec.signal?.throwIfAborted?.();
        const patch = {};
        for (const key of ['autoLogin', 'profile', 'scopes', 'storage', 'globalData', 'loginRoutes', 'requestMocks', 'cloudFunctionMocks']) {
          if (Object.prototype.hasOwnProperty.call(args, key)) patch[key] = args[key];
        }
        return service.updateIdentity(args.projectPath, patch);
      }
    ),
    tool(
      'wxpreview_stop',
      '停止一个或全部本地微信小程序预览服务；不会修改目标项目。',
      {
        projectPath: { type: 'string', description: '项目目录。' },
        sessionId: { type: 'string', description: '预览会话 ID。' },
        all: { type: 'boolean', description: '停止所有活动预览。' }
      },
      async (args, exec) => { exec.signal?.throwIfAborted?.(); return service.stop(args); }
    )
  ];
}

export function apply(ctx) {
  const service = createPreviewService();
  const unregister = toolsFor(service).map((item) => ctx.tools.register(item));
  const unprovide = typeof ctx.provide === 'function' ? ctx.provide('wxPreview', service) : undefined;
  const cleanup = registerLifetime(ctx, () => {
    const configRoute = ctx.webServer.register({
      kind: 'exact',
      path: CONFIG_PATH,
      handler: (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' });
          response.end();
          return;
        }
        let conversationId = '';
        try { conversationId = new URL(request.url || '/', 'http://dsh-wx-preview.local').searchParams.get('sessionId') || ''; } catch (_) { /* use global CLI view */ }
        writeJson(response, 200, service.config(conversationId));
      }
    });
    const healthRoute = ctx.webServer.register({
      kind: 'exact',
      path: HEALTH_PATH,
      handler: (_request, response) => writeJson(response, 200, { ok: true, plugin: name, ...service.config() })
    });
    service.onChange = (config) => ctx.webServer.broadcast?.(CONFIG_PATH, config);
    return () => {
      service.onChange = null;
      if (typeof configRoute === 'function') configRoute();
      if (typeof healthRoute === 'function') healthRoute();
      void service.dispose();
      for (const remove of unregister) if (typeof remove === 'function') remove();
      if (typeof unprovide === 'function') unprovide();
    };
  }, 'dsh-wx-preview: host service');
  return cleanup;
}

export { createPreviewService } from '../src/host-service.mjs';
