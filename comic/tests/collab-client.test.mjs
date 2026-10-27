// 协作客户端测试（协议 §7.2/§7.3/§8.2/§9/§10）：用内置 http 假中控驱动真实 createStudio，
// 覆盖配对/配置、prepare 与 /api/jobs 输入同构、distribute 幂等、自动回填、冲突上报与 apply-choice、
// 本地通知、资产按需下载、关闭后无定时器残留。全部离线，不调用真实 AI/网络。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createComicFixture, makePng, seedProject, sha256Hex, sleep, startFakeHub, waitFor} from './helpers/collab-fixture.mjs';

function prepareEnvironment(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comic-collab-client-'));
  const configPath = path.join(root, 'client-config.json');
  const previous = {COLLAB_CLIENT_CONFIG: process.env.COLLAB_CLIENT_CONFIG, COLLAB_POLL_MS: process.env.COLLAB_POLL_MS};
  process.env.COLLAB_CLIENT_CONFIG = configPath;
  process.env.COLLAB_POLL_MS = '40';
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, {recursive: true, force: true});
  });
  return {root, configPath};
}

async function pair(fixture, hub, clientName = 'A电脑') {
  const response = await fixture.api('/api/collab/pair', 'POST', {hubUrl: hub.origin, pairingCode: 'PAIR01', clientName});
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value;
}

test('配对保存 token，GET /api/collab/config 不回显；status 可达中控；资产/节点代理与按需下载可用', async t => {
  const {root, configPath} = prepareEnvironment(t);
  const hub = await startFakeHub(t);
  const fixture = await createComicFixture(t, {directory: root});
  assert.equal(fixture.studio.collabClient.pollTimer, null, '未配对时不应创建轮询定时器');

  const paired = await pair(fixture, hub);
  assert.equal(paired.ok, true);
  assert.equal(paired.client.id, 'client_synthetic');
  assert.equal(paired.hub.hubName, '合成协作中控');

  const config = await fixture.api('/api/collab/config');
  assert.equal(config.status, 200);
  assert.equal(config.value.tokenSet, true);
  assert.equal(config.value.configured, true);
  assert.equal(config.value.hubUrl, hub.origin);
  assert.equal(config.value.clientId, 'client_synthetic');
  assert.equal(Object.hasOwn(config.value, 'token'), false, '接口绝不能回显 token');
  assert.ok(fs.existsSync(configPath));
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).token, 'tok_synthetic');

  const updated = await fixture.api('/api/collab/config', 'PUT', {autoApply: false});
  assert.equal(updated.status, 200);
  assert.equal(updated.value.autoApply, false);
  assert.equal((await fixture.api('/api/collab/config', 'PUT', {autoApply: true})).value.autoApply, true);

  const status = await fixture.api('/api/collab/status');
  assert.equal(status.status, 200);
  assert.equal(status.value.configured, true);
  assert.equal(status.value.hubReachable, true);
  assert.equal(status.value.hub.hubName, '合成协作中控');
  assert.equal(status.value.client.id, 'client_synthetic');

  const badPair = await fixture.api('/api/collab/pair', 'POST', {hubUrl: hub.origin, pairingCode: 'WRONG1', clientName: 'A电脑'});
  assert.equal(badPair.status, 401);
  assert.match(String(badPair.value.error), /配对码/);

  // 共享资产：元数据 + 缩略图（中控没有缩略图时回退原图）+ 按需下载并登记本地资产
  const assetBytes = makePng(24, 20, {r: 5, g: 60, b: 170});
  const shared = hub.addAsset({id: 'asset_shared_1', name: '共享角色', kind: 'character', status: 'available', mime: 'image/png', size: assetBytes.length}, assetBytes);
  const list = await fixture.api('/api/collab/assets');
  assert.equal(list.status, 200);
  assert.equal(list.value.total, 1);
  assert.equal(list.value.assets[0].thumbUrl, '/api/collab/assets/asset_shared_1/thumb');
  assert.equal(list.value.assets[0].downloadUrl, '/api/collab/assets/asset_shared_1/download');
  const thumb = await fixture.apiRaw('/api/collab/assets/asset_shared_1/thumb');
  assert.equal(thumb.status, 200);
  assert.deepEqual(thumb.bytes, assetBytes);
  const downloaded = await fixture.api('/api/collab/assets/asset_shared_1/download');
  assert.equal(downloaded.status, 200, JSON.stringify(downloaded.value));
  const localAsset = fixture.studio.store.db.assets.find(asset => asset.id === downloaded.value.assetId);
  assert.ok(localAsset, '下载的原图必须登记为本地资产');
  assert.equal(localAsset.source, 'collab-download');
  assert.equal(sha256Hex(fs.readFileSync(localAsset.filePath)), shared.sha256);

  const nodes = await fixture.api('/api/collab/nodes');
  assert.equal(nodes.status, 200);
  assert.equal(nodes.value.nodes[0].name, 'B电脑');

  assert.equal((await fixture.api('/api/collab/notifications?since=0')).status, 200);
});

test('prepare 产出的 generationInput 与 /api/jobs 完全同构，并带 target.expected 与参考图校验信息', async t => {
  const {root} = prepareEnvironment(t);
  const hub = await startFakeHub(t);
  const fixture = await createComicFixture(t, {directory: root});
  await pair(fixture, hub);
  const seed = await seedProject(fixture, {referenceCount: 1});
  const panelId = seed.panels[0].id;

  // 先 prepare：此时画格还没有被本地任务改动，输入快照与 /api/jobs 提交时完全同源。
  const prepared = await fixture.api('/api/collab/prepare', 'POST', {projectId: seed.project.id, panelIds: [panelId]});
  assert.equal(prepared.status, 200, JSON.stringify(prepared.value));

  const jobResponse = await fixture.api('/api/jobs', 'POST', {projectId: seed.project.id, panelIds: [panelId], provider: 'codex'});
  assert.equal(jobResponse.status, 202, JSON.stringify(jobResponse.value));
  await fixture.waitForCalls(1);
  const jobInput = fixture.calls[0].input;

  assert.equal(prepared.value.projectId, seed.project.id);
  assert.equal(prepared.value.panels.length, 1);
  const item = prepared.value.panels[0];
  assert.equal(item.panelId, panelId);
  assert.equal(item.panelCode, 'S01');
  assert.equal(item.style, seed.project.style);
  assert.deepEqual(item.size, {w: Math.round(seed.panels[0].w), h: Math.round(seed.panels[0].h)});
  assert.deepEqual(item.generationInput, jobInput, 'prepare 的 generationInput 必须与现有 /api/jobs 为同一画格组装的 input 完全一致');
  assert.ok(item.generationInput.referenceRoles.length >= 1);
  assert.equal(item.generationInput.action, 'generate');

  const target = item.target;
  assert.equal(target.projectId, seed.project.id);
  assert.equal(target.panelId, panelId);
  assert.equal(target.panelCode, 'S01');
  for (const field of ['revision', 'panelContentKey', 'geometryKey', 'referenceKey']) {
    assert.ok(target.expected[field] !== undefined && target.expected[field] !== null, 'target.expected 缺少 ' + field);
  }

  const reference = item.references[0];
  const referenceAsset = seed.assets[0];
  const referencePath = fs.realpathSync(referenceAsset.filePath);
  assert.equal(reference.role, 'character');
  assert.equal(reference.assetId, referenceAsset.id);
  assert.equal(reference.filePath, referencePath);
  assert.equal(reference.sha256, sha256Hex(fs.readFileSync(referencePath)));
  assert.equal(reference.size, fs.statSync(referencePath).size);
  assert.equal(reference.mime, 'image/png');
});

test('distribute 参考图只上传一次，重复提交同内容不重复建任务，任务载荷符合协议', async t => {
  const {root} = prepareEnvironment(t);
  const hub = await startFakeHub(t);
  const fixture = await createComicFixture(t, {directory: root});
  await pair(fixture, hub);
  const seed = await seedProject(fixture, {referenceCount: 1});

  const first = await fixture.api('/api/collab/distribute', 'POST', {projectId: seed.project.id, panelIds: [seed.panels[0].id]});
  assert.equal(first.status, 200, JSON.stringify(first.value));
  assert.deepEqual(first.value.errors, []);
  assert.equal(first.value.tasks.length, 1);
  const firstTask = first.value.tasks[0];
  assert.ok(firstTask.taskId);
  assert.equal(firstTask.panelId, seed.panels[0].id);
  assert.equal(firstTask.panelCode, 'S01');
  assert.equal(firstTask.duplicate, false);
  assert.equal(hub.taskCount(), 1);

  const hubTask = hub.task(firstTask.taskId);
  assert.equal(hubTask.type, 'panel-generation');
  assert.equal(hubTask.projectId, seed.project.id);
  assert.equal(hubTask.submittedBy, 'client_synthetic');
  assert.equal(hubTask.panelCode, 'S01');
  assert.equal(hubTask.panelId, seed.panels[0].id);
  assert.ok(hubTask.generationInput && typeof hubTask.generationInput === 'object');
  assert.ok(hubTask.target.expected.panelContentKey);
  assert.match(String(hubTask.idempotencyKey), /^[^:]+:[^:]+:[0-9a-f]{16}$/, '幂等键应为 projectId:panelId:目标指纹16位');
  const referencePath = fs.realpathSync(seed.assets[0].filePath);
  assert.equal(hubTask.references.length, 1);
  assert.equal(hubTask.references[0].sha256, sha256Hex(fs.readFileSync(referencePath)));
  assert.equal(hubTask.references[0].role, 'character');
  assert.equal(hubTask.references[0].mime, 'image/png');
  assert.ok(hub.state.blobs.has(hubTask.references[0].sha256), '参考图必须已上传为中控 blob');

  const second = await fixture.api('/api/collab/distribute', 'POST', {projectId: seed.project.id, panelIds: [seed.panels[0].id]});
  assert.equal(second.status, 200);
  assert.equal(second.value.tasks[0].taskId, firstTask.taskId);
  assert.equal(second.value.tasks[0].duplicate, true);
  assert.equal(hub.taskCount(), 1, '同内容重复提交不能重复建任务');
  assert.equal(hub.state.calls.filter(call => call.method === 'PUT' && call.path === '/api/blobs').length, 1, '同一参考图只上传一次');

  const list = await fixture.api('/api/collab/tasks?submittedBy=client_synthetic');
  assert.equal(list.status, 200);
  assert.equal(list.value.total, 1);
  assert.equal(list.value.tasks[0].id, firstTask.taskId);
});

test('轮询 done+pending 任务：下载校验结果→自动回填→上报 applied；结果预览路由与本地通知可用', async t => {
  const {root} = prepareEnvironment(t);
  const hub = await startFakeHub(t);
  const fixture = await createComicFixture(t, {directory: root});
  await pair(fixture, hub);
  const seed = await seedProject(fixture, {referenceCount: 1});
  const distributed = await fixture.api('/api/collab/distribute', 'POST', {projectId: seed.project.id, panelIds: [seed.panels[0].id]});
  const taskId = distributed.value.tasks[0].taskId;
  assert.equal(hub.applyOf(taskId).status, 'pending');

  const resultBytes = makePng(100, 70, {r: 220, g: 40, b: 120});
  hub.setTaskDone(taskId, resultBytes);
  await hub.waitForApply(taskId, 'applied');
  await waitFor(() => hub.taskCount() === 1, '任务丢失');
  const project = fixture.studio.store.project(seed.project.id);
  const panel = project.pages[0].panels[0];
  assert.ok(panel.imageAssetId, '自动回填后画格必须有图片');
  assert.ok(panel.candidates.includes(panel.imageAssetId));
  const localAsset = fixture.studio.store.db.assets.find(asset => asset.id === panel.imageAssetId);
  assert.ok(localAsset && localAsset.source === 'collab');
  assert.equal(sha256Hex(fs.readFileSync(localAsset.filePath)), sha256Hex(resultBytes), '回填的必须是中控返回的那张图');

  const detail = await fixture.api('/api/collab/tasks/' + taskId);
  assert.equal(detail.status, 200);
  assert.equal(detail.value.task.id, taskId);
  assert.equal(detail.value.task.previewUrl, '/api/collab/tasks/' + taskId + '/result');
  const preview = await fixture.apiRaw(detail.value.task.previewUrl);
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.bytes, resultBytes);

  const notifications = await fixture.api('/api/collab/notifications?since=0');
  assert.equal(notifications.status, 200);
  assert.ok(notifications.value.notifications.some(notification => notification.type === 'task.done' && notification.taskId === taskId));
  assert.ok(notifications.value.lastSeq > 0);
  await waitFor(async () => (await fixture.api('/api/collab/status')).value.pendingApply === 0, '回填后 pendingApply 应归零');

  // Lead 决策（问题 #2 方案 A）：结果回填后再次提交同一画格 = 重新生成一张。
  // 幂等键含目标指纹（panelContentKey/geometryKey/referenceKey/revision），回填改变 geometryKey → 新键 → 新建任务。
  const resubmit = await fixture.api('/api/collab/distribute', 'POST', {projectId: seed.project.id, panelIds: [seed.panels[0].id]});
  assert.equal(resubmit.status, 200);
  assert.deepEqual(resubmit.value.errors, [], '回填后再次提交不应出现错误：' + JSON.stringify(resubmit.value.errors));
  assert.equal(resubmit.value.tasks.length, 1);
  assert.equal(resubmit.value.tasks[0].duplicate, false, '回填后再次提交应作为新一次生成');
  assert.notEqual(resubmit.value.tasks[0].taskId, taskId, '回填后应新建任务而不是命中旧任务');
  assert.equal(hub.taskCount(), 2, '回填后再次提交应新建 1 个任务（旧任务仍保留）');
  assert.notEqual(hub.task(resubmit.value.tasks[0].taskId).idempotencyKey, hub.task(taskId).idempotencyKey, '回填后目标指纹变化 → 幂等键必须变化');
});

test('兼容兜底：同幂等键不同 payload（旧任务/极端差异）命中中控 409 时仍回落 duplicate，不新建任务', async t => {
  const {root} = prepareEnvironment(t);
  const hub = await startFakeHub(t);
  const fixture = await createComicFixture(t, {directory: root});
  await pair(fixture, hub);
  const seed = await seedProject(fixture, {referenceCount: 1});
  const first = await fixture.api('/api/collab/distribute', 'POST', {projectId: seed.project.id, panelIds: [seed.panels[0].id]});
  const taskId = first.value.tasks[0].taskId;

  // 只改 generationInput 里的 panel.candidates：panelContentKey/geometryKey/referenceKey/revision 都不变，
  // 目标指纹不变 → 同一幂等键，但请求 payloadHash 变化 → 假中控按真实中控语义返回 409 idempotency_conflict。
  const project = fixture.studio.store.project(seed.project.id);
  const panel = project.pages[0].panels[0];
  panel.candidates = [...(panel.candidates || []), 'asset_00000000-0000-0000-0000-000000000000'];
  fixture.studio.store.markProject?.(project);
  fixture.studio.store.save();

  const again = await fixture.api('/api/collab/distribute', 'POST', {projectId: seed.project.id, panelIds: [seed.panels[0].id]});
  assert.equal(again.status, 200);
  assert.deepEqual(again.value.errors, []);
  assert.equal(again.value.tasks.length, 1);
  assert.equal(again.value.tasks[0].taskId, taskId, '409 兜底应找回原任务');
  assert.equal(again.value.tasks[0].duplicate, true);
  assert.equal(hub.taskCount(), 1, '409 兜底不能新建任务');
});

test('等待期间画格被修改 → 上报 conflict 且不覆盖；apply-choice force 应用、discard 丢弃；非法 choice 400', async t => {
  const {root} = prepareEnvironment(t);
  const hub = await startFakeHub(t);
  const fixture = await createComicFixture(t, {directory: root});
  await pair(fixture, hub);
  const seed = await seedProject(fixture, {referenceCount: 1, panelCount: 2});
  const distributed = await fixture.api('/api/collab/distribute', 'POST', {projectId: seed.project.id, panelIds: seed.panels.map(panel => panel.id)});
  assert.equal(distributed.status, 200);
  assert.equal(distributed.value.tasks.length, 2);
  const [taskA, taskB] = distributed.value.tasks;

  // 模拟用户在中控生成期间修改了工程（revision 与提示词都变化）
  const project = fixture.studio.store.project(seed.project.id);
  project.pages[0].panels[0].generation.prompt = '用户改过的提示词';
  project.revision += 1;
  project.updated = new Date().toISOString();
  fixture.studio.store.markProject?.(project);
  fixture.studio.store.save();

  hub.setTaskDone(taskA.taskId, makePng(60, 60, {r: 10, g: 200, b: 10}));
  hub.setTaskDone(taskB.taskId, makePng(50, 50, {r: 200, g: 10, b: 10}));
  await hub.waitForApply(taskA.taskId, 'conflict');
  await hub.waitForApply(taskB.taskId, 'conflict');

  const afterConflict = fixture.studio.store.project(seed.project.id).pages[0].panels[0];
  assert.equal(afterConflict.imageAssetId, null, '冲突时不能覆盖当前画面');
  assert.ok(afterConflict.candidates.length >= 1, '冲突结果必须保留为候选');
  const conflictNotifications = await fixture.api('/api/collab/notifications?since=0');
  assert.ok(conflictNotifications.value.notifications.some(notification => notification.type === 'task.conflict'));

  const invalid = await fixture.api('/api/collab/tasks/' + taskA.taskId + '/apply-choice', 'POST', {choice: 'whatever'});
  assert.equal(invalid.status, 400);

  const forced = await fixture.api('/api/collab/tasks/' + taskA.taskId + '/apply-choice', 'POST', {choice: 'force'});
  assert.equal(forced.status, 200, JSON.stringify(forced.value));
  assert.equal(forced.value.status, 'applied');
  assert.ok(forced.value.assetId);
  assert.equal(fixture.studio.store.project(seed.project.id).pages[0].panels[0].imageAssetId, forced.value.assetId);
  await hub.waitForApply(taskA.taskId, 'applied');

  const discarded = await fixture.api('/api/collab/tasks/' + taskB.taskId + '/apply-choice', 'POST', {choice: 'discard'});
  assert.equal(discarded.status, 200);
  assert.equal(discarded.value.status, 'skipped');
  await hub.waitForApply(taskB.taskId, 'skipped');
  assert.equal(fixture.studio.store.project(seed.project.id).pages[0].panels[1].imageAssetId, null);
});

test('server.close 会清理轮询定时器，关闭后不再请求中控', async t => {
  const {root} = prepareEnvironment(t);
  const hub = await startFakeHub(t);
  const fixture = await createComicFixture(t, {directory: root});
  await pair(fixture, hub);
  assert.ok(fixture.studio.collabClient.pollTimer, '配对后应启动轮询');

  fixture.studio.close();
  assert.equal(fixture.studio.collabClient.pollTimer, null, 'close 后不能残留定时器');
  await sleep(120);
  const callsAfterClose = hub.state.calls.length;
  await sleep(180);
  assert.equal(hub.state.calls.length, callsAfterClose, '关闭后不应再请求中控');
});

test('中控不可达时返回明确中文错误，原漫画服务接口不受影响', async t => {
  const {root} = prepareEnvironment(t);
  const fixture = await createComicFixture(t, {directory: root});
  // 占一个空闲端口再立刻关掉，得到一个确定没人监听的地址
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const deadPort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));

  const updated = await fixture.api('/api/collab/config', 'PUT', {hubUrl: 'http://127.0.0.1:' + deadPort, token: 'tok_offline', clientId: 'client_offline', enabled: true});
  assert.equal(updated.status, 200);
  assert.equal(updated.value.configured, true);
  assert.equal(updated.value.tokenSet, true);

  const status = await fixture.api('/api/collab/status');
  assert.equal(status.status, 200);
  assert.equal(status.value.hubReachable, false);
  assert.match(String(status.value.lastError), /无法连接|超时/);

  const tasks = await fixture.api('/api/collab/tasks');
  assert.equal(tasks.status, 502);
  assert.match(String(tasks.value.error), /无法连接|超时/);

  // 旧接口完全不受影响
  const health = await fixture.api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.value.application, 'comic-merged-studio');
  assert.equal((await fixture.api('/api/state')).status, 200);
});
