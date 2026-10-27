/**
 * 任务状态机（纯领域）。
 *
 * 一个 Task 只表达"这次需求走到哪"；尝试、租约、审批、绑定各有自己的记录，
 * 不用布尔值或一个 status 字段混合表达。
 */
import {fail} from '../errors.mjs';

export const TASK_STATES = Object.freeze([
  'draft',
  'queued',
  'claimed',
  'preparing',
  'running',
  'uploading',
  'review',
  'approved',
  'rejected',
  'applied',
  'failed',
  'uncertain',
  'cancelled'
]);

/** 这些状态视为"仍在处理"，同一 assetKey 不重复建任务。 */
export const ACTIVE_STATES = Object.freeze([
  'queued',
  'claimed',
  'preparing',
  'running',
  'uploading',
  'review'
]);

const TRANSITIONS = Object.freeze({
  draft: ['queued', 'cancelled'],
  queued: ['claimed', 'cancelled'],
  claimed: ['preparing', 'running', 'queued', 'failed', 'uncertain', 'cancelled'],
  preparing: ['running', 'failed', 'uncertain'],
  running: ['uploading', 'failed', 'uncertain'],
  uploading: ['review', 'failed', 'uncertain'],
  review: ['approved', 'rejected', 'superseded'],
  approved: ['applied', 'superseded'],
  rejected: [],
  applied: ['superseded'],
  failed: ['queued'],
  uncertain: ['running', 'review', 'failed'],
  cancelled: []
});

export function assertTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!allowed) throw fail.invalid(`未知任务状态：${from}`);
  if (!allowed.includes(to)) {
    throw fail.stateConflict(`任务不能从 ${from} 变为 ${to}`);
  }
}

export function isActive(state) {
  return ACTIVE_STATES.includes(state);
}

const ROLES = new Set(['character', 'scene', 'prop', 'style']);
const MAX_PROMPT = 20000;

export function validateManifest(input) {
  if (!input || typeof input !== 'object') throw fail.invalid('缺少任务输入');
  const role = String(input.role ?? '').trim();
  if (!ROLES.has(role)) throw fail.invalid('资产类型必须是 character / scene / prop / style');
  const name = String(input.name ?? '').trim();
  if (!name) throw fail.invalid('资产名称不能为空');
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) throw fail.invalid('生成提示词不能为空');
  if (prompt.length > MAX_PROMPT) throw fail.invalid(`提示词不能超过 ${MAX_PROMPT} 个字符`);
  return {
    role,
    name,
    state: String(input.state ?? '').trim(),
    view: String(input.view ?? '').trim(),
    prompt,
    assetSpecId: String(input.assetSpecId ?? 'character_card_v1').trim(),
    executor: String(input.executor ?? 'fake').trim(),
    referenceRevisionIds: Array.isArray(input.referenceRevisionIds)
      ? input.referenceRevisionIds.slice(0, 3).map(value => String(value))
      : [],
    references: []
  };
}

export function createTask({
  id,
  batchId,
  projectId,
  episodeId = null,
  type = 'asset.generate',
  assetKey,
  clientRequestId = null,
  manifest,
  now
}) {
  if (!id) throw fail.invalid('缺少任务编号');
  if (!projectId) throw fail.invalid('缺少项目编号');
  if (!assetKey) throw fail.invalid('缺少资产编号');
  if (!now) throw fail.invalid('缺少创建时间');
  return {
    id,
    batchId,
    projectId,
    episodeId,
    type,
    assetKey,
    clientRequestId,
    inputManifest: manifest,
    state: 'queued',
    subscribers: 1,
    resultAssetId: null,
    resultRevisionId: null,
    reviewReason: null,
    createdAt: now,
    updatedAt: now
  };
}

export function taskSummary(task) {
  return {
    id: task.id,
    batchId: task.batchId,
    projectId: task.projectId,
    episodeId: task.episodeId,
    type: task.type,
    assetKey: task.assetKey,
    state: task.state,
    subscribers: task.subscribers,
    resultAssetId: task.resultAssetId,
    resultRevisionId: task.resultRevisionId,
    reviewReason: task.reviewReason,
    inputManifest: task.inputManifest,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}
