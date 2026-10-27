/**
 * 工作台配置：一次读取、校验后内存缓存，写入走原子替换。
 * 关键点（吸收两个旧版的教训）：
 *  - 任何路径类配置都要显式校验，避免写错目录后静默乱写；
 *  - 密钥/令牌只返回前缀，接口永不明文回显；
 *  - 配置损坏时不允许带病运行，直接报明确错误。
 */
import path from 'node:path';
import {randomBytes, createHash} from 'node:crypto';
import {atomicJson, readJson, ensureDir, safeName} from './store.mjs';
import {files, paths} from './paths.mjs';

export const SETTINGS_VERSION = 2;

export const DEFAULT_NAMING_TEMPLATE = '{project}/{type}/{character}_{outfit}_{view}_{version}';

export function defaultSettings() {
  return {
    settingsVersion: SETTINGS_VERSION,
    bindHost: '0.0.0.0',
    port: 8790,
    lanEnabled: true,
    /** 是否需要令牌才能调用局域网接单/素材接口 */
    requireToken: true,
    scene: {
      port: 8891,
      codexPath: '',
      /** Codex 的 home 目录；留空表示自动：优先用用户 ~/.codex，不可写时用 data/codex-home */
      codexHome: '',
      imageSize: '1536x864'
    },
    workshop: {
      port: 8892,
      autostart: true,
      maxConcurrentJobs: 4,
      pythonPath: ''
    },
    intake: {
      maxConcurrentJobs: 4,
      maxItemsPerJob: 20,
      jobTimeoutSeconds: 5400,
      callbackRetries: 5,
      callbackTimeoutSeconds: 15,
      /** 工单被取消时是否中断已经排队到引擎的任务 */
      cancelPropagates: true
    },
    naming: {
      template: DEFAULT_NAMING_TEMPLATE,
      timeZone: 'Asia/Shanghai',
      collision: 'version',
      lowerCaseExtensions: true
    },
    destinations: [
      {id: 'local', label: '本机素材库', path: './assets', role: 'primary', writable: true, enabled: true},
      {
        id: 'share',
        label: '局域网存放电脑（示例：请改成实际共享路径后启用）',
        path: '\\\\SERVER\\Assets',
        role: 'archive',
        writable: true,
        enabled: false
      }
    ],
    /** 素材检索时额外纳入索引的目录 */
    additionalRoots: [],
    mimeAllow: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/json', 'text/plain', 'video/mp4'],
    maxUploadBytes: 64 * 1024 * 1024
  };
}

function resolveDir(value, base = paths.data) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, path.sep === '\\' ? '\\' : '/');
  if (/^([a-zA-Z]:[\\/]|\\\\|\/\/)/.test(raw)) return path.normalize(normalized);
  return path.resolve(base, normalized);
}

export function normalizeDestination(input, index) {
  const id = safeName(input?.id || `dest${index + 1}`, {max: 40, fallback: `dest${index + 1}`});
  const rawPath = String(input?.path || '').trim();
  if (!rawPath) throw Object.assign(new Error(`存储位置 ${id} 缺少 path。`), {status: 400, code: 'destination_path_missing'});
  return {
    id,
    label: String(input?.label || id).slice(0, 120),
    path: resolveDir(rawPath),
    rawPath,
    role: ['primary', 'archive', 'mirror'].includes(input?.role) ? input.role : 'archive',
    writable: input?.writable !== false,
    enabled: input?.enabled !== false,
    /** 该位置是否追加“项目名/类型”两级子目录，留空表示完全由命名模板决定 */
    subdir: input?.subdir ? String(input.subdir).slice(0, 200) : ''
  };
}

function validateSettings(input) {
  const merged = {...defaultSettings(), ...input};
  const problems = [];
  const port = Number(merged.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) problems.push('端口需为 1024-65535 的整数。');
  if (merged.bindHost !== '0.0.0.0' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(String(merged.bindHost))) problems.push('监听地址需为 0.0.0.0 或具体 IPv4 地址。');
  const destinations = [];
  (Array.isArray(merged.destinations) ? merged.destinations : []).forEach((entry, index) => {
    try {
      destinations.push(normalizeDestination(entry, index));
    } catch (error) {
      problems.push(error.message);
    }
  });
  const ids = new Set();
  for (const destination of destinations) {
    if (ids.has(destination.id)) problems.push(`存储位置 id 重复：${destination.id}`);
    ids.add(destination.id);
  }
  if (!destinations.some(entry => entry.enabled)) problems.push('至少需要启用一个存储位置。');
  if (!destinations.some(entry => entry.enabled && entry.role === 'primary')) problems.push('需要有一个启用中的 primary 存储位置。');
  const template = String(merged.naming?.template || '').trim();
  if (!template) problems.push('命名模板不能为空。');
  const mimeAllow = (Array.isArray(merged.mimeAllow) ? merged.mimeAllow : []).map(String).filter(Boolean);
  if (!mimeAllow.length) problems.push('允许入库的文件类型不能为空。');
  if (problems.length) throw Object.assign(new Error(problems.join(' ')), {status: 400, code: 'settings_invalid'});
  return {
    ...merged,
    port,
    destinations,
    mimeAllow,
    additionalRoots: (Array.isArray(merged.additionalRoots) ? merged.additionalRoots : [])
      .map(entry => (typeof entry === 'string' ? {id: safeName(path.basename(entry) || 'root'), label: entry, path: resolveDir(entry)} : {...entry, path: resolveDir(entry.path)}))
      .filter(entry => entry.path),
    naming: {
      template,
      timeZone: String(merged.naming?.timeZone || 'Asia/Shanghai'),
      collision: ['version', 'overwrite', 'skip', 'hash'].includes(merged.naming?.collision) ? merged.naming.collision : 'version',
      lowerCaseExtensions: merged.naming?.lowerCaseExtensions !== false
    },
    intake: {
      maxConcurrentJobs: clampInt(merged.intake?.maxConcurrentJobs, 1, 16, 4),
      maxItemsPerJob: clampInt(merged.intake?.maxItemsPerJob, 1, 200, 20),
      jobTimeoutSeconds: clampInt(merged.intake?.jobTimeoutSeconds, 60, 86400, 5400),
      callbackRetries: clampInt(merged.intake?.callbackRetries, 0, 12, 5),
      callbackTimeoutSeconds: clampInt(merged.intake?.callbackTimeoutSeconds, 3, 120, 15),
      cancelPropagates: merged.intake?.cancelPropagates !== false
    },
    scene: {
      port: clampInt(merged.scene?.port, 1024, 65535, 8891),
      codexPath: String(merged.scene?.codexPath || '').trim(),
      codexHome: String(merged.scene?.codexHome || '').trim(),
      imageSize: merged.scene?.imageSize === '2048x1152' ? '2048x1152' : '1536x864'
    },
    workshop: {
      port: clampInt(merged.workshop?.port, 1024, 65535, 8892),
      autostart: merged.workshop?.autostart !== false,
      maxConcurrentJobs: clampInt(merged.workshop?.maxConcurrentJobs, 1, 8, 4),
      pythonPath: String(merged.workshop?.pythonPath || '').trim()
    },
    maxUploadBytes: clampInt(merged.maxUploadBytes, 1024, 1024 * 1024 * 1024, 64 * 1024 * 1024)
  };
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const rounded = Math.round(number);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

export function createConfig() {
  let cache = null;
  let loading = null;
  const listeners = new Set();

  async function load() {
    await ensureDir(paths.data);
    const raw = await readJson(files.settings, null);
    const settings = validateSettings(raw || {});
    cache = settings;
    return settings;
  }

  async function read() {
    if (cache) return cache;
    loading ||= load().finally(() => {
      loading = null;
    });
    return await loading;
  }

  return {
    async read() {
      return await read();
    },
    async update(patch) {
      const current = await read();
      const combined={...current,...patch};
      for(const group of ['scene','workshop','intake','naming'])if(patch[group])combined[group]={...current[group],...patch[group]};
      const next = validateSettings(combined);
      next.settingsVersion = SETTINGS_VERSION;
      await atomicJson(files.settings, next, {backup: true});
      cache = next;
      for (const listener of listeners) listener(next);
      return next;
    },
    async reload() {
      cache = null;
      return await read();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 返回给界面/接口的可见配置（不含任何密钥） */
    async safe() {
      const current = await read();
      return {
        settingsVersion: current.settingsVersion,
        bindHost: current.bindHost,
        port: current.port,
        lanEnabled: current.lanEnabled,
        requireToken: current.requireToken,
        naming: current.naming,
        destinations: current.destinations.map(entry => ({...entry, exists: undefined})),
        additionalRoots: current.additionalRoots,
        intake: current.intake,
        scene: current.scene,
        workshop: current.workshop,
        settingsFile: files.settings
      };
    },
    normalizeDestination
  };
}

/* --------------------------------- 令牌 --------------------------------- */

const TOKEN_PREFIX = 'wab_';
const SCOPES = new Set(['intake', 'read', 'write', 'admin']);

export function generateToken() {
  return TOKEN_PREFIX + randomBytes(24).toString('base64url');
}

export function tokenDigest(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function createTokenStore() {
  let cache = null;

  async function load() {
    const raw = await readJson(files.tokens, null);
    const tokens = Array.isArray(raw?.tokens) ? raw.tokens : [];
    cache = {version: 1, tokens};
    return cache;
  }

  async function persist() {
    await atomicJson(files.tokens, cache, {backup: true});
  }

  return {
    async list() {
      const store = cache || (await load());
      return store.tokens.map(entry => ({
        id: entry.id,
        label: entry.label,
        prefix: entry.prefix,
        scopes: entry.scopes,
        projectIds: entry.projectIds || [],
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt || null,
        callCount: entry.callCount || 0,
        enabled: entry.enabled !== false,
        expiresAt: entry.expiresAt || null
      }));
    },
    async create({label, scopes = ['intake', 'read'], expiresInDays = 0, projectIds = []} = {}) {
      const store = cache || (await load());
      const cleanScopes = scopes.filter(scope => SCOPES.has(scope));
      if (!cleanScopes.length) throw Object.assign(new Error('令牌至少需要一个权限：intake/read/write/admin。'), {status: 400, code: 'token_scope_invalid'});
      const token = generateToken();
      const record = {
        id: 'tok_' + randomBytes(6).toString('hex'),
        label: String(label || '未命名调用方').slice(0, 80),
        prefix: token.slice(0, 12),
        digest: tokenDigest(token),
        scopes: cleanScopes,
        projectIds: [...new Set(projectIds.map(String))],
        createdAt: new Date().toISOString(),
        enabled: true,
        expiresAt: expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null,
        callCount: 0
      };
      store.tokens.push(record);
      await persist();
      return {token, id: record.id, label: record.label, scopes: record.scopes};
    },
    async remove(id) {
      const store = cache || (await load());
      const index = store.tokens.findIndex(entry => entry.id === id);
      if (index < 0) throw Object.assign(new Error('令牌不存在。'), {status: 404, code: 'token_missing'});
      store.tokens.splice(index, 1);
      await persist();
      return {removed: id};
    },
    async setEnabled(id, enabled) {
      const store = cache || (await load());
      const record = store.tokens.find(entry => entry.id === id);
      if (!record) throw Object.assign(new Error('令牌不存在。'), {status: 404, code: 'token_missing'});
      record.enabled = !!enabled;
      await persist();
      return {id, enabled: record.enabled};
    },
    /** 校验并记录使用情况（不阻塞调用：计数失败不影响请求） */
    async verify(token, requiredScope) {
      const store = cache || (await load());
      const digest = tokenDigest(token);
      const record = store.tokens.find(entry => entry.digest === digest);
      if (!record) return {ok: false, reason: '令牌不正确。'};
      if (record.enabled === false) return {ok: false, reason: '令牌已被停用。'};
      if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) return {ok: false, reason: '令牌已过期。'};
      if (requiredScope && !record.scopes.includes(requiredScope) && !record.scopes.includes('admin')) {
        return {ok: false, reason: `令牌缺少 ${requiredScope} 权限。`};
      }
      record.lastUsedAt = new Date().toISOString();
      record.callCount = (record.callCount || 0) + 1;
      persist().catch(() => {});
      return {ok: true, record};
    },
    hasAny() {
      return !!cache?.tokens?.length;
    }
  };
}
