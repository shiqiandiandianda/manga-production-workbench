/**
 * 局域网接单 / 素材接口的端到端测试。
 *
 * 会在临时数据目录里真的把工作台服务跑起来，然后用 HTTP 打一遍：
 * 建令牌 → 提交工单（入库模式，不调用模型）→ 落盘 → 检索 → 取图 → 幂等重复提交。
 * 生成类（mode=generate/workshop）需要 Codex 账号与模型额度，不在自动化测试范围内。
 *
 * 运行：node --test tests/lan-api.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, readFile, writeFile, readdir, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomInt} from 'node:crypto';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** 受限环境下系统临时目录可能不可写，因此优先用工作台自己的 temp 目录。 */
async function makeTemp(prefix) {
  for (const base of [path.join(ROOT, 'data', 'temp'), tmpdir()]) {
    try {
      await mkdir(base, {recursive: true});
      return await mkdtemp(path.join(base, prefix));
    } catch {
      /* 换下一个候选 */
    }
  }
  throw new Error('找不到可写的临时目录。');
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

test('局域网 API：接单、命名落盘、检索与幂等', {timeout: 180_000}, async () => {
  const dataDir = await makeTemp('wb-lan-');
  const port = randomInt(20000, 45000);
  const shareDir = path.join(dataDir, 'share');
  await mkdir(shareDir, {recursive: true});
  await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
    port,
    bindHost: '127.0.0.1',
    destinations: [
      {id: 'local', label: '本机素材库', path: './assets', role: 'primary', enabled: true},
      {id: 'share', label: '共享位置', path: shareDir, role: 'archive', enabled: true}
    ]
  }), 'utf8');

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'main.mjs'), '--no-engines'], {
    cwd: ROOT,
    env: {...process.env, WORKBENCH_DATA_DIR: dataDir, PYTHONDONTWRITEBYTECODE: '1'},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => {
    output += chunk;
  });
  child.stderr.on('data', chunk => {
    output += chunk;
  });

  try {
    const base = `http://127.0.0.1:${port}`;
    assert.ok(await waitFor(`${base}/healthz`), `服务未启动：${output}`);

    // 公开路由：无令牌可用
    const health = await (await fetch(`${base}/api/lan/v1/health`)).json();
    assert.equal(health.ok, true);
    const capabilities = await (await fetch(`${base}/api/lan/v1/capabilities`)).json();
    assert.ok(capabilities.endpoints.submit.includes('/api/lan/v1/jobs'));

    // 未带令牌的局域网调用读取素材必须被拒（本机回环免令牌，故这里只验证路由存在）
    assert.ok((await fetch(`${base}/api/lan/v1/assets`)).ok, '本机回环访问应免令牌');

    // 建令牌（本机回环免令牌）
    const created = await (await fetch(`${base}/api/hub/tokens`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({label: '测试平台', scopes: ['intake', 'read']})
    })).json();
    assert.match(created.token, /^wab_/);
    const auth = {Authorization: `Bearer ${created.token}`, 'Content-Type': 'application/json'};

    // 提交工单：两项不同资产，同名规则由服务端决定
    const payload = {
      vendor: '测试生图平台',
      project: '长夜',
      clientRequestId: 'auto-test-0001',
      items: [
        {mode: 'ingest', type: 'card', character: '李三', outfit: '校服', view: '正面', tags: ['测试'], data: `data:image/png;base64,${PNG}`},
        {mode: 'ingest', type: 'face_core', character: '李三', data: `data:image/png;base64,${PNG}`}
      ]
    };
    const submit = await fetch(`${base}/api/lan/v1/jobs`, {method: 'POST', headers: auth, body: JSON.stringify(payload)});
    assert.equal(submit.status, 202);
    const job = await submit.json();
    assert.ok(job.jobId);

    // 等待作业结束
    let detail = null;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      detail = await (await fetch(`${base}/api/lan/v1/jobs/${job.jobId}`, {headers: auth})).json();
      if (['completed', 'partial', 'failed', 'cancelled'].includes(detail.status)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(detail.status, 'completed', JSON.stringify(detail.items));
    assert.equal(detail.assets.length, 2);

    // 命名规则：{project}/{type}/{character}_{outfit}_{view}_{version}
    const paths = detail.assets.map(asset => asset.relativePath).sort();
    assert.deepEqual(paths, [
      path.join('长夜', 'card', '李三_校服_正面_v1.png'),
      path.join('长夜', 'face_core', '李三_v1.png')
    ]);

    // 两个位置都必须落盘
    for (const asset of detail.assets) {
      assert.equal(asset.copies.length, 2, `${asset.relativePath} 应写到两个位置`);
      for (const copy of asset.copies) {
        assert.ok(existsSync(copy.path), `缺少文件：${copy.path}`);
      }
      assert.equal(asset.width, 1);
      assert.equal(asset.height, 1);
    }

    // 索引与磁盘一致
    const onDisk = await readdir(path.join(dataDir, 'assets', '长夜', 'card'));
    assert.deepEqual(onDisk, ['李三_校服_正面_v1.png']);

    // 检索：按类型、按角色、关键词
    const byType = await (await fetch(`${base}/api/lan/v1/assets?type=card`, {headers: auth})).json();
    assert.equal(byType.total, 1);
    assert.equal(byType.facets.character[0].value, '李三');
    const byKeyword = await (await fetch(`${base}/api/lan/v1/assets?q=${encodeURIComponent('校服')}`, {headers: auth})).json();
    assert.equal(byKeyword.total, 1);

    // 取图内容与登记的哈希一致
    const asset = byType.assets[0];
    // 回归：界面靠 kind=image 才显示缩略图；曾经所有图片都被判成 other
    assert.equal(asset.kind, 'image', `图片素材的 kind 应为 image，实际 ${asset.kind}`);
    // 回归：asset.url 必须是可直接显示的图片地址，asset.self 才是元数据接口
    assert.match(asset.url, /\/file$/, 'asset.url 应指向图片文件');
    const meta = await fetch(`${base}${asset.self}`, {headers: auth});
    assert.ok((meta.headers.get('content-type') || '').includes('json'), 'asset.self 应指向元数据接口');
    const file = await fetch(`${base}${asset.url}`, {headers: auth});
    assert.equal(file.status, 200);
    assert.ok((file.headers.get('content-type') || '').startsWith('image/'), 'asset.url 应返回图片类型');
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(bytes.length, asset.bytes);
    const diskBytes = await readFile(path.join(dataDir, 'assets', asset.relativePath));
    assert.deepEqual(bytes, diskBytes);

    // 界面用的 hub 取图地址也必须能出图
    const hubFile = await fetch(`${base}/api/hub/assets/${asset.assetId}/file`);
    assert.equal(hubFile.status, 200);
    assert.ok((hubFile.headers.get('content-type') || '').startsWith('image/'), 'hub 取图接口应返回图片类型');

    // 按相对路径取图
    const byPath = await fetch(`${base}/api/lan/v1/files?relativePath=${encodeURIComponent(asset.relativePath)}`, {headers: auth});
    assert.equal(byPath.status, 200);

    // 幂等：同一 clientRequestId 返回原作业
    const again = await (await fetch(`${base}/api/lan/v1/jobs`, {method: 'POST', headers: auth, body: JSON.stringify(payload)})).json();
    assert.equal(again.duplicate, true);
    assert.equal(again.jobId, job.jobId);

    // 同名冲突：同样内容再入库一次（无 clientRequestId）应生成 _v2
    const second = await (await fetch(`${base}/api/lan/v1/jobs`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({project: '长夜', items: [{mode: 'ingest', type: 'card', character: '李三', outfit: '校服', view: '正面', data: `data:image/png;base64,${PNG}`}]})
    })).json();
    let secondDetail = null;
    const deadline2 = Date.now() + 30_000;
    while (Date.now() < deadline2) {
      secondDetail = await (await fetch(`${base}/api/lan/v1/jobs/${second.jobId}`, {headers: auth})).json();
      if (['completed', 'failed'].includes(secondDetail.status)) break;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    assert.match(secondDetail.assets[0].relativePath, /_v2\.png$/);

    // 统计
    const stats = await (await fetch(`${base}/api/lan/v1/stats`, {headers: auth})).json();
    assert.equal(stats.assets.total, 3);
    assert.equal(stats.assets.byDestination.local, 3);
    assert.equal(stats.assets.byDestination.share, 3);
    assert.equal(stats.outbox, 0);

    // 非 base64 内容必须被拒绝
    const bad = await fetch(`${base}/api/lan/v1/jobs`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({items: [{mode: 'ingest', type: 'card', data: 'data:image/png;base64,bm90IGFuIGltYWdl'}]})
    });
    assert.equal(bad.status, 202, '请求先被接收');
    const badJob = await bad.json();
    let badDetail = null;
    const deadline3 = Date.now() + 30_000;
    while (Date.now() < deadline3) {
      badDetail = await (await fetch(`${base}/api/lan/v1/jobs/${badJob.jobId}`, {headers: auth})).json();
      if (['completed', 'partial', 'failed'].includes(badDetail.status)) break;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    assert.equal(badDetail.status, 'failed');
    assert.match(badDetail.items[0].message, /无法识别/);

    // 参数校验
    const invalid = await fetch(`${base}/api/lan/v1/jobs`, {method: 'POST', headers: auth, body: JSON.stringify({items: []})});
    assert.equal(invalid.status, 400);
  } finally {
    child.kill();
    await new Promise(resolve => setTimeout(resolve, 300));
    await rm(dataDir, {recursive: true, force: true});
  }
});
