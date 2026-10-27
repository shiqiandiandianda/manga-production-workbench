// 中控持久化与数据模型（协议与设计.md §3 / §5.9 / §10）。
// 职责：state 结构、原子写 + 100ms 合并写、启动读盘、配对/令牌、通知 seq、
// 容量上限、重启恢复所需的「恢复计划」。只依赖 node: 内置模块与 protocol.mjs。
import fs from 'node:fs';
import path from 'node:path';
import {
  CollabError,
  NODE_ROLES,
  check,
  clampInteger,
  ensureDir,
  newToken,
  nowIso as isoNow,
  pairingCode,
  publicNode,
  readJson,
  tokenHash,
  uid,
  writeJsonAtomic,
} from './protocol.mjs';

const SILENT_LOGGER = {info() {}, warn() {}, error() {}};
const NOTIFICATION_LEVELS = ['info', 'success', 'warn', 'error'];

export const HUB_DEFAULTS = Object.freeze({
  port: 18897,
  host: '0.0.0.0',
  hubName: 'PhotoCraft 协作中控',
  heartbeatTimeoutMs: 15000,
  leaseMs: 120000,
  maxAttemptMs: 900000,
  resultMaxBytes: 64 * 1024 * 1024,
  jsonBodyMaxBytes: 4 * 1024 * 1024,
  maxTasks: 5000,
  maxNotifications: 5000,
  maxConcurrencyLimit: 8,
  pairingEnabled: true,
  allowedProjectIds: [],
});

// 合并默认配置；数值做范围收敛，避免配置文件写坏把中控搞挂。
export function defaultHubConfig(overrides = {}) {
  const config = {...HUB_DEFAULTS, ...(overrides && typeof overrides === 'object' ? overrides : {})};
  config.heartbeatTimeoutMs = clampInteger(config.heartbeatTimeoutMs, 1000, 600000, HUB_DEFAULTS.heartbeatTimeoutMs);
  config.leaseMs = clampInteger(config.leaseMs, 2000, 3600000, HUB_DEFAULTS.leaseMs);
  config.maxAttemptMs = clampInteger(config.maxAttemptMs, 1000, 24 * 3600 * 1000, HUB_DEFAULTS.maxAttemptMs);
  config.resultMaxBytes = clampInteger(config.resultMaxBytes, 1024, 512 * 1024 * 1024, HUB_DEFAULTS.resultMaxBytes);
  config.jsonBodyMaxBytes = clampInteger(config.jsonBodyMaxBytes, 1024, 128 * 1024 * 1024, HUB_DEFAULTS.jsonBodyMaxBytes);
  config.maxTasks = clampInteger(config.maxTasks, 10, 1000000, HUB_DEFAULTS.maxTasks);
  config.maxNotifications = clampInteger(config.maxNotifications, 10, 1000000, HUB_DEFAULTS.maxNotifications);
  config.maxConcurrencyLimit = clampInteger(config.maxConcurrencyLimit, 1, 32, HUB_DEFAULTS.maxConcurrencyLimit);
  config.pairingEnabled = config.pairingEnabled !== false;
  config.allowedProjectIds = Array.isArray(config.allowedProjectIds)
    ? config.allowedProjectIds.map((item) => String(item)).filter(Boolean)
    : [];
  return config;
}

function defaultNodeSettings() {
  return {enabled: true, paused: false, maxConcurrency: 2};
}

function defaultNodeStatus() {
  return {online: false, lastSeenAt: null, freeSlots: 0, runningTaskIds: [], local: {}, message: ''};
}

function defaultApply() {
  return {status: 'pending', detail: '', at: null, by: null};
}

function normalizeNotifications(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const normalized = [];
  let maxSeq = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const seq = clampInteger(item.seq, 1, Number.MAX_SAFE_INTEGER, maxSeq + 1);
    if (seen.has(seq)) continue;
    seen.add(seq);
    maxSeq = Math.max(maxSeq, seq);
    normalized.push({
      id: typeof item.id === 'string' && item.id ? item.id : uid('ntf'),
      seq,
      level: NOTIFICATION_LEVELS.includes(item.level) ? item.level : 'info',
      type: String(item.type || 'info'),
      title: String(item.title || ''),
      body: String(item.body || ''),
      taskId: item.taskId || null,
      assetId: item.assetId || null,
      nodeId: item.nodeId || null,
      targetClientId: item.targetClientId || null,
      createdAt: String(item.createdAt || isoNow()),
      readBy: Array.isArray(item.readBy) ? item.readBy.map(String) : [],
    });
  }
  return normalized;
}

function normalizeState(raw, {hubName} = {}) {
  const state = raw && typeof raw === 'object' && !Array.isArray(raw) ? {...raw} : {};
  state.version = 1;
  state.hubId = typeof state.hubId === 'string' && state.hubId ? state.hubId : uid('hub');
  state.hubName = String(state.hubName || hubName || HUB_DEFAULTS.hubName);
  state.createdAt = String(state.createdAt || isoNow());
  state.pairingCode = /^[A-Z0-9]{4,12}$/.test(String(state.pairingCode || ''))
    ? String(state.pairingCode)
    : pairingCode();

  state.clients = (Array.isArray(state.clients) ? state.clients : [])
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      name: String(item.name || ''),
      role: NODE_ROLES.includes(item.role) ? item.role : 'client',
      tokenHash: String(item.tokenHash || ''),
      nodeId: item.nodeId || null,
      createdAt: String(item.createdAt || isoNow()),
      revoked: item.revoked === true,
      lastNotificationSeq: clampInteger(item.lastNotificationSeq, 0, Number.MAX_SAFE_INTEGER, 0),
    }));

  state.nodes = (Array.isArray(state.nodes) ? state.nodes : [])
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      name: String(item.name || ''),
      platform: String(item.platform || ''),
      version: String(item.version || ''),
      pairedAt: String(item.pairedAt || isoNow()),
      revoked: item.revoked === true,
      settings: {...defaultNodeSettings(), ...(item.settings && typeof item.settings === 'object' ? item.settings : {})},
      status: {...defaultNodeStatus(), ...(item.status && typeof item.status === 'object' ? item.status : {})},
      capabilities: item.capabilities && typeof item.capabilities === 'object' ? item.capabilities : {},
    }));

  state.tasks = (Array.isArray(state.tasks) ? state.tasks : [])
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    .map((item) => ({
      ...item,
      status: typeof item.status === 'string' ? item.status : 'queued',
      phase: typeof item.phase === 'string' ? item.phase : 'queued',
      references: Array.isArray(item.references) ? item.references : [],
      attempts: Array.isArray(item.attempts) ? item.attempts : [],
      lateResults: Array.isArray(item.lateResults) ? item.lateResults : [],
      events: Array.isArray(item.events) ? item.events : [],
      result: item.result && typeof item.result === 'object' ? item.result : null,
      target: item.target && typeof item.target === 'object' ? item.target : {},
      generationInput: item.generationInput && typeof item.generationInput === 'object' ? item.generationInput : {},
      activeAttempt: clampInteger(item.activeAttempt, 0, Number.MAX_SAFE_INTEGER, 0),
      assignedNodeId: item.assignedNodeId || null,
      apply: {...defaultApply(), ...(item.apply && typeof item.apply === 'object' ? item.apply : {})},
    }));

  state.assets = (Array.isArray(state.assets) ? state.assets : [])
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    .map((item) => ({
      ...item,
      lineageId: item.lineageId || `lin_${item.id}`,
      version: clampInteger(item.version, 1, Number.MAX_SAFE_INTEGER, 1),
      parentAssetId: item.parentAssetId || null,
      status: typeof item.status === 'string' ? item.status : 'pending',
      sha256: item.sha256 || null,
      blobId: item.blobId || null,
      size: clampInteger(item.size, 0, Number.MAX_SAFE_INTEGER, 0),
      width: clampInteger(item.width, 0, 20000, 0),
      height: clampInteger(item.height, 0, 20000, 0),
      labels: item.labels && typeof item.labels === 'object' ? item.labels : {},
      thumb: item.thumb || null,
    }));

  state.assetRequests = (Array.isArray(state.assetRequests) ? state.assetRequests : [])
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    .map((item) => ({
      ...item,
      waiters: Array.isArray(item.waiters) ? item.waiters.map(String) : [],
      status: typeof item.status === 'string' ? item.status : 'pending',
      assetId: item.assetId || null,
      taskId: item.taskId || null,
    }));

  state.notifications = normalizeNotifications(state.notifications);
  const previousSeq = clampInteger(state.counters && state.counters.notificationSeq, 0, Number.MAX_SAFE_INTEGER, 0);
  const maxSeq = state.notifications.reduce((max, item) => Math.max(max, item.seq), 0);
  state.counters = {notificationSeq: Math.max(previousSeq, maxSeq)};
  return state;
}

export class HubState {
  constructor({dataDir, hubName, config = {}, now, logger} = {}) {
    check(typeof dataDir === 'string' && dataDir.trim(), '缺少中控数据目录 dataDir', 500, 'missing_data_dir');
    this.dataDir = path.resolve(dataDir);
    this.config = defaultHubConfig({...config, ...(hubName ? {hubName} : {})});
    this.hubName = this.config.hubName;
    this.now = typeof now === 'function' ? now : typeof config.now === 'function' ? config.now : Date.now;
    this.logger = logger && typeof logger === 'object' ? {...SILENT_LOGGER, ...logger} : SILENT_LOGGER;
    this.stateFile = path.join(this.dataDir, 'hub-state.json');
    this.pairingFile = path.join(this.dataDir, '配对码.txt');
    this.blobsDir = path.join(this.dataDir, 'blobs');
    this.thumbsDir = path.join(this.dataDir, 'thumbs');
    this.listeners = new Set();
    this.saveTimer = null;
    this.dirty = false;
    this.closed = false;
    ensureDir(this.dataDir);
    ensureDir(this.blobsDir);
    ensureDir(this.thumbsDir);

    let loaded = null;
    try {
      loaded = readJson(this.stateFile, null);
    } catch (error) {
      throw new Error(`中控状态文件损坏，无法解析：${this.stateFile}（${error.message}）。请先备份/移走该文件再启动。`);
    }
    this.state = loaded
      ? normalizeState(loaded, {hubName: this.hubName})
      : normalizeState({hubId: uid('hub'), hubName: this.hubName, createdAt: isoNow()}, {hubName: this.hubName});
    this.writePairingFile();
    this.flush();
  }

  // ------------------------------------------------------------------ 时间和保存
  nowMs() {
    return this.now();
  }

  nowIso() {
    return new Date(this.now()).toISOString();
  }

  isoAt(milliseconds) {
    return new Date(milliseconds).toISOString();
  }

  touch() {
    this.scheduleSave();
  }

  // 100ms 合并写：高频心跳/任务更新只落一次盘。
  scheduleSave() {
    if (this.closed) return;
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        this.flush();
      } catch (error) {
        this.logger.error?.(`[中控] 状态落盘失败：${error.message}`);
      }
    }, 100);
    this.saveTimer.unref?.();
  }

  flush() {
    if (!this.dirty && fs.existsSync(this.stateFile)) return;
    this.trimStore();
    writeJsonAtomic(this.stateFile, this.state);
    this.dirty = false;
  }

  close() {
    if (this.closed) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      this.dirty = true;
      this.flush();
    } finally {
      this.closed = true;
    }
  }

  trimStore() {
    const {maxNotifications, maxTasks} = this.config;
    if (this.state.notifications.length > maxNotifications) {
      this.state.notifications = this.state.notifications
        .slice()
        .sort((a, b) => a.seq - b.seq)
        .slice(-maxNotifications);
    }
    if (this.state.tasks.length > maxTasks) {
      const active = [];
      const terminal = [];
      for (const task of this.state.tasks) {
        if (['queued', 'running', 'uploading', 'verifying'].includes(task.status)) active.push(task);
        else terminal.push(task);
      }
      terminal.sort((a, b) => String(b.updatedAt || b.submittedAt || '').localeCompare(String(a.updatedAt || a.submittedAt || '')));
      const keep = Math.max(0, maxTasks - active.length);
      this.state.tasks = active.concat(terminal.slice(0, keep));
    }
  }

  // ------------------------------------------------------------------ 查询
  getTask(taskId) {
    return this.state.tasks.find((task) => task.id === taskId) || null;
  }

  getAsset(assetId) {
    return this.state.assets.find((asset) => asset.id === assetId) || null;
  }

  getAssetVersion(assetId, version) {
    return this.state.assets.find((asset) => asset.id === assetId && asset.version === version) || null;
  }

  getAssetRequest(requestId) {
    return this.state.assetRequests.find((item) => item.id === requestId) || null;
  }

  findTaskByAssetRequestId(requestId) {
    return this.state.tasks.find((task) => task.assetRequestId === requestId) || null;
  }

  getNode(nodeId) {
    return this.state.nodes.find((node) => node.id === nodeId) || null;
  }

  getClient(clientId) {
    return this.state.clients.find((client) => client.id === clientId) || null;
  }

  clientForNode(nodeId) {
    return this.state.clients.find((client) => client.nodeId === nodeId && client.role === 'node') || null;
  }

  findClientByToken(token) {
    const value = String(token || '').trim();
    if (!value) return null;
    let hash = '';
    try {
      hash = tokenHash(value);
    } catch {
      return null;
    }
    return this.state.clients.find((client) => client.tokenHash && client.tokenHash === hash) || null;
  }

  allNodes() {
    return this.state.nodes;
  }

  // ------------------------------------------------------------------ 配对 / 令牌
  pair({pairingCode: code, role, name, platform = '', version = ''} = {}) {
    if (!this.config.pairingEnabled) {
      throw new CollabError('中控已关闭配对，请在配置文件里开启 pairingEnabled', {status: 403, code: 'pairing_disabled'});
    }
    const submittedCode = String(code || '').trim().toUpperCase();
    check(submittedCode, '缺少配对码', 400, 'missing_pairing_code');
    check(NODE_ROLES.includes(role), `配对角色无效：${role}`, 400, 'invalid_role');
    const deviceName = String(name || '').trim().slice(0, 64);
    check(deviceName, '缺少设备名称', 400, 'missing_name');
    if (submittedCode !== this.state.pairingCode) {
      throw new CollabError('配对码错误', {status: 401, code: 'invalid_pairing_code'});
    }
    const token = newToken();
    const timestamp = this.nowIso();
    let node = null;
    if (role === 'node') {
      node = {
        id: uid('node'),
        name: deviceName,
        platform: String(platform || ''),
        version: String(version || ''),
        pairedAt: timestamp,
        revoked: false,
        settings: defaultNodeSettings(),
        status: defaultNodeStatus(),
        capabilities: {},
      };
      this.state.nodes.push(node);
    }
    const client = {
      id: uid('client'),
      name: deviceName,
      role,
      tokenHash: tokenHash(token),
      nodeId: node ? node.id : null,
      createdAt: timestamp,
      revoked: false,
      lastNotificationSeq: this.state.counters.notificationSeq,
    };
    this.state.clients.push(client);
    this.touch();
    this.logger.info?.(`[中控] 已配对${role === 'node' ? '节点' : '客户端'}「${deviceName}」`);
    return {client, node, token, hubId: this.state.hubId, hubName: this.state.hubName, protocolVersion: '1.0.0'};
  }

  revokeNode(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) throw new CollabError('节点不存在', {status: 404, code: 'node_not_found'});
    if (node.revoked) return {node, alreadyRevoked: true};
    node.revoked = true;
    node.status = {...defaultNodeStatus(), ...node.status, online: false, freeSlots: 0, runningTaskIds: []};
    for (const client of this.state.clients) {
      if (client.nodeId === node.id) client.revoked = true;
    }
    this.addNotification({
      level: 'warn',
      type: 'node.revoked',
      title: '节点已被吊销',
      body: `节点「${node.name}」已被吊销，后续心跳会被拒绝。`,
      nodeId: node.id,
    });
    this.touch();
    return {node, alreadyRevoked: false};
  }

  updateNodeSettings(nodeId, patch = {}) {
    const node = this.getNode(nodeId);
    if (!node) throw new CollabError('节点不存在', {status: 404, code: 'node_not_found'});
    const next = {...node.settings};
    if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
    if (patch.paused !== undefined) next.paused = patch.paused === true;
    if (patch.maxConcurrency !== undefined) {
      next.maxConcurrency = clampInteger(patch.maxConcurrency, 1, this.config.maxConcurrencyLimit, next.maxConcurrency);
    }
    node.settings = next;
    this.touch();
    return node;
  }

  publicNode(node) {
    return publicNode(node);
  }

  rotationCode() {
    return this.state.pairingCode;
  }

  rotatePairing() {
    this.state.pairingCode = pairingCode();
    this.writePairingFile();
    this.touch();
    return this.state.pairingCode;
  }

  writePairingFile() {
    const text = [
      'PhotoCraft 协作中控配对码',
      '',
      `配对码：${this.state.pairingCode}`,
      `中控名称：${this.state.hubName}`,
      `生成时间：${this.nowIso()}`,
      '',
      '把上面的配对码输入节点/客户端的「配对」界面即可接入。',
      '配对码属于局域网内部凭据，请勿外传；可在中控控制台轮换。',
      '',
    ].join('\n');
    const temporary = `${this.pairingFile}.${process.pid}.tmp`;
    try {
      ensureDir(path.dirname(this.pairingFile));
      fs.writeFileSync(temporary, text, 'utf8');
      fs.renameSync(temporary, this.pairingFile);
    } catch (error) {
      try {
        fs.rmSync(temporary, {force: true});
      } catch {}
      this.logger.warn?.(`[中控] 写入配对码文件失败：${error.message}`);
    }
  }

  // ------------------------------------------------------------------ 通知
  addNotification({level = 'info', type = 'info', title = '', body = '', taskId = null, assetId = null, nodeId = null, targetClientId = null} = {}) {
    const seq = this.state.counters.notificationSeq + 1;
    this.state.counters.notificationSeq = seq;
    const notification = {
      id: uid('ntf'),
      seq,
      level: NOTIFICATION_LEVELS.includes(level) ? level : 'info',
      type: String(type || 'info'),
      title: String(title || ''),
      body: String(body || ''),
      taskId: taskId || null,
      assetId: assetId || null,
      nodeId: nodeId || null,
      targetClientId: targetClientId || null,
      createdAt: this.nowIso(),
      readBy: [],
    };
    this.state.notifications.push(notification);
    if (this.state.notifications.length > this.config.maxNotifications) {
      this.state.notifications = this.state.notifications
        .slice()
        .sort((a, b) => a.seq - b.seq)
        .slice(-this.config.maxNotifications);
    }
    this._emit({
      seq: notification.seq,
      level: notification.level,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      taskId: notification.taskId,
      assetId: notification.assetId,
      nodeId: notification.nodeId,
      createdAt: notification.createdAt,
    });
    this.touch();
    return notification;
  }

  notificationsFor({clientId = null, since = 0, limit = 100, advance = false} = {}) {
    const client = clientId ? this.getClient(clientId) : null;
    const floor = clampInteger(since, 0, Number.MAX_SAFE_INTEGER, 0);
    const size = clampInteger(limit, 1, 500, 100);
    const list = this.state.notifications
      .filter((item) => item.seq > floor)
      .filter((item) => !item.targetClientId || item.targetClientId === clientId)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, size);
    if (advance && client && list.length > 0) {
      client.lastNotificationSeq = Math.max(client.lastNotificationSeq || 0, list[list.length - 1].seq);
    }
    return {
      notifications: list,
      lastSeq: this.state.counters.notificationSeq,
    };
  }

  markNotificationsRead(ids, clientId) {
    check(clientId, '缺少 clientId', 400, 'missing_client_id');
    check(Array.isArray(ids), 'ids 必须是数组', 400, 'invalid_ids');
    const wanted = new Set(ids.map(String));
    let changed = 0;
    for (const notification of this.state.notifications) {
      if (!wanted.has(notification.id)) continue;
      if (!notification.readBy.includes(clientId)) {
        notification.readBy.push(clientId);
        changed += 1;
      }
    }
    if (changed > 0) this.touch();
    return changed;
  }

  notificationSinceForClient(clientId) {
    const client = clientId ? this.getClient(clientId) : null;
    return client ? client.lastNotificationSeq || 0 : 0;
  }

  // ------------------------------------------------------------------ 统计 / 恢复
  counts() {
    const taskCounts = {queued: 0, running: 0, uploading: 0, done: 0, failed: 0, verifying: 0, cancelled: 0};
    for (const task of this.state.tasks) {
      if (Object.prototype.hasOwnProperty.call(taskCounts, task.status)) taskCounts[task.status] += 1;
    }
    const activeNodes = this.state.nodes.filter((node) => !node.revoked);
    return {
      nodes: {total: activeNodes.length, online: activeNodes.filter((node) => node.status && node.status.online).length},
      tasks: taskCounts,
      assets: {total: this.state.assets.length, available: this.state.assets.filter((asset) => asset.status === 'available').length},
      notifications: {total: this.state.notifications.length, lastSeq: this.state.counters.notificationSeq},
    };
  }

  // §5.9 启动恢复所需信息：只收集，不改变状态；由 hub-queue.recoverAfterRestart 执行裁决。
  getRecoveryPlan(nowValue = this.now()) {
    const plan = {
      checkingAt: new Date(nowValue).toISOString(),
      expiredLeases: [],
      uploadingWithoutResult: [],
      donePendingApply: [],
      missingAttempt: [],
      onlineNodeIds: [],
      pendingAssetRequests: [],
    };
    for (const node of this.state.nodes) {
      if (node.status && node.status.online) plan.onlineNodeIds.push(node.id);
    }
    for (const task of this.state.tasks) {
      if (task.status === 'done' && (!task.apply || task.apply.status === 'pending')) plan.donePendingApply.push(task.id);
      if (!['queued', 'running', 'uploading', 'verifying'].includes(task.status)) continue;
      const attempt = (task.attempts || []).find((item) => item.attempt === task.activeAttempt) || null;
      if (!attempt) {
        if (task.status !== 'queued') plan.missingAttempt.push(task.id);
        continue;
      }
      if (task.status === 'uploading') {
        plan.uploadingWithoutResult.push(task.id);
        continue;
      }
      const expiresAt = Date.parse(attempt.leaseExpiresAt || '');
      if (Number.isFinite(expiresAt) && expiresAt < nowValue) {
        plan.expiredLeases.push({
          taskId: task.id,
          taskStatus: task.status,
          attempt: attempt.attempt,
          attemptStatus: attempt.status,
          nodeId: attempt.nodeId || null,
        });
      }
    }
    for (const request of this.state.assetRequests) {
      if (request.status === 'pending') plan.pendingAssetRequests.push(request.id);
    }
    return plan;
  }

  onEvent(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // SSE 客户端写入失败不应影响业务。
      }
    }
  }
}
