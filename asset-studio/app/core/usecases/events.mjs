/**
 * 事件与话数用例。
 *
 * 事件是界面增量刷新的唯一来源：客户端保存 seq 游标，断线后用 after 续拉。
 */
import {fail} from '../errors.mjs';
import {newId} from '../ids.mjs';

export function createEpisodeUsecases({projects, episodes, clock, ids = newId}) {
  return {
    async list({projectId}) {
      if (!projects.get(projectId)) throw fail.notFound('项目不存在');
      return episodes.listByProject(projectId);
    },

    async get({episodeId}) {
      const episode = episodes.get(episodeId);
      if (!episode) throw fail.notFound('话数不存在');
      return episode;
    },

    async create({projectId, number, ownerUserId = null}) {
      if (!projects.get(projectId)) throw fail.notFound('项目不存在');
      const value = Number(number);
      if (!Number.isInteger(value) || value <= 0) throw fail.invalid('话数必须是正整数');
      const existing = episodes.findByNumber(projectId, value);
      if (existing) return existing;
      const now = clock();
      return episodes.insert({
        id: ids('ep'),
        projectId,
        number: value,
        ownerUserId: ownerUserId ? String(ownerUserId).slice(0, 120) : null,
        stage: 'script',
        objectVersion: 1,
        createdAt: now,
        updatedAt: now
      });
    }
  };
}

export function createEventUsecases({events}) {
  return {
    async after({after = 0, limit = 200} = {}) {
      const cursor = Number.isFinite(Number(after)) ? Math.max(0, Math.floor(Number(after))) : 0;
      const size = Math.min(500, Math.max(1, Math.floor(Number(limit) || 200)));
      const rows = events.listAfter(cursor, size);
      const next = rows.length ? rows[rows.length - 1].seq : cursor;
      return {events: rows, cursor: next};
    }
  };
}
