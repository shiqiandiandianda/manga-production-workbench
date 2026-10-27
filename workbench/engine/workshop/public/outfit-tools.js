/* Outfit inventory with independent conversion jobs; selections survive polling. */
(() => {
 const selections=new Map();
 function view(job){
  const plan=job.toolResult?.outfitPlan,children=state.jobs.filter(j=>j.outfitPlanJobId===job.id);
  if(!plan)return pageHeading('外部角色卡转换',escape(job.name),'先识别全部服装，再按套制作。',button('回到转换工具','tool-open','data-value="converter"'))+'<section class="card tool-result-status"><p>'+escape(job.message||'等待识别服装')+'</p>'+progressMarkup(job)+(['failed','cancelled'].includes(job.status)?button('重新识别','tool-retry','data-id="'+escape(job.id)+'"','soft'):button('取消任务','cancel-job','data-id="'+escape(job.id)+'"','small'))+'</section>';
  if(!selections.has(job.id))selections.set(job.id,new Set(plan.outfits.map(o=>o.id)));
  const selected=selections.get(job.id);let done=0,active=0,failed=0;
  const cards=plan.outfits.map((o,i)=>{
   const child=children.filter(j=>j.sourceOutfitId===o.id).at(-1),ready=child?.toolResult?.components||{},preview=o.sourceViews?.find(v=>v.kind==='front'||v.kind==='other')?.image;
   if(child?.status==='completed')done++;if(['running','queued'].includes(child?.status))active++;if(['failed','cancelled'].includes(child?.status))failed++;
   const label=child?child.status==='failed'&&ready.card?'角色图成功，手部待继续':statuses[child.status]||child.status:'尚未制作';
   return '<article class="card outfit-conversion-item"><div class="outfit-source-preview">'+(preview?'<a data-action="preview" href="'+escape(fileUrl(preview))+'" data-url="'+escape(fileUrl(preview))+'" data-name="'+escape(o.name)+'"><img src="'+escape(fileUrl(preview))+'" alt="'+escape(o.name)+'来源服装"></a>':'')+'</div><div class="outfit-conversion-info"><label class="outfit-selection"><input type="checkbox" data-scan-id="'+escape(job.id)+'" data-outfit-id="'+escape(o.id)+'" '+(selected.has(o.id)?'checked':'')+'><strong>'+(i+1)+'. '+escape(o.name)+'</strong></label><p>'+escape(o.description)+'</p><p class="subtext">来源：'+escape(o.views.map(v=>v.location).join(' / '))+' · '+o.views.length+' 个视图 · '+(o.sourceDetails?.length||0)+' 处配件细节</p>'+(o.sourceLabel?'<p class="subtext">原图标签：'+escape(o.sourceLabel)+'</p>':'')+'<span class="tag '+(child?.status==='completed'?'green':child?.status==='failed'?'red':'gray')+'">'+escape(label)+'</span>'+(child?progressMarkup(child):'')+'<div class="actions">'+(child?button('查看这套结果','tool-result','data-id="'+escape(child.id)+'"','small soft'):button('制作这一套','tool-outfits-convert','data-id="'+escape(job.id)+'" data-outfit-id="'+escape(o.id)+'"','small soft'))+(child&&['failed','cancelled'].includes(child.status)?button('继续这一套','tool-retry','data-id="'+escape(child.id)+'"','small'):'')+'</div></div></article>';
  }).join('');
  const unresolved=(plan.details||[]).filter(d=>!d.outfitIndexes?.length);
  const detailsNotice=unresolved.length?'<section class="card tool-result-status"><h3>'+unresolved.length+' 处配件特写的归属待确认</h3><p class="subtext">来源不明确的配件已保留，转换各套服装时以该套实际可见配件为准。</p>'+unresolved.map(d=>'<p>'+escape(d.description)+'</p>'+(d.image?'<a data-action="preview" href="'+escape(fileUrl(d.image))+'" data-url="'+escape(fileUrl(d.image))+'" data-name="待确认配件">查看来源特写</a>':'')).join('')+'</section>':'';
  return pageHeading('外部角色卡转换 · 分套制作',escape(job.name),'同套三视归为一套；表情头像和局部配件已归到对应来源。',button('回到转换工具','tool-open','data-value="converter"'))+'<section class="card tool-result-status"><h2>识别到 '+plan.outfits.length+' 套服装</h2><p>完成 '+done+' 套 · 制作 / 等待 '+active+' 套 · 待继续 '+failed+' 套。每套保留同一角色五官、独立服装和对应的手部服饰。</p>'+(job.batchError?'<p class="notice">'+escape(job.batchError)+'</p>':'')+'<div class="actions">'+button('制作选中的服装','tool-outfits-convert','data-id="'+escape(job.id)+'"','primary')+(children.some(j=>j.toolResult?.components?.card?.status==='completed')?button('已完成角色卡全部存入素材库','tool-outfits-save-library','data-id="'+escape(job.id)+'"','soft'):'')+'<a class="button soft" href="/api/tool-results/'+escape(job.id)+'/export" download>打包清单与已完成成品</a></div><p class="subtext">最多8张同时制作。重复点击会沿用已入队或完成的套装；已取消的任务只有再次点击继续才会制作。</p></section><div class="outfit-conversion-list">'+cards+'</div>';
 }
 async function action(target){
  const id=target.dataset.id,chosen=target.dataset.outfitId?[target.dataset.outfitId]:[...(selections.get(id)||[])];
  if(!chosen.length)throw new Error('请至少选中一套服装。');target.disabled=true;
  try{const result=await api('/api/tools/outfit-scans/'+id+'/convert','POST',{outfitIds:chosen});await refresh(true);toast(result.jobs.length+' 套已加入队列或沿用现有结果。');}finally{if(target.isConnected)target.disabled=false;}
 }
 document.addEventListener('change',event=>{const t=event.target;if(t.dataset.scanId&&t.dataset.outfitId){const values=selections.get(t.dataset.scanId)||new Set();if(t.checked)values.add(t.dataset.outfitId);else values.delete(t.dataset.outfitId);selections.set(t.dataset.scanId,values);}});
 window.outfitTools={view,action};
})();
