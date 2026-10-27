import {assetUnavailable} from './asset-availability.js';
import {productionSegmentUnit} from './production-episode-layout.js';
import {layoutDesignSvg} from './layout-design.js';
import {openProductionStyles} from './production-style-ui.js';
import {resolveProductionStyle} from './production-lettering-style.js';
import {FONT_LABELS} from './unified-typography.js';
import {productionSegment,productionFrame,productionRequirementKey} from './production-package-model.js';
import {openPanelSlices} from './panel-slices-ui.js';
import {generationPromptSelection} from './prompt-source.js';
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
export function mountProductionWorkspace({api,getProject,getSelected,getAssets=()=>[],flushSave,accept,toast,modal,closeModal,selectFrame,generate,chooseReferences,regenerateReferences,retrieveReferences,getEpisode,onChooseEpisode,openAutoLayout}){
 const root=document.querySelector('#production-tab');let current='',currentGrid='',lastSelection='',stamp='',activateCurrent=null,opening=null,navigating=false,restoredEpisode='';
 const segmentMemoryKey=(projectId,episode)=>'comic-production-segment:'+projectId+':'+episode;
 const rememberedSegment=(projectId,episode)=>{try{return localStorage.getItem(segmentMemoryKey(projectId,episode))||''}catch{return ''}};
 const rememberSegment=(projectId,episode,segmentId)=>{try{localStorage.setItem(segmentMemoryKey(projectId,episode),segmentId)}catch{}};
 const endpoint=(project,action)=>'/api/projects/'+project.id+'/production/'+action;
 async function change(action,input){await flushSave();const project=getProject();if(input.projectId&&input.projectId!==project.id)throw Error('作品已切换，请重新打开操作界面');const result=await api(endpoint(project,action),'POST',{...input,expectedRevision:project.revision});if(result.requiresPreview)return result;await accept(result.project||result);stamp='';refresh();return result;}
 const safe=fn=>async event=>{try{await fn(event);}catch(e){toast(e.message,true);}};
 async function navigate(fn){if(navigating)return;navigating=true;stamp='';refresh();try{return await fn();}finally{navigating=false;stamp='';refresh();}}
 function refresh(force=false){
  const project=getProject(),pkg=project?.productionPackage,selected=getSelected(),key=[project?.id,project?.revision,selected?.id,selected?.imageAssetId,getEpisode?.(),productionSegmentUnit(project,getEpisode?.(),current),project&&productionFrame(project,current)?.imageAssetId,current].join(':');if(!force&&stamp===key)return;stamp=key;
  if(!pkg){root.innerHTML='<p class="sub-note">从顶部“导入制作资料”选择整套文件夹。已有逐格工程可继续使用。</p>';return;}
  const activeEpisode=pkg.episodes.find(e=>e.episode===getEpisode?.())||pkg.episodes[0],episodeKey=project.id+':'+activeEpisode.episode;
  if(restoredEpisode!==episodeKey){restoredEpisode=episodeKey;current='';currentGrid='';lastSelection='';}
  current=selectedProductionSegment(project,activeEpisode,selected,{current,remembered:rememberedSegment(project.id,activeEpisode.episode)});
  rememberSegment(project.id,activeEpisode.episode,current);
  const s=productionSegment(project,current),frame=productionFrame(project,current),episode=pkg.episodes.find(e=>e.episode===s.episode),rows=episode.panelRecords.filter(p=>p.segmentId===s.id),texts=episode.texts.filter(t=>t['段ID']===s.localId),screenChoice=generationPromptSelection(frame,project),missing=s.references.filter(r=>r['必须']&&!r.binding).length;

  if(['single-mode-20261027','post-lettering-20261027'].includes(pkg.sourceFormat)){
   const record=episode.panelRecords.find(r=>r.segmentId===s.id),choice=generationPromptSelection(frame,project),missing=s.references.filter(r=>!r.binding).length;
   root.innerHTML=`<div class="production-core"><section><label>话<select data-production-episode>${pkg.episodes.map(e=>`<option value="${e.episode}" ${e.episode===s.episode?'selected':''}>第${e.episode}话${e.title?' · '+esc(e.title):''}</option>`).join('')}</select></label><label>单格<select data-production-segment>${episode.segments.map(seg=>{const row=episode.panelRecords.find(r=>r.segmentId===seg.id);return `<option value="${esc(seg.id)}" ${seg.id===s.id?'selected':''}>${esc((row?.id||seg.localId)+' · '+seg.scene)}</option>`;}).join('')}</select></label><label>生成单位<input value="单格：一格一图" readonly></label><label>提示词模式<input value="带字：资料包原文" readonly></label><div class="production-primary-actions"><button data-production-generate ${choice.text?'':'disabled'}>生成当前单格</button><button data-production-panel-references>本格参考</button></div>${missing?'<p class="production-missing">本格有 '+missing+' 项为文字设定，尚未绑定图片；可按需要在本格参考中核对。</p>':''}<p class="sub-note">本包只提供带字提示词。台词已包含在提示词中，不会自动重复排字；画幅以本格资料为准。</p><details class="production-single-prompts"><summary>查看带字提示词原文</summary><pre>${esc(choice.text||'未提供')}</pre></details></section></div>`;
   root.querySelector('[data-production-episode]').onchange=safe(e=>onChooseEpisode?.(Number(e.target.value)));
   root.querySelector('[data-production-segment]').onchange=safe(e=>{current=e.target.value;rememberSegment(project.id,episode.episode,current);const f=productionFrame(getProject(),current);if(f)selectFrame(f);stamp='';refresh();});
   root.querySelector('[data-production-generate]').onclick=safe(()=>generate([frame.id]));
   root.querySelector('[data-production-panel-references]').onclick=safe(()=>chooseReferences(frame));
   if(pkg.sourceFormat==='post-lettering-20261027'){root.querySelectorAll('input[readonly]')[1].value='无字画面：工具后期嵌字';root.querySelector('.sub-note').textContent='按本格原始比例生成无字画面，台词单独保留。成图后打开本格排字，核对预案位置。';root.querySelector('.production-single-prompts summary').textContent='查看无字提示词原文';const button=document.createElement('button');button.textContent='本格排字';button.disabled=!frame.imageAssetId;button.onclick=safe(()=>openLayout(s.id));root.querySelector('.production-primary-actions').append(button);}
   activateCurrent=()=>selectFrame(frame);return;
  }
  const single=productionSegmentUnit(project,episode.episode,s.id)==='panel',selectedSource=productionPanelSource(selected);
  if(selected?.id!==lastSelection&&selectedSource?.segmentId===s.id)currentGrid=selectedSource.panelId;lastSelection=selected?.id;
  if(!rows.some(r=>r.id===currentGrid))currentGrid=rows[0]?.id||'';
  const record=rows.find(r=>r.id===currentGrid),target=record&&findProductionPanel(project,s.id,record.id),prompts=productionPanelPrompts(record),singleSource=productionPanelPromptSource(record,s.panelPromptSources?.[currentGrid]||(target?.productionGrid?target.generation?.promptSource:undefined));
  const choice=single?{source:singleSource,text:(singleSource==='post-lettering'?prompts.clean:prompts.empty).text}:screenChoice,dataIssues=record?productionPanelDataIssues(record,{referenceAudit:target&&auditPanelReferences(project,target,getAssets())}):[];
  const style=resolveProductionStyle(project,s.id);
  const unitControls=`<label>生成单位<select data-production-unit><option value="screen" ${single?'':'selected'}>屏段：整屏生成</option><option value="panel" ${single?'selected':''}>单格：按单镜头生成</option></select></label>${single?'<button type="button" data-production-align-panels title="按资料包分镜表的格子位置重置本屏单格；已有图片和锁定格会跳过">按分镜表对齐单格</button>':''}${single?`<label>单格<select data-production-grid>${rows.map(r=>`<option value="${esc(r.id)}" ${r.id===currentGrid?'selected':''}>${esc(r.id+' · '+String(r.original?.['画面内容']||r.production?.['画面内容']||'').slice(0,24))}</option>`).join('')}</select></label>`:''}`;
  async function prepareSingle(gridId=record?.id){if(!gridId)throw Error('本屏段没有对应的单镜头资料');let f=findProductionPanel(getProject(),s.id,gridId);if(!f){const result=await change('panel',{projectId:project.id,segmentId:s.id,gridId});f=getProject().pages.flatMap(p=>p.panels).find(f=>f.id===result.panelId);}if(getProject()?.id!==project.id)throw Error('作品已切换');selectFrame(f);return f;}
  async function prepareSegment(){if(rows.some(r=>!findProductionPanel(getProject(),s.id,r.id))||productionPanelLetteringPending(getProject(),s.id))await change('unit',{projectId:project.id,segmentId:s.id,unit:'panel'});return prepareSingle(currentGrid);}
  activateCurrent=()=>single?prepareSegment():selectFrame(productionFrame(getProject(),s.id));
  root.innerHTML=`<div class="production-core"><section><label>话<select data-production-episode>${pkg.episodes.map(e=>`<option value="${e.episode}" ${e.episode===s.episode?'selected':''}>第${e.episode}话${e.title?' · '+esc(e.title):''}</option>`).join('')}</select></label><button class="primary" data-production-episode-layout title="套用本话最新已完成的助手预览，先备份，可撤销">一键单格排版</button><label>屏段<select data-production-segment>${episode.segments.map(seg=>`<option value="${esc(seg.id)}" ${seg.id===s.id?'selected':''}>${esc(seg.localId+' · '+seg.scene)}</option>`).join('')}</select></label>${unitControls}<label>提示词模式<select data-production-mode><option value="post-lettering" ${choice.source==='post-lettering'?'selected':''} ${single&&!prompts.clean.text?'disabled':''}>无泡：工具排框与文字（默认）${single&&!prompts.clean.text?'（缺少原文）':''}</option><option value="imported" ${choice.source==='imported'?'selected':''} ${single&&!prompts.empty.text?'disabled':''}>空泡：模型画框，工具填字${single&&!prompts.empty.text?'（缺少原文）':''}</option></select></label><div class="production-primary-actions"><button data-production-generate>${single?'生成本屏全部单格（'+rows.length+'格）':'生成本屏'}</button>${single?'<button data-production-generate-one '+(!choice.text||dataIssues.length?'disabled':'')+'>仅重做选中格</button>':''}${single?'<button data-production-panel-references>本格参考</button>':'<button class="primary" data-production-layout data-production-slices '+(frame.imageAssetId?'':'disabled')+'>裁格与排字</button>'}${single?'<button data-production-panel-lettering '+(target?'':'disabled')+'>本格排字</button>':''}</div>${s.pendingSourceFields?'<div class="package-conflict">提示词有更新<button data-source-incoming>采用更新</button><button data-source-local>保留当前</button></div>':''}${!single&&missing?'<p class="production-missing">缺 '+missing+' 项必需资产</p>':''}${single?'<p class="sub-note">点击一次为本屏全部镜头分别生成图片，使用当前选择的空泡／无泡模式；完成后各自回填。本格气泡与台词会自动排上，可继续拖动调整。</p>'+(!prompts.empty.text?'<p class="production-missing">本格尚缺空泡提示词，请补入分镜表后重新导入。</p>':'')+(!prompts.clean.text?'<p class="production-missing">本格尚缺无泡提示词，请补入分镜表后重新导入。</p>':'')+'<details class="production-single-prompts"><summary>查看本格两套提示词原文</summary><strong>空泡</strong><pre>'+esc(prompts.empty.text||'分镜表未提供')+'</pre><strong>无泡</strong><pre>'+esc(prompts.clean.text||'分镜表未提供')+'</pre></details>':''}</section><section><h3>字体与边框</h3><button class="production-style-entry" data-production-styles><strong>${esc(FONT_LABELS[style.fontFamily]||'思源黑体')} · ${style.fontSize||36} px</strong><small>对白 · 内心 · 人名 · 地点 · 时间 · 旁白</small><span>选择款式与应用范围</span></button></section><section><h3>底图</h3>${s.background['方式']==='纯白'?'<p class="sub-note">纯白底 · 无需生成底图</p>':''}<div class="package-actions production-background-actions"><button data-production-bg-generate ${s.background['方式']==='纯白'?'disabled':''}>生成底图</button><button data-production-bg-apply ${s.background['方式']==='纯白'?'disabled':''}>铺满本组</button></div><details><summary>底图处理</summary><button data-production-compose ${s.layoutAssetId===frame.imageAssetId?'':'disabled'}>分离白缝</button></details></section></div>`;
  if(s.background['方式']==='纯白'){
   const actions=root.querySelector('.production-background-actions');for(const button of actions.querySelectorAll('button'))button.disabled=true;actions.insertAdjacentHTML('afterend','<p class="sub-note">本屏使用纯白底，不生成底图。</p>');
  }
  if(project.layoutRuleBindings?.[episode.episode]){
   const binding=project.layoutRuleBindings[episode.episode],button=document.createElement('button');button.dataset.productionLayoutDesign='';button.textContent='助手预览 · '+binding.contract.name;root.querySelector('.production-primary-actions').append(button);button.onclick=safe(()=>openAutoLayout?.(episode.episode));
  }else if(episode.layoutDesign){
   const button=document.createElement('button');button.dataset.productionLayoutDesign='';button.textContent='导入版式原件 · '+episode.layoutDesign.data.layoutVersion;root.querySelector('.production-primary-actions').append(button);
   button.onclick=()=>{const d=episode.layoutDesign.data;modal('排版设计 · 第'+episode.episode+'话','<p>设计框位；成图裁区仍需看图确认。'+(episode.layoutDesignReview?'布局有更新，当前保留已采用版与人工调整。':'')+'</p><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start;max-height:70vh;overflow:auto"><section style="min-width:0"><h3>最终整话</h3>'+layoutDesignSvg(d)+'</section><section style="min-width:0"><h3>本屏生成框位</h3>'+layoutDesignSvg(d,s.id)+'</section></div>',[{label:'关闭',run:closeModal}]);};
  }
  if(single&&dataIssues.length)root.querySelector('.production-primary-actions').insertAdjacentHTML('afterend',dataIssues.map(issue=>'<p class="production-missing">'+esc(issue)+'；请补入分镜资料。</p>').join(''));
  root.querySelector('[data-production-panel-lettering]')?.addEventListener('click',()=>{
   const entries=episode.texts.filter(t=>t['格ID']===record.id&&t['渲染']==='工具');
   modal('本格排字 · '+record.id,'<p>加入本格台词原文后，在画板上拖动文字框调整位置。空泡模式只加文字，无泡模式加可编辑气泡与文字。已有台词与位置保留。</p>'+entries.map(t=>'<p><strong>'+esc(t['说话人']||t['类型'])+'</strong>：'+esc(t['文本'])+'</p>').join(''),[{label:'取消',run:closeModal},{label:'加入本格文字层',primary:true,run:async()=>{const result=await change('panel-lettering',{projectId:project.id,segmentId:s.id,gridId:record.id,confirmed:true});closeModal();selectFrame(findProductionPanel(getProject(),s.id,record.id));toast('已加入 '+result.created+' 条本格台词'+(result.skipped?'；已有 '+result.skipped+' 条保留':'')+'，可在画板调整位置');}}]);
  });
  root.querySelector('[data-production-unit]').onchange=safe(async e=>{const unit=e.target.value;
   await navigate(async()=>{
    await change('unit',{projectId:project.id,segmentId:s.id,unit});
    const active=unit==='panel'?(findProductionPanel(getProject(),s.id,currentGrid)||findProductionPanel(getProject(),s.id,rows[0]?.id)):productionFrame(getProject(),s.id);
    if(active)selectFrame(active);
    stamp='';refresh();
   });});
  root.querySelector('[data-production-episode-layout]').onclick=safe(()=>applyAssistantPreview({episodeNumber:episode.episode}));
  root.querySelector('[data-production-grid]')?.addEventListener('change',safe(async e=>{const gridId=e.target.value;currentGrid=gridId;await navigate(()=>prepareSingle(gridId));}));
  root.querySelector('[data-production-align-panels]')?.addEventListener('click',safe(async()=>{
   modal('按分镜表对齐单格','将按资料包“屏段布局”的格子位置重置本屏尚未出图、未锁定的单格；已有图片和人工调整的格子会跳过。',[
    {label:'取消',run:closeModal},
    {label:'按表格对齐',primary:true,run:async()=>{closeModal();const result=await change('relayout-panels',{projectId:project.id,segmentId:s.id});toast('已按分镜表对齐 '+result.moved+' 格'+(result.skipped?'；跳过 '+result.skipped+' 格（已有图片或锁定）':''));const active=findProductionPanel(getProject(),s.id,currentGrid)||productionFrame(getProject(),s.id);if(active)selectFrame(active);}}
   ]);
  }));
  root.querySelector('[data-production-panel-references]')?.addEventListener('click',safe(async()=>{const f=await prepareSingle();chooseReferences(f);}));
  root.querySelector('[data-production-episode]').onchange=safe(e=>onChooseEpisode?.(Number(e.target.value)));root.querySelector('[data-production-styles]').onclick=()=>openProductionStyles({segmentId:s.id,getProject,change,modal,closeModal});
  root.querySelector('[data-production-segment]').onchange=safe(async e=>{current=e.target.value;rememberSegment(project.id,episode.episode,current);const now=getProject(),panel=productionSegmentUnit(now,episode.episode,current)==='panel';selectFrame((panel?findProductionPanel(now,current,currentGrid):null)||productionFrame(now,current));stamp='';refresh();if(panel)await navigate(()=>activateCurrent?.());});
  root.querySelector('[data-production-mode]').onchange=safe(async e=>{await change('mode',{projectId:project.id,segmentId:s.id,...(single?{gridId:record.id}:{}),mode:e.target.value==='post-lettering'?'clean':'empty'});if(getProject()?.id!==project.id)return;const active=single?findProductionPanel(getProject(),s.id,record.id):productionFrame(getProject(),s.id);if(active)selectFrame(active);});
  root.querySelector('[data-production-generate]').onclick=safe(async()=>{if(!single)return generate([frame.id]);await navigate(async()=>{let result;try{result=await change('panels',{projectId:project.id,segmentId:s.id,mode:choice.source==='post-lettering'?'clean':'empty'});}catch(error){modal('本屏单格资料检查','<pre class=production-batch-issues>'+esc(error.message)+'</pre>',[{label:'关闭',run:closeModal}]);return;}selectFrame(findProductionPanel(getProject(),s.id,currentGrid)||findProductionPanel(getProject(),s.id,rows[0].id));if(!result.panelIds?.length){toast(result.skippedExisting?.length?'本屏单格都已有图片，没有重复生成；需要重做请用单格“重新生成”':'本屏没有可生成的缺图格子');return;}await generate(result.panelIds);});});
  root.querySelector('[data-production-generate-one]')?.addEventListener('click',safe(async()=>generate([(await prepareSingle()).id])));root.querySelector('[data-production-bg-generate]').onclick=safe(()=>{const owner=s.background['方式']==='共用'?episode.segments.find(v=>v.localId===s.background['段ID']):s;return generate([productionFrame(project,owner.id+'-BG').id]);});
  const layoutButton=root.querySelector('[data-production-layout]');if(layoutButton)layoutButton.onclick=safe(()=>openLayout(s.id));

  root.querySelector('[data-production-bg-apply]').onclick=()=>confirmOperation('铺满氛围底图','将该组底图的副本覆盖共享屏段的完整高度，原始生成图保留。','background',s.id);
  root.querySelector('[data-production-compose]').onclick=()=>confirmOperation('分离外部白缝','仅在副本移除与页面边缘连通的纯白区。无边框处可能需要在同页修图中调整，请对照原图检查白衣、发丝与光效。','compose',s.id);

  for(const b of root.querySelectorAll('[data-review-issue]'))b.onclick=safe(()=>{const n=Number(b.dataset.reviewIssue),reviewed=new Set(pkg.reviewedIssues||[]);reviewed.has(n)?reviewed.delete(n):reviewed.add(n);return change('issues',{reviewed:[...reviewed]});});
  root.querySelector('[data-source-incoming]')?.addEventListener('click',safe(()=>change('resolve',{segmentId:s.id,useIncoming:true})));root.querySelector('[data-source-local]')?.addEventListener('click',safe(()=>change('resolve',{segmentId:s.id,useIncoming:false})));
  if(root.querySelector('[data-copy-production-prompt]'))root.querySelector('[data-copy-production-prompt]').onclick=safe(()=>navigator.clipboard.writeText(choice.text));if(root.querySelector('[data-export-production-plan]'))root.querySelector('[data-export-production-plan]').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({projectId:project.id,title:project.title,productionPackage:pkg},null,2)],{type:'application/json'}));a.download=project.title+'_制作来源记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  if(navigating){
   for(const node of root.querySelectorAll('[data-production-episode-layout],[data-production-unit],[data-production-grid],[data-production-mode],[data-production-generate],[data-production-generate-one],[data-production-segment]'))node.disabled=true;
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
 async function applyAssistantPreview({episodeNumber,scriptId,expectedPacketHash}={}){return navigate(async()=>{
  const p=getProject(),number=Number(episodeNumber??getEpisode?.()),ep=p?.productionPackage?.episodes.find(e=>e.episode===number);if(!ep)throw Error('请选择当前话');
  const result=await change('episode-layout',{projectId:p.id,episode:number,...(scriptId?{scriptId}:{}),...(expectedPacketHash?{expectedPacketHash}:{})});
  if(result.requiresPreview){await openAutoLayout?.(number);toast('本话还没有可用预览，请在你的排版助手完成预览后再接回');return result;}
  await onChooseEpisode?.(number);const e=getProject().productionPackage.episodes.find(e=>e.episode===number),seg=e.segments.find(s=>s.id===current)||e.segments[0],key=seg.panelIds.includes(currentGrid)?currentGrid:seg.panelIds[0],f=findProductionPanel(getProject(),seg.id,key);if(f)selectFrame(f);
  toast('已接回第'+number+'话最新预览 · '+result.panels+'格；已备份，可撤销');return result;
 });}
 return {refresh,applyAssistantPreview,async open(){if(opening)return opening;refresh(true);if(!getProject()?.productionPackage)return;opening=Promise.resolve().then(()=>activateCurrent?.());try{await opening;}finally{opening=null;}},openLayout,openStyles(scope='screen'){refresh();const p=getProject(),e=p?.productionPackage?.episodes.find(e=>e.episode===getEpisode?.()),segment=e?.segments.find(s=>s.id===current)||e?.segments[0];if(!segment)throw Error('请先选择有制作资料的屏段');return openProductionStyles({segmentId:segment.id,getProject,change,modal,closeModal,initialScope:scope});}};
}

