/**
 * 旧漫画工程读取器（只读）。
 *
 * 兼容两种存储：
 * - storage=2：studio.json 索引 + projects/<id>.json
 * - 旧版单文件：studio.json 内 projects 数组
 *
 * 不修改任何旧文件；只把需要的信息整理成迁移器可用的结构。
 */
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ID = /^[a-z]+_[0-9a-f-]{36}$/;
const PROJECT_FILE = /^([a-z]+_[0-9a-f-]{36})\.json$/;
const ASSET_ID = /^asset_[0-9a-f-]{36}$/;

export function readComicStore(dataDir) {
  const root = path.resolve(dataDir);
  const indexFile = path.join(root, 'studio.json');
  if (!fs.existsSync(indexFile)) {
    throw new Error(`找不到漫画工程索引：${indexFile}`);
  }

  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`studio.json 无法解析：${error.message}`);
  }

  const assets = new Map();
  for (const raw of index.assets ?? []) {
    if (!raw?.id) continue;
    const extension = raw.extension || '.png';
    assets.set(raw.id, {
      ...raw,
      extension,
      filePath: raw.filePath || path.join(root, 'assets', raw.id + extension)
    });
  }

  let projects = [];
  if (index.storage === 2) {
    const order = Array.isArray(index.projectOrder) ? index.projectOrder : [];
    const dir = path.join(root, 'projects');
    const ids = new Set(order.filter(id => PROJECT_ID.test(id)));
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const match = PROJECT_FILE.exec(name);
        if (match) ids.add(match[1]);
      }
    }
    for (const id of ids) {
      const file = path.join(dir, `${id}.json`);
      if (!fs.existsSync(file)) continue; // 被移到 projects/removed 的工程
      let project;
      try {
        project = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      } catch (error) {
        throw new Error(`工程文件无法解析：${file}（${error.message}）`);
      }
      if (project?.id !== id) throw new Error(`工程文件编号不一致：${file}`);
      projects.push(project);
    }
  } else if (Array.isArray(index.projects)) {
    projects = index.projects;
  }

  return {
    root,
    index,
    projects: projects.filter(project => project && project.id && !project.deletedAt),
    assets
  };
}

function episodeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/** 与 comic/public/episode-boards.js 的 pageEpisode 保持同一优先级。 */
export function pageEpisode(project, page) {
  const panels = page?.panels ?? [];
  const shot = (project.shots ?? []).find(item => panels.some(panel => panel.shotId === item.id));
  return episodeNumber(page?.storyboard?.episode)
    ?? episodeNumber(shot?.episode)
    ?? episodeNumber(shot?.storyboard?.episode)
    ?? episodeNumber(/^第\s*([^话]+)话/u.exec(page?.name ?? '')?.[1])
    ?? ((project.pages ?? []).filter(p => !p.designEpisodeRole).length === 1
      ? episodeNumber(/^第\s*([^话]+)话/u.exec(project.importReview?.sheet ?? '')?.[1])
      : null)
    ?? null;
}

export function episodeNumbers(project) {
  const numbers = new Set();
  for (const page of project.pages ?? []) {
    const number = pageEpisode(project, page);
    if (number) numbers.add(number);
  }
  if (!numbers.size) numbers.add(1);
  return [...numbers].sort((a, b) => a - b);
}

/** 递归收集 project JSON 里引用到的旧 assetId。 */
export function referencedAssetIds(project) {
  const found = new Set();
  const visit = value => {
    if (typeof value === 'string') {
      if (ASSET_ID.test(value)) found.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(project);
  return found;
}

const ROLES = new Set(['character', 'scene', 'prop', 'style']);

/** 从项目引用与旧资产记录里还原角色/名称/形态。 */
export function resolveAssetMeta(project, assetId, asset) {
  const reference = (project.references ?? []).find(item => item.assetId === assetId);
  const role = [reference?.role, asset.libraryRole, asset.productionRole]
    .find(value => ROLES.has(value)) ?? 'scene';
  const rawName = [reference?.name, asset.libraryName, asset.name, assetId]
    .map(value => String(value ?? '').trim())
    .find(Boolean) ?? assetId;
  const name = rawName.replace(/\.(png|jpe?g|webp)$/i, '');
  const state = String(asset.libraryState ?? reference?.state ?? '').replace(/\s+/g, ' ').trim();
  const view = String(asset.libraryView ?? '').replace(/\s+/g, ' ').trim();
  return {role, name, state, view};
}

export function normalizeTime(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

export {PROJECT_ID};
