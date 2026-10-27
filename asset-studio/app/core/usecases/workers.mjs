/**
 * 执行节点用例：注册、心跳、列表。
 *
 * 节点身份由 (machineId, poolId) 唯一确定；同一机器同一执行池重连不会虚增名额。
 * 真实鉴权（令牌/证书）在阶段 4 加强；阶段 3 用可选共享令牌先兜住局域网。
 */
import {fail} from '../errors.mjs';
import {newId} from '../ids.mjs';

const MAX_CAPACITY = 6;

function cleanLabel(value, label, max = 120) {
  const text = String(value ?? '').trim();
  if (!text) throw fail.invalid(`${label}不能为空`);
  if (text.length > max) throw fail.invalid(`${label}不能超过 ${max} 个字符`);
  return text;
}

export function createWorkerUsecases({workers, clock, ids = newId}) {
  return {
    async register({machineId, poolId = 'local', capacity = 1, reserve = 0}) {
      const machine = cleanLabel(machineId, 'machineId');
      const pool = cleanLabel(poolId, 'poolId', 80);
      const max = Number(capacity);
      if (!Number.isInteger(max) || max < 1 || max > MAX_CAPACITY) {
        throw fail.invalid(`capacity 必须是 1–${MAX_CAPACITY} 的整数`);
      }
      const reserved = Number(reserve);
      if (!Number.isInteger(reserved) || reserved < 0 || reserved > max) {
        throw fail.invalid('reserve 必须是 0–capacity 的整数');
      }

      const existing = workers.findByMachine(machine, pool);
      const now = clock();
      return workers.upsert({
        id: existing?.id ?? ids('worker'),
        machineId: machine,
        poolId: pool,
        capacity: max,
        reserve: reserved,
        ready: true,
        lastHeartbeat: now,
        createdAt: existing?.createdAt ?? now
      });
    },

    async heartbeat({workerId, ready = true, capacity, reserve}) {
      const worker = workers.get(workerId);
      if (!worker) throw fail.notFound('节点未注册');
      const max = capacity === undefined ? worker.capacity : Number(capacity);
      const reserved = reserve === undefined ? worker.reserve : Number(reserve);
      if (!Number.isInteger(max) || max < 1 || max > MAX_CAPACITY) {
        throw fail.invalid(`capacity 必须是 1–${MAX_CAPACITY} 的整数`);
      }
      if (!Number.isInteger(reserved) || reserved < 0 || reserved > max) {
        throw fail.invalid('reserve 必须是 0–capacity 的整数');
      }
      return workers.upsert({
        ...worker,
        capacity: max,
        reserve: reserved,
        ready: ready !== false,
        lastHeartbeat: clock()
      });
    },

    async list() {
      return workers.list();
    }
  };
}
