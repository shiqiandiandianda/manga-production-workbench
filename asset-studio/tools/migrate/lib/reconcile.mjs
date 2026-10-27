/**
 * 迁移对账（库函数，供 CLI 与测试共用）。
 */
import path from 'node:path';
import {openDatabase} from '../../../app/platform/db/open.mjs';
import {
  episodeNumbers,
  readComicStore,
  referencedAssetIds
} from './read-comic-store.mjs';

export function reconcileComicStore({dataDir, databaseFile}) {
  const store = readComicStore(dataDir);
  const db = openDatabase(databaseFile, {readOnly: true});
  const mismatches = [];
  const warnings = [];
  const counts = {
    oldProjects: store.projects.length,
    newProjects: 0,
    oldEpisodes: 0,
    newEpisodes: 0,
    assetsChecked: 0,
    documentsChecked: 0
  };

  try {
    const findProject = db.prepare(
      'SELECT id, title, external_key FROM projects WHERE external_key = ?'
    );
    const countImported = db.prepare(
      "SELECT COUNT(*) AS n FROM projects WHERE external_key LIKE 'comic:%'"
    );
    const episodeStmt = db.prepare(
      'SELECT number FROM episodes WHERE project_id = ? ORDER BY number'
    );
    const legacyStmt = db.prepare(
      'SELECT new_id FROM legacy_ids WHERE entity = ? AND source = ? AND old_id = ?'
    );
    const revisionStmt = db.prepare(
      'SELECT revision_id, sha256 FROM asset_revisions WHERE asset_id = ? ORDER BY created_at'
    );

    counts.newProjects = Number(countImported.get().n);

    for (const project of store.projects) {
      const externalKey = `comic:${project.id}`;
      const row = findProject.get(externalKey);
      if (!row) {
        mismatches.push({kind: 'project.missing', detail: `${project.id}（${externalKey}）`});
        continue;
      }

      const oldEpisodes = episodeNumbers(project);
      counts.oldEpisodes += oldEpisodes.length;
      const newEpisodes = episodeStmt.all(row.id).map(item => Number(item.number));
      counts.newEpisodes += newEpisodes.length;
      const missingEpisodes = oldEpisodes.filter(number => !newEpisodes.includes(number));
      if (missingEpisodes.length) {
        mismatches.push({
          kind: 'episode.missing',
          detail: `${project.id} 缺少第 ${missingEpisodes.join('、')} 话`
        });
      }

      for (const assetId of referencedAssetIds(project)) {
        const asset = store.assets.get(assetId);
        if (!asset) {
          warnings.push(`旧工程引用了不存在的资产：${project.id} → ${assetId}`);
          continue;
        }
        const mapped = legacyStmt.get('asset', 'comic', `${project.id}:asset:${assetId}`);
        if (!mapped) {
          mismatches.push({
            kind: 'asset.missing',
            detail: `${project.id} → ${assetId}（无 legacy 映射）`
          });
          continue;
        }
        counts.assetsChecked += 1;
        const revisions = revisionStmt.all(mapped.new_id);
        if (!revisions.length) {
          mismatches.push({
            kind: 'revision.missing',
            detail: `${project.id} → ${assetId}（无版本）`
          });
          continue;
        }
        if (asset.sha256 && /^[a-f0-9]{64}$/i.test(asset.sha256)) {
          const expected = asset.sha256.toLowerCase();
          if (!revisions.some(revision => revision.sha256 === expected)) {
            warnings.push(`sha256 不一致（可能因文件被替换）：${project.id} → ${assetId}`);
          }
        }
      }

      const documentMapped = legacyStmt.get(
        'document',
        'comic',
        `${project.id}:document:comic-project`
      );
      if (documentMapped) counts.documentsChecked += 1;
      else {
        mismatches.push({
          kind: 'document.missing',
          detail: `${project.id}（未登记 comic-project 文档）`
        });
      }
    }
  } finally {
    db.close();
  }

  return {
    ok: mismatches.length === 0,
    checkedAt: new Date().toISOString(),
    source: path.resolve(dataDir),
    databaseFile,
    counts,
    mismatches,
    warnings
  };
}
