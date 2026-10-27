// 第二阶段：局域网协作端到端多进程模拟（独立验证工程师编写，不属于实现代码）。
//
// 真实性边界（务必如实理解）：
//   - 真实执行：真实子进程 开发/协作/中控.mjs（随机端口、临时 dataDir、小 leaseMs/heartbeatTimeoutMs）、
//     真实子进程 2 个 开发/协作/节点.mjs run --config（各自 dataDir/名字/token/journal 落盘）、
//     进程内真实 createStudio 起两个真实漫画服务 HTTP 服务（A 端 + B 端执行适配层，走真实
//     collab-jobs/collab-client/pump/名额/回填），真实 HTTP 调用与真实文件/磁盘状态。
//   - 模拟（明确非真实）：Codex/Jimeng 生图桥为 fake bridge（返回合成的合法 PNG，绝不联网/不调用真实 AI）；
//     节点甲的 localComic 指向本测试自带的「假漫画服务」以注入故障（真实 HTTP + 合成 PNG + 真实 sha256）。
//   - 未验证：第二台真实电脑、真实 Codex 账号生图、真实局域网/防火墙。不得据此宣称「双机已跑通」。
//
// 运行（包内 node，TEMP/TMP 指向 开发/临时文件）：
//   $env:TEMP='...\开发\临时文件'; $env:TMP=$env:TEMP
//   & "...\开发\workbench\运行环境\node\node.exe" --test --test-concurrency=1 "开发/协作/tests/e2e-lan-simulation.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../../comic/server.mjs';
import {createProject, id as newId, panel} from '../../comic/public/model.js';
import {ensureProjectPanelGeneration} from '../../comic/public/panel-generation.js';
import {readApplyJournal} from '../../comic/lib/collab-apply.mjs';
import {sha256} from '../lib/protocol.mjs';
import {
  closeServer,
  createHttpApi,
  delay,
  getFreePort,
  jsonBrief,
  killProcessTree,
  makePng,
  readJsonFile,
  removeDir,
  spawnManaged,
  startServer,
  tempDir,
  waitFor,
  waitForHttp,
  writeJsonFile,
} from './helpers/harness.mjs';
import {createFakeComic} from './helpers/fake-comic.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV_ROOT = path.resolve(HERE, '..', '..'); // 开发 目录
const HUB_SCRIPT = path.join(DEV_ROOT, '协作', '中控.mjs');
const NODE_SCRIPT = path.join(DEV_ROOT, '协作', '节点.mjs');

// ---------------------------------------------------------------------------
// 通用断言 / 等待 / 进程辅助
// ---------------------------------------------------------------------------
function assertStatus(result, expected, label) {
  assert.equal(
    result.status,
    expected,
    `${label}：期望 HTTP ${expected}，实际 ${result.status}；报文=${jsonBrief(result.body ?? result.text)}`,
  );
  return result;
}

function brief(value) {
  return jsonBrief(value);
}

async function waitForValue(check, {timeout = 25000, interval = 100, label = '条件'} = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(interval);
  }
  throw new Error(`等待${label}超时（${timeout}ms）` + (lastError ? `；最后错误：${lastError.message}` : ''));
}

async function listenStudio(studio) {
  await new Promise((resolve, reject) => {
    studio.server.once('error', reject);
    studio.server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${studio.server.address().port}`;
}

async function closeStudio(studio) {
  if (!studio) return;
  try { studio.close(); } catch {}
  await new Promise((resolve) => {
    try {
      if (!studio.server.listening) return resolve();
      studio.server.close(() => resolve());
      setTimeout(resolve, 2000).unref?.();
    } catch {
      resolve();
    }
  });
}

// 假生图桥：返回合成 PNG（明确非真实生图），记录真实 pump 的调用参数。
function createFakeBridge(label, {width = 64, height = 48} = {}) {
  const calls = [];
  return {
    calls,
    close() {},
    ensurePoolSize() {},
    async status() {
      return {connected: true, imageFeature: true, message: `e2e 假生图桥 ${label}：未连接真实 AI`};
    },
    async generate(directory, input, refs, options = {}) {
      const seq = calls.length + 1;
      calls.push({directory, input: JSON.parse(JSON.stringify(input)), refs: [...refs], options});
      const color = [(40 + seq * 47) % 256, (90 + seq * 31) % 256, (150 + seq * 17) % 256, 255];
      return {
        bytes: makePng(width, height, color),
        imageToolSeen: true,
        description: `e2e 假生图桥 ${label} 合成测试图（非真实生图）`,
      };
    },
  };
}

// 节点 → 中控 的故障注入代理：真实 HTTP 转发，可对「结果上传」注入一次 500。
async function startForwardProxy(targetOrigin) {
  const state = {failNextResult: 0, resultAttempts: new Map(), resultFailures: new Map(), forwarded: 0};
  const started = await startServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const resultMatch = url.pathname.match(/^\/api\/node\/tasks\/([^/]+)\/result$/);
      if (resultMatch && request.method === 'PUT') {
        const taskId = decodeURIComponent(resultMatch[1]);
        state.resultAttempts.set(taskId, (state.resultAttempts.get(taskId) || 0) + 1);
        if (state.failNextResult > 0) {
          state.failNextResult -= 1;
          state.resultFailures.set(taskId, (state.resultFailures.get(taskId) || 0) + 1);
          const payload = Buffer.from(JSON.stringify({error: '注入的上传故障（独立验证代理，测试用）', code: 'injected_upload_failure'}));
          response.writeHead(500, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length});
          response.end(payload);
          return;
        }
      }
      state.forwarded += 1;
      const headers = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (['host', 'connection', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) continue;
        headers[key] = value;
      }
      const upstream = await fetch(targetOrigin + url.pathname + url.search, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : body,
        signal: AbortSignal.timeout(30000),
      });
      const upstreamBuffer = Buffer.from(await upstream.arrayBuffer());
      const responseHeaders = {};
      upstream.headers.forEach((value, key) => {
        if (['content-length', 'connection', 'transfer-encoding'].includes(key.toLowerCase())) return;
        responseHeaders[key] = value;
      });
      response.writeHead(upstream.status, responseHeaders);
      response.end(upstreamBuffer);
    } catch {
      if (!response.headersSent) {
        const payload = Buffer.from(JSON.stringify({error: '代理无法连接中控（测试注入）', code: 'proxy_unreachable'}));
        response.writeHead(502, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length});
        response.end(payload);
      } else {
        try { response.end(); } catch {}
      }
    }
  });
  return {
    ...started,
    state,
    close: () => closeServer(started.server),
  };
}

// ---------------------------------------------------------------------------
// 主测试
// ---------------------------------------------------------------------------
test('第二阶段：端到端多进程模拟（真实中控/节点进程 + 真实 comic 服务 + 假生图桥，离线）', {timeout: 175000}, async (t) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = path.join(os.tmpdir(), 'photocraft-e2e-evidence', stamp);
  fs.mkdirSync(evidenceDir, {recursive: true});
  const root = tempDir('photocraft-e2e-');
  const dirs = {
    hub: path.join(root, 'hub-data'),
    nodeA: path.join(root, 'node-a'),
    nodeB: path.join(root, 'node-b'),
    studioA: path.join(root, 'studio-a'),
    studioB: path.join(root, 'studio-b'),
    fakeResults: path.join(root, 'fake-comic-results'),
    refs: path.join(root, 'refs'),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, {recursive: true});

  let fakeComic = null;
  let studioA = null;
  let studioB = null;
  let hubProc = null;
  let nodeAProc = null;
  let nodeBProc = null;
  let proxy = null;
  let failure = null;
  let hubPort = 0;
  // 所有真实子进程记录（含重启产生的），cleanup 时逐个强制结束，避免 Windows 孤儿进程。
  const processRecords = [];
  function spawnTracked(options) {
    const record = spawnManaged(options);
    processRecords.push(record);
    return record;
  }

  try {
    // ---------------- 1) 假生图通道（节点甲的本机漫画服务替身） ----------------
    fakeComic = await createFakeComic({resultsDir: dirs.fakeResults, maxConcurrency: 2});
    t.diagnostic(`假生图通道：${fakeComic.origin}`);

    // ---------------- 2) 真实中控进程 ----------------
    hubPort = await getFreePort();
    const hubConfigFile = path.join(root, 'hub-config.json');
    writeJsonFile(hubConfigFile, {
      port: hubPort,
      host: '127.0.0.1',
      dataDir: dirs.hub,
      hubName: 'e2e 验证中控',
      heartbeatTimeoutMs: 1500,
      leaseMs: 2000,
      maxAttemptMs: 900000,
      resultMaxBytes: 64 * 1024 * 1024,
      maxTasks: 500,
      maxConcurrencyLimit: 4,
      pairingEnabled: true,
      allowedProjectIds: [],
    });
    const hubArgs = ['--config', hubConfigFile, '--port', String(hubPort), '--host', '127.0.0.1', '--data', dirs.hub];
    hubProc = spawnTracked({
      name: '中控进程',
      script: HUB_SCRIPT,
      args: hubArgs,
      cwd: DEV_ROOT,
      logFile: path.join(evidenceDir, '中控.log'),
    });
    await waitForHttp(`http://127.0.0.1:${hubPort}/api/health`, (response) => response.status === 200, {
      label: '中控进程启动',
      timeout: 25000,
    });
    const hubOrigin = `http://127.0.0.1:${hubPort}`;
    const hubApi = createHttpApi(hubOrigin);
    const pairingText = fs.readFileSync(path.join(dirs.hub, '配对码.txt'), 'utf8');
    const pairingCode = (pairingText.match(/配对码：([A-Z0-9]{4,12})/) || [])[1];
    assert.ok(pairingCode, `未能从中控 配对码.txt 读取配对码：${brief(pairingText)}`);
    t.diagnostic(`中控进程：${hubOrigin}（dataDir=${dirs.hub}）`);

    // ---------------- 3) 配对（真实 /api/pair）与节点配置 ----------------
    const clientPair = assertStatus(
      await hubApi('POST', '/api/pair', {pairingCode, role: 'client', name: 'A电脑-验证'}),
      200,
      'A 端客户端配对',
    );
    const clientToken = clientPair.body.token;
    const clientId = clientPair.body.clientId;
    assert.ok(clientToken && clientId, `客户端配对未返回 token/clientId：${brief(clientPair.body)}`);

    const nodeAPair = assertStatus(
      await hubApi('POST', '/api/pair', {pairingCode, role: 'node', name: 'B电脑-甲', platform: 'win32', version: '1.0.0'}),
      200,
      '节点甲配对',
    );
    const nodeBPair = assertStatus(
      await hubApi('POST', '/api/pair', {pairingCode, role: 'node', name: 'B电脑-乙', platform: 'win32', version: '1.0.0'}),
      200,
      '节点乙配对',
    );
    const nodeA = {id: nodeAPair.body.nodeId, token: nodeAPair.body.token, proc: null, name: 'B电脑-甲'};
    const nodeB = {id: nodeBPair.body.nodeId, token: nodeBPair.body.token, proc: null, name: 'B电脑-乙'};
    assert.ok(nodeA.id && nodeB.id, '节点配对未返回 nodeId');
    t.diagnostic(`已配对：client=${clientId}，nodeA=${nodeA.id}，nodeB=${nodeB.id}`);

    // A 端使用协议 §7.2 的客户端配置文件（enabled=true 才轮询；pollMs 调小加速测试）
    writeJsonFile(path.join(dirs.studioA, 'collab', 'client-config.json'), {
      hubUrl: hubOrigin,
      token: clientToken,
      clientId,
      clientName: 'A电脑-验证',
      enabled: true,
      autoApply: true,
      pollMs: 500,
    });

    // ---------------- 4) 真实漫画服务（A 端 + B 端执行适配层，fake 生图桥） ----------------
    const bridgeA = createFakeBridge('A端');
    studioA = createStudio({dataDir: dirs.studioA, maxConcurrent: 1, bridge: bridgeA, jimengBridge: bridgeA, storyboardGenerator: {close() {}}});
    const studioAOrigin = await listenStudio(studioA);
    const studioApi = createHttpApi(studioAOrigin);

    const bridgeB = createFakeBridge('B端执行层');
    studioB = createStudio({dataDir: dirs.studioB, maxConcurrent: 2, bridge: bridgeB, jimengBridge: bridgeB, storyboardGenerator: {close() {}}});
    const studioBOrigin = await listenStudio(studioB);
    const studioBApi = createHttpApi(studioBOrigin);
    t.diagnostic(`真实漫画服务：A=${studioAOrigin}，B执行层=${studioBOrigin}（fake 生图桥）`);

    // ---------------- 5) A 端工程种子（真实 createProject / store 持久化） ----------------
    const project = createProject('e2e 协作验证工程');
    const refPath = path.join(dirs.refs, '叶麟-参考.png');
    fs.writeFileSync(refPath, makePng(32, 24, [30, 90, 160, 255]));
    const refAsset = assertStatus(await studioApi('POST', '/api/assets', {filePath: refPath, name: '叶麟'}), 201, '登记参考资产');
    project.references = [{assetId: refAsset.body.id, name: '叶麟', role: 'character'}];
    project.shots[0].referenceIds = [refAsset.body.id];
    const PANEL_COUNT = 7;
    while (project.pages[0].panels.length < PANEL_COUNT) {
      const shot = JSON.parse(JSON.stringify(project.shots[0]));
      shot.id = newId('shot');
      shot.code = `S${String(project.shots.length + 1).padStart(2, '0')}`;
      shot.referenceIds = [refAsset.body.id];
      project.shots.push(shot);
      project.pages[0].panels.push(panel(shot.id, 100, 100 + project.pages[0].panels.length * 220, 420, 200));
    }
    ensureProjectPanelGeneration(project, studioA.store.db.assets);
    studioA.store.db.projects.push(project);
    studioA.store.save();
    const projectId = project.id;
    const panelIds = project.pages[0].panels.map((item) => item.id);
    t.diagnostic(`A 端工程：${projectId}，${panelIds.length} 个画格`);

    // ---------------- 6) 节点 → 中控 故障注入代理 + 两个真实节点进程 ----------------
    proxy = await startForwardProxy(hubOrigin);
    const nodeConfigBase = {
      hubUrl: proxy.origin,
      maxConcurrency: 1,
      enabled: true,
      paused: false,
      allowedProjectIds: [],
      allowedTaskTypes: ['panel-generation', 'asset-generation'],
      heartbeatMs: 120,
      pollMs: 40,
      uploadRetries: 4,
      uploadBackoffMs: 80,
      taskTimeoutMs: 60000,
      hubTimeoutMs: 5000,
    };
    writeJsonFile(path.join(dirs.nodeA, 'config.json'), {
      ...nodeConfigBase,
      token: nodeA.token,
      nodeName: nodeA.name,
      dataDir: dirs.nodeA,
      localComic: {origin: fakeComic.origin, provider: 'codex'},
    });
    writeJsonFile(path.join(dirs.nodeB, 'config.json'), {
      ...nodeConfigBase,
      token: nodeB.token,
      nodeName: nodeB.name,
      dataDir: dirs.nodeB,
      localComic: {origin: studioBOrigin, provider: 'codex'},
    });
    nodeAProc = spawnTracked({
      name: '节点甲进程',
      script: NODE_SCRIPT,
      args: ['run', '--config', path.join(dirs.nodeA, 'config.json')],
      cwd: DEV_ROOT,
      logFile: path.join(evidenceDir, '节点甲.log'),
    });
    nodeA.proc = nodeAProc;
    nodeBProc = spawnTracked({
      name: '节点乙进程',
      script: NODE_SCRIPT,
      args: ['run', '--config', path.join(dirs.nodeB, 'config.json')],
      cwd: DEV_ROOT,
      logFile: path.join(evidenceDir, '节点乙.log'),
    });
    nodeB.proc = nodeBProc;

    // ---------------- 7) 公共操作封装 ----------------
    async function hubRequest(method, route, body, options = {}) {
      return hubApi(method, route, body, {token: clientToken, ...options});
    }
    async function getHubTask(taskId) {
      const response = assertStatus(await hubRequest('GET', `/api/tasks/${encodeURIComponent(taskId)}`), 200, `读取任务 ${taskId.slice(-8)}`);
      return response.body.task;
    }
    async function waitHubTask(taskId, predicate, label, timeout = 30000) {
      return waitForValue(async () => {
        const task = await getHubTask(taskId);
        return predicate(task) ? task : false;
      }, {timeout, interval: 100, label: `任务 ${taskId.slice(-8)} ${label}`});
    }
    async function getPanel(panelId) {
      const current = studioA.store.project(projectId);
      for (const page of current.pages) {
        const found = page.panels.find((item) => item.id === panelId);
        if (found) return found;
      }
      return null;
    }
    async function waitPanelImage(panelId, label, timeout = 30000) {
      return waitForValue(() => {
        const foundPanel = studioA.store.project(projectId).pages[0].panels.find((item) => item.id === panelId);
        return foundPanel && foundPanel.imageAssetId ? foundPanel.imageAssetId : false;
      }, {timeout, interval: 100, label: `画格 ${panelId.slice(-6)} ${label}`});
    }
    async function waitNodeOnline(nodeId, timeout = 25000) {
      await waitForValue(async () => {
        const response = await hubRequest('GET', '/api/nodes');
        const node = (response.body.nodes || []).find((item) => item.id === nodeId);
        return node && node.status && node.status.online === true;
      }, {timeout, interval: 150, label: `节点 ${nodeId.slice(-6)} 上线`});
    }
    async function setNodePaused(nodeId, paused) {
      const response = await hubRequest('POST', `/api/nodes/${nodeId}/settings`, {paused});
      assertStatus(response, 200, `设置节点 ${nodeId.slice(-6)} paused=${paused}`);
      // 让节点在下一次心跳应用设置（心跳 120ms，留足 4 个周期）
      await delay(paused ? 250 : 450);
    }
    async function distributePanel(panelId) {
      const response = assertStatus(
        await studioApi('POST', '/api/collab/distribute', {projectId, panelIds: [panelId]}),
        200,
        `A 端提交画格 ${panelId.slice(-6)} 协作任务`,
      );
      assert.deepEqual(response.body.errors || [], [], `A 端 distribute 返回错误：${brief(response.body.errors)}`);
      assert.equal((response.body.tasks || []).length, 1, `A 端 distribute 应返回 1 个任务：${brief(response.body)}`);
      return response.body.tasks[0];
    }
    function executionCounts(taskId) {
      const fakeComicCount = fakeComic.submissionsFor(taskId).length;
      const studioBCount = studioB.store.db.jobs.filter((job) => job.kind === 'collab-generation' && job.collab && job.collab.taskId === taskId).length;
      return {fakeComic: fakeComicCount, studioB: studioBCount, total: fakeComicCount + studioBCount};
    }
    function nodeTokenById(nodeId) {
      if (nodeId === nodeA.id) return nodeA.token;
      if (nodeId === nodeB.id) return nodeB.token;
      throw new Error(`未知节点：${nodeId}`);
    }
    function nodeLabelById(nodeId) {
      if (nodeId === nodeA.id) return '节点甲';
      if (nodeId === nodeB.id) return '节点乙';
      return nodeId;
    }
    // 场景包装：失败立即打印详细错误（含实际报文），并汇总到父测试，确保 summary=失败、证据被保留。
    // options.todo=true 时：失败只记为 TODO（不算失败）；若意外通过则反过来报错提醒摘标记。
    const scenarioFailures = [];
    async function scenario(name, options, fn) {
      const isTodo = Boolean(options && options.todo);
      await t.test(name, options, async () => {
        try {
          await fn();
          if (isTodo) {
            const error = new Error('TODO 用例意外通过：实现行为已符合期望，请摘掉 todo 标记后复跑');
            scenarioFailures.push({name, error});
            throw error;
          }
        } catch (error) {
          if (!isTodo) {
            scenarioFailures.push({name, error});
            console.error(`[e2e] 场景失败：${name}\n${error && error.stack ? error.stack : error}`);
          }
          throw error;
        }
      });
    }

    await waitNodeOnline(nodeA.id);
    await waitNodeOnline(nodeB.id);
    t.diagnostic('两个真实节点进程已上线');

    // =====================================================================
    // a) 两节点竞争同一任务：恰好一个领取且只执行一次；A 端自动回填
    // =====================================================================
    await scenario('a) 两节点竞争同一任务：恰好一个领取并完成，只执行一次，A 端自动回填', {timeout: 60000}, async () => {
      const submitted = await distributePanel(panelIds[0]);
      const done = await waitHubTask(submitted.taskId, (task) => task.status === 'done', '完成', 40000);
      assert.equal(done.attempts.length, 1, `同一任务应只有 1 条 attempt（两节点竞争只允许一个领取）：${brief(done.attempts)}`);
      assert.equal(done.attempts[0].status, 'succeeded', `attempt 状态应为 succeeded：${brief(done.attempts[0])}`);
      assert.ok(done.result && done.result.sha256, `任务完成却没有结果：${brief(done)}`);
      assert.equal(done.result.nodeId, done.attempts[0].nodeId, '结果节点与领取节点不一致');
      const counts = executionCounts(submitted.taskId);
      assert.equal(counts.total, 1, `同一任务只能被执行一次（不重复执行）：${brief(counts)}`);

      // 参考图顺序/内容一致性：执行端实际收到的参考图必须与中控任务 reference 顺序一致
      assert.equal(done.references.length, 1, `任务 references 数量异常：${brief(done.references)}`);
      const fakeSubmission = fakeComic.submissionsFor(submitted.taskId)[0];
      if (fakeSubmission) {
        assert.equal(fakeSubmission.referenceFiles.length, done.references.length, `节点甲收到的参考图数量不一致：${brief({got: fakeSubmission.referenceFiles.length, want: done.references.length})}`);
        fakeSubmission.referenceFiles.forEach((file, index) => {
          assert.equal(file.role, done.references[index].role, `参考图 role 顺序不一致（第 ${index + 1} 张）`);
          assert.equal(sha256(fs.readFileSync(file.filePath)), done.references[index].sha256, `参考图内容 sha 与中控 tasks.references 不一致（第 ${index + 1} 张）`);
        });
      } else {
        const call = bridgeB.calls.find((item) => item.input && Array.isArray(item.refs));
        assert.ok(call, `节点乙应真实调用执行适配层的生图桥：bridgeB.calls=${bridgeB.calls.length}`);
        assert.equal(call.refs.length, done.references.length, `执行层参考图数量不一致：${brief({refs: call.refs.length, refsInTask: done.references.length})}`);
        call.refs.forEach((filePath, index) => {
          assert.equal(call.input.referenceRoles[index].role, done.references[index].role, `执行层 referenceRoles 顺序与中控 task.references 不一致（第 ${index + 1} 张）`);
          assert.equal(sha256(fs.readFileSync(filePath)), done.references[index].sha256, `执行层参考图内容 sha 不一致（第 ${index + 1} 张）`);
        });
      }

      const applied = await waitHubTask(submitted.taskId, (task) => task.apply.status === 'applied', 'A 端自动回填 applied', 30000);
      assert.ok(applied.result.sha256, '回填任务缺少结果 sha');
      const assetId = await waitPanelImage(panelIds[0], '被自动回填');
      const panelNow = studioA.store.project(projectId).pages[0].panels.find((item) => item.id === panelIds[0]);
      assert.equal(panelNow.imageAssetId, assetId, '画格 imageAssetId 未写入');
      assert.ok((panelNow.candidates || []).includes(assetId), '画格候选未包含回填结果');
      const localAsset = studioA.store.db.assets.find((item) => item.id === assetId);
      assert.ok(localAsset, '本地资产未登记');
      assert.equal(localAsset.sha256, applied.result.sha256, '本地资产 sha 与中控结果不一致');
      t.diagnostic(`a) 完成：task=${submitted.taskId}，执行节点=${nodeLabelById(done.result.nodeId)}，apply=${applied.apply.status}`);
    });

    // =====================================================================
    // i) 执行适配层：真实走 comic jobs/pump，工作目录在 dataDir/collab/*
    // =====================================================================
    await scenario('i) 执行适配层真实走 comic jobs/pump：工作目录 dataDir/collab/*、fake bridge 被真实调用', {timeout: 60000}, async () => {
      await setNodePaused(nodeA.id, true);
      await setNodePaused(nodeB.id, false);
      try {
        const submitted = await distributePanel(panelIds[1]);
        const done = await waitHubTask(submitted.taskId, (task) => task.status === 'done', '由节点乙完成', 40000);
        assert.equal(done.result.nodeId, nodeB.id, `本任务应固定由节点乙执行（甲已暂停）：实际 ${nodeLabelById(done.result.nodeId)}`);

        const job = studioB.store.db.jobs.find((item) => item.kind === 'collab-generation' && item.collab && item.collab.taskId === submitted.taskId);
        assert.ok(job, '节点乙的漫画服务中找不到 kind=collab-generation 的 job（未走执行适配层 jobs/pump）');
        assert.equal(job.status, 'done', `执行适配层 job 状态应为 done：${job.status}`);
        const jobDir = path.join(dirs.studioB, 'collab', 'jobs', job.id);
        assert.equal(fs.existsSync(jobDir), true, `协作 job 工作目录不在 dataDir/collab/jobs/<jobId>：${jobDir}`);
        const outDir = path.join(jobDir, 'out');
        assert.equal(fs.existsSync(outDir), true, `协作 job 结果目录缺失：${outDir}`);
        assert.ok(fs.readdirSync(outDir).length > 0, `协作 job 结果目录为空：${outDir}`);
        assert.ok(job.collabResult && job.collabResult.sha256, `job 未记录 collabResult：${brief(job.collabResult)}`);
        assert.equal(job.collabResult.sha256, done.result.sha256, '执行适配层结果 sha 与中控任务结果 sha 不一致（说明结果未走真实校验链路）');

        const call = bridgeB.calls.find((item) => path.resolve(item.directory) === path.resolve(jobDir));
        assert.ok(call, `真实 pump 未调用 fake 生图桥（bridgeB.calls=${bridgeB.calls.length}）`);
        assert.equal(call.refs.length, done.references.length, '执行层实际参考图数量与任务 references 不一致');
        call.refs.forEach((filePath, index) => {
          assert.equal(call.input.referenceRoles[index].role, done.references[index].role, `generationInput.referenceRoles 顺序与任务 references 不一致（第 ${index + 1} 张）`);
          assert.equal(sha256(fs.readFileSync(filePath)), done.references[index].sha256, `执行层参考图内容 sha 不一致（第 ${index + 1} 张）`);
        });

        // 名额已释放（pump 生命周期走完）
        const state = await waitForValue(async () => {
          const response = await studioBApi('GET', '/api/state');
          const scheduler = response.body.scheduler;
          return scheduler && scheduler.active === 0 && scheduler.queued === 0 ? scheduler : false;
        }, {timeout: 15000, interval: 150, label: '节点乙漫画服务名额释放'});
        assert.equal(state.active, 0, `名额未释放：${brief(state)}`);

        await waitHubTask(submitted.taskId, (task) => task.apply.status === 'applied', 'A 端回填', 30000);
        await waitPanelImage(panelIds[1], '被回填');
        t.diagnostic(`i) 完成：job=${job.id}，工作目录=${jobDir}`);
      } finally {
        await setNodePaused(nodeA.id, false).catch(() => {});
      }
    });

    // =====================================================================
    // b) 同一资产 dedupeKey 并发申请：1 pending 资产 + 1 任务，其余 join
    // =====================================================================
    await scenario('b) 同一资产并发申请：只建 1 个 pending 资产 + 1 个任务，其余 join', {timeout: 60000}, async () => {
      const assetProjectId = 'project_asset_verify';
      const assetBody = {
        projectId: assetProjectId,
        kind: 'character',
        name: '验证角色',
        form: '默认形态',
        costume: '默认服装',
        style: '国漫',
        prompt: '验证角色标准立绘',
        size: {w: 256, h: 256},
        generationInput: {
          action: 'generate',
          projectId: assetProjectId,
          projectTitle: '资产并发验证',
          shot: {id: 'shot_asset', code: 'A01', title: '资产', description: '验证角色标准立绘'},
          style: '国漫',
          panel: {id: 'panel_asset', name: 'A01', w: 256, h: 256},
          nativeSizing: null,
          referenceRoles: [],
          editPrompt: '',
          cropBox: null,
          maskPolygon: null,
          feather: 0,
          border: 4,
        },
        references: [],
      };
      const responses = await Promise.all(Array.from({length: 5}, () => studioApi('POST', '/api/collab/assets/request', assetBody)));
      responses.forEach((response, index) => assertStatus(response, 200, `并发资产申请 #${index + 1}`));
      const modes = responses.map((response) => response.body.mode);
      assert.equal(modes.filter((mode) => mode === 'create').length, 1, `并发申请应恰好 1 个 create：${brief(modes)}`);
      assert.equal(modes.filter((mode) => mode === 'join').length, 4, `其余应为 join：${brief(modes)}`);
      const created = responses.find((response) => response.body.mode === 'create').body;
      assert.ok(created.asset && created.task, `create 响应缺少 asset/task：${brief(created)}`);

      const hubTasks = await hubRequest('GET', `/api/tasks?projectId=${assetProjectId}&limit=100`);
      assertStatus(hubTasks, 200, '资产项目任务列表');
      assert.equal(hubTasks.body.total, 1, `并发申请只应产生 1 个任务：${brief(hubTasks.body)}`);
      assert.equal(hubTasks.body.tasks[0].type, 'asset-generation', `资产任务类型错误：${hubTasks.body.tasks[0].type}`);

      const available = await waitForValue(async () => {
        const response = await hubRequest('GET', `/api/assets?projectId=${assetProjectId}&limit=100`);
        const asset = (response.body.assets || []).find((item) => item.status === 'available');
        return asset || false;
      }, {timeout: 40000, interval: 150, label: '共享资产生成完成'});
      assert.equal(available.status, 'available', `资产状态应为 available：${brief(available)}`);
      const counts = executionCounts(created.task.id);
      assert.equal(counts.total, 1, `资产生成任务只应执行一次：${brief(counts)}`);
      const assetTask = await getHubTask(created.task.id);
      assert.equal(assetTask.status, 'done', `资产任务应完成：${assetTask.status}`);
      assert.equal(available.sha256, assetTask.result.sha256, '资产 sha 与实际生成结果不一致');
      t.diagnostic(`b) 完成：asset=${available.id} v${available.version}，task=${created.task.id}，modes=${brief(modes)}`);
    });

    // =====================================================================
    // c-1) 节点掉线：claimed（未开始生成）→ 回队/abandoned，可重派
    // =====================================================================
    await scenario('c-1) 节点掉线：claimed→queued/abandoned 且可重派给另一节点', {timeout: 90000}, async () => {
      await setNodePaused(nodeB.id, true);
      let releaseSubmit = null;
      try {
        releaseSubmit = fakeComic.holdNextSubmit();
        const submitted = await distributePanel(panelIds[2]);
        // 必须等「节点甲已把提交请求发到本机漫画服务（响应被挂起）」且中控仍为 claimed 才杀节点，
        // 否则可能杀掉还在下载参考图/尚未提交的节点，测不到「claimed 租约过期」这条路径。
        const claimed = await waitForValue(async () => {
          const task = await getHubTask(submitted.taskId);
          const submittedCount = fakeComic.submissionsFor(submitted.taskId).length;
          return task.status === 'running' && task.attempts.length === 1 && task.attempts[0].status === 'claimed' && submittedCount === 1
            ? {task, submittedCount}
            : false;
        }, {timeout: 25000, interval: 60, label: '节点甲领取且提交被挂起（尚未开始生成）'});
        assert.equal(claimed.task.attempts[0].nodeId, nodeA.id, '本任务应由节点甲领取');
        assert.equal(claimed.submittedCount, 1, `节点甲应已向本机漫画服务提交 1 次：实际 ${claimed.submittedCount}`);
        // 杀掉节点甲（模拟掉线）
        await killProcessTree(nodeA.proc);
        releaseSubmit();
        releaseSubmit = null;

        const requeued = await waitHubTask(
          submitted.taskId,
          (task) => task.status === 'queued' && task.attempts.length === 1 && task.attempts[0].status === 'abandoned',
          '租约过期后回队/abandoned',
          30000,
        );
        assert.equal(requeued.assignedNodeId, null, `回队任务不应保留 assignedNodeId：${requeued.assignedNodeId}`);

        await setNodePaused(nodeB.id, false);
        const done = await waitHubTask(submitted.taskId, (task) => task.status === 'done', '节点乙接管第 2 次尝试完成', 40000);
        assert.equal(done.attempts.length, 2, `应有 2 条 attempt（旧尝试保留 + 新尝试）：${brief(done.attempts)}`);
        assert.equal(done.attempts[0].status, 'abandoned', `旧尝试状态应为 abandoned：${brief(done.attempts[0])}`);
        assert.equal(done.attempts[1].nodeId, nodeB.id, '第 2 次尝试应由节点乙领取');
        assert.equal(done.attempts[1].status, 'succeeded', `第 2 次尝试应成功：${brief(done.attempts[1])}`);
        assert.equal(fakeComic.submissionsFor(submitted.taskId).length, 1, '节点甲被挂起的提交只应发生一次（不应重复生成）');
        await waitHubTask(submitted.taskId, (task) => task.apply.status === 'applied', 'A 端回填', 30000);
        await waitPanelImage(panelIds[2], '被回填');
        t.diagnostic('c-1) 完成：claimed 过期回队 → 节点乙重派成功');
      } finally {
        if (releaseSubmit) releaseSubmit();
        // 重启节点甲，验证 journal 恢复裁决（旧尝试 late：只清理，不覆盖新结果）
        try {
          nodeA.proc = spawnTracked({
            name: '节点甲进程（重启）',
            script: NODE_SCRIPT,
            args: ['run', '--config', path.join(dirs.nodeA, 'config.json')],
            cwd: DEV_ROOT,
            logFile: path.join(evidenceDir, '节点甲.log'),
          });
          await waitNodeOnline(nodeA.id);
          await waitFor(() => {
            const journal = readJsonFile(path.join(dirs.nodeA, 'journal.json'), {entries: {}});
            return Object.keys(journal.entries || {}).length === 0;
          }, {timeout: 20000, interval: 150, label: '节点甲 journal 恢复清理'});
        } catch (error) {
          t.diagnostic(`c-1) 节点甲重启恢复异常（后续场景可能受影响）：${error.message}`);
        }
      }
    });

    // =====================================================================
    // c-2 + g) generating→verifying/unknown 不自动重派；旧尝试迟到结果只登记不覆盖
    // =====================================================================
    await scenario('c-2/g) generating→verifying/unknown 不自动重派；旧尝试迟到结果只登记 lateResults 不覆盖', {timeout: 120000}, async () => {
      await setNodePaused(nodeB.id, true);
      fakeComic.setDefaultHeld(true);
      const panelId = panelIds[3];
      let submitted = null;
      try {
        submitted = await distributePanel(panelId);
        const generating = await waitHubTask(
          submitted.taskId,
          (task) => task.status === 'running' && task.attempts.length === 1 && task.attempts[0].status === 'generating',
          '节点甲已上报 generating',
          30000,
        );
        assert.equal(generating.attempts[0].nodeId, nodeA.id, '本任务应由节点甲生成');

        await killProcessTree(nodeA.proc);
        const verifying = await waitHubTask(
          submitted.taskId,
          (task) => task.status === 'verifying' && task.attempts.length === 1 && task.attempts[0].status === 'unknown',
          '租约过期后 generating→verifying/unknown',
          30000,
        );
        assert.equal(verifying.result, null, `待核实任务不应有结果：${brief(verifying.result)}`);

        // 不自动重派：让唯一在线节点乙空闲超过一个租约周期，任务必须保持 verifying / 1 条 attempt
        await setNodePaused(nodeB.id, false);
        await delay(2600);
        const still = await getHubTask(submitted.taskId);
        assert.equal(still.status, 'verifying', `待核实任务被自动改派/改状态：${still.status}`);
        assert.equal(still.attempts.length, 1, `待核实任务 attempts 被自动增加：${still.attempts.length}（${brief(still.attempts)}）`);
        assert.equal(still.activeAttempt, 1, `待核实任务 activeAttempt 被改变：${still.activeAttempt}`);

        // 人工核实后 retry → 节点乙接管第 2 次尝试
        const retry = await hubRequest('POST', `/api/tasks/${submitted.taskId}/retry`, {reason: '独立验证：人工核实后重派'});
        assertStatus(retry, 200, '人工 retry 待核实任务');
        const done = await waitHubTask(submitted.taskId, (task) => task.status === 'done', '节点乙接管完成', 40000);
        assert.equal(done.attempts.length, 2, `应有 2 条 attempt：${brief(done.attempts)}`);
        assert.equal(done.attempts[0].status, 'unknown', `旧尝试状态应为 unknown：${brief(done.attempts[0])}`);
        assert.equal(done.attempts[1].nodeId, nodeB.id, '第 2 次尝试应由节点乙领取');
        const currentSha = done.result.sha256;

        // A 端回填完成后，再注入旧尝试迟到结果，验证「只登记、不覆盖、不改 apply」
        await waitHubTask(submitted.taskId, (task) => task.apply.status === 'applied', 'A 端回填 applied', 30000);
        await waitPanelImage(panelId, '被回填');
        const applyBefore = (await getHubTask(submitted.taskId)).apply.status;
        const lateImage = makePng(52, 40, [220, 40, 60, 255]);
        const lateUpload = await hubApi('PUT', `/api/node/tasks/${submitted.taskId}/result`, lateImage, {
          token: nodeA.token,
          headers: {'content-type': 'image/png', 'x-attempt': '1', 'x-sha256': sha256(lateImage)},
        });
        assertStatus(lateUpload, 200, '旧尝试迟到结果上传');
        assert.equal(lateUpload.body.late, true, `旧尝试结果应 late=true：${brief(lateUpload.body)}`);
        assert.equal(lateUpload.body.duplicate, false, `首次迟到结果不应 duplicate：${brief(lateUpload.body)}`);
        const afterLate = await getHubTask(submitted.taskId);
        assert.equal(afterLate.result.sha256, currentSha, `迟到结果覆盖了当前结果：${brief(afterLate.result)}`);
        assert.equal(afterLate.apply.status, applyBefore, `迟到结果改变了 apply 状态：${afterLate.apply.status}`);
        assert.equal(afterLate.lateResults.length, 1, `lateResults 应有 1 条：${brief(afterLate.lateResults)}`);
        assert.equal(afterLate.lateResults[0].sha256, sha256(lateImage), `lateResults sha 错误：${brief(afterLate.lateResults[0])}`);
        assert.equal(afterLate.lateResults[0].attempt, 1, `lateResults attempt 错误：${brief(afterLate.lateResults[0])}`);
        assert.equal(afterLate.lateResults[0].reason, 'stale_attempt', `lateResults reason 错误：${brief(afterLate.lateResults[0])}`);
        const notifications = assertStatus(await hubRequest('GET', '/api/notifications?since=0&limit=200'), 200, '通知列表');
        assert.ok(
          (notifications.body.notifications || []).some((item) => item.type === 'task.late_result'),
          `缺少 task.late_result 通知：${brief((notifications.body.notifications || []).map((item) => item.type))}`,
        );
        t.diagnostic(`c-2/g) 完成：task=${submitted.taskId}，lateResults=1，apply=${afterLate.apply.status}`);
      } finally {
        fakeComic.releaseAll();
        fakeComic.setDefaultHeld(false);
        try {
          nodeA.proc = spawnTracked({
            name: '节点甲进程（重启2）',
            script: NODE_SCRIPT,
            args: ['run', '--config', path.join(dirs.nodeA, 'config.json')],
            cwd: DEV_ROOT,
            logFile: path.join(evidenceDir, '节点甲.log'),
          });
          await waitNodeOnline(nodeA.id);
        } catch (error) {
          t.diagnostic(`c-2) 节点甲重启异常（后续场景可能受影响）：${error.message}`);
        }
      }
    });

    // 确保两个节点都恢复在线且未暂停，供后续场景使用
    await setNodePaused(nodeA.id, false).catch(() => {});
    await setNodePaused(nodeB.id, false).catch(() => {});
    await waitNodeOnline(nodeA.id).catch(() => {});
    await waitNodeOnline(nodeB.id).catch(() => {});

    // =====================================================================
    // e + f) 上传失败重传（不重新生成）+ 重复提交 / 重复回传 / 回填只一次
    // =====================================================================
    await scenario('e/f) 上传失败重传（不重新生成）；重复提交/重复回传幂等、回填只一次', {timeout: 90000}, async () => {
      proxy.state.failNextResult = 1;
      const panelId = panelIds[5];
      const submitted = await distributePanel(panelId);

      // f1) 重复提交同一画格（回填前 target.expected 未变化）：幂等键相同 → duplicate，不新建任务
      const tasksBefore = assertStatus(await hubRequest('GET', `/api/tasks?projectId=${projectId}&limit=100`), 200, '重复提交前任务列表');
      const again = assertStatus(
        await studioApi('POST', '/api/collab/distribute', {projectId, panelIds: [panelId]}),
        200,
        'A 端重复提交同一画格',
      );
      assert.equal(again.body.tasks.length, 1, `重复提交应返回 1 个任务条目：${brief(again.body)}`);
      assert.equal(again.body.tasks[0].duplicate, true, `重复提交同一内容应 duplicate=true：${brief(again.body.tasks[0])}`);
      assert.equal(again.body.tasks[0].taskId, submitted.taskId, '重复提交返回了不同任务');
      const tasksAfter = assertStatus(await hubRequest('GET', `/api/tasks?projectId=${projectId}&limit=100`), 200, '重复提交后任务列表');
      assert.equal(tasksAfter.body.total, tasksBefore.body.total, `重复提交不应新建任务：${tasksBefore.body.total} → ${tasksAfter.body.total}`);

      const done = await waitHubTask(submitted.taskId, (task) => task.status === 'done', '上传失败重传后完成', 45000);
      const attemptsThroughProxy = proxy.state.resultAttempts.get(submitted.taskId) || 0;
      assert.ok(attemptsThroughProxy >= 2, `结果上传应至少 2 次（首次注入 500）：实际 ${attemptsThroughProxy}`);
      const counts = executionCounts(submitted.taskId);
      assert.equal(counts.total, 1, `上传失败不应重新生成：${brief(counts)}`);
      const nodeLogFiles = [path.join(dirs.nodeA, 'logs', '节点.log'), path.join(dirs.nodeB, 'logs', '节点.log')].filter((file) => fs.existsSync(file));
      assert.ok(nodeLogFiles.length > 0, '未找到节点日志文件');
      assert.ok(
        nodeLogFiles.some((file) => fs.readFileSync(file, 'utf8').includes('结果上传失败')),
        `节点日志中没有「结果上传失败」记录：${brief(nodeLogFiles)}`,
      );

      await waitHubTask(submitted.taskId, (task) => task.apply.status === 'applied', 'A 端回填 applied', 30000);
      await waitPanelImage(panelId, '被回填');

      // f2) 重复回传同 sha：协议级 duplicate，不重复入库/回填
      const uploaderToken = nodeTokenById(done.result.nodeId);
      const resultBlob = assertStatus(await hubRequest('GET', `/api/blobs/${done.result.sha256}`), 200, '下载当前结果 blob');
      const duplicateUpload = await hubApi('PUT', `/api/node/tasks/${submitted.taskId}/result`, resultBlob.buffer, {
        token: uploaderToken,
        headers: {'content-type': 'image/png', 'x-attempt': String(done.result.attempt), 'x-sha256': done.result.sha256},
      });
      assertStatus(duplicateUpload, 200, '重复回传同 sha');
      assert.equal(duplicateUpload.body.duplicate, true, `重复回传应 duplicate=true：${brief(duplicateUpload.body)}`);

      // 回填只一次：等 A 端多轮轮询后，画格候选/图片不变，apply 仍 applied
      const panelBefore = await getPanel(panelId);
      const candidatesBefore = [...(panelBefore.candidates || [])];
      const imageBefore = panelBefore.imageAssetId;
      await delay(1500);
      const panelAfter = await getPanel(panelId);
      assert.equal(panelAfter.imageAssetId, imageBefore, '重复回传导致画格图片被再次写入');
      assert.deepEqual(panelAfter.candidates, candidatesBefore, `重复回传导致候选列表变化：${brief({before: candidatesBefore, after: panelAfter.candidates})}`);
      const hubAfter = await getHubTask(submitted.taskId);
      assert.equal(hubAfter.apply.status, 'applied', `重复回传改变了 apply 状态：${hubAfter.apply.status}`);
      const journal = readApplyJournal(dirs.studioA);
      const entriesForTask = Object.entries(journal.entries || {}).filter(([, entry]) => entry && entry.taskId === submitted.taskId);
      assert.equal(entriesForTask.length, 1, `本地 apply-journal 应只有 1 条该任务记录：${brief(entriesForTask)}`);
      assert.equal(entriesForTask[0][1].status, 'applied', `本地 apply-journal 状态应为 applied：${brief(entriesForTask[0][1])}`);
      t.diagnostic('e/f) 完成：上传重传 2 次、只生成 1 次；重复提交/重复回传幂等、回填只一次');
    });

    // =====================================================================
    // h) 回填目标已修改：自动回填 conflict 不覆盖；force 后应用并保留候选
    // =====================================================================
    await scenario('h) 回填目标已修改：自动回填 conflict 不覆盖、结果进候选；force 后应用且保留候选', {timeout: 90000}, async () => {
      await setNodePaused(nodeB.id, true);
      fakeComic.setDefaultHeld(true);
      const panelId = panelIds[4];
      let beforeImage = null;
      try {
        const submitted = await distributePanel(panelId);
        await waitHubTask(
          submitted.taskId,
          (task) => task.status === 'running' && task.attempts.length === 1 && task.attempts[0].status === 'generating',
          '节点甲开始生成（假通道挂起）',
          30000,
        );
        // 等待期间用户修改目标画格：提示词、几何、工程 revision
        const stored = studioA.store.project(projectId);
        const targetPanel = stored.pages[0].panels.find((item) => item.id === panelId);
        const targetShot = stored.shots.find((item) => item.id === targetPanel.shotId);
        beforeImage = targetPanel.imageAssetId;
        targetShot.description = '用户等待期间改写后的提示词：叶麟拔剑而立，近景';
        targetPanel.x += 40;
        stored.revision += 1;
        stored.updated = new Date().toISOString();
        studioA.store.markProject?.(stored);
        studioA.store.save();

        // 放行假通道 → 节点甲完成上传
        fakeComic.releaseJob(submitted.taskId);
        const done = await waitHubTask(submitted.taskId, (task) => task.status === 'done', '生成完成', 40000);
        const conflict = await waitHubTask(submitted.taskId, (task) => task.apply.status === 'conflict', 'A 端自动回填 conflict', 35000);
        assert.ok(conflict.apply.detail, `conflict 缺少 detail：${brief(conflict.apply)}`);
        const panelAfterConflict = await getPanel(panelId);
        assert.equal(panelAfterConflict.imageAssetId, beforeImage, '冲突时覆盖了当前画格图片');
        assert.equal(panelAfterConflict.x, targetPanel.x, '冲突时覆盖了画格几何');
        const candidates = panelAfterConflict.candidates || [];
        assert.ok(candidates.length > 0, '冲突结果未保留为候选');
        const candidateAsset = candidates
          .map((assetId) => studioA.store.db.assets.find((item) => item.id === assetId))
          .find((asset) => asset && asset.sha256 === done.result.sha256);
        assert.ok(candidateAsset, `冲突结果未登记为本地候选资产（sha 不匹配）：${brief(candidates)}`);

        // 用户处理冲突：仍然应用（force）
        const force = await studioApi('POST', `/api/collab/tasks/${submitted.taskId}/apply-choice`, {choice: 'force'});
        assertStatus(force, 200, 'apply-choice force');
        assert.equal(force.body.status, 'applied', `force 应返回 applied：${brief(force.body)}`);
        await waitHubTask(submitted.taskId, (task) => task.apply.status === 'applied', 'force 后中控 apply=applied', 25000);
        const panelForced = await getPanel(panelId);
        assert.equal(panelForced.imageAssetId, candidateAsset.id, 'force 未把结果写入画格');
        assert.ok((panelForced.candidates || []).includes(candidateAsset.id), 'force 后候选丢失');
        t.diagnostic(`h) 完成：conflict → force，asset=${candidateAsset.id}`);
      } finally {
        fakeComic.releaseAll();
        fakeComic.setDefaultHeld(false);
        await setNodePaused(nodeB.id, false).catch(() => {});
      }
    });

    // =====================================================================
    // d) 中控重启：状态恢复、节点重连、重启后仍可派单与回填
    // =====================================================================
    await scenario('d) 中控重启：任务/节点/资产/apply 恢复，节点重连，重启后仍可派单回填', {timeout: 120000}, async () => {
      await setNodePaused(nodeA.id, false).catch(() => {});
      await setNodePaused(nodeB.id, false).catch(() => {});
      await waitNodeOnline(nodeA.id);
      await waitNodeOnline(nodeB.id);
      const healthBefore = assertStatus(await hubApi('GET', '/api/health'), 200, '重启前 health');
      const hubIdBefore = healthBefore.body.hubId;
      const tasksBefore = assertStatus(await hubRequest('GET', `/api/tasks?limit=100`), 200, '重启前任务列表');
      const assetsBefore = assertStatus(await hubRequest('GET', `/api/assets?limit=100&allVersions=true`), 200, '重启前资产列表');
      const appliedTasksBefore = tasksBefore.body.tasks.filter((task) => task.apply && task.apply.status === 'applied').length;
      const doneTasksBefore = tasksBefore.body.tasks.filter((task) => task.status === 'done').length;
      assert.ok(tasksBefore.body.total >= 5, `重启前应已有多个任务：${tasksBefore.body.total}`);

      await delay(800); // 等中控 100ms 合并写落盘
      await killProcessTree(hubProc);
      await delay(500);
      assert.equal(nodeA.proc.exit, null, '中控停机期间节点甲进程不应退出');
      assert.equal(nodeB.proc.exit, null, '中控停机期间节点乙进程不应退出');

      hubProc = spawnTracked({
        name: '中控进程（重启）',
        script: HUB_SCRIPT,
        args: hubArgs,
        cwd: DEV_ROOT,
        logFile: path.join(evidenceDir, '中控.log'),
      });
      await waitForHttp(`http://127.0.0.1:${hubPort}/api/health`, (response) => response.status === 200, {
        label: '中控进程重启',
        timeout: 30000,
      });
      const healthAfter = assertStatus(await hubApi('GET', '/api/health'), 200, '重启后 health');
      assert.equal(healthAfter.body.hubId, hubIdBefore, `重启后 hubId 变化（未读回同一 dataDir）：${hubIdBefore} → ${healthAfter.body.hubId}`);

      const tasksAfter = assertStatus(await hubRequest('GET', `/api/tasks?limit=100`), 200, '重启后任务列表');
      assert.equal(tasksAfter.body.total, tasksBefore.body.total, `重启后任务数变化：${tasksBefore.body.total} → ${tasksAfter.body.total}`);
      assert.equal(
        tasksAfter.body.tasks.filter((task) => task.status === 'done').length,
        doneTasksBefore,
        '重启后已完成任务数变化',
      );
      assert.equal(
        tasksAfter.body.tasks.filter((task) => task.apply && task.apply.status === 'applied').length,
        appliedTasksBefore,
        '重启后 apply=applied 任务数变化',
      );
      const assetsAfter = assertStatus(await hubRequest('GET', `/api/assets?limit=100&allVersions=true`), 200, '重启后资产列表');
      assert.equal(assetsAfter.body.total, assetsBefore.body.total, `重启后资产数变化：${assetsBefore.body.total} → ${assetsAfter.body.total}`);
      const availableAssetBefore = assetsBefore.body.assets.find((asset) => asset.status === 'available');
      if (availableAssetBefore) {
        const sameAfter = assetsAfter.body.assets.find((asset) => asset.id === availableAssetBefore.id);
        assert.ok(sameAfter, '重启后共享资产丢失');
        assert.equal(sameAfter.sha256, availableAssetBefore.sha256, '重启后共享资产内容 sha 变化');
      }

      await waitNodeOnline(nodeA.id);
      await waitNodeOnline(nodeB.id);
      const statusAfter = assertStatus(await studioApi('GET', '/api/collab/status'), 200, 'A 端协作状态');
      assert.equal(statusAfter.body.configured, true, `A 端协作未配置：${brief(statusAfter.body)}`);
      await waitForValue(async () => {
        const response = await studioApi('GET', '/api/collab/status');
        return response.body.hubReachable === true;
      }, {timeout: 20000, interval: 250, label: 'A 端重新连接中控'});

      // 重启后仍可继续派单与自动回填
      const submitted = await distributePanel(panelIds[6]);
      const done = await waitHubTask(submitted.taskId, (task) => task.status === 'done', '重启后新任务完成', 45000);
      assert.equal(done.attempts.length, 1, `重启后新任务 attempts 异常：${brief(done.attempts)}`);
      await waitHubTask(submitted.taskId, (task) => task.apply.status === 'applied', '重启后 A 端回填 applied', 30000);
      await waitPanelImage(panelIds[6], '重启后被回填');
      t.diagnostic(`d) 完成：hubId=${hubIdBefore} 恢复，tasks=${tasksAfter.body.total}，assets=${assetsAfter.body.total}，重启后新任务可回填`);
    });

    // =====================================================================
    // 回填后重复提交同一画格（历史问题 #2，Lead 拍板方向 A：幂等键纳入目标指纹）
    //   历史现象：A 端幂等键 = projectId:panelId:panelContentKey前16:referenceKey前8，
    //        但中控 payloadHash 覆盖 target.expected（含 geometryKey，而 geometryKey 含 imageAssetId）。
    //        回填成功后画格 imageAssetId 变化 → target.expected 变化 → 同一幂等键 + 不同 payload
    //        → 中控 409 idempotency_conflict；A 端 distribute 该项进入 errors，返回 tasks=[]。
    //   最终语义（方向 A）：幂等键纳入目标指纹（panelContentKey+geometryKey+referenceKey+revision 的哈希）。
    //        - 未回填连点（expected 不变）→ 同一幂等键 → duplicate，不新建任务（e/f 场景已覆盖）；
    //        - 回填成功后再次提交（geometryKey 变化）→ 新幂等键 → 新建任务（重新生成语义），
    //          中控任务数 +1、新旧 taskId 不同、errors 为空。
    // =====================================================================
    await scenario(
      '回填后再次提交同一画格：按新目标指纹视为新任务（方向 A 回归，不 409、不误判 duplicate）',
      {timeout: 40000},
      async () => {
        const panelId = panelIds[5]; // 该画格已在 e/f 场景回填为 applied
        const tasksBefore = assertStatus(await hubRequest('GET', `/api/tasks?projectId=${projectId}&limit=100`), 200, '问题#2 提交前任务列表');
        const originalTask = tasksBefore.body.tasks.find((task) => task.panelId === panelId && task.status === 'done');
        assert.ok(originalTask, `未找到该画格已完成的原任务：${brief(tasksBefore.body.tasks.filter((task) => task.panelId === panelId))}`);
        const response = await studioApi('POST', '/api/collab/distribute', {projectId, panelIds: [panelId]});
        assertStatus(response, 200, '回填后再次提交');
        assert.deepEqual(response.body.errors || [], [], `回填后再次提交不应有 errors（不应暴露 409）：${brief(response.body.errors)}`);
        assert.equal(response.body.tasks.length, 1, `回填后再次提交应返回 1 个任务：${brief(response.body)}`);
        const newTaskId = response.body.tasks[0].taskId;
        assert.equal(response.body.tasks[0].duplicate, false, `回填后再次提交应视为新任务而不是 duplicate：${brief(response.body.tasks[0])}`);
        assert.notEqual(newTaskId, originalTask.id, `回填后再次提交应生成新 taskId（方向 A），实际仍是旧任务 ${newTaskId}`);
        const tasksAfter = assertStatus(await hubRequest('GET', `/api/tasks?projectId=${projectId}&limit=100`), 200, '问题#2 提交后任务列表');
        assert.equal(tasksAfter.body.total, tasksBefore.body.total + 1, `回填后再次提交应新建 1 个任务：${tasksBefore.body.total} → ${tasksAfter.body.total}`);
        const createdTask = await getHubTask(newTaskId);
        assert.equal(createdTask.panelId, panelId, `新任务画格编号不一致：${brief(createdTask)}`);
        assert.equal(createdTask.duplicate, undefined, '任务对象不应带 duplicate 字段');
        // 清理：该回归任务不再需要执行（若已被节点领取并完成则容忍，不影响后续断言）
        const cancelled = await hubRequest('POST', `/api/tasks/${encodeURIComponent(newTaskId)}/cancel`);
        assert.ok([200, 409].includes(cancelled.status), `回归任务取消失败：${brief(cancelled)}`);
        t.diagnostic(`问题#2 回归：原任务=${originalTask.id}，新任务=${newTaskId}，任务数 ${tasksBefore.body.total}→${tasksAfter.body.total}`);
      },
    );

    if (scenarioFailures.length > 0) {
      throw new Error(
        `e2e 有 ${scenarioFailures.length} 个场景失败：${scenarioFailures.map((item) => item.name).join('；')}`
          + `；首个错误：${scenarioFailures[0].error && scenarioFailures[0].error.message ? scenarioFailures[0].error.message : scenarioFailures[0].error}`,
      );
    }

    t.diagnostic(`e2e 证据日志目录：${evidenceDir}`);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // 失败时尽量保留关键证据（不包含任何 token 明文）
    if (failure) {
      try { fs.writeFileSync(path.join(evidenceDir, 'failure.txt'), String(failure.stack || failure)); } catch {}
      try {
        for (const [label, source] of [
          ['hub-state.json', path.join(dirs.hub, 'hub-state.json')],
          ['nodeA-journal.json', path.join(dirs.nodeA, 'journal.json')],
          ['nodeB-journal.json', path.join(dirs.nodeB, 'journal.json')],
          ['studioA-apply-journal.json', path.join(dirs.studioA, 'collab', 'apply-journal.json')],
        ]) {
          if (fs.existsSync(source)) fs.copyFileSync(source, path.join(evidenceDir, label));
        }
      } catch {}
    }
    fakeComic?.releaseAll?.();
    try { if (fakeComic) await fakeComic.close(); } catch {}
    // 逐个强制结束所有真实子进程（含多次重启产生的记录），Windows 下用 taskkill /T /F 防止孤儿。
    for (const record of [...processRecords].reverse()) {
      try { await killProcessTree(record); } catch {}
    }
    try { if (proxy) await proxy.close(); } catch {}
    try { await closeStudio(studioA); } catch {}
    try { await closeStudio(studioB); } catch {}
    try { removeDir(root); } catch {}
    try {
      writeJsonFile(path.join(evidenceDir, 'summary.json'), {
        runAt: stamp,
        status: failure ? 'failed' : 'passed',
        note: '本机单机多进程模拟；未验证真实第二台电脑/真实 Codex 生图',
        hubPort,
        failure: failure ? String(failure.message || failure) : null,
      });
    } catch {}
    if (failure) console.error(`[e2e] 失败证据目录：${evidenceDir}`);
    else console.log(`[e2e] 证据日志目录：${evidenceDir}`);
  }
});
