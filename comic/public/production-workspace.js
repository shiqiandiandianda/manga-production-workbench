import {episodeLetteringPending} from './production-episode-lettering.js';
import {assetUnavailable} from './asset-availability.js';
import {productionScreenLetteringPending} from './production-screen-lettering.js';
import {productionSegmentUnit} from './production-episode-layout.js';
import {layoutDesignSvg} from './layout-design.js';
import {openProductionStyles} from './production-style-ui.js';
import {productionSegment,productionFrame,productionRequirementKey} from './production-package-model.js';
import {openPanelSlices} from './panel-slices-ui.js';
import {generationPromptSelection,generationPromptChoices} from './prompt-source.js';
import {findProductionPanel,productionPanelSource,productionPanelLetteringPending} from './production-panel-generation.js';
import {productionPanelPrompts,productionPanelPromptSource,productionPanelDataIssues} from './production-panel-prompts.js';
import {auditPanelReferences} from './panel-reference-audit.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function rememberedProductionFrame(project,episodeNumber){
 const episode=project?.productionPackage?.episodes.find(e=>e.episode===episodeNumber);if(!episode)return null;
 let key;try{key=localStorage.getItem('comic-production-segment:'+project.id+':'+episodeNumber);}catch{return null;}
 const segment=episode.segments.find(s=>s.id===key);if(!segment)return null;
 return (productionSegmentUnit(project,episodeNumber,key)==='panel'&&segment.panelIds.map(id=>findProductionPanel(project,key,id)).find(Boolean))||productionFrame(project,key);
}
/** An explicit canvas/layer selection wins over the last visited sidebar segment. */
export function selectedProductionSegment(project,episode,selected,{current='',remembered=''}={}){
 const frames=new Map(project.pages.flatMap(p=>p.panels).map(f=>[f.id,f])),seen=new Set();let item=selected;
 while(item&&!seen.has(item.id)){
  seen.add(item.id);const key=item.productionSegment||item.productionGrid?.segmentId||item.panelSlice?.segmentId||item.productionBackground?.replace(/-BG$/,'');
  if(episode.segments.some(s=>s.id===key))return key;
  item=frames.get(item.parentPanelId||item.cutoutLayer?.parentPanelId||item.breakoutForeground?.backgroundPanelId);
 }
 return [current,remembered].find(key=>episode.segments.some(s=>s.id===key))||episode.segments[0]?.id||'';
}
export function mountProductionWorkspace({api,getProject,getSelected,getAssets=()=>[],flushSave,accept,toast,modal,closeModal,selectFrame,selectDialogue,onAddDialogue,onManualPlacement,onTemplate,onReflow,generate,chooseReferences,regenerateReferences,retrieveReferences,getEpisode,onChooseEpisode,openAutoLayout,openImport}){
 const root=document.querySelector('#production-tab');let current='',currentGrid='',lastSelection='',stamp='',activateCurrent=null,opening=null,navigating=false,restoredEpisode='';
 const segmentMemoryKey=(projectId,episode)=>'comic-production-segment:'+projectId+':'+episode;
 const rememberedSegment=(projectId,episode)=>{try{return localStorage.getItem(segmentMemoryKey(projectId,episode))||''}catch{return ''}};
 const rememberSegment=(projectId,episode,segmentId)=>{try{localStorage.setItem(segmentMemoryKey(projectId,episode),segmentId)}catch{}};
 const endpoint=(project,action)=>'/api/projects/'+project.id+'/production/'+action;
 async function change(action,input){await flushSave();const project=getProject();if(input.projectId&&input.projectId!==project.id)throw Error('作品已切换，请重新打开操作界面');const revision=project.revision,requestStarted=performance.now();const result=await api(endpoint(project,action),'POST',{...input,expectedRevision:revision});if(result.requiresPreview)return result;const received=performance.now();await accept(result.project||result,action==='episode-layout'?{message:null,refresh:false,deferRender:true,expectedRevision:revision}:undefined);result.layoutReturnTiming={requestMs:received-requestStarted,adoptMs:performance.now()-received,server:result.returnTiming};stamp='';refresh();return result;}
 const safe=fn=>async event=>{try{await fn(event);}catch(e){toast(e.message,true);}};
 async function navigate(fn){if(navigating)return;navigating=true;stamp='';refresh();try{return await fn();}finally{navigating=false;stamp='';refresh();}}
 function refresh(force=false){
  const project=getProject(),pkg=project?.productionPackage,selected=getSelected(),key=[project?.id,project?.revision,selected?.id,selected?.imageAssetId,getEpisode?.(),productionSegmentUnit(project,getEpisode?.(),current),project&&productionFrame(project,current)?.imageAssetId,current].join(':');if(!force&&stamp===key)return;stamp=key;
  if(!pkg){root.innerHTML='<button type="button" data-production-import>导入制作资料</button>';root.querySelector('[data-production-import]').onclick=()=>openImport?.({target:'new'});return;}
  const activeEpisode=pkg.episodes.find(e=>e.episode===getEpisode?.())||pkg.episodes[0],episodeKey=project.id+':'+activeEpisode.episode;
  if(restoredEpisode!==episodeKey){restoredEpisode=episodeKey;current='';currentGrid='';lastSelection='';}
  current=selectedProductionSegment(project,activeEpisode,selected,{current,remembered:rememberedSegment(project.id,activeEpisode.episode)});
  rememberSegment(project.id,activeEpisode.episode,current);
  const s=productionSegment(project,current),frame=productionFrame(project,current),episode=pkg.episodes.find(e=>e.episode===s.episode),rows=episode.panelRecords.filter(p=>p.segmentId===s.id),texts=episode.texts.filter(t=>t['段ID']===s.localId),screenChoice=generationPromptSelection(frame,project),missing=s.references.filter(r=>r['必须']&&!r.binding).length;
  function commonActions(){const actions=root.querySelector('.production-primary-actions');if(!actions)return;if(openImport){const button=document.createElement('button');button.type='button';button.dataset.productionImport='';button.textContent='更新制作资料';button.onclick=()=>openImport({target:'current'});actions.append(button);}}

  if(['single-mode-20261027','post-lettering-20261027'].includes(pkg.sourceFormat)){
   const record=episode.panelRecords.find(r=>r.segmentId===s.id),choice=generationPromptSelection(frame,project),missing=s.references.filter(r=>!r.binding).length;
   root.innerHTML=`<div class="production-core"><section><label>话<select data-production-episode>${pkg.episodes.map(e=>`<option value="${e.episode}" ${e.episode===s.episode?'selected':''}>第${e.episode}话${e.title?' · '+esc(e.title):''}</option>`).join('')}</select></label><label>单格<select data-production-segment>${episode.segments.map(seg=>{const row=episode.panelRecords.find(r=>r.segmentId===seg.id);return `<option value="${esc(seg.id)}" ${seg.id===s.id?'selected':''}>${esc((row?.id||seg.localId)+' · '+seg.scene)}</option>`;}).join('')}</select></label><label>生成单位<input value="单格：一格一图" readonly></label><label>图片出字方式<input value="带字：资料包原文" readonly></label><div class="production-primary-actions"><button data-production-generate ${choice.text?'':'disabled'}>生成当前单格</button></div></section></div>`;
   root.querySelector('[data-production-episode]').onchange=safe(e=>onChooseEpisode?.(Number(e.target.value)));
   root.querySelector('[data-production-segment]').onchange=safe(e=>{current=e.target.value;rememberSegment(project.id,episode.episode,current);const f=productionFrame(getProject(),current);if(f)selectFrame(f);stamp='';refresh();});
   root.querySelector('[data-production-generate]').onclick=safe(()=>generate([frame.id]));
   commonActions();
   const references=document.createElement('button');references.type='button';references.textContent='本格参考';references.dataset.productionPanelReferences='';references.onclick=safe(()=>chooseReferences(frame));root.querySelector('.production-primary-actions').append(references);
   if(pkg.sourceFormat==='post-lettering-20261027')root.querySelectorAll('input[readonly]')[1].value='无字画面：工具后期嵌字';
   activateCurrent=()=>selectFrame(frame);return;
  }
  const single=productionSegmentUnit(project,episode.episode,s.id)==='panel',selectedSource=productionPanelSource(selected);
  if(selected?.id!==lastSelection&&selectedSource?.segmentId===s.id)currentGrid=selectedSource.panelId;lastSelection=selected?.id;
  if(!rows.some(r=>r.id===currentGrid))currentGrid=rows[0]?.id||'';
  const record=rows.find(r=>r.id===currentGrid),target=record&&findProductionPanel(project,s.id,record.id),prompts=productionPanelPrompts(record),singleSource=productionPanelPromptSource(record,s.panelPromptSources?.[currentGrid]||(target?.productionGrid?target.generation?.promptSource:undefined));
  const choice=single?(target?generationPromptSelection({...target,generation:{...target.generation,promptSource:singleSource}},project):{source:singleSource,text:(singleSource==='post-lettering'?prompts.clean:prompts.empty).text}):screenChoice,dataIssues=record?productionPanelDataIssues(record,{referenceAudit:target&&auditPanelReferences(project,target,getAssets())}):[];
  if(choice.scopeError)dataIssues.push(choice.scopeError);
  const allSingle=episode.segments.every(seg=>productionSegmentUnit(project,episode.episode,seg.id)==='panel'),screenChoices=generationPromptChoices(frame,project),screenEmpty=screenChoices.find(c=>c.value==='imported')?.text,screenClean=screenChoices.find(c=>c.value==='post-lettering')?.text,hasClean=single?!!prompts.clean.text:!!screenClean,hasEmpty=single?!!prompts.empty.text:!!screenEmpty;
  const unitControls=`<label>生成单位<select data-production-unit><option value="screen" ${single?'':'selected'}>屏段：整屏生成</option><option value="panel" ${single?'selected':''}>单格：按单镜头生成</option></select></label>${single?`<label>单格<select data-production-grid>${rows.map(r=>`<option value="${esc(r.id)}" ${r.id===currentGrid?'selected':''}>${esc(r.id+' · '+String(r.original?.['画面内容']||r.production?.['画面内容']||'').slice(0,24))}</option>`).join('')}</select></label>`:''}`;
  async function prepareSingle(gridId=record?.id){if(!gridId)throw Error('本屏段没有对应的单镜头资料');let f=findProductionPanel(getProject(),s.id,gridId);if(!f){const result=await change('panel',{projectId:project.id,segmentId:s.id,gridId});f=getProject().pages.flatMap(p=>p.panels).find(f=>f.id===result.panelId);}if(getProject()?.id!==project.id)throw Error('作品已切换');selectFrame(f);return f;}
  async function prepareSegment(){if(rows.some(r=>!findProductionPanel(getProject(),s.id,r.id))||productionPanelLetteringPending(getProject(),s.id))await change('unit',{projectId:project.id,segmentId:s.id,unit:'panel'});return prepareSingle(currentGrid);}
  async function prepareScreen(){if(productionScreenLetteringPending(getProject(),s.id))await change('unit',{projectId:project.id,segmentId:s.id,unit:'screen'});if(getProject()?.id!==project.id)throw Error('作品已切换');const now=getProject(),visible=now.episodeReflows?.[s.episode]&&s.panelIds.map(id=>findProductionPanel(now,s.id,id)).find(f=>f?.visible!==false);selectFrame(visible||productionFrame(now,s.id));}
  activateCurrent=()=>single?prepareSegment():prepareScreen();
  const toolTexts=texts.filter(t=>t['渲染']==='工具'&&s.panelIds.includes(t['格ID'])&&String(t['文本']||'').trim());
  root.innerHTML=`<div class="production-core"><section><label>话<select data-production-episode>${pkg.episodes.map(e=>`<option value="${e.episode}" ${e.episode===s.episode?'selected':''}>第${e.episode}话${e.title?' · '+esc(e.title):''}</option>`).join('')}</select></label><button class="primary" data-production-episode-unit title="将本话所有屏段切换为${allSingle?'屏段':'单格'}模式，保留已有图片和布局">${allSingle?'一键屏段':'一键单格'}</button><label>屏段<select data-production-segment>${episode.segments.map(seg=>`<option value="${esc(seg.id)}" ${seg.id===s.id?'selected':''}>${esc(seg.localId+' · '+seg.scene)}</option>`).join('')}</select></label>${unitControls}<label>图片出字方式<select data-production-mode><option value="post-lettering" ${choice.source==='post-lettering'?'selected':''} ${!hasClean?'disabled':''}>画面无框无字：工具加气泡和台词${!hasClean?'（缺少原文）':''}</option><option value="imported" ${choice.source==='imported'?'selected':''} ${!hasEmpty?'disabled':''}>画面自带空泡：工具填字${!hasEmpty?'（缺少原文）':''}</option></select></label><div class="production-primary-actions"><button type="button" data-production-episode-mode title="将上方出字方式应用到当前话全部屏段和单格，保留已有图片与台词">一键调整整话出字方式</button>${!single?'<button class="primary" data-production-layout data-production-slices '+(frame.imageAssetId?'':'disabled')+'>裁格</button>':''}</div>${s.pendingSourceFields?'<div class="package-conflict">提示词有更新<button data-source-incoming>采用更新</button><button data-source-local>保留当前</button></div>':''}</section><section><h3>底图</h3>${s.background['方式']==='纯白'?'<p class="sub-note">纯白底 · 无需生成底图</p>':''}<div class="package-actions production-background-actions"><button data-production-bg-generate ${s.background['方式']==='纯白'?'disabled':''}>生成底图</button><button data-production-bg-apply ${s.background['方式']==='纯白'?'disabled':''}>铺满本组</button></div><details><summary>底图处理</summary><button data-production-compose ${s.layoutAssetId===frame.imageAssetId?'':'disabled'}>分离白缝</button></details></section></div>`;
  commonActions();
  if(single){
   const actions=root.querySelector('.production-primary-actions'),one=document.createElement('button');one.type='button';one.dataset.productionGenerateOne='';one.textContent='仅重做选中格';one.disabled=!choice.text||dataIssues.length>0;one.onclick=safe(async()=>generate([(await prepareSingle()).id]));actions.append(one);
   const refs=document.createElement('button');refs.type='button';refs.dataset.productionPanelReferences='';refs.textContent='本格参考';refs.onclick=safe(async()=>chooseReferences(await prepareSingle()));actions.append(refs);
   const notes=[...dataIssues,...(!prompts.empty.text?['本格尚缺空泡提示词']:[]),...(!prompts.clean.text?['本格尚缺无泡提示词']:[])];for(const note of notes){const p=document.createElement('p');p.className='production-missing';p.textContent=note+'；请补入分镜资料。';actions.after(p);}
   actions.insertAdjacentHTML('afterend','<details class="production-single-prompts"><summary>查看本格两套提示词原文</summary><strong>空泡</strong><pre>'+esc(prompts.empty.text||'分镜表未提供')+'</pre><strong>无泡</strong><pre>'+esc(prompts.clean.text||'分镜表未提供')+'</pre></details>');
  }
  if(s.background['方式']==='纯白'){
   const actions=root.querySelector('.production-background-actions');for(const button of actions.querySelectorAll('button'))button.disabled=true;actions.insertAdjacentHTML('afterend','<p class="sub-note">本屏使用纯白底，不生成底图。</p>');
  }
  if(project.layoutRuleBindings?.[episode.episode]){
   const binding=project.layoutRuleBindings[episode.episode],button=document.createElement('button');button.dataset.productionLayoutDesign='';button.textContent='助手预览 · '+binding.contract.name;root.querySelector('.production-primary-actions').append(button);button.onclick=safe(()=>openAutoLayout?.(episode.episode));
  }else if(episode.layoutDesign){
   const button=document.createElement('button');button.dataset.productionLayoutDesign='';button.textContent='导入版式原件 · '+episode.layoutDesign.data.layoutVersion;root.querySelector('.production-primary-actions').append(button);
   button.onclick=()=>{const d=episode.layoutDesign.data;modal('排版设计 · 第'+episode.episode+'话','<p>设计框位；成图裁区仍需看图确认。'+(episode.layoutDesignReview?'布局有更新，当前保留已采用版与人工调整。':'')+'</p><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start;max-height:70vh;overflow:auto"><section style="min-width:0"><h3>最终整话</h3>'+layoutDesignSvg(d)+'</section><section style="min-width:0"><h3>本屏生成框位</h3>'+layoutDesignSvg(d,s.id)+'</section></div>',[{label:'关闭',run:closeModal}]);};
  }
  root.querySelector('[data-production-unit]').onchange=safe(async e=>{const unit=e.target.value;
   await navigate(async()=>{
    await change('unit',{projectId:project.id,segmentId:s.id,unit});
    const active=unit==='panel'?(findProductionPanel(getProject(),s.id,currentGrid)||findProductionPanel(getProject(),s.id,rows[0]?.id)):productionFrame(getProject(),s.id);
    if(active)selectFrame(active);
    stamp='';refresh();
   });});
  root.querySelector('[data-production-episode-unit]').onclick=safe(()=>navigate(async()=>{
   const unit=allSingle?'screen':'panel';
   await change('episode-unit',{projectId:project.id,episode:episode.episode,unit});
   const now=getProject(),active=unit==='panel'?(findProductionPanel(now,s.id,currentGrid)||findProductionPanel(now,s.id,rows[0]?.id)):productionFrame(now,s.id);
   if(active)selectFrame(active);toast('本话 '+episode.segments.length+' 个屏段已切换为'+(unit==='panel'?'单格':'屏段')+'模式；可随时切回');
  }));
  root.querySelector('[data-production-grid]')?.addEventListener('change',safe(async e=>{const gridId=e.target.value;currentGrid=gridId;await navigate(()=>prepareSingle(gridId));}));
  root.querySelector('[data-production-episode]').onchange=safe(e=>onChooseEpisode?.(Number(e.target.value)));
  root.querySelector('[data-production-segment]').onchange=safe(async e=>{current=e.target.value;rememberSegment(project.id,episode.episode,current);const now=getProject(),panel=productionSegmentUnit(now,episode.episode,current)==='panel';selectFrame((panel?findProductionPanel(now,current,currentGrid):null)||productionFrame(now,current));stamp='';refresh();await navigate(()=>activateCurrent?.());});
  const modeSelect=root.querySelector('[data-production-mode]');
  modeSelect.onchange=safe(async e=>{try{await change('mode',{projectId:project.id,segmentId:s.id,...(single?{gridId:record.id}:{}),mode:e.target.value==='post-lettering'?'clean':'empty'});if(getProject()?.id!==project.id)return;const active=single?findProductionPanel(getProject(),s.id,record.id):productionFrame(getProject(),s.id);if(active)selectFrame(active);}catch(error){stamp='';refresh();throw error;}});
  root.querySelector('[data-production-episode-mode]').onclick=safe(()=>{const mode=modeSelect.value==='post-lettering'?'clean':'empty';return navigate(async()=>{
   try{const result=await change('episode-mode',{projectId:project.id,episode:episode.episode,mode});toast('第'+result.episode+'话已统一为'+(mode==='clean'?'画面无框无字':'画面自带空泡')+'：'+result.segments+'个屏段、'+result.panels+'个单格；已有图片和台词保留');}
   catch(error){modal('整话出字方式未更改','<pre class="production-batch-issues">'+esc(error.status===404?'请先保存工程并重启工作台服务，再使用整话出字方式功能。':error.message)+'</pre>',[{label:'关闭',run:closeModal}]);}
  });});
  const layoutButton=root.querySelector('[data-production-layout]');if(layoutButton)layoutButton.onclick=safe(()=>openLayout(s.id));
  root.querySelector('[data-production-bg-generate]').onclick=safe(()=>{const owner=s.background['方式']==='共用'?episode.segments.find(v=>v.localId===s.background['段ID']):s;const background=owner&&productionFrame(getProject(),owner.id+'-BG');if(!background)throw Error('未找到本组底图');return generate([background.id]);});

  root.querySelector('[data-production-bg-apply]').onclick=()=>confirmOperation('铺满氛围底图','将该组底图的副本覆盖共享屏段的完整高度，原始生成图保留。','background',s.id);
  root.querySelector('[data-production-compose]').onclick=()=>confirmOperation('分离外部白缝','仅在副本移除与页面边缘连通的纯白区。无边框处可能需要在同页修图中调整，请对照原图检查白衣、发丝与光效。','compose',s.id);

  for(const b of root.querySelectorAll('[data-review-issue]'))b.onclick=safe(()=>{const n=Number(b.dataset.reviewIssue),reviewed=new Set(pkg.reviewedIssues||[]);reviewed.has(n)?reviewed.delete(n):reviewed.add(n);return change('issues',{reviewed:[...reviewed]});});
  root.querySelector('[data-source-incoming]')?.addEventListener('click',safe(()=>change('resolve',{segmentId:s.id,useIncoming:true})));root.querySelector('[data-source-local]')?.addEventListener('click',safe(()=>change('resolve',{segmentId:s.id,useIncoming:false})));
  if(root.querySelector('[data-copy-production-prompt]'))root.querySelector('[data-copy-production-prompt]').onclick=safe(()=>navigator.clipboard.writeText(choice.text));if(root.querySelector('[data-export-production-plan]'))root.querySelector('[data-export-production-plan]').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({projectId:project.id,title:project.title,productionPackage:pkg},null,2)],{type:'application/json'}));a.download=project.title+'_制作来源记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  if(navigating){
   for(const node of root.querySelectorAll('[data-production-episode-layout],[data-production-episode-unit],[data-production-episode-mode],[data-production-unit],[data-production-grid],[data-production-mode],[data-production-generate],[data-production-generate-one],[data-production-segment]'))node.disabled=true;
   root.querySelector('.production-primary-actions')?.insertAdjacentHTML('afterend','<p class="sub-note" role="status">正在处理当前操作，请稍候。</p>');
  }
 }
 function confirmOperation(title,text,action,key){const projectId=getProject().id;modal(title,'<p>'+esc(text)+'</p>',[{label:'取消',run:closeModal},{label:'确认生成副本',primary:true,run:async()=>{await change(action,{projectId,segmentId:key,confirmed:true});closeModal();}}]);}
 async function openBinding(key,slot){
  await flushSave();const project=getProject(),ref=productionSegment(project,key).references.find(r=>r.slot===slot),projects=(await api('/api/library/projects')).items;let offset=0,items=[];const matchedProjects=projects.filter(p=>project.productionPackage.title.includes(p.name));
  modal('绑定附图 · '+(ref['人物']||ref['类型']),`<section class="production-binding"><p>${esc(ref['服装']||ref['说明']||'')} · 选择图片及固定版本后绑定</p><label>墨库项目<select data-binding-project><option value="">请选择项目</option><option value="public">公共素材库</option>${projects.map(p=>`<option value="${esc(p.id)}" ${matchedProjects.length===1&&matchedProjects[0].id===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><input data-binding-search type="search" value="${esc(ref['人物']||'')}" placeholder="搜索人物、服装或素材名"><button data-binding-query>搜索</button><label><input type="checkbox" data-bind-matching checked>同时绑定所有同名同服装需求</label><div data-binding-results></div><div class="package-actions"><button data-binding-prev>上一页</button><button data-binding-next>下一页</button></div><p data-binding-status role="status"></p></section>`,[{label:'关闭',run:closeModal}]);
  const host=document.querySelector('.production-binding'),status=t=>host.querySelector('[data-binding-status]').textContent=t;
  async function load(){if(!host.querySelector('[data-binding-project]').value){status('请选择明确的墨库项目或公共素材库。');return;}status('读取墨库图片…');const r=await api('/api/library/assets?'+new URLSearchParams({projectId:host.querySelector('[data-binding-project]').value,kind:'image',q:host.querySelector('[data-binding-search]').value,offset:String(offset),limit:'20'}));items=r.items;host.querySelector('[data-binding-results]').innerHTML=items.map(i=>`<article class="package-bind-card"><img src="/api/library/revisions/${esc(i.displayRevisionId||i.recommendedRevisionId)}/preview/thumb.webp" alt="${esc(i.name)}"><strong>${esc(i.name)}</strong><button data-binding-item="${esc(i.id)}" ${assetUnavailable(i)?'disabled':''}>查看并选定版本</button></article>`).join('');status(items.length?'请选择合适的身份与服装。':'没有找到图片，调整搜索词或项目范围。');host.querySelector('[data-binding-prev]').disabled=!offset;host.querySelector('[data-binding-next]').disabled=items.length<20;}
  host.querySelector('[data-binding-query]').onclick=safe(()=>{offset=0;return load();});host.querySelector('[data-binding-project]').onchange=safe(()=>{offset=0;return load();});host.querySelector('[data-binding-prev]').onclick=safe(()=>{offset=Math.max(0,offset-20);return load();});host.querySelector('[data-binding-next]').onclick=safe(()=>{offset+=20;return load();});
  host.onclick=safe(async e=>{const button=e.target.closest('[data-binding-item]');if(!button)return;const item=items.find(i=>i.id===button.dataset.bindingItem),detail=await api('/api/library/assets/'+item.id),applyMatching=host.querySelector('[data-bind-matching]').checked;closeModal();modal('确认固定版本',`<p>${esc(detail.name)} · ${esc(ref['服装']||'')}</p><select data-binding-revision>${detail.revisions.map(r=>`<option value="${esc(r.id)}" ${r.id===detail.recommendedRevisionId?'selected':''}>${esc(r.originalName)} · ${esc(r.createdAt||'')} · ${esc(r.id.slice(0,8))}</option>`).join('')}</select><img class="production-binding-preview" data-binding-preview alt="参考原图">`,[{label:'返回',run:()=>{closeModal();return openBinding(key,slot);}},{label:'采用此版本',primary:true,run:async()=>{const revisionId=document.querySelector('[data-binding-revision]').value,r=await api('/api/library/import','POST',{assetId:item.id,revisionId});await change('bind',{projectId:project.id,segmentId:key,slot,assetId:r.asset.id,applyMatching});closeModal();toast('已绑定固定版本，附图顺序保留');}}]);const select=document.querySelector('[data-binding-revision]'),preview=()=>document.querySelector('[data-binding-preview]').src='/api/library/revisions/'+select.value+'/download';select.onchange=preview;preview();});await load();
 }
 async function openLayout(key){return openPanelSlices({segmentId:key,sourcePanelId:getSelected()?.cutoutLayer?.kind==='upscale'?getSelected().id:undefined,api,getProject,flushSave,accept,modal,closeModal,toast,selectFrame});}
 function openDialogues(scope='screen',initialTab='dialogue'){
  refresh();const p=getProject(),e=p?.productionPackage?.episodes.find(e=>e.episode===getEpisode?.()),segment=e?.segments.find(s=>s.id===current)||e?.segments[0];if(!segment)throw Error('请先选择有制作资料的屏段');
  return openProductionStyles({segmentId:segment.id,getProject,getSelected,change,modal,closeModal,initialScope:scope,initialTab,selectDialogue,onAdd:onAddDialogue,onReflow:onReflow&&safe(onReflow),onTemplate:onTemplate&&safe(onTemplate),
   onPosition:safe(()=>{closeModal();onManualPlacement?.();}),
   onPlace:async row=>{closeModal();onManualPlacement?.({rowKey:row.key});}
  });
 }
 async function applyAssistantPreview({episodeNumber,scriptId,expectedPacketHash}={}){return navigate(async()=>{
  const p=getProject(),number=Number(episodeNumber??getEpisode?.()),ep=p?.productionPackage?.episodes.find(e=>e.episode===number);if(!ep)throw Error('请选择当前话');
  const result=await change('episode-layout',{projectId:p.id,episode:number,...(scriptId?{scriptId}:{}),...(expectedPacketHash?{expectedPacketHash}:{})});
  if(result.requiresPreview){await openAutoLayout?.(number);toast('本话还没有可用预览，请在你的排版助手完成预览后再接回');return result;}
  const presentationStarted=performance.now();await onChooseEpisode?.(number,{deferRender:true});const e=getProject().productionPackage.episodes.find(e=>e.episode===number),seg=e.segments.find(s=>s.id===current)||e.segments[0],key=seg.panelIds.includes(currentGrid)?currentGrid:seg.panelIds[0],f=findProductionPanel(getProject(),seg.id,key);if(f)selectFrame(f);else await onChooseEpisode?.(number);result.layoutReturnTiming.presentationMs=performance.now()-presentationStarted;
  toast('已接回第'+number+'话最新预览 · '+result.panels+'格；已备份，可撤销');return result;
 });}
 return {refresh,applyAssistantPreview,async open(){if(opening)return opening;refresh(true);if(!getProject()?.productionPackage)return;opening=Promise.resolve().then(()=>navigate(async()=>{const p=getProject(),episode=getEpisode?.()||p.productionPackage.episodes[0]?.episode;if(episodeLetteringPending(p,episode))await change('episode-lettering',{projectId:p.id,episode});if(getProject()?.id===p.id)await activateCurrent?.();}));try{await opening;}finally{opening=null;}},openLayout,openStyles:openDialogues};
}
