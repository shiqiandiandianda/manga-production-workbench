import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID, createHash, randomBytes} from 'node:crypto';
import {readImageSize} from './archive.mjs';
import {encodeEngineering} from './compact-engineering.mjs';
import {brotliDecompressSync} from 'node:zlib';

export const id = prefix => prefix + '_' + randomUUID();
const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('hex');
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
export function check(condition, message, status = 400) { if (!condition) throw Object.assign(Error(message), {status}); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ACTIVE = ['queued', 'claimed', 'running', 'uncertain'];
export const DEFAULT_RULES = {
  visual: {description: '', referenceFileIds: []},
  characters: {preserveIdentity: true, stateMustBeExplicit: true},
  continuity: {description: ''},
  layout: {pageWidth: 1200, gutter: 24, safeMargin: 40},
  typography: {fontFileIds: [], family: '', minSize: 20, maxSize: 72, lineHeight: 1.3},
  dialogue: {editableText: true, description: ''},
  images: {maxBytes: 30 * 1024 * 1024, minWidth: 1, minHeight: 1, formats: ['png', 'jpeg', 'webp']},
  prompts: {description: '', forbidden: []},
  review: {humanApproval: true}, naming: {}, delivery: {}, permissions: {}, revision: {}
};

export class ProjectCenter {
  constructor(directory) {
    this.directory = path.resolve(directory); fs.mkdirSync(this.directory, {recursive: true});
    this.db = new DatabaseSync(path.join(this.directory, 'projects.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT PRIMARY KEY,project TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_project ON records(project,kind);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,project TEXT,kind TEXT,payload TEXT,created TEXT);
      CREATE TABLE IF NOT EXISTS dependencies(project TEXT,source TEXT,target TEXT,PRIMARY KEY(project,source,target));`);
    // A process restart is not evidence that an upstream image stopped.
    for (const task of this.list('task')) if (['claimed', 'running'].includes(task.status) && task.executor === 'local') {
      task.status = 'uncertain'; task.message = '服务重启，原生成状态待核实，未自动重派'; this.put('task', task);
    }
    for(const upload of this.list('upload'))if(upload.status==='assembling'){upload.status='uploading';this.put('upload',upload);}
  }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  get(kind, key, project) { const r = this.db.prepare('SELECT * FROM records WHERE kind=? AND id=?').get(kind, key); check(r && (!project || r.project === project), '记录不存在或不属于此项目', 404); return JSON.parse(r.payload); }
  maybe(kind, key) { try { return this.get(kind, key); } catch (error) { if (error.status === 404) return null; throw error; } }
  list(kind, project) { return this.db.prepare('SELECT payload FROM records WHERE kind=?' + (project ? ' AND project=?' : '') + ' ORDER BY rowid').all(...(project ? [kind, project] : [kind])).map(r => JSON.parse(r.payload)); }
  put(kind, value) { value.updatedAt = now(); this.db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(kind, value.id, value.projectId || value.id, JSON.stringify(value)); return value; }
  event(project, kind, value) { this.db.prepare('INSERT INTO events(project,kind,payload,created) VALUES(?,?,?,?)').run(project, kind, JSON.stringify(value), now()); }
  events(project, since = 0) { return this.db.prepare('SELECT * FROM events WHERE project=? AND seq>? ORDER BY seq LIMIT 500').all(project, Number(since) || 0).map(r => ({...r, payload: JSON.parse(r.payload)})); }
  createProject(input) {
    check(clean(input.title), '请填写项目名称');
    const p = {id: id('project'), title: clean(input.title, 180), description: clean(input.description, 4000), revision: 1, standardsId: null, createdAt: now()};
    this.put('project', p); this.event(p.id, 'project.created', {id: p.id}); return p;
  }
  upload(projectId, input, bytes) {
    this.get('project', projectId); check(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 128 * 1024 * 1024, '文件为空或超过单次128MB上传限制', 413);
    const name = path.basename(clean(input.name, 240).replaceAll('\\', '/')); check(name && name !== '.' && name !== '..', '文件名无效');
    const digest = hash(bytes), existing = this.list('file', projectId).filter(f => f.name === name);
    const duplicate = existing.find(f => f.sha256 === digest); if (duplicate) return {...duplicate, duplicate: true};
    const extension = path.extname(name).toLowerCase();
    const folder = path.join(this.directory, 'projects', projectId, 'blobs'); fs.mkdirSync(folder, {recursive: true});
    const compressed=input.type==='comic-project'&&extension==='.json'?encodeEngineering(bytes):null;
    const filePath = path.join(folder, digest + extension+(compressed?'.br':'')); if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, compressed||bytes, {flag: 'wx'});
    const record = {id: id('file'), projectId, name, type: clean(input.type || 'original'), mime: clean(input.mime || 'application/octet-stream'), sha256: digest, bytes: bytes.length, path: filePath, version: existing.length + 1, previousId: existing.at(-1)?.id || null, createdAt: now(), sourceId: input.sourceId || null};
    if(compressed)Object.assign(record,{storageEncoding:'br',storageBytes:compressed.length,storageSha256:hash(compressed)});
    if (record.sourceId) this.get('file', record.sourceId, projectId);
    this.put('file', record); if (record.sourceId) this.depend(projectId, record.sourceId, record.id); this.event(projectId, 'file.uploaded', {fileId: record.id, name, version: record.version}); return record;
  }
  readFile(record){const bytes=fs.readFileSync(record.path),raw=record.storageEncoding==='br'?brotliDecompressSync(bytes,{maxOutputLength:128*1024*1024}):bytes;check(hash(raw)===record.sha256,'归档文件摘要不符',422);return raw;}
  draft(projectId, input) {
    this.get('project', projectId); const rules = structuredClone(DEFAULT_RULES);
    for (const [group, value] of Object.entries(input.rules || {})) { check(group in rules && value && typeof value === 'object' && !Array.isArray(value), '规范分类无效：' + group); rules[group] = {...rules[group], ...value}; }
    for (const key of ['pageWidth', 'gutter', 'safeMargin']) check(Number.isFinite(rules.layout[key]) && rules.layout[key] >= 0 && rules.layout[key] <= 20000, '排版数值无效');
    check(rules.layout.pageWidth > 0 && rules.typography.minSize > 0 && rules.typography.maxSize >= rules.typography.minSize, '页面宽度或字号范围无效');
    check(Array.isArray(rules.images.formats) && rules.images.formats.length && rules.images.formats.every(x => ['png', 'jpeg', 'webp'].includes(x)), '图片格式规范无效');
    const sources = [...new Set(input.sourceFileIds || [])]; for (const fileId of [...sources, ...rules.visual.referenceFileIds, ...rules.typography.fontFileIds]) this.get('file', fileId, projectId);
    const record = {id: id('standard'), projectId, status: 'draft', number: this.list('standard', projectId).length + 1, rules, sourceFileIds: sources, notes: clean(input.notes, 30000), createdAt: now()};
    this.put('standard', record); return record;
  }
  publish(projectId, standardId, expectedRevision) {
    return this.tx(() => {
      const project = this.get('project', projectId), standard = this.get('standard', standardId, projectId);
      check(project.revision === expectedRevision, '项目已变化，请刷新后发布', 409); check(standard.status === 'draft', '只能发布草稿规范', 409);
      const previousId = project.standardsId; standard.status = 'published'; standard.publishedAt = now(); this.put('standard', standard);
      project.standardsId = standard.id; project.revision++; this.put('project', project);
      this.event(projectId, 'standards.published', {standardId, number: standard.number, previousId});
      if (previousId) this.invalidate(projectId, [previousId], '项目规范发布了新版本');
      return {project, standard};
    });
  }
  standards(projectId) { const project = this.get('project', projectId); check(project.standardsId, '请先确认并发布项目规范', 409); return this.get('standard', project.standardsId, projectId); }
  depend(projectId, source, target) { check(source !== target, '不能依赖自身'); this.db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?)').run(projectId, source, target); }
  impact(projectId, sources) {
    const seen = new Set(sources), queue = [...sources], affected = new Set();
    while (queue.length) for (const r of this.db.prepare('SELECT target FROM dependencies WHERE project=? AND source=?').all(projectId, queue.shift())) if (!seen.has(r.target)) { seen.add(r.target); affected.add(r.target); queue.push(r.target); }
    return [...affected].map(key => { const r = this.db.prepare('SELECT kind,payload FROM records WHERE id=? AND project=?').get(key, projectId); return r ? {kind: r.kind, ...JSON.parse(r.payload)} : {id: key, kind: 'external'}; });
  }
  invalidate(projectId, sources, reason) {
    const affected = this.impact(projectId, sources);
    for (const r of affected) if (r.kind !== 'external') { const {kind, ...value} = r; value.stale = true; value.staleReason = reason; if (kind === 'task' && value.status === 'queued') value.status = 'needs_update'; this.put(kind, value); }
    this.event(projectId, 'dependencies.invalidated', {sources, reason, affected: affected.map(r => ({id: r.id, kind: r.kind}))}); return affected;
  }
  change(projectId, input) {
    this.get('project', projectId); const sources = [...new Set(input.sourceIds || [])]; check(sources.length && clean(input.description), '请填写修改说明并选择来源');
    for (const source of sources) check(this.db.prepare('SELECT id FROM records WHERE id=? AND project=?').get(source, projectId), '改动来源不属于此项目', 404);
    const change = {id: id('change'), projectId, description: clean(input.description, 10000), sourceIds: sources, status: 'draft', createdAt: now()}; this.put('change', change); return {...change, affected: this.impact(projectId, sources)};
  }
  commitChange(projectId, key) { return this.tx(() => { const c = this.get('change', key, projectId); check(c.status === 'draft', '变更已处理', 409); const affected = this.invalidate(projectId, c.sourceIds, c.description); c.status = 'committed'; c.affectedIds = affected.map(r => r.id); this.put('change', c); return {...c, affected}; }); }
  requestAsset(projectId, input) {
    return this.tx(() => {
      const standard = this.standards(projectId); check(['character', 'scene', 'prop'].includes(input.role), '请选择角色、场景或道具'); check(clean(input.name) && clean(input.prompt, 18000), '资产名称和要求不能为空');
      check(input.role!=='character'||standard.rules.characters.stateMustBeExplicit!==true||clean(input.state),'请明确角色的服装或形态，避免不同状态混用');
      const referenceIds = [...new Set([...(standard.rules.visual.referenceFileIds || []), ...(input.referenceFileIds || [])])]; check(referenceIds.length <= 3, '每个任务最多3张固定参考图');
      for (const fileId of referenceIds) { const file = this.get('file', fileId, projectId); check(readImageSize(fs.readFileSync(file.path)).format, '参考必须是图片'); }
      const canonicalKey = clean(input.canonicalKey || input.name).normalize('NFKC').toLowerCase(), state = clean(input.state), assets = this.list('asset', projectId);
      let asset = assets.find(a => a.role === input.role && a.canonicalKey === canonicalKey && a.state === state);
      if (!asset) asset = this.put('asset', {id: id('asset'), projectId, role: input.role, name: clean(input.name), canonicalKey, state, approvedVersionId: null, createdAt: now()});
      const subscribers = clean(input.requester || '未命名同事');
      const usages=[...(asset.usages||[]),...(input.usages||[])];asset.usages=[...new Map(usages.map(u=>[JSON.stringify([u.tool,u.episode,u.unitId,u.shotId,u.targetId]),u])).values()];asset.subscribers=[...new Set([...(asset.subscribers||[]),subscribers])];this.put('asset',asset);
      if (asset.approvedVersionId && !asset.stale && !input.newCandidate) {this.event(projectId,'asset.reused',{assetId:asset.id,versionId:asset.approvedVersionId,requester:subscribers,usages:input.usages||[]});return {asset, version: this.get('version', asset.approvedVersionId, projectId), reused: true};}
      const signature = hash(JSON.stringify([asset.id, standard.id, referenceIds, input.prompt]));
      const active = this.list('task', projectId).find(t => t.signature === signature && [...ACTIVE, 'review'].includes(t.status));
      if (active) { active.subscribers = [...new Set([...active.subscribers, subscribers])]; active.usages=asset.usages;this.put('task', active); return {asset, task: active, duplicate: true}; }
      const key = clean(input.clientRequestId, 180); if (key) { const previous = this.list('task', projectId).find(t => t.clientRequestId === key); if (previous) { check(previous.signature === signature, '请求编号已用于不同内容', 409); return {asset, task: previous, duplicate: true}; } }
      const task = {id: id('task'), projectId, assetId: asset.id, role: input.role, name: asset.name, signature, clientRequestId: key || id('request'), subscribers: [subscribers], responsible: subscribers, episode: input.episode || null, usages: input.usages || [], status: 'queued', standardsId: standard.id, referenceFileIds: referenceIds, engine: input.role === 'character' ? 'workshop' : 'scene', executor: input.executor === 'distributed' ? 'distributed' : 'local', prompt: clean(input.prompt, 18000), compiledPrompt: ['项目统一规范：' + JSON.stringify(standard.rules), '本项资产：' + input.name, state ? '服装/形态：' + state : '', input.prompt].filter(Boolean).join('\n'), generation: 0, createdAt: now()};
      this.put('task', task); this.depend(projectId, standard.id, task.id); for (const ref of referenceIds) this.depend(projectId, ref, task.id); this.depend(projectId, task.id, asset.id);
      this.event(projectId, 'asset.requested', {assetId: asset.id, taskId: task.id, requester: subscribers}); return {asset, task};
    });
  }
  candidate(taskId, bytes, lease = null) {
    return this.tx(() => {
      const task = this.get('task', taskId); if (task.executor === 'distributed') this.validateLease(task,lease); if (task.versionId) { const old = this.get('version', task.versionId); check(old.sha256 === hash(bytes), '同一任务已回传不同结果', 409); return old; }
      check(['running', 'claimed', 'uncertain'].includes(task.status), '任务当前不能回传', 409); if (task.executor === 'distributed') this.validateLease(task, lease);
      const standard = this.get('standard', task.standardsId, task.projectId), spec = standard.rules.images, info = readImageSize(bytes);
      check(info.format && spec.formats.includes(info.format), '图片格式不符合项目规范', 415); check(info.width >= spec.minWidth && info.height >= spec.minHeight && bytes.length <= spec.maxBytes, '图片尺寸或大小不符合项目规范', 422);
      const file = this.upload(task.projectId, {name: task.name + '.' + (info.format === 'jpeg' ? 'jpg' : info.format), type: 'generated', mime: 'image/' + info.format}, bytes);
      const version = {id: id('version'), projectId: task.projectId, assetId: task.assetId, taskId, fileId: file.id, sha256: file.sha256, width: info.width, height: info.height, standardsId: task.standardsId, number: this.list('version', task.projectId).filter(v => v.assetId === task.assetId).length + 1, status: 'review', stale: !!task.stale, createdAt: now()};
      this.put('version', version); this.depend(task.projectId, task.id, version.id); this.depend(task.projectId, task.assetId, version.id); task.versionId = version.id; task.status = 'review'; task.message = '候选图已回传，等待看图确认'; this.put('task', task); this.event(task.projectId, 'asset.review_ready', {taskId, versionId: version.id}); return version;
    });
  }
  approve(projectId, key, input) {
    return this.tx(() => {
      const v = this.get('version', key, projectId), a = this.get('asset', v.assetId, projectId), p = this.get('project', projectId);
      check(!v.stale && v.standardsId === p.standardsId, '候选所用规范或来源已变化，请先复核更新', 409);
      if (v.status === 'approved' && a.approvedVersionId === v.id) return {asset:a, version:v, usages:this.get('task',v.taskId).usages};
      check((input.expectedApprovedVersionId ?? null) === a.approvedVersionId, '正式版本已变化，请刷新后确认', 409);
      check(v.status === 'review' || v.status === 'approved', '候选状态不可采用', 409);
      v.status = 'approved'; this.put('version', v); a.approvedVersionId = v.id; a.stale = false; this.put('asset', a);
      const task = this.get('task', v.taskId, projectId); task.status = 'done'; this.put('task', task);
      this.event(projectId, 'asset.approved', {assetId: a.id, versionId: v.id, usages: task.usages, subscribers: task.subscribers}); return {asset: a, version: v, usages: task.usages};
    });
  }
  bind(projectId, input) {
    const v = this.get('version', input.versionId, projectId); check(v.status === 'approved' && !v.stale, '只能绑定已确认的有效版本', 409);
    check(clean(input.tool) && clean(input.targetId), '绑定缺少工具或目标编号');
    const old = this.list('binding', projectId).find(b => b.tool === input.tool && b.targetId === input.targetId && b.role === input.role);
    if (old?.locked) { check(old.versionId === v.id, '目标已锁定，保留原版本', 409); return old; }
    if (old) check(input.expectedVersionId === old.versionId, '目标引用已变化，请刷新后同步', 409);
    const b = {...old, id: old?.id || id('binding'), projectId, versionId: v.id, tool: clean(input.tool), targetId: clean(input.targetId), role: clean(input.role), episode: input.episode, responsible: clean(input.responsible), locked: !!input.locked, stale: false};
    this.put('binding', b); this.depend(projectId, v.id, b.id); return b;
  }
  progress(projectId, input) {
    this.get('project', projectId); check(clean(input.person) && Number.isInteger(input.episode) && input.episode > 0, '请填写同事和话数');
    check(['script', 'assets', 'storyboard', 'layout', 'generation', 'repair', 'review', 'export', 'done'].includes(input.stage), '生产阶段无效');
    const previous = this.list('progress', projectId).find(p => p.person === input.person && p.episode === input.episode);
    const total = Number(input.total) || 0, completed = Number(input.completed) || 0; check(total >= 0 && completed >= 0 && completed <= total, '进度数量无效');
    const result = this.put('progress', {...previous, id: previous?.id || id('progress'), projectId, person: clean(input.person), episode: input.episode, stage: input.stage, completed, total, message: clean(input.message), activeTarget: clean(input.activeTarget)});
    this.event(projectId, 'progress.updated', result); return result;
  }
  heartbeat(input) {
    check(clean(input.poolId) && clean(input.machineId), '节点需要机器和执行池唯一编号');
    const existing = this.list('worker').find(w => w.poolId === input.poolId && w.machineId === input.machineId);
    const registrationHash=input.registrationKey?hash(String(input.registrationKey)):null;
    check(!existing?.ownerId || existing.ownerId === input.ownerId || registrationHash&&registrationHash===existing.registrationHash, '执行池已由其他接单器注册', 403);
    const capacity = Math.min(6, Math.max(0, Math.floor(Number(input.capacity) || 0))), active = Math.max(0, Math.floor(Number(input.localActive) || 0));
    const reserved = Math.min(capacity,Math.max(0,Math.floor(Number(input.reserve)||0)));
    const w = this.put('worker', {id: existing?.id || id('worker'), projectId: '_workers', ownerId: input.ownerId, machineId: clean(input.machineId), poolId: clean(input.poolId), name: clean(input.name || input.machineId), projects: input.projectIds || [], roles: (input.roles || []).filter(r => ['character', 'scene', 'prop'].includes(r)), capacity, reserve:reserved, localActive: active, paused: !!input.paused, ready: input.ready === true, message: clean(input.message, 500), lastSeen: Date.now()});
    w.registrationHash=existing?.registrationHash||registrationHash;w.ownerIds=[...new Set([...(existing?.ownerIds||[]),existing?.ownerId,input.ownerId].filter(Boolean))].slice(-8);this.put('worker',w);return w;
  }
  claim(workerId, allowedProjects=null) {
    return this.tx(() => {
      this.expire(); const w = this.get('worker', workerId); check(Date.now() - w.lastSeen < 15000, '节点心跳已过期', 409);
      if (w.paused || !w.ready) return {tasks: []};
      const inflight = this.list('task').filter(t => t.workerId === w.id && ['claimed', 'running', 'uncertain'].includes(t.status));
      // Conservative admission: a delayed local occupancy report must not oversubscribe.
      let free = Math.max(0, w.capacity - (w.reserve||0) - w.localActive - inflight.length);
      const tasks = [];
      for (const t of this.list('task').filter(t => t.status === 'queued' && t.executor === 'distributed').sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        if (!free) break; if (!w.projects.includes(t.projectId) || !w.roles.includes(t.role) || allowedProjects?.length&&!allowedProjects.includes(t.projectId)) continue;
        t.workerId = w.id; t.status = 'claimed'; t.leaseToken = randomBytes(24).toString('hex'); t.leaseUntil = Date.now() + 120000; t.generation++; this.put('task', t); tasks.push(t); free--;
      }
      return {tasks};
    });
  }
  validateLease(t, input) { check(input && input.workerId === t.workerId && input.leaseToken === t.leaseToken, '节点或任务租约不符', 409); }
  taskProgress(key, input) { const t = this.get('task', key); this.validateLease(t, input); check(['claimed', 'running'].includes(t.status), '任务需要人工核实', 409); t.status = input.started ? 'running' : t.status; t.leaseUntil = Date.now() + 120000; t.message = clean(input.message); this.put('task', t); return t; }
  fail(key, input) { const t = this.get('task', key); if(t.versionId&&['review','done'].includes(t.status))return t; if (t.executor === 'distributed') this.validateLease(t, input); t.status = input.generationEnded === true ? 'failed' : 'uncertain'; t.message = clean(input.message); this.put('task', t); this.event(t.projectId, 'task.' + t.status, {taskId: t.id, message: t.message}); return t; }
  expire() { for (const t of this.list('task')) if (['claimed', 'running'].includes(t.status) && t.executor === 'distributed' && t.leaseUntil < Date.now()) { t.status = t.status === 'claimed' ? 'queued' : 'uncertain'; t.message = t.status === 'uncertain' ? '节点失联，原生成待核实，未自动重派' : '尚未开始的任务重新排队'; t.workerId = t.status === 'queued' ? null : t.workerId; this.put('task', t); } }
  retry(projectId, key, input) {
    const t=this.get('task',key,projectId),staleReview=t.stale&&['review','done'].includes(t.status);
    check(['failed','uncertain','needs_update'].includes(t.status)||staleReview,'任务当前不可重试',409);
    check(t.status!=='uncertain'||input.confirmRemoteStopped===true,'请先确认原生成已结束',409);
    if(t.stale)check(input.confirmUpdated===true&&clean(input.prompt,18000),'请按最新要求核对并提交资产提示词',409);
    const old=this.get('standard',t.standardsId),standard=this.standards(projectId),contentReferences=t.referenceFileIds.filter(k=>!old.rules.visual.referenceFileIds.includes(k));
    t.referenceFileIds=[...new Set([...standard.rules.visual.referenceFileIds,...contentReferences])];check(t.referenceFileIds.length<=3,'新规范参考图超过3张，请调整后重试');
    for(const fileId of t.referenceFileIds){this.get('file',fileId,projectId);this.depend(projectId,fileId,t.id);}
    t.attempts=[...(t.attempts||[]),{generation:t.generation,versionId:t.versionId,jobId:t.localJobId,standardsId:t.standardsId,finishedAt:now()}];
    if(input.prompt)t.prompt=clean(input.prompt,18000);t.standardsId=standard.id;t.status='queued';t.stale=false;t.versionId=null;t.message='';t.workerId=null;t.localJobId=null;t.compiledPrompt='项目统一规范：'+JSON.stringify(standard.rules)+'\n'+t.prompt;
    this.depend(projectId,standard.id,t.id);this.put('task',t);return t;
  }
  dashboard(projectId) { const project = this.get('project', projectId); this.expire(); return {project, files: this.list('file', projectId), standards: this.list('standard', projectId), assets: this.list('asset', projectId), versions: this.list('version', projectId), tasks: this.list('task', projectId).map(({leaseToken, ...t}) => t), progress: this.list('progress', projectId), artifacts: this.list('artifact',projectId), bindings: this.list('binding', projectId), changes: this.list('change', projectId), workers: this.list('worker').filter(w => w.projects.includes(projectId)).map(w => ({...w, online: Date.now() - w.lastSeen < 15000}))}; }
  close() { this.db.close(); }
}
