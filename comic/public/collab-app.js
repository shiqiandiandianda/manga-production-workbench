/*
 * PhotoCraft 漫画工作台 · 协作生图页（由 18896 漫画服务静态托管，纯静态、无框架、无外链）。
 * 接口契约：开发/协作/协议与设计.md §7.2（A 端提交与回填）+ 现有 GET /api/state。
 * 页面只调用本机漫画服务的 /api/collab/* 代理接口，不直接连中控，也不接触 token。
 */
(function () {
  'use strict';

  var POLL_MS = 2000;
  var MAX_NOTIFICATIONS = 500;
  var FLASH_KEY = 'photocraft.collab.page.flash';
  var PROJECT_KEY = 'comic-active-project';

  // 协议 §7.2 白名单内的代理路径 + 现有 /api/state（ui-smoke.test.mjs 会扫描并对照白名单）。
  var API = {
    state: '/api/state',
    status: '/api/collab/status',
    config: '/api/collab/config',
    pair: '/api/collab/pair',
    distribute: '/api/collab/distribute',
    tasks: '/api/collab/tasks',
    task: function (id) { return `/api/collab/tasks/${encodeURIComponent(id)}`; },
    taskRetry: function (id) { return `/api/collab/tasks/${encodeURIComponent(id)}/retry`; },
    taskCancel: function (id) { return `/api/collab/tasks/${encodeURIComponent(id)}/cancel`; },
    applyChoice: function (id) { return `/api/collab/tasks/${encodeURIComponent(id)}/apply-choice`; },
    assets: '/api/collab/assets',
    asset: function (id) { return `/api/collab/assets/${encodeURIComponent(id)}`; },
    assetThumb: function (id) { return `/api/collab/assets/${encodeURIComponent(id)}/thumb`; },
    assetDownload: function (id) { return `/api/collab/assets/${encodeURIComponent(id)}/download`; },
    notifications: '/api/collab/notifications',
    notificationsRead: '/api/collab/notifications/read'
  };

  var TASK_STATUS_LABEL = {queued: '排队中', running: '执行中', uploading: '上传中', verifying: '待核实', done: '已完成', failed: '失败', cancelled: '已取消'};
  var PHASE_LABEL = {queued: '排队', claimed: '已领取', generating: '生成中', uploading: '上传中', verifying: '核实中', done: '完成', failed: '失败', cancelled: '取消'};
  var APPLY_LABEL = {pending: '待回填', applied: '已回填', conflict: '冲突', candidate: '仅候选', failed: '回填失败', skipped: '已丢弃'};
  var ATTEMPT_LABEL = {claimed: '已领取', generating: '生成中', uploading: '上传中', upload_failed: '上传失败', unknown: '状态未知', succeeded: '成功', failed: '失败', abandoned: '已放弃'};
  var ASSET_KIND_LABEL = {character: '角色', prop: '道具', scene: '场景', style: '画风', panel: '画格', other: '其他'};
  var ASSET_STATUS_LABEL = {available: '可用', pending: '生成中', failed: '失败'};
  var NOTICE_TYPE_LABEL = {
    'task.done': '任务完成', 'task.failed': '任务失败', 'task.conflict': '回填冲突',
    'task.verifying': '任务待核实', 'task.late_result': '迟到结果', 'asset.created': '资产入库',
    'node.online': '节点上线', 'node.offline': '节点离线', 'node.revoked': '节点吊销',
    'apply.applied': '已回填', 'apply.conflict': '回填冲突', 'apply.failed': '回填失败'
  };

  var state = {
    config: {},
    status: {},
    projects: [],
    currentProjectId: '',
    selectedPanels: {},
    tasks: [],
    tasksTotal: 0,
    assets: [],
    assetsTotal: 0,
    notifications: [],
    lastSeq: 0,
    taskFilter: {status: '', projectId: ''},
    assetFilter: {q: '', kind: '', projectId: ''},
    drawerKind: '',
    drawerId: '',
    timer: null,
    busy: false,
    lastTasksError: '',
    lastStatusError: ''
  };

  // ---------------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------------
  function qs(selector, root) { return (root || document).querySelector(selector); }
  function qsa(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function shortId(value) {
    var text = String(value || '');
    if (!text) return '—';
    return text.replace(/^(task|node|asset|client|blob|panel|project)_/, '').slice(0, 8);
  }

  function pad2(value) { return String(value).padStart(2, '0'); }

  function fmtTime(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return String(date.getFullYear()).slice(2) + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
  }

  function fmtRelative(value) {
    if (!value) return '—';
    var time = new Date(value).getTime();
    if (!isFinite(time)) return '—';
    var diff = Date.now() - time;
    if (diff < 0) diff = 0;
    if (diff < 1500) return '刚刚';
    if (diff < 60000) return Math.round(diff / 1000) + ' 秒前';
    if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前';
    return Math.round(diff / 86400000) + ' 天前';
  }

  function bytesText(size) {
    var number = Number(size);
    if (!isFinite(number) || number <= 0) return '—';
    if (number < 1024) return number + ' B';
    if (number < 1024 * 1024) return (number / 1024).toFixed(1) + ' KB';
    return (number / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function sizeText(size) {
    if (!size || typeof size !== 'object') return '—';
    return (size.w || size.width || '?') + ' × ' + (size.h || size.height || '?');
  }

  function badge(kind, label, extraClass) {
    return '<span class="badge ' + esc(extraClass || '') + ' s-' + esc(kind) + '">' + esc(label) + '</span>';
  }

  function num(value) { return (typeof value === 'number') ? String(value) : '—'; }

  var toastTimer = null;
  function toast(message, isError) {
    var element = qs('#toast');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', !!isError);
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { element.hidden = true; }, isError ? 7000 : 3200);
  }

  // ---------------------------------------------------------------------------
  // HTTP：同源代理接口，错误中文提示。
  // ---------------------------------------------------------------------------
  function api(path, options) {
    options = options || {};
    var headers = {'Accept': 'application/json'};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store'
    }).then(function (response) {
      return response.text().then(function (raw) {
        var data = null;
        if (raw) { try { data = JSON.parse(raw); } catch (error) { data = null; } }
        if (!response.ok) {
          var failure = new Error((data && data.error) || ('请求失败（HTTP ' + response.status + '）'));
          failure.status = response.status;
          failure.code = data && data.code;
          throw failure;
        }
        return data;
      });
    }).catch(function (error) {
      if (error && error.status) throw error;
      throw new Error('无法连接本机漫画服务（18896），请确认现有工具已启动');
    });
  }

  function normalizeHubUrl(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) text = 'http://' + text;
    return text.replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------------------
  // 连接设置 / 状态
  // ---------------------------------------------------------------------------
  function loadConfig() {
    return api(API.config).then(function (data) {
      state.config = data || {};
      var hubInput = qs('#hub-url');
      var nameInput = qs('#client-name');
      var enabledInput = qs('#cfg-enabled');
      var autoApplyInput = qs('#cfg-auto-apply');
      if (hubInput && document.activeElement !== hubInput) hubInput.value = state.config.hubUrl || '';
      if (nameInput && document.activeElement !== nameInput) nameInput.value = state.config.clientName || '';
      if (enabledInput && document.activeElement !== enabledInput) enabledInput.checked = state.config.enabled !== false;
      if (autoApplyInput && document.activeElement !== autoApplyInput) autoApplyInput.checked = state.config.autoApply !== false;
      var summary = qs('#config-summary');
      if (summary) {
        summary.textContent = state.config.configured
          ? ('令牌' + (state.config.tokenSet ? '已保存' : '未保存') + ' · 客户端 ' + (state.config.clientName || '—'))
          : '尚未配对';
      }
    }).catch(function (error) {
      var summary = qs('#config-summary');
      if (summary) summary.textContent = '读取配置失败：' + error.message;
    });
  }

  function pollStatus() {
    return api(API.status).then(function (data) {
      state.status = data || {};
      renderStatus();
      state.lastStatusError = '';
    }).catch(function (error) {
      state.status = {configured: false, hubReachable: false};
      renderStatus('无法读取协作状态：' + error.message);
      if (state.lastStatusError !== error.message) {
        state.lastStatusError = error.message;
        setPill('off', '漫画服务未响应');
      }
    });
  }

  function renderStatus(fallbackMessage) {
    var status = state.status || {};
    var connected = status.configured === true && status.hubReachable === true;
    setPill(connected ? 'on' : (status.configured ? 'off' : 'off'), connected ? '已连接' : (status.configured ? '中控未连接' : '未连接'));

    var versionEl = qs('#hub-version');
    var hub = status.hub;
    if (versionEl) {
      versionEl.textContent = hub
        ? ('Hub ' + (hub.hubName || '') + ' · v' + (hub.version || hub.protocolVersion || '?'))
        : 'Hub 版本 —';
    }

    var pendingEl = qs('#pending-apply');
    if (pendingEl) {
      var pendingCount = Number(status.pendingApply);
      if (isFinite(pendingCount) && pendingCount > 0) {
        pendingEl.hidden = false;
        pendingEl.textContent = '待回填 ' + pendingCount + ' 个任务';
      } else {
        pendingEl.hidden = true;
      }
    }

    var statusLine = qs('#status-line');
    if (statusLine) {
      var parts = [];
      parts.push(status.configured ? '已配对' : '未配对');
      if (status.configured) {
        parts.push('令牌' + (status.tokenSet ? '已保存' : '未保存'));
        parts.push('启用' + (status.enabled === false ? '关' : '开'));
        parts.push('自动回填' + (status.autoApply === false ? '关' : '开'));
        if (status.lastSyncAt) parts.push('最后同步 ' + fmtTime(status.lastSyncAt));
      }
      if (status.client && status.client.name) parts.push('客户端 ' + status.client.name);
      if (status.lastError) parts.push('最近错误：' + status.lastError);
      if (fallbackMessage) parts.push(fallbackMessage);
      statusLine.textContent = parts.join(' · ');
      statusLine.classList.toggle('error-text', !!(status.lastError || fallbackMessage));
    }
  }

  function setPill(kind, text) {
    var pill = qs('#conn-pill');
    if (!pill) return;
    pill.className = 'pill ' + kind;
    pill.textContent = text;
  }

  function pairHub() {
    var hubInput = qs('#hub-url');
    var codeInput = qs('#pairing-code');
    var nameInput = qs('#client-name');
    var messageEl = qs('#pair-message');
    var hubUrl = normalizeHubUrl(hubInput ? hubInput.value : '');
    var pairingCode = String((codeInput && codeInput.value) || '').trim().toUpperCase();
    var clientName = String((nameInput && nameInput.value) || '').trim() || 'A电脑';
    if (!hubUrl) { showPairMessage('请填写中控地址，例如 192.168.1.10:18897', true); return; }
    if (!/^[A-Z0-9]{4,16}$/.test(pairingCode)) { showPairMessage('请填写中控窗口显示的配对码（6 位）', true); return; }
    var button = qs('#btn-pair');
    if (button) { button.disabled = true; button.textContent = '正在配对…'; }
    showPairMessage('正在连接中控并配对…', false);
    api(API.pair, {method: 'POST', body: {hubUrl: hubUrl, pairingCode: pairingCode, clientName: clientName}})
      .then(function (data) {
        var hubName = data && data.hub ? (data.hub.hubName || '') : '';
        var version = data && data.hub ? (data.hub.version || data.hub.protocolVersion || '') : '';
        showPairMessage('配对成功' + (hubName ? '：' + hubName : '') + (version ? '（v' + version + '）' : '') + '，令牌已保存到本机。', false);
        toast('协作配对成功');
        if (codeInput) codeInput.value = '';
        if (hubInput) hubInput.value = hubUrl;
        return Promise.all([loadConfig(), pollStatus()]);
      })
      .catch(function (error) {
        showPairMessage('配对失败：' + error.message, true);
      })
      .then(function () {
        if (button) { button.disabled = false; button.textContent = '配对连接'; }
      });
  }

  function showPairMessage(message, isError) {
    var messageEl = qs('#pair-message');
    if (!messageEl) return;
    messageEl.textContent = message;
    messageEl.classList.toggle('error-text', !!isError);
  }

  function saveConfig() {
    var enabledInput = qs('#cfg-enabled');
    var autoApplyInput = qs('#cfg-auto-apply');
    var button = qs('#btn-save-config');
    if (button) button.disabled = true;
    api(API.config, {
      method: 'PUT',
      body: {enabled: !!(enabledInput && enabledInput.checked), autoApply: !!(autoApplyInput && autoApplyInput.checked)}
    }).then(function (data) {
      state.config = data || state.config;
      toast('协作开关已保存：启用' + (state.config.enabled === false ? '关' : '开') + ' · 自动回填' + (state.config.autoApply === false ? '关' : '开'));
      return pollStatus();
    }).catch(function (error) {
      toast('保存协作开关失败：' + error.message, true);
      loadConfig();
    }).then(function () {
      if (button) button.disabled = false;
    });
  }

  // ---------------------------------------------------------------------------
  // 当前工程画格（GET /api/state）
  // ---------------------------------------------------------------------------
  function loadState() {
    return api(API.state).then(function (data) {
      var projects = (data && Array.isArray(data.projects)) ? data.projects : [];
      state.projects = projects.filter(function (project) { return project && project.id && !project.deletedAt; });
      renderProjectSelects();
      renderPanels();
      state.lastTasksError = '';
    }).catch(function (error) {
      var list = qs('#panel-list');
      if (list) list.innerHTML = '<p class="form-error small">读取工程失败：' + esc(error.message) + '</p>';
    });
  }

  function projectLabel(project) {
    return (project.title || project.id || '未命名工程');
  }

  function renderProjectSelects() {
    var projectSelect = qs('#project-select');
    var taskProjectSelect = qs('#task-project');
    var assetProjectSelect = qs('#asset-project');
    var options = state.projects.map(function (project) {
      return '<option value="' + esc(project.id) + '">' + esc(projectLabel(project)) + '</option>';
    }).join('');
    var allProjects = '<option value="">全部项目</option>' + options;

    if (projectSelect) {
      projectSelect.innerHTML = options || '<option value="">（没有可用的漫画工程）</option>';
      var remembered = '';
      try { remembered = localStorage.getItem(PROJECT_KEY) || ''; } catch (error) { remembered = ''; }
      if (state.currentProjectId && state.projects.some(function (project) { return project.id === state.currentProjectId; })) {
        projectSelect.value = state.currentProjectId;
      } else {
        var preferred = state.projects.filter(function (project) { return project.id === remembered; })[0] ||
          state.projects.filter(function (project) { return Array.isArray(project.pages) && project.pages.some(function (page) { return Array.isArray(page.panels) && page.panels.length; }); })[0] ||
          state.projects[0];
        state.currentProjectId = preferred ? preferred.id : '';
        if (state.currentProjectId) projectSelect.value = state.currentProjectId;
      }
    }
    if (taskProjectSelect && taskProjectSelect.innerHTML !== allProjects) {
      var keepTask = state.taskFilter.projectId;
      taskProjectSelect.innerHTML = allProjects;
      taskProjectSelect.value = keepTask;
    }
    if (assetProjectSelect && assetProjectSelect.innerHTML !== allProjects) {
      var keepAsset = state.assetFilter.projectId;
      assetProjectSelect.innerHTML = allProjects;
      assetProjectSelect.value = keepAsset;
    }
  }

  function currentProject() {
    return state.projects.filter(function (project) { return project.id === state.currentProjectId; })[0] || null;
  }

  function shotMapOf(project) {
    var map = {};
    (project.shots || []).forEach(function (shot) { if (shot && shot.id) map[shot.id] = shot; });
    return map;
  }

  function panelHasImage(panel) {
    return !!panel.imageAssetId || (Array.isArray(panel.candidates) && panel.candidates.length > 0);
  }

  function renderPanels() {
    var list = qs('#panel-list');
    if (!list) return;
    var project = currentProject();
    if (!project) {
      list.innerHTML = '<p class="empty">没有可用的漫画工程。请先在工作台新建或导入工程。</p>';
      setPanelSummary(0, 0);
      return;
    }
    var shots = shotMapOf(project);
    var rows = [];
    var total = 0;
    (project.pages || []).forEach(function (page, pageIndex) {
      (page.panels || []).forEach(function (panel, panelIndex) {
        if (!panel || !panel.id) return;
        total += 1;
        var shot = shots[panel.shotId] || {};
        var shotCode = shot.code || '';
        var title = shot.title || '';
        var description = String(shot.description || '').replace(/\s+/g, ' ').trim();
        var summary = description || title || '（该格还没有镜头提示词）';
        if (summary.length > 78) summary = summary.slice(0, 78) + '…';
        var code = '第' + (pageIndex + 1) + '页 · 格' + (panelIndex + 1);
        var hasImage = panelHasImage(panel);
        var checked = state.selectedPanels[panel.id] === true;
        rows.push('<label class="panel-row' + (hasImage ? ' has-image' : '') + '">' +
          '<input type="checkbox" data-panel-check="' + esc(panel.id) + '"' + (checked ? ' checked' : '') + '>' +
          '<span class="panel-code">' + esc(code) + '<span class="muted">' + esc(shortId(panel.id)) + '</span></span>' +
          '<span class="panel-text"><strong>' + esc(shotCode || '—') + (title ? ' · ' + esc(title) : '') + '</strong>' +
            '<span class="muted">' + esc(summary) + '</span></span>' +
          '<span class="panel-state">' + (hasImage ? badge('available', '已有图') : badge('pending', '缺图')) +
            (panel.kind === 'background' ? '<span class="chip">背景格</span>' : '') + '</span>' +
        '</label>');
      });
    });
    if (!rows.length) {
      list.innerHTML = '<p class="empty">这个工程还没有画格。请先在左侧「画板」里新建或导入分镜。</p>';
      setPanelSummary(0, 0);
      return;
    }
    list.innerHTML = rows.join('');
    setPanelSummary(total, Object.keys(state.selectedPanels).length);
  }

  function setPanelSummary(total, selected) {
    var summary = qs('#panel-summary');
    if (summary) summary.textContent = '共 ' + total + ' 个画格 · 已选 ' + selected + ' 个';
  }

  function selectedPanelIds() {
    return Object.keys(state.selectedPanels).filter(function (id) { return state.selectedPanels[id] === true; });
  }

  function selectPanels(predicate) {
    var project = currentProject();
    if (!project) return;
    var map = shotMapOf(project);
    (project.pages || []).forEach(function (page) {
      (page.panels || []).forEach(function (panel) {
        if (panel && panel.id && predicate(panel, map[panel.shotId] || {})) state.selectedPanels[panel.id] = true;
      });
    });
    renderPanels();
  }

  function clearSelection() {
    state.selectedPanels = {};
    renderPanels();
  }

  function distribute() {
    var project = currentProject();
    if (!project) { toast('没有可提交的漫画工程', true); return; }
    var panelIds = selectedPanelIds();
    if (!panelIds.length) { toast('请先勾选要协作生成的画格', true); return; }
    if (!state.status || state.status.configured !== true) { toast('请先在上方完成与中控的配对连接', true); return; }
    var button = qs('#btn-distribute');
    if (button) { button.disabled = true; button.textContent = '正在提交…'; }
    var messageList = qs('#distribute-message');
    if (messageList) messageList.innerHTML = '';
    api(API.distribute, {method: 'POST', body: {projectId: project.id, panelIds: panelIds}})
      .then(function (data) {
        var tasks = (data && Array.isArray(data.tasks)) ? data.tasks : [];
        var errors = (data && Array.isArray(data.errors)) ? data.errors : [];
        renderDistributeResult(tasks, errors);
        toast('已提交 ' + tasks.length + ' 个协作任务' + (errors.length ? '，' + errors.length + ' 个失败' : ''));
        state.selectedPanels = {};
        renderPanels();
        return loadTasks();
      })
      .catch(function (error) {
        toast('提交协作生成失败：' + error.message, true);
      })
      .then(function () {
        if (button) { button.disabled = false; button.textContent = '提交协作生成'; }
      });
  }

  function renderDistributeResult(tasks, errors) {
    var list = qs('#distribute-message');
    if (!list) return;
    var html = [];
    tasks.forEach(function (task) {
      html.push('<li class="ok">✔ 画格 ' + esc(task.panelCode || shortId(task.panelId)) + ' 已提交（任务 ' + esc(shortId(task.taskId)) +
        (task.duplicate ? ' · 已存在相同任务，未重复创建' : '') + '）</li>');
    });
    errors.forEach(function (error) {
      html.push('<li class="bad">✘ 画格 ' + esc(error.panelCode || shortId(error.panelId)) + ' 失败：' + esc(error.error || error.message || '未知错误') + '</li>');
    });
    list.innerHTML = html.length ? html.join('') : '<li class="muted">没有提交结果。</li>';
  }

  // ---------------------------------------------------------------------------
  // 协作任务
  // ---------------------------------------------------------------------------
  function buildTaskQuery() {
    var filter = state.taskFilter;
    var parts = ['limit=100'];
    if (filter.status) parts.push('status=' + encodeURIComponent(filter.status));
    if (filter.projectId) parts.push('projectId=' + encodeURIComponent(filter.projectId));
    return API.tasks + '?' + parts.join('&');
  }

  function loadTasks() {
    return api(buildTaskQuery()).then(function (data) {
      state.tasks = (data && Array.isArray(data.tasks)) ? data.tasks : [];
      state.tasksTotal = (data && typeof data.total === 'number') ? data.total : state.tasks.length;
      state.lastTasksError = '';
      renderTasks();
    }).catch(function (error) {
      if (state.lastTasksError !== error.message) {
        state.lastTasksError = error.message;
        var list = qs('#tasks-list');
        if (state.tasks.length) toast('刷新协作任务失败：' + error.message, true);
        else if (list) list.innerHTML = '<p class="form-error small">读取协作任务失败：' + esc(error.message) + '</p>';
      }
    });
  }

  function renderTasks() {
    var list = qs('#tasks-list');
    if (!list) return;
    var summary = qs('#tasks-summary');
    if (summary) summary.textContent = '共 ' + state.tasksTotal + ' 个任务，显示 ' + state.tasks.length + ' 条';
    if (!state.tasks.length) {
      list.innerHTML = '<p class="empty">还没有协作任务。勾选上方画格并提交即可开始。</p>';
      return;
    }
    list.innerHTML = state.tasks.map(function (task) {
      var status = task.status || 'queued';
      var apply = task.apply || {};
      var applyStatus = apply.status || 'pending';
      var conflict = applyStatus === 'conflict';
      var buttons = '<button type="button" class="small" data-task-open="' + esc(task.id) + '">详情</button>';
      if (conflict) {
        buttons += '<button type="button" class="small primary" data-task-choice="force" data-task-id="' + esc(task.id) + '">仍然应用</button>' +
          '<button type="button" class="small" data-task-choice="candidate" data-task-id="' + esc(task.id) + '">仅存候选</button>' +
          '<button type="button" class="small danger" data-task-choice="discard" data-task-id="' + esc(task.id) + '">丢弃</button>';
      }
      return '<article class="task-row' + (conflict ? ' conflict' : '') + '" data-task-row="' + esc(task.id) + '">' +
        '<div class="task-main">' +
          '<div class="task-title"><strong>' + esc(task.projectName || task.projectId || '—') + '</strong>' +
            (task.episode ? ' · 第 ' + esc(task.episode) + ' 话' : '') +
            ' · ' + esc(task.panelCode || '—') +
            (task.shotCode && task.shotCode !== task.panelCode ? ' <span class="muted small">(' + esc(task.shotCode) + ')</span>' : '') + '</div>' +
          '<div class="task-meta">' + badge(status, TASK_STATUS_LABEL[status] || status) +
            ' <span class="muted small">' + esc(PHASE_LABEL[task.phase] || task.phase || '') + '</span>' +
            ' <span class="chip">回填：' + esc(APPLY_LABEL[applyStatus] || applyStatus) + '</span>' +
            ' <span class="muted small">节点 ' + esc(shortId(task.assignedNodeId)) + ' · 尝试 ' + esc(task.activeAttempt || '—') +
            ' · ' + esc(fmtRelative(task.updatedAt)) + '</span></div>' +
          (conflict ? '<p class="warn-text small">目标画格在等待期间被修改过：结果没有覆盖当前画面，已保留为候选。请选择处理方式。</p>' : '') +
        '</div>' +
        '<div class="task-actions">' + buttons + '</div>' +
      '</article>';
    }).join('');
  }

  function openTaskDetail(taskId) {
    openDrawer('任务详情', '<p class="muted">正在加载任务 ' + esc(shortId(taskId)) + '…</p>');
    state.drawerKind = 'task';
    state.drawerId = taskId;
    api(API.task(taskId)).then(function (data) {
      var task = data && data.task ? data.task : data;
      if (!task || !task.id) throw new Error('漫画服务没有返回任务详情');
      renderTaskDetail(task);
    }).catch(function (error) {
      var body = qs('#detail-body');
      if (body) body.innerHTML = '<p class="form-error">加载任务详情失败：' + esc(error.message) + '</p>';
    });
  }

  function renderTaskDetail(task) {
    var status = task.status || 'queued';
    var apply = task.apply || {};
    var applyStatus = apply.status || 'pending';
    var attempts = Array.isArray(task.attempts) ? task.attempts : [];
    var references = Array.isArray(task.references) ? task.references : [];
    var html = '';

    html += '<div class="detail-top">' + badge(status, TASK_STATUS_LABEL[status] || status) +
      badge(applyStatus, '回填：' + (APPLY_LABEL[applyStatus] || applyStatus), 'apply') +
      '<span class="muted mono">' + esc(task.id) + '</span></div>';

    html += '<div class="kv-grid">' +
      kv('项目', task.projectName || task.projectId || '—') +
      kv('画格', task.panelCode || '—') +
      kv('镜头', task.shotCode || '—') +
      kv('状态阶段', PHASE_LABEL[task.phase] || task.phase || '—') +
      kv('节点', shortId(task.assignedNodeId)) +
      kv('尝试', task.activeAttempt || '—') +
      kv('尺寸', sizeText(task.size)) +
      kv('提交时间', fmtTime(task.submittedAt)) +
      kv('更新时间', fmtTime(task.updatedAt)) +
      '</div>';

    html += section('提示词', '<pre class="prompt">' + esc(task.prompt || '（空）') + '</pre>');
    html += section('画风', '<p>' + esc(task.style || '（未指定画风）') + '</p>');

    html += '<section><h3>参考图（' + references.length + '）</h3>' +
      (references.length ? '<ul class="plain-list">' + references.map(function (reference) {
        return '<li>' + esc(reference.name || '—') + ' · ' + esc(reference.role || '—') +
          ' · ' + esc(bytesText(reference.size)) + ' <span class="muted mono">' + esc(shortId(reference.sha256)) + '</span></li>';
      }).join('') + '</ul>' : '<p class="muted">没有参考图。</p>') + '</section>';

    html += '<section><h3>执行尝试（' + attempts.length + '）</h3>' +
      (attempts.length ? '<ol class="timeline">' + attempts.map(function (attempt) {
        var attemptStatus = attempt.status || 'claimed';
        return '<li class="timeline-item s-' + esc(attemptStatus) + '">' +
          '<div class="timeline-head"><strong>#' + esc(attempt.attempt) + ' ' + esc(ATTEMPT_LABEL[attemptStatus] || attemptStatus) + '</strong>' +
          '<span class="muted small">节点 ' + esc(shortId(attempt.nodeId)) + '</span></div>' +
          '<div class="muted small">领取 ' + esc(fmtTime(attempt.claimedAt)) + ' · 完成 ' + esc(fmtTime(attempt.finishedAt)) + '</div>' +
          (attempt.error ? '<p class="error-text small">' + esc(attempt.error) + '</p>' : '') +
        '</li>';
      }).join('') + '</ol>' : '<p class="muted">还没有执行记录。</p>') + '</section>';

    // 结果预览：优先用漫画服务注入的同源 previewUrl；没有则只显示元数据（接口缺口见 README）。
    var preview = typeof task.previewUrl === 'string' && task.previewUrl.charAt(0) === '/' ? task.previewUrl : '';
    var result = task.result || null;
    if (preview) {
      html += '<section><h3>结果预览</h3><figure class="result"><img src="' + esc(preview) + '" alt="协作生成结果预览" loading="lazy" data-result-preview="1"></figure>' +
        '<p class="muted small preview-fallback" hidden>结果预览暂时不可用（图片代理返回错误或文件不可达），下面只显示结果元数据。</p>' +
        (result ? '<p class="muted small">' + esc(result.mime || 'image') + ' · ' + esc(bytesText(result.size)) + ' · ' +
          esc((result.width || '?') + '×' + (result.height || '?')) + ' · 节点 ' + esc(shortId(result.nodeId)) + '</p>' +
          '<p class="mono small">sha256: ' + esc(result.sha256) + '</p>' : '') +
        '</section>';
    } else if (result && result.sha256) {
      html += '<section><h3>结果</h3><p class="muted">结果已生成（sha256 ' + esc(shortId(result.sha256)) + '，' + esc(bytesText(result.size)) + '），' +
        '但任务详情没有返回可用的同源预览路径；请点「详情」重新加载，或在控制台任务详情查看结果。</p></section>';
    } else if (status === 'done') {
      html += section('结果', '<p class="muted">任务已完成，但暂时没有可预览的结果记录。</p>');
    } else {
      html += section('结果', '<p class="muted">任务还没有可预览的结果。</p>');
    }

    html += '<section><h3>回填状态</h3>' + badge(applyStatus, APPLY_LABEL[applyStatus] || applyStatus, 'apply') +
      (apply.detail ? '<p class="muted small">' + esc(apply.detail) + '</p>' : '') +
      '<p class="muted small">' + esc(apply.at ? ('时间 ' + fmtTime(apply.at)) : '时间 —') + '</p></section>';

    var actions = '';
    if (applyStatus === 'conflict') {
      actions += '<button type="button" class="primary" data-task-choice="force" data-task-id="' + esc(task.id) + '">仍然应用</button>' +
        '<button type="button" data-task-choice="candidate" data-task-id="' + esc(task.id) + '">仅存候选</button>' +
        '<button type="button" class="danger" data-task-choice="discard" data-task-id="' + esc(task.id) + '">丢弃</button>';
    }
    if (['queued', 'running', 'uploading', 'verifying'].indexOf(status) >= 0) {
      actions += '<button type="button" class="danger" data-task-action="cancel" data-task-id="' + esc(task.id) + '">取消任务</button>';
    }
    if (['failed', 'verifying', 'cancelled'].indexOf(status) >= 0) {
      actions += '<button type="button" data-task-action="retry" data-task-id="' + esc(task.id) + '">重新派单</button>';
    }
    if (actions) html += '<div class="detail-actions">' + actions + '</div>';

    var body = qs('#detail-body');
    if (body) body.innerHTML = html;
    var title = qs('#detail-title');
    if (title) title.textContent = '任务详情 · ' + (task.panelCode || shortId(task.id));
  }

  function kv(label, value) {
    return '<div class="kv"><span class="kv-label">' + esc(label) + '</span><span class="kv-value">' + esc(value || '—') + '</span></div>';
  }

  function section(title, body) {
    return '<section><h3>' + esc(title) + '</h3>' + body + '</section>';
  }

  function chooseApply(taskId, choice, label) {
    var messages = {
      force: '仍然应用：会用协作结果覆盖当前画格画面（当前画面同时保留为候选）。确定继续？',
      candidate: '仅存候选：结果只加入画格候选列表，不改变当前画面。确定继续？',
      discard: '丢弃：不写入画格，协作结果仍保留在中控资产里。确定继续？'
    };
    if (!confirm(messages[choice] || '确定执行？')) return;
    api(API.applyChoice(taskId), {method: 'POST', body: {choice: choice}}).then(function (data) {
      var statusText = data && data.status ? (APPLY_LABEL[data.status] || data.status) : label;
      toast('已处理：' + statusText);
      loadTasks();
      if (state.drawerKind === 'task' && state.drawerId === taskId) openTaskDetail(taskId);
    }).catch(function (error) {
      toast('处理冲突失败：' + error.message, true);
    });
  }

  function taskAction(taskId, action) {
    var isCancel = action === 'cancel';
    if (!confirm(isCancel ? '取消任务 ' + shortId(taskId) + '？' : '重新派单 ' + shortId(taskId) + '？会创建新的执行尝试。')) return;
    var path = isCancel ? API.taskCancel(taskId) : API.taskRetry(taskId);
    api(path, {method: 'POST', body: isCancel ? undefined : {reason: '协作页手动重新派单'}}).then(function () {
      toast(isCancel ? '任务已取消' : '已重新派单，等待节点领取');
      loadTasks();
      if (state.drawerKind === 'task' && state.drawerId === taskId) openTaskDetail(taskId);
    }).catch(function (error) {
      toast((isCancel ? '取消失败：' : '重新派单失败：') + error.message, true);
    });
  }

  // ---------------------------------------------------------------------------
  // 共享资产
  // ---------------------------------------------------------------------------
  function buildAssetQuery() {
    var filter = state.assetFilter;
    var parts = ['limit=60', 'offset=0'];
    if (filter.q) parts.push('q=' + encodeURIComponent(filter.q));
    if (filter.kind) parts.push('kind=' + encodeURIComponent(filter.kind));
    if (filter.projectId) parts.push('projectId=' + encodeURIComponent(filter.projectId));
    return API.assets + '?' + parts.join('&');
  }

  function loadAssets() {
    return api(buildAssetQuery()).then(function (data) {
      state.assets = (data && Array.isArray(data.assets)) ? data.assets : [];
      state.assetsTotal = (data && typeof data.total === 'number') ? data.total : state.assets.length;
      renderAssets();
    }).catch(function (error) {
      var grid = qs('#assets-grid');
      if (grid && !state.assets.length) grid.innerHTML = '<p class="form-error small">读取共享资产失败：' + esc(error.message) + '</p>';
    });
  }

  function renderAssets() {
    var grid = qs('#assets-grid');
    if (!grid) return;
    var summary = qs('#assets-summary');
    if (summary) summary.textContent = '共 ' + state.assetsTotal + ' 个资产，显示 ' + state.assets.length + ' 条';
    if (!state.assets.length) {
      grid.innerHTML = '<p class="empty">还没有共享资产。协作生成完成或有资产申请后会自动入库。</p>';
      return;
    }
    grid.innerHTML = state.assets.map(function (asset) {
      var status = asset.status || 'available';
      var kind = asset.kind || 'other';
      var meta = [asset.form, asset.costume, asset.style].filter(Boolean).join(' · ') || '—';
      var thumb = asset.sha256 ? API.assetThumb(asset.id) : '';
      return '<article class="asset-card" data-asset-id="' + esc(asset.id) + '">' +
        '<div class="asset-thumb">' +
          (thumb
            ? '<img src="' + esc(thumb) + '" alt="' + esc(asset.name || '共享资产') + '" loading="lazy" data-asset-thumb="' + esc(asset.id) + '">' +
              '<span class="thumb-fallback" hidden>缩略图不可用</span>'
            : '<span class="thumb-fallback">' + esc(ASSET_STATUS_LABEL[status] || status) + '</span>') +
          '<span class="asset-version">v' + esc(asset.version || 1) + '</span>' +
        '</div>' +
        '<div class="asset-body">' +
          '<strong>' + esc(asset.name || '未命名资产') + '</strong>' +
          '<div class="chips">' + badge(status, ASSET_STATUS_LABEL[status] || status) +
            '<span class="chip">' + esc(ASSET_KIND_LABEL[kind] || kind) + '</span></div>' +
          '<p class="muted small">' + esc(meta) + '</p>' +
          '<p class="muted small">项目 ' + esc(shortId(asset.projectId)) +
            (asset.sourceTaskId ? ' · 来源任务 ' + esc(shortId(asset.sourceTaskId)) : '') + '</p>' +
          '<div class="asset-actions">' +
            '<button type="button" class="small" data-asset-open="' + esc(asset.id) + '">详情</button>' +
            '<button type="button" class="small" data-asset-download="' + esc(asset.id) + '">下载原图</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function openAssetDetail(assetId) {
    openDrawer('资产详情', '<p class="muted">正在加载资产 ' + esc(shortId(assetId)) + '…</p>');
    state.drawerKind = 'asset';
    state.drawerId = assetId;
    api(API.asset(assetId)).then(function (data) {
      var asset = data && data.asset ? data.asset : data;
      if (!asset || !asset.id) throw new Error('漫画服务没有返回资产详情');
      var versions = (data && Array.isArray(data.versions) && data.versions.length) ? data.versions : [asset];
      renderAssetDetail(asset, versions);
    }).catch(function (error) {
      var body = qs('#detail-body');
      if (body) body.innerHTML = '<p class="form-error">加载资产详情失败：' + esc(error.message) + '</p>';
    });
  }

  function renderAssetDetail(asset, versions) {
    var status = asset.status || 'available';
    var html = '';
    html += '<div class="detail-top">' + badge(status, ASSET_STATUS_LABEL[status] || status) +
      '<span class="chip">' + esc(ASSET_KIND_LABEL[asset.kind] || asset.kind || '其他') + '</span>' +
      '<span class="muted mono">' + esc(asset.id) + '</span></div>';
    html += '<figure class="result asset-preview">' +
      (asset.sha256
        ? '<img src="' + esc(API.assetThumb(asset.id)) + '" alt="' + esc(asset.name || '资产') + '" data-asset-thumb="' + esc(asset.id) + '"><span class="thumb-fallback" hidden>缩略图不可用</span>'
        : '<span class="thumb-fallback">暂无图片</span>') + '</figure>';
    html += '<div class="kv-grid">' +
      kv('名称', asset.name) + kv('形态 form', asset.form) + kv('服装 costume', asset.costume) +
      kv('画风 style', asset.style) + kv('版本', 'v' + (asset.version || 1)) + kv('项目', shortId(asset.projectId)) +
      kv('来源任务', asset.sourceTaskId ? shortId(asset.sourceTaskId) : '—') +
      kv('尺寸', (asset.width || '?') + ' × ' + (asset.height || '?')) + kv('大小', bytesText(asset.size)) +
      kv('创建时间', fmtTime(asset.createdAt)) + kv('sha256', shortId(asset.sha256)) +
      '</div>';
    html += '<div class="detail-actions">' +
      '<button type="button" class="primary" data-asset-download="' + esc(asset.id) + '">下载原图到本机</button>' +
      (asset.sourceTaskId ? '<button type="button" data-asset-task="' + esc(asset.sourceTaskId) + '">查看来源任务</button>' : '') +
      '</div>';
    html += '<section><h3>版本列表（同谱系，新 → 旧，共 ' + versions.length + ' 个）</h3><div class="version-list">' +
      versions.map(function (version) {
        var current = version.id === asset.id;
        return '<div class="version-item' + (current ? ' current' : '') + '">' +
          (version.sha256 ? '<img src="' + esc(API.assetThumb(version.id)) + '" alt="" loading="lazy" data-asset-thumb="' + esc(version.id) + '">' : '<span class="thumb-fallback">无图</span>') +
          '<div class="version-body"><strong>v' + esc(version.version || 1) + (current ? ' · 当前查看' : '') + '</strong>' +
            '<div class="muted small">' + esc(version.form || '—') + ' · ' + esc(fmtTime(version.createdAt)) + '</div>' +
            '<div class="muted small mono">' + esc(shortId(version.sha256)) + ' · ' + esc(bytesText(version.size)) + '</div>' +
            '<div class="version-actions"><button type="button" class="small" data-asset-download="' + esc(version.id) + '">下载此版本</button></div>' +
          '</div></div>';
      }).join('') + '</div></section>';
    var body = qs('#detail-body');
    if (body) body.innerHTML = html;
    var title = qs('#detail-title');
    if (title) title.textContent = '资产详情 · ' + (asset.name || shortId(asset.id));
  }

  function downloadAsset(assetId) {
    var buttons = qsa('[data-asset-download="' + assetId + '"]');
    buttons.forEach(function (button) { button.disabled = true; });
    toast('正在下载原图到本机缓存…');
    api(API.assetDownload(assetId)).then(function (data) {
      var message = '原图已下载';
      if (data && data.filePath) message += '：' + data.filePath;
      if (data && data.assetId) message += '（本地资产 ' + shortId(data.assetId) + '）';
      toast(message);
      loadAssets();
    }).catch(function (error) {
      toast('下载原图失败：' + error.message, true);
    }).then(function () {
      buttons.forEach(function (button) { button.disabled = false; });
    });
  }

  // ---------------------------------------------------------------------------
  // 通知
  // ---------------------------------------------------------------------------
  function loadNotifications() {
    var since = state.lastSeq || 0;
    return api(API.notifications + '?since=' + encodeURIComponent(String(since)) + '&limit=200').then(function (data) {
      if (!data) return;
      var incoming = Array.isArray(data.notifications) ? data.notifications : [];
      if (incoming.length) {
        var seen = {};
        state.notifications.forEach(function (item) { if (item && item.id) seen[item.id] = true; });
        var fresh = incoming.filter(function (item) { return item && item.id && !seen[item.id]; });
        state.notifications = fresh.concat(state.notifications).slice(0, MAX_NOTIFICATIONS);
      }
      if (typeof data.lastSeq === 'number' && data.lastSeq > state.lastSeq) state.lastSeq = data.lastSeq;
      renderNotifications();
    }).catch(function () { /* 通知失败不打断页面，任务区会显示错误 */ });
  }

  function isNotificationRead(item) {
    if (!item) return true;
    var clientId = state.status && state.status.client ? state.status.client.id : '';
    if (!clientId) return false;
    return Array.isArray(item.readBy) && item.readBy.indexOf(clientId) >= 0;
  }

  function noticeItemHtml(item) {
    if (!item) return '';
    var level = item.level || 'info';
    var typeLabel = NOTICE_TYPE_LABEL[item.type] || item.type || '通知';
    var read = isNotificationRead(item);
    var links = '';
    if (item.taskId) links += '<button type="button" class="link" data-notice-task="' + esc(item.taskId) + '">查看任务</button>';
    if (item.assetId) links += '<button type="button" class="link" data-notice-asset="' + esc(item.assetId) + '">查看资产</button>';
    return '<li class="notice level-' + esc(level) + (read ? '' : ' unread') + '" data-notice-id="' + esc(item.id) + '">' +
      '<div class="notice-head"><span class="notice-dot"></span><strong>' + esc(item.title || typeLabel) + '</strong>' +
        '<span class="muted small">' + esc(typeLabel) + ' · ' + esc(level) + '</span>' +
        '<time class="muted small">' + esc(fmtTime(item.createdAt)) + '</time></div>' +
      (item.body ? '<p class="notice-body">' + esc(item.body) + '</p>' : '') +
      '<div class="notice-foot">' + (read ? '<span class="muted small">已读</span>' : '<button type="button" class="link" data-notice-read="' + esc(item.id) + '">标记已读</button>') + links + '</div>' +
    '</li>';
  }

  function renderNotifications() {
    var list = qs('#notifications-list');
    if (!list) return;
    var unread = state.notifications.filter(function (item) { return !isNotificationRead(item); }).length;
    var summary = qs('#notif-summary');
    if (summary) summary.textContent = '共 ' + state.notifications.length + ' 条 · 未读 ' + unread + ' 条';
    list.innerHTML = state.notifications.length
      ? state.notifications.map(noticeItemHtml).join('')
      : '<li class="empty">还没有通知。协作任务完成、失败、冲突或资产入库时会出现在这里。</li>';
  }

  function findNotification(notificationId) {
    return state.notifications.filter(function (item) { return item && item.id === notificationId; })[0] || null;
  }

  function markRead(ids, silent) {
    var unique = [];
    (ids || []).forEach(function (id) { if (id && unique.indexOf(id) < 0) unique.push(id); });
    if (!unique.length) return Promise.resolve();
    var clientId = state.status && state.status.client ? state.status.client.id : undefined;
    return api(API.notificationsRead, {method: 'POST', body: {ids: unique, clientId: clientId}}).then(function () {
      unique.forEach(function (id) {
        var item = findNotification(id);
        if (item) {
          if (!Array.isArray(item.readBy)) item.readBy = [];
          if (clientId && item.readBy.indexOf(clientId) < 0) item.readBy.push(clientId);
        }
      });
      renderNotifications();
      if (!silent) toast('已标记 ' + unique.length + ' 条通知为已读');
    }).catch(function (error) {
      toast('标记已读失败：' + error.message, true);
    });
  }

  function markAllRead() {
    var unread = state.notifications.filter(function (item) { return !isNotificationRead(item); }).map(function (item) { return item.id; });
    if (!unread.length) { toast('当前没有未读通知'); return; }
    markRead(unread);
  }

  // ---------------------------------------------------------------------------
  // 抽屉
  // ---------------------------------------------------------------------------
  function openDrawer(title, html) {
    var drawer = qs('#detail-drawer');
    var mask = qs('#detail-mask');
    if (!drawer || !mask) return;
    var titleEl = qs('#detail-title');
    if (titleEl) titleEl.textContent = title;
    var body = qs('#detail-body');
    if (body) body.innerHTML = html;
    drawer.hidden = false;
    mask.hidden = false;
    document.body.classList.add('drawer-open');
  }

  function closeDrawer() {
    var drawer = qs('#detail-drawer');
    var mask = qs('#detail-mask');
    if (drawer) drawer.hidden = true;
    if (mask) mask.hidden = true;
    document.body.classList.remove('drawer-open');
    state.drawerKind = '';
    state.drawerId = '';
  }

  // ---------------------------------------------------------------------------
  // 事件
  // ---------------------------------------------------------------------------
  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, delay);
    };
  }

  function bindEvents() {
    var refreshButton = qs('#btn-refresh');
    if (refreshButton) refreshButton.addEventListener('click', function () {
      toast('正在刷新…');
      loadConfig();
      pollStatus();
      loadState();
      loadTasks();
      loadAssets();
      loadNotifications();
    });
    var pairButton = qs('#btn-pair');
    if (pairButton) pairButton.addEventListener('click', pairHub);
    var saveButton = qs('#btn-save-config');
    if (saveButton) saveButton.addEventListener('click', saveConfig);

    var projectSelect = qs('#project-select');
    if (projectSelect) projectSelect.addEventListener('change', function () {
      state.currentProjectId = projectSelect.value;
      state.selectedPanels = {};
      try { if (state.currentProjectId) localStorage.setItem(PROJECT_KEY, state.currentProjectId); } catch (error) { /* 忽略 */ }
      renderPanels();
    });
    var selectMissing = qs('#btn-select-missing');
    if (selectMissing) selectMissing.addEventListener('click', function () {
      selectPanels(function (panel) { return !panelHasImage(panel); });
    });
    var selectNone = qs('#btn-select-none');
    if (selectNone) selectNone.addEventListener('click', clearSelection);
    var reloadPanels = qs('#btn-reload-panels');
    if (reloadPanels) reloadPanels.addEventListener('click', function () { loadState(); toast('已重新读取工程'); });
    var distributeButton = qs('#btn-distribute');
    if (distributeButton) distributeButton.addEventListener('click', distribute);

    var panelList = qs('#panel-list');
    if (panelList) panelList.addEventListener('change', function (event) {
      var checkbox = event.target;
      if (!checkbox || !checkbox.getAttribute) return;
      var panelId = checkbox.getAttribute('data-panel-check');
      if (!panelId) return;
      if (checkbox.checked) state.selectedPanels[panelId] = true;
      else delete state.selectedPanels[panelId];
      setPanelSummary(qsa('#panel-list .panel-row').length, selectedPanelIds().length);
    });

    var taskStatus = qs('#task-status');
    if (taskStatus) taskStatus.addEventListener('change', function () {
      state.taskFilter.status = taskStatus.value;
      loadTasks();
    });
    var taskProject = qs('#task-project');
    if (taskProject) taskProject.addEventListener('change', function () {
      state.taskFilter.projectId = taskProject.value;
      loadTasks();
    });
    var tasksRefresh = qs('#btn-tasks-refresh');
    if (tasksRefresh) tasksRefresh.addEventListener('click', function () { loadTasks(); });

    var assetQ = qs('#asset-q');
    if (assetQ) assetQ.addEventListener('input', debounce(function () {
      state.assetFilter.q = assetQ.value.trim();
      loadAssets();
    }, 300));
    var assetKind = qs('#asset-kind');
    if (assetKind) assetKind.addEventListener('change', function () {
      state.assetFilter.kind = assetKind.value;
      loadAssets();
    });
    var assetProject = qs('#asset-project');
    if (assetProject) assetProject.addEventListener('change', function () {
      state.assetFilter.projectId = assetProject.value;
      loadAssets();
    });
    var assetsRefresh = qs('#btn-assets-refresh');
    if (assetsRefresh) assetsRefresh.addEventListener('click', function () { loadAssets(); });

    var notifRefresh = qs('#btn-notif-refresh');
    if (notifRefresh) notifRefresh.addEventListener('click', function () { loadNotifications(); toast('通知已刷新'); });
    var notifReadAll = qs('#btn-notif-readall');
    if (notifReadAll) notifReadAll.addEventListener('click', markAllRead);

    var detailClose = qs('#detail-close');
    if (detailClose) detailClose.addEventListener('click', closeDrawer);
    var detailMask = qs('#detail-mask');
    if (detailMask) detailMask.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeDrawer(); });

    document.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest(
        '[data-task-open],[data-task-choice],[data-task-action],[data-asset-open],[data-asset-download],[data-asset-task],[data-notice-task],[data-notice-asset],[data-notice-read]'
      ) : null;
      if (!target) return;

      if (target.hasAttribute('data-task-open')) { openTaskDetail(target.getAttribute('data-task-open')); return; }
      if (target.hasAttribute('data-task-choice')) {
        chooseApply(target.getAttribute('data-task-id'), target.getAttribute('data-task-choice'), '已处理');
        return;
      }
      if (target.hasAttribute('data-task-action')) {
        taskAction(target.getAttribute('data-task-id'), target.getAttribute('data-task-action'));
        return;
      }
      if (target.hasAttribute('data-asset-open')) { openAssetDetail(target.getAttribute('data-asset-open')); return; }
      if (target.hasAttribute('data-asset-download')) { downloadAsset(target.getAttribute('data-asset-download')); return; }
      if (target.hasAttribute('data-asset-task')) { openTaskDetail(target.getAttribute('data-asset-task')); return; }
      if (target.hasAttribute('data-notice-read')) { markRead([target.getAttribute('data-notice-read')]); return; }
      var noticeItem = target.closest('[data-notice-id]');
      var noticeId = noticeItem ? noticeItem.getAttribute('data-notice-id') : '';
      if (target.hasAttribute('data-notice-task')) {
        markRead([noticeId], true);
        openTaskDetail(target.getAttribute('data-notice-task'));
        return;
      }
      if (target.hasAttribute('data-notice-asset')) {
        markRead([noticeId], true);
        openAssetDetail(target.getAttribute('data-notice-asset'));
      }
    });

    // 缩略图 / 结果预览不可用时显示占位文字（协议 §7.2 的 thumb 与 result 代理都可能返回 404）。
    document.addEventListener('error', function (event) {
      var image = event.target;
      if (!image || image.tagName !== 'IMG') return;
      if (image.getAttribute('data-result-preview')) {
        var section = image.closest ? image.closest('section') : null;
        var previewFallback = section ? section.querySelector('.preview-fallback') : null;
        image.hidden = true;
        if (previewFallback) previewFallback.hidden = false;
        return;
      }
      if (!image.getAttribute('data-asset-thumb')) return;
      var parent = image.parentNode;
      image.hidden = true;
      if (parent) {
        var fallback = parent.querySelector('.thumb-fallback');
        if (fallback) fallback.hidden = false;
      }
    }, true);
  }

  // ---------------------------------------------------------------------------
  // 轮询
  // ---------------------------------------------------------------------------
  function tick() {
    if (document.hidden) return;
    var count = tick.number = (tick.number || 0) + 1;
    pollStatus();
    loadTasks();
    loadNotifications();
    if (count % 3 === 0) loadAssets();
    if (count % 15 === 0) loadState();
  }

  function boot() {
    bindEvents();
    var flash = null;
    try {
      flash = sessionStorage.getItem(FLASH_KEY);
      if (flash) sessionStorage.removeItem(FLASH_KEY);
    } catch (error) { flash = null; }
    loadConfig();
    pollStatus();
    loadState();
    loadTasks();
    loadAssets();
    loadNotifications();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { pollStatus(); loadTasks(); }
    });
    if (flash) toast(flash);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
