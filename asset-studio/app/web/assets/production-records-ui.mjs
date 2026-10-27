import {mountQuickRevision} from './quick-revision-ui.mjs';
import {productionRecordGroups} from './production-record-groups.mjs';
import {mountProductionRevisions} from './production-revisions-ui.mjs';
import {loadProductionConfig,productionConfig} from './app.mjs';
import {loadProductionBoard,serializeProductionBoard,setProductionComponentState} from './board.mjs';

const $=s=>document.querySelector(s);
const labels={queued:'已排队',running:'组件生成中',completed:'可编辑',editing:'待补图',failed:'失败',legacy:'旧版整图'};
const componentLabels={'role-card':'整张角色卡',face:'脸部',views:'三视图',hands:'手部',prop:'道具配饰',scene:'场景','scene-front':'场景正视图','scene-reverse':'场景反打'};
const active=p=>['queued','running','recoverable','awaiting_confirmation','delegated'].includes(p?.status);
const componentOf=id=>['front','side','back'].includes(id)?'views':id;
let current=null,items=[],timer=null,opening=0,historyGroupId=null,historyTrashMode=false;
const submitting=new Set();
const revisionUI=mountProductionRevisions({getCurrent:()=>current,saveCurrent,openRecord:open,note:text=>note(text)});
const quickRevision=mountQuickRevision({getCurrent:()=>current,saveCurrent,openRecord:open});

const box=document.createElement('section');
box.id='production-history';
box.innerHTML='<strong>最近生成</strong><div data-production-records></div><p data-production-status role="status" aria-live="polite"></p><details data-production-error hidden><summary>查看失败原因</summary><p></p></details>';
$('.form-card').insertBefore(box,$('.form-card').children[1]);
const sceneSource=document.createElement('div');
sceneSource.id='scene-source';sceneSource.hidden=true;
document.querySelector('#outfit-field').closest('.form-grid').after(sceneSource);
function renderSceneSource(r){
 const scene=r?.type==='scene'?r.source?.scene:null;
 if(!scene){sceneSource.hidden=true;sceneSource.replaceChildren();return;}
 sceneSource.hidden=false;sceneSource.replaceChildren();
 const kind={field:'分镜表字段',prompt:'正文地名',continuous:'沿用上一格',undefined:'未标注'}[scene.kind]||scene.kind||'未知';
 const confirmed=!!r.source?.sceneConfirmed,line=document.createElement('p'),b=document.createElement('b');
 b.textContent='场景来源 ';line.append(b,document.createTextNode(`${scene.sourceCode||'—'} · ${kind}`));
 if(scene.kind==='continuous'&&!confirmed){const flag=document.createElement('em');flag.textContent='待核对';line.append(flag);}
 sceneSource.append(line);
 const quote=document.createElement('small');quote.textContent=scene.quote?('“'+scene.quote+'”'):(scene.note||'');if(quote.textContent)sceneSource.append(quote);
 if(scene.kind==='continuous'&&!confirmed){
  const button=document.createElement('button');button.type='button';button.textContent='确认场景无误';
  button.onclick=async()=>{button.disabled=true;try{const next=await api('/api/production-records/'+r.id+'/source',{sceneConfirmed:true});remember(next);renderSceneSource(next);note('场景来源已确认。');}catch(e){note('确认失败：'+e.message);button.disabled=false;}};
  sceneSource.append(button);
 }
 const tip=document.createElement('small');tip.textContent='如果实际不是这个场景：改上面的“名称”后点“生成资产”，会按新场景重建。';sceneSource.append(tip);
}
const dialog=document.createElement('dialog');
dialog.id='production-history-dialog';dialog.setAttribute('aria-labelledby','production-history-title');
dialog.innerHTML='<header><div><h2 id="production-history-title">生成记录</h2><p>查看任务状态，打开记录继续编辑</p></div><button type="button" data-history-close aria-label="关闭生成记录">×</button></header><div class="history-search"><input type="search" placeholder="搜索名称、服装或状态" aria-label="搜索生成记录"><button type="button" data-history-refresh>刷新</button></div><p data-history-message role="status"></p><div class="history-record-grid"></div>';
document.body.append(dialog);
const style=document.createElement('style');
style.textContent=`
#production-history{padding:10px 16px;border-bottom:1px solid #d7d9d0}
#production-history>strong{font-size:13px}#production-history [data-production-records]{display:flex;gap:6px;overflow:auto;padding:8px 0;max-height:90px;flex-wrap:wrap}
#production-history button{font-size:12px;padding:6px 8px}#production-history p{font-size:12px;margin:3px 0;color:#67756d}#production-history details{font-size:12px;color:#9d3f32}#production-history details p{overflow-wrap:anywhere;max-height:130px;overflow:auto}
#save-production-board{background:#26775f;color:white;border:0;border-radius:5px}.board-actions>button{min-width:0;white-space:nowrap}
#production-history-dialog{width:min(1040px,calc(100vw - 48px));max-height:85vh;padding:24px;border:1px solid #ddd5c5;border-radius:16px;background:#faf8f2;color:#233d40;box-shadow:0 20px 80px #0003}
#production-history-dialog::backdrop{background:#14272688}#production-history-dialog header{display:flex;justify-content:space-between;align-items:start;gap:16px}#production-history-dialog h2{margin:0;font-size:22px}#production-history-dialog header p{margin:8px 0 18px;color:#6c7c78;font-size:13px}
#production-history-dialog button{cursor:pointer;font:inherit}#production-history-dialog [data-history-close]{border:0;background:transparent;font-size:27px;padding:0 8px}.history-search{display:flex;gap:10px}.history-search input{flex:1;min-width:0;padding:10px;border:1px solid #d5d8ce;border-radius:7px;background:#fff}.history-search button{padding:8px 16px;border:1px solid #d5d8ce;border-radius:7px;background:#fff}
.history-record-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.history-record{border:1px solid #d9d9cf;border-radius:10px;background:#fff;padding:12px;display:flex;flex-direction:column;gap:8px}.history-record img{width:100%;height:150px;object-fit:contain;background:#f4f3ee;border-radius:6px}.history-record strong{font-size:16px}.history-record p{margin:0;color:#6d7a73;font-size:12px;overflow-wrap:anywhere}.history-record .record-state{color:#25735a;font-size:12px}.history-record .record-phases{display:flex;flex-wrap:wrap;gap:5px}.record-phases span{background:#f0f5f1;border-radius:4px;padding:4px;font-size:11px}.record-phases span[data-status="failed"]{background:#fff0e8;color:#9d3f32}.history-record button{margin-top:auto;padding:8px;border:0;border-radius:6px;background:#27775f;color:#fff}.history-record-placeholder{height:150px;display:grid;place-items:center;background:#f4f3ee;color:#88938a}
#scene-source{margin:8px 0 10px;padding:8px 10px;border:1px solid #d9d9cf;border-radius:8px;background:#fbfaf4;font-size:12px;color:#3c464e}
#scene-source p{margin:0 0 3px;font-size:12px;color:#3c464e}#scene-source b{color:#25735a}#scene-source em{margin-left:6px;font-style:normal;color:#a3612d;background:#fff3e4;border-radius:4px;padding:1px 5px;font-size:11px}
#scene-source small{display:block;color:#6d7a73;font-size:11px;line-height:1.5;overflow-wrap:anywhere;margin-top:2px}
#scene-source button{margin:6px 0 2px;padding:5px 9px;border:1px solid #b7d2c7;border-radius:5px;background:#eef8f3;color:#246953;font:inherit;font-size:12px;cursor:pointer}
#scene-master-bind select{max-width:190px;font-size:11px}#scene-master-bind button{white-space:nowrap}
`;style.textContent+=' .production-home-open{display:block;width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.production-home-open:focus-visible{outline:3px solid #26775f;outline-offset:-3px}.production-home-versions{display:flex;flex-wrap:wrap;gap:8px;padding:0 18px 16px}.production-home-versions button{border:1px solid #c8d4c9;border-radius:6px;background:#edf4ee;color:#245e49;padding:7px 10px;font:inherit;font-size:12px;cursor:pointer}.production-home-copy .production-version-notice{color:#99703b;font-size:12px}.history-revision-notes{white-space:pre-wrap;max-height:96px;overflow:auto;font-size:12px;}';document.head.append(style);

const note=t=>$('[data-production-status]').textContent=t;
async function api(route,body,method=body?'POST':'GET'){
 const res=await fetch(route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const value=await res.json();if(!res.ok)throw Error(value.error||'请求失败');return value;
}
const statusLabel=r=>(r.revisionOf?'修改版 · ':'')+(r.status==='failed'&&Object.keys(r.slots||{}).some(id=>['face','front','side','back','hands','scene','scene-front','scene-reverse','prop'].includes(id))?'部分完成，可编辑':labels[r.status]||r.status);
function describe(r){
 const busy=Object.entries(r.phases||{}).filter(([,p])=>active(p));
 if(busy.length)return busy.map(([id,p])=>componentLabels[id]+' · '+({queued:'排队中',running:'生成中',recoverable:'等待恢复',awaiting_confirmation:'等待确认',delegated:'执行中'})[p.status]).join('，');
 const failed=Object.entries(r.phases||{}).filter(([,p])=>['failed','cancelled'].includes(p.status));
 return failed.length?failed.map(([id])=>componentLabels[id]).join('、')+'未完成，可在对应组件重新生成；已有图片保留。':r.legacy?'旧版整图已保留，可载入后重新制作组件。':'配置与组件已载入，可继续编辑。';
}
function report(r){
 note(r.connectionError||describe(r));const details=$('[data-production-error]');details.hidden=!r.error;details.querySelector('p').textContent=r.error||'';
}
function renderRecent(){
 const root=$('[data-production-records]');root.replaceChildren();
 for(const {display:r}of productionRecordGroups(items).slice(0,4)){const b=document.createElement('button');b.type='button';b.dataset.productionRecord=r.id;b.textContent=r.name+' · '+statusLabel(r);b.onclick=()=>open(r.id).catch(e=>note(e.message));root.append(b);}
 if(!items.some(r=>!r.deletedAt))root.textContent='还没有生成记录';
 const visibleCount=items.filter(r=>!r.deletedAt).length;$('#open-production-history').textContent='生成记录'+(visibleCount?'（'+visibleCount+'）':'');
}
function renderHistory(){
 const root=dialog.querySelector('.history-record-grid'),query=dialog.querySelector('input').value.trim().toLowerCase();root.replaceChildren();
 const group=!historyTrashMode&&historyGroupId?productionRecordGroups(items).find(g=>g.id===historyGroupId):null,pool=historyTrashMode?items.filter(r=>r.deletedAt):historyGroupId?(group?.versions||[]):items.filter(r=>!r.deletedAt);
 $('#production-history-title').textContent=historyTrashMode?'资产回收站':group?group.display.name+' · 版本历史':'生成记录';
 const matches=pool.filter(r=>[r.name,r.outfit,statusLabel(r),r.revisionOf?.notes].join(' ').toLowerCase().includes(query));
 dialog.querySelector('[data-history-message]').textContent=matches.length?'共 '+matches.length+' 条记录':query?'没有匹配的记录':'还没有生成记录，生成后会保留配置、组件和拼版。';
 for(const r of matches){
  const card=document.createElement('article');card.className='history-record';card.dataset.historyRecord=r.id;
  if(r.imageUrl){const image=document.createElement('img');image.src=r.imageUrl+'&v='+encodeURIComponent(r.updatedAt||r.createdAt);image.alt=r.name+'预览';card.append(image);}else{const empty=document.createElement('div');empty.className='history-record-placeholder';empty.textContent='等待生成预览';card.append(empty);}
  const name=document.createElement('strong');name.textContent=r.name;const outfit=document.createElement('p');outfit.textContent=r.outfit||({character:'角色卡',scene:'场景',prop:'道具'})[r.type];
  const status=document.createElement('span');status.className='record-state';status.textContent=statusLabel(r);const date=document.createElement('p');date.textContent=new Date(r.createdAt).toLocaleString('zh-CN');
  const phases=document.createElement('div');phases.className='record-phases';
  for(const [id,p]of Object.entries(r.phases||{})){const chip=document.createElement('span');chip.dataset.status=p.status;chip.textContent=(componentLabels[id]||id)+' · '+({done:'已完成',failed:'失败',cancelled:'已取消',queued:'排队中',running:'生成中',recoverable:'待恢复',awaiting_confirmation:'待确认'})[p.status];chip.title=p.message||'';phases.append(chip);}
  const reason=document.createElement('p');reason.textContent=r.error||(r.legacy?'保留原始整图':describe(r));if(r.revisionOf?.notes){const opinions=document.createElement('p');opinions.className='history-revision-notes';opinions.textContent='修改意见：'+r.revisionOf.notes;card.append(opinions);}
  const button=document.createElement('button');button.type='button';button.textContent='打开编辑';button.onclick=async()=>{button.disabled=true;try{await open(r.id);dialog.close();}catch(e){dialog.querySelector('[data-history-message]').textContent=e.message;}finally{button.disabled=false;}};
  button.hidden=historyTrashMode;const removal=document.createElement('button');removal.type='button';removal.dataset.historyTrash=r.id;removal.textContent=historyTrashMode?'恢复此版本':'删除此版本';removal.onclick=()=>historyTrashMode?restoreRecord(r):trashRecord(r);card.append(name,outfit,status,date,phases,reason,button,removal);root.append(card);
 }
}
function renderHome(){
 const root=$('.production-home-grid');if(!root)return;root.replaceChildren();
 const query=$('[data-home-search]').value.trim().toLowerCase(),type=$('[data-home-type]').value,groups=productionRecordGroups(items),matches=groups.filter(g=>(!type||g.display.type===type)&&g.versions.some(r=>[r.name,r.outfit].join(' ').toLowerCase().includes(query)));
 $('[data-home-status]').textContent=matches.length?'共 '+matches.length+' 项资产 · '+matches.reduce((n,g)=>n+g.versions.length,0)+' 条生成/修改记录 · 最近更新在前':'还没有匹配的资产，可点击右上角“新建资产”。';
 for(const g of matches){
  const r=g.display,card=document.createElement('article');card.className='production-home-card';card.dataset.homeRecord=r.id;card.dataset.homeGroup=g.id;
  const button=document.createElement('button');button.type='button';button.className='production-home-open';button.setAttribute('aria-label','打开 '+r.name);const src=r.imageUrl||r.slots?.['scene-front']?.url||r.slots?.face?.url||r.slots?.prop?.url;
  if(src){const image=document.createElement('img');image.src=src+'&v='+encodeURIComponent(r.updatedAt||r.createdAt);image.alt=r.name;image.loading='lazy';button.append(image);}else{const empty=document.createElement('div');empty.className='production-home-placeholder';empty.textContent=r.status==='failed'?'生成未完成':'等待生成预览';button.append(empty);}
  const copy=document.createElement('span');copy.className='production-home-copy';const name=document.createElement('strong');name.textContent=r.name;const state=document.createElement('small');state.textContent=({character:'人物',scene:'场景',prop:'道具'})[r.type]+' · '+(r.outfit||'默认状态');const status=document.createElement('span');status.className='record-state';status.textContent=statusLabel(r)+' · '+new Date(r.createdAt).toLocaleString('zh-CN');copy.append(name,state,status);
  if(g.latest.id!==r.id){const notice=document.createElement('small');notice.className='production-version-notice';notice.textContent=g.pending?'最新修改处理中，当前显示已有版本':g.hasFailedLatest?'最新修改未成功，当前保留已有版本':'最新记录待确认，当前显示已完成版本';copy.append(notice);}
  button.append(copy);card.append(button);card.onclick=()=>open(r.id).catch(e=>{$('[data-home-status]').textContent=e.message;});
  const actions=document.createElement('footer');actions.className='production-home-versions';const versions=document.createElement('button');versions.type='button';versions.dataset.homeVersions=g.id;versions.textContent='版本历史（'+g.versions.length+'）';versions.onclick=event=>{event.stopPropagation();showHistory(g.id);};actions.append(versions);
  if(g.latest.id!==r.id){const latest=document.createElement('button');latest.type='button';latest.dataset.homeLatest=g.latest.id;latest.textContent=g.pending?'查看当前任务':'查看最新记录';latest.onclick=event=>{event.stopPropagation();open(g.latest.id).catch(e=>{$('[data-home-status]').textContent=e.message;});};actions.append(latest);}
  const remove=document.createElement('button');remove.type='button';remove.dataset.homeTrash=r.id;remove.textContent='删除此版本';remove.onclick=e=>{e.stopPropagation();trashRecord(r);};actions.append(remove);card.append(actions);root.append(card);
 }
}

function detailMode(name='新建资产'){document.body.classList.remove('production-home');$('.topbar h1').textContent=name;}
function homeMode(){++opening;clearTimeout(timer);document.body.classList.add('production-home');$('.topbar h1').textContent='资产工作室';history.replaceState(null,'','?home=1');renderHome();}
$('[data-home-search]').oninput=renderHome;$('[data-home-type]').onchange=renderHome;$('[data-home-refresh]').onclick=()=>refresh().catch(e=>{$('[data-home-status]').textContent=e.message;});
$('#production-home-open').onclick=async()=>{try{if(current)await saveCurrent();homeMode();await refresh();}catch(e){note(e.message);}};
$('#production-new').onclick=async()=>{++opening;clearTimeout(timer);current=null;revisionUI.update(null);quickRevision.update(null);window.assetProductionRecord=null;detailMode();history.replaceState(null,'','?new=1');await loadProductionConfig({type:'character',name:'',outfit:'',prompt:'',referenceIds:[],references:[]});await loadProductionBoard({id:'draft',type:'character',name:'',slots:{},finished:[],status:'draft',referenceIds:[]});$('#result').hidden=true;$('#empty').hidden=false;$('#generate').disabled=false;};
async function refresh(){items=(await api('/api/production-records?includeTrashed=1')).items;items.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));renderRecent();renderHome();if(dialog.open)renderHistory();}
function preview(r){
 revisionUI.update(r);quickRevision.update(r);
 const pending=Object.values(r.phases||{}).some(active)||['running','queued'].includes(r.status);$('#generate').disabled=pending;$('#board-grid').inert=false;
 $('#preview-chip').textContent=statusLabel(r);$('#error').hidden=true;$('#actions').hidden=true;
 if(r.imageUrl){const src=r.imageUrl+'&v='+encodeURIComponent(r.updatedAt||r.createdAt);if($('#image').getAttribute('src')!==src)$('#image').src=src;$('#result').hidden=false;$('#empty').hidden=true;$('#caption').textContent=r.name+' · '+(r.legacy?'旧版整图':r.width+'×'+r.height);}
 else{$('#result').hidden=true;$('#empty').hidden=pending;}
 $('#progress').hidden=!pending;
 if(pending){$('#phase').textContent='组件生成中';$('#message').textContent=describe(r);}
 setProductionComponentState(r,{submitting:[...submitting]});
}
function remember(r){current=r;window.assetProductionRecord=r;const at=items.findIndex(i=>i.id===r.id);if(at>=0)items[at]=r;else items.unshift(r);renderRecent();if(dialog.open)renderHistory();}
function schedule(){clearTimeout(timer);if(!current||!Object.values(current.phases||{}).some(active)&&!['running','queued'].includes(current.status))return;const id=current.id;timer=setTimeout(async()=>{try{const r=await api('/api/production-records/'+id);if(current?.id!==id)return;remember(r);await loadProductionBoard(r,{incremental:true});preview(r);report(r);}catch(e){note('进度读取失败：'+e.message+'；将继续刷新');}finally{if(current?.id===id)schedule();}},2500);}
async function open(id){
 const token=++opening;clearTimeout(timer);note('正在打开生成记录…');const r=await api('/api/production-records/'+id);if(token!==opening)return;
 if(r.deletedAt)throw Error('该版本已删除，可在回收站恢复');detailMode(r.name);remember(r);history.replaceState(null,'','?'+new URLSearchParams({...(new URLSearchParams(location.search).get('embed')?{embed:'1'}:{}),record:id}));
 await loadProductionConfig(r);if(token!==opening)return;renderSceneSource(r);await loadProductionBoard(r);if(token!==opening)return;preview(r);report(r);schedule();
}
async function saveCurrent(){
 if(!current)throw Error('先选择一条生成记录');const id=current.id,r=await api('/api/production-records/'+id+'/board',{...serializeProductionBoard(),...(['scene','character'].includes(current.type)?await productionConfig():{})},'PUT');
 if(current?.id===id){remember(r);preview(r);}return r;
}
window.addEventListener('asset-production-board-saved',event=>{if(current?.id===event.detail.id){remember(event.detail);preview(current);}});
window.addEventListener('asset-production-scene-mode',async()=>{
 if(!current)return;const id=current.id;clearTimeout(timer);$('#board-grid').inert=true;$('#scene-output-controls').inert=true;
 try{const r=await saveCurrent();if(current?.id!==id)return;await loadProductionBoard(r,{incremental:true});note(r.sceneOutputMode==='front'?'已保存为单张正视图，预览、导出和入库使用同一张图。':'已添加反打位；上传图片或点击生成后再保存。');schedule();}
 catch(e){note('场景输出保存失败：'+e.message);}
 finally{$('#board-grid').inert=false;$('#scene-output-controls').inert=false;}
});
window.addEventListener('asset-production-component',async event=>{
 if(!current)return;if(current.revisionOf&&event.detail.action!=='cancel'){window.dispatchEvent(new CustomEvent('asset-production-revise',{detail:{component:event.detail.component}}));return;}const input=event.detail,component=componentOf(input.component),id=current.id;if(submitting.has(component))return;
 submitting.add(component);preview(current);note(componentLabels[component]+(input.action==='cancel'?' · 正在取消…':' · 正在提交重新生成…'));
 try{
  if(input.action!=='cancel')await saveCurrent();
  const r=await api('/api/production-records/'+id+'/component',{...input,requestId:crypto.randomUUID()});
  if(current?.id!==id)return;remember(r);await loadProductionBoard(r,{incremental:true});preview(r);report(r);if(r.reusedJob)note(componentLabels[component]+'已有任务，已接续显示进度；不会重复提交。');schedule();
 }catch(e){note(componentLabels[component]+'提交失败：'+e.message);}
 finally{submitting.delete(component);if(current?.id===id)preview(current);}
});
const save=document.createElement('button');save.id='save-production-board';save.className='btn primary';save.type='button';save.textContent='保存拼版编辑';$('#board-save').before(save);
save.onclick=async()=>{save.disabled=true;try{await saveCurrent();note('拼版编辑已保存，重新打开仍可继续调整。');}catch(e){note(e.message);}finally{save.disabled=false;}};
window.addEventListener('asset-production-generate',async()=>{try{const input=await productionConfig();$('#generate').disabled=true;note('正在提交生成…');if(!input.name||!input.prompt)throw Error('请填写资产名称和提示词');const result=await api('/api/production-records',{...input,requestId:crypto.randomUUID(),...(current?{referenceIds:current.referenceIds,extraReferenceIds:input.useFormReferences?(current.referenceIds||[]).slice(2):[],source:current.source}: {})});await open(result.id);}catch(e){note(e.message);$('#generate').disabled=false;}});
async function showHistory(groupId=null,trashMode=false){historyGroupId=groupId;historyTrashMode=trashMode;dialog.querySelector('input').value='';if(!dialog.open)dialog.showModal();dialog.querySelector('[data-history-message]').textContent='正在读取生成记录…';try{await refresh();}catch(e){dialog.querySelector('[data-history-message]').textContent='读取失败：'+e.message;}}
$('#open-production-history').onclick=()=>showHistory();dialog.querySelector('[data-history-close]').onclick=()=>dialog.close();dialog.querySelector('[data-history-refresh]').onclick=()=>showHistory(historyGroupId,historyTrashMode);dialog.querySelector('input').oninput=renderHistory;
const start=()=>{const id=new URLSearchParams(location.search).get('record');if(!id)homeMode();(id?open(id).then(refresh):refresh()).catch(e=>note(e.message));};
if(window.assetStudioReady||!new URLSearchParams(location.search).get('record'))start();else window.addEventListener('asset-studio-ready',start,{once:true});

setInterval(()=>{if(document.body.classList.contains('production-home')&&!document.hidden)void refresh().catch(e=>{$('[data-home-status]').textContent=e.message;});},10000);


 const recycle=document.createElement('button');recycle.type='button';recycle.className='btn ghost';recycle.id='production-trash-open';recycle.textContent='回收站';recycle.onclick=()=>showHistory(null,true);$('#open-production-history').after(recycle);
 async function trashRecord(r){if(!confirm('删除“'+r.name+'”的这个版本并放入回收站？同一资产其他版本、当前工作台用图和素材库原件保留。若仍在生成，将申请取消，实际结束后才能删除。'))return;try{await api('/api/production-records/'+r.id+'/trash',{cancelActive:true});if(current?.id===r.id){current=null;window.assetProductionRecord=null;revisionUI.update(null);quickRevision.update(null);homeMode();}await refresh();note('已放入回收站，可恢复。');}catch(e){if(dialog.open)dialog.querySelector('[data-history-message]').textContent=e.message;else $('[data-home-status]').textContent=e.message;note(e.message);}}
 async function restoreRecord(r){try{await api('/api/production-records/'+r.id+'/restore',{});await refresh();dialog.querySelector('[data-history-message]').textContent='已恢复，可从最近生成或版本历史打开。';}catch(e){dialog.querySelector('[data-history-message]').textContent=e.message;}}
