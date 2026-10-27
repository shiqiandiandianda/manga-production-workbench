import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {ensurePrimaryPublisher, isPrimaryInstallation} from '../master-startup.mjs';
import {existingCanvasHub} from '../publisher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const proof = path.join(root, 'runtime-data/verification/team-startup');
fs.mkdirSync(proof, {recursive: true});
function fixture(primary = true) {
  const dir = fs.mkdtempSync(path.join(proof, 'unit-'));
  if (primary) put(dir, 'runtime-data/distribution/master/master.local.json', {privateKey: 'synthetic-private-key', publicKey: 'synthetic-public-key'});
  return dir;
}
function put(dir, name, value) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value));
}
async function listen(server, port = 0) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server.address().port;
}
function serverFor(t, value) {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value())); });
  t.after(async () => { server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); });
  return server;
}

test('同事包缺少主版本私钥时只做客户端，不启动发布服务', async () => {
  const dir = fixture(false);
  assert.equal(isPrimaryInstallation(dir), false);
  assert.equal(await ensurePrimaryPublisher(dir, {launch() { assert.fail('同事端不得启动主版本'); }}), null);
  put(dir, 'runtime-data/distribution/master/master.local.json', {publicKey: 'incomplete'});
  assert.throws(() => isPrimaryInstallation(dir), /身份文件不完整/);
});

test('主版本启动器自动带起发布服务并等待正确实例就绪', async t => {
  const dir = fixture(), temporary = http.createServer();
  const port = await listen(temporary);
  await new Promise(resolve => temporary.close(resolve));
  const server = serverFor(t, () => ({application: 'comic-team-publisher', root: dir}));
  let count = 0;
  const result = await ensurePrimaryPublisher(dir, {port, timeout: 3000,
    async launch(name, file, args) {
      count++;
      assert.equal(name, 'publisher');
      assert.equal(file, 'distribution/launch-master.mjs');
      assert.deepEqual(args, [dir, '--port', String(port), '--hub-port', '18897', '--comic-port', '18909']);
      await listen(server, port);
      return {exitCode: null};
    }});
  assert.equal(count, 1);
  assert.equal(result.reused, false);
  assert.equal(result.health.root, dir);
});

test('只复用同目录发布实例，拒绝占用端口的其他工具', async t => {
  const dir = fixture();
  let health = {application: 'comic-team-publisher', root: dir};
  const server = serverFor(t, () => health), port = await listen(server);
  const launch = () => assert.fail('端口已使用不得再启动');
  assert.equal((await ensurePrimaryPublisher(dir, {port, launch})).reused, true);
  health = {application: 'comic-team-publisher', root: fixture()};
  await assert.rejects(() => ensurePrimaryPublisher(dir, {port, launch}), /另一套服务/);
  health = {application: 'unrelated-service', root: dir};
  await assert.rejects(() => ensurePrimaryPublisher(dir, {port, launch}), /另一套服务/);
});

test('发布进程异常退出时明确报错，不一直等待连接', async t => {
  const dir = fixture(), server = serverFor(t, () => ({}));
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(() => ensurePrimaryPublisher(dir, {port, timeout: 3000, launch: () => ({exitCode: 1})}), /publisher.log/);
});

function savedHub(dir, hubUrl) {
  const dataRoot = path.join(dir, 'runtime-data/comic');
  put(dir, 'runtime-data/comic/collab/client-config.json', {hubUrl, token: 'synthetic-token', enabled: true});
  return async url => {
    if (url.endsWith(':18909/api/health')) return Response.json({application: 'comic-merged-studio', dataRoot});
    throw new TypeError('fetch failed');
  };
}

test('停掉的本机自有中控可以按持久化身份恢复，原配置不变', async () => {
  const dir = fixture(), request = savedHub(dir, 'http://127.0.0.1:18897');
  await assert.rejects(() => existingCanvasHub({root: dir, request}), /未创建第二套中控/);
  put(dir, 'runtime-data/distribution/master/canvas-hub/hub-state.json', {hubId: 'synthetic-hub', tasks: []});
  const file = path.join(dir, 'runtime-data/comic/collab/client-config.json'), before = fs.readFileSync(file, 'utf8');
  assert.equal(await existingCanvasHub({root: dir, request}), null);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'runtime-data/distribution/master/canvas-hub/hub-state.json'))).hubId, 'synthetic-hub');
  await assert.rejects(() => existingCanvasHub({root: dir, request, hubPort: 18898}), /未创建第二套中控/);
});

test('远程中控掉线不能新建替代中控，错误协议也不能接管', async () => {
  const dir = fixture();
  put(dir, 'runtime-data/distribution/master/canvas-hub/hub-state.json', {hubId: 'synthetic-hub'});
  await assert.rejects(() => existingCanvasHub({root: dir, request: savedHub(dir, 'http://192.0.2.1:18897')}), /未创建第二套中控/);
  const offline = savedHub(dir, 'http://127.0.0.1:18897');
  await assert.rejects(() => existingCanvasHub({root: dir, request: url => url.includes(':18909/') ? offline(url) : Promise.resolve(Response.json({application: 'foreign-service'}))}), /协议不匹配/);
});

test('已有正确中控继续复用，配对令牌仅交给原中控', async () => {
  const dir = fixture(), offline = savedHub(dir, 'http://127.0.0.1:18897');
  const adapter = await existingCanvasHub({root: dir, request: async (url, options) => {
    if (url.includes(':18909/')) return offline(url);
    assert.equal(new URL(url).origin, 'http://127.0.0.1:18897');
    if (url.endsWith('/api/admin/pairing')) {
      assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
      return Response.json({pairingCode: 'SYNTHETIC'});
    }
    return Response.json({application: 'photocraft-collab-hub'});
  }});
  assert.deepEqual(await adapter.pairing(), {hubUrl: 'http://127.0.0.1:18897', pairingCode: 'SYNTHETIC'});
});
