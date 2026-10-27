/**
 * 工作台的 HTTP 入口。
 *
 * 一个端口同时提供四件事：
 *   /                     工作台界面（含"场景模块/角色模块"两个内嵌页面）
 *   /api/lan/v1/...       局域网接单 + 素材检索（对生图平台开放，令牌鉴权）
 *   /api/hub/...          本机界面用的管理接口（配置、令牌、写盘队列、自检）
 *   /api/scene/... 等      转发到场记引擎；/workshop/* 转发到角色引擎
 *
 * 两个引擎各自仍只监听 127.0.0.1，因此它们原来的安全假设没有被破坏。
 */
import http from 'node:http';
import {createReadStream, existsSync} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {lanCorsHeaders} from './lan-api.mjs';
import {paths} from './paths.mjs';
import os from 'node:os';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function isLoopback(address) {
  if (!address) return false;
  const value = address.startsWith('::ffff:') ? address.slice(7) : address;
  return value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

export function createRequestContext(req, res, {remoteAddress}) {
  const hostHeader = req.headers.host || '127.0.0.1';
  const url = new URL(req.url, `http://${hostHeader}`);
  const request = {
    req,
    res,
    url,
    method: req.method,
    headers: req.headers,
    params: [],
    remoteAddress,
    loopback: isLoopback(remoteAddress),
    requestId: randomUUID(),
    async raw(limit) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (limit && size > limit) throw Object.assign(new Error('请求内容过大。'), {status: 413, code: 'body_too_large'});
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
    async json(limit = 4 * 1024 * 1024) {
      const text = req.headers['content-type'] || '';
      if (!String(text).toLowerCase().includes('application/json')) {
        throw Object.assign(new Error('请使用 JSON 请求（Content-Type: application/json）。'), {status: 415, code: 'content_type_invalid'});
      }
      const body = await request.raw(limit);
      if (!body.length) return {};
      try {
        return JSON.parse(body.toString('utf8'));
      } catch {
        throw Object.assign(new Error('JSON 内容无法解析。'), {status: 400, code: 'json_invalid'});
      }
    },
    /** 简易 multipart 解析：够用于平台直接上传图片，不引入依赖。 */
    async multipart(limit = 64 * 1024 * 1024) {
      const contentType = String(req.headers['content-type'] || '');
      const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
      if (!match) throw Object.assign(new Error('multipart 缺少 boundary。'), {status: 400, code: 'multipart_invalid'});
      const boundary = Buffer.from(`--${(match[1] || match[2]).trim()}`);
      const body = await request.raw(limit);
      const parts = [];
      let index = body.indexOf(boundary);
      if (index < 0) throw Object.assign(new Error('multipart 内容不完整。'), {status: 400, code: 'multipart_invalid'});
      while (index >= 0) {
        const start = index + boundary.length;
        if (body.subarray(start, start + 2).toString() === '--') break;
        const next = body.indexOf(boundary, start);
        if (next < 0) break;
        const headerEnd = body.indexOf('\r\n\r\n', start);
        if (headerEnd < 0 || headerEnd > next) {
          index = next;
          continue;
        }
        const headerText = body.subarray(start, headerEnd).toString('utf8');
        const content = body.subarray(headerEnd + 4, next - 2);
        const nameMatch = /name="([^"]*)"/i.exec(headerText);
        const fileMatch = /filename="([^"]*)"/i.exec(headerText);
        const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
        parts.push({
          name: nameMatch ? nameMatch[1] : '',
          filename: fileMatch ? fileMatch[1] : '',
          contentType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
          data: content
        });
        index = next;
      }
      return {
        parts,
        field(name) {
          const found = parts.find(part => part.name === name && !part.filename);
          return found ? found.data.toString('utf8') : '';
        },
        file(name) {
          return parts.find(part => part.name === name && part.filename) || parts.find(part => part.filename) || null;
        }
      };
    }
  };
  return request;
}

export function createHubServer({config, tokens, logger, registerRoutes, fallbackStatic}) {
  const routes = registerRoutes();
  const server = http.createServer(async (req, res) => {
    const remoteAddress = req.socket.remoteAddress || '';
    const request = createRequestContext(req, res, {remoteAddress});
    let cors = false;
    try {
      const url = request.url;
      const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase(),allowedHosts=new Set(['localhost','127.0.0.1','::1',os.hostname().toLowerCase(),...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(v=>v.address.toLowerCase())]);
      if(!allowedHosts.has(host))throw Object.assign(new Error('此主机名未授权。'),{status:403});
      const pathname = decodeURIComponent(url.pathname);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {...lanCorsHeaders(), 'Cache-Control': 'no-store'});
        return res.end();
      }
      const match = routes.find(item => item.method === req.method && item.pattern.test(pathname));
      if (match) {
        const settings = await config.read();
        cors = !!match.options.cors;
        const scope = match.options.scope;
        // 鉴权规则：
        //  - scope 为 null：公开路由（健康检查、能力清单）；
        //  - 本机回环访问：免令牌。工作台界面就在本机，全部操作都被本机浏览器驱动；
        //    若强制令牌，第一次"生成令牌"的操作将无人能执行；
        //  - 其余（局域网）访问：必须有令牌，并按 scope 校验权限。
        const suppliedToken = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
        const requireToken = !!scope && (!request.loopback || !!suppliedToken);
        if (requireToken && settings.requireToken === false && scope !== 'admin') {
          // 内网可信模式下允许无令牌只读/接单，但仍记录来源，便于排查。
          logger?.warn('未校验令牌的局域网访问', {path: pathname, from: remoteAddress});
        }
        let token = null;
        if (requireToken) {
          const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
          const candidate = bearer ? bearer[1].trim() : String(req.headers['x-auth-token'] || url.searchParams.get('token') || '').trim();
          if (!candidate) {
            throw Object.assign(new Error('缺少访问令牌。请在 Authorization: Bearer <token> 中提供。'), {status: 401, code: 'token_required'});
          }
          const verdict = await tokens.verify(candidate, scope);
          if (!verdict.ok) throw Object.assign(new Error(verdict.reason), {status: 401, code: 'token_invalid'});
          token = verdict;
          if (verdict.record?.projectIds?.length && !/^\/api\/v1\/(projects|files|workers)(\/|$)/.test(pathname)) throw Object.assign(new Error('此接入权限只允许调用项目接口。'), {status:403});
        } else if (scope === 'admin' && !request.loopback) {
          throw Object.assign(new Error('管理接口只允许本机调用。'), {status: 403, code: 'admin_local_only'});
        }
        request.params = match.pattern.exec(pathname).slice(1).map(value => (value === undefined ? '' : decodeURIComponent(value)));
        request.token = token;
        const handler = match.handler;
        const result = await handler(request, res);
        if (result && result.file) {
          await sendFile(req, res, result.file, {cors, cacheControl: result.cacheControl, extraHeaders: result.headers});
          return;
        }
        // 处理器自己写过响应（例如反向代理、静态资源）时不再包装成 JSON。
        if (res.headersSent || res.writableEnded) return;
        return sendJson(res, result?.body ?? {}, {status: result?.status || 200, cors, headers: result?.headers});
      }
      if (pathname.startsWith('/api/')) {
        return sendJson(res, {error: '接口不存在。', code: 'route_missing', requestId: request.requestId}, {status: 404, cors});
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, {error: '请求方法不支持。'}, {status: 405});
      }
      await fallbackStatic(req, res, request);
    } catch (error) {
      const status = error.status || (error.code === 'ENOENT' ? 404 : 400);
      const payload = {
        error: error.message || '请求处理失败。',
        code: error.code || 'request_failed',
        requestId: request.requestId,
        retryable: !!error.retryable,
        ...(error.detail ? {detail: error.detail} : {})
      };
      logger?.warn('请求异常', {path: req.url, method: req.method, status, error: error.message, code: error.code, stack: String(error.stack || '').split('\n').slice(0, 4).join(' | ')});
      if (!res.headersSent) sendJson(res, payload, {status, cors});
      else res.end();
    }
  });
  server.requestTimeout = 900_000;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 20_000;
  return {server, routes};
}

export function sendJson(res, body, {status = 200, headers = {}, cors = false} = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(cors ? lanCorsHeaders() : {}),
    ...headers
  });
  res.end(bytes);
}

export async function sendFile(req, res, file, {cors = false, cacheControl = 'no-cache', extraHeaders = {}} = {}) {
  const info = await stat(file.path);
  const name = file.downloadName ? `; filename*=UTF-8''${encodeURIComponent(file.downloadName)}` : '';
  res.writeHead(200, {
    'Content-Type': file.mime || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': cacheControl,
    'Content-Disposition': `${file.inline === false ? 'attachment' : 'inline'}${name}`,
    'X-Content-Type-Options': 'nosniff',
    ...(cors ? lanCorsHeaders() : {}),
    ...extraHeaders
  });
  if (req.method === 'HEAD') return res.end();
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file.path);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

/**
 * 静态资源：先在 dist 找，找不到回落到 index.html（单页应用）。
 *
 * 缓存策略（手工内网工具，改完就希望刷新能立刻看到）：
 *  - HTML 一律 no-cache，每次都来问服务器；
 *  - 其余资源带内容 ETag 并要求每次复验，命中就回 304（快），改了内容立刻换新（准）。
 * 以前只给 max-age=300 且没有 ETag，浏览器可能五分钟内连问都不问，
 * 于是"刷新了却没更新"。这里不再依赖浏览器推测。
 */
export async function serveStatic(req, res, {root, spaFallback = true, request}) {
  if (!existsSync(root)) {
    return sendJson(res, {error: '界面尚未构建。请先运行构建脚本，或使用 npm run build。', code: 'web_not_built'}, {status: 503});
  }
  const pathname = decodeURIComponent(request.url.pathname);
  let target = path.resolve(root, `.${pathname}`);
  if (!target.startsWith(root)) target = path.join(root, 'index.html');
  let info = await stat(target).catch(() => null);
  if (info?.isDirectory()) {
    target = path.join(target, 'index.html');
    info = await stat(target).catch(() => null);
  }
  if (!info?.isFile()) {
    if (!spaFallback) return sendJson(res, {error: '文件不存在。'}, {status: 404});
    target = path.join(root, 'index.html');
    info = await stat(target).catch(() => null);
    if (!info) return sendJson(res, {error: '文件不存在。'}, {status: 404});
  }
  const extension = path.extname(target).toLowerCase();
  const bytes = await readFile(target);
  const etag = `"${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`;
  const cacheControl = extension === '.html' ? 'no-cache' : 'no-cache, must-revalidate';
  const lastModified = info.mtime.toUTCString();
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, {'ETag': etag, 'Cache-Control': cacheControl, 'Last-Modified': lastModified});
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': MIME[extension] || 'application/octet-stream',
    'Content-Length': bytes.length,
    'ETag': etag,
    'Last-Modified': lastModified,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff'
  });
  if (req.method === 'HEAD') return res.end();
  res.end(bytes);
}

/** 反向代理：把 /prefix/... 转给回环地址上的引擎，并把 HTML 里的绝对接口路径改写。 */
export async function createProxyHandler({prefix, targetPort, config, logger, rewriteHtml = false, onUpload}) {
  return async function proxy(req, res, request) {
    const settings = await config.read();
    if(!request.loopback)throw Object.assign(new Error('生成引擎页面只允许本机使用；同事请通过项目接口接单。'),{status:403});
    const port = typeof targetPort === 'function' ? targetPort(settings) : targetPort;
    if (!port) return sendJson(res, {error: '目标引擎未配置端口。'}, {status: 503});
    const pathname = request.url.pathname;
    const search = request.url.search;
    const stripped = pathname.slice(prefix.length) || '/';
    const upstreamPath = stripped.startsWith('/') ? stripped : `/${stripped}`;
    const isApi = upstreamPath.startsWith('/api/') || upstreamPath.startsWith('/files/');
    const target = `http://127.0.0.1:${port}${upstreamPath}${search}`;
    const headers = {...req.headers};
    // 逐跳头与 undici 不支持的 Expect 都要去掉，否则转发会直接报 UND_ERR_NOT_SUPPORTED。
    for (const name of ['host', 'connection', 'content-length', 'transfer-encoding', 'expect', 'keep-alive', 'te', 'trailer', 'upgrade', 'proxy-connection']) {
      delete headers[name];
    }
    // 两个上游引擎都按"只允许本机工作台页面"的思路校验 Origin：
    // 它们看到的是本工作台的转发，因此统一改写成各自回环地址，保持原有安全假设不变。
    headers.origin = `http://127.0.0.1:${port}`;
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      body = await request.raw(128 * 1024 * 1024);
      if(onUpload && /upload|import|scripts/i.test(upstreamPath))await onUpload(request,body,upstreamPath);
      headers['content-length'] = String(body.length);
    }
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body,
        redirect: 'manual'
      });
      const contentType = upstream.headers.get('content-type') || '';
      if (rewriteHtml && contentType.includes('text/html') && req.method === 'GET') {
        let text = await upstream.text();
        text = injectBaseShim(text, prefix);
        const bytes = Buffer.from(text);
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store'});
        return res.end(bytes);
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      const responseHeaders = {};
      for (const name of ['content-type', 'content-disposition', 'etag', 'last-modified']) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders[name] = value;
      }
      const location = upstream.headers.get('location');
      if (location && location.startsWith('/') && !location.startsWith(prefix)) responseHeaders.location = prefix + location;
      res.writeHead(upstream.status, {
        'Content-Length': buffer.length,
        'Cache-Control': isApi ? 'no-store' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        ...responseHeaders
      });
      return res.end(buffer);
    } catch (error) {
      logger?.warn('代理转发失败', {
        prefix,
        target,
        error: error.message,
        cause: error.cause?.message || '',
        code: error.cause?.code || error.code || ''
      });
      return sendJson(res, {
        error: `内嵌模块（${prefix}）暂时不可用：${error.message}`,
        code: 'proxy_failed',
        hint: '可在“运行状态”里启动该引擎后重试。'
      }, {status: 502});
    }
  };
}

/**
 * 把上游页面挂到 /prefix/ 下时需要补两件事：
 *  1. <base href="/prefix/"> —— 让页面里所有根路径资源（/styles.css、/app.js）落到前缀下；
 *  2. 一段运行期补丁 —— fetch / XHR / WebSocket 里的 /api/... 也要带上前缀。
 *
 * 特别注意：绝对不要用脚本去改 HTML 里的 href/src。上游写的是根路径，
 * 一旦被当成"相对路径"改写到前缀下就会 404，页面会直接裸奔（本次踩过这个坑）。
 */
function injectBaseShim(html, prefix) {
  const shim = `<script>(function(){
  var BASE=${JSON.stringify(prefix)};
  var ORIGIN=location.origin;
  function rewrite(u){
    if(typeof u!=='string'||!u)return u;
    if(u.indexOf(BASE+'/')===0||u===BASE)return u;
    if(u.charAt(0)==='/')return BASE+u;
    if(u.indexOf(ORIGIN+'/')===0)return BASE+u.slice(ORIGIN.length);
    return u;
  }
  var of=window.fetch;
  if(of){
    window.fetch=function(input,init){
      try{
        if(typeof input==='string')input=rewrite(input);
        else if(input&&input.url&&typeof input.url==='string'){var r=rewrite(input.url);if(r!==input.url)input=new Request(r,input);}
      }catch(e){}
      return of.call(this,input,init);
    };
  }
  var oo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    try{arguments[1]=rewrite(url);}catch(e){}
    return oo.apply(this,arguments);
  };
  try{
    var Native=window.WebSocket;
    window.WebSocket=function(url,protocols){
      try{
        if(typeof url==='string'&&url.indexOf('/')===0){
          var abs=new URL(BASE+url,location.origin);
          abs.protocol=location.protocol==='https:'?'wss:':'ws:';
          url=abs.toString();
        }
      }catch(e){}
      return protocols===undefined?new Native(url):new Native(url,protocols);
    };
    window.WebSocket.prototype=Native.prototype;
  }catch(e){}
})();</script>`;
  html = html.replace(/<base[^>]*>/gi, '');
  html = prefixHeadAssets(html, prefix);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, match => `${match}${shim}`);
  return shim + html;
}

/**
 * 把 head 里以 / 开头的资源路径改到前缀下。
 * 直接改 HTML 比依赖 <base> 可靠：<base> 只影响相对路径，
 * 而上游写的是 "/styles.css" 这种根路径，浏览器会忽略 base 直接打到站点根。
 */
function prefixHeadAssets(html, prefix) {
  const headEnd = html.search(/<\/head>/i);
  if (headEnd < 0) return html;
  const head = html.slice(0, headEnd);
  const rest = html.slice(headEnd);
  const rewritten = head.replace(
    /(<(?:link|script)\b[^>]*?\b(?:href|src)=)(["'])(\/(?!\/)[^"']*)\2/gi,
    (match, head_, quote, path) => (path.startsWith(`${prefix}/`) ? match : `${head_}${quote}${prefix}${path}${quote}`)
  );
  return rewritten + rest;
}

export {isLoopback, paths};
