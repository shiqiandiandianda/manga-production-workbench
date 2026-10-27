/**
 * 唯一 HTTP 路由表。
 *
 * 路由层只做三件事：解包请求、调用用例、返回结果。
 * 业务规则、权限判定、状态机迁移都在 core。
 */
import {createRouter} from '../platform/http/router.mjs';
import {describeConfig} from '../platform/config/index.mjs';
import {sniffImageMime} from '../platform/fs/image.mjs';
import {fail} from '../core/errors.mjs';
import {API_PREFIX, PHASE, PHASE_LABEL, PRODUCT_NAME, VERSION} from '../version.mjs';

const STARTED_AT = Date.now();

export function createRoutes({config, usecases, archive, executors}) {
  const router = createRouter();

  router.get(`${API_PREFIX}/health`, () => ({
    body: {
      ok: true,
      product: PRODUCT_NAME,
      version: VERSION,
      phase: PHASE,
      role: config.role,
      uptimeMs: Date.now() - STARTED_AT
    }
  }));

  router.get(`${API_PREFIX}/bootstrap`, () => ({
    body: {
      product: PRODUCT_NAME,
      version: VERSION,
      phase: PHASE,
      phaseLabel: PHASE_LABEL,
      role: config.role,
      user: localUser(),
      capabilities: {
        projects: true,
        assets: true,
        tasks: true,
        bindings: true,
        archive: config.archive.kind,
        hub: Boolean(config.hub.url)
      }
    }
  }));

  router.get(`${API_PREFIX}/projects`, async () => ({
    body: {projects: await usecases.projects.list()}
  }));

  router.post(`${API_PREFIX}/projects`, async ({body}) => {
    const result = await usecases.projects.create({
      title: body?.title,
      mokuProjectId: body?.mokuProjectId || null,
      externalKey: body?.externalKey || null,
      format: body?.format || 'webtoon'
    });
    return {status: result.created ? 201 : 200, body: result};
  });

  router.get(`${API_PREFIX}/projects/:projectId`, async ({params}) => ({
    body: {project: await usecases.projects.get({projectId: params.projectId})}
  }));

  router.post(`${API_PREFIX}/projects/:projectId/link`, async ({params, body}) => ({
    body: {
      project: await usecases.projects.link({
        projectId: params.projectId,
        mokuProjectId: body?.mokuProjectId,
        expectedVersion: body?.expectedVersion,
        force: body?.force === true
      })
    }
  }));

  router.post(`${API_PREFIX}/projects/:projectId/rename`, async ({params, body}) => ({
    body: {
      project: await usecases.projects.rename({
        projectId: params.projectId,
        title: body?.title,
        expectedVersion: body?.expectedVersion
      })
    }
  }));

  router.get(`${API_PREFIX}/projects/:projectId/episodes`, async ({params}) => ({
    body: {episodes: await usecases.episodes.list({projectId: params.projectId})}
  }));

  router.get(`${API_PREFIX}/projects/:projectId/assets`, async ({params}) => ({
    body: {assets: await usecases.assets.list({projectId: params.projectId})}
  }));

  router.post(`${API_PREFIX}/projects/:projectId/episodes`, async ({params, body}) => ({
    status: 201,
    body: {
      episode: await usecases.episodes.create({
        projectId: params.projectId,
        number: body?.number,
        ownerUserId: body?.ownerUserId ?? null
      })
    }
  }));

  // 提交缺失资产批次：202 只表示已收单，不表示已生成。
  router.post(`${API_PREFIX}/projects/:projectId/asset-requests`, async ({params, body}) => ({
    status: 202,
    body: await usecases.tasks.submit({
      projectId: params.projectId,
      episodeId: body?.episodeId ?? null,
      requester: body?.requester ?? localUser().name,
      clientRequestId: body?.clientRequestId ?? null,
      items: body?.items ?? []
    })
  }));

  router.get(`${API_PREFIX}/projects/:projectId/tasks`, async ({params}) => ({
    body: {tasks: await usecases.tasks.list({projectId: params.projectId})}
  }));

  router.get(`${API_PREFIX}/tasks/:taskId`, async ({params}) => ({
    body: {task: await usecases.tasks.get({taskId: params.taskId})}
  }));

  router.post(`${API_PREFIX}/tasks/:taskId/review`, async ({params, body}) => ({
    body: {
      task: await usecases.tasks.review({
        taskId: params.taskId,
        decision: body?.decision,
        reason: body?.reason,
        reviewer: body?.reviewer ?? localUser().name
      })
    }
  }));

  router.get(`${API_PREFIX}/projects/:projectId/bindings`, async ({params}) => ({
    body: {bindings: await usecases.tasks.listBindings({projectId: params.projectId})}
  }));

  router.post(`${API_PREFIX}/projects/:projectId/bindings`, async ({params, body}) => ({
    status: 201,
    body: {
      binding: await usecases.tasks.adopt({
        projectId: params.projectId,
        panelId: body?.panelId,
        assetKey: body?.assetKey,
        revisionId: body?.revisionId,
        mode: body?.mode ?? 'auto',
        locked: body?.locked === true,
        force: body?.force === true
      })
    }
  }));

  router.get(`${API_PREFIX}/executors`, () => ({
    body: {executors: executors.list()}
  }));

  // ---------------- 执行节点 ----------------

  router.get(`${API_PREFIX}/workers`, async ({request}) => {
    requireWorkerToken(request, config);
    return {body: {workers: await usecases.workers.list()}};
  });

  router.post(`${API_PREFIX}/workers/register`, async ({request, body}) => {
    requireWorkerToken(request, config);
    return {
      status: 201,
      body: {
        worker: await usecases.workers.register({
          machineId: body?.machineId,
          poolId: body?.poolId,
          capacity: body?.capacity,
          reserve: body?.reserve
        })
      }
    };
  });

  router.post(`${API_PREFIX}/workers/:workerId/heartbeat`, async ({request, params, body}) => {
    requireWorkerToken(request, config);
    return {
      body: {
        worker: await usecases.workers.heartbeat({
          workerId: params.workerId,
          ready: body?.ready,
          capacity: body?.capacity,
          reserve: body?.reserve
        })
      }
    };
  });

  router.post(`${API_PREFIX}/workers/:workerId/claim`, async ({request, params}) => {
    requireWorkerToken(request, config);
    return {
      body: {claim: await usecases.tasks.claim({workerId: params.workerId})}
    };
  });

  router.post(`${API_PREFIX}/attempts/:attemptId/started`, async ({request, params, body}) => {
    requireWorkerToken(request, config);
    return {
      body: await usecases.tasks.start({
        attemptId: params.attemptId,
        leaseId: body?.leaseId
      })
    };
  });

  router.post(`${API_PREFIX}/attempts/:attemptId/result`, async ({request, params, body}) => {
    requireWorkerToken(request, config);
    const bytes = Buffer.from(String(body?.imageBase64 ?? ''), 'base64');
    if (!bytes.length) throw fail.invalid('结果为空');
    const result = await usecases.tasks.complete({
      attemptId: params.attemptId,
      leaseId: body?.leaseId,
      bytes,
      mime: body?.mime || 'image/png',
      engineJobId: body?.engineJobId ?? null
    });
    return {
      status: 201,
      body: {task: result.task, revision: result.revision}
    };
  }, {maxBytes: 48 * 1024 * 1024});

  router.post(`${API_PREFIX}/attempts/:attemptId/fail`, async ({request, params, body}) => {
    requireWorkerToken(request, config);
    await usecases.tasks.fail({
      attemptId: params.attemptId,
      leaseId: body?.leaseId,
      message: body?.message,
      started: body?.started === true
    });
    return {body: {ok: true}};
  });

  router.get(`${API_PREFIX}/events`, async ({query}) => ({
    body: await usecases.events.after({
      after: query.get('after') ?? 0,
      limit: query.get('limit') ?? 200
    })
  }));

  // 内容寻址的文件读取：固定 sha256，浏览器可直接缓存；不存在就明确 404。
  router.get(`${API_PREFIX}/blobs/:sha256`, async ({params}) => {
    const sha256 = String(params.sha256 ?? '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw fail.invalid('sha256 格式不正确');
    const stat = await archive.stat(sha256);
    if (!stat) throw fail.notFound('文件不存在');
    const bytes = await archive.get(sha256);
    return {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: `"${sha256}"`,
        'Content-Disposition': 'inline'
      },
      raw: {bytes, mime: sniffImageMime(bytes)}
    };
  });

  router.get(`${API_PREFIX}/diagnostics`, () => ({
    body: {
      version: VERSION,
      phase: PHASE,
      uptimeMs: Date.now() - STARTED_AT,
      config: describeConfig(config),
      routes: router.list()
    }
  }));

  return router;
}

function localUser() {
  const name = process.env.USERNAME || process.env.USER || '本机用户';
  return {id: 'user_local', name, scope: 'local'};
}

function requireWorkerToken(request, config) {
  const token = String(config.hub?.workerToken ?? '');
  if (!token) return;
  const header = String(request?.headers?.authorization ?? '');
  if (header !== `Bearer ${token}`) {
    throw fail.unauthorized('节点令牌无效');
  }
}
