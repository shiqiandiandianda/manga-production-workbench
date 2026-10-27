// 工作节点 · 本机漫画服务适配 + 本地 journal（开发/协作/lib/node-local.mjs）
// 只依赖 node: 内置模块与 ./protocol.mjs；零 npm 依赖。
//
// 职责：
//   1) 调用本机漫画服务（默认 http://127.0.0.1:18896）的固定接口：
//      POST /api/collab/generation、GET /api/collab/generation/:jobId、
//      POST /api/collab/generation/:jobId/cancel、GET /api/state、GET /api/health。
//   2) 从中控下载参考图（GET {hubUrl}/api/blobs/:sha256）到
//      dataDir/tasks/<taskId>/<attempt>/refs/。
//   3) 校验本机结果文件：存在 / 可读 / 大小 / sha256 + protocol.inspectImageBuffer 像素。
//   4) 原子读写节点 journal（dataDir/journal.json），供断线恢复与心跳上报。
//
// 安全约定：任务字段只作为数据处理，绝不参与命令拼接；只请求上述固定 URL；
//           不访问用户工程目录；日志不打印 token。
import fs from 'node:fs';
import path from 'node:path';
import {
  CollabError,
  check,
  ensureDir,
  inspectImageBuffer,
  nowIso,
  readJson,
  safeFileName,
  safeFileSegment,
  sha256,
  validateImageBuffer,
  writeJsonAtomic,
} from './protocol.mjs';

export const DEFAULT_LOCAL_ORIGIN = 'http://127.0.0.1:18896';
export const DEFAULT_PROVIDER = 'codex';
export const MAX_RESULT_BYTES = 64 * 1024 * 1024; // 协议：结果图 ≤64MB
export const MAX_BLOB_BYTES = 64 * 1024 * 1024;
export const LOCAL_REQUEST_TIMEOUT_MS = 20000;
export const LOCAL_QUERY_TIMEOUT_MS = 8000;
export const HUB_REQUEST_TIMEOUT_MS = 20000;

// journal 阶段与协议 §4.2 的 journal.stage 一致；done 只在本机短暂记录后清理。
export const JOURNAL_STAGES = Object.freeze([
  'claimed',
  'submitting',
  'submitted',
  'generating',
  'upload_failed',
  'result_ready',
  'done',
  'unknown',
]);

// ---------------------------------------------------------------------------
// 通用工具：取消 / 超时 / 中文错误（本机漫画服务与中控请求共用）
// ---------------------------------------------------------------------------
export function isAbortedError(error) {
  return Boolean(error && (error.code === 'aborted' || error.name === 'AbortError'));
}

export function describeError(error) {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  let text = String(error.message || error);
  const code = error.cause && error.cause.code;
  if (code && !text.includes(code)) text += `（${code}）`;
  if (error.status && !text.includes(`HTTP ${error.status}`)) text += `（HTTP ${error.status}）`;
  return text;
}

function abortedError() {
  return new CollabError('请求已取消（节点正在停止）', {status: 0, code: 'aborted'});
}

// 可被 AbortSignal 中断的等待；节点 stop() 时用来打断轮询退避，避免退出卡住。
export function sleep(ms, signal) {
  const delay = Math.max(0, Math.floor(Number(ms) || 0));
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(abortedError());
      return;
    }
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortedError());
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    if (signal) signal.addEventListener('abort', onAbort, {once: true});
  });
}

// 去掉 URL 里的查询串，避免把 ?token= 写进日志/错误。
function safeUrlText(url) {
  return String(url || '').split('?')[0];
}

function combineAbortSignals(signal, timeoutMs) {
  const signals = [];
  let timer = null;
  if (signal) signals.push(signal);
  if (timeoutMs > 0) {
    const timeoutController = new AbortController();
    timer = setTimeout(() => {
      const error = new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
      error.name = 'TimeoutError';
      timeoutController.abort(error);
    }, Math.round(timeoutMs));
    signals.push(timeoutController.signal);
  }
  const combined = signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  return {
    signal: combined,
    cleanup() {
      if (timer) clearTimeout(timer);
    },
  };
}

function mapRequestError(error, parentSignal) {
  const aborted = parentSignal && parentSignal.aborted;
  if (aborted) return abortedError();
  if (isAbortedError(error)) return abortedError();
  if (error && error.name === 'TimeoutError') {
    return new CollabError(String(error.message || '请求超时'), {status: 0, code: 'timeout'});
  }
  return new CollabError(`网络请求失败：${describeError(error)}`, {status: 0, code: 'network'});
}

// 发送 HTTP 请求并返回原始字节；统一映射超时/断线/停止为中文 CollabError。
export async function requestBuffer(url, options = {}) {
  const {
    method = 'GET',
    token = '',
    headers = {},
    body,
    signal,
    timeoutMs = LOCAL_REQUEST_TIMEOUT_MS,
    maxBytes = MAX_RESULT_BYTES,
  } = options;
  const combined = combineAbortSignals(signal, timeoutMs);
  const requestHeaders = {...headers};
  if (token) requestHeaders['x-collab-token'] = token;
  let status = 0;
  let response = null;
  try {
    let responseError = null;
    try {
      response = await fetch(url, {
        method,
        headers: requestHeaders,
        body,
        signal: combined.signal,
        redirect: 'error',
      });
    } catch (error) {
      responseError = error;
    }
    if (responseError) throw mapRequestError(responseError, signal);
    status = response.status;
    let arrayBuffer = null;
    try {
      arrayBuffer = await response.arrayBuffer();
    } catch (error) {
      throw mapRequestError(error, signal);
    }
    const buffer = Buffer.from(arrayBuffer);
    check(
      buffer.length <= maxBytes,
      `响应内容超过大小上限（${buffer.length} > ${maxBytes}）：${safeUrlText(url)}`,
      413,
      'response_too_large',
    );
    return {
      status,
      ok: response.ok,
      headers: response.headers,
      buffer,
      url: safeUrlText(url),
      method,
    };
  } catch (error) {
    if (error instanceof CollabError) throw error;
    throw mapRequestError(error, signal);
  } finally {
    combined.cleanup();
  }
}

export async function requestJson(url, options = {}) {
  const result = await requestBuffer(url, {...options, maxBytes: options.maxBytes || 4 * 1024 * 1024});
  let parsed = null;
  const text = result.buffer.toString('utf8');
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (result.ok) {
        throw new CollabError(`服务返回的不是有效 JSON：${result.method} ${result.url}`, {status: 0, code: 'invalid_json'});
      }
    }
  }
  if (!result.ok) {
    const statusText = result.status ? `HTTP ${result.status}` : '网络错误';
    const message = parsed && (parsed.error || parsed.message)
      ? String(parsed.error || parsed.message)
      : `服务返回 ${statusText}：${result.method} ${result.url}`;
    throw new CollabError(message, {
      status: result.status || 0,
      code: (parsed && parsed.code) || 'http_error',
      details: parsed,
    });
  }
  return {status: result.status, body: parsed, headers: result.headers};
}

// 供测试/诊断：只读 GET，失败返回空值而不抛错。
export async function tryRequestJson(url, options = {}) {
  try {
    return await requestJson(url, options);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 本机漫画服务地址规范
// ---------------------------------------------------------------------------
export function normalizeLocalOrigin(value, fallback = DEFAULT_LOCAL_ORIGIN) {
  const text = String(value ?? fallback ?? '').trim().replace(/\/+$/, '');
  check(/^https?:\/\/[^\s/]+$/i.test(text), `本机漫画服务地址无效：${value}（应为 http://127.0.0.1:端口）`, 400, 'invalid_local_origin');
  return text;
}

function normalizeAttemptNumber(attempt) {
  const value = Math.floor(Number(attempt));
  check(Number.isInteger(value) && value >= 1, `尝试次数无效：${attempt}`, 400, 'invalid_attempt');
  return value;
}

function readScheduler(state) {
  const scheduler = state && typeof state === 'object' && state.scheduler && typeof state.scheduler === 'object'
    ? state.scheduler
    : null;
  if (!scheduler) return null;
  const toCount = (value, fallback = 0) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.floor(number));
  };
  return {
    active: toCount(scheduler.active),
    queued: toCount(scheduler.queued),
    concurrency: toCount(scheduler.concurrency),
  };
}

// ---------------------------------------------------------------------------
// 本机漫画服务客户端（submit / query / cancel / 状态 / 健康）
// ---------------------------------------------------------------------------
export function createLocalComicClient(options = {}) {
  const origin = normalizeLocalOrigin(options.origin);
  const provider = String(options.provider || DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  const requestTimeoutMs = Number(options.requestTimeoutMs) > 0 ? Number(options.requestTimeoutMs) : LOCAL_REQUEST_TIMEOUT_MS;
  const log = (level, message) => {
    try {
      logger(level, `[本机漫画服务] ${message}`);
    } catch {
      // 日志失败不影响主流程
    }
  };

  async function submitGeneration({taskId, attempt, generationInput, referenceFiles = [], signal} = {}) {
    check(typeof taskId === 'string' && taskId.trim(), '提交本机生成缺少 taskId', 400, 'missing_task_id');
    const attemptNumber = normalizeAttemptNumber(attempt);
    check(generationInput && typeof generationInput === 'object' && !Array.isArray(generationInput), '提交本机生成缺少 generationInput 对象', 400, 'missing_generation_input');
    const body = {
      taskId: taskId.trim(),
      attempt: attemptNumber,
      provider,
      generationInput,
      referenceFiles: Array.isArray(referenceFiles) ? referenceFiles : [],
    };
    const result = await requestJson(`${origin}/api/collab/generation`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {'content-type': 'application/json; charset=utf-8'},
      signal,
      timeoutMs: requestTimeoutMs,
    });
    const jobId = result.body && result.body.jobId;
    check(typeof jobId === 'string' && jobId.trim(), '本机漫画服务没有返回 jobId', 502, 'local_bad_response');
    log('info', `已提交本机协作生成任务 ${taskId}（第 ${attemptNumber} 次尝试），jobId=${jobId.trim()}`);
    return {jobId: jobId.trim(), response: result.body};
  }

  async function queryGeneration(jobId, {signal, timeoutMs = LOCAL_QUERY_TIMEOUT_MS} = {}) {
    check(typeof jobId === 'string' && jobId.trim(), '查询本机任务缺少 jobId', 400, 'missing_job_id');
    const result = await requestJson(`${origin}/api/collab/generation/${encodeURIComponent(jobId.trim())}`, {
      signal,
      timeoutMs,
    });
    const job = result.body;
    check(job && typeof job === 'object', '本机漫画服务返回的任务状态无效', 502, 'local_bad_response');
    return job;
  }

  async function cancelGeneration(jobId, {signal, timeoutMs = LOCAL_QUERY_TIMEOUT_MS} = {}) {
    if (typeof jobId !== 'string' || !jobId.trim()) return {ok: false, reason: 'no_job_id'};
    try {
      const result = await requestJson(`${origin}/api/collab/generation/${encodeURIComponent(jobId.trim())}/cancel`, {
        method: 'POST',
        signal,
        timeoutMs,
      });
      log('info', `已请求本机取消协作生成任务 jobId=${jobId.trim()}`);
      return {ok: true, response: result.body};
    } catch (error) {
      // 本机任务可能已结束/已被清理，取消失败只记录，不阻塞恢复流程。
      if (error && (error.status === 404 || error.status === 409)) {
        log('debug', `本机任务 jobId=${jobId.trim()} 已不存在，无需取消`);
        return {ok: false, reason: 'already_gone'};
      }
      if (isAbortedError(error)) throw error;
      log('warn', `取消本机任务 jobId=${jobId.trim()} 失败：${describeError(error)}`);
      return {ok: false, reason: describeError(error)};
    }
  }

  async function readState({signal, timeoutMs = LOCAL_QUERY_TIMEOUT_MS} = {}) {
    // Capacity checks must not download whole projects, source prompts and images.
    const health = await requestJson(`${origin}/api/health`, {signal, timeoutMs});
    const generation = health.body?.generation;
    if (generation && Number.isFinite(Number(generation.concurrency))) {
      const scheduler = {active:Math.max(0,(Number(generation.running)||0)+(Number(generation.remoteUnknown)||0)),queued:Math.max(0,Number(generation.queued)||0),concurrency:Math.max(0,Number(generation.concurrency)||0)};
      return {origin,state:{scheduler},scheduler};
    }
    const result = await requestJson(`${origin}/api/state`, {signal, timeoutMs,maxBytes:32*1024*1024});
    const state = result.body && typeof result.body === 'object' ? result.body : {};
    return {origin, state, scheduler: readScheduler(state)};
  }

  async function readGenerationSettings({signal, timeoutMs = LOCAL_QUERY_TIMEOUT_MS} = {}) {
    const result = await requestJson(`${origin}/api/generation-settings`, {signal, timeoutMs});
    return result.body && typeof result.body === 'object' ? result.body : {};
  }

  async function readHealth({signal, timeoutMs = LOCAL_QUERY_TIMEOUT_MS} = {}) {
    const result = await requestJson(`${origin}/api/health`, {signal, timeoutMs});
    return result.body && typeof result.body === 'object' ? result.body : {};
  }

  // 下载参考图并校验；只允许 http(s) 中控地址与 /api/blobs/<sha256> 固定路径。
  async function downloadReferences({taskId, attempt, references = [], hubUrl, token = '', signal, maxBytes = MAX_BLOB_BYTES} = {}) {
    check(typeof taskId === 'string' && taskId.trim(), '下载参考图缺少 taskId', 400, 'missing_task_id');
    const attemptNumber = normalizeAttemptNumber(attempt);
    const hubBase = String(hubUrl || '').trim().replace(/\/+$/, '');
    check(/^https?:\/\/[^\s/]+$/i.test(hubBase), `中控地址无效，无法下载参考图：${hubUrl}`, 400, 'invalid_hub_url');
    const list = Array.isArray(references) ? references : [];
    const targetDir = path.join(
      checkDataDir(),
      'tasks',
      safeFileSegment(taskId, 'task'),
      String(attemptNumber),
      'refs',
    );
    ensureDir(targetDir);
    const files = [];
    for (let index = 0; index < list.length; index += 1) {
      const reference = list[index] && typeof list[index] === 'object' ? list[index] : {};
      const digest = String(reference.sha256 || '').trim().toLowerCase();
      check(/^[0-9a-f]{64}$/.test(digest), `参考图 sha256 无效（第 ${index + 1} 张）：${reference.sha256}`, 400, 'invalid_reference');
      const result = await requestBuffer(`${hubBase}/api/blobs/${digest}`, {
        token,
        signal,
        timeoutMs: HUB_REQUEST_TIMEOUT_MS,
        maxBytes,
      });
      if (!result.ok) {
        let detail = null;
        try {
          detail = JSON.parse(result.buffer.toString('utf8'));
        } catch {
          detail = null;
        }
        throw new CollabError(
          `下载参考图失败（${reference.name || digest.slice(0, 12)}）：${detail && (detail.error || detail.message) ? String(detail.error || detail.message) : `中控返回 HTTP ${result.status}`}`,
          {status: result.status, code: (detail && detail.code) || 'blob_download_failed'},
        );
      }
      const actual = sha256(result.buffer);
      check(
        actual === digest,
        `参考图内容校验失败（${reference.name || digest.slice(0, 12)}）：期望 ${digest.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…`,
        502,
        'reference_sha_mismatch',
      );
      if (Number.isFinite(Number(reference.size)) && Number(reference.size) > 0) {
        check(
          result.buffer.length === Number(reference.size),
          `参考图大小不一致（${reference.name || digest.slice(0, 12)}）：期望 ${reference.size}，实际 ${result.buffer.length}`,
          502,
          'reference_size_mismatch',
        );
      }
      const info = validateImageBuffer(result.buffer, {maxBytes});
      const fallbackName = `${reference.role || 'reference'}-${index + 1}${info.ext}`;
      let name = safeFileName(reference.name || fallbackName, fallbackName);
      if (!path.extname(name)) name = `${name}${info.ext}`;
      const filePath = path.join(targetDir, `${index + 1}-${name}`);
      fs.writeFileSync(filePath, result.buffer);
      files.push({
        role: String(reference.role || 'reference'),
        name: String(reference.name || name),
        filePath,
        sha256: actual,
        mime: info.mime,
        size: result.buffer.length,
      });
    }
    if (files.length > 0) log('info', `已下载 ${files.length} 张参考图到 ${targetDir}`);
    return files;
  }

  function checkDataDir() {
    const dataDir = String(options.dataDir || '').trim();
    check(dataDir, '本机漫画服务客户端缺少 dataDir', 500, 'missing_data_dir');
    return path.resolve(dataDir);
  }

  // 校验并读取本机结果文件：存在 / 可读 / 大小 / sha256 / 像素格式。
  async function readResultFile(result, {expectedSha256, maxBytes = MAX_RESULT_BYTES} = {}) {
    check(result && typeof result === 'object', '本机任务结果缺少 result 对象', 502, 'local_result_missing');
    const filePath = String(result.filePath || '').trim();
    check(filePath, '本机任务结果缺少 filePath', 502, 'local_result_missing');
    let stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch (error) {
      throw new CollabError(
        `本机结果文件不存在或不可读：${filePath}（${error && error.code ? error.code : describeError(error)}）`,
        {status: 502, code: 'local_result_unreadable'},
      );
    }
    check(stat.isFile(), `本机结果不是普通文件：${filePath}`, 502, 'local_result_unreadable');
    check(stat.size > 0, `本机结果文件为空：${filePath}`, 502, 'local_result_empty');
    check(stat.size <= maxBytes, `本机结果文件超过大小上限（${stat.size} > ${maxBytes}）`, 502, 'local_result_too_large');
    let buffer = null;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (error) {
      throw new CollabError(`本机结果文件读取失败：${filePath}（${describeError(error)}）`, {status: 502, code: 'local_result_unreadable'});
    }
    const actual = sha256(buffer);
    const expected = String(expectedSha256 || result.sha256 || '').trim().toLowerCase();
    if (expected) {
      check(
        actual === expected,
        `本机结果 sha256 校验失败：期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…`,
        502,
        'local_result_sha_mismatch',
      );
    }
    if (Number.isFinite(Number(result.size)) && Number(result.size) > 0) {
      check(
        buffer.length === Number(result.size),
        `本机结果大小不一致：期望 ${result.size}，实际 ${buffer.length}`,
        502,
        'local_result_size_mismatch',
      );
    }
    let info = null;
    try {
      info = validateImageBuffer(buffer, {maxBytes});
    } catch (error) {
      throw new CollabError(`本机结果不是有效的 PNG/JPEG/WebP 图片：${describeError(error)}`, {
        status: 502,
        code: 'local_result_invalid_image',
      });
    }
    return {
      buffer,
      filePath,
      sha256: actual,
      size: buffer.length,
      mime: info.mime,
      width: info.width,
      height: info.height,
    };
  }

  // 只读探测一张参考图是否真的是可识别图片（供测试/诊断）。
  function inspectImage(buffer) {
    return inspectImageBuffer(buffer);
  }

  return {
    origin,
    provider,
    submitGeneration,
    queryGeneration,
    cancelGeneration,
    readState,
    readGenerationSettings,
    readHealth,
    downloadReferences,
    readResultFile,
    inspectImage,
  };
}

// ---------------------------------------------------------------------------
// 本地 journal：dataDir/journal.json 原子读写
// 记录字段：taskId / attempt / stage / jobId / resultPath / sha256 / updatedAt（其余为恢复辅助信息）。
// ---------------------------------------------------------------------------
export function journalKey(taskId, attempt) {
  return `${String(taskId || '')}#${Math.floor(Number(attempt) || 0)}`;
}

// 心跳上报用的精简 journal 条目（协议 §4.2，不携带 generationInput/prompt 等大字段）。
export function journalEntryForHeartbeat(entry) {
  if (!entry) return null;
  return {
    taskId: entry.taskId,
    attempt: entry.attempt,
    stage: JOURNAL_STAGES.includes(entry.stage) ? entry.stage : 'unknown',
    hasResult: Boolean(entry.resultPath && entry.sha256),
    likelyGenerated: Boolean(entry.likelyGenerated),
  };
}

export function createJournal(options = {}) {
  const dataDir = String(options.dataDir || '').trim();
  check(dataDir, 'journal 缺少 dataDir', 500, 'missing_data_dir');
  const resolvedDataDir = path.resolve(dataDir);
  const filePath = path.join(resolvedDataDir, 'journal.json');
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  const log = (level, message) => {
    try {
      logger(level, `[journal] ${message}`);
    } catch {
      // 日志失败不影响主流程
    }
  };
  const entries = new Map();
  let loaded = false;

  function load() {
    let raw = null;
    try {
      raw = readJson(filePath, null);
    } catch (error) {
      throw new CollabError(
        `journal.json 无法解析，为避免丢失断线恢复记录已停止：${describeError(error)}`,
        {status: 500, code: 'journal_corrupt'},
      );
    }
    entries.clear();
    if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object') {
      for (const [entryKey, value] of Object.entries(raw.entries)) {
        if (!value || typeof value !== 'object') {
          log('warn', `已忽略 journal 中无效记录 ${entryKey}`);
          continue;
        }
        const taskId = String(value.taskId || '').trim();
        const attempt = Math.floor(Number(value.attempt));
        if (!taskId || !Number.isInteger(attempt) || attempt < 1) {
          log('warn', `已忽略 journal 中缺少 taskId/attempt 的记录 ${entryKey}`);
          continue;
        }
        const stage = JOURNAL_STAGES.includes(value.stage) ? value.stage : 'unknown';
        entries.set(journalKey(taskId, attempt), {...value, taskId, attempt, stage});
      }
    }
    loaded = true;
    return list();
  }

  function save() {
    ensureDir(resolvedDataDir);
    const payload = {
      version: 1,
      updatedAt: nowIso(),
      entries: Object.fromEntries([...entries.entries()].map(([entryKey, value]) => [entryKey, {...value}])),
    };
    writeJsonAtomic(filePath, payload);
  }

  function ensureLoaded() {
    if (!loaded) load();
  }

  function get(taskId, attempt) {
    ensureLoaded();
    const value = entries.get(journalKey(taskId, attempt));
    return value ? {...value} : null;
  }

  function upsert(taskId, attempt, patch = {}) {
    ensureLoaded();
    const id = String(taskId || '').trim();
    const attemptNumber = Math.floor(Number(attempt));
    check(id, 'journal 记录缺少 taskId', 500, 'journal_invalid');
    check(Number.isInteger(attemptNumber) && attemptNumber >= 1, `journal 记录 attempt 无效：${attempt}`, 500, 'journal_invalid');
    const key = journalKey(id, attemptNumber);
    const previous = entries.get(key) || {taskId: id, attempt: attemptNumber, createdAt: nowIso()};
    const stage = patch.stage ?? previous.stage ?? 'claimed';
    check(JOURNAL_STAGES.includes(stage), `journal 阶段无效：${stage}`, 500, 'journal_invalid');
    const next = {...previous, ...patch, taskId: id, attempt: attemptNumber, stage, updatedAt: nowIso()};
    entries.set(key, next);
    save();
    return {...next};
  }

  function remove(taskId, attempt) {
    ensureLoaded();
    const removed = entries.delete(journalKey(taskId, attempt));
    if (removed) save();
    return removed;
  }

  function list() {
    ensureLoaded();
    return [...entries.values()].map((value) => ({...value}));
  }

  function count() {
    ensureLoaded();
    return entries.size;
  }

  function clear() {
    ensureLoaded();
    if (entries.size > 0) {
      entries.clear();
      save();
    }
  }

  return {
    filePath,
    dataDir: resolvedDataDir,
    load,
    reload: load,
    get,
    upsert,
    remove,
    list,
    count,
    clear,
    save,
  };
}
