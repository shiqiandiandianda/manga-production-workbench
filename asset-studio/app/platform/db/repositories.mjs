/**
 * 仓储实现：把端口契约落到 SQLite。
 *
 * 所有 SQL 集中在这里；core 不出现表名与 SQL。
 * 写操作统一处理唯一约束与乐观并发。
 */
import {fail} from '../../core/errors.mjs';

export function createRepositories(db) {
  return {
    projects: createProjectRepository(db),
    assets: createAssetRepository(db),
    episodes: createEpisodeRepository(db),
    documents: createDocumentRepository(db),
    legacy: createLegacyRepository(db),
    tasks: createTaskRepository(db),
    attempts: createAttemptRepository(db),
    leases: createLeaseRepository(db),
    batches: createBatchRepository(db),
    approvals: createApprovalRepository(db),
    bindings: createBindingRepository(db),
    workers: createWorkerRepository(db),
    events: createEventRepository(db)
  };
}

function uniqueError(error) {
  return /UNIQUE constraint failed/i.test(String(error?.message ?? ''));
}

/* ------------------------------- projects ------------------------------- */

function createProjectRepository(db) {
  const COLUMNS =
    'id, title, moku_project_id, external_key, format, object_version, created_at, updated_at';
  const toProject = row => row
    ? {
        id: row.id,
        title: row.title,
        mokuProjectId: row.moku_project_id,
        externalKey: row.external_key,
        format: row.format ?? 'webtoon',
        objectVersion: Number(row.object_version),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;

  const insertStmt = db.prepare(
    `INSERT INTO projects (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM projects WHERE id = ?`);
  const listStmt = db.prepare(`SELECT ${COLUMNS} FROM projects ORDER BY created_at, id`);
  const byMokuStmt = db.prepare(
    `SELECT ${COLUMNS} FROM projects WHERE moku_project_id = ?`
  );
  const byExternalStmt = db.prepare(
    `SELECT ${COLUMNS} FROM projects WHERE external_key = ?`
  );
  const updateStmt = db.prepare(
    `UPDATE projects
        SET title = ?, moku_project_id = ?, object_version = object_version + 1, updated_at = ?
      WHERE id = ? AND object_version = ?`
  );

  return {
    insert(project) {
      try {
        insertStmt.run(
          project.id,
          project.title,
          project.mokuProjectId,
          project.externalKey,
          project.format ?? 'webtoon',
          project.objectVersion,
          project.createdAt,
          project.updatedAt
        );
      } catch (error) {
        if (uniqueError(error)) throw fail.stateConflict('项目编号、externalKey 或墨库项目已存在');
        throw error;
      }
      return project;
    },
    get(id) {
      return toProject(getStmt.get(id));
    },
    list() {
      return listStmt.all().map(toProject);
    },
    findByMokuId(mokuProjectId) {
      return toProject(byMokuStmt.get(mokuProjectId));
    },
    findByExternalKey(externalKey) {
      return toProject(byExternalStmt.get(externalKey));
    },
    update(project, expectedVersion) {
      try {
        const result = updateStmt.run(
          project.title,
          project.mokuProjectId,
          project.updatedAt,
          project.id,
          expectedVersion
        );
        if (Number(result.changes) !== 1) return null;
      } catch (error) {
        if (uniqueError(error)) throw fail.stateConflict('该墨库项目已关联其他本地项目');
        throw error;
      }
      return toProject(getStmt.get(project.id));
    }
  };
}

/* -------------------------------- assets -------------------------------- */

function createAssetRepository(db) {
  const IDENTITY_COLUMNS =
    'id, project_id, asset_key, role, name, state, view, created_at, updated_at';
  const REVISION_COLUMNS =
    'id, asset_id, revision_id, sha256, mime, size, status, created_at';

  const toIdentity = row => row
    ? {
        id: row.id,
        projectId: row.project_id,
        assetKey: row.asset_key,
        role: row.role,
        name: row.name,
        state: row.state,
        view: row.view,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;

  const toRevision = row => row
    ? {
        id: row.id,
        assetId: row.asset_id,
        revisionId: row.revision_id,
        sha256: row.sha256,
        mime: row.mime,
        size: Number(row.size),
        status: row.status,
        createdAt: row.created_at
      }
    : null;

  const insertIdentityStmt = db.prepare(
    `INSERT INTO asset_identities (${IDENTITY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const getIdentityStmt = db.prepare(
    `SELECT ${IDENTITY_COLUMNS} FROM asset_identities WHERE id = ?`
  );
  const findIdentityStmt = db.prepare(
    `SELECT ${IDENTITY_COLUMNS} FROM asset_identities WHERE project_id = ? AND asset_key = ?`
  );
  const listIdentitiesStmt = db.prepare(
    `SELECT ${IDENTITY_COLUMNS} FROM asset_identities WHERE project_id = ? ORDER BY created_at, id`
  );
  const updateIdentityStmt = db.prepare(
    `UPDATE asset_identities SET name = ?, state = ?, view = ?, updated_at = ? WHERE id = ?`
  );

  const insertRevisionStmt = db.prepare(
    `INSERT INTO asset_revisions (${REVISION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const getRevisionStmt = db.prepare(
    `SELECT ${REVISION_COLUMNS} FROM asset_revisions WHERE asset_id = ? AND revision_id = ?`
  );
  const byRevisionStmt = db.prepare(`
    SELECT r.id, r.asset_id, r.revision_id, r.sha256, r.mime, r.size, r.status, r.created_at,
           a.name AS asset_name, a.asset_key
      FROM asset_revisions r
      JOIN asset_identities a ON a.id = r.asset_id
     WHERE a.project_id = ? AND r.revision_id = ?
     ORDER BY r.created_at DESC
     LIMIT 1
  `);
  const listRevisionsStmt = db.prepare(
    `SELECT ${REVISION_COLUMNS} FROM asset_revisions WHERE asset_id = ? ORDER BY created_at, id`
  );

  return {
    listIdentities(projectId) {
      return listIdentitiesStmt.all(projectId).map(toIdentity);
    },
    findIdentity(projectId, assetKey) {
      return toIdentity(findIdentityStmt.get(projectId, assetKey));
    },
    getIdentity(id) {
      return toIdentity(getIdentityStmt.get(id));
    },
    insertIdentity(identity) {
      try {
        insertIdentityStmt.run(
          identity.id,
          identity.projectId,
          identity.assetKey,
          identity.role,
          identity.name,
          identity.state,
          identity.view,
          identity.createdAt,
          identity.updatedAt
        );
      } catch (error) {
        if (uniqueError(error)) throw fail.conflict('该资产身份已存在');
        throw error;
      }
      return identity;
    },
    updateIdentity(identity) {
      updateIdentityStmt.run(
        identity.name,
        identity.state,
        identity.view,
        identity.updatedAt,
        identity.id
      );
      return toIdentity(getIdentityStmt.get(identity.id));
    },
    findRevision(assetId, revisionId) {
      return toRevision(getRevisionStmt.get(assetId, revisionId));
    },
    findRevisionByRevisionId(projectId, revisionId) {
      const row = byRevisionStmt.get(projectId, revisionId);
      return row
        ? {...toRevision(row), assetName: row.asset_name, assetKey: row.asset_key}
        : null;
    },
    insertRevision(revision) {
      try {
        insertRevisionStmt.run(
          revision.id,
          revision.assetId,
          revision.revisionId,
          revision.sha256,
          revision.mime,
          revision.size,
          revision.status,
          revision.createdAt
        );
      } catch (error) {
        if (uniqueError(error)) throw fail.conflict('该资产版本已存在');
        throw error;
      }
      return revision;
    },
    listRevisions(assetId) {
      return listRevisionsStmt.all(assetId).map(toRevision);
    },
    updateRevisionStatus(assetId, revisionId, status) {
      const result = db.prepare(
        'UPDATE asset_revisions SET status = ? WHERE asset_id = ? AND revision_id = ?'
      ).run(status, assetId, revisionId);
      return Number(result.changes) === 1;
    },
    supersedeApproved(assetId, keepRevisionId) {
      db.prepare(`
        UPDATE asset_revisions
           SET status = 'superseded'
         WHERE asset_id = ? AND status = 'approved' AND revision_id <> ?
      `).run(assetId, keepRevisionId);
    }
  };
}

/* -------------------------------- episodes ------------------------------- */

function createEpisodeRepository(db) {
  const COLUMNS =
    'id, project_id, number, owner_user_id, stage, object_version, created_at, updated_at';
  const toEpisode = row => row
    ? {
        id: row.id,
        projectId: row.project_id,
        number: Number(row.number),
        ownerUserId: row.owner_user_id,
        stage: row.stage,
        objectVersion: Number(row.object_version),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;

  const listStmt = db.prepare(
    `SELECT ${COLUMNS} FROM episodes WHERE project_id = ? ORDER BY number`
  );
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM episodes WHERE id = ?`);
  const byNumberStmt = db.prepare(
    `SELECT ${COLUMNS} FROM episodes WHERE project_id = ? AND number = ?`
  );
  const insertStmt = db.prepare(
    `INSERT INTO episodes (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  return {
    listByProject(projectId) {
      return listStmt.all(projectId).map(toEpisode);
    },
    get(id) {
      return toEpisode(getStmt.get(id));
    },
    findByNumber(projectId, number) {
      return toEpisode(byNumberStmt.get(projectId, number));
    },
    insert(episode) {
      try {
        insertStmt.run(
          episode.id,
          episode.projectId,
          episode.number,
          episode.ownerUserId ?? null,
          episode.stage,
          episode.objectVersion ?? 1,
          episode.createdAt,
          episode.updatedAt
        );
      } catch (error) {
        if (uniqueError(error)) throw fail.stateConflict('该话数已存在');
        throw error;
      }
      return episode;
    }
  };
}

/* ------------------------------- documents ------------------------------- */

function createDocumentRepository(db) {
  const COLUMNS =
    'id, project_id, kind, revision_id, sha256, object_version, created_at, updated_at';
  const toDocument = row => row
    ? {
        id: row.id,
        projectId: row.project_id,
        kind: row.kind,
        revisionId: row.revision_id,
        sha256: row.sha256,
        objectVersion: Number(row.object_version),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;

  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM documents WHERE id = ?`);
  const byKindStmt = db.prepare(
    `SELECT ${COLUMNS} FROM documents WHERE project_id = ? AND kind = ? ORDER BY created_at LIMIT 1`
  );
  const listStmt = db.prepare(
    `SELECT ${COLUMNS} FROM documents WHERE project_id = ? ORDER BY created_at, id`
  );
  const insertStmt = db.prepare(
    `INSERT INTO documents (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  return {
    get(id) {
      return toDocument(getStmt.get(id));
    },
    findByKind(projectId, kind) {
      return toDocument(byKindStmt.get(projectId, kind));
    },
    listByProject(projectId) {
      return listStmt.all(projectId).map(toDocument);
    },
    insert(document) {
      insertStmt.run(
        document.id,
        document.projectId,
        document.kind,
        document.revisionId ?? null,
        document.sha256 ?? null,
        document.objectVersion ?? 1,
        document.createdAt,
        document.updatedAt
      );
      return document;
    }
  };
}

/* ------------------------------- legacy ids ------------------------------ */

function createLegacyRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO legacy_ids (entity, source, old_id, new_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(entity, source, old_id) DO UPDATE SET new_id = excluded.new_id
  `);
  const getStmt = db.prepare(
    'SELECT entity, source, old_id, new_id FROM legacy_ids WHERE entity = ? AND source = ? AND old_id = ?'
  );
  const toLegacy = row => row
    ? {entity: row.entity, source: row.source, oldId: row.old_id, newId: row.new_id}
    : null;

  return {
    record({entity, source, oldId, newId}) {
      insertStmt.run(entity, source, oldId, newId);
      return {entity, source, oldId, newId};
    },
    get(entity, source, oldId) {
      return toLegacy(getStmt.get(entity, source, oldId));
    }
  };
}

/* --------------------------------- tasks --------------------------------- */

function createTaskRepository(db) {
  const COLUMNS = [
    'id', 'batch_id', 'project_id', 'episode_id', 'type', 'state', 'asset_key',
    'input_manifest', 'client_request_id', 'result_asset_id', 'result_revision_id',
    'review_reason', 'subscribers', 'created_at', 'updated_at'
  ].join(', ');

  const toTask = row => row
    ? {
        id: row.id,
        batchId: row.batch_id,
        projectId: row.project_id,
        episodeId: row.episode_id,
        type: row.type,
        state: row.state,
        assetKey: row.asset_key,
        inputManifest: safeParse(row.input_manifest),
        clientRequestId: row.client_request_id,
        resultAssetId: row.result_asset_id,
        resultRevisionId: row.result_revision_id,
        reviewReason: row.review_reason,
        subscribers: Number(row.subscribers),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;

  const insertStmt = db.prepare(
    `INSERT INTO tasks (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`);
  const listStmt = db.prepare(
    `SELECT ${COLUMNS} FROM tasks WHERE project_id = ? ORDER BY created_at DESC, id DESC`
  );
  const byBatchStmt = db.prepare(
    `SELECT ${COLUMNS} FROM tasks WHERE batch_id = ? ORDER BY created_at, id`
  );
  const activeStmt = db.prepare(`
    SELECT ${COLUMNS} FROM tasks
     WHERE project_id = ? AND asset_key = ?
       AND state IN ('queued','claimed','preparing','running','uploading','review')
     ORDER BY created_at
     LIMIT 1
  `);
  const nextQueuedStmt = db.prepare(`
    SELECT ${COLUMNS} FROM tasks
     WHERE state = 'queued'
     ORDER BY created_at, id
     LIMIT 1
  `);
  const transitionStmt = db.prepare(
    'UPDATE tasks SET state = ?, updated_at = ? WHERE id = ? AND state = ?'
  );
  const setResultStmt = db.prepare(
    'UPDATE tasks SET result_asset_id = ?, result_revision_id = ?, updated_at = ? WHERE id = ?'
  );
  const setReviewStmt = db.prepare(
    'UPDATE tasks SET state = ?, review_reason = ?, updated_at = ? WHERE id = ?'
  );
  const addSubscriberStmt = db.prepare(
    'UPDATE tasks SET subscribers = subscribers + 1, updated_at = ? WHERE id = ?'
  );
  const byResultStmt = db.prepare(
    'SELECT ' + COLUMNS + ' FROM tasks WHERE project_id = ? AND result_revision_id = ? ORDER BY created_at LIMIT 1'
  );

  return {
    insert(task) {
      insertStmt.run(
        task.id,
        task.batchId,
        task.projectId,
        task.episodeId,
        task.type,
        task.state,
        task.assetKey,
        JSON.stringify(task.inputManifest),
        task.clientRequestId,
        task.resultAssetId,
        task.resultRevisionId,
        task.reviewReason,
        task.subscribers,
        task.createdAt,
        task.updatedAt
      );
      return task;
    },
    get(id) {
      return toTask(getStmt.get(id));
    },
    listByProject(projectId) {
      return listStmt.all(projectId).map(toTask);
    },
    listByBatch(batchId) {
      return byBatchStmt.all(batchId).map(toTask);
    },
    findActiveByAssetKey(projectId, assetKey) {
      return toTask(activeStmt.get(projectId, assetKey));
    },
    nextQueued() {
      return toTask(nextQueuedStmt.get());
    },
    transition(id, from, to, now) {
      return Number(transitionStmt.run(to, now, id, from).changes) === 1;
    },
    setResult(id, assetId, revisionId, now) {
      return Number(setResultStmt.run(assetId, revisionId, now, id).changes) === 1;
    },
    setReview(id, state, reason, now) {
      return Number(setReviewStmt.run(state, reason, now, id).changes) === 1;
    },
    addSubscriber(id, now) {
      addSubscriberStmt.run(now, id);
    },
    findByResultRevision(projectId, revisionId) {
      return toTask(byResultStmt.get(projectId, revisionId));
    }
  };
}

function createAttemptRepository(db) {
  const COLUMNS =
    'id, task_id, attempt_no, worker_id, lease_id, engine_job_id, state, started_at, finished_at';
  const toAttempt = row => row
    ? {
        id: row.id,
        taskId: row.task_id,
        attemptNo: Number(row.attempt_no),
        workerId: row.worker_id,
        leaseId: row.lease_id,
        engineJobId: row.engine_job_id,
        state: row.state,
        startedAt: row.started_at,
        finishedAt: row.finished_at
      }
    : null;
  const insertStmt = db.prepare(
    `INSERT INTO task_attempts (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM task_attempts WHERE id = ?`);
  const nextNoStmt = db.prepare(
    'SELECT COALESCE(MAX(attempt_no), 0) + 1 AS n FROM task_attempts WHERE task_id = ?'
  );
  const updateStmt = db.prepare(
    `UPDATE task_attempts
        SET worker_id = ?, lease_id = ?, engine_job_id = ?, state = ?, started_at = ?, finished_at = ?
      WHERE id = ?`
  );

  return {
    insert(attempt) {
      insertStmt.run(
        attempt.id,
        attempt.taskId,
        attempt.attemptNo,
        attempt.workerId,
        attempt.leaseId,
        attempt.engineJobId,
        attempt.state,
        attempt.startedAt,
        attempt.finishedAt
      );
      return attempt;
    },
    get(id) {
      return toAttempt(getStmt.get(id));
    },
    nextNumber(taskId) {
      return Number(nextNoStmt.get(taskId).n);
    },
    update(attempt) {
      updateStmt.run(
        attempt.workerId,
        attempt.leaseId,
        attempt.engineJobId,
        attempt.state,
        attempt.startedAt,
        attempt.finishedAt,
        attempt.id
      );
      return toAttempt(getStmt.get(attempt.id));
    }
  };
}

function createLeaseRepository(db) {
  const COLUMNS = 'id, attempt_id, worker_id, expires_at, heartbeat_at';
  const toLease = row => row
    ? {
        id: row.id,
        attemptId: row.attempt_id,
        workerId: row.worker_id,
        expiresAt: row.expires_at,
        heartbeatAt: row.heartbeat_at
      }
    : null;
  const insertStmt = db.prepare(`INSERT INTO leases (${COLUMNS}) VALUES (?, ?, ?, ?, ?)`);
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM leases WHERE id = ?`);
  const byAttemptStmt = db.prepare(
    `SELECT ${COLUMNS} FROM leases WHERE attempt_id = ? ORDER BY heartbeat_at DESC LIMIT 1`
  );
  const deleteStmt = db.prepare('DELETE FROM leases WHERE id = ?');
  const heartbeatStmt = db.prepare(
    'UPDATE leases SET heartbeat_at = ?, expires_at = ? WHERE id = ?'
  );

  return {
    insert(lease) {
      insertStmt.run(lease.id, lease.attemptId, lease.workerId, lease.expiresAt, lease.heartbeatAt);
      return lease;
    },
    get(id) {
      return toLease(getStmt.get(id));
    },
    getByAttempt(attemptId) {
      return toLease(byAttemptStmt.get(attemptId));
    },
    remove(id) {
      deleteStmt.run(id);
    },
    heartbeat(id, heartbeatAt, expiresAt) {
      heartbeatStmt.run(heartbeatAt, expiresAt, id);
    }
  };
}

/* --------------------------------- batches -------------------------------- */

function createBatchRepository(db) {
  const COLUMNS =
    'id, project_id, episode_id, requester, client_request_id, item_count, created_at';
  const toBatch = row => row
    ? {
        id: row.id,
        projectId: row.project_id,
        episodeId: row.episode_id,
        requester: row.requester,
        clientRequestId: row.client_request_id,
        itemCount: Number(row.item_count),
        createdAt: row.created_at
      }
    : null;
  const insertStmt = db.prepare(`INSERT INTO batches (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM batches WHERE id = ?`);
  const byClientStmt = db.prepare(
    `SELECT ${COLUMNS} FROM batches WHERE project_id = ? AND client_request_id = ?`
  );

  return {
    insert(batch) {
      insertStmt.run(
        batch.id,
        batch.projectId,
        batch.episodeId,
        batch.requester,
        batch.clientRequestId,
        batch.itemCount,
        batch.createdAt
      );
      return batch;
    },
    get(id) {
      return toBatch(getStmt.get(id));
    },
    findByClientRequest(projectId, clientRequestId) {
      return toBatch(byClientStmt.get(projectId, clientRequestId));
    }
  };
}

/* -------------------------------- approvals ------------------------------- */

function createApprovalRepository(db) {
  const COLUMNS =
    'id, project_id, asset_id, revision_id, approved_by, status, object_version, created_at, updated_at';
  const toApproval = row => row
    ? {
        id: row.id,
        projectId: row.project_id,
        assetId: row.asset_id,
        revisionId: row.revision_id,
        approvedBy: row.approved_by,
        status: row.status,
        objectVersion: Number(row.object_version),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;
  const insertStmt = db.prepare(`INSERT INTO approvals (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM approvals WHERE id = ?`);
  const activeStmt = db.prepare(
    `SELECT ${COLUMNS} FROM approvals WHERE asset_id = ? AND status = 'approved' LIMIT 1`
  );
  const supersedeStmt = db.prepare(
    `UPDATE approvals SET status = 'superseded', updated_at = ? WHERE asset_id = ? AND status = 'approved'`
  );
  const listStmt = db.prepare(
    `SELECT ${COLUMNS} FROM approvals WHERE asset_id = ? ORDER BY created_at`
  );

  return {
    insert(approval) {
      insertStmt.run(
        approval.id,
        approval.projectId,
        approval.assetId,
        approval.revisionId,
        approval.approvedBy,
        approval.status,
        approval.objectVersion,
        approval.createdAt,
        approval.updatedAt
      );
      return approval;
    },
    get(id) {
      return toApproval(getStmt.get(id));
    },
    findActive(assetId) {
      return toApproval(activeStmt.get(assetId));
    },
    supersede(assetId, now) {
      supersedeStmt.run(now, assetId);
    },
    listByAsset(assetId) {
      return listStmt.all(assetId).map(toApproval);
    }
  };
}

/* -------------------------------- bindings -------------------------------- */

function createBindingRepository(db) {
  const COLUMNS =
    'id, project_id, panel_id, asset_key, revision_id, mode, locked, object_version, created_at, updated_at';
  const toBinding = row => row
    ? {
        id: row.id,
        projectId: row.project_id,
        panelId: row.panel_id,
        assetKey: row.asset_key,
        revisionId: row.revision_id,
        mode: row.mode,
        locked: Boolean(row.locked),
        objectVersion: Number(row.object_version),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;
  const findStmt = db.prepare(
    `SELECT ${COLUMNS} FROM bindings WHERE project_id = ? AND panel_id = ? AND asset_key = ?`
  );
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM bindings WHERE id = ?`);
  const listStmt = db.prepare(
    `SELECT ${COLUMNS} FROM bindings WHERE project_id = ? ORDER BY panel_id, asset_key`
  );
  const upsertStmt = db.prepare(`
    INSERT INTO bindings (${COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, panel_id, asset_key) DO UPDATE SET
      revision_id = excluded.revision_id,
      mode = excluded.mode,
      locked = excluded.locked,
      object_version = bindings.object_version + 1,
      updated_at = excluded.updated_at
  `);

  return {
    find(projectId, panelId, assetKey) {
      return toBinding(findStmt.get(projectId, panelId, assetKey));
    },
    get(id) {
      return toBinding(getStmt.get(id));
    },
    listByProject(projectId) {
      return listStmt.all(projectId).map(toBinding);
    },
    upsert(binding) {
      upsertStmt.run(
        binding.id,
        binding.projectId,
        binding.panelId,
        binding.assetKey,
        binding.revisionId,
        binding.mode,
        binding.locked ? 1 : 0,
        binding.objectVersion,
        binding.createdAt,
        binding.updatedAt
      );
      return toBinding(findStmt.get(binding.projectId, binding.panelId, binding.assetKey));
    }
  };
}

/* --------------------------------- workers -------------------------------- */

function createWorkerRepository(db) {
  const COLUMNS =
    'id, machine_id, pool_id, capacity, reserve, ready, last_heartbeat, created_at';
  const toWorker = row => row
    ? {
        id: row.id,
        machineId: row.machine_id,
        poolId: row.pool_id,
        capacity: Number(row.capacity),
        reserve: Number(row.reserve),
        ready: Boolean(row.ready),
        lastHeartbeat: row.last_heartbeat,
        createdAt: row.created_at
      }
    : null;
  const upsertStmt = db.prepare(`
    INSERT INTO workers (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(machine_id, pool_id) DO UPDATE SET
      capacity = excluded.capacity,
      reserve = excluded.reserve,
      ready = excluded.ready,
      last_heartbeat = excluded.last_heartbeat
  `);
  const findStmt = db.prepare(
    `SELECT ${COLUMNS} FROM workers WHERE machine_id = ? AND pool_id = ?`
  );
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM workers WHERE id = ?`);
  const listStmt = db.prepare(`SELECT ${COLUMNS} FROM workers ORDER BY created_at`);

  return {
    upsert(worker) {
      upsertStmt.run(
        worker.id,
        worker.machineId,
        worker.poolId,
        worker.capacity,
        worker.reserve,
        worker.ready ? 1 : 0,
        worker.lastHeartbeat,
        worker.createdAt
      );
      return toWorker(findStmt.get(worker.machineId, worker.poolId));
    },
    findByMachine(machineId, poolId) {
      return toWorker(findStmt.get(machineId, poolId));
    },
    get(id) {
      return toWorker(getStmt.get(id));
    },
    list() {
      return listStmt.all().map(toWorker);
    }
  };
}

/* --------------------------------- events -------------------------------- */

function createEventRepository(db) {
  const insertStmt = db.prepare(
    'INSERT INTO events (type, aggregate_id, payload, created_at) VALUES (?, ?, ?, ?)'
  );
  const listStmt = db.prepare(`
    SELECT seq, type, aggregate_id, payload, created_at
      FROM events
     WHERE seq > ?
     ORDER BY seq
     LIMIT ?
  `);

  return {
    append({type, aggregateId = null, payload = {}, createdAt}) {
      const result = insertStmt.run(type, aggregateId, JSON.stringify(payload), createdAt);
      return Number(result.lastInsertRowid);
    },
    listAfter(after, limit) {
      return listStmt.all(after, limit).map(row => ({
        seq: Number(row.seq),
        type: row.type,
        aggregateId: row.aggregate_id,
        payload: safeParse(row.payload),
        createdAt: row.created_at
      }));
    }
  };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
