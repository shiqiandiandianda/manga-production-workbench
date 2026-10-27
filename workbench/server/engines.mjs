/**
 * 引擎适配层：工作台自己不重新实现生图，而是把两类引擎接进来。
 *
 *  1) 场景引擎（场记）：Node 服务，跑在回环地址上，负责剧本拆解和"正打+反打"分镜出图；
 *  2) 角色引擎（角色工房）：Python 服务，跑在回环地址上，负责任意角色/服装/手部/群像出图。
 *
 * 两个引擎都只监听 127.0.0.1（旧版就是这么写的，也是这两个工具的安全边界），
 * 对局域网的开口统一由工作台的接单 API 负责，避免把内部维护接口直接暴露到网上。
 */
import path from 'node:path';
import {spawn} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {readdir, stat, mkdir, writeFile, copyFile, access} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {paths} from './paths.mjs';
import {ensureDir} from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------ Codex 运行目录 ------------------------------ */

/**
 * Codex CLI 需要在自己的 home 目录下建临时目录、写会话文件。
 * 有些环境（受限令牌、只读配置介质、企业策略）会让 ~/.codex 无法写入，
 * Codex 会以 "failed to initialize in-process app-server client: 拒绝访问" 直接失败。
 *
 * 处理策略：先判断用户自己的 ~/.codex 是否可写，能写就直接用（登录态只有一份，最省心）；
 * 不能写就在工作台数据目录下建一个托管 home，并把登录信息复制过去，
 * 之后两个引擎都用这个 home，出图流程不受影响。
 */
export async function ensureCodexHome({logger, configured = ''} = {}) {
  if (configured && configured.trim()) {
    const custom = path.resolve(configured.trim());
    await ensureDir(custom);
    return custom;
  }
  const userHome = process.env.CODEX_HOME && process.env.CODEX_HOME.trim()
    ? path.resolve(process.env.CODEX_HOME.trim())
    : path.join(process.env.USERPROFILE || process.env.HOME || paths.data, '.codex');
  if (await isWritableDir(userHome)) return userHome;

  const managed = path.join(paths.data, 'codex-home');
  await ensureDir(managed);
  await ensureDir(path.join(managed, 'tmp'));
  for (const name of ['auth.json', 'config.toml']) {
    const source = path.join(userHome, name);
    if (!existsSync(source)) continue;
    const target = path.join(managed, name);
    try {
      // 只在缺失或用户重新登录（源文件更新）时同步，避免每次启动都写盘
      const [sourceInfo, targetInfo] = await Promise.all([
        stat(source),
        stat(target).catch(() => null)
      ]);
      if (!targetInfo || sourceInfo.mtimeMs > targetInfo.mtimeMs) {
        await copyFile(source, target);
        logger?.info('已同步 Codex 登录信息到工作台托管目录', {source, target});
      }
    } catch (error) {
      logger?.warn('同步 Codex 登录信息失败', {name, error: error.message});
    }
  }
  logger?.info('用户 ~/.codex 不可写，改用工作台托管目录', {managed, userHome});
  return managed;
}

async function isWritableDir(directory) {
  try {
    await access(directory, fsConstants.W_OK);
    const probe = path.join(directory, `.__wb_write_probe_${process.pid}`);
    await writeFile(probe, 'ok');
    const {unlink} = await import('node:fs/promises');
    await unlink(probe).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/* --------------------------- 本机 AI 助手的令牌 --------------------------- */

const ASSISTANT_LABEL = '本机 AI 助手（自动）';

/**
 * 不必让用户手工建令牌：工作台启动时自己签一个，并写成本机文件。
 * Codex 只要读这个文件就能调接口（文件在 data 目录里，不进版本库）。
 * 每次重启轮换一次，旧令牌立即失效，避免长期有效的明文令牌留在磁盘上。
 */
export function createAssistantToken({tokens, logger, file}) {
  let current = null;

  async function rotate() {
    const list = await tokens.list();
    for (const token of list.filter(item => item.label === ASSISTANT_LABEL)) {
      await tokens.remove(token.id).catch(() => {});
    }
    const created = await tokens.create({
      label: ASSISTANT_LABEL,
      scopes: ['intake', 'read', 'write'],
      expiresInDays: 90
    });
    current = created.token;
    await ensureDir(path.dirname(file));
    await writeFile(file, `${created.token}\n`, {encoding: 'utf8', mode: 0o600});
    logger?.info('已自动签发本机助手令牌并写入文件', {file, id: created.id});
    return created.token;
  }

  return {
    rotate,
    read: async () => {
      if (current) return current;
      try {
        const text = await (await import('node:fs/promises')).readFile(file, 'utf8');
        const value = text.trim();
        if (value) {
          current = value;
          return value;
        }
      } catch {
        /* 文件还没生成 */
      }
      return null;
    },
    file
  };
}

/* ------------------------------ Node 运行时 ------------------------------ */

/** 优先用随包 Node，其次用当前进程，最后用 PATH 上的 node。 */
export function resolveNodeBinary() {
  if (process.execPath && existsSync(process.execPath)) return process.execPath;
  if (existsSync(paths.runtimeNode)) return paths.runtimeNode;
  return 'node';
}

export function resolvePythonBinary(configured = '') {
  const candidates = [
    configured,
    paths.runtimePython,
    path.join(paths.root, 'engine', 'workshop', 'runtime', 'python', 'python.exe'),
    path.join('C:', 'Python313', 'python.exe')
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'python';
}

export function findCodexBinary(configured = '') {
  const candidates = [];
  if (configured) candidates.push(configured);
  if (process.env.SCENE_CODEX_PATH) candidates.push(process.env.SCENE_CODEX_PATH);
  if (process.env.CODEX_CLI_PATH) candidates.push(process.env.CODEX_CLI_PATH);
  const localAppData = process.env.LOCALAPPDATA || '';
  if (localAppData) {
    const binRoot = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
    if (existsSync(binRoot)) {
      try {
        for (const entry of readdirSync(binRoot)) candidates.push(path.join(binRoot, entry, 'codex.exe'));
      } catch {
        /* 忽略：退回到已知路径 */
      }
    }
    candidates.push(path.join(localAppData, 'Programs', 'codex', 'codex.exe'));
    candidates.push(path.join(localAppData, 'Programs', 'Codex', 'codex.exe'));
  }
  if (paths.runtimeCodex) candidates.push(path.join(paths.runtimeCodex, 'codex.exe'));
  candidates.push(path.join(paths.root, 'runtime', 'Codex', 'codex.exe'));
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return '';
}

/* -------------------------------- HTTP 小工具 -------------------------------- */

export async function httpJson(url, {method = 'GET', body, headers = {}, timeoutMs = 30_000, token, origin} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
        // 上游引擎按"只允许本机工作台页面"校验 Origin；服务端调用必须自报为那个页面。
        ...(origin ? {Origin: origin} : {}),
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {raw: text};
      }
    }
    if (!response.ok) {
      const message = data?.error || data?.message || `上游返回 ${response.status}`;
      throw Object.assign(new Error(message), {status: response.status, code: 'upstream_error', payload: data});
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForHttp(url, {timeoutMs = 60_000, intervalMs = 500, accept} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const data = await httpJson(url, {timeoutMs: 3000});
      if (!accept || accept(data)) return data;
      lastError = new Error('服务已响应但未就绪。');
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw Object.assign(new Error(`等待服务就绪超时：${url}（${lastError?.message || '无响应'}）`), {code: 'service_timeout'});
}

/* ------------------------------- 场景引擎（Node） ------------------------------- */

export function createSceneEngine({config, logger}) {
  let child = null;
  let starting = null;

  async function port() {
    return (await config.read()).scene.port;
  }

  async function status() {
    const p = await port();
    try {
      const data = await httpJson(`http://127.0.0.1:${p}/api/status`, {timeoutMs: 4000});
      return {running: true, port: p, info: data};
    } catch (error) {
      return {running: false, port: p, error: error.message};
    }
  }

  async function start() {
    if (starting) return starting;
    starting = (async () => {
      const settings = await config.read();
      if ((await status()).running) return {alreadyRunning: true, port: settings.scene.port};
      const serverFile = path.join(paths.sceneApp, 'server', 'index.mjs');
      if (!existsSync(serverFile)) throw Object.assign(new Error(`场景引擎缺少文件：${serverFile}`), {code: 'scene_server_missing'});
      await ensureDir(paths.sceneData);
      await ensureDir(path.join(paths.sceneData, 'images'));
      const env = {
        ...process.env,
        SCENE_PORT: String(settings.scene.port),
        SCENE_DATA_DIR: paths.sceneData,
        NODE_ENV: process.env.NODE_ENV || 'production'
      };
      if (settings.scene.codexPath) env.SCENE_CODEX_PATH = settings.scene.codexPath;
      const codexHome = await ensureCodexHome({logger, configured: settings.scene.codexHome});
      env.CODEX_HOME = codexHome;
      child = spawn(resolveNodeBinary(), [serverFile], {cwd: paths.sceneApp, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
      child.stdout.on('data', chunk => logger?.info('scene', {line: String(chunk).trim()}));
      child.stderr.on('data', chunk => logger?.warn('scene', {line: String(chunk).trim()}));
      child.on('exit', code => {
        logger?.warn('场景引擎退出', {code});
        child = null;
      });
      await waitForHttp(`http://127.0.0.1:${settings.scene.port}/api/status`, {timeoutMs: 45_000, accept: data => data?.applicationId === 'scene-studio-local'});
      return {started: true, port: settings.scene.port, pid: child?.pid};
    })().finally(() => {
      starting = null;
    });
    return starting;
  }

  async function stop() {
    if (!child) return {stopped: false};
    const pid = child.pid;
    child.kill();
    child = null;
    return {stopped: true, pid};
  }

  /** 只做一件事：prompt -> PNG。场景引擎的 /api/image 正好是这个语义。 */
  async function generateImage({prompt, size, references = [], timeoutMs = 600_000}) {
    const settings = await config.read();
    const data = await httpJson(`http://127.0.0.1:${settings.scene.port}/api/image`, {
      method: 'POST',
      origin: `http://127.0.0.1:${settings.scene.port}`,
      body: {prompt, size: size || settings.scene.imageSize, references},
      timeoutMs
    });
    if (!data?.image) throw Object.assign(new Error('场景引擎没有返回图片地址。'), {code: 'scene_no_image'});
    return await fetchImage(data.image);
  }

  async function fetchImage(imageUrl) {
    const settings = await config.read();
    const response = await fetch(`http://127.0.0.1:${settings.scene.port}${imageUrl}`);
    if (!response.ok) throw Object.assign(new Error(`读取场景引擎图片失败：${response.status}`), {code: 'scene_image_read_failed'});
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  return {start, stop, status, generateImage, fetchImage, port};
}

/* ------------------------------ 角色引擎（Python） ------------------------------ */

export function createWorkshopEngine({config, logger}) {
  let child = null;
  let starting = null;

  function launcherFile() {
    return path.join(paths.workshopEngine, 'hub_launcher.py');
  }

  async function port() {
    return (await config.read()).workshop.port;
  }

  async function status() {
    const p = await port();
    try {
      const data = await httpJson(`http://127.0.0.1:${p}/api/health`, {timeoutMs: 4000});
      return {running: data?.app === 'comic-character-workbench', port: p, info: data};
    } catch (error) {
      return {running: false, port: p, error: error.message};
    }
  }

  async function ensureLauncher() {
    const launcher = launcherFile();
    if (!existsSync(launcher)) {
      throw Object.assign(new Error(`角色引擎缺少引导脚本：${launcher}`), {code: 'workshop_launcher_missing'});
    }
    return launcher;
  }

  async function start() {
    if (starting) return starting;
    starting = (async () => {
      const settings = await config.read();
      if ((await status()).running) return {alreadyRunning: true, port: settings.workshop.port};
      const launcher = await ensureLauncher();
      await ensureDir(paths.workshopData);
      const python = resolvePythonBinary(settings.workshop.pythonPath);
      // 角色工房里负责出图的 Codex 路径：优先工作台设置，其次本机自动查找，
      // 这样两个模块共用同一份登录状态，不需要重复登录。
      const codex = findCodexBinary(settings.scene.codexPath);
      const codexHome = await ensureCodexHome({logger, configured: settings.scene.codexHome});
      const env = {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        CHARACTER_WORKBENCH_PORT: String(settings.workshop.port),
        WORKBENCH_DATA_DIR: paths.workshopData,
        CHARACTER_WORKBENCH_NO_BROWSER: '1',
        CODEX_HOME: codexHome,
        ...(codex ? {WORKBENCH_CODEX_PATH: codex} : {}),
        WORKBENCH_PYTHON_PATH: python,
        TEMP: path.join(paths.workshopData, 'temp'),
        TMP: path.join(paths.workshopData, 'temp')
      };
      await ensureDir(path.join(paths.workshopData, 'temp'));
      child = spawn(python, ['-B', launcher], {
        cwd: paths.workshopEngine,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      child.stdout.on('data', chunk => logger?.info('workshop', {line: String(chunk).trim()}));
      child.stderr.on('data', chunk => logger?.warn('workshop', {line: String(chunk).trim()}));
      child.on('exit', code => {
        logger?.warn('角色引擎退出', {code});
        child = null;
      });
      await waitForHttp(`http://127.0.0.1:${settings.workshop.port}/api/health`, {
        timeoutMs: 90_000,
        accept: data => data?.app === 'comic-character-workbench'
      });
      return {started: true, port: settings.workshop.port, pid: child?.pid};
    })().finally(() => {
      starting = null;
    });
    return starting;
  }

  async function stop() {
    if (!child) return {stopped: false};
    const pid = child.pid;
    child.kill();
    child = null;
    return {stopped: true, pid};
  }

  async function call(method, apiPath, body, {timeoutMs = 120_000} = {}) {
    const settings = await config.read();
    return await httpJson(`http://127.0.0.1:${settings.workshop.port}${apiPath}`, {
      method,
      body,
      timeoutMs,
      origin: `http://127.0.0.1:${settings.workshop.port}`
    });
  }

  /** 提交一个角色工房任务并轮询到结束；返回任务对象（含 files）。 */
  async function submitJob(payload, {signal, onProgress, pollMs = 2500, timeoutMs} = {}) {
    const settings = await config.read();
    const deadline = Date.now() + (timeoutMs || settings.intake.jobTimeoutSeconds * 1000);
    const created = await call('POST', '/api/jobs', payload);
    const jobId = created?.job?.id || created?.id;
    if (!jobId) throw Object.assign(new Error('角色引擎未返回任务编号。'), {code: 'workshop_no_job'});
    let last = null;
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        await call('POST', `/api/jobs/${jobId}/cancel`, {}).catch(() => {});
        throw Object.assign(new Error('任务已取消。'), {code: 'cancelled', status: 499});
      }
      const state = await call('GET', '/api/state', undefined, {timeoutMs: 30_000});
      const job = (state?.jobs || []).find(item => item.id === jobId);
      if (job) {
        last = job;
        onProgress?.({
          phase: job.phase || job.status,
          message: job.message || '',
          stepProgress: job.stepProgress || null,
          percent: job.stepProgress?.total ? Math.round((job.stepProgress.completed / job.stepProgress.total) * 100) : null
        });
        if (job.status === 'completed') return job;
        if (job.status === 'failed' || job.status === 'cancelled') {
          throw Object.assign(new Error(job.message || (job.status === 'cancelled' ? '任务已取消。' : '角色引擎任务失败。')), {
            code: job.status === 'cancelled' ? 'cancelled' : 'workshop_job_failed',
            job,
            status: job.status === 'cancelled' ? 499 : 500
          });
        }
      }
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    throw Object.assign(new Error('角色引擎任务超时。'), {code: 'workshop_timeout', job: last, status: 504});
  }

  /** 把 /files/... 相对地址读成字节（生成机与存放机分离时的取图路径）。 */
  async function fetchFile(url) {
    const settings = await config.read();
    const response = await fetch(`http://127.0.0.1:${settings.workshop.port}${url}`);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * 找出一个角色工房任务真正产出的图片。
   *
   * 上游任务对象里并没有"产出文件清单"（图片是直接写到 data/generated/<jobId>/ 的），
   * 所以这里按任务目录扫描，只认"任务开始之后写出的图片"，避免把中间态或旧文件当成成品。
   * 结果与图片在磁盘上的路径顺序无关，因此放回工作台归档时是可复现的。
   *
   * options.filter: 正则字符串，只保留匹配的文件名（不含目录）
   * options.fields: {文件名(不含扩展名): 视图名}，用于给产出起可读的 view
   */
  async function listJobOutputs(engineJob, {filter = '', fields = {}} = {}) {
    const settings = await config.read();
    const jobId = engineJob?.id;
    if (!jobId || !/^[A-Za-z0-9_-]{1,80}$/.test(jobId)) return [];
    const directory = path.join(paths.workshopData, 'generated', jobId);
    if (!existsSync(directory)) return [];
    const startedAt = Date.parse(engineJob.startedAt || engineJob.createdAt || '') || 0;
    const pattern = filter ? new RegExp(filter, 'i') : null;
    const found = [];
    const walk = async (current, depth = 0) => {
      if (depth > 4) return;
      let entries;
      try {
        entries = await readdir(current, {withFileTypes: true});
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue;
          await walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) continue;
        if (entry.name.startsWith('normalized-')) continue;
        const info = await stat(full).catch(() => null);
        if (!info) continue;
        // 留 3 秒余量：任务开始与首个文件写入之间可能有时间差
        if (startedAt && info.mtimeMs < startedAt - 3000) continue;
        if (pattern && !pattern.test(entry.name)) continue;
        const stem = path.basename(entry.name, extension);
        found.push({
          url: `/files/${path.relative(paths.workshopData, full).split(path.sep).join('/')}`,
          name: entry.name,
          relative: path.relative(directory, full).split(path.sep).join('/'),
          view: fields[stem] || fields[entry.name] || stem,
          part: path.dirname(path.relative(directory, full)) === '.' ? '' : path.dirname(path.relative(directory, full)).split(path.sep).join('/'),
          bytes: info.size,
          mtimeMs: info.mtimeMs
        });
      }
    };
    await walk(directory);
    found.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
    return found;
  }

  return {start, stop, status, call, submitJob, fetchFile, listJobOutputs, port, ensureLauncher};
}
