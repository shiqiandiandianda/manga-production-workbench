#!/usr/bin/env node
// 中控 CLI：加载配置 → 创建 HTTP 服务 → 打印中控地址/配对码 → 优雅关闭。
// 用法：node 中控.mjs [--config 路径] [--port 端口] [--host 监听地址] [--data 数据目录]
// 环境变量：COLLAB_HUB_DATA_DIR 覆盖数据目录（测试用）；COLLAB_HUB_PORT / COLLAB_HUB_HOST 可选覆盖。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readJson, writeJsonAtomic} from './lib/protocol.mjs';
import {createHubServer} from './lib/hub-server.mjs';
import {HUB_DEFAULTS, defaultHubConfig} from './lib/hub-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(HERE, 'config', 'hub.json');
const DEFAULT_DATA_DIR = path.join(HERE, '..', '运行数据', '协作', '中控');

const USAGE = [
  'PhotoCraft 协作中控',
  '',
  '用法：node 中控.mjs [参数]',
  '  --config <路径>  配置文件路径（默认 开发/协作/config/hub.json，不存在则用默认值）',
  '  --port <端口>    监听端口（默认 18897）',
  '  --host <地址>    监听地址（默认 0.0.0.0，允许局域网访问）',
  '  --data <目录>    数据目录（默认 开发/运行数据/协作/中控）',
  '  -h, --help       显示本帮助',
  '',
  '环境变量：COLLAB_HUB_DATA_DIR 可覆盖数据目录（便于自动化测试）。',
].join('\n');

export function parseHubArgs(argv = []) {
  const result = {config: null, port: null, host: null, data: null, help: false};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index]);
    const equals = token.indexOf('=');
    const name = equals > 0 ? token.slice(0, equals) : token;
    const inlineValue = equals > 0 ? token.slice(equals + 1) : null;
    const takeValue = (label) => {
      if (inlineValue !== null) {
        if (!inlineValue) throw new Error(`参数 ${label} 缺少取值`);
        return inlineValue;
      }
      const next = argv[index + 1];
      if (next === undefined || String(next).startsWith('--')) throw new Error(`参数 ${label} 缺少取值`);
      index += 1;
      return String(next);
    };
    switch (name) {
      case '--config':
      case '-c':
        result.config = takeValue('--config');
        break;
      case '--port':
        result.port = takeValue('--port');
        break;
      case '--host':
        result.host = takeValue('--host');
        break;
      case '--data':
        result.data = takeValue('--data');
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        if (name.startsWith('-')) throw new Error(`未知参数：${name}（用 --help 查看用法）`);
        throw new Error(`多余的参数：${name}`);
    }
  }
  if (result.port !== null) {
    const port = Number(result.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`端口无效：${result.port}`);
    result.port = port;
  }
  return result;
}

function loadHubConfigFile(configPath) {
  if (!fs.existsSync(configPath)) {
    return {config: {}, exists: false, path: configPath};
  }
  let raw;
  try {
    raw = readJson(configPath, {});
  } catch (error) {
    throw new Error(`中控配置文件不是有效 JSON：${configPath}（${error.message}）`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`中控配置文件内容必须是 JSON 对象：${configPath}`);
  }
  return {config: raw, exists: true, path: configPath};
}

export function resolveHubOptions(args = {}, env = process.env) {
  const configPath = args.config ? path.resolve(args.config) : DEFAULT_CONFIG_PATH;
  const loaded = loadHubConfigFile(configPath);
  const config = defaultHubConfig(loaded.config);
  const configDir = path.dirname(configPath);
  const envData = String(env.COLLAB_HUB_DATA_DIR || '').trim();
  let dataDir;
  if (args.data) dataDir = path.resolve(args.data);
  else if (envData) dataDir = path.resolve(envData);
  else if (loaded.exists && typeof loaded.config.dataDir === 'string' && loaded.config.dataDir.trim()) {
    dataDir = path.resolve(configDir, loaded.config.dataDir.trim());
  } else {
    dataDir = DEFAULT_DATA_DIR;
  }
  const port = args.port !== null && args.port !== undefined
    ? args.port
    : env.COLLAB_HUB_PORT
      ? Number(env.COLLAB_HUB_PORT)
      : config.port;
  const host = args.host || env.COLLAB_HUB_HOST || config.host;
  return {
    configPath,
    configFileExists: loaded.exists,
    rawConfig: loaded.config,
    config,
    dataDir,
    port,
    host,
    hubName: config.hubName || HUB_DEFAULTS.hubName,
  };
}

export function lanAddresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      const family = typeof entry.family === 'string' ? entry.family : `IPv${entry.family}`;
      if (family !== 'IPv4' || entry.internal) continue;
      if (!entry.address || entry.address.startsWith('169.254.')) continue;
      result.push(entry.address);
    }
  }
  const score = (address) => {
    if (address.startsWith('192.168.')) return 0;
    if (address.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
    return 3;
  };
  return [...new Set(result)].sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}

export function createCliLogger(consoleLike = console) {
  return {
    info: (...args) => consoleLike.log(...args),
    warn: (...args) => consoleLike.warn(...args),
    error: (...args) => consoleLike.error(...args),
  };
}

// 启动中控（可被测试或脚本复用）；返回运行时对象。
export async function runHub({argv = process.argv.slice(2), env = process.env, logger = createCliLogger()} = {}) {
  const args = parseHubArgs(argv);
  if (args.help) {
    logger.info(USAGE);
    return null;
  }
  const options = resolveHubOptions(args, env);
  const config = {...options.config, port: options.port, host: options.host, hubName: options.hubName};
  const runtime = createHubServer({
    dataDir: options.dataDir,
    config,
    hubName: options.hubName,
    logger,
  });

  let address;
  try {
    address = await runtime.listen({port: options.port, host: options.host});
  } catch (error) {
    try {
      await runtime.close();
    } catch {}
    if (error && error.code === 'EADDRINUSE') {
      throw new Error(`端口 ${options.port} 已被占用，请关闭占用程序或改用 --port 指定其他端口。`);
    }
    if (error && error.code === 'EACCES') {
      throw new Error(`没有权限监听 ${options.host}:${options.port}，请改用 127.0.0.1 或更高权限。`);
    }
    throw new Error(`中控启动失败：${error && error.message ? error.message : error}`);
  }

  const port = address && typeof address === 'object' ? address.port : options.port;
  const displayHost = options.host === '0.0.0.0' || options.host === '::' ? lanAddresses()[0] || '127.0.0.1' : options.host;
  if (!options.configFileExists) {
    logger.warn?.(`[中控] 未找到配置文件 ${options.configPath}，已使用默认配置。可复制 config/hub.example.json 为 config/hub.json 后修改。`);
  }

  // 记录生效配置，便于排查（不含任何令牌；配对码只写在 配对码.txt）。
  try {
    const effective = {...config, dataDir: runtime.hub.dataDir, configPath: options.configPath};
    writeJsonAtomic(path.join(runtime.hub.dataDir, 'hub-config.json'), effective);
  } catch (error) {
    logger.warn?.(`[中控] 写入 hub-config.json 失败：${error.message}`);
  }

  logger.info('');
  logger.info('==============================================');
  logger.info('  PhotoCraft 协作中控已启动');
  logger.info(`  中控地址 http://${displayHost}:${port}`);
  logger.info(`  本机地址 http://127.0.0.1:${port}`);
  logger.info(`  配对码   ${runtime.hub.state.pairingCode}`);
  logger.info(`  数据目录 ${runtime.hub.dataDir}`);
  logger.info(`  配对码文件 ${runtime.hub.pairingFile}`);
  logger.info('  把「中控地址 + 配对码」填到节点/客户端即可配对；Ctrl+C 停止。');
  logger.info('==============================================');
  logger.info('');

  runtime.boundPort = port;
  return runtime;
}

async function main() {
  let runtime;
  try {
    runtime = await runHub();
  } catch (error) {
    console.error(`[中控] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
    return;
  }
  if (!runtime) return;
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[中控] 收到 ${signal}，正在优雅关闭…`);
    try {
      await runtime.close();
      console.log('[中控] 已保存状态并关闭，再见。');
    } catch (error) {
      console.error(`[中控] 关闭时出错：${error && error.message ? error.message : error}`);
    }
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error(`[中控] 未处理的异步错误：${reason && reason.message ? reason.message : reason}`);
  });
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[中控] 启动失败：${error && error.message ? error.message : error}`);
    process.exit(1);
  });
}
