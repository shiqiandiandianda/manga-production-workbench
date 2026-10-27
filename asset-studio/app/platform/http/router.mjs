/**
 * 极简路由表。
 *
 * 一个接口只在 routes 表里出现一次；新增接口必须同时带 schema、错误码、契约测试。
 */
export function createRouter() {
  const routes = [];

  const api = {
    add(method, pattern, handler, options = {}) {
      routes.push({
        method: method.toUpperCase(),
        pattern,
        handler,
        ...compile(pattern),
        ...options
      });
      return api;
    },
    get(pattern, handler, options) {
      return api.add('GET', pattern, handler, options);
    },
    post(pattern, handler, options) {
      return api.add('POST', pattern, handler, options);
    },
    put(pattern, handler, options) {
      return api.add('PUT', pattern, handler, options);
    },
    delete(pattern, handler, options) {
      return api.add('DELETE', pattern, handler, options);
    },
    match(method, pathname) {
      let pathMatched = false;
      for (const route of routes) {
        const found = route.regex.exec(pathname);
        if (!found) continue;
        pathMatched = true;
        if (route.method !== method.toUpperCase()) continue;
        const params = {};
        route.keys.forEach((key, index) => {
          params[key] = decodeURIComponent(found[index + 1]);
        });
        return {handler: route.handler, params, pattern: route.pattern, route};
      }
      return pathMatched ? {methodMismatch: true} : null;
    },
    list() {
      return routes.map(route => `${route.method} ${route.pattern}`);
    }
  };

  return api;
}

function compile(pattern) {
  const keys = [];
  const source = String(pattern)
    .split('/')
    .map(segment => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return escapeRegExp(segment);
    })
    .join('/');
  return {keys, regex: new RegExp(`^${source}/?$`)};
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
