// 一键加入（第二台电脑 / 工作节点）：
//   询问（或从参数/上次配置取得）A 电脑的中控地址与配对码 → 自动配对 →
//   自动拉起本机制作工具（18896）→ 启动工作节点 → 显示状态并保持运行。
// 用法：双击根目录「一键加入-局域网协作-第二台电脑.cmd」，
//       或 node 一键加入-第二台电脑.mjs --hub 192.168.1.10:18897 --code ABC123
// 参数：--hub <地址> --code <配对码> --name <节点名> --comic <本机漫画服务地址>
//       --max <并发> --provider <codex|jimeng> --no-start-tool --exit-after <秒，测试用> --help
import os from 'node:os';
import path from 'node:path';
import {createNodeAgent, pairNode} from './lib/node-core.mjs';
import * as u from './lib/oneclick.mjs';

const NODE_STEPS = 5;

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
    'PhotoCraft 局域网协作 · 一键加入（第二台电脑）',
    '',
    '双击根目录「一键加入-局域网协作-第二台电脑.cmd」，按提示输入 A 电脑显示的中控地址和配对码即可。',
    '',
    '可选参数：',
    '  --hub <地址>       A 电脑中控地址，例 192.168.1.10:18897',
    '  --code <配对码>    A 电脑窗口显示的 6 位配对码（配对过一次后不再需要）',
    '  --name <名字>      本机节点名（默认用电脑名）',
    '  --comic <地址>     本机漫画服务地址（默认 http://127.0.0.1:18896）',
    '  --max <数字>       本机最多同时接几个任务（默认 2）',
    '  --provider <渠道>  生图渠道 codex 或 jimeng（默认 codex）',
    '  --no-start-tool    不自动拉起制作工具（要求它已经在运行）',
    '  --help             显示本帮助',
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (flag(args, 'help')) {
    printHelp();
    return;
  }
  const prompter = u.createPrompter();
  try {
    const nodeName = String(args.name || os.hostname() || '工作节点').slice(0, 60);
    const comicOrigin = String(args.comic || u.COMIC_ORIGIN_DEFAULT).replace(/\/+$/, '');
    const provider = String(args.provider || 'codex').toLowerCase() === 'jimeng' ? 'jimeng' : 'codex';
    const dataDir = args.data ? path.resolve(String(args.data)) : u.nodeDataDir(nodeName);
    const configFile = u.nodeConfigPath(nodeName, dataDir);
    const existing = u.readJsonFile(configFile);

    u.section('PhotoCraft 局域网协作 · 一键加入（第二台电脑）');
    u.info('本程序会把这台电脑加入 A 电脑的中控，自动接任务、生图、上传结果。');
    u.info('请保持本窗口打开；关掉窗口 = 停止接任务（不会影响 A 电脑）。');

    // ------------------------------------------------------------------ 1 A 电脑地址
    u.step(1, NODE_STEPS, '连接 A 电脑的协作中控…');
    let hubUrl = u.normalizeHubUrl(args.hub || existing?.hubUrl || '');
    if (!hubUrl) {
      u.info('请打开 A 电脑上的「一键启动」窗口，照着里面的两行输入。');
      hubUrl = u.normalizeHubUrl(await prompter.ask('  请输入 A 电脑显示的中控地址（例 192.168.1.10:18897）：'));
    }
    if (!hubUrl) {
      u.bad('没有填写中控地址，已退出。');
      process.exitCode = 1;
      return;
    }
    const hubInfo = await u.hubHealth(hubUrl, 4000);
    if (!hubInfo) {
      u.bad(`连不上中控：${hubUrl}`);
      u.info('请检查：① A 电脑的「一键启动」窗口还开着；② 两台电脑在同一网络/Wi-Fi；');
      u.info('        ③ A 电脑防火墙已放行 TCP 18897（A 电脑第一次启动时可能弹窗，点“允许”）。');
      u.info(`        ④ 地址是否写错（A 电脑窗口里显示的是 http://${u.lanAddress()}:${u.HUB_PORT_DEFAULT} 形式）。`);
      process.exitCode = 1;
      return;
    }
    u.ok(`已连上 A 电脑的中控「${hubInfo.hubName || 'PhotoCraft 协作中控'}」`);

    // ------------------------------------------------------------------ 2 配对
    u.step(2, NODE_STEPS, '配对这台电脑…');
    let token = null;
    let paired = null;
    if (existing && existing.hubUrl === hubUrl && existing.token) {
      const valid = await u.probeNodeToken(hubUrl, existing.token);
      if (valid) {
        token = existing.token;
        paired = {
          token: existing.token,
          hubId: existing.hubId || null,
          hubName: existing.hubName || '',
          clientId: existing.clientId || null,
          nodeId: existing.nodeId || null,
          protocolVersion: existing.protocolVersion || null,
        };
        u.ok('这台电脑已经加入过，直接复用上次的配对（不需要再输配对码）。');
      }
    }
    if (!token) {
      let code = String(args.code || '').trim();
      if (!code) code = await prompter.ask('  请输入 A 电脑窗口显示的 6 位配对码：');
      if (!code) {
        u.bad('没有填写配对码，已退出。');
        process.exitCode = 1;
        return;
      }
      try {
        paired = await pairNode({hubUrl, code, name: nodeName});
      } catch (error) {
        u.bad('配对失败：' + (error && error.message ? error.message : error));
        u.info('请确认配对码与 A 电脑窗口里显示的一致（配对码轮换后旧码会失效）。');
        process.exitCode = 1;
        return;
      }
      token = paired.token;
      u.ok('配对成功，令牌已保存到这台电脑。');
    }

    // ------------------------------------------------------------------ 3 本机制作工具
    u.step(3, NODE_STEPS, '检查本机制作工具（本机 18896 漫画服务）…');
    const comic = await u.ensureComicService({origin: comicOrigin, autoStart: !flag(args, 'no-start-tool')});
    if (!comic.ok) {
      u.bad('本机制作工具没有就绪，无法接任务。');
      u.info('请先双击「启动漫画融合版.cmd」，等编辑器窗口完全出现后，再双击本程序。');
      process.exitCode = 1;
      return;
    }

    // 写入/更新节点配置（以后双击「启动协作节点.cmd」也能直接用）
    const maxConcurrency = Math.max(1, Math.min(8, Number(args.max) || Number(existing?.maxConcurrency) || 2));
    const nodeConfig = u.nodeConfigFromPairing({
      hubUrl,
      paired: {...paired, token},
      nodeName,
      dataDir,
      comicOrigin,
      provider,
      maxConcurrency,
      existing,
    });
    u.writeNodeConfigFile(configFile, nodeConfig);
    u.ok('节点配置已保存：' + configFile);

    // ------------------------------------------------------------------ 4 启动节点
    u.step(4, NODE_STEPS, `启动工作节点「${nodeName}」（最多同时 ${maxConcurrency} 个任务）…`);
    const agent = createNodeAgent({
      config: nodeConfig,
      logger: (level, message) => {
        const tag = level === 'error' ? '[节点][错误] ' : level === 'warn' ? '[节点][提示] ' : '[节点] ';
        console.log('       ' + tag + message);
      },
    });
    await agent.start();
    const deadline = Date.now() + 15000;
    let status = agent.status();
    while (Date.now() < deadline) {
      status = agent.status();
      if (status.lastHeartbeatAt || status.revoked) break;
      await u.sleep(500);
    }
    if (status.revoked) {
      u.bad('中控显示这台电脑的节点已被吊销，请让 A 电脑在控制台「节点」页解除，或重新运行本程序配对。');
      process.exitCode = 1;
      return;
    }
    if (status.lastHeartbeatAt) {
      u.ok('节点已上线，正在等 A 电脑派任务。');
    } else {
      u.warn('节点已启动，但暂时没收到中控心跳响应：' + (status.lastError || '稍后会自动重试'));
    }

    // ------------------------------------------------------------------ 5 就绪
    u.step(5, NODE_STEPS, '加入完成');
    console.log('');
    console.log('--------------------------------------------------------------');
    console.log('  这台电脑已经加入协作');
    console.log('--------------------------------------------------------------');
    console.log(`  中控：${hubUrl}`);
    console.log(`  节点名：${nodeName}（最多同时 ${maxConcurrency} 个任务）`);
    console.log(`  本机漫画服务：${comicOrigin}（渠道 ${provider}）`);
    console.log('');
    console.log('  现在保持本窗口打开即可。');
    console.log('  回 A 电脑的协作页勾选画格提交，本机会自动领取、调用本机账号生图、上传结果。');
    console.log('  关闭本窗口 = 停止接任务（A 电脑的中控和别的电脑不受影响）。');
    console.log('--------------------------------------------------------------');
    console.log('');

    // ------------------------------------------------------------------ 状态与关闭
    let stopping = false;
    const shutdown = async (reason) => {
      if (stopping) return;
      stopping = true;
      console.log('');
      console.log(`[停止] ${reason}，正在停止节点…`);
      try {
        await Promise.race([agent.stop(), u.sleep(8000)]);
      } catch {
        // 忽略
      }
      console.log('[停止] 已停止。本窗口可以关闭了。');
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('收到 Ctrl+C'));
    process.on('SIGTERM', () => void shutdown('窗口被关闭'));

    const startedAt = Date.now();
    const statusTimer = setInterval(async () => {
      if (stopping) return;
      const [hub, comicNow] = await Promise.all([u.hubHealth(hubUrl, 1500), u.comicHealth(comicOrigin, 1200)]);
      const nodeStatus = agent.status();
      const hubText = hub ? '正常' : '连不上';
      const comicText = comicNow ? '正常' : '异常';
      const nodeText = nodeStatus.revoked
        ? '已被吊销'
        : nodeStatus.lastHeartbeatAt
          ? `在线（空闲名额 ${nodeStatus.freeSlots}，执行中 ${nodeStatus.runningTasks.length}）`
          : '等待心跳';
      const minutes = Math.floor((Date.now() - startedAt) / 60000);
      console.log(`[状态 ${u.clock()}] 中控：${hubText} · 本机节点：${nodeText} · 漫画服务：${comicText} · 已运行 ${minutes} 分钟`);
      if (!hub) console.log('       [!] 连不上中控：确认 A 电脑的「一键启动」窗口还开着；网络没断。');
      if (!comicNow) console.log('       [!] 本机制作工具没响应：重新双击「启动漫画融合版.cmd」，然后重启本程序。');
      if (nodeStatus.revoked) console.log('       [!] 节点已被吊销：请重新运行本程序配对（需要新的配对码）。');
    }, 5000);

    const exitAfter = Number(args['exit-after']);
    if (Number.isFinite(exitAfter) && exitAfter > 0) {
      console.log(`[自动化] ${exitAfter} 秒后自动停止（测试参数 --exit-after）。`);
      setTimeout(() => void shutdown('自动化测试到时'), exitAfter * 1000);
    }
    statusTimer.unref?.();
    prompter.close();
    await new Promise(() => {
      // 节点心跳定时器维持进程存活；收到停止信号时 process.exit。
    });
  } finally {
    prompter.close();
  }
}

main().catch((error) => {
  console.error('');
  console.error('[X] 一键加入失败：' + (error && error.message ? error.message : error));
  console.error('请把上面的内容截图发给维护人员。');
  process.exitCode = 1;
});
