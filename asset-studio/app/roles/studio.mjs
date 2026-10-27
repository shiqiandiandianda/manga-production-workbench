#!/usr/bin/env node
/**
 * studio：每位同事本机的唯一入口。
 *
 * 默认监听 127.0.0.1:8792；端口被占用时自动向后找。
 * 团队模式下，集群请求会转发给 hub；单人模式下内核直接内嵌在进程里。
 */
import {loadConfig} from '../platform/config/index.mjs';
import {listenWithFallback} from '../platform/http/server.mjs';
import {openBrowser} from '../platform/system/open-browser.mjs';
import {createLogger} from '../platform/log/index.mjs';
import {ensureSqliteRuntime, installShutdown, parseArgs, printFatal} from './cli.mjs';
import {PHASE_LABEL, PRODUCT_NAME} from '../version.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法：node app/roles/studio.mjs [--config <文件>] [--port <端口>] [--host <地址>] [--open]');
    return;
  }
  if (!(await ensureSqliteRuntime())) {
    process.exitCode = 1;
    return;
  }

  const studio = {};
  if (args.port !== undefined) studio.port = Number(args.port);
  if (args.host !== undefined) studio.host = String(args.host);

  const config = loadConfig({
    file: args.config,
    overrides: {role: 'studio', ...(Object.keys(studio).length ? {studio} : {})}
  });
  const logger = createLogger({level: config.logLevel, scope: 'studio'});

  const {createRuntime} = await import('./runtime.mjs');
  const runtime = createRuntime({config, logger});

  const address = await listenWithFallback(
    runtime.server,
    config.studio.port,
    config.studio.host
  );
  const host = address.address === '::' ? '127.0.0.1' : address.address;
  const url = `http://${host}:${address.port}/`;

  if (address.port !== config.studio.port) {
    console.log(`端口 ${config.studio.port} 被占用，已改用 ${address.port}。`);
  }

  console.log('');
  console.log(`${PRODUCT_NAME} · ${PHASE_LABEL}`);
  console.log(`本机入口   ${url}`);
  console.log(`数据目录   ${config.paths.data}`);
  console.log(`数据库     ${config.paths.database}`);
  console.log(`配置       ${config.meta.exists ? config.meta.configFile : '(默认值)'}`);
  console.log('按 Ctrl+C 停止。');
  console.log('');

  if (args.open) openBrowser(url);

  installShutdown(() => runtime.close(), logger);
}

main().catch(error => {
  printFatal(error);
  process.exitCode = 1;
});
