/**
 * 节点 → hub 的 HTTP 客户端。
 *
 * 节点不需要数据库；它只通过 hub 的 API 注册、心跳、领取、回传。
 */
export function createHubClient({
  baseUrl,
  token = '',
  fetchImpl = fetch,
  defaultTimeoutMs = 30_000
} = {}) {
  if (!baseUrl) throw new Error('缺少 hub.url');
  const base = String(baseUrl).replace(/\/+$/, '');

  async function request(route, {method = 'GET', body, timeout = defaultTimeoutMs} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(base + route, {
        method,
        headers: {
          ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
          ...(token ? {Authorization: `Bearer ${token}`} : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const error = new Error(data?.error?.message || `HTTP ${response.status}`);
        error.code = data?.error?.code || `HTTP_${response.status}`;
        error.status = response.status;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    baseUrl: base,

    register(payload) {
      return request('/api/v1/workers/register', {method: 'POST', body: payload});
    },
    heartbeat(workerId, payload) {
      return request(`/api/v1/workers/${encodeURIComponent(workerId)}/heartbeat`, {
        method: 'POST',
        body: payload
      });
    },
    claim(workerId) {
      return request(`/api/v1/workers/${encodeURIComponent(workerId)}/claim`, {
        method: 'POST',
        body: {}
      });
    },
    started(attemptId, payload) {
      return request(`/api/v1/attempts/${encodeURIComponent(attemptId)}/started`, {
        method: 'POST',
        body: payload
      });
    },
    result(attemptId, payload) {
      return request(`/api/v1/attempts/${encodeURIComponent(attemptId)}/result`, {
        method: 'POST',
        body: payload,
        timeout: 120_000
      });
    },
    fail(attemptId, payload) {
      return request(`/api/v1/attempts/${encodeURIComponent(attemptId)}/fail`, {
        method: 'POST',
        body: payload
      });
    },

    async downloadBlob(sha256) {
      const response = await fetchImpl(`${base}/api/v1/blobs/${sha256}`, {
        headers: token ? {Authorization: `Bearer ${token}`} : {}
      });
      if (!response.ok) throw new Error(`参考图读取失败：HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }
  };
}
