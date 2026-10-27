/**
 * 数据库迁移：只向前，不回头。
 *
 * 每次迁移在事务内执行，并写入 schema_migrations。
 * 阶段 1 先固定表形状；阶段 3 再补执行器、账号池等字段。
 */

export const MIGRATIONS = Object.freeze([
  {
    version: 1,
    name: 'phase1-core-schema',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        moku_project_id TEXT UNIQUE,
        object_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE episodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        owner_user_id TEXT,
        stage TEXT NOT NULL DEFAULT 'script',
        object_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, number)
      );

      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        revision_id TEXT,
        sha256 TEXT,
        object_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX documents_project_kind ON documents(project_id, kind);

      CREATE TABLE asset_identities (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        asset_key TEXT NOT NULL,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT '',
        view TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, asset_key)
      );

      CREATE TABLE asset_revisions (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES asset_identities(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate'
          CHECK (status IN ('candidate','approved','rejected','superseded')),
        created_at TEXT NOT NULL,
        UNIQUE(asset_id, revision_id)
      );
      CREATE INDEX asset_revisions_asset ON asset_revisions(asset_id, created_at);

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        batch_id TEXT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT,
        type TEXT NOT NULL,
        state TEXT NOT NULL,
        input_manifest TEXT NOT NULL,
        client_request_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, client_request_id)
      );
      CREATE INDEX tasks_state ON tasks(state, created_at);

      CREATE TABLE task_attempts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL,
        worker_id TEXT,
        lease_id TEXT,
        engine_job_id TEXT,
        state TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        UNIQUE(task_id, attempt_no)
      );

      CREATE TABLE leases (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL REFERENCES task_attempts(id) ON DELETE CASCADE,
        worker_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL
      );

      CREATE TABLE events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        aggregate_id TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE legacy_ids (
        entity TEXT NOT NULL,
        source TEXT NOT NULL,
        old_id TEXT NOT NULL,
        new_id TEXT NOT NULL,
        PRIMARY KEY (entity, source, old_id)
      );
    `
  },
  {
    version: 2,
    name: 'project-external-key',
    sql: `
      ALTER TABLE projects ADD COLUMN external_key TEXT;
      CREATE UNIQUE INDEX projects_external_key
        ON projects(external_key)
        WHERE external_key IS NOT NULL;
    `
  },
  {
    version: 3,
    name: 'phase3-task-review-binding',
    sql: `
      ALTER TABLE tasks ADD COLUMN asset_key TEXT;
      ALTER TABLE tasks ADD COLUMN result_asset_id TEXT;
      ALTER TABLE tasks ADD COLUMN result_revision_id TEXT;
      ALTER TABLE tasks ADD COLUMN review_reason TEXT;
      ALTER TABLE tasks ADD COLUMN subscribers INTEGER NOT NULL DEFAULT 1;

      CREATE INDEX tasks_asset_key ON tasks(project_id, asset_key, state);
      CREATE INDEX tasks_project_state ON tasks(project_id, state, created_at);

      CREATE TABLE batches (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT,
        requester TEXT,
        client_request_id TEXT,
        item_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, client_request_id)
      );

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES asset_identities(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL,
        approved_by TEXT,
        status TEXT NOT NULL DEFAULT 'approved'
          CHECK (status IN ('approved','rejected','superseded')),
        object_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX approvals_asset ON approvals(asset_id, status);
      CREATE UNIQUE INDEX approvals_one_active
        ON approvals(asset_id)
        WHERE status = 'approved';

      CREATE TABLE bindings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        panel_id TEXT NOT NULL,
        asset_key TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'auto',
        locked INTEGER NOT NULL DEFAULT 0,
        object_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, panel_id, asset_key)
      );
      CREATE INDEX bindings_project ON bindings(project_id, panel_id);

      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        pool_id TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 1,
        reserve INTEGER NOT NULL DEFAULT 0,
        ready INTEGER NOT NULL DEFAULT 1,
        last_heartbeat TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(machine_id, pool_id)
      );

      CREATE TABLE account_pools (
        pool_hash TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 6,
        reserve INTEGER NOT NULL DEFAULT 2,
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 4,
    name: 'project-format-webtoon',
    sql: `
      ALTER TABLE projects ADD COLUMN format TEXT NOT NULL DEFAULT 'webtoon';
    `
  }
]);

export function currentVersion(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get();
  return Number(row?.version ?? 0);
}

export function migrate(db, {logger = null} = {}) {
  const applied = currentVersion(db);
  const pending = MIGRATIONS.filter(migration => migration.version > applied);
  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT');
      logger?.info?.(`已应用迁移 ${migration.version} · ${migration.name}`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`迁移 ${migration.version} 失败：${error.message}`, {cause: error});
    }
  }
  return {from: applied, to: currentVersion(db), applied: pending.length};
}
