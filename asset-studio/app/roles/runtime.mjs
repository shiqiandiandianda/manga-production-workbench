/**
 * 组合根：把 core 用例、SQLite 仓储、HTTP 路由、本机执行循环装成一个可启动的运行时。
 *
 * studio / hub 共用本文件；角色差异只体现在监听地址与端口。
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createUsecases} from '../core/usecases/index.mjs';
import {newId} from '../core/ids.mjs';
import {createRepositories} from '../platform/db/repositories.mjs';
import {migrate} from '../platform/db/migrate.mjs';
import {openDatabase} from '../platform/db/open.mjs';
import {createTransaction} from '../platform/db/transaction.mjs';
import {createAppServer} from '../platform/http/server.mjs';
import {createLogger} from '../platform/log/index.mjs';
import {createLocalArchive} from '../adapters/archive/local.mjs';
import {createExecutorRegistry} from '../adapters/engines/index.mjs';
import {createRoutes} from '../api/routes.mjs';
import {createLocalRunner} from './runner.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createRuntime({
  config,
  databaseFile,
  archive,
  logger = createLogger({level: config.logLevel})
}) {
  const db = openDatabase(databaseFile ?? config.paths.database);
  const migration = migrate(db, {logger});
  const archiveStore = archive ?? createLocalArchive({root: config.paths.cache});

  const repos = createRepositories(db);
  const tx = createTransaction(db);
  const executors = createExecutorRegistry({config});
  const clock = () => new Date().toISOString();
  const usecases = createUsecases({
    projects: repos.projects,
    assets: repos.assets,
    episodes: repos.episodes,
    tasks: repos.tasks,
    attempts: repos.attempts,
    leases: repos.leases,
    batches: repos.batches,
    approvals: repos.approvals,
    bindings: repos.bindings,
    workers: repos.workers,
    events: repos.events,
    archive: archiveStore,
    executors,
    tx,
    clock,
    ids: newId
  });

  const runner = config.executors.fake.enabled
    ? createLocalRunner({usecases, executors, archive: archiveStore, logger, capacity: 1})
    : null;
  if (runner && config.executors.fake.autoRun) runner.start();

  const router = createRoutes({config, usecases, archive: archiveStore, executors});
  const {server} = createAppServer({
    router,
    webRoot: path.join(APP_ROOT, 'web'),
    logger
  });

  let closed = false;

  return {
    db,
    server,
    router,
    usecases,
    archive: archiveStore,
    executors,
    runner,
    migration,
    config,
    logger,
    async close() {
      if (closed) return;
      closed = true;
      runner?.stop();
      if (server.listening) {
        await new Promise(resolve => {
          server.close(resolve);
          server.closeAllConnections?.();
        });
      }
      db.close();
    }
  };
}
