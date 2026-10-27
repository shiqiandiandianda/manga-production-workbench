'use strict';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const main = $('#main');
const dialog = $('#modal');
const styles = ['国漫', '日漫', '韩漫', '美漫'];
const scriptFormats = ['epub', 'docx', 'doc', 'pdf', 'txt', 'md', 'markdown', 'rtf', 'odt', 'html', 'htm', 'json', 'fountain', 'csv', 'tsv', 'zip'];
const kinds = { card_outfit_scan:'识别全部服装',card_convert:'外部角色卡转换',image_combine:'图片上下拼接',analyze: '拆解剧本', face: '生成 3 张候选脸', base: '生成素体', outfit: '生成服装卡', gestures: '安排8个手部动作', hands: '生成手部卡', special: '生成特殊动作', combine: '拼接角色卡', pipeline: '制作完整角色卡', project_auto: '全项目自动制作', library_faces: '积累旧单人整头素材', library_body: '生成身体模板', library_face_core: '制作五官素材', hands_auto: '安排并生成8格手部', extract_assets: '拆分参考入素材库', crowd_set: '制作5人群像套组', face_refine: '生成五官微调预览', hairstyle_preview: '生成发型白模三视', library_hairstyle: '制作发型素材', head_prepare: '整理本时期完整头部', clothing_extract: '提取纯服装入库', clothing_collect: '收集往期服装' };
const statuses = { queued: '等待中', running: '制作中', completed: '已完成', failed: '未完成', cancelled: '已取消', interrupted: '已中断' };
const state = { projects: [], library: [], jobs: [], runtime: {}, settings: {}, template: null, scriptFormats: [] };
const ui = { page: 'home', projectId: localStorage.getItem('character-studio-project') || '', characterId: '', outfitId: '', category: '全部', libraryKind: 'face_core', libraryStyle: '全部画风', bodyId: '', queueFilter: '全部', loading: true, inFlight: new Set(), modalSubmit: null, pollSnapshot: '', pendingRender: false, connected: false, drafts: {}, runtimeDraft: null, projectFormState: null, candidateSelection: {} };
ui.projectStage = 'script';
ui.profileSelections = {};
ui.mergePreview = null;
ui.clothingFilters = { style: '', era: '', gender: '', ageGroup: '', query: '' };
ui.requirementView = { projectId: '', chapter: '', segment: '', type: 'all', missingOnly: false };
const clothingFacets = { era: ['古代', '现代', '未来科技', '其他'], gender: ['男', '女', '通用'], ageGroup: ['儿童', '少年', '青年', '中年', '老年', '通用'] };

function escape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function fileUrl(value) { const raw = typeof value === 'object' ? value?.url || value?.image || '' : value; return typeof raw === 'string' && raw.startsWith('/files/') && !/[<>"\r\n]/.test(raw) ? raw : ''; }
function imageFor(value) { return fileUrl(value); }
function supportedScriptFormats() { const provided = Array.isArray(state.scriptFormats) ? state.scriptFormats.map(format => String(format).replace(/^\./, '').toLowerCase()).filter(format => /^[a-z0-9]{1,10}$/.test(format)) : []; return provided.length ? [...new Set(provided)] : scriptFormats; }
function icon(name) { return `<svg class="ui-icon" aria-hidden="true"><use href="#icon-${name}"/></svg>`; }
function thumbnailUrl(value,size=512){const url=fileUrl(value);return url&&state.settings?.resourceControl?.previewsEnabled?'/api/thumbnail?url='+encodeURIComponent(url)+'&size='+size:url;}
function imageView(value, alt, empty, extraClass = '') {
  const url = imageFor(value);
  return `<div class="media-well ${extraClass} ${url ? 'has-image' : 'is-empty'}">${url ? `<a href="${escape(url)}" data-action="preview" data-url="${escape(url)}" data-name="${escape(alt)}" aria-label="放大查看${escape(alt)}" style="width:100%;height:100%;display:grid;place-items:center"><img src="${escape(thumbnailUrl(url,768))}" alt="${escape(alt)}" loading="lazy" decoding="async"><span class="media-preview-hint">${icon('image')}放大查看</span></a>${extraClass==='portrait' ? button('展开大图','expand-media','','small media-expand-button') : ''}` : `<div class="media-placeholder"><span class="placeholder-symbol">${icon(extraClass === 'portrait' ? 'portrait' : 'image')}</span>${escape(empty)}</div>`}</div>`;
}
function projectAutoActive() { return state.jobs.some(job => job.projectId === ui.projectId && job.kind === 'project_auto' && ['queued', 'running'].includes(job.status)); }
function jobKey(kind, cid = ui.characterId, oid = ui.outfitId, pid = ui.projectId) { if (kind.startsWith('library') || kind === 'clothing_collect') { pid = ''; cid = ''; oid = ''; } else if (['analyze','project_auto'].includes(kind)) { cid = ''; oid = ''; } return `${kind}:${pid}:${cid}:${oid}:${cid ? currentAppearanceProfileId() : ''}`; }
function button(label, action, attrs = '', type = '', disabled = false) { return `<button type="button" class="button ${type}" data-action="${action}" ${attrs} ${disabled ? 'disabled' : ''}>${label}</button>`; }
function busy(kind, characterId = ui.characterId, outfitId = ui.outfitId) {
  if (['analyze', 'project_auto', 'clothing_collect'].includes(kind) || kind.startsWith('library')) { characterId = ''; outfitId = ''; }
  const matches = job => ['queued', 'running'].includes(job.status) && job.kind === kind && (!kind.startsWith('library') && kind !== 'clothing_collect' ? job.projectId === ui.projectId : true) && (!characterId || (job.appearanceProfileId || currentCharacterRecord()?.defaultAppearanceProfileId || '') === currentAppearanceProfileId()) && (characterId ? job.characterId === characterId : true) && (['outfit', 'hands', 'hands_auto', 'special', 'gestures', 'combine', 'pipeline', 'clothing_extract'].includes(kind) && outfitId ? job.outfitId === outfitId : true);
  return ui.inFlight.has(jobKey(kind, characterId, outfitId)) || state.jobs.some(matches);
}
function jobButton(kind, label, extra = '', disabled = false, appearance = 'small') {
  const pending = busy(kind);
  return button(pending ? '已加入队列' : label, 'job', `data-kind="${kind}" ${extra}`, appearance, disabled || pending);
}
function toast(message, isError = false) {
  const region=$('#toast-region');for(const previous of [...region.children])if(previous.textContent===message)previous.remove();while(region.children.length>=3)region.firstElementChild.remove();
  const node = document.createElement('div'); node.className = `toast${isError ? ' error' : ''}`; node.textContent = message; region.append(node); setTimeout(() => node.remove(), 6500);
}
let stateETag='';
async function api(path, method = 'GET', body) {
  const headers=body===undefined?{}:{'Content-Type':'application/json'};if(path==='/api/state'&&method==='GET'&&stateETag)headers['If-None-Match']=stateETag;
  const response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  if(path==='/api/state'&&response.status===304)return null;
  if(path==='/api/state'&&response.ok)stateETag=response.headers.get('ETag')||'';
  let result; const type = response.headers.get('Content-Type') || '';
  if (type.includes('json')) result = await response.json(); else result = { error: await response.text() };
  if (!response.ok) throw new Error(result.error || `操作未完成（${response.status}）`);
  return result;
}
function currentProject() { return state.projects.find(project => project.id === ui.projectId); }
function currentCharacterRecord() { return (currentProject()?.characters || []).find(character => character.id === ui.characterId); }
function profilesFor(character) {
  if (Array.isArray(character?.appearanceProfiles) && character.appearanceProfiles.length) return character.appearanceProfiles;
  return character ? [{ ...character, id: '', name: '当前时期', legacy: true }] : [];
}
function profileKey(characterId = ui.characterId) { return `${ui.projectId}:${characterId}`; }
function profileFor(character) {
  const profiles = profilesFor(character);
  const selected = ui.profileSelections[profileKey(character?.id)] || character?.activeAppearanceProfileId || character?.defaultAppearanceProfileId;
  return profiles.find(profile => profile.id === selected) || profiles[0];
}
function characterView(character) {
  if (!character) return undefined;
  const profile = profileFor(character);
  const assets = {};
  for (const field of ['face','faceCandidates','faceCandidateSheet','faceApproved','faceStyle','base','baseStyle','selectedFaceId','faceSelectionMode','faceSelectionReason','headContractVersion','headReviewStatus','legacyHeadReviewPending','identityReviewPending','headPreparationPending','headIdentityReviewPending','hairReviewPending','faceDiversityReviewPending','faceCandidatesPending','faceDiversityReviewStatus','faceIdentityGroupId','faceContinuity','faceCore','libraryFaceCoreId','hairstyle','reference','references','identitySource']) assets[field] = profile?.[field] ?? (profile?.legacy ? character[field] : ['faceCandidates','references'].includes(field) ? [] : field === 'faceApproved' ? false : '');
  const defaultProfileId = character.defaultAppearanceProfileId || profilesFor(character)[0]?.id || '';
  return { ...character, ...assets, scriptDescription: profile?.scriptDescription || (profile?.legacy || profile?.id === defaultProfileId ? character.scriptDescription : ''), appearanceProfileId: profile?.id || '', appearanceProfileName: profile?.name || '当前时期', profileDescription: profile?.description || '', outfits: (character.outfits || []).filter(outfit => profile?.legacy || (outfit.appearanceProfileId || defaultProfileId) === profile?.id) };
}
function currentCharacter() { return characterView(currentCharacterRecord()); }
function currentAppearanceProfileId() { return currentCharacter()?.appearanceProfileId || ''; }
function appearancePayload() { const id = currentAppearanceProfileId(); return id ? { appearanceProfileId: id } : {}; }
function candidateKey(character = currentCharacter()) { return `${character?.id || ''}:${character?.appearanceProfileId || ''}`; }
function currentOutfit() { return (currentCharacter()?.outfits || []).find(outfit => outfit.id === ui.outfitId); }
function characterEndpoint(characterId = ui.characterId) { return `/api/projects/${encodeURIComponent(ui.projectId)}/characters/${encodeURIComponent(characterId)}`; }
function outfitEndpoint() { return `${characterEndpoint()}/outfits/${encodeURIComponent(ui.outfitId)}`; }
function chooseProject(id) { ui.projectId = id; ui.characterId = ''; ui.outfitId = ''; ui.category = '全部'; ui.projectStage = 'script'; ui.requirementView = { projectId: id, chapter: '', segment: '', type: 'all', missingOnly: false }; localStorage.setItem('character-studio-project', id); }
function reconcile() {
  if (!currentProject()) chooseProject(state.projects[0]?.id || '');
  const characters = currentProject()?.characters || [];
  if (!characters.some(character => character.id === ui.characterId)) ui.characterId = characters[0]?.id || '';
  const outfits = currentCharacter()?.outfits || [];
  if (!outfits.some(outfit => outfit.id === ui.outfitId)) ui.outfitId = outfits[0]?.id || '';
}
function dateLabel(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
function episodesLabel(value) {
  if (!Array.isArray(value)) return String(value || '尚未标记出场话数');
  if (!value.length) return '尚未标记出场话数';
  const parts = []; let start = value[0], end = start;
  for (let index = 1; index <= value.length; index++) { if (index < value.length && value[index] === end + 1) end = value[index]; else { parts.push(start === end ? String(start) : `${start}—${end}`); start = end = value[index]; } }
  return `第 ${parts.join('、')} 话`;
}
function gestureText(value) { return typeof value === 'object' ? value?.name || value?.action || '' : value || ''; }
function draftKey() { return `${ui.projectId}:${ui.characterId}:${ui.outfitId}`; }
function runtimeReady() { const runtime = state.runtime || {}; return runtime.ready === true || runtime.connected === true || (runtime.codexAvailable === true && (runtime.loggedIn === true || runtime.authenticated === true)); }

async function refresh(force = false) {
  if(ui.refreshing){if(force)ui.refreshRequested=true;return;}ui.refreshing=true;
  try {
    const result=await api('/api/state');
    if(result===null){ui.connected=true;ui.loading=false;updateChrome();if(force){reconcile();render();ui.pendingRender=false;}return;}
    const snapshot=stateETag||JSON.stringify(result);
    Object.assign(state, { projects: result.projects || [], library: result.library || [], jobs: result.jobs || [], runtime: result.runtime || {}, settings: result.settings || {}, template: result.template || null, scriptFormats: result.scriptFormats || [], recycleBin: result.recycleBin || result.deletedProjects || [], materialRecycleBin: result.materialRecycleBin || [], materialRecycleSettings: result.materialRecycleSettings || {enabled:false,retentionDays:30,time:'09:00'}, materialCleanupHistory: result.materialCleanupHistory || [], queueOrder: result.queueOrder || [], queuedJobs: result.queuedJobs || [], scheduler: result.scheduler || {},detachedCharacters:result.detachedCharacters||[] });
    ui.connected = true; ui.loading = false; reconcile(); updateChrome();
    if (force || snapshot !== ui.pollSnapshot) {
      ui.pollSnapshot = snapshot;
      const focused = document.activeElement;
      const editing = !force && (dialog.open || (main.contains(focused) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused?.tagName)));
      if (editing) ui.pendingRender = true; else { render(); ui.pendingRender = false; }
    }
  } catch (error) {
    ui.connected = false; updateChrome();
    if (ui.loading) { main.innerHTML = `<div class="card error-view"><h2>工作台暂时没有连接上</h2><p>${escape(error.message)}</p><div class="subtext" style="margin-bottom:20px">请先打开工作台的本地启动程序，再刷新这个页面。</div>${button('重新连接', 'refresh', '', 'primary')}</div>`; }
    if (force) toast(error.message, true);
  } finally {ui.refreshing=false;if(ui.refreshRequested){ui.refreshRequested=false;refresh(true);}}
}
function updateChrome() {
  const ready = ui.connected && runtimeReady();
  const connection = $('#connection-status'); connection.className = `status-badge${ready ? ' connected' : ui.connected ? '' : ' failed'}`;
  connection.innerHTML = `<i></i>${ready ? 'Codex 已连接' : ui.connected ? '本地已连接 · Codex 待连接' : '本地连接中断'}`;
  const activeJobs = state.jobs.filter(job => ['queued', 'running'].includes(job.status)).length; const count = $('#queue-count'); count.textContent = activeJobs; count.hidden = !activeJobs;
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === (ui.page==='assembly'?'library':ui.page==='projects'?'project':['converter','imageCombine','toolResult'].includes(ui.page)?'home':ui.page)));
  const labels = { home:'首页',projects:'项目列表',converter:'外部角色卡转换',imageCombine:'图片上下拼接',toolResult:'快捷结果',project: '项目制作', library: '素材库', assembly:'素材库 · 素材组装', crowd: '群像素材库', clothing: '服装库', queue: '任务队列', settings: '连接设置', guide: '新手指引' };
  $('#breadcrumb').innerHTML = `创作工作台 <span>/</span> ${labels[ui.page]}`;
  $('#project-shortcuts').innerHTML = state.projects.length ? state.projects.slice(-7).reverse().map(project => `<button class="project-shortcut ${project.id === ui.projectId ? 'active' : ''}" data-action="select-project" data-id="${escape(project.id)}" title="${escape(project.name)}">${escape(project.name)}</button>`).join('') : '<div class="sidebar-empty">从第一个故事开始</div>';
}
function render() {
  if(ui.page==='crowd'||ui.page==='clothing'){ui.materialSection=ui.page==='crowd'?'crowd_set':'clothing';ui.page='library';}
  updateChrome();
  const renderer = { home:()=>window.workbenchTools?.home()||'<div class="loading"><div class="spinner"></div><p>正在打开快捷工具…</p></div>', projects:()=>window.workbenchTools?.projects()||'<div class="loading">正在打开快捷工具…</div>', converter:()=>window.workbenchTools?.converter()||'<div class="loading">正在打开快捷工具…</div>', imageCombine:()=>window.workbenchTools?.merger()||'<div class="loading">正在打开快捷工具…</div>', toolResult:()=>window.workbenchTools?.results()||'<div class="loading">正在打开快捷工具…</div>', project: renderProject, library: renderLibrary, crowd: renderCrowdLibrary, clothing: renderClothing, queue: renderQueue, settings: renderSettings, guide: renderGuide, assembly:renderLibrary }[ui.page];
  main.innerHTML = (ui.page==='guide'?'':guideNudge()) + submissionBar() + renderer();
  if (ui.page === 'settings') main.insertAdjacentHTML('beforeend', templatePanel('settings'));
  if (ui.page === 'settings' && !runtimeReady()) $('.connection-summary')?.insertAdjacentHTML('afterend', '<div class="login-help"><strong>登录你的现有账号</strong><br>双击本工具目录中的“登录Codex.cmd”完成登录，再点击“重新检查连接”。</div>');
  window.characterTour?.refresh();
}
function pageHeading(eyebrow, title, description, actions = '') { return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtext">${description}</p></div><div class="heading-actions">${actions}</div></div>`; }
function templatePanel(place = 'project') {
  const template = state.template || {};
  const canvas = template.canvas || { width: 1920, height: 1080 }; const combined = template.combined || { width: 1920, height: 2160 }; const hands = template.hands || { rows: 2, cols: 4 };
  const columns = Array.isArray(template.columns) && template.columns.length === 4 && template.columns.every(n => Number(n) > 0 && Number(n) <= 100) ? template.columns.map(Number) : [40,20,20,20];
  const version = String(template.version || '1.0').replace(/^v/, '');
  const notes = Array.isArray(template.summary) && template.summary.length ? template.summary : ['大脸正对镜头、双眼水平；完整头发优先，头顶、两侧与发尾不裁切；下巴约在92%，不露肩膀与上身。', '正面、严格90°侧面、背面全身都保留完整头部，尺寸与接地高度一致。', '手部动作图沿用该服装版本的袖口、护腕、手套和配饰；纯白背景、无文字。'];
  return `<details class="template-panel ${place === 'settings' ? 'template-settings card' : ''}" ${place === 'settings' ? 'open' : ''} data-template-version="${escape(version)}"><summary><span class="template-mark">▤</span><span><strong>统一模板 v${escape(version)}</strong><small>所有项目共用 · 角色和服装改变内容，布局保持一致</small></span><span class="template-summary-size">${escape(canvas.width)} × ${escape(canvas.height)}</span><span class="template-expand">查看规范</span></summary><div class="template-body"><div class="template-visual"><div class="template-column-preview" style="grid-template-columns:${columns.map(n => `${n}fr`).join(' ')}">${['大脸特写','带头正面','90°侧面','带头背面'].map((label,index) => `<div><span class="template-person-icon ${index ? '' : 'template-face-icon'}">◯</span><strong>${label}</strong><small>${columns[index]}%</small></div>`).join('')}</div><p class="template-preview-caption">角色卡布局示意 · ${columns.join(' / ')} / 纯白背景</p><div class="template-hand-preview">${Array.from({length:8},(_,index) => `<i>${String(index+1).padStart(2,'0')}</i>`).join('')}</div><p class="template-preview-caption">手部卡布局示意 ${escape(hands.rows)} × ${escape(hands.cols)} · 同一服装版本</p></div><div class="template-spec"><p class="template-dimensions"><span>角色卡 / 手部卡<strong>${escape(canvas.width)} × ${escape(canvas.height)}</strong></span><span>上下合并图<strong>${escape(combined.width)} × ${escape(combined.height)}</strong></span></p><ul>${notes.map(note => `<li>${escape(note)}</li>`).join('')}</ul><p class="template-fixed-note">主角与配角使用四栏角色卡和8格手部规范。群像另用五人全身、完整5头与服装三图成组保存。</p></div></div></details>`;
}
function workflowStrip() { return `<div class="workflow-strip">${['拆解剧本', '确认脸图', '身体底稿', '服装版本', '手部动作', '合并角色卡'].map((step, index) => `<div class="workflow-step"><span>${String(index + 1).padStart(2, '0')}</span>${step}</div>${index < 5 ? '<div class="workflow-arrow">›</div>' : ''}`).join('')}</div>`; }
function welcomeLayout() {
  return `<div class="welcome-layout" aria-label="固定角色卡与手部卡的布局示意"><div class="layout-sheet"><div class="layout-sheet-header"><span>角色卡</span><small>16:9 · 四栏统一布局</small></div><div class="layout-role-preview"><span class="layout-face">${icon('portrait')}</span>${['正面','侧面','背面'].map(label => `<span class="layout-body"><i></i><small>${label}</small></span>`).join('')}</div></div><div class="layout-sheet layout-hands"><div class="layout-sheet-header"><span>手部动作卡</span><small>2 排 × 4 列</small></div><div class="layout-hands-grid">${Array.from({length:8},(_,index) => `<span>${String(index+1).padStart(2,'0')}</span>`).join('')}</div></div><p>布局示意 · 所有角色使用同一套规范</p></div>`;
}
const requirementTypes = { role: '角色', costume: '服装', crowd: '群像' };
const requirementStatuses = { ready: '已有可用', existing_needs_work: '已有待补', definition_only: '已登记待制作', unregistered: '尚未入库', candidate: '候选待确认' };
const evidenceBases = { source: '原文明写', explicit: '原文明写', original: '原文明写', inferred: '语境推定', inference: '语境推定', design: '制作补设', proposed: '制作补设', production_design: '制作补设', authorized: '已授权改编', adaptation: '已授权改编', authorized_adaptation: '已授权改编' };
function evidenceLabel(value) { return evidenceBases[value] || String(value || '依据待核对'); }
function evidenceText(value) {
  if (Array.isArray(value)) return value.map(evidenceText).filter(Boolean).join('；');
  if (value && typeof value === 'object') return [value.chapter ? `第 ${value.chapter} 章` : '', value.paragraphId || value.sourceId || '', value.quote || value.text || value.evidence || ''].filter(Boolean).join(' · ');
  return String(value || '');
}
function requirementStateNotes(item) {
  const notes = (Array.isArray(item.presentationNotes) ? item.presentationNotes : item.presentationNotes ? [item.presentationNotes] : []).map(evidenceText).filter(Boolean);
  const stateBasis = item.stateBasis || item.statesBasis || '';
  return `${item.outfitBasis ? `<p><strong>服装依据：${escape(evidenceLabel(item.outfitBasis))}</strong>${evidenceText(item.outfitEvidence) ? `<br>${escape(evidenceText(item.outfitEvidence))}` : ''}</p>` : ''}${stateBasis ? `<p>状态依据：${escape(evidenceLabel(stateBasis))}</p>` : ''}${notes.length ? `<p><strong>造型说明 / 待核对</strong><br>${notes.map(escape).join('<br>')}</p>` : ''}`;
}
function stableAssetInfo(item, label = '资产编号') {
  const entries = [[item?.teamAssetId ? 'teamAssetId' : 'assetId', label], ['identityEntityId', '身份编号'], [item?.teamStateId ? 'teamStateId' : 'stateId', '状态编号']].filter(([key]) => item?.[key]);
  return entries.length ? `<details class="asset-identifiers"><summary>查看资产编号</summary>${entries.map(([key, title]) => `<div><span>${escape(title)}</span><code>${escape(item[key])}</code>${button('复制', 'copy-asset-id', `data-value="${escape(item[key])}"`, 'small')}</div>`).join('')}</details>` : '';
}
function readScopePanel(project) {
  const storedChapters = Array.isArray(project.chapters) ? project.chapters : [];
  const scopeStart = Number(project.rangeStart || project.readRange?.[0] || 1);
  const scopeEnd = Number(project.rangeEnd || project.readRange?.[1] || 20);
  const chapters = storedChapters.filter(chapter => Number(chapter.chapter) >= scopeStart && Number(chapter.chapter) <= scopeEnd);
  const cachedRange = storedChapters.length ? [Math.min(...storedChapters.map(chapter => Number(chapter.chapter))), Math.max(...storedChapters.map(chapter => Number(chapter.chapter)))] : [];
  const cacheNote = storedChapters.length > chapters.length ? `<p class="subtext">历史读取缓存：第 ${cachedRange[0]}—${cachedRange[1]} 章，共 ${storedChapters.length} 章。当前仅拆解第 ${scopeStart}—${scopeEnd} 章。</p>` : '';
  const hasScript = typeof project.script === 'string' && project.script.trim().length > 0;
  const verified = project.rangeVerified === true && chapters.length > 0;
  const readRange = Array.isArray(project.readRange) ? project.readRange : [];
  const rangeText = readRange.length === 2 ? `第 ${readRange[0]}—${readRange[1]} 章` : '尚未核对读取范围';
  const warnings = [...(project.importWarnings || []), ...(project.analysisWarnings || []), ...(project.assetWarnings || [])];
  return `<section class="read-scope-card card"><div class="read-scope-heading"><div><span class="eyebrow">原文读取</span><h3>${verified ? `${escape(rangeText)} · 已读取 ${chapters.length} 章正文` : chapters.length || hasScript ? '已有正文，章节范围待核对' : project.sourceFiles?.length ? '源文件已保存，正文尚未读取' : '尚未导入剧本正文'}</h3><p>${verified ? '章节按原文标题识别，下面的清单对应当前读取范围。' : hasScript ? '已有文字内容，尚未确认可靠的章节索引。核对范围和章节标题后，再分析对应素材。' : '先读取所选章节，再拆解人物、服装与群像。保存文件和读取正文是两个步骤。'}</p>${cacheNote}</div><div class="actions">${project.sourceFiles?.length ? button('重读所选章节', 'read-project-chapters', '', 'small soft', false) : ''}${jobButton('analyze', '只拆解剧本', '', !project.script, 'small soft')}</div></div>${chapters.length ? `<details class="read-chapter-details"><summary>查看实际已读章节</summary><div class="read-chapter-list">${chapters.map(chapter => `<span>${escape(chapter.title || `第 ${chapter.chapter} 章`)}</span>`).join('')}</div></details>` : ''}${warnings.length ? `<details class="read-warnings"><summary>${warnings.length} 条读取或分析提示</summary>${warnings.map(warning => `<p>${escape(mergeConflictText(warning))}</p>`).join('')}</details>` : ''}</section>`;
}
function requirementCard(item) {
  const type = requirementTypes[item.type] || '素材';
  const knownStatus = Object.hasOwn(requirementStatuses, item.status);
  const label = item.label || requirementStatuses[item.status] || '状态待核对';
  const url = fileUrl(item.imageUrl);
  const evidence = evidenceText(item.evidence);
  const missingParts = Array.isArray(item.missingParts) ? item.missingParts : item.missingParts ? [item.missingParts] : [];
  const destination = item.type === 'crowd' ? '去群像素材库' : item.characterId ? item.type === 'costume' ? '查看服装版本' : '查看角色资料' : item.type === 'costume' ? '去服装库' : '去角色目录';
  return `<article class="requirement-card ${knownStatus ? `requirement-${escape(item.status)}` : ''}"><div class="requirement-thumb">${url ? `<a href="${escape(url)}" data-action="preview" data-url="${escape(url)}" data-name="${escape(item.name || type)}"><img src="${escape(url)}" alt="${escape(item.name || type)}" loading="lazy"></a>` : `<span>${icon(item.type === 'role' ? 'portrait' : 'image')}</span><small>暂无参考图</small>`}</div><div class="requirement-info"><div class="requirement-title"><h3>${escape(item.name || '待命名素材')}</h3><span class="requirement-kind">${type}</span></div><span class="requirement-status">${escape(label)}</span><p class="requirement-reason">${escape(item.reason || '具体可用条件待核对。')}</p>${missingParts.length ? `<p class="requirement-missing"><strong>需补：</strong>${escape(missingParts.join('、'))}</p>` : ''}${item.states?.length ? `<p class="requirement-reason">造型状态：${escape(item.states.map(evidenceText).join('、'))}${item.stateReviewPending ? ' · 状态参考待核对' : ''}</p>` : ''}<details class="requirement-evidence"><summary>${escape(evidenceLabel(item.basis))} · 查看依据</summary><p>${escape(evidence || '当前没有附上原文证据，需核对后采用。')}</p>${requirementStateNotes(item)}${stableAssetInfo(item)}</details><div class="requirement-actions">${button(destination, 'open-requirement', `data-type="${escape(item.type)}" data-character="${escape(item.characterId || '')}" data-outfit="${escape(item.outfitId || '')}" data-asset="${escape(item.assetId || '')}"`, 'small')}</div></div></article>`;
}
function renderChapterRequirements(project) {
  const chapters = Array.isArray(project.chapterRequirements) ? project.chapterRequirements : [];
  const exportLink = `<a class="button small" href="/api/team-master/${encodeURIComponent(project.id)}" download>导出团队母版 JSON</a>`;
  if (!chapters.length || !chapters.some(chapter => chapter.analyzed === true || chapter.segments?.length)) return `<section class="card chapter-requirements"><div class="card-header"><div><h2>逐章素材清单</h2><p class="subtext">先拆出片段，再核对角色、服装和群像的已有与缺失。</p></div>${exportLink}</div><div class="requirements-empty"><span>${icon('book')}</span><h3>当前范围还没有完成拆解</h3><p>剧本拆解会登记出场人物、服装版本、状态和原文依据，然后与你的已有图片、群像库、服装库核对。这里尚不能判断哪些素材已经齐备。</p><div class="actions">${jobButton('analyze', '只分析当前章节', '', !project.script, 'small soft')}${project.sourceFiles?.length && !project.script ? button('先读取正文', 'read-project-chapters', '', 'small soft') : ''}</div></div><p class="team-master-note">母版保留稳定编号，供后续分镜引用。当前未导入分镜，素材需求按原文章节整理。</p></section>`;
  const view = ui.requirementView;
  if (!chapters.some(chapter => String(chapter.chapter) === String(view.chapter))) { view.chapter = String(chapters[0].chapter); view.segment = ''; }
  const chapter = chapters.find(item => String(item.chapter) === String(view.chapter));
  const segments = Array.isArray(chapter.segments) ? chapter.segments : [];
  if (view.segment && !segments.some(segment => String(segment.id) === view.segment)) view.segment = '';
  let requirements = view.segment ? segments.filter(segment => String(segment.id) === view.segment).flatMap(segment => (segment.requirements || []).map(item => ({ ...item, segmentTitle: segment.title }))) : chapter.requirements ? Object.values(chapter.requirements).flat() : segments.flatMap(segment => segment.requirements || []);
  requirements = requirements.filter((item, index, list) => list.findIndex(other => (other.id || `${other.type}:${other.assetId}:${other.name}`) === (item.id || `${item.type}:${item.assetId}:${item.name}`)) === index);
  const ready = requirements.filter(item => item.status === 'ready').length;
  const pending = requirements.filter(item => item.status !== 'ready').length;
  const filtered = requirements.filter(item => (view.type === 'all' || item.type === view.type) && (!view.missingOnly || item.status !== 'ready'));
  const summary = project.chapterRequirementSummary || {};
  const totalPending = Number.isFinite(Number(summary.total)) ? Number(summary.total) - Number(summary.ready || 0) : NaN;
  const chapterPending = chapter.analyzed === false;
  return `<section class="card chapter-requirements"><div class="card-header"><div><h2>逐章素材清单</h2><p class="subtext">按章和片段查看素材。已有定义、已有图片和检查通过分别记录。</p></div>${exportLink}</div><div class="requirements-controls"><label>章节<select data-change="requirement-chapter">${chapters.map(item => `<option value="${escape(item.chapter)}" ${String(item.chapter) === String(view.chapter) ? 'selected' : ''}>${escape(item.title || `第 ${item.chapter} 章`)}${item.analyzed === false ? ' · 尚未分析' : ''}</option>`).join('')}</select></label><label>片段<select data-change="requirement-segment"><option value="">本章全部片段</option>${segments.map(segment => `<option value="${escape(segment.id)}" ${String(segment.id) === view.segment ? 'selected' : ''}>${escape(segment.title || segment.id)}</option>`).join('')}</select></label><label class="requirements-missing-toggle"><input type="checkbox" data-change="requirement-missing" ${view.missingOnly ? 'checked' : ''}>只看待补</label></div><div class="requirements-chapter-summary"><p>${chapterPending ? '这一章尚未完成分析，素材需求数量未知。' : escape(view.segment ? segments.find(segment => String(segment.id) === view.segment)?.summary || chapter.summary || '' : chapter.summary || '')}</p><div>${chapterPending ? '' : `<span><strong>${ready}</strong> 项已有可用</span><span><strong>${pending}</strong> 项待补 / 待确认</span>`}${Number.isFinite(totalPending) ? `<span>已分析范围 ${totalPending} 项待补</span>` : ''}${summary.pendingChapters ? `<span>${escape(summary.pendingChapters)} 章尚未分析，需求数量待核对</span>` : ''}</div></div>${chapterPending ? `<div class="requirements-empty">${jobButton('analyze', '继续分析所选章节', '', !project.script, 'small soft')}</div>` : `<div class="requirements-tabs"><button class="tab ${view.type === 'all' ? 'active' : ''}" data-action="requirement-type" data-value="all">全部 <span>${requirements.length}</span></button>${Object.entries(requirementTypes).map(([type, label]) => `<button class="tab ${view.type === type ? 'active' : ''}" data-action="requirement-type" data-value="${type}">${label} <span>${requirements.filter(item => item.type === type).length}</span></button>`).join('')}</div><div class="requirements-grid">${filtered.length ? filtered.map(requirementCard).join('') : '<p class="requirements-filter-empty">当前筛选下没有素材条目。</p>'}</div>`}<p class="team-master-note">母版用于后续分镜按资产编号引用。当前未导入分镜，尚未进行分镜资产对应核对。</p></section>`;
}
const projectStages = [
  ['script', '拆解剧本', '先读所选章节，核对人物与衣着依据'],
  ['inventory', '素材清单', '按章检查已有与缺失'],
  ['face', '选脸定稿', '按时期固定长相与完整发型'],
  ['body', '身体定稿', '保持该时期的年龄与体型'],
  ['outfit', '服装与手部', '按服装版本制作角色卡及8个手势'],
  ['output', '查看成品', '上下拼接、下载及复用']
];
function projectStageNavigation(project) {
  const profiles = (project.characters || []).filter(character => ['主角','配角'].includes(character.category)).flatMap(profilesFor);
  const analyzed = (project.chapterRequirements || []).filter(chapter => chapter.analyzed).length;
  const approved = profiles.filter(profile => profile.faceApproved && profile.face).length;
  const bodies = profiles.filter(profile => profile.base && !headAssetsReviewPending(profile)).length;
  const outfits = (project.characters || []).flatMap(character => character.outfits || []);
  const completed = outfits.filter(outfit => outfit.combined && !outfitReviewPending(outfit)).length;
  const captions = { script: analyzed ? `已拆 ${analyzed} 章` : '从这里开始', inventory: project.chapterRequirementSummary?.pendingChapters ? '仍有章节待分析' : '查看需要补什么', face: `${approved} / ${profiles.length} 个时期已定脸`, body: `${bodies} / ${profiles.length} 个时期有底稿`, outfit: `${outfits.length} 套服装分别保存`, output: `${completed} 个合并成品` };
  return `<nav class="production-navigation" aria-label="角色制作步骤">${projectStages.map(([id,label],index) => `<button data-action="project-stage" data-value="${id}" class="production-step ${ui.projectStage === id ? 'active' : ''}" aria-current="${ui.projectStage === id ? 'step' : 'false'}"><span>${String(index+1).padStart(2,'0')}</span><strong>${label}</strong><small>${escape(captions[id])}</small></button>`).join('')}</nav>`;
}
function stageGuide(project) {
  const index = projectStages.findIndex(stage => stage[0] === ui.projectStage);
  const step = projectStages[Math.max(0,index)];
  const next = projectStages[index+1];
  return `<div class="production-guide"><div><p class="eyebrow">当前步骤 ${Math.max(0,index)+1} / ${projectStages.length}</p><h2>${step[1]}</h2><p>${step[2]}</p></div>${next ? button(`下一步：${next[1]}`, 'project-stage', `data-value="${next[0]}"`, 'small soft') : '<span class="tag gray">角色卡与手部卡按同宽完整拼接</span>'}</div>`;
}
function outfitReviewPending(outfit) { return !!(outfit?.semanticReviewPending || outfit?.appearanceProfileReviewPending || outfit?.legacyHeadReviewPending); }
function renderProfilePanel(character) {
  const record = currentCharacterRecord();
  const profiles = profilesFor(record);
  const selected = character.appearanceProfileId || '';
  return `<section class="card appearance-panel"><div class="card-header"><div><h2>人物时期</h2><p class="subtext">每个时期单独确认脸、年龄与身体，服装跟随对应时期。</p></div>${button('＋ 新增时期', 'add-profile', '', 'small')}</div><div class="appearance-profile-list">${profiles.map(profile => {
    const outfits = (record.outfits || []).filter(outfit => profile.legacy || (outfit.appearanceProfileId || record.defaultAppearanceProfileId || profiles[0]?.id) === profile.id);
    const finished = outfits.filter(outfit => outfit.combined && !outfitReviewPending(outfit)).length;
    return `<button class="appearance-profile ${profile.id === selected ? 'active' : ''}" data-action="select-profile" data-id="${escape(profile.id)}"><strong>${escape(profile.name || '未命名时期')}</strong><span>${escape(profile.ageText || '年龄未说明')}</span><small>${profile.faceApproved && profile.face ? '脸已确认' : profile.faceCandidates?.length ? `${profile.faceCandidates.length} 张候选待选` : profile.face ? '脸待确认' : '脸待制作'} · ${headAssetsReviewPending(profile) ? '时期图片待核验' : profile.base ? '身体已有' : '身体待制作'} · ${finished}/${outfits.length} 服装已完成${outfits.some(outfitReviewPending) ? ' · 旧图待核验' : ''}</small></button>`;
  }).join('')}</div><div class="appearance-current"><p><strong>当前：${escape(character.appearanceProfileName)}</strong>${character.profileDescription ? `<span>${escape(character.profileDescription)}</span>` : ''}</p>${selected ? button('编辑该时期', 'edit-profile', '', 'small') : ''}</div>${headIdentityPanel(character)}</section>`;
}
function renderOutfitDelivery(character) {
  const outfit = currentOutfit();
  if (!outfit) return `<div class="card empty-state"><h2>这个时期还没有服装版本</h2><p>先添加该时期的服装，再制作对应角色卡与手部卡。</p>${button('去服装与手部', 'project-stage', 'data-value="outfit"', 'soft')}</div>`;
  const tabs = character.outfits.map(item => `<button class="outfit-tab ${item.id === ui.outfitId ? 'active' : ''}" data-action="select-outfit" data-id="${escape(item.id)}">${escape(item.name)}</button>`).join('');
  return `<section class="card delivery-panel"><div class="card-header"><div><h2>${escape(character.name)} · ${escape(outfit.name)}</h2><p class="subtext">上方16:9角色卡，下方16:9手部卡，按相同宽度拼接。${outfitReviewPending(outfit) ? ' 已存旧图仍待核验时期、原著服饰或完整头发。' : ''}</p></div>${button('查看制作步骤', 'project-stage', 'data-value="outfit"', 'small')}</div><div class="outfit-tabs">${tabs}</div><div class="delivery-assets"><div><h3>角色卡</h3>${imageView(outfit.card,'角色卡','尚未完成角色卡')}</div><div><h3>手部卡 · 8个动作</h3>${imageView(outfit.hands,'手部卡','尚未完成对应服饰的手部卡')}</div></div><div class="delivery-combined"><h3>完整角色卡</h3>${imageView(outfit.combined,`${character.name}合并成品`,'角色卡与手部卡齐备后，可上下拼接')}${stableAssetInfo(outfit,'服装资产编号')}</div><div class="bottom-actions">${jobButton('combine',outfit.combined?'重新拼接':'上下拼接','',!outfit.card||!outfit.hands,'soft')}${outfit.combined ? `<a class="button primary" href="${escape(fileUrl(outfit.combined))}" download>下载完整角色卡</a>` : ''}${outfit.card ? `<a class="button small" href="${escape(fileUrl(outfit.card))}" download>下载角色卡</a>` : ''}${outfit.hands ? `<a class="button small" href="${escape(fileUrl(outfit.hands))}" download>下载手部卡</a>` : ''}</div></section>`;
}
function renderProject() {
  const project = currentProject();
  const titleActions = button('从图片全自动制作', 'image-auto', '', 'soft') + button('＋ 新建项目', 'create-project', '', 'primary') + button('导入项目资料', 'import-project') + button('导入网上参考', 'batch-reference-import') + button('回收站','project-recycle','','small') + (project ? `<a class="button dark" href="/api/export/${encodeURIComponent(project.id)}" download title="包含项目资料、所有角色图片与剧本原文件">导出整个项目 ZIP</a>` : '');
  if (!project) return pageHeading('从故事开始创作', '把故事里的角色，带到画面上', '整理剧本，固定长相，让服装与动作成为可复用的角色资产。', titleActions) + `<div class="welcome-grid"><section class="card welcome-hero"><div class="welcome-intro"><span class="welcome-kicker">角色一致 · 服装分版 · 动作复用</span><h2>你的角色创作，<br>从这里开始。</h2><p>上传剧本，整理主角、配角与群像；也可以直接沿用已有定稿图，制作完整角色卡。</p><div class="welcome-primary-actions">${button(`${icon('book')}导入剧本开始`, 'create-project', '', 'primary')}${button(`${icon('image')}从定稿图开始`, 'image-auto', '', 'soft')}</div><div class="welcome-source-hint">${icon('upload')}支持 EPUB、Word、PDF 和 ZIP 等多种资料</div></div>${welcomeLayout()}</section><aside class="card welcome-workflow"><p class="eyebrow">可重复使用的制作流程</p><h3>一次定好，持续积累</h3>${[['选定角色长相', '人工挑选 3 张候选脸，或交给全自动模式。'], ['建立服装版本', '每套衣服分别保存角色卡与对应的手部动作。'], ['提取剧情动作', '整理 8 个常用手势，技能和特殊动作单独补图。'], ['积累通用素材', '主配四栏角色卡与手部卡分别制作；群像五人全身、整头和服装成组取用。']].map((item, index) => `<div class="welcome-step"><span class="welcome-step-number">${String(index+1).padStart(2,'0')}</span><div><h3>${item[0]}</h3><p>${item[1]}</p></div></div>`).join('')}</aside></div>` + templatePanel();
  const characters = (project.characters || []).slice().sort((a,b)=>roleRank(a)-roleRank(b));
  const approved = characters.filter(character => ['主角','配角'].includes(roleCategory(character)) && character.faceApproved).length;
  const styleLabel = project.styleMode === 'manual' ? `${project.style || '国漫'} · 已指定` : project.recommendedStyle ? `${project.recommendedStyle}（推荐）` : '自动推荐 · 待分析';
  const range = `第 ${project.rangeStart || 1} — ${project.rangeEnd || 20} 章 / 话`;
  const overview = `<div class="card project-overview"><div class="project-icon">${icon('book')}</div><div class="project-summary"><select class="project-select" data-change="project" aria-label="选择项目">${state.projects.map(item => `<option value="${escape(item.id)}" ${item.id === project.id ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select><div class="project-meta"><span>${range}</span><span>${characters.length} 个角色</span><span>${escape(styleLabel)}</span>${project.sourceFiles?.length ? `<span>${project.sourceFiles.length} 份源文件已保存</span>` : ''}</div><p class="export-hint">整包导出：项目资料 ＋ 所有图片 ＋ 剧本原文件</p></div><div class="actions">${button('剧本与画风', 'edit-project', '', 'small')}${button('合并项目', 'merge-project', '', 'small', state.projects.length < 2)}${button('删除项目', 'delete-project', '', 'small danger')}${button('回收站', 'project-recycle', '', 'small')}</div></div>`;
  const missingFaces = characters.map(characterView).filter(character => ['主角', '配角'].includes(character.category) && !['face','fullbody'].includes(character.identitySource) && headTaskKind(character) !== 'head_prepare' && !character.face && (character.faceCandidates || []).length < 3);
  const faceTargets = missingFaces.filter(character => !state.jobs.some(job => job.projectId === project.id && ['queued', 'running'].includes(job.status) && (job.kind === 'analyze' || job.characterId === character.id)));
  const batch = characters.length ? `<div class="batch-strip"><div><strong>${approved} 位主角或配角已定脸</strong>　${missingFaces.length ? `${missingFaces.length} 位主角或配角待生成 3 张候选脸。` : '已有候选脸可逐人选择，定稿后继续制作。'}</div><div class="actions">${button('批量为每人生成 3 张脸', 'batch-faces', '', 'small soft', !faceTargets.length || ui.inFlight.has('batch-faces'))}${button('批量制作已定脸角色', 'batch-pipeline', '', 'small soft', !approved)}</div></div>` : '';
  const activeTasks = state.jobs.some(job => job.projectId === project.id && ['queued', 'running'].includes(job.status));
  const automatic = `<div class="automation-card"><div><span class="automation-label">${icon('spark')}${project.workflowMode === 'auto' ? '全自动模式' : '人工选脸模式'}</span><h3>从剧本到完整角色卡，一次完成</h3><p>主角与配角自动拆剧本、定脸、制作身体与服装、8格手部和合并图；群像按5人全身、完整整头与服装套组保存。已有成果可以继续复用。</p>${activeTasks ? '<small>当前项目有任务进行中，可在任务队列查看或取消。</small>' : ''}</div>${button(projectAutoActive() ? '全自动制作中' : '一键全流程自动制作', 'project-auto', '', 'primary', busy('project_auto') || !project.script && !characters.length)}</div>`;
  const tabs = ['全部', '主角', '配角', '群像'].map(category => `<button class="tab ${ui.category === category ? 'active' : ''}" data-action="category" data-value="${category}">${category}</button>`).join('');
  const filtered = characters.map(characterView).filter(character => ui.category === '全部' || roleCategory(character) === ui.category);
  const list = filtered.length ? filtered.map((character,index) => {
    const category=roleCategory(character),groupItem=category==='群像'?crowdItemFor(character):null,previous=filtered[index-1],heading=!previous || roleCategory(previous)!==category?'<div class="role-group-heading"><strong>'+escape(category)+'</strong><span>'+filtered.filter(item=>roleCategory(item)===category).length+' 位</span></div>':'';
    return heading+'<button class="character-item '+(character.id === ui.characterId ? 'active' : '')+'" data-action="select-character" data-id="'+escape(character.id)+'" data-category="'+escape(category)+'"><span class="character-thumb">'+(imageFor(character.face || character.reference)?'<img src="'+escape(thumbnailUrl(imageFor(character.face || character.reference),96))+'" alt="'+escape(character.name)+'" loading="lazy">':'◯')+'</span><span><span class="character-name">'+escape(character.name)+'</span><span class="character-info" style="display:block">'+escape(category)+' · '+(category==='群像'?(groupItem?crowdMissingParts(groupItem).length?'套组待补齐':'已有群像套组':'待制作5人套组'):character.faceApproved?'已定脸':character.faceCandidates?.length?'待选择候选脸':character.face?'待确认脸图':['face','fullbody'].includes(character.identitySource)&&character.reference?'已有定稿参考，待整理脸图':'待生成候选脸')+'</span></span><i class="tiny-status '+(character.faceApproved?'ready':'')+'"></i></button>';
  }).join('') : '<div class="mini-empty">'+(characters.length?'这里还没有这个分类的角色。':'先拆解剧本，或手动添加角色。')+'<br>参考图和角色描述都可以作为起点。</div>';
  const panel = `<aside class="card character-panel"><div class="card-header"><h2>角色目录 <span class="subtext">${characters.length}</span></h2>${button('＋ 添加', 'add-character', '', 'small')}</div><div class="character-tabs">${tabs}</div><div class="character-list">${list}</div></aside>`;
  const stage = projectStages.some(item => item[0] === ui.projectStage) ? ui.projectStage : 'script';
  ui.projectStage = stage;
  const workspace = `<div class="workspace-grid" id="character-workspace">${panel}<div class="detail-panel">${currentCharacter() && roleCategory(currentCharacterRecord() || {})!=='群像' ? renderProfilePanel(currentCharacter()) : ''}${renderCharacter(stage)}</div></div>`;
  const crowdMode=roleCategory(currentCharacterRecord() || {})==='群像'&&['face','body','outfit','output'].includes(stage);
  const content = stage === 'script' ? readScopePanel(project) + automatic : stage === 'inventory' ? renderChapterRequirements(project) : (crowdMode?'':stage === 'face' ? batch : batchStageTools(project,stage)) + workspace;
  return pageHeading('项目创作空间','角色制作','按步骤完成当前范围，时期与服装分别保存。',titleActions) + overview + (crowdMode?'<div class="production-guide"><div><p class="eyebrow">群像专用流程</p><h2>全身 → 完整5头与服装 → 群像库</h2><p>原组演员整体保存，无须逐个选脸；服装依据与制作补设分开。</p></div>'+button('查看群像库','open-crowd-library','data-character-id="'+escape(ui.characterId)+'"','small soft')+'</div>':projectStageNavigation(project) + stageGuide(project)) + content + (crowdMode?'':`<details class="production-template-details"><summary>查看主配角色卡片规范</summary>${templatePanel()}</details>`);
}
function renderFaceCandidates(character) {
  const candidates = character.faceCandidates || [];
  if (!candidates.length) return '';
  let selectedId = ui.candidateSelection[candidateKey(character)] || character.selectedFaceId || '';
  if (!candidates.some(candidate => candidate.id === selectedId)) selectedId = character.selectedFaceId || '';
  const selected = candidates.find(candidate => candidate.id === selectedId);
  const locked = busy('face');
  return `<div class="card face-candidates-card"><div class="card-header"><div><h2>${candidates.length} 张候选脸 · ${escape(character.name)}</h2>${character.faceDiversityReviewPending || character.faceCandidatesPending || ['legacy_pending','failed'].includes(character.faceDiversityReviewStatus) ? '<p class="candidate-review-note">历史方案的骨相差异待重做；现有选择仍保留，可重新生成明显不同的五官方案。</p>' : ''}<p class="subtext">新3候选比较脸型、眉眼、鼻型与下颌骨相，画风一致，头发完整；每张下方显示已记录的区别。旧8候选仍可选择，同脸时期沿用身份。</p></div>${fileUrl(character.faceCandidateSheet) ? `<a class="button small" href="${escape(fileUrl(character.faceCandidateSheet))}" download>下载候选合集</a>` : ''}</div><div class="face-candidate-grid ${candidates.length === 3 ? 'candidate-three' : 'candidate-legacy'}">${candidates.map((candidate, index) => { const url = fileUrl(candidate.image); const chosen = candidate.id === selectedId; const confirmed = candidate.id === character.selectedFaceId && character.faceApproved; return `<article class="face-candidate ${chosen ? 'selected' : ''}" data-action="select-candidate" data-id="${escape(candidate.id)}" tabindex="0" role="button" aria-pressed="${chosen}" aria-label="选择${escape(candidate.label || `候选 ${index + 1}`)}"><div class="candidate-image">${url ? `<img src="${escape(url)}" alt="${escape(candidate.label || `候选 ${index + 1}`)}" loading="lazy">${button('↗', 'preview', `data-url="${escape(url)}" data-name="${escape(character.name)} · ${escape(candidate.label || `候选 ${index + 1}`)}" title="放大查看"`, 'candidate-zoom')}` : '<span class="media-placeholder">暂无图片</span>'}${chosen ? '<span class="candidate-check">✓</span>' : ''}</div><div class="candidate-caption"><strong>${escape(candidate.label || `候选 ${String(index + 1).padStart(2, '0')}`)}</strong>${confirmed ? '<span class="tag green">已定稿</span>' : chosen ? '<span class="tag">已选</span>' : ''}</div>${candidateDifference(candidate) ? `<p class="candidate-bone-brief">${escape(candidateDifference(candidate))}</p>` : ''}<div class="candidate-refine-actions">${refinementButtons({sourceKind:'candidate',candidateId:candidate.id,projectId:ui.projectId,characterId:character.id,appearanceProfileId:character.appearanceProfileId})}</div></article>`; }).join('')}</div><div class="candidate-confirm-row"><p>${character.faceApproved && character.faceSelectionMode === 'auto' ? 'Codex 已自动选定长相；你也可以选择其他候选重新定稿。' : selected ? `当前选中：${escape(selected.label || '候选脸')}。确认前，角色定稿保持原有选择。` : '先选中一张候选脸，再确认继续。'}</p>${button('确认选中并继续', 'confirm-candidate', `data-candidate="${escape(selectedId)}"`, 'primary', !selected || locked || character.faceApproved && selectedId === character.selectedFaceId)}</div>${character.faceSelectionReason ? `<div class="candidate-reason"><span>${character.faceSelectionMode === 'auto' ? '自动选定依据' : '选择说明'}</span>${escape(character.faceSelectionReason)}</div>` : ''}</div>`;
}
function renderCharacter(stage = ui.projectStage) {
  const character = currentCharacter();
  if (!character) return `<div class="card empty-state"><div class="empty-illustration">${icon('portrait')}</div><h2>角色从这里开始</h2><p>拆解指定话数的剧本，或上传你已有的角色图。主角和配角使用相同制作流程，群像以5人备选套组整体保存。</p>${button('添加一个角色', 'add-character', '', 'primary')}</div>`;
  if(roleCategory(character)==='群像')return renderCrowdCharacter(character);
  const refs = [...new Set([character.reference, ...(character.references || [])])].map(fileUrl).filter(Boolean);
  const scriptDescription = typeof character.scriptDescription === 'string' && character.scriptDescription.trim() !== String(character.description || '').trim() ? character.scriptDescription.trim() : '';
  const heading = `<div class="card"><div class="character-detail-heading"><div class="character-title"><div><p class="eyebrow">角色资料</p><h2>${escape(character.name)}</h2></div><span class="group-badge">${escape(character.category || '配角')}</span></div>${button('编辑角色', 'edit-character', '', 'small')}</div><div class="character-detail-text">${escape(character.profileDescription || (character.appearanceProfileId && character.appearanceProfileId !== currentCharacterRecord()?.defaultAppearanceProfileId ? '该时期外形尚待补充；年龄和外形以本时期资料为准。' : character.description) || '添加角色外貌、性格和身体特征，让后续制作有明确依据。')}${scriptDescription ? `<details class="asset-identifiers"><summary>新增原著资料（待核验）</summary><p style="white-space:pre-wrap;margin-top:8px">${escape(scriptDescription)}</p><p class="hint-text">这是最新剧本分析提取的资料，核验后再决定采用；已有美术描述与定稿参考保留。</p></details>` : ''}${stableAssetInfo(character)}</div>${refs.length ? `<div class="reference-section">${refs.slice(0, 4).map(url => `<a href="${escape(url)}" data-action="preview" data-url="${escape(url)}" data-name="角色参考"><img src="${escape(url)}" alt="角色参考"></a>`).join('')}<p>参考资料 · ${refs.length} 张<br>${escape(episodesLabel(character.episodes))}</p></div>` : ''}</div>`;
  const face = `<div class="card stage-card"><div class="stage-label"><span class="stage-num">02</span><h3>脸图定稿</h3><span class="tag ${character.faceApproved ? 'green' : 'gray'}">${headAssetsReviewPending(character) ? '头图待核验' : character.faceApproved ? character.faceSelectionMode === 'auto' ? '自动选定' : '已确认' : character.faceCandidates?.length ? '待选脸' : character.face ? '待确认' : '待生成'}</span></div>${imageView(character.face, `${character.name}脸图定稿`, character.faceCandidates?.length ? '从上方候选脸中选择，再确认继续' : headTaskKind(character)==='head_prepare' ? headTaskReady(character) ? '沿用五官与本期发型，整理一张完整头部' : '先确定来源时期的五官，再整理本时期完整头部' : '生成3张候选脸，或整理已有定稿；保留完整头发', 'portrait')}${character.legacyHeadReviewPending ? '<p class="hint-text">已有脸图保留，头顶、两侧和发尾是否完整仍待核对。</p>' : ''}<p class="stage-note">${headTaskKind(character)==='head_prepare' ? character.faceContinuity?.status==='age_related' ? '参照来源时期，按本期年龄调整五官与脸型，单张整理完整头部；幼年不会直接复制成年五官。' : '固定五官身份，只按本时期发型单张整理完整头部，头顶、两侧与发尾均完整呈现。' : '新身份提供3种明显不同的长相方案，画风一致，保留全部头发；已有定稿图直接整理身份。'}</p><div class="stage-actions">${jobButton(headTaskKind(character), headTaskLabel(character), '', !headTaskReady(character), 'small soft')}${character.faceCandidates?.length ? '' : button(character.faceApproved ? '已确认脸图' : '确认这张脸', 'approve-face', '', 'small', !character.face || character.faceApproved)}${button('导入脸图', 'import-artifact', 'data-field="face"', 'small')}${character.face ? button(headTaskKind(character)==='head_prepare' ? '返修完整头部' : '返修候选', 'revise-artifact', `data-kind="${headTaskKind(character)}"`, 'small') + `<a class="button small" href="${escape(fileUrl(character.face))}" download>下载定稿</a>` : ''}</div>${character.face ? `<div class="refine-head-actions">${refinementButtons({sourceKind:'complete_head',projectId:ui.projectId,characterId:character.id,appearanceProfileId:character.appearanceProfileId})}</div>` : ''}${archiveHeadButton(character)}</div>`;
  const base = `<div class="card stage-card"><div class="stage-label"><span class="stage-num">03</span><h3>身体底稿</h3><span class="tag gray">${headAssetsReviewPending(character) ? '时期图片待核验' : character.base ? '已生成' : '待生成'}</span></div>${imageView(character.base, `${character.name}身体底稿`, '固定体型比例，保留完整头部', 'portrait')}<p class="stage-note">本时期身体底稿保留完整头部和头发，使用简洁贴身基础衣着用于换装。幼年、前世等时期分别保持自身年龄与体型。</p><div class="stage-actions">${jobButton('base', character.base ? '重新生成' : '生成身体底稿', '', !character.faceApproved, 'small soft')}${button('导入底稿', 'import-artifact', 'data-field="base"', 'small', !character.faceApproved)}${character.base ? button('返修', 'revise-artifact', 'data-kind="base"', 'small') + `<a class="button small" href="${escape(fileUrl(character.base))}" download>下载</a>` : ''}</div>${!character.faceApproved ? '<p class="hint-text">先到“选脸定稿”确认这个时期的脸，再继续制作。</p>' : ''}</div>`;
  return heading + (stage === 'face' ? renderFaceCandidates(character) + face : stage === 'body' ? base : stage === 'output' ? renderOutfitDelivery(character) : renderOutfit(character));
}
function renderOutfit(character) {
  const outfits = character.outfits || []; const outfit = currentOutfit();
  const tabs = outfits.map(item => `<button class="outfit-tab ${item.id === ui.outfitId ? 'active' : ''}" data-action="select-outfit" data-id="${escape(item.id)}">${escape(item.name)}</button>`).join('');
  const start = `<div class="card"><div class="card-header"><div><h2>服装与动作</h2><p class="subtext">同一套服装跨话复用，换装时同步调整手部的袖口与配饰。</p></div>${button('＋ 服装版本', 'add-outfit', '', 'small')}</div>`;
  if (!outfit) return start + `<div class="outfit-empty"><p>添加一套服装，开始制作该版本的角色卡。</p>${button('添加服装版本', 'add-outfit', '', 'soft')}</div></div>`;
  const draft = ui.drafts[draftKey()] || {};
  const gestures = Array.from({ length: 8 }, (_, index) => gestureText((draft.gestures || outfit.gestures)?.[index]));
  const card = `<div class="artifact-heading"><h3><span class="stage-num" style="display:inline-grid;margin-right:7px">04</span>16:9 服装角色卡</h3><div class="artifact-actions">${jobButton('outfit', outfit.card ? '重新生成服装卡' : '生成服装卡', '', !character.faceApproved || !character.base, 'small soft')}${button('导入成图', 'import-artifact', 'data-field="card"', 'small', !character.faceApproved)}${outfit.card ? button('返修', 'revise-artifact', 'data-kind="outfit"', 'small') + `<a class="button small" href="${escape(fileUrl(outfit.card))}" download>下载</a>` : ''}</div></div>${imageView(outfit.card, `${character.name} · ${outfit.name}角色卡`, '大脸特写 ＋ 带完整头部的正面、90°侧面与背面全身')}<p class="hint-text">四栏比例 40 : 20 : 20 : 20，纯白背景。正脸双眼水平、头发完整，下巴约在画面高度92%；服装对应当前人物时期。${!character.base ? ' 先生成身体底稿，或直接导入已有服装卡。' : ''}</p>`;
  const hands = `<div class="section-divider"></div><div class="artifact-heading"><h3><span class="stage-num" style="display:inline-grid;margin-right:7px">05</span>8 个手部动作</h3><div class="artifact-actions">${jobButton('gestures', '只整理动作文字', '', false, 'small')}${button('保存动作', 'save-gestures', '', 'small')}</div></div><div class="gesture-grid">${gestures.map((gesture, index) => `<label class="gesture-field"><span>${String(index + 1).padStart(2, '0')}</span><input name="gesture-${index}" value="${escape(gesture)}" placeholder="动作 ${index + 1}" aria-label="手部动作 ${index + 1}" maxlength="1500"></label>`).join('')}</div><p class="hint-text" style="margin-bottom:13px">优先用你填写的动作。为空时优先从对应剧情选取；没有对应剧情时按角色图选基础手势。手套、袖口、护腕和饰品随服装同步。</p>${outfit.gestureSources?.length ? `<details class="gesture-evidence"><summary>查看动作来源</summary>${outfit.gestureSources.map(source => `<p>${escape(typeof source === 'string' ? source : source.action || source.name || '')} ${escape(typeof source === 'object' ? source.source || source.evidence || source.episode || '' : '')}</p>`).join('')}</details>` : ''}<div class="artifact-heading"><h3>16:9 · 两排四列手部卡</h3><div class="artifact-actions">${jobButton('hands_auto', outfit.hands ? '重新安排并生成8格手部' : '安排并生成8格手部', '', !outfit.card&&!handCardDependency(), 'small soft')}${button('导入成图', 'import-artifact', 'data-field="hands"', 'small', !outfit.card)}${outfit.hands ? button('返修', 'revise-artifact', 'data-kind="hands"', 'small') + `<a class="button small" href="${escape(fileUrl(outfit.hands))}" download>下载</a>` : ''}</div></div>${imageView(outfit.hands, `${character.name} · ${outfit.name}手部动作卡`, '8 格动作，共用画风与服饰，无文字')}<p class="hint-text">${!outfit.card ? handCardDependency() ? '服装卡任务已排队；手部任务将等待该卡完成后继续，不会提前失败。' : '先生成或导入这套服装的角色卡。卡任务排队后即可安排手部，后台等待前置完成。' : '点击“安排并生成8格手部”会补齐动作并直接出图；没有对应剧情时按角色卡选握拳、摊掌、指向等基础手势。只安排动作只生成文字。'}</p>`;
  const special = `<div class="section-divider"></div><div class="artifact-heading"><h3>剧情独有的特殊动作</h3><span class="tag gray">附加图</span></div><div class="special-controls"><textarea id="special-instructions" aria-label="特殊动作说明" placeholder="例如：第 6 话施放技能，左手结印、右手双指并拢。保留这套衣服的护腕。">${escape(draft.specialInstructions ?? outfit.specialInstructions ?? '')}</textarea>${jobButton('special', '单独补图', '', !outfit.card, 'small soft')}</div><p class="hint-text">大招、结印或特别的握持动作单独保存，避免每一话重复生成整套动作。</p>${outfit.specialSuggestions?.length ? `<div class="suggestion-list">${outfit.specialSuggestions.map((item, index) => `<button class="suggestion-button" data-action="use-special-suggestion" data-index="${index}">＋ ${escape(typeof item === 'string' ? item : item.action || item.name || item.description || '特殊动作')}</button>`).join('')}</div>` : ''}${outfit.specials?.length ? `<div class="special-list">${outfit.specials.map((item, index) => { const url = fileUrl(typeof item === 'string' ? item : item.image || item.url); return url ? `<div class="special-item"><a href="${escape(url)}" data-action="preview" data-url="${escape(url)}" data-name="特殊动作 ${index + 1}"><img src="${escape(url)}" alt="特殊动作 ${index + 1}" loading="lazy"></a><a href="${escape(url)}" download>下载特殊动作 ${index + 1}</a></div>` : ''; }).join('')}</div>` : ''}`;
  const combine = `<div class="section-divider"></div><div class="artifact-heading"><h3><span class="stage-num" style="display:inline-grid;margin-right:7px">06</span>合并角色卡</h3><div class="artifact-actions">${jobButton('combine', outfit.combined ? '重新拼接' : '上下拼接', '', !outfit.card || !outfit.hands, 'small soft')}${outfit.combined ? `<a class="button small" href="${escape(fileUrl(outfit.combined))}" download>下载合并图</a>` : ''}</div></div><div class="combined-card">${imageView(outfit.combined, `${character.name} · ${outfit.name}完整角色卡`, '上方角色卡，下方手部动作，按相同宽度完整拼接')}</div>`;
  return start + `<div class="outfit-tabs">${tabs}</div><div class="outfit-info"><div><h3>${escape(outfit.name)} <span class="tag gray">${escape(episodesLabel(outfit.episodes))}</span></h3><p class="outfit-description">${escape(outfit.description || '补充服装的款式、配色、材质与配饰。')}</p>${stableAssetInfo(outfit, '服装资产编号')}</div>${button('编辑服装', 'edit-outfit', '', 'small')}</div><div class="outfit-content">${card}${hands}${special}${combine}</div><div class="bottom-actions">${jobButton('clothing_extract', outfit.clothingId ? '重新提取纯服装' : '存入服装库', '', !outfit.card, 'soft')}${jobButton('pipeline', '连续制作这个服装版本', '', !character.faceApproved, 'primary')}</div></div>`;
}

const headLibraryKinds = { face_core:'五官脸库',hairstyle:'发型库',body:'身体模板' };
const headEras = { ancient:'古代',modern:'现代',future:'未来科技',unspecified:'未说明' };
const headRelations = { same:'同一张脸',different:'不同脸',age_related:'随年龄变化',unknown:'原文未说明' };
const headBases = { source:'原文明写',inference:'语境推定',production_design:'制作补设',authorized_adaptation:'用户改编' };
ui.libraryFilters = {};
ui.librarySelections = {};
ui.libraryTarget = null;
function selectOptions(values,selected) { return Object.entries(values).map(([value,label])=>'<option value="'+escape(value)+'" '+(value===selected?'selected':'')+'>'+escape(label)+'</option>').join(''); }
function headAssetsReviewPending(value) { return !!(value?.identityReviewPending || value?.headPreparationPending || value?.headIdentityReviewPending || value?.hairReviewPending); }
function headSourceProfile(character=currentCharacter()) { const record=(currentProject()?.characters || []).find(item=>item.id===character?.id); const profile=profileFor(record); return profilesFor(record).find(item=>item.id===profile?.faceContinuity?.sourceProfileId && item.id!==profile?.id); }
function headTaskKind(character=currentCharacter()) {
  const relation=character?.faceContinuity || {}, source=headSourceProfile(character);
  return relation.status==='same' || (relation.status==='age_related' && (source?.face || source?.faceCore)) || character?.faceCore || (character?.face && character?.hairstyle?.reviewPending) ? 'head_prepare' : 'face';
}
function headTaskReady(character=currentCharacter()) { const source=headSourceProfile(character); return headTaskKind(character)!=='head_prepare' || !!(character.face || character.faceCore || character.reference || source?.face || source?.faceCore); }
function headTaskLabel(character=currentCharacter()) {
  if(!headTaskReady(character))return '先确定来源时期的五官';
  if(headTaskKind(character)==='head_prepare') return character.faceContinuity?.status==='age_related' ? '按年龄调整，整理本期头部' : character.faceContinuity?.status==='same' ? '沿用五官，制作本期发型' : '整理本时期完整头部';
  return ['face','fullbody'].includes(character.identitySource) ? '整理定稿脸图' : character.faceCandidates?.length ? '重新生成 3 张脸' : '生成 3 张候选脸';
}
function libraryFacetValues(item) {
  const era=Object.hasOwn(headEras,item.era)?item.era:({'古代':'ancient','现代':'modern','未来科技':'future'})[item.era] || 'unspecified';
  const ageStage=item.ageStage || ({'儿童':'child','少年':'teen','青年':'young_adult','成年':'adult','中年':'middle_aged','老年':'elderly'})[item.ageGroup] || 'unspecified';
  return {style:item.style || '',era,gender:['男','女','通用'].includes(item.gender)?item.gender:'未说明',ageStage,...(item.kind==='body'&&window.bodyStudio?window.bodyStudio.facets(item):{})};
}
function libraryFilterFor(kind=ui.libraryKind) { return ui.libraryFilters[kind] ||= {style:'',era:'',gender:'',ageStage:'',query:''}; }
function headIdentityPanel(character) {
  const relation=character.faceContinuity || {status:'unknown'}, hair=character.hairstyle || {}, source=headSourceProfile(character);
  return '<div class="head-layer-summary"><span class="tag">'+escape(headRelations[relation.status] || headRelations.unknown)+'</span><span>'+escape(headBases[relation.basis] || '依据待核对')+(source?' · 对照 '+escape(source.name):'')+'</span>'+button('设置脸与发型','edit-head-settings','','small')+'</div><details class="head-layer-details"><summary>五官身份与发型依据</summary><div class="head-layer-columns"><section><h3>五官身份</h3><p>'+escape(character.faceIdentityGroupId?'同脸组：'+character.faceIdentityGroupId:'尚未指定同脸组')+'</p><p>'+escape([evidenceText(relation.evidence),relation.note].filter(Boolean).join('；') || (relation.status==='unknown' ? '原文未说明脸部是否相同；未知不等于同脸。' : '尚未附原文证据；关系按上方依据性质登记。'))+'</p>'+(relation.status==='age_related'?'<p>需要按年龄调整五官与脸型，幼年不直接复制成年脸。</p>':'')+(character.faceCore?imageView(character.faceCore,'五官素材','暂无五官素材'):'')+'<div class="actions">'+button('选用五官脸库','open-head-library','data-kind="face_core"','small')+button('提取五官入库','head-library-create','data-kind="face_core" data-mode="extract"','small',!character.face&&!character.reference)+'</div></section><section><h3>发型 · '+escape(headEras[hair.era] || '时代未说明')+'</h3><p><strong>原文描写：</strong>'+escape(hair.sourceDescription || '未描写')+'</p>'+(evidenceText(hair.sourceEvidence)?'<p>'+escape(evidenceText(hair.sourceEvidence))+'</p>':'')+'<p><strong>制作设计：</strong>'+escape(hair.designDescription || '尚未补设')+'</p><p>'+escape(headBases[hair.designBasis] || '补设依据待核对')+' · 发型建议与原文资料分开保存。</p>'+(hair.image?imageView(hair.image,'独立发型素材','暂无发型素材'):'')+'<div class="actions">'+button('选用发型库','open-head-library','data-kind="hairstyle"','small')+button('提取发型入库','head-library-create','data-kind="hairstyle" data-mode="extract"','small',!character.face&&!character.reference)+'</div></section></div><p class="subtext">五官库保存无头发的纯五官脸或光头头部，不含颈部与身体；发型库仅包含头发及发饰。角色脸图仍保存完整头部和全部头发。</p>'+(hair.reviewPending?'<p class="hint-text">发型已调整；本时期旧头图、身体底稿与服装图保留，需核对或重新制作。</p>':'')+'</details>';
}
function headSettingsForm() {
  const record=currentCharacterRecord(), profile=profileFor(record);if(!profile?.id)throw new Error('先建立人物时期。');
  const relation=profile.faceContinuity || {}, hair=profile.hairstyle || {};
  const sources=profilesFor(record).filter(item=>item.id!==profile.id);
  const body='<div class="form-row"><div class="form-field"><label>五官关系</label><select name="relationStatus">'+selectOptions(headRelations,relation.status || 'unknown')+'</select></div><div class="form-field"><label>对照时期</label><select name="sourceProfileId"><option value="">未指定</option>'+sources.map(item=>'<option value="'+escape(item.id)+'" '+(item.id===relation.sourceProfileId?'selected':'')+'>'+escape(item.name)+'</option>').join('')+'</select></div></div><div class="form-field"><label>关系依据</label><select name="relationBasis">'+selectOptions(headBases,relation.basis || 'production_design')+'</select></div><div class="form-field"><label>关系证据或改编说明</label><textarea name="relationEvidence">'+escape(evidenceText(relation.evidence))+'</textarea></div><div class="form-field"><label>同脸组 <small>相同五官使用同一组；未知可留空</small></label><input name="faceIdentityGroupId" value="'+escape(profile.faceIdentityGroupId || '')+'"></div><hr class="form-divider"><div class="form-row"><div class="form-field"><label>发型时代</label><select name="era">'+selectOptions(headEras,hair.era || 'unspecified')+'</select></div><div class="form-field"><label>适用性别</label><select name="gender">'+selectOptions({'男':'男','女':'女','通用':'通用','未说明':'未说明'},hair.gender || '未说明')+'</select></div></div><div class="form-field"><label>原文发型描写 <small>没有描写就留空</small></label><textarea name="sourceDescription">'+escape(hair.sourceDescription || '')+'</textarea></div><div class="form-field"><label>原文发型证据</label><textarea name="sourceEvidence">'+escape(evidenceText(hair.sourceEvidence))+'</textarea></div><div class="form-field"><label>制作设计建议</label><textarea name="designDescription" placeholder="例如：现代短发；这是制作设计，不作原文事实。">'+escape(hair.designDescription || '')+'</textarea></div><div class="form-field"><label>设计性质</label><select name="designBasis">'+selectOptions({production_design:'制作补设',authorized_adaptation:'用户改编'},hair.designBasis || 'production_design')+'</select></div><p class="form-help">这里只保存关系和设计，不生成图片。改发型后保留旧成果，再整理本时期完整头部。</p>';
  modal('设置五官与发型',record.name+' · '+profile.name,body,'保存设置',async form=>{
    const values=Object.fromEntries(new FormData(form));
    if(['same','age_related'].includes(values.relationStatus)&&!values.sourceProfileId)throw new Error('同脸或随年龄变化需要选择一个对照时期。');
    const evidence=values.relationEvidence.trim()===evidenceText(relation.evidence).trim()?relation.evidence || []:values.relationEvidence.trim()?[{quote:values.relationEvidence.trim(),paragraphId:'',claimType:values.relationBasis==='source'?'literal':'design'}]:[];
    const sourceEvidence=values.sourceEvidence.trim()===evidenceText(hair.sourceEvidence).trim()?hair.sourceEvidence || []:values.sourceEvidence.trim()?[{quote:values.sourceEvidence.trim(),paragraphId:'',claimType:'literal'}]:[];
    await api(characterEndpoint(record.id)+'/appearance-profiles/'+encodeURIComponent(profile.id),'PATCH',{faceIdentityGroupId:values.faceIdentityGroupId.trim(),faceContinuity:{...relation,status:values.relationStatus,basis:values.relationBasis,sourceProfileId:values.sourceProfileId,evidence},hairstyle:{...hair,era:values.era,gender:values.gender,ageStage:profile.ageStage || 'unspecified',sourceDescription:values.sourceDescription.trim(),sourceEvidence,designDescription:values.designDescription.trim(),designBasis:values.designBasis}});
    closeModal();await refresh(true);toast('五官关系与发型设计已保存；图片制作需另行开始。');
  });
}

function renderLibrary(){return window.materialStudio?window.materialStudio.render():renderPeopleLibrary();}
function materialCardActions(item){return window.materialStudio?.cardActions(item)||'';}
function renderPeopleLibrary() {
  if(!Object.hasOwn(headLibraryKinds,ui.libraryKind))ui.libraryKind='face_core';
  const f=libraryFilterFor();
  const filtered=state.library.filter(item=>item.kind===ui.libraryKind && Object.entries(libraryFacetValues(item)).every(([key,value])=>!f[key] || value===f[key]) && (!f.query || [item.name,item.description,item.sourceDescription,item.designDescription,...(item.tags || [])].join(' ').toLowerCase().includes(f.query.toLowerCase())));
  const split=['face_core','hairstyle'].includes(ui.libraryKind);
  const createAction=split?'head-library-create':'library-body';
  const createLabel=split?'＋ 生成'+(ui.libraryKind==='face_core'?'五官素材':'发型素材'):'＋ 生成素体模板';
  const actions=button(createLabel,createAction,split?'data-kind="'+ui.libraryKind+'" data-mode="generate"':'','primary')+(split?button('从参考图提取','head-library-create','data-kind="'+ui.libraryKind+'" data-mode="extract"'):'')+button('导入已有素材','library-upload')+(split?button('批量导入参考','batch-reference-import'):'');
  const tabs='<div class="tabs">'+Object.entries(headLibraryKinds).map(([kind,label])=>'<button class="tab '+(kind===ui.libraryKind?'active':'')+'" data-action="library-kind" data-value="'+kind+'">'+label+' <span>'+state.library.filter(item=>item.kind===kind).length+'</span></button>').join('')+'</div>';
  const filters=[['style','全部画风',Object.fromEntries(assetStyles.map(style=>[style,style]))],...(ui.libraryKind==='body'?[]:[['era','全部时代',headEras]]),['gender','全部性别',{'男':'男','女':'女','通用':'通用','未说明':'未说明'}],['ageStage','全部年龄',appearanceAges],...(ui.libraryKind==='body'&&window.bodyStudio?window.bodyStudio.filters:[])].map(([key,label,values])=>'<select data-library-filter="'+key+'" aria-label="'+label+'"><option value="">'+label+'</option>'+selectOptions(values,f[key])+'</select>').join('');
  const tips={face_core:'无头发的纯五官脸或光头头部，五官骨相清楚；不含颈部、肩膀与身体。',hairstyle:'只展示通用白模头部的正、90°侧、背发型三视，完整发尾与发饰；五官身份由五官脸库提供。原文资料与制作补设分开。',body:'不同身材的可复用素体，按男女、年龄、高矮胖瘦分类。简单贴身的白色基础T恤与短裤，纯白背景、无角色服装配饰；三视结构用于换装与组装。'};
  const target=ui.libraryTarget, targetProject=state.projects.find(project=>project.id===target?.projectId),targetCharacter=targetProject?.characters?.find(character=>character.id===target?.characterId),targetProfile=profilesFor(targetCharacter).find(profile=>profile.id===target?.appearanceProfileId);
  const targetBanner=split&&targetProfile?'<div class="batch-strip"><div><strong>为 '+escape(targetCharacter.name)+' · '+escape(targetProfile.name)+' 选素材</strong><small>选用五官或发型只更新这个时期的对应资料；完整头部需另行整理。</small></div>'+button('返回人物时期','return-head-target','','small')+'</div>':'';
  const grid=filtered.length?'<div class="library-grid">'+filtered.map(item=>{
    const selected=item.id===ui.bodyId || item.id===ui.librarySelections[item.kind],url=item.kind==='hairstyle'?hairDisplay(item).url:fileUrl(item.image),facets=libraryFacetValues(item);
    return '<article class="card library-item '+(selected?'selected':'')+'" data-action="select-library" data-id="'+escape(item.id)+'" tabindex="0" role="button" aria-pressed="'+selected+'" aria-label="选择'+escape(item.name)+'"><div class="library-image">'+(url?'<img src="'+escape(thumbnailUrl(url,512))+'" alt="'+escape(item.name)+'" loading="lazy">':'<span class="media-placeholder">暂无图片</span>')+(selected?'<span class="selection-mark">✓</span>':'')+'</div><div class="library-item-body"><h3>'+escape(item.name || item.id)+'</h3><p class="subtext">'+escape([item.style || '未标记画风',...(item.kind==='body'?[]:[headEras[facets.era]]),facets.gender,appearanceAges[facets.ageStage] || '年龄未说明',...(item.kind==='body'&&window.bodyStudio?[window.bodyStudio.tags(item)]:[])].join(' · '))+'</p><p class="subtext library-description">'+escape(item.description || tips[item.kind])+'</p>'+(item.kind==='hairstyle'?'<details class="library-source-details"><summary>原文与制作设计</summary><p>原文：'+escape(item.sourceDescription || '未描写')+'</p><p>设计：'+escape(item.designDescription || item.description || '未补设')+'</p><p>'+escape(headBases[item.designBasis] || '制作补设')+'</p></details>':'')+'<div class="actions">'+(url?'<a class="button small" href="'+escape(url)+'" download>下载</a>'+button('放大','preview','data-url="'+escape(url)+'" data-name="'+escape(item.name)+'"','small'):'')+(split?button(item.kind==='hairstyle'?'选用此发型':'选用此五官','use-head-library','data-id="'+escape(item.id)+'"','small soft'):'')+(item.kind==='face_core'?refinementButtons({sourceKind:'face_core',libraryId:item.id}):'')+'</div>'+materialCardActions(item)+hairLibraryControls(item)+'</div></article>';
  }).join('')+'</div>':'<div class="card empty-state"><div class="empty-illustration">'+icon(split?'portrait':'people')+'</div><h2>'+escape(state.library.some(item=>item.kind===ui.libraryKind)?'没有匹配的素材':'建立'+headLibraryKinds[ui.libraryKind])+'</h2><p>'+escape(tips[ui.libraryKind])+'</p>'+button(createLabel,createAction,split?'data-kind="'+ui.libraryKind+'" data-mode="generate"':'','primary')+'</div>';
  return pageHeading('可复用的人物资产','人物素材库','五官、发型与身体分别保存；角色完整头部在项目中定稿，群像整头在群像库成组保存。',actions)+targetBanner+'<div class="head-library-toolbar">'+tabs+'<div class="head-library-filters">'+filters+'<input id="head-library-search" value="'+escape(f.query)+'" placeholder="搜索名称、描述或标签" aria-label="搜索人物素材">'+button('搜索','search-head-library','','small')+'</div></div><p class="library-kind-note">'+escape(tips[ui.libraryKind])+'</p>'+grid;
}
function headLibraryFacetFields(item={}) {
  const f=libraryFacetValues(item);
  return '<div class="form-row"><div class="form-field"><label>时代</label><select name="era">'+selectOptions(headEras,f.era)+'</select></div><div class="form-field"><label>性别</label><select name="gender">'+selectOptions({'男':'男','女':'女','通用':'通用','未说明':'未说明'},f.gender)+'</select></div></div><div class="form-field"><label>年龄阶段</label><select name="ageStage">'+selectOptions(appearanceAges,f.ageStage)+'</select></div>';
}
function headLibraryForm(kind,action='generate') {
  if(!['face_core','hairstyle'].includes(kind))return;
  const character=currentCharacter(),profile=profileFor(currentCharacterRecord()),hair=profile?.hairstyle || {};
  const available=state.library.filter(item=>fileUrl(item.image)&&(Object.hasOwn(headLibraryKinds,item.kind)||item.kind==='clothing'));
  const ownReference=character?.face || character?.reference || '';
  const body='<div class="form-row"><div class="form-field"><label>素材名称</label><input name="name" placeholder="'+(kind==='face_core'?'例如：青年男性五官':'例如：现代短发')+'" required></div><div class="form-field"><label>画风</label><select name="style">'+selectOptions(Object.fromEntries(styles.map(style=>[style,style])),currentProject()?.style || '国漫')+'</select></div></div>'+headLibraryFacetFields({...hair,ageStage:profile?.ageStage || 'unspecified'})+'<div class="form-field"><label>'+(kind==='hairstyle'?'发型制作描述':'五官与脸型描述')+'</label><textarea name="description" rows="4">'+escape(kind==='hairstyle'?hair.designDescription || '':'')+'</textarea></div>'+(kind==='hairstyle'?'<div class="form-field"><label>原文发型描写 <small>未描写可留空</small></label><textarea name="sourceDescription">'+escape(hair.sourceDescription || '')+'</textarea></div><div class="form-field"><label>设计性质</label><select name="designBasis">'+selectOptions({production_design:'制作补设',authorized_adaptation:'用户改编'},hair.designBasis || 'production_design')+'</select></div>':'')+'<div class="form-field"><label>已有参考素材</label><select name="referenceId"><option value="">不选素材库参考</option>'+available.map(item=>'<option value="'+escape(item.id)+'">'+escape(headLibraryKinds[item.kind] || '服装')+' · '+escape(item.name)+'</option>').join('')+'</select></div>'+(ownReference?'<label class="checkbox-label"><input type="checkbox" name="useCurrentHead" '+(action==='extract'?'checked':'')+'>使用当前人物时期的完整脸图或参考图</label>':'')+referenceField([],false)+'<div class="notice">'+(kind==='face_core'?'纯五官脸或光头头部：完全无头发，保持五官骨相，不含颈部、肩膀与身体。':'只生成白模头部发型三视图；通用纯白中性头不代表角色五官，完整头发与发饰，不含颈肩和身体。')+' '+(action==='extract'?'从参考提取一张独立素材。':'生成一张独立素材。')+' 素材入库不会直接覆盖角色完整头部。</div>';
  modal((action==='extract'?'提取':'生成')+headLibraryKinds[kind],'五官与发型分别保存，便于同脸换发型。',body,'加入制作队列',async form=>{
    const values=Object.fromEntries(new FormData(form)),uploaded=await uploadSelectedFiles(form);
    const reference=uploaded[0] || (values.useCurrentHead?ownReference:'');
    if(action==='extract'&&!reference&&!values.referenceId)throw new Error('提取素材需要参考图或已选素材。');
    await enqueue(kind==='face_core'?'library_face_core':'library_hairstyle',{action,name:values.name.trim(),style:values.style,description:values.description.trim(),era:values.era,gender:values.gender,ageStage:values.ageStage,...(reference?{reference}:{}),referenceIds:values.referenceId?[values.referenceId]:[],...(kind==='hairstyle'?{sourceDescription:values.sourceDescription.trim(),sourceEvidence:values.sourceDescription.trim()===(hair.sourceDescription || '').trim()?hair.sourceEvidence || []:[],designDescription:values.description.trim(),designBasis:values.designBasis}:{}),count:1});
    closeModal();ui.page='queue';render();
  });
}
function headLibraryTargetForm(item) {
  if(!item || !['face_core','hairstyle'].includes(item.kind))throw new Error('先选择五官或发型素材。');
  if(!state.projects.some(project=>project.characters?.length))throw new Error('先建立一个项目与角色。');
  const target=ui.libraryTarget || {projectId:ui.projectId,characterId:ui.characterId,appearanceProfileId:currentAppearanceProfileId()};
  const project=state.projects.find(entry=>entry.id===target.projectId&&entry.characters?.length) || state.projects.find(entry=>entry.characters?.length);
  const character=project.characters.find(entry=>entry.id===target.characterId)||project.characters[0];
  const profiles=profilesFor(character),profile=profiles.find(entry=>entry.id===target.appearanceProfileId)||profiles[0];
  const body='<div class="reference-grid"><img class="reference-preview" src="'+escape(fileUrl(item.image))+'" alt="'+escape(item.name)+'"></div><div class="form-field"><label>项目</label><select name="projectId" data-change="head-target-project">'+state.projects.filter(entry=>entry.characters?.length).map(entry=>'<option value="'+escape(entry.id)+'" '+(entry.id===project.id?'selected':'')+'>'+escape(entry.name)+'</option>').join('')+'</select></div><div class="form-field"><label>角色</label><select name="characterId" id="head-target-character" data-change="head-target-character">'+project.characters.map(entry=>'<option value="'+escape(entry.id)+'" '+(entry.id===character.id?'selected':'')+'>'+escape(entry.name)+'</option>').join('')+'</select></div><div class="form-field"><label>人物时期</label><select name="appearanceProfileId" id="head-target-profile">'+profiles.map(entry=>'<option value="'+escape(entry.id)+'" '+(entry.id===profile.id?'selected':'')+'>'+escape(entry.name)+'</option>').join('')+'</select></div><p class="form-help">'+(item.kind==='face_core'?'只选用纯五官素材，不替换完整头部图片。':'只选用发型，不更换五官身份。')+' 旧头图、身体与服装成果保留并等待核验；下一步整理本时期完整头部。</p>';
  modal(item.kind==='face_core'?'选用五官素材':'选用发型',item.name+' · 来源画风 '+(item.style || '未标记'),body+'<p class="form-help">来源与项目画风不同时，选用为转绘参考；原素材保持原风格，最终头部与角色卡按项目画风制作。</p>','选用到该时期',async form=>{
    const values=Object.fromEntries(new FormData(form));
    const targetProject=state.projects.find(project=>project.id===values.projectId),targetStyle=targetProject?.style || targetProject?.recommendedStyle || '国漫';
    const result=await api('/api/library/'+encodeURIComponent(item.id)+(item.kind==='hairstyle'?'/wear-hairstyle':'/adopt'),'POST',{...values,...(item.style&&item.style!==targetStyle?{asReference:true,convertStyle:true}:{})});
    chooseProject(result.projectId || values.projectId);ui.characterId=result.characterId || values.characterId;ui.profileSelections[profileKey(ui.characterId)]=result.appearanceProfileId || values.appearanceProfileId;ui.projectStage='face';ui.page='project';ui.libraryTarget=null;closeModal();await refresh(true);toast('素材已选用。接着整理这个时期的完整头部。');
  });
}
function updateHeadTargetOptions(changedProject=false) {
  const project=state.projects.find(entry=>entry.id===$('[name="projectId"]',dialog)?.value);
  const charSelect=$('#head-target-character',dialog),profileSelect=$('#head-target-profile',dialog);
  if(changedProject)charSelect.innerHTML=(project?.characters || []).map(entry=>'<option value="'+escape(entry.id)+'">'+escape(entry.name)+'</option>').join('');
  const character=project?.characters?.find(entry=>entry.id===charSelect.value);
  profileSelect.innerHTML=profilesFor(character).map(entry=>'<option value="'+escape(entry.id)+'">'+escape(entry.name)+'</option>').join('');
}
function renderClothing() {
  const f = ui.clothingFilters;
  const items = state.library.filter(item => item.kind === 'clothing' && ['style', 'era', 'gender', 'ageGroup'].every(key => !f[key] || item[key] === f[key]) && (!f.query || [item.name, item.description, ...(item.tags || [])].join(' ').toLowerCase().includes(f.query.toLowerCase())));
  const filters = [['style', '全部画风', assetStyles], ['era', '全部时代', clothingFacets.era], ['gender', '全部性别', clothingFacets.gender], ['ageGroup', '全部年龄', clothingFacets.ageGroup]].map(([key, label, values]) => `<select data-clothing-filter="${key}" aria-label="${label}"><option value="">${label}</option>${values.map(value => `<option value="${escape(value)}" ${f[key] === value ? 'selected' : ''}>${escape(value)}</option>`).join('')}</select>`).join('');
  const grid = items.length ? `<div class="library-grid">${items.map(item => `<article class="card library-item clothing-item"><div class="library-image">${fileUrl(item.image) ? `<a href="${escape(fileUrl(item.image))}" data-action="preview" data-url="${escape(fileUrl(item.image))}" data-name="${escape(item.name)}"><img src="${escape(fileUrl(item.image))}" alt="${escape(item.name)}" loading="lazy"></a>` : ''}</div><div class="library-item-body"><h3>${escape(item.name)}</h3><p class="subtext">${escape([item.style, item.era, item.gender, item.ageGroup].filter(Boolean).join(' · '))}</p><p class="subtext">${escape((item.tags || []).join('、'))}</p>${item.detailReviewVersion ? `<span class="tag ${item.detailReviewStatus === 'checked' ? 'green' : 'gray'}">${item.detailReviewStatus === 'checked' ? '纯素材与必要细节已检查' : '素材细节待核验'}</span>` : '<span class="tag gray">旧素材细节待核验</span>'}<div class="actions">${button('穿此衣服', 'wear-clothing', `data-id="${escape(item.id)}"`, 'small soft')}${button('编辑标签', 'edit-clothing', `data-id="${escape(item.id)}"`, 'small')}${materialCardActions(item)}<a class="button small" href="${escape(fileUrl(item.image))}" download>下载</a></div></div></article>`).join('')}</div>` : `<div class="card empty-state"><div class="empty-illustration">${icon('clothing')}</div><h2>${state.library.some(item => item.kind === 'clothing') ? '没有匹配的服装' : '建立可复用的纯服装库'}</h2><p>从角色服装卡提取衣服，或导入不含人物的服装图。按时代、画风、性别、年龄和标签挑选，再给其他角色换装。</p>${jobButton('clothing_collect', '收集往期服装', '', false, 'soft')}</div>`;
  return pageHeading('让每套衣服持续复用', '服装库', '纯服装素材：整套衣服、鞋与配饰，附必要的3—6处局部放大细节；不含人物、身体或假人，简单服饰不编造细节。', jobButton('clothing_collect', '收集往期服装', '', false, 'soft') + button('导入纯服装图', 'import-clothing', '', 'primary') + '<a class="button" href="/api/export/clothing" download>导出服装库 ZIP</a>') + `<div class="clothing-toolbar">${filters}<input id="clothing-search" value="${escape(f.query)}" placeholder="搜索名称、描述或标签" aria-label="搜索服装"><button class="button small" data-action="search-clothing">搜索</button></div>` + grid;
}
function clothingLabelFields(item = {}) { return `<div class="form-row"><div class="form-field"><label>服装名称</label><input name="name" required value="${escape(item.name || '')}" placeholder="例如：玄色巡卫常服"></div><div class="form-field"><label>画风</label><select name="style">${styles.map(style => `<option ${style === (item.style || currentProject()?.style || '国漫') ? 'selected' : ''}>${style}</option>`).join('')}</select></div></div><div class="clothing-label-row">${Object.entries(clothingFacets).map(([key, values]) => `<div class="form-field"><label>${{era:'时代',gender:'性别',ageGroup:'年龄'}[key]}</label><select name="${key}">${values.map(value => `<option ${value === (item[key] || (key === 'era' ? '其他' : '通用')) ? 'selected' : ''}>${value}</option>`).join('')}</select></div>`).join('')}</div><div class="form-field"><label>标签</label><input name="tags" value="${escape((item.tags || []).join('、'))}" placeholder="例如：官服、黑色、护腕、长袍"></div><div class="form-field"><label>服装描述</label><textarea name="description">${escape(item.description || '')}</textarea></div>`; }
function clothingForm(item) {
  modal(item ? '编辑服装标签' : '导入纯服装图', '图库保存独立服装设计，供其他角色复用。', clothingLabelFields(item) + (!item ? referenceField([], false) + '<div class="notice">纯服装素材以整套上衣、下装、鞋和穿戴配饰为主，附必要的3—6处局部放大细节（袖口、护腕、手套、纹样等）；简单衣服可减少细节，不编造。画面不含人物、脸、身体、假人或持握道具。带角色的图请从对应服装版本“存入服装库”提取。</div>' : ''), item ? '保存标签' : '存入服装库', async form => {
    const values = Object.fromEntries(new FormData(form)); const payload = { kind: 'clothing', name: values.name.trim(), style: values.style, era: values.era, gender: values.gender, ageGroup: values.ageGroup, description: values.description, tags: [...new Set(values.tags.split(/[,，、;；\n]+/).map(tag => tag.trim()).filter(Boolean))] };
    if (!item) { const uploaded = await uploadSelectedFiles(form); if (!uploaded.length) throw new Error('请选择一张纯服装图片。'); payload.image = uploaded[0]; }
    await api(item ? `/api/library/${encodeURIComponent(item.id)}` : '/api/library', item ? 'PATCH' : 'POST', payload); closeModal(); await refresh(true); toast('服装资料已保存。');
  });
}
function wearClothingForm(item) {
  const eligible = state.projects.filter(project => project.style === item.style && project.characters?.length);
  if (!eligible.length) throw new Error('先建立同画风的项目与角色，再使用这套服装。');
  const selectedProject = eligible.find(project => project.id === ui.projectId) || eligible[0];
  const body = `<div class="form-field"><label>项目</label><select name="projectId" data-change="wear-project">${eligible.map(project => `<option value="${escape(project.id)}" ${project.id === selectedProject.id ? 'selected' : ''}>${escape(project.name)}</option>`).join('')}</select></div><div class="form-field"><label>穿着角色</label><select name="characterId" id="wear-character">${selectedProject.characters.map(character => `<option value="${escape(character.id)}">${escape(character.name)}</option>`).join('')}</select></div><div class="form-field"><label>服装版本名称</label><input name="name" value="${escape(item.name)}" required></div><div class="form-field"><label>对应话数</label><input name="episodes" placeholder="可选，例如1-8"></div><p class="form-help">为这个角色添加该服装版本，保持人物自己的长相与体型。随后在项目中生成，或点击全自动制作。</p>`;
  modal('给角色穿这套衣服', item.name, body, '穿此衣服', async form => { const values = Object.fromEntries(new FormData(form)); const result = await api(`/api/library/${encodeURIComponent(item.id)}/wear`, 'POST', values); chooseProject(result.projectId || values.projectId); ui.characterId = result.characterId || values.characterId; ui.outfitId = result.outfit?.id || ''; ui.page = 'project'; closeModal(); await refresh(true); toast('服装版本已加入角色，可以开始制作。'); });
}
function jobTitle(job) {
  if(['card_convert','card_outfit_scan','image_combine'].includes(job.kind))return '快捷工具 / '+(job.name || kinds[job.kind]);
  const project = state.projects.find(item => item.id === job.projectId); const character = project?.characters?.find(item => item.id === job.characterId); const outfit = character?.outfits?.find(item => item.id === job.outfitId);
  return [project?.name, character?.name, outfit?.name].filter(Boolean).join(' / ') || (job.kind==='hairstyle_preview' ? '发型库 · 白模三视预览' : job.kind==='face_refine'&&job.libraryId ? '五官库 · 微调预览' : job.kind==='extract_assets' ? '人物素材库 · 参考提取' : job.kind?.startsWith('library') ? '人物素材库' : '项目任务');
}
function jobMessage(job) {
  if (job.error) return job.error;
  if (job.message) return job.message;
  if (job.messages?.length) { const last = job.messages.at(-1); return typeof last === 'string' ? last : last.message || last.text || ''; }
  return { queued: '任务已保存，等待前面的任务完成。', running: 'Codex 正在处理，结果会自动保存到对应角色。', completed: '结果已保存。', failed: '任务未完成，可以调整要求后重新发起。', cancelled: '任务已取消。' }[job.status] || '';
}
function orderedQueuedJobs() {
  const queued = state.jobs.filter(job=>job.status==='queued');
  const orderedIds = [...(state.queueOrder || []), ...(state.queuedJobs || []).map(job=>typeof job==='string'?job:job.id)];
  const rank = new Map([...new Set(orderedIds)].map((id,index)=>[id,index]));
  return queued.sort((a,b)=>(rank.get(a.id) ?? Number.MAX_SAFE_INTEGER)-(rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}
async function moveQueuedJob(id,direction) {
  const queued = orderedQueuedJobs();
  const index = queued.findIndex(job=>job.id===id), target = index+direction;
  if (index<0||target<0||target>=queued.length) return;
  [queued[index],queued[target]] = [queued[target],queued[index]];
  try {
    await api('/api/jobs/reorder','POST',{jobIds:queued.map(job=>job.id)}); await refresh(true); toast('等待任务顺序已更新。');
  } catch(error) { await refresh(true); throw error; }
}

function durationLabel(seconds) { const value=Math.max(0,Math.floor(Number(seconds)||0));return value>=3600?Math.floor(value/3600)+'小时 '+Math.floor(value%3600/60)+'分':value>=60?Math.floor(value/60)+'分 '+value%60+'秒':value+'秒'; }
function jobElapsed(job) { if(job.status==='running'&&job.startedAt){const start=Date.parse(job.startedAt);if(Number.isFinite(start))return Math.max(0,(Date.now()-start)/1000);}return Number(job.elapsedSeconds)||0; }

function realJobProgress(job) {
  const step=job.stepProgress || {},total=Number(step.total),completed=Math.max(0,Number(step.completed)||0),known=Number.isFinite(total)&&total>0;
  const percent=job.status==='completed'?100:known?Math.min(100,completed/total*100):Number.isFinite(job.progressPercent)&&job.progressPercent>=0?Math.min(100,job.progressPercent):null;
  const partLabels={full_group:'5人全身素材',heads:'完整5头素材',plan:'规划群像套组',face_core:'纯五官脸',hairstyle:'发型',clothing:'纯服装',gestures:'安排8个动作',hands:'生成8格手部',render:'生成图片',verify:'检查图片',save:'保存成果'};
  const fallback={running:'正在处理，等待阶段结果',queued:'等待执行',completed:'成果已保存',failed:'制作未完成',cancelled:'任务已取消',interrupted:'任务已中断'};
  const current=partLabels[step.currentStep] || step.currentStep || fallback[job.status] || '阶段待核对';
  return {percent,known,completed,total,current,steps:(step.steps || []).map(item=>({label:partLabels[item.id] || item.name || item.label || item.id,status:item.status}))};
}
function progressMarkup(job) {
  const progress=realJobProgress(job),running=job.status==='running';
  if(!running&&job.status!=='completed'&&!job.stepProgress)return '';
  const bar=progress.percent===null ? running ? '<div class="job-progress indeterminate" role="status" aria-label="生成中，阶段总数尚未确定"><i></i></div>' : '' : '<div class="job-progress determinate" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(progress.percent)+'"><i style="width:'+progress.percent+'%"></i></div>';
  const statePrefix={queued:'等待执行',failed:'未完成',cancelled:'已取消',interrupted:'已中断'};
  const stage=statePrefix[job.status] ? statePrefix[job.status]+' · '+progress.current : progress.current;
  const stepText=step=>step.status==='running'&&!running ? job.status==='queued'?'等待继续':'已停止' : ({completed:'完成',running:'处理中',failed:'未完成',skipped:'已复用',queued:'等待',pending:'待处理',cancelled:'取消',interrupted:'中断'})[step.status] || '待处理';
  return bar+'<p class="job-stage-progress">'+(progress.known?'已完成 '+progress.completed+' / '+progress.total+' 步 · ':'')+escape(stage)+'</p>'+(progress.steps.length?'<div class="job-part-status">'+progress.steps.map(step=>'<span class="tag '+(step.status==='completed'?'green':step.status==='failed'?'red':'gray')+'">'+escape(step.label)+' · '+escape(stepText(step))+'</span>').join('')+'</div>':'');
}
function schedulerPanel() {
  const scheduler=state.scheduler || {},maximum=Number(scheduler.maxConcurrentJobs || state.settings.maxConcurrentJobs || 8),running=Number.isFinite(scheduler.runningCount)?scheduler.runningCount:state.jobs.filter(job=>job.status==='running').length;
  return '<div class="scheduler-panel card"><div><strong>同时进行 '+running+' / '+maximum+' 个任务</strong><p>独立任务可立即同时执行；有素材依赖或同一输出冲突的任务显示等待原因。一个任务的8格手部图片不等于8个并发任务。</p></div><label>同时执行<select data-change="concurrency" aria-label="同时执行的任务数">'+Array.from({length:8},(_,index)=>'<option value="'+(index+1)+'" '+(index+1===maximum?'selected':'')+'>'+(index+1)+' 个</option>').join('')+'</select></label></div>';
}
function submissionBar() {
  const info=ui.lastSubmission;if(!info)return '';
  const job=state.jobs.find(item=>item.id===info.id) || info,progress=realJobProgress(job);
  return '<div class="submission-bar" role="status"><div><strong>'+escape(({queued:'已加入制作队列',running:'正在制作',completed:'制作完成',failed:'任务未完成',cancelled:'任务已取消'})[job.status] || '任务已提交')+' · '+escape(kinds[job.kind] || '素材制作')+'</strong><span>'+escape(progress.known?'完成 '+progress.completed+'/'+progress.total+' 步':job.blockedReason || progress.current || '到任务队列查看实际阶段和结果。')+'</span></div>'+button('查看进度','show-queue','','small soft')+button('收起','dismiss-submission','','small')+'</div>';
}
function updateElapsedLabels() { $$('[data-elapsed-job]').forEach(node=>{const job=state.jobs.find(item=>item.id===node.dataset.elapsedJob);if(job)node.textContent='已用时 '+durationLabel(jobElapsed(job));}); }
setInterval(updateElapsedLabels,1000);
function handCardDependency() { return state.jobs.find(job=>job.projectId===ui.projectId&&job.characterId===ui.characterId&&job.outfitId===ui.outfitId&&job.kind==='outfit'&&['queued','running'].includes(job.status)); }
function headArchiveState(character) {
  const active=state.jobs.find(job=>job.kind==='extract_assets'&&job.projectId===ui.projectId&&job.characterId===character.id&&job.appearanceProfileId===character.appearanceProfileId&&['queued','running'].includes(job.status));
  const ready=!!(character.faceCore && (character.hairstyle?.image || character.hairstyle?.libraryHairstyleId));
  return {active,ready};
}
function archiveHeadButton(character) {
  if(!character.face)return '';
  const archive=headArchiveState(character);
  return '<div class="head-archive-bar"><p>'+escape(archive.ready?'五官与发型素材已关联，完整头部仍单独保留。':archive.active?'五官与发型正在拆入库，可在任务队列查看各项进度。':'已确认的脸可拆成纯五官脸和独立发型，供其他时期复用。')+'</p>'+button(archive.active?'拆入库任务已排队':archive.ready?'补齐或复用库素材':'一键拆入五官与发型库','archive-head','','small soft',!!archive.active||!character.faceApproved)+'</div>';
}
async function archiveCurrentHead() {
  const character=currentCharacter();if(!character?.face||!character.faceApproved)throw new Error('先确认这张完整脸图，再拆入素材库。');
  await enqueue('extract_assets',{characterId:character.id,appearanceProfileId:character.appearanceProfileId,sourceHead:character.face,parts:['face_core','hairstyle'],sourceStyle:'comic',outputStyle:character.faceStyle || currentProject()?.style || '国漫'});
}

function queueRow(job,position=-1,total=0) {
  const queued=job.status==='queued';
  return '<article class="card job-row" data-job-id="'+escape(job.id)+'"><div class="job-icon">'+(queued?position+1:job.status==='completed'?'✓':job.status==='failed'?'!':'◷')+'</div><div class="job-content"><div class="job-heading"><h3>'+escape(kinds[job.kind] || job.kind)+'</h3><span class="tag '+(job.status==='completed'?'green':job.status==='failed'?'red':'gray')+'">'+escape(statuses[job.status] || job.status)+'</span>'+(queued?'<span class="queue-order-label">等待顺序 '+(position+1)+'</span>':'')+'</div><p class="job-description">'+escape(jobTitle(job))+'</p>'+progressMarkup(job)+'<p class="job-message">'+escape(jobMessage(job))+'</p>'+(job.blockedReason?'<p class="job-blocked">等待前置：'+escape(job.blockedReason)+'</p>':'')+(job.kind==='extract_assets'?'<p class="job-source-style">来源：'+escape(referenceSourceStyles[job.sourceStyle] || '未标记')+' · 输出：'+escape(job.outputStyle==='source' ? '保留原风格' : job.outputStyle || job.style || '未标记')+'</p>':'')+'<p class="job-time">'+escape(dateLabel(job.createdAt || job.created))+(job.startedAt||job.elapsedSeconds?' · <span data-elapsed-job="'+escape(job.id)+'">已用时 '+durationLabel(jobElapsed(job))+'</span>':'')+'</p></div><div class="actions">'+(queued?button('上移','move-job','data-id="'+escape(job.id)+'" data-direction="-1"','small',position===0)+button('下移','move-job','data-id="'+escape(job.id)+'" data-direction="1"','small',position===total-1):'')+(['card_convert','card_outfit_scan','image_combine'].includes(job.kind)?button('查看结果','tool-result','data-id="'+escape(job.id)+'"','small soft'):'')+(job.projectId?button('查看角色','open-job','data-id="'+escape(job.id)+'"','small'):'')+(job.kind==='face_refine'&&job.status==='completed'&&fileUrl(job.visualRefinement?.image)?button('比较微调预览','compare-refinement','data-job-id="'+escape(job.id)+'"','small soft'):'')+(['queued','running'].includes(job.status)?button('取消','cancel-job','data-id="'+escape(job.id)+'"','small danger'):'')+'</div></article>';
}
function renderQueue() {
  const queued=orderedQueuedJobs(),running=state.jobs.filter(job=>job.status==='running'),history=state.jobs.filter(job=>!['queued','running'].includes(job.status)).slice().reverse();
  const counts={waiting:queued.length,running:running.length,done:history.filter(job=>job.status==='completed').length,failed:history.filter(job=>job.status==='failed').length};
  const tabs=['全部','等待中','制作中','已完成','未完成'].map(label=>'<button class="tab '+(ui.queueFilter===label?'active':'')+'" data-action="queue-filter" data-value="'+label+'">'+label+'</button>').join('');
  const showRunning=['全部','制作中'].includes(ui.queueFilter),showQueued=['全部','等待中'].includes(ui.queueFilter),showHistory=['全部','已完成','未完成'].includes(ui.queueFilter);
  const filteredHistory=ui.queueFilter==='已完成'?history.filter(job=>job.status==='completed'):ui.queueFilter==='未完成'?history.filter(job=>['failed','cancelled','interrupted'].includes(job.status)):history;
  let content='';
  if(showRunning)content+='<div class="queue-section-heading"><h2>正在制作</h2><span>实时阶段和已用时间；总步数未知时不猜百分比</span></div><div class="job-list">'+(running.length?running.map(job=>queueRow(job)).join(''):'<p class="queue-section-empty">当前没有正在制作的任务。</p>')+'</div>';
  if(showQueued)content+='<div class="queue-section-heading"><h2>等待执行</h2><span>前置就绪后按顺序执行，可移动或取消</span></div><div class="job-list">'+(queued.length?queued.map((job,index)=>queueRow(job,index,queued.length)).join(''):'<p class="queue-section-empty">等待队列为空，可以继续提交其他角色或项目任务。</p>')+'</div>';
  if(showHistory)content+='<div class="queue-section-heading"><h2>任务历史</h2><span>成功部分保留，未完成部分可补齐</span></div><div class="job-list">'+(filteredHistory.length?filteredHistory.map(job=>queueRow(job)).join(''):'<p class="queue-section-empty">当前筛选没有历史任务。</p>')+'</div>';
  return pageHeading('多个项目可以持续排队','任务队列','按真实阶段查看结果，依赖素材尚未完成的任务会等待。',button('回到项目','go-project','','soft')+button('刷新进度','refresh'))+schedulerPanel()+'<div class="stats-row">'+[[counts.waiting,'等待中'],[counts.running,'正在制作'],[counts.done,'已完成'],[counts.failed,'未完成']].map(item=>'<div class="card stat-card"><strong>'+item[0]+'</strong><span>'+item[1]+'</span></div>').join('')+'</div><div style="margin-bottom:17px">'+tabs+'</div>'+content;
}
function renderSettings() {
  const runtime = state.runtime || {}; const settings = state.settings || {}; const ready = runtimeReady();
  const bundled = settings.runtimeMode === 'bundled';
  const codex = bundled ? '本工作台自带，独立运行' : '连接本机 Codex 程序，程序位置可在高级设置中调整';
  const python = runtime.pythonPath || runtime.python?.path || settings.pythonPath ? bundled ? '本工作台自带图片与文档处理工具' : '已配置本机图片处理工具，程序位置在高级设置中' : '';
  const loginStatus = runtime.loggedIn ?? runtime.authenticated ?? runtime.codex?.authenticated;
  const codexAvailable = runtime.codexAvailable ?? runtime.codex?.available ?? (ready || loginStatus === true);
  const pythonAvailable = runtime.pythonAvailable ?? runtime.python?.available;
  const pathDraft = ui.runtimeDraft || settings;
  return pageHeading('本地保存 · 账号连接', '连接设置', '本地网页负责整理与预览，已登录的 Codex 负责分析和生成。', button('重新检查连接', 'check-runtime', '', 'soft')) + schedulerPanel() + (window.resourceStudio?.panel()||'') + `<div class="settings-layout"><div class="card connection-card"><div class="connection-summary"><div class="connection-orb ${ready ? 'connected' : ''}">${ready ? '✓' : '◷'}</div><div><h2>${ready ? 'Codex 已准备就绪' : '检查本地连接'}</h2><p class="subtext">${ready ? '可以从项目中开始制作。' : '先确认本机的 Codex 已登录，再重新检查。'}</p></div></div><div class="connection-checks"><div class="connection-check"><div>本地工作台<small>项目、队列和图片由本机保存</small></div><span>${ui.connected ? '已连接' : '未连接'}</span></div><div class="connection-check"><div>Codex 程序<small>${escape(codex || '自动查找本机安装')}</small></div><span>${codexAvailable ? '已找到' : '待检查'}</span></div><div class="connection-check"><div>账号登录<small>沿用本机 Codex 的现有登录</small></div><span>${loginStatus === true || ready ? '已登录' : loginStatus === false ? '未登录' : '待检查'}</span></div><div class="connection-check"><div>图片拼接<small>${escape(python || '自动查找本机图片处理工具')}</small></div><span>${pythonAvailable === true ? '已找到' : python ? '已配置' : '待检查'}</span></div></div>${runtime.error || runtime.message ? `<div class="notice" style="margin-top:20px">${escape(runtime.error || runtime.message)}</div>` : ''}<details class="advanced-settings"><summary>高级设置 · 程序位置</summary><form id="runtime-form"><div class="form-field"><label for="codex-path">Codex 程序路径<small>留空保持现有设置</small></label><input id="codex-path" name="codexPath" value="${escape(pathDraft.codexPath || '')}" placeholder="本机 Codex 程序的完整路径"></div><div class="form-field"><label for="python-path">图片处理程序路径<small>留空保持现有设置</small></label><input id="python-path" name="pythonPath" value="${escape(pathDraft.pythonPath || '')}" placeholder="本机 Python 程序的完整路径"></div><p class="form-help" style="margin-bottom:16px">这里无需填写 API Key。程序路径用于连接本机已有工具。</p><button class="button primary" type="submit">保存并检查</button></form></details></div><div class="card settings-info"><p class="eyebrow">为后续创作衔接资料</p><h2>为整体工作流预留衔接</h2><p>项目保存剧本、话数范围、画风和角色资料。开头指定画风时直接执行；选择自动推荐时由剧本分析给出建议，再由你选择。</p><div class="integrations"><div class="integration"><span>角色制作与群像素材库</span><span class="tag green">已接入</span></div><div class="integration"><span>独立画风分析模块</span><span class="tag gray">项目资料可对接</span></div><div class="integration"><span>场景制作模块</span><span class="tag gray">后续接入</span></div></div><p>打包下载中包含项目资料，可导入回工作台继续制作，也可交给后续模块使用。</p><div class="actions">${button('导入项目资料', 'import-project', '', 'small soft')}</div><p style="font-size:9px;margin-top:20px">生成任务会使用现有账号能力与额度，实际可用性以本机 Codex 连接检查和任务结果为准。</p></div></div>`;
}

function modal(title, description, body, submitLabel, onSubmit) {
  dialog.classList.remove('preview-dialog');
  $('#modal-content').innerHTML = `<form id="modal-form" class="modal-form"><div class="modal-header"><div><h2>${escape(title)}</h2><p>${escape(description)}</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="关闭">×</button></div><div class="modal-body">${body}</div><div class="modal-footer"><button type="button" class="button" data-action="close-modal">取消</button><button class="button primary" type="submit">${escape(submitLabel)}</button></div></form>`;
  ui.modalSubmit = onSubmit;
  dialog.showModal();
  window.characterTour?.refresh();
}
function closeModal() { dialog.close(); ui.modalSubmit = null; ui.projectFormState = null; if (ui.pendingRender) { render(); ui.pendingRender = false; } window.characterTour?.refresh(); }
function styleFields(value = '国漫', auto = false) { return `<div class="style-options">${auto ? `<label class="style-option"><input type="radio" name="style-choice" value="auto" ${value === 'auto' ? 'checked' : ''}>自动推荐</label>` : ''}${styles.map(style => `<label class="style-option"><input type="radio" name="style-choice" value="${style}" ${value === style ? 'checked' : ''}>${style}</label>`).join('')}</div>`; }
function workflowFields(mode = 'manual', newProject = false) {
  return `<div class="form-field workflow-choice-field"><label>制作方式</label><div class="workflow-choice-grid"><label class="workflow-option"><input type="radio" name="workflow-choice" value="manual" ${mode !== 'auto' ? 'checked' : ''}><span><strong>人工选脸</strong><small>每人生成 3 张候选脸，由你选定后继续制作。</small></span></label><label class="workflow-option"><input type="radio" name="workflow-choice" value="auto" ${mode === 'auto' ? 'checked' : ''}><span><strong>全自动制作</strong><small>自动分析、选脸、换装、生成动作并拼接全项目。</small></span></label></div>${newProject ? `<div id="create-auto-start" class="create-auto-start" ${mode === 'auto' ? '' : 'hidden'}><label class="checkbox-label"><input type="checkbox" name="startAuto" ${mode === 'auto' ? '' : 'disabled'}>创建后直接开始全自动制作</label><p class="form-help">开启后，创建项目即进入任务队列，无需逐人确认。</p></div>` : '<p class="form-help">保存制作方式后，点击项目中的“一键全流程自动制作”开始。</p>'}</div>`;
}
function scriptUploadField() {
  return `<div class="form-field script-upload-field"><label>导入剧本与资料<small>多份文件可以一起上传</small></label><div class="script-dropzone" data-script-drop tabindex="0" role="button" aria-label="选择或拖入剧本文件，支持 EPUB 电子书等格式"><span class="script-upload-icon">${icon('upload')}</span><strong>拖入剧本文件，或点击选择</strong><span>电子书、文档、聊天导出与文件包，都从这里开始</span><div class="script-format-row"><span class="format-chip featured">EPUB 电子书</span><span class="format-chip">Word</span><span class="format-chip">PDF</span><span class="format-chip">ZIP 文件包</span></div><input id="script-files" type="file" accept="${supportedScriptFormats().map(format => `.${format}`).join(',')}" multiple data-file="scripts" aria-label="选择多个剧本文件"></div><details class="script-format-details"><summary>查看全部支持格式与导入说明 <span>单份 20 MB · 每批 60 MB</span></summary><div class="script-format-groups"><p><strong>电子书与文档</strong><span>EPUB、DOCX、DOC、PDF、ODT、HTML / HTM</span></p><p><strong>文字剧本</strong><span>TXT、Markdown（MD / Markdown）、RTF、Fountain、CSV / TSV</span></p><p><strong>聊天与文件包</strong><span>JSON（ChatGPT 导出对话或文本剧本）、ZIP</span></p><small>自动提取可读取的文字，原文件随项目保留。ZIP 中的资料按内容顺序整理；无法读取的文件会显示提示，不会当作成功导入的剧情。</small></div></details><div id="script-import-status" class="script-import-status" role="status" aria-live="polite"></div><div id="script-source-files" class="script-source-files"></div><div id="script-import-warnings"></div></div>`;
}
const appearancePeriods = { current_life:'当前时期', previous_life:'前世', unspecified:'时期未说明' };
const appearanceAges = { infant:'婴幼儿',child:'儿童',teen:'少年',young_adult:'青年',adult:'成年',middle_aged:'中年',elderly:'老年',unspecified:'年龄未说明' };
function appearanceProfileForm(profile) {
  const record = currentCharacterRecord(); if (!record) throw new Error('先选择一个角色。');
  const editing = !!profile?.id;
  const references = [...new Set([profile?.reference,...(profile?.references || [])])].filter(Boolean);
  const options = (values, selected) => Object.entries(values).map(([value,label])=>`<option value="${value}" ${value===selected?'selected':''}>${label}</option>`).join('');
  const body = `<div class="form-field"><label>时期名称</label><input name="name" value="${escape(profile?.name || '')}" placeholder="例如：当前20岁 / 童年 / 前世" required maxlength="100"></div><div class="form-row"><div class="form-field"><label>时期</label><select name="period">${options(appearancePeriods,profile?.period || 'unspecified')}</select></div><div class="form-field"><label>年龄阶段</label><select name="ageStage">${options(appearanceAges,profile?.ageStage || 'unspecified')}</select></div></div><div class="form-field"><label>年龄说明<small>原文没写就保留未知</small></label><input name="ageText" value="${escape(profile?.ageText || '')}" placeholder="例如：20岁 / 三四岁 / 原文未说明"></div><div class="form-field"><label>该时期外形与体型</label><textarea name="description" rows="4" placeholder="只写这个时期的脸、发型、年龄感和体型；未知项留待设计。">${escape(profile?.description || '')}</textarea></div><div class="form-field"><label>依据性质</label><select name="basis">${options({source:'原文明写',inference:'语境推定',production_design:'制作补设'},profile?.basis || 'production_design')}</select></div><div class="form-field"><label>原文依据或设计说明<small>可选，后续核对来源</small></label><textarea name="evidenceText" rows="3">${escape(evidenceText(profile?.evidence))}</textarea></div>${identitySourceFields(profile?.identitySource || 'design')}${referenceField(references)}<p class="form-help">这个时期单独保存脸图、身体底稿和服装进度。上传该时期自己的参考；不会自动套用成年或其他时期的定稿图。</p>`;
  modal(editing?'编辑人物时期':'新增人物时期',record.name,body,editing?'保存时期':'新增并选脸',async form=>{
    const values=Object.fromEntries(new FormData(form)), uploaded=await uploadSelectedFiles(form);
    const evidence = values.evidenceText.trim()===evidenceText(profile?.evidence).trim() ? profile?.evidence || [] : values.evidenceText.trim() ? [{quote:values.evidenceText.trim(),paragraphId:'',claimType:'literal'}] : [];
    const payload={name:values.name.trim(),period:values.period,ageStage:values.ageStage,ageText:values.ageText.trim(),description:values.description.trim(),basis:values.basis,evidence,identitySource:values.identitySource,...(uploaded.length?{reference:uploaded[0],references:uploaded}:{} )};
    if(payload.identitySource!=='design'&&!uploaded.length&&!references.length)throw new Error('沿用定稿身份需要这个时期自己的参考图片。');
    const endpoint=`${characterEndpoint(record.id)}/appearance-profiles${editing?'/'+encodeURIComponent(profile.id):''}`;
    const result=await api(endpoint,editing?'PATCH':'POST',payload);
    ui.profileSelections[profileKey(record.id)]=result.profile?.id||result.appearanceProfile?.id||result.id||profile?.id||'';
    ui.outfitId=''; ui.projectStage='face'; closeModal(); await refresh(true); toast(editing?'该时期资料已保存。':'该时期已建立，下一步确认这个时期的脸。');
  });
}
function mergeConflictText(value) {
  if (!value || typeof value !== 'object') return String(value || '');
  if (value.message) return String(value.message);
  const chapter = value.chapter ? `第${value.chapter}章：` : '';
  return { field_variant:'角色或资产资料有不同版本，保留当前项目定义，并记录另一版待核对。', ambiguous_character_identity:`${value.name || '同名角色'}的身份未确认相同，将保留独立身份。`, chapter_source_version:chapter+'原文来源版本不同，保留当前来源并记录另一版。', analysis_variant:chapter+'拆解有不同版本，保留当前分析并记录另一版待核对。', reference_slot_variant:'同一参考位置有不同图片，保留当前参考并记录另一版。' }[value.kind] || evidenceText(value) || '有一项资料冲突需要核对，合并记录会保留。';
}
function mergeSummary(result) {
  const summary = result.summary;
  if (typeof summary === 'string') return escape(summary);
  if (Array.isArray(summary)) return summary.map(value => `<p>${escape(evidenceText(value))}</p>`).join('');
  if (summary && typeof summary === 'object') {
    const labels = { charactersBefore:'合并前角色数',charactersAfter:'合并后角色数',readChapters:'已读取章节',readScopes:'保留读取范围',mappedIds:'已对应的资产与引用编号数',retainedOriginalFiles:'原文件保留',retainedImages:'图片保留',conflicts:'待核对差异数',sourceProjectArchived:'原项目归档',sourceFiles:'原文件',characters:'角色',outfits:'服装',chapters:'章节',images:'图片',sourceFileCount:'原文件数',characterCount:'角色数',outfitCount:'服装数',chapterCount:'章节数',imageCount:'图片数',sameBook:'同书判定',mergedCharacters:'合并角色',newCharacters:'新增角色',mergedOutfits:'合并服装',newOutfits:'新增服装',preservedImages:'保留图片' };
    return Object.entries(summary).filter(([key])=>labels[key]).map(([key,value]) => `<p><strong>${escape(labels[key])}</strong>：${escape(key === 'readScopes' && Array.isArray(value) ? value.map(range=>`第${range[0]}—${range[1]}章`).join('、') : key === 'readChapters' && Array.isArray(value) ? episodesLabel(value).replace('话','章') : typeof value === 'boolean' ? value ? '是' : '否' : typeof value === 'object' ? JSON.stringify(value) : value)}</p>`).join('') || '所选项目已核对，请查看下方说明与差异。';
  }
  return '预览已完成，请核对下面的说明。';
}
async function updateMergePreview(project) {
  const sourceId = $('#merge-source')?.value;
  const previewBox = $('#merge-preview');
  const submit = $('#modal-form [type="submit"]');
  if (!sourceId || !previewBox) return;
  ui.mergePreview = null; if (submit) submit.disabled = true;
  previewBox.innerHTML = '<p class="form-help">正在核对两个项目的资料与编号…</p>';
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/merge`,'POST',{sourceProjectId:sourceId,dryRun:true,explicitMerge:true});
    if ($('#merge-source')?.value !== sourceId || !previewBox.isConnected) return;
    ui.mergePreview = { ...result, selectedSourceId:sourceId, selectedProjectId:project.id };
    const warnings = [...(result.warnings || []), ...(result.conflicts || [])];
    previewBox.innerHTML = `<div class="merge-preview-summary"><h3>${result.canMerge ? '合并预览' : '当前项目无法合并'}</h3>${mergeSummary(result)}${warnings.length ? `<div class="script-warnings">${warnings.map(warning=>`<p>${escape(mergeConflictText(warning))}</p>`).join('')}</div>` : ''}</div>`;
    if (submit) submit.disabled = result.canMerge !== true;
  } catch(error) { if (previewBox.isConnected) previewBox.textContent = error.message; }
}
function mergeProjectForm() {
  const project = currentProject();
  const others = state.projects.filter(item => item.id !== project?.id);
  if (!project || !others.length) throw new Error('需要至少两个项目才可以合并。');
  modal('合并项目',`把另一个项目的资料合到“${project.name}”。先核对预览，再决定合并。`,`<div class="form-field"><label>合并到</label><input value="${escape(project.name)}" readonly></div><div class="form-field"><label for="merge-source">选择要合入的项目</label><select id="merge-source" name="sourceProjectId" data-change="merge-source">${others.map(item=>`<option value="${escape(item.id)}">${escape(item.name)} · ${item.characters?.length || 0} 个角色</option>`).join('')}</select></div><div class="notice">以服务端预览为准，不按同名自动认定为同一角色。合并后原项目退出项目列表，并保留审计与可恢复记录；已有图片、剧本原件保留。</div><div id="merge-preview" aria-live="polite"></div>`,'确认合并',async form=>{
    const sourceId = new FormData(form).get('sourceProjectId');
    if (!ui.mergePreview?.canMerge || ui.mergePreview.selectedSourceId !== sourceId || ui.mergePreview.selectedProjectId !== project.id) throw new Error('请先完成当前所选项目的合并预览。');
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/merge`,'POST',{sourceProjectId:sourceId,dryRun:false,explicitMerge:true});
    chooseProject(result.projectId || project.id); closeModal(); await refresh(true); toast('项目已合并，原项目记录可在回收站查看。');
  });
  updateMergePreview(project);
}
function deleteProjectForm() {
  const project = currentProject(); if (!project) return;
  const running = state.jobs.filter(job=>job.projectId===project.id&&job.status==='running');
  modal('删除项目',`“${project.name}”将移入回收站。`,`<div class="delete-project-summary"><h3>${escape(project.name)}</h3><p>${project.characters?.length || 0} 个角色 · ${project.sourceFiles?.length || 0} 份原文件</p></div><div class="notice">项目会从当前列表移走，图片和剧本原文件保留，可以从回收站恢复。尚未执行的队列任务会取消，任务历史保留。</div>${running.length ? '<div class="script-warnings"><p>这个项目仍有任务正在制作，请先在任务队列取消并等待停止，再删除项目。</p></div>'+button('查看任务队列','show-queue','','small soft') : ''}`,'移入回收站',async()=>{
    await api(`/api/projects/${encodeURIComponent(project.id)}`,'DELETE');
    closeModal(); chooseProject(''); await refresh(true); toast('项目已移入回收站，图片和原件保留。');
  });
  $('#modal-form [type="submit"]').disabled = running.length > 0;
}
function recycleProjectForm() {
  const entries = state.recycleBin || [];
  modal('项目回收站','项目删除与合并记录保留，已有图片和原文件不会在这里被清理。',entries.length ? `<div class="recycle-list">${entries.map(item=>`<article><div><h3>${escape(item.name || '未命名项目')}</h3><p>${escape(dateLabel(item.deletedAt))} · ${escape(item.reason || '移入回收站')}</p></div>${button(item.restorable === false ? '不可直接恢复' : '恢复项目','restore-project',`data-id="${escape(item.id)}"`,'small soft',item.restorable === false)}</article>`).join('')}</div>` : '<div class="requirements-empty"><h3>回收站为空</h3><p>删除或合并后的项目记录会显示在这里。</p></div>','关闭',async()=>closeModal());
}
function projectForm(project) {
  const newProject = !project; const choice = project?.styleMode === 'manual' ? project.style || '国漫' : 'auto';
  const model = { sourceFiles: (project?.sourceFiles || []).map(file => ({ ...file })), warnings: [...(project?.importWarnings || [])], importing: false, pendingFiles: [], inferredName: '', autoNameOwned: newProject, script: project?.script || '', chapters: [...(project?.chapters || [])], availableChapters: [...(project?.availableChapters || [])], readRange: [...(project?.readRange || [])], rangeVerified: project?.rangeVerified === true, needsReread: !!project?.sourceFiles?.length && (!project?.chapters?.length || !project?.readRange?.length), readingRange: null };
  ui.projectFormState = model;
  const body = `<div class="script-range-field"><div class="form-row"><div class="form-field"><label for="range-start">从第几章 / 话开始</label><input id="range-start" type="number" name="rangeStart" min="1" max="99999" value="${project?.rangeStart || 1}" required></div><div class="form-field"><label for="range-end">读取到第几章 / 话</label><input id="range-end" type="number" name="rangeEnd" min="1" max="99999" value="${project?.rangeEnd || 20}" required></div></div><p class="form-help">先选范围，再上传。整本 EPUB 按章提取当前范围，原文件保留；读取和拆解不会自动生成图片。</p><div id="script-range-status" aria-live="polite"></div></div>${scriptUploadField()}<div class="form-field"><label for="project-name">项目名称<small>根据上传文件自动填写，可以修改</small></label><input id="project-name" name="name" required maxlength="120" value="${escape(project?.name || '')}" placeholder="上传后自动填写，也可以自己命名"></div><details class="script-text-details" ${project?.script && !project?.sourceFiles?.length ? 'open' : ''}><summary>查看提取内容 / 手动补充 <span id="script-text-count"></span></summary><div class="form-field"><label for="project-script">当前范围正文<small>可选：直接粘贴或修正提取结果</small></label><textarea id="project-script" name="script" rows="7" placeholder="没有文件时，也可以粘贴所选章节正文；只做参考图角色时可留空。">${escape(project?.script || '')}</textarea></div></details><div class="form-field"><label>画风选择 <small>指定画风后跳过推荐</small></label>${styleFields(choice, true)}${project?.recommendedStyle && project?.styleMode !== 'manual' ? `<p class="form-help">剧本分析推荐：${escape(project.recommendedStyle)}。你可以改选任何画风。</p>` : ''}</div><p class="form-help">主角与配角使用相同流程，群像从素材库组合。</p>`;
  modal(newProject ? '新建角色项目' : '剧本与画风', newProject ? '先确定读取范围，上传后核对实际读到的章节。默认保存项目，由你决定何时开始制作。' : '保留原文件和已有图片；修改范围后重新提取对应正文，不混入其他章节。', body + templatePanel('modal') + workflowFields(project?.workflowMode || 'manual', newProject) + `<div class="create-auto-start"><label class="checkbox-label"><input type="checkbox" name="autoArchiveClothing" ${project?.autoArchiveClothing !== false ? 'checked' : ''}>制作后自动存入服装库</label><p class="form-help">为新版服装另外生成一张无人纯服装图，便于其他角色复用，会生成额外图片。</p></div>`, newProject ? '创建项目' : '保存项目', async form => {
    if (model.importing) throw new Error('资料还在读取，请稍等完成后再保存。');
    const values = Object.fromEntries(new FormData(form));
    const rangeStart = Number(values.rangeStart), rangeEnd = Number(values.rangeEnd);
    chosenScriptRange();
    model.script = values.script;
    if (model.sourceFiles.length && (model.needsReread || !sameReadRange(model, { rangeStart, rangeEnd }))) await rereadScriptSources(model);
    if (ui.projectFormState !== model) return;
    const manual = values['style-choice'] !== 'auto';
    const payload = { name: values.name.trim(), script: model.script, sourceFiles: model.sourceFiles, chapters: model.chapters, availableChapters: model.availableChapters, readRange: model.readRange, rangeVerified: model.rangeVerified, importWarnings: model.warnings, rangeStart, rangeEnd, styleMode: manual ? 'manual' : 'auto', style: manual ? values['style-choice'] : project?.style || '国漫', workflowMode: values['workflow-choice'] === 'auto' ? 'auto' : 'manual', autoArchiveClothing: values.autoArchiveClothing === 'on' };
    if (newProject && payload.workflowMode === 'auto' && values.startAuto === 'on' && !payload.script.trim()) throw new Error('先导入剧本或填写剧情，再勾选直接开始全自动制作。');
    if (project && payload.styleMode === project.styleMode && payload.style === project.style) { delete payload.styleMode; delete payload.style; }
    const result = await api(project ? `/api/projects/${encodeURIComponent(project.id)}` : '/api/projects', project ? 'PATCH' : 'POST', payload);
    if (newProject) {chooseProject(result.id || result.project?.id || result.projectId || '');ui.page='project';}
    closeModal(); await refresh(true);
    if (newProject && payload.workflowMode === 'auto' && values.startAuto === 'on') {
      try { await enqueue('project_auto'); } catch (error) { toast(`项目已创建，全自动制作暂未启动：${error.message}`, true); }
    } else toast(newProject ? '项目已保存。下一步只拆解当前章节，核对素材清单。' : '项目资料已保存，已有图片继续保留。');
  });
  updateScriptImportView(model);
}
function fileSizeLabel(size) { const bytes = Number(size) || 0; return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : bytes >= 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${bytes} B`; }
function updateScriptImportView(model) {
  if (ui.projectFormState !== model || !$('#script-import-status')) return;
  $('#script-import-status').innerHTML = model.importing ? `<span class="inline-spinner"></span>${model.pendingFiles.length ? `正在读取 ${model.pendingFiles.length} 份文件` : '正在从已存原件重新读取'}${model.readingRange ? ` · 第 ${model.readingRange.rangeStart}—${model.readingRange.rangeEnd} 章 / 话` : ''}…` : model.sourceFiles.length ? `<span class="import-check">✓</span>已保存 ${model.sourceFiles.length} 份源文件 · 当前正文 ${model.script.trim().length.toLocaleString('zh-CN')} 字` : '原文件和当前范围正文一起保存，方便以后继续制作。';
  $('#script-source-files').innerHTML = model.sourceFiles.map(file => `<a class="source-file-chip" ${fileUrl(file.url) ? `href="${escape(fileUrl(file.url))}" download` : ''} title="${escape(file.name)} · ${escape(fileSizeLabel(file.size))}${file.textLength ? ` · ${file.textLength} 字` : ''}"><span class="source-format">${escape((file.format || file.name?.split('.').pop() || 'FILE').toUpperCase())}</span><span class="source-name">${escape(file.name || '源文件')}</span><span class="source-size">${escape(fileSizeLabel(file.size))}</span></a>`).join('');
  $('#script-import-warnings').innerHTML = model.warnings.length ? `<div class="script-warnings">${model.warnings.map(warning => `<p>${escape(typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning))}</p>`).join('')}</div>` : '';
  const count = $('#script-text-count'); if (count) count.textContent = model.script.trim().length ? `${model.script.trim().length.toLocaleString('zh-CN')} 字` : '可选';
  const submit = $('#modal-form [type="submit"]'); if (submit) submit.disabled = model.importing;
  const input = $('#script-files'); if (input) input.disabled = model.importing;
  const textarea = $('#project-script'); if (textarea) textarea.disabled = model.importing;
  for (const id of ['range-start', 'range-end']) { const field = $(`#${id}`); if (field) field.disabled = model.importing; }
  const scope = $('#script-range-status');
  if (scope) {
    const range = { rangeStart: Number($('#range-start')?.value), rangeEnd: Number($('#range-end')?.value) };
    const stale = model.needsReread || !sameReadRange(model, range);
    scope.innerHTML = model.importing ? '' : model.sourceFiles.length && stale ? `<div class="script-scope-status pending"><strong>将读取第 ${escape(range.rangeStart)}—${escape(range.rangeEnd)} 章 / 话</strong><p>当前正文尚未按这个范围更新。点击重读，或保存时自动重读原文件。</p>${button('重读这个范围', 'reread-script-sources', '', 'small soft')}</div>` : model.manualEdited ? `<div class="script-scope-status pending"><strong>正文已手动修改，章节与出处需要重新核对</strong><p>保存会保留手动修改。按原件重读会用所选范围的原文替换当前正文。</p>${model.sourceFiles.length ? button('按原件重读', 'reread-script-sources', '', 'small soft') : ''}</div>` : model.chapters.length ? `<div class="script-scope-status ${model.rangeVerified ? 'verified' : 'pending'}"><strong>${model.rangeVerified ? '范围已核对' : '章节范围待核对'} · 实际读取 ${model.chapters.length} 章</strong><p>${escape(model.chapters.map(chapter => chapter.title || `第 ${chapter.chapter} 章`).join('；'))}</p>${!model.rangeVerified ? '<small>未能确认章节标题，下面的提示需核对。不会把未知范围显示为已完成。</small>' : ''}</div>` : '';
  }
  $('[data-script-drop]')?.classList.toggle('is-importing', model.importing);
}
function chosenScriptRange() {
  const rangeStart = Number($('#range-start')?.value), rangeEnd = Number($('#range-end')?.value);
  if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 1 || rangeEnd < rangeStart || rangeEnd > 99999) throw new Error('请填写有效的起止章节，结束不能早于开始。');
  return { rangeStart, rangeEnd };
}
function sameReadRange(model, range) { return model.readRange?.length === 2 && Number(model.readRange[0]) === range.rangeStart && Number(model.readRange[1]) === range.rangeEnd; }
function applyScriptRead(model, result, range) {
  const idMap = new Map((result.sourceFiles || []).map(file => [file.id, model.sourceFiles.find(existing => existing.sha256 && existing.sha256 === file.sha256)?.id || file.id]));
  mergeSourceFiles(model.sourceFiles, result.sourceFiles || []);
  model.script = typeof result.script === 'string' ? result.script : '';
  model.chapters = (result.chapters || []).map(chapter => ({ ...chapter, sourceId: idMap.get(chapter.sourceId) || chapter.sourceId }));
  model.availableChapters = result.availableChapters || [];
  model.readRange = Array.isArray(result.readRange) ? result.readRange : [range.rangeStart, range.rangeEnd];
  model.rangeVerified = result.rangeVerified === true;
  model.warnings = Array.isArray(result.warnings) ? result.warnings : [];
  model.needsReread = false;
  model.manualEdited = false;
  const textarea = $('#project-script'); if (textarea) textarea.value = model.script;
}
async function rereadScriptSources(model = ui.projectFormState) {
  if (!model || model.importing || !model.sourceFiles.length) return;
  const range = chosenScriptRange();
  model.importing = true; model.readingRange = range; model.pendingFiles = []; updateScriptImportView(model);
  try {
    const result = await api('/api/scripts/read-saved', 'POST', { sourceFiles: model.sourceFiles, ...range });
    if (ui.projectFormState === model) { applyScriptRead(model, result, range); toast(`当前正文已更新：实际读取 ${model.chapters.length} 章。`); }
  } catch (error) { model.needsReread = true; model.warnings.push(`重读未完成：${error.message}`); throw error; }
  finally { model.importing = false; model.readingRange = null; if (ui.projectFormState === model) updateScriptImportView(model); }
}
async function readFileData(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error(`“${file.name}”读取失败。`)); reader.readAsDataURL(file); }); }
async function fileHash(file) { const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join(''); }
function sourceFormat(file) { return String(file.format || file.name?.split('.').pop() || '').replace(/^\./, '').toLowerCase(); }
function readableSourceHashes(sources) { return new Set(sources.filter(file => Number(file.textLength) > 0 && file.sha256).map(file => file.sha256)); }
function sourceWasRead(file, sources, successfulHashes, visited = new Set()) {
  if (Number(file.textLength) > 0 || successfulHashes.has(file.sha256)) return true;
  if (sourceFormat(file) !== 'zip' || visited.has(file.id)) return false;
  const next = new Set(visited); next.add(file.id);
  const members = sources.filter(member => member.archive === file.id && supportedScriptFormats().includes(sourceFormat(member)));
  return members.length > 0 && members.every(member => sourceWasRead(member, sources, successfulHashes, next));
}
function mergeSourceFiles(current, incoming) {
  const idMap = new Map();
  for (const file of incoming) { const existing = current.find(item => item.id === file.id || item.sha256 && item.sha256 === file.sha256); if (existing) idMap.set(file.id, existing.id); }
  for (const file of incoming) {
    const existing = current.find(item => item.id === file.id || item.sha256 && item.sha256 === file.sha256);
    if (existing) {
      if (Number(file.textLength) > Number(existing.textLength) || file.readRange || file.rangeVerified !== undefined) { const { id, url, archive } = existing; Object.assign(existing, file, { id, url }); if (archive) existing.archive = archive; else delete existing.archive; }
    } else current.push({ ...file, ...(file.archive ? { archive: idMap.get(file.archive) || file.archive } : {}) });
  }
}
async function importScriptFiles(fileList) {
  const model = ui.projectFormState;
  if (!model || model.importing) return;
  const files = [...fileList]; if (!files.length) return;
  const invalid = files.find(file => !supportedScriptFormats().includes(file.name.split('.').pop().toLowerCase()));
  if (invalid) throw new Error(`“${invalid.name}”格式暂不支持。请上传 EPUB、Word、PDF、文字剧本或 ZIP，完整格式可在上传区下方查看。`);
  if (files.some(file => file.size > 20 * 1024 * 1024)) throw new Error('每份资料请控制在 20 MB 以内。');
  if (files.reduce((sum, file) => sum + file.size, 0) > 60 * 1024 * 1024) throw new Error('一次导入的资料总大小请控制在 60 MB 以内，可以分批添加。');
  const range = chosenScriptRange(); const hadSources = model.sourceFiles.length > 0;
  model.script = $('#project-script').value; model.pendingFiles = files; model.importing = true; model.readingRange = range; updateScriptImportView(model);
  try {
    const successfulHashes = sameReadRange(model, range) && !model.needsReread ? readableSourceHashes(model.sourceFiles) : new Set();
    const alreadyRead = sameReadRange(model, range) && !model.needsReread ? model.sourceFiles.filter(file => sourceWasRead(file, model.sourceFiles, successfulHashes)) : [];
    const hashes = new Set(alreadyRead.map(file => file.sha256).filter(Boolean));
    const legacy = new Set(alreadyRead.filter(file => !file.sha256).map(file => `${file.name}:${file.size}`));
    const payload = []; let skipped = 0;
    for (const file of files) {
      const hash = await fileHash(file);
      if (hashes.has(hash) || legacy.has(`${file.name}:${file.size}`)) { skipped++; continue; }
      hashes.add(hash); payload.push({ filename: file.name, data: await readFileData(file) });
    }
    if (!payload.length) { toast('这些文件已经在当前读取范围内导入，正文不会重复添加。'); return; }
    let result = await api('/api/scripts/import', 'POST', { files: payload, knownHashes: [...successfulHashes], ...range });
    if (ui.projectFormState !== model) return;
    mergeSourceFiles(model.sourceFiles, result.sourceFiles || []);
    if (hadSources) result = await api('/api/scripts/read-saved', 'POST', { sourceFiles: model.sourceFiles, ...range });
    if (ui.projectFormState !== model) return;
    applyScriptRead(model, result, range);
    const script = model.script;
    const nameInput = $('#project-name');
    if (result.name && (nameInput.value.trim() === '' || model.autoNameOwned && nameInput.value === model.inferredName)) {
      const proposed = model.inferredName || String(result.name).slice(0, 120); nameInput.value = proposed; model.inferredName = proposed; model.autoNameOwned = true;
    }
    toast(`当前范围已读取 ${model.chapters.length} 章${skipped ? `，跳过 ${skipped} 份重复文件` : ''}。${script ? '可展开核对正文。' : '请查看读取提示。'}`);
  } catch (error) { if (ui.projectFormState === model) model.warnings.push(`这次读取未完成：${error.message}`); throw error; }
  finally { model.importing = false; model.pendingFiles = []; model.readingRange = null; if (ui.projectFormState === model) { const input = $('#script-files'); if (input) input.value = ''; updateScriptImportView(model); } }
}
function referenceField(references = [], multiple = true) { return `<div class="form-field"><label>参考图片 <small>可选${multiple ? '，支持多张' : ''}</small></label>${references.length ? `<div class="reference-grid">${references.map(url => `<img class="reference-preview" src="${escape(fileUrl(url))}" alt="已有参考图">`).join('')}</div>` : ''}<label class="upload-label">＋ 选择图片<input type="file" name="reference-file" accept="image/*" ${multiple ? 'multiple' : ''} data-file="reference"></label><p class="file-input-name" id="reference-filenames">新图片会作为本次参考；不选择则保留现有图片。</p></div>`; }
function characterForm(character) {
  const refs = [...new Set([character?.reference, ...(character?.references || [])])].filter(Boolean);
  const body = `<div class="form-row"><div class="form-field"><label for="character-name">角色名称</label><input id="character-name" name="name" value="${escape(character?.name || '')}" required maxlength="100" placeholder="例如：宋玄"></div><div class="form-field"><label for="character-category">角色分类</label><select id="character-category" name="category">${['主角', '配角', '群像'].map(category => `<option ${category === (character?.category || '主角') ? 'selected' : ''}>${category}</option>`).join('')}</select></div></div><div class="form-field"><label for="character-description">角色描述</label><textarea id="character-description" name="description" rows="5" placeholder="外貌、年龄、发型、肤色、体型、性格，以及需要固定的特征…">${escape(character?.description || '')}</textarea></div><div class="form-field"><label for="character-episodes">出场话数</label><input id="character-episodes" name="episodes" value="${escape(Array.isArray(character?.episodes) ? character.episodes.join('、') : character?.episodes || '')}" placeholder="例如：1-8,12"></div>${referenceField(refs)}`;
  modal(character ? '编辑角色资料' : '添加角色', '设计参考生成候选；已定脸或全身图直接沿用身份。', body + identitySourceFields(character?.identitySource || 'design') + (!character ? '<div id="character-auto-start" class="create-auto-start" hidden><label class="checkbox-label"><input type="checkbox" name="saveAuto" disabled>保存后全自动制作</label><p class="form-help">沿用上传定稿的身份，直接整理已有定稿身份。</p></div>' : ''), character ? '保存角色' : '添加角色', async form => {
    const values = Object.fromEntries(new FormData(form)); const refsUploaded = await uploadSelectedFiles(form);
    const payload = { name: values.name.trim(), category: values.category, description: values.description, episodes: values.episodes, identitySource: values.identitySource || 'design', ...(refsUploaded.length ? { reference: refsUploaded[0], references: refsUploaded } : {}) };
    if (payload.identitySource !== 'design' && !refsUploaded.length && !character?.reference) throw new Error('已定脸图或全身图需要上传对应的图片。');
    const result = await api(character ? characterEndpoint(character.id) : `/api/projects/${encodeURIComponent(ui.projectId)}/characters`, character ? 'PATCH' : 'POST', payload);
    if (!character) { ui.characterId = result.id || result.character?.id || result.characterId || ''; ui.category = '全部'; ui.outfitId = ''; }
    closeModal(); await refresh(true); if (!character && values.saveAuto === 'on') { try { await enqueue('project_auto'); } catch (error) { toast(`角色已保存，全自动暂未启动：${error.message}`, true); } } else toast('角色资料已保存。');
  });
  syncIdentitySourceControls();
}
function identitySourceFields(value = 'design', finalizedOnly = false) { return `<div class="form-field"><label>图片用途</label><select name="identitySource" data-change="identity-source">${[['design','设计参考 · 生成3张候选'],['face','已定脸图 · 直接沿用身份'],['fullbody','已定全身图 · 沿用身份与服装']].filter(([key]) => !finalizedOnly || key !== 'design').map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('')}</select><p class="form-help">已定脸或全身图可直接自动制作，姓名可不填，默认为“上传角色”，以后可以改名；描述留空时会读图提取外观。已有剧本建议填写对应角色姓名。群像同样优先沿用上传身份。</p></div>`; }
function syncIdentitySourceControls() { const source = $('[name="identitySource"]', dialog)?.value; if (!source) return; const field = $('#character-name'); if (field) field.required = source === 'design'; const controls = $('#character-auto-start'); if (controls) { const finalized = source !== 'design'; controls.hidden = !finalized; $('[name="saveAuto"]', controls).disabled = !finalized; if (!finalized) $('[name="saveAuto"]', controls).checked = false; } }
function imageAutoForm() {
  const selectable = state.projects.filter(project => !state.jobs.some(job => job.projectId === project.id && ['queued','running'].includes(job.status)));
  const body = `<div class="form-field"><label>保存到项目</label><select name="projectId" data-change="image-project"><option value="new" selected>新建独立图片项目</option>${selectable.map(project => `<option value="${escape(project.id)}">${escape(project.name)}</option>`).join('')}</select></div><div id="image-new-project"><div class="form-field"><label>新项目名称<small>可留空，上传后自动填写</small></label><input id="image-project-name" name="projectName" placeholder="根据图片文件命名"></div><div class="form-field"><label>画风</label>${styleFields(currentProject()?.style || '国漫')}</div></div>${referenceField([], false)}${identitySourceFields('face', true)}<div class="form-row"><div class="form-field"><label>角色姓名<small>可选</small></label><input name="name" placeholder="留空默认为“上传角色”"></div><div class="form-field"><label>角色分类</label><select name="category"><option>主角</option><option>配角</option><option>群像</option></select></div></div><div class="form-field"><label>角色描述<small>可选</small></label><textarea name="description" placeholder="可补充年龄、体型或要保留的细节"></textarea></div><p class="form-help">默认保存到独立图片项目。手动选择小说项目时，才会把这个图片角色加入该小说。无需剧本，可自动完成身体、服装、动作与合并卡。新项目默认自动生成纯服装归档图，会额外生成图片，可在项目设置中关闭。</p>`;
  modal('从图片全自动制作', '你的角色已经定稿，直接沿用长相开始制作。', body, '保存并全自动制作', async form => {
    const values = Object.fromEntries(new FormData(form)); const files = [...($('[name="reference-file"]', form)?.files || [])]; const uploaded = await uploadSelectedFiles(form); if (!uploaded.length) throw new Error('请选择一张已定脸图或全身图。');
    let projectId = values.projectId;
    if (projectId === 'new') { const result = await api('/api/projects', 'POST', { name: values.projectName.trim() || files[0].name.replace(/\.[^.]+$/, '') || '图片角色项目', script:'', styleMode:'manual', style:values['style-choice'] || '国漫', workflowMode:'auto', autoArchiveClothing:true, rangeStart:1, rangeEnd:20 }); projectId = result.id || result.project?.id; }
    const character = await api(`/api/projects/${encodeURIComponent(projectId)}/characters`, 'POST', { name: values.name.trim(), description: values.description, category:values.category, identitySource:values.identitySource, reference:uploaded[0], references:uploaded });
    chooseProject(projectId); ui.characterId = character.id || character.character?.id || ''; ui.page='project'; closeModal(); await refresh(true); try { await enqueue('project_auto'); } catch (error) { toast(`图片角色已保存，全自动暂未启动：${error.message}`, true); }
  });
  const selection = $('[name="projectId"]', dialog); $('#image-new-project').hidden = selection.value !== 'new';
}
function outfitForm(outfit) {
  const body = `<div class="form-field"><label for="outfit-name">服装版本名称</label><input id="outfit-name" name="name" value="${escape(outfit?.name || '')}" placeholder="例如：黑衣常服 / 第 9 话白衣" required maxlength="100"></div><div class="form-field"><label for="outfit-description">服装与配饰描述</label><textarea id="outfit-description" name="description" rows="5" placeholder="上衣、下装、鞋子、配色、材质，以及袖口、护腕、手套和饰品…">${escape(outfit?.description || '')}</textarea></div><div class="form-field"><label for="outfit-episodes">这套衣服对应的话数</label><input id="outfit-episodes" name="episodes" value="${escape(Array.isArray(outfit?.episodes) ? outfit.episodes.join('、') : outfit?.episodes || '')}" placeholder="例如：1-8"></div>${referenceField(outfit?.reference ? [outfit.reference] : [], false)}<p class="form-help">手部动作会同步使用这套服装的袖口、护腕、手套、饰品和材质颜色。</p>`;
  modal(outfit ? '编辑服装版本' : '新增服装版本', '同一人物可有多套服装，每套单独保存角色卡和动作卡。', body, outfit ? '保存服装' : '添加服装', async form => {
    const values = Object.fromEntries(new FormData(form)); const uploaded = await uploadSelectedFiles(form);
    const payload = { name: values.name.trim(), description: values.description, episodes: values.episodes, ...appearancePayload(), ...(uploaded.length ? { reference: uploaded[0] } : {}) };
    const result = await api(outfit ? outfitEndpoint() : `${characterEndpoint()}/outfits`, outfit ? 'PATCH' : 'POST', payload);
    if (!outfit) ui.outfitId = result.id || result.outfit?.id || result.outfitId || '';
    closeModal(); await refresh(true); toast('服装版本已保存。');
  });
}
const uploadWaiters=[];let activeUploads=0;
async function uploadFile(file){if(activeUploads>=2)await new Promise(resolve=>uploadWaiters.push(resolve));else activeUploads++;try{return await readAndUploadFile(file);}finally{if(uploadWaiters.length)uploadWaiters.shift()();else activeUploads--;}}
async function readAndUploadFile(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('请选择图片文件。');
  if (file.size > 20 * 1024 * 1024) throw new Error('单张参考图请控制在 20 MB 以内。');
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败。')); reader.readAsDataURL(file); });
  const result = await api('/api/upload', 'POST', { filename: file.name, data });
  if (!fileUrl(result.url)) throw new Error('图片上传后没有返回可用路径。');
  return result.url;
}
async function uploadSelectedFiles(form) { const files = [...($('[name="reference-file"]', form)?.files || [])]; if (files.length > 12) throw new Error('每个角色最多上传 12 张参考图。'); return Promise.all(files.map(uploadFile)); }
function readGestures() { return Array.from({ length: 8 }, (_, index) => $(`[name="gesture-${index}"]`)?.value.trim() || ''); }
async function saveGestures(silent = false) { await api(outfitEndpoint(), 'PATCH', { gestures: readGestures().filter(Boolean), ...appearancePayload() }); if (ui.drafts[draftKey()]) delete ui.drafts[draftKey()].gestures; if (!silent) { await refresh(true); toast('动作已保存。'); } }
async function enqueue(kind, overrides = {}) {
  const character = currentCharacter(); const outfit = currentOutfit();
  if (['base', 'outfit', 'pipeline'].includes(kind) && !character?.faceApproved && !overrides.characterId) throw new Error('请先确认角色脸图。');
  
  const key = ['face_refine','hairstyle_preview','crowd_set'].includes(kind) ? kind+':'+JSON.stringify([overrides.projectId || '',overrides.characterId || '',overrides.appearanceProfileId || '',overrides.libraryId || '',overrides.sourceKind || '',overrides.sourceUrl || '',overrides.candidateId || '',overrides.refineOptions || [],overrides.maskUrl || '',overrides.crowdSetId || '',overrides.parts || [],overrides.name || '']) : jobKey(kind, overrides.characterId || ui.characterId, overrides.outfitId || ui.outfitId, overrides.projectId || ui.projectId);
  if (ui.inFlight.has(key) || (!Object.keys(overrides).length && busy(kind))) return;
  ui.inFlight.add(key);
  try {
    if (['gestures', 'hands', 'hands_auto', 'pipeline'].includes(kind) && outfit && !overrides.characterId && $$('.gesture-field input').length) {
      if (kind === 'hands' && readGestures().filter(Boolean).length !== 8) throw new Error('请先填写完整的 8 个动作，或点击“从剧本提取”补足。');
      await saveGestures(true);
    }
    const payload = { kind, clientRequestId: crypto.randomUUID(), ...(['face','head_prepare','base','outfit','gestures','hands','hands_auto','special','combine','pipeline','clothing_extract'].includes(kind) ? appearancePayload() : {}), ...(kind.startsWith('library') || kind === 'clothing_collect' ? {} : { projectId: ui.projectId }), ...(['face', 'head_prepare', 'base', 'outfit', 'gestures', 'hands', 'hands_auto', 'special', 'combine', 'pipeline', 'clothing_extract'].includes(kind) ? { characterId: ui.characterId } : {}), ...(['outfit', 'gestures', 'hands', 'hands_auto', 'special', 'combine', 'pipeline', 'clothing_extract'].includes(kind) ? { outfitId: ui.outfitId } : {}), ...overrides };
    if (kind === 'special') {
      const instructions = $('#special-instructions')?.value.trim() || overrides.instructions;
      if (!instructions) throw new Error('先填写这一话的特殊动作，再单独补图。');
      await api(outfitEndpoint(), 'PATCH', { specialInstructions: instructions }); payload.instructions = instructions;
      if (ui.drafts[draftKey()]) delete ui.drafts[draftKey()].specialInstructions;
    }
    if(kind==='hands_auto'&&!outfit?.card){const dependency=handCardDependency();if(!dependency)throw new Error('先生成或导入对应服装卡；也可先把服装卡排入队列，再安排手部。');payload.dependsOn=[dependency.id];}
    const submitted=await api('/api/jobs', 'POST', payload); ui.lastSubmission=submitted.job || submitted;
    toast(`${kinds[kind] || '制作'}已加入任务队列。`);
  } finally { ui.inFlight.delete(key); await refresh(true); }
}

const assetStyles=[...styles,'真人','3D','漫画原画','混合原样','未知原样'];
const referenceSourceStyles={unknown:'自动识别',comic:'漫画',photo:'照片', '3d':'3D',mixed:'混合来源'};
function batchReferenceImportForm() {
  const body='<div class="form-field"><label>参考图片 <small>每张分别入队，可一次多选</small></label><label class="upload-label">＋ 选择多张图片<input type="file" name="reference-file" accept="image/*" multiple data-file="reference"></label><p id="reference-filenames" class="file-input-name">支持漫画、照片和3D参考，先选来源类型，再选择输出画风。</p></div><div class="form-row"><div class="form-field"><label>来源类型</label><select name="sourceStyle">'+selectOptions(referenceSourceStyles,'unknown')+'</select></div><div class="form-field"><label>输出漫画画风</label><select name="outputStyle">'+selectOptions({source:'保留参考原风格',...Object.fromEntries(styles.map(style=>[style,style]))},currentProject()?.style || '国漫')+'</select></div></div><div class="form-field"><label>从每张图提取什么</label><div class="extract-part-options"><label class="checkbox-label"><input type="checkbox" name="parts" value="face_core" checked>纯五官脸 · 无头发</label><label class="checkbox-label"><input type="checkbox" name="parts" value="hairstyle" checked>发型与发饰</label><label class="checkbox-label"><input type="checkbox" name="parts" value="clothing">纯服装与配饰</label></div></div>'+headLibraryFacetFields()+'<div class="form-field"><label>图中要提取的对象 <small>多人物图请明确同一个对象</small></label><input name="sourceSubjectKey" placeholder="例如：左侧黑发男子 / 中间人物"><p class="form-help">同一次任务的五官、发型和衣服对应同一个指定对象；没有指定时由后台选择主要对象，不能保证一次覆盖图中所有人物。</p></div><div class="form-field"><label>制作说明 <small>可选</small></label><textarea name="instructions" placeholder="例如：保留五官骨相，统一为国漫画风；去掉背景与人物身体。"></textarea></div><div class="notice">每张参考单独提交素材任务，按所勾选部位拆入对应库。已有正确素材可复用；某部位失败会保留成功部分。来源类型与输出画风分开标记，不将照片原图冒充漫画成品。</div>';
  modal('批量导入参考并拆入素材库','一次入口处理网上收集的参考图；只上传后拆素材，不直接覆盖项目人物。',body,'上传并安排素材提取',async form=>{
    const values=Object.fromEntries(new FormData(form)),parts=new FormData(form).getAll('parts');
    if(!parts.length)throw new Error('至少选择一种提取素材。');
    const files=[...($('[name="reference-file"]',form)?.files || [])];if(!files.length)throw new Error('先选择至少一张参考图片。');
    let queued=0;
    for(const file of files){const reference=await uploadFile(file);const status=$('#reference-filenames',form);if(status)status.textContent='已上传 '+(queued+1)+' / '+files.length+' 张参考，正在分别安排素材提取。';await enqueue('extract_assets',{projectId:'',reference,parts,sourceStyle:values.sourceStyle,outputStyle:values.outputStyle,sourceSubjectKey:values.sourceSubjectKey.trim(),subjectScope:values.sourceSubjectKey.trim() || 'primary_subject',era:values.era,gender:values.gender,ageStage:values.ageStage,instructions:values.instructions.trim()});queued++;}
    closeModal();ui.page='queue';render();toast(queued+' 张参考已分别安排提取，可查看各部位的真实进度。');
  });
}
function candidateDifference(candidate) {
  if(typeof candidate.boneBrief==='string')return candidate.boneBrief;
  if(candidate.boneBrief&&typeof candidate.boneBrief==='object'){const labels={faceShape:'脸型',boneStructure:'骨相',eyes:'眼型',nose:'鼻型',jaw:'下颌',brows:'眉型',mouth:'唇形'};return Object.entries(candidate.boneBrief).map(([key,value])=>(labels[key] || key)+'：'+evidenceText(value)).join(' · ');}
  return candidate.description || '';
}

const guideContent = {"title":"角色工房新手指引","steps":[{"id":"input","title":"1. 上传剧本或参考图片","text":"剧本可上传EPUB、Word、PDF、TXT或ZIP等文件，先选读取章节范围，再拆出角色与服装。也可批量上传网上收集的漫画、照片、3D参考，选择来源类型与输出漫画画风，再勾选五官、发型或服装提取。","stage":"script","action":"去导入资料"},{"id":"face","title":"2. 为角色选脸","text":"新身份提供3张五官与骨相明显不同、画风一致的完整头部候选。选中后确认；同脸时期沿用五官，按本时期发型整理单张头部，幼年按年龄调整。","stage":"face","action":"去选脸"},{"id":"archive","title":"3. 确认后自动拆入两库","text":"确认完整脸图后，后台安排纯五官脸与发型入库。五官素材为无头发的干净五官脸或光头头部，不含颈部、肩膀、身体；发型素材保存一张通用白模头部正、90°侧、背三视，完整露出头发与发饰。旧定稿脸可点击“一键拆入五官与发型库”，已有正确素材会复用。","stage":"face","action":"查看脸与入库状态"},{"id":"body","title":"4. 确定身体并换装","text":"先有当前时期已确认的脸，再制作身体底稿；随后按服装版本生成角色卡。各视图保留完整头部与全部头发。纯服装库仅保存衣服、鞋和穿戴配饰及必要细节，不含人物或假人。","stage":"body","action":"去身体定稿"},{"id":"hands","title":"5. 安排并生成8格手部","text":"选择对应服装版本。服装卡已存在，或已把服装卡任务排入队列后，可点击“安排并生成8格手部”。可填写动作，空缺由剧情补齐；袖口、护腕、手套与当前衣服保持一致。“只整理动作文字”不会生成手部图片。","stage":"outfit","action":"去服装与手部"},{"id":"export","title":"6. 拼接与导出","text":"角色卡与手部卡都完成后，点击上下拼接；成品为两张16:9卡等宽组合。也可导出整个项目ZIP，保留素材、图片、剧本原件与编号。","stage":"output","action":"去查看成品"}],"tips":[{"title":"整图预览","text":"主页面可展开/收起大图。点击图片打开预览，默认适应屏幕、完整显示。用鼠标滚轮或＋/−放大缩小，拖动或用滚动条平移查看细节；“适应屏幕/重置”回到完整图，“原始大小”按图片像素显示。"},{"title":"真实进度与并行","text":"任务队列显示实际完成步骤、当前阶段与已用时间；制作中且总步骤未知时显示动画，不猜百分比。最多同时执行8个独立任务，提交不同任务即可并行；有素材依赖或同一输出冲突时显示等待原因。一个任务的8格动作不是8个并发任务。"},{"title":"来源与制作画风","text":"原文描写、未知项、美术补设及用户改编分别登记。参考图的漫画/照片/3D来源类型与输出画风分别保存；可选“保留参考原风格”，原照片或3D素材不冒标为漫画。"},{"title":"费用与提交","text":"指引只打开页面或表单，查看、预览、选择筛选不会自动生成。点击任务或表单中的提交制作后，才会使用已连接账号的生成能力。"}]};


guideContent.tips.push({title:'脸部微调与明确采用',text:'在完整头像、每张候选脸或五官库素材上点击“微调五官”，选择部位、方向与轻微、适中、明显三档力度。可选涂选重点区域作为AI引导，不能保证区域外逐像素不变。提交只生成草稿，完成后并排比较，再点击确认采用；原文件保留。不同微调草稿与其他独立任务可同时提交。'});
guideContent.tips.push({title:'发型库只看白模三视',text:'发型库仅展示通用纯白头部的正、90°侧、背三视，不代表角色五官。新素材只生成这一版；旧素材缺白模图时可点击补齐，旧文件与已有引用保留。'});
guideContent.tips.push({title:'主配角分步批量',text:'身体定稿、服装与手部、查看成品页面均有批量入口。按人物、时期、服装筛选，查看每项前置与等待原因，选择可制作项后一次提交独立任务。最多8个任务同时进行；已完成默认跳过，重做仍须满足前置确认。群像使用独立5人套组，不进入这些主配批量。'});
guideContent.tips.push({title:'群像整组流程',text:'选择群像目录进入专用制作区，一组5人备选保存全身、完整5头与服装。完整头部包括五官和全部头发，不拆纯五官/发型，不逐个定脸。群像库默认看整头，可切全身或服装。服装默认按剧情分析，只有主动选择时指定统一、混合或分别穿着；没写制服时标制作补设。5只是素材数，不推定剧情人数或5人同框。部分失败保留成功图，只补缺失部分。'});
guideContent.tips.push({title:'收藏、删除与素材组装',text:'素材库按五官、发型、身体、服装和群像分类。卡片点☆收藏后到我的收藏快速找；删除会进回收站，可恢复，项目图片保留。在素材组装中选脸、发型、服装和可选身体，保存到项目生成新角色、手部及合成卡。'});
guideContent.tips.push({title:'首页快捷工具与外部角色卡转换',text:'打开工具先进入首页。外部角色卡转换不需要项目，可多选图片，保留角色外观转为统一四栏格式；可只出角色卡，或配8格手部并上下合成。图片上下拼接在本地完成。快捷结果独立保存，可预览下载、导出ZIP；失败可保留完成部分续做。项目在首页下方进入。'});
function guideNudge() { return localStorage.getItem('character-studio-guide-seen') ? '' : '<div class="guide-nudge"><div><strong>第一次使用角色工房？</strong><span>从首页工具开始，或上传剧本进入项目；跟着实际界面一步步操作。</span></div>'+button('打开新手指引','open-guide','','small soft')+button('知道了','dismiss-guide','','small')+'</div>'; }
function renderGuide() {
  const character=currentCharacter(),outfit=currentOutfit(),project=currentProject(),archive=character?headArchiveState(character):{};
  const states={input:!!(project?.script || project?.characters?.length),face:!!character?.faceApproved,archive:!!archive.ready,body:!!(character?.base&&!headAssetsReviewPending(character)),hands:!!outfit?.hands,export:!!outfit?.combined};
  const prerequisites={input:'先准备剧本文件或参考图片',face:project?'已建立项目；选择要制作的人物时期':'先导入资料并建立项目',archive:character?.faceApproved?'完整脸已确认，可查看自动拆分队列':'需要一张已确认的完整脸图',body:character?.faceApproved?'完整脸已确认，可制作当前时期身体':'先确认当前时期的完整脸图',hands:outfit?.card?'已有对应服装卡，可安排并生成手部':handCardDependency()?'服装卡任务已排队，手部将等待其完成':'先生成或导入对应服装卡',export:outfit?.card&&outfit?.hands?'角色卡与手部卡已齐，可等宽拼接':'需要角色卡与对应手部卡都完成'};
  return pageHeading('随时可以回来查看','新手指引','按当前项目的真实素材状态提示下一步。这里的按钮只打开页面或表单。',button('开始逐步教程','open-guide','','primary')+button('下载使用说明','download-guide','','soft')+button('回到项目','go-project'))+'<div class="guide-input-actions">'+button('上传剧本建立项目','create-project','','small primary')+button('批量导入网上参考','batch-reference-import','','small soft')+'</div><div class="guide-step-grid">'+guideContent.steps.map(step=>'<section class="card guide-step"><div class="guide-step-heading"><h2>'+escape(step.title)+'</h2><span class="tag '+(states[step.id]?'green':'gray')+'">'+(states[step.id]?'当前素材已有':'下一步可继续')+'</span></div><p>'+escape(step.text)+'</p><p class="guide-prerequisite">'+escape(prerequisites[step.id])+'</p>'+button(step.action,'guide-step','data-stage="'+step.stage+'"','small soft')+'</section>').join('')+'</div><div class="guide-tip-grid">'+guideContent.tips.map(tip=>'<section class="card guide-tip"><h3>'+escape(tip.title)+'</h3><p>'+escape(tip.text)+'</p></section>').join('')+'</div>';
}
function downloadGuide() {
  const text=[guideContent.title,...guideContent.steps.flatMap(step=>['',step.title,step.text]),...guideContent.tips.flatMap(tip=>['',tip.title,tip.text])].join('\r\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download='角色工房使用说明.txt';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}



const crowdParts={full_group:{label:'5人全身',field:'fullGroupImage'},heads:{label:'完整5头',field:'headSheet'},clothing:{label:'服装素材',field:'clothingSheet'}};
const crowdPolicies={uniform:'统一服装（可收录一套）',mixed:'部分统一、部分不同',varied:'按演员分别穿不同服装'};
ui.crowdViews={};ui.crowdFilters={style:'',era:'',policy:'',query:''};
function crowdMissingParts(item){
  if(!item)return Object.keys(crowdParts);
  const stored=(Array.isArray(item.missingParts)?item.missingParts:[]).filter(part=>crowdParts[part]);for(const part of Object.keys(crowdParts))if(item.parts?.[part]?.status==='failed')stored.push(part);
  return [...new Set([...stored,...Object.entries(crowdParts).filter(([part,info])=>!fileUrl(item[info.field])).map(([part])=>part)])];
}
function crowdDisplay(item){const selected=ui.crowdViews[item.id] || 'heads';const part=fileUrl(item[crowdParts[selected]?.field])?selected:Object.keys(crowdParts).find(part=>fileUrl(item[crowdParts[part].field])) || 'heads';return {part,url:fileUrl(item[crowdParts[part].field])};}
function crowdItemFor(character){return state.library.find(item=>item.kind==='crowd_set'&&item.id===character?.crowdSetId) || (character?.crowdAssets?.headSheet || character?.crowdAssets?.fullGroupImage ? {...character.crowdAssets,id:character.crowdSetId || character.id,name:character.name,kind:'crowd_set'} : null);}
function crowdJobActive(item,character){return state.jobs.some(job=>job.kind==='crowd_set'&&['queued','running'].includes(job.status)&&(item?.id?job.crowdSetId===item.id:job.projectId===ui.projectId&&job.characterId===character?.id));}
function crowdPolicyLabel(item){return item?.costumePolicyRequested===false && item?.parts?.plan?.status!=='completed' && item?.reviewStatus!=='approved_manual' ? '按剧情分析（方案待定）' : crowdPolicies[item?.costumePolicy] || '服装方案未说明';}
function crowdSourcePanel(item){
  const evidence=evidenceText(item?.sourceEvidence);
  return '<details class="crowd-source-details"><summary>剧情依据与制作设计</summary><p><strong>服装方案：</strong>'+escape(crowdPolicyLabel(item))+' · '+escape(headBases[item?.costumePolicyBasis || item?.basis] || '未说明依据')+'</p><p><strong>原文群像/服装：</strong>'+escape(item?.sourceDescription || '未明确描写；不把制作方案当原文')+'</p><p><strong>原文证据：</strong>'+escape(evidence || '暂无已登记证据')+'</p><p><strong>制作补设：</strong>'+escape(item?.designDescription || item?.description || '尚未补充')+' · '+escape(headBases[item?.designBasis] || '制作补设')+'</p><p>原文人数：'+escape(item?.sourceFacts?.memberCount && item.sourceFacts.memberCount!=='unknown'?item.sourceFacts.memberCount:'未知')+'；原文同框：'+escape(item?.sourceFacts?.sameFrame && item.sourceFacts.sameFrame!=='unknown'?item.sourceFacts.sameFrame:'未知')+'。5人是备选素材数，不表示剧情已确定人数或5人同时入镜。</p></details>';
}
function crowdSetMedia(item,character=null){
  const missing=crowdMissingParts(item),display=crowdDisplay(item),active=crowdJobActive(item,character),failures=Array.isArray(item.partialFailures)?item.partialFailures.map(row=>typeof row==='string'?row:row.reason || row.error || row.part):Object.entries(item.partialFailures || {}).map(([part,reason])=>(crowdParts[part]?.label || part)+'：'+reason);
  const controls='<div class="crowd-view-tabs">'+Object.entries(crowdParts).map(([part,info])=>button(info.label,'crowd-view','data-id="'+escape(item.id)+'" data-part="'+part+'"','small '+(part===display.part?'soft':''),!fileUrl(item[info.field]))).join('')+'</div>';
  const downloads=Object.entries(crowdParts).filter(([part,info])=>fileUrl(item[info.field])).map(([part,info])=>'<a class="button small" href="'+escape(fileUrl(item[info.field]))+'" download>下载'+info.label+'</a>').join('');
  return controls+imageView(display.url,item.name+' · '+crowdParts[display.part].label,'尚未完成该份群像素材')+'<p class="crowd-completion-note">'+(missing.length?'部分完成，待补：'+missing.map(part=>crowdParts[part].label).join('、'):'全身、整头与服装三份素材已齐')+' · '+(item.reviewStatus==='approved_manual'?'人工示范已确认':item.qualityValidated===true?'图像核验通过':'素材待核验')+'</p>'+(failures.length?'<div class="notice">'+escape(failures.join('；'))+'</div>':'')+(Array.isArray(item.members)&&item.members.length?'<details class="crowd-member-index"><summary>查看同组备选与素材对应</summary><div class="crowd-member-table">'+item.members.map((member,index)=>{const mapping=item.memberIndex?.find(row=>row.memberKey===member.memberKey);return '<div><strong>'+escape(member.name || '备选'+(index+1))+'</strong><span>'+escape(member.memberKey || '')+'</span><small>整头 '+escape(mapping?.head?'第'+mapping.head.row+'行 / 第'+mapping.head.col+'列':'对应待登记')+' · 服装 '+escape(member.costumeGroupId || '组别待登记')+(mapping?.clothing?'（第'+mapping.clothing.row+'行 / 第'+mapping.clothing.col+'列）':'')+'</small></div>';}).join('')+'</div></details>':'')+'<div class="actions">'+downloads+(missing.length?button(active?'套组任务已在队列':'只补齐缺失素材','crowd-retry','data-id="'+escape(item.id)+'"','small soft',active):'')+'</div>'+crowdSourcePanel(item);
}
function renderCrowdCharacter(character){
  const item=crowdItemFor(character);
  return '<section class="card crowd-character-panel"><div class="card-header"><div><p class="eyebrow">群像专用流程</p><h2>'+escape(character.name)+' · 5人备选套组</h2><p class="subtext">一套保留全身、脸与发型完整整头、服装。无需逐个选脸，不拆入纯五官或发型库。</p></div>'+button('编辑群像资料','edit-character','','small')+'</div><div class="card-body"><p class="notice">服装按剧情选择统一、混合或分别穿着，不强制5套不同衣服。原文未写制服时，统一服装属于制作补设。</p><p class="subtext" style="margin:12px 0">'+escape(character.description || character.scriptDescription || '先补充这组群像的剧情范围与制作目标。')+'</p><div class="actions">'+button(item?'制作另一套备选':'制作5人套组','crowd-create','data-character-id="'+escape(character.id)+'"','small primary')+button('导入已有五人图/套组','crowd-import','data-character-id="'+escape(character.id)+'"','small')+button('从群像库选用','open-crowd-library','data-character-id="'+escape(character.id)+'"','small soft')+'</div>'+(item?crowdSetMedia(item,character):'<div class="empty-state"><h3>这组还没有关联套组</h3><p>先制作或导入5人全身图，再提取同组完整5头与剧情对应服装。</p></div>')+'</div></section>';
}
function renderCrowdLibrary(){
  const f=ui.crowdFilters,items=state.library.filter(item=>item.kind==='crowd_set'&&(!f.style||item.style===f.style)&&(!f.era||item.era===f.era)&&(!f.policy||item.costumePolicy===f.policy)&&(!f.query||[item.name,item.description,item.sourceDescription,item.designDescription].join(' ').toLowerCase().includes(f.query.toLowerCase())));
  const target=ui.crowdTarget,project=state.projects.find(item=>item.id===target?.projectId),character=project?.characters?.find(item=>item.id===target?.characterId);
  const banner=character?'<div class="batch-strip"><div><strong>为 '+escape(character.name)+' 选用群像套组</strong><small>关联整组素材，保留原组演员与原文件。</small></div>'+button('返回群像项目','return-crowd-target','','small')+'</div>':'';
  const toolbar='<div class="head-library-filters"><select data-crowd-filter="style" aria-label="群像画风"><option value="">全部画风</option>'+selectOptions(Object.fromEntries(styles.map(style=>[style,style])),f.style)+'</select><select data-crowd-filter="era" aria-label="群像时代"><option value="">全部时代</option>'+selectOptions(headEras,f.era)+'</select><select data-crowd-filter="policy" aria-label="群像服装方案"><option value="">全部服装方案</option>'+selectOptions(crowdPolicies,f.policy)+'</select><input id="crowd-library-search" value="'+escape(f.query)+'" placeholder="搜索群像名称或制作描述" aria-label="搜索群像素材">'+button('搜索','crowd-search','','small')+'</div>';
  const grid=items.length?'<div class="crowd-library-grid">'+items.map(item=>'<article class="card crowd-library-item" data-crowd-set-id="'+escape(item.id)+'"><div class="card-header"><div><h2>'+escape(item.name)+'</h2><p class="subtext">'+escape([item.style || '未标记画风',headEras[item.era] || '时代未说明',crowdPolicyLabel(item)].join(' · '))+'</p></div>'+button('选用此组','crowd-adopt','data-id="'+escape(item.id)+'"','small soft')+'</div><div class="card-body">'+crowdSetMedia(item)+materialCardActions(item)+'</div></article>').join('')+'</div>':'<div class="card empty-state"><h2>建立可重复使用的群像套组库</h2><p>每组5人备选，默认查看完整5头；同组全身和服装始终关联保存。</p>'+button('制作第一组','crowd-create','','primary')+'</div>';
  return pageHeading('群像整组保存','群像素材库','5人只是备选数量。统一服装可只收录1套，剧情人数和同框数量仍按原文。',button('＋ 制作5人套组','crowd-create','','primary')+button('导入已有套组','crowd-import'))+banner+toolbar+grid;
}
function formatCrowdEvidence(value){return (Array.isArray(value)?value:[]).map(row=>typeof row==='object'&&row?String(row.chapter ?? '')+' | '+String(row.paragraphId || '')+' | '+String(row.quote || ''):String(row || '')).filter(Boolean).join('\n');}
function parseCrowdEvidence(value){
  const lines=String(value || '').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  return lines.map((line,index)=>{const match=line.match(/^(\d+)\s*[|｜]\s*([^|｜]+?)\s*[|｜]\s*(.+)$/);if(!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1])<1 || !/^C\d+-P\d+$/.test(match[2].trim()) || !match[3].trim())throw new Error('第'+(index+1)+'条原文证据格式不完整，请按“章号 | 段落ID | 原句”填写，例如 1 | C01-P033 | 原文短句。');return {chapter:Number(match[1]),paragraphId:match[2].trim(),quote:match[3].trim()};});
}
async function crowdSetForm(mode='generate',characterId=''){
  const character=(currentProject()?.characters || []).find(item=>item.id===characterId),existing=character?crowdItemFor(character):null;
  const fields='<div class="form-field"><label>套组名称</label><input name="name" required value="'+escape(character?.name || '')+'" placeholder="例如：古代街市百姓备选组"></div><div class="form-field"><label>群像范围与制作目标</label><textarea name="description" rows="3">'+escape(character?.description || '')+'</textarea></div>'+styleFields(currentProject()?.style || '国漫')+headLibraryFacetFields({era:existing?.era || 'ancient',gender:'通用'})+'<div class="form-row"><div class="form-field"><label>服装方案</label><select name="costumePolicy" data-change="crowd-policy" required>'+selectOptions(mode==='import'?{'':'请选择原图服装方案',...crowdPolicies}:{auto:'按剧情分析（默认）',...crowdPolicies},mode==='import'?'':'auto')+'</select></div><div class="form-field"><label>服装方案依据</label><select name="costumePolicyBasis" '+(mode==='generate'?'disabled':'')+'>'+selectOptions(headBases,existing?.costumePolicyBasis || 'production_design')+'</select></div></div><details class="crowd-source-details"><summary>原文/未知项与制作设计分别填写</summary><div class="form-field"><label>原文群像与衣服描写</label><textarea name="sourceDescription" placeholder="未描写就留空；职业身份不等于已明确制服">'+escape(existing?.sourceDescription || '')+'</textarea></div><div class="form-field"><label>原文证据（每行：章号 | 段落ID | 原句）</label><textarea name="sourceEvidence" placeholder="例如 1 | C01-P033 | 原文短句；没有依据就留空">'+escape(formatCrowdEvidence(existing?.sourceEvidence))+'</textarea></div><div class="form-field"><label>制作设计建议</label><textarea name="designDescription" placeholder="原文未知的年龄、脸型、服色等补设">'+escape(existing?.designDescription || '')+'</textarea></div><div class="form-field"><label>制作设计性质</label><select name="designBasis">'+selectOptions({production_design:'制作补设',authorized_adaptation:'用户改编'},existing?.designBasis || 'production_design')+'</select></div></details>';
  const uploads=Object.entries(crowdParts).map(([part,info])=>'<div class="form-field"><label>'+info.label+(part==='full_group'?'（可上传已有5人全身参考）':'（已有时可直接导入）')+'</label><input type="file" name="crowd-'+part+'" accept="image/png,image/jpeg,image/webp"></div>').join('');
  modal(mode==='import'?'导入群像套组':'制作5人群像套组','脸与全部头发保存为完整头部；不进入主配角选脸/身体/手部流程。',fields+uploads+'<p class="notice">默认按剧情分析服装，原文未写就登记制作补设，不强制统一。你可主动选统一、混合或不同服装。已有五人全身参考仅补整头/服装；完整三图直接导入须明确原图服装方案，上传状态待核验。5不是剧情人数。</p>',mode==='import'?'保存群像素材':'提交独立套组任务',async form=>{
    const values=Object.fromEntries(new FormData(form)),data={name:values.name.trim(),description:values.description.trim(),style:values['style-choice'],era:values.era,gender:values.gender,ageStage:values.ageStage,costumePolicyRequested:values.costumePolicy!=='auto' && !!values.costumePolicy,...(values.costumePolicy!=='auto'&&values.costumePolicy?{costumePolicy:values.costumePolicy,costumePolicyBasis:values.costumePolicyBasis}:{}),sourceDescription:values.sourceDescription.trim(),sourceEvidence:parseCrowdEvidence(values.sourceEvidence),designDescription:values.designDescription.trim(),designBasis:values.designBasis};
    if(mode==='import'&&!data.costumePolicyRequested)throw new Error('导入套组须明确原图服装方案，避免错误成员对应。');
    if(!data.costumePolicyRequested&&Object.keys(crowdParts).every(part=>$('[name="crowd-'+part+'"]',form)?.files?.length))throw new Error('已有完整三图直接登记时，请明确原图服装方案；只上传全身参考则可按剧情分析。');
    if(data.costumePolicyBasis==='source'&&!data.sourceEvidence.length)throw new Error('原文依据须填写真实证据；原文没写制服时请选制作补设。');
    const images={};for(const [part,info] of Object.entries(crowdParts)){const file=$('[name="crowd-'+part+'"]',form)?.files?.[0];if(file)images[info.field]=await uploadFile(file);}
    const associated=character?{projectId:ui.projectId,characterId:character.id}:{projectId:''};
    if(mode==='import'){
      if(!Object.keys(images).length)throw new Error('至少上传已有五人全身、整头或服装图中的一份。');
      const created=await api('/api/library','POST',{kind:'crowd_set',...data,...images});const id=created.id || created.asset?.id || created.item?.id;
      if(character&&id)await api('/api/library/'+encodeURIComponent(id)+'/adopt-crowd','POST',associated);
      closeModal();ui.page=character?'project':'crowd';await refresh(true);toast('群像素材已登记，原文件保留；缺失部分可继续补齐，图像状态待核验。');
    }else{
      let crowdSetId='',refGroupImage=images.fullGroupImage || '';
      if(Object.keys(images).length){const created=await api('/api/library','POST',{kind:'crowd_set',...data,...images});crowdSetId=created.id || created.asset?.id || created.item?.id || '';if(character&&crowdSetId)await api('/api/library/'+encodeURIComponent(crowdSetId)+'/adopt-crowd','POST',associated);}
      const parts=Object.entries(crowdParts).filter(([part,info])=>!images[info.field]).map(([part])=>part);
      if(!parts.length){closeModal();await refresh(true);toast('三份图均已登记，无需重复生成；上传素材仍待核验。');return;}
      await enqueue('crowd_set',{...associated,...data,...(crowdSetId?{crowdSetId}:{}),...(refGroupImage?{refGroupImage}:{}),parts,count:5});closeModal();ui.page='queue';render();
    }
  });
}
async function retryCrowdSet(id){const item=state.library.find(row=>row.kind==='crowd_set'&&row.id===id) || crowdItemFor(currentCharacterRecord());if(!item)throw new Error('这条群像素材不存在，请刷新。');const missing=crowdMissingParts(item);if(!missing.length)throw new Error('三份素材已齐，无需补提。');await enqueue('crowd_set',{projectId:'',crowdSetId:item.id,parts:missing,...(fileUrl(item.fullGroupImage)?{refGroupImage:item.fullGroupImage}:{}),style:item.style,count:5});}
async function adoptCrowdSet(id){
  const projects=state.projects.filter(project=>project.characters?.some(character=>roleCategory(character)==='群像'));if(!projects.length)throw new Error('先在项目中添加或拆出一组群像。');
  const target=ui.crowdTarget || {projectId:ui.projectId,characterId:roleCategory(currentCharacterRecord() || {})==='群像'?ui.characterId:''},project=projects.find(item=>item.id===target.projectId) || projects[0];
  const opts=selected=>{const p=state.projects.find(item=>item.id===selected);return (p?.characters || []).filter(character=>roleCategory(character)==='群像').map(character=>'<option value="'+escape(character.id)+'" '+(character.id===target.characterId?'selected':'')+'>'+escape(character.name)+'</option>').join('');};
  modal('选用群像套组','只关联群像组，不改主配定脸或拆成五官/发型。','<div class="form-field"><label>项目</label><select name="projectId" data-change="crowd-adopt-project">'+projects.map(item=>'<option value="'+escape(item.id)+'" '+(item.id===project.id?'selected':'')+'>'+escape(item.name)+'</option>').join('')+'</select></div><div class="form-field"><label>群像组</label><select id="crowd-adopt-character" name="characterId">'+opts(project.id)+'</select></div>','关联这组素材',async form=>{const values=Object.fromEntries(new FormData(form));await api('/api/library/'+encodeURIComponent(id)+'/adopt-crowd','POST',values);closeModal();chooseProject(values.projectId);ui.characterId=values.characterId;ui.category='群像';ui.projectStage='outfit';ui.page='project';await refresh(true);toast('整组素材已关联，全身、整头与服装按同组使用。');});
}

const batchKinds={base:{title:'批量制作身体底稿',unit:'人物时期',stage:'body'},outfit:{title:'批量制作服装角色卡',unit:'服装版本',stage:'outfit'},hands_auto:{title:'批量安排并生成8格手部',unit:'服装版本',stage:'outfit'},combine:{title:'批量上下拼接',unit:'服装版本',stage:'output'}};
const batchStatuses={ready:'可以制作',waiting:'等待前置，可入队',completed:'已经完成',active:'已在队列',missing:'缺少前置',excluded:'本次不制作',error:'需要处理',enqueued:'已独立入队',duplicate:'已有同任务',skipped:'本次跳过'};
function roleCategory(character){return character.category || '配角';}
function roleRank(character){return {主角:0,配角:1,群像:2}[roleCategory(character)] ?? 3;}
function batchStageTools(project,stage){
  const kindList=stage==='body'?['base']:stage==='outfit'?['outfit','hands_auto']:stage==='output'?['combine']:[];
  if(!kindList.length)return '';
  const count=(project.characters || []).filter(character=>['主角','配角'].includes(roleCategory(character))).length;
  return '<section class="batch-strip production-batch-tools"><div><strong>主角与配角 · 分步批量制作</strong><small>选择人物、时期与服装，只提交前置已齐或已有前置任务的项目；每项独立入队，同时最多8个。</small><small>群像使用专用套组，本次不进入这些主配批量任务。</small></div><div class="actions">'+kindList.map(kind=>button(batchKinds[kind].title,'batch-stage','data-kind="'+kind+'"','small soft',!count)).join('')+'</div></section>';
}
function batchSourceItems(project,kind){
  return (project.characters || []).slice().sort((a,b)=>roleRank(a)-roleRank(b)).filter(character=>['主角','配角'].includes(roleCategory(character))).flatMap(character=>{
    const profiles=profilesFor(character),defaultId=character.defaultAppearanceProfileId || profiles[0]?.id || '';
    return profiles.flatMap(profile=>{
      const ids={characterId:character.id,appearanceProfileId:profile.id || ''};
      if(kind==='base')return [ids];
      return (character.outfits || []).filter(outfit=>profile.legacy || (outfit.appearanceProfileId || defaultId)===profile.id).map(outfit=>({...ids,outfitId:outfit.id}));
    });
  });
}
function batchTargetKey(target){return [target.characterId || '',target.appearanceProfileId || '',target.outfitId || ''].join(':');}
function batchTargetInfo(row){
  const editor=ui.batchEditor,target=row.target || row.payload || {},project=state.projects.find(item=>item.id===editor.projectId),character=project?.characters?.find(item=>item.id===target.characterId),profile=profilesFor(character).find(item=>item.id===(target.appearanceProfileId || '')) || profilesFor(character)[0],outfit=character?.outfits?.find(item=>item.id===target.outfitId);
  return {...target,characterName:target.characterName || character?.name || '未命名人物',profileName:target.profileName || profile?.name || '当前时期',outfitName:target.outfitName || outfit?.name || '',category:roleCategory(character || {})};
}
function batchRowsVisible(){
  const editor=ui.batchEditor;if(!editor)return [];
  return (editor.plan.items || []).filter(row=>{const target=batchTargetInfo(row),f=editor.filters;return (!f.category || target.category===f.category)&&(!f.characterId || target.characterId===f.characterId)&&(!f.appearanceProfileId || target.appearanceProfileId===f.appearanceProfileId)&&(!f.outfitId || target.outfitId===f.outfitId);});
}
function batchRowSelectable(row){const result=ui.batchEditor.results.get(row.key);return ['ready','waiting'].includes(row.status)&&!['enqueued','duplicate','skipped'].includes(result?.status);}
function paintBatchPlan(){
  const editor=ui.batchEditor,list=$('#batch-plan-list',dialog);if(!editor || !list)return;
  const rows=batchRowsVisible(),all=editor.plan.items || [],selected=all.filter(row=>editor.selected.has(row.key)&&batchRowSelectable(row));
  const counts={};for(const row of all)counts[row.status]=(counts[row.status] || 0)+1;
  $('#batch-plan-summary',dialog).textContent='共 '+all.length+' 项 · 可以制作 '+(counts.ready || 0)+' · 等待前置 '+(counts.waiting || 0)+' · 已有/在队列 '+((counts.completed || 0)+(counts.active || 0))+' · 缺前置 '+(counts.missing || 0);
  $('#batch-selection-summary',dialog).textContent='当前筛选 '+rows.length+' 项 · 已选 '+selected.length+' 项';
  list.innerHTML=rows.length?rows.map(row=>{
    const target=batchTargetInfo(row),result=editor.results.get(row.key),status=result?.status || row.status,reason=result?.reason || row.reason || '',selectable=batchRowSelectable(row),pending=row.dependsOn?.length?' · '+row.dependsOn.length+' 个前置任务':'';
    return '<label class="batch-target-row '+(!selectable?'not-ready':'')+'" data-batch-key="'+escape(row.key)+'"><input type="checkbox" name="batch-target" value="'+escape(row.key)+'" data-change="batch-target" '+(editor.selected.has(row.key)&&selectable?'checked':'')+' '+(!selectable?'disabled':'')+'><span class="batch-target-description"><strong>'+escape(target.characterName)+' <span>'+escape(target.category)+'</span></strong><small>'+escape(target.profileName)+(target.outfitName?' · '+escape(target.outfitName):'')+'</small><span class="batch-target-reason">'+escape(reason+pending)+'</span></span><span class="tag '+(['ready','enqueued'].includes(status)?'green':['missing','error'].includes(status)?'red':'gray')+'">'+escape(batchStatuses[status] || status)+'</span></label>';
  }).join(''):'<p class="mini-empty">当前筛选没有对应人物时期或服装版本。</p>';
  const submit=$('#modal-form [type="submit"]',dialog);submit.disabled=editor.planning || !selected.length;submit.textContent=editor.planning?'正在检查前置':selected.length?'提交 '+selected.length+' 个独立任务':'先选择可制作项';
}
async function reloadBatchPlan(){
  const editor=ui.batchEditor,revision=(editor.revision || 0)+1;editor.revision=revision;editor.planning=true;paintBatchPlan();
  try{
    const plan=await api('/api/jobs/batch/plan','POST',{projectId:editor.projectId,kind:editor.kind,items:editor.sourceItems,force:editor.force});
    if(ui.batchEditor!==editor || editor.revision!==revision)return;
    editor.plan=plan;editor.results=new Map();const available=new Set((editor.plan.items || []).filter(row=>batchRowSelectable(row)).map(row=>row.key));for(const key of editor.selected)if(!available.has(key))editor.selected.delete(key);
  }finally{if(ui.batchEditor===editor && editor.revision===revision){editor.planning=false;paintBatchPlan();}}
}
async function batchStageForm(kind){
  const project=currentProject(),settings=batchKinds[kind];if(!project || !settings)throw new Error('先选择项目与制作步骤。');
  const sourceItems=batchSourceItems(project,kind);if(!sourceItems.length)throw new Error(kind==='base'?'还没有主角或配角的人物时期。':'主角或配角还没有对应服装版本，请先添加服装。');
  ui.batchEditor={projectId:project.id,kind,sourceItems,force:false,plan:{items:[]},selected:new Set(),results:new Map(),clientIds:new Map(),filters:{category:'',characterId:'',appearanceProfileId:'',outfitId:''}};
  await reloadBatchPlan();const editor=ui.batchEditor,all=editor.plan.items || [],targets=all.map(batchTargetInfo);
  const unique=(key,label)=>[...new Map(targets.filter(target=>target[key]).map(target=>[target[key],target])).values()].map(target=>'<option value="'+escape(target[key])+'">'+escape(label(target))+'</option>').join('');
  const body='<div class="notice">这里只规划和选择，不会自动生成。身体须先定脸，服装须先定身体；手部与拼接可等待已经排队的前置素材。每项独立提交，缺少前置的项会说明原因。群像不进入本次主配批量。</div><div class="batch-target-filters"><select data-change="batch-filter" data-field="category" aria-label="筛选角色分类"><option value="">全部主角与配角</option><option>主角</option><option>配角</option></select><select data-change="batch-filter" data-field="characterId" aria-label="筛选人物"><option value="">全部人物</option>'+unique('characterId',target=>target.characterName)+'</select><select data-change="batch-filter" data-field="appearanceProfileId" aria-label="筛选时期"><option value="">全部时期</option>'+unique('appearanceProfileId',target=>target.characterName+' · '+target.profileName)+'</select>'+(kind!=='base'?'<select data-change="batch-filter" data-field="outfitId" aria-label="筛选服装"><option value="">全部服装</option>'+unique('outfitId',target=>target.characterName+' · '+target.profileName+' · '+target.outfitName)+'</select>':'')+'</div><label class="batch-force-label"><input type="checkbox" data-change="batch-force">包含已完成项，重新制作（仍需满足前置确认）</label><p class="subtext" id="batch-plan-summary"></p><div class="batch-selection-toolbar">'+button('全选当前可制作项','batch-select-ready','','small soft')+button('取消全部选择','batch-clear-selection','','small')+button('重新检查前置','batch-refresh-plan','','small')+'<span id="batch-selection-summary"></span></div><div class="batch-plan-list" id="batch-plan-list"></div><p class="form-help">等待中不占用制作名额；依赖就绪后按队列安排。一次手部任务生成8格图，与同时制作8个独立任务分别计算。已完成项默认跳过。</p>';
  modal(settings.title,'按 '+settings.unit+' 分别保存结果；最多8个独立任务同时执行。',body,'先选择可制作项',async()=>{
    const selected=(editor.plan.items || []).filter(row=>editor.selected.has(row.key)&&batchRowSelectable(row));
    if(!selected.length)throw new Error('至少选择一个可制作或有前置任务的项目。');
    const items=selected.map(row=>{const target=batchTargetInfo(row);if(!editor.clientIds.has(row.key))editor.clientIds.set(row.key,crypto.randomUUID());return{characterId:target.characterId,appearanceProfileId:target.appearanceProfileId || '',...(target.outfitId?{outfitId:target.outfitId}:{}),clientRequestId:editor.clientIds.get(row.key)};});
    const response=await api('/api/jobs/batch','POST',{projectId:editor.projectId,kind,items,force:editor.force}),results=response.items || [],counts={};
    for(const result of results){editor.results.set(result.key,result);counts[result.status]=(counts[result.status] || 0)+1;}
    const submitted=results.find(result=>result.job);if(submitted)ui.lastSubmission=submitted.job;
    const message='独立入队 '+(counts.enqueued || 0)+' 项，已有任务 '+(counts.duplicate || 0)+' 项，跳过 '+(counts.skipped || 0)+' 项，需要处理 '+(counts.error || 0)+' 项。';
    if(results.length!==selected.length || counts.error || counts.skipped){await refresh(true);paintBatchPlan();toast(message+'请查看各项原因，其他成功任务正常制作。',true);}
    else{closeModal();ui.batchEditor=null;ui.page='queue';await refresh(true);toast(message+'可继续提交其他人物或步骤。');}
  });
  paintBatchPlan();
}

function refineSourceContext(kind,id='') {
  if(kind==='face_core'){const item=state.library.find(entry=>entry.id===id);if(!item?.image)throw new Error('先选择一张五官库素材。');return {sourceKind:'face_core',sourceUrl:item.image,libraryId:item.id,name:item.name};}
  const character=currentCharacter();if(!character)throw new Error('先选择角色和人物时期。');
  const candidate=kind==='candidate'?character.faceCandidates?.find(entry=>entry.id===id):null;
  const sourceUrl=candidate?.image || (kind==='complete_head'?character.face:'');
  if(!sourceUrl)throw new Error('当前没有可以微调的图片。');
  return {projectId:ui.projectId,characterId:character.id,appearanceProfileId:character.appearanceProfileId,sourceKind:kind,sourceUrl,candidateId:candidate?.id || '',name:character.name+' · '+(candidate?.label || character.appearanceProfileName)};
}
function refinementDraftFor(context) {
  return state.jobs.slice().reverse().find(job=>job.kind==='face_refine'&&job.status==='completed'&&fileUrl(job.visualRefinement?.image)&&(
    context.libraryId ? job.libraryId===context.libraryId : job.projectId===context.projectId&&job.characterId===context.characterId&&job.appearanceProfileId===context.appearanceProfileId&&job.visualRefinement.sourceKind===context.sourceKind&&(context.sourceKind!=='candidate'||job.visualRefinement.candidateId===context.candidateId)));
}
function refinementButtons(context) {
  const draft=refinementDraftFor(context);
  return button('微调五官','face-refine','data-source-kind="'+escape(context.sourceKind)+'" data-source-id="'+escape(context.libraryId || context.candidateId || '')+'"','small')+(draft?button('比较微调预览','compare-refinement','data-job-id="'+escape(draft.id)+'"','small soft'):'');
}
async function faceRefinementForm(context) {
  const options=await api('/api/refinement-options');
  if(!Array.isArray(options.parts)||!options.parts.length)throw new Error('微调选项暂未准备好，请稍后重试。');
  ui.refineEditor={context,options,strokes:[],draftStroke:null,tool:'circle',brush:4,image:null,width:0,height:0,pointer:null};
  const rows=Array.from({length:Math.min(4,options.maximumOptions || 4)},(_,index)=>'<div class="refinement-option-row"><select name="refine-part-'+index+'" data-change="refine-part" data-index="'+index+'" aria-label="微调部位'+(index+1)+'"><option value="">不调整此项</option>'+options.parts.map(part=>'<option value="'+escape(part.id)+'">'+escape(part.label)+'</option>').join('')+'</select><select name="refine-direction-'+index+'" id="refine-direction-'+index+'" aria-label="调整方向'+(index+1)+'" disabled><option value="">先选部位</option></select><select name="refine-amount-'+index+'" aria-label="微调幅度'+(index+1)+'">'+options.amounts.map(amount=>'<option value="'+amount.id+'">'+escape(amount.label)+'</option>').join('')+'</select></div>').join('');
  const body='<div class="refinement-options"><h3>选择自然微调方向</h3><p class="form-help">1档轻微、2档适中、3档明显；最高档要求并排可辨，同时保持同一人物。最多'+(options.maximumOptions || 4)+'项。保留年龄、性别、角色身份与未指定的五官；完整头像的发型保持原样。</p>'+rows+'</div><details class="refine-mask-details"><summary>可选：涂选重点区域，作为AI修改引导 <span>不画区域也能提交</span></summary><div class="refine-mask-toolbar">'+button('画圈','refine-mask-tool','data-tool="circle"','small soft')+button('刷子','refine-mask-tool','data-tool="brush"','small')+'<label>笔刷大小<input type="range" min="1" max="15" value="4" data-change="refine-brush" aria-label="笔刷大小"></label>'+button('撤销','refine-mask-undo','','small',true)+button('清除','refine-mask-clear','','small',true)+'</div><div class="refine-mask-viewport"><div class="refine-mask-wrap"><img id="refine-source-image" src="'+escape(fileUrl(context.sourceUrl))+'" alt="微调前完整原图"><canvas id="refine-mask-canvas" aria-label="圈选或刷选局部调整区域"></canvas></div></div><p class="form-help">紫色区域表示希望AI重点调整的位置；区域以外作为保留参考，不能保证每个像素完全不变。原图不被画笔覆盖，结果先对比再采用。</p></details><div class="refine-original-reference">'+'<div class="media-well has-image"><img src="'+escape(fileUrl(context.sourceUrl))+'" alt="微调前完整原图"></div>'+'</div><div class="notice">提交后只生成微调预览。原头像、候选或库素材保持原图，先比较前后效果，再明确点击“确认采用微调图”。</div>';
  modal('脸部局部微调',context.name,body,'生成微调预览',async form=>{
    const values=Object.fromEntries(new FormData(form)),refineOptions=[];
    for(let index=0;index<Math.min(4,options.maximumOptions || 4);index++){const part=values['refine-part-'+index];if(part)refineOptions.push({part,direction:values['refine-direction-'+index],amount:Number(values['refine-amount-'+index])});}
    if(!refineOptions.length)throw new Error('至少选择一个五官部位和调整方向。');
    if(new Set(refineOptions.map(item=>item.part)).size!==refineOptions.length)throw new Error('同一部位只选择一个方向，避免相反要求。');
    if(refineOptions.some(item=>!item.direction))throw new Error('请为所选部位选定调整方向。');
    let maskUrl='';
    if(ui.refineEditor.strokes.length){const mask=document.createElement('canvas');mask.width=ui.refineEditor.width;mask.height=ui.refineEditor.height;const ctx=mask.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,mask.width,mask.height);paintRefineStrokes(ctx,ui.refineEditor.strokes,'#fff');const response=await api('/api/upload','POST',{filename:'face-refine-mask.png',data:mask.toDataURL('image/png')});maskUrl=response.url;if(!fileUrl(maskUrl))throw new Error('局部区域上传未完成，请重试。');}
    await enqueue('face_refine',{projectId:context.projectId || '',characterId:context.characterId || '',appearanceProfileId:context.appearanceProfileId || '',sourceKind:context.sourceKind,sourceUrl:context.sourceUrl,...(context.candidateId?{candidateId:context.candidateId}:{}),...(context.libraryId?{libraryId:context.libraryId}:{}),refineOptions,...(maskUrl?{maskUrl}:{})});
    closeModal();ui.refineEditor=null;ui.page='queue';render();toast('微调预览已排队；原图保持不变，完成后先比较再采用。');
  });
  const image=$('#refine-source-image',dialog);
  const initialize=()=>{if(!ui.refineEditor)return;const canvas=$('#refine-mask-canvas',dialog);ui.refineEditor.width=image.naturalWidth;ui.refineEditor.height=image.naturalHeight;canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;redrawRefineMask();};
  if(image.complete&&image.naturalWidth)initialize();else image.addEventListener('load',initialize,{once:true});
}
function paintRefineStrokes(ctx,strokes,color) {
  ctx.fillStyle=color;ctx.strokeStyle=color;
  for(const stroke of strokes){if(stroke.tool==='circle'){const start=stroke.points[0],end=stroke.points.at(-1),radius=Math.hypot(end.x-start.x,end.y-start.y);ctx.beginPath();ctx.arc(start.x,start.y,Math.max(1,radius),0,Math.PI*2);ctx.fill();}else{ctx.lineWidth=stroke.size;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(stroke.points[0].x,stroke.points[0].y);for(const point of stroke.points.slice(1))ctx.lineTo(point.x,point.y);ctx.stroke();if(stroke.points.length===1){ctx.beginPath();ctx.arc(stroke.points[0].x,stroke.points[0].y,stroke.size/2,0,Math.PI*2);ctx.fill();}}}
}
function redrawRefineMask() {
  const editor=ui.refineEditor,canvas=$('#refine-mask-canvas',dialog);if(!editor||!canvas)return;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);paintRefineStrokes(ctx,[...editor.strokes,...(editor.draftStroke?[editor.draftStroke]:[])],'rgba(140,85,185,.36)');
  $('[data-action="refine-mask-undo"]',dialog).disabled=!editor.strokes.length;$('[data-action="refine-mask-clear"]',dialog).disabled=!editor.strokes.length;
}
function refinementPoint(event,canvas) {const rect=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(event.clientX-rect.left)*canvas.width/rect.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-rect.top)*canvas.height/rect.height))};}
document.addEventListener('pointerdown',event=>{
  if(event.target.id!=='refine-mask-canvas'||!ui.refineEditor?.width)return;
  const editor=ui.refineEditor;editor.pointer=event.pointerId;editor.draftStroke={tool:editor.tool,size:Math.max(1,editor.width*editor.brush/100),points:[refinementPoint(event,event.target)]};event.target.setPointerCapture(event.pointerId);event.preventDefault();redrawRefineMask();
});
document.addEventListener('pointermove',event=>{const editor=ui.refineEditor,canvas=$('#refine-mask-canvas',dialog);if(!editor?.draftStroke||editor.pointer!==event.pointerId||!canvas)return;const point=refinementPoint(event,canvas);if(editor.tool==='circle')editor.draftStroke.points=[editor.draftStroke.points[0],point];else editor.draftStroke.points.push(point);event.preventDefault();redrawRefineMask();});
document.addEventListener('pointerup',event=>{const editor=ui.refineEditor;if(!editor?.draftStroke||editor.pointer!==event.pointerId)return;editor.strokes.push(editor.draftStroke);editor.draftStroke=null;editor.pointer=null;redrawRefineMask();});
function compareRefinement(job) {
  const receipt=job?.visualRefinement;if(!receipt?.image)throw new Error('微调预览尚未完成。');
  const adopted=receipt.status==='adopted'||receipt.adoptedAt;
  ui.refineComparisonZoom=1;
  const applyNote=receipt.sourceKind==='candidate'?'采用只替换这张候选图，之后还要选中并确认定脸。':'采用后才更新对应脸图或库素材。';
  const body='<p class="notice refinement-adoption-note">'+(adopted?'这张微调图已采用。':'当前是未采用预览，原图没有被替换。')+' '+escape(applyNote)+'</p><div class="refinement-zoom-toolbar">'+button('−','refinement-zoom','data-delta="-.5"','small')+button('＋ 放大细节','refinement-zoom','data-delta=".5"','small soft')+button('适应窗口','refinement-zoom-reset','','small')+'<span class="refinement-zoom-label">100%</span></div><div class="refinement-compare"><section><h3>原图</h3><div class="refinement-zoom-viewport"><img src="'+escape(fileUrl(receipt.sourceUrl || job.sourceUrl))+'" alt="微调原图"></div></section><section><h3>微调预览</h3><div class="refinement-zoom-viewport"><img src="'+escape(fileUrl(receipt.image))+'" alt="微调预览"></div></section></div><p class="form-help">可同步放大并滚动查看脸部细节。确认采用是独立操作，原文件保留；源图改变时会提示重新生成。旧预览保留当时效果，新档位仅对下一次生成生效。</p>';
  modal('比较五官微调效果','仅预览不会改定稿；确认采用是独立操作。',body,adopted?'已采用':'确认采用微调图',async()=>{
    const libraryId=job.libraryId || receipt.libraryId;
    const endpoint=libraryId?'/api/library/'+encodeURIComponent(libraryId)+'/adopt-refinement':'/api/projects/'+encodeURIComponent(job.projectId)+'/characters/'+encodeURIComponent(job.characterId)+'/adopt-refinement';
    await api(endpoint,'POST',{jobId:job.id,...(job.appearanceProfileId?{appearanceProfileId:job.appearanceProfileId}:{})});
    closeModal();await refresh(true);toast('微调图已明确采用，原图文件保留。');
  });
  if(adopted)$('#modal-form [type="submit"]').disabled=true;
}


function zoomRefinement(delta,reset=false) {
  const boxes=$$('.refinement-zoom-viewport',dialog);if(!boxes.length)return;
  const previous=ui.refineComparisonZoom || 1,next=reset?1:Math.max(1,Math.min(3,previous+delta));
  for(const box of boxes){const cx=(box.scrollLeft+box.clientWidth/2)/previous,cy=(box.scrollTop+box.clientHeight/2)/previous;
    box.style.setProperty('--refinement-zoom',String(next));
    box.scrollLeft=reset?0:cx*next-box.clientWidth/2;box.scrollTop=reset?0:cy*next-box.clientHeight/2;}
  ui.refineComparisonZoom=next;$('.refinement-zoom-label',dialog).textContent=Math.round(next*100)+'%';
}
document.addEventListener('scroll',event=>{
  const box=event.target;if(!(box instanceof Element)||!box.matches('.refinement-zoom-viewport'))return;
  for(const other of $$('.refinement-zoom-viewport',dialog)){if(other===box)continue;
    if(Math.abs(other.scrollLeft-box.scrollLeft)>.5)other.scrollLeft=box.scrollLeft;
    if(Math.abs(other.scrollTop-box.scrollTop)>.5)other.scrollTop=box.scrollTop;}
},true);

function hairDisplay(item){const preview=fileUrl(item.preview || (item.storageForm==='neutral_white_head_three_views'?item.image:''));return {preview,pure:'',mode:'preview',url:preview};}
function hairLibraryControls(item){
 if(item.kind!=='hairstyle')return '';
 const display=hairDisplay(item),pending=state.jobs.some(job=>job.kind==='hairstyle_preview'&&job.libraryId===item.id&&['queued','running'].includes(job.status));
 return '<p class="subtext">通用白模头部 · 正面、90°侧面、背面；只参考发型，不借用白模五官。</p><div class="actions">'+button(pending?'白模三视已排队':display.preview?'重新制作白模三视':'补齐白模三视','hair-preview-job','data-id="'+escape(item.id)+'"','small soft',pending)+(display.preview?'<a class="button small" href="'+escape(display.preview)+'" download>下载白模三视</a>':'')+'</div>';
}
ui.hairViews={};
function libraryForm(kind) {
  if(kind==='body'&&window.bodyStudio){window.bodyStudio.create();return;}
  if(kind!=='body')return;
  const body = `<div class="form-field"><label>素材画风</label>${styleFields(currentProject()?.style || '国漫')}</div>${headLibraryFacetFields()}<div class="form-field"><label for="library-brief">身体模板描述</label><textarea id="library-brief" name="instructions" rows="6" placeholder="例如：成年男性，高瘦，窄肩，普通肌肉量；身体中性直立，简洁贴身基础衣着，完整头部与鞋子。"></textarea></div><div class="notice">身体模板按体型独立保存。组合时统一肤色、头身比例和画风。</div>`;
  modal('生成身体模板', '不依赖项目，生成结果进入身体模板库。', body, '加入制作队列', async form => {
    const values = Object.fromEntries(new FormData(form));
    await enqueue('library_body', { style: values['style-choice'], instructions: values.instructions.trim(), era: values.era, gender: values.gender, ageStage: values.ageStage, count: 1 }); closeModal(); ui.page = 'queue'; render();
  });
}

function libraryUploadForm() {
  if(ui.libraryKind==='body'&&window.bodyStudio){window.bodyStudio.upload();return;}
  const body='<div class="form-field"><label>素材名称</label><input name="name" required placeholder="例如：青年五官01 / 古代高束发"></div><div class="form-row"><div class="form-field"><label>素材类别</label><select name="kind">'+selectOptions(headLibraryKinds,ui.libraryKind)+'</select></div><div class="form-field"><label>画风</label><select name="style">'+selectOptions(Object.fromEntries(assetStyles.map(style=>[style,style])),currentProject()?.style || '国漫')+'</select></div></div>'+headLibraryFacetFields()+'<div class="form-field"><label>素材特征或制作设计</label><textarea name="description" placeholder="五官、脸型、发型或体型等便于检索的特征"></textarea></div><details class="head-upload-evidence"><summary>发型的原文依据与设计性质</summary><div class="form-field"><label>原文发型描写</label><textarea name="sourceDescription" placeholder="没有原文描写就留空，不将制作建议写成原文"></textarea></div><div class="form-field"><label>设计性质</label><select name="designBasis">'+selectOptions({production_design:'制作补设',authorized_adaptation:'用户改编'},'production_design')+'</select></div></details>'+referenceField([],false)+'<div class="notice">五官素材为完全无头发的纯五官脸或光头头部，无颈部和肩膀；发型素材请上传通用白模头部的正、90°侧、背三视，不含颈肩身体。带人物的参考图请用“从参考图提取”。</div>';
  modal('导入人物素材','五官、发型与身体三类素材各自保存，上传不会直接覆盖角色完整头部。',body,'保存到素材库',async form=>{
    const values=Object.fromEntries(new FormData(form)),uploaded=await uploadSelectedFiles(form);if(!uploaded.length)throw new Error('请选择一张素材图片。');
    await api('/api/library','POST',{name:values.name.trim(),kind:values.kind,style:values.style,description:values.description.trim(),image:uploaded[0],era:values.era,gender:values.gender,ageStage:values.ageStage,...(values.kind==='hairstyle'?{storageForm:'neutral_white_head_three_views',sourceDescription:values.sourceDescription.trim(),sourceEvidence:[],designDescription:values.description.trim(),designBasis:values.designBasis}:{})});
    ui.libraryKind=values.kind;ui.materialSection=values.kind;closeModal();await refresh(true);toast('素材已保存到素材库对应类别，待核验。');
  });
}

function importProjectForm() {
  const body = `<div class="form-field"><label>项目资料文件</label><label class="upload-label">＋ 选择 project.json 文件<input type="file" name="project-file" accept=".json,application/json"></label></div><p class="form-help">支持本工作台导出的项目资料。画风、话数范围和角色描述可以与后续模块共用；图片文件需仍在本机，或重新上传参考。</p>`;
  modal('导入项目资料', '接续已有项目，或接入其他模块整理的项目资料。', body, '导入项目', async form => {
    const file = $('[name="project-file"]', form).files[0]; if (!file) throw new Error('请选择项目 JSON 文件。');
    let project; try { const parsed = JSON.parse(await file.text()); project = parsed.project || parsed; } catch { throw new Error('这个文件不是有效的项目 JSON。'); }
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('项目资料格式不正确。');
    const result = await api('/api/projects/import', 'POST', { project }); chooseProject(result.id || result.project?.id || ''); closeModal(); ui.page = 'project'; await refresh(true); toast('项目资料已导入。');
  });
}

function importArtifactForm(field) {
  const labels = { face: '脸图', base: '身体底稿', card: '服装角色卡', hands: '手部动作卡' };
  const body = `${referenceField([], false)}<p class="form-help">${field === 'face' ? '导入后仍需确认脸图。变更脸图会清除当前身体和服装卡的关联，原图片文件保留。' : field === 'base' ? '变更身体底稿后，后续服装和动作需要重新制作；原图片文件保留。' : '导入已完成的图片作为当前版本。变更服装卡后需要重新匹配手部动作。'}</p>`;
  modal(`导入${labels[field]}`, '上传你已画好或已经完成的成图，继续后续制作。', body, '使用这张成图', async form => {
    const uploaded = await uploadSelectedFiles(form); if (!uploaded.length) throw new Error('请选择一张成图。');
    await api(['face', 'base'].includes(field) ? characterEndpoint() : outfitEndpoint(), 'PATCH', { [field]: uploaded[0], ...appearancePayload() }); closeModal(); await refresh(true); toast(`${labels[field]}已导入。`);
  });
}
function reviseArtifactForm(kind) {
  const body = `<div class="form-field"><label>返修要求</label><textarea name="instructions" required rows="6" placeholder="例如：第一栏脸正对镜头、双眼水平，下巴移到画面高度 92%；其余三栏保持相同角色和服装。"></textarea></div><div class="notice">按当前角色资料和参考图重新生成本步骤。新结果会替换当前关联；已完成的原文件保留。脸图返修后需要重新确认。</div>`;
  modal(`返修${kinds[kind]?.replace('生成', '') || '图片'}`, '只处理你选中的制作步骤。', body, '提交返修', async form => {
    const values = Object.fromEntries(new FormData(form)); await enqueue(kind, { instructions: values.instructions.trim() }); closeModal();
  });
}

function preview(url,name='图片预览') {
  if(!fileUrl(url))return;
  dialog.classList.add('preview-dialog');ui.preview={scale:1,fitScale:1,mode:'fit',width:0,height:0,drag:null};
  $('#modal-content').innerHTML='<div class="modal-header"><div><h2>'+escape(name)+'</h2><p>鼠标滚轮放大缩小，拖动查看细节；也可用滚动条平移。</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="关闭">×</button></div><div class="preview-toolbar">'+button('−','preview-zoom','data-factor="0.8"','small')+'<output class="preview-scale-label">加载图片…</output>'+button('＋','preview-zoom','data-factor="1.25"','small')+button('适应屏幕','preview-fit','','small soft')+button('原始大小','preview-original','','small')+button('重置','preview-reset','','small')+'</div><div class="preview-viewport" tabindex="0" aria-label="可滚动及拖动的整图预览"><div class="preview-canvas"><img class="modal-image" src="'+escape(url)+'" alt="'+escape(name)+'" draggable="false"></div></div><div class="modal-footer"><a class="button primary" href="'+escape(url)+'" download>下载图片</a><button type="button" class="button" data-action="close-modal">关闭</button></div>';
  ui.modalSubmit=null;dialog.showModal();
  const image=$('.modal-image',dialog);
  const initialize=()=>{if(!ui.preview||!dialog.open)return;ui.preview.width=image.naturalWidth;ui.preview.height=image.naturalHeight;fitPreview();};
  if(image.complete&&image.naturalWidth)initialize();else image.addEventListener('load',initialize,{once:true});
  image.addEventListener('error',()=>{$('.preview-scale-label',dialog).textContent='图片暂未载入';},{once:true});
}
function scalePreview(scale,keepCenter=true,anchor=null) {
  const info=ui.preview,viewport=$('.preview-viewport',dialog),canvas=$('.preview-canvas',dialog),image=$('.modal-image',dialog);
  if(!info?.width||!viewport)return;
  const box=viewport.getBoundingClientRect(),pointX=anchor?Math.max(0,Math.min(viewport.clientWidth,anchor.clientX-box.left)):viewport.clientWidth/2,pointY=anchor?Math.max(0,Math.min(viewport.clientHeight,anchor.clientY-box.top)):viewport.clientHeight/2;
  const oldScale=info.scale || 1, centerX=(viewport.scrollLeft+pointX-image.offsetLeft)/oldScale,centerY=(viewport.scrollTop+pointY-image.offsetTop)/oldScale;
  info.scale=Math.max(.01,Math.min(5,scale));
  const width=info.width*info.scale,height=info.height*info.scale,canvasWidth=Math.max(viewport.clientWidth,width+32),canvasHeight=Math.max(viewport.clientHeight,height+32);
  canvas.style.width=canvasWidth+'px';canvas.style.height=canvasHeight+'px';
  image.style.width=width+'px';image.style.height=height+'px';image.style.left=(canvasWidth-width)/2+'px';image.style.top=(canvasHeight-height)/2+'px';
  $('.preview-scale-label',dialog).textContent=Math.round(info.scale*100)+'%';
  if(keepCenter){viewport.scrollLeft=centerX*info.scale+image.offsetLeft-pointX;viewport.scrollTop=centerY*info.scale+image.offsetTop-pointY;}
  else {viewport.scrollLeft=0;viewport.scrollTop=0;}
}
function fitPreview() {
  const info=ui.preview,viewport=$('.preview-viewport',dialog);if(!info?.width||!viewport)return;
  info.fitScale=Math.min((viewport.clientWidth-32)/info.width,(viewport.clientHeight-32)/info.height,1);
  info.mode='fit';scalePreview(info.fitScale,false);
}
document.addEventListener('pointerdown',event=>{
  const viewport=event.target.closest?.('.preview-viewport');if(!viewport||event.pointerType==='touch'||event.button!==0||!ui.preview)return;
  ui.preview.drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
  viewport.setPointerCapture(event.pointerId);viewport.classList.add('dragging');event.preventDefault();
});
document.addEventListener('pointermove',event=>{const drag=ui.preview?.drag,viewport=$('.preview-viewport',dialog);if(!drag||drag.id!==event.pointerId||!viewport)return;viewport.scrollLeft=drag.left+drag.x-event.clientX;viewport.scrollTop=drag.top+drag.y-event.clientY;});
document.addEventListener('pointerup',()=>{if(ui.preview)ui.preview.drag=null;$('.preview-viewport',dialog)?.classList.remove('dragging');});
window.addEventListener('resize',()=>{if(dialog.open&&ui.preview?.mode==='fit')fitPreview();});
document.addEventListener('wheel',event=>{
  const viewport=event.target.closest?.('.preview-viewport');
  if(!viewport||!dialog.open||!ui.preview?.width||!event.deltaY)return;
  event.preventDefault();
  const units=event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1;
  const movement=Math.max(-240,Math.min(240,event.deltaY*units));
  ui.preview.mode='manual';scalePreview(ui.preview.scale*Math.exp(-movement*.0015),true,{clientX:event.clientX,clientY:event.clientY});
},{passive:false});


document.addEventListener('click', async event => {
  const dropzone = event.target.closest('[data-script-drop]');
  if (dropzone && event.target.tagName !== 'INPUT') { if (!ui.projectFormState?.importing) $('#script-files')?.click(); return; }
  const navigation = event.target.closest('[data-page]');
  if (navigation) { ui.page = navigation.dataset.page; render(); return; }
  if (event.target.closest('a[download]')) return;
  const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
  if (target.tagName === 'A') event.preventDefault();
  const action = target.dataset.action;
  if (target.closest('.library-item') && target !== target.closest('.library-item')) event.stopPropagation();
  try {
    if(action.startsWith('tool-')){await window.workbenchTools.action(target);return;}
    if(action.startsWith('body-')){await window.bodyStudio.action(target);return;}
    if(action.startsWith('material-')){await window.materialStudio.action(target);return;}
    switch (action) {
      case 'resource-refresh':case 'resource-clean':case 'resource-restore':await window.resourceStudio.action(target);break;
      case 'refresh': await refresh(true); break;
      case 'refinement-zoom': zoomRefinement(Number(target.dataset.delta));break;
      case 'refinement-zoom-reset': zoomRefinement(0,true);break;
      case 'open-guide': if(window.characterTour)window.characterTour.start();else{ui.page='guide';render();}break;
      case 'read-guide': if(window.characterTour?.active)window.characterTour.stop(false);ui.page='guide';render();break;
      case 'dismiss-guide': localStorage.setItem('character-studio-guide-seen','1');render();break;
      case 'guide-step': ui.page='project';ui.projectStage=target.dataset.stage;render();break;
      case 'download-guide': downloadGuide();break;
      case 'crowd-create': await crowdSetForm('generate',target.dataset.characterId || '');break;
      case 'crowd-import': await crowdSetForm('import',target.dataset.characterId || '');break;
      case 'crowd-view': ui.crowdViews[target.dataset.id]=target.dataset.part;render();break;
      case 'crowd-retry': target.disabled=true;await retryCrowdSet(target.dataset.id);break;
      case 'crowd-adopt': await adoptCrowdSet(target.dataset.id);break;
      case 'crowd-search': ui.crowdFilters.query=$('#crowd-library-search')?.value.trim() || '';render();break;
      case 'open-crowd-library': ui.crowdTarget={projectId:ui.projectId,characterId:target.dataset.characterId || ui.characterId};ui.page='crowd';render();break;
      case 'return-crowd-target': if(ui.crowdTarget){chooseProject(ui.crowdTarget.projectId);ui.characterId=ui.crowdTarget.characterId;ui.category='群像';ui.projectStage='outfit';ui.page='project';reconcile();render();}break;
      case 'batch-stage': await batchStageForm(target.dataset.kind);break;
      case 'batch-select-ready': for(const row of batchRowsVisible())if(batchRowSelectable(row))ui.batchEditor.selected.add(row.key);paintBatchPlan();break;
      case 'batch-clear-selection': ui.batchEditor.selected.clear();paintBatchPlan();break;
      case 'batch-refresh-plan': target.disabled=true;try{await reloadBatchPlan();}finally{target.disabled=false;}break;
      case 'batch-reference-import': batchReferenceImportForm();break;
      case 'face-refine': await faceRefinementForm(refineSourceContext(target.dataset.sourceKind,target.dataset.sourceId));break;
      case 'compare-refinement': compareRefinement(state.jobs.find(job=>job.id===target.dataset.jobId));break;
      case 'refine-mask-tool': if(ui.refineEditor){ui.refineEditor.tool=target.dataset.tool;$$('[data-action="refine-mask-tool"]',dialog).forEach(button=>button.classList.toggle('soft',button.dataset.tool===target.dataset.tool));}break;
      case 'refine-mask-undo': if(ui.refineEditor){ui.refineEditor.strokes.pop();redrawRefineMask();}break;
      case 'refine-mask-clear': if(ui.refineEditor){ui.refineEditor.strokes=[];redrawRefineMask();}break;
      case 'hair-library-view': ui.hairViews[target.dataset.id]=target.dataset.view;render();break;
      case 'hair-preview-job': await enqueue('hairstyle_preview',{projectId:'',libraryId:target.dataset.id});break;
      case 'archive-head': target.disabled=true;await archiveCurrentHead();break;
      case 'dismiss-submission': ui.lastSubmission=null;render();break;
      case 'expand-media': {const well=target.closest('.media-well'),image=well?.querySelector('img');if(image?.naturalWidth){const expanded=well.classList.toggle('expanded');well.style.height=expanded?(well.clientWidth*image.naturalHeight/image.naturalWidth)+'px':'';target.textContent=expanded?'收起大图':'展开大图';}break;}
      case 'preview-zoom': if(ui.preview){ui.preview.mode='custom';scalePreview(ui.preview.scale*Number(target.dataset.factor));}break;
      case 'preview-fit': case 'preview-reset': fitPreview();break;
      case 'preview-original': if(ui.preview){ui.preview.mode='custom';scalePreview(1);}break;
      case 'project-stage': ui.projectStage = target.dataset.value; render(); break;
      case 'select-profile': ui.profileSelections[profileKey()] = target.dataset.id; ui.outfitId = ''; reconcile(); render(); break;
      case 'add-profile': appearanceProfileForm(); break;
      case 'edit-profile': appearanceProfileForm(profileFor(currentCharacterRecord())); break;
      case 'edit-head-settings': headSettingsForm(); break;
      case 'open-head-library': ui.libraryTarget={projectId:ui.projectId,characterId:ui.characterId,appearanceProfileId:currentAppearanceProfileId()}; ui.libraryKind=target.dataset.kind; ui.materialSection=target.dataset.kind; ui.page='library'; render(); break;
      case 'return-head-target': if(ui.libraryTarget){chooseProject(ui.libraryTarget.projectId);ui.characterId=ui.libraryTarget.characterId;ui.profileSelections[profileKey()]=ui.libraryTarget.appearanceProfileId;ui.projectStage='face';ui.page='project';reconcile();render();} break;
      case 'head-library-create': headLibraryForm(target.dataset.kind || ui.libraryKind,target.dataset.mode || 'generate'); break;
      case 'use-head-library': headLibraryTargetForm(state.library.find(item=>item.id===target.dataset.id)); break;
      case 'search-head-library': libraryFilterFor().query=$('#head-library-search')?.value.trim() || ''; render(); break;
      case 'merge-project': mergeProjectForm(); break;
      case 'delete-project': deleteProjectForm(); break;
      case 'project-recycle': recycleProjectForm(); break;
      case 'restore-project': { target.disabled=true; const result=await api(`/api/projects/${encodeURIComponent(target.dataset.id)}/restore`,'POST',{}); closeModal(); chooseProject(result.project?.id || target.dataset.id); await refresh(true); toast('项目已恢复。'); break; }
      case 'show-queue': closeModal(); ui.page='queue'; render(); break;
      case 'move-job': target.disabled=true; await moveQueuedJob(target.dataset.id,Number(target.dataset.direction)); break;
      case 'create-project': projectForm(); break;
      case 'image-auto': imageAutoForm(); break;
      case 'edit-project': projectForm(currentProject()); break;
      case 'reread-script-sources': await rereadScriptSources(); break;
      case 'read-project-chapters': {
        const project = currentProject(); if (!project?.sourceFiles?.length) throw new Error('先上传或保存剧本原文件。');
        target.disabled = true;
        await api(`/api/projects/${encodeURIComponent(project.id)}/read-chapters`, 'POST', { rangeStart: project.rangeStart || 1, rangeEnd: project.rangeEnd || 20 });
        await refresh(true); toast('所选章节正文已重新读取。下一步点击“只拆解剧本”核对素材，不会自动生图。'); break;
      }
      case 'requirement-type': ui.requirementView.type = target.dataset.value; render(); break;
      case 'copy-asset-id': await navigator.clipboard.writeText(target.dataset.value || ''); toast('资产编号已复制。'); break;
      case 'open-requirement': {
        const project = currentProject(); const character = project?.characters?.find(item => item.id === target.dataset.character || (item.teamAssetId || item.assetId) === target.dataset.asset);
        if (character && target.dataset.type !== 'crowd') { ui.page = 'project'; ui.characterId = character.id; ui.category = '全部'; const targetOutfit = character.outfits?.find(outfit=>outfit.id===target.dataset.outfit); if (targetOutfit?.appearanceProfileId) ui.profileSelections[profileKey(character.id)] = targetOutfit.appearanceProfileId; ui.projectStage = target.dataset.type === 'costume' ? 'outfit' : 'face'; ui.outfitId = target.dataset.outfit || ''; reconcile(); render(); $('#character-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else if (target.dataset.type === 'crowd') { ui.page='crowd';ui.crowdTarget=character?{projectId:project.id,characterId:character.id}:null;render(); }
        else if (target.dataset.type === 'costume') { ui.page = 'clothing'; render(); }
        else { ui.page = 'project'; ui.category = '全部'; ui.projectStage = 'face'; render(); $('#character-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        break;
      }
      case 'select-project': chooseProject(target.dataset.id); ui.page = 'project'; reconcile(); render(); break;
      case 'select-character': ui.characterId = target.dataset.id; ui.outfitId = ''; reconcile(); render(); break;
      case 'select-outfit': ui.outfitId = target.dataset.id; render(); break;
      case 'category': ui.category = target.dataset.value; { const chars = currentProject()?.characters || []; const visible = chars.filter(character => ui.category === '全部' || character.category === ui.category); if (!visible.some(character => character.id === ui.characterId)) { ui.characterId = visible[0]?.id || ''; ui.outfitId = ''; } } render(); break;
      case 'add-character': if (!currentProject()) projectForm(); else characterForm(); break;
      case 'edit-character': characterForm(currentCharacterRecord()); break;
      case 'add-outfit': outfitForm(); break;
      case 'edit-outfit': outfitForm(currentOutfit()); break;
      case 'approve-face': await api(characterEndpoint(), 'PATCH', { faceApproved: true, ...appearancePayload() }); ui.projectStage = 'body'; await refresh(true); toast('脸图已确认，五官与发型拆入库已自动安排，可在队列查看；现在可继续身体定稿。'); break;
      case 'select-candidate': if (!busy('face')) { ui.candidateSelection[candidateKey()] = target.dataset.id; render(); } break;
      case 'confirm-candidate': {
        const character = currentCharacter(); const candidateId = target.dataset.candidate;
        if (!character?.faceCandidates?.some(candidate => candidate.id === candidateId)) throw new Error('先选中一张当前候选脸。');
        target.disabled = true; await api(`${characterEndpoint()}/select-face`, 'POST', { candidateId, ...appearancePayload() }); ui.projectStage = 'body'; await refresh(true); toast('长相已确认，纯五官与发型已自动安排入库；可继续制作身体与服装。'); break;
      }
      case 'project-auto': target.disabled = true; await enqueue('project_auto'); break;
      case 'save-gestures': target.disabled = true; await saveGestures(); break;
      case 'job': target.disabled = true; await enqueue(target.dataset.kind); break;
      case 'batch-pipeline': {
        const project = currentProject(); const available = (project?.characters || []).map(characterView).filter(character => ['主角','配角'].includes(roleCategory(character)) && character.faceApproved);
        const count = available.reduce((total, character) => total + (character.outfits || []).length, 0);
        if (!count) throw new Error('已定脸的角色还没有服装版本，请先添加服装。');
        target.disabled = true; let queued = 0;
        for (const character of available) for (const outfit of character.outfits || []) { if (state.jobs.some(job => job.characterId === character.id && job.outfitId === outfit.id && job.kind === 'pipeline' && ['queued', 'running'].includes(job.status))) continue; await api('/api/jobs', 'POST', { kind: 'pipeline', projectId: project.id, characterId: character.id, outfitId: outfit.id, appearanceProfileId: character.appearanceProfileId || undefined, clientRequestId: crypto.randomUUID() }); queued++; }
        await refresh(true); toast(`${queued} 个服装版本已加入制作队列。`); break;
      }
      case 'batch-faces': {
        if (ui.inFlight.has('batch-faces')) break;
        const project = currentProject();
        const targets = (project?.characters || []).map(characterView).filter(character => ['主角', '配角'].includes(character.category) && !['face','fullbody'].includes(character.identitySource) && headTaskKind(character) !== 'head_prepare' && !character.face && (character.faceCandidates || []).length < 3 && !state.jobs.some(job => job.projectId === project.id && ['queued', 'running'].includes(job.status) && (job.kind === 'analyze' || job.characterId === character.id)));
        if (!targets.length) throw new Error('没有需要生成脸图的主角或配角；待确认的脸图会保留。');
        target.disabled = true; ui.inFlight.add('batch-faces'); let queued = 0;
        try {
          for (const character of targets) { await api('/api/jobs', 'POST', { kind: 'face', projectId: project.id, characterId: character.id, appearanceProfileId: character.appearanceProfileId || undefined, clientRequestId: crypto.randomUUID() }); queued++; }
          toast(`${queued} 个角色已加入队列，每人生成 3 张脸供你挑选。`);
        } finally { ui.inFlight.delete('batch-faces'); await refresh(true); }
        break;
      }
      case 'library-kind': if(Object.hasOwn(headLibraryKinds,target.dataset.value)){ui.libraryKind=target.dataset.value;ui.materialSection=target.dataset.value;} render(); break;
      case 'library-body': libraryForm('body'); break;
      case 'library-upload': libraryUploadForm(); break;
      case 'import-clothing': clothingForm(); break;
      case 'edit-clothing': clothingForm(state.library.find(item => item.id === target.dataset.id)); break;
      case 'wear-clothing': wearClothingForm(state.library.find(item => item.id === target.dataset.id)); break;
      case 'search-clothing': ui.clothingFilters.query = $('#clothing-search')?.value.trim() || ''; render(); break;
      case 'import-artifact': importArtifactForm(target.dataset.field); break;
      case 'revise-artifact': reviseArtifactForm(target.dataset.kind); break;
      case 'use-special-suggestion': { const item = currentOutfit()?.specialSuggestions?.[Number(target.dataset.index)]; if (item) { const text = typeof item === 'string' ? item : [item.episode ? `第${item.episode}话` : '', item.action || item.name || item.description || '', item.reason || item.source || ''].filter(Boolean).join(' · '); $('#special-instructions').value = text; const key = draftKey(); ui.drafts[key] = { ...(ui.drafts[key] || {}), specialInstructions: text }; $('#special-instructions').focus(); } break; }
      case 'select-library': { const item = state.library.find(entry => entry.id === target.dataset.id); if (item?.kind === 'body') ui.bodyId = ui.bodyId === item.id ? '' : item.id; else if (item && Object.hasOwn(headLibraryKinds,item.kind)) ui.librarySelections[item.kind] = ui.librarySelections[item.kind] === item.id ? '' : item.id; render(); break; }
      case 'queue-filter': ui.queueFilter = target.dataset.value; render(); break;
      case 'cancel-job': target.disabled = true; await api(`/api/jobs/${encodeURIComponent(target.dataset.id)}/cancel`, 'POST', {}); await refresh(true); toast('取消请求已提交。'); break;
      case 'open-job': { const job = state.jobs.find(item => item.id === target.dataset.id); if (job) { chooseProject(job.projectId); ui.characterId = job.characterId || ''; ui.outfitId = job.outfitId || ''; if(job.appearanceProfileId) ui.profileSelections[profileKey(job.characterId)] = job.appearanceProfileId; ui.projectStage = ['face','head_prepare','hair_apply'].includes(job.kind)?'face':job.kind==='base'?'body':job.kind==='analyze'?'inventory':job.kind==='combine'||job.kind==='pipeline'?'output':'outfit'; ui.page = 'project'; reconcile(); render(); } break; }
      case 'go-project': ui.page = 'project'; render(); break;
      case 'check-runtime': target.disabled = true; state.runtime = await api('/api/runtime'); await refresh(true); toast(runtimeReady() ? 'Codex 已连接，可以开始制作。' : '连接检查完成，请查看当前状态。'); break;
      case 'import-project': importProjectForm(); break;
      case 'preview': preview(target.dataset.url, target.dataset.name); break;
      case 'close-modal': closeModal(); break;
      default: break;
    }
  } catch (error) { toast(error.message, true); if (target.isConnected) target.disabled = false; }
});
document.addEventListener('change', async event => {
  const target = event.target;
  if(target.dataset.change==='concurrency'){try{await api('/api/settings','POST',{maxConcurrentJobs:Number(target.value)});await refresh(true);toast('并行任务数已保存。');}catch(error){toast(error.message,true);await refresh(true);}}
  if(target.dataset.change==='crowd-policy'){const basis=$('[name="costumePolicyBasis"]',dialog);if(basis)basis.disabled=target.value==='auto';}
  if(target.dataset.crowdFilter){ui.crowdFilters[target.dataset.crowdFilter]=target.value;render();}
  if(target.dataset.change==='crowd-adopt-project'){const project=state.projects.find(project=>project.id===target.value);$('#crowd-adopt-character',dialog).innerHTML=(project?.characters || []).filter(character=>roleCategory(character)==='群像').map(character=>'<option value="'+escape(character.id)+'">'+escape(character.name)+'</option>').join('');}
  if(target.dataset.change==='batch-target'){if(target.checked)ui.batchEditor.selected.add(target.value);else ui.batchEditor.selected.delete(target.value);paintBatchPlan();}
  if(target.dataset.change==='batch-filter'){ui.batchEditor.filters[target.dataset.field]=target.value;paintBatchPlan();}
  if(target.dataset.change==='batch-force'){ui.batchEditor.force=target.checked;try{await reloadBatchPlan();}catch(error){toast(error.message,true);}}
  if(target.dataset.change==='refine-part'){const part=ui.refineEditor?.options.parts.find(part=>part.id===target.value),direction=$('#refine-direction-'+target.dataset.index,dialog);direction.innerHTML=part?part.directions.map(item=>'<option value="'+escape(item.id)+'">'+escape(item.label)+'</option>').join(''):'<option value="">先选部位</option>';direction.disabled=!part;}
  if(target.dataset.change==='refine-brush'&&ui.refineEditor)ui.refineEditor.brush=Number(target.value);
  if (target.dataset.change === 'project') { chooseProject(target.value); reconcile(); render(); }
  if (target.dataset.change === 'library-style') { ui.libraryStyle = target.value; render(); }
  if (target.dataset.clothingFilter) { ui.clothingFilters[target.dataset.clothingFilter] = target.value; render(); }
  if (target.dataset.libraryFilter) { libraryFilterFor()[target.dataset.libraryFilter]=target.value; render(); }
  if (target.dataset.change==='head-target-project') updateHeadTargetOptions(true);
  if (target.dataset.change==='head-target-character') updateHeadTargetOptions(false);
  if (target.dataset.change === 'wear-project') { const project = state.projects.find(item => item.id === target.value); $('#wear-character').innerHTML = (project?.characters || []).map(character => `<option value="${escape(character.id)}">${escape(character.name)}</option>`).join(''); }
  if (target.dataset.change === 'identity-source') syncIdentitySourceControls();
  if (target.dataset.change === 'merge-source') await updateMergePreview(currentProject());
  if (target.dataset.change === 'image-project') $('#image-new-project').hidden = target.value !== 'new';
  if (target.dataset.change === 'requirement-chapter') { ui.requirementView.chapter = target.value; ui.requirementView.segment = ''; render(); }
  if (target.dataset.change === 'requirement-segment') { ui.requirementView.segment = target.value; render(); }
  if (target.dataset.change === 'requirement-missing') { ui.requirementView.missingOnly = target.checked; render(); }
  if (target.dataset.file === 'scripts') { try { await importScriptFiles(target.files); } catch (error) { toast(error.message, true); } }
  if (target.name === 'workflow-choice') { const automatic = target.value === 'auto'; const controls = $('#create-auto-start'); if (controls) { controls.hidden = !automatic; const checkbox = $('[name="startAuto"]', controls); checkbox.disabled = !automatic; if (!automatic) checkbox.checked = false; } const submit = $('#modal-form [type="submit"]'); if (submit && controls) submit.textContent = '创建项目'; }
  if (target.name === 'startAuto') { const submit = $('#modal-form [type="submit"]'); if (submit) submit.textContent = target.checked ? '创建并全自动制作' : '创建项目'; }
  if (target.dataset.file === 'reference') { const label = $('#reference-filenames'); if (label) label.textContent = [...target.files].map(file => file.name).join('、') || '未选择新图片。'; const name = $('#image-project-name'); if (name && !name.value.trim() && target.files[0]) name.value = target.files[0].name.replace(/\.[^.]+$/, ''); }
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'modal-form' && event.target.id !== 'runtime-form') return;
  event.preventDefault(); const form = event.target; const submit = $('[type="submit"]', form); submit.disabled = true;
  try {
    if (form.id === 'modal-form' && ui.modalSubmit) await ui.modalSubmit(form);
    else if (form.id === 'runtime-form') { const values = Object.fromEntries(new FormData(form)); const payload = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)); if (Object.keys(payload).length) await api('/api/settings', 'POST', payload); ui.runtimeDraft = null; state.runtime = await api('/api/runtime'); await refresh(true); toast('设置已保存。'); }
  } catch (error) { toast(error.message, true); }
  finally { if (submit.isConnected) { if(form.id==='modal-form' && ui.batchEditor && $('#batch-plan-list',dialog))paintBatchPlan();else submit.disabled = false; } }
});
document.addEventListener('input', event => {
  const target = event.target;
  if (target.name?.startsWith('gesture-')) { const key = draftKey(); ui.drafts[key] = { ...(ui.drafts[key] || {}), gestures: readGestures() }; }
  if (target.id === 'special-instructions') { const key = draftKey(); ui.drafts[key] = { ...(ui.drafts[key] || {}), specialInstructions: target.value }; }
  if (target.closest('#runtime-form')) ui.runtimeDraft = { codexPath: $('#codex-path').value, pythonPath: $('#python-path').value };
  if (target.id === 'project-name' && ui.projectFormState) ui.projectFormState.autoNameOwned = target.value === ui.projectFormState.inferredName;
  if (target.id === 'project-script' && ui.projectFormState) { const model = ui.projectFormState; model.script = target.value; model.chapters = []; model.rangeVerified = false; model.manualEdited = true; updateScriptImportView(model); }
  if (['range-start', 'range-end'].includes(target.id) && ui.projectFormState) { const model = ui.projectFormState; model.needsReread = model.sourceFiles.length > 0 && !sameReadRange(model, { rangeStart: Number($('#range-start')?.value), rangeEnd: Number($('#range-end')?.value) }); updateScriptImportView(model); }
  if (target.id === 'clothing-search') ui.clothingFilters.query = target.value;
  if (target.id==='head-library-search') libraryFilterFor().query=target.value;
});
document.addEventListener('keydown', event => { if(event.target.id==='head-library-search'&&event.key==='Enter'){event.preventDefault();libraryFilterFor().query=event.target.value.trim();render();return;} if (event.target.id === 'clothing-search' && event.key === 'Enter') { event.preventDefault(); ui.clothingFilters.query = event.target.value.trim(); render(); return; } const target = event.target.closest?.('.library-item,.face-candidate,[data-script-drop]'); if (target && ['Enter', ' '].includes(event.key) && !['INPUT', 'BUTTON', 'A'].includes(event.target.tagName)) { event.preventDefault(); target.click(); } });
document.addEventListener('dragover', event => { const zone = event.target.closest?.('[data-script-drop]'); if (zone) { event.preventDefault(); if (!ui.projectFormState?.importing) zone.classList.add('drag-over'); } });
document.addEventListener('dragleave', event => { const zone = event.target.closest?.('[data-script-drop]'); if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('drag-over'); });
document.addEventListener('drop', async event => { const zone = event.target.closest?.('[data-script-drop]'); if (zone) { event.preventDefault(); zone.classList.remove('drag-over'); try { await importScriptFiles(event.dataTransfer.files); } catch (error) { toast(error.message, true); } } });
dialog.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
dialog.addEventListener('click', event => { if (event.target === dialog) { const rectangle = dialog.getBoundingClientRect(); if (event.clientX < rectangle.left || event.clientX > rectangle.right || event.clientY < rectangle.top || event.clientY > rectangle.bottom) closeModal(); } });
document.addEventListener('focusout', () => { setTimeout(() => { if (ui.pendingRender && !dialog.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { render(); ui.pendingRender = false; } }, 100); });
window.addEventListener('online', () => refresh(true));
refresh(true);
setInterval(() => { if (!document.hidden) refresh(false); }, 3000);
