/**
 * 底层文件与队列原语。
 * 取自场记 1.5.3 中经测试验证的实现（原子写入、Windows 文件占用重试、串行写链），
 * 并补上局域网共享（UNC/映射盘）需要的重试与超时处理。
 */
import {mkdir, readFile, writeFile, rename, copyFile, open, stat, unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {appendFile} from 'node:fs/promises';

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EEXIST', 'ETXTBSY', 'ENETRESET', 'ECONNABORTED']);

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 重试可恢复的文件系统错误；网络共享断开会以 ENOENT/EPIPE 形式出现，交给上层判断。 */
export async function withRetry(operation, {attempts = 6, baseDelayMs = 25, maxDelayMs = 2000, onRetry} = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      if (!TRANSIENT.has(error?.code) || attempt === attempts - 1) throw error;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
  throw last;
}

export async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readJson(file, fallback) {
  try {
    const text = await readFile(file, 'utf8');
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) throw Object.assign(new Error(`本地文件内容损坏：${path.basename(file)}。请从备份恢复。`), {code: 'file_corrupt', cause: error});
    throw error;
  }
}

export async function ensureDir(dir) {
  await mkdir(dir, {recursive: true});
}

/** 原子 JSON 写入：临时文件 -> 重命名，失败自动重试。 */
export async function atomicJson(file, value, {backup = false, mode = 0o600} = {}) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), {mode});
  if (backup) await copyFile(file, `${file}.bak`).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  await withRetry(() => rename(temp, file));
}

export async function atomicText(file, text, {mode = 0o600} = {}) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, text, {mode, encoding: 'utf8'});
  await withRetry(() => rename(temp, file));
}

/**
 * 把字节写到目标路径（支持 UNC / 映射盘）。
 * 先写同目录临时文件再改名，避免其他机器读到半个文件；跨共享改名失败时退化为直接写入。
 */
export async function atomicBytes(target, bytes) {
  await ensureDir(path.dirname(target));
  const temp = `${target}.${randomUUID()}.part`;
  try {
    await withRetry(() => writeFile(temp, bytes));
    await withRetry(() => rename(temp, target), {attempts: 8, baseDelayMs: 50});
    return target;
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function hashFile(file) {
  const bytes = await readFile(file);
  return sha256(bytes);
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function shortHash(value, length = 12) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

/** 文件名净化：与角色工房 safe_name 对齐，并补齐 Windows 保留名。 */
export function safeName(value, {max = 100, fallback = 'unnamed'} = {}) {
  let text = String(value ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[\s.]+$/g, '').trim();
  text = text.replace(/_+/g, '_');
  if (!text) text = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(text)) text = `_${text}`;
  return text.slice(0, max);
}

/**
 * 串行写链：同一把锁下的多次写入按提交顺序落盘，读回时不会看到中间态。
 */
export function writeChain() {
  let chain = Promise.resolve();
  return {
    run(task) {
      const next = chain.catch(() => {}).then(task);
      chain = next.catch(() => {});
      return next;
    },
    async flush() {
      await chain.catch(() => {});
    }
  };
}

/** 轻量 JSONL 追加日志（资产索引使用），带内存偏移量，读取时可增量加载。 */
export function jsonlLog(file) {
  let queued = writeChain();
  return {
    async append(record) {
      const line = `${JSON.stringify(record)}\n`;
      await queued.run(async () => {
        await ensureDir(path.dirname(file));
        await appendFile(file, line, 'utf8');
      });
    },
    async appendMany(records) {
      if (!records.length) return;
      const text = records.map(record => `${JSON.stringify(record)}\n`).join('');
      await queued.run(async () => {
        await ensureDir(path.dirname(file));
        await appendFile(file, text, 'utf8');
      });
    },
    async rewrite(records) {
      await queued.run(async () => {
        await atomicText(file, records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''));
      });
    },
    async readAll() {
      await queued.flush();
      const text = await readText(file);
      if (!text) return [];
      const out = [];
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          out.push(JSON.parse(trimmed));
        } catch {
          /* 半行写入（掉电）直接跳过，索引可重建 */
        }
      }
      return out;
    }
  };
}

export async function fileExists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** 独占锁文件，防止同机启动两份服务共用同一份数据。 */
export async function acquireLock(file, {staleMs = 60_000} = {}) {
  await ensureDir(path.dirname(file));
  try {
    const handle = await open(file, 'wx');
    await handle.writeFile(String(process.pid));
    await handle.close();
    return {
      async release() {
        await unlink(file).catch(() => {});
      }
    };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await stat(file).catch(() => null);
    // 锁里记了进程号：如果那个进程已经不在了，不管锁文件多新都可以直接接管。
    // 否则异常退出（崩溃、被杀）之后要白等 staleMs 才能启动。
    const recorded = Number((await readText(file).catch(() => '') || '').trim());
    const alive = Number.isInteger(recorded) && recorded > 0 && isProcessAlive(recorded);
    if (!alive || (info && Date.now() - info.mtimeMs > staleMs)) {
      await unlink(file).catch(() => {});
      return acquireLock(file, {staleMs});
    }
    throw Object.assign(new Error('工作台数据目录已被另一个进程占用，请先停止另一个实例。'), {code: 'already_running', status: 409});
  }
}

/** 进程是否还活着（只发信号 0 探测，不真杀） */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM 表示进程存在但没有权限，也算活着
    return error.code === 'EPERM';
  }
}
