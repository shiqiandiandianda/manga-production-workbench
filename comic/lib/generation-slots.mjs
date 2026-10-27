import {randomBytes} from 'node:crypto';
import {mkdirSync, readFileSync} from 'node:fs';
import {writeFileAtomicSync} from './durable-files.mjs';
import path from 'node:path';
import {DEFAULT_CONCURRENCY,MAX_CONCURRENCY,validatePlatformConcurrency} from './concurrency.mjs';

const failure = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const aborted = () => Object.assign(new Error('生成任务已取消'), {name:'AbortError'});
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const validPid = pid => Number.isSafeInteger(pid) && pid > 0;
const ENDED_REQUEST_TTL_MS = 24*60*60*1000, ENDED_REQUEST_LIMIT = 1000, ENDED_REQUEST_SLACK = 200;
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\x00-\x1f]/.test(value);
const json = (res, value, status = 200) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
async function body(req) { let data = '', bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) throw failure('队列请求过大', 413); data += chunk; } try { return JSON.parse(data || '{}'); } catch { throw failure('队列请求格式错误'); } }

export const MAX_IMAGE_CONCURRENCY = MAX_CONCURRENCY;
export function normalizeImageConcurrency(value = DEFAULT_CONCURRENCY) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.min(MAX_IMAGE_CONCURRENCY, Math.floor(parsed))) : DEFAULT_CONCURRENCY;
}

// One coordinator lives in the comic service. Its durable leases also cover
// detached repair workers after either Node service is restarted.
export class GenerationSlots {
  constructor({directory, limit = DEFAULT_CONCURRENCY, platforms, onChange=()=>{}, isAlive = alive, pollMs = 150, remoteTtlMs = 2*60*60*1000} = {}) {
    if (!directory) throw new Error('生成队列需要数据目录');
    this.limit = normalizeImageConcurrency(limit);
    this.platforms = platforms ? validatePlatformConcurrency(platforms) : null;
    if(this.platforms)this.limit=this.platforms.main;
    this.providerLimits=null;
    this.remoteTtlMs=Number.isFinite(Number(remoteTtlMs))&&Number(remoteTtlMs)>0?Number(remoteTtlMs):2*60*60*1000;
    this.waiters=new Map();this.onChange=onChange;this.notificationPending=false;
    this.isAlive = isAlive;
    this.pollMs = pollMs;
    mkdirSync(directory, {recursive:true});
    this.file = path.join(directory, 'leases.json');
    try { this.state = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw failure('生成队列记录损坏，已停止启动以避免重复生成', 500); this.state = {version:1, leases:[], requests:{}}; }
    if (this.state.version !== 1 || !Array.isArray(this.state.leases) || !this.state.requests || typeof this.state.requests !== 'object') throw failure('生成队列记录格式不正确', 500);
    for (const lease of this.state.leases) if (typeof lease.key!=='string' || lease.key.length>481 || !validId(lease.ownerId) || !validId(lease.requestId) || lease.key!==`${lease.ownerId}:${lease.requestId}` || !/^[a-f0-9]{64}$/.test(lease.token) || !validPid(lease.ownerPid) || !Array.isArray(lease.workerPids) || lease.workerPids.some(pid => !validPid(pid)) || !Number.isFinite(lease.createdAt) || (lease.claimedPid!==null && !validPid(lease.claimedPid)) || (lease.provider!==undefined && lease.provider!==null && (typeof lease.provider!=='string' || lease.provider.length>40))) throw failure('生成队列记录格式不正确', 500);
    const keys = new Set(this.state.leases.map(lease=>lease.key)), tokens = new Set(this.state.leases.map(lease=>lease.token));
    if(keys.size!==this.state.leases.length || tokens.size!==this.state.leases.length || this.state.leases.some(lease=>this.state.requests[lease.key]?.status!=='active') || Object.entries(this.state.requests).some(([key,request])=>request?.status==='active' && !keys.has(key)))throw failure('生成队列记录不完整，已停止启动以避免重复生成',500);
    this.reap();
  }
  save() {
    this.prune();
    writeFileAtomicSync(this.file, JSON.stringify(this.state), {mode:0o600});
    this.notify();
  }
  // 已结束的生成身份只用于拒绝同一身份的重复提交（几分钟内的事）；它们以前永久保存，leases.json 随生成次数
  // 无限变大，每次取放名额都要整份重写。这里只保留最近 24 小时、最多约 1000 条已结束记录，进行中的从不清理。
  prune(now=Date.now()) {
    if(now-(this.lastPrune||0)<60_000&&Object.keys(this.state.requests).length<=ENDED_REQUEST_LIMIT+ENDED_REQUEST_SLACK)return 0;
    this.lastPrune=now;
    const ended=Object.entries(this.state.requests).filter(([,request])=>request?.status!=='active');
    if(ended.length<=ENDED_REQUEST_LIMIT&&!ended.some(([,request])=>now-(request.endedAt||0)>ENDED_REQUEST_TTL_MS))return 0;
    const keep=new Set(ended.filter(([,request])=>now-(request.endedAt||0)<=ENDED_REQUEST_TTL_MS).sort((a,b)=>(b[1].endedAt||0)-(a[1].endedAt||0)).slice(0,ENDED_REQUEST_LIMIT).map(([key])=>key));
    let removed=0;for(const [key] of ended)if(!keep.has(key)){delete this.state.requests[key];removed++;}
    return removed;
  }
  notify(){if(this.notificationPending)return;this.notificationPending=true;queueMicrotask(()=>{this.notificationPending=false;this.onChange();});}
  cleanWaiters(){for(const [key,request] of this.waiters)if(!this.isAlive(request.ownerPid)||(!request.queued&&Date.now()-request.updatedAt>30000)){this.waiters.delete(key);this.notify();}}
  enqueue({ownerId,ownerPid=process.pid,requestId=ownerId}={}){
    if(!validId(ownerId)||!validId(requestId)||!validPid(ownerPid)||this.platform(ownerId)!=='repair')throw failure('补图优先排队身份不正确');
    if(!this.isAlive(ownerPid))throw failure('生成所属进程已退出',409);
    const key=`${ownerId}:${requestId}`,previous=this.state.requests[key];
    if(previous&&previous.status!=='active')throw failure('本次生成身份已结束，不能重复提交',410);
    if(this.state.leases.some(lease=>lease.key===key))return {ok:true};
    const old=this.waiters.get(key);this.waiters.set(key,{ownerId,ownerPid,requestId,queued:true,updatedAt:Date.now()});if(!old)this.notify();return {ok:true};
  }
  mainLimit(){
    if(!this.platforms)return this.limit;
    this.cleanWaiters();
    const demand=this.waiters.size>0||this.state.leases.some(lease=>this.platform(lease.ownerId)==='repair');
    return demand?this.platforms.main-this.platforms.repair:this.platforms.main;
  }
  reap() {
    let changed = false;
    this.state.leases = this.state.leases.filter(lease => {
      // A CLI can exit while its submitted cloud image is still running. A
      // remote lease needs an explicit result/query; local PID death is no proof.
      // It still expires eventually: a crashed/stale remote reservation must not
      // consume a slot forever.
      if (lease.remoteUnknown === true) {
        if (Date.now() - lease.createdAt <= this.remoteTtlMs) return true;
        this.state.requests[lease.key] = {status:'abandoned', endedAt:Date.now()};
        changed = true;
        return false;
      }
      const workersAlive = lease.workerPids.some(pid => this.isAlive(pid));
      const reservationExpired = !lease.workerPids.length && Date.now() - lease.createdAt > 30000;
      if (workersAlive || (!lease.releaseRequested && !reservationExpired && this.isAlive(lease.ownerPid))) return true;
      this.state.requests[lease.key] = {status:lease.releaseRequested ? 'released' : 'abandoned', endedAt:Date.now()};
      changed = true;
      return false;
    });
    if (changed) this.save();
    return this.state.leases.length;
  }
  tryAcquire({ownerId, ownerPid = process.pid, requestId = ownerId, recoveryOnly = false, provider = null} = {}) {
    if (!validId(ownerId) || !validId(requestId) || !validPid(ownerPid)) throw failure('生成请求编号或进程编号不正确');
    if (provider !== null && provider !== undefined && (typeof provider !== 'string' || provider.length > 40)) throw failure('生成渠道编号不正确');
    this.reap();
    const key = `${ownerId}:${requestId}`;
    const previous = this.state.requests[key];
    if (previous && previous.status !== 'active') throw failure('本次生成身份已结束，不能重复提交', 410);
    const remote = this.state.leases.find(lease => lease.ownerId === ownerId && lease.remoteUnknown === true);
    if (remote && remote.key !== key) {
      if (!recoveryOnly) throw Object.assign(failure('该镜头云端状态尚未确定，请恢复原任务查询，不能再次提交', 409), {recoverable:true,requiredAction:'resume'});
      if (!this.isAlive(ownerPid)) throw failure('恢复所属进程已退出', 409);
      this.state.requests[remote.key] = {status:'superseded', endedAt:Date.now()};
      remote.key=key;remote.requestId=requestId;remote.ownerPid=ownerPid;
      // Old callbacks cannot clear or register against a recovery attempt.
      remote.token=randomBytes(32).toString('hex');
      remote.claimedPid=null;remote.releaseRequested=false;remote.provider=provider||remote.provider||null;
      this.state.requests[key] = {status:'active', createdAt:Date.now()};
      this.save();
      return this.lease(remote.token);
    }
    const existing = this.state.leases.find(lease => lease.key === key);
    if (existing) {
      if (existing.ownerPid !== ownerPid || existing.releaseRequested) throw failure('本次生成已由其他进程接管或取消', 409);
      return this.lease(existing.token);
    }
    if(this.platforms){
      const platform=this.platform(ownerId);
      this.cleanWaiters();
      if(platform==='repair'){
        const old=this.waiters.get(key);this.waiters.set(key,{ownerId,ownerPid,requestId,queued:old?.queued===true,updatedAt:Date.now()});if(!old)this.notify();
      }
      const ceiling=platform==='repair'?this.platforms.repair:this.mainLimit();
      if(this.state.leases.length>=this.limit||this.state.leases.filter(lease=>this.platform(lease.ownerId)===platform).length>=ceiling)return null;
      // The user-facing per-provider limit must also cover side paths
      // (asset center, effects, collaboration), not just the main job queue.
      if(platform==='main'&&provider&&this.providerLimits?.get(provider)){
        const used=this.state.leases.filter(lease=>this.platform(lease.ownerId)==='main'&&lease.provider===provider).length;
        if(used>=this.providerLimits.get(provider))return null;
      }
      if(platform==='repair'&&this.waiters.keys().next().value!==key)return null;
    }else if (this.state.leases.length >= this.limit) return null;
    if (!this.isAlive(ownerPid)) throw failure('生成所属进程已退出', 409);
    const item = {key, ownerId, requestId, ownerPid, provider:provider||null, token:randomBytes(32).toString('hex'), workerPids:[], claimedPid:null, releaseRequested:false, remoteUnknown:false, createdAt:Date.now()};
    this.state.leases.push(item);
    this.waiters.delete(key);
    this.state.requests[key] = {status:'active', createdAt:item.createdAt};
    this.save();
    return this.lease(item.token);
  }
  async acquire(options = {}) {
    const {signal} = options;
    try{
    for (;;) {
      if (signal?.aborted) throw aborted();
      const lease = this.tryAcquire(options);
      if (lease) {
        if (signal?.aborted) { lease.release(); throw aborted(); }
        return lease;
      }
      await new Promise((resolve, reject) => {
        const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); resolve(); };
        const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(aborted()); };
        const timer = setTimeout(finish, this.pollMs);
        signal?.addEventListener('abort', cancel, {once:true});
        if (signal?.aborted) cancel();
      });
    }
    }catch(error){if(signal?.aborted)this.cancelRequest(options);throw error;}
  }
  item(token) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) throw failure('生成队列身份无效', 403);
    const lease = this.state.leases.find(item => item.token === token);
    if (!lease) throw failure('生成队列身份已结束', 410);
    return lease;
  }
  track(token, pid, claim = false) {
    const item = this.item(token);
    if (item.releaseRequested) throw failure('生成队列身份已取消', 410);
    if (!validPid(pid) || !this.isAlive(pid)) throw failure('生成进程已退出或编号不正确', 409);
    if (claim && item.claimedPid && item.claimedPid !== pid) throw failure('本次生成身份已有工作进程，禁止重复生成', 409);
    if (claim) item.claimedPid = pid;
    if (!item.workerPids.includes(pid)) item.workerPids.push(pid);
    this.save();
    return {ok:true};
  }
  release(token, {completed = false} = {}) {
    const item = this.state.leases.find(item => item.token === token);
    if (!item) return {ok:true};
    // A persistent Codex worker remains alive while idle. Only an explicit
    // completion from its owner clears that worker's finished task lease.
    if (completed) {
      this.state.leases = this.state.leases.filter(lease => lease.token !== token);
      this.state.requests[item.key] = {status:'released', endedAt:Date.now()};
      this.save();
      return {ok:true};
    }
    item.releaseRequested = true;
    this.save();
    this.reap();
    return {ok:true};
  }
  cancelRequest({ownerId, ownerPid = process.pid, requestId = ownerId} = {}) {
    if (!validId(ownerId) || !validId(requestId) || !validPid(ownerPid)) throw failure('生成请求编号或进程编号不正确');
    const key = `${ownerId}:${requestId}`;
    const waiter=this.waiters.get(key);if(waiter&&waiter.ownerPid!==ownerPid)throw failure('生成任务所属进程不匹配',409);
    if(this.waiters.delete(key))this.notify();
    const item = this.state.leases.find(item => item.key === key);
    if (item && item.ownerPid !== ownerPid) throw failure('生成任务所属进程不匹配', 409);
    if (item) return this.release(item.token);
    if (!this.state.requests[key]) { this.state.requests[key] = {status:'cancelled', endedAt:Date.now()}; this.save(); }
    return {ok:true};
  }
  keepRemote(token) { const item=this.item(token);if(item.releaseRequested)throw failure('生成队列身份已取消',410);item.remoteUnknown=true;this.save();return {ok:true}; }
  listRemote() { return this.state.leases.filter(lease=>lease.remoteUnknown===true).map(({ownerId,token})=>({ownerId,token})); }
  lease(token) { return {token, trackPid:pid => this.track(token, pid), keepRemote:()=>this.keepRemote(token), release:options => this.release(token, options)}; }
  setLimit(value) { if(!this.platforms)this.limit=normalizeImageConcurrency(value); return this.snapshot(); }
  setProviderLimits(limits) {
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) { this.providerLimits = null; return this.snapshot(); }
    const next = new Map();
    for (const [name, value] of Object.entries(limits)) {
      const count = Number(value);
      if (typeof name === 'string' && name.length > 0 && name.length <= 40 && Number.isFinite(count) && count >= 1) next.set(name, Math.min(MAX_CONCURRENCY, Math.floor(count)));
    }
    this.providerLimits = next.size ? next : null;
    this.notify();
    return this.snapshot();
  }
  platform(ownerId){return ownerId.startsWith('repair:')?'repair':'main';}
  setPlatforms(value){this.platforms=validatePlatformConcurrency(value);this.limit=this.platforms.main;this.notify();return this.snapshot();}
  snapshot() {
    this.reap();
    const result={running:this.state.leases.length, concurrency:this.limit};
    if(this.platforms)result.platforms=Object.fromEntries(Object.entries(this.platforms).map(([name,concurrency])=>[name,{concurrency:name==='main'?this.mainLimit():concurrency,running:this.state.leases.filter(lease=>this.platform(lease.ownerId)===name).length}]));
    return result;
  }
  async handle(req, res, url) {
    if (!url.pathname.startsWith('/api/generation-slots/')) return false;
    try {
      // Only server-side local callers use these endpoints. Browser requests
      // have no reason to acquire a slot or learn a worker's bearer token.
      if (req.headers.origin) throw failure('生成队列仅供本机服务调用', 403);
      if (req.method !== 'POST') throw failure('生成队列请求方法不正确', 405);
      const input = await body(req);
      const action = url.pathname.slice('/api/generation-slots/'.length);
      if(action==='enqueue')json(res,this.enqueue(input));
      else if (action === 'acquire') {
        const lease = this.tryAcquire(input);
        json(res, lease ? {token:lease.token} : {waiting:true}, lease ? 200 : 202);
      } else if (action === 'cancel') {
        json(res, this.cancelRequest(input));
      } else {
        const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
        if (action === 'track' || action === 'claim') json(res, this.track(token, input.pid, action === 'claim'));
        else if (action === 'release') { if (!token) throw failure('生成队列身份无效', 403); json(res, this.release(token, {completed:input.completed === true})); }
        else throw failure('队列操作不存在', 404);
      }
    } catch (error) { json(res, {error:error.message}, error.statusCode || 500); }
    return true;
  }
}

export class GenerationSlotsClient {
  constructor({origin, fetcher = fetch, pollMs = 200, timeoutMs = 5000} = {}) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('生成队列必须连接本机漫画服务');
    this.origin = url.origin;
    this.fetcher = fetcher;
    this.pollMs = pollMs;
    this.timeoutMs = timeoutMs;
  }
  async call(action, input, token, signal) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try { response = await this.fetcher(`${this.origin}/api/generation-slots/${action}`, {method:'POST', headers:{'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})}, body:JSON.stringify(input), signal:requestSignal}); }
    catch (error) { if (signal?.aborted) throw aborted(); throw failure('无法连接统一生成队列，请保持漫画服务运行；未启动新的生图任务', 503); }
    const value = await response.json();
    if (!response.ok) throw failure(value.error || '统一生成队列拒绝请求', response.status);
    return {value, status:response.status};
  }
  async acquire({ownerId, ownerPid = process.pid, requestId = ownerId, signal} = {}) {
    const identity = {ownerId, ownerPid, requestId};
    try {
    for (;;) {
      if (signal?.aborted) throw aborted();
      const {value, status} = await this.call('acquire', identity, null, signal);
      if (status !== 202) return {token:value.token, origin:this.origin, trackPid:pid => this.call('track', {pid}, value.token), release:options => this.call('release', {completed:options?.completed === true}, value.token)};
      await new Promise((resolve, reject) => { const timer = setTimeout(finish, this.pollMs); function finish() { signal?.removeEventListener('abort', cancel); resolve(); } function cancel() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(aborted()); } signal?.addEventListener('abort', cancel, {once:true}); if (signal?.aborted) cancel(); });
    }
    } catch (error) { if (signal?.aborted) await this.call('cancel', identity).catch(() => {}); throw error; }
  }
  enqueue(identity){return this.call('enqueue',identity);}
  cancel(identity){return this.call('cancel',identity);}
}
