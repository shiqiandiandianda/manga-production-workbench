/**
 * 角色工房执行器（真实生成）。
 *
 * 契约（来自 01/workbench/engine/workshop）：
 *   GET  /api/health                     → {ok, app:"comic-character-workbench", version}
 *   POST /api/jobs {kind:"comic_character", name, instructions, style, references}
 *   GET  /api/state                      → {jobs:[{id,status,phase,message,files,...}]}
 *   POST /api/jobs/:id/cancel
 *   GET  /files/...                      → 图片字节
 *
 * 适配器只负责"提交、轮询、取回字节"，不写数据库；入库由任务用例完成。
 * 默认不在配置里启用：真实生成会消耗账号额度，必须显式打开。
 */
const HEALTH_APP = 'comic-character-workbench';

export function createWorkshopExecutor({
  baseUrl = 'http://127.0.0.1:8892',
  timeoutMs = 1_800_000,
  pollMs = 1500,
  fetchImpl = fetch
} = {}) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('角色工房 baseUrl 无效');

  async function request(route, {method = 'GET', body, timeout = 20_000} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(base + route, {
        method,
        headers: {
          ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
          Origin: base
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`角色工房 ${route} 返回 ${response.status}：${text.slice(0, 200)}`);
      }
      return text ? JSON.parse(text) : {};
    } finally {
      clearTimeout(timer);
    }
  }

  async function health() {
    try {
      const info = await request('/api/health', {timeout: 2500});
      if (!info?.ok) return {ready: false, reason: '工房健康检查未通过'};
      if (info.app !== HEALTH_APP) return {ready: false, reason: `不是角色工房：${info.app ?? '未知'}`};
      return {ready: true, version: info.version ?? ''};
    } catch (error) {
      return {ready: false, reason: error.message};
    }
  }

  async function cancel(jobId) {
    if (!jobId) return false;
    try {
      await request(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        body: {},
        timeout: 10_000
      });
      return true;
    } catch {
      return false;
    }
  }

  async function run(manifest, ctx = {}) {
    const references = await uploadReferences(ctx.references);
    const payload = {
      kind: 'comic_character',
      name: [manifest.name, manifest.state].filter(Boolean).join(' · ').slice(0, 160),
      instructions: buildInstructions(manifest),
      style: manifest.style || '国漫',
      references,
      clientRequestId: `comic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };

    const created = await request('/api/jobs', {method: 'POST', body: payload, timeout: 60_000});
    const jobId = created?.job?.id ?? created?.id;
    if (!jobId) throw Object.assign(new Error('角色工房没有返回任务编号'), {code: 'workshop_no_job'});

    const deadline = Date.now() + timeoutMs;
    let last = null;

    while (Date.now() < deadline) {
      if (ctx.signal?.aborted) {
        await cancel(jobId);
        throw Object.assign(new Error('任务已取消'), {code: 'cancelled'});
      }

      const state = await request('/api/state', {timeout: 20_000});
      const job = (state?.jobs ?? []).find(item => item.id === jobId);
      if (job) {
        last = job;
        ctx.progress?.({
          phase: job.phase || job.status,
          message: job.message || '',
          percent: job.stepProgress?.total
            ? Math.round((job.stepProgress.completed / job.stepProgress.total) * 100)
            : null
        });

        if (job.status === 'completed') {
          const url = pickImageUrl(job, jobId);
          const bytes = await fetchBytes(url, ctx.signal);
          return {bytes, mime: mimeForUrl(url), engineJobId: jobId};
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          throw Object.assign(
            new Error(job.message || (job.status === 'cancelled' ? '任务已取消' : '角色工房任务失败')),
            {code: job.status === 'cancelled' ? 'cancelled' : 'workshop_job_failed', job}
          );
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    await cancel(jobId);
    throw Object.assign(new Error('角色工房任务超时'), {code: 'workshop_timeout', job: last});
  }

  async function uploadReferences(list) {
    if (!Array.isArray(list) || !list.length) return [];
    const urls = [];
    for (const [index, reference] of list.slice(0, 3).entries()) {
      if (!Buffer.isBuffer(reference?.bytes) || !reference.bytes.length) continue;
      const uploaded = await request('/api/upload', {
        method: 'POST',
        body: {
          filename: reference.filename || `reference-${index + 1}.png`,
          data: reference.bytes.toString('base64')
        },
        timeout: 120_000
      });
      if (!uploaded?.url) {
        throw Object.assign(new Error('参考图上传失败'), {code: 'workshop_reference_missing'});
      }
      urls.push(uploaded.url);
    }
    return urls;
  }

  async function fetchBytes(url, signal) {
    const timeout = AbortSignal.timeout(60_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetchImpl(base + url, {signal: combined});
    if (!response.ok) {
      throw Object.assign(new Error(`产物读取失败：HTTP ${response.status}`), {code: 'workshop_no_output'});
    }
    return Buffer.from(await response.arrayBuffer());
  }

  return {
    id: 'character.workshop',
    label: '角色工房（真实生成）',
    capabilities: ['asset.character'],
    probe: health,
    estimate() {
      return {slots: 1, minutes: 4};
    },
    run,
    cancel
  };
}

function buildInstructions(manifest) {
  return [
    `角色：${manifest.name}`,
    manifest.state ? `形态/服装：${manifest.state}` : '',
    manifest.view ? `视角：${manifest.view}` : '',
    '',
    manifest.prompt
  ].filter(line => line !== undefined).join('\n').trim();
}

function pickImageUrl(job, jobId) {
  const files = Array.isArray(job.files) ? job.files : [];
  const urls = files
    .map(item => (typeof item === 'string' ? item : item?.url))
    .filter(value => typeof value === 'string' && value.startsWith('/files/'));
  const image = urls.find(value => /\.(png|jpe?g|webp)(\?|$)/i.test(value));
  return image ?? `/files/generated/${jobId}/comic-character.png`;
}

function mimeForUrl(url) {
  const value = String(url).toLowerCase();
  if (value.endsWith('.jpg') || value.endsWith('.jpeg')) return 'image/jpeg';
  if (value.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}
