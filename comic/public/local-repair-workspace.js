// Keep the established selection editor inside this page and use the same undo stack.
export function mountLocalRepairWorkspace({api,getProject,getPanel,flushSave,onApplied,onHistory,canApply,openLibrary,onLocalRegion,toast}){
 const workspace=document.createElement('dialog');workspace.className='local-repair-workspace';workspace.setAttribute('aria-label','框选局部修图');
 workspace.innerHTML='<header><div><strong>框选局部修图</strong><p data-local-repair-hint>拉框圈住要改的位置 → 输入修改要求 → 提交修改；结果按选区自动拼回。完成后点“应用并合并”。</p></div><button data-local-repair-close>返回排版</button></header><iframe id="repair-editor" title="局部修图画布"></iframe>';
 document.body.append(workspace);const iframe=workspace.querySelector('iframe');let ready=false,pending=null,session=null,applying=false,closing=false;const waits=new Map();
 const post=value=>iframe.contentWindow?.postMessage(value,location.origin);
 const persist=()=>{try{sessionStorage.setItem('comic-local-repair-session',JSON.stringify(session));}catch{}};
 function sendSource(value){session={...value.session,label:value.metadata.name};persist();pending=null;post({type:'comic:repair-source',...value});}
 async function close(){if(closing)return;if(applying)return toast('正在拼回画布，请稍候',true);closing=true;try{if(ready){const requestId=crypto.randomUUID();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waits.delete(requestId);reject(Error('修图保存尚未确认，请稍后返回，当前内容仍保留'));},15000);waits.set(requestId,{resolve,reject,timer});post({type:'comic:repair-flush',requestId});});}workspace.close();}catch(e){toast(e.message,true);}finally{closing=false;}}
 workspace.querySelector('[data-local-repair-close]').onclick=()=>void close();workspace.addEventListener('cancel',e=>{e.preventDefault();void close();});
 async function open(){
  const project=getProject(),panel=getPanel();if(!project||!panel?.imageAssetId)throw Error('先选择要局部修改的图片');await flushSave();if(getProject()?.id!==project.id||getPanel()?.id!==panel.id)throw Error('选择已变化，请重新打开局部修图');
  if(session?.projectId===project.id&&session.panelId===panel.id&&session.imageAssetId===panel.imageAssetId&&ready){workspace.showModal();return;}
  const value=await api('/api/integrated-repair/sessions','POST',{projectId:project.id,panelId:panel.id,expectedRevision:getProject().revision});
  if(getProject()?.id!==project.id)throw Error('工程已切换，请重新打开局部修图');pending=value;workspace.showModal();if(ready)sendSource(value);else if(!iframe.getAttribute('src'))iframe.src='/repair/';
 }
 window.addEventListener('message',async event=>{
  if(event.origin!==location.origin||event.source!==iframe.contentWindow)return;const d=event.data;
  try{
   if(d?.type==='comic:repair-ready'){ready=true;if(pending)sendSource(pending);}
   if(d?.type==='comic:repair-flushed'){const wait=waits.get(d.requestId);if(wait){clearTimeout(wait.timer);waits.delete(d.requestId);wait.resolve();}}
   if(d?.type==='comic:repair-result'){
    if(applying)throw Error('正在应用上一张结果，请稍候');if(!session||session.id!==d.sessionId||getProject()?.id!==session.projectId)throw Error('修图来源已切换，结果保留在修图记录');applying=true;
    try{await flushSave();if(!canApply())throw Error('请先结束排版编辑，再应用局部修图');const result=await api('/api/integrated-repair/sessions/'+session.id+'/apply','POST',{resultUrl:d.resultUrl,mode:d.mode||'replace',position:d.position||'above',model:d.model,expectedRevision:getProject().revision});await onApplied(result);if(result.applied&&result.session){session={...result.session,label:session.label};persist();}toast(result.message);post({type:'comic:repair-applied',requestId:d.requestId,sessionId:d.sessionId,session:result.session,metadata:result.metadata,operationId:result.operationId,createdLayer:result.createdLayer,updatedLayer:result.updatedLayer,applied:result.applied,message:result.message});}finally{applying=false;}
   }
   if(d?.type==='comic:repair-history'){
    if(!session||session.id!==d.sessionId||getProject()?.id!==session.projectId)throw Error('修图来源已切换');const current=await onHistory({direction:d.direction,operationId:d.operationId,projectId:session.projectId}),value=await api('/api/integrated-repair/sessions','POST',{projectId:current.id,panelId:d.panelId,expectedRevision:current.revision});session={...value.session,label:value.metadata.name};persist();post({type:'comic:repair-history-result',requestId:d.requestId,session});
   }
   if(d?.type==='comic:local-region'){if(!session||session.id!==d.sessionId||getProject()?.id!==session.projectId)throw Error('修图来源已切换');await close();await onLocalRegion({operation:d.operation,projectId:session.projectId,panelId:session.panelId});}
   if(d?.type==='comic:open-library'){await close();openLibrary({target:'repair'});}
   if(d?.type==='comic:repair-error')toast(d.message,true);
  }catch(e){toast(e.message,true);if(d?.requestId)post({type:'comic:repair-apply-error',requestId:d.requestId,message:e.message});}
 });
 return {open,projectChanged(){if(session&&getProject()?.id!==session.projectId&&workspace.open)void close();},addReference(asset){if(!session)return openLibrary({kind:'image'});workspace.showModal();post({type:'comic:repair-reference',name:asset.name,url:'/assets/'+asset.id});},addFont(font){if(!session)return openLibrary({kind:'font'});workspace.showModal();post({type:'comic:repair-font',font});},get active(){return workspace.open;}};
}
