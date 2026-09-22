const clone = (value) => {
  if (value === undefined) return undefined;
  try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
};

function mockResponse(mock, fallback) {
  if (!mock) return clone(fallback);
  return clone(Object.prototype.hasOwnProperty.call(mock, 'response') ? mock.response : mock);
}

export function createPreviewBackend(identity, options = {}) {
  const log = options.onCall || (() => {});
  const cloudMocks = identity.cloudFunctionMocks || {};
  const requestMocks = identity.requestMocks || [];
  return {
    identity,
    profile: identity.profile,
    async callFunction(request = {}) {
      const name = request.name || 'unknown';
      const action = request.data?.action || request.data?.type || '';
      const exact = cloudMocks[`${name}:${action}`] ?? cloudMocks[name];
      log({ kind: 'cloud', name, action, payload: request.data || {}, mocked: Boolean(exact) });
      if (exact) return mockResponse(exact, { result: {} });
      return {
        result: {
          success: true,
          code: 0,
          data: {},
          preview: true,
          message: `wxpreview 未配置云函数 ${name}${action ? `:${action}` : ''} 的返回数据`
        }
      };
    },
    request(request = {}) {
      const method = String(request.method || 'GET').toUpperCase();
      const url = String(request.url || '');
      const mock = requestMocks.find((item) => {
        if (item.method && String(item.method).toUpperCase() !== method) return false;
        if (item.url === url) return true;
        if (item.urlPattern) {
          try { return new RegExp(item.urlPattern).test(url); } catch (_) { return false; }
        }
        return false;
      });
      log({ kind: 'request', method, url, payload: request.data, mocked: Boolean(mock) });
      if (!mock) return null;
      return mockResponse(mock, { statusCode: 200, data: {} });
    }
  };
}
