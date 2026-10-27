/**
 * 旧漫画工程 → 新库的只读迁移器。
 *
 * 只做等价搬迁：
 * - 项目按 `comic:<旧 projectId>` 建立 externalKey，重复运行幂等
 * - 话数按 pageEpisode 推导，保留负责人为空、阶段按内容推断
 * - 资产按"项目 + 角色 + 名称 + 形态"建立身份，按 sha256 建立固定版本
 * - 工程 JSON 作为 `comic-project` 文档登记（固定 sha256）
 * - 旧编号全部写入 legacy_ids，供对账与回查
 *
 * 不导入：任务、审批、绑定。它们属于阶段 3，避免只搬迁一半的状态。
 */
import fs from 'node:fs';
import path from 'node:path';
import {newId} from '../../../app/core/ids.mjs';
import {
  assetKeyOf,
  createAssetIdentity,
  createAssetRevision
} from '../../../app/core/model/asset.mjs';
import {createProject} from '../../../app/core/model/project.mjs';
import {createLocalArchive} from '../../../app/adapters/archive/local.mjs';
import {openDatabase} from '../../../app/platform/db/open.mjs';
import {migrate} from '../../../app/platform/db/migrate.mjs';
import {createRepositories} from '../../../app/platform/db/repositories.mjs';
import {sha256File, sha256Text} from '../../../app/platform/fs/hash.mjs';
import {mimeForExtension, sniffImageMimeOfFile} from '../../../app/platform/fs/image.mjs';
import {createTempDir} from '../../../app/platform/fs/temp.mjs';
import {
  episodeNumbers,
  normalizeTime,
  pageEpisode,
  readComicStore,
  referencedAssetIds,
  resolveAssetMeta
} from './read-comic-store.mjs';

export async function importComicStore({
  dataDir,
  databaseFile,
  archiveRoot,
  withFiles = true,
  dryRun = false,
  clock = () => new Date().toISOString()
} = {}) {
  if (!dataDir) throw new Error('缺少 --data（旧漫画数据目录）');
  if (!databaseFile) throw new Error('缺少 --db（新数据库路径）');
  if (!archiveRoot) throw new Error('缺少 --cache（内容缓存目录）');

  const store = readComicStore(dataDir);
  const temporaryArchive = dryRun ? createTempDir('comic-migrate-') : null;
  const targetDatabase = dryRun ? ':memory:' : databaseFile;
  const targetArchive = dryRun ? temporaryArchive : archiveRoot;

  const warnings = [];
  const stats = {
    projects: 0,
    projectsCreated: 0,
    projectsExisting: 0,
    skippedProjects: 0,
    episodes: 0,
    episodesExisting: 0,
    assets: 0,
    assetsExisting: 0,
    assetsWithoutBytes: 0,
    revisions: 0,
    documents: 0,
    filesArchived: 0
  };

  const db = openDatabase(targetDatabase);
  try {
    migrate(db);
    const repos = createRepositories(db);
    const archive = createLocalArchive({root: targetArchive});

    for (const project of store.projects) {
      const title = String(project.title ?? '').trim();
      if (!title) {
        stats.skippedProjects += 1;
        warnings.push(`跳过无标题工程：${project.id}`);
        continue;
      }

      stats.projects += 1;
      const createdAt = normalizeTime(project.created) ?? clock();
      const updatedAt = normalizeTime(project.updated) ?? createdAt;
      const externalKey = `comic:${project.id}`;

      let projectRow = repos.projects.findByExternalKey(externalKey);
      if (projectRow) {
        stats.projectsExisting += 1;
        if (projectRow.title !== title) {
          warnings.push(`标题已存在且不同，保留新库标题：${project.id}`);
        }
      } else {
        projectRow = createProject({
          id: newId('proj'),
          title,
          mokuProjectId: null,
          externalKey,
          now: createdAt,
          updatedAt
        });
        repos.projects.insert(projectRow);
        repos.legacy.record({
          entity: 'project',
          source: 'comic',
          oldId: project.id,
          newId: projectRow.id
        });
        stats.projectsCreated += 1;
      }

      for (const number of episodeNumbers(project)) {
        const legacyOldId = `${project.id}:episode:${number}`;
        if (repos.legacy.get('episode', 'comic', legacyOldId)) {
          stats.episodesExisting += 1;
          continue;
        }
        const existing = repos.episodes.findByNumber(projectRow.id, number);
        if (existing) {
          repos.legacy.record({
            entity: 'episode',
            source: 'comic',
            oldId: legacyOldId,
            newId: existing.id
          });
          stats.episodesExisting += 1;
          continue;
        }
        const episode = {
          id: newId('ep'),
          projectId: projectRow.id,
          number,
          ownerUserId: null,
          stage: deriveStage(project, number),
          objectVersion: 1,
          createdAt,
          updatedAt
        };
        repos.episodes.insert(episode);
        repos.legacy.record({
          entity: 'episode',
          source: 'comic',
          oldId: legacyOldId,
          newId: episode.id
        });
        stats.episodes += 1;
      }

      for (const assetId of referencedAssetIds(project)) {
        const asset = store.assets.get(assetId);
        if (!asset) {
          warnings.push(`工程引用了不存在的资产：${project.id} → ${assetId}`);
          continue;
        }

        const legacyOldId = `${project.id}:asset:${assetId}`;
        const mapped = repos.legacy.get('asset', 'comic', legacyOldId);
        if (mapped) {
          stats.assetsExisting += 1;
          continue;
        }

        let meta;
        try {
          meta = resolveAssetMeta(project, assetId, asset);
        } catch (error) {
          warnings.push(`资产元数据无效：${assetId}（${error.message}）`);
          continue;
        }

        let key = assetKeyOf(meta);
        let identity = repos.assets.findIdentity(projectRow.id, key);
        if (identity) {
          // 不同旧资产落到同一形态时，用旧编号尾缀区分，避免错误合并。
          meta = {...meta, name: `${meta.name} · ${assetId.slice(-4)}`};
          key = assetKeyOf(meta);
          identity = repos.assets.findIdentity(projectRow.id, key);
        }
        if (!identity) {
          identity = createAssetIdentity({
            id: newId('asset'),
            projectId: projectRow.id,
            role: meta.role,
            name: meta.name,
            state: meta.state,
            view: meta.view,
            now: createdAt
          });
          repos.assets.insertIdentity(identity);
        }
        repos.legacy.record({
          entity: 'asset',
          source: 'comic',
          oldId: legacyOldId,
          newId: identity.id
        });
        stats.assets += 1;

        let resolved;
        try {
          resolved = await resolveRevision({asset, archive, withFiles, warnings});
        } catch (error) {
          warnings.push(`资产文件入库失败：${project.id} → ${assetId}（${error.message}）`);
          resolved = null;
        }
        if (!resolved) {
          stats.assetsWithoutBytes += 1;
          warnings.push(`资产没有可用的固定字节：${project.id} → ${assetId}`);
          continue;
        }
        if (resolved.archived) stats.filesArchived += 1;

        const revisionId = `local:${resolved.sha256}`;
        if (repos.assets.findRevision(identity.id, revisionId)) continue;
        const revision = createAssetRevision({
          id: newId('rev'),
          assetId: identity.id,
          revisionId,
          sha256: resolved.sha256,
          mime: resolved.mime,
          size: resolved.size,
          status: asset.productionStatus === 'confirmed' ? 'approved' : 'candidate',
          now: createdAt
        });
        repos.assets.insertRevision(revision);
        stats.revisions += 1;
      }

      const documentOldId = `${project.id}:document:comic-project`;
      if (!repos.legacy.get('document', 'comic', documentOldId)) {
        const sha256 = sha256Text(JSON.stringify(project));
        const document = {
          id: newId('doc'),
          projectId: projectRow.id,
          kind: 'comic-project',
          revisionId: `local:${sha256}`,
          sha256,
          objectVersion: 1,
          createdAt,
          updatedAt
        };
        repos.documents.insert(document);
        repos.legacy.record({
          entity: 'document',
          source: 'comic',
          oldId: documentOldId,
          newId: document.id
        });
        stats.documents += 1;
      }
    }

    return {
      dryRun,
      stats,
      warnings,
      databaseFile: dryRun ? ':memory:' : databaseFile,
      archiveRoot: dryRun ? null : archiveRoot
    };
  } finally {
    db.close();
    if (temporaryArchive) fs.rmSync(temporaryArchive, {recursive: true, force: true});
  }
}

function deriveStage(project, number) {
  const pages = (project.pages ?? []).filter(page => pageEpisode(project, page) === number);
  if (!pages.length) return 'script';
  const hasImage = pages.some(page => (page.panels ?? []).some(panel => panel.imageAssetId));
  return hasImage ? 'generation' : 'layout';
}

async function resolveRevision({asset, archive, withFiles, warnings}) {
  const file = asset.filePath;
  const exists = file && fs.existsSync(file);
  let sha256 = typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(asset.sha256)
    ? asset.sha256.toLowerCase()
    : null;
  let size = Number.isInteger(asset.fileSize) && asset.fileSize > 0 ? asset.fileSize : null;
  let mime = mimeForExtension(asset.extension);
  let archived = false;

  if (exists) {
    if (withFiles) {
      const stored = await archive.putFile(file);
      if (sha256 && sha256 !== stored.sha256) {
        warnings.push(`文件哈希与记录不一致，按文件实际内容入库：${file}`);
      }
      sha256 = stored.sha256;
      size = stored.size;
      archived = true;
    } else {
      if (!sha256) sha256 = await sha256File(file);
      if (!size) size = fs.statSync(file).size;
    }
    try {
      mime = sniffImageMimeOfFile(file, asset.extension);
    } catch {
      /* 保留扩展名推断的 mime */
    }
  } else {
    warnings.push(`文件缺失，仅登记元数据：${file}`);
  }

  if (!sha256 || !size) return null;
  return {sha256, size, mime, archived};
}
