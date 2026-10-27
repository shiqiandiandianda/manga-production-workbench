/**
 * 结构化日志：一行一个 JSON，便于 grep 与后续接入日志文件。
 */
const LEVELS = {debug: 10, info: 20, warn: 30, error: 40};

export function createLogger({level = 'info', scope = 'app', stream = process.stdout} = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(lvl, message, data) {
    if ((LEVELS[lvl] ?? LEVELS.info) < threshold) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: lvl,
      scope,
      message,
      ...(data === undefined ? {} : {data})
    });
    (lvl === 'error' ? process.stderr : stream).write(`${line}\n`);
  }

  return {
    debug: (message, data) => write('debug', message, data),
    info: (message, data) => write('info', message, data),
    warn: (message, data) => write('warn', message, data),
    error: (message, data) => write('error', message, data),
    child: childScope => createLogger({level, scope: `${scope}:${childScope}`, stream})
  };
}
