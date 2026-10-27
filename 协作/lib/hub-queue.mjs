// 中控任务队列：派单、租约、尝试、幂等提交、重复/迟到回传、重试、apply、恢复。
// 对应协议与设计.md §5（逐条）与 §4.2/§4.3 的任务相关接口。
// 关键约束：派单的「检查 + 置位」在同一事件循环内同步完成，中间不 await。
import {
  APPLY_STATUSES,
  ATTEMPT_STATUSES,
  CollabError,
  IMAGE_MIMES,
  PHASE,
  TASK_TYPES,
  check,
  clampInteger,
  canTransitionTask,
  hashJson,
  nowIso as isoNow,
  uid,
  validateImageBuffer,
  validateTaskShape,
  sha256 as sha256Of,
} from './protocol.mjs';
import {volunteerCapacity,volunteerPending} from './volunteer.mjs';

const ACTIVE_TASK_STATUSES = ['queued', 'running', 'uploading', 'verifying'];
const IN_FLIGHT_ATTEMPT_STATUSES = ['claimed', 'generating', 'uploading', 'upload_failed', 'unknown'];
const TERMINAL_TASK_STATUSES = ['done', 'failed', 'cancelled'];
const SILENT_LOGGER = {info() {}, warn() {}, error() {}};
const MAX_TASK_EVENTS = 100;
const MAX_LATE_RESULTS = 50;

function normalizeReferences(raw) {
  check(raw === undefined || Array.isArray(raw), 'references 必须是数组', 400, 'invalid_references');
  const list = Array.isArray(raw) ? raw : [];
  return list.map((reference, index) => {
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

function parseIntStrict(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export class HubQueue {
  constructor({hub, assets = null, logger} = {}) {
    check(hub, '缺少中控状态实例', 500, 'missing_hub');
    this.hub = hub;
    this.config = hub.config;
    this.assets = assets;
    this.logger = logger && typeof logger === 'object' ? {...SILENT_LOGGER, ...logger} : SILENT_LOGGER;
    this.timer = null;
  }

  attachAssets(assets) {
    this.assets = assets;
    return this;
  }

  // ------------------------------------------------------------------ 通用工具
  get state() {
    return this.hub.state;
  }

  nowMs() {
    return this.hub.nowMs();
  }

  nowIso() {
    return this.hub.nowIso();
  }

  leaseIso() {
    return this.hub.isoAt(this.nowMs() + this.config.leaseMs);
  }

  activeAttemptRecord(task) {
    if (!task) return null;
    return (task.attempts || []).find((item) => item.attempt === task.activeAttempt) || null;
  }

  pushEvent(task, type, message) {
    if (!task) return;
    task.events = Array.isArray(task.events) ? task.events : [];
    task.events.push({at: this.nowIso(), type: String(type), message: String(message || '')});
    if (task.events.length > MAX_TASK_EVENTS) task.events = task.events.slice(-MAX_TASK_EVENTS);
  }

  setTaskStatus(task, status, phase = status) {
    if (task.status === status) {
      task.phase = phase;
      return;
    }
    // 少见的恢复路径需要强制迁移（例如协议表未列出 verifying→queued），由 forceTaskStatus 处理。
    if (!['queued', 'running', 'uploading', 'doing', 'done', 'failed', 'verifying', 'cancelled'].includes(status)) {
      throw new CollabError(`未知任务状态：${status}`, {status: 500, code: 'invalid_status'});
    }
    if (!this.canTransition(task.status, status)) {
      throw new CollabError(`任务状态不能从 ${task.status} 变为 ${status}`, {status: 409, code: 'invalid_transition'});
    }
    task.status = status;
    task.phase = phase;
    task.updatedAt = this.nowIso();
  }

  forceTaskStatus(task, status, phase = status) {
    task.status = status;
    task.phase = phase;
    task.updatedAt = this.nowIso();
  }

  canTransition(from, to) {
    // 以 protocol.mjs 的 TASK_TRANSITION_TABLE 为唯一来源（verifying→queued 已由 Lead 补入协议表，§4.3 retry）。
    return canTransitionTask(from, to);
  }

  publicTask(task, {includeInput = false} = {}) {
    if (!task) return null;
    const copy = {...task};
    copy.references = Array.isArray(task.references) ? task.references.map((item) => ({...item})) : [];
    copy.attempts = Array.isArray(task.attempts) ? task.attempts.map((item) => ({...item})) : [];
    copy.lateResults = Array.isArray(task.lateResults) ? task.lateResults.map((item) => ({...item})) : [];
    copy.events = Array.isArray(task.events) ? task.events.map((item) => ({...item})) : [];
    copy.apply = {...(task.apply || {status: 'pending'})};
    copy.result = task.result ? {...task.result} : null;
    if (!includeInput) delete copy.generationInput;
    return copy;
  }

  getTaskOrThrow(taskId) {
    const task = this.hub.getTask(taskId);
    if (!task) throw new CollabError('任务不存在', {status: 404, code: 'task_not_found'});
    return task;
  }

  getNodeOrThrow(nodeId) {
    const node = this.hub.getNode(nodeId);
    if (!node) throw new CollabError('节点不存在', {status: 404, code: 'node_not_found'});
    if (node.revoked) throw new CollabError('节点已被吊销', {status: 403, code: 'node_revoked'});
    return node;
  }

  // ------------------------------------------------------------------ 建任务（幂等）
  submitTask(input, {clientId = null, source = 'client'} = {}) {
    check(input && typeof input === 'object' && !Array.isArray(input), '任务请求必须是对象', 400, 'invalid_task');
    const type = String(input.type || '');
    check(TASK_TYPES.includes(type), `不支持的任务类型：${type || '(空)'}`, 400, 'invalid_task_type');
    const normalized = {
      type,
      projectId: String(input.projectId || '').trim(),
      projectName: String(input.projectName || '').slice(0, 200),
      episode: input.episode === undefined || input.episode === null ? null : clampInteger(input.episode, 0, 1000000, null),
      panelCode: input.panelCode === undefined || input.panelCode === null ? null : String(input.panelCode).slice(0, 120),
      panelId: input.panelId === undefined || input.panelId === null ? null : String(input.panelId).slice(0, 200),
      shotCode: input.shotCode === undefined || input.shotCode === null ? null : String(input.shotCode).slice(0, 120),
      prompt: String(input.prompt || '').slice(0, 200000),
      style: String(input.style || '').slice(0, 400),
      size: {
        w: clampInteger(input.size && input.size.w, 0, 20000, 0),
        h: clampInteger(input.size && input.size.h, 0, 20000, 0),
      },
      target: input.target && typeof input.target === 'object' && !Array.isArray(input.target) ? input.target : {},
      generationInput: input.generationInput && typeof input.generationInput === 'object' && !Array.isArray(input.generationInput) ? input.generationInput : {},
      references: normalizeReferences(input.references),
      submittedBy: clientId || (typeof input.submittedBy === 'string' ? input.submittedBy : null),
      assetRequestId: input.assetRequestId ? String(input.assetRequestId) : null,
      assetId: input.assetId ? String(input.assetId) : null,
      ...(input.preferredNodeId?{preferredNodeId:String(input.preferredNodeId).slice(0,120)}:{}),
      ...(input.requesterName?{requesterName:String(input.requesterName).slice(0,80)}:{}),
    };
    const shapeErrors = validateTaskShape(normalized);
    check(shapeErrors.length === 0, `任务参数无效：${shapeErrors.join('；')}`, 400, 'invalid_task', shapeErrors);
    if(normalized.preferredNodeId)this.getNodeOrThrow(normalized.preferredNodeId);

    const payloadHash = hashJson(normalized);
    let idempotencyKey = String(input.idempotencyKey || '').trim().slice(0, 512);
    if (!idempotencyKey) idempotencyKey = `auto|${normalized.submittedBy || 'anonymous'}|${payloadHash.slice(0, 32)}`;

    const existing = this.state.tasks.find((task) => task.idempotencyKey === idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new CollabError('同一幂等键提交了不同内容（payloadHash 不一致）', {status: 409, code: 'idempotency_conflict'});
      }
      return {task: existing, duplicate: true};
    }

    const timestamp = this.nowIso();
    const task = {
      id: uid('task'),
      idempotencyKey,
      payloadHash,
      ...normalized,
      status: 'queued',
      phase: PHASE.QUEUED,
      submittedAt: timestamp,
      updatedAt: timestamp,
      activeAttempt: 0,
      assignedNodeId: null,
      attempts: [],
      result: null,
      lateResults: [],
      apply: {status: 'pending', detail: '', at: null, by: null},
      events: [],
    };
    this.state.tasks.push(task);
    this.pushEvent(task, 'submitted', source === 'asset-request' ? '共享资产申请创建生成任务，等待节点领取' : '客户端提交任务，进入队列');
    this.hub.touch();
    return {task, duplicate: false};
  }

  // ------------------------------------------------------------------ 查询
  listTasks(query = {}) {
    const limit = clampInteger(query.limit, 1, 500, 100);
    const offset = clampInteger(query.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const statusFilter = query.status ? String(query.status).split(',').map((item) => item.trim()).filter(Boolean) : null;
    const applyFilter = query.applyStatus ? String(query.applyStatus).split(',').map((item) => item.trim()).filter(Boolean) : null;
    let sinceMs = null;
    if (query.since !== undefined && query.since !== null && query.since !== '') {
      const numeric = Number(query.since);
      if (Number.isFinite(numeric)) sinceMs = numeric;
      else {
        const parsed = Date.parse(String(query.since));
        if (Number.isFinite(parsed)) sinceMs = parsed;
      }
    }
    const filtered = this.state.tasks.filter((task) => {
      if (query.projectId && task.projectId !== String(query.projectId)) return false;
      if (query.submittedBy && task.submittedBy !== String(query.submittedBy)) return false;
      if (statusFilter && !statusFilter.includes(task.status)) return false;
      if (applyFilter && !applyFilter.includes(task.apply && task.apply.status)) return false;
      if (sinceMs !== null) {
        const updated = Date.parse(task.updatedAt || task.submittedAt || '');
        if (!Number.isFinite(updated) || updated <= sinceMs) return false;
      }
      return true;
    });
    filtered.sort((a, b) => {
      const left = Date.parse(a.submittedAt || '') || 0;
      const right = Date.parse(b.submittedAt || '') || 0;
      if (right !== left) return right - left;
      return String(a.id).localeCompare(String(b.id));
    });
    const includeInput = query.include === true || query.include === 'true' || query.include === 1 || query.include === '1';
    const tasks = filtered.slice(offset, offset + limit).map((task) => this.publicTask(task, {includeInput}));
    return {tasks, total: filtered.length};
  }

  getTaskDetail(taskId) {
    const task = this.getTaskOrThrow(taskId);
    return this.publicTask(task, {includeInput: true});
  }

  // ------------------------------------------------------------------ 节点心跳（派单 + 续租 + 裁决）
  heartbeat(nodeId, body = {}) {
    const node = this.getNodeOrThrow(nodeId);
    const timestamp = this.nowIso();
    const wasOnline = Boolean(node.status && node.status.online);
    node.status = node.status && typeof node.status === 'object' ? node.status : {};
    node.status.online = true;
    node.status.lastSeenAt = timestamp;
    node.status.freeSlots = clampInteger(body.freeSlots, 0, 64, 0);
    node.status.runningTaskIds = Array.isArray(body.running) ? body.running.map(String).slice(0, 200) : [];
    node.status.local = body.local && typeof body.local === 'object' && !Array.isArray(body.local) ? body.local : {};
    node.status.message = typeof body.message === 'string' ? body.message.slice(0, 300) : '';
    if (body.capabilities && typeof body.capabilities === 'object') {
      node.capabilities = {...body.capabilities};
      if (typeof body.capabilities.version === 'string') node.version = body.capabilities.version.slice(0, 40);
      if (typeof body.capabilities.platform === 'string') node.platform = body.capabilities.platform.slice(0, 40);
    }
    if (!wasOnline) {
      this.hub.addNotification({
        level: 'success',
        type: 'node.online',
        title: '节点上线',
        body: `节点「${node.name}」已连接中控。`,
        nodeId: node.id,
      });
    }

    // 本节点心跳先续租，再做全局过期裁决，避免活跃节点的心跳瞬间被误判为过期。
    this.renewLeases(node);
    const expired = this.sweepExpiredLeases();
    this.sweepOfflineNodes();

    const dispositions = this.judgeJournal(node, body.journal);
    const assignments = this.dispatchToNode(node);

    const client = this.hub.clientForNode(node.id);
    const since = client ? client.lastNotificationSeq || 0 : 0;
    const {notifications} = this.hub.notificationsFor({clientId: client ? client.id : null, since, limit: 50, advance: true});
    this.hub.touch();
    return {
      serverTime: timestamp,
      hubId: this.state.hubId,
      settings: {...node.settings},
      revoked: false,
      dispositions,
      assignments,
      notifications,
      lastSeq: this.state.counters.notificationSeq,
      expired,
    };
  }

  renewLeases(node) {
    const leaseExpiresAt = this.leaseIso();
    for (const task of this.state.tasks) {
      if (!ACTIVE_TASK_STATUSES.includes(task.status)) continue;
      if (task.assignedNodeId !== node.id) continue;
      const attempt = this.activeAttemptRecord(task);
      if (!attempt || attempt.nodeId !== node.id) continue;
      if (!IN_FLIGHT_ATTEMPT_STATUSES.includes(attempt.status)) continue;
      attempt.leaseExpiresAt = leaseExpiresAt;
    }
  }

  // 排他派单：整个过程同步执行，检查与置位之间没有 await，同一任务绝不派给两个节点。
  requestVolunteer(nodeId,taskId){
    const node=this.getNodeOrThrow(nodeId),task=this.getTaskOrThrow(taskId);
    if(task.volunteer?.nodeId===nodeId&&(volunteerPending(task,this.nowMs())||task.assignedNodeId===nodeId&&['running','uploading','verifying'].includes(task.status)))return {taskId:task.id,reused:true,status:task.status};
    check(task.status==='queued','任务已被领取或开始生成，请刷新列表',409,'task_not_waiting');
    check(!volunteerPending(task,this.nowMs()),'已有同事主动领取此任务',409,'task_reserved');
    check(!task.preferredNodeId||task.preferredNodeId===nodeId,'此任务已指定其他同事',409,'task_designated');
    const projects=this.config.allowedProjectIds||[],allowed=node.capabilities?.allowedProjectIds||[],types=node.capabilities?.allowedTaskTypes||[];
    check(!projects.length||projects.includes(task.projectId),'本项目不允许协作生成',403,'project_not_allowed');
    check(!allowed.length||allowed.includes(task.projectId),'本机未获准生成这个项目',403,'project_not_allowed');
    check(!types.length||types.includes(task.type),'本机不支持此任务类型',409,'type_not_allowed');
    const capacity=volunteerCapacity(node,this.state.tasks,{now:this.nowMs(),timeout:this.config.heartbeatTimeoutMs});
    check(capacity.available,capacity.message,409,'node_not_ready');
    task.volunteer={nodeId,requestedAt:this.nowIso(),expiresAt:this.hub.isoAt(this.nowMs()+30000)};
    task.updatedAt=this.nowIso();this.pushEvent(task,'volunteered',`「${node.name}」主动帮忙，等待本机接单器确认`);this.hub.touch();this.hub.flush();
    return {taskId:task.id,reused:false,status:'queued'};
  }

  dispatchToNode(node) {
    if (!node || node.revoked) return [];
    const settings = node.settings || {};
    if (settings.enabled === false) return [];
    const pending=this.state.tasks.filter(t=>volunteerPending(t,this.nowMs())&&t.volunteer.nodeId===node.id);
    // Reserved work is delivered by the normal heartbeat and journal protocol.
    // Its explicit consent permits this one task even when auto-help is paused.
    const available=volunteerCapacity(node,this.state.tasks,{now:this.nowMs(),timeout:this.config.heartbeatTimeoutMs,reservePending:false});
    const manualSlots=available.slots;
    let slots = clampInteger(node.status && node.status.freeSlots, 0, 64, 0);
    slots = Math.min(slots, clampInteger(settings.maxConcurrency, 1, this.config.maxConcurrencyLimit, 1));
    const running=this.state.tasks.filter(t=>t.assignedNodeId===node.id&&['running','uploading','verifying'].includes(t.status)).length;
    slots=Math.max(0,Math.min(settings.paused?0:slots,settings.maxConcurrency-running));
    slots=Math.max(slots,Math.min(pending.length,manualSlots));
    if (slots <= 0) return [];
    const allowedProjects = Array.isArray(this.config.allowedProjectIds) ? this.config.allowedProjectIds : [];
    // 稳定 FIFO：submittedAt 相同（可控时钟测试/同毫秒提交）时用任务在 state.tasks 里的入队顺序兜底，
    // 不能用随机 UUID 做 tiebreak，否则派单顺序不确定，测试与故障恢复会出现偶发差异。
    const queueOrder = new Map();
    this.state.tasks.forEach((task, index) => queueOrder.set(task.id, index));
    const candidates = this.state.tasks
      .filter((task) => task.status === 'queued')
      .filter((task) => !task.preferredNodeId || task.preferredNodeId===node.id)
      .filter((task) => !volunteerPending(task,this.nowMs())||task.volunteer.nodeId===node.id)
      .filter((task) => !settings.paused||volunteerPending(task,this.nowMs()))
      .filter((task) => allowedProjects.length === 0 || allowedProjects.includes(task.projectId))
      .sort((a, b) => {
        const manual=Number(volunteerPending(b,this.nowMs()))-Number(volunteerPending(a,this.nowMs()));if(manual)return manual;
        const left = Date.parse(a.submittedAt || '') || 0;
        const right = Date.parse(b.submittedAt || '') || 0;
        if (left !== right) return left - right;
        return (queueOrder.get(a.id) ?? 0) - (queueOrder.get(b.id) ?? 0);
      });
    const assignments = [];
    for (const task of candidates) {
      if (assignments.length >= slots) break;
      const attemptNumber = (task.activeAttempt || 0) + 1;
      const attempt = {
        attempt: attemptNumber,
        nodeId: node.id,
        claimedAt: this.nowIso(),
        leaseExpiresAt: this.leaseIso(),
        status: 'claimed',
        generationStartedAt: null,
        finishedAt: null,
        error: null,
      };
      task.attempts = Array.isArray(task.attempts) ? task.attempts : [];
      task.attempts.push(attempt);
      task.activeAttempt = attemptNumber;
      task.assignedNodeId = node.id;
      this.forceTaskStatus(task, 'running', PHASE.CLAIMED);
      this.pushEvent(task, 'assigned', `派发给节点「${node.name}」，第 ${attemptNumber} 次尝试`);
      assignments.push({
        manualHelp:volunteerPending(task,this.nowMs())||task.volunteer?.nodeId===node.id&&Date.parse(task.volunteer.expiresAt)>this.nowMs(),
        taskId: task.id,
        attempt: attemptNumber,
        leaseMs: this.config.leaseMs,
        leaseExpiresAt: attempt.leaseExpiresAt,
        payload: this.taskPayload(task),
        references: task.references || [],
      });
    }
    if (assignments.length > 0) {
      node.status.freeSlots = Math.max(0, slots - assignments.length);
      const running = new Set(node.status.runningTaskIds || []);
      for (const assignment of assignments) running.add(assignment.taskId);
      node.status.runningTaskIds = [...running];
      this.hub.touch();
    }
    return assignments;
  }

  taskPayload(task) {
    return {
      type: task.type,
      projectId: task.projectId,
      projectName: task.projectName,
      episode: task.episode,
      panelCode: task.panelCode,
      panelId: task.panelId,
      shotCode: task.shotCode,
      prompt: task.prompt,
      style: task.style,
      size: task.size,
      target: task.target,
      generationInput: task.generationInput,
    };
  }

  // 断线恢复裁决（§5.4）：节点把本地 journal 随心跳上报，中控据此给处置建议。
  judgeJournal(node, journal) {
    if (!Array.isArray(journal) || journal.length === 0) return [];
    const dispositions = [];
    for (const entry of journal.slice(0, 500)) {
      if (!entry || typeof entry !== 'object') continue;
      const taskId = String(entry.taskId || '');
      const attemptNumber = clampInteger(entry.attempt, 0, Number.MAX_SAFE_INTEGER, 0);
      if (!taskId) continue;
      const task = this.hub.getTask(taskId);
      const base = {taskId, attempt: attemptNumber};
      if (!task) {
        dispositions.push({...base, disposition: 'done', message: '任务已不存在或已结束'});
        continue;
      }
      if (task.activeAttempt !== attemptNumber) {
        dispositions.push({...base, disposition: 'late', message: `任务已由第 ${task.activeAttempt} 次尝试接管，旧结果只登记不覆盖`});
        continue;
      }
      if (task.status === 'done') {
        dispositions.push({...base, disposition: 'done', message: '任务已完成，无需继续'});
        continue;
      }
      if (TERMINAL_TASK_STATUSES.includes(task.status)) {
        dispositions.push({...base, disposition: 'abandoned', message: `任务已${task.status === 'failed' ? '失败' : '取消'}`});
        continue;
      }
      const attempt = this.activeAttemptRecord(task);
      if (attempt && attempt.status === 'abandoned') {
        dispositions.push({...base, disposition: 'late', message: '该次尝试已作废，请丢弃本地结果'});
        continue;
      }
      const stage = String(entry.stage || '');
      const hasResult = entry.hasResult === true || stage === 'result_ready';
      if (hasResult) {
        dispositions.push({...base, disposition: 'retry_upload', message: '本地已生成结果，请优先重新上传'});
        continue;
      }
      if (task.status === 'uploading') {
        dispositions.push({...base, disposition: 'retry_upload', message: '中控未收到完整结果，请优先重新上传'});
        continue;
      }
      if (stage === 'unknown') {
        this.forceTaskStatus(task, 'verifying', PHASE.VERIFYING);
        if (attempt) attempt.status = 'unknown';
        this.pushEvent(task, 'verify', '节点上报状态未知，等待核实生成结果');
        this.hub.touch();
        dispositions.push({...base, disposition: 'verify', message: '中控将任务标记为待核实，请查询本机 job 后调用 verify'});
        continue;
      }
      if (task.status === 'verifying') {
        dispositions.push({...base, disposition: 'verify', message: '任务待核实，请查询本机 job 结果后上报 verify'});
        continue;
      }
      if (stage === 'upload_failed') {
        dispositions.push({...base, disposition: 'retry_upload', message: '上次上传失败，请重传已生成的图片'});
        continue;
      }
      dispositions.push({...base, disposition: 'keep', message: '任务仍归本次尝试，请继续查询本机 job'});
    }
    return dispositions;
  }

  // ------------------------------------------------------------------ 节点进度 / 失败 / 核实
  progress(taskId, {attempt, phase, message = ''} = {}, nodeId) {
    const task = this.getTaskOrThrow(taskId);
    check(['generating', 'uploading'].includes(phase), `进度阶段无效：${phase}`, 400, 'invalid_phase');
    if (task.activeAttempt !== attempt) return {ok: true, late: true, task: this.publicTask(task)};
    if (!['running', 'uploading', 'verifying'].includes(task.status)) return {ok: true, late: true, task: this.publicTask(task)};
    const record = this.activeAttemptRecord(task);
    if (record && ['succeeded', 'failed', 'abandoned'].includes(record.status)) {
      return {ok: true, late: true, task: this.publicTask(task)};
    }
    if (task.assignedNodeId && task.assignedNodeId !== nodeId) {
      throw new CollabError('任务未派发给该节点', {status: 409, code: 'not_assigned'});
    }
    if (record) {
      record.leaseExpiresAt = this.leaseIso();
      if (phase === 'generating') {
        record.status = 'generating';
        if (!record.generationStartedAt) record.generationStartedAt = this.nowIso();
      } else {
        record.status = 'uploading';
      }
    }
    if (phase === 'generating') {
      if (task.status === 'running') task.phase = PHASE.GENERATING;
      else this.forceTaskStatus(task, 'running', PHASE.GENERATING);
      this.pushEvent(task, 'generating', message || '节点开始生成');
    } else {
      this.forceTaskStatus(task, 'uploading', PHASE.UPLOADING);
      this.pushEvent(task, 'uploading', message || '节点开始上传结果');
    }
    this.hub.touch();
    return {ok: true, task: this.publicTask(task)};
  }

  failTask(taskId, {attempt, error = '', likelyGenerated = false} = {}, nodeId) {
    const task = this.getTaskOrThrow(taskId);
    if (task.activeAttempt !== attempt) return {ok: true, late: true, task: this.publicTask(task)};
    if (!['running', 'uploading', 'verifying'].includes(task.status)) return {ok: true, late: true, task: this.publicTask(task)};
    if (task.assignedNodeId && task.assignedNodeId !== nodeId) {
      throw new CollabError('任务未派发给该节点', {status: 409, code: 'not_assigned'});
    }
    const record = this.activeAttemptRecord(task);
    if (record && ['succeeded', 'failed', 'abandoned'].includes(record.status)) {
      return {ok: true, late: true, task: this.publicTask(task)};
    }
    const message = typeof error === 'object' && error ? String(error.message || JSON.stringify(error)).slice(0, 2000) : String(error || '').slice(0, 2000);
    if (record) {
      record.finishedAt = this.nowIso();
      record.error = message;
    }
    if (likelyGenerated) {
      if (record) record.status = 'unknown';
      this.forceTaskStatus(task, 'verifying', PHASE.VERIFYING);
      this.pushEvent(task, 'verifying', `节点报告生成可能已发生但结果未知：${message}`);
      this.hub.addNotification({
        level: 'warn',
        type: 'task.verifying',
        title: '生成结果待核实',
        body: `任务 ${task.panelCode || task.id} 由节点「${(this.hub.getNode(nodeId) || {}).name || nodeId}」报告失败，但可能已生成图片，请等待核实。${message ? `（${message}）` : ''}`,
        taskId: task.id,
        nodeId,
      });
      this.hub.touch();
      return {ok: true, task: this.publicTask(task, {includeInput: true})};
    }
    if (record) record.status = 'failed';
    this.forceTaskStatus(task, 'failed', PHASE.FAILED);
    this.pushEvent(task, 'failed', `生成失败：${message}`);
    this.hub.addNotification({
      level: 'error',
      type: 'task.failed',
      title: '协作任务生成失败',
      body: `任务 ${task.panelCode || task.id} 生成失败：${message || '节点未提供原因'}`,
      taskId: task.id,
      nodeId,
    });
    if (this.assets && task.type === 'asset-generation') this.assets.failAssetTask(task, {reason: message});
    this.hub.touch();
    return {ok: true, task: this.publicTask(task, {includeInput: true})};
  }

  verifyTask(taskId, {attempt, outcome, message = ''} = {}, nodeId) {
    const task = this.getTaskOrThrow(taskId);
    check(['result_available', 'no_result', 'still_running'].includes(outcome), `核实结果无效：${outcome}`, 400, 'invalid_outcome');
    if (task.activeAttempt !== attempt) return {ok: true, late: true, task: this.publicTask(task)};
    if (!['running', 'uploading', 'verifying'].includes(task.status)) return {ok: true, late: true, task: this.publicTask(task)};
    if (task.assignedNodeId && task.assignedNodeId !== nodeId) {
      throw new CollabError('任务未派发给该节点', {status: 409, code: 'not_assigned'});
    }
    const record = this.activeAttemptRecord(task);
    if (record && ['succeeded', 'failed', 'abandoned'].includes(record.status)) {
      return {ok: true, late: true, task: this.publicTask(task)};
    }
    const text = String(message || '').slice(0, 1000);
    if (outcome === 'no_result') {
      if (record) {
        record.status = 'failed';
        record.finishedAt = this.nowIso();
        record.error = text || '节点核实本机无生成结果';
      }
      this.forceTaskStatus(task, 'failed', PHASE.FAILED);
      this.pushEvent(task, 'verify', `核实无结果，任务失败${text ? `：${text}` : ''}`);
      this.hub.addNotification({
        level: 'error',
        type: 'task.failed',
        title: '核实后确认生成失败',
        body: `任务 ${task.panelCode || task.id} 经节点核实本机没有生成结果，已标记失败，可重试。`,
        taskId: task.id,
        nodeId,
      });
      if (this.assets && task.type === 'asset-generation') this.assets.failAssetTask(task, {reason: text || '核实无结果'});
      this.hub.touch();
      return {ok: true, task: this.publicTask(task, {includeInput: true})};
    }
    if (outcome === 'result_available') {
      if (record) {
        record.status = 'uploading';
        record.leaseExpiresAt = this.leaseIso();
      }
      if (task.status !== 'verifying') {
        this.forceTaskStatus(task, 'verifying', PHASE.VERIFYING);
        this.hub.addNotification({
          level: 'warn',
          type: 'task.verifying',
          title: '生成结果待核实',
          body: `任务 ${task.panelCode || task.id} 节点已找到结果，等待上传。`,
          taskId: task.id,
          nodeId,
        });
      }
      this.pushEvent(task, 'verify', text || '节点核实结果可用，准备上传');
      this.hub.touch();
      return {ok: true, task: this.publicTask(task)};
    }
    // still_running：保持待核实并续租
    if (record) {
      record.status = 'generating';
      if (!record.generationStartedAt) record.generationStartedAt = this.nowIso();
      record.leaseExpiresAt = this.leaseIso();
    }
    this.forceTaskStatus(task, 'verifying', PHASE.VERIFYING);
    this.pushEvent(task, 'verify', text || '节点核实任务仍在运行，继续等待');
    this.hub.touch();
    return {ok: true, task: this.publicTask(task)};
  }

  // ------------------------------------------------------------------ 结果回传（重复 / 迟到 / 完成）
  uploadResult(taskId, {attempt, sha256: declaredSha = null, buffer, nodeId} = {}) {
    check(Buffer.isBuffer(buffer) && buffer.length > 0, '图片内容为空', 400, 'empty_image');
    const task = this.getTaskOrThrow(taskId);
    const actualSha = sha256Of(buffer);
    if (declaredSha) {
      check(/^[0-9a-f]{64}$/.test(String(declaredSha).toLowerCase()), 'x-sha256 格式无效', 400, 'invalid_sha256');
      check(String(declaredSha).toLowerCase() === actualSha, 'sha256 校验失败：上传内容与声明不一致', 400, 'sha256_mismatch');
    }
    const imageInfo = validateImageBuffer(buffer, {maxBytes: this.config.resultMaxBytes});

    // 旧尝试的迟到结果：先按尝试号判断，确保 reason 准确记为 stale_attempt。
    if (task.activeAttempt !== attempt) {
      if (task.status === 'done' && task.result && task.result.sha256 === actualSha) {
        return {ok: true, duplicate: true, late: true, task: this.publicTask(task), apply: {...task.apply}};
      }
      return this.registerLateResult(task, {attempt, nodeId, buffer, actualSha, reason: 'stale_attempt'});
    }
    // 任务已完成且尝试号匹配：同图视为重复，不同图视为迟到（task_already_done）。
    if (task.status === 'done' && task.result) {
      if (task.result.sha256 === actualSha) {
        return {ok: true, duplicate: true, late: false, task: this.publicTask(task), apply: {...task.apply}};
      }
      return this.registerLateResult(task, {attempt, nodeId, buffer, actualSha, reason: 'task_already_done'});
    }
    if (TERMINAL_TASK_STATUSES.includes(task.status)) {
      return this.registerLateResult(task, {attempt, nodeId, buffer, actualSha, reason: 'task_already_done'});
    }
    if (task.assignedNodeId && task.assignedNodeId !== nodeId) {
      throw new CollabError('任务未派发给该节点', {status: 409, code: 'not_assigned'});
    }
    if (!['running', 'uploading', 'verifying'].includes(task.status)) {
      return this.registerLateResult(task, {attempt, nodeId, buffer, actualSha, reason: 'task_already_done'});
    }
    check(this.assets, '中控资产模块未初始化', 500, 'assets_unavailable');
    const blob = this.assets.putBlobBuffer(buffer, {maxBytes: this.config.resultMaxBytes});
    const record = this.activeAttemptRecord(task);
    if (record) {
      record.status = 'succeeded';
      record.finishedAt = this.nowIso();
      record.leaseExpiresAt = null;
    }
    this.forceTaskStatus(task, 'done', PHASE.DONE);
    task.result = {
      sha256: blob.sha256,
      blobId: blob.blobId,
      size: blob.size,
      mime: blob.mime || imageInfo.mime,
      width: blob.width || imageInfo.width,
      height: blob.height || imageInfo.height,
      nodeId: nodeId || null,
      attempt,
      uploadedAt: this.nowIso(),
    };
    this.pushEvent(task, 'done', '结果已通过 sha256 与图片头校验并入库');
    const node = this.hub.getNode(nodeId);
    if (task.type === 'asset-generation') {
      task.apply = {status: 'skipped', detail: '资产生成任务由中控直接入库，无需回填', at: this.nowIso(), by: 'hub'};
      if (this.assets) this.assets.completeAssetTask(task);
      this.hub.addNotification({
        level: 'success',
        type: 'task.done',
        title: '共享资产生成完成',
        body: `资产生成任务 ${task.id} 已完成并由中控入库。`,
        taskId: task.id,
        nodeId,
      });
    } else {
      this.hub.addNotification({
        level: 'success',
        type: 'task.done',
        title: '协作任务生成完成',
        body: `任务 ${task.panelCode || task.id} 已由节点「${(node && node.name) || nodeId}」完成，等待 A 端自动回填。`,
        taskId: task.id,
        nodeId,
      });
    }
    this.hub.touch();
    return {
      ok: true,
      duplicate: false,
      late: false,
      task: this.publicTask(task),
      apply: {...task.apply},
    };
  }

  registerLateResult(task, {attempt, nodeId, buffer, actualSha, reason}) {
    task.lateResults = Array.isArray(task.lateResults) ? task.lateResults : [];
    const existing = task.lateResults.find((item) => item.sha256 === actualSha && item.attempt === attempt);
    if (existing) {
      return {ok: true, duplicate: true, late: true, task: this.publicTask(task), apply: {...task.apply}};
    }
    let blobId = null;
    if (this.assets) {
      try {
        const blob = this.assets.putBlobBuffer(buffer, {maxBytes: this.config.resultMaxBytes});
        blobId = blob.blobId;
      } catch {
        blobId = null;
      }
    }
    task.lateResults.push({
      sha256: actualSha,
      blobId,
      attempt,
      nodeId: nodeId || null,
      uploadedAt: this.nowIso(),
      reason,
    });
    if (task.lateResults.length > MAX_LATE_RESULTS) task.lateResults = task.lateResults.slice(-MAX_LATE_RESULTS);
    this.pushEvent(task, 'late_result', `收到第 ${attempt} 次尝试的迟到结果（${reason}），只登记不覆盖`);
    this.hub.addNotification({
      level: 'warn',
      type: 'task.late_result',
      title: '收到迟到的生成结果',
      body: `任务 ${task.panelCode || task.id} 收到旧尝试（#${attempt}）的结果，已登记为迟到结果，不会覆盖当前结果。`,
      taskId: task.id,
      nodeId: nodeId || null,
    });
    this.hub.touch();
    return {ok: true, duplicate: false, late: true, task: this.publicTask(task), apply: {...task.apply}};
  }

  // ------------------------------------------------------------------ 取消 / 重试 / apply
  cancelTask(taskId, {by = null} = {}) {
    const task = this.getTaskOrThrow(taskId);
    if (TERMINAL_TASK_STATUSES.includes(task.status)) {
      throw new CollabError('任务已结束，不能取消', {status: 409, code: 'task_already_terminal'});
    }
    const record = this.activeAttemptRecord(task);
    if (record && IN_FLIGHT_ATTEMPT_STATUSES.includes(record.status)) {
      record.status = 'abandoned';
      record.finishedAt = this.nowIso();
      record.error = '任务被取消';
    }
    this.forceTaskStatus(task, 'cancelled', PHASE.CANCELLED);
    task.assignedNodeId = null;delete task.volunteer;
    this.pushEvent(task, 'cancelled', `任务被${by ? ` ${by} ` : ''}取消`);
    if (this.assets && task.type === 'asset-generation') this.assets.failAssetTask(task, {cancelled: true, reason: '任务被取消'});
    this.hub.touch();
    return {ok: true, task: this.publicTask(task)};
  }

  retryTask(taskId, {reason = '', by = null} = {}) {
    const task = this.getTaskOrThrow(taskId);
    if (!['failed', 'verifying', 'cancelled'].includes(task.status)) {
      throw new CollabError('只有失败/待核实/已取消的任务可以重试', {status: 409, code: 'task_not_retryable'});
    }
    // 协议文档 §4.3 允许 verifying → queued 重派，但 protocol.mjs 的迁移表未列出这一条：
    // 这里用 force 包一层，不修改 Lead 维护的 protocol.mjs。
    this.forceTaskStatus(task, 'queued', PHASE.QUEUED);
    task.assignedNodeId = null;delete task.volunteer;
    if (this.assets && task.type === 'asset-generation') this.assets.retryAssetTask(task);
    this.pushEvent(task, 'retried', `任务重新入队${reason ? `：${reason}` : ''}`);
    this.hub.touch();
    return {ok: true, task: this.publicTask(task, {includeInput: true})};
  }

  applyTask(taskId, {status, detail = '', by = null} = {}) {
    const task = this.getTaskOrThrow(taskId);
    check(APPLY_STATUSES.includes(status) && status !== 'pending', `apply 状态无效：${status}`, 400, 'invalid_apply_status');
    const current = task.apply || {status: 'pending', detail: '', at: null, by: null};
    if (current.status === status) {
      return {ok: true, duplicate: true, task: this.publicTask(task, {includeInput: true}), apply: {...current}};
    }
    // §5.10：回填状态只迁移一次；例外：冲突/候选之后用户点「仍然应用」允许 force 成 applied（§8.2）。
    const allowedFrom = ['pending'];
    if (status === 'applied' && (current.status === 'conflict' || current.status === 'candidate')) allowedFrom.push(current.status);
    if (!allowedFrom.includes(current.status)) {
      throw new CollabError(`apply 状态只能从 pending 迁移一次（当前：${current.status}）`, {status: 409, code: 'apply_already_settled'});
    }
    task.apply = {
      status,
      detail: String(detail || '').slice(0, 2000),
      at: this.nowIso(),
      by: by ? String(by).slice(0, 200) : null,
    };
    this.pushEvent(task, 'apply', `A 端回填结果：${status}${detail ? `（${String(detail).slice(0, 300)}）` : ''}`);
    if (status === 'conflict') {
      this.hub.addNotification({
        level: 'warn',
        type: 'task.conflict',
        title: '回填冲突',
        body: `任务 ${task.panelCode || task.id} 的结果与当前编辑版本不一致，已保留为候选，请在协作页处理。`,
        taskId: task.id,
      });
    }
    this.hub.touch();
    return {ok: true, duplicate: false, task: this.publicTask(task, {includeInput: true}), apply: {...task.apply}};
  }

  // ------------------------------------------------------------------ 租约 / 离线 / 重启恢复
  sweepExpiredLeases(nowMs = this.nowMs()) {
    const result = {requeued: [], verifying: []};
    for (const task of this.state.tasks) {
      // §5.9：uploading 且没有结果时保持不动，等待节点重传。
      if (task.status === 'uploading') continue;
      // queued 表示「等待下一次派单」，旧的 activeAttempt 只是历史记录，不能拿它的过期租约做裁决，
      // 否则人工 retry 出来的 queued 任务会在下一次心跳巡检时被误判回 verifying。
      if (task.status === 'queued') continue;
      if (!ACTIVE_TASK_STATUSES.includes(task.status)) continue;
      const attempt = this.activeAttemptRecord(task);
      if (!attempt) {
        if (task.status !== 'queued') {
          this.forceTaskStatus(task, 'queued', PHASE.QUEUED);
          task.assignedNodeId = null;delete task.volunteer;
          this.pushEvent(task, 'lease_expired', '活动尝试缺失，任务回队等待重新派发');
          result.requeued.push(task.id);
        }
        continue;
      }
      if (['succeeded', 'failed', 'abandoned'].includes(attempt.status)) continue;
      const expiresAt = Date.parse(attempt.leaseExpiresAt || '');
      if (!Number.isFinite(expiresAt) || expiresAt >= nowMs) continue;
      if (attempt.status === 'claimed') {
        attempt.status = 'abandoned';
        attempt.finishedAt = this.nowIso();
        attempt.error = '租约过期，任务回队';
        this.forceTaskStatus(task, 'queued', PHASE.QUEUED);
        task.assignedNodeId = null;delete task.volunteer;
        this.pushEvent(task, 'lease_expired', '租约过期且尚未开始生成，任务回队等待重新派发');
        result.requeued.push(task.id);
      } else {
        attempt.status = 'unknown';
        attempt.finishedAt = this.nowIso();
        attempt.error = '租约过期，生成状态未知';
        this.forceTaskStatus(task, 'verifying', PHASE.VERIFYING);
        this.pushEvent(task, 'lease_expired', '租约过期且已开始生成，任务转待核实（不自动重派）');
        this.hub.addNotification({
          level: 'warn',
          type: 'task.verifying',
          title: '节点失联，生成结果待核实',
          body: `任务 ${task.panelCode || task.id} 的节点租约过期，生成可能已发生，已转为待核实，不会自动重派。`,
          taskId: task.id,
          nodeId: attempt.nodeId || null,
        });
        result.verifying.push(task.id);
      }
    }
    if (result.requeued.length || result.verifying.length) this.hub.touch();
    return result;
  }

  sweepOfflineNodes(nowMs = this.nowMs()) {
    const offline = [];
    const timeout = this.config.heartbeatTimeoutMs;
    for (const node of this.state.nodes) {
      if (node.revoked) continue;
      if (!node.status || !node.status.online) continue;
      const lastSeen = Date.parse(node.status.lastSeenAt || '');
      if (Number.isFinite(lastSeen) && nowMs - lastSeen <= timeout) continue;
      node.status.online = false;
      node.status.freeSlots = 0;
      node.status.runningTaskIds = [];
      this.hub.addNotification({
        level: 'warn',
        type: 'node.offline',
        title: '节点离线',
        body: `节点「${node.name}」超过 ${Math.round(timeout / 1000)} 秒没有心跳，已标记离线。`,
        nodeId: node.id,
      });
      offline.push(node.id);
    }
    if (offline.length) this.hub.touch();
    return offline;
  }

  // §5.9：启动时重读 state → 过期租约按 §5.3 裁决；uploading 无结果保持；done+apply=pending 原样保留。
  recoverAfterRestart() {
    const plan = this.hub.getRecoveryPlan(this.nowMs());
    for (const node of this.state.nodes) {
      if (node.status && node.status.online) {
        node.status.online = false;
        node.status.freeSlots = 0;
        node.status.runningTaskIds = [];
      }
    }
    // 活动状态但没有任何尝试记录：除 uploading（等待重传）外回队。
    for (const task of this.state.tasks) {
      if (!ACTIVE_TASK_STATUSES.includes(task.status) || task.status === 'uploading') continue;
      if (this.activeAttemptRecord(task)) continue;
      this.forceTaskStatus(task, 'queued', PHASE.QUEUED);
      task.assignedNodeId = null;delete task.volunteer;
      this.pushEvent(task, 'recovered', '中控重启恢复：缺少活动尝试记录，任务重新入队');
    }
    this.hub.touch();
    const expired = this.sweepExpiredLeases(this.nowMs());
    const summary = {
      checkedAt: plan.checkingAt,
      expiredLeases: plan.expiredLeases.length,
      requeued: expired.requeued.length,
      verifying: expired.verifying.length,
      uploadingWithoutResult: plan.uploadingWithoutResult.length,
      donePendingApply: plan.donePendingApply.length,
      pendingAssetRequests: plan.pendingAssetRequests.length,
      nodesMarkedOffline: plan.onlineNodeIds.length,
    };
    this.logger.info?.(
      `[中控] 重启恢复：过期租约 ${summary.expiredLeases}，回队 ${summary.requeued}，待核实 ${summary.verifying}，` +
        `上传中待重传 ${summary.uploadingWithoutResult}，待回填 ${summary.donePendingApply}，节点置离线 ${summary.nodesMarkedOffline}`,
    );
    return summary;
  }

  startTimers() {
    if (this.timer) return this.timer;
    const interval = Math.max(250, Math.min(5000, Math.floor(this.config.heartbeatTimeoutMs / 3) || 1000));
    this.timer = setInterval(() => {
      try {
        this.sweepExpiredLeases();
        this.sweepOfflineNodes();
      } catch (error) {
        this.logger.error?.(`[中控] 周期巡检失败：${error.message}`);
      }
    }, interval);
    this.timer.unref?.();
    return this.timer;
  }

  stopTimers() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export {ACTIVE_TASK_STATUSES, TERMINAL_TASK_STATUSES, IN_FLIGHT_ATTEMPT_STATUSES, ATTEMPT_STATUSES, isoNow};
