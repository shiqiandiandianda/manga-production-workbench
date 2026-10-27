/**
 * 任务用例：提交 → 领取 → 开始 → 完成 → 审核 → 绑定。
 *
 * 边界：
 * - 执行器不写库；它只跑，结果由本用例入库。
 * - 归档（字节）走 Archive 端口；数据库写入走事务。
 * - 同一 assetKey 的活跃任务合并订阅，不重复生成。
 */
import {fail} from '../errors.mjs';
import {newId} from '../ids.mjs';
import {
  assetKeyOf,
  createAssetIdentity,
  createAssetRevision
} from '../model/asset.mjs';
import {
  assertTransition,
  createTask,
  taskSummary,
  validateManifest
} from '../model/task.mjs';

export function createTaskUsecases({
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
  ids = newId,
  tx,
  leaseMs = 30_000
}) {
  function emit(type, aggregateId, payload) {
    events.append({type, aggregateId, payload, createdAt: clock()});
  }

  function requireProject(projectId) {
    const project = projects.get(projectId);
    if (!project) throw fail.notFound('项目不存在');
    return project;
  }

  function expand(task) {
    const summary = taskSummary(task);
    const revision = task.resultAssetId && task.resultRevisionId
      ? assets.findRevision(task.resultAssetId, task.resultRevisionId)
      : null;
    return {...summary, revision};
  }

  function batchView(batch) {
    const list = tasks.listByBatch(batch.id);
    return {
      batchId: batch.id,
      duplicate: true,
      itemCount: batch.itemCount,
      tasks: list.map(expand)
    };
  }

  return {
    /**
     * 批量提交缺失资产生成需求。
     * 返回 202 的语义：已收单，不代表已生成。
     */
    async submit({projectId, episodeId = null, requester = 'local', clientRequestId = null, items = []}) {
      requireProject(projectId);
      if (episodeId) {
        const episode = episodes.get(episodeId);
        if (!episode || episode.projectId !== projectId) throw fail.notFound('话数不存在');
      }
      if (!Array.isArray(items) || !items.length) throw fail.invalid('至少提交 1 项需求');
      if (items.length > 50) throw fail.invalid('单批最多 50 项');
      if (clientRequestId && String(clientRequestId).length > 200) {
        throw fail.invalid('clientRequestId 不能超过 200 个字符');
      }

      if (clientRequestId) {
        const existing = batches.findByClientRequest(projectId, clientRequestId);
        if (existing) return batchView(existing);
      }

      const blocked = [];
      const prepared = [];
      for (const item of items) {
        const needId = String(item?.needId ?? '').slice(0, 160) || null;
        try {
          const manifest = validateManifest(item);
          manifest.references = manifest.referenceRevisionIds.map((revisionId, index) => {
            const revision = assets.findRevisionByRevisionId(projectId, revisionId);
            if (!revision) throw fail.invalid(`参考版本不存在：${revisionId}`);
            const extension = revision.mime === 'image/jpeg'
              ? '.jpg'
              : revision.mime === 'image/webp' ? '.webp' : '.png';
            return {
              revisionId: revision.revisionId,
              assetId: revision.assetId,
              sha256: revision.sha256,
              mime: revision.mime,
              name: revision.assetName,
              filename: `reference-${index + 1}${extension}`
            };
          });
          prepared.push({needId, manifest, assetKey: assetKeyOf(manifest)});
        } catch (error) {
          blocked.push({needId, reason: error.message});
        }
      }

      // 提交前只探测一次每个执行器；不可用就整项阻塞，不入队。
      const readiness = new Map();
      for (const executorId of new Set(prepared.map(item => item.manifest.executor))) {
        const executor = executors.get(executorId);
        if (!executor) {
          readiness.set(executorId, {ready: false, reason: `执行器未注册：${executorId}`});
          continue;
        }
        try {
          const probe = await executor.probe();
          readiness.set(executorId, probe?.ready
            ? probe
            : {ready: false, reason: probe?.reason ?? '执行器未就绪'});
        } catch (error) {
          readiness.set(executorId, {ready: false, reason: error.message});
        }
      }

      const now = clock();
      const batch = {
        id: ids('batch'),
        projectId,
        episodeId,
        requester: String(requester ?? 'local').slice(0, 120),
        clientRequestId,
        itemCount: items.length,
        createdAt: now
      };

      const accepted = [];
      const reused = [];

      tx(() => {
        batches.insert(batch);

        for (const {needId, manifest, assetKey} of prepared) {
          const ready = readiness.get(manifest.executor);
          if (!ready?.ready) {
            blocked.push({
              needId,
              reason: ready?.reason ?? '执行器未就绪',
              nextAction: {type: 'open_executors'}
            });
            continue;
          }

          const identity = assets.findIdentity(projectId, assetKey);
          if (identity) {
            const approved = approvals.findActive(identity.id);
            if (approved) {
              reused.push({
                needId,
                assetKey,
                assetId: identity.id,
                revisionId: approved.revisionId
              });
              continue;
            }
          }

          const active = tasks.findActiveByAssetKey(projectId, assetKey);
          if (active) {
            tasks.addSubscriber(active.id, now);
            accepted.push({needId, taskId: active.id, assetKey, merged: true});
            continue;
          }

          const task = createTask({
            id: ids('task'),
            batchId: batch.id,
            projectId,
            episodeId,
            assetKey,
            clientRequestId: null,
            manifest,
            now
          });
          tasks.insert(task);
          emit('task.queued', task.id, {
            batchId: batch.id,
            assetKey,
            role: manifest.role,
            name: manifest.name
          });
          accepted.push({needId, taskId: task.id, assetKey, state: task.state, merged: false});
        }
      });

      return {
        batchId: batch.id,
        duplicate: false,
        itemCount: items.length,
        accepted: accepted.length,
        reused: reused.length,
        blocked: blocked.length,
        tasks: accepted,
        reusedItems: reused,
        blockedItems: blocked
      };
    },

    async get({taskId}) {
      const task = tasks.get(taskId);
      if (!task) throw fail.notFound('任务不存在');
      return expand(task);
    },

    async list({projectId}) {
      requireProject(projectId);
      return tasks.listByProject(projectId).map(expand);
    },

    /** 节点领取一个 queued 任务，事务内建 attempt 与 lease。 */
    async claim({workerId = 'worker_local'} = {}) {
      const worker = workers.get(workerId);
      if (!worker) throw fail.notFound('节点未注册');
      if (!worker.ready) throw fail.blocked('节点未就绪，不领取任务');
      return tx(() => {
        const task = tasks.nextQueued();
        if (!task) return null;
        const now = clock();
        if (!tasks.transition(task.id, 'queued', 'claimed', now)) return null;

        const attemptNo = attempts.nextNumber(task.id);
        const leaseId = ids('lease');
        const attempt = {
          id: ids('att'),
          taskId: task.id,
          attemptNo,
          workerId,
          leaseId,
          engineJobId: null,
          state: 'created',
          startedAt: null,
          finishedAt: null
        };
        const lease = {
          id: leaseId,
          attemptId: attempt.id,
          workerId,
          expiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
          heartbeatAt: now
        };
        attempts.insert(attempt);
        leases.insert(lease);
        emit('task.claimed', task.id, {workerId, attemptId: attempt.id});
        return {task: tasks.get(task.id), attempt, lease};
      });
    },

    /** 节点确认真正开始执行；必须先落本地日志再调用，避免失联后重复生成。 */
    async start({attemptId, leaseId}) {
      return tx(() => {
        const attempt = attempts.get(attemptId);
        if (!attempt) throw fail.notFound('尝试不存在');
        const lease = leases.get(leaseId);
        if (!lease || lease.attemptId !== attemptId) throw fail.notFound('租约不存在');
        if (Date.parse(lease.expiresAt) < Date.now()) throw fail.stateConflict('租约已过期，请重新领取');
        const task = tasks.get(attempt.taskId);
        if (!task) throw fail.notFound('任务不存在');
        if (task.state !== 'claimed' && task.state !== 'preparing') {
          throw fail.stateConflict(`任务当前状态不能开始：${task.state}`);
        }
        assertTransition(task.state, 'running');
        const now = clock();
        if (!tasks.transition(task.id, task.state, 'running', now)) {
          throw fail.stateConflict('任务状态已变化');
        }
        attempts.update({
          ...attempt,
          state: 'running',
          startedAt: attempt.startedAt ?? now
        });
        leases.heartbeat(leaseId, now, new Date(Date.parse(now) + leaseMs).toISOString());
        emit('task.started', task.id, {attemptId, workerId: attempt.workerId});
        return {task: tasks.get(task.id), attempt: attempts.get(attemptId)};
      });
    },

    /** 续租：长任务（真实工房 2–5 分钟）必须定期续，否则会被判定失联。 */
    async renew({attemptId, leaseId}) {
      const attempt = attempts.get(attemptId);
      if (!attempt) throw fail.notFound('尝试不存在');
      const lease = leases.get(leaseId);
      if (!lease || lease.attemptId !== attemptId) throw fail.notFound('租约不存在');
      const now = clock();
      const expiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
      leases.heartbeat(leaseId, now, expiresAt);
      return {leaseId, expiresAt};
    },

    /** 执行完成：先归档字节，再在一个事务里登记版本、推进状态。 */
    async complete({attemptId, leaseId, bytes, mime = 'image/png', engineJobId = null}) {
      if (!Buffer.isBuffer(bytes) || !bytes.length) throw fail.invalid('结果为空');
      const attempt = attempts.get(attemptId);
      if (!attempt) throw fail.notFound('尝试不存在');
      const lease = leases.get(leaseId);
      if (!lease || lease.attemptId !== attemptId) throw fail.notFound('租约不存在');
      const task = tasks.get(attempt.taskId);
      if (!task) throw fail.notFound('任务不存在');
      if (task.state !== 'running' && task.state !== 'uploading') {
        throw fail.stateConflict(`任务当前状态不能回传：${task.state}`);
      }

      const stored = await archive.put(bytes);

      return tx(() => {
        const manifest = task.inputManifest;
        let identity = assets.findIdentity(task.projectId, task.assetKey);
        if (!identity) {
          identity = createAssetIdentity({
            id: ids('asset'),
            projectId: task.projectId,
            role: manifest.role,
            name: manifest.name,
            state: manifest.state,
            view: manifest.view,
            now: clock()
          });
          assets.insertIdentity(identity);
        }

        const revisionId = `local:${stored.sha256}`;
        let revision = assets.findRevision(identity.id, revisionId);
        if (!revision) {
          revision = createAssetRevision({
            id: ids('rev'),
            assetId: identity.id,
            revisionId,
            sha256: stored.sha256,
            mime,
            size: stored.size,
            status: 'candidate',
            now: clock()
          });
          assets.insertRevision(revision);
        }

        if (task.state === 'running') {
          const now = clock();
          if (!tasks.transition(task.id, 'running', 'uploading', now)) {
            throw fail.stateConflict('任务状态已变化');
          }
          if (!tasks.transition(task.id, 'uploading', 'review', now)) {
            throw fail.stateConflict('任务状态已变化');
          }
        }
        tasks.setResult(task.id, identity.id, revision.revisionId, clock());

        attempts.update({
          ...attempt,
          state: 'finished',
          engineJobId,
          finishedAt: clock()
        });
        leases.remove(leaseId);
        emit('task.review', task.id, {
          assetId: identity.id,
          revisionId: revision.id,
          sha256: stored.sha256
        });
        return {task: tasks.get(task.id), revision, asset: identity};
      });
    },

    async fail({attemptId, leaseId, message = '生成失败', started = false}) {
      return tx(() => {
        const attempt = attempts.get(attemptId);
        if (!attempt) throw fail.notFound('尝试不存在');
        const task = tasks.get(attempt.taskId);
        if (!task) throw fail.notFound('任务不存在');
        const target = started ? 'uncertain' : 'failed';
        assertTransition(task.state, target);
        const now = clock();
        tasks.setReview(task.id, target, String(message).slice(0, 500), now);
        attempts.update({
          ...attempt,
          state: target === 'uncertain' ? 'lost' : 'failed',
          finishedAt: now
        });
        if (leaseId) leases.remove(leaseId);
        emit(target === 'uncertain' ? 'task.uncertain' : 'task.failed', task.id, {
          attemptId,
          message
        });
        return tasks.get(task.id);
      });
    },

    /** 人工审核：批准或退回。批准后该版本成为资产的唯一生效版本。 */
    async review({taskId, decision, reason = '', reviewer = 'local'}) {
      const task = tasks.get(taskId);
      if (!task) throw fail.notFound('任务不存在');
      if (task.state !== 'review') throw fail.stateConflict(`任务不在待审核状态：${task.state}`);
      if (!['approve', 'reject'].includes(decision)) throw fail.invalid('decision 必须是 approve 或 reject');
      if (!task.resultAssetId || !task.resultRevisionId) throw fail.stateConflict('任务还没有结果版本');

      const now = clock();
      return tx(() => {
        if (decision === 'approve') {
          approvals.supersede(task.resultAssetId, now);
          assets.supersedeApproved(task.resultAssetId, task.resultRevisionId);
          approvals.insert({
            id: ids('approval'),
            projectId: task.projectId,
            assetId: task.resultAssetId,
            revisionId: task.resultRevisionId,
            approvedBy: String(reviewer ?? 'local').slice(0, 120),
            status: 'approved',
            objectVersion: 1,
            createdAt: now,
            updatedAt: now
          });
          assets.updateRevisionStatus(task.resultAssetId, task.resultRevisionId, 'approved');
          tasks.setReview(task.id, 'approved', null, now);
          emit('task.approved', task.id, {
            assetId: task.resultAssetId,
            revisionId: task.resultRevisionId
          });
        } else {
          const text = String(reason ?? '').trim();
          if (!text) throw fail.invalid('退回必须填写原因');
          assets.updateRevisionStatus(task.resultAssetId, task.resultRevisionId, 'rejected');
          tasks.setReview(task.id, 'rejected', text.slice(0, 500), now);
          emit('task.rejected', task.id, {reason: text});
        }
        return expand(tasks.get(task.id));
      });
    },

    /** 采用：把已批准版本绑定到具体画格；锁定项需要显式 force。 */
    async adopt({
      projectId,
      panelId,
      assetKey,
      revisionId,
      mode = 'auto',
      locked = false,
      force = false
    }) {
      requireProject(projectId);
      if (!panelId) throw fail.invalid('缺少画格编号');
      const identity = assets.findIdentity(projectId, String(assetKey));
      if (!identity) throw fail.notFound('资产不存在');
      const revision = assets.findRevision(identity.id, String(revisionId));
      if (!revision) throw fail.notFound('资产版本不存在');
      if (revision.status !== 'approved') {
        throw fail.blocked('只有已批准的版本才能绑定', {type: 'review_candidate'});
      }

      const existing = bindings.find(projectId, panelId, assetKey);
      if (existing?.locked && !force) {
        throw fail.stateConflict('该画格引用已锁定，需要显式确认才能替换', {
          currentRevisionId: existing.revisionId
        });
      }

      const now = clock();
      return tx(() => {
        const binding = bindings.upsert({
          id: existing?.id ?? ids('binding'),
          projectId,
          panelId,
          assetKey,
          revisionId,
          mode,
          locked,
          objectVersion: 1,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        });
        const task = tasks.findByResultRevision(projectId, revisionId);
        if (task && task.state === 'approved') {
          tasks.setReview(task.id, 'applied', null, now);
        }
        emit('binding.adopted', binding.id, {panelId, assetKey, revisionId});
        return binding;
      });
    },

    async listBindings({projectId}) {
      requireProject(projectId);
      return bindings.listByProject(projectId);
    }
  };
}
