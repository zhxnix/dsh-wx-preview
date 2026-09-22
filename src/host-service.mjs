import { resolveNativeProject, discoverNativeProjects } from './project.mjs';
import { precompileProject, updateProjectIdentity } from './precompile.mjs';
import { startPreview } from './preview-server.mjs';

/**
 * Owns local preview processes for the DSH host half.  The service is kept
 * independent from Cordis so the same engine can be used by the CLI and by a
 * DSH plugin host.
 */
export function createPreviewService() {
  const sessions = new Map();
  const conversationSessions = new Map();
  let lastSessionId = null;
  let disposed = false;

  const projectSummary = (project) => ({
    id: project.id,
    name: project.name,
    framework: project.framework,
    projectRoot: project.projectRoot,
    sourceRoot: project.sourceRoot,
    projectConfigFile: project.projectConfigFile,
    appId: project.projectConfig?.appid || null,
    pageCount: Array.isArray(project.appConfig?.pages) ? project.appConfig.pages.length : 0,
    subpackageCount: Array.isArray(project.appConfig?.subpackages || project.appConfig?.subPackages)
      ? (project.appConfig.subpackages || project.appConfig.subPackages).length
      : 0
  });

  const compiledSummary = (result) => ({
    project: result.state.project,
    cacheDir: result.cacheDir,
    fingerprint: result.fingerprint,
    reused: result.state.reused,
    generatedAt: result.state.generatedAt,
    counts: result.state.counts,
    compatibility: result.state.compatibility,
    localIdentity: {
      autoLogin: result.identity.autoLogin,
      profile: result.identity.profile,
      scopes: result.identity.scopes,
      storageKeys: Object.keys(result.identity.storage || {})
    },
    boundaries: [
      '预编译只读取目标项目，并将缓存写入 DSH_WX_PREVIEW_HOME（默认用户缓存目录）。',
      'localIdentity 只是浏览器预览 Fixture，不是微信平台权限。',
      '真实登录、CloudBase、设备能力和发布终验仍需微信开发者工具或真机。'
    ]
  });

  const sessionSummary = (session) => ({
    sessionId: session.id,
    url: session.url,
    port: session.port,
    project: {
      id: session.project.id,
      name: session.project.name,
      projectRoot: session.project.projectRoot,
      sourceRoot: session.project.sourceRoot
    },
    state: session.compiled?.state || null,
    logCount: session.logs.length
  });

  const resolveSession = (args = {}) => {
    if (args.sessionId) return sessions.get(String(args.sessionId)) || null;
    if (args.projectPath) {
      const project = resolveNativeProject(args.projectPath);
      return sessions.get(project.id) || null;
    }
    return null;
  };

  const notify = () => service.onChange?.(service.config());

  const service = {
    sessions,
    onChange: null,

    discover(projectPath, maxDepth) {
      const projects = discoverNativeProjects(projectPath, { maxDepth });
      return {
        projectPath,
        projects: projects.map(projectSummary),
        nativeProjects: projects.filter((item) => item.framework === 'native').length,
        unsupportedProjects: projects.filter((item) => item.framework !== 'native').map(projectSummary),
        note: '发现阶段只读取配置；调用 wxpreview_precompile 或 wxpreview_open 才会建立本地缓存。'
      };
    },

    async precompile(projectPath, options = {}) {
      return compiledSummary(await precompileProject(projectPath, options));
    },

    async open(projectPath, options = {}, conversationId = '') {
      if (disposed) throw new Error('wxpreview service is disposed');
      const result = await precompileProject(projectPath, { force: Boolean(options.force) });
      const existing = sessions.get(result.project.id);
      if (existing) {
        if (options.force) await existing.refresh();
        lastSessionId = existing.id;
        if (conversationId) conversationSessions.set(String(conversationId), existing.id);
        notify();
        return {
          ...sessionSummary(existing),
          reusedSession: true,
          precompile: compiledSummary(result),
          openInDshSidebar: existing.url
        };
      }
      const session = await startPreview(result.project, {
        route: options.route,
        port: options.port,
        force: false
      });
      sessions.set(session.id, session);
      lastSessionId = session.id;
      if (conversationId) conversationSessions.set(String(conversationId), session.id);
      notify();
      return {
        ...sessionSummary(session),
        reusedSession: false,
        precompile: compiledSummary(result),
        openInDshSidebar: session.url
      };
    },

    status(args = {}) {
      if (args.projectPath || args.sessionId) {
        const session = resolveSession(args);
        if (!session) return { active: false, sessionId: args.sessionId || null, projectPath: args.projectPath || null };
        return { active: true, ...sessionSummary(session) };
      }
      return { active: Array.from(sessions.values()).map(sessionSummary) };
    },

    logs(args = {}) {
      const session = resolveSession(args);
      if (!session) return { active: false, logs: [] };
      const limit = Math.min(500, Math.max(1, Number(args.limit) || 100));
      return {
        active: true,
        sessionId: session.id,
        url: session.url,
        logs: session.logs.slice(-limit)
      };
    },

    async updateIdentity(projectPath, patch) {
      const result = await updateProjectIdentity(projectPath, patch);
      const old = sessions.get(result.project.id);
      let restarted = false;
      if (old) {
        const port = old.port;
        const route = new URL(old.url).searchParams.get('route') || undefined;
        await old.close();
        sessions.delete(old.id);
        const replacement = await startPreview(result.project, { port, route });
        sessions.set(replacement.id, replacement);
        for (const [conversationId, mappedId] of conversationSessions) {
          if (mappedId === old.id) conversationSessions.set(conversationId, replacement.id);
        }
        lastSessionId = replacement.id;
        restarted = true;
      }
      notify();
      return {
        ...compiledSummary(result),
        restarted,
        session: sessions.has(result.project.id) ? sessionSummary(sessions.get(result.project.id)) : null
      };
    },

    config(conversationId = '') {
      const mappedId = conversationId ? conversationSessions.get(String(conversationId)) : null;
      const session = conversationId
        ? (mappedId ? sessions.get(mappedId) : null)
        : (lastSessionId ? sessions.get(lastSessionId) : null);
      if (!session) return { active: false, sessionId: null, url: '' };
      return {
        active: true,
        sessionId: session.id,
        url: session.url,
        project: {
          id: session.project.id,
          name: session.project.name,
          projectRoot: session.project.projectRoot,
          sourceRoot: session.project.sourceRoot
        }
      };
    },

    async stop(args = {}) {
      if (args.all) {
        const stopped = [];
        for (const session of sessions.values()) {
          await session.close();
          stopped.push(session.id);
        }
        sessions.clear();
        conversationSessions.clear();
        lastSessionId = null;
        notify();
        return { stopped };
      }
      const session = resolveSession(args);
      if (!session) return { stopped: false, sessionId: args.sessionId || null };
      await session.close();
      sessions.delete(session.id);
      for (const [conversationId, mappedId] of conversationSessions) {
        if (mappedId === session.id) conversationSessions.delete(conversationId);
      }
      if (lastSessionId === session.id) lastSessionId = Array.from(sessions.keys()).at(-1) || null;
      notify();
      return { stopped: true, sessionId: session.id, project: session.project.projectRoot };
    },

    async dispose() {
      disposed = true;
      for (const session of sessions.values()) {
        try { await session.close(); } catch (_) { /* best effort */ }
      }
      sessions.clear();
      conversationSessions.clear();
      lastSessionId = null;
    }
  };

  return service;
}
