/**
 * 本机执行循环：领取 → 开始 → 执行 → 回传。
 *
 * 阶段 3 驱动假执行器与真实角色工房；真实节点是独立进程，用同一组用例，通过 HTTP 领取。
 * 长任务期间每 10 秒续租一次；停止时 abort 当前执行器（工房会取消云端任务）。
 */
export function createLocalRunner({
  usecases,
  executors,
  archive,
  logger,
  capacity = 1,
  intervalMs = 120
}) {
  let timer = null;
  let active = 0;
  let pumping = false;
  let closed = false;
  let workerId = null;
  const controllers = new Set();

  async function ensureWorker() {
    if (workerId) return workerId;
    const worker = await usecases.workers.register({
      machineId: 'local',
      poolId: 'local',
      capacity,
      reserve: 0
    });
    workerId = worker.id;
    return workerId;
  }

  async function tick() {
    if (closed || pumping || active >= capacity) return 0;
    pumping = true;
    try {
      const id = await ensureWorker();
      const claim = await usecases.tasks.claim({workerId: id});
      if (!claim) return 0;

      active += 1;
      const {task, attempt, lease} = claim;
      const controller = new AbortController();
      controllers.add(controller);
      const heartbeat = setInterval(() => {
        void usecases.tasks.renew({attemptId: attempt.id, leaseId: lease.id}).catch(error => {
          logger?.warn?.('续租失败', {taskId: task.id, message: error.message});
        });
      }, 10_000);
      heartbeat.unref?.();

      try {
        await usecases.tasks.start({attemptId: attempt.id, leaseId: lease.id});
        const executor = executors.get(task.inputManifest.executor);
        if (!executor) throw new Error(`执行器未就绪：${task.inputManifest.executor}`);

        const references = [];
        for (const reference of task.inputManifest.references ?? []) {
          references.push({
            ...reference,
            bytes: await archive.get(reference.sha256)
          });
        }

        const result = await executor.run(task.inputManifest, {
          signal: controller.signal,
          references
        });
        await usecases.tasks.complete({
          attemptId: attempt.id,
          leaseId: lease.id,
          bytes: result.bytes,
          mime: result.mime,
          engineJobId: result.engineJobId
        });
        return 1;
      } catch (error) {
        logger?.warn?.('本地执行失败', {taskId: task.id, message: error.message});
        try {
          await usecases.tasks.fail({
            attemptId: attempt.id,
            leaseId: lease.id,
            message: error.message,
            started: true
          });
        } catch (failError) {
          logger?.error?.('任务失败状态回写失败', {taskId: task.id, message: failError.message});
        }
        return 0;
      } finally {
        clearInterval(heartbeat);
        controllers.delete(controller);
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
        void tick().catch(error => logger?.warn?.('执行循环异常', {message: error.message}));
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      closed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tick,
    stats() {
      return {active, capacity, running: Boolean(timer)};
    }
  };
}
