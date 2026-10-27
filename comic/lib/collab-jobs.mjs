// 漫画服务协作执行适配层（B 端执行，协议 §7.1）。
// 复用现有 pump()/名额（generationSlots）/CodexBridge・JimengBridge，不复制生图链路：
//   POST /api/collab/generation        提交自包含协作生图任务 → 202 {jobId}
//   GET  /api/collab/generation/:jobId 查询任务状态与已校验结果
//   POST /api/collab/generation/:jobId/cancel 取消（复用现有任务取消机制）
// 协作任务与用户工程分开：job.kind='collab-generation'、projectId='collab'、工作目录 dataDir/collab/jobs/<jobId>，
// 完成后只登记图片资产，绝不修改任何工程画格。
import fs from 'node:fs';
import path from 'node:path';
import {check, ensureDir, inspectImageBuffer, nowIso, sha256, uid, writeJsonAtomic} from '../../协作/lib/protocol.mjs';
import {cleanId} from './store.mjs';
import {inspectImageFileAsync} from './image-files.mjs';

export const COLLAB_JOB_KIND = 'collab-generation';
export const COLLAB_PROVIDERS = Object.freeze(['codex', 'jimeng']);
export const COLLAB_JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
const COLLAB_JOBS_HISTORY_LIMIT = 2000;

const json = (response, status, value) => {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': body.length});
  response.end(body);
};

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 创建协作执行适配层。
 * 依赖均由 createStudio 闭包注入，保证与正常生图共用队列、名额和桥：
 *   store, dataDir, pump, updateJob, addAssetInfo, generatedAsset, getRunningOperation, isClosed
 */
export function createCollabJobs({store, dataDir, pump, updateJob, addAssetInfo, generatedAsset, getRunningOperation, isClosed = () => false}) {
  check(store && typeof store === 'object', '缺少工程数据存储', 500);
  check(typeof dataDir === 'string' && dataDir, '缺少漫画数据目录', 500);
  const jobsRoot = path.join(dataDir, 'collab', 'jobs');
  ensureDir(jobsRoot);

  // 服务重启时 Store 会把 queued/running 统一置为 failed；协作任务额外标记 interrupted，
  // 让节点明确知道「结果未知」，而不是普通生成失败。
  let recovered = 0;
  for (const job of store.db.jobs) {
    if (job.kind !== COLLAB_JOB_KIND) continue;
    if (job.status === 'failed' && !job.completedAt && ['queued', 'preparing', 'running', 'generating', 'uploading', 'verifying'].includes(job.phase)) {
      job.interrupted = true;
      job.lastPhase = job.phase;
      recovered++;
    }
  }
  if (recovered) store.save();

  // 清理 24 小时前的已完成协作任务（工作目录与记录），避免无限增长。
  function pruneHistory() {
    const now = Date.now();
    const stale = [];
    for (const job of store.db.jobs) {
      if (job.kind !== COLLAB_JOB_KIND) continue;
      if (!['done', 'failed', 'cancelled'].includes(job.status)) continue;
      const finished = Date.parse(job.completedAt || job.updated || 0);
      if (!Number.isFinite(finished) || now - finished <= COLLAB_JOB_RETENTION_MS) continue;
      stale.push(job);
    }
    if (!stale.length) return;
    const ids = new Set(stale.map(job => job.id));
    store.db.jobs = store.db.jobs.filter(job => !ids.has(job.id));
    for (const id of ids) {
      try { fs.rmSync(path.join(jobsRoot, id), {recursive: true, force: true}); } catch {}
    }
    store.save();
  }
  pruneHistory();
  let historyTimer = setInterval(pruneHistory, 60 * 60 * 1000);
  historyTimer.unref?.();

  function findJob(jobId) {
    const job = store.db.jobs.find(item => item.id === jobId && item.kind === COLLAB_JOB_KIND);
    check(job, '协作生成任务不存在（可能已超过 24 小时保留期）', 404);
    return job;
  }

  function publicResult(job) {
    const result = job.collabResult;
    if (!result) return null;
    return {
      filePath: result.filePath,
      sha256: result.sha256,
      size: result.size,
      mime: result.mime,
      width: result.width,
      height: result.height,
      assetId: result.assetId,
    };
  }

  function viewJob(job) {
    return {
      jobId: job.id,
      status: job.status,
      phase: job.phase || job.status,
      message: job.message || '',
      progress: Number.isFinite(job.progress) ? job.progress : null,
      result: publicResult(job),
      error: job.status === 'failed' ? (job.error || job.message || '协作生成失败') : null,
      startedAt: job.startedAt || null,
      completedAt: job.completedAt || null,
      interrupted: job.interrupted === true,
      taskId: job.collab?.taskId || null,
      attempt: Number.isInteger(job.collab?.attempt) ? job.collab.attempt : null,
      createdAt: job.created || null,
    };
  }

  // 参考图登记为本地 asset（路径资产），完全复用现有 addAssetInfo 的去重/校验逻辑。
  async function registerReferences(referenceFiles, referenceRoles) {
    const assets = [];
    for (let index = 0; index < referenceFiles.length; index++) {
      const file = referenceFiles[index];
      check(file && typeof file === 'object' && !Array.isArray(file), `第 ${index + 1} 个参考图格式无效`);
      const role = text(file.role, 40);
      const expectedRole = text(referenceRoles[index]?.role, 40);
      check(role, `第 ${index + 1} 个参考图缺少 role`);
      check(!expectedRole || expectedRole === role, `第 ${index + 1} 个参考图的 role 与 generationInput.referenceRoles 顺序不一致`);
      check(typeof file.filePath === 'string' && file.filePath.trim(), `第 ${index + 1} 个参考图缺少 filePath`);
      let info;
      try {
        info = await inspectImageFileAsync(file.filePath);
      } catch (error) {
        check(false, `第 ${index + 1} 个参考图无法读取：${error.message}`, 400);
      }
      const asset = addAssetInfo(info, text(file.name, 180) || text(referenceRoles[index]?.name, 180) || `协作参考图 ${index + 1}`, 'collab-reference');
      assets.push(asset);
    }
    return assets;
  }

  async function submit(body) {
    check(!isClosed(), '服务正在关闭，请稍后重试', 503);
    check(body && typeof body === 'object' && !Array.isArray(body), '协作生成请求格式无效');
    const taskId = text(body.taskId);
    check(taskId, '缺少 taskId');
    const attempt = Number(body.attempt);
    check(Number.isInteger(attempt) && attempt >= 1 && attempt <= 1000, 'attempt 必须是 1—1000 的整数');
    const provider = text(body.provider) || 'codex';
    check(COLLAB_PROVIDERS.includes(provider), `不支持的生成通道：${provider}（只支持 codex/jimeng）`);
    const generationInput = body.generationInput;
    check(generationInput && typeof generationInput === 'object' && !Array.isArray(generationInput), 'generationInput 必须是自包含的生成输入对象');
    const referenceFiles = body.referenceFiles === undefined ? [] : body.referenceFiles;
    check(Array.isArray(referenceFiles) && referenceFiles.length <= 60, 'referenceFiles 必须是 0—60 张参考图');
    const referenceRoles = generationInput.referenceRoles === undefined ? [] : generationInput.referenceRoles;
    check(Array.isArray(referenceRoles) && referenceRoles.length <= 60, 'generationInput.referenceRoles 必须是 0—60 条参考角色');
    check(referenceFiles.length === referenceRoles.length, `参考图数量（${referenceFiles.length}）与 generationInput.referenceRoles（${referenceRoles.length}）不一致`);
    const inputClone = jsonClone(generationInput);
    const referenceAssets = await registerReferences(referenceFiles, referenceRoles);
    // 重建 referenceRoles：把 A 端传来的 assetId 换成本机登记后的 assetId，顺序/角色/名称不变。
    inputClone.referenceRoles = referenceFiles.map((file, index) => ({
      ...referenceRoles[index],
      assetId: referenceAssets[index].id,
      name: text(file.name, 180) || text(referenceRoles[index]?.name, 180) || referenceAssets[index].name,
      role: text(file.role, 40) || text(referenceRoles[index]?.role, 40),
    }));
    for (const reference of inputClone.referenceRoles) store.asset(reference.assetId);

    const jobId = uid('job');
    const directory = path.join(jobsRoot, jobId);
    ensureDir(directory);
    const originProjectId = text(body.projectId || inputClone.projectId, 120);
    const originPanelId = text(body.panelId || inputClone.panel?.id, 120);
    const target = body.target && typeof body.target === 'object' && !Array.isArray(body.target) ? jsonClone(body.target) : null;
    const shot = inputClone.shot && typeof inputClone.shot === 'object' ? inputClone.shot : {};
    const job = {
      id: jobId,
      kind: COLLAB_JOB_KIND,
      provider,
      projectId: 'collab',
      panelId: '',
      shotId: text(shot.id, 120),
      shotCode: text(shot.code, 80) || '协作画格',
      shotTitle: text(shot.title, 180) || '协作生成',
      action: 'generate',
      status: 'queued',
      phase: 'queued',
      message: '协作任务已排队，等待生图名额',
      created: nowIso(),
      updated: nowIso(),
      collab: {
        taskId,
        attempt,
        projectId: originProjectId,
        panelId: originPanelId,
        target,
        provider,
        referenceFiles: referenceFiles.map((file, index) => ({
          role: inputClone.referenceRoles[index].role,
          name: inputClone.referenceRoles[index].name,
          assetId: referenceAssets[index].id,
          filePath: referenceAssets[index].filePath,
        })),
      },
      input: inputClone,
    };
    // 请求元数据单独落盘，供人工核对；正式生成输入仍由桥写入自己的目录。
    writeJsonAtomic(path.join(directory, 'collab-request.json'), {
      taskId,
      attempt,
      provider,
      projectId: originProjectId,
      panelId: originPanelId,
      target,
      receivedAt: job.created,
      references: job.collab.referenceFiles,
    });
    store.db.jobs.push(job);
    store.save();
    void pump();
    return {jobId, status: 'queued', taskId, attempt, createdAt: job.created};
  }

  function cancel(jobId) {
    const job = findJob(jobId);
    check(['queued', 'running', 'preparing', 'generating'].includes(job.status), '任务已结束，无法取消', 409);
    updateJob(job, {status: 'cancelled', phase: 'cancelled', completedAt: nowIso(), message: '任务已取消，协作结果不再登记'});
    const operation = getRunningOperation?.(job.id);
    operation?.controller?.abort?.();
    operation?.handle?.cancel?.();
    pump();
    return {ok: true, jobId: job.id, status: 'cancelled'};
  }

  /** executeJob 成功返回后调用：校验图片、登记资产、写 job done + collabResult；绝不触碰工程画格。 */
  function complete(job, result, {directory} = {}) {
    const finishedAt = nowIso();
    if (job.status === 'cancelled') {
      updateJob(job, {phase: 'cancelled', completedAt: finishedAt, message: '任务已取消，协作结果不再登记'});
      return null;
    }
    const hasAligned = !!(result?.alignedPath || (result?.alignedBytes && result.alignedBytes.length));
    const sourcePath = hasAligned ? result.alignedPath : result?.filePath;
    let bytes = null;
    if (hasAligned && result.alignedBytes) bytes = Buffer.from(result.alignedBytes);
    else if (result?.bytes) bytes = Buffer.from(result.bytes);
    else if (sourcePath) bytes = fs.readFileSync(sourcePath);
    check(bytes && bytes.length > 0, '生成结果没有可读取的图片文件，协作任务失败', 502);
    const info = inspectImageBuffer(bytes);
    check(info, '生成结果不是可识别的 PNG/JPEG/WebP 图片，协作任务失败（可能上传不完整）', 502);
    const asset = generatedAsset(result, directory, `${job.shotCode || '协作画格'} · 协作结果`, hasAligned ? 'collab-edit' : 'collab', {aligned: hasAligned});
    const finalPath = asset.filePath;
    const stat = fs.statSync(finalPath);
    const finalBytes = fs.readFileSync(finalPath);
    const finalSha256 = sha256(finalBytes);
    const finalInfo = inspectImageBuffer(finalBytes);
    check(finalInfo, '协作结果文件校验失败，已拒绝登记', 502);
    const collabResult = {
      filePath: finalPath,
      sha256: finalSha256,
      size: stat.size,
      mime: finalInfo.mime,
      width: finalInfo.width,
      height: finalInfo.height,
      assetId: asset.id,
      verifiedAt: finishedAt,
    };
    updateJob(job, {
      status: 'done',
      phase: 'done',
      assetId: asset.id,
      rawAssetId: asset.id,
      applied: false,
      completedAt: finishedAt,
      collabResult,
      message: `协作图片已生成并通过校验（${finalInfo.width}×${finalInfo.height}，${finalInfo.mime}）`,
    });
    return collabResult;
  }

  async function handle(request, response, {pathname, method}) {
    if (!pathname.startsWith('/api/collab/generation')) return false;
    if (method === 'POST' && pathname === '/api/collab/generation') {
      const payload = await readJsonBodyLimited(request);
      json(response, 202, await submit(payload));
      return true;
    }
    const match = pathname.match(/^\/api\/collab\/generation\/([a-z]+_[0-9a-f-]{36})(\/cancel)?$/);
    if (!match) return false;
    const jobId = cleanId(match[1]);
    if (method === 'GET' && !match[2]) return json(response, 200, viewJob(findJob(jobId))), true;
    if (method === 'POST' && match[2]) return json(response, 200, cancel(jobId)), true;
    return false;
  }

  return {
    jobsRoot,
    submit,
    cancel,
    complete,
    get: jobId => viewJob(findJob(cleanId(jobId))),
    viewJob,
    findJob,
    pruneHistory,
    handle,
    close() {
      if (historyTimer) clearInterval(historyTimer);
      historyTimer = null;
    },
    get closed() {
      return historyTimer === null;
    },
  };
}

async function readJsonBodyLimited(request, maxBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    check(total <= maxBytes, '协作生成请求超过大小限制', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    check(false, '协作生成请求不是有效 JSON');
  }
}
