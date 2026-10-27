import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createProject, makePage} from '../../public/model.js';
import {buildReflowProject, mergeReflowIntoOriginal} from '../../public/auto-layout-reflow.mjs';
import {createScreenReflow} from '../../lib/screen-reflow.mjs';

function fixture() {
  const original = createProject('合成双话工程');
  const firstPage = original.pages[0], firstShot = original.shots[0], firstPanel = firstPage.panels[0];
  firstPage.storyboard = {episode: 1};
  Object.assign(firstPanel, {x: 40, y: 40, w: 600, h: 800, imageAssetId: 'asset-first',
    imageTransform: {x: 12, y: 20, scale: 1, rotation: 0, flipX: false, flipY: false}});
  firstShot.productionGridId = 'grid-1';
  firstPage.bubbles.push({id: 'bubble-original', parentPanelId: firstPanel.id, shotId: firstShot.id,
    productionGridId: 'grid-1', productionTextId: 'text-1', text: '原文不改', speaker: '角色甲',
    x: 80, y: 90, w: 180, h: 120, fontSize: 30, visible: true, tail: {visible: false}});
  const secondShot = {...structuredClone(firstShot), id: 'shot-second', productionGridId: 'grid-2'};
  const secondPage = makePage([secondShot.id], null, 1280, 1200);
  secondPage.storyboard = {episode: 2};
  secondPage.panels[0].imageAssetId = 'asset-second';
  original.shots.push(secondShot);
  original.pages.push(secondPage);
  original.productionPackage = {episodes: [
    {episode: 1, texts: [{'格ID': 'grid-1', '文字ID': 'text-1', '文本': '原文不改', '渲染': '工具'}]},
    {episode: 2, texts: []}
  ]};
  const script = {id: 'script-1', title: '第1话', episode: 1, source: {type: 'synthetic'},
    shots: [{key: 'grid-1', code: 'grid-1', title: '格1', description: '画面', dialogue: ''}]};
  const geometry = {format: 'comic-layout-geometry', version: 1, canvas: {width: 1280, height: 1200},
    sourcePanelKeys: ['grid-1'], panels: [{key: 'grid-1', sourceShotCode: 'grid-1', readingOrder: 1,
      x: 50, y: 60, w: 600, h: 800, shape: 'rectangle'}],
    backgrounds: [{x: 0, y: 0, w: 1280, h: 1200, color: '#ffffff', mode: 'solid'}]};
  const item = {key: 'grid-1', segmentId: 'segment-1', rootPanelId: firstPanel.id,
    sourcePanelId: firstPanel.id, sourceAssetId: 'asset-first', sourceHash: 'source-sha',
    existingPanelId: firstPanel.id, existingAssetId: 'asset-first', preserveCurrentView: true,
    asset: {id: 'asset-first', width: 600, height: 800}, width: 600, height: 800,
    sourceWidth: 600, sourceHeight: 800, sha256: 'crop-sha', recordId: 'record-1', cropKey: 'crop-1',
    pixels: {x: 0, y: 0, w: 600, h: 800}, region: {x: 0, y: 0, w: 1, h: 1}};
  return {original, firstPage, secondPage, script, geometry, item};
}

test('成图重排接回只替换目标话，保留原画、台词和其他话', () => {
  const {original, firstPage, secondPage, script, geometry, item} = fixture();
  const before = structuredClone(original);
  const derived = buildReflowProject({original, script, geometry, items: [item], batchId: 'batch-1'});
  const result = mergeReflowIntoOriginal(original, derived, 1);
  assert.deepEqual(original, before, '生成候选不能修改原工程');
  assert.equal(result.id, original.id);
  assert.deepEqual(result.pages.find(page => page.id === secondPage.id), secondPage, '其他话的画板不应改变');
  const page = result.pages.find(page => page.storyboard?.episode === 1);
  const reused = page.panels.find(panel => panel.visible !== false && panel.panelSlice?.panelId === 'grid-1');
  const archived = page.panels.find(panel => panel.id === firstPage.panels[0].id);
  assert.equal(reused.imageAssetId, 'asset-first');
  assert.equal(reused.autoLayoutCrop.imageSha256, 'crop-sha');
  assert.equal(reused.autoLayoutCrop.fit, 'preserve-current-view');
  assert.equal(archived.visible, false);
  assert.equal(archived.imageAssetId, 'asset-first');
  const text = page.bubbles.find(bubble => bubble.visible !== false);
  assert.equal(text.text, '原文不改');
  assert.equal(text.speaker, '角色甲');
  assert.equal(text.parentPanelId, reused.id);
  assert.equal(result.episodeReflows[1].imageGenerationDisabled, true);
});

test('裁图尺寸或冻结排版规则不一致时拒绝接回', () => {
  const {original, script, geometry, item} = fixture();
  assert.throws(() => buildReflowProject({original, script, geometry, items: [{...item, width: 599}], batchId: 'batch'}), /裁图尺寸不一致/);
  const frozenScript = {...script, layoutRuleContract: {digest: 'expected'}};
  assert.throws(() => buildReflowProject({original, script: frozenScript, geometry: {...geometry, layoutRuleDigest: 'different'}, items: [item], batchId: 'batch'}), /排版规则与冻结版本不一致/);
});

test('接回旧重排工程时检查并发版本及任务，失败不覆盖，成功保留备份', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflow-preservation-'));
  t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); fs.rmSync(dir, {recursive: true, force: true}); });
  const {original, secondPage, script, geometry, item} = fixture();
  const derived = buildReflowProject({original, script, geometry, items: [item], batchId: 'batch-1'});
  const store = {db: {projects: [original, derived], jobs: [], assets: []}, lastSaveError: null,
    project(id) { const value = this.db.projects.find(p => p.id === id); if (!value) throw Error('工程不存在'); return value; },
    save() { this.lastSaveError = null; }};
  let failSave = false;
  const service = createScreenReflow({store, dataDir: dir, body: async req => req.input,
    json: (res, status, value) => Object.assign(res, {status, value}), request: async () => { throw Error('意外请求排版服务'); },
    addAsset: () => { throw Error('接回不应新增资产'); }, validateProject: () => {}, checkAssets: () => {},
    saveProject: value => { if (failSave) { store.lastSaveError = '合成写盘失败'; return value; } value.revision++; return value; }});
  const submit = () => service.handle({input: {projectId: derived.id, expectedRevision: derived.revision}}, {},
    {pathname: '/api/auto-layout/reflow/merge-existing', method: 'POST'});
  const before = structuredClone(original);
  original.revision++;
  await assert.rejects(submit(), /来源工程在重排后已有修改/);
  original.revision--;
  store.db.jobs.push({projectId: original.id, status: 'running'});
  await assert.rejects(submit(), /仍有任务/);
  store.db.jobs.length = 0;
  failSave = true;
  await assert.rejects(submit(), /合成写盘失败/);
  assert.deepEqual(store.project(original.id), before);
  assert.equal(derived.deletedAt, undefined);
  failSave = false;
  const res = {};
  await service.handle({input: {projectId: derived.id, expectedRevision: derived.revision}}, res,
    {pathname: '/api/auto-layout/reflow/merge-existing', method: 'POST'});
  assert.equal(res.status, 200);
  assert.equal(res.value.id, original.id);
  assert.deepEqual(res.value.pages.find(page => page.id === secondPage.id), secondPage);
  assert.ok(derived.deletedAt, '接回后重排工程进入回收状态');
  const backup = path.join(dir, 'backups', original.id + '_before_reflow_merge_' + before.revision + '.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, 'utf8')), before);
});
