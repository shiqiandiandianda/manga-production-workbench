/**
 * 用例装配：依赖全部由外部注入，core 不认识数据库、HTTP、墨库。
 */
import {newId} from '../ids.mjs';
import {createAssetUsecases} from './assets.mjs';
import {createEpisodeUsecases, createEventUsecases} from './events.mjs';
import {createProjectUsecases} from './projects.mjs';
import {createTaskUsecases} from './tasks.mjs';
import {createWorkerUsecases} from './workers.mjs';

export function createUsecases({
  projects,
  assets,
  episodes,
  tasks,
  attempts,
  leases,
  batches,
  approvals,
  bindings,
  workers,
  events,
  archive,
  executors,
  tx,
  clock,
  ids = newId
}) {
  return {
    projects: createProjectUsecases({projects, events, clock, ids}),
    assets: createAssetUsecases({projects, assets, clock, ids}),
    episodes: createEpisodeUsecases({projects, episodes, clock, ids}),
    workers: createWorkerUsecases({workers, clock, ids}),
    tasks: createTaskUsecases({
      projects,
      episodes,
      assets,
      tasks,
      attempts,
      leases,
      batches,
      approvals,
      bindings,
      workers,
      events,
      archive,
      executors,
      clock,
      ids,
      tx
    }),
    events: createEventUsecases({events})
  };
}
