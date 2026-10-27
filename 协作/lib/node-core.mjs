// 工作节点 · 主循环（开发/协作/lib/node-core.mjs）
// 只依赖 node: 内置模块与 ./protocol.mjs、./node-local.mjs；零 npm 依赖。
//
// 职责（协议 §6）：
//   心跳循环（带 journal / 名额）→ 处理中控裁决（断线恢复）→ 领取任务 →
//   下载参考图 → 提交本机漫画服务 → 轮询进度并上报 → 校验结果 → 上传中控（退避重传）→ 清理 journal。
//
// 安全约定：
//   - 只访问 hubUrl/api/* 与 localComic.origin/api/collab/* 固定 URL；
//   - prompt/参考图名等任务字段只作为 JSON 数据，绝不参与命令拼接；
//   - 只执行 allowedTaskTypes / allowedProjectIds 白名单内的任务；
//   - 日志不打印 token。
import os from 'node:os';
import path from 'node:path';
import {
  CollabError,
  NODE_APPLICATION,
  NODE_VERSION,
  PROTOCOL_VERSION,
  TASK_TYPES,
  check,
  clampInteger,
  ensureDir,
  nowIso,
  normalizeOrigin,
  readJson,
  safeFileSegment,
  validateTaskShape,
} from './protocol.mjs';
import {
  DEFAULT_LOCAL_ORIGIN,
  DEFAULT_PROVIDER,
  createJournal,
  createLocalComicClient,
  describeError,
  isAbortedError,
  journalEntryForHeartbeat,
  normalizeLocalOrigin,
  requestJson,
  sleep,
} from './node-local.mjs';

export const NODE_CONFIG_DEFAULTS = Object.freeze({
  hubUrl: '',
  token: '',
  nodeName: '',
  dataDir: '',
  localComic: Object.freeze({origin: DEFAULT_LOCAL_ORIGIN, provider: DEFAULT_PROVIDER}),
  maxConcurrency: 2,
  enabled: true,
  paused: false,
  allowedProjectIds: Object.freeze([]),
  allowedTaskTypes: Object.freeze([...TASK_TYPES]),
  heartbeatMs: 3000,
  pollMs: 1200,
  uploadRetries: 6,
  taskTimeoutMs: 30 * 60 * 1000,
  uploadBackoffMs: 400,
  hubTimeoutMs: 15000,
  autoHeartbeat: true,
});

// ---------------------------------------------------------------------------
// 配置加载 / 规范化 / 配对
// ---------------------------------------------------------------------------
export function resolveDataDir(value, baseDir = process.cwd()) {
  const text = String(value || '').trim();
  check(text, '节点配置缺少 dataDir', 400, 'missing_data_dir');
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(baseDir, text);
}

// allowedTaskTypes：未配置时默认允许协议全部类型；显式配置后按列表筛选（空列表=拒绝全部）。
// allowedProjectIds：空列表=不限制项目；非空=只执行这些项目（协议 §6）。
export function normalizeNodeConfig(raw = {}, context = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const configDir = path.resolve(context.configDir || process.cwd());
  const hubUrl = normalizeOrigin(source.hubUrl || '');
  const token = String(source.token || '').trim();
  check(token, '节点配置缺少 token，请先运行 pair 配对命令取得 token', 400, 'missing_token');

  const nodeName = String(source.nodeName || '').trim() || os.hostname();
  const configuredDataDir = context.dataDir || source.dataDir || path.join('节点数据', `节点-${safeFileSegment(nodeName, 'node')}`);
  const dataDir = resolveDataDir(configuredDataDir, configDir);

  const localComicSource = source.localComic && typeof source.localComic === 'object' ? source.localComic : {};
  const localComic = {
    origin: normalizeLocalOrigin(localComicSource.origin || source.localOrigin || DEFAULT_LOCAL_ORIGIN),
    provider: String(localComicSource.provider || source.provider || DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER,
  };

  let allowedProjectIds = [];
  if (Array.isArray(source.allowedProjectIds)) {
    allowedProjectIds = [...new Set(source.allowedProjectIds.map((item) => String(item || '').trim()).filter(Boolean))];
  }

  let allowedTaskTypes = [...TASK_TYPES];
  if (source.allowedTaskTypes !== undefined && source.allowedTaskTypes !== null) {
    const rawTypes = Array.isArray(source.allowedTaskTypes) ? source.allowedTaskTypes : [];
    allowedTaskTypes = [...new Set(rawTypes.map((item) => String(item || '').trim()).filter((item) => TASK_TYPES.includes(item)))];
  }

  return {
    hubUrl,
    token,
    nodeName,
    dataDir,
    localComic,
    maxConcurrency: clampInteger(source.maxConcurrency, 1, 8, NODE_CONFIG_DEFAULTS.maxConcurrency),
    enabled: source.enabled !== false,
    paused: source.paused === true,
    allowedProjectIds,
    allowedTaskTypes,
    heartbeatMs: clampInteger(source.heartbeatMs, 20, 60000, NODE_CONFIG_DEFAULTS.heartbeatMs),
    pollMs: clampInteger(source.pollMs, 10, 30000, NODE_CONFIG_DEFAULTS.pollMs),
    uploadRetries: clampInteger(source.uploadRetries, 0, 20, NODE_CONFIG_DEFAULTS.uploadRetries),
    taskTimeoutMs: clampInteger(source.taskTimeoutMs, 5000, 24 * 60 * 60 * 1000, NODE_CONFIG_DEFAULTS.taskTimeoutMs),
    uploadBackoffMs: clampInteger(source.uploadBackoffMs, 0, 60000, NODE_CONFIG_DEFAULTS.uploadBackoffMs),
    hubTimeoutMs: clampInteger(source.hubTimeoutMs, 1000, 120000, NODE_CONFIG_DEFAULTS.hubTimeoutMs),
    autoHeartbeat: source.autoHeartbeat !== false,
  };
}

// 读取节点配置文件（dataDir 等相对路径按配置文件所在目录解析）。
export function loadNodeConfig(configFile, options = {}) {
  const filePath = path.resolve(String(configFile || '').trim());
  check(String(configFile || '').trim(), '缺少节点配置文件（--config）', 400, 'missing_config_file');
  let raw = null;
  try {
    raw = readJson(filePath, null);
  } catch (error) {
    throw new CollabError(`节点配置文件不是有效 JSON：${filePath}（${describeError(error)}）`, {
      status: 400,
      code: 'invalid_config',
    });
  }
  if (!raw || typeof raw !== 'object') {
    throw new CollabError(`找不到节点配置文件或内容为空：${filePath}`, {status: 400, code: 'missing_config_file'});
  }
  return normalizeNodeConfig(raw, {configDir: path.dirname(filePath), dataDir: options.dataDir});
}

// 不包含 token 的配置摘要（日志/--check 使用）。
export function describeNodeConfig(config) {
  return [
    `中控地址：${config.hubUrl}`,
    `节点名称：${config.nodeName}`,
    `数据目录：${config.dataDir}`,
    `本机漫画服务：${config.localComic.origin}（provider=${config.localComic.provider}）`,
    `最多同时执行：${config.maxConcurrency}`,
    `允许任务类型：${config.allowedTaskTypes.length ? config.allowedTaskTypes.join('、') : '（无，拒绝全部）'}`,
    `允许项目：${config.allowedProjectIds.length ? config.allowedProjectIds.join('、') : '不限制'}`,
    `心跳/轮询：${config.heartbeatMs}ms / ${config.pollMs}ms，上传重试 ${config.uploadRetries} 次`,
  ];
}

// 配对：调中控 POST /api/pair（role=node）换取 token，不写配置文件（由 CLI 决定落盘位置）。
export async function pairNode({hubUrl, code, name, platform, version, timeoutMs = 15000, signal} = {}) {
  const origin = normalizeOrigin(hubUrl || '');
  const pairingCode = String(code || '').trim();
  check(pairingCode, '缺少配对码（--code）', 400, 'missing_pairing_code');
  const nodeName = String(name || '').trim() || os.hostname();
  let response = null;
  try {
    response = await requestJson(`${origin}/api/pair`, {
      method: 'POST',
      headers: {'content-type': 'application/json; charset=utf-8'},
      body: JSON.stringify({
        pairingCode,
        role: 'node',
        name: nodeName,
        platform: platform || process.platform,
        version: version || NODE_VERSION,
      }),
      signal,
      timeoutMs,
    });
  } catch (error) {
    if (error && error.status === 401) {
      throw new CollabError('配对码错误或已失效，请确认中控终端/控制台显示的当前配对码', {
        status: 401,
        code: 'pair_rejected',
      });
    }
    throw error;
  }
  const data = response.body && typeof response.body === 'object' ? response.body : {};
  check(typeof data.token === 'string' && data.token.trim(), '中控没有返回节点 token，配对失败', 502, 'pair_bad_response');
  return {
    hubUrl: origin,
    token: data.token.trim(),
    clientId: data.clientId || null,
    nodeId: data.nodeId || null,
    role: data.role || 'node',
    hubId: data.hubId || null,
    hubName: data.hubName || null,
    protocolVersion: data.protocolVersion || null,
    nodeName,
  };
}

// ---------------------------------------------------------------------------
// 日志适配：统一为 (level, message)；token 永不进入日志。
// ---------------------------------------------------------------------------
function makeLogSink(logger, token = '') {
  const secret = String(token || '');
  const sanitize = (message) => {
    let text = String(message ?? '');
    if (secret && secret.length >= 4) text = text.split(secret).join('***');
    return text;
  };
  if (typeof logger === 'function') {
    return (level, message) => {
      try {
        logger(level, sanitize(message));
      } catch {
        // 日志失败不影响主流程
      }
    };
  }
  if (logger && typeof logger === 'object') {
    return (level, message) => {
      try {
        const write = logger[level] || logger.log;
        if (typeof write === 'function') write.call(logger, sanitize(message));
      } catch {
        // 日志失败不影响主流程
      }
    };
  }
  return (level, message) => {
    if (level === 'debug') return;
    const text = `[节点] ${sanitize(message)}`;
    try {
      if (level === 'error') console.error(text);
      else if (level === 'warn') console.warn(text);
      else console.log(text);
    } catch {
      // 控制台不可用时忽略
    }
  };
}

function sanitizeReferences(references) {
  if (!Array.isArray(references)) return [];
  return references.map((reference) => {
    const item = reference && typeof reference === 'object' ? reference : {};
    return {
      role: String(item.role || 'reference'),
      name: String(item.name || ''),
      sha256: String(item.sha256 || ''),
      mime: String(item.mime || ''),
      size: Number(item.size) || 0,
    };
  });
}

function clipText(value, maxLength = 300) {
  const text = String(value ?? '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

// 名额公式（协议 §6）：max(0, min(设置上限 - 本机协作在跑数, 本机并发 - 本机已活跃))
export function computeFreeSlots({settings, runningCount = 0, local = {}} = {}) {
  const maxConcurrency = clampInteger(settings && settings.maxConcurrency, 1, 8, NODE_CONFIG_DEFAULTS.maxConcurrency);
  const running = Math.max(0, Math.floor(Number(runningCount) || 0));
  const localConcurrency = Math.max(0, Math.floor(Number(local.concurrency) || 0));
  const localActive = Math.max(0, Math.floor(Number(local.active) || 0))+Math.max(0,Math.floor(Number(local.queued)||0));
  const localFree = Math.max(0, localConcurrency - localActive);
  return Math.max(0, Math.min(maxConcurrency - running, localFree));
}

// ---------------------------------------------------------------------------
// 节点代理
// ---------------------------------------------------------------------------
class NodeAgent {
  constructor(options = {}) {
    const rawConfig = options.config && typeof options.config === 'object' ? options.config : options;
    // 允许注入 config 的超集（含 logger 等运行期字段），normalize 只取协议字段。
    this.config = normalizeNodeConfig(rawConfig, {dataDir: rawConfig.dataDir, configDir: process.cwd()});
    this.log = makeLogSink(options.logger ?? rawConfig.logger, this.config.token);
    this.local = options.localComicClient || createLocalComicClient({
      origin: this.config.localComic.origin,
      provider: this.config.localComic.provider,
      dataDir: this.config.dataDir,
      logger: this.log,
    });
    this.journal = options.journal || createJournal({dataDir: this.config.dataDir, logger: this.log});
    this.state = {
      running: false,
      stopping: false,
      revoked: false,
      startedAt: null,
      settings: {
        enabled: this.config.enabled,
        paused: this.config.paused,
        maxConcurrency: this.config.maxConcurrency,
      },
      executions: new Map(), // taskId -> {attempt, controller, startedAt, promise}
      heartbeatTimer: null,
      heartbeatCount: 0,
      lastHeartbeatAt: null,
      lastError: null,
      lastLocal: {active: 0, queued: 0, concurrency: 0, origin: this.config.localComic.origin, available: false},
      lastLocalError: null,
      freeSlots: 0,
    };
    this._heartbeatController = null;
  }

  // ------------------------------ 生命周期 ------------------------------
  async start() {
    if (this.state.running) return this.status();
    ensureDir(this.config.dataDir);
    this.journal.load();
    this.state.running = true;
    this.state.stopping = false;
    this.state.revoked = false;
    this.state.startedAt = nowIso();
    this.log('info', `节点「${this.config.nodeName}」启动：中控 ${this.config.hubUrl}，本机漫画服务 ${this.config.localComic.origin}`);
    const pending = this.journal.list();
    if (pending.length > 0) {
      this.log('info', `加载到 ${pending.length} 条未完成 journal 记录，将在心跳中上报等待中控裁决`);
    }
    if (this.config.autoHeartbeat) this._scheduleHeartbeat(0);
    return this.status();
  }

  async stop() {
    if (!this.state.running && !this.state.stopping) {
      this._clearHeartbeatTimer();
      return;
    }
    if (this.state.stopping) {
      await this._waitForExecutions();
      return;
    }
    this.state.stopping = true;
    this.log('info', '节点正在停止：清理定时器并中断在途请求…');
    this._clearHeartbeatTimer();
    if (this._heartbeatController) {
      try {
        this._heartbeatController.abort();
      } catch {
        // 忽略
      }
    }
    for (const record of this.state.executions.values()) {
      try {
        record.controller.abort();
      } catch {
        // 忽略
      }
    }
    await this._waitForExecutions();
    this.state.running = false;
    this.state.stopping = false;
    this.state.startedAt = null;
    this.log('info', '节点已停止，未完成任务已保留在 journal 中等待下次启动恢复');
  }

  status() {
    let journal = [];
    try {
      journal = this.journal.list().map((entry) => ({
        taskId: entry.taskId,
        attempt: entry.attempt,
        stage: entry.stage,
        jobId: entry.jobId || null,
        hasResult: Boolean(entry.resultPath && entry.sha256),
        likelyGenerated: Boolean(entry.likelyGenerated),
        updatedAt: entry.updatedAt || null,
      }));
    } catch {
      journal = [];
    }
    return {
      application: NODE_APPLICATION,
      version: NODE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      running: this.state.running,
      nodeName: this.config.nodeName,
      hubUrl: this.config.hubUrl,
      dataDir: this.config.dataDir,
      localOrigin: this.config.localComic.origin,
      settings: {...this.state.settings},
      revoked: this.state.revoked,
      freeSlots: this.state.freeSlots,
      heartbeatCount: this.state.heartbeatCount,
      lastHeartbeatAt: this.state.lastHeartbeatAt,
      lastError: this.state.lastError,
      startedAt: this.state.startedAt,
      runningTasks: [...this.state.executions.values()].map((record) => ({
        taskId: record.taskId,
        attempt: record.attempt,
        startedAt: record.startedAt,
      })),
      local: {...this.state.lastLocal},
      journal,
    };
  }

  _clearHeartbeatTimer() {
    if (this.state.heartbeatTimer) {
      clearTimeout(this.state.heartbeatTimer);
      this.state.heartbeatTimer = null;
    }
  }

  _scheduleHeartbeat(delayMs) {
    this._clearHeartbeatTimer();
    const delay = Math.max(0, Math.floor(Number(delayMs) || 0));
    this.state.heartbeatTimer = setTimeout(() => {
      this.state.heartbeatTimer = null;
      this._heartbeatTick();
    }, delay);
  }

  async _heartbeatTick() {
    if (!this.state.running || this.state.stopping || this.state.revoked) return;
    try {
      await this.heartbeatOnce();
    } catch (error) {
      if (isAbortedError(error) && (this.state.stopping || !this.state.running)) return;
      const message = describeError(error);
      this.state.lastError = message;
      this.log('error', `心跳失败：${message}`);
      if (error && (error.status === 401 || error.status === 403)) {
        this.state.revoked = true;
        this.state.lastError = '节点凭证被中控拒绝（可能已被吊销），已停止心跳';
        this.log('error', this.state.lastError);
        return;
      }
    }
    if (this.state.running && !this.state.stopping && !this.state.revoked) {
      this._scheduleHeartbeat(this.config.heartbeatMs);
    }
  }

  async _waitForExecutions() {
    const records = [...this.state.executions.values()];
    if (records.length === 0) return;
    await Promise.allSettled(records.map((record) => record.promise));
  }

  // 注册一个本机执行（同步占位，保证并发/名额/重复派单判断是原子的）。
  _startExecution(taskId, attempt, runner) {
    if (this.state.executions.has(taskId)) return false;
    const controller = new AbortController();
    const record = {taskId, attempt, controller, startedAt: nowIso(), promise: null};
    record.promise = Promise.resolve()
      .then(() => runner(controller.signal))
      .catch((error) => {
        if (isAbortedError(error) || this.state.stopping) {
          this.log('debug', `任务 ${taskId} 执行被中断，journal 保留待恢复`);
          return;
        }
        this.log('error', `任务 ${taskId}（第 ${attempt} 次尝试）执行异常：${describeError(error)}`);
        this.state.lastError = describeError(error);
      })
      .finally(() => {
        if (this.state.executions.get(taskId) === record) this.state.executions.delete(taskId);
      });
    record.promise.catch(() => {});
    this.state.executions.set(taskId, record);
    return true;
  }

  // ------------------------------ 心跳 ------------------------------
  async heartbeatOnce() {
    if (!this.state.running) throw new CollabError('节点尚未启动，无法执行心跳', 409, 'not_running');
    if (this.state.revoked) throw new CollabError('节点已被中控吊销，不再发送心跳', 403, 'node_revoked');
    const controller = new AbortController();
    this._heartbeatController = controller;
    const signal = controller.signal;
    try {
      const localSnapshot = await this._readLocalSnapshot(signal);
      const settings = {...this.state.settings};
      const pausedOrDisabled = !settings.enabled || settings.paused;
      const runningCount = this.state.executions.size;
      const freeSlots = pausedOrDisabled ? 0 : computeFreeSlots({settings, runningCount, local: localSnapshot});
      this.state.freeSlots = freeSlots;
      const journalEntries = this.journal
        .list()
        .filter((entry) => entry.stage !== 'done')
        .map((entry) => journalEntryForHeartbeat(entry))
        .filter(Boolean);
      const body = {
        running: [...this.state.executions.keys()],
        freeSlots,
        local: {
          active: localSnapshot.active,
          queued: localSnapshot.queued,
          concurrency: localSnapshot.concurrency,
          origin: this.config.localComic.origin,
          available: this.state.lastLocal?.available!==false,
        },
        message: this.state.lastLocalError||'',
        capabilities: {
          volunteerVersion:1,
          allowedProjectIds:this.config.allowedProjectIds,
          allowedTaskTypes:this.config.allowedTaskTypes,
          providers: [this.config.localComic.provider],
          version: NODE_VERSION,
          platform: process.platform,
        },
        journal: journalEntries,
      };
      const result = await requestJson(`${this.config.hubUrl}/api/node/heartbeat`, {
        method: 'POST',
        token: this.config.token,
        headers: {'content-type': 'application/json; charset=utf-8'},
        body: JSON.stringify(body),
        signal,
        timeoutMs: this.config.hubTimeoutMs,
      });
      const response = result.body && typeof result.body === 'object' ? result.body : {};
      this.state.heartbeatCount += 1;
      this.state.lastHeartbeatAt = nowIso();
      this.state.lastError = null;
      this._applyHubSettings(response.settings);
      if (response.revoked === true) {
        this.state.revoked = true;
        this.log('error', '中控已吊销本节点：停止领单并结束心跳，请在中控重新配对');
        return response;
      }
      this._logNotifications(response.notifications);
      await this._processDispositions(response.dispositions, signal);
      await this._acceptAssignments(response.assignments, signal);
      return response;
    } catch (error) {
      this.state.lastError = describeError(error);
      throw error;
    } finally {
      if (this._heartbeatController === controller) this._heartbeatController = null;
    }
  }

  async _readLocalSnapshot(signal) {
    const origin = this.config.localComic.origin;
    try {
      const result = await this.local.readState({signal});
      let scheduler = result.scheduler;
      if (!scheduler) {
        // 兼容：旧版 /api/state 没有 scheduler 时，从 /api/generation-settings 读取总并发。
        let concurrency = 0;
        try {
          const generationSettings = await this.local.readGenerationSettings({signal});
          concurrency = Number(
            generationSettings.totalConcurrency
            ?? generationSettings.sharedLimit
            ?? (generationSettings.platforms && generationSettings.platforms.main),
          ) || 0;
        } catch (fallbackError) {
          if (isAbortedError(fallbackError)) throw fallbackError;
        }
        scheduler = {active: 0, queued: 0, concurrency: Math.max(0, Math.floor(concurrency))};
      }
      this.state.lastLocal = {
        active: scheduler.active,
        queued: scheduler.queued,
        concurrency: scheduler.concurrency,
        origin,
        available: true,
      };
      this.state.lastLocalError = null;
      return scheduler;
    } catch (error) {
      if (isAbortedError(error)) throw error;
      this.state.lastLocal = {active: 0, queued: 0, concurrency: 0, origin, available: false};
      const message = `无法读取本机漫画服务状态（${origin}）：${describeError(error)}，本轮不领单`;
      if (this.state.lastLocalError !== message) {
        this.log('warn', message);
        this.state.lastLocalError = message;
      }
      return {active: 0, queued: 0, concurrency: 0};
    }
  }

  _applyHubSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    const previous = {...this.state.settings};
    if (typeof settings.enabled === 'boolean') this.state.settings.enabled = settings.enabled;
    if (typeof settings.paused === 'boolean') this.state.settings.paused = settings.paused;
    if (settings.maxConcurrency !== undefined) {
      this.state.settings.maxConcurrency = clampInteger(settings.maxConcurrency, 1, 8, previous.maxConcurrency);
    }
    const changed = previous.enabled !== this.state.settings.enabled
      || previous.paused !== this.state.settings.paused
      || previous.maxConcurrency !== this.state.settings.maxConcurrency;
    if (changed) {
      this.log(
        'info',
        `中控已更新节点设置：启用=${this.state.settings.enabled ? '是' : '否'}，暂停=${this.state.settings.paused ? '是' : '否'}，并发上限=${this.state.settings.maxConcurrency}`,
      );
    }
  }

  _logNotifications(notifications) {
    if (!Array.isArray(notifications)) return;
    for (const raw of notifications) {
      const notification = raw && typeof raw === 'object' ? raw : {};
      const level = notification.level === 'error' ? 'error' : notification.level === 'warn' ? 'warn' : 'info';
      const title = clipText(notification.title || notification.type || '中控通知', 120);
      const bodyText = notification.body ? `：${clipText(notification.body, 200)}` : '';
      this.log(level, `中控通知[${notification.type || 'info'}] ${title}${bodyText}`);
    }
  }

  // ------------------------------ 中控裁决（断线恢复） ------------------------------
  async _processDispositions(dispositions, signal) {
    if (!Array.isArray(dispositions) || dispositions.length === 0) return;
    for (const raw of dispositions) {
      const disposition = raw && typeof raw === 'object' ? raw : {};
      const taskId = String(disposition.taskId || '').trim();
      const attempt = Math.floor(Number(disposition.attempt));
      const kind = String(disposition.disposition || '').trim();
      if (!taskId || !Number.isInteger(attempt) || attempt < 1 || !kind) {
        this.log('warn', '收到无效的中控裁决记录（缺少 taskId/attempt/disposition），已忽略');
        continue;
      }
      const entry = this.journal.get(taskId, attempt);
      const extra = disposition.message ? `：${clipText(disposition.message, 160)}` : '';
      this.log('info', `中控裁决任务 ${taskId}（第 ${attempt} 次尝试）：${kind}${extra}`);
      if (this.state.executions.has(taskId)) {
        this.log('debug', `任务 ${taskId} 正在本机执行，忽略重复裁决`);
        continue;
      }
      switch (kind) {
        case 'done':
          this.journal.remove(taskId, attempt);
          break;
        case 'late':
          this._startExecution(taskId, attempt, (execSignal) => this._handleLateResult(taskId, attempt, execSignal));
          break;
        case 'abandoned':
          this._startExecution(taskId, attempt, (execSignal) => this._handleAbandoned(entry, execSignal));
          break;
        case 'keep':
          if (!entry) {
            this.log('warn', `中控要求继续任务 ${taskId}，但本机没有对应 journal 记录，等待重新派单`);
            break;
          }
          this._startExecution(taskId, attempt, (execSignal) => this._resumeKeptTask(entry, execSignal));
          break;
        case 'verify':
          if (!entry) {
            await this._reportVerifySafe(taskId, attempt, 'no_result', '本机没有对应 journal 记录', signal);
            break;
          }
          this._startExecution(taskId, attempt, (execSignal) => this._resumeVerify(entry, execSignal));
          break;
        case 'retry_upload':
          if (!entry) {
            this.log('warn', `中控要求重传任务 ${taskId}，但本机没有对应 journal 记录`);
            break;
          }
          this._startExecution(taskId, attempt, (execSignal) => this._resumeUpload(entry, execSignal));
          break;
        default:
          this.log('warn', `未知的中控裁决：${kind}（任务 ${taskId}），已忽略`);
          break;
      }
    }
  }

  // ------------------------------ 领取任务 ------------------------------
  async _acceptAssignments(assignments, signal) {
    if (!Array.isArray(assignments) || assignments.length === 0) return;
    for (const raw of assignments) {
      const assignment = raw && typeof raw === 'object' ? raw : {};
      const taskId = String(assignment.taskId || '').trim();
      const attempt = Math.floor(Number(assignment.attempt));
      if (!taskId || !Number.isInteger(attempt) || attempt < 1) {
        this.log('warn', '收到无效任务派单（缺少 taskId/attempt），已忽略');
        continue;
      }
      const settings = this.state.settings;
      if (!settings.enabled || settings.paused&&assignment.manualHelp!==true) {
        this.log('info', `节点处于${settings.paused ? '暂停' : '禁用'}状态，暂不领取任务 ${taskId}（租约到期后由中控重派）`);
        continue;
      }
      if (this.state.executions.has(taskId)) {
        this.log('debug', `任务 ${taskId} 已在执行，忽略重复派单`);
        continue;
      }
      if (!this.state.lastLocal.available) {
        this.log('warn', `本机漫画服务状态不可用，暂不领取任务 ${taskId}（等待服务恢复）`);
        continue;
      }
      if (this.state.executions.size >= settings.maxConcurrency) {
        this.log('info', `本机协作任务已满（${this.state.executions.size}/${settings.maxConcurrency}），暂不领取任务 ${taskId}`);
        continue;
      }
      const payload = assignment.payload && typeof assignment.payload === 'object' ? assignment.payload : {};
      const references = Array.isArray(assignment.references) ? assignment.references : [];
      const rejectReason = this._assignmentRejectReason(payload, references);
      if (rejectReason) {
        this.log('warn', `拒绝执行任务 ${taskId}：${rejectReason}`);
        await this._reportFailSafe(taskId, attempt, rejectReason, false, signal);
        continue;
      }
      this._startExecution(taskId, attempt, (execSignal) => this._runAssignment(assignment, execSignal));
    }
  }

  _assignmentRejectReason(payload, references) {
    const shapeErrors = validateTaskShape({
      type: payload.type,
      projectId: payload.projectId,
      panelCode: payload.panelCode,
      generationInput: payload.generationInput,
      references,
    });
    if (shapeErrors.length > 0) return `任务数据不完整：${shapeErrors.join('；')}`;
    if (!this.config.allowedTaskTypes.includes(payload.type)) {
      return `节点白名单不允许执行任务类型「${payload.type}」`;
    }
    const projectId = String(payload.projectId || '').trim();
    if (this.config.allowedProjectIds.length > 0 && !this.config.allowedProjectIds.includes(projectId)) {
      return `节点白名单不允许执行项目「${projectId}」`;
    }
    return null;
  }

  // ------------------------------ 任务执行 ------------------------------
  async _runAssignment(assignment, signal) {
    const taskId = String(assignment.taskId || '').trim();
    const attempt = Math.floor(Number(assignment.attempt));
    const payload = assignment.payload && typeof assignment.payload === 'object' ? assignment.payload : {};
    const references = Array.isArray(assignment.references) ? assignment.references : [];
    this.journal.upsert(taskId, attempt, {
      stage: 'claimed',
      jobId: null,
      resultPath: null,
      sha256: null,
      likelyGenerated: false,
      taskType: payload.type,
      projectId: payload.projectId,
      generationInput: payload.generationInput,
      references: sanitizeReferences(references),
      uploadFailures: 0,
      lastError: null,
      startedAt: nowIso(),
    });
    this.log('info', `领取任务 ${taskId}（第 ${attempt} 次尝试，类型 ${payload.type}，项目 ${payload.projectId}）`);
    try {
      const result = await this._executePipeline({
        taskId,
        attempt,
        payload,
        references,
        signal,
        jobId: null,
      });
      if (!result) return;
      await this._uploadResultWithRecovery({taskId, attempt, result, signal});
    } catch (error) {
      if (isAbortedError(error) || this.state.stopping) {
        this.log('warn', `任务 ${taskId} 因节点停止而中断，等待重启后按中控裁决恢复`);
        return;
      }
      const entry = this.journal.get(taskId, attempt);
      const likelyGenerated = Boolean(entry && entry.likelyGenerated);
      this.log('error', `任务 ${taskId} 执行失败：${describeError(error)}`);
      await this._reportFailSafe(taskId, attempt, `本机执行失败：${describeError(error)}`, likelyGenerated, signal);
      if (entry && !likelyGenerated) this.journal.remove(taskId, attempt);
    }
  }

  // 下载参考图 → 提交本机 → 轮询；返回校验后的结果对象（失败/取消返回 null）。
  async _executePipeline({taskId, attempt, payload, references, signal, jobId}) {
    let currentJobId = jobId || null;
    if (!currentJobId) {
      let referenceFiles = [];
      if (Array.isArray(references) && references.length > 0) {
        this.journal.upsert(taskId, attempt, {stage: 'claimed'});
        referenceFiles = await this.local.downloadReferences({
          taskId,
          attempt,
          references,
          hubUrl: this.config.hubUrl,
          token: this.config.token,
          signal,
        });
      }
      this.journal.upsert(taskId, attempt, {stage: 'submitting'});
      let submitted = null;
      try {
        submitted = await this.local.submitGeneration({
          taskId,
          attempt,
          generationInput: payload.generationInput,
          referenceFiles,
          signal,
        });
      } catch (error) {
        if (isAbortedError(error)) throw error;
        // 4xx=本机明确拒绝（没生成）；超时/断线/5xx=可能已经建了 job，按「可能已生成」保守处理。
        const uncertain = !(error && typeof error.status === 'number' && error.status >= 400 && error.status < 500);
        this.journal.upsert(taskId, attempt, {
          stage: uncertain ? 'submitting' : 'unknown',
          likelyGenerated: uncertain,
          lastError: describeError(error),
        });
        throw error;
      }
      currentJobId = submitted.jobId;
      this.journal.upsert(taskId, attempt, {stage: 'submitted', jobId: currentJobId, likelyGenerated: false});
    } else {
      this.journal.upsert(taskId, attempt, {stage: 'submitted', jobId: currentJobId});
    }
    return this._pollLocalJob({taskId, attempt, jobId: currentJobId, signal});
  }

  // 轮询本机 job：queued → running（上报 generating）→ done（校验结果）/ failed / cancelled。
  async _pollLocalJob({taskId, attempt, jobId, signal}) {
    const deadline = Date.now() + this.config.taskTimeoutMs;
    let progressReported = false;
    let consecutiveErrors = 0;
    let unknownStatusCount = 0;
    while (true) {
      if (signal.aborted || this.state.stopping) {
        throw new CollabError('节点正在停止，中止本机任务轮询', {status: 0, code: 'aborted'});
      }
      if (Date.now() > deadline) {
        await this.local.cancelGeneration(jobId);
        const message = `本机生成超时（${Math.round(this.config.taskTimeoutMs / 1000)} 秒），已请求取消`;
        this.log('error', `任务 ${taskId} ${message}`);
        await this._reportFailSafe(taskId, attempt, message, true, signal);
        this.journal.upsert(taskId, attempt, {stage: 'unknown', likelyGenerated: true, lastError: message});
        return null;
      }
      let job = null;
      try {
        job = await this.local.queryGeneration(jobId, {signal});
        consecutiveErrors = 0;
      } catch (error) {
        if (isAbortedError(error)) throw error;
        consecutiveErrors += 1;
        this.log('warn', `查询本机任务 ${jobId} 失败（连续 ${consecutiveErrors} 次）：${describeError(error)}`);
        if (consecutiveErrors >= 5) {
          const entry = this.journal.get(taskId, attempt);
          const likelyGenerated = Boolean(entry && (entry.likelyGenerated || entry.generationStartedAt));
          const message = `连续查询本机任务失败：${describeError(error)}`;
          await this._reportFailSafe(taskId, attempt, message, likelyGenerated, signal);
          if (likelyGenerated) this.journal.upsert(taskId, attempt, {stage: 'unknown', lastError: message});
          else this.journal.remove(taskId, attempt);
          return null;
        }
        await sleep(this.config.pollMs, signal);
        continue;
      }
      const status = String(job.status || '').trim();
      if (status === 'queued') {
        await sleep(this.config.pollMs, signal);
        continue;
      }
      if (status === 'running' || status === 'generating') {
        const generationStartedAt = job.generationStartedAt || job.startedAt || null;
        this.journal.upsert(taskId, attempt, {
          stage: 'generating',
          likelyGenerated: true,
          ...(generationStartedAt ? {generationStartedAt} : {}),
        });
        if (!progressReported) {
          progressReported = true;
          await this._reportProgressSafe(taskId, attempt, 'generating', job.message || '本机正在生成', signal);
        }
        await sleep(this.config.pollMs, signal);
        continue;
      }
      if (status === 'done') {
        this.journal.upsert(taskId, attempt, {stage: 'result_ready', likelyGenerated: true});
        if (!job.result || typeof job.result !== 'object') {
          throw new CollabError('本机任务已完成但没有返回结果文件信息', {status: 502, code: 'local_result_missing'});
        }
        const result = await this.local.readResultFile(job.result, {expectedSha256: job.result.sha256});
        this.journal.upsert(taskId, attempt, {
          stage: 'result_ready',
          resultPath: result.filePath,
          sha256: result.sha256,
          size: result.size,
          mime: result.mime,
          width: result.width,
          height: result.height,
          likelyGenerated: true,
        });
        return result;
      }
      if (status === 'failed' || status === 'cancelled') {
        const entry = this.journal.get(taskId, attempt);
        const likelyGenerated = Boolean(
          (entry && (entry.likelyGenerated || entry.generationStartedAt))
          || job.generationStartedAt
          || job.startedAt,
        );
        const detail = job.error && typeof job.error === 'object'
          ? job.error.message || ''
          : job.error || job.message || '';
        const reason = status === 'cancelled' ? '本机协作生成任务已被取消' : '本机协作生成失败';
        const message = `${reason}${detail ? `：${clipText(detail, 300)}` : ''}`;
        this.log('error', `任务 ${taskId} ${message}（可能已生成=${likelyGenerated ? '是' : '否'}）`);
        await this._reportFailSafe(taskId, attempt, message, likelyGenerated, signal);
        this.journal.remove(taskId, attempt);
        return null;
      }
      unknownStatusCount += 1;
      this.log('warn', `本机任务 ${jobId} 返回未知状态「${status}」，继续轮询`);
      this.journal.upsert(taskId, attempt, {stage: 'unknown'});
      if (unknownStatusCount >= 30) {
        await this._reportFailSafe(taskId, attempt, `本机任务状态异常：${status}`, true, signal);
        this.journal.upsert(taskId, attempt, {stage: 'unknown', likelyGenerated: true});
        return null;
      }
      await sleep(this.config.pollMs, signal);
    }
  }

  // ------------------------------ 结果上传 ------------------------------
  async _uploadResultWithRecovery({taskId, attempt, result, signal}) {
    this.journal.upsert(taskId, attempt, {
      stage: 'result_ready',
      resultPath: result.filePath,
      sha256: result.sha256,
      size: result.size,
      mime: result.mime,
      width: result.width,
      height: result.height,
      likelyGenerated: true,
    });
    await this._reportProgressSafe(taskId, attempt, 'uploading', '正在上传生成结果', signal);
    const totalAttempts = Math.max(1, Math.floor(Number(this.config.uploadRetries) || 0) + 1);
    let lastError = null;
    for (let index = 0; index < totalAttempts; index += 1) {
      if (signal.aborted || this.state.stopping) {
        throw new CollabError('节点正在停止，中止结果上传', {status: 0, code: 'aborted'});
      }
      try {
        const response = await requestJson(
          `${this.config.hubUrl}/api/node/tasks/${encodeURIComponent(taskId)}/result`,
          {
            method: 'PUT',
            token: this.config.token,
            signal,
            timeoutMs: Math.max(this.config.hubTimeoutMs, 30000),
            headers: {
              'content-type': result.mime || 'application/octet-stream',
              'x-attempt': String(attempt),
              'x-sha256': result.sha256,
            },
            body: result.buffer,
            maxBytes: 4 * 1024 * 1024,
          },
        );
        const data = response.body && typeof response.body === 'object' ? response.body : {};
        this.journal.upsert(taskId, attempt, {stage: 'done', uploadFailures: index, lastError: null});
        this.journal.remove(taskId, attempt);
        const notes = [
          data.duplicate ? '中控判为重复回传' : '',
          data.late ? '中控作为迟到结果登记' : '',
        ].filter(Boolean).join('，');
        this.log('info', `任务 ${taskId}（第 ${attempt} 次尝试）结果上传成功${notes ? `（${notes}）` : ''}`);
        return true;
      } catch (error) {
        if (isAbortedError(error)) throw error;
        lastError = error;
        this.journal.upsert(taskId, attempt, {
          stage: 'upload_failed',
          uploadFailures: index + 1,
          lastError: describeError(error),
        });
        this.log('warn', `任务 ${taskId} 结果上传失败（第 ${index + 1}/${totalAttempts} 次）：${describeError(error)}`);
        if (index + 1 < totalAttempts) {
          const backoff = Math.max(0, Math.floor(this.config.uploadBackoffMs * Math.pow(2, index)));
          await sleep(backoff, signal);
        }
      }
    }
    const reason = `结果已生成但连续上传失败：${describeError(lastError)}`;
    this.log('error', `任务 ${taskId} ${reason}`);
    await this._reportFailSafe(taskId, attempt, reason, true, signal);
    return false;
  }

  // 上传一次迟到结果（不覆盖新尝试、不触发本机失败上报）。
  async _uploadLateOnce(entry, result, signal) {
    try {
      const response = await requestJson(
        `${this.config.hubUrl}/api/node/tasks/${encodeURIComponent(entry.taskId)}/result`,
        {
          method: 'PUT',
          token: this.config.token,
          signal,
          timeoutMs: Math.max(this.config.hubTimeoutMs, 30000),
          headers: {
            'content-type': result.mime || 'application/octet-stream',
            'x-attempt': String(entry.attempt),
            'x-sha256': result.sha256,
          },
          body: result.buffer,
          maxBytes: 4 * 1024 * 1024,
        },
      );
      const data = response.body && typeof response.body === 'object' ? response.body : {};
      this.log('info', `任务 ${entry.taskId} 迟到结果已登记${data.late ? '（中控记录为迟到结果）' : ''}`);
      return true;
    } catch (error) {
      if (isAbortedError(error)) throw error;
      this.log('warn', `任务 ${entry.taskId} 迟到结果登记失败（已放弃）：${describeError(error)}`);
      return false;
    }
  }

  // ------------------------------ 恢复处理 ------------------------------
  async _resultFromJournalEntry(entry, signal) {
    if (!entry) return null;
    if (entry.resultPath && entry.sha256) {
      try {
        return await this.local.readResultFile({
          filePath: entry.resultPath,
          sha256: entry.sha256,
          size: entry.size,
          mime: entry.mime,
        });
      } catch (error) {
        this.log('warn', `journal 记录的结果文件不可用（任务 ${entry.taskId}）：${describeError(error)}`);
      }
    }
    if (entry.jobId) {
      try {
        const job = await this.local.queryGeneration(entry.jobId, {signal});
        if (job && job.status === 'done' && job.result) {
          const result = await this.local.readResultFile(job.result, {expectedSha256: job.result.sha256});
          this.journal.upsert(entry.taskId, entry.attempt, {
            stage: 'result_ready',
            resultPath: result.filePath,
            sha256: result.sha256,
            size: result.size,
            mime: result.mime,
            width: result.width,
            height: result.height,
            likelyGenerated: true,
          });
          return result;
        }
      } catch (error) {
        if (isAbortedError(error)) throw error;
        this.log('warn', `查询本机任务 ${entry.jobId} 结果失败（任务 ${entry.taskId}）：${describeError(error)}`);
      }
    }
    return null;
  }

  async _handleAbandoned(entry, signal) {
    const taskId = entry ? entry.taskId : '';
    this.log('info', `任务 ${taskId} 已被中控放弃/改派，取消本机残留任务并清理 journal`);
    try {
      if (entry && entry.jobId) await this.local.cancelGeneration(entry.jobId);
    } finally {
      if (entry) this.journal.remove(entry.taskId, entry.attempt);
    }
  }

  async _handleLateResult(taskId, attempt, signal) {
    const entry = this.journal.get(taskId, attempt);
    this.log('info', `任务 ${taskId} 已有新尝试接管，旧结果只登记不覆盖`);
    try {
      const result = await this._resultFromJournalEntry(entry, signal);
      if (result) {
        await this._uploadLateOnce(entry, result, signal);
      } else if (entry && entry.jobId) {
        await this.local.cancelGeneration(entry.jobId);
      }
    } finally {
      this.journal.remove(taskId, attempt);
    }
  }

  async _resumeKeptTask(entry, signal) {
    const taskId = entry.taskId;
    const attempt = entry.attempt;
    this.log('info', `按中控裁决继续任务 ${taskId}（第 ${attempt} 次尝试，journal 阶段 ${entry.stage}）`);
    try {
      if (entry.stage === 'result_ready' || entry.stage === 'upload_failed') {
        const existing = await this._resultFromJournalEntry(entry, signal);
        if (existing) {
          await this._uploadResultWithRecovery({taskId, attempt, result: existing, signal});
          return;
        }
      }
      let result = null;
      if (entry.jobId) {
        this.journal.upsert(taskId, attempt, {stage: entry.stage === 'generating' ? 'generating' : 'submitted'});
        result = await this._pollLocalJob({taskId, attempt, jobId: entry.jobId, signal});
      } else {
        if (!entry.generationInput || typeof entry.generationInput !== 'object') {
          const reason = '本机 journal 缺少 generationInput，无法继续生成';
          this.log('error', `任务 ${taskId} ${reason}`);
          await this._reportFailSafe(taskId, attempt, reason, Boolean(entry.likelyGenerated), signal);
          this.journal.remove(taskId, attempt);
          return;
        }
        result = await this._executePipeline({
          taskId,
          attempt,
          payload: {
            type: entry.taskType || TASK_TYPES[0],
            projectId: entry.projectId || '',
            generationInput: entry.generationInput,
          },
          references: Array.isArray(entry.references) ? entry.references : [],
          signal,
          jobId: null,
        });
      }
      if (!result) return;
      await this._uploadResultWithRecovery({taskId, attempt, result, signal});
    } catch (error) {
      if (isAbortedError(error) || this.state.stopping) {
        this.log('warn', `任务 ${taskId} 恢复被节点停止中断，journal 保留`);
        return;
      }
      const current = this.journal.get(taskId, attempt);
      const likelyGenerated = Boolean(current && current.likelyGenerated);
      this.log('error', `任务 ${taskId} 恢复失败：${describeError(error)}`);
      await this._reportFailSafe(taskId, attempt, `节点恢复执行失败：${describeError(error)}`, likelyGenerated, signal);
      if (!likelyGenerated) this.journal.remove(taskId, attempt);
    }
  }

  async _resumeUpload(entry, signal) {
    const taskId = entry.taskId;
    const attempt = entry.attempt;
    this.log('info', `按中控裁决重传任务 ${taskId}（第 ${attempt} 次尝试）的结果`);
    const result = await this._resultFromJournalEntry(entry, signal);
    if (!result) {
      const reason = 'journal 中没有可用的结果文件，无法重传';
      this.log('error', `任务 ${taskId} ${reason}`);
      await this._reportFailSafe(taskId, attempt, reason, true, signal);
      this.journal.remove(taskId, attempt);
      return;
    }
    await this._uploadResultWithRecovery({taskId, attempt, result, signal});
  }

  async _resumeVerify(entry, signal) {
    const taskId = entry.taskId;
    const attempt = entry.attempt;
    this.log('info', `按中控裁决核实任务 ${taskId}（第 ${attempt} 次尝试）的本机结果`);
    try {
      let job = null;
      if (entry.jobId) {
        try {
          job = await this.local.queryGeneration(entry.jobId, {signal});
        } catch (error) {
          if (isAbortedError(error)) throw error;
          if (error && error.status === 404) job = null;
          else throw error;
        }
      }
      const jobStatus = job ? String(job.status || '').trim() : '';
      if (job && (jobStatus === 'queued' || jobStatus === 'running' || jobStatus === 'generating')) {
        await this._reportVerifySafe(taskId, attempt, 'still_running', '本机任务仍在执行，继续等待结果', signal);
        const result = await this._pollLocalJob({taskId, attempt, jobId: entry.jobId, signal});
        if (result) {
          await this._reportVerifySafe(taskId, attempt, 'result_available', '本机结果已生成', signal);
          await this._uploadResultWithRecovery({taskId, attempt, result, signal});
        }
        return;
      }
      const existing = await this._resultFromJournalEntry(entry, signal);
      if (existing) {
        await this._reportVerifySafe(taskId, attempt, 'result_available', '本机结果文件仍可用', signal);
        await this._uploadResultWithRecovery({taskId, attempt, result: existing, signal});
        return;
      }
      await this._reportVerifySafe(taskId, attempt, 'no_result', '本机没有可用结果', signal);
      this.journal.remove(taskId, attempt);
    } catch (error) {
      if (isAbortedError(error) || this.state.stopping) {
        this.log('warn', `任务 ${taskId} 核实被节点停止中断，journal 保留`);
        return;
      }
      this.log('error', `任务 ${taskId} 核实失败（保留 journal 等下次裁决）：${describeError(error)}`);
    }
  }

  // ------------------------------ 中控上报 ------------------------------
  async _reportProgress(taskId, attempt, phase, message, signal) {
    await requestJson(`${this.config.hubUrl}/api/node/tasks/${encodeURIComponent(taskId)}/progress`, {
      method: 'POST',
      token: this.config.token,
      signal,
      headers: {'content-type': 'application/json; charset=utf-8'},
      body: JSON.stringify({attempt, phase, ...(message ? {message: clipText(message, 300)} : {})}),
      timeoutMs: this.config.hubTimeoutMs,
    });
  }

  async _reportProgressSafe(taskId, attempt, phase, message, signal) {
    try {
      await this._reportProgress(taskId, attempt, phase, message, signal);
      this.log('debug', `已上报任务 ${taskId} 进度：${phase}`);
    } catch (error) {
      if (isAbortedError(error)) throw error;
      this.log('warn', `上报任务 ${taskId} 进度失败：${describeError(error)}`);
    }
  }

  async _reportFail(taskId, attempt, message, likelyGenerated, signal) {
    await requestJson(`${this.config.hubUrl}/api/node/tasks/${encodeURIComponent(taskId)}/fail`, {
      method: 'POST',
      token: this.config.token,
      signal,
      headers: {'content-type': 'application/json; charset=utf-8'},
      body: JSON.stringify({attempt, error: clipText(message, 500), likelyGenerated: Boolean(likelyGenerated)}),
      timeoutMs: this.config.hubTimeoutMs,
    });
  }

  async _reportFailSafe(taskId, attempt, message, likelyGenerated, signal) {
    try {
      await this._reportFail(taskId, attempt, message, likelyGenerated, signal);
      this.log(
        'warn',
        `已上报中控：任务 ${taskId} 失败（${clipText(message, 160)}）${likelyGenerated ? '，标记为可能已生成、等待核实' : ''}`,
      );
    } catch (error) {
      if (isAbortedError(error)) {
        this.log('debug', `任务 ${taskId} 的失败上报因节点停止而取消`);
        return;
      }
      this.log('error', `上报任务 ${taskId} 失败状态失败：${describeError(error)}`);
    }
  }

  async _reportVerifySafe(taskId, attempt, outcome, message, signal) {
    try {
      await requestJson(`${this.config.hubUrl}/api/node/tasks/${encodeURIComponent(taskId)}/verify`, {
        method: 'POST',
        token: this.config.token,
        signal,
        headers: {'content-type': 'application/json; charset=utf-8'},
        body: JSON.stringify({attempt, outcome, ...(message ? {message: clipText(message, 300)} : {})}),
        timeoutMs: this.config.hubTimeoutMs,
      });
      this.log('info', `已上报任务 ${taskId} 核实结果：${outcome}`);
    } catch (error) {
      if (isAbortedError(error)) throw error;
      this.log('warn', `上报任务 ${taskId} 核实结果失败：${describeError(error)}`);
    }
  }
}

export function createNodeAgent(options = {}) {
  return new NodeAgent(options);
}
