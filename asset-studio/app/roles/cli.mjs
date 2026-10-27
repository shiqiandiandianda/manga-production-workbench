/**
 * 角色入口共用的小工具：参数解析、运行时能力检查、优雅退出。
 */
export function parseArgs(argv, known = ['config', 'port', 'host', 'help', 'open']) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`无法识别的参数：${token}`);
    }
    const name = token.slice(2);
    if (!known.includes(name)) {
      throw new Error(`未知选项：--${name}`);
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      if (name !== 'help' && name !== 'open') throw new Error(`选项 --${name} 需要一个值`);
      args[name] = true;
    } else {
      args[name] = next;
      index += 1;
    }
  }
  return args;
}

/** node:sqlite 是 Node 24 内置模块；缺少时给一句人话，而不是堆栈。 */
export async function ensureSqliteRuntime() {
  try {
    await import('node:sqlite');
    return true;
  } catch {
    console.error(
      [
        '当前 Node 版本没有内置 node:sqlite。',
        '请使用 Node.js 24 或更新版本（本项目目标运行时），或改用带 --experimental-sqlite 的 Node 22/23。',
        `当前版本：${process.version}`
      ].join('\n')
    );
    return false;
  }
}

export function installShutdown(close, logger) {
  let stopping = false;
  const stop = async signal => {
    if (stopping) return;
    stopping = true;
    logger?.info?.(`收到 ${signal}，正在停止`);
    try {
      await close();
    } catch (error) {
      logger?.error?.('停止时出错', {message: error.message});
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

export function printFatal(error) {
  if (error?.code === 'EADDRINUSE') {
    console.error(`端口已被占用：${error.address}:${error.port}。请先停止占用该端口的进程，或改用 --port。`);
    return;
  }
  console.error(error?.message || String(error));
  if (error?.stack && process.env.APP_DEBUG === '1') console.error(error.stack);
}
