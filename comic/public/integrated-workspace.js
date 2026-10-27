export function mountIntegratedWorkspace({api,getProject,getPanel,canvasActions,flushSave,onApplied,onHistory,canApply=()=>true,openLibrary,toast,onModeChange=()=>{},onLocalRegion=()=>{}}){
 const shell=document.querySelector('.app-shell'),frame=document.createElement('div');
 frame.className='workspace-frame';shell.before(frame);frame.append(shell);
 const splitter=document.createElement('div');splitter.className='workspace-splitter';splitter.setAttribute('role','separator');splitter.setAttribute('aria-label','调整排版和修图区域宽度');splitter.setAttribute('aria-orientation','vertical');splitter.tabIndex=0;
 const pane=document.createElement('aside');pane.id='repair-pane';pane.setAttribute('aria-label','修图区域');
 pane.innerHTML='<div class="repair-pane-heading"><div class="pane-title"><strong>修图</strong><span id="repair-session-label">从左侧选一格开始</span></div><button id="repair-close" aria-label="收起修图区域" title="收起修图区域">×</button></div><iframe id="repair-editor" title="一体修图编辑器"></iframe>';
 const loadButton=document.createElement('button');loadButton.id='repair-current-panel';loadButton.type='button';loadButton.setAttribute('aria-label','修改画面');loadButton.title='修改画面：将选中画格载入右侧修图';loadButton.innerHTML='<b aria-hidden="true">↗</b><span>修改画面</span>';
 const focus=document.createElement('div');focus.className='compact-pane-switch';focus.innerHTML='<button data-pane-focus="layout" class="active">排版画布</button><button data-pane-focus="repair">修图画布</button>';
 frame.append(focus,splitter,pane);frame.dataset.activePane='layout';
 function focusPane(value){frame.dataset.activePane=value;focus.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.paneFocus===value));window.dispatchEvent(new Event('resize'));}
 focus.onclick=e=>{const b=e.target.closest('[data-pane-focus]');if(b)focusPane(b.dataset.paneFocus);};
 const mode=document.createElement('div');mode.id='workspace-modes';mode.setAttribute('aria-label','工作模式');mode.innerHTML='<button data-workspace-mode="layout" class="active" aria-pressed="true">排版</button><button data-workspace-mode="repair" aria-pressed="false">修图</button>';
 document.querySelector('#storyboard-import').before(mode);
 let active='layout',ready=false,pending=null,session=null;const iframe=pane.querySelector('iframe');
 try{session=JSON.parse(localStorage.getItem('comic-integrated-repair-session')||'null');}catch{}
 function setMode(value){
  const entering=active!==value;active=value;frame.classList.toggle('repair-mode',value==='repair');document.body.classList.toggle('repair-workspace-active',value==='repair');
  mode.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b.dataset.workspaceMode===value);b.setAttribute('aria-pressed',String(b.dataset.workspaceMode===value));});
  if(value==='repair'&&!iframe.getAttribute('src'))iframe.src='/repair/';
  if(entering&&value==='repair'){
   document.querySelector('#inspector-close').click();document.querySelector('#sidebar-close').click();
   const zoom=document.querySelector('#zoom');zoom.value='fit';zoom.dispatchEvent(new Event('change'));
  }
  window.dispatchEvent(new Event('resize'));requestAnimationFrame(()=>onModeChange(value));
 }
 function sendSource(value){session={...value.session,label:value.metadata.name};localStorage.setItem('comic-integrated-repair-session',JSON.stringify(session));pane.querySelector('#repair-session-label').textContent=value.metadata.name;if(ready)iframe.contentWindow.postMessage({type:'comic:repair-source',...value},location.origin);else pending=value;}
 async function load(){
  const button=loadButton;
  try{const p=getProject(),panel=getPanel();if(!p||!panel?.imageAssetId)throw Error('先选择左侧已有图片的画格');button.disabled=true;await flushSave();setMode('repair');sendSource(await api('/api/integrated-repair/sessions','POST',{projectId:getProject().id,panelId:panel.id,expectedRevision:getProject().revision}));focusPane('repair');}
  catch(e){toast(e.message,true);}finally{button.disabled=false;}
 }
 mode.onclick=e=>{const b=e.target.closest('[data-workspace-mode]');if(b)setMode(b.dataset.workspaceMode);};
 pane.querySelector('#repair-close').onclick=()=>setMode('layout');loadButton.onclick=load;canvasActions.addAction(loadButton,{visible:()=>!!getPanel()?.imageAssetId});
 window.addEventListener('message',async event=>{
  if(event.origin!==location.origin||event.source!==iframe.contentWindow)return;const d=event.data;
  try{
   if(d?.type==='comic:repair-ready'){ready=true;if(pending){const value=pending;pending=null;sendSource(value);}else if(session){iframe.contentWindow.postMessage({type:'comic:repair-bind-session',session},location.origin);pane.querySelector('#repair-session-label').textContent=session.label||'继续上次修图';}}
   if(d?.type==='comic:repair-result'){
    if(!session||session.id!==d.sessionId)throw Error('修图会话已切换，结果仍保存在右侧');await flushSave();if(!canApply())throw Error('请先完成左侧编辑后再应用，结果已保存在右侧');const current=getProject();if(current?.id!==session.projectId)throw Error('左侧项目已切换，请切回原项目再回填');
    if(['layer','upscale'].includes(d.mode)&&!(await api('/api/integrated-repair/status')).applyModes?.includes(d.mode))throw Error('服务正在更新，新增子图层尚未就绪，请稍后刷新');
    const r=await api('/api/integrated-repair/sessions/'+d.sessionId+'/apply','POST',{resultUrl:d.resultUrl,mode:d.mode||'replace',position:d.position||'above',model:d.model,expectedRevision:current.revision});await onApplied(r);if(r.applied&&r.session){session={...r.session,label:session.label};localStorage.setItem('comic-integrated-repair-session',JSON.stringify(session));}toast(r.message);if(d.requestId)iframe.contentWindow.postMessage({type:'comic:repair-applied',requestId:d.requestId,sessionId:d.sessionId,session:r.session,metadata:r.metadata,operationId:r.operationId,createdLayer:r.createdLayer,updatedLayer:r.updatedLayer,applied:r.applied,message:r.message},location.origin);
   }
   if(d?.type==='comic:repair-history'){
    if(!session||session.id!==d.sessionId||getProject()?.id!==session.projectId)throw Error('修图来源已切换，未撤回其他工程');
    const current=await onHistory({direction:d.direction,operationId:d.operationId,projectId:session.projectId});
    const value=await api('/api/integrated-repair/sessions','POST',{projectId:current.id,panelId:d.panelId,expectedRevision:current.revision});
    session={...value.session,label:value.metadata.name};localStorage.setItem('comic-integrated-repair-session',JSON.stringify(session));
    iframe.contentWindow.postMessage({type:'comic:repair-history-result',requestId:d.requestId,session},location.origin);
   }
   if(d?.type==='comic:local-region'){if(!session||session.id!==d.sessionId||getProject()?.id!==session.projectId)throw Error('修图来源已切换，请重新加载');if(!['inpaint','cutout'].includes(d.operation))throw Error('本地处理类型无效');await onLocalRegion({operation:d.operation,projectId:session.projectId,panelId:session.panelId});}
   if(d?.type==='comic:open-library'){focusPane('layout');openLibrary({target:'repair'});}
   if(d?.type==='comic:repair-error')toast(d.message,true);
  }catch(e){toast(e.message,true);if(d?.requestId)iframe.contentWindow.postMessage({type:'comic:repair-apply-error',requestId:d.requestId,message:e.message},location.origin);}
 });
 function split(x){const b=frame.getBoundingClientRect(),ratio=Math.max(30,Math.min(65,(x-b.left)/b.width*100));frame.style.setProperty('--workspace-split',ratio+'%');window.dispatchEvent(new Event('resize'));}
 splitter.onpointerdown=e=>{splitter.setPointerCapture(e.pointerId);split(e.clientX);splitter.onpointermove=e=>split(e.clientX);splitter.onpointerup=splitter.onpointercancel=()=>{splitter.onpointermove=null;};};
 splitter.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const current=parseFloat(frame.style.getPropertyValue('--workspace-split'))||46;frame.style.setProperty('--workspace-split',Math.max(30,Math.min(65,current+(e.key==='ArrowRight'?2:-2)))+'%');window.dispatchEvent(new Event('resize'));}};
 return {setMode,loadCurrent:load,addReference(asset){setMode('repair');focusPane('repair');iframe.contentWindow.postMessage({type:'comic:repair-reference',name:asset.name,url:'/assets/'+asset.id},location.origin);},addFont(font){setMode('repair');focusPane('repair');iframe.contentWindow.postMessage({type:'comic:repair-font',font},location.origin);},get mode(){return active;}};
}
