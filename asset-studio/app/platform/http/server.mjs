/**
 * HTTP 服务：静态外壳 + JSON API。
 *
 * 约束：
 * - 只监听本机回环（由 roles 决定端口与地址）。
 * - 所有 /api 响应 no-store；所有静态资源带 CSP。
 * - 请求体上限 2MB；超限与非法 JSON 返回统一错误。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fail} from '../../core/errors.mjs';
import {sendBuffer} from './buffer.mjs';
import {sendError, sendJson} from './respond.mjs';

const BODY_LIMIT = 2 * 1024 * 1024;

const MIME = Object.freeze({
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
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
});

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ');

export function createAppServer({router, webRoot, logger}) {
  const root = path.resolve(webRoot);

  const server = http.createServer((request, response) => {
    handle(request, response).catch(error => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendError(response, error, currentRequestId(request), {logger});
    });
  });

  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  async function handle(request, response) {
    const requestId = `req_${randomUUID()}`;
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      const match = router.match(request.method || 'GET', pathname);
      if (!match) {
        throw fail.notFound('接口不存在');
      }
      if (match.methodMismatch) {
        throw fail.unsupported('不支持此请求方法');
      }
      const body = await readBody(request, match.route?.maxBytes ?? BODY_LIMIT);
      const result = await match.handler({
        params: match.params,
        query: url.searchParams,
        body,
        requestId,
        request,
        response,
        url
      });
      if (response.writableEnded) return;
      if (result?.raw) {
        sendBuffer(response, Number(result.status) || 200, result.raw.bytes, {
          'Content-Type': result.raw.mime || 'application/octet-stream',
          ...(result.headers || {})
        });
        return;
      }
      const status = Number(result?.status) || 200;
      const payload = result && Object.prototype.hasOwnProperty.call(result, 'body') ? result.body : result;
      sendJson(response, status, payload ?? {ok: true}, result?.headers);
      return;
    }

    await serveStatic(request, response, pathname);
  }

  async function serveStatic(request, response, pathname) {
    if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
      throw fail.unsupported('静态资源只支持 GET/HEAD');
    }
    const relative = safeDecode(pathname).replace(/^\/+/, '') || 'index.html';
    let candidate = path.resolve(root, relative);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      throw fail.forbidden('非法路径');
    }

    let file = candidate;
    let stat = statSafe(file);
    if (!stat || stat.isDirectory()) {
      if (path.extname(relative)) throw fail.notFound('文件不存在');
      file = path.join(root, 'index.html');
      stat = statSafe(file);
    }
    if (!stat || !stat.isFile()) throw fail.notFound('页面不存在');

    const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': CSP
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = fs.createReadStream(file);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }

  return {server, webRoot: root};
}

export function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** 端口被占用时自动向后找；用于本机一键启动。 */
export async function listenWithFallback(server, port, host, attempts = 10) {
  let lastError = null;
  for (let offset = 0; offset < attempts; offset += 1) {
    try {
      return await listen(server, port + offset, host);
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error('没有可用端口');
}

function currentRequestId(request) {
  return request.requestId || `req_${randomUUID()}`;
}

async function readBody(request, limit = BODY_LIMIT) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method || 'GET')) return null;
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) {
      throw fail.invalid(`请求体超过 ${Math.round(limit / 1024 / 1024)}MB`);
    }
    chunks.push(chunk);
  }
  if (!total) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw fail.invalid('请求体不是合法 JSON');
  }
}

function statSafe(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw fail.invalid('URL 编码不正确');
  }
}
