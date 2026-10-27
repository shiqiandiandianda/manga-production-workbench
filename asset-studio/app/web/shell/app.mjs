/**
 * 唯一前端外壳（阶段 1）。
 *
 * 目标：一个入口、一个项目上下文、一个任务徽标。
 * 当前只读展示项目/话数/资产；任务、规范、变更在后续阶段接入。
 */
import {api} from '../lib/api.mjs';

const ROLE_LABELS = Object.freeze({character: '角色', scene: '场景', prop: '道具', style: '风格'});
const ROLE_ORDER = ['character', 'scene', 'prop', 'style'];
const STAGE_LABELS = Object.freeze({
  script: '资料准备',
  assets: '资产',
  storyboard: '分镜',
  layout: '排版',
  generation: '生图',
  repair: '修图',
  review: '审核',
  export: '导出',
  done: '交付'
});
const TASK_STATE_LABELS = Object.freeze({
  queued: '入队',
  claimed: '已领取',
  preparing: '准备中',
  running: '运行中',
  uploading: '上传中',
  review: '待审核',
  approved: '已批准',
  rejected: '已退回',
  applied: '已应用',
  failed: '失败',
  uncertain: '待核实',
  cancelled: '已取消'
});
const STANDARD_GROUPS = [
  ['visual', '画风与固定参考'],
  ['characters', '角色身份与状态'],
  ['continuity', '场景与道具连续性'],
  ['layout', '画板与格间距'],
  ['typography', '字号、字体、行距'],
  ['dialogue', '对白与气泡'],
  ['images', '图片规格'],
  ['prompts', '提示词约束'],
  ['review', '质量审核'],
  ['naming', '命名与版本'],
  ['delivery', '交付与导出'],
  ['permissions', '人员权限'],
  ['revision', '变更策略']
];
const DRAWERS = [
  {id: 'assets', label: '资产'},
  {id: 'tasks', label: '任务'},
  {id: 'standards', label: '规范'},
  {id: 'progress', label: '进度'},
  {id: 'changes', label: '变更'},
  {id: 'admin', label: '管理'}
];

const state = {
  bootstrap: null,
  projects: [],
  projectId: null,
  project: null,
  episodes: [],
  assets: [],
  tasks: [],
  executors: [],
  drawer: 'assets',
  drawerOpen: true,
  error: null,
  notice: null,
  diagnostics: null,
  busy: false
};

const root = document.querySelector('#app');
const dialog = document.querySelector('#new-project-dialog');
const form = document.querySelector('#new-project-form');

root.addEventListener('click', event => void onClick(event));
form.addEventListener('submit', event => void onCreateProject(event));
document.querySelector('[data-close]').addEventListener('click', () => dialog.close());

boot().catch(error => {
  state.error = error;
  render();
});

/* -------------------------------- 数据 -------------------------------- */

async function boot() {
  const [bootstrap, projects, executors] = await Promise.all([
    api('/api/v1/bootstrap'),
    api('/api/v1/projects'),
    api('/api/v1/executors')
  ]);
  state.bootstrap = bootstrap;
  state.projects = projects.projects;
  state.executors = executors.executors;
  if (!state.projects.some(project => project.id === state.projectId)) {
    state.projectId = state.projects[0]?.id ?? null;
  }
  await loadProject();
  state.error = null;
  render();
}

async function loadProject() {
  state.project = null;
  state.episodes = [];
  state.assets = [];
  state.tasks = [];
  state.diagnostics = null;
  if (!state.projectId) return;

  const id = encodeURIComponent(state.projectId);
  const [project, episodes, assets, tasks] = await Promise.all([
    api(`/api/v1/projects/${id}`),
    api(`/api/v1/projects/${id}/episodes`),
    api(`/api/v1/projects/${id}/assets`),
    api(`/api/v1/projects/${id}/tasks`)
  ]);
  state.project = project.project;
  state.episodes = episodes.episodes;
  state.assets = assets.assets;
  state.tasks = tasks.tasks;
}

async function linkProject() {
  if (!state.project) return;
  const input = document.querySelector('#moku-input');
  const mokuProjectId = String(input?.value ?? '').trim();
  if (!mokuProjectId) {
    const error = new Error('请填写墨库项目编号');
    error.code = 'INVALID_INPUT';
    throw error;
  }
  const payload = await api(`/api/v1/projects/${encodeURIComponent(state.project.id)}/link`, {
    method: 'POST',
    body: {
      mokuProjectId,
      expectedVersion: state.project.objectVersion
    }
  });
  state.project = payload.project;
  const index = state.projects.findIndex(item => item.id === payload.project.id);
  if (index >= 0) state.projects[index] = payload.project;
  state.error = null;
}

async function loadDiagnostics() {
  state.diagnostics = await api('/api/v1/diagnostics');
}

/* -------------------------------- 动作 -------------------------------- */

async function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'new-project') {
    if (!dialog.open) dialog.showModal();
    return;
  }
  if (action === 'refresh') {
    await run(boot);
    return;
  }
  if (action === 'drawer') {
    state.drawer = target.dataset.drawer || 'assets';
    render();
    return;
  }
  if (action === 'toggle-drawer') {
    state.drawerOpen = !state.drawerOpen;
    render();
    return;
  }
  if (action === 'dismiss-error') {
    state.error = null;
    render();
    return;
  }
  if (action === 'dismiss-notice') {
    state.notice = null;
    render();
    return;
  }
  if (action === 'link') {
    await run(linkProject);
    return;
  }
  if (action === 'refresh-tasks') {
    await run(refreshTasks);
    return;
  }
  if (action === 'approve-task') {
    await run(() => reviewTask(target.dataset.taskId, 'approve'));
    return;
  }
  if (action === 'reject-task') {
    await run(() => reviewTask(target.dataset.taskId, 'reject'));
    return;
  }
  if (action === 'diagnostics') {
    await run(loadDiagnostics);
  }
}

async function onCreateProject(event) {
  event.preventDefault();
  const data = new FormData(form);
  const title = String(data.get('title') ?? '').trim();
  const mokuProjectId = String(data.get('mokuProjectId') ?? '').trim();
  if (!title) return;

  await run(async () => {
    const payload = await api('/api/v1/projects', {
      method: 'POST',
      body: {title, mokuProjectId: mokuProjectId || null}
    });
    dialog.close();
    form.reset();
    const index = state.projects.findIndex(item => item.id === payload.project.id);
    if (index >= 0) state.projects[index] = payload.project;
    else state.projects.push(payload.project);
    state.projectId = payload.project.id;
    await loadProject();
  });
}

async function run(task) {
  state.busy = true;
  try {
    await task();
    state.error = null;
  } catch (error) {
    state.error = error;
  } finally {
    state.busy = false;
  }
  render();
}

async function refreshTasks() {
  if (!state.project) return;
  const payload = await api(`/api/v1/projects/${encodeURIComponent(state.project.id)}/tasks`);
  state.tasks = payload.tasks;
}

async function submitAsset() {
  if (!state.project) return;
  const role = document.querySelector('#task-role')?.value ?? 'character';
  const name = String(document.querySelector('#task-name')?.value ?? '').trim();
  const shape = String(document.querySelector('#task-state')?.value ?? '').trim();
  const prompt = String(document.querySelector('#task-prompt')?.value ?? '').trim();
  const executor = document.querySelector('#task-executor')?.value ?? 'fake';
  if (!name) throw new Error('请填写资产名称');
  if (!prompt) throw new Error('请填写提示词');

  await api(`/api/v1/projects/${encodeURIComponent(state.project.id)}/asset-requests`, {
    method: 'POST',
    body: {
      items: [{role, name, state: shape, view: '', prompt, executor}]
    }
  }).then(result => {
    if (result.accepted === 0 && result.reused === 0) {
      const reason = result.blockedItems?.[0]?.reason ?? '没有入队';
      throw new Error(`未入队：${reason}`);
    }
    state.notice = result.reused > 0
      ? `已复用批准版本 ×${result.reused}，没有新建任务`
      : `已入队 ${result.accepted} 项`;
  });
  await refreshTasks();
  setTimeout(() => {
    void refreshTasks().then(render).catch(() => {});
  }, 900);
}

async function reviewTask(taskId, decision) {
  if (!taskId) return;
  let reason = '';
  if (decision === 'reject') {
    reason = window.prompt('退回原因（必填）') ?? '';
    if (!reason.trim()) return;
  }
  await api(`/api/v1/tasks/${encodeURIComponent(taskId)}/review`, {
    method: 'POST',
    body: {decision, reason}
  });
  state.notice = decision === 'approve' ? '已批准，该版本成为资产生效版本' : '已退回';
  await loadProject();
}

async function selectProject(projectId) {
  state.projectId = projectId || null;
  await loadProject();
}

/* -------------------------------- 渲染 -------------------------------- */

function render() {
  const children = [
    renderTopbar(),
    h('main', {class: 'workspace'}, renderRail(), renderCanvas(), renderInspector()),
    renderDrawer()
  ];
  if (state.error) children.push(renderBanner());
  else if (state.notice) children.push(renderNotice());
  root.replaceChildren(...children);
}

function renderTopbar() {
  const projects = state.projects.length
    ? state.projects.map(project => h('option', {
        value: project.id,
        selected: project.id === state.projectId
      }, project.title))
    : [h('option', {value: ''}, '尚无项目')];

  const linked = Boolean(state.project?.mokuProjectId);

  return h('header', {class: 'topbar'},
    h('div', {class: 'brand'},
      h('span', {class: 'brand-title'}, state.bootstrap?.product ?? '漫画生产平台'),
      h('span', {class: 'brand-phase'}, state.bootstrap?.phaseLabel ?? '阶段 1 · 骨架可运行')
    ),
    h('div', {class: 'context'},
      h('select', {
        class: 'select',
        id: 'project-select',
        'aria-label': '选择项目',
        disabled: !state.projects.length,
        onchange: event => {
          const value = event.target.value;
          void run(() => selectProject(value));
        }
      }, projects),
      h('button', {
        class: 'button ghost',
        type: 'button',
        'data-action': 'new-project'
      }, '新建项目')
    ),
    h('div', {class: 'topbar-spacer'}),
    h('div', {class: 'status'},
      h('span', {class: 'chip'},
        h('span', {class: `chip-dot ${state.bootstrap ? '' : 'off'}`}),
        state.bootstrap ? '本机' : '未连接'
      ),
      h('span', {class: 'chip'},
        h('span', {class: `chip-dot ${linked ? '' : 'warn'}`}),
        linked ? '墨库已关联' : '墨库未关联'
      ),
      h('span', {class: 'chip'}, `任务 ${state.tasks.length}`),
      h('span', {class: 'user'}, state.bootstrap?.user?.name ?? '')
    )
  );
}

function renderRail() {
  const items = state.episodes.length
    ? state.episodes.map(episode => h('div', {class: 'rail-item'},
        h('span', {}, `第 ${episode.number} 话`),
        h('span', {class: 'stage'}, STAGE_LABELS[episode.stage] ?? episode.stage)
      ))
    : [h('div', {class: 'rail-empty'}, state.project ? '尚未导入话数' : '先创建项目')];

  return h('aside', {class: 'rail'},
    h('h2', {class: 'section-title'}, '话数'),
    h('div', {class: 'rail-list'}, items)
  );
}

function renderCanvas() {
  if (!state.project) {
    return h('section', {class: 'canvas'},
      h('div', {class: 'empty-state'},
        h('h2', {}, '还没有项目'),
        h('p', {}, '项目是唯一的上下文：话数、规范、资产、任务、绑定都挂在它上面。先创建一个，或者刷新读取已有数据。'),
        h('div', {class: 'empty-actions'},
          h('button', {class: 'button primary', type: 'button', 'data-action': 'new-project'}, '新建项目'),
          h('button', {class: 'button ghost', type: 'button', 'data-action': 'refresh'}, '刷新')
        )
      )
    );
  }

  const project = state.project;
  const episodeLabel = state.episodes.length ? `第 ${state.episodes[0].number} 话` : '未分话';
  const panels = [
    {height: 220, label: '开场 · 全景', note: '1280 × 720'},
    {height: 340, label: '人物 · 中景', note: '1280 × 960'},
    {height: 180, label: '特写', note: '全宽破格', bleed: true},
    {height: 420, label: '冲突 · 动作', note: '1280 × 1200'},
    {height: 260, label: '收尾 · 留白', note: '1280 × 760'}
  ];

  return h('section', {class: 'canvas'},
    h('div', {class: 'webtoon-stage'},
      h('div', {class: 'webtoon-strip'},
        h('header', {class: 'webtoon-head'},
          h('div', {},
            h('h1', {class: 'paper-title'}, project.title),
            h('p', {class: 'paper-sub'},
              `${episodeLabel} · 长条漫画 · 竖向连续阅读 · 画板宽 1280px · 高度可变`)
          ),
          h('div', {class: 'paper-meta'},
            h('span', {class: 'badge'}, `${state.assets.length} 项资产`),
            h('span', {class: 'badge neutral'}, project.mokuProjectId ? '墨库已关联' : '未关联墨库'),
            h('span', {class: 'badge neutral'}, `v${project.objectVersion}`)
          )
        ),
        h('div', {class: 'webtoon-panels'},
          panels.map((panel, index) => h('div', {
            class: `webtoon-panel ${panel.bleed ? 'full-bleed' : ''}`,
            style: {height: `${panel.height}px`}
          },
            h('span', {class: 'webtoon-index'}, `第 ${index + 1} 格`),
            h('span', {class: 'webtoon-label'}, panel.label),
            h('span', {class: 'webtoon-note'}, panel.note)
          ))
        ),
        h('div', {class: 'webtoon-end'}, '本话结束 · 向下滚动阅读'),
        h('div', {class: 'paper-note'},
          '长条漫画的阅读单位是“话”，不是固定页：画格纵向排列、高度可变，允许全宽破格与留白。当前阶段 3 已通项目、旧工程只读与任务闭环；真实画布、对白与导出在阶段 4 迁入。'
        )
      )
    )
  );
}

function renderInspector() {
  if (!state.project) {
    return h('aside', {class: 'inspector'},
      h('h2', {class: 'section-title'}, '检查器'),
      h('p', {class: 'muted'}, '选择项目后显示属性。')
    );
  }

  const project = state.project;
  return h('aside', {class: 'inspector'},
    h('div', {class: 'inspector-block'},
      h('h2', {class: 'section-title'}, '项目'),
      h('div', {class: 'kv'},
        h('span', {class: 'kv-key'}, '名称'),
        h('span', {class: 'kv-value'}, project.title),
        h('span', {class: 'kv-key'}, '编号'),
        h('span', {class: 'kv-value mono'}, project.id),
        h('span', {class: 'kv-key'}, '墨库'),
        h('span', {class: 'kv-value mono'}, project.mokuProjectId || '未关联'),
        h('span', {class: 'kv-key'}, '版式'),
        h('span', {class: 'kv-value'}, project.format === 'page' ? '页漫（page）' : '长条漫画（webtoon）'),
        h('span', {class: 'kv-key'}, '版本'),
        h('span', {class: 'kv-value'}, String(project.objectVersion)),
        h('span', {class: 'kv-key'}, '创建'),
        h('span', {class: 'kv-value'}, formatTime(project.createdAt))
      )
    ),
    h('div', {class: 'inspector-block'},
      h('h2', {class: 'section-title'}, '下一步'),
      h('div', {class: 'kv'},
        h('span', {class: 'kv-key'}, '当前'),
        h('span', {class: 'kv-value'}, '旧工程只读 + 任务闭环'),
        h('span', {class: 'kv-key'}, '阶段 4'),
        h('span', {class: 'kv-value'}, '长条画布 / 对白 / 导出'),
        h('span', {class: 'kv-key'}, '阶段 5'),
        h('span', {class: 'kv-value'}, '墨库固定版本与归档')
      )
    )
  );
}

function renderDrawer() {
  const tabs = DRAWERS.map(item => h('button', {
    class: `tab ${state.drawer === item.id ? 'active' : ''}`,
    type: 'button',
    'data-action': 'drawer',
    'data-drawer': item.id
  }, item.label));

  return h('section', {class: `drawer ${state.drawerOpen ? '' : 'collapsed'}`},
    h('div', {class: 'drawer-head'},
      h('div', {class: 'tabs'}, tabs),
      h('button', {
        class: 'button ghost',
        type: 'button',
        'data-action': 'toggle-drawer'
      }, state.drawerOpen ? '收起' : '展开')
    ),
    state.drawerOpen ? h('div', {class: 'drawer-body'}, renderPanel()) : null
  );
}

function renderPanel() {
  switch (state.drawer) {
    case 'tasks':
      return renderTasks();
    case 'standards':
      return renderStandards();
    case 'progress':
      return renderProgress();
    case 'changes':
      return renderChanges();
    case 'admin':
      return renderAdmin();
    default:
      return renderAssets();
  }
}

function renderAssets() {
  if (!state.project) return h('p', {class: 'muted'}, '先选择或新建项目。');
  if (!state.assets.length) {
    return h('div', {},
      h('div', {class: 'stat-grid'},
        h('div', {class: 'stat'}, h('div', {class: 'stat-value'}, '0'), h('div', {class: 'stat-label'}, '已登记资产')),
        h('div', {class: 'stat'}, h('div', {class: 'stat-value'}, '0'), h('div', {class: 'stat-label'}, '已批准版本')),
        h('div', {class: 'stat'}, h('div', {class: 'stat-value'}, '0'), h('div', {class: 'stat-label'}, '缺失需求'))
      ),
      h('p', {class: 'muted', style: {marginTop: '12px'}},
        '本项目还没有登记资产。阶段 2 会按固定 revisionId 从墨库导入；阶段 3 才会提交缺失需求并生成候选。'
      )
    );
  }

  const groups = ROLE_ORDER
    .map(role => ({role, items: state.assets.filter(asset => asset.role === role)}))
    .filter(group => group.items.length);

  return h('div', {}, groups.map(group => h('div', {class: 'asset-group'},
    h('h3', {}, `${ROLE_LABELS[group.role] ?? group.role} · ${group.items.length}`),
    h('div', {class: 'asset-grid'}, group.items.map(renderAssetCard))
  )));
}

function renderAssetCard(asset) {
  const latest = asset.revisions[asset.revisions.length - 1];
  const shape = [asset.state, asset.view].filter(Boolean).join(' · ') || '默认形态';
  return h('article', {class: 'asset-card'},
    latest
      ? h('img', {
          class: 'asset-thumb',
          src: `/api/v1/blobs/${latest.sha256}`,
          alt: asset.name,
          loading: 'lazy',
          decoding: 'async'
        })
      : h('div', {class: 'asset-thumb placeholder'}, '无版本'),
    h('div', {class: 'asset-role'}, ROLE_LABELS[asset.role] ?? asset.role),
    h('div', {class: 'asset-name'}, asset.name),
    h('div', {class: 'asset-meta'}, shape),
    latest
      ? h('div', {class: 'asset-rev'},
          `rev ${shortRevision(latest.revisionId)} · ${latest.status === 'approved' ? '已批准' : '候选'}`)
      : h('div', {class: 'asset-rev muted'}, '尚未登记版本')
  );
}

function renderTasks() {
  if (!state.project) return h('p', {class: 'muted'}, '先选择或新建项目。');

  const active = state.tasks.filter(task =>
    ['queued', 'claimed', 'preparing', 'running', 'uploading'].includes(task.state)).length;
  const review = state.tasks.filter(task => task.state === 'review').length;
  const approved = state.tasks.filter(task => ['approved', 'applied'].includes(task.state)).length;

  return h('div', {},
    h('div', {class: 'stat-grid'},
      h('div', {class: 'stat'}, h('div', {class: 'stat-value'}, String(active)), h('div', {class: 'stat-label'}, '处理中')),
      h('div', {class: 'stat'}, h('div', {class: 'stat-value'}, String(review)), h('div', {class: 'stat-label'}, '待审核')),
      h('div', {class: 'stat'}, h('div', {class: 'stat-value'}, String(approved)), h('div', {class: 'stat-label'}, '已批准'))
    ),
    h('form', {
      class: 'task-form',
      onsubmit: event => {
        event.preventDefault();
        void run(submitAsset);
      }
    },
      h('div', {class: 'form-row'},
        h('select', {class: 'select', id: 'task-role'},
          h('option', {value: 'character'}, '角色'),
          h('option', {value: 'scene'}, '场景'),
          h('option', {value: 'prop'}, '道具')
        ),
        h('input', {class: 'input', id: 'task-name', placeholder: '资产名称，例：李明', autocomplete: 'off'}),
        h('input', {class: 'input', id: 'task-state', placeholder: '形态，例：校服', autocomplete: 'off'})
      ),
      h('div', {class: 'form-row'},
        h('input', {class: 'input', id: 'task-prompt', placeholder: '生成提示词', autocomplete: 'off'}),
        h('select', {class: 'select', id: 'task-executor'},
          (state.executors.length ? state.executors : [{id: 'fake', label: '假执行器（不耗额度）'}])
            .map(executor => h('option', {value: executor.id}, executor.label ?? executor.id))
        ),
        h('button', {class: 'button primary', type: 'submit'}, '提交缺失资产')
      ),
      h('p', {class: 'hint'}, '当前使用假执行器：只验证任务链，不调用 AI、不消耗额度。')
    ),
    h('div', {class: 'task-list-head'},
      h('h3', {}, `任务 ${state.tasks.length}`),
      h('button', {class: 'button ghost', type: 'button', 'data-action': 'refresh-tasks'}, '刷新')
    ),
    state.tasks.length
      ? h('div', {class: 'task-list'}, state.tasks.map(renderTaskRow))
      : h('p', {class: 'muted'}, '还没有任务。提交一项缺失资产试试。')
  );
}

function renderTaskRow(task) {
  const manifest = task.inputManifest ?? {};
  const revision = task.revision;
  const shape = [manifest.state, manifest.view].filter(Boolean).join(' · ') || '默认形态';
  const label = TASK_STATE_LABELS[task.state] ?? task.state;
  return h('article', {class: 'task-row'},
    revision
      ? h('img', {
          class: 'task-thumb',
          src: `/api/v1/blobs/${revision.sha256}`,
          alt: manifest.name ?? '',
          loading: 'lazy'
        })
      : h('div', {class: 'task-thumb placeholder'}, '—'),
    h('div', {class: 'task-main'},
      h('div', {class: 'task-title'}, `${manifest.name ?? task.assetKey} · ${shape}`),
      h('div', {class: 'task-meta'},
        h('span', {class: `task-state state-${task.state}`}, label),
        ` ${manifest.role ?? ''} · ${task.subscribers} 人订阅`,
        task.reviewReason ? ` · ${task.reviewReason}` : ''
      ),
      revision
        ? h('div', {class: 'task-rev'},
            `rev ${shortRevision(revision.revisionId)} · ${revision.status === 'approved' ? '已批准' : '候选'} · ${Math.max(1, Math.round(revision.size / 1024))}KB`)
        : null
    ),
    h('div', {class: 'task-actions'},
      task.state === 'review'
        ? h('button', {class: 'button primary', type: 'button', 'data-action': 'approve-task', 'data-task-id': task.id}, '批准')
        : null,
      task.state === 'review'
        ? h('button', {class: 'button ghost', type: 'button', 'data-action': 'reject-task', 'data-task-id': task.id}, '退回')
        : null
    )
  );
}

function renderStandards() {
  return h('div', {},
    h('p', {class: 'muted'}, '项目规范尚未发布。规范正文保存为墨库文档，任务入队时冻结固定 documentRevisionId。'),
    h('div', {class: 'asset-grid'},
      STANDARD_GROUPS.map(([key, label]) => h('div', {class: 'asset-card'},
        h('div', {class: 'asset-name'}, label),
        h('div', {class: 'asset-meta'}, key),
        h('div', {class: 'asset-rev muted'}, '未发布')
      ))
    )
  );
}

function renderProgress() {
  if (!state.episodes.length) {
    return h('p', {class: 'muted'}, '尚未导入话数。阶段 2 会从旧工程迁移话数、负责人与阶段。');
  }
  return h('div', {class: 'stat-grid'},
    state.episodes.map(episode => h('div', {class: 'stat'},
      h('div', {class: 'stat-value'}, String(episode.number)),
      h('div', {class: 'stat-label'}, `${STAGE_LABELS[episode.stage] ?? episode.stage} · ${episode.ownerUserId ?? '未分配负责人'}`)
    ))
  );
}

function renderChanges() {
  return h('div', {},
    h('p', {class: 'muted'}, '变更影响预览在阶段 5 接入：先登记 oldRevisionId / newRevisionId，再按依赖列出受影响的话数、画格与负责人。'),
    h('button', {class: 'button ghost', type: 'button', disabled: true}, '预览影响（阶段 5）')
  );
}

function renderAdmin() {
  if (!state.project) return h('p', {class: 'muted'}, '先选择或新建项目。');
  const project = state.project;

  return h('div', {},
    h('div', {class: 'panel-block'},
      h('h3', {}, '关联墨库项目'),
      h('p', {class: 'muted'},
        project.mokuProjectId
          ? `当前关联：${project.mokuProjectId}。改绑需要明确确认，已采用的固定版本不会自动漂移。`
          : '尚未关联。关联由人确认一次，之后按稳定 projectId 读取资产与文档。'
      ),
      h('div', {class: 'form-row'},
        h('input', {
          class: 'input',
          id: 'moku-input',
          placeholder: '墨库 projectId',
          autocomplete: 'off',
          value: project.mokuProjectId ?? ''
        }),
        h('button', {
          class: 'button primary',
          type: 'button',
          'data-action': 'link'
        }, project.mokuProjectId ? '改绑' : '关联')
      )
    ),
    h('div', {class: 'panel-block'},
      h('h3', {}, '诊断'),
      h('p', {class: 'muted'}, '读取本进程的有效配置与路由表。不会返回任何密钥。'),
      h('button', {class: 'button ghost', type: 'button', 'data-action': 'diagnostics'}, '读取诊断'),
      state.diagnostics ? h('pre', {class: 'code'}, JSON.stringify(state.diagnostics, null, 2)) : null
    )
  );
}

function renderNotice() {
  return h('div', {class: 'banner ok', role: 'status'},
    h('div', {}, state.notice),
    h('button', {class: 'button ghost', type: 'button', 'data-action': 'dismiss-notice'}, '关闭')
  );
}

function renderBanner() {
  const error = state.error;
  return h('div', {class: 'banner', role: 'alert'},
    h('div', {},
      h('strong', {}, error.code ?? 'ERROR'),
      error.message,
      error.requestId ? ` · ${error.requestId}` : ''
    ),
    h('button', {class: 'button ghost', type: 'button', 'data-action': 'dismiss-error'}, '关闭')
  );
}

/* -------------------------------- DOM -------------------------------- */

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
    else if (key === 'value') element.value = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, String(value));
  }
  append(element, children);
  return element;
}

function append(element, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(element, child);
    else if (child instanceof Node) element.appendChild(child);
    else element.appendChild(document.createTextNode(String(child)));
  }
}

function shortRevision(value) {
  const text = String(value ?? '');
  return text.length <= 12 ? text : text.slice(0, 12);
}

function formatTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
