/**
 * 配置加载与校验。
 *
 * 规则：
 * - 所有路径、端口、可执行文件都来自配置；不从 Node 所在目录推断。
 * - 配置缺失时给出可用默认值（仅用于开发），显式指定的文件缺失则直接失败。
 * - 启动时校验，失败即退出；doctor 打印脱敏后的"有效配置"。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fail} from '../../core/errors.mjs';

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(CONFIG_DIR, '../..');
export const REPO_ROOT = path.resolve(APP_ROOT, '..');

export const DEFAULT_CONFIG = Object.freeze({
  role: 'studio',
  studio: {host: '127.0.0.1', port: 8792},
  hub: {url: '', listen: '127.0.0.1', port: 8788, workerToken: ''},
  node: {
    machineId: '',
    poolId: 'local',
    capacity: 1,
    reserve: 0,
    heartbeatMs: 5000,
    claimMs: 1000
  },
  paths: {
    data: 'data',
    workspace: 'workspace'
  },
  archive: {kind: 'local', baseUrl: ''},
  limits: {maxConcurrent: 6, reserve: 2},
  executors: {
    fake: {enabled: true, autoRun: true, latencyMs: 30},
    workshop: {
      enabled: false,
      baseUrl: 'http://127.0.0.1:8892',
      timeoutMs: 1_800_000,
      pollMs: 1500
    }
  },
  logLevel: 'info'
});

const ROLES = ['studio', 'hub', 'node'];
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

export function loadConfig({
  file,
  root = REPO_ROOT,
  overrides = {},
  env = process.env,
  ensureDirs = true
} = {}) {
  const fromEnv = envOverrides(env);
  const explicit = file || env.APP_CONFIG;
  const configFile = explicit
    ? path.resolve(root, explicit)
    : path.join(root, 'config', 'app.local.json');

  let fileConfig = {};
  if (fs.existsSync(configFile)) {
    fileConfig = readJson(configFile);
  } else if (explicit) {
    throw fail.invalid(`配置文件不存在：${configFile}`);
  }

  const merged = merge(DEFAULT_CONFIG, fileConfig, fromEnv, overrides);
  const config = normalize(merged, root);
  config.meta = {configFile, root, exists: fs.existsSync(configFile)};

  if (ensureDirs) {
    for (const dir of [config.paths.data, config.paths.cache, config.paths.logs, config.paths.workspace]) {
      fs.mkdirSync(dir, {recursive: true});
    }
  }
  return config;
}

function envOverrides(env) {
  const result = {};
  if (env.APP_ROLE) result.role = env.APP_ROLE;
  if (env.APP_STUDIO_PORT) result.studio = {...(result.studio || {}), port: Number(env.APP_STUDIO_PORT)};
  if (env.APP_HUB_PORT) result.hub = {...(result.hub || {}), port: Number(env.APP_HUB_PORT)};
  if (env.APP_DATA_DIR) result.paths = {...(result.paths || {}), data: env.APP_DATA_DIR};
  return result;
}

function normalize(input, root) {
  const role = String(input.role ?? '').trim();
  if (!ROLES.includes(role)) {
    throw fail.invalid(`role 必须是 ${ROLES.join(' / ')} 之一`);
  }

  const dataDir = resolvePath(root, input.paths?.data || 'data');
  const cacheDir = input.paths?.cache
    ? resolvePath(root, input.paths.cache)
    : path.join(dataDir, 'cache');
  const logsDir = input.paths?.logs
    ? resolvePath(root, input.paths.logs)
    : path.join(dataDir, 'logs');
  const workspaceDir = input.paths?.workspace
    ? resolvePath(root, input.paths.workspace)
    : path.join(root, 'workspace');
  const database = input.paths?.database
    ? resolvePath(root, input.paths.database)
    : path.join(dataDir, 'platform.sqlite');

  const archiveKind = String(input.archive?.kind ?? 'local').trim();
  if (!['local', 'moku'].includes(archiveKind)) {
    throw fail.invalid('archive.kind 必须是 local 或 moku');
  }
  const archiveBaseUrl = String(input.archive?.baseUrl ?? '').trim();
  if (archiveKind === 'moku' && !/^https?:\/\//.test(archiveBaseUrl)) {
    throw fail.invalid('archive.kind=moku 时必须提供 archive.baseUrl');
  }

  const maxConcurrent = intInRange(input.limits?.maxConcurrent, 1, 64, 4, 'limits.maxConcurrent');
  const reserve = intInRange(
    input.limits?.reserve,
    0,
    maxConcurrent,
    Math.min(2, maxConcurrent),
    'limits.reserve'
  );
  const nodeCapacity = intInRange(input.node?.capacity, 1, 6, 1, 'node.capacity');
  const nodeReserve = intInRange(input.node?.reserve, 0, nodeCapacity, 0, 'node.reserve');

  return {
    role,
    studio: Object.freeze({
      host: cleanHost(input.studio?.host, '127.0.0.1'),
      port: intInRange(input.studio?.port, 1024, 65535, 8792, 'studio.port')
    }),
    hub: Object.freeze({
      url: cleanUrl(input.hub?.url),
      listen: cleanHost(input.hub?.listen, '127.0.0.1'),
      port: intInRange(input.hub?.port, 1024, 65535, 8788, 'hub.port'),
      workerToken: String(input.hub?.workerToken ?? '').trim()
    }),
    node: Object.freeze({
      machineId: String(input.node?.machineId ?? '').trim(),
      poolId: String(input.node?.poolId ?? 'local').trim() || 'local',
      capacity: nodeCapacity,
      reserve: nodeReserve,
      heartbeatMs: intInRange(input.node?.heartbeatMs, 1000, 60000, 5000, 'node.heartbeatMs'),
      claimMs: intInRange(input.node?.claimMs, 250, 30000, 1000, 'node.claimMs')
    }),
    paths: Object.freeze({
      data: dataDir,
      cache: cacheDir,
      logs: logsDir,
      workspace: workspaceDir,
      database
    }),
    archive: Object.freeze({kind: archiveKind, baseUrl: archiveBaseUrl}),
    limits: Object.freeze({maxConcurrent, reserve}),
    executors: Object.freeze({
      fake: Object.freeze({
        enabled: input.executors?.fake?.enabled !== false,
        autoRun: input.executors?.fake?.autoRun !== false,
        latencyMs: intInRange(
          input.executors?.fake?.latencyMs,
          0,
          5000,
          30,
          'executors.fake.latencyMs'
        )
      }),
      workshop: Object.freeze({
        enabled: input.executors?.workshop?.enabled === true,
        baseUrl: cleanUrl(input.executors?.workshop?.baseUrl || 'http://127.0.0.1:8892')
          || 'http://127.0.0.1:8892',
        timeoutMs: intInRange(
          input.executors?.workshop?.timeoutMs,
          30_000,
          7_200_000,
          1_800_000,
          'executors.workshop.timeoutMs'
        ),
        pollMs: intInRange(
          input.executors?.workshop?.pollMs,
          250,
          10_000,
          1500,
          'executors.workshop.pollMs'
        )
      })
    }),
    logLevel: LOG_LEVELS.includes(input.logLevel) ? input.logLevel : 'info'
  };
}

function intInRange(value, min, max, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw fail.invalid(`${label} 必须是 ${min}–${max} 的整数`);
  }
  return number;
}

function cleanHost(value, fallback) {
  const host = String(value ?? fallback).trim();
  if (!host || /[\s/@\\]/.test(host)) throw fail.invalid('host 格式不正确');
  return host;
}

function cleanUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw fail.invalid('hub.url 不是合法地址');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw fail.invalid('hub.url 只支持 http/https');
  return parsed.origin;
}

function resolvePath(root, value) {
  const target = String(value ?? '').trim();
  if (!target) throw fail.invalid('路径不能为空');
  return path.isAbsolute(target) ? path.normalize(target) : path.resolve(root, target);
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw fail.invalid(`配置文件无法读取：${file}（${error.message}）`);
  }
  try {
    // Windows 编辑器/PowerShell 常写 UTF-8 BOM；JSON.parse 不认，先剥掉。
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw fail.invalid(`配置文件不是合法 JSON：${file}（${error.message}）`);
  }
}

function merge(...sources) {
  const result = {};
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = merge(result[key], value);
      } else if (value !== undefined) {
        result[key] = value;
      }
    }
  }
  return result;
}

/** 给 doctor / 日志用的摘要，不包含任何密钥。 */
export function describeConfig(config) {
  return {
    role: config.role,
    studio: `${config.studio.host}:${config.studio.port}`,
    hub: config.hub.url || `(本进程内嵌) ${config.hub.listen}:${config.hub.port}`,
    data: config.paths.data,
    database: config.paths.database,
    cache: config.paths.cache,
    workspace: config.paths.workspace,
    archive: config.archive.kind === 'moku' ? config.archive.baseUrl : 'local',
    limits: config.limits,
    configFile: config.meta?.exists === false ? '(默认值)' : config.meta?.configFile ?? '(默认值)'
  };
}
