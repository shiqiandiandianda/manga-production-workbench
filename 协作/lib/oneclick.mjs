// 一键启动 / 一键加入 的共同工具：定位路径、探测本机服务、自动拉起制作工具、配对、控制台输出。
// 只依赖 node 内置模块与 ./protocol.mjs；不新增任何 npm 依赖。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import readline from 'node:readline/promises';
import {readJson, writeJsonAtomic, ensureDir, safeFileSegment} from './protocol.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const COLLAB_DIR = path.resolve(HERE, '..');
export const DEV_DIR = path.resolve(COLLAB_DIR, '..');
export const PACKAGE_ROOT = path.resolve(DEV_DIR, '..');
export const NODE_BIN = path.join(DEV_DIR, 'workbench', '运行环境', 'node', 'node.exe');
export const TOOL_LAUNCHER = path.join(PACKAGE_ROOT, '启动漫画融合版.cmd');
export const COMIC_ORIGIN_DEFAULT = 'http://127.0.0.1:18896';
export const HUB_PORT_DEFAULT = 18897;
export const HUB_CONFIG_FILE = path.join(COLLAB_DIR, 'config', 'hub.json');
export const RUN_DATA_DIR = path.join(DEV_DIR, '运行数据', '协作');
export const HUB_APPLICATION = 'photocraft-collab-hub';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function line(text = '') {
  console.log(text);
}

export function section(title) {
  console.log('');
  console.log('==============================================================');
  console.log('  ' + title);
  console.log('==============================================================');
}

export function step(index, total, text) {
  console.log('');
  console.log(`[${index}/${total}] ${text}`);
}

export function ok(text) {
  console.log('  [OK] ' + text);
}

export function warn(text) {
  console.log('  [!]  ' + text);
}

export function bad(text) {
  console.log('  [X]  ' + text);
}

export function info(text) {
  console.log('       ' + text);
}

export function clock(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// HTTP 小工具：JSON 请求 + 超时；中控/漫画服务都是本机或局域网明文 HTTP。
// ---------------------------------------------------------------------------
export async function httpJson(url, {method = 'GET', headers = {}, body, token, timeoutMs = 8000} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestHeaders = {...headers};
    if (body !== undefined && requestHeaders['content-type'] === undefined) requestHeaders['content-type'] = 'application/json; charset=utf-8';
    if (token) requestHeaders['x-collab-token'] = token;
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      signal: controller.signal,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = {raw: text};
    }
    return {ok: response.ok, status: response.status, body: parsed};
  } finally {
    clearTimeout(timer);
  }
}

function stripSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function normalizeHubUrl(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) text = 'http://' + text;
  return stripSlash(text);
}

export async function comicHealth(origin = COMIC_ORIGIN_DEFAULT, timeoutMs = 1500) {
  try {
    const response = await httpJson(stripSlash(origin) + '/api/health', {timeoutMs});
    if (!response.ok || !response.body) return null;
    if (!String(response.body.application || '').startsWith('comic-merged')) return null;
    return response.body;
  } catch {
    return null;
  }
}

export async function hubHealth(origin, timeoutMs = 1500) {
  try {
    const response = await httpJson(stripSlash(origin) + '/api/health', {timeoutMs});
    return response.ok && response.body && response.body.application === HUB_APPLICATION ? response.body : null;
  } catch {
    return null;
  }
}

// 用固定 URL 和参数启动一个分离进程（不阻塞本脚本）。
function launchDetached(file, args = [], cwd = PACKAGE_ROOT) {
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '', `"${file}"`, ...args], {
      cwd,
      windowsHide: false,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch (error) {
    warn('自动打开失败：' + (error && error.message ? error.message : error));
    return false;
  }
}

export function openBrowser(url) {
  return launchDetached(url);
}

// 检查/自动拉起本机制作工具（18896 漫画服务）。返回 {ok, started, health}。
export async function ensureComicService({origin = COMIC_ORIGIN_DEFAULT, autoStart = true, timeoutMs = 180000} = {}) {
  const existing = await comicHealth(origin);
  if (existing) {
    ok(`制作工具已在运行：${origin}`);
    return {ok: true, started: false, health: existing};
  }
  if (!autoStart) {
    bad(`没有检测到本机漫画服务（${origin}），请先双击「启动漫画融合版.cmd」。`);
    return {ok: false, started: false, health: null};
  }
  if (!fs.existsSync(TOOL_LAUNCHER)) {
    bad('找不到制作工具启动器：' + TOOL_LAUNCHER);
    info('请确认使用完整的软件包目录，不要单独复制某个文件。');
    return {ok: false, started: false, health: null};
  }
  warn('制作工具还没启动，正在自动打开（会弹出编辑器窗口，请稍等）…');
  launchDetached(TOOL_LAUNCHER);
  const startedAt = Date.now();
  let nextNoticeAt = startedAt + 10000;
  while (Date.now() - startedAt < timeoutMs) {
    const health = await comicHealth(origin);
    if (health) {
      ok(`制作工具已启动（用时约 ${Math.round((Date.now() - startedAt) / 1000)} 秒）`);
      return {ok: true, started: true, health};
    }
    if (Date.now() >= nextNoticeAt) {
      info(`仍在等待制作工具启动…（已等 ${Math.round((Date.now() - startedAt) / 1000)} 秒）`);
      nextNoticeAt = Date.now() + 10000;
    }
    await sleep(1000);
  }
  bad('等待制作工具启动超时。');
  info('请手动双击「启动漫画融合版.cmd」，看到编辑器后再试一次。');
  return {ok: false, started: true, health: null};
}

// 中控配置文件：没有就按默认值创建一份，避免用户手工复制。
export function ensureHubConfigFile({port = HUB_PORT_DEFAULT, host = '0.0.0.0'} = {}) {
  if (fs.existsSync(HUB_CONFIG_FILE)) {
    const existing = readJson(HUB_CONFIG_FILE, null);
    return {created: false, config: existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}};
  }
  const config = {
    port,
    host,
    dataDir: '../../运行数据/协作/中控',
    hubName: 'PhotoCraft 协作中控',
  };
  writeJsonAtomic(HUB_CONFIG_FILE, config);
  return {created: true, config};
}

// 本机局域网 IPv4：优先 192.168.x / 10.x / 172.16-31。
export function lanAddress() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = typeof entry.family === 'string' ? entry.family : `IPv${entry.family}`;
      if (family !== 'IPv4' || entry.internal) continue;
      if (!entry.address || entry.address.startsWith('169.254.')) continue;
      addresses.push(entry.address);
    }
  }
  const score = (address) => {
    if (address.startsWith('192.168.')) return 0;
    if (address.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
    return 3;
  };
  return [...new Set(addresses)].sort((a, b) => score(a) - score(b) || a.localeCompare(b))[0] || '127.0.0.1';
}

export function nodeDataDir(name) {
  return path.join(RUN_DATA_DIR, `节点-${safeFileSegment(name || 'node', 'node')}`);
}

export function nodeConfigPath(name, dataDirOverride = null) {
  return path.join(dataDirOverride ? path.resolve(dataDirOverride) : nodeDataDir(name), 'config.json');
}

export function readJsonFile(file) {
  try {
    return readJson(file, null);
  } catch {
    return null;
  }
}

// 写节点配置（字段与 节点.mjs pair 落盘的一致，便于以后双击 启动协作节点.cmd 也能用）。
export function writeNodeConfigFile(file, config) {
  ensureDir(path.dirname(file));
  writeJsonAtomic(file, config);
  return file;
}

// 只读探测节点 token 是否还有效：节点 token 调客户端接口应得到 403（有权限校验说明 token 有效）。
export async function probeNodeToken(hubUrl, token) {
  if (!token) return false;
  try {
    const response = await httpJson(stripSlash(hubUrl) + '/api/nodes', {token, timeoutMs: 4000});
    if (response.status === 403) return true;
    if (response.status === 401) return false;
    return response.ok === true;
  } catch {
    return false;
  }
}

export async function pairingCodeForHub(runtime) {
  return String(runtime?.hub?.state?.pairingCode || '').trim();
}

// 让 A 端漫画服务与中控配对（协作页即可直接使用，不用手填）。
export async function ensureComicClientPairing({comicOrigin, hubUrl, pairingCode, expectedHubId = null, clientName = 'A电脑'}) {
  const base = stripSlash(comicOrigin);
  let status = null;
  try {
    const response = await httpJson(base + '/api/collab/status', {timeoutMs: 6000});
    status = response.body;
  } catch {
    status = null;
  }
  if (!status || status.configured === undefined) {
    return {
      ok: false,
      error: '当前漫画服务还是旧代码（没有协作接口）。请完全关闭制作工具后，重新双击「启动漫画融合版.cmd」。',
    };
  }
  const currentHubId = status?.hub?.hubId || null;
  if (status.configured === true && currentHubId && expectedHubId && currentHubId === expectedHubId) {
    return {ok: true, reused: true, status};
  }
  try {
    const response = await httpJson(base + '/api/collab/pair', {
      method: 'POST',
      body: {hubUrl, pairingCode, clientName},
      timeoutMs: 15000,
    });
    if (!response.ok) {
      return {ok: false, error: response.body?.error || `配对失败（HTTP ${response.status}）`};
    }
    return {ok: true, reused: false, status: response.body};
  } catch (error) {
    return {ok: false, error: '配对请求失败：' + (error && error.message ? error.message : error)};
  }
}

// 交互式输入（只在第一台以外的电脑首次加入时需要问两个问题）。
export function createPrompter() {
  let interfaceRef = null;
  const getInterface = () => {
    if (!interfaceRef) interfaceRef = readline.createInterface({input: process.stdin, output: process.stdout});
    return interfaceRef;
  };
  return {
    async ask(question) {
      const answer = await getInterface().question(question);
      return String(answer || '').trim();
    },
    close() {
      if (interfaceRef) {
        interfaceRef.close();
        interfaceRef = null;
      }
    },
  };
}

export function nodeConfigFromPairing({hubUrl, paired, nodeName, dataDir, comicOrigin, provider = 'codex', maxConcurrency = 2, existing = null}) {
  return {
    hubUrl,
    token: paired.token,
    nodeName,
    dataDir,
    localComic: {origin: stripSlash(comicOrigin), provider},
    maxConcurrency: Number(maxConcurrency) || 2,
    enabled: true,
    paused: false,
    allowedProjectIds: [],
    allowedTaskTypes: ['panel-generation', 'asset-generation'],
    heartbeatMs: 3000,
    pollMs: 1200,
    uploadRetries: 6,
    taskTimeoutMs: 1800000,
    hubId: paired.hubId || null,
    hubName: paired.hubName || '',
    clientId: paired.clientId || null,
    nodeId: paired.nodeId || null,
    protocolVersion: paired.protocolVersion || null,
    pairedAt: new Date().toISOString(),
    ...(existing ? {previousPairedAt: existing.pairedAt || null} : {}),
  };
}
