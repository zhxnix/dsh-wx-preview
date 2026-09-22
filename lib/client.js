/*
 * Browser half of dsh-wx-preview.
 *
 * The shared DSH annotation workbench is optional.  When it is present this
 * panel delegates to BrowserPanel so mini-program elements can be annotated
 * like ordinary web elements.  A small iframe panel remains available on a
 * plain DSH installation, so the preview engine is useful by itself too.
 */
window.__ModuleLoader__.load({
  id: 'dsh-wx-preview',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const PANEL_ID = 'dsh-wx-preview';
    const PANEL_KIND = 'dsh-wx-preview';
    const CONFIG_PATH = '/dsh-wx-preview/config';

    const sharedPanel = () => window.__dshSidebarAnnotations?.BrowserPanel
      || window.__dshWorkbenchPanels?.BrowserPanel
      || null;

    function subscribeShared(listener) {
      window.addEventListener('dsh-sidebar-annotations-changed', listener);
      window.addEventListener('dsh-workbench-panels-changed', listener);
      return () => {
        window.removeEventListener('dsh-sidebar-annotations-changed', listener);
        window.removeEventListener('dsh-workbench-panels-changed', listener);
      };
    }

    function configUrl(sessionId) {
      return sessionId ? `${CONFIG_PATH}?sessionId=${encodeURIComponent(sessionId)}` : CONFIG_PATH;
    }

    function safePreviewUrl(value) {
      const text = String(value || '').trim();
      if (!text) return '';
      try {
        const parsed = new URL(text, window.location.href);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        if (!parsed.hostname) return '';
        return parsed.href;
      } catch (_) { return ''; }
    }

    function usePreviewConfig(initialUrl, sessionId) {
      const [config, setConfig] = React.useState(() => ({
        active: Boolean(initialUrl),
        sessionId: null,
        url: initialUrl || ''
      }));
      React.useEffect(() => {
        let disposed = false;
        const read = async () => {
          try {
            const response = await fetch(configUrl(sessionId), { cache: 'no-store' });
            if (!response.ok) return;
            const next = await response.json();
            if (!disposed && next && typeof next === 'object') setConfig(next);
          } catch (_) { /* host half may be unavailable on a plain static install */ }
        };
        void read();
        const timer = setInterval(read, 2000);
        return () => { disposed = true; clearInterval(timer); };
      }, [initialUrl, sessionId]);
      return config;
    }

    function BasicPreview({ initialUrl = '', sessionId = '' }) {
      const config = usePreviewConfig(initialUrl, sessionId);
      const [url, setUrl] = React.useState(safePreviewUrl(config.url || initialUrl || ''));
      const [frameUrl, setFrameUrl] = React.useState(safePreviewUrl(config.url || initialUrl || ''));
      React.useEffect(() => {
        const next = safePreviewUrl(config.url);
        if (next && next !== frameUrl) {
          setUrl(next);
          setFrameUrl(next);
        }
      }, [config.url]);
      return h('section', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--dsw-alias-surface-secondary, #181818)', color: 'var(--dsw-alias-label-primary, #eee)' }, 'data-dsh-wx-preview': true },
        h('form', { onSubmit: (event) => { event.preventDefault(); const next = safePreviewUrl(url); if (next) { setUrl(next); setFrameUrl(next); } }, style: { display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid #ffffff18' } },
          h('input', { value: url, onChange: (event) => setUrl(event.target.value), placeholder: '预览地址（由 wxpreview_open 自动填入）', spellCheck: false, style: { minWidth: 0, flex: 1, color: 'inherit', background: '#ffffff0a', border: '1px solid #ffffff22', borderRadius: 6, padding: '6px 8px' } }),
          h('button', { type: 'submit', style: { color: 'inherit', background: '#ffffff12', border: '1px solid #ffffff22', borderRadius: 6, padding: '0 10px' } }, '打开')),
        frameUrl
          ? h('iframe', { key: frameUrl, src: frameUrl, title: '微信小程序预览', style: { flex: 1, width: '100%', minHeight: 0, border: 0 }, allow: 'clipboard-read; clipboard-write' })
          : h('div', { style: { padding: 24, lineHeight: 1.8, opacity: .75 } }, '调用 wxpreview_open 启动预览，或输入一个预览 URL。'));
    }

    function MiniProgramPanel(props) {
      const SharedBrowserPanel = React.useSyncExternalStore(subscribeShared, sharedPanel, sharedPanel);
      const currentSession = typeof window.__dshWxPreviewCurrentSession === 'function'
        ? window.__dshWxPreviewCurrentSession()
        : '';
      const config = usePreviewConfig(props.defaultUrl || '', props.sessionId || currentSession);
      const url = config.url || props.defaultUrl || '';
      if (!SharedBrowserPanel) return h(BasicPreview, { initialUrl: url, sessionId: props.sessionId || currentSession });
      return h(SharedBrowserPanel, {
        ...props,
        key: `${PANEL_KIND}:${config.sessionId || url}`,
        panelKind: PANEL_KIND,
        defaultUrl: url
      });
    }

    function apply(ctx) {
      let bodyReady = false;
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: PANEL_ID,
        kind: PANEL_KIND,
        priority: 'extension',
        title: () => '小程序预览',
        guide: [{
          order: 6,
          title: () => '微信小程序预览',
          description: () => '预览原生小程序，支持调试与点选注释'
        }]
      }));
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => {
        bodyReady = true;
        const dispose = ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PANEL_ID }, MiniProgramPanel);
        return () => { bodyReady = false; dispose(); };
      }));
      ctx.effect(() => {
        let disposed = false;
        let lastSession = '';
        const poll = async () => {
          try {
            const sessionId = typeof ctx.sessions?.list?.getSnapshot === 'function'
              ? ctx.sessions.list.getSnapshot().current
              : '';
            if (!sessionId) return;
            const response = await fetch(configUrl(sessionId), { cache: 'no-store' });
            if (!response.ok) return;
            const config = await response.json();
            if (!disposed && bodyReady && config?.active && config.sessionId && config.sessionId !== lastSession) {
              lastSession = config.sessionId;
              ctx.get('sidebarRight')?.openTab(PANEL_KIND);
            }
          } catch (_) { /* the host half may not be mounted yet */ }
        };
        void poll();
        const timer = setInterval(poll, 2000);
        return () => { disposed = true; clearInterval(timer); };
      });
      const previous = window.__dshWxPreviewCurrentSession;
      window.__dshWxPreviewCurrentSession = () => {
        try { return ctx.sessions?.list?.getSnapshot?.().current || ''; } catch (_) { return ''; }
      };
      ctx.effect(() => () => {
        if (window.__dshWxPreviewCurrentSession === previous || previous === undefined) delete window.__dshWxPreviewCurrentSession;
        else window.__dshWxPreviewCurrentSession = previous;
      });
      void fetch('/dsh-wx-preview/health', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ renderer: 'dsh-wx-preview' })
      }).catch(() => {});
    }

    return { apply, inject: ['slots', 'sidebarRightTabs', 'sessions'] };
  }
});
