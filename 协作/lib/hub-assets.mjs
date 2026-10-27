// 中控共享资产：内容寻址 blob、资产登记/版本/去重、并发申请原子性、缩略图懒生成。
// 对应协议与设计.md §3（assets/assetRequests）与 §9；图片校验统一复用 protocol.mjs。
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {
  ASSET_KINDS,
  CollabError,
  IMAGE_MIMES,
  check,
  clampInteger,
  ensureDir,
  normalizeAssetKey,
  sha256 as sha256Of,
  uid,
  validateImageBuffer,
} from './protocol.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SILENT_LOGGER = {info() {}, warn() {}, error() {}};
const THUMB_MAX_SIDE = 320;
const DEFAULT_MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_DEDUPE_KEY = 1200;

// @napi-rs/canvas 是可选能力：包内运行环境已安装就用，缺失/加载失败时缩略图接口返回 404，绝不崩溃。
let canvasModuleCache;
function loadCanvasModule(logger) {
  if (canvasModuleCache !== undefined) return canvasModuleCache;
  const require = createRequire(import.meta.url);
  const candidates = [];
  const fromEnv = String(process.env.COLLAB_CANVAS_MODULE || '').trim();
  if (fromEnv) candidates.push(path.resolve(fromEnv));
  candidates.push(path.resolve(HERE, '../../workbench/运行环境/node/node_modules/@napi-rs/canvas'));
  for (const candidate of candidates) {
    try {
      const loaded = require(candidate);
      if (loaded && typeof loaded.createCanvas === 'function' && typeof loaded.loadImage === 'function') {
        canvasModuleCache = loaded;
        logger?.info?.(`[中控] 缩略图模块已加载：${candidate}`);
        return canvasModuleCache;
      }
    } catch {
      // 继续尝试下一个候选路径。
    }
  }
  canvasModuleCache = null;
  logger?.warn?.('[中控] 未找到 @napi-rs/canvas，缩略图接口将返回 404（客户端会回退原图）');
  return canvasModuleCache;
}

function normalizeText(value, maxLength = 200) {
  return String(value ?? '').trim().replace(/[\u3000\s]+/g, ' ').slice(0, maxLength);
}

function normalizeReferences(raw) {
  check(raw === undefined || Array.isArray(raw), 'references 必须是数组', 400, 'invalid_references');
  return (Array.isArray(raw) ? raw : []).map((reference, index) => {
    check(reference && typeof reference === 'object', `第 ${index + 1} 个参考图无效`, 400, 'invalid_reference');
    const sha = String(reference.sha256 || '').toLowerCase();
    check(/^[0-9a-f]{64}$/.test(sha), `第 ${index + 1} 个参考图 sha256 无效`, 400, 'invalid_reference');
    return {
      sha256: sha,
      role: String(reference.role || 'reference').slice(0, 32),
      name: String(reference.name || '').slice(0, 200),
      mime: IMAGE_MIMES.includes(reference.mime) ? reference.mime : 'image/png',
      size: clampInteger(reference.size, 0, 512 * 1024 * 1024, 0),
    };
  });
}

export class HubAssets {
  constructor({hub, logger} = {}) {
    check(hub, '缺少中控状态实例', 500, 'missing_hub');
    this.hub = hub;
    this.config = hub.config;
    this.logger = logger && typeof logger === 'object' ? {...SILENT_LOGGER, ...logger} : SILENT_LOGGER;
    this.dataDir = hub.dataDir;
    this.blobsDir = hub.blobsDir || path.join(this.dataDir, 'blobs');
    this.thumbsDir = hub.thumbsDir || path.join(this.dataDir, 'thumbs');
    ensureDir(this.blobsDir);
    ensureDir(this.thumbsDir);
    this.queue = null;
    this.thumbPromises = new Map();
  }

  attachQueue(queue) {
    this.queue = queue;
    return this;
  }

  get state() {
    return this.hub.state;
  }

  // ------------------------------------------------------------------ blob 内容寻址存储
  assertSha(value) {
    const sha = String(value || '').toLowerCase();
    check(/^[0-9a-f]{64}$/.test(sha), `sha256 无效：${value}`, 400, 'invalid_sha256');
    return sha;
  }

  blobPath(sha256) {
    const sha = this.assertSha(sha256);
    return path.join(this.blobsDir, sha.slice(0, 2), sha);
  }

  thumbPath(sha256) {
    const sha = this.assertSha(sha256);
    return path.join(this.thumbsDir, `${sha}.png`);
  }

  hasBlob(sha256) {
    try {
      return fs.existsSync(this.blobPath(sha256));
    } catch {
      return false;
    }
  }

  readBlob(sha256) {
    try {
      return fs.readFileSync(this.blobPath(sha256));
    } catch {
      return null;
    }
  }

  // PUT /api/blobs 与结果上传共用：校验图片 → 计算 sha256 → 幂等写盘。
  putBlobBuffer(buffer, {expectedSha256 = null, maxBytes = DEFAULT_MAX_IMAGE_BYTES} = {}) {
    check(Buffer.isBuffer(buffer) && buffer.length > 0, '图片内容为空', 400, 'empty_image');
    const actualSha = sha256Of(buffer);
    if (expectedSha256) {
      const expected = String(expectedSha256).toLowerCase();
      check(/^[0-9a-f]{64}$/.test(expected), 'x-sha256 格式无效', 400, 'invalid_sha256');
      check(expected === actualSha, 'sha256 校验失败：上传内容与声明不一致', 400, 'sha256_mismatch');
    }
    const info = validateImageBuffer(buffer, {maxBytes});
    const target = this.blobPath(actualSha);
    const deduped = fs.existsSync(target);
    if (!deduped) {
      ensureDir(path.dirname(target));
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporary, buffer);
      try {
        fs.renameSync(temporary, target);
      } catch (error) {
        try {
          fs.rmSync(temporary, {force: true});
        } catch {}
        // 并发写同一内容时另一个请求可能已先落盘，此时视为命中。
        if (!fs.existsSync(target)) throw error;
      }
    }
    return {
      sha256: actualSha,
      blobId: `blob_${actualSha}`,
      size: buffer.length,
      mime: info.mime,
      width: info.width,
      height: info.height,
      deduped,
    };
  }

  // ------------------------------------------------------------------ 缩略图（懒生成）
  async ensureThumb(sha256) {
    const sha = this.assertSha(sha256);
    const file = this.thumbPath(sha);
    try {
      const cached = await fs.promises.readFile(file);
      return {sha256: sha, file, buffer: cached, mime: 'image/png', fromCache: true};
    } catch {
      // 未生成过，继续。
    }
    if (this.thumbPromises.has(sha)) return this.thumbPromises.get(sha);
    const job = (async () => {
      const blob = this.readBlob(sha);
      if (!blob) return null;
      const canvas = loadCanvasModule(this.logger);
      if (!canvas) return null;
      try {
        const image = await canvas.loadImage(blob);
        const sourceWidth = clampInteger(image.width, 1, 20000, 1);
        const sourceHeight = clampInteger(image.height, 1, 20000, 1);
        const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const target = canvas.createCanvas(width, height);
        const context = target.getContext('2d');
        context.drawImage(image, 0, 0, width, height);
        const buffer = target.toBuffer('image/png');
        ensureDir(path.dirname(file));
        const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(temporary, buffer);
        try {
          fs.renameSync(temporary, file);
        } catch (error) {
          try {
            fs.rmSync(temporary, {force: true});
          } catch {}
          if (!fs.existsSync(file)) throw error;
        }
        return {sha256: sha, file, buffer, mime: 'image/png', fromCache: false};
      } catch (error) {
        this.logger.warn?.(`[中控] 缩略图生成失败（${sha.slice(0, 12)}…）：${error.message}`);
        return null;
      }
    })().finally(() => this.thumbPromises.delete(sha));
    this.thumbPromises.set(sha, job);
    return job;
  }

  // ------------------------------------------------------------------ 资产去重键 / 申请
  assetDedupeKey({projectId = '', kind = 'other', name = '', form = '', costume = '', style = ''} = {}) {
    // §3 约定：v1|projectId|kind|归一化name|归一化form|归一化costume|归一化style（只看语义字段，不看文件名）。
    const key = `v1|${normalizeAssetKey({projectId, kind, name, form, costume, style})}`;
    return key.slice(0, MAX_DEDUPE_KEY);
  }

  normalizeAssetRequest(input = {}) {
    check(input && typeof input === 'object' && !Array.isArray(input), '资产申请必须是对象', 400, 'invalid_asset_request');
    const projectId = normalizeText(input.projectId, 200);
    check(projectId, '资产申请缺少 projectId', 400, 'missing_project_id');
    const kind = String(input.kind || 'other');
    check(ASSET_KINDS.includes(kind), `资产类型无效：${kind}`, 400, 'invalid_asset_kind');
    const name = normalizeText(input.name, 200);
    check(name, '资产申请缺少名称 name', 400, 'missing_asset_name');
    const size = {
      w: clampInteger(input.size && input.size.w, 1, 20000, 1024),
      h: clampInteger(input.size && input.size.h, 1, 20000, 1024),
    };
    return {
      projectId,
      projectName: normalizeText(input.projectName, 200),
      kind,
      name,
      form: normalizeText(input.form, 200),
      costume: normalizeText(input.costume, 200),
      style: normalizeText(input.style, 200),
      forceNewVersion: input.forceNewVersion === true,
      prompt: String(input.prompt || '').slice(0, 200000),
      size,
      generationInput: input.generationInput && typeof input.generationInput === 'object' && !Array.isArray(input.generationInput) ? input.generationInput : {},
      references: normalizeReferences(input.references),
      submittedBy: input.submittedBy ? String(input.submittedBy) : null,
    };
  }

  findAvailableByKey(dedupeKey) {
    return this.state.assets
      .filter((asset) => asset.dedupeKey === dedupeKey && asset.status === 'available')
      .sort((a, b) => b.version - a.version)[0] || null;
  }

  latestByKey(dedupeKey) {
    return this.state.assets
      .filter((asset) => asset.dedupeKey === dedupeKey)
      .sort((a, b) => b.version - a.version)[0] || null;
  }

  getAssetOrThrow(assetId) {
    const asset = this.hub.getAsset(assetId);
    if (!asset) throw new CollabError('资产不存在', {status: 404, code: 'asset_not_found'});
    return asset;
  }

  // POST /api/assets/request：查重 → 复用 / 关联 / 新建，全部同步完成。
  // 因为没有 await，同一事件循环内并发申请同一 dedupeKey 只会走一次「新建」分支。
  requestAsset(input = {}, {clientId = null} = {}) {
    const request = this.normalizeAssetRequest(input);
    const dedupeKey = this.assetDedupeKey(request);
    const submitter = clientId || request.submittedBy || null;

    if (!request.forceNewVersion) {
      const available = this.findAvailableByKey(dedupeKey);
      if (available) {
        return {mode: 'reuse', asset: available, dedupeKey};
      }
    }

    const pendingRequest = this.state.assetRequests.find((item) => item.dedupeKey === dedupeKey && item.status === 'pending');
    if (pendingRequest) {
      if (submitter && !pendingRequest.waiters.includes(submitter)) pendingRequest.waiters.push(submitter);
      pendingRequest.updatedAt = this.hub.nowIso();
      this.hub.touch();
      return {
        mode: 'join',
        asset: this.hub.getAsset(pendingRequest.assetId),
        request: pendingRequest,
        taskId: pendingRequest.taskId,
        dedupeKey,
      };
    }

    check(this.queue, '中控任务队列未初始化，无法创建资产生成任务', 500, 'queue_unavailable');
    const latest = this.latestByKey(dedupeKey);
    const asset = {
      id: uid('asset'),
      lineageId: latest ? latest.lineageId : uid('lin'),
      version: latest ? latest.version + 1 : 1,
      parentAssetId: latest ? latest.id : null,
      kind: request.kind,
      projectId: request.projectId,
      name: request.name,
      form: request.form,
      costume: request.costume,
      style: request.style,
      dedupeKey,
      sha256: null,
      blobId: null,
      size: 0,
      mime: 'image/png',
      width: 0,
      height: 0,
      status: 'pending',
      sourceTaskId: null,
      sourceNodeId: null,
      createdAt: this.hub.nowIso(),
      createdBy: submitter,
      labels: request.forceNewVersion ? {forceNewVersion: true} : {},
      thumb: null,
      requestId: null,
    };
    const assetRequest = {
      id: uid('areq'),
      dedupeKey,
      projectId: request.projectId,
      kind: request.kind,
      name: request.name,
      form: request.form,
      costume: request.costume,
      style: request.style,
      status: 'pending',
      assetId: asset.id,
      taskId: null,
      createdAt: this.hub.nowIso(),
      updatedAt: this.hub.nowIso(),
      waiters: submitter ? [submitter] : [],
    };
    asset.requestId = assetRequest.id;

    // 先建任务（可能因参数校验抛错），成功后再把 pending 资产/请求写入索引，避免半条记录。
    const {task} = this.queue.submitTask(
      {
        idempotencyKey: `asset-request|${assetRequest.id}`,
        type: 'asset-generation',
        projectId: request.projectId,
        projectName: request.projectName || request.projectId,
        episode: null,
        panelCode: null,
        panelId: null,
        shotCode: null,
        prompt: request.prompt,
        style: request.style,
        size: request.size,
        target: {
          assetId: asset.id,
          assetRequestId: assetRequest.id,
          dedupeKey,
          assetKind: request.kind,
          assetName: request.name,
          form: request.form,
          costume: request.costume,
        },
        generationInput: request.generationInput,
        references: request.references,
        submittedBy: submitter,
        assetRequestId: assetRequest.id,
        assetId: asset.id,
      },
      {clientId: submitter, source: 'asset-request'},
    );
    asset.sourceTaskId = task.id;
    assetRequest.taskId = task.id;
    this.state.assets.push(asset);
    this.state.assetRequests.push(assetRequest);
    this.hub.touch();
    return {mode: 'create', asset, request: assetRequest, task, dedupeKey};
  }

  // 任务成功：同一事务（同一事件循环、无 await）里写资产 available + 请求 done + 发通知。
  completeAssetTask(task) {
    if (!task || task.type !== 'asset-generation' || !task.assetRequestId) return null;
    const request = this.hub.getAssetRequest(task.assetRequestId) || this.state.assetRequests.find((item) => item.taskId === task.id);
    if (!request) return null;
    const asset = this.hub.getAsset(request.assetId);
    if (!asset) return null;
    if (request.status === 'done' && asset.status === 'available') return asset;
    if (!task.result) return null;
    asset.sha256 = task.result.sha256;
    asset.blobId = task.result.blobId;
    asset.size = task.result.size;
    asset.mime = task.result.mime;
    asset.width = task.result.width;
    asset.height = task.result.height;
    asset.status = 'available';
    asset.sourceNodeId = task.result.nodeId || null;
    asset.sourceTaskId = task.id;
    request.status = 'done';
    request.updatedAt = this.hub.nowIso();
    this.hub.addNotification({
      level: 'success',
      type: 'asset.created',
      title: '共享资产已入库',
      body: `资产「${asset.name || asset.id}」已生成并入库（版本 v${asset.version}），申请者可直接复用。`,
      taskId: task.id,
      assetId: asset.id,
    });
    this.hub.touch();
    return asset;
  }

  failAssetTask(task, {cancelled = false, reason = ''} = {}) {
    if (!task || task.type !== 'asset-generation' || !task.assetRequestId) return null;
    const request = this.hub.getAssetRequest(task.assetRequestId);
    if (!request) return null;
    const asset = this.hub.getAsset(request.assetId);
    if (asset && asset.status === 'pending') asset.status = 'failed';
    if (request.status === 'pending') request.status = cancelled ? 'cancelled' : 'failed';
    request.updatedAt = this.hub.nowIso();
    if (reason) request.detail = String(reason).slice(0, 500);
    this.hub.touch();
    return request;
  }

  retryAssetTask(task) {
    if (!task || task.type !== 'asset-generation' || !task.assetRequestId) return null;
    const request = this.hub.getAssetRequest(task.assetRequestId);
    if (!request) return null;
    const asset = this.hub.getAsset(request.assetId);
    if (asset && asset.status === 'failed') asset.status = 'pending';
    if (request.status === 'failed' || request.status === 'cancelled') {
      request.status = 'pending';
      request.updatedAt = this.hub.nowIso();
    }
    this.hub.touch();
    return request;
  }

  // ------------------------------------------------------------------ 查询
  listAssets(query = {}) {
    const limit = clampInteger(query.limit, 1, 500, 100);
    const offset = clampInteger(query.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const kind = query.kind ? String(query.kind) : null;
    const status = query.status ? String(query.status) : null;
    const projectId = query.projectId ? String(query.projectId) : null;
    const keyword = normalizeText(query.q, 200).toLowerCase();
    const allVersions = query.allVersions === true || query.allVersions === 'true' || query.allVersions === 1 || query.allVersions === '1';
    const filtered = this.state.assets.filter((asset) => {
      if (projectId && asset.projectId !== projectId) return false;
      if (kind && asset.kind !== kind) return false;
      if (status && asset.status !== status) return false;
      if (keyword) {
        const haystack = [asset.name, asset.form, asset.costume, asset.style, asset.projectId]
          .map((value) => normalizeText(value, 200).toLowerCase())
          .join(' ');
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
    let assets = filtered;
    if (!allVersions) {
      const latestByLineage = new Map();
      for (const asset of filtered) {
        const current = latestByLineage.get(asset.lineageId);
        if (!current || asset.version > current.version) latestByLineage.set(asset.lineageId, asset);
      }
      assets = [...latestByLineage.values()];
    }
    assets = assets.slice().sort((a, b) => {
      const left = Date.parse(a.createdAt || '') || 0;
      const right = Date.parse(b.createdAt || '') || 0;
      if (right !== left) return right - left;
      return b.version - a.version;
    });
    const total = assets.length;
    return {assets: assets.slice(offset, offset + limit), total};
  }

  getAssetDetail(assetId) {
    const asset = this.getAssetOrThrow(assetId);
    const versions = this.state.assets
      .filter((item) => item.lineageId === asset.lineageId)
      .sort((a, b) => b.version - a.version);
    return {asset, versions};
  }

  assetStatusCounts() {
    return {
      total: this.state.assets.length,
      available: this.state.assets.filter((asset) => asset.status === 'available').length,
      pending: this.state.assets.filter((asset) => asset.status === 'pending').length,
      failed: this.state.assets.filter((asset) => asset.status === 'failed').length,
    };
  }
}
