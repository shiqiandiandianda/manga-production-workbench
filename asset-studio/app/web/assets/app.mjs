const $ = selector => document.querySelector(selector);
let mokuCheck=null;

const state = {
  type: 'character',
  mode: 'text',
  reference: null,
  costumeReference: null,
  handReference: null,
  prompts: [],
  request: null,
  ready: false,
  job: null,
  timer: null,
  busy: false,
  asset: null,
  referenceLoadVersion: 0
};

const TYPE_LABEL = {character: '角色', scene: '场景', prop: '道具'};
const STATUS_LABEL = {
  queued: '排队中',
  running: '生成中',
  completed: '已完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消'
};

init();

async function init() {
  if (new URLSearchParams(location.search).get('embed') === '1') {
    document.body.classList.add('embed');
  }
  bindEvents();
  updateModeFields();
  await Promise.all([loadHealth(), loadRequests(), loadMoku()]);window.assetStudioReady=true;window.dispatchEvent(new Event('asset-studio-ready'));
  $('#moku-refresh').addEventListener('click',()=>void loadMoku());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void loadMoku();});
  setInterval(()=>{if(!document.hidden)void loadMoku();},30000);
}

function bindEvents() {
 for(const id of ['reference','costume-reference']){const input=document.getElementById(id),zone=input.closest('.upload');zone.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();});zone.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();const file=e.dataTransfer?.files?.[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024){showError('请拖入不超过20MB的PNG、JPEG或WebP图片');return;}const data=new DataTransfer();data.items.add(file);input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));});}

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      if (state.busy) return;
      state.type = tab.dataset.type;
      for (const item of document.querySelectorAll('.tab')) item.classList.toggle('active', item === tab);
      setOutfitLabel();
      applyTypeUi();
      renderPicker();
      selectFirst();
    });
  }

  for (const button of document.querySelectorAll('.mode')) {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      for (const item of document.querySelectorAll('.mode')) item.classList.toggle('active', item === button);
      updateModeFields();
    });
  }

  $('#reference').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.reference = String(reader.result);
      $('#reference-image').src = state.reference;
      $('#reference-preview').hidden = false;
      event.target.closest('.upload').querySelector('.upload-box').hidden = true;
    };
    reader.readAsDataURL(file);
  });

  $('#reference-clear').addEventListener('click', () => {
    state.reference = null;
    $('#reference').value = '';
    $('#reference-preview').hidden = true;
    $('#reference-image').removeAttribute('src');
    $('#reference-preview').closest('.upload').querySelector('.upload-box').hidden = false;
  });

  $('#costume-reference').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.costumeReference = String(reader.result);
      $('#costume-reference-image').src = state.costumeReference;
      $('#costume-reference-preview').hidden = false;
      event.target.closest('.upload').querySelector('.upload-box').hidden = true;
    };
    reader.readAsDataURL(file);
  });

  $('#costume-reference-clear').addEventListener('click', () => {
    state.costumeReference = null;
    $('#costume-reference').value = '';
    $('#costume-reference-preview').hidden = true;
    $('#costume-reference-image').removeAttribute('src');
    $('#costume-reference-preview').closest('.upload').querySelector('.upload-box').hidden = false;
  });

  $('#hand-reference').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.handReference = String(reader.result);
      $('#hand-reference-image').src = state.handReference;
      $('#hand-reference-preview').hidden = false;
      event.target.closest('.upload').querySelector('.upload-box').hidden = true;
    };
    reader.readAsDataURL(file);
  });

  $('#hand-reference-clear').addEventListener('click', () => {
    state.handReference = null;
    $('#hand-reference').value = '';
    $('#hand-reference-preview').hidden = true;
    $('#hand-reference-image').removeAttribute('src');
    $('#hand-reference-preview').closest('.upload').querySelector('.upload-box').hidden = false;
  });

  $('#picker').addEventListener('change', event => {
    const record = state.prompts.find(item => item.id === event.target.value);
    if (!record) return;
    applyRequest(record);
  });

  $('#generate').addEventListener('click', () => void generate());
  $('#adopt').addEventListener('click', () => void adopt());
  $('#push').addEventListener('click', () => void pushToEditor());
  $('#moku-project').addEventListener('change', async event => {
    const projectId = event.target.value;
    if (!projectId) return;
    try {
      const response = await fetch('/api/moku/project', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({projectId})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '切换失败');
      await loadMoku();
    } catch (error) {
      showError(error.message);
    }
  });
  $('#retry').addEventListener('click', () => {
    if (state.busy) return;
    void generate();
  });
}

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    const engines = data.engines?.engines || {};
    const ok = Boolean(data.ok);
    $('#dot').className = `dot ${ok ? 'ok' : 'bad'}`;
    $('#status-text').textContent = ok ? '编辑器资产工程在线' : '编辑器或资产工程未就绪';
  } catch {
    $('#dot').className = 'dot bad';
    $('#status-text').textContent = '连接失败';
  }
}

async function loadMoku() {
  if(mokuCheck)return mokuCheck;
  const refresh=$('#moku-refresh');refresh.disabled=true;
  mokuCheck=(async()=>{
    try {
      const response=await fetch('/api/moku/status',{signal:AbortSignal.timeout(10000),cache:'no-store'}),data=await response.json();
      if(!response.ok)throw Error(data.error||'连接失败');
      $('#moku').textContent=data.ok?`已连接 · ${data.user?.displayName||data.user?.username||'墨库'}`:(data.error||'未连接');
      const select=$('#moku-project'),projects=data.projects||[],options=projects.map(p=>[p.id,p.name]);
      if(!options.length)options.push([data.projectId||'',data.projectName||'无可用项目']);
      if(JSON.stringify([...select.options].map(o=>[o.value,o.text]))!==JSON.stringify(options))select.replaceChildren(...options.map(([value,label])=>new Option(label,value)));
      select.value=data.projectId||'';select.disabled=!data.ok;
    } catch {
      $('#moku').textContent='连接失败，可重新检查';$('#moku-project').disabled=true;
    }
  })().finally(()=>{mokuCheck=null;refresh.disabled=false;});
  return mokuCheck;
}

async function loadRequests() {
  try {
    const response = await fetch('/api/requests');
    const data = await response.json();
    state.prompts = data.requests || [];
    renderPicker();
    if (!applyDeepLink()) selectFirst();
  } catch {
    renderPicker();
  }
}

function setOutfitLabel() {
  const label = $('#outfit-field .field-label');
  if (label) {
    label.textContent = state.type === 'character'
      ? '服装 / 形态'
      : state.type === 'scene'
        ? '机位 / 时间'
        : '类型 / 状态';
  }
  $('#outfit-field').hidden = false;
}

function applyRequest(record) {
  $('#character-role').value=record.characterRole||'auto';$('#character-appearance-notes').value=record.appearanceNotes||'';
  state.request = record;
  state.ready = Boolean(record.ready);
  state.type = record.type || state.type;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.type === state.type);
  }
  setOutfitLabel();

  state.mode = record.mode || 'text';
  for (const button of document.querySelectorAll('.mode')) {
    button.classList.toggle('active', button.dataset.mode === state.mode);
  }
  updateModeFields();

  $('#name').value = record.name || '';
  $('#outfit').value = record.outfit || '';
  $('#prompt').value = record.executionPrompt || record.prompt || '';
  $('#size').value = record.size || (state.type === 'character' ? '1024x1536' : '1536x1024');
  if (state.type === 'scene') {
    const sceneMeta = record.sceneMeta || {};
    let camera = sceneMeta.camera || '', time = sceneMeta.time || '', weather = sceneMeta.weather || '';
    const parts = String(record.outfit || '').split(' · ').map(value => value.trim()).filter(Boolean);
    if (!camera && !time && !weather && parts.length >= 2) [camera, time, weather] = [parts[0] || '', parts[1] || '', parts[2] || ''];
    $('#scene-camera').value = camera;
    $('#scene-time').value = time;
    $('#scene-weather').value = weather;
    applyTypeUi();
  }

  const meta = $('#request-meta');
  meta.replaceChildren();
  const add = (label, value) => {
    if (!value) return;
    const span = document.createElement('span');
    const strong = document.createElement('b');
    strong.textContent = label;
    span.append(strong, ` ${value}`);
    meta.append(span);
  };
  add('资产', record.assetId);
  add('变体', record.variantId);
  add('首用', record.firstPanel);
  add('用途', record.usage);
  meta.hidden = !record.assetId;

  const source = $('#request-source');
  const sourceText = $('#request-source-text');
  if (record.requestPrompt) {
    source.hidden = false;
    source.open = false;
    sourceText.textContent = record.requestPrompt;
  } else {
    source.hidden = true;
  }

  const spec = $('#spec-status');
  spec.hidden = false;
  spec.className = `spec-status ${record.ready ? 'ready' : 'blocked'}`;
  if (record.ready) {
    spec.innerHTML = record.type === 'scene'
      ? '<span class="badge ok">场景参数齐</span><span>正视图 + 反打，各 16:9</span>'
      : '<span class="badge ok">规格齐</span><span>身份与服装参考已绑定</span>';
  } else {
    const missing = (record.missing || []).map(item => `<span class="badge warn">缺 ${item}</span>`).join('');
    spec.innerHTML = `<span class="badge bad">缺规格</span>${missing}<span>补齐后才能生成</span>`;
  }
  if (record.warning) spec.innerHTML += `<span class="badge warn">${record.warning}</span>`;

  updateGenerateState();
  void loadAutoReferences(record);
}

function updateGenerateState() {
  $('#generate').disabled = state.busy || !state.ready;
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function clearReferencePreviews() {
  state.referenceLoadVersion++;
  state.reference = null;
  state.costumeReference = null;
  state.handReference = null;
  for (const [preview, image] of [
    ['#reference-preview', '#reference-image'],
    ['#costume-reference-preview', '#costume-reference-image'],
    ['#hand-reference-preview', '#hand-reference-image']
  ]) {
    $(preview).hidden = true;
    $(image).removeAttribute('src');
    $(preview).closest('.upload').querySelector('.upload-box').hidden = false;
  }
}

async function loadReference(editorId, kind, version = state.referenceLoadVersion) {
  if (!editorId) return;
  try {
    const response = await fetch(`/api/editor-image?id=${encodeURIComponent(editorId)}`);
    if (!response.ok) throw new Error(`参考图 ${editorId} 读取失败`);
    const dataUrl = await blobToDataUrl(await response.blob());
    if (version !== state.referenceLoadVersion) return;
    state[kind] = dataUrl;
    const map = {
      reference: ['#reference-preview', '#reference-image'],
      costumeReference: ['#costume-reference-preview', '#costume-reference-image'],
      handReference: ['#hand-reference-preview', '#hand-reference-image']
    };
    const [preview, image] = map[kind];
    $(image).src = dataUrl;
    $(preview).hidden = false;
    $(preview).closest('.upload').querySelector('.upload-box').hidden = true;
  } catch (error) {
    console.warn(error.message);
  }
}

async function loadAutoReferences(record) {
  clearReferencePreviews();
  await Promise.all([
    loadReference(record.referenceEditorId, 'reference'),
    loadReference(record.costumeReferenceEditorId, 'costumeReference'),
    loadReference(record.handReferenceEditorId, 'handReference')
  ]);
}

function applyDeepLink() {
  const wanted = new URLSearchParams(location.search).get('asset');
  if (!wanted) return false;
  const record = state.prompts.find(item => item.assetId === wanted);
  if (!record) return false;
  state.type = record.type;
  renderPicker();
  $('#picker').value = record.id;
  applyRequest(record);
  return true;
}

function renderPicker() {
  const select = $('#picker');
  const all = state.prompts.filter(item => item.type === state.type);
  const ready = all.filter(item => item.ready);
  const missing = all.length - ready.length;
  select.replaceChildren(new Option(ready.length ? '选择可生成资产' : '当前类型暂无可生成资产', ''));
  for (const item of ready) {
    const label = [
      item.assetId,
      item.name,
      item.outfit,
      item.firstPanel
    ].filter(Boolean).join(' · ') + (item.warning ? ' · 无主景' : '');
    select.add(new Option(label, item.id));
  }
  if (missing) {
    const option = new Option(`—— 待补参考 ${missing} 条，在资产配置中补齐 ——`, '__blocked__');
    option.disabled = true;
    select.add(option);
  }
}

function selectFirst() {
  const first = state.prompts.find(item => item.type === state.type && item.ready);
  if (!first) {
    showBlockedState();
    return;
  }
  $('#picker').value = first.id;
  applyRequest(first);
}

function showBlockedState() {
  const all = state.prompts.filter(item => item.type === state.type);
  const ready = all.filter(item => item.ready).length;
  const missing = all.length - ready;
  state.ready = false;
  state.request = null;
  $('#name').value = '';
  $('#outfit').value = '';
  $('#prompt').value = '';
  $('#request-meta').hidden = true;
  $('#request-source').hidden = true;
  const spec = $('#spec-status');
  spec.hidden = false;
  spec.className = 'spec-status blocked';
  spec.innerHTML = `<span class="badge bad">暂无可生成资产</span><span>该类型 ${missing} 条待补参考，在左侧绑定身份 / 服装 / 主景后再来</span>`;
  $('#progress').hidden = true;
  $('#empty').hidden = false;
  $('#result').hidden = true;
  $('#actions').hidden = true;
  applyTypeUi();
  updateGenerateState();
}

function updateModeFields() {
  const costume = state.mode === 'costume';
  const character = state.type === 'character';
  $('#identity-field').hidden = costume || !character;
  $('#costume-reference-field').hidden = !character || !['outfit', 'costume', 'hands'].includes(state.mode);
  $('#hand-reference-field').hidden = !character || state.mode !== 'outfit' || !state.request?.handReferenceEditorId;
  $('#costume-spec').hidden = !costume;
  if (state.mode === 'hands') $('#size').value = '1024x1536';
  if (costume) $('#size').value = '1536x864';
  $('#prompt').placeholder = costume
    ? '补充要求（可留空，服装规格会用上面的字段）'
    : '描述这张资产：视角、服装、背景、画风。越短越稳。';
  applyTypeUi();
}

// 场景和角色的产出结构不同：场景固定“两幅 16:9（正视图 + 反打）”，不沿用角色的尺寸与模式。
function applyTypeUi() {
  const scene = state.type === 'scene';
  const preview=document.querySelector('#asset-prompt-preview');if(preview){preview.hidden=false;preview.querySelector('summary').textContent=state.type==='character'?'查看实际组件提示词 · 人物定位':'查看实际生成提示词 · 二维动漫';preview.querySelector('p').textContent=state.type==='character'?'人物定位和外观补充进入脸部、三视图与其余组件。普通路人保持平常相貌和朴素发型。':'场景与道具使用二维手绘线稿和平涂。反打更换相机位置、可见面与背景区域。';}
  $('#character-spec').hidden=state.type!=='character';
  const modes = document.querySelector('.modes');
  if (modes) modes.hidden = scene;
  const sceneSpec = document.querySelector('#scene-spec');
  if (sceneSpec) sceneSpec.hidden = !scene;
  const size = $('#size');
  if (size) {
    size.disabled = scene;
    if (scene) size.value = '1536x864';
  }
  const prompt = $('#prompt');
  if (prompt) prompt.placeholder = scene
    ? '描述这个场景：地点、时间、光线、建筑、门窗与陈设。这段用于确定正视图与共同空间；下方可单独填写反打描述。'
    : state.type==='prop'?'描述道具的轮廓、结构、配色和纹样。固定采用二维动漫手绘风格。':'描述这张资产：视角、服装、背景、画风。越短越稳。';
  const hint = document.querySelector('.hint');
  if (hint) hint.textContent = scene
    ? '二维动漫场景：正打与反打各为16:9，使用同一空间与相反观察方向。反打只参考本版正打，镜像或近似复制会退回；可保存单张正打。'
    : state.type==='prop'?'二维动漫道具：清晰手绘线稿、平涂色块、纯白背景，保留物件结构与配色，禁止3D国漫和CG渲染。':'角色标准卡：标题 + 左大脸 + 正面 / 3-4 侧 / 背面 + 四手。换装 / 状态先上传已批准标准卡，锁脸不换人。';
}

async function generate() {
  if (state.busy) return;
  if(!['costume','hands'].includes(state.mode)){window.dispatchEvent(new Event('asset-production-generate'));return;}
  if (!state.ready) {
    const missing = (state.request?.missing || []).join('、');
    return showError(`当前资产缺规格${missing ? `：${missing}` : ''}，补齐后再生成`);
  }
  const name = $('#name').value.trim();
  const prompt = $('#prompt').value.trim();
  const outfit = $('#outfit').value.trim();
  if (!name) return showError('请填写资产名称');
  if (!['costume', 'hands'].includes(state.mode) && !prompt) return showError('请填写提示词');
  if (state.mode === 'costume' && !state.costumeReference) {
    return showError('服装设计需要先上传一张同宗门服装参考图');
  }
  if (state.mode === 'hands' && !state.reference) {
    return showError('手部卡需要先上传角色标准卡参考图');
  }
  if (['identity', 'outfit', 'state'].includes(state.mode) && !state.reference) {
    return showError('首次身份 / 换装 / 状态模式需要先上传一张身份参考图');
  }

  state.busy = true;
  state.asset = null;
  $('#generate').disabled = true;
  $('#adopt').disabled = false;
  $('#push').disabled = false;
  $('#error').hidden = true;
  $('#result').hidden = true;
  $('#actions').hidden = true;
  $('#empty').hidden = true;
  $('#progress').hidden = false;
  $('#phase').textContent = '提交任务';
  $('#message').textContent = '正在创建生成任务…';

  let endpoint = '/api/generate';
  let payload;
  if (state.mode === 'costume') {
    endpoint = '/api/costume-design';
    payload = {
      name,
      outfit,
      sect: $('#sect').value.trim(),
      peak: $('#peak').value.trim(),
      rank: $('#rank').value.trim(),
      occasion: $('#occasion').value.trim(),
      mainColor: $('#main-color').value.trim(),
      accentColor: $('#accent-color').value.trim(),
      pattern: $('#pattern').value.trim(),
      sash: $('#sash').value.trim(),
      boots: $('#boots').value.trim(),
      wrist: $('#wrist').value.trim(),
      notes: prompt,
      reference: state.costumeReference
    };
  } else if (state.mode === 'hands') {
    endpoint = '/api/hand-card';
    payload = {name, reference: state.reference, costumeReference: state.costumeReference || undefined, notes: prompt, size: $('#size').value};
  } else {
    payload = {
      type: state.type,
      mode: state.mode,
      reference: state.reference || undefined,
      costumeReference: state.costumeReference || undefined,
      handReference: state.handReference || undefined,
      name,
      outfit,
      prompt,
      size: $('#size').value
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '提交失败');
    state.job = data.jobId;
    poll();
  } catch (error) {
    fail(error.message);
  }
}

function poll() {
  clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    if (!state.job) return;
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(state.job)}`);
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || '查询失败');
      if (job.status === 'completed' && job.asset) {
        state.busy = false;
        state.asset = job.asset;
        $('#generate').disabled = false;
        $('#progress').hidden = true;
        $('#result').hidden = false;
        $('#image').src = `${job.asset.imageUrl}?t=${Date.now()}`;
        $('#caption').textContent = `${job.asset.name || $('#name').value} · ${job.asset.width}×${job.asset.height}`;
        $('#actions').hidden = false;
        updateGenerateState();
        return;
      }
      if (['failed', 'cancelled', 'partial'].includes(job.status)) {
        fail(job.message || STATUS_LABEL[job.status] || '生成失败');
        return;
      }
      $('#phase').textContent = STATUS_LABEL[job.status] || job.status;
      $('#message').textContent = job.message || '正在生成…';
      poll();
    } catch (error) {
      fail(error.message);
    }
  }, 3000);
}

async function pushToEditor() {
  if (!state.job || !state.asset) return;
  $('#push').disabled = true;
  const uploadType = ['costume', 'hands'].includes(state.mode) ? 'prop' : state.type;
  try {
    const response = await fetch('/api/push-to-editor', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jobId: state.job, name: $('#name').value.trim(), outfit: $('#outfit').value.trim(), type: uploadType})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '送入失败');
    $('#caption').textContent = `已送入主工作台 · ${data.assetId.slice(0, 8)}`;
  } catch (error) {
    showError(error.message);
  } finally {
    $('#push').disabled = false;
  }
}

async function adopt() {
  if (!state.job || !state.asset) return;
  $('#adopt').disabled = true;
  const uploadType = ['costume', 'hands'].includes(state.mode) ? 'prop' : state.type;
  try {
    const response = await fetch('/api/adopt', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        jobId: state.job,
        type: uploadType,
        name: $('#name').value.trim(),
        outfit: $('#outfit').value.trim(),
        prompt: $('#prompt').value.trim()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '入库失败');
    $('#caption').textContent = `已入库 · ${data.file}`;
    if (data.moku?.assetId) {
      $('#caption').textContent += ` · 墨库 ${data.moku.assetId.slice(0, 8)}`;
    }
    if (data.warning) {
      showError(`本地已保存；墨库上传失败：${data.warning}`);
    }
  } catch (error) {
    $('#adopt').disabled = false;
    showError(error.message);
  }
}

function fail(message) {
  clearTimeout(state.timer);
  state.busy = false;
  updateGenerateState();
  $('#progress').hidden = true;
  $('#empty').hidden = true;
  $('#result').hidden = true;
  $('#actions').hidden = true;
  showError(message);
}

function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = false;
}

export async function loadProductionConfig(r){
 document.querySelector('#asset-prompt-preview-text').textContent='';document.querySelector('#asset-prompt-preview').open=false;
 clearReferencePreviews();const version=state.referenceLoadVersion;
 state.type=r.type;state.mode=r.referenceIds?.length?'outfit':'text';state.ready=true;state.request=null;
 for(const item of document.querySelectorAll('.tab'))item.classList.toggle('active',item.dataset.type===state.type);
 for(const item of document.querySelectorAll('.mode'))item.classList.toggle('active',item.dataset.mode===state.mode);
 document.querySelector('#name').value=r.name;document.querySelector('#outfit').value=r.outfit||'';document.querySelector('#prompt').value=r.prompt||'';
 $('#character-role').value=r.characterRole||'auto';$('#character-appearance-notes').value=r.appearanceNotes||'';
 $('#character-role-hint').textContent=r.effectiveCharacterRole==='background'?'当前识别为普通路人：平常五官、朴素发型，与男主区分；年龄、性别和体型沿用资料。':'人物定位独立于出场次数；已确认的主要人物身份不会因职业或服装被改成路人。';
 const sceneMeta=r.sceneMeta||{};let camera=sceneMeta.camera||'',time=sceneMeta.time||'',weather=sceneMeta.weather||'';
 if(r.type==='scene'&&!camera&&!time&&!weather&&r.outfit){const parts=String(r.outfit).split(' · ').map(v=>v.trim()).filter(Boolean);if(parts.length>=2){camera=parts[0]||'';time=parts[1]||'';weather=parts[2]||'';}}
 for(const [field,key] of [['scene-reverse-camera','reverseCamera'],['scene-reverse-description','reverseDescription'],['scene-reverse-details','reverseDetails']])document.getElementById(field).value=r[key]||'';
 document.querySelector('#scene-camera').value=camera;document.querySelector('#scene-time').value=time;document.querySelector('#scene-weather').value=weather;
 document.querySelector('#board-title').value=r.boardTitle||r.name+'｜'+(r.outfit||'');
 for(const [i,kind,preview,image] of [[0,'reference','#reference-preview','#reference-image'],[1,'costumeReference','#costume-reference-preview','#costume-reference-image'],[2,'handReference','#hand-reference-preview','#hand-reference-image']]){if(!r.references?.[i])continue;const response=await fetch(r.references[i]);if(!response.ok)throw Error('生成记录参考图读取失败');const data=await blobToDataUrl(await response.blob());if(version!==state.referenceLoadVersion)return;state[kind]=data;$(image).src=data;$(preview).hidden=false;$(preview).closest('.upload').querySelector('.upload-box').hidden=true;}
 $('#picker').value='';$('#spec-status').hidden=true;
 updateModeFields();document.querySelector('#generate').disabled=false;document.querySelector('#request-meta').hidden=true;document.querySelector('#request-source').hidden=true;
}
export async function productionConfig(){return {useFormReferences:true,type:state.type,name:$('#name').value.trim(),outfit:$('#outfit').value.trim(),prompt:$('#prompt').value.trim(),reference:state.reference,costumeReference:state.costumeReference,...(state.type==='character'?{characterRole:$('#character-role').value,appearanceNotes:$('#character-appearance-notes').value.trim()}:{}),...(state.type==='scene'?{reverseCamera:$('#scene-reverse-camera').value.trim(),reverseDescription:$('#scene-reverse-description').value.trim(),reverseDetails:$('#scene-reverse-details').value.trim(),sceneMeta:{camera:$('#scene-camera').value.trim(),time:$('#scene-time').value.trim(),weather:$('#scene-weather').value.trim()}}:{})};}
document.querySelector('#asset-prompt-preview-refresh').onclick=async()=>{
 const button=$('#asset-prompt-preview-refresh'),output=$('#asset-prompt-preview-text');button.disabled=true;output.textContent='正在整理实际生成提示词…';
 try{const {reference,costumeReference,...input}=await productionConfig();const response=await fetch('/api/production-records/prompt-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,recordId:window.assetProductionRecord?.id})}),result=await response.json();if(!response.ok)throw Error(result.error||'预览失败');output.textContent=input.type==='scene'?'【正打实际提示词】\n'+result.front+'\n\n【反打实际提示词】\n'+result.reverse:input.type==='character'?Object.entries(result.components).map(([key,value])=>'【'+({'role-card':'整张角色卡',face:'脸部',views:'三视图',hands:'手部',prop:'道具配饰'})[key]+'实际提示词】\n'+value).join('\n\n'):result.prop;}catch(e){output.textContent='预览失败：'+e.message;}finally{button.disabled=false;}
};
