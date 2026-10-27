/**
 * 归档写入器：把一份资产写到所有启用位置（本机素材库 + 局域网存放电脑），
 * 主位置失败即整单失败；附加位置失败进入 outbox，后台按退避重试，
 * 绝不允许"悄悄没存上"。
 */
import path from 'node:path';
import {stat, readFile, unlink} from 'node:fs/promises';
import {atomicBytes, atomicJson, readJson, ensureDir, sha256, withRetry, safeName} from './store.mjs';
import {files} from './paths.mjs';
import {buildVariables, buildRelativePath, planTargets, joinDestination, displayPath} from './naming.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** 目录探活超时：网络共享掉线时不能把接单线程拖死。 */
const DESTINATION_PROBE_TIMEOUT_MS = 5000;

async function isReachable(root) {
  if (!root) return false;
  let timer;
  try {
    return await Promise.race([
      stat(root).then(info => info.isDirectory()).catch(error => (error.code === 'ENOENT' ? mkdirProbe(root) : false)),
      new Promise(resolve => {
        timer = setTimeout(() => resolve(false), DESTINATION_PROBE_TIMEOUT_MS);
        timer.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 目录还不存在时尝试建一次；失败说明不可写（例如 \\SERVER\Assets 未共享）。 */
async function mkdirProbe(root) {
  try {
    await ensureDir(root);
    return true;
  } catch {
    return false;
  }
}

/** 只解析头部，不解码整图；失败不报错，尺寸只是辅助信息。 */
export function readImageSize(bytes) {
  try {
    if (bytes.length > 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png'};
    }
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return {height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), format: 'jpeg'};
        }
        offset += 2 + length;
      }
    }
    if (bytes.length > 30 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
      const chunk = bytes.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8X') {
        const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return {width, height, format: 'webp'};
      }
      if (chunk === 'VP8 ') {
        return {width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, format: 'webp'};
      }
      if (chunk === 'VP8L') {
        const bits = bytes.readUInt32LE(21);
        return {width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp'};
      }
    }
  } catch {
    /* 尺寸信息尽力而为 */
  }
  return {width: null, height: null, format: ''};
}

export function sniffMime(bytes, extension, allowed) {
  // 调用方可能传 'png' 或 '.png'，这里统一成带点的形式。
  const ext = `.${String(extension || '').toLowerCase().replace(/^\./, '')}`;
  let mime = '';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) mime = 'image/png';
  else if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) mime = 'image/jpeg';
  else if (bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') mime = 'image/webp';
  else if (bytes.length > 6 && bytes.subarray(0, 6).toString('ascii').startsWith('GIF8')) mime = 'image/gif';
  else if (['.json'].includes(ext)) mime = 'application/json';
  else if (['.mp4', '.mov', '.webm'].includes(ext)) mime = 'video/mp4';
  // 纯文本没有魔数：只在扩展名声明是文本、且内容里没有控制字节时认账。
  if (!mime && ['.txt', '.md', '.csv'].includes(ext) && bytes.length && !bytes.includes(0)) {
    mime = 'text/plain';
  }
  if (!mime) throw Object.assign(new Error('无法识别的文件内容，已拒绝入库。'), {status: 415, code: 'content_unrecognized'});
  if (Array.isArray(allowed) && allowed.length && !allowed.includes(mime)) {
    throw Object.assign(new Error(`不允许的素材类型：${mime}。`), {status: 415, code: 'content_not_allowed'});
  }
  return mime;
}

export function createArchive({config, index, logger}) {
  let outbox = [];
  let outboxLoaded = false;
  let timer = null;
  let flushing = false;

  async function loadOutbox() {
    if (outboxLoaded) return;
    const raw = await readJson(files.outbox, {version: 1, items: []});
    outbox = Array.isArray(raw?.items) ? raw.items : [];
    outboxLoaded = true;
  }

  async function saveOutbox() {
    await atomicJson(files.outbox, {version: 1, updatedAt: new Date().toISOString(), items: outbox}, {backup: true});
  }

  async function stageBytes(source) {
    if (Buffer.isBuffer(source.bytes)) return source.bytes;
    if (source.sourcePath) {
      return await withRetry(() => readFile(source.sourcePath), {attempts: 4});
    }
    throw Object.assign(new Error('归档缺少内容：既没有 bytes 也没有 sourcePath。'), {status: 400, code: 'archive_no_content'});
  }

  /**
   * 归档一份资产。
   * input: {bytes|sourcePath, type, project, character, outfit, view, part, style, era, gender,
   *         version, tags, note, origin, jobId, clientRequestId, vendor, ext, vars, extra,
   *         destinations?: string[]  仅写指定位置（用于"只入本机库"这类需求）}
   */
  async function store(input) {
    const settings = await config.read();
    const bytes = await stageBytes(input);
    const digest = sha256(bytes);
    const extension = safeName(String(input.ext || path.extname(input.sourcePath || '') || 'png').replace(/^\./, ''), {max: 12, fallback: 'png'}).toLowerCase();
    const mime = sniffMime(bytes, extension, settings.mimeAllow);
    if (bytes.length > settings.maxUploadBytes) {
      throw Object.assign(new Error(`单个素材超过上限 ${Math.round(settings.maxUploadBytes / 1048576)} MB。`), {status: 413, code: 'content_too_large'});
    }
    const dimensions = readImageSize(bytes);
    const variables = buildVariables(
      {
        type: input.type || 'misc',
        project: input.project,
        character: input.character,
        outfit: input.outfit,
        view: input.view,
        part: input.part,
        style: input.style,
        era: input.era,
        gender: input.gender,
        ageStage: input.ageStage,
        version: input.version,
        index: input.index,
        jobId: input.jobId,
        scene: input.scene,
        canonicalKey: input.canonicalKey,
        chapter: input.chapter,
        ext: extension,
        vars: input.vars
      },
      {timeZone: settings.naming.timeZone}
    );
    const relative = buildRelativePath({template: settings.naming.template, variables, ext: extension});
    const destinations = input.destinations?.length
      ? settings.destinations.filter(entry => input.destinations.includes(entry.id))
      : settings.destinations;
    const plan = await planTargets({
      destinations,
      relative,
      policy: input.collision || settings.naming.collision,
      contentHash: digest
    });
    if (!plan) {
      return {skipped: true, reason: '目标文件已存在且冲突策略为 skip。', relative};
    }

    const copies = [];
    const failures = [];
    for (const target of plan.targets) {
      if (!target.writable) {
        copies.push({destinationId: target.destinationId, relativePath: plan.relative, path: displayPath(target.path)});
        continue;
      }
      // 先探活：网络共享掉线时 mkdir/写入会各自卡住数秒，先快速失败才能保住接单吞吐。
      const reachable = await isReachable(target.root);
      if (!reachable) {
        failures.push({
          destinationId: target.destinationId,
          label: target.label,
          relativePath: plan.relative,
          path: displayPath(target.path),
          message: `存储位置不可达（${target.root}）：网络共享可能未连接或权限不足。`,
          code: 'destination_unreachable'
        });
        continue;
      }
      try {
        await atomicBytes(target.path, bytes);
        const info = await stat(target.path).catch(() => null);
        copies.push({
          destinationId: target.destinationId,
          relativePath: plan.relative,
          path: displayPath(target.path),
          bytes: info?.size ?? bytes.length
        });
      } catch (error) {
        failures.push({destinationId: target.destinationId, label: target.label, relativePath: plan.relative, path: displayPath(target.path), message: error.message, code: error.code || ''});
      }
    }

    const primaryWritten = copies.some(copy => copy.destinationId === plan.primaryId);
    if (!primaryWritten) {
      const failure = failures.find(item => item.destinationId === plan.primaryId) || failures[0];
      throw Object.assign(new Error(`写入主存储位置失败：${failure?.message || '未知错误'}`), {
        status: 507,
        code: 'primary_write_failed',
        detail: failures
      });
    }

    const record = await index.add({
      relativePath: plan.relative,
      name: path.basename(plan.relative),
      extension,
      kind: input.type === 'scene' ? 'image' : undefined,
      type: input.type || 'misc',
      project: input.project || '',
      character: input.character || '',
      outfit: input.outfit || '',
      view: input.view || '',
      part: input.part || '',
      style: input.style || '',
      era: input.era || '',
      gender: input.gender || '',
      ageStage: input.ageStage || '',
      version: variables.version,
      tags: input.tags || [],
      note: input.note || '',
      sha256: digest,
      bytes: bytes.length,
      width: dimensions.width,
      height: dimensions.height,
      origin: input.origin || 'hub',
      jobId: input.jobId || '',
      clientRequestId: input.clientRequestId || '',
      vendor: input.vendor || '',
      extra: {...(input.extra || {}), mime},
      copies
    });

    if (failures.length) {
      await loadOutbox();
      for (const failure of failures) {
        outbox.push({
          id: `out_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
          assetId: record.assetId,
          destinationId: failure.destinationId,
          relativePath: failure.relativePath,
          path: failure.path,
          attempts: 0,
          nextAttemptAt: Date.now() + 5000,
          lastError: failure.message,
          createdAt: new Date().toISOString()
        });
      }
      await saveOutbox();
      logger?.warn('部分存储位置写入失败，已进入补写队列', {jobId: input.jobId, failures: failures.map(item => `${item.destinationId}:${item.code || item.message}`)});
    }

    return {asset: record, copies, failures, skipped: false};
  }

  async function retryOutboxOnce() {
    await loadOutbox();
    if (!outbox.length) return {retried: 0, remaining: 0};
    const now = Date.now();
    const pending = outbox.filter(item => (item.nextAttemptAt || 0) <= now);
    const keep = outbox.filter(item => (item.nextAttemptAt || 0) > now);
    outbox = keep;
    let retried = 0;
    for (const item of pending) {
      const record = index.get(item.assetId);
      if (!record) continue;
      const destination = (await config.read()).destinations.find(entry => entry.id === item.destinationId);
      if (!destination || !destination.enabled || destination.writable === false) continue;
      try {
        const localPath = (record.copies || []).find(copy => copy.destinationId === item.destinationId)?.path
          || (record.copies || [])[0]?.path;
        const bytes = await readFile(localPath || item.path);
        await atomicBytes(item.path, bytes);
        await index.updateCopy(record.assetId, item.destinationId, {relativePath: item.relativePath, path: item.path});
        retried += 1;
        logger?.info('补写成功', {assetId: record.assetId, destinationId: item.destinationId});
      } catch (error) {
        item.attempts = (item.attempts || 0) + 1;
        item.lastError = error.message;
        const delay = Math.min(30 * 60_000, 10_000 * 2 ** Math.min(item.attempts, 8));
        item.nextAttemptAt = Date.now() + delay;
        if (item.attempts <= 20) outbox.push(item);
        else logger?.error('补写放弃（超过 20 次）', {assetId: item.assetId, destinationId: item.destinationId, error: error.message});
      }
    }
    await saveOutbox();
    return {retried, remaining: outbox.length};
  }

  async function flushOutbox() {
    if (flushing) return {retried: 0, remaining: outbox.length};
    flushing = true;
    try {
      return await retryOutboxOnce();
    } finally {
      flushing = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      flushOutbox().catch(error => logger?.warn('补写队列执行失败', {error: error.message}));
    }, 60_000);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function pending() {
    await loadOutbox();
    return outbox.map(item => ({...item}));
  }

  /** 目录预检：给界面和启动自检用，避免第一单才发现共享不可写。 */
  async function checkDestinations() {
    const settings = await config.read();
    const results = [];
    for (const destination of settings.destinations) {
      const result = {id: destination.id, label: destination.label, path: destination.path, enabled: destination.enabled, role: destination.role};
      try {
        await ensureDir(destination.path);
        const probe = joinDestination(destination.path, `.workbench-write-probe-${Date.now()}`);
        await atomicBytes(probe, Buffer.from('ok'));
        await unlink(probe).catch(() => {});
        const info = await stat(destination.path);
        result.ok = true;
        result.writable = true;
        result.checkedAt = new Date().toISOString();
        result.exists = info.isDirectory();
      } catch (error) {
        result.ok = false;
        result.writable = false;
        result.error = error.message;
      }
      results.push(result);
    }
    return results;
  }

  return {store, start, stop, pending, flushOutbox, checkDestinations};
}
