#!/usr/bin/env node
/**
 * node：算力机器上的独立执行进程。
 *
 * 不监听端口、不碰数据库；只通过 hub API 注册、心跳、领取、回传。
 * 执行器（假执行器 / 角色工房）在本机运行，账号与模型留在本机。
 */
import os from 'node:os';
import {loadConfig} from '../platform/config/index.mjs';
import {createLogger} from '../platform/log/index.mjs';
import {createExecutorRegistry} from '../adapters/engines/index.mjs';
import {createHubClient} from './node-client.mjs';
import {createNodeRunner} from './node-runner.mjs';
import {installShutdown, parseArgs, printFatal} from './cli.mjs';
import {PHASE_LABEL, PRODUCT_NAME} from '../version.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法：node app/roles/node.mjs --config config/node.local.json');
    return;
  }

  const config = loadConfig({file: args.config, overrides: {role: 'node'}});
  if (!config.hub.url) {
    throw new Error('未配置 hub.url；节点需要知道中央服务地址');
  }

  const logger = createLogger({level: config.logLevel, scope: 'node'});
  const executors = createExecutorRegistry({config});
  if (!executors.list().length) {
    throw new Error('没有可用执行器；请启用 executors.fake 或 executors.workshop');
  }

  const machineId = config.node.machineId || os.hostname();
  const client = createHubClient({
    baseUrl: config.hub.url,
    token: config.hub.workerToken
  });
  const runner = createNodeRunner({
    config,
    client,
    executors,
    logger,
    machineId
  });

  const workerId = await runner.ensureRegistered();
  runner.start();

  console.log('');
  console.log(`${PRODUCT_NAME} · node · ${PHASE_LABEL}`);
  console.log(`集群       ${config.hub.url}`);
  console.log(`节点       ${workerId}`);
  console.log(`机器/池    ${machineId} / ${config.node.poolId}`);
  console.log(`容量       ${config.node.capacity}（保留 ${config.node.reserve}）`);
  console.log(`执行器     ${executors.list().map(item => item.id).join(', ')}`);
  console.log(`journal    ${runner.journalDir}`);
  console.log('按 Ctrl+C 停止。');
  console.log('');

  installShutdown(() => runner.stop(), logger);
}

main().catch(error => {
  printFatal(error);
  process.exitCode = 1;
});
