/*
 * PhotoCraft 局域网协作 · 中控控制台（纯静态，无框架、无外链、无构建）。
 * 接口契约：开发/协作/协议与设计.md §4「中控 HTTP API」。
 * 约定：所有请求优先从本文件顶部的 API 表取路径；除 health/pair 外都带 x-collab-token；
 *       图片类 GET 用 ?token= 传递令牌（浏览器 <img> 无法带头）。
 * 配对令牌只保存在 localStorage，禁止写死在页面里。
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'photocraft.collab.console.token';
  var CLIENT_KEY = 'photocraft.collab.console.clientId';
  var HUB_KEY = 'photocraft.collab.console.hub';
  var FLASH_KEY = 'photocraft.collab.console.flash';
  var POLL_MS = 2000;
  var MAX_NOTIFICATIONS = 500;

  // 协议 §4 白名单内的路径。ui-smoke.test.mjs 会扫描本文件的 /api/ 字面量并对照协议白名单。
  var API = {
    health: '/api/health',
    pair: '/api/pair',
    nodes: '/api/nodes',
    nodeSettings: function (id) { return `/api/nodes/${encodeURIComponent(id)}/settings`; },
    nodeRevoke: function (id) { return `/api/nodes/${encodeURIComponent(id)}/revoke`; },
    pairing: '/api/admin/pairing',
    rotatePairing: '/api/admin/rotate-pairing',
    tasks: '/api/tasks',
    task: function (id) { return `/api/tasks/${encodeURIComponent(id)}`; },
    taskCancel: function (id) { return `/api/tasks/${encodeURIComponent(id)}/cancel`; },
    taskRetry: function (id) { return `/api/tasks/${encodeURIComponent(id)}/retry`; },
    assets: '/api/assets',
    asset: function (id) { return `/api/assets/${encodeURIComponent(id)}`; },
    blob: function (sha) { return `/api/blobs/${encodeURIComponent(sha)}`; },
    blobThumb: function (sha) { return `/api/blobs/${encodeURIComponent(sha)}/thumb`; },
    notifications: '/api/notifications',
    notificationsRead: '/api/notifications/read'
  };

  var TASK_STATUS_LABEL = {queued: '排队中', running: '执行中', uploading: '上传中', verifying: '待核实', done: '已完成', failed: '失败', cancelled: '已取消'};
  var PHASE_LABEL = {queued: '排队', claimed: '已领取', generating: '生成中', uploading: '上传中', verifying: '核实中', done: '完成', failed: '失败', cancelled: '取消'};
  var APPLY_LABEL = {pending: '待回填', applied: '已回填', conflict: '冲突', candidate: '仅候选', failed: '回填失败', skipped: '已丢弃'};
  var ATTEMPT_LABEL = {claimed: '已领取', generating: '生成中', uploading: '上传中', upload_failed: '上传失败', unknown: '状态未知', succeeded: '成功', failed: '失败', abandoned: '已放弃'};
  var ASSET_KIND_LABEL = {character: '角色', prop: '道具', scene: '场景', style: '画风', panel: '画格', other: '其他'};
  var ASSET_STATUS_LABEL = {available: '可用', pending: '生成中', failed: '失败'};
  var TASK_TYPE_LABEL = {'panel-generation': '画格生图', 'asset-generation': '资产生图'};
  var NOTICE_TYPE_LABEL = {
    'task.done': '任务完成', 'task.failed': '任务失败', 'task.conflict': '回填冲突',
    'task.verifying': '任务待核实', 'task.late_result': '迟到结果', 'asset.created': '资产入库',
    'node.online': '节点上线', 'node.offline': '节点离线', 'node.revoked': '节点吊销', 'pair.new': '新设备配对'
  };

  var state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    clientId: localStorage.getItem(CLIENT_KEY) || '',
    hub: readHub(),
    authorized: false,
    view: 'overview',
    health: null,
    nodes: [],
    tasks: [],
    tasksTotal: 0,
    assets: [],
    assetsTotal: 0,
    notifications: [],
    lastSeq: 0,
    busy: false,
    timer: null,
    lastError: '',
    taskFilter: {status: '', applyStatus: '', projectId: ''},
    assetFilter: {q: '', projectId: '', kind: '', status: '', allVersions: false}
  };

  // ---------------------------------------------------------------------------
  // 基础工具
  // ---------------------------------------------------------------------------
  function qs(selector, root) { return (root || document).querySelector(selector); }
  function qsa(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function readHub() {
    try { return JSON.parse(localStorage.getItem(HUB_KEY) || '{}') || {}; } catch (error) { return {}; }
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function shortId(value) {
    var text = String(value || '');
    if (!text) return '—';
    var plain = text.replace(/^(task|node|asset|client|blob|hub|panel|project)_/, '');
    return plain.slice(0, 8);
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
    if (!isFinite(diff)) return '—';
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

  function imageUrl(path) {
    if (!path) return '';
    var separator = path.indexOf('?') >= 0 ? '&' : '?';
    return path + separator + 'token=' + encodeURIComponent(state.token || '');
  }

  var toastTimer = null;
  function toast(message, isError) {
    var element = qs('#toast');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', !!isError);
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { element.hidden = true; }, isError ? 6000 : 3000);
  }

  function setConn(kind, message) {
    var dot = qs('#conn-dot');
    if (!dot) return;
    dot.className = 'dot ' + kind;
    var label = qs('#conn-text');
    if (label) label.textContent = message;
  }

  // ---------------------------------------------------------------------------
  // HTTP：统一带令牌；401 回到配对界面；错误信息中文化。
  // ---------------------------------------------------------------------------
  function request(path, options) {
    options = options || {};
    var headers = {'Accept': 'application/json'};
    if (state.token) headers['x-collab-token'] = state.token;
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
        if (response.status === 401) {
          var unauthorized = new Error((data && data.error) || '令牌无效或已过期，请重新配对');
          unauthorized.unauthorized = true;
          handleUnauthorized();
          throw unauthorized;
        }
        if (!response.ok) {
          var failure = new Error((data && data.error) || ('请求失败（HTTP ' + response.status + '）'));
          failure.status = response.status;
          failure.code = data && data.code;
          throw failure;
        }
        return data;
      });
    }).catch(function (error) {
      if (error && (error.unauthorized || error.status)) throw error;
      var message = String((error && error.message) || '未知错误');
      if (error && (error.name === 'TypeError' || /Failed to fetch|NetworkError|network error/i.test(message))) {
        throw new Error('无法连接中控（请确认中控已启动、地址正确、局域网防火墙已放行 18897）');
      }
      throw error;
    });
  }

  function handleUnauthorized() {
    if (!state.token) return;
    state.authorized = false;
    stopPolling();
    state.token = '';
    state.clientId = '';
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CLIENT_KEY);
    showPairScreen('登录状态已失效（令牌无效、已吊销或中控已重置），请重新输入配对码。');
  }

  function onPollError(error) {
    if (!error || error.unauthorized) return;
    setConn('error', '连接异常');
    var message = '中控请求失败：' + (error.message || '未知错误');
    if (state.lastError !== message) {
      state.lastError = message;
      toast(message, true);
    }
  }

  // ---------------------------------------------------------------------------
  // 配对
  // ---------------------------------------------------------------------------
  function showPairScreen(message) {
    var consoleEl = qs('#console');
    var pairEl = qs('#pair-screen');
    if (!consoleEl || !pairEl) return;
    consoleEl.hidden = true;
    pairEl.hidden = false;
    var originEl = qs('#pair-origin');
    if (originEl) originEl.textContent = location.origin;
    var errorEl = qs('#pair-error');
    if (errorEl) {
      if (message) { errorEl.textContent = message; errorEl.hidden = false; }
      else { errorEl.hidden = true; }
    }
    var codeInput = qs('#pair-code');
    if (codeInput && !codeInput.value) {
      var fromUrl = new URLSearchParams(location.search).get('pair');
      if (fromUrl) codeInput.value = fromUrl.toUpperCase();
    }
  }

  function submitPair() {
    var codeInput = qs('#pair-code');
    var nameInput = qs('#pair-name');
    var errorEl = qs('#pair-error');
    var button = qs('#pair-submit');
    var code = String((codeInput && codeInput.value) || '').trim().toUpperCase();
    var name = String((nameInput && nameInput.value) || '').trim() || '中控控制台';
    if (errorEl) errorEl.hidden = true;
    if (!/^[A-Z0-9]{4,16}$/.test(code)) {
      if (errorEl) { errorEl.textContent = '配对码格式不正确，请输入中控启动窗口显示的 6 位配对码'; errorEl.hidden = false; }
      return;
    }
    if (button) { button.disabled = true; button.textContent = '正在配对…'; }
    fetch(API.pair, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: JSON.stringify({pairingCode: code, role: 'client', name: name})
    }).then(function (response) {
      return response.text().then(function (raw) {
        var data = null;
        if (raw) { try { data = JSON.parse(raw); } catch (error) { data = null; } }
        return {response: response, data: data};
      });
    }).then(function (result) {
      if (!result.response.ok) {
        var message = (result.data && result.data.error) || ('配对失败（HTTP ' + result.response.status + '），请确认配对码是否已轮换');
        throw new Error(message);
      }
      var data = result.data || {};
      if (!data.token) throw new Error('中控没有返回令牌，请检查中控版本是否为协作版');
      localStorage.setItem(TOKEN_KEY, data.token);
      if (data.clientId) localStorage.setItem(CLIENT_KEY, data.clientId);
      localStorage.setItem(HUB_KEY, JSON.stringify({
        hubId: data.hubId || '',
        hubName: data.hubName || '',
        protocolVersion: data.protocolVersion || ''
      }));
      try { sessionStorage.setItem(FLASH_KEY, '配对成功，已进入控制台'); } catch (error) { /* 忽略隐私模式限制 */ }
      location.reload();
    }).catch(function (error) {
      var message = (error && error.message) || '配对失败';
      if (error && error.name === 'TypeError') message = '无法连接中控，请确认中控已启动、地址正确且防火墙已放行 18897';
      if (errorEl) { errorEl.textContent = message; errorEl.hidden = false; }
      if (button) { button.disabled = false; button.textContent = '配对并进入控制台'; }
    });
  }

  function disconnect() {
    if (!confirm('断开后会清除本机保存的令牌，需要重新配对才能继续使用控制台。继续？')) return;
    stopPolling();
    state.authorized = false;
    state.token = '';
    state.clientId = '';
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CLIENT_KEY);
    showPairScreen('已断开连接，请重新配对。');
  }

  function enterConsole() {
    var pairEl = qs('#pair-screen');
    var consoleEl = qs('#console');
    if (pairEl) pairEl.hidden = true;
    if (consoleEl) consoleEl.hidden = false;
    state.authorized = true;
    renderTopbar();
    setConn('pending', '正在连接…');
    startPolling();
  }

  // ---------------------------------------------------------------------------
  // 轮询：2 秒一次；页面隐藏时跳过网络请求。
  // ---------------------------------------------------------------------------
  function startPolling() {
    stopPolling();
    tick();
    state.timer = setInterval(tick, POLL_MS);
  }

  function stopPolling() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  function tick() {
    if (!state.authorized || state.busy) return;
    if (document.hidden) return;
    state.busy = true;
    var jobs = [pollHealth().catch(onPollError), pollNotifications().catch(onPollError)];
    if (state.view === 'overview' || state.view === 'nodes') jobs.push(pollNodes().catch(onPollError));
    else if (state.view === 'tasks') jobs.push(pollTasks().catch(onPollError));
    else if (state.view === 'assets') jobs.push(pollAssets().catch(onPollError));
    Promise.all(jobs).then(function () { state.busy = false; }, function () { state.busy = false; });
  }

  function pollHealth() {
    return request(API.health).then(function (data) {
      if (!data) return;
      state.health = data;
      state.lastError = '';
      setConn('ok', '已连接');
      renderTopbar();
      if (state.view === 'overview') renderOverview();
    });
  }

  function pollNodes() {
    return request(API.nodes).then(function (data) {
      state.nodes = (data && Array.isArray(data.nodes)) ? data.nodes : [];
      if (state.view === 'nodes') renderNodes();
      if (state.view === 'overview') renderOverview();
    });
  }

  function pollTasks() {
    return request(buildTaskQuery()).then(function (data) {
      state.tasks = (data && Array.isArray(data.tasks)) ? data.tasks : [];
      state.tasksTotal = (data && typeof data.total === 'number') ? data.total : state.tasks.length;
      if (state.view === 'tasks') renderTasks();
    });
  }

  function pollAssets() {
    return request(buildAssetQuery()).then(function (data) {
      state.assets = (data && Array.isArray(data.assets)) ? data.assets : [];
      state.assetsTotal = (data && typeof data.total === 'number') ? data.total : state.assets.length;
      if (state.view === 'assets') renderAssets();
    });
  }

  function pollNotifications() {
    var since = state.lastSeq || 0;
    return request(API.notifications + '?since=' + encodeURIComponent(String(since)) + '&limit=200').then(function (data) {
      if (!data) return;
      var incoming = Array.isArray(data.notifications) ? data.notifications : [];
      if (incoming.length) {
        var seen = {};
        state.notifications.forEach(function (item) { if (item && item.id) seen[item.id] = true; });
        var fresh = incoming.filter(function (item) { return item && item.id && !seen[item.id]; });
        state.notifications = fresh.concat(state.notifications).slice(0, MAX_NOTIFICATIONS);
      }
      if (typeof data.lastSeq === 'number' && data.lastSeq > state.lastSeq) state.lastSeq = data.lastSeq;
      updateUnreadBadge();
      if (state.view === 'notifications') renderNotifications();
      if (state.view === 'overview') renderOverview();
    });
  }

  function buildTaskQuery() {
    var filter = state.taskFilter;
    var parts = ['limit=100'];
    if (filter.status) parts.push('status=' + encodeURIComponent(filter.status));
    if (filter.applyStatus) parts.push('applyStatus=' + encodeURIComponent(filter.applyStatus));
    if (filter.projectId) parts.push('projectId=' + encodeURIComponent(filter.projectId));
    return API.tasks + '?' + parts.join('&');
  }

  function buildAssetQuery() {
    var filter = state.assetFilter;
    var parts = ['limit=100', 'offset=0'];
    if (filter.q) parts.push('q=' + encodeURIComponent(filter.q));
    if (filter.projectId) parts.push('projectId=' + encodeURIComponent(filter.projectId));
    if (filter.kind) parts.push('kind=' + encodeURIComponent(filter.kind));
    if (filter.status) parts.push('status=' + encodeURIComponent(filter.status));
    if (filter.allVersions) parts.push('allVersions=1');
    return API.assets + '?' + parts.join('&');
  }

  // ---------------------------------------------------------------------------
  // 顶部信息
  // ---------------------------------------------------------------------------
  function renderTopbar() {
    var hub = state.hub || {};
    var health = state.health || {};
    var name = health.hubName || hub.hubName || '协作中控';
    var version = health.protocolVersion || hub.protocolVersion || '—';
    var hubId = health.hubId || hub.hubId || '';
    var nameEl = qs('#hub-name');
    var metaEl = qs('#hub-meta');
    var clientEl = qs('#client-label');
    if (nameEl) nameEl.textContent = name;
    if (metaEl) metaEl.textContent = location.origin + ' · 协议 ' + version + (hubId ? ' · ' + shortId(hubId) : '');
    if (clientEl) clientEl.textContent = state.clientId ? ('设备 ' + shortId(state.clientId)) : '';
  }

  function updateUnreadBadge() {
    var unread = countUnread();
    var badgeEl = qs('#unread-badge');
    if (badgeEl) {
      badgeEl.textContent = String(unread);
      badgeEl.hidden = unread <= 0;
    }
    var summary = qs('#notif-summary');
    if (summary) summary.textContent = '共 ' + state.notifications.length + ' 条 · 未读 ' + unread + ' 条';
  }

  function isNotificationRead(item) {
    if (!item) return true;
    if (!state.clientId) return false;
    return Array.isArray(item.readBy) && item.readBy.indexOf(state.clientId) >= 0;
  }

  function countUnread() {
    return state.notifications.filter(function (item) { return !isNotificationRead(item); }).length;
  }

  // ---------------------------------------------------------------------------
  // 视图切换
  // ---------------------------------------------------------------------------
  function switchView(view) {
    if (!view) return;
    state.view = view;
    qsa('.tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.getAttribute('data-view') === view);
    });
    qsa('[data-view-panel]').forEach(function (panel) {
      panel.classList.toggle('active', panel.getAttribute('data-view-panel') === view);
    });
    if (view === 'overview') { renderOverview(); pollNodes().catch(onPollError); }
    if (view === 'nodes') { renderNodes(); loadPairingCode(); pollNodes().catch(onPollError); }
    if (view === 'tasks') { renderTasks(); pollTasks().catch(onPollError); }
    if (view === 'assets') { renderAssets(); pollAssets().catch(onPollError); }
    if (view === 'notifications') { renderNotifications(); }
  }

  // ---------------------------------------------------------------------------
  // 概览
  // ---------------------------------------------------------------------------
  function renderOverview() {
    if (state.view !== 'overview') return;
    var health = state.health || {};
    var nodesInfo = health.nodes || {};
    var tasksInfo = health.tasks || {};
    var assetsInfo = health.assets || {};

    setText('#ov-nodes', (typeof nodesInfo.total === 'number') ? ((typeof nodesInfo.online === 'number' ? nodesInfo.online : 0) + ' / ' + nodesInfo.total) : '—');
    var slots = 0;
    var hasSlots = false;
    state.nodes.forEach(function (node) {
      if (node && node.status && typeof node.status.freeSlots === 'number') { slots += node.status.freeSlots; hasSlots = true; }
    });
    setText('#ov-slots', hasSlots ? String(slots) : '—');

    var active = 0;
    var hasActive = false;
    ['queued', 'running', 'uploading', 'verifying'].forEach(function (key) {
      if (typeof tasksInfo[key] === 'number') { active += tasksInfo[key]; hasActive = true; }
    });
    setText('#ov-active', hasActive ? String(active) : '—');
    setText('#ov-done', (typeof tasksInfo.done === 'number') ? String(tasksInfo.done) : '—');
    setText('#ov-assets', (typeof assetsInfo.total === 'number') ? String(assetsInfo.total) : '—');

    var detailNodes = qs('#ov-nodes-detail');
    if (detailNodes) detailNodes.textContent = '在线 / 总数';
    var detailActive = qs('#ov-active-detail');
    if (detailActive) {
      detailActive.textContent = '排队 ' + num(tasksInfo.queued) + ' · 执行 ' + num(tasksInfo.running) +
        ' · 上传 ' + num(tasksInfo.uploading) + ' · 待核实 ' + num(tasksInfo.verifying);
    }
    var detailDone = qs('#ov-done-detail');
    if (detailDone) detailDone.textContent = '失败 ' + num(tasksInfo.failed) + ' 个';

    var chipRow = qs('#ov-task-status');
    if (chipRow) {
      var order = ['queued', 'running', 'uploading', 'verifying', 'done', 'failed'];
      chipRow.innerHTML = order.map(function (key) {
        return '<span class="chip">' + esc(TASK_STATUS_LABEL[key] || key) + ' <strong>' + num(tasksInfo[key]) + '</strong></span>';
      }).join('');
    }

    var latest = qs('#ov-notifications');
    if (latest) {
      var items = state.notifications.slice(0, 6);
      latest.innerHTML = items.length ? items.map(noticeItemHtml).join('') : '<li class="empty">暂无通知</li>';
    }
  }

  function num(value) { return (typeof value === 'number') ? String(value) : '—'; }

  function setText(selector, value) {
    var element = qs(selector);
    if (element) element.textContent = value;
  }

  // ---------------------------------------------------------------------------
  // 节点
  // ---------------------------------------------------------------------------
  function loadPairingCode() {
    var codeEl = qs('#pairing-code');
    if (codeEl) codeEl.textContent = '…';
    request(API.pairing).then(function (data) {
      if (codeEl) codeEl.textContent = (data && data.pairingCode) || '—';
    }).catch(function (error) {
      if (codeEl) codeEl.textContent = '—';
      if (!error.unauthorized) toast('读取配对码失败：' + error.message, true);
    });
  }

  function renderNodes() {
    if (state.view !== 'nodes') return;
    var body = qs('#nodes-body');
    if (!body) return;
    var nodes = state.nodes || [];
    if (!nodes.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">还没有节点。请在 B 电脑上用 节点.mjs 配对后启动节点。</td></tr>';
      return;
    }
    body.innerHTML = nodes.map(function (node) {
      var status = node.status || {};
      var settings = node.settings || {};
      var online = status.online === true;
      var running = Array.isArray(status.runningTaskIds) ? status.runningTaskIds.length : 0;
      var revoked = node.revoked === true;
      var options = '';
      var max = Number(settings.maxConcurrency) || 1;
      for (var index = 1; index <= 8; index += 1) {
        options += '<option value="' + index + '"' + (index === max ? ' selected' : '') + '>' + index + '</option>';
      }
      return '<tr data-node-id="' + esc(node.id) + '">' +
        '<td><strong>' + esc(node.name || node.id) + '</strong>' +
          '<div class="sub">' + esc(node.platform || '—') + ' · v' + esc(node.version || '—') + ' · ' + esc(shortId(node.id)) +
          (revoked ? ' · <span class="warn-text">已吊销</span>' : '') + '</div>' +
          (status.message ? '<div class="sub warn-text">' + esc(status.message) + '</div>' : '') +
        '</td>' +
        '<td>' + (online ? '<span class="dot ok"></span>在线' : '<span class="dot off"></span>离线') + '</td>' +
        '<td title="' + esc(fmtTime(status.lastSeenAt)) + '">' + esc(fmtRelative(status.lastSeenAt)) + '</td>' +
        '<td>' + esc(typeof status.freeSlots === 'number' ? status.freeSlots : '—') +
          (running ? ' <span class="sub">（跑 ' + running + ' 个）</span>' : '') + '</td>' +
        '<td><select data-node-field="maxConcurrency"' + (revoked ? ' disabled' : '') + '>' + options + '</select></td>' +
        '<td><input type="checkbox" data-node-field="enabled"' + (settings.enabled !== false ? ' checked' : '') + (revoked ? ' disabled' : '') + '></td>' +
        '<td><input type="checkbox" data-node-field="paused"' + (settings.paused === true ? ' checked' : '') + (revoked ? ' disabled' : '') + '></td>' +
        '<td><button type="button" class="danger small" data-node-action="revoke"' + (revoked ? ' disabled' : '') + '>吊销</button></td>' +
      '</tr>';
    }).join('');
  }

  function findNodeRow(nodeId) {
    var rows = qsa('#nodes-body tr');
    for (var index = 0; index < rows.length; index += 1) {
      if (rows[index].getAttribute('data-node-id') === String(nodeId)) return rows[index];
    }
    return null;
  }

  function applyNodeSettings(nodeId) {
    var row = findNodeRow(nodeId);
    if (!row) return;
    var enabledInput = row.querySelector('[data-node-field="enabled"]');
    var pausedInput = row.querySelector('[data-node-field="paused"]');
    var concurrencyInput = row.querySelector('[data-node-field="maxConcurrency"]');
    var payload = {
      enabled: enabledInput ? enabledInput.checked : true,
      paused: pausedInput ? pausedInput.checked : false,
      maxConcurrency: concurrencyInput ? Number(concurrencyInput.value) : 1
    };
    request(API.nodeSettings(nodeId), {method: 'POST', body: payload}).then(function (data) {
      var updated = data && data.node;
      if (updated) {
        state.nodes = state.nodes.map(function (node) { return node.id === updated.id ? updated : node; });
      }
      toast('节点设置已更新：' + (payload.enabled ? '启用' : '停用') + (payload.paused ? ' / 暂停' : '') + ' / 并发 ' + payload.maxConcurrency);
      if (state.view === 'nodes') renderNodes();
    }).catch(function (error) {
      if (!error.unauthorized) {
        toast('保存节点设置失败：' + error.message, true);
        if (state.view === 'nodes') renderNodes();
      }
    });
  }

  function revokeNode(nodeId) {
    var node = (state.nodes || []).filter(function (item) { return item.id === nodeId; })[0];
    var label = node ? (node.name || node.id) : nodeId;
    if (!confirm('吊销节点「' + label + '」？该节点会立即失去访问权限，需要重新配对才能继续接任务。')) return;
    request(API.nodeRevoke(nodeId), {method: 'POST'}).then(function () {
      toast('节点已吊销：' + label);
      pollNodes().catch(onPollError);
    }).catch(function (error) {
      if (!error.unauthorized) toast('吊销节点失败：' + error.message, true);
    });
  }

  function rotatePairingCode() {
    if (!confirm('轮换配对码？旧配对码会立即失效，已配对的节点和客户端不受影响。')) return;
    request(API.rotatePairing, {method: 'POST'}).then(function (data) {
      var codeEl = qs('#pairing-code');
      if (codeEl) codeEl.textContent = (data && data.pairingCode) || '—';
      toast('配对码已轮换，请把新配对码告诉要接入的电脑');
    }).catch(function (error) {
      if (!error.unauthorized) toast('轮换配对码失败：' + error.message, true);
    });
  }

  // ---------------------------------------------------------------------------
  // 任务
  // ---------------------------------------------------------------------------
  function renderTasks() {
    if (state.view !== 'tasks') return;
    var body = qs('#tasks-body');
    if (!body) return;
    var tasks = state.tasks || [];
    var summary = qs('#tasks-summary');
    if (summary) summary.textContent = '共 ' + state.tasksTotal + ' 个任务，显示 ' + tasks.length + ' 条';
    fillTaskProjectOptions(tasks);
    if (!tasks.length) {
      body.innerHTML = '<tr><td colspan="9" class="empty">没有符合条件的任务。可以在现有工具里提交协作生成，或调整筛选条件。</td></tr>';
      return;
    }
    body.innerHTML = tasks.map(function (task) {
      var status = task.status || 'queued';
      var apply = task.apply || {};
      var applyStatus = apply.status || 'pending';
      return '<tr data-task-id="' + esc(task.id) + '">' +
        '<td><strong>' + esc(task.projectName || task.projectId || '—') + '</strong><div class="sub">' + esc(shortId(task.projectId)) + '</div></td>' +
        '<td>' + esc(task.panelCode || '—') + '<div class="sub">' +
          (task.episode ? '第 ' + esc(task.episode) + ' 话 · ' : '') + esc(task.panelId ? shortId(task.panelId) : '') + '</div></td>' +
        '<td>' + esc(TASK_TYPE_LABEL[task.type] || task.type || '—') + '</td>' +
        '<td>' + badge(status, TASK_STATUS_LABEL[status] || status) + '<div class="sub">' + esc(PHASE_LABEL[task.phase] || task.phase || '') + '</div></td>' +
        '<td>' + badge(applyStatus, APPLY_LABEL[applyStatus] || applyStatus, 'apply') + '</td>' +
        '<td>' + esc(shortId(task.assignedNodeId)) + '</td>' +
        '<td>' + esc(task.activeAttempt || '—') + '</td>' +
        '<td title="' + esc(fmtTime(task.updatedAt)) + '">' + esc(fmtRelative(task.updatedAt)) + '</td>' +
        '<td><button type="button" class="small" data-task-open="' + esc(task.id) + '">详情</button></td>' +
      '</tr>';
    }).join('');
  }

  function fillTaskProjectOptions(tasks) {
    var datalist = qs('#task-project-options');
    if (!datalist) return;
    var seen = {};
    var options = '';
    (tasks || []).forEach(function (task) {
      if (!task.projectId || seen[task.projectId]) return;
      seen[task.projectId] = true;
      options += '<option value="' + esc(task.projectId) + '" label="' + esc(task.projectName || '') + '"></option>';
    });
    if (datalist.innerHTML !== options) datalist.innerHTML = options;
  }

  function openTaskDetail(taskId) {
    openDrawer('任务详情', '<p class="muted">正在加载任务 ' + esc(shortId(taskId)) + '…</p>');
    request(API.task(taskId)).then(function (data) {
      var task = data && data.task ? data.task : data;
      if (!task || !task.id) throw new Error('中控没有返回任务详情');
      renderTaskDetail(task);
    }).catch(function (error) {
      var body = qs('#drawer-body');
      if (body) body.innerHTML = '<p class="form-error">加载任务详情失败：' + esc(error.message) + '</p>';
    });
  }

  function renderTaskDetail(task) {
    var status = task.status || 'queued';
    var apply = task.apply || {};
    var applyStatus = apply.status || 'pending';
    var attempts = Array.isArray(task.attempts) ? task.attempts : [];
    var references = Array.isArray(task.references) ? task.references : [];
    var events = Array.isArray(task.events) ? task.events : [];
    var lateResults = Array.isArray(task.lateResults) ? task.lateResults : [];
    var html = '';

    html += '<div class="detail-top">' + badge(status, TASK_STATUS_LABEL[status] || status) +
      badge(applyStatus, '回填：' + (APPLY_LABEL[applyStatus] || applyStatus), 'apply') +
      '<span class="muted mono">' + esc(task.id) + '</span></div>';

    html += '<div class="kv-grid">' +
      kv('项目', (task.projectName || '—') + (task.projectId ? '（' + shortId(task.projectId) + '）' : '')) +
      kv('话', task.episode ? '第 ' + task.episode + ' 话' : '—') +
      kv('画格', task.panelCode || '—') +
      kv('镜头', task.shotCode || '—') +
      kv('类型', TASK_TYPE_LABEL[task.type] || task.type || '—') +
      kv('提交人', shortId(task.submittedBy)) +
      kv('提交时间', fmtTime(task.submittedAt)) +
      kv('更新时间', fmtTime(task.updatedAt)) +
      kv('节点', shortId(task.assignedNodeId)) +
      kv('当前尝试', task.activeAttempt || '—') +
      kv('尺寸', sizeText(task.size)) +
      '</div>';

    html += section('提示词', '<pre class="prompt mono">' + esc(task.prompt || '（空）') + '</pre>');
    html += section('画风', '<p>' + esc(task.style || '（未指定画风）') + '</p>');
    if (task.target) html += details('target（回填版本校验字段）', JSON.stringify(task.target, null, 2));
    if (task.generationInput) html += details('generationInput（与本地生图 input 同构）', JSON.stringify(task.generationInput, null, 2));

    html += '<section><h3>参考图（' + references.length + '）</h3>' +
      (references.length ? '<div class="ref-grid">' + references.map(function (reference) {
        var sha = reference.sha256 || '';
        var thumb = sha ? imageUrl(API.blobThumb(sha)) : '';
        var full = sha ? imageUrl(API.blob(sha)) : '';
        return '<figure class="ref">' +
          (thumb
            ? '<a href="' + esc(full) + '" target="_blank" rel="noopener"><img src="' + esc(thumb) + '" data-fallback="' + esc(full) + '" alt="" loading="lazy"></a>'
            : '<span class="thumb placeholder">无图片</span>') +
          '<figcaption>' + esc(reference.name || '—') + '<br><span class="muted">' + esc(reference.role || '—') + ' · ' + esc(bytesText(reference.size)) +
          (sha ? '<br>' + esc(shortId(sha)) : '') + '</span></figcaption></figure>';
      }).join('') + '</div>' : '<p class="muted">没有参考图。</p>') + '</section>';

    html += '<section><h3>执行尝试（' + attempts.length + '）</h3>' +
      (attempts.length ? '<ol class="timeline">' + attempts.map(function (attempt) {
        var attemptStatus = attempt.status || 'claimed';
        return '<li class="timeline-item s-' + esc(attemptStatus) + '">' +
          '<div class="timeline-head"><strong>#' + esc(attempt.attempt) + ' ' + esc(ATTEMPT_LABEL[attemptStatus] || attemptStatus) + '</strong>' +
          '<span class="muted">节点 ' + esc(shortId(attempt.nodeId)) + '</span></div>' +
          '<div class="sub">领取：' + esc(fmtTime(attempt.claimedAt)) + ' · 完成：' + esc(fmtTime(attempt.finishedAt)) +
          (attempt.generationStartedAt ? ' · 开始生成：' + esc(fmtTime(attempt.generationStartedAt)) : '') + '</div>' +
          (attempt.error ? '<div class="form-error small">' + esc(attempt.error) + '</div>' : '') +
        '</li>';
      }).join('') + '</ol>' : '<p class="muted">还没有执行记录。</p>') + '</section>';

    var result = task.result;
    if (result && result.sha256) {
      var fullUrl = imageUrl(API.blob(result.sha256));
      html += '<section><h3>结果</h3>' +
        '<figure class="result"><img src="' + esc(fullUrl) + '" alt="协作生成结果预览" loading="lazy"></figure>' +
        '<p class="muted">' + esc(result.mime || 'image') + ' · ' + esc(bytesText(result.size)) + ' · ' +
        esc((result.width || '?') + '×' + (result.height || '?')) + ' · 节点 ' + esc(shortId(result.nodeId)) +
        ' · 尝试 #' + esc(result.attempt || '?') + ' · ' + esc(fmtTime(result.uploadedAt)) + '</p>' +
        '<p class="mono sub">sha256: ' + esc(result.sha256) + '</p>' +
        '<p><a class="button" href="' + esc(fullUrl) + '" download="' + esc(downloadName(task)) + '">下载原图</a></p>' +
      '</section>';
    } else if (status === 'done') {
      html += section('结果', '<p class="muted">任务已完成，但中控没有返回 result 记录（可能结果 blob 已清理）。</p>');
    } else {
      html += section('结果', '<p class="muted">任务还没有可预览的结果。</p>');
    }

    if (lateResults.length) {
      html += '<section><h3>迟到结果（' + lateResults.length + '，未覆盖当前结果）</h3><ul class="plain-list">' +
        lateResults.map(function (late) {
          return '<li>尝试 #' + esc(late.attempt) + ' · 节点 ' + esc(shortId(late.nodeId)) + ' · ' + esc(fmtTime(late.uploadedAt)) +
            ' · 原因 ' + esc(late.reason || '—') + '<br><span class="mono sub">' + esc(shortId(late.sha256)) + '</span></li>';
        }).join('') + '</ul></section>';
    }

    html += '<section><h3>回填状态</h3>' + badge(applyStatus, APPLY_LABEL[applyStatus] || applyStatus, 'apply') +
      (apply.detail ? '<p class="muted">' + esc(apply.detail) + '</p>' : '') +
      '<p class="sub muted">' + esc(apply.at ? ('时间：' + fmtTime(apply.at)) : '时间：—') + ' · ' + esc(apply.by ? ('操作人：' + shortId(apply.by)) : '操作人：—') + '</p>' +
    '</section>';

    if (events.length) {
      html += '<section><h3>事件（最近 ' + Math.min(events.length, 30) + ' 条）</h3><ul class="plain-list">' +
        events.slice(-30).reverse().map(function (event) {
          return '<li><span class="muted">' + esc(fmtTime(event.at)) + '</span> · ' + esc(event.type || 'event') +
            (event.message ? ' · ' + esc(event.message) : '') + '</li>';
        }).join('') + '</ul></section>';
    }

    var actions = '';
    if (['queued', 'running', 'uploading', 'verifying'].indexOf(status) >= 0) {
      actions += '<button type="button" class="danger" data-task-action="cancel" data-task-id="' + esc(task.id) + '">取消任务</button>';
    }
    if (['failed', 'verifying', 'cancelled'].indexOf(status) >= 0) {
      actions += '<button type="button" class="primary" data-task-action="retry" data-task-id="' + esc(task.id) + '">重新派单</button>';
    }
    if (actions) html += '<div class="drawer-actions">' + actions + '</div>';

    openDrawer('任务详情 · ' + (task.panelCode || shortId(task.id)), html);
  }

  function downloadName(task) {
    var code = String((task && task.panelCode) || (task && task.id) || 'result').replace(/[^\w.-]+/g, '_');
    return code + '.png';
  }

  function kv(label, value) {
    return '<div class="kv"><span class="kv-label">' + esc(label) + '</span><span class="kv-value">' + esc(value || '—') + '</span></div>';
  }

  function section(title, body) {
    return '<section><h3>' + esc(title) + '</h3>' + body + '</section>';
  }

  function details(summary, textContent) {
    return '<details class="raw"><summary>' + esc(summary) + '</summary><pre class="mono">' + esc(textContent) + '</pre></details>';
  }

  function runTaskAction(path, okMessage, taskId) {
    request(path, {method: 'POST', body: path.indexOf('retry') >= 0 ? {reason: '控制台手动重新派单'} : undefined})
      .then(function () {
        toast(okMessage);
        openTaskDetail(taskId);
        pollTasks().catch(onPollError);
      })
      .catch(function (error) {
        if (!error.unauthorized) toast('操作失败：' + error.message, true);
      });
  }

  // ---------------------------------------------------------------------------
  // 共享资产
  // ---------------------------------------------------------------------------
  function renderAssets() {
    if (state.view !== 'assets') return;
    var grid = qs('#assets-grid');
    if (!grid) return;
    var summary = qs('#assets-summary');
    if (summary) summary.textContent = '共 ' + state.assetsTotal + ' 个资产，显示 ' + state.assets.length + ' 条';
    var assets = state.assets || [];
    if (!assets.length) {
      grid.innerHTML = '<p class="empty">没有符合条件的共享资产。协作生成完成或有资产申请后会自动入库。</p>';
      return;
    }
    grid.innerHTML = assets.map(function (asset) {
      var status = asset.status || 'available';
      var kind = asset.kind || 'other';
      var sha = asset.sha256 || '';
      var thumb = sha ? imageUrl(API.blobThumb(sha)) : '';
      var full = sha ? imageUrl(API.blob(sha)) : '';
      var meta = [asset.form, asset.costume, asset.style].filter(Boolean).join(' · ') || '—';
      return '<article class="asset-card" data-asset-id="' + esc(asset.id) + '">' +
        '<div class="asset-thumb">' +
          (thumb
            ? '<img src="' + esc(thumb) + '" data-fallback="' + esc(full) + '" alt="' + esc(asset.name || '资产') + '" loading="lazy">'
            : '<span class="thumb placeholder">' + esc(ASSET_STATUS_LABEL[status] || status) + '</span>') +
          '<span class="asset-version">v' + esc(asset.version || 1) + '</span>' +
        '</div>' +
        '<div class="asset-body">' +
          '<strong>' + esc(asset.name || '未命名资产') + '</strong>' +
          '<div class="chips">' + badge(status, ASSET_STATUS_LABEL[status] || status) +
            '<span class="chip">' + esc(ASSET_KIND_LABEL[kind] || kind) + '</span></div>' +
          '<p class="sub">' + esc(meta) + '</p>' +
          '<p class="sub">项目：' + esc(shortId(asset.projectId)) +
            (asset.sourceTaskId ? ' · 来源任务：' + esc(shortId(asset.sourceTaskId)) : '') + '</p>' +
          '<button type="button" class="small wide" data-asset-open="' + esc(asset.id) + '">详情 / 下载</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function openAssetDetail(assetId) {
    openDrawer('资产详情', '<p class="muted">正在加载资产 ' + esc(shortId(assetId)) + '…</p>');
    request(API.asset(assetId)).then(function (data) {
      var asset = data && data.asset ? data.asset : data;
      if (!asset || !asset.id) throw new Error('中控没有返回资产详情');
      var versions = (data && Array.isArray(data.versions) && data.versions.length) ? data.versions : [asset];
      renderAssetDetail(asset, versions);
    }).catch(function (error) {
      var body = qs('#drawer-body');
      if (body) body.innerHTML = '<p class="form-error">加载资产详情失败：' + esc(error.message) + '</p>';
    });
  }

  function renderAssetDetail(asset, versions) {
    var status = asset.status || 'available';
    var sha = asset.sha256 || '';
    var full = sha ? imageUrl(API.blob(sha)) : '';
    var thumb = sha ? imageUrl(API.blobThumb(sha)) : '';
    var html = '';

    html += '<div class="detail-top">' + badge(status, ASSET_STATUS_LABEL[status] || status) +
      '<span class="chip">' + esc(ASSET_KIND_LABEL[asset.kind] || asset.kind || '其他') + '</span>' +
      '<span class="muted mono">' + esc(asset.id) + '</span></div>';

    html += '<figure class="result asset-preview">' +
      (thumb
        ? '<img src="' + esc(thumb) + '" data-fallback="' + esc(full) + '" alt="' + esc(asset.name || '资产') + '">'
        : '<span class="thumb placeholder">暂无图片</span>') + '</figure>';

    html += '<div class="kv-grid">' +
      kv('名称', asset.name) +
      kv('形态 form', asset.form) +
      kv('服装 costume', asset.costume) +
      kv('画风 style', asset.style) +
      kv('版本', 'v' + (asset.version || 1)) +
      kv('项目', shortId(asset.projectId)) +
      kv('来源任务', asset.sourceTaskId ? shortId(asset.sourceTaskId) : '—') +
      kv('来源节点', asset.sourceNodeId ? shortId(asset.sourceNodeId) : '—') +
      kv('尺寸', (asset.width || '?') + ' × ' + (asset.height || '?')) +
      kv('大小', bytesText(asset.size)) +
      kv('创建时间', fmtTime(asset.createdAt)) +
      kv('sha256', shortId(sha)) +
      '</div>';

    html += '<div class="drawer-actions">' +
      (sha ? '<a class="button primary" href="' + esc(full) + '" download="' + esc(String(asset.name || 'asset').replace(/[^\w.-]+/g, '_') + '.png') + '">下载原图</a>' : '') +
      (asset.sourceTaskId ? '<button type="button" data-asset-source-task="' + esc(asset.sourceTaskId) + '">查看来源任务</button>' : '') +
    '</div>';

    html += '<section><h3>版本列表（同谱系，新 → 旧，共 ' + versions.length + ' 个）</h3><div class="version-list">' +
      versions.map(function (version) {
        var versionSha = version.sha256 || '';
        var versionThumb = versionSha ? imageUrl(API.blobThumb(versionSha)) : '';
        var versionFull = versionSha ? imageUrl(API.blob(versionSha)) : '';
        var current = version.id === asset.id;
        return '<div class="version-item' + (current ? ' current' : '') + '">' +
          (versionThumb
            ? '<a href="' + esc(versionFull) + '" target="_blank" rel="noopener"><img src="' + esc(versionThumb) + '" data-fallback="' + esc(versionFull) + '" alt="" loading="lazy"></a>'
            : '<span class="thumb placeholder">无图</span>') +
          '<div class="version-body"><strong>v' + esc(version.version || 1) + (current ? ' · 当前查看' : '') + '</strong>' +
            '<div class="sub">' + esc(version.form || '—') + ' · ' + esc(fmtTime(version.createdAt)) + '</div>' +
            '<div class="sub mono">' + esc(shortId(versionSha)) + ' · ' + esc(bytesText(version.size)) + '</div>' +
            (versionSha ? '<a class="link" href="' + esc(versionFull) + '" download="' + esc(String(version.name || 'asset').replace(/[^\w.-]+/g, '_') + '-v' + (version.version || 1) + '.png') + '">下载此版本</a>' : '') +
          '</div></div>';
      }).join('') + '</div></section>';

    openDrawer('资产详情 · ' + (asset.name || shortId(asset.id)), html);
  }

  // ---------------------------------------------------------------------------
  // 通知
  // ---------------------------------------------------------------------------
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
        '<span class="notice-type">' + esc(typeLabel) + ' · ' + esc(level) + '</span>' +
        '<time class="muted">' + esc(fmtTime(item.createdAt)) + '</time></div>' +
      (item.body ? '<p class="notice-body">' + esc(item.body) + '</p>' : '') +
      '<div class="notice-foot">' + (read ? '<span class="muted sub">已读</span>' : '<button type="button" class="link" data-notice-read="' + esc(item.id) + '">标记已读</button>') + links + '</div>' +
    '</li>';
  }

  function renderNotifications() {
    if (state.view !== 'notifications') return;
    var list = qs('#notifications-list');
    if (!list) return;
    var items = state.notifications || [];
    list.innerHTML = items.length ? items.map(noticeItemHtml).join('') : '<li class="empty">还没有通知。任务完成、失败、资产入库、节点上下线时会出现在这里。</li>';
    updateUnreadBadge();
  }

  function findNotification(notificationId) {
    var items = state.notifications || [];
    for (var index = 0; index < items.length; index += 1) {
      if (items[index].id === notificationId) return items[index];
    }
    return null;
  }

  function markRead(ids, silent) {
    var unique = [];
    (ids || []).forEach(function (id) { if (id && unique.indexOf(id) < 0) unique.push(id); });
    if (!unique.length) return Promise.resolve();
    return request(API.notificationsRead, {method: 'POST', body: {ids: unique, clientId: state.clientId}})
      .then(function () {
        unique.forEach(function (id) {
          var item = findNotification(id);
          if (item) {
            if (!Array.isArray(item.readBy)) item.readBy = [];
            if (state.clientId && item.readBy.indexOf(state.clientId) < 0) item.readBy.push(state.clientId);
          }
        });
        updateUnreadBadge();
        if (state.view === 'notifications') renderNotifications();
        if (state.view === 'overview') renderOverview();
        if (!silent) toast('已标记 ' + unique.length + ' 条通知为已读');
      })
      .catch(function (error) {
        if (!error.unauthorized) toast('标记已读失败：' + error.message, true);
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
    var drawer = qs('#drawer');
    var mask = qs('#drawer-mask');
    if (!drawer || !mask) return;
    var titleEl = qs('#drawer-title');
    if (titleEl) titleEl.textContent = title;
    var body = qs('#drawer-body');
    if (body) body.innerHTML = html;
    drawer.hidden = false;
    mask.hidden = false;
    document.body.classList.add('drawer-open');
  }

  function closeDrawer() {
    var drawer = qs('#drawer');
    var mask = qs('#drawer-mask');
    if (drawer) drawer.hidden = true;
    if (mask) mask.hidden = true;
    document.body.classList.remove('drawer-open');
  }

  // ---------------------------------------------------------------------------
  // 事件绑定
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
    var pairButton = qs('#pair-submit');
    if (pairButton) pairButton.addEventListener('click', submitPair);
    var pairCode = qs('#pair-code');
    if (pairCode) pairCode.addEventListener('keydown', function (event) { if (event.key === 'Enter') submitPair(); });
    var pairName = qs('#pair-name');
    if (pairName) pairName.addEventListener('keydown', function (event) { if (event.key === 'Enter') submitPair(); });

    var tabs = qs('.tabs');
    if (tabs) {
      tabs.addEventListener('click', function (event) {
        var tab = event.target.closest ? event.target.closest('[data-view]') : null;
        if (tab) switchView(tab.getAttribute('data-view'));
      });
    }

    var disconnectButton = qs('#btn-disconnect');
    if (disconnectButton) disconnectButton.addEventListener('click', disconnect);

    var nodesRefresh = qs('#btn-nodes-refresh');
    if (nodesRefresh) nodesRefresh.addEventListener('click', function () { pollNodes().catch(onPollError); });
    var tasksRefresh = qs('#btn-tasks-refresh');
    if (tasksRefresh) tasksRefresh.addEventListener('click', function () { pollTasks().catch(onPollError); });
    var assetsRefresh = qs('#btn-assets-refresh');
    if (assetsRefresh) assetsRefresh.addEventListener('click', function () { pollAssets().catch(onPollError); });
    var notifRefresh = qs('#btn-notif-refresh');
    if (notifRefresh) notifRefresh.addEventListener('click', function () { pollNotifications().catch(onPollError); toast('通知已刷新'); });
    var readAll = qs('#btn-notif-readall');
    if (readAll) readAll.addEventListener('click', markAllRead);
    var pairingRefresh = qs('#btn-pairing-refresh');
    if (pairingRefresh) pairingRefresh.addEventListener('click', loadPairingCode);
    var pairingRotate = qs('#btn-pairing-rotate');
    if (pairingRotate) pairingRotate.addEventListener('click', rotatePairingCode);

    var nodesBody = qs('#nodes-body');
    if (nodesBody) {
      nodesBody.addEventListener('change', function (event) {
        var field = event.target.closest ? event.target.closest('[data-node-field]') : null;
        if (!field) return;
        var row = field.closest('tr');
        if (row) applyNodeSettings(row.getAttribute('data-node-id'));
      });
      nodesBody.addEventListener('click', function (event) {
        var action = event.target.closest ? event.target.closest('[data-node-action]') : null;
        if (!action) return;
        var row = action.closest('tr');
        if (row) revokeNode(row.getAttribute('data-node-id'));
      });
    }

    var taskStatus = qs('#task-status');
    if (taskStatus) taskStatus.addEventListener('change', function () {
      state.taskFilter.status = taskStatus.value;
      pollTasks().catch(onPollError);
    });
    var taskApply = qs('#task-apply');
    if (taskApply) taskApply.addEventListener('change', function () {
      state.taskFilter.applyStatus = taskApply.value;
      pollTasks().catch(onPollError);
    });
    var taskProject = qs('#task-project');
    if (taskProject) taskProject.addEventListener('input', debounce(function () {
      state.taskFilter.projectId = taskProject.value.trim();
      pollTasks().catch(onPollError);
    }, 300));

    var assetQ = qs('#asset-q');
    if (assetQ) assetQ.addEventListener('input', debounce(function () {
      state.assetFilter.q = assetQ.value.trim();
      pollAssets().catch(onPollError);
    }, 300));
    var assetProject = qs('#asset-project');
    if (assetProject) assetProject.addEventListener('input', debounce(function () {
      state.assetFilter.projectId = assetProject.value.trim();
      pollAssets().catch(onPollError);
    }, 300));
    var assetKind = qs('#asset-kind');
    if (assetKind) assetKind.addEventListener('change', function () {
      state.assetFilter.kind = assetKind.value;
      pollAssets().catch(onPollError);
    });
    var assetStatus = qs('#asset-status');
    if (assetStatus) assetStatus.addEventListener('change', function () {
      state.assetFilter.status = assetStatus.value;
      pollAssets().catch(onPollError);
    });
    var allVersions = qs('#asset-all-versions');
    if (allVersions) allVersions.addEventListener('change', function () {
      state.assetFilter.allVersions = allVersions.checked;
      pollAssets().catch(onPollError);
    });

    var drawerClose = qs('#drawer-close');
    if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
    var drawerMask = qs('#drawer-mask');
    if (drawerMask) drawerMask.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeDrawer(); });

    var drawerBody = qs('#drawer-body');
    if (drawerBody) {
      drawerBody.addEventListener('click', function (event) {
        var target = event.target.closest ? event.target.closest('[data-task-action],[data-asset-source-task]') : null;
        if (!target) return;
        if (target.hasAttribute('data-task-action')) {
          var action = target.getAttribute('data-task-action');
          var taskId = target.getAttribute('data-task-id');
          if (!taskId) return;
          if (action === 'cancel') {
            if (!confirm('取消任务 ' + shortId(taskId) + '？未完成的任务会被标记为已取消。')) return;
            runTaskAction(API.taskCancel(taskId), '任务已取消', taskId);
          } else if (action === 'retry') {
            if (!confirm('重新派单 ' + shortId(taskId) + '？会创建新的执行尝试并保留历史记录。')) return;
            runTaskAction(API.taskRetry(taskId), '已重新派单，等待节点领取', taskId);
          }
          return;
        }
        var sourceTask = target.getAttribute('data-asset-source-task');
        if (sourceTask) openTaskDetail(sourceTask);
      });
    }

    document.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-view-link],[data-task-open],[data-asset-open],[data-notice-task],[data-notice-asset],[data-notice-read]') : null;
      if (!target) return;
      if (target.hasAttribute('data-view-link')) { switchView(target.getAttribute('data-view-link')); return; }
      if (target.hasAttribute('data-task-open')) { openTaskDetail(target.getAttribute('data-task-open')); return; }
      if (target.hasAttribute('data-asset-open')) { openAssetDetail(target.getAttribute('data-asset-open')); return; }
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

    // 图片缩略图不可用时自动回退原图（协议 §4.3 thumb 不可用返回 404）。
    document.addEventListener('error', function (event) {
      var image = event.target;
      if (!image || image.tagName !== 'IMG') return;
      var fallback = image.getAttribute('data-fallback');
      if (!fallback) return;
      image.removeAttribute('data-fallback');
      image.src = fallback;
    }, true);
  }

  // ---------------------------------------------------------------------------
  // 启动
  // ---------------------------------------------------------------------------
  function boot() {
    var originEl = qs('#pair-origin');
    if (originEl) originEl.textContent = location.origin;
    bindEvents();

    var flash = null;
    try {
      flash = sessionStorage.getItem(FLASH_KEY);
      if (flash) sessionStorage.removeItem(FLASH_KEY);
    } catch (error) { flash = null; }

    if (!state.token) {
      showPairScreen();
      var fromUrl = new URLSearchParams(location.search).get('pair');
      if (fromUrl) {
        var codeInput = qs('#pair-code');
        if (codeInput) codeInput.value = fromUrl.toUpperCase();
        setTimeout(submitPair, 250);
      }
      return;
    }

    enterConsole();
    if (flash) toast(flash);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
