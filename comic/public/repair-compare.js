// Preview a cloned project only. Never save the original-view state or put it
// into the undo history, and never substitute a different frame's source.
export function repairPreview(project,rows,assetMap,panelIds){
 const targets=new Set(panelIds),matches=rows.filter(r=>r.projectId===project.id&&targets.has(r.panelId)),next=structuredClone(project);let count=0;
 for(const page of next.pages)for(const layer of page.panels)if(layer.visible!==false&&layer.cutoutLayer?.kind==='repair-patch'&&(targets.has(layer.id)||targets.has(layer.cutoutLayer.parentPanelId))){layer.visible=false;count++;}
 for(const page of next.pages)for(const panel of page.panels){const row=matches.findLast(r=>r.panelId===panel.id&&r.afterAssetId===panel.imageAssetId),before=row&&assetMap.get(row.beforeAssetId),after=row&&assetMap.get(row.afterAssetId);if(!before||!after)continue;panel.imageAssetId=before.id;panel.imageTransform={...panel.imageTransform,scale:(panel.imageTransform?.scale||1)*after.width/before.width};delete panel.imageEffects;count++;}
 return {project:count?next:project,count};
}
export function mountRepairCompare({api,getProject,getPanel,getPage,getAssets,onRender,canCompare,toast}){
 let rows=[],loadedKey='',loading,original=false,scope='';const button=document.createElement('button');button.id='repair-compare-toggle';button.title='Ctrl＋空格：切换当前格原图 / 修图';document.querySelector('.job-heading .footer-spacer').before(button);
 const targetKey=()=>getProject()?.id+':'+(getPanel()?.id||getPage()?.id);
 const panelIds=()=>getPanel()?[getPanel().id]:(getPage()?.panels||[]).map(p=>p.id);
 function label(){button.textContent=original?'正在查看原图 · Ctrl＋空格返回修图':'原图 / 修图 · Ctrl＋空格';button.classList.toggle('repair-original-preview',original);button.setAttribute('aria-pressed',String(original));}
 async function refresh(){const project=getProject();if(!project)return;const key=project.id+':'+project.revision;if(key===loadedKey)return;if(loading)return loading;loading=(async()=>{const data=await api('/api/integrated-repair/comparisons?projectId='+encodeURIComponent(project.id));if(getProject()?.id===project.id){rows=data.comparisons;loadedKey=key;}})().finally(()=>loading=null);return loading;}
 function reset(){if(original){original=false;label();onRender();}}
 async function toggle(){if(!canCompare())return;try{await refresh();if(!getProject())return;if(original)return reset();const result=repairPreview(getProject(),rows,getAssets(),panelIds());if(!result.count)return toast('当前画格还没有可对比的修图记录');original=true;scope=targetKey();label();onRender();}catch(e){toast(e.message,true);}}
 button.onclick=toggle;document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||e.code!=='Space'||e.repeat||e.isComposing||e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')||document.querySelector('dialog[open]'))return;e.preventDefault();e.stopImmediatePropagation();void toggle();},true);
 document.querySelector('#stage').addEventListener('pointerdown',()=>reset(),true);
 label();return {refresh,reset,project(value){if(original&&scope!==targetKey()){original=false;label();}if(!original)return value;const preview=repairPreview(value,rows,getAssets(),panelIds());if(!preview.count){original=false;label();}return preview.project;}};
}
