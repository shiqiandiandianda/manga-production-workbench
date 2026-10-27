/**
 * 执行器注册表。执行器是能力，不是应用：没有项目、队列、页面。
 */
import {createFakeExecutor} from './fake.mjs';
import {createWorkshopExecutor} from './workshop.mjs';

export function createExecutorRegistry({config}) {
  const executors = new Map();
  const fake = createFakeExecutor({
    latencyMs: config.executors?.fake?.latencyMs ?? 30
  });
  if (config.executors?.fake?.enabled !== false) executors.set(fake.id, fake);

  if (config.executors?.workshop?.enabled === true) {
    const workshop = createWorkshopExecutor({
      baseUrl: config.executors.workshop.baseUrl,
      timeoutMs: config.executors.workshop.timeoutMs,
      pollMs: config.executors.workshop.pollMs
    });
    executors.set(workshop.id, workshop);
  }

  return {
    get(id) {
      return executors.get(id) ?? null;
    },
    has(id) {
      return executors.has(id);
    },
    list() {
      return [...executors.values()].map(executor => ({
        id: executor.id,
        label: executor.label ?? executor.id,
        capabilities: executor.capabilities
      }));
    }
  };
}
