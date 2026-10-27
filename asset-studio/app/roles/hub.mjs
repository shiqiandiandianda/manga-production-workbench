#!/usr/bin/env node
/**
 * hub：团队共享的唯一工作流权威。
 *
 * 同一套 Web 外壳与 API；中心机启动后，同事直接用浏览器打开局域网地址即可，
 * 不需要在自己的电脑上安装或启动任何东西。额外的算力机器再运行 node 角色。
 */
import os from 'node:os';
import {loadConfig} from '../platform/config/index.mjs';
import {listen} from '../platform/http/server.mjs';
import {openBrowser} from '../platform/system/open-browser.mjs';
import {createLogger} from '../platform/log/index.mjs';
import {ensureSqliteRuntime, installShutdown, parseArgs, printFatal} from './cli.mjs';
import {PHASE_LABEL, PRODUCT_NAME} from '../version.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法：node app/roles/hub.mjs [--config <文件>] [--port <端口>] [--host <地址>] [--open]');
    return;
  }
  if (!(await ensureSqliteRuntime())) {
    process.exitCode = 1;
    return;
  }

  const hub = {};
  if (args.port !== undefined) hub.port = Number(args.port);
  if (args.host !== undefined) hub.listen = String(args.host);

  const config = loadConfig({
    file: args.config,
    overrides: {role: 'hub', ...(Object.keys(hub).length ? {hub} : {})}
  });
  const logger = createLogger({level: config.logLevel, scope: 'hub'});

  if (config.hub.listen !== '127.0.0.1' && config.hub.listen !== 'localhost') {
    if (!config.hub.workerToken) {
      logger.warn('中心已对局域网开放，但未设置 hub.workerToken；仅建议在可信局域网使用');
    } else {
      logger.info('中心已对局域网开放；节点需要携带同一个 workerToken');
    }
  }

  const {createRuntime} = await import('./runtime.mjs');
  const runtime = createRuntime({config, logger});
  const address = await listen(runtime.server, config.hub.port, config.hub.listen);
  const port = address.port;
  const localUrl = `http://127.0.0.1:${port}/`;
  const lanAddresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(item => item && item.family === 'IPv4' && !item.internal)
    .map(item => item.address);

  console.log('');
  console.log(`${PRODUCT_NAME} · hub · ${PHASE_LABEL}`);
  console.log(`本机入口   ${localUrl}`);
  for (const ip of lanAddresses) console.log(`局域网     http://${ip}:${port}/`);
  console.log(`数据库     ${config.paths.database}`);
  console.log(`配置       ${config.meta.exists ? config.meta.configFile : '(默认值)'}`);
  console.log('同事用浏览器打开上面的局域网地址即可；按 Ctrl+C 停止。');
  console.log('');

  if (args.open) openBrowser(localUrl);

  installShutdown(() => runtime.close(), logger);
}

main().catch(error => {
  printFatal(error);
  process.exitCode = 1;
});
