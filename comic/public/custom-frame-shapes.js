import {validPolygon,polygonFor,shapePresets} from './model.js';
export const CUSTOM_FRAME_SHAPES_KEY='comic-custom-frame-shapes-v1';
const MAX_SHAPES=100,clone=value=>structuredClone(value),listeners=new Set();
const error=message=>new Error(message);
export function frameShapeStorage(){try{return globalThis.localStorage||null;}catch{return null;}}
export function validateCustomFramePoints(points){
 if(!Array.isArray(points)||points.length<3||points.length>64)throw error('轮廓需要3–64个节点');
 if(points.some(p=>!p||typeof p!=='object'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>8||Math.abs(p.y)>8))throw error('节点坐标需为有效数值，范围为 -800%—800%');
 if(!validPolygon(points))throw error('轮廓不能自交、重叠或退化；相邻节点不能过近');
 return points.map(p=>({x:p.x,y:p.y}));
}
function nameValue(value){if(typeof value!=='string'||!value.trim()||value.trim().length>80)throw error('请输入1–80字的形状名称');return value.trim();}
const basePreset=id=>shapePresets.find(p=>p.id===id);
const effectivePreset=(preset,overrides)=>({id:preset.id,label:preset.label,name:overrides[preset.id]?.name||preset.label,points:clone(overrides[preset.id]?.points||polygonFor(preset.id)),overridden:!!overrides[preset.id]});
function readLibrary(storage,key){
 if(!storage)return {version:1,items:[],overrides:{}};const raw=storage.getItem(key);if(!raw)return {version:1,items:[],overrides:{}};
 let parsed;try{parsed=JSON.parse(raw);}catch{throw error('自定义形状库无法读取，原数据已保留');}
 if(!parsed||parsed.version!==1||!Array.isArray(parsed.items)||parsed.items.length>MAX_SHAPES)throw error('自定义形状库格式无效，原数据已保留');
 const overrides={};if(parsed.overrides!==undefined){if(!parsed.overrides||typeof parsed.overrides!=='object'||Array.isArray(parsed.overrides)||Object.keys(parsed.overrides).some(id=>!basePreset(id)))throw error('常用形状覆盖记录无效，原数据已保留');for(const [id,item] of Object.entries(parsed.overrides)){if(!item||typeof item!=='object')throw error('常用形状覆盖记录无效，原数据已保留');overrides[id]={name:nameValue(item.name),points:validateCustomFramePoints(item.points),updatedAt:typeof item.updatedAt==='string'?item.updatedAt:''};}}
 const ids=new Set();return {version:1,overrides,items:parsed.items.map(item=>{if(!item||typeof item.id!=='string'||!/^custom-shape:[0-9a-f-]{36}$/u.test(item.id)||ids.has(item.id))throw error('自定义形状编号无效，原数据已保留');ids.add(item.id);return {id:item.id,name:nameValue(item.name),points:validateCustomFramePoints(item.points),createdAt:typeof item.createdAt==='string'?item.createdAt:'',updatedAt:typeof item.updatedAt==='string'?item.updatedAt:''};})};
}
/** A successful setItem is the commit point; invalid/quota-failed edits never replace the saved library. */
export function createCustomFrameShapeLibrary({storage=frameShapeStorage(),key=CUSTOM_FRAME_SHAPES_KEY,now=()=>new Date().toISOString(),makeId=()=>globalThis.crypto.randomUUID()}={}){
 const read=()=>readLibrary(storage,key),write=value=>{if(!storage)throw error('当前浏览器不允许本地保存；形状尚未写入');try{storage.setItem(key,JSON.stringify(value));}catch{throw error('自定义形状未能保存，本地空间不足或存储被限制；原库保持');}for(const listener of listeners)if(listener.storage===storage&&listener.key===key)try{listener.fn();}catch{}return clone(value);};
 return {
  list:()=>clone(read().items),get:id=>clone(read().items.find(item=>item.id===id)||null),
  presets(){const library=read();return shapePresets.map(p=>effectivePreset(p,library.overrides));},
  getPreset(id){const preset=basePreset(id);if(!preset)throw error('常用形状不存在');return effectivePreset(preset,read().overrides);},
  setPresetOverride(id,{name,points}){const preset=basePreset(id);if(!preset)throw error('只能覆盖六个常用形状槽位');const library=read(),item={name:nameValue(name??library.overrides[id]?.name??preset.label),points:validateCustomFramePoints(points),updatedAt:now()};library.overrides[id]=item;write(library);return effectivePreset(preset,library.overrides);},
  restorePreset(id){const preset=basePreset(id);if(!preset)throw error('只能恢复六个常用形状');const library=read();if(library.overrides[id]){delete library.overrides[id];write(library);}return effectivePreset(preset,library.overrides);},
  create(name,points){const library=read(),item={id:'custom-shape:'+makeId(),name:nameValue(name),points:validateCustomFramePoints(points),createdAt:now(),updatedAt:now()};if(library.items.length>=MAX_SHAPES)throw error('自定义形状最多100款，请先整理形状库');if(library.items.some(v=>v.id===item.id)||!/^custom-shape:[0-9a-f-]{36}$/u.test(item.id))throw error('自定义形状编号无效');library.items.push(item);write(library);return clone(item);},
  update(id,{name,points}){const library=read(),index=library.items.findIndex(item=>item.id===id);if(index<0)throw error('自定义形状不存在');const previous=library.items[index],item={...previous,name:name===undefined?previous.name:nameValue(name),points:points===undefined?clone(previous.points):validateCustomFramePoints(points),updatedAt:now()};library.items[index]=item;write(library);return clone(item);},
  remove(id){const library=read(),index=library.items.findIndex(item=>item.id===id);if(index<0)throw error('只能删除已保存的自定义形状，六种基础形状保持');library.items.splice(index,1);write(library);},
  subscribe(fn){const listener={storage,key,fn};listeners.add(listener);return ()=>listeners.delete(listener);},
  key
 };
}
/** The overwrite selector accepts a standard slot as well as a previously saved custom shape. */
export function overwriteFrameShapeTarget(library,targetId,value){return basePreset(targetId)?library.setPresetOverride(targetId,value):library.update(targetId,value);}
/** Choosing where to save must not replace the current edited outline with the target's old outline. */
export function selectFrameShapeOverwriteTarget(library,state,targetId){
 const item=basePreset(targetId)?library.getPreset(targetId):library.get(targetId);if(!item)throw error('覆盖目标不存在');
 return {...state,targetId,draft:clone(state.draft),draftName:state.nameEdited?state.draftName:item.name};
}
export function frameShapeTargetOptions(library,selectedId,{escape=escapeDefault}={}){
 const presets=library.presets(),items=library.list();return `<optgroup label="六个常用形状">${presets.map((p,i)=>`<option value="${p.id}" ${selectedId===p.id?'selected':''}>${i+1} · ${escape(p.label)}${p.overridden?'（已覆盖：'+escape(p.name)+'）':''}</option>`).join('')}</optgroup><optgroup label="已保存自定义形状">${items.map(p=>`<option value="${escape(p.id)}" ${selectedId===p.id?'selected':''}>${escape(p.name)}</option>`).join('')||'<option disabled>尚无自定义款，也可直接覆盖上方常用形状</option>'}</optgroup>`;
}
/** Only points change: image crop, source, dimensions, positions and lettering are untouched. */
export function applyFrameShape(frame,value,library){
 if(!frame||frame.locked)throw error('请先选中并解锁格子');let points;
 if(typeof value==='object'&&value!==null)points=value.points;
 else if(shapePresets.some(item=>item.id===value))points=library?library.getPreset(value).points:polygonFor(value);
 else if(typeof value==='string'&&value.startsWith('custom-shape:'))points=library?.get(value)?.points;
 if(!points)throw error('画格形状不存在');const valid=validateCustomFramePoints(points);frame.points=valid;return frame;
}
export function customFrameShapeIcon(points,{width=26,height=22}={}){
 const valid=validateCustomFramePoints(points),xs=valid.map(p=>p.x),ys=valid.map(p=>p.y),left=Math.min(...xs),top=Math.min(...ys),w=Math.max(...xs)-left,h=Math.max(...ys)-top,scale=Math.min((width-6)/w,(height-6)/h),dx=(width-w*scale)/2,dy=(height-h*scale)/2;
 const path=valid.map((p,i)=>(i?'L':'M')+(dx+(p.x-left)*scale).toFixed(2)+' '+(dy+(p.y-top)*scale).toFixed(2)).join(' ')+' Z';
 return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}
const escapeDefault=value=>String(value??'').replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function customFrameShapeButtons(items,{escape=escapeDefault}={}){
 return items.map(item=>`<button type="button" data-custom-frame-shape="${escape(item.id)}" aria-label="${escape(item.name)}自定义画格" title="${escape(item.name)} · 点击应用并编辑节点">${customFrameShapeIcon(item.points)}</button>`).join('');
}
export function customFrameNodeMarkup(points){
 return points.map((p,i)=>`<div class="custom-frame-node-row" style="display:grid;grid-template-columns:36px 1fr 1fr 36px;gap:6px;align-items:center"><small>${i+1}</small><input style="min-width:0;width:100%" type="number" step="0.1" min="-800" max="800" data-custom-node="${i}" data-custom-axis="x" aria-label="节点${i+1}横坐标百分比" value="${Number((p.x*100).toFixed(4))}"><input style="min-width:0;width:100%" type="number" step="0.1" min="-800" max="800" data-custom-node="${i}" data-custom-axis="y" aria-label="节点${i+1}纵坐标百分比" value="${Number((p.y*100).toFixed(4))}"><button type="button" data-custom-node-delete="${i}" aria-label="删除节点${i+1}" ${points.length<=3?'disabled':''}>×</button></div>`).join('');
}
export function addCustomFrameNode(points,index){
 const valid=validateCustomFramePoints(points);if(valid.length>=64)throw error('最多64个节点');
 if(index===undefined){let longest=-1;for(let i=0;i<valid.length;i++){const next=valid[(i+1)%valid.length],distance=Math.hypot(valid[i].x-next.x,valid[i].y-next.y);if(distance>longest){longest=distance;index=i;}}}
 if(!Number.isInteger(index)||index<0||index>=valid.length)throw error('节点位置无效');const a=valid[index],b=valid[(index+1)%valid.length];valid.splice(index+1,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});return validateCustomFramePoints(valid);
}
export function removeCustomFrameNode(points,index){const valid=validateCustomFramePoints(points);if(valid.length<=3)throw error('至少保留3个节点');if(!Number.isInteger(index)||index<0||index>=valid.length)throw error('节点位置无效');valid.splice(index,1);return validateCustomFramePoints(valid);}
/** The canvas remains the main free-node editor. This modal also allows precise coordinate edits. */
export function openCustomFrameShapes({library=createCustomFrameShapeLibrary(),getTarget,onApply,onEditNodes=()=>{},modal,closeModal,escape=escapeDefault,toast=()=>{},initialId,onChange=()=>{}}){
 const target=getTarget();if(!target?.item)throw error('请先选中一个格子');if(target.item.locked)throw error('请先解锁格子');const targetId=target.item.id;
 let selectedId=initialId||null,draft=validateCustomFramePoints(target.item.points),draftName='我的画格形状',nameEdited=false,fallback=null,host;
 const current=()=>{const active=getTarget();if(active?.item?.id!==targetId)throw error('选中的格子已变化，请重新打开形状库');if(active.item.locked)throw error('当前格子已锁定');return active.item;};
 const close=()=>{if(fallback){fallback.close();fallback.remove();}else closeModal?.();};
 const targets=[...library.presets(),...library.list()];if(!targets.some(p=>p.id===selectedId))selectedId=targets.find(p=>JSON.stringify(p.points)===JSON.stringify(draft))?.id||'rectangle';
 const targetShape=()=>basePreset(selectedId)?library.getPreset(selectedId):library.get(selectedId);const initial=targetShape();if(initial)draftName=initial.name;
 const render=()=>{
  const items=library.list(),standard=!!basePreset(selectedId),overridden=standard&&library.getPreset(selectedId).overridden;host.innerHTML=`<p class="sub-note">选择要覆盖的常用图标或自定义款，再保存当前轮廓。六个常用槽位可恢复默认；已经应用的画格保持原样。</p><label>覆盖目标<select data-custom-overwrite-target aria-label="覆盖目标">${frameShapeTargetOptions(library,selectedId,{escape})}</select></label><div class="custom-frame-shape-list" style="display:flex;gap:6px;flex-wrap:wrap;max-height:120px;overflow:auto">${items.map(item=>`<button type="button" data-custom-select="${escape(item.id)}" aria-pressed="${item.id===selectedId}" style="display:flex;align-items:center;gap:6px;${item.id===selectedId?'background:#2c5976;color:#eef7ff;':''}"><span style="width:30px;height:24px;display:block">${customFrameShapeIcon(item.points)}</span>${escape(item.name)}</button>`).join('')||'<small>还没有自定义款，也可以直接覆盖上方六个常用形状。</small>'}</div><label>形状名称<input data-custom-name maxlength="80" value="${escape(draftName)}"></label><div class="custom-frame-preview" style="width:100px;height:78px;margin:8px auto">${customFrameShapeIcon(draft,{width:100,height:78})}</div><div class="row" style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" data-custom-action="capture">用当前轮廓</button><button type="button" data-custom-action="load">载入目标轮廓</button><button type="button" data-custom-action="apply">应用并编辑节点</button></div><details><summary>节点坐标（百分比） · ${draft.length} 点</summary><div style="max-height:230px;overflow:auto;display:grid;gap:5px" data-custom-nodes>${customFrameNodeMarkup(draft)}</div><button type="button" data-custom-action="add" ${draft.length>=64?'disabled':''}>增加节点</button></details><p data-custom-status role="status" class="sub-note"></p><div class="row" style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="primary" data-custom-action="create">保存为新形状</button><button type="button" data-custom-action="update">保存覆盖所选目标</button><button type="button" data-custom-action="restore" ${!overridden?'disabled':''}>恢复所选默认形状</button><button type="button" data-custom-action="delete" ${standard?'disabled':''}>删除所选自定义款</button></div>`;
 };
 const status=(message,bad=false)=>{const node=host.querySelector('[data-custom-status]');if(node){node.textContent=message;node.style.color=bad?'#f1b3a6':'';}};
 if(modal&&closeModal){modal('自定义画格形状','<section data-custom-frame-manager></section>',[{label:'关闭',run:close}]);host=document.querySelector('[data-custom-frame-manager]');}
 else{fallback=document.createElement('dialog');fallback.setAttribute('aria-label','自定义画格形状');fallback.style.cssText='width:min(620px,calc(100vw - 24px));max-height:85vh;overflow:auto;background:#172633;color:#e7f0f8;border:1px solid #49657d;border-radius:10px;padding:18px';fallback.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center"><strong>自定义画格形状</strong><button type="button" data-custom-close aria-label="关闭自定义形状库">×</button></div><section data-custom-frame-manager></section>';document.body.append(fallback);host=fallback.querySelector('[data-custom-frame-manager]');fallback.querySelector('[data-custom-close]').addEventListener('click',close);fallback.addEventListener('cancel',()=>fallback.remove(),{once:true});fallback.showModal();}
 if(!host)throw error('形状库界面无法打开');render();
 const chooseTarget=next=>{const state=selectFrameShapeOverwriteTarget(library,{targetId:selectedId,draft,draftName,nameEdited},next);selectedId=state.targetId;draft=state.draft;draftName=state.draftName;render();status('已切换覆盖目标；当前草稿轮廓保持，点击保存覆盖后才写入。');};
 host.addEventListener('change',event=>{if(!event.target.matches('[data-custom-overwrite-target]'))return;try{chooseTarget(event.target.value);}catch(e){status(e.message,true);toast(e.message,true);}});
 host.addEventListener('input',event=>{
  if(event.target.matches('[data-custom-name]')){draftName=event.target.value;nameEdited=true;return;}
  const input=event.target;if(!input.matches('[data-custom-node]'))return;const index=Number(input.dataset.customNode),axis=input.dataset.customAxis;draft[index][axis]=input.valueAsNumber/100;
  try{validateCustomFramePoints(draft);host.querySelector('.custom-frame-preview').innerHTML=customFrameShapeIcon(draft,{width:100,height:78});status('轮廓有效；点击保存后才更新形状库。');}catch(e){status(e.message,true);}
 });
 host.addEventListener('click',event=>{
  try{const select=event.target.closest('[data-custom-select]');if(select){chooseTarget(select.dataset.customSelect);return;}
   const deletion=event.target.closest('[data-custom-node-delete]');if(deletion){draft=removeCustomFrameNode(draft,Number(deletion.dataset.customNodeDelete));render();return;}
   const button=event.target.closest('[data-custom-action]');if(!button||button.disabled)return;const action=button.dataset.customAction;
   if(action==='capture'){draft=validateCustomFramePoints(current().points);render();status('已读取当前轮廓，尚未覆盖保存。');}
   else if(action==='load'){const item=targetShape();if(!item)throw error('覆盖目标不存在');draft=item.points;draftName=item.name;nameEdited=false;render();status('已载入所选目标，可编辑节点后保存覆盖。');}
   else if(action==='add'){draft=addCustomFrameNode(draft);render();}
   else if(action==='create'){const item=library.create(draftName,draft);selectedId=item.id;draft=item.points;draftName=item.name;nameEdited=false;onChange(item);render();status('已保存，可在任意画格复用。');toast('自定义形状已保存');}
   else if(action==='update'){const item=overwriteFrameShapeTarget(library,selectedId,{name:draftName,points:draft});onChange(item);render();status('已覆盖所选目标，主栏对应图标已更新；已经应用的画格保持原轮廓。');toast('所选形状已覆盖');}
   else if(action==='restore'){const item=library.restorePreset(selectedId);draft=item.points;draftName=item.name;nameEdited=false;onChange(item);render();status('已恢复该常用图标默认形状，已应用的画格保持。');}
   else if(action==='delete'){library.remove(selectedId);selectedId='rectangle';onChange(null);render();status('已删除自定义款式，已应用的画格保持。');}
   else if(action==='apply'){current();const points=validateCustomFramePoints(draft),item={id:selectedId||'custom-draft',name:nameValue(draftName),points};onApply(item);onChange(item);close();onEditNodes();toast('已应用轮廓，可拖动自由点；其他内容保持');}
  }catch(e){status(e.message,true);toast(e.message,true);}
 });
 return {close};
}
