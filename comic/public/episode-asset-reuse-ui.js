const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={reuse:'可复用',same:'已使用同一图片',conflict:'当前已选其他图片；勾选后替换',unused:'本话不需要',blocked:'已锁定、生成中或使用文生，暂不替换'};
export function mountEpisodeAssetReuse({api,getProject,getPage,flushSave,onAssets,accept,changed,setBusy}){
 let running=false;
 const capture=()=>({projectId:getProject().id,pageId:getPage().id});
 const verify=target=>{if(getProject()?.id!==target.projectId||getPage()?.id!==target.pageId)throw Error('工程或当前话已切换，请重新操作');};
 const call=(target,action,extra={})=>{verify(target);return api('/api/projects/'+target.projectId+'/asset-workspace/reuse-'+action,'POST',{expectedRevision:getProject().revision,pageId:target.pageId,...extra});};
 async function exportFile(){
  if(running)return;running=true;setBusy(true);
  try{const target=capture();await flushSave();const {bundle,skipped}=await call(target,'export');verify(target);const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=('第'+bundle.source.episode+'话-人物场景复用.json').replace(/[\\/:*?"<>|]/g,'_');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);changed('已导出 '+bundle.items.length+' 项已采用的人物和场景。'+(skipped.length?'未导出：'+skipped.join('；'):'下一话点击“导入复用文件”即可使用。'));}
  finally{running=false;setBusy(false);}
 }
 async function importFile(file){
  if(running||!file)return;running=true;setBusy(true);
  try{if(file.size>2*1024*1024)throw Error('请选择小于2MB的资产复用 JSON 文件');let bundle;try{bundle=JSON.parse(await file.text());}catch{throw Error('复用文件不是有效的 JSON，请选择导出的复用文件');}const target=capture();await flushSave();const preview=await call(target,'preview',{bundle});verify(target);showPreview(target,bundle,preview);}
  finally{running=false;setBusy(false);}
 }
 function showPreview(target,bundle,preview){
  const revision=getProject().revision,dialog=document.createElement('dialog');dialog.className='asset-reuse-dialog';dialog.setAttribute('aria-label','导入人物场景复用文件');
  dialog.innerHTML=`<h2>导入人物场景复用文件</h2><p>来源：${esc(preview.source.title)} · 第${esc(preview.source.episode)}话</p><p>同名人物按服装区分；默认补齐缺图。已选不同图片的项目需勾选后才替换。</p><div class="asset-reuse-list">${preview.items.map(item=>`<label class="asset-reuse-item"><input type="checkbox" data-reuse-index="${item.index}" ${item.status==='reuse'?'checked':''} ${['reuse','conflict'].includes(item.status)?'':'disabled'}><img loading="lazy" src="/api/library/revisions/${esc(bundle.items[item.index].asset.revisionId)}/download" alt="待复用图片"><span><strong>${esc(item.name)}</strong>${item.state?' · '+esc(item.state):''}<small>${esc(labels[item.status])}${item.count?' · '+item.count+' 处':''}${item.blocked?'；跳过 '+item.blocked+' 处':''}</small></span></label>`).join('')}</div><p>${preview.newItems.length?'本话新增资产需另选图片：'+preview.newItems.map(i=>esc(i.name)+(i.state?'（'+esc(i.state)+'）':'')).join('、'):'本话人物和场景均已包含在复用文件中。'}</p><p data-reuse-status role="status" aria-live="polite"></p><footer><button data-reuse-cancel>取消</button><button data-reuse-apply class="primary">导入选中资产</button></footer>`;
  let applying=false;const status=dialog.querySelector('[data-reuse-status]'),submit=dialog.querySelector('[data-reuse-apply]');
  const update=()=>{submit.disabled=applying||!dialog.querySelector('[data-reuse-index]:checked:not(:disabled)');};dialog.addEventListener('change',update);update();
  dialog.addEventListener('cancel',event=>{if(applying)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.querySelector('[data-reuse-cancel]').onclick=()=>{if(!applying)dialog.close();};
  submit.onclick=async()=>{
   if(applying)return;const selected=[...dialog.querySelectorAll('[data-reuse-index]:checked:not(:disabled)')].map(n=>Number(n.dataset.reuseIndex));if(!selected.length)return;
   applying=true;running=true;setBusy(true);for(const n of dialog.querySelectorAll('button,input'))n.disabled=true;status.textContent='正在取回固定版本并应用到本话，请稍候…';
   try{verify(target);if(getProject().revision!==revision)throw Error('预览后工程已改变，请关闭窗口重新导入');const result=await call(target,'import',{bundle,selected});verify(target);onAssets(result.assets);await accept(result.project,{message:''});changed('已复用 '+result.summary.assets+' 项资产，应用到 '+result.summary.applied+' 处。'+(result.summary.blocked?'跳过锁定或生成中的 '+result.summary.blocked+' 处。':'')+(preview.newItems.length?'新增 '+preview.newItems.length+' 项请继续选图。':''));dialog.close();}
   catch(error){status.textContent='导入未完成：'+error.message;for(const n of dialog.querySelectorAll('button'))n.disabled=false;for(const n of dialog.querySelectorAll('[data-reuse-index]'))n.disabled=!['reuse','conflict'].includes(preview.items[Number(n.dataset.reuseIndex)].status);}
   finally{applying=false;running=false;setBusy(false);update();}
  };
  document.body.append(dialog);dialog.showModal();
 }
 return {exportFile,importFile};
}
