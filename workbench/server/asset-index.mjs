/**
 * 资产索引：一次写入、多处可查。
 *
 * 设计取舍：用 JSONL 追加写（崩溃只丢最后一行）作为主存储，内存 Map 提供查询，
 * 定期把快照写成 JSON 便于人工查看与外部工具直接读取。
 * 索引不是唯一真源——scan() 可以随时按磁盘重建，避免"索引坏了素材就丢了"。
 */
import path from 'node:path';
import {readdir, stat} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {atomicJson, jsonlLog, safeName} from './store.mjs';
import {files} from './paths.mjs';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const TEXT_EXTENSIONS = new Set(['.json', '.txt', '.md', '.csv']);

/** 扩展名统一成带点的形式（'png' 和 '.png' 都要认，否则图片会被判成 other） */
function withDot(extension) {
  const value = String(extension || '').toLowerCase();
  if (!value) return '';
  return value.startsWith('.') ? value : `.${value}`;
}

function kindForExtension(input) {
  const extension = withDot(input);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (['.mp4', '.mov', '.webm'].includes(extension)) return 'video';
  return 'other';
}

function normalizeRecord(record) {
  // 展开 ...record 时，值为 undefined 的字段会把前面算好的默认值又覆盖掉
  //（这就是图片被记成 other、界面不显示缩略图的原因）。先清掉空值再归一化。
  const source = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (value === undefined || value === null) continue;
    source[key] = value;
  }
  // 扩展名要从相对路径兜底，kind 再由扩展名推断
  const extension = String(source.extension || path.extname(source.relativePath || '') || '').toLowerCase();
  const kind = source.kind || kindForExtension(extension);
  return {
    assetId: source.assetId,
    relativePath: source.relativePath,
    name: source.name || path.basename(source.relativePath || ''),
    extension,
    kind,
    type: record.type || 'misc',
    typeLabel: record.typeLabel || '',
    project: record.project || '',
    character: record.character || '',
    outfit: record.outfit || '',
    view: record.view || '',
    part: record.part || '',
    style: record.style || '',
    era: record.era || '',
    gender: record.gender || '',
    ageStage: record.ageStage || '',
    version: record.version || 'v1',
    tags: Array.isArray(record.tags) ? record.tags.slice(0, 40) : [],
    note: record.note || '',
    sha256: record.sha256 || '',
    bytes: Number(record.bytes) || 0,
    width: record.width || null,
    height: record.height || null,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origin: record.origin || 'hub',
    jobId: record.jobId || '',
    clientRequestId: record.clientRequestId || '',
    vendor: record.vendor || '',
    copies: Array.isArray(record.copies) ? record.copies : [],
    deletedAt: record.deletedAt || null,
    extra: record.extra && typeof record.extra === 'object' ? record.extra : {}
  };
}

export function createAssetIndex() {
  const log = jsonlLog(files.assetIndex);
  /** assetId -> record */
  const records = new Map();
  /** `${destinationId}\u0000${relativePath.toLowerCase()}` -> assetId */
  const byPath = new Map();
  let loaded = false;
  let saving = Promise.resolve();
  let dirty = 0;

  function pathKey(destinationId, relativePath) {
    return `${destinationId}\u0000${String(relativePath).toLowerCase()}`;
  }

  function reindex(record) {
    for (const copy of record.copies || []) byPath.set(pathKey(copy.destinationId, copy.relativePath), record.assetId);
  }

  async function ensureLoaded() {
    if (loaded) return;
    const entries = await log.readAll();
    for (const entry of entries) {
      if (entry?.event === 'delete' && entry.assetId) {
        const existing = records.get(entry.assetId);
        if (existing) {
          existing.deletedAt = entry.deletedAt || new Date().toISOString();
          for (const copy of existing.copies || []) byPath.delete(pathKey(copy.destinationId, copy.relativePath));
        }
        continue;
      }
      const record = normalizeRecord(entry);
      if (!record.assetId || !record.relativePath) continue;
      records.set(record.assetId, record);
      reindex(record);
    }
    loaded = true;
  }

  function scheduleFlush() {
    dirty += 1;
    saving = saving.then(async () => {
      if (!dirty) return;
      dirty = 0;
      const list = [...records.values()];
      await atomicJson(files.assetIndexSnapshot, {version: 1, updatedAt: new Date().toISOString(), total: list.length, assets: list});
    }).catch(() => {});
    return saving;
  }

  function relativeToDestination(destination, absolutePath) {
    const root = destination.path;
    const relative = path.relative(root, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return relative;
  }

  return {
    async load() {
      await ensureLoaded();
      return records.size;
    },
    async add(input) {
      await ensureLoaded();
      const now = new Date().toISOString();
      const assetId = input.assetId || `ast_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const copies = [];
      for (const copy of input.copies || []) {
        if (!copy?.destinationId || !copy?.relativePath) continue;
        copies.push({destinationId: copy.destinationId, relativePath: copy.relativePath, path: copy.path || ''});
        byPath.set(pathKey(copy.destinationId, copy.relativePath), assetId);
      }
      const existing = records.get(assetId);
      const candidate = {
        ...(existing || {}),
        ...input,
        assetId,
        copies: copies.length ? copies : existing?.copies || [],
        createdAt: existing?.createdAt || input.createdAt || now,
        updatedAt: now
      };
      // 调用方把 kind / extension 等字段传成 undefined 时，展开会覆盖掉推断结果，
      // 导致图片被记成 other、界面上不显示缩略图。这里统一清掉空值再归一化。
      for (const key of Object.keys(candidate)) {
        if (candidate[key] === undefined || candidate[key] === null) delete candidate[key];
      }
      const record = normalizeRecord(candidate);
      records.set(assetId, record);
      await log.append(record);
      scheduleFlush();
      return record;
    },
    async markDeleted(assetId) {
      await ensureLoaded();
      const record = records.get(assetId);
      if (!record) return null;
      record.deletedAt = new Date().toISOString();
      for (const copy of record.copies || []) byPath.delete(pathKey(copy.destinationId, copy.relativePath));
      await log.append({event: 'delete', assetId, deletedAt: record.deletedAt});
      scheduleFlush();
      return record;
    },
    /** 更新单个副本的落盘结果（补充 archive 位置、修正相对路径） */
    async updateCopy(assetId, destinationId, copy) {
      await ensureLoaded();
      const record = records.get(assetId);
      if (!record) return null;
      record.copies = (record.copies || []).filter(entry => entry.destinationId !== destinationId);
      record.copies.push({destinationId, relativePath: copy.relativePath, path: copy.path});
      byPath.set(pathKey(destinationId, copy.relativePath), assetId);
      record.updatedAt = new Date().toISOString();
      await log.append(record);
      scheduleFlush();
      return record;
    },
    get(assetId) {
      return records.get(assetId) || null;
    },
    findByPath(destinationId, relativePath) {
      const assetId = byPath.get(pathKey(destinationId, relativePath));
      return assetId ? records.get(assetId) || null : null;
    },
    /** 相对路径全局唯一（模板不含位置信息），因此跨位置查同一文件是安全的 */
    findByRelativePath(relativePath) {
      const target = String(relativePath).toLowerCase();
      for (const record of records.values()) {
        if ((record.relativePath || '').toLowerCase() === target) return record;
      }
      return null;
    },
    async query(params = {}) {
      await ensureLoaded();
      const {
        q = '', type = '', project = '', character = '', outfit = '', style = '', era = '', gender = '',
        kind = '', tags = [], destinationId = '', includeDeleted = false, since = '', until = '',
        limit = 60, offset = 0, sort = 'createdAt', order = 'desc'
      } = params;
      const needle = String(q).trim().toLowerCase();
      const tagList = (Array.isArray(tags) ? tags : String(tags).split(',')).map(tag => String(tag).trim().toLowerCase()).filter(Boolean);
      const sinceTime = since ? Date.parse(since) : null;
      const untilTime = until ? Date.parse(until) : null;
      const matched = [];
      for (const record of records.values()) {
        if (!includeDeleted && record.deletedAt) continue;
        if (type && record.type !== type) continue;
        if (project && record.project !== project) continue;
        if (character && record.character !== character) continue;
        if (outfit && record.outfit !== outfit) continue;
        if (style && record.style !== style) continue;
        if (era && record.era !== era) continue;
        if (gender && record.gender !== gender) continue;
        if (kind && record.kind !== kind) continue;
        if (destinationId && !(record.copies || []).some(copy => copy.destinationId === destinationId)) continue;
        if (tagList.length && !tagList.every(tag => record.tags.map(value => value.toLowerCase()).includes(tag))) continue;
        const created = Date.parse(record.createdAt) || 0;
        if (sinceTime && created < sinceTime) continue;
        if (untilTime && created > untilTime) continue;
        if (needle) {
          const haystack = [record.name, record.relativePath, record.project, record.character, record.outfit, record.type, record.typeLabel, record.style, record.note, record.sha256, ...(record.tags || [])]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(needle)) continue;
        }
        matched.push(record);
      }
      const direction = order === 'asc' ? 1 : -1;
      const key = ['createdAt', 'name', 'bytes', 'project', 'character', 'type'].includes(sort) ? sort : 'createdAt';
      matched.sort((a, b) => {
        const left = key === 'bytes' ? a.bytes : key === 'createdAt' ? Date.parse(a.createdAt) : String(a[key] || '');
        const right = key === 'bytes' ? b.bytes : key === 'createdAt' ? Date.parse(b.createdAt) : String(b[key] || '');
        if (left === right) return 0;
        return left > right ? direction : -direction;
      });
      const pageSize = Math.min(Math.max(Number(limit) || 60, 1), 500);
      const pageOffset = Math.max(Number(offset) || 0, 0);
      return {
        total: matched.length,
        limit: pageSize,
        offset: pageOffset,
        assets: matched.slice(pageOffset, pageOffset + pageSize),
        facets: buildFacets(matched)
      };
    },
    stats() {
      const live = [...records.values()].filter(record => !record.deletedAt);
      const byType = {};
      const byProject = {};
      const byDestination = {};
      let bytes = 0;
      for (const record of live) {
        byType[record.type] = (byType[record.type] || 0) + 1;
        const project = record.project || '(未指定项目)';
        byProject[project] = (byProject[project] || 0) + 1;
        bytes += record.bytes || 0;
        for (const copy of record.copies || []) byDestination[copy.destinationId] = (byDestination[copy.destinationId] || 0) + 1;
      }
      return {total: live.length, deleted: records.size - live.length, bytes, byType, byProject, byDestination};
    },
    /**
     * 按磁盘重建/补齐索引：用于索引文件丢失、或直接往共享目录手动放图之后的追认。
     * 只做新增与路径修正，不删除已有记录。
     */
    async scan(roots, {onProgress} = {}) {
      await ensureLoaded();
      const found = [];
      const walk = async (root, destinationId, depth = 0) => {
        if (depth > 6) return;
        let entries;
        try {
          entries = await readdir(root, {withFileTypes: true});
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(root, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue;
            await walk(full, destinationId, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;
          const extension = path.extname(entry.name).toLowerCase();
          if (!IMAGE_EXTENSIONS.has(extension) && !TEXT_EXTENSIONS.has(extension)) continue;
          found.push({full, extension, destinationId});
        }
      };
      for (const root of roots) await walk(root.path, root.id);
      let added = 0;
      let index = 0;
      for (const item of found) {
        index += 1;
        onProgress?.({scanned: index, total: found.length, added});
        const relative = path.relative(roots.find(root => item.full.startsWith(root.path))?.path || path.dirname(item.full), item.full);
        const existing = this.findByPath(item.destinationId, relative);
        if (existing) continue;
        const info = await stat(item.full).catch(() => null);
        if (!info) continue;
        await this.add({
          relativePath: relative,
          name: path.basename(relative),
          extension: item.extension,
          kind: kindForExtension(item.extension),
          type: 'misc',
          origin: 'scan',
          bytes: info.size,
          createdAt: info.mtime.toISOString(),
          copies: [{destinationId: item.destinationId, relativePath: relative, path: item.full}]
        });
        added += 1;
      }
      await scheduleFlush();
      return {scanned: found.length, added};
    },
    async flush() {
      await saving;
    },
    async compact() {
      await ensureLoaded();
      await log.rewrite([...records.values()]);
      await scheduleFlush();
    },
    /** 供启动时幂等去重：同一内容同一位置只保留一条 */
    fingerprint(bytes) {
      return createHash('sha256').update(bytes).digest('hex');
    }
  };
}

function buildFacets(list) {
  const collect = field => {
    const counter = new Map();
    for (const record of list) {
      const value = record[field] || '';
      if (!value) continue;
      counter.set(value, (counter.get(value) || 0) + 1);
    }
    return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([value, count]) => ({value, count}));
  };
  const tags = new Map();
  for (const record of list) for (const tag of record.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
  return {
    type: collect('type'),
    project: collect('project'),
    character: collect('character'),
    style: collect('style'),
    era: collect('era'),
    gender: collect('gender'),
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([value, count]) => ({value, count}))
  };
}

export {kindForExtension, normalizeRecord};
