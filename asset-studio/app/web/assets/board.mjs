const CHARACTER = {
  width: 3840,
  height: 1890,
  scene: false,
  frames: [
    {id: 'face', label: '脸 + 发型', x: 32, y: 96, w: 900, h: 1762},
    {id: 'front', label: '正面', x: 960, y: 96, w: 700, h: 1680},
    {id: 'side', label: '3/4 侧', x: 1680, y: 96, w: 700, h: 1680},
    {id: 'back', label: '背面', x: 2400, y: 96, w: 700, h: 1680},
    {id: 'hands', label: '手部', x: 3140, y: 96, w: 668, h: 1200},
    {id: 'prop', label: '道具', x: 3140, y: 1320, w: 668, h: 538}
  ],
  aux: [
    {id: 'injury', label: '受伤状态'},
    {id: 'handprop', label: '手持道具'},
    {id: 'free', label: '自由上传'}
  ],
  labels: new Map([['front', '正面'], ['side', '四分之三侧面'], ['back', '背面']])
};

// 场景拼版：竖版 8:9，两幅 16:9 上下无缝拼接；上=正视图，下=反打。
const SCENE = {
  width: 1536,
  height: 1728,
  scene: true,
  frames: [
    {id: 'scene-front', label: '正视图 · 16:9', x: 0, y: 0, w: 1536, h: 864},
    {id: 'scene-reverse', label: '反打 · 16:9', x: 0, y: 864, w: 1536, h: 864}
  ],
  aux: [],
  labels: new Map()
};
const SCENE_FRONT = {...SCENE, height:864, frames:SCENE.frames.slice(0,1)};

const SINGLE_CARD={...CHARACTER,width:2048,height:1024,frames:[{id:'role-card',label:'完整普通人物角色卡',x:0,y:0,w:2048,h:1024}],aux:[],labels:new Map()};
let board = CHARACTER;
let W = board.width;
let H = board.height;
let FRAMES = board.frames;
let AUX = board.aux;
let labels = board.labels;
let built = false;

const state = {
  slots: new Map(),
  removed: new Set(),
  selected: null,
  drag: null,
  identity: null,
  costume: null,
  componentPhases: {},
  submitting: new Set(),
  loadedHashes: new Map(),
  busy: false
};

const panel = document.querySelector('#board-panel');
const grid = document.querySelector('#board-grid');
const auxGrid = document.querySelector('#aux-grid');
const status = document.querySelector('#board-status');

function setStatus(text) {
  status.textContent = text;
}

function slotOf(id) {
  return state.slots.get(id);
}

function applyTransform(slot) {
  const frame=FRAMES.find(f=>f.id===slot.el.dataset.id);
  const dx=frame?`${slot.ox/frame.w*100}%`:`${slot.ox}px`,dy=frame?`${slot.oy/frame.h*100}%`:`${slot.oy}px`;
  slot.imgEl.style.transform = `translate(-50%, -50%) translate(${dx}, ${dy}) scale(${slot.zoom})`;
}

function setSlotImage(id, image) {
  state.removed.delete(id);
  const slot = slotOf(id);
  slot.img = image;
  slot.manual=false;
  slot.zoom = 1;
  slot.ox = 0;
  slot.oy = 0;
  slot.imgEl.src = image.src;
  slot.imgEl.hidden = false;
  if (slot.emptyEl) slot.emptyEl.hidden = true;
  applyTransform(slot);
  updateComponentControls(id);
}

const productionComponent=id=>['front','side','back'].includes(id)?'views':id;
const componentActive=phase=>['queued','running','recoverable','awaiting_confirmation','delegated'].includes(phase?.status);
function updateComponentControls(id){
 const amend=document.querySelector('[data-component-revise="'+id+'"]');if(amend)amend.disabled=!state.slots.get(id)?.img;
  const slot=slotOf(id);if(!slot?.makeButton)return;
  const component=productionComponent(id),phase=state.componentPhases[component],sending=state.submitting.has(component),busy=sending||componentActive(phase);
  const label=sending?'正在提交…':({queued:'排队中',running:'生成中…',recoverable:'等待恢复',awaiting_confirmation:'等待确认',delegated:'执行中…'})[phase?.status];
  const existing=slot.img||phase?.jobId;
  const action=component==='views'?(existing?'重新生成三视图':'生成三视图'):(existing?'重新生成':'生成');
  for(const button of [slot.makeButton,slot.regenerateButton]){button.textContent=busy?label:action;button.disabled=busy;}
  slot.cancelButton.hidden=!componentActive(phase);slot.cancelButton.dataset.jobId=phase?.jobId||'';
  slot.phaseLabel.hidden=!phase&&!sending;slot.phaseLabel.dataset.status=phase?.status||'queued';slot.phaseLabel.title=phase?.message||'';
  slot.phaseLabel.textContent=sending?'正在提交…':({queued:'排队中',running:'生成中',done:'已完成',failed:'失败，可重试',cancelled:'已取消，可重试',recoverable:'等待恢复',awaiting_confirmation:'等待确认'})[phase?.status]||phase?.status||'';
}
export function setProductionComponentState(record,{submitting=[]}={}){state.componentPhases=record?.phases||{};state.submitting=new Set(submitting);for(const id of state.slots.keys())updateComponentControls(id);}

function loadFile(id, file) {
  if (!file) return;
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    setSlotImage(id, image);
    slotOf(id).manual=true;
    state.selected = id;
    markSelected();
    setStatus(`${id} 已载入`);
  };
  image.src = url;
}

function markSelected() {
  for (const [id, slot] of state.slots) {
    slot.el.classList.toggle('selected', id === state.selected);
  }
}

function closeMenus() {
  for (const slot of state.slots.values()) slot.actions.hidden = true;
}

function menu(id) {
  const slot = slotOf(id);
  const open = slot.actions.hidden;
  closeMenus();
  state.selected = id;
  markSelected();
  if (open) slot.actions.hidden = false;
}

function currentName() {
  const raw = document.querySelector('#board-title').value.trim() || '宋凌天｜灵剑峰内门道袍';
  const [name, ...rest] = raw.split('｜');
  return {name: name.trim() || '宋凌天', outfit: rest.join('｜').trim()};
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readIdentity() {
  const file = document.querySelector('#board-identity').files?.[0];
  if (file) state.identity = await fileToDataUrl(file);
  return state.identity;
}

async function readCostume() {
  const file = document.querySelector('#board-costume').files?.[0];
  if (file) state.costume = await fileToDataUrl(file);
  return state.costume;
}

async function blobImage(blob) {
  const image = new Image();
  const url = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = url;
  });
  return image;
}

async function waitJob(jobId) {
  for (let index = 0; index < 300; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const job = await (await fetch(`/api/jobs/${encodeURIComponent(jobId)}`)).json();
    if (['completed', 'failed', 'cancelled', 'partial'].includes(job.status)) return job;
  }
  return null;
}

async function fetchJobImage(jobId) {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/image`);
  if (!response.ok) throw new Error('拿不到生成图');
  return blobImage(await response.blob());
}

async function generate(id) {
  if (state.busy) return;
  if(window.assetProductionRecord?.legacy){setStatus('旧版整图没有独立组件；请点左侧“生成资产”建立可编辑的标准卡。');return;}
  if(window.assetProductionRecord&&!window.assetProductionRecord.legacy&&['face','front','side','back','hands','prop','scene-front','scene-reverse'].includes(id)){window.dispatchEvent(new CustomEvent('asset-production-component',{detail:{component:id}}));return;}
  const {name, outfit} = currentName();
  const identity = await readIdentity();
  const costume = await readCostume();
  if (id !== 'prop' && id !== 'free' && !identity) {
    setStatus('请先在“身份参考”里选一张标准卡');
    return;
  }
  state.busy = true;
  setStatus('提交生成…');
  try {
    if (id === 'free') {
      setStatus('自由上传：点“选择图片”，或选中槽位后按 Ctrl+V');
      return;
    }
    if (id === 'injury' || id === 'handprop') {
      const prompt = id === 'injury'
        ? `在已批准角色标准卡基础上，制作${name}的受伤状态：脸颊擦伤、嘴角血迹、手臂抓痕，衣摆轻微破损；严格锁脸、发型、服装和画风，只增加伤势，不换人。纯白背景，视线平视，无文字。`
        : `在已批准角色标准卡基础上，制作${name}的手部特写：右手无名指戴一枚素色戒指，手指自然弯曲，袖口与标准卡一致；严格锁手型、肤色、袖口和画风，不换人。纯白背景，无文字。`;
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          type: 'character',
          mode: 'state',
          reference: identity,
          costumeReference: costume || undefined,
          name,
          outfit,
          prompt,
          size: '1024x1536'
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '提交失败');
      const job = await waitJob(data.jobId);
      if (job?.status !== 'completed') throw new Error(job?.message || '生成失败');
      setSlotImage(id, await fetchJobImage(data.jobId));
      setStatus(`${id} 生成完成`);
      return;
    }
    if (id === 'face') {
      const response = await fetch('/api/face-closeup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name, reference: identity})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '提交失败');
      const job = await waitJob(data.jobId);
      if (job?.status !== 'completed') throw new Error(job?.message || '生成失败');
      setSlotImage('face', await fetchJobImage(data.jobId));
    } else if (id === 'hands') {
      const response = await fetch('/api/hand-card', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name, reference: identity, costumeReference: costume || undefined, size: '1024x1536'})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '提交失败');
      const job = await waitJob(data.jobId);
      if (job?.status !== 'completed') throw new Error(job?.message || '生成失败');
      setSlotImage('hands', await fetchJobImage(data.jobId));
    } else if (['front', 'side', 'back'].includes(id)) {
      const response = await fetch('/api/three-view', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name, outfit, reference: identity, costumeReference: costume || undefined})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '提交失败');
      const job = await waitJob(data.jobId);
      if (job?.status !== 'completed') throw new Error(job?.message || '生成失败');
      const sheet = await fetchJobImage(data.jobId);
      const parts = splitThreeView(sheet);
      const images = await Promise.all(parts.map(url => imageFromUrl(url)));
      setSlotImage('front', images[0]);
      setSlotImage('side', images[1]);
      setSlotImage('back', images[2]);
    } else if (id === 'prop') {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({type: 'prop', mode: 'text', name: `${name} 道具`, outfit, prompt: '道具资产设定图，纯白背景，正侧背或三视图，清晰材质与结构，无人物无场景无文字。', size: '1024x1536'})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '提交失败');
      const job = await waitJob(data.jobId);
      if (job?.status !== 'completed') throw new Error(job?.message || '生成失败');
      setSlotImage('prop', await fetchJobImage(data.jobId));
    }
    setStatus(`${id} 生成完成`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    state.busy = false;
  }
}

function splitThreeView(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const {data} = context.getImageData(0, 0, image.width, image.height);
  const width = image.width;
  const height = image.height;
  const occupied = new Array(width).fill(false);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const index = (y * width + x) * 4;
      if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) {
        occupied[x] = true;
        break;
      }
    }
  }
  const runs = [];
  let start = null;
  for (let x = 0; x < width; x += 1) {
    if (occupied[x] && start === null) start = x;
    if (!occupied[x] && start !== null) { runs.push([start, x]); start = null; }
  }
  if (start !== null) runs.push([start, width]);
  const merged = [];
  for (const run of runs) {
    if (merged.length && run[0] - merged[merged.length - 1][1] < 30) merged[merged.length - 1][1] = run[1];
    else merged.push([...run]);
  }
  const figures = merged.filter(run => run[1] - run[0] > 40);
  if (figures.length !== 3) throw new Error(`三视图检测到 ${figures.length} 个人物，需要重新生成`);
  return figures.map(([left, right]) => {
    let top = height, bottom = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = left; x < right; x += 1) {
        const index = (y * width + x) * 4;
        if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          break;
        }
      }
    }
    const pad = 12;
    const box = {
      x: Math.max(0, left - pad),
      y: Math.max(0, top - pad),
      w: Math.min(width, right + pad) - Math.max(0, left - pad),
      h: Math.min(height, bottom + pad) - Math.max(0, top - pad)
    };
    const out = document.createElement('canvas');
    out.width = box.w;
    out.height = box.h;
    out.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    return out.toDataURL('image/png');
  });
}

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('组件读取失败'));
    image.src = url;
  });
}

function draw(target, scale) {
  target.save();
  target.fillStyle = '#ffffff';
  target.fillRect(0, 0, W * scale, H * scale);
  if (!board.scene) {
    target.fillStyle = '#1c2a3a';
    target.font = `700 ${Math.round(56 * scale)}px "Microsoft YaHei", sans-serif`;
    target.textBaseline = 'top';
    target.fillText(document.querySelector('#board-title').value.trim(), 48 * scale, 18 * scale);
  }

  for (const frame of FRAMES) {
    const slot = slotOf(frame.id);
    if (!slot.img) continue;
    const base = (board.scene?Math.max:Math.min)(frame.w / slot.img.width, frame.h / slot.img.height);
    const zoom = base * slot.zoom;
    const dw = slot.img.width * zoom;
    const dh = slot.img.height * zoom;
    const dx = frame.x + (frame.w - dw) / 2 + slot.ox;
    const dy = frame.y + (frame.h - dh) / 2 + slot.oy;
    target.save();
    target.beginPath();
    target.rect(frame.x * scale, frame.y * scale, frame.w * scale, frame.h * scale);
    target.clip();
    target.drawImage(slot.img, dx * scale, dy * scale, dw * scale, dh * scale);
    target.restore();
  }

  for (const [id, label] of labels) {
    const frame = FRAMES.find(item => item.id === id);
    target.fillStyle = '#3c464e';
    target.font = `${Math.round(34 * scale)}px "Microsoft YaHei", sans-serif`;
    target.textAlign = 'center';
    target.textBaseline = 'top';
    target.fillText(label, (frame.x + frame.w / 2) * scale, 1800 * scale);
  }
  target.restore();
}

function fullCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  draw(canvas.getContext('2d'), 1);
  return canvas;
}

export function setBoardType(type, mode='both') {
  const next = type === 'scene' ? (mode==='front'?SCENE_FRONT:SCENE) : mode==='card'?SINGLE_CARD:CHARACTER;
  const canvas = document.querySelector('.board-canvas');
  canvas.classList.toggle('scene', next.scene);
  canvas.classList.toggle('scene-front-only', next===SCENE_FRONT);
  canvas.style.aspectRatio=next.width+' / '+next.height;
  document.querySelector('.board-dim').textContent = next.scene ? (next===SCENE_FRONT?'1536 × 864 · 仅正视图 · 16:9':'1536 × 1728 · 正视图 + 反打') : '3840 × 1890';
  sceneControls.hidden=!next.scene;
  sceneControls.querySelector('[data-scene-front-only]').hidden=next===SCENE_FRONT;
  sceneControls.querySelector('[data-scene-add-reverse]').hidden=next!==SCENE_FRONT;
  document.querySelector('.board-aux').hidden = next.scene;
  for (const el of document.querySelectorAll('.board-ref')) el.hidden = next.scene;
  const masterBind = document.querySelector('#scene-master-bind');
  if (masterBind) masterBind.hidden = !next.scene;
  if (next.scene) void loadSceneMasterOptions(window.assetProductionRecord?.name || '');
  document.querySelector('#board-sample').hidden = next.scene;
  if (next === board && built) return;
  board = next;
  W = board.width;
  H = board.height;
  FRAMES = board.frames;
  AUX = board.aux;
  labels = board.labels;
  build();
}

const sceneControls=document.createElement('span');sceneControls.id='scene-output-controls';sceneControls.hidden=true;
sceneControls.innerHTML='<button type="button" class="btn" data-scene-front-only>仅用正视图</button><button type="button" class="btn" data-scene-add-reverse>添加反打图</button>';
document.querySelector('.board-tools').append(sceneControls);
sceneControls.addEventListener('click',event=>{if(event.target.closest('button'))setSceneOutputMode(event.target.hasAttribute('data-scene-front-only')?'front':'both');});
export function setSceneOutputMode(mode){
 if(!board.scene||!['front','both'].includes(mode))return;
 const previous=new Map([...state.slots].map(([id,s])=>[id,{img:s.img,zoom:s.zoom,ox:s.ox,oy:s.oy,manual:s.manual}]));
 setBoardType('scene',mode);
 for(const [id,s]of previous){if(!s.img||!state.slots.has(id))continue;setSlotImage(id,s.img);Object.assign(slotOf(id),s);applyTransform(slotOf(id));}
 if(mode==='front'){state.removed.add('scene-reverse');state.loadedHashes.delete('scene-reverse');}else state.removed.delete('scene-reverse');
 setStatus(mode==='front'?'已移除反打，正在保存单张正视图…':'已添加空反打位；可上传图片或主动点击生成。');
 window.dispatchEvent(new CustomEvent('asset-production-scene-mode',{detail:{mode}}));
}

let masterScenes = null;
async function loadSceneMasterOptions(name) {
  const select = document.querySelector('#scene-master-scene');
  if (!select) return;
  if (!masterScenes) {
    try {
      const data = await (await fetch('/api/registry')).json();
      masterScenes = (data.assets || []).filter(asset => asset.type === 'scene');
      select.replaceChildren(...masterScenes.map(asset => new Option(`${asset.assetId} · ${asset.name}`, asset.assetId)));
    } catch {
      select.replaceChildren(new Option('台账读取失败', ''));
      return;
    }
  }
  if (name && select.options.length) {
    const hit = [...select.options].find(option => option.text.includes(name) || name.includes(option.text.split(' · ').at(-1) || ''));
    if (hit) select.value = hit.value;
  }
}

document.querySelector('#scene-master-save')?.addEventListener('click', async event => {
  const record = window.assetProductionRecord, select = document.querySelector('#scene-master-scene'), button = event.currentTarget;
  if (!record || record.type !== 'scene') return setStatus('先打开一条场景记录');
  if (!record.imageUrl) return setStatus('先保存场景图，单张正视图也可以设为主景');
  if (!select?.value) return setStatus('先在“主景绑定”里选择台账场景');
  button.disabled = true;
  setStatus('正在设为主景…');
  try {
    const response = await fetch('/api/scene-master', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({recordId: record.id, sceneAssetId: select.value})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '设为主景失败');
    masterScenes = null;
    setStatus(`已设为 ${data.sceneAssetId} 的主景 · ${data.editorId.slice(0, 8)}；下次从台账生成会带上这张`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
});

function build() {
  built = true;
  state.slots.clear();
  grid.replaceChildren();
  auxGrid.replaceChildren();
  for (const frame of [...FRAMES, ...AUX]) {
    const el = document.createElement('div');
    el.className = 'board-slot';
    el.dataset.id = frame.id;

    const img = document.createElement('img');
    img.alt = frame.label;
    img.hidden = true;

    const empty = document.createElement('span');
    empty.className = 'slot-empty';
    const emptyMark = document.createElement('b');
    emptyMark.textContent = '＋';
    const emptyLabel = document.createElement('small');
    emptyLabel.textContent = frame.label;
    empty.append(emptyMark, emptyLabel);

    const name = document.createElement('span');
    name.className = 'slot-name';
    name.textContent = frame.label;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot-menu';
    button.textContent = '⋯';
    button.addEventListener('click', event => {
      event.stopPropagation();
      menu(frame.id);
    });

    const actions = document.createElement('div');
    actions.className = 'slot-actions';
    actions.hidden = true;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.hidden = true;
    input.addEventListener('change', () => loadFile(frame.id, input.files?.[0]));

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.textContent = '选择图片';
    choose.addEventListener('click', event => { event.stopPropagation(); closeMenus(); input.click(); });

    const paste = document.createElement('button');
    paste.type = 'button';
    paste.textContent = '粘贴';
    paste.addEventListener('click', async event => {
      event.stopPropagation();
      closeMenus();
      state.selected = frame.id;
      markSelected();
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find(value => value.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            loadFile(frame.id, new File([blob], 'paste.png', {type}));
            return;
          }
        }
        setStatus('剪贴板里没有图片');
      } catch {
        setStatus('浏览器不允许读剪贴板；点一下槽位后按 Ctrl+V');
      }
    });

    const make = document.createElement('button');
    make.type = 'button';
    make.textContent = '生成';
    make.dataset.componentGenerate=frame.id;
    make.addEventListener('click', event => { event.stopPropagation(); closeMenus(); generate(frame.id); });
    const regenerate=document.createElement('button');regenerate.type='button';regenerate.className='component-regenerate';regenerate.dataset.componentRegenerate=frame.id;regenerate.textContent='生成';regenerate.addEventListener('click',event=>{event.stopPropagation();closeMenus();generate(frame.id);});
    const phaseLabel=document.createElement('span');phaseLabel.className='component-phase';phaseLabel.dataset.componentStatus=frame.id;phaseLabel.hidden=true;
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消任务';cancel.hidden=true;cancel.addEventListener('click',event=>{event.stopPropagation();closeMenus();window.dispatchEvent(new CustomEvent('asset-production-component',{detail:{component:frame.id,action:'cancel',jobId:cancel.dataset.jobId}}));});

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = '重置';
    reset.addEventListener('click', event => {
      event.stopPropagation();
      closeMenus();
      const slot = slotOf(frame.id);
      slot.zoom = 1;
      slot.ox = 0;
      slot.oy = 0;
      applyTransform(slot);
    });

    const remove=document.createElement('button');remove.type='button';remove.dataset.removeComponent=frame.id;remove.textContent=frame.id==='scene-reverse'?'移除反打，仅用正视图':'移除组件';remove.addEventListener('click',event=>{event.stopPropagation();closeMenus();if(frame.id==='scene-reverse'){setSceneOutputMode('front');return;}const slot=slotOf(frame.id);slot.img=null;slot.imgEl.hidden=true;if(slot.emptyEl)slot.emptyEl.hidden=false;state.removed.add(frame.id);setStatus('组件已移除，点击“保存拼版编辑”保留修改。');});
    const amend=document.createElement('button');amend.type='button';amend.textContent='修改意见 / 圈注';amend.dataset.componentRevise=frame.id;amend.addEventListener('click',event=>{event.stopPropagation();closeMenus();window.dispatchEvent(new CustomEvent('asset-production-revise',{detail:{component:frame.id}}));});
    actions.append(choose, paste, amend, make, cancel, reset, remove);
    el.append(img, empty, name, button, actions, input,regenerate,phaseLabel);

    el.addEventListener('pointerdown', event => {
      if (event.target.closest('button') || event.target.closest('.slot-actions')) return;
      closeMenus();
      state.selected = frame.id;
      markSelected();
      const slot = slotOf(frame.id);
      state.drag = {id: frame.id, x: event.clientX, y: event.clientY, ox: slot.ox, oy: slot.oy};
      el.setPointerCapture(event.pointerId);
    });

    el.addEventListener('pointermove', event => {
      if (!state.drag || state.drag.id !== frame.id) return;
      const slot = slotOf(frame.id);
      slot.ox = state.drag.ox + (event.clientX - state.drag.x)*(FRAMES.includes(frame)?frame.w/el.clientWidth:1);
      slot.oy = state.drag.oy + (event.clientY - state.drag.y)*(FRAMES.includes(frame)?frame.h/el.clientHeight:1);
      applyTransform(slot);
    });

    el.addEventListener('pointerup', event => {
      state.drag = null;
      try { el.releasePointerCapture(event.pointerId); } catch {}
    });

    el.addEventListener('wheel', event => {
      const slot = slotOf(frame.id);
      event.preventDefault();
      slot.zoom = Math.min(8, Math.max(0.2, slot.zoom * Math.exp(-event.deltaY * 0.0012)));
      state.selected = frame.id;
      markSelected();
      applyTransform(slot);
    }, {passive: false});

    const target = FRAMES.some(item => item.id === frame.id) ? grid : auxGrid;
    target.append(el);
    state.slots.set(frame.id, {el, imgEl: img, emptyEl: empty, img: null, zoom: 1, ox: 0, oy: 0, actions,makeButton:make,regenerateButton:regenerate,cancelButton:cancel,phaseLabel});
  }
}

document.addEventListener('paste', event => {
  if (!state.selected) return;
  const item = [...(event.clipboardData?.items || [])].find(entry => entry.type.startsWith('image/'));
  if (!item) return;
  const file = item.getAsFile();
  if (!file) return;
  event.preventDefault();
  loadFile(state.selected, file);
});

document.querySelector('#board-expand').addEventListener('click', event => {
  panel.classList.toggle('expanded');
  event.currentTarget.textContent = panel.classList.contains('expanded') ? '还原' : '放大';
});

document.querySelector('#board-sample').addEventListener('click', async () => {  setStatus('加载示例…');
  try {
    await Promise.all(['face', 'front', 'side', 'back', 'hands'].map(async id => {
      const response = await fetch(`/api/compose-sample?name=${id}`);
      if (!response.ok) throw new Error(id);
      setSlotImage(id, await blobImage(await response.blob()));
    }));
    setStatus('示例已加载');
  } catch {
    setStatus('示例组件不完整');
  }
});

document.querySelector('#board-export').addEventListener('click', () => {
  const canvas = fullCanvas();
  canvas.toBlob(blob => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `拼版_${W}x${H}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, 'image/png');
});

document.querySelector('#board-save').addEventListener('click', async () => {
  const button = document.querySelector('#board-save');
  button.disabled = true;
  setStatus('正在保存…');
  try {
    if(window.assetProductionRecord){const response=await fetch('/api/production-records/'+window.assetProductionRecord.id+'/board',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(serializeProductionBoard())});const record=await response.json();if(!response.ok)throw Error(record.error||'拼版记录保存失败');window.assetProductionRecord=record;window.dispatchEvent(new CustomEvent('asset-production-board-saved',{detail:record}));}
    const {name, outfit} = currentName();
    const data = fullCanvas().toDataURL('image/png');
    const response = await fetch('/api/compose-save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({data, name, outfit,type:board.scene?'scene':'character'})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '保存失败');
    setStatus(`已保存 · 主工作台 ${result.assetId.slice(0, 8)}${result.moku?.assetId ? ` · 墨库 ${result.moku.assetId.slice(0, 8)}` : ''}`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
});

build();

document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.board-slot')) closeMenus();
});

const params = new URLSearchParams(location.search);
if (params.has('sample')) document.querySelector('#board-sample').click();

export async function loadProductionBoard(r,{incremental=false}={}){
 setBoardType(r.type,r.characterOutputMode==='card'?'card':r.sceneOutputMode||'both');
 if(!incremental){state.removed.clear();state.loadedHashes.clear();state.identity=null;state.costume=null;document.querySelector('#board-identity').value='';document.querySelector('#board-costume').value='';for(const [id,slot]of state.slots){slot.img=null;slot.imgEl.hidden=true;if(slot.emptyEl)slot.emptyEl.hidden=false;slot.zoom=1;slot.ox=slot.oy=0;}}
 for(const [id,value]of Object.entries(r.slots||{})){
  // 旧记录只有一张 3:2 场景图时，先把它放进正视图位，方便直接补反打。
  const target=r.type==='scene'&&id==='scene'?'scene-front':id;
  if(!state.slots.has(target)||incremental&&state.loadedHashes.get(target)===value.sha256)continue;
  const img=await imageFromUrl(value.url+'&v='+encodeURIComponent(value.sha256||r.updatedAt||r.createdAt));setSlotImage(target,img);state.loadedHashes.set(target,value.sha256);Object.assign(slotOf(target),{zoom:value.zoom??1,ox:value.ox??0,oy:value.oy??0});applyTransform(slotOf(target));
 }
 if(r.type==='scene'&&r.sceneOutputMode==='front')state.removed.add('scene-reverse');
 if(!incremental&&r.references?.[0]){const response=await fetch(r.references[0]);state.identity=await fileToDataUrl(await response.blob());}
 if(!incremental&&r.references?.[1]){const response=await fetch(r.references[1]);state.costume=await fileToDataUrl(await response.blob());}
 setProductionComponentState(r);
 const scene=r.type==='scene',upgraded=Array.isArray(r.components)&&r.components.length===2,hasReverse=Boolean(r.slots?.['scene-reverse']);
 if(scene&&r.sceneOutputMode==='front'){setStatus('仅使用正视图 · 1536×864；可上传替换、导出和保存入库。');return;}
 setStatus(r.legacy?'旧版整图已保留在自由上传栏；可按标准模板重新生成组件。':r.status==='completed'?(scene?(upgraded&&hasReverse?'1536×1728 场景拼版：上正视图、下反打，各 16:9；可拖动、缩放、更换图片并保存。':upgraded?'正视图已完成；点反打“生成”补齐下半张。':'旧版只有一张 3:2 场景图；点正视图“重新生成”会补齐 16:9 正视图 + 反打。'):'3840×1890 标准拼版；可拖动组件、缩放、更换图片并保存。'):r.status==='failed'?(scene?'部分场景图未完成；已有图片保留，可单独重试。':'部分组件未完成；已有组件可继续编辑、保存，缺少的组件可单独重试。'):(scene?'先生成正视图，完成后自动以它为唯一参考生成反打，再拼成竖版。':'组件生成中，完成后自动载入拼版。'));
}
export function serializeProductionBoard(){return {title:document.querySelector('#board-title').value,...(board.scene?{sceneOutputMode:board===SCENE_FRONT?'front':'both'}:{}),slots:Object.fromEntries([...state.removed].map(id=>[id,{remove:true}]).concat([...state.slots].filter(([,s])=>s.img).map(([id,s])=>{if(state.loadedHashes.has(id)&&!s.manual)return [id,{zoom:s.zoom,ox:s.ox,oy:s.oy}];const c=document.createElement('canvas');c.width=s.img.naturalWidth||s.img.width;c.height=s.img.naturalHeight||s.img.height;c.getContext('2d').drawImage(s.img,0,0);return [id,{data:c.toDataURL('image/png'),zoom:s.zoom,ox:s.ox,oy:s.oy,...(s.manual?{manual:true}:{})}];}))) };}
