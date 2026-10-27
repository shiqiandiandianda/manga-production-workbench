/**
 * 项目模型（纯领域）。
 *
 * 单一权威：项目身份由 `projects` 表持有，`mokuProjectId` 是墨库项目的稳定映射，
 * 只允许由人确认一次；一个本地项目最多映射一个墨库项目。
 */
import {fail} from '../errors.mjs';

export const MAX_TITLE_LENGTH = 180;
const MOKU_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** webtoon = 长条漫画（竖向连续阅读）；page = 传统页漫。 */
export const PROJECT_FORMATS = Object.freeze(['webtoon', 'page']);

export function cleanFormat(value = 'webtoon') {
  const format = String(value ?? 'webtoon').trim();
  if (!PROJECT_FORMATS.includes(format)) {
    throw fail.invalid('项目版式必须是 webtoon（长条）或 page（页漫）');
  }
  return format;
}

export function cleanTitle(value) {
  const title = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw fail.invalid('项目名称不能为空');
  if ([...title].length > MAX_TITLE_LENGTH) {
    throw fail.invalid(`项目名称不能超过 ${MAX_TITLE_LENGTH} 个字符`);
  }
  return title;
}

export function cleanMokuProjectId(value) {
  const id = String(value ?? '').trim();
  if (!id) throw fail.invalid('墨库项目编号不能为空');
  if (!MOKU_ID.test(id)) {
    throw fail.invalid('墨库项目编号格式不正确（只允许字母、数字、点、下划线、冒号、连字符）');
  }
  return id;
}

/**
 * externalKey 是来源工具的稳定工程编号（对应 07/PROJECT-API.md 的 externalKey）。
 * 用于"创建或查找"：同一个 key 重复提交返回同一个项目，迁移期也靠它对齐旧工程。
 */
export function cleanExternalKey(value) {
  if (value === undefined || value === null || value === '') return null;
  const key = String(value).trim();
  if (!key) return null;
  if (key.length > 200) throw fail.invalid('externalKey 不能超过 200 个字符');
  if (/[\u0000-\u001f\u007f]/.test(key)) throw fail.invalid('externalKey 不能包含控制字符');
  return key;
}

export function createProject({
  id,
  title,
  mokuProjectId = null,
  externalKey = null,
  format = 'webtoon',
  now,
  updatedAt = now
}) {
  if (!id) throw fail.invalid('缺少项目编号');
  if (!now) throw fail.invalid('缺少创建时间');
  return {
    id,
    title: cleanTitle(title),
    mokuProjectId: mokuProjectId ? cleanMokuProjectId(mokuProjectId) : null,
    externalKey: cleanExternalKey(externalKey),
    format: cleanFormat(format),
    objectVersion: 1,
    createdAt: now,
    updatedAt: updatedAt ?? now
  };
}

/**
 * 关联墨库项目。同一编号重复调用是幂等的；改绑必须显式 force。
 * 返回新对象（不修改入参），objectVersion 由仓储层自增。
 */
export function linkToMoku(project, mokuProjectId, {now, force = false} = {}) {
  if (!now) throw fail.invalid('缺少更新时间');
  const next = cleanMokuProjectId(mokuProjectId);
  if (project.mokuProjectId === next) return project;
  if (project.mokuProjectId && !force) {
    throw fail.stateConflict('项目已关联其他墨库项目，改绑需要显式确认', {
      currentMokuProjectId: project.mokuProjectId
    });
  }
  return {...project, mokuProjectId: next, updatedAt: now};
}

export function renameProject(project, title, {now} = {}) {
  if (!now) throw fail.invalid('缺少更新时间');
  const nextTitle = cleanTitle(title);
  if (nextTitle === project.title) return project;
  return {...project, title: nextTitle, updatedAt: now};
}

export function projectSummary(project) {
  return {
    id: project.id,
    title: project.title,
    mokuProjectId: project.mokuProjectId,
    externalKey: project.externalKey,
    format: project.format ?? 'webtoon',
    objectVersion: project.objectVersion,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    linked: Boolean(project.mokuProjectId)
  };
}
