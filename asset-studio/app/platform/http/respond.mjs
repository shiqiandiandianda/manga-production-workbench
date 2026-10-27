/**
 * HTTP 响应工具：统一的 JSON、错误与安全头。
 */
import {isAppError, toErrorBody} from '../../core/errors.mjs';

const COMMON_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin'
});

export function sendJson(res, status, body, headers = {}) {
  if (res.writableEnded) return;
  const payload = Buffer.from(JSON.stringify(body ?? null), 'utf8');
  res.writeHead(status, {
    ...COMMON_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(payload);
}

export function sendError(res, error, requestId, {logger} = {}) {
  const status = isAppError(error) ? error.status : 500;
  if (!isAppError(error)) {
    logger?.error?.('未处理的服务端错误', {
      requestId,
      message: error?.message,
      stack: error?.stack
    });
  }
  const body = toErrorBody(error, requestId);
  sendJson(res, status, body, {'X-Request-Id': requestId});
}
