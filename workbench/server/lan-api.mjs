/**
 * 接单 API（局域网）：生图平台 → 工作台。
 *
 * 与旧的"只允许本机"边界相比，这里做了三件必要的事：
 *  1. 显式绑定网卡（默认 0.0.0.0），不再是 127.0.0.1；
 *  2. 令牌鉴权 + 权限范围（intake/read/write/admin），而不是靠 Host 头自证清白；
 *  3. 先收单返回 jobId，再异步干活 + 可选回调，不再让平台等几分钟的同步请求。
 *
 * 另外保留 CORS：平台侧很多是网页前端，没有 CORS 就只能靠后端代理。
 */
import {existsSync} from 'node:fs';
import {ASSET_TYPES} from './naming.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token, X-Workbench-Token',
  'Access-Control-Max-Age': '86400'
};

export function lanCorsHeaders() {
  return {...CORS_HEADERS};
}

export function registerLanRoutes(ctx) {
  const {jobs, index, archive, config, tokens, logger, engines} = ctx;

  const routes = [];
  const route = (method, pattern, handler, options = {}) => routes.push({method, pattern, handler, options});

  /* --------------------------------- 元信息 --------------------------------- */

  route('GET', /^\/api\/lan\/v1\/health$/, async () => ({
    body: {
      ok: true,
      app: 'asset-generation-workbench',
      version: ctx.version,
      time: new Date().toISOString(),
      lan: true,
      engines: await enginesStatus(),
      assets: index.stats()
    }
  }), {scope: null, cors: true});

  route('GET', /^\/api\/lan\/v1\/capabilities$/, async () => ({
    body: {
      version: ctx.version,
      dialects: ['generic-v1', 'openai-images'],
      modes: ['generate', 'ingest', 'copy', 'workshop'],
      assetTypes: ASSET_TYPES,
      engines: await enginesStatus(),
      naming: {
        variables: ['project', 'type', 'typeLabel', 'character', 'outfit', 'view', 'part', 'style', 'era', 'gender', 'version', 'index', 'job', 'scene', 'canonicalKey', 'date', 'time', 'datetime', 'yyyy', 'MM', 'dd', 'HH', 'mm', 'ss', 'ext'],
        description: '文件名与目录由服务端模板决定；平台只需给出业务字段。'
      },
      limits: {
        maxItemsPerJob: (await config.read()).intake.maxItemsPerJob,
        maxUploadBytes: (await config.read()).maxUploadBytes,
        referenceImagesPerItem: 3
      },
      endpoints: {
        submit: 'POST /api/lan/v1/jobs',
        job: 'GET /api/lan/v1/jobs/{jobId}',
        jobs: 'GET /api/lan/v1/jobs',
        cancel: 'POST /api/lan/v1/jobs/{jobId}/cancel',
        assets: 'GET /api/lan/v1/assets?q=&type=&project=&character=&limit=&offset=',
        asset: 'GET /api/lan/v1/assets/{assetId}',
        assetFile: 'GET /api/lan/v1/assets/{assetId}/file',
        byPath: 'GET /api/lan/v1/files?relativePath=',
        stats: 'GET /api/lan/v1/stats'
      }
    }
  }), {scope: null, cors: true});

  async function enginesStatus() {
    const [scene, workshop] = await Promise.all([
      engines.scene.status().catch(error => ({running: false, error: error.message})),
      engines.workshop.status().catch(error => ({running: false, error: error.message}))
    ]);
    return {
      scene: {running: !!scene.running, port: scene.port, codex: scene.info?.codexAvailable ?? null, model: scene.info?.imageModel || '', message: scene.info?.message || scene.error || ''},
      workshop: {running: !!workshop.running, port: workshop.port, version: workshop.info?.version || '', message: workshop.error || ''}
    };
  }

  /* --------------------------------- 作业 --------------------------------- */

  route('POST', /^\/api\/lan\/v1\/jobs$/, async request => {
    const payload = await request.json();
    const result = await jobs.create(payload, {token: request.token});
    return {body: {...result.job, duplicate: !!result.duplicate}, status: result.duplicate ? 200 : 202};
  }, {scope: 'intake', cors: true});

  route('GET', /^\/api\/lan\/v1\/jobs$/, async request => {
    const query = request.url.searchParams;
    return {
      body: await jobs.list({
        status: query.get('status') || '',
        vendor: query.get('vendor') || '',
        limit: Number(query.get('limit') || 50),
        offset: Number(query.get('offset') || 0)
      })
    };
  }, {scope: 'read', cors: true});

  route('GET', /^\/api\/lan\/v1\/jobs\/([^/]+)$/, async request => {
    const job = await jobs.get(request.params[0]);
    if (!job) throw notFound('作业不存在。', 'job_missing');
    return {body: job};
  }, {scope: 'read', cors: true});

  route('POST', /^\/api\/lan\/v1\/jobs\/([^/]+)\/cancel$/, async request => {
    const payload = await request.json().catch(() => ({}));
    return {body: await jobs.cancel(request.params[0], {reason: payload?.reason})};
  }, {scope: 'intake', cors: true});

  route('POST', /^\/api\/lan\/v1\/jobs\/([^/]+)\/retry$/, async request => {
    return {body: await jobs.retryFailed(request.params[0])};
  }, {scope: 'intake', cors: true});

  /** 单步同步生图：给小批量、要求即时拿到图的调用方 */
  route('POST', /^\/api\/lan\/v1\/render$/, async request => {
    const settings = await config.read();
    const payload = await request.json();
    if (!payload?.prompt || typeof payload.prompt !== 'string') throw badRequest('缺少 prompt。', 'prompt_missing');
    const size = payload.size === '2048x1152' ? '2048x1152' : settings.scene.imageSize;
    const references = Array.isArray(payload.references) ? payload.references.slice(0, 3) : [];
    const bytes = await engines.scene.generateImage({prompt: payload.prompt, size, references});
    const result = await archive.store({
      bytes,
      type: ASSET_TYPES[payload.type] ? payload.type : 'scene',
      project: payload.project || '',
      character: payload.character || '',
      outfit: payload.outfit || '',
      view: payload.view || '',
      scene: payload.scene || '',
      canonicalKey: payload.canonicalKey || '',
      style: payload.style || '',
      version: payload.version,
      tags: payload.tags,
      note: payload.note || '',
      ext: 'png',
      collision: payload.collision,
      destinations: Array.isArray(payload.destinations) ? payload.destinations : undefined,
      origin: 'lan:render',
      vendor: request.token?.record?.label || '',
      extra: {prompt: payload.prompt.slice(0, 4000)}
    });
    return {body: {asset: publicAsset(result.asset)}, status: 201};
  }, {scope: 'intake', cors: true});

  /* -------------------------------- 素材查询 -------------------------------- */

  route('GET', /^\/api\/lan\/v1\/assets$/, async request => {
    const query = request.url.searchParams;
    const result = await index.query({
      q: query.get('q') || '',
      type: query.get('type') || '',
      project: query.get('project') || '',
      character: query.get('character') || '',
      outfit: query.get('outfit') || '',
      style: query.get('style') || '',
      era: query.get('era') || '',
      gender: query.get('gender') || '',
      kind: query.get('kind') || '',
      tags: query.get('tags') || '',
      destinationId: query.get('destinationId') || '',
      includeDeleted: query.get('includeDeleted') === '1',
      since: query.get('since') || '',
      until: query.get('until') || '',
      sort: query.get('sort') || 'createdAt',
      order: query.get('order') || 'desc',
      limit: Number(query.get('limit') || 60),
      offset: Number(query.get('offset') || 0)
    });
    return {
      body: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        facets: result.facets,
        assets: result.assets.map(publicAsset)
      }
    };
  }, {scope: 'read', cors: true});

  route('GET', /^\/api\/lan\/v1\/assets\/([^/]+)\/file$/, async request => {
    const asset = index.get(request.params[0]);
    if (!asset || asset.deletedAt) throw notFound('素材不存在。', 'asset_missing');
    const requested = request.url.searchParams.get('destinationId');
    const stored = readStoredFile(asset, requested);
    if (!stored) throw notFound('素材文件在磁盘上不存在（可能被移动或共享掉线）。', 'asset_file_missing');
    return {
      file: {path: stored.path, mime: mimeFor(asset.extension), downloadName: asset.name},
      cacheControl: 'private, max-age=3600'
    };
  }, {scope: 'read', cors: true});

  route('GET', /^\/api\/lan\/v1\/assets\/([^/]+)$/, async request => {
    const asset = index.get(request.params[0]);
    if (!asset || asset.deletedAt) throw notFound('素材不存在。', 'asset_missing');
    return {body: publicAsset(asset)};
  }, {scope: 'read', cors: true});

  route('GET', /^\/api\/lan\/v1\/files$/, async request => {
    const relative = request.url.searchParams.get('relativePath');
    if (!relative) throw badRequest('缺少 relativePath。', 'relative_path_missing');
    const asset = index.findByRelativePath(relative);
    if (!asset || asset.deletedAt) throw notFound('该相对路径没有登记素材。', 'asset_missing');
    return {
      file: {path: readStoredFile(asset)?.path, mime: mimeFor(asset.extension), downloadName: asset.name},
      cacheControl: 'private, max-age=3600'
    };
  }, {scope: 'read', cors: true});

  route('GET', /^\/api\/lan\/v1\/stats$/, async () => ({
    body: {assets: index.stats(), jobs: await jobs.stats(), destinations: await archive.checkDestinations(), outbox: (await archive.pending()).length}
  }), {scope: 'read', cors: true});

  route('DELETE', /^\/api\/lan\/v1\/assets\/([^/]+)$/, async request => {
    const asset = await index.markDeleted(request.params[0]);
    if (!asset) throw notFound('素材不存在。', 'asset_missing');
    return {body: {deleted: asset.assetId, softDelete: true, note: '索引已标记删除，磁盘文件保留。'}};
  }, {scope: 'write', cors: true});

  /* ------------------------------ 与两个引擎互通 ------------------------------ */

  route('GET', /^\/api\/lan\/v1\/engines$/, async () => ({body: {engines: await enginesStatus()}}), {scope: null, cors: true});

  route('POST', /^\/api\/lan\/v1\/engines\/(scene|workshop)\/(start|stop)$/, async request => {
    const [engine, action] = request.params;
    const target = engines[engine];
    if (!target) throw Object.assign(new Error(`未知引擎：${engine}`), {status: 400});
    const result = action === 'start' ? await target.start() : await target.stop();
    return {body: {engine, action, result}};
  }, {scope: 'admin', cors: true});

  return routes;

  function publicAsset(asset) {
    return {
      assetId: asset.assetId,
      name: asset.name,
      relativePath: asset.relativePath,
      extension: asset.extension,
      kind: asset.kind,
      type: asset.type,
      typeLabel: asset.typeLabel || ASSET_TYPES[asset.type] || asset.type,
      project: asset.project,
      character: asset.character,
      outfit: asset.outfit,
      view: asset.view,
      part: asset.part,
      style: asset.style,
      era: asset.era,
      gender: asset.gender,
      ageStage: asset.ageStage,
      version: asset.version,
      tags: asset.tags,
      note: asset.note,
      sha256: asset.sha256,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
      origin: asset.origin,
      jobId: asset.jobId,
      vendor: asset.vendor,
      copies: asset.copies.map(copy => ({destinationId: copy.destinationId, relativePath: copy.relativePath, path: copy.path})),
      url: `/api/lan/v1/assets/${asset.assetId}/file`,
      self: `/api/lan/v1/assets/${asset.assetId}`,
      deletedAt: asset.deletedAt || null
    };
  }
}

export function mimeFor(extension) {
  const ext = String(extension || '').toLowerCase().replace(/^\./, '');
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    json: 'application/json',
    txt: 'text/plain; charset=utf-8',
    md: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm'
  }[ext] || 'application/octet-stream';
}

export function readStoredFile(asset, destinationId) {
  const copies = (asset.copies || []).filter(copy => copy.path);
  if (!copies.length) return null;
  const preferred = destinationId ? copies.filter(copy => copy.destinationId === destinationId) : [];
  for (const copy of [...preferred, ...copies]) {
    try {
      if (existsSync(copy.path)) return copy;
    } catch {
      /* 忽略：继续尝试下一个副本 */
    }
  }
  return null;
}

function notFound(message, code) {
  return Object.assign(new Error(message), {status: 404, code});
}

function badRequest(message, code) {
  return Object.assign(new Error(message), {status: 400, code});
}
