/**
 * 前端 API 客户端：只走同源 /api，不直连任何旧端口。
 */
export async function api(path, {method = 'GET', body, signal} = {}) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const error = new Error(data?.error?.message || `请求失败（HTTP ${response.status}）`);
    error.code = data?.error?.code || `HTTP_${response.status}`;
    error.nextAction = data?.error?.nextAction || null;
    error.requestId = data?.requestId || null;
    throw error;
  }
  return data;
}
