// 协作结果回填（A 端回填层，协议 §7.2 / §8）。
// 只在「目标编辑版本未变」时写入画格；版本变化时保留为候选、绝不覆盖当前画面。
// 回填只做一次：本地 dataDir/collab/apply-journal.json 原子写，先 applying 再改画格、成功写 applied。
// 本模块不依赖 server.mjs 闭包，测试可直接注入 Store 调用。
import fs from 'node:fs';
import path from 'node:path';
import {check, nowIso, sha256, uid, writeJsonAtomic} from '../../协作/lib/protocol.mjs';
import {panelContentKey} from '../public/panel-generation.js';
import {panelReferenceKey} from '../public/panel-references.js';
import {clone} from '../public/model.js';
import {fitGeneratedArtwork} from '../public/artwork-transform.js';
import {panelArtDirection} from '../public/comic-art-direction.js';
import {inspectImageFile} from './image-files.mjs';
import {imagePathKey} from './image-directory.mjs';

export const COLLAB_APPLY_MODES = Object.freeze(['auto', 'force', 'candidate']);
export const APPLY_JOURNAL_VERSION = 1;
const JOURNAL_ENTRY_LIMIT = 2000;

// 与 server.mjs 顶部的 geometryKey 完全一致（字段顺序也一致，JSON 字符串才能直接比较）。
// 协作 prepare 端与回填端都使用这一份定义；不要随意增删字段，否则会和旧任务记录对不上。
export const panelGeometryKey = panel => JSON.stringify({x: panel.x, y: panel.y, w: panel.w, h: panel.h, points: panel.points, imageAssetId: panel.imageAssetId, imageTransform: panel.imageTransform});

export function applyJournalFile(dataDir) {
  return path.join(dataDir, 'collab', 'apply-journal.json');
}

export function readApplyJournal(dataDir) {
  const file = applyJournalFile(dataDir);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {version: APPLY_JOURNAL_VERSION, entries: {}};
    // 损坏的 journal 不能阻止回填；重置为新的空日志（面板本身已经按幂等方式处理）。
    return {version: APPLY_JOURNAL_VERSION, entries: {}, recovered: true};
  }
  if (!value || typeof value !== 'object' || value.version !== APPLY_JOURNAL_VERSION || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) {
    return {version: APPLY_JOURNAL_VERSION, entries: {}, recovered: true};
  }
  return value;
}

function writeApplyJournal(dataDir, journal) {
  const entries = Object.entries(journal.entries);
  if (entries.length > JOURNAL_ENTRY_LIMIT) {
    entries.sort((a, b) => String(a[1]?.at || '').localeCompare(String(b[1]?.at || '')));
    journal.entries = Object.fromEntries(entries.slice(-JOURNAL_ENTRY_LIMIT));
  }
  writeJsonAtomic(applyJournalFile(dataDir), journal);
}

/** 把一张协作结果图复制进本机 assets 目录并登记为本地资产；同 sha256 复用，避免重复复制。 */
export function registerLocalImageAsset({store, dataDir, filePath, name = '', source = 'collab', expectedSha256 = null} = {}) {
  check(store && typeof store === 'object' && typeof store.save === 'function', '缺少工程数据存储，无法登记协作结果', 500);
  check(typeof filePath === 'string' && filePath.trim(), '缺少协作结果图片路径');
  const absolute = path.resolve(filePath.trim());
  check(fs.existsSync(absolute), '协作结果图片文件不存在：' + absolute, 404);
  const info = inspectImageFile(absolute);
  const bytes = fs.readFileSync(info.filePath);
  const actualSha256 = sha256(bytes);
  if (expectedSha256) check(actualSha256 === String(expectedSha256).toLowerCase(), '协作结果图片校验失败：SHA-256 与中控记录不一致，已拒绝登记', 409);
  const existingBySha = store.db.assets.find(asset => asset.sha256 === actualSha256 && fs.existsSync(store.assetPath(asset.id)));
  if (existingBySha) return {...existingBySha, sha256: actualSha256};
  const samePath = store.db.assets.find(asset => imagePathKey(store.assetPath(asset.id)) === imagePathKey(info.filePath));
  if (samePath) {
    Object.assign(samePath, info, {sha256: actualSha256});
    store.save();
    return samePath;
  }
  const directory = path.join(dataDir, 'assets');
  fs.mkdirSync(directory, {recursive: true});
  const id = uid('asset');
  const target = path.join(directory, id + info.extension);
  fs.copyFileSync(info.filePath, target);
  const stat = fs.statSync(target);
  const asset = {
    id,
    name: String(name || path.basename(info.filePath)).slice(0, 180),
    ...info,
    filePath: target,
    storage: 'path',
    fileSize: stat.size,
    fileModified: stat.mtimeMs,
    fileChanged: stat.ctimeMs,
    sha256: actualSha256,
    source,
    created: nowIso(),
  };
  store.db.assets.push(asset);
  store.save();
  return asset;
}

function addCandidate(panel, assetId) {
  const list = Array.isArray(panel.candidates) ? panel.candidates.slice() : [];
  const next = list.includes(assetId) ? list : [...list, assetId];
  panel.candidates = next.slice(-40);
}

function findPanel(project, panelId) {
  for (const page of project.pages || []) {
    const panel = (page.panels || []).find(item => item.id === panelId);
    if (panel) return {page, panel};
  }
  return null;
}

// 版本校验：只比较 expected 里明确给出的字段（旧任务可能没有 generationToken 等扩展字段）。
function compareVersions(project, panel, expected, assets) {
  const current = {
    revision: project.revision,
    panelContentKey: panelContentKey(project, panel, assets),
    geometryKey: panelGeometryKey(panel),
    referenceKey: panelReferenceKey(project, panel, assets),
  };
  const mismatches = [];
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    for (const field of ['revision', 'panelContentKey', 'geometryKey', 'referenceKey']) {
      if (expected[field] === undefined) continue;
      if (expected[field] !== current[field]) mismatches.push(field);
    }
  }
  return {current, mismatches};
}

/**
 * 回填一张协作结果。
 * @returns {{status:'applied'|'conflict'|'candidate', duplicate:boolean, taskId:string, projectId:string, panelId:string, assetId:string, sha256:string, mismatches:string[], forced:boolean, mode:string}}
 */
export function applyCollabResult({store, dataDir, projectId, panelId, taskId, filePath, sha256: expectedSha256 = null, expected = null, mode = 'auto', name = '', by = null} = {}) {
  check(store && typeof store === 'object' && typeof store.project === 'function', '缺少工程数据存储，无法回填协作结果', 500);
  check(typeof dataDir === 'string' && dataDir.trim(), '缺少漫画数据目录');
  check(typeof projectId === 'string' && projectId.trim(), '回填参数缺少工程编号');
  check(typeof panelId === 'string' && panelId.trim(), '回填参数缺少画格编号');
  check(typeof taskId === 'string' && taskId.trim() && taskId.length <= 240, '回填参数缺少协作任务编号');
  check(COLLAB_APPLY_MODES.includes(mode), '回填模式无效：' + mode);
  check(typeof filePath === 'string' && filePath.trim(), '回填参数缺少结果图片路径');
  const absoluteFile = path.resolve(filePath.trim());
  check(fs.existsSync(absoluteFile), '协作结果图片文件不存在：' + absoluteFile, 404);

  const bytes = fs.readFileSync(absoluteFile);
  const actualSha256 = sha256(bytes);
  if (expectedSha256) check(actualSha256 === String(expectedSha256).toLowerCase(), '协作结果图片校验失败：SHA-256 与中控记录不一致，已拒绝回填', 409);

  const journal = readApplyJournal(dataDir);
  const journalKey = taskId + ':' + actualSha256;
  const previous = journal.entries[journalKey];
  // 已经成功回填过的同一任务+同一张图：只回 duplicate，不再改画格。
  if (previous?.status === 'applied') {
    return {status: 'applied', duplicate: true, taskId, projectId, panelId, assetId: previous.assetId || null, sha256: actualSha256, mismatches: [], forced: previous.forced === true, mode: previous.mode || mode, by};
  }

  const project = store.project(projectId);
  const found = findPanel(project, panelId);
  check(found, '画格不存在，可能已在其他窗口删除', 404);
  const {panel} = found;

  const mismatches = compareVersions(project, panel, expected, store.db.assets).mismatches;

  // 冲突或仅候选：结果图仍然登记并加入候选，绝不覆盖 imageAssetId。
  if (mode === 'candidate' || (mode === 'auto' && mismatches.length)) {
    const status = mode === 'candidate' ? 'candidate' : 'conflict';
    journal.entries[journalKey] = {status: 'applying', taskId, sha256: actualSha256, projectId, panelId, mode, by, at: nowIso()};
    writeApplyJournal(dataDir, journal);
    const asset = registerLocalImageAsset({store, dataDir, filePath: absoluteFile, name: name || '协作结果 ' + taskId.slice(-6), source: 'collab', expectedSha256: actualSha256});
    addCandidate(panel, asset.id);
    project.updated = nowIso();
    store.markProject?.(project);
    store.save();
    journal.entries[journalKey] = {status, taskId, sha256: actualSha256, projectId, panelId, assetId: asset.id, mismatches, mode, by, at: nowIso()};
    writeApplyJournal(dataDir, journal);
    return {status, duplicate: false, taskId, projectId, panelId, assetId: asset.id, sha256: actualSha256, mismatches, forced: false, mode, by};
  }

  // 一致（或用户显式 force）：登记资产并写入画格。
  journal.entries[journalKey] = {status: 'applying', taskId, sha256: actualSha256, projectId, panelId, mode, by, at: nowIso()};
  writeApplyJournal(dataDir, journal);
  const asset = registerLocalImageAsset({store, dataDir, filePath: absoluteFile, name: name || '协作结果 ' + taskId.slice(-6), source: 'collab', expectedSha256: actualSha256});
  addCandidate(panel, asset.id);
  panel.imageAssetId = asset.id;
  // 协作生图与本机采用相同的 95% 初始取景，不改变画格几何或原图像素。
  panel.imageTransform = fitGeneratedArtwork(panel, asset);
  panel.imageEffects = {version: 1, imageAssetId: asset.id, artDirection: clone(panelArtDirection(panel))};
  project.updated = nowIso();
  store.markProject?.(project);
  store.save();
  journal.entries[journalKey] = {status: 'applied', taskId, sha256: actualSha256, projectId, panelId, assetId: asset.id, mismatches, forced: mode === 'force', mode, by, at: nowIso()};
  writeApplyJournal(dataDir, journal);
  return {status: 'applied', duplicate: false, taskId, projectId, panelId, assetId: asset.id, sha256: actualSha256, mismatches, forced: mode === 'force', mode, by};
}

/** 页面「丢弃」结果：只记录，不改画格，也不登记本地资产。 */
export function markCollabResultSkipped({store, dataDir, taskId, sha256: expectedSha256, projectId = '', panelId = '', by = null} = {}) {
  check(typeof taskId === 'string' && taskId.trim(), '缺少协作任务编号');
  check(dataDir, '缺少漫画数据目录');
  const journal = readApplyJournal(dataDir);
  const prior = Object.entries(journal.entries).find(([key, entry]) => entry?.taskId === taskId && (!expectedSha256 || entry?.sha256 === String(expectedSha256).toLowerCase()));
  if (prior && prior[1]?.status === 'applied') return {status: 'applied', duplicate: true, assetId: prior[1].assetId || null};
  const journalKey = taskId + ':' + String(expectedSha256 || '').toLowerCase();
  journal.entries[journalKey] = {status: 'skipped', taskId, sha256: String(expectedSha256 || '').toLowerCase(), projectId, panelId, by, at: nowIso()};
  writeApplyJournal(dataDir, journal);
  return {status: 'skipped', duplicate: false, assetId: null};
}

/** 供状态接口/页面读取的本地回填历史（新→旧）。 */
export function collabApplyHistory(dataDir, {limit = 50} = {}) {
  const journal = readApplyJournal(dataDir);
  return Object.entries(journal.entries)
    .map(([key, entry]) => ({journalKey: key, ...entry}))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));
}
