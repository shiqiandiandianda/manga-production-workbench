// 协作回填层测试（协议 §8）：版本一致才写画格；提示词/几何/参考/版本任一变化只进候选；
// force 显式应用；同任务+同图只回填一次；本地 apply-journal 原子落盘且崩溃可恢复。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store, uid} from '../lib/store.mjs';
import {createProject} from '../public/model.js';
import {ensurePanelGeneration, panelContentKey} from '../public/panel-generation.js';
import {panelReferenceKey} from '../public/panel-references.js';
import {inspectImageFile} from '../lib/image-files.mjs';
import {applyCollabResult, applyJournalFile, panelGeometryKey, readApplyJournal} from '../lib/collab-apply.mjs';
import {makePng, sha256Hex} from './helpers/collab-fixture.mjs';

function setup(t, {withReference = false} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comic-collab-apply-'));
  const dataDir = path.join(root, 'data');
  const store = new Store(dataDir);
  const project = createProject('协作回填测试');
  store.db.projects.push(project);
  if (withReference) {
    const refFile = path.join(root, 'reference.png');
    fs.writeFileSync(refFile, makePng(16, 16, {r: 90, g: 40, b: 200}));
    const info = inspectImageFile(refFile);
    const asset = {id: uid('asset'), name: '角色甲', ...info, source: 'local-path', libraryRole: 'character'};
    store.db.assets.push(asset);
    project.references = [{assetId: asset.id, name: '角色甲', role: 'character'}];
    project.shots[0].referenceIds = [asset.id];
  }
  const panel = project.pages[0].panels[0];
  ensurePanelGeneration(project, panel, store.db.assets);
  store.save();
  const resultBytes = makePng(80, 60, {r: 10, g: 150, b: 90});
  const resultFile = path.join(root, 'result.png');
  fs.writeFileSync(resultFile, resultBytes);
  const sha256 = sha256Hex(resultBytes);
  const currentProject = () => store.project(project.id);
  const currentPanel = () => currentProject().pages[0].panels[0];
  const expected = () => {
    const current = currentProject();
    const frame = currentPanel();
    return {
      revision: current.revision,
      panelContentKey: panelContentKey(current, frame, store.db.assets),
      geometryKey: panelGeometryKey(frame),
      referenceKey: panelReferenceKey(current, frame, store.db.assets),
      generationToken: frame.generationToken ?? null,
    };
  };
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(root, {recursive: true, force: true});
  });
  return {root, dataDir, store, project, panel, resultFile, sha256, expected, currentProject, currentPanel};
}

test('版本一致 → applied：登记资产、写 imageAssetId/imageTransform/imageEffects/候选，落盘并只回填一次', t => {
  const x = setup(t);
  const expected = x.expected();
  const outcome = applyCollabResult({store: x.store, dataDir: x.dataDir, projectId: x.project.id, panelId: x.panel.id, taskId: 'task_apply_1', filePath: x.resultFile, sha256: x.sha256, expected, mode: 'auto'});
  assert.equal(outcome.status, 'applied');
  assert.equal(outcome.duplicate, false);
  assert.equal(outcome.forced, false);
  assert.deepEqual(outcome.mismatches, []);
  assert.ok(outcome.assetId);
  assert.equal(outcome.sha256, x.sha256);

  const panel = x.currentPanel();
  assert.equal(panel.imageAssetId, outcome.assetId);
  assert.ok(panel.imageTransform && panel.imageTransform.scale > 0, '必须写入 fitImage 取景');
  assert.equal(panel.imageEffects.version, 1);
  assert.equal(panel.imageEffects.imageAssetId, outcome.assetId);
  assert.ok(panel.candidates.includes(outcome.assetId));

  const asset = x.store.db.assets.find(item => item.id === outcome.assetId);
  assert.ok(asset, '结果必须登记为本地资产');
  assert.ok(fs.existsSync(asset.filePath));
  assert.equal(sha256Hex(fs.readFileSync(asset.filePath)), x.sha256);
  assert.ok(path.resolve(asset.filePath).startsWith(path.resolve(x.dataDir, 'assets') + path.sep), '资产应复制进本机 data/assets');

  // 已保存到工程文件
  const persisted = JSON.parse(fs.readFileSync(path.join(x.dataDir, 'projects', x.project.id + '.json'), 'utf8'));
  assert.equal(persisted.pages[0].panels[0].imageAssetId, outcome.assetId);

  const journal = readApplyJournal(x.dataDir);
  const entry = journal.entries['task_apply_1:' + x.sha256];
  assert.ok(entry, 'apply-journal 必须有记录');
  assert.equal(entry.status, 'applied');
  assert.equal(entry.assetId, outcome.assetId);

  // 同 taskId+sha256 再次调用：duplicate，不会再复制资产/重复候选
  const assetsBefore = x.store.db.assets.length;
  const candidatesBefore = x.currentPanel().candidates.length;
  const repeat = applyCollabResult({store: x.store, dataDir: x.dataDir, projectId: x.project.id, panelId: x.panel.id, taskId: 'task_apply_1', filePath: x.resultFile, sha256: x.sha256, expected, mode: 'auto'});
  assert.equal(repeat.status, 'applied');
  assert.equal(repeat.duplicate, true);
  assert.equal(repeat.assetId, outcome.assetId);
  assert.equal(x.store.db.assets.length, assetsBefore);
  assert.equal(x.currentPanel().candidates.length, candidatesBefore);
});

test('提示词/几何/版本被修改 → conflict：不覆盖画面，结果进候选；force 才写入并保留候选', t => {
  const x = setup(t);
  const expected = x.expected();
  // 模拟用户在等待结果期间编辑了画格
  const project = x.currentProject();
  const panel = x.currentPanel();
  project.shots.find(shot => shot.id === panel.shotId).description = '用户在等待期间更新的分镜表内容';
  panel.x += 9;
  project.revision += 1;
  project.updated = new Date().toISOString();
  x.store.markProject?.(project);
  x.store.save();

  const outcome = applyCollabResult({store: x.store, dataDir: x.dataDir, projectId: x.project.id, panelId: x.panel.id, taskId: 'task_conflict_1', filePath: x.resultFile, sha256: x.sha256, expected, mode: 'auto'});
  assert.equal(outcome.status, 'conflict');
  assert.ok(outcome.mismatches.includes('revision'));
  assert.ok(outcome.mismatches.includes('panelContentKey'));
  assert.ok(outcome.mismatches.includes('geometryKey'));
  assert.ok(outcome.assetId, '冲突结果也要登记资产');
  const afterConflict = x.currentPanel();
  assert.equal(afterConflict.imageAssetId, null, '冲突时绝不能覆盖当前画面');
  assert.ok(afterConflict.candidates.includes(outcome.assetId), '冲突结果必须保留为候选');
  assert.equal(readApplyJournal(x.dataDir).entries['task_conflict_1:' + x.sha256]?.status, 'conflict');

  const forced = applyCollabResult({store: x.store, dataDir: x.dataDir, projectId: x.project.id, panelId: x.panel.id, taskId: 'task_conflict_1', filePath: x.resultFile, sha256: x.sha256, expected, mode: 'force'});
  assert.equal(forced.status, 'applied');
  assert.equal(forced.forced, true);
  assert.ok(forced.mismatches.length > 0, 'force 时也记录当时的版本差异');
  assert.equal(x.currentPanel().imageAssetId, forced.assetId);
  const journal = readApplyJournal(x.dataDir);
  assert.equal(journal.entries['task_conflict_1:' + x.sha256]?.status, 'applied');
});

test('candidate 模式只加候选、不动当前画面；参考绑定变化也算冲突', t => {
  const x = setup(t, {withReference: true});
  const expected = x.expected();
  assert.ok(expected.referenceKey.includes('角色甲'));
  const project = x.currentProject();
  const panel = x.currentPanel();
  panel.referenceIds = [];
  panel.generation.referenceRoles = [];
  x.store.markProject?.(project);
  x.store.save();

  const outcome = applyCollabResult({store: x.store, dataDir: x.dataDir, projectId: x.project.id, panelId: panel.id, taskId: 'task_candidate_1', filePath: x.resultFile, sha256: x.sha256, expected, mode: 'candidate'});
  assert.equal(outcome.status, 'candidate');
  assert.ok(outcome.mismatches.includes('referenceKey'), '参考绑定变化必须被识别');
  assert.equal(x.currentPanel().imageAssetId, null);
  assert.ok(x.currentPanel().candidates.includes(outcome.assetId));

  const conflict = applyCollabResult({store: x.store, dataDir: x.dataDir, projectId: x.project.id, panelId: panel.id, taskId: 'task_candidate_2', filePath: x.resultFile, sha256: x.sha256, expected, mode: 'auto'});
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.mismatches.includes('referenceKey'));
  assert.equal(x.currentPanel().imageAssetId, null);
});

test('apply-journal 崩溃恢复：已写 applying 的继续回填；损坏的 journal 不阻塞；sha 不一致拒绝', t => {
  const x = setup(t);
  const journalFile = applyJournalFile(x.dataDir);
  fs.mkdirSync(path.dirname(journalFile), {recursive: true});
  fs.writeFileSync(journalFile, JSON.stringify({version: 1, entries: {['task_crash_1:' + x.sha256]: {status: 'applying', taskId: 'task_crash_1', sha256: x.sha256, at: new Date().toISOString()}}}));
  const recovered = applyCollabResult({store: x.store, dataDir: x.dataDir, projectId: x.project.id, panelId: x.panel.id, taskId: 'task_crash_1', filePath: x.resultFile, sha256: x.sha256, expected: x.expected(), mode: 'auto'});
  assert.equal(recovered.status, 'applied');
  assert.equal(recovered.duplicate, false);
  assert.equal(readApplyJournal(x.dataDir).entries['task_crash_1:' + x.sha256]?.status, 'applied');

  // 损坏的 journal：重新初始化为空日志，不阻塞回填
  fs.writeFileSync(journalFile, '{这不是 JSON');
  const another = applyCollabResult({store: x.store, dataDir: x.dataDir, projectId: x.project.id, panelId: x.panel.id, taskId: 'task_crash_2', filePath: x.resultFile, sha256: x.sha256, expected: x.expected(), mode: 'auto'});
  assert.equal(another.status, 'applied');
  assert.ok(JSON.parse(fs.readFileSync(journalFile, 'utf8')).entries['task_crash_2:' + x.sha256]);

  assert.throws(() => applyCollabResult({store: x.store, dataDir: x.dataDir, projectId: x.project.id, panelId: x.panel.id, taskId: 'task_bad_sha', filePath: x.resultFile, sha256: '0'.repeat(64), expected: x.expected(), mode: 'auto'}), /SHA-256/);
});
