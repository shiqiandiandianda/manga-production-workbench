// 独立验证测试共享辅助（adversarial verifier 维护，不属于实现代码）。
//
// 只提供：真实 PNG/JPEG 字节合成（假图片内容，但文件头/像素真实）、真实 HTTP 小工具、
// 临时目录、等待、中控实例启动封装。**不模拟被测状态机**——所有状态迁移都发生在
// 真实 hub-server / hub-queue / node-core 里，测试只通过 HTTP 或真实模块调用驱动。
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawn, spawnSync} from 'node:child_process';
import {createHubServer} from '../../lib/hub-server.mjs';

const SILENT_LOGGER = {info() {}, warn() {}, error() {}};

// ---------------------------------------------------------------------------
// 假图片字节：PNG 用真实 IHDR/IDAT/IEND + CRC，JPEG 用最小合法 SOF0 帧头。
// 只用于离线测试，不涉及任何真实生图/网络。
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

// 真实可解码的 PNG（RGBA，纯色）。用于校验中控/节点的「PNG 头 + 像素尺寸」。
export function makePng(width = 32, height = 24, color = [90, 140, 220, 255]) {
  const rgba = Array.isArray(color) ? color : [90, 140, 220, 255];
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 4;
      raw[offset] = rgba[0] & 0xff;
      raw[offset + 1] = rgba[1] & 0xff;
      raw[offset + 2] = rgba[2] & 0xff;
      raw[offset + 3] = rgba[3] & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 最小合法 JPEG：SOI + SOF0（含真实宽高）+ EOI。足以让协议层解析出 image/jpeg 与像素尺寸。
export function makeJpeg(width = 64, height = 48) {
  const sof = Buffer.alloc(19);
  sof.writeUInt8(0xff, 0); // marker
  sof.writeUInt8(0xc0, 1); // SOF0
  sof.writeUInt16BE(0x0011, 2); // 段长度 17（含自身 2 字节）
  sof.writeUInt8(8, 4); // 精度
  sof.writeUInt16BE(height, 5); // 高
  sof.writeUInt16BE(width, 7); // 宽
  sof.writeUInt8(3, 9); // 分量数
  const components = [
    [1, 0x11, 0],
    [2, 0x11, 1],
    [3, 0x11, 1],
  ];
  let offset = 10;
  for (const [id, sampling, table] of components) {
    sof.writeUInt8(id, offset);
    sof.writeUInt8(sampling, offset + 1);
    sof.writeUInt8(table, offset + 2);
    offset += 3;
  }
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}

// ---------------------------------------------------------------------------
// 临时目录 / 等待
// ---------------------------------------------------------------------------
export function tempDir(prefix = 'photocraft-verify-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(directory) {
  try {
    fs.rmSync(directory, {recursive: true, force: true});
  } catch {
    // 清理失败不掩盖测试结果（Windows 偶发占用）
  }
}

export async function waitFor(predicate, {timeout = 10000, interval = 15, label = '条件'} = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`等待${label}超时（${timeout}ms）`);
}

// ---------------------------------------------------------------------------
// 真实 HTTP 服务（listen(0) 随机端口）
// ---------------------------------------------------------------------------
export function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      const port = server.address().port;
      resolve({server, port, origin: `http://127.0.0.1:${port}`});
    });
  });
}

export function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

// 紧凑 JSON（失败断言时打印实际报文关键字段用；超长截断）。
export function jsonBrief(value, maxLength = 2000) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…（共 ${text.length} 字符）` : text;
}

// ---------------------------------------------------------------------------
// 中控 HTTP 客户端封装（真实请求）
// ---------------------------------------------------------------------------
export function createHttpApi(baseUrl) {
  return async function api(method, pathname, body, {token, headers = {}, timeoutMs = 15000} = {}) {
    const requestHeaders = {...headers};
    if (token) requestHeaders['x-collab-token'] = token;
    let payload;
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) {
        payload = body;
        if (!requestHeaders['content-type']) requestHeaders['content-type'] = 'application/octet-stream';
      } else {
        payload = Buffer.from(JSON.stringify(body), 'utf8');
        requestHeaders['content-type'] = 'application/json; charset=utf-8';
      }
    }
    const response = await fetch(baseUrl + pathname, {
      method,
      headers: requestHeaders,
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.toString('utf8');
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return {status: response.status, headers: response.headers, buffer, text, body: parsed, method, pathname};
  };
}

export async function pairDevice(api, pairingCode, role, name) {
  const result = await api('POST', '/api/pair', {
    pairingCode,
    role,
    name,
    platform: process.platform,
    version: '1.0.0',
  });
  if (result.status !== 200 || !result.body || typeof result.body.token !== 'string') {
    throw new Error(`配对失败（${role}/${name}）：${jsonBrief({status: result.status, body: result.body})}`);
  }
  return {
    token: result.body.token,
    clientId: result.body.clientId,
    nodeId: result.body.nodeId,
    role: result.body.role,
  };
}

// ---------------------------------------------------------------------------
// 启动真实中控实例：随机端口 + 临时目录 + 可选可控时钟。
// 返回的 close() 只关服务，不删目录（重启恢复测试要复用同一 dataDir）。
// ---------------------------------------------------------------------------
export async function startHub({dataDir, config = {}, now, hubName, logger = SILENT_LOGGER} = {}) {
  const runtime = createHubServer({
    dataDir,
    config: {port: 0, host: '127.0.0.1', ...config},
    hubName,
    now,
    logger,
    startTimers: false,
    recoverOnStart: true,
  });
  const address = await runtime.listen({port: 0, host: '127.0.0.1'});
  const base = `http://127.0.0.1:${address.port}`;
  return {
    runtime,
    base,
    api: createHttpApi(base),
    dataDir: runtime.hub.dataDir,
    port: address.port,
    recovery: runtime.recovery,
    close: () => runtime.close(),
  };
}

// ---------------------------------------------------------------------------
// 第二阶段（真实多进程）辅助：随机端口、子进程托管、日志落盘、等待 HTTP。
// ---------------------------------------------------------------------------
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(Number(ms) || 0))));
}

export function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

export function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

export function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

// 启动一个受管子进程（真实 node 进程），stdout/stderr 同时写入内存与证据日志文件。
export function spawnManaged({name, script, args = [], cwd, env = {}, logFile}) {
  fs.mkdirSync(path.dirname(logFile), {recursive: true});
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] 启动 ${name}：${script} ${args.join(' ')}\n`, 'utf8');
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: {...process.env, ...env},
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const record = {name, child, logFile, pid: child.pid, stdout: [], stderr: [], exit: null};
  child.stdout.on('data', (chunk) => {
    record.stdout.push(chunk);
    try { fs.appendFileSync(logFile, chunk); } catch {}
  });
  child.stderr.on('data', (chunk) => {
    record.stderr.push(chunk);
    try { fs.appendFileSync(logFile, chunk); } catch {}
  });
  child.once('exit', (code, signal) => {
    record.exit = {code, signal};
    try { fs.appendFileSync(logFile, `\n[进程退出] ${name} code=${code} signal=${signal} at=${new Date().toISOString()}\n`); } catch {}
  });
  return record;
}

export function waitChildExit(record, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!record || !record.child || record.exit) return resolve(record ? record.exit : null);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    record.child.once('exit', (code, signal) => {
      clearTimeout(timer);
      finish({code, signal});
    });
  });
}

// 强制结束子进程树（Windows 用 taskkill /T /F 确保不留孤儿）。
export async function killProcessTree(record) {
  if (!record || !record.child || record.exit) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(record.child.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
    } catch {}
  } else {
    try { record.child.kill('SIGTERM'); } catch {}
  }
  await waitChildExit(record, 6000);
}

export function processText(record) {
  return Buffer.concat([...record.stdout, ...record.stderr]).toString('utf8');
}

// 轮询 HTTP 直到 predicate 通过；返回最后一次响应（含解析 body）。
export async function waitForHttp(url, predicate = () => true, {timeout = 20000, interval = 100, label = 'HTTP 服务', headers = {}} = {}) {
  const started = Date.now();
  let last = null;
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url, {headers, signal: AbortSignal.timeout(5000)});
      const buffer = Buffer.from(await response.arrayBuffer());
      const text = buffer.toString('utf8');
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      last = {status: response.status, ok: response.ok, headers: response.headers, buffer, text, body};
      if (predicate(last)) return last;
    } catch (error) {
      lastError = error;
    }
    await delay(interval);
  }
  throw new Error(
    `等待${label}超时（${timeout}ms）：${url}；最后响应=${jsonBrief(last && {status: last.status, body: last.body})}`
      + (lastError ? `；最后错误=${lastError.message}` : ''),
  );
}
