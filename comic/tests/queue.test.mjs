import {createProject as fixtureProject} from '../public/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';

// A real, tiny PNG used only by the fake bridge in isolated test data directories.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.runtime', 'temp');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const connected = {connected:true, imageFeature:true, needsLogin:false, connectionState:'connected'};

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return {promise, resolve, reject};
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await delay(10);
  }
  throw new Error(message);
}

function gatedBridge({blockStatus=false, status=connected}={}) {
  const statusGate = deferred(), calls = [];
  if (!blockStatus) statusGate.resolve();
  let statusCalls = 0, active = 0, peak = 0, drain = false, closeCalls = 0;
  return {
    calls,
    get statusCalls() { return statusCalls; },
    get active() { return active; },
    get peak() { return peak; },
    get closeCalls() { return closeCalls; },
    releaseStatus() { statusGate.resolve(); },
    releaseAll() {
      drain = true;
      statusGate.resolve();
      for (const call of calls) call.release();
    },
    close() { closeCalls++; this.releaseAll(); },
    async status() {
      statusCalls++;
      await statusGate.promise;
      return {...status};
    },
    async generate(directory, input, refs, {signal, onProgress}={}) {
      const gate = deferred();
      const call = {directory, input, refs, signal, release:gate.resolve};
      calls.push(call);
      active++;
      peak = Math.max(peak, active);
      const abort = () => gate.reject(Object.assign(new Error('本测试任务已取消'), {name:'AbortError', code:'COMIC_CANCELLED'}));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, {once:true});
      onProgress?.('测试桥接正在等待独立门闩');
      if (drain) gate.resolve();
      try {
        await gate.promise;
        return {bytes:png, imageToolSeen:true, description:'队列测试专用输出'};
      } finally {
        signal?.removeEventListener('abort', abort);
        active--;
      }
    }
  };
}

async function fixture(t, bridge=gatedBridge(), options={}) {
  fs.mkdirSync(testRoot, {recursive:true});
  const directory = fs.mkdtempSync(path.join(testRoot, 'queue-tests-'));
  const studio = createStudio({dataDir:directory, bridge, maxConcurrent:2, seedReference:false, ...options});
  const seeded=fixtureProject('隔离回归样本',true);
  if(options.maxConcurrent>=4){const extra=fixtureProject('隔离回归第二组',true);seeded.shots.push(...extra.shots);seeded.pages.push(...extra.pages);}
  studio.store.db.projects.push(seeded);studio.store.save();
  t.after(async () => {
    // Release all pending status requests and generation gates before shutting down.
    bridge.releaseAll();
    const closed = studio.server.listening ? new Promise(resolve => studio.server.once('close', resolve)) : Promise.resolve();
    await studio.close();
    await closed;
    await waitFor(() => studio.idle(), '关闭 fixture 后仍有生图任务未退出');
    const absolute = path.resolve(directory);
    assert.ok(absolute.startsWith(testRoot + path.sep) && path.basename(absolute).startsWith('queue-tests-'));
    fs.rmSync(absolute, {recursive:true, force:true});
  });
  await new Promise(resolve => studio.server.listen(0, '127.0.0.1', resolve));
  return {studio, bridge, url:'http://127.0.0.1:' + studio.server.address().port};
}

async function request(url, route, method='GET', data) {
  const response = await fetch(url + route, {
    method,
    headers:data === undefined ? {} : {'Content-Type':'application/json'},
    body:data === undefined ? undefined : JSON.stringify(data)
  });
  return {status:response.status, data:await response.json()};
}

async function projectAt(url) {
  const {data} = await request(url, '/api/state');
  const project = data.projects[0];
  const panels = project.pages.flatMap(page => page.panels);
  assert.ok(panels.length >= 4, '默认示例工程应提供至少四个镜头供队列测试');
  return {project, panels};
}

async function stateAt(url) {
  return (await request(url, '/api/state')).data;
}

async function completed(url) {
  return waitFor(async () => {
    const state = await stateAt(url);
    return state.jobs.every(job => !['queued', 'running'].includes(job.status)) && state;
  }, '测试队列未完成');
}

test('默认同时运行两个格子，第三格等待；释放一个位置后继续生成', async t => {
  const {url, bridge} = await fixture(t);
  const {project, panels} = await projectAt(url);
  const submitted = await request(url, '/api/jobs', 'POST', {projectId:project.id, panelIds:panels.slice(0, 3).map(panel => panel.id)});
  assert.equal(submitted.status, 202);
  await waitFor(() => bridge.calls.length === 2, '两个独立格子没有同时进入生图');
  const state = await stateAt(url);
  assert.deepEqual(state.jobs.map(job => job.status), ['running', 'running', 'queued']);
  assert.deepEqual(state.scheduler, {concurrency:2, active:2, queued:1, episodeBatches:[]});
  assert.equal(bridge.active, 2);

  bridge.calls[0].release();
  await waitFor(() => bridge.calls.length === 3, '完成一格后没有启动等待中的第三格');
  const resumed = await stateAt(url);
  assert.deepEqual(resumed.jobs.map(job => job.status), ['done', 'running', 'running']);
  assert.deepEqual(resumed.scheduler, {concurrency:2, active:2, queued:0, episodeBatches:[]});
  assert.equal(bridge.peak, 2);
  bridge.releaseAll();
  assert.deepEqual((await completed(url)).jobs.map(job => job.status), ['done', 'done', 'done']);
});

test('取消一个运行格只触发它的 AbortSignal，并立即让等待格使用空位置', async t => {
  const {url, bridge} = await fixture(t);
  const {project, panels} = await projectAt(url);
  const submitted = await request(url, '/api/jobs', 'POST', {projectId:project.id, panelIds:panels.slice(0, 3).map(panel => panel.id)});
  assert.equal(submitted.status, 202);
  await waitFor(() => bridge.calls.length === 2, '取消测试需要两个同时运行的格子');
  const [first, sibling] = bridge.calls;
  assert.ok(first.signal instanceof AbortSignal);
  assert.ok(sibling.signal instanceof AbortSignal);
  const cancelled = await request(url, '/api/jobs/' + submitted.data[0].id + '/cancel', 'POST', {});
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.status, 'cancelled');
  await waitFor(() => bridge.calls.length === 3, '取消运行格后等待格没有开始');
  assert.equal(first.signal.aborted, true);
  assert.equal(sibling.signal.aborted, false);
  assert.equal(bridge.calls[2].signal.aborted, false);
  assert.equal(bridge.active, 2);
  assert.equal(bridge.peak, 2);
  const activeState = await stateAt(url);
  assert.deepEqual(activeState.jobs.map(job => job.status), ['cancelled', 'running', 'running']);

  bridge.releaseAll();
  const finished = await completed(url);
  assert.deepEqual(finished.jobs.map(job => job.status), ['cancelled', 'done', 'done']);
  const current = finished.projects[0].pages.flatMap(page => page.panels);
  assert.equal(current.find(panel => panel.id === panels[0].id).imageAssetId, null);
  assert.ok(current.find(panel => panel.id === panels[1].id).imageAssetId);
  assert.ok(current.find(panel => panel.id === panels[2].id).imageAssetId);
  assert.equal(finished.assets.length, 2);
});

test('运行和等待中的同格都拒绝重复生成，含重复格子的批次也不会部分入队', async t => {
  const {url, bridge} = await fixture(t);
  const {project, panels} = await projectAt(url);
  assert.equal((await request(url, '/api/jobs', 'POST', {projectId:project.id, panelIds:panels.slice(0, 3).map(panel => panel.id)})).status, 202);
  await waitFor(() => bridge.calls.length === 2, '重复测试需要先建立正在运行和等待的任务');
  for (const panel of [panels[0], panels[2]]) {
    assert.equal((await request(url, '/api/jobs', 'POST', {projectId:project.id, panelIds:[panel.id]})).status, 409);
  }
  assert.equal((await request(url, '/api/jobs', 'POST', {projectId:project.id, panelIds:[panels[0].id, panels[3].id]})).status, 409);
  const state = await stateAt(url);
  assert.equal(state.jobs.length, 3);
  assert.equal(bridge.calls.length, 2);
  assert.equal(state.projects[0].pages.flatMap(page => page.panels).find(panel => panel.id === panels[3].id).generationToken, null);
  bridge.releaseAll();
  assert.equal((await completed(url)).jobs.filter(job => job.status === 'done').length, 3);
});

test('两个同格 POST 在连接检查门闩处竞争时，只有一个能建立任务', async t => {
  const bridge = gatedBridge({blockStatus:true});
  const {url} = await fixture(t, bridge);
  const {project, panels} = await projectAt(url);
  const payload = {projectId:project.id, panelIds:[panels[0].id]};
  const requests = [request(url, '/api/jobs', 'POST', payload), request(url, '/api/jobs', 'POST', payload)];
  await waitFor(() => bridge.statusCalls === 2, '两个请求没有同时到达连接检查');
  assert.equal((await stateAt(url)).jobs.length, 0);
  bridge.releaseStatus();
  const results = await Promise.all(requests);
  assert.deepEqual(results.map(result => result.status).sort(), [202, 409]);
  await waitFor(() => bridge.calls.length === 1, '获准请求没有开始生图');
  assert.equal((await stateAt(url)).jobs.length, 1);
  bridge.releaseAll();
  assert.equal((await completed(url)).jobs.filter(job => job.status === 'done').length, 1);
});

test('已登录但连接暂时失败时返回实际错误，且不建立任务', async t => {
  const message = '官方服务暂时无法连接，请稍后重试';
  const bridge = gatedBridge({status:{connected:false, imageFeature:true, needsLogin:false, connectionState:'temporary_failure', message}});
  const {url} = await fixture(t, bridge);
  const {project, panels} = await projectAt(url);
  const connection = await request(url, '/api/codex/status');
  assert.equal(connection.data.needsLogin, false);
  assert.equal(connection.data.connectionState, 'temporary_failure');
  const result = await request(url, '/api/jobs', 'POST', {projectId:project.id, panelIds:[panels[0].id]});
  assert.equal(result.status, 409);
  assert.equal(result.data.error, message);
  assert.doesNotMatch(result.data.error, /登录/);
  assert.equal((await stateAt(url)).jobs.length, 0);
  assert.equal(bridge.calls.length, 0);
});


for (const concurrency of [1, 3, 6]) {
  test('maxConcurrent=' + concurrency + ' 精确限制同时生图的数量', async t => {
    const {url, bridge} = await fixture(t, gatedBridge(), {maxConcurrent:concurrency});
    const {project, panels} = await projectAt(url);
    const total=Math.max(4,concurrency+1);
    const result = await request(url, '/api/jobs', 'POST', {projectId:project.id, panelIds:panels.slice(0, total).map(panel => panel.id)});
    assert.equal(result.status, 202);
    await waitFor(() => bridge.calls.length === concurrency, '指定并行数量没有生效');
    const state = await stateAt(url);
    assert.equal(state.jobs.filter(job => job.status === 'running').length, concurrency);
    assert.equal(state.jobs.filter(job => job.status === 'queued').length, total - concurrency);
    assert.deepEqual(state.scheduler, {concurrency, active:concurrency, queued:total - concurrency, episodeBatches:[]});
    bridge.calls[0].release();
    await waitFor(() => bridge.calls.length === concurrency + 1, '指定并行队列没有补充等待任务');
    assert.equal(bridge.peak, concurrency);
    bridge.releaseAll();
    assert.equal((await completed(url)).jobs.filter(job => job.status === 'done').length, total);
    assert.equal(bridge.peak, concurrency);
  });
}

test('并行结果反向到达后保留在正确格子的候选，生成期间的轮廓编辑优先', async t => {
  const {url, bridge} = await fixture(t);
  const {project, panels} = await projectAt(url);
  const submitted = await request(url, '/api/jobs', 'POST', {projectId:project.id, panelIds:panels.slice(0, 2).map(panel => panel.id)});
  assert.equal(submitted.status, 202);
  await waitFor(() => bridge.calls.length === 2, '镜头映射测试需要同时运行的两个格子');
  const editing = (await stateAt(url)).projects[0];
  const editedPanels = editing.pages.flatMap(page => page.panels);
  editedPanels.find(panel => panel.id === panels[0].id).points[1].x = .72;
  editedPanels.find(panel => panel.id === panels[1].id).points[1].x = .83;
  assert.equal((await request(url, '/api/projects/' + project.id, 'PUT', editing)).status, 200);

  bridge.calls[1].release();
  const secondDone = await waitFor(async () => {
    const state = await stateAt(url);
    return state.jobs[1].status === 'done' && state;
  }, '第二格结果没有先完成');
  const intermediate = secondDone.projects[0].pages.flatMap(page => page.panels);
  assert.equal(secondDone.jobs[0].status, 'running');
  assert.equal(intermediate.find(panel => panel.id === panels[0].id).imageAssetId, null);
  assert.equal(intermediate.find(panel => panel.id === panels[1].id).imageAssetId, null);
  assert.equal(secondDone.jobs[1].applied, false);
  assert.deepEqual(intermediate.find(panel => panel.id === panels[1].id).candidates, [secondDone.jobs[1].assetId]);

  bridge.calls[0].release();
  const finished = await completed(url);
  const current = finished.projects[0].pages.flatMap(page => page.panels);
  assert.notEqual(finished.jobs[0].assetId, finished.jobs[1].assetId);
  for (const [index, expectedX] of [[0, .72], [1, .83]]) {
    const panel = current.find(panel => panel.id === panels[index].id);
    assert.equal(panel.imageAssetId, null);
    assert.equal(finished.jobs[index].applied, false);
    assert.deepEqual(panel.candidates, [finished.jobs[index].assetId]);
    assert.equal(panel.points[1].x, expectedX);
  }
});


test('连接检查等待期间工程保存后，旧 expectedRevision 不得建立任务', async t => {
  const bridge = gatedBridge({blockStatus:true});
  const {url} = await fixture(t, bridge);
  const {project, panels} = await projectAt(url);
  const pending = request(url, '/api/jobs', 'POST', {projectId:project.id, panelIds:[panels[0].id], expectedRevision:project.revision});
  await waitFor(() => bridge.statusCalls === 1, '生成请求没有停在连接检查');
  const editing = (await stateAt(url)).projects[0];
  editing.pages[0].panels[0].points[1].x = .76;
  const saved = await request(url, '/api/projects/' + project.id, 'PUT', editing);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.revision, project.revision + 1);
  bridge.releaseStatus();
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal((await stateAt(url)).jobs.length, 0);
  assert.equal(bridge.calls.length, 0);
});

