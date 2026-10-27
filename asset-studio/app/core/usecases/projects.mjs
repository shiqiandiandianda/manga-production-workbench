/**
 * 项目用例。
 *
 * 一个用例 = 一次业务动作的完整事务边界。路由层只负责解包 HTTP，不写业务规则。
 */
import {fail} from '../errors.mjs';
import {newId} from '../ids.mjs';
import {
  cleanExternalKey,
  cleanMokuProjectId,
  cleanTitle,
  createProject,
  linkToMoku,
  projectSummary,
  renameProject
} from '../model/project.mjs';

export function createProjectUsecases({projects, events, clock, ids = newId}) {
  function emit(type, aggregateId, payload) {
    events.append({type, aggregateId, payload, createdAt: clock()});
  }

  return {
    async list() {
      return projects.list().map(projectSummary);
    },

    async get({projectId}) {
      const project = projects.get(projectId);
      if (!project) throw fail.notFound('项目不存在');
      return projectSummary(project);
    },

    /**
     * 创建或查找项目。
     * 带 externalKey 时按来源工具的稳定编号幂等返回，对应 07/PROJECT-API.md 的 create/find 语义。
     */
    async create({title, mokuProjectId = null, externalKey = null, format = 'webtoon'}) {
      const key = cleanExternalKey(externalKey);
      if (key) {
        const existing = projects.findByExternalKey(key);
        if (existing) return {project: projectSummary(existing), created: false};
      }

      const now = clock();
      const project = createProject({
        id: ids('proj'),
        title: cleanTitle(title),
        mokuProjectId,
        externalKey: key,
        format,
        now
      });
      if (project.mokuProjectId) {
        const existing = projects.findByMokuId(project.mokuProjectId);
        if (existing) {
          throw fail.stateConflict('该墨库项目已关联其他本地项目', {projectId: existing.id});
        }
      }
      projects.insert(project);
      emit('project.created', project.id, {
        title: project.title,
        mokuProjectId: project.mokuProjectId,
        externalKey: project.externalKey
      });
      return {project: projectSummary(project), created: true};
    },

    async rename({projectId, title, expectedVersion}) {
      const current = projects.get(projectId);
      if (!current) throw fail.notFound('项目不存在');
      assertVersion(current, expectedVersion);
      const next = renameProject(current, title, {now: clock()});
      if (next === current) return projectSummary(current);
      const saved = projects.update(next, current.objectVersion);
      if (!saved) throw versionConflict();
      emit('project.renamed', projectId, {title: saved.title});
      return projectSummary(saved);
    },

    /**
     * 关联墨库项目。人确认一次，保存稳定 projectId。
     * 同一编号重复调用幂等；改绑需要 force + 显式确认。
     */
    async link({projectId, mokuProjectId, expectedVersion, force = false}) {
      const current = projects.get(projectId);
      if (!current) throw fail.notFound('项目不存在');
      assertVersion(current, expectedVersion);
      const next = linkToMoku(current, cleanMokuProjectId(mokuProjectId), {
        now: clock(),
        force: force === true
      });
      if (next === current) return projectSummary(current);
      const other = projects.findByMokuId(next.mokuProjectId);
      if (other && other.id !== projectId) {
        throw fail.stateConflict('该墨库项目已关联其他本地项目', {projectId: other.id});
      }
      const saved = projects.update(next, current.objectVersion);
      if (!saved) throw versionConflict();
      emit('project.linked', projectId, {mokuProjectId: saved.mokuProjectId});
      return projectSummary(saved);
    }
  };

  function assertVersion(current, expectedVersion) {
    if (expectedVersion === undefined || expectedVersion === null) return;
    if (Number(expectedVersion) !== current.objectVersion) throw versionConflict(current.objectVersion);
  }

  function versionConflict(currentVersion) {
    return fail.conflict('项目已被修改，请刷新后重试', {
      currentVersion: currentVersion ?? null
    });
  }
}
