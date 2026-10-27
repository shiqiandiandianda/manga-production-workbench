#!/usr/bin/env node
// 工作节点 CLI（开发/协作/节点.mjs）
// 用法：
//   node 节点.mjs pair --hub http://<中控IP>:18897 --code <配对码> --name <电脑名> [--data <目录>]
//   node 节点.mjs run --config <配置文件> [--data <目录>] [--check]
// 说明：节点只主动连中控与本机漫画服务（127.0.0.1），不监听任何入站端口；
//       日志写到 dataDir/logs/节点.log 并同时打印；不打印 token。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CollabError,
  HUB_APPLICATION,
  NODE_VERSION,
  PROTOCOL_VERSION,
  TASK_TYPES,
  ensureDir,
  nowIso,
  safeFileSegment,
  writeJsonAtomic,
} from './lib/protocol.mjs';
import {
  createNodeAgent,
  describeNodeConfig,
  loadNodeConfig,
  normalizeNodeConfig,
  pairNode,
} from './lib/node-core.mjs';
import {
  DEFAULT_LOCAL_ORIGIN,
  DEFAULT_PROVIDER,
  describeError,
  normalizeLocalOrigin,
  requestJson,
} from './lib/node-local.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scriptFile = path.join(scriptDir, '节点.mjs');

// ---------------------------------------------------------------------------
// 参数解析：支持 `--name value` 与 `--name=value`，其余为位置参数。
// ---------------------------------------------------------------------------
export function parseArgs(argv = []) {
  const positionals = [];
  const flags = {};
  let index = 0;
  while (index < argv.length) {
    const token = String(argv[index]);
    if (token.startsWith('--')) {
      const trimmed = token.slice(2);
      if (!trimmed) {
        index += 1;
        continue;
      }
      const equals = trimmed.indexOf('=');
      if (equals >= 0) {
        flags[trimmed.slice(0, equals)] = trimmed.slice(equals + 1);
        index += 1;
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !String(next).startsWith('--')) {
        flags[trimmed] = String(next);
        index += 2;
      } else {
        flags[trimmed] = true;
        index += 1;
      }
      continue;
    }
    positionals.push(token);
    index += 1;
  }
  return {positionals, flags};
}

function flagValue(flags, ...names) {
  for (const name of names) {
    if (flags[name] !== undefined && flags[name] !== true && flags[name] !== false) return String(flags[name]);
    if (flags[name] === true) return true;
  }
  return undefined;
}

function numberFlag(flags, names) {
  const value = flagValue(flags, ...names);
  if (value === undefined || value === true) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function printUsage(stream = console.log) {
  stream([
    'PhotoCraft 局域网协作 · 工作节点',
    '',
    '用法：',
    '  node 节点.mjs pair --hub http://<中控IP>:18897 --code <配对码> --name <电脑名> [--data <数据目录>]',
    '       [--local http://127.0.0.1:18896] [--provider codex] [--max 2]',
    '  node 节点.mjs run --config <配置文件> [--data <数据目录>] [--check]',
    '  node 节点.mjs help',
    '',
    '说明：',
    '  pair  向中控配对，取得节点 token 并写入 <数据目录>/config.json',
    '  run   启动节点代理：心跳 → 领任务 → 调本机漫画服务生图 → 上传结果（Ctrl+C 优雅退出）',
    '  --check  只做配置/中控连通/本机漫画服务健康检查，不启动代理、不领任务',
    '',
    '节点不开放入站端口，只访问中控 /api/* 与本机漫画服务固定接口；token 不会写入日志。',
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// 日志：dataDir/logs/节点.log（追加）+ 控制台；debug 不落控制台。
// ---------------------------------------------------------------------------
function createCliLogger(dataDir) {
  const logDir = path.join(dataDir, 'logs');
  ensureDir(logDir);
  const logFile = path.join(logDir, '节点.log');
  const writeLine = (level, message) => {
    const line = `[${nowIso()}] [${level.toUpperCase()}] ${message}`;
    try {
      fs.appendFileSync(logFile, `${line}\n`);
    } catch {
      // 日志写盘失败不影响节点运行
    }
    try {
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else if (level !== 'debug') console.log(line);
    } catch {
      // 控制台不可用时忽略
    }
  };
  return {
    logFile,
    log(level, message) {
      writeLine(level, String(message ?? ''));
    },
  };
}

function printBanner(log, lines) {
  for (const line of lines) log('info', line);
}

function defaultDataDir(name) {
  // 默认放在 开发/运行数据/协作/节点-<名字>（与协议 §2 的运行时数据布局一致）
  return path.resolve(scriptDir, '..', '运行数据', '协作', `节点-${safeFileSegment(name || 'node', 'node')}`);
}

// ---------------------------------------------------------------------------
// pair 子命令
// ---------------------------------------------------------------------------
async function commandPair(argv) {
  const {flags} = parseArgs(argv);
  const hubUrlRaw = flagValue(flags, 'hub', 'hub-url');
  const code = flagValue(flags, 'code', 'pairing-code');
  const name = flagValue(flags, 'name', 'node-name');
  const dataFlag = flagValue(flags, 'data', 'data-dir');
  const localFlag = flagValue(flags, 'local', 'local-origin');
  const provider = flagValue(flags, 'provider');
  const maxConcurrency = numberFlag(flags, ['max', 'max-concurrency']);

  if (!hubUrlRaw || hubUrlRaw === true) {
    console.error('缺少 --hub 参数，例如：--hub http://192.168.1.10:18897');
    return 1;
  }
  if (!code || code === true) {
    console.error('缺少 --code 配对码参数，配对码显示在中控启动终端/控制台。');
    return 1;
  }
  const nodeName = name && name !== true ? name : os.hostname();
  const dataDir = dataFlag && dataFlag !== true ? path.resolve(String(dataFlag)) : defaultDataDir(nodeName);
  const localOrigin = normalizeLocalOrigin(localFlag && localFlag !== true ? localFlag : DEFAULT_LOCAL_ORIGIN);
  const logger = createCliLogger(dataDir);

  let config = null;
  try {
    // 先用占位 token 规范化校验其余字段（真正的 token 在配对成功后写入）
    config = normalizeNodeConfig({
      hubUrl: String(hubUrlRaw),
      token: 'pair-placeholder-token',
      nodeName,
      dataDir,
      localComic: {origin: localOrigin, provider: provider && provider !== true ? provider : DEFAULT_PROVIDER},
      maxConcurrency,
      enabled: true,
      paused: false,
      allowedProjectIds: [],
      allowedTaskTypes: [...TASK_TYPES],
      heartbeatMs: numberFlag(flags, ['heartbeat-ms']),
      pollMs: numberFlag(flags, ['poll-ms']),
      uploadRetries: numberFlag(flags, ['upload-retries']),
      taskTimeoutMs: numberFlag(flags, ['task-timeout-ms']),
    }, {});
    logger.log('info', `开始配对：中控 ${config.hubUrl}，节点名称「${nodeName}」`);
    const paired = await pairNode({hubUrl: config.hubUrl, code: String(code), name: config.nodeName});
    config = {
      ...config,
      hubUrl: paired.hubUrl,
      token: paired.token,
      hubId: paired.hubId,
      hubName: paired.hubName,
      clientId: paired.clientId,
      nodeId: paired.nodeId,
      protocolVersion: paired.protocolVersion,
      pairedAt: nowIso(),
    };
    const configFile = path.join(config.dataDir, 'config.json');
    const saved = {
      hubUrl: config.hubUrl,
      token: config.token,
      nodeName: config.nodeName,
      dataDir: config.dataDir,
      localComic: config.localComic,
      maxConcurrency: config.maxConcurrency,
      enabled: config.enabled,
      paused: config.paused,
      allowedProjectIds: config.allowedProjectIds,
      allowedTaskTypes: config.allowedTaskTypes,
      heartbeatMs: config.heartbeatMs,
      pollMs: config.pollMs,
      uploadRetries: config.uploadRetries,
      taskTimeoutMs: config.taskTimeoutMs,
      hubId: config.hubId,
      hubName: config.hubName,
      clientId: config.clientId,
      nodeId: config.nodeId,
      protocolVersion: config.protocolVersion || PROTOCOL_VERSION,
      pairedAt: config.pairedAt,
    };
    writeJsonAtomic(configFile, saved);
    logger.log('info', `配对成功：${config.hubName || '协作中控'}（hubId=${config.hubId || '未知'}）`);
    logger.log('info', `节点编号：${config.nodeId || '（中控未返回）'}；协议版本：${config.protocolVersion || PROTOCOL_VERSION}`);
    logger.log('info', `配置文件已写入：${configFile}`);
    logger.log('info', `数据目录：${config.dataDir}`);
    logger.log('info', '下一步：');
    logger.log('info', '  1) 确认本机漫画服务已启动（默认 http://127.0.0.1:18896）；');
    logger.log('info', `  2) 启动节点：node "${scriptFile}" run --config "${configFile}"`);
    logger.log('info', '提示：配置文件中的 token 等同于本机节点凭证，请勿外传或上传到网络。');
    return 0;
  } catch (error) {
    if (error instanceof CollabError) {
      logger.log('error', `配对失败：${error.message}`);
    } else {
      logger.log('error', `配对失败：${describeError(error)}`);
    }
    return 1;
  }
}

// ---------------------------------------------------------------------------
// run --check：配置 + 中控连通 + 本机漫画服务健康检查（不领取任务）
// ---------------------------------------------------------------------------
async function runChecks(config, logger) {
  let ok = true;
  logger.log('info', '开始检查节点配置与服务连通性（--check，不领取任务）…');

  // 1) 中控健康检查（无需 token）
  try {
    const result = await requestJson(`${config.hubUrl}/api/health`, {timeoutMs: 8000});
    const body = result.body && typeof result.body === 'object' ? result.body : {};
    if (body.application && body.application !== HUB_APPLICATION) {
      logger.log('warn', `中控健康检查返回的应用标识异常：${body.application}（期望 ${HUB_APPLICATION}）`);
      ok = false;
    } else {
      logger.log(
        'info',
        `中控连接正常：${body.hubName || config.hubUrl}（协议版本 ${body.protocolVersion || '未知'}，`
        + `在线节点 ${body.nodes && body.nodes.online !== undefined ? body.nodes.online : '未知'}）`,
      );
    }
  } catch (error) {
    logger.log('error', `无法连接中控 ${config.hubUrl}：${describeError(error)}`);
    ok = false;
  }

  // 2) 节点 token 校验（只读接口，不发心跳、不领任务）
  try {
    await requestJson(`${config.hubUrl}/api/nodes`, {
      token: config.token,
      timeoutMs: 8000,
    });
    logger.log('info', '节点 token 校验通过。');
  } catch (error) {
    if (error && error.status === 401) {
      logger.log('error', '节点 token 无效，请重新运行 pair 配对。');
      ok = false;
    } else if (error && error.status === 403 && error.code === 'client_token_required') {
      // 中控先鉴权再校验角色：能走到角色拒绝说明 token 本身有效，只是该只读接口仅客户端可读。
      logger.log('info', '节点 token 认证通过（/api/nodes 仅客户端可读，已跳过角色限制）。');
    } else if (error && error.status === 403) {
      logger.log('error', '节点 token 已被中控吊销或节点记录不可用，请重新运行 pair 配对。');
      ok = false;
    } else if (error && error.status === 404) {
      logger.log('warn', '中控没有 /api/nodes 只读接口（版本可能不匹配），跳过 token 校验。');
    } else {
      logger.log('error', `节点 token 校验失败：${describeError(error)}`);
      ok = false;
    }
  }

  // 3) 本机漫画服务健康检查
  try {
    const result = await requestJson(`${config.localComic.origin}/api/health`, {timeoutMs: 8000});
    const body = result.body && typeof result.body === 'object' ? result.body : {};
    logger.log(
      'info',
      `本机漫画服务连接正常：${body.application || '未知应用'} ${body.version || ''}（${config.localComic.origin}）`,
    );
  } catch (error) {
    logger.log(
      'error',
      `无法连接本机漫画服务 ${config.localComic.origin}：${describeError(error)}（请先启动现有漫画工具/漫画服务）`,
    );
    ok = false;
  }

  // 4) 名额依赖：/api/state 的 scheduler（不可读则节点无法领单）
  try {
    const result = await requestJson(`${config.localComic.origin}/api/state`, {timeoutMs: 8000});
    const scheduler = result.body && result.body.scheduler;
    if (!scheduler || typeof scheduler !== 'object') {
      logger.log('warn', '本机 /api/state 没有 scheduler 字段，节点将无法计算空闲名额（会读取 /api/generation-settings 作为兜底）。');
    } else {
      logger.log(
        'info',
        `本机调度状态：并发上限 ${scheduler.concurrency ?? '未知'}，当前活跃 ${scheduler.active ?? '未知'}，排队 ${scheduler.queued ?? '未知'}。`,
      );
    }
  } catch (error) {
    logger.log('error', `读取本机 /api/state 失败：${describeError(error)}`);
    ok = false;
  }

  logger.log(ok ? 'info' : 'error', ok ? '检查通过：可以运行 run 子命令启动节点。' : '检查未通过：请先修复上面标出的问题。');
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// run 子命令
// ---------------------------------------------------------------------------
async function commandRun(argv) {
  const {flags} = parseArgs(argv);
  const dataFlag = flagValue(flags, 'data', 'data-dir');
  const dataDirOverride = dataFlag && dataFlag !== true ? path.resolve(String(dataFlag)) : null;
  const configFlag = flagValue(flags, 'config');
  const configFile = configFlag && configFlag !== true
    ? path.resolve(String(configFlag))
    : dataDirOverride
      ? path.join(dataDirOverride, 'config.json')
      : null;
  if (!configFile) {
    console.error('缺少 --config 参数。示例：node 节点.mjs run --config "E:\\运行数据\\协作\\节点-小明\\config.json"');
    return 1;
  }

  let config = null;
  try {
    config = loadNodeConfig(configFile, {dataDir: dataDirOverride});
  } catch (error) {
    console.error(error instanceof CollabError ? `节点配置无效：${error.message}` : `读取节点配置失败：${describeError(error)}`);
    return 1;
  }
  const logger = createCliLogger(config.dataDir);
  printBanner(logger.log.bind(logger), [
    '='.repeat(72),
    `PhotoCraft 协作工作节点 v${NODE_VERSION}（协议 ${PROTOCOL_VERSION}）`,
    `配置文件：${configFile}`,
    ...describeNodeConfig(config),
    `日志文件：${logger.logFile}`,
    '='.repeat(72),
  ]);

  if (flags.check === true) {
    return runChecks(config, logger);
  }

  const agent = createNodeAgent({config, logger: (level, message) => logger.log(level, message)});
  let stopping = false;
  let revokeMonitor = null;
  const shutdown = async (signalName) => {
    if (stopping) return;
    stopping = true;
    if (revokeMonitor) clearInterval(revokeMonitor);
    logger.log('info', `收到 ${signalName}，正在优雅退出（清理定时器与在途请求）…`);
    try {
      await agent.stop();
    } catch (error) {
      logger.log('error', `停止节点时发生错误：${describeError(error)}`);
    }
    logger.log('info', `节点已退出。日志：${logger.logFile}`);
    process.exit(0);
  };
  process.once('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('unhandledRejection', (reason) => {
    logger.log('error', `未处理的异步错误：${describeError(reason)}`);
  });
  process.on('uncaughtException', (error) => {
    logger.log('error', `未捕获异常：${describeError(error)}`);
  });

  try {
    await agent.start();
  } catch (error) {
    logger.log('error', `节点启动失败：${describeError(error)}`);
    return 1;
  }
  const status = agent.status();
  logger.log('info', `节点已启动：名称「${status.nodeName}」，心跳间隔 ${config.heartbeatMs}ms，Ctrl+C 退出。`);
  logger.log('info', '节点只主动连中控与本机漫画服务，不开放任何入站端口；等待中控派单…');
  // 中控吊销节点后心跳循环会停止，这里主动退出，避免进程空转。
  revokeMonitor = setInterval(() => {
    if (agent.status().revoked) {
      clearInterval(revokeMonitor);
      revokeMonitor = null;
      logger.log('error', '节点已被中控吊销，停止运行。请重新 pair 配对后再启动。');
      agent.stop().finally(() => process.exit(1));
    }
  }, 5000);
  // 保持进程存活，直到收到 SIGINT/SIGTERM。
  await new Promise(() => {});
  return 0;
}

async function main(argv) {
  const command = argv[0];
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return 0;
  }
  if (command === 'pair') return commandPair(argv.slice(1));
  if (command === 'run') return commandRun(argv.slice(1));
  console.error(`未知命令：${command}\n`);
  printUsage(console.error);
  return 1;
}

const isDirectRun = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => {
      if (typeof code === 'number') process.exitCode = code;
    })
    .catch((error) => {
      console.error(`节点运行失败：${describeError(error)}`);
      process.exitCode = 1;
    });
}

export {main, commandPair, commandRun, runChecks, createCliLogger, defaultDataDir};
