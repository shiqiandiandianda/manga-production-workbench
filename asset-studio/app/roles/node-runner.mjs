/**
 * 独立执行节点：注册 → 心跳 → 领取 → 执行 → 回传。
 *
 * 与 studio 的本机执行循环共用同一组用例语义，但节点不碰数据库，
 * 只通过 hub 的 HTTP API 工作；本机 journal 只用于崩溃后核实，不自动重派。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createNodeRunner({
  config,
  client,
  executors,
  logger,
  machineId = config.node.machineId || os.hostname(),
  journalDir
}) {
  const capacity = config.node.capacity;
  const journal = path.resolve(journalDir ?? path.join(config.paths.data, 'node-journal'));
  fs.mkdirSync(journal, {recursive: true});

  let workerId = null;
  let timer = null;
  let active = 0;
  let pumping = false;
  let closed = false;
  let lastHeartbeat = 0;

  for (const name of fs.readdirSync(journal)) {
    if (name.endsWith('.json')) {
      logger?.warn?.('发现上次未清理的执行记录，请核实原任务后再决定是否重试', {
        file: path.join(journal, name)
      });
    }
  }

  async function ensureRegistered() {
    if (workerId) return workerId;
    const response = await client.register({
      machineId,
      poolId: config.node.poolId,
      capacity,
      reserve: config.node.reserve
    });
    workerId = response.worker.id;
    logger?.info?.('节点已注册', {workerId, machineId, poolId: config.node.poolId, capacity});
    return workerId;
  }

  async function heartbeat(force = false) {
    const id = await ensureRegistered();
    const now = Date.now();
    if (!force && now - lastHeartbeat < config.node.heartbeatMs) return id;
    await client.heartbeat(id, {
      ready: true,
      capacity,
      reserve: config.node.reserve
    });
    lastHeartbeat = now;
    return id;
  }

  async function tick() {
    if (closed || pumping || active >= capacity) return 0;
    pumping = true;
    try {
      await heartbeat();
      const id = await ensureRegistered();
      const response = await client.claim(id);
      const claim = response.claim;
      if (!claim) return 0;

      active += 1;
      const {task, attempt, lease} = claim;
      const journalFile = path.join(journal, `${task.id}.json`);
      fs.writeFileSync(journalFile, JSON.stringify({
        taskId: task.id,
        attemptId: attempt.id,
        leaseId: lease.id,
        startedAt: new Date().toISOString()
      }), 'utf8');

      try {
        await client.started(attempt.id, {leaseId: lease.id});
        const executor = executors.get(task.inputManifest.executor);
        if (!executor) throw new Error(`执行器未就绪：${task.inputManifest.executor}`);

        const references = [];
        for (const reference of task.inputManifest.references ?? []) {
          references.push({...reference, bytes: await client.downloadBlob(reference.sha256)});
        }

        const result = await executor.run(task.inputManifest, {references});
        await client.result(attempt.id, {
          leaseId: lease.id,
          imageBase64: result.bytes.toString('base64'),
          mime: result.mime,
          engineJobId: result.engineJobId
        });
        fs.rmSync(journalFile, {force: true});
        return 1;
      } catch (error) {
        logger?.warn?.('节点执行失败', {taskId: task.id, message: error.message});
        try {
          await client.fail(attempt.id, {
            leaseId: lease.id,
            message: error.message,
            started: true
          });
        } catch (failError) {
          logger?.error?.('节点失败回写失败', {taskId: task.id, message: failError.message});
        }
        fs.rmSync(journalFile, {force: true});
        return 0;
      } finally {
        active -= 1;
      }
    } finally {
      pumping = false;
    }
  }

  return {
    start() {
      if (timer || closed) return;
      timer = setInterval(() => {
        void tick().catch(error => logger?.warn?.('节点循环异常', {message: error.message}));
      }, config.node.claimMs);
      // 节点没有监听端口；这个定时器就是进程的存活句柄，不能 unref。
    },
    stop() {
      closed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tick,
    ensureRegistered,
    heartbeat,
    journalDir: journal,
    stats() {
      return {workerId, active, capacity, running: Boolean(timer), machineId, poolId: config.node.poolId};
    }
  };
}
