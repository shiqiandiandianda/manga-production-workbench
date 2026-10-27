/**
 * 统一响应：字节流（图片、归档文件）。
 */
export function sendBuffer(res, status, bytes, headers = {}) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Length': bytes.length,
    ...headers
  });
  res.end(bytes);
}
