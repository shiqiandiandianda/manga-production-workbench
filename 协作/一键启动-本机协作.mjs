// 一键启动（A 电脑 / 本机试跑）：
//   自动检查并拉起制作工具（18896）→ 启动协作中控（18897）→ 自动配对协作页 →
//   自动启动一个本机工作节点 → 打开控制台与协作页 → 显示使用说明并保持运行。
// 用法：双击根目录「一键启动-局域网协作.cmd」，或 node 一键启动-本机协作.mjs [参数]。
// 参数：--port <中控端口> --comic <本机漫画服务地址> --node-name <节点名> --max <并发>
//       --no-node 不启动本机节点、--no-browser 不打开浏览器、--no-start-tool 不自动拉起制作工具
//       --exit-after <秒> 仅供自动化测试；--help 帮助
import path from 'node:path';
import os from 'node:os';
import {runHub} from './中控.mjs';
import {createNodeAgent, pairNode} from './lib/node-core.mjs';
import * as u from './lib/oneclick.mjs';

const HUB_STEPS = 6;

function parseArgs(argv) {
  const result = {_args: []};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index]);
    if (!token.startsWith('--')) {
      result._args.push(token);
      continue;
    }
    const equal = token.indexOf('=');
    const name = equal > 0 ? token.slice(2, equal) : token.slice(2);
    if (equal > 0) {
      result[name] = token.slice(equal + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !String(next).startsWith('--')) {
      result[name] = String(next);
      index += 1;
    } else {
      result[name] = true;
    }
  }
  return result;
}

function flag(args, name) {
  return args[name] === true || args[name] === 'true' || args[name] === '1';
}

function printHelp() {
  console.log([
    'PhotoCraft 局域网协作 · 一键启动（本机）',
    '',
    '双击根目录「一键启动-局域网协作.cmd」即可，一般不需要参数。',
    '',
    '可选参数：',
    '  --port <端口>        中控端口（默认 18897，一般不用改）',
    '  --comic <地址>       本机漫画服务地址（默认 http://127.0.0.1:18896）',
    '  --node-name <名字>   本机工作节点名称（默认「本机节点」）',
    '  --max <数字>         本机节点同时接几个任务（默认 2）',
    '  --no-node            只启动中控，不启动本机节点（准备只用另一台电脑生成时）',
    '  --no-browser         不自动打开浏览器',
    '  --no-start-tool      不自动拉起制作工具（要求它已经在运行）',
    '  --help               显示本帮助',
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    printHelp();
    return;
  }
  const comicOrigin = String(args.comic || u.COMIC_ORIGIN_DEFAULT).replace(/\/+$/, '');
  const hubPortOverride = args.port ? Number(args.port) : null;
  const nodeName = String(args['node-name'] || '本机节点');
  const maxConcurrency = Math.max(1, Math.min(8, Number(args.max) || 2));
  const startLocalNode = !flag(args, 'no-node');
  const autoStartTool = !flag(args, 'no-start-tool');
  const openBrowsers = !flag(args, 'no-browser');

  u.section('PhotoCraft 局域网协作 · 一键启动（本机）');
  u.info('这个窗口会自动完成：启动制作工具 → 启动协作中控 → 配对协作页 → 启动本机节点。');
  u.info('请保持本窗口打开；关掉窗口 = 停止中控和本机节点。');
  u.info(`本机位置：${u.PACKAGE_ROOT}`);

  // ------------------------------------------------------------------ 1 制作工具
  u.step(1, HUB_STEPS, '检查制作工具（本机 18896 漫画服务）…');
  const comic = await u.ensureComicService({origin: comicOrigin, autoStart: autoStartTool});
  if (!comic.ok) {
    u.bad('制作工具没有就绪，无法继续。');
    u.info('处理办法：双击根目录「启动漫画融合版.cmd」，等编辑器窗口完全出现后，再双击本程序。');
    process.exitCode = 1;
    return;
  }

  // ------------------------------------------------------------------ 2 中控
  u.step(2, HUB_STEPS, '启动协作中控…');
  const ensured = u.ensureHubConfigFile();
  if (ensured.created) {
    u.ok('已自动创建中控配置文件：' + u.HUB_CONFIG_FILE);
  }
  const hubArgv = ['--config', u.HUB_CONFIG_FILE];
  if (hubPortOverride) hubArgv.push('--port', String(hubPortOverride));
  const hubLogger = {
    info: (message) => console.log('       [中控] ' + message),
    warn: (message) => console.log('       [中控] ' + message),
    error: (message) => console.log('       [中控] ' + message),
  };
  let hub = null;
  try {
    hub = await runHub({argv: hubArgv, logger: hubLogger});
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    u.bad('中控启动失败：' + message);
    if (/占用|EADDRINUSE/.test(message)) {
      u.info('最常见原因：上一次的一键窗口还没关，或 18897 被别的程序占用。');
      u.info('请关闭上一次的「一键启动」窗口后重试；仍不行就重启电脑再试。');
    }
    process.exitCode = 1;
    return;
  }
  if (!hub) {
    u.bad('中控没有启动（未知原因）。');
    process.exitCode = 1;
    return;
  }
  const hubPort = hub.boundPort || hubPortOverride || u.HUB_PORT_DEFAULT;
  const hubLocalUrl = `http://127.0.0.1:${hubPort}`;
  const pairingCode = await u.pairingCodeForHub(hub);
  const hubId = String(hub?.hub?.state?.hubId || '');
  u.ok(`中控已启动：${hubLocalUrl}（局域网地址 http://${u.lanAddress()}:${hubPort}）`);
  u.ok(`当前配对码：${pairingCode}`);

  // ------------------------------------------------------------------ 3 配对 A 端协作页
  u.step(3, HUB_STEPS, '把协作页自动配对到中控…');
  const pairing = await u.ensureComicClientPairing({
    comicOrigin,
    hubUrl: hubLocalUrl,
    pairingCode,
    expectedHubId: hubId,
    clientName: 'A电脑',
  });
  if (pairing.ok) {
    u.ok(pairing.reused ? '协作页此前已配对，直接复用。' : '协作页配对成功（令牌已保存在本机）。');
  } else {
    u.warn('协作页自动配对失败：' + pairing.error);
    u.info('不影响中控和节点；稍后可在协作页手动填「中控地址 + 配对码」再点「配对连接」。');
  }

  // ------------------------------------------------------------------ 4 本机节点
  let agent = null;
  let nodeConfig = null;
  let nodeConfigFile = '';
  if (startLocalNode) {
    u.step(4, HUB_STEPS, `启动本机工作节点「${nodeName}」（最多同时 ${maxConcurrency} 个任务）…`);
    const dataDir = args.data ? path.resolve(String(args.data)) : u.nodeDataDir(nodeName);
    nodeConfigFile = u.nodeConfigPath(nodeName, dataDir);
    const existing = u.readJsonFile(nodeConfigFile);
    let paired = null;
    if (existing && existing.hubId === hubId && existing.hubUrl === hubLocalUrl && existing.token) {
      const valid = await u.probeNodeToken(hubLocalUrl, existing.token);
      if (valid) {
        u.ok('这台电脑此前已配对过，直接复用令牌。');
        paired = {
          token: existing.token,
          hubId: existing.hubId,
          hubName: existing.hubName || '',
          clientId: existing.clientId || null,
          nodeId: existing.nodeId || null,
          protocolVersion: existing.protocolVersion || null,
        };
      }
    }
    if (!paired) {
      try {
        paired = await pairNode({hubUrl: hubLocalUrl, code: pairingCode, name: nodeName});
        u.ok('节点配对成功。');
      } catch (error) {
        u.bad('节点配对失败：' + (error && error.message ? error.message : error));
        u.info('中控和协作页仍可用，可稍后双击「启动协作节点.cmd」重试。');
        process.exitCode = 1;
        return;
      }
    }
    nodeConfig = u.nodeConfigFromPairing({
      hubUrl: hubLocalUrl,
      paired: {...paired, token: paired.token},
      nodeName,
      dataDir,
      comicOrigin,
      maxConcurrency,
      existing,
    });
    u.writeNodeConfigFile(nodeConfigFile, nodeConfig);
    agent = createNodeAgent({
      config: nodeConfig,
      logger: (level, message) => {
        const tag = level === 'error' ? '[节点][错误] ' : level === 'warn' ? '[节点][提示] ' : '[节点] ';
        console.log('       ' + tag + message);
      },
    });
    await agent.start();
    const heartbeatDeadline = Date.now() + 15000;
    let status = agent.status();
    while (Date.now() < heartbeatDeadline) {
      status = agent.status();
      if (status.lastHeartbeatAt) break;
      if (status.revoked) break;
      await u.sleep(500);
    }
    if (status.revoked) {
      u.bad('节点已被中控吊销。请在控制台「节点」页解除或重新运行本程序。');
    } else if (status.lastHeartbeatAt) {
      u.ok(`本机节点已上线（${status.settings.maxConcurrency} 个名额，等中控派单）。`);
    } else {
      u.warn('节点已启动但还没收到中控心跳响应：' + (status.lastError || '稍后会自动重试'));
    }
  } else {
    u.step(4, HUB_STEPS, '按参数要求：本次不启动本机节点（只做中控）。');
  }

  // ------------------------------------------------------------------ 5 浏览器
  u.step(5, HUB_STEPS, '打开浏览器页面…');
  const consoleUrl = `${hubLocalUrl}/?pair=${encodeURIComponent(pairingCode)}`;
  const collabUrl = `${comicOrigin}/collab.html`;
  if (openBrowsers) {
    u.openBrowser(consoleUrl);
    u.openBrowser(collabUrl);
    u.ok('已打开：中控控制台');
    u.ok('已打开：协作页（在这里勾选画格提交）');
  } else {
    u.info('（已跳过自动打开浏览器）');
  }

  // ------------------------------------------------------------------ 6 就绪
  u.step(6, HUB_STEPS, '全部就绪');
  const lanHost = u.lanAddress();
  console.log('');
  console.log('--------------------------------------------------------------');
  console.log('  现在可以开始用了');
  console.log('--------------------------------------------------------------');
  console.log('  浏览器里应该已经打开两个页面：');
  console.log(`    1) 中控控制台：${hubLocalUrl}/`);
  console.log(`    2) 协作页：   ${collabUrl}`);
  console.log('');
  console.log('  第一次用只需要三步：');
  console.log('    1. 协作页顶部已自动填好中控地址和配对码；若显示“未配对”，手动填：');
  console.log(`         中控地址 ${hubLocalUrl}    配对码 ${pairingCode}`);
  console.log('    2. 在协作页选一个工程 → 勾选 1 个画格 → 点「提交协作生成」。');
  console.log('    3. 中控控制台「任务」页会看到 排队→执行中→上传中→完成；完成后自动回填到画格。');
  console.log('');
  console.log('  ★ 这会用本机已登录的 Codex/即梦账号真实生图，会消耗生成额度，第一次先只勾 1 格。');
  console.log('');
  console.log('  如果还有第二台电脑，让它加入：');
  console.log('    1) 那台电脑打开同一个完整软件包；');
  console.log('    2) 双击包根目录「一键加入-局域网协作-第二台电脑.cmd」；');
  console.log('    3) 按提示输入下面两行（照抄）：');
  console.log(`         中控地址：${lanHost}:${hubPort}`);
  console.log(`         配对码：  ${pairingCode}`);
  console.log('--------------------------------------------------------------');
  console.log('');

  // ------------------------------------------------------------------ 状态与关闭
  let stopping = false;
  const shutdown = async (reason) => {
    if (stopping) return;
    stopping = true;
    console.log('');
    console.log(`[停止] ${reason}，正在停止节点和中控…`);
    try {
      await Promise.race([agent ? agent.stop() : Promise.resolve(), u.sleep(8000)]);
    } catch {
      // 忽略停止错误
    }
    try {
      if (hub) await hub.close();
    } catch {
      // 忽略关闭错误
    }
    console.log('[停止] 已停止。本窗口可以关闭了。');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('收到 Ctrl+C'));
  process.on('SIGTERM', () => void shutdown('窗口被关闭'));

  const startedAt = Date.now();
  const statusTimer = setInterval(async () => {
    if (stopping) return;
    const [hubInfo, comicInfo] = await Promise.all([u.hubHealth(hubLocalUrl, 1200), u.comicHealth(comicOrigin, 1200)]);
    const nodeStatus = agent ? agent.status() : null;
    const hubText = hubInfo ? '正常' : '异常';
    const comicText = comicInfo ? '正常' : '异常';
    let nodeText = '未启动';
    if (nodeStatus) {
      if (nodeStatus.revoked) nodeText = '已被吊销';
      else if (nodeStatus.lastHeartbeatAt) nodeText = `在线（空闲名额 ${nodeStatus.freeSlots}，执行中 ${nodeStatus.runningTasks.length}）`;
      else nodeText = '等待心跳';
    }
    const minutes = Math.floor((Date.now() - startedAt) / 60000);
    console.log(`[状态 ${u.clock()}] 中控：${hubText} · 本机节点：${nodeText} · 漫画服务：${comicText} · 已运行 ${minutes} 分钟`);
    if (!hubInfo) console.log('       [!] 中控异常：如果本窗口还在但中控无响应，请重启本程序。');
    if (!comicInfo) console.log('       [!] 漫画服务异常：制作工具可能被关闭了，重新双击「启动漫画融合版.cmd」后重启本程序。');
  }, 5000);

  const exitAfter = Number(args['exit-after']);
  if (Number.isFinite(exitAfter) && exitAfter > 0) {
    console.log(`[自动化] ${exitAfter} 秒后自动停止（测试参数 --exit-after）。`);
    setTimeout(() => void shutdown('自动化测试到时'), exitAfter * 1000);
  }
  // 保持窗口运行；状态定时器会持续输出。
  statusTimer.unref?.();
  await new Promise((resolve) => {
    const keep = setInterval(() => {
      if (stopping) {
        clearInterval(keep);
        resolve();
      }
    }, 1000);
    keep.unref?.();
  });
}

main().catch((error) => {
  console.error('');
  console.error('[X] 一键启动失败：' + (error && error.message ? error.message : error));
  console.error('请把上面的内容截图发给维护人员。');
  process.exitCode = 1;
});
