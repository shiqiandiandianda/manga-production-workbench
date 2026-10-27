/**
 * 接单作业：局域网生图平台发过来的"要生成/要入库"的请求在这里排队执行。
 *
 * 设计要点：
 *  - 先收单后干活（异步），平台立刻拿到 jobId，可以轮询、可以回调；
 *  - 每个 workItem 独立成败，部分失败不会让整单白干；
 *  - 重试幂等：客户端可以带 clientRequestId，同一编号重复提交直接返回原作业；
 *  - 生成类工作交给两个引擎，入库/命名/落盘统一走 archive，避免两套命名逻辑。
 */
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson, readJson, safeName, ensureDir} from './store.mjs';
import {files, paths} from './paths.mjs';
import {ASSET_TYPES} from './naming.mjs';

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const TERMINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

export function createJobManager({config, archive, scene, workshop, logger}) {
  const settingsRef = {value: null};
  const jobs = new Map();
  const order = [];
  const running = new Map();
  let loaded = false;
  let saving = Promise.resolve();
  let pumpScheduled = false;
  const waiters = new Map();

  function nowIso() {
    return new Date().toISOString();
  }

  async function ensureLoaded() {
    if (loaded) return;
    const raw = await readJson(files.jobs, {version: 1, jobs: []});
    for (const job of Array.isArray(raw?.jobs) ? raw.jobs : []) {
      if (!job?.id) continue;
      if (job.status === 'running') {
        job.status = 'failed';
        job.phase = 'interrupted';
        job.message = '工作台重启，作业已中断；可重新提交（带 clientRequestId 会新建一单）。';
        job.finishedAt = job.finishedAt || nowIso();
      }
      jobs.set(job.id, job);
      order.push(job.id);
    }
    loaded = true;
  }

  function scheduleSave() {
    saving = saving.then(async () => {
      const snapshot = {version: 1, savedAt: nowIso(), limit: settingsRef.value?.intake.jobTimeoutSeconds, jobs: order.map(id => jobs.get(id)).filter(Boolean).slice(-500)};
      await atomicJson(files.jobs, snapshot, {backup: true});
    }).catch(error => logger?.error('作业列表写入失败', {error: error.message}));
    return saving;
  }

  function trim() {
    const max = 800;
    while (order.length > max) {
      const id = order[0];
      const job = jobs.get(id);
      if (job && ACTIVE_STATUSES.has(job.status)) break;
      order.shift();
      jobs.delete(id);
    }
  }

  function publicJob(job, {includeItems = true} = {}) {
    if (!job) return null;
    const base = {
      jobId: job.id,
      status: job.status,
      phase: job.phase || '',
      message: job.message || '',
      progress: job.progress || {completed: 0, total: job.items?.length || 0, percent: null},
      vendor: job.vendor || '',
      project: job.project || '',
      clientRequestId: job.clientRequestId || '',
      createdAt: job.createdAt,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      elapsedSeconds: job.startedAt ? Math.round(((job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - Date.parse(job.startedAt)) / 1000) : 0,
      assets: (job.items || []).filter(item => item.assetId).map(item => ({
        itemId: item.id,
        assetId: item.assetId,
        name: item.name,
        relativePath: item.relativePath,
        type: item.type,
        character: item.character || '',
        outfit: item.outfit || '',
        view: item.view || '',
        width: item.width || null,
        height: item.height || null,
        bytes: item.bytes || 0,
        sha256: item.sha256 || '',
        url: item.assetId ? `/api/lan/v1/assets/${item.assetId}` : null,
        copies: item.copies || []
      })),
      callback: job.callback ? {url: job.callback.url, delivered: job.callback.delivered || false, attempts: job.callback.attempts || 0, lastError: job.callback.lastError || ''} : null
    };
    if (includeItems) {
      base.items = (job.items || []).map(item => ({
        itemId: item.id,
        mode: item.mode,
        type: item.type,
        status: item.status,
        message: item.message || '',
        engine: item.engine || '',
        engineJobId: item.engineJobId || '',
        assetId: item.assetId || null,
        relativePath: item.relativePath || null,
        progress: item.progress || null,
        attempts: item.attempts || 0,
        startedAt: item.startedAt || null,
        finishedAt: item.finishedAt || null
      }));
    }
    return base;
  }

  function notify(job) {
    const listeners = waiters.get(job.id);
    if (!listeners) return;
    waiters.delete(job.id);
    for (const resolve of listeners) resolve(publicJob(job));
  }

  function updateJob(job, patch, {item = null, itemPatch = null} = {}) {
    if (item && itemPatch) Object.assign(item, itemPatch);
    const before = job.status;
    Object.assign(job, patch, {updatedAt: nowIso()});
    const items = job.items || [];
    const done = items.filter(entry => ['completed', 'skipped', 'failed'].includes(entry.status)).length;
    job.progress = {
      completed: done,
      total: items.length,
      percent: items.length ? Math.round((done / items.length) * 100) : null,
      currentItem: items.find(entry => entry.status === 'running')?.id || ''
    };
    if (TERMINAL_STATUSES.has(job.status) && job.status !== before) {
      if (job.status === 'completed' && items.some(entry => entry.status === 'failed')) job.status = 'partial';
      job.finishedAt = job.finishedAt || nowIso();
    }
    scheduleSave();
    if (job.status !== before || TERMINAL_STATUSES.has(job.status)) notify(job);
  }

  /* ------------------------------- 提交与校验 ------------------------------- */

  function normalizeItem(raw, index, vendors) {
    const mode = String(raw?.mode || (raw?.path ? 'copy' : raw?.prompt ? 'generate' : raw?.data ? 'ingest' : 'ingest')).toLowerCase();
    const type = ASSET_TYPES[raw?.type] ? raw.type : 'misc';
    const item = {
      id: `it_${index + 1}_${randomUUID().slice(0, 8)}`,
      mode,
      type,
      status: 'queued',
      project: raw?.project || raw?.projectName || '',
      character: raw?.character || raw?.characterName || '',
      outfit: raw?.outfit || raw?.outfitName || '',
      view: raw?.view || '',
      part: raw?.part || '',
      style: raw?.style || '',
      era: raw?.era || '',
      gender: raw?.gender || '',
      ageStage: raw?.ageStage || '',
      version: raw?.version ? String(raw.version) : 'v1',
      index: raw?.index,
      scene: raw?.scene || raw?.sceneName || '',
      canonicalKey: raw?.canonicalKey || '',
      chapter: raw?.chapter,
      tags: Array.isArray(raw?.tags) ? raw.tags.slice(0, 40) : [],
      note: raw?.note || '',
      vars: raw?.vars && typeof raw.vars === 'object' ? raw.vars : {},
      collision: ['version', 'overwrite', 'skip', 'hash'].includes(raw?.collision) ? raw.collision : undefined,
      destinations: Array.isArray(raw?.destinations) && raw.destinations.length ? raw.destinations.map(String) : undefined,
      ext: raw?.ext ? String(raw.ext).replace(/^\./, '').toLowerCase() : undefined,
      /** generate */
      prompt: typeof raw?.prompt === 'string' ? raw.prompt : '',
      size: raw?.size === '2048x1152' ? '2048x1152' : raw?.size === '1536x864' ? '1536x864' : undefined,
      references: Array.isArray(raw?.references) ? raw.references.slice(0, 3) : [],
      engine: raw?.engine || '',
      timeoutSeconds: Number(raw?.timeoutSeconds) || 0,
      /** ingest */
      data: typeof raw?.data === 'string' ? raw.data : '',
      url: typeof raw?.url === 'string' ? raw.url : '',
      filename: raw?.filename ? String(raw.filename) : '',
      /** copy */
      sourcePath: raw?.sourcePath ? String(raw.sourcePath) : raw?.path ? String(raw.path) : '',
      /** workshop */
      job: raw?.job && typeof raw.job === 'object' ? raw.job : null,
      attempts: 0
    };
    if (item.mode === 'generate' && !item.prompt) throw badRequest(`第 ${index + 1} 项缺少 prompt。`, 'item_prompt_missing');
    if (item.mode === 'ingest' && !item.data && !item.url) throw badRequest(`第 ${index + 1} 项缺少 data 或 url。`, 'item_payload_missing');
    if (item.mode === 'copy' && !item.sourcePath) throw badRequest(`第 ${index + 1} 项缺少 path。`, 'item_path_missing');
    if (item.mode === 'workshop' && !item.job) throw badRequest(`第 ${index + 1} 项缺少 job 描述。`, 'item_job_missing');
    if (item.prompt.length > 18000) throw badRequest(`第 ${index + 1} 项 prompt 超过 18000 字。`, 'item_prompt_too_long');
    for (const reference of item.references) {
      if (typeof reference !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(reference)) {
        throw badRequest(`第 ${index + 1} 项参考图格式不正确（需要 data:image/png;base64,...）。`, 'item_reference_invalid');
      }
    }
    return item;
  }

  function badRequest(message, code) {
    return Object.assign(new Error(message), {status: 400, code});
  }

  /** 一个工单项产出多张图时副本会累加；同一位置 + 同一相对路径只保留一条。 */
  function mergeCopies(existing, incoming) {
    const merged = new Map();
    for (const copy of [...(existing || []), ...(incoming || [])]) {
      if (!copy?.destinationId) continue;
      merged.set(`${copy.destinationId}\u0000${copy.relativePath}`, copy);
    }
    return [...merged.values()];
  }

  async function create(input, {token} = {}) {
    await ensureLoaded();
    const settings = await config.read();
    settingsRef.value = settings;
    if (!input || typeof input !== 'object') throw badRequest('请求体需要是 JSON 对象。', 'body_invalid');
    const rawItems = Array.isArray(input.items) ? input.items : input.item ? [input.item] : [];
    if (!rawItems.length) throw badRequest('items 不能为空。', 'items_empty');
    if (rawItems.length > settings.intake.maxItemsPerJob) throw badRequest(`单次最多 ${settings.intake.maxItemsPerJob} 项。`, 'items_too_many');

    const clientRequestId = input.clientRequestId ? String(input.clientRequestId).slice(0, 120) : '';
    if (clientRequestId) {
      const existing = [...jobs.values()].find(job => job.clientRequestId && job.clientRequestId === clientRequestId);
      if (existing) return {job: publicJob(existing), duplicate: true};
    }

    const callback = input.callback?.url ? {
      url: String(input.callback.url),
      token: input.callback.token ? String(input.callback.token) : '',
      delivered: false,
      attempts: 0,
      lastError: ''
    } : null;
    if (callback) {
      let parsed;
      try {
        parsed = new URL(callback.url);
      } catch {
        throw badRequest('callback.url 不是合法地址。', 'callback_invalid');
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest('callback.url 只支持 http/https。', 'callback_invalid');
    }

    const job = {
      id: `job_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
      status: 'queued',
      phase: 'queued',
      message: '已接单，等待处理。',
      vendor: String(input.vendor || token?.record?.label || '').slice(0, 120),
      project: String(input.project || input.projectName || '').slice(0, 200),
      clientRequestId,
      callback,
      createdAt: nowIso(),
      items: rawItems.map((item, index) => normalizeItem({...item, project: item?.project || item?.projectName || input.project, style: item?.style || input.style}, index, input)),
      progress: {completed: 0, total: rawItems.length, percent: 0},
      defaults: {
        destinations: Array.isArray(input.destinations) && input.destinations.length ? input.destinations.map(String) : undefined,
        collision: input.collision,
        type: ASSET_TYPES[input.type] ? input.type : undefined
      }
    };
    for (const item of job.items) {
      if (!item.type || item.type === 'misc') item.type = job.defaults.type || item.type;
      if (!item.collision && job.defaults.collision) item.collision = job.defaults.collision;
      if (!item.destinations && job.defaults.destinations) item.destinations = job.defaults.destinations;
    }
    jobs.set(job.id, job);
    order.push(job.id);
    trim();
    await scheduleSave();
    logger?.info('接单', {jobId: job.id, items: job.items.length, vendor: job.vendor});
    schedulePump();
    return {job: publicJob(job)};
  }

  /* --------------------------------- 执行 --------------------------------- */

  function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    setTimeout(() => {
      pumpScheduled = false;
      pump().catch(error => logger?.error('作业调度失败', {error: error.message}));
    }, 0);
  }

  async function pump() {
    const settings = settingsRef.value || (await config.read());
    settingsRef.value = settings;
    const limit = Math.max(1, settings.intake.maxConcurrentJobs);
    while (running.size < limit) {
      const next = order.map(id => jobs.get(id)).find(job => job && (job.status === 'queued' || job.status === 'partial') && !running.has(job.id));
      if (!next) break;
      next.status = 'running';
      next.startedAt = next.startedAt || nowIso();
      next.phase = 'running';
      next.message = '正在处理。';
      const controller = new AbortController();
      running.set(next.id, controller);
      scheduleSave();
      execute(next, controller).catch(error => logger?.error('作业执行异常', {jobId: next.id, error: error.message}))
        .finally(() => {
          running.delete(next.id);
          scheduleSave();
          schedulePump();
        });
    }
  }

  async function decodeItemBytes(item, job) {
    if (item.mode === 'generate') {
      const engineName = item.engine || (item.job ? 'workshop' : 'scene');
      item.engine = engineName;
      if (engineName === 'workshop') {
        return await runWorkshopItem(item, job);
      }
      const bytes = await scene.generateImage({prompt: item.prompt, size: item.size, references: item.references});
      return {bytes, ext: 'png'};
    }
    if (item.mode === 'ingest') {
      if (item.data) {
        const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(item.data.trim());
        const base64 = match ? match[2] : item.data.replace(/\s+/g, '');
        const bytes = Buffer.from(base64, 'base64');
        if (!bytes.length) throw badRequest('data 不是有效的 base64。', 'item_data_invalid');
        const ext = item.ext || (match ? match[1].split('/')[1] : 'png');
        return {bytes, ext};
      }
      const response = await fetch(item.url, {signal: undefined});
      if (!response.ok) throw Object.assign(new Error(`下载 url 失败：${response.status}`), {status: 502, code: 'item_url_failed'});
      const bytes = Buffer.from(await response.arrayBuffer());
      const ext = item.ext || path.extname(new URL(item.url).pathname).replace(/^\./, '') || 'png';
      return {bytes, ext};
    }
    if (item.mode === 'copy') {
      const {readFile} = await import('node:fs/promises');
      const bytes = await readFile(item.sourcePath);
      return {bytes, ext: item.ext || path.extname(item.sourcePath).replace(/^\./, '') || 'png'};
    }
    if (item.mode === 'workshop') {
      return await runWorkshopItem(item, job);
    }
    throw badRequest(`不支持的 mode：${item.mode}。`, 'item_mode_invalid');
  }

  async function runWorkshopItem(item, job) {
    item.engine = 'workshop';
    let payload;
    if (item.job) {
      payload = {...item.job};
    } else {
      // A comic requirement is one reviewable character candidate. Native face,
      // body and outfit pipelines remain available through an explicit job.
      const references = [];
      for (const [index, data] of item.references.entries()) {
        const uploaded = await workshop.call('POST', '/api/upload', {filename: `comic-reference-${index + 1}.png`, data});
        if (!uploaded?.url) throw Object.assign(new Error('角色参考图上传未返回有效路径。'), {code: 'workshop_reference_missing'});
        references.push(uploaded.url);
      }
      payload = {
        kind: 'comic_character', name: item.character || '漫画角色资产',
        instructions: item.prompt, style: item.style || '国漫', references,
        clientRequestId: `${job.id}_${item.id}`,
        archiveFilter: '^comic-character\\.png$'
      };
    }
    const engineJob = await workshop.submitJob(payload, {
      signal: running.get(job.id)?.signal,
      timeoutMs: (item.timeoutSeconds || settingsRef.value?.intake.jobTimeoutSeconds || 5400) * 1000,
      onProgress: progress => {
        item.progress = progress;
        scheduleSave();
      }
    });
    item.engineJobId = engineJob.id;
    const produced = [];
    for (const file of await workshop.listJobOutputs(engineJob, {filter: payload.archiveFilter, fields: payload.archiveFields})) {
      const bytes = await workshop.fetchFile(file.url);
      if (!bytes) continue;
      produced.push({
        bytes,
        ext: path.extname(file.url).replace(/^\./, '') || 'png',
        view: file.view || (produced.length === 0 ? 'card' : `part${produced.length + 1}`),
        part: file.part || '',
        note: engineJob.message || ''
      });
    }
    if (!produced.length) {
      throw Object.assign(new Error('角色引擎任务完成，但任务目录里没有找到可归档的图片。'), {status: 502, code: 'workshop_no_output'});
    }
    item.produced = produced;
    return produced[0];
  }

  async function execute(job, controller) {
    const settings = settingsRef.value || (await config.read());
    const timeout = setTimeout(() => {
      job.message = '作业超时，已中止。';
      controller.abort();
    }, settings.intake.jobTimeoutSeconds * 1000);
    timeout.unref?.();
    try {
      for (const item of job.items) {
        if (controller.signal.aborted) {
          item.status = 'failed';
          item.message = '作业已取消。';
          continue;
        }
        if (TERMINAL_STATUSES.has(item.status)) continue;
        item.status = 'running';
        item.startedAt = item.startedAt || nowIso();
        item.attempts = (item.attempts || 0) + 1;
        updateJob(job, {status: 'running', phase: 'running', message: `正在处理 ${item.type}/${item.character || item.name || item.id}`});
        try {
          const staged = await decodeItemBytes(item, job);
          const outputs = item.produced?.length ? item.produced : [staged];
          let first = null;
          let order = 0;
          for (const output of outputs) {
            order += 1;
            const view = output.view || (outputs.length > 1 ? `part${order}` : item.view);
            const result = await archive.store({
              bytes: output.bytes,
              type: item.type,
              project: item.project || job.project,
              character: item.character,
              outfit: item.outfit,
              view,
              part: output.part || item.part,
              style: item.style,
              era: item.era,
              gender: item.gender,
              ageStage: item.ageStage,
              version: item.version,
              index: outputs.length > 1 ? order : item.index,
              scene: item.scene,
              canonicalKey: item.canonicalKey,
              chapter: item.chapter,
              tags: item.tags,
              note: output.note || item.note,
              ext: output.ext || item.ext || 'png',
              vars: item.vars,
              collision: item.collision,
              destinations: item.destinations,
              origin: item.mode === 'generate' ? `engine:${item.engine}` : `intake:${item.mode}`,
              jobId: job.id,
              clientRequestId: job.clientRequestId,
              vendor: job.vendor,
              extra: {mode: item.mode, engineJobId: item.engineJobId || '', prompt: item.prompt ? item.prompt.slice(0, 4000) : ''}
            });
            if (result.skipped) {
              item.status = 'skipped';
              item.message = result.reason;
              continue;
            }
            const asset = result.asset;
            if (!first) {
              first = asset;
              item.assetId = asset.assetId;
              item.relativePath = asset.relativePath;
              item.sha256 = asset.sha256;
              item.bytes = asset.bytes;
              item.width = asset.width;
              item.height = asset.height;
              item.name = asset.name;
            } else {
              item.extraAssets = [...(item.extraAssets || []), {assetId: asset.assetId, relativePath: asset.relativePath}];
            }
            item.copies = mergeCopies(item.copies, result.copies);
            if (result.failures?.length) {
              item.message = `已入库，${result.failures.length} 个存储位置待补写。`;
            }
          }
          if (item.status === 'running') {
            item.status = 'completed';
            item.message = item.message || '已生成并归档。';
          }
        } catch (error) {
          item.status = 'failed';
          item.message = error.message;
          item.errorCode = error.code || '';
          logger?.warn('工单项失败', {jobId: job.id, itemId: item.id, error: error.message, code: error.code});
        }
        item.finishedAt = nowIso();
        updateJob(job, {});
      }
      const items = job.items;
      const failed = items.filter(item => item.status === 'failed').length;
      const completed = items.filter(item => ['completed', 'skipped'].includes(item.status)).length;
      const status = failed === 0 ? 'completed' : completed > 0 ? 'partial' : 'failed';
      job.phase = status;
      job.message = status === 'completed' ? `全部完成，共 ${completed} 项。` : status === 'partial' ? `部分完成：成功 ${completed} 项，失败 ${failed} 项。` : '全部失败。';
      if (job.status==='cancelled'||controller.signal.aborted && !job.finishedAt) job.status = 'cancelled';
      else job.status = status;
      updateJob(job, {});
      if (job.status === 'cancelled') job.message = '作业已取消，已完成的部分保留在素材库。';
    } finally {
      clearTimeout(timeout);
      if (job.callback && !TERMINAL_STATUSES.has(job._callbackSent)) {
        deliverCallback(job).catch(() => {});
      }
      job.finishedAt = job.finishedAt || nowIso();
      scheduleSave();
      notify(job);
    }
  }

  /* --------------------------------- 回调 --------------------------------- */

  async function deliverCallback(job) {
    if (!job.callback?.url) return {delivered: false, reason: 'no_callback'};
    const settings = settingsRef.value || (await config.read());
    const body = JSON.stringify({event: 'job.finished', job: publicJob(job)});
    for (let attempt = 0; attempt <= settings.intake.callbackRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settings.intake.callbackTimeoutSeconds * 1000);
      try {
        const response = await fetch(job.callback.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Workbench-Event': 'job.finished',
            'X-Workbench-Job': job.id,
            ...(job.callback.token ? {'X-Workbench-Token': job.callback.token} : {})
          },
          body,
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        job.callback.delivered = true;
        job.callback.attempts = attempt + 1;
        job.callback.lastError = '';
        job._callbackSent = 'completed';
        scheduleSave();
        return {delivered: true, attempts: attempt + 1};
      } catch (error) {
        job.callback.attempts = attempt + 1;
        job.callback.lastError = error.message;
        clearTimeout(timer);
        if (attempt < settings.intake.callbackRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.min(30_000, 2000 * 2 ** attempt)));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    scheduleSave();
    return {delivered: false, reason: job.callback.lastError};
  }

  /* --------------------------------- 查询 --------------------------------- */

  async function get(jobId) {
    await ensureLoaded();
    return publicJob(jobs.get(jobId));
  }

  async function list({status = '', limit = 50, offset = 0, vendor = ''} = {}) {
    await ensureLoaded();
    let list = order.map(id => jobs.get(id)).filter(Boolean);
    if (status) list = list.filter(job => job.status === status);
    if (vendor) list = list.filter(job => job.vendor === vendor);
    list = list.reverse();
    return {
      total: list.length,
      jobs: list.slice(offset, offset + Math.min(Math.max(limit, 1), 200)).map(job => publicJob(job, {includeItems: false}))
    };
  }

  async function cancel(jobId, {reason = ''} = {}) {
    await ensureLoaded();
    const job = jobs.get(jobId);
    if (!job) throw Object.assign(new Error('作业不存在。'), {status: 404, code: 'job_missing'});
    if (TERMINAL_STATUSES.has(job.status)) return {job: publicJob(job), alreadyFinished: true};
    const controller = running.get(job.id);
    job.message = reason || '已请求取消。';
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.phase = 'cancelled';
      job.finishedAt = nowIso();
      for (const item of job.items) {
        if (item.status === 'queued') {
          item.status = 'failed';
          item.message = '作业已取消。';
        }
      }
      updateJob(job, {});
      return {job: publicJob(job)};
    }
    if (settingsRef.value?.intake.cancelPropagates) controller?.abort();
    updateJob(job, {message: '正在取消，等待当前步骤结束。'});
    return {job: publicJob(job), cancelling: true};
  }

  /** 等待作业结束（内部用；接口层用轮询更稳） */
  function waitFor(jobId, timeoutMs = 60_000) {
    return new Promise(resolve => {
      const list = waiters.get(jobId) || [];
      list.push(resolve);
      waiters.set(jobId, list);
      setTimeout(() => {
        const current = waiters.get(jobId);
        if (!current) return;
        const index = current.indexOf(resolve);
        if (index >= 0) current.splice(index, 1);
        resolve(publicJob(jobs.get(jobId)));
      }, timeoutMs).unref?.();
    });
  }

  async function stats() {
    await ensureLoaded();
    const list = order.map(id => jobs.get(id)).filter(Boolean);
    return {
      total: list.length,
      queued: list.filter(job => job.status === 'queued').length,
      running: running.size,
      completed: list.filter(job => job.status === 'completed').length,
      partial: list.filter(job => job.status === 'partial').length,
      failed: list.filter(job => job.status === 'failed').length,
      cancelled: list.filter(job => job.status === 'cancelled').length,
      items: list.reduce((sum, job) => sum + (job.items?.length || 0), 0)
    };
  }

  async function retryFailed(jobId) {
    await ensureLoaded();
    const job = jobs.get(jobId);
    if (!job) throw Object.assign(new Error('作业不存在。'), {status: 404, code: 'job_missing'});
    const failed = (job.items || []).filter(item => item.status === 'failed' && item.mode !== 'copy');
    if (!failed.length) return {job: publicJob(job), retried: 0};
    for (const item of failed) {
      item.status = 'queued';
      item.message = '重新排队。';
    }
    job.status = 'queued';
    job.phase = 'queued';
    job.finishedAt = null;
    job.message = `重新处理 ${failed.length} 个失败项。`;
    await scheduleSave();
    schedulePump();
    return {job: publicJob(job), retried: failed.length};
  }

  async function init() {
    await ensureLoaded();
    settingsRef.value = await config.read();
    await ensureDir(paths.data);
  }

  async function forceStop(){await ensureLoaded();for(const job of jobs.values())if(ACTIVE_STATUSES.has(job.status)){job.status='cancelled';job.phase='cancelled';job.finishedAt=nowIso();job.message='主机强制升级，已停止本机任务，已有图片保留';for(const item of job.items||[])if(['queued','running'].includes(item.status)){item.status='failed';item.message=job.message;}}for(const controller of running.values())controller.abort();await scheduleSave();}

  async function shutdown() {
    for (const controller of running.values()) controller.abort();
    await saving;
  }

  return {init, create, get, list, cancel, waitFor, stats, retryFailed, shutdown, forceStop,pump, publicJob, _jobs: jobs};
}

export function isActive(status) {
  return ACTIVE_STATUSES.has(status);
}
