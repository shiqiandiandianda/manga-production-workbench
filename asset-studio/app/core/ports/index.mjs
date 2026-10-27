/**
 * 端口定义（Ports）。
 *
 * 这里只有类型契约，没有实现。core 通过端口访问外部世界；
 * platform / adapters 提供实现；roles 负责装配。
 *
 * 所有方法都允许返回 Promise，实现可以是同步或异步。
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} title
 * @property {string|null} mokuProjectId
 * @property {number} objectVersion
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} ProjectRepository
 * @property {(project: Project) => void} insert
 * @property {(id: string) => Project|null} get
 * @property {() => Project[]} list
 * @property {(mokuProjectId: string) => Project|null} findByMokuId
 * @property {(project: Project, expectedVersion: number) => Project|null} update
 *   乐观并发：仅当 objectVersion 匹配时更新，并把版本 +1；返回更新后的对象，冲突返回 null。
 */

/**
 * @typedef {Object} AssetIdentity
 * @property {string} id
 * @property {string} projectId
 * @property {string} assetKey
 * @property {'character'|'scene'|'prop'|'style'} role
 * @property {string} name
 * @property {string} state
 * @property {string} view
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} AssetRevision
 * @property {string} id
 * @property {string} assetId
 * @property {string} revisionId
 * @property {string} sha256
 * @property {string} mime
 * @property {number} size
 * @property {'candidate'|'approved'|'rejected'|'superseded'} status
 * @property {string} createdAt
 */

/**
 * @typedef {Object} AssetRepository
 * @property {(projectId: string) => AssetIdentity[]} listIdentities
 * @property {(projectId: string, assetKey: string) => AssetIdentity|null} findIdentity
 * @property {(identity: AssetIdentity) => AssetIdentity} insertIdentity
 * @property {(identity: AssetIdentity) => AssetIdentity} updateIdentity
 * @property {(revision: AssetRevision) => AssetRevision} insertRevision
 * @property {(assetId: string) => AssetRevision[]} listRevisions
 */

/**
 * @typedef {Object} EpisodeRepository
 * @property {(projectId: string) => Object[]} listByProject
 */

/**
 * @typedef {Object} EventRepository
 * @property {(event: {type: string, aggregateId: string|null, payload: Object, createdAt: string}) => number} append
 * @property {(after: number, limit: number) => Object[]} listAfter
 */

/**
 * @typedef {Object} EventSink
 * @property {(type: string, aggregateId: string|null, payload: Object) => void} emit
 */

/**
 * @typedef {Object} Archive
 * 文件权威适配器。正式实现是墨库；开发与离线用本地实现。
 * @property {() => Promise<{ok: boolean, detail?: string}>} health
 * @property {(revisionId: string) => Promise<{bytes: Buffer, sha256: string}>} download
 * @property {(bytes: Buffer, meta: Object) => Promise<{revisionId: string, sha256: string, size: number}>} upload
 */

/**
 * @typedef {Object} Executor
 * 生成能力适配器。执行器不写数据库，只通过 ctx 回调。
 * @property {string} id
 * @property {string[]} capabilities
 * @property {() => Promise<{ready: boolean, reason?: string}>} probe
 * @property {(input: Object, ctx: Object) => Promise<{revisions: Object[], engineJobId?: string}>} run
 */

export const PORT_VERSION = 1;
