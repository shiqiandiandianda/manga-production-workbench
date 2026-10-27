// 假漫画服务（第二阶段 e2e 的「本机生图通道」协议替身，完全离线）。
//
// 用途：节点进程（开发/协作/节点.mjs）的 localComic.origin 指向本服务，模拟 B 端
// 开发/comic 的 §7.1 接口子集。它返回**真实合成的 PNG 文件 + 真实 sha256/像素**，
// 但**不调用任何真实 AI/账号/外网**。
//
// 与控制面（供测试注入故障）：
//   holdNextSubmit()   下一次 POST /api/collab/generation 挂起不响应（用于「claimed 但未开始生成」）
//   setDefaultHeld(v)  新 job 进入 running 后保持不完成（用于「generating 后掉线」/冲突窗口）
//   releaseJob(id)     让指定 job 完成并产出结果文件
//   releaseAll()       释放所有挂起（提交响应 + 生成完成）
//   submissionsFor(id) 查询某 task 的提交记录（用于断言「不重复生成」）
import fs from 'node:fs';
import path from 'node:path';
import {sha256, inspectImageBuffer} from '../../lib/protocol.mjs';
import {makePng, startServer, closeServer, delay} from './harness.mjs';

const json = (response, status, value) => {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length});
  response.end(body);
};

async function readBody(request, maxBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('请求体超过限制'), {status: 413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function createFakeComic({resultsDir, maxConcurrency = 2, logger = () => {}} = {}) {
  fs.mkdirSync(resultsDir, {recursive: true});
  const state = {
    jobs: new Map(),
    plans: new Map(),
    submits: [],
    cancels: [],
    queryCount: 0,
    nextJobSeq: 0,
    defaultHeld: false,
    submitHolds: [],
    closed: false,
  };

  function planFor(taskId) {
    let plan = state.plans.get(taskId);
    if (!plan) {
      plan = {release: !state.defaultHeld, cancelled: false, failure: false, colorSeed: state.plans.size + 1};
      state.plans.set(taskId, plan);
    }
    return plan;
  }

  function resultFor(job) {
    if (job.result) return job.result;
    const seed = job.plan.colorSeed || 1;
    const color = [(40 + seed * 37) % 256, (90 + seed * 53) % 256, (160 + seed * 29) % 256, 255];
    const bytes = makePng(64, 48, color);
    const filePath = path.join(resultsDir, `${job.jobId}.png`);
    fs.writeFileSync(filePath, bytes);
    const info = inspectImageBuffer(bytes);
    job.result = {
      filePath,
      sha256: sha256(bytes),
      size: bytes.length,
      mime: info ? info.mime : 'image/png',
      width: info ? info.width : 64,
      height: info ? info.height : 48,
      assetId: null,
    };
    return job.result;
  }

  function viewJob(job) {
    state.queryCount += 1;
    const plan = job.plan;
    let status;
    if (plan.cancelled) status = 'cancelled';
    else if (plan.failure) status = 'failed';
    else if (job.queryCount < 2) {
      status = job.queryCount === 0 ? 'queued' : 'running';
      job.queryCount += 1;
    } else {
      status = plan.release ? 'done' : 'running';
    }
    if (status === 'running' && !job.startedAt) job.startedAt = new Date().toISOString();
    if (status === 'running' && !job.generationStartedAt) job.generationStartedAt = job.startedAt;
    let result = null;
    if (status === 'done') {
      if (!job.completedAt) job.completedAt = new Date().toISOString();
      result = resultFor(job);
    }
    return {
      jobId: job.jobId,
      status,
      phase: status,
      message: status === 'running' ? 'e2e 假生图通道：合成中' : status === 'done' ? 'e2e 假生图通道：已完成（合成 PNG）' : '',
      progress: status === 'running' ? 50 : status === 'done' ? 100 : 0,
      result,
      error: status === 'failed' ? {message: 'e2e 假生图通道：注入的生成失败'} : null,
      startedAt: job.startedAt || null,
      completedAt: job.completedAt || null,
    };
  }

  function activeJobs() {
    let active = 0;
    for (const job of state.jobs.values()) {
      if (job.plan.cancelled) continue;
      if (job.result || job.plan.failure) continue;
      active += 1;
    }
    return active;
  }

  const server = await startServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const method = request.method;
    try {
      if (method === 'POST' && url.pathname === '/api/collab/generation') {
        const payload = JSON.parse((await readBody(request)).toString('utf8') || '{}');
        const taskId = String(payload.taskId || '').trim();
        const attempt = Number(payload.attempt);
        const generationInput = payload.generationInput;
        const referenceFiles = Array.isArray(payload.referenceFiles) ? payload.referenceFiles : [];
        if (!taskId) return json(response, 400, {error: '缺少 taskId', code: 'missing_task_id'});
        if (!Number.isInteger(attempt) || attempt < 1) return json(response, 400, {error: 'attempt 无效', code: 'invalid_attempt'});
        if (!generationInput || typeof generationInput !== 'object' || Array.isArray(generationInput)) {
          return json(response, 400, {error: 'generationInput 必须是自包含对象', code: 'invalid_generation_input'});
        }
        const referenceRoles = Array.isArray(generationInput.referenceRoles) ? generationInput.referenceRoles : [];
        if (referenceFiles.length !== referenceRoles.length) {
          return json(response, 400, {
            error: `参考图数量（${referenceFiles.length}）与 generationInput.referenceRoles（${referenceRoles.length}）不一致`,
            code: 'reference_role_mismatch',
          });
        }
        for (let index = 0; index < referenceFiles.length; index += 1) {
          const file = referenceFiles[index] && typeof referenceFiles[index] === 'object' ? referenceFiles[index] : {};
          const role = String(file.role || '').trim();
          const expectedRole = String(referenceRoles[index] && referenceRoles[index].role || '').trim();
          if (!role) return json(response, 400, {error: `第 ${index + 1} 个参考图缺少 role`, code: 'invalid_reference'});
          if (expectedRole && expectedRole !== role) {
            return json(response, 400, {
              error: `第 ${index + 1} 个参考图的 role 与 generationInput.referenceRoles 顺序不一致`,
              code: 'reference_role_mismatch',
            });
          }
        }
        state.submits.push({
          taskId,
          attempt,
          provider: String(payload.provider || 'codex'),
          referenceFiles: referenceFiles.map((file) => ({...file})),
          referenceRoles: referenceRoles.map((role) => ({...role})),
          generationInput,
          at: new Date().toISOString(),
        });
        const held = state.submitHolds.length > 0 ? state.submitHolds.shift() : null;
        if (held) {
          // 挂起响应：模拟「节点已领取但尚未开始生成」的窗口。
          await Promise.race([held.promise, delay(30000)]);
        }
        const jobId = `job_fake_${String((state.nextJobSeq += 1)).padStart(4, '0')}`;
        state.jobs.set(jobId, {
          jobId,
          taskId,
          attempt,
          plan: planFor(taskId),
          queryCount: 0,
          startedAt: null,
          generationStartedAt: null,
          completedAt: null,
          result: null,
          createdAt: new Date().toISOString(),
        });
        json(response, 202, {jobId});
        return;
      }
      let match = url.pathname.match(/^\/api\/collab\/generation\/([^/]+)\/cancel$/);
      if (method === 'POST' && match) {
        state.cancels.push(decodeURIComponent(match[1]));
        const job = state.jobs.get(decodeURIComponent(match[1]));
        if (job) job.plan.cancelled = true;
        json(response, 200, {ok: true});
        return;
      }
      match = url.pathname.match(/^\/api\/collab\/generation\/([^/]+)$/);
      if (method === 'GET' && match) {
        const job = state.jobs.get(decodeURIComponent(match[1]));
        if (!job) return json(response, 404, {error: '没有该协作任务', code: 'job_not_found'});
        json(response, 200, viewJob(job));
        return;
      }
      if (method === 'GET' && url.pathname === '/api/state') {
        json(response, 200, {projects: [], jobs: [], scheduler: {active: activeJobs(), queued: 0, concurrency: maxConcurrency}});
        return;
      }
      if (method === 'GET' && url.pathname === '/api/generation-settings') {
        json(response, 200, {totalConcurrency: maxConcurrency, sharedLimit: maxConcurrency, platforms: {main: maxConcurrency}, limits: {codex: maxConcurrency}});
        return;
      }
      if (method === 'GET' && url.pathname === '/api/health') {
        json(response, 200, {application: 'comic-merged-studio', version: 'e2e-fake-generation-channel', fake: true});
        return;
      }
      json(response, 404, {error: '假漫画服务没有该接口', code: 'not_found'});
    } catch (error) {
      if (!response.headersSent) {
        try { json(response, error.status || 500, {error: String(error.message || error), code: 'fake_comic_error'}); } catch {}
      } else {
        try { response.end(); } catch {}
      }
    }
  });

  function releaseAll() {
    for (const plan of state.plans.values()) plan.release = true;
    while (state.submitHolds.length > 0) state.submitHolds.shift().release();
  }

  return {
    origin: server.origin,
    port: server.port,
    state,
    server: server.server,
    holdNextSubmit() {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      state.submitHolds.push({promise, release});
      return release;
    },
    setDefaultHeld(value) {
      state.defaultHeld = value === true;
    },
    releaseJob(taskId) {
      planFor(taskId).release = true;
    },
    releaseAll,
    submissionsFor(taskId) {
      return state.submits.filter((item) => item.taskId === taskId);
    },
    async close() {
      if (state.closed) return;
      state.closed = true;
      try { releaseAll(); } catch {}
      await closeServer(server.server);
    },
  };
}
