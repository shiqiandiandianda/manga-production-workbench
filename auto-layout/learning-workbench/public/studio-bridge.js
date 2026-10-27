// Explicit current-episode apply is visible in the generated preview header too.
(()=>{
 const params=new URLSearchParams(location.search);if(params.get('readonly')==='1')return;
 const host=params.get('view')==='preview'?document.querySelector('header'):document.querySelector('.actions');if(!host)return;
 const button=document.createElement('button');button.id='studio-apply-current-episode';button.className='primary';button.textContent='接回当前话';button.hidden=true;host.append(button);let pending=false;
 const update=()=>{button.hidden=!(mode==='draft'&&packet&&script?.studioSource?.projectId&&script.studioSource.mode==='preproduction-layout');button.disabled=pending||dirty;button.title=dirty?'请先保存当前预览':'将当前可见预览套用到对应话，先备份，可撤销';};
 button.onclick=async()=>{if(pending)return;pending=true;update();try{
  if(dirty)throw Error('请先保存当前预览');const id=currentId,s=structuredClone(script),g=structuredClone(packet);if(!s?.studioSource?.projectId||s.id!==id)throw Error('请先打开有工程来源的本话预览');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(g))),hash=[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
  const info=await api('/api/integration/status'),url=new URL(info.editorOrigin||'http://127.0.0.1:18924');if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)throw Error('当前漫画工作台地址无效');
  if(window.parent!==window&&params.get('integrated')==='1'){window.parent.postMessage({type:'comic-layout:apply-current',scriptId:id,episode:Number(s.episode),expectedPacketHash:hash},url.origin);status('正在接回当前话，保留原图并备份，可撤销。');}
  else{url.pathname='/';url.search=new URLSearchParams({project:params.get('targetProjectId')||s.studioSource.projectId,'apply-layout':id,'layout-episode':String(s.episode),'layout-hash':hash});location.assign(url.href);}
 }catch(e){status(e.message,true);const visible=document.getElementById('current-episode-apply-error')||document.createElement('span');visible.id='current-episode-apply-error';visible.textContent=e.message;visible.style.cssText='color:#a33232;font-size:13px';host.append(visible);}finally{pending=false;update();}};
 setInterval(update,500);update();
})();
// Standalone library handoff stays on the local server and preserves the source project.
(()=>{
 if(window.parent!==window)return;
 const actions=document.querySelector('.actions'),apply=document.createElement('button'),open=document.createElement('a');
 apply.id='library-apply-layout';apply.className='primary';apply.textContent='接回漫画工作台';apply.hidden=true;
 open.id='library-open-applied';open.className='previewButton';open.textContent='打开已接回的新工程';open.hidden=true;open.target='_blank';
 (viewParams.get('view')==='preview'?document.querySelector('header'):actions).append(apply,open);let busy=false,shown='';
 const update=()=>{const valid=mode==='draft'&&script?.studioSource?.projectId&&packet;apply.hidden=!valid;apply.disabled=busy||dirty;if(shown!==currentId){shown=currentId;open.hidden=true;}apply.title=dirty?'请先保存当前排版，再接回':'按当前排版另存为新工程，保留原工程';};
 apply.onclick=async()=>{if(busy)return;busy=true;update();try{if(dirty)throw Error('请先保存当前排版，再接回');const id=currentId,result=await api('/api/integration/apply',{id,script:structuredClone(script),packet:structuredClone(packet)});if(currentId!==id)return;const url=new URL(result.openUrl);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw Error('返回工程地址无效');open.href=url.href;open.hidden=false;status('已接回新工程：'+result.title+'。原工程保留，点击“打开已接回的新工程”继续制作。');}catch(e){status(e.message,true);}finally{busy=false;update();}};
 setInterval(update,500);
})();
// A read-only preview bridge: no export, restore, model or image-generation calls.
(()=>{const params=new URLSearchParams(location.search);if(params.get('integrated')!=='1'||params.get('readonly')!=='1'||window.parent===window)return;
 const parentOrigin='http://127.0.0.1:18924';window.addEventListener('message',event=>{if(event.origin!==parentOrigin||event.source!==window.parent||event.data?.type!=='comic-layout:request-preview'||event.data.scriptId!==params.get('id')||typeof event.data.requestId!=='string')return;if(mode!=='draft'||script?.id!==event.data.scriptId||!packet)return;window.parent.postMessage({type:'comic-layout:preview-packet',requestId:event.data.requestId,script,packet},parentOrigin);});
})();
(()=>{
 if(new URLSearchParams(location.search).get('integrated')!=='1'||window.parent===window)return;
 const directParams=new URLSearchParams(location.search),directToken=directParams.get('direct'),directScript=directParams.get('id');let directBusy=!!directToken;
 const parentOrigin='http://127.0.0.1:18924',actions=document.querySelector('.actions');
 const apply=document.createElement('button');apply.id='studio-apply-layout';apply.className='primary';apply.textContent='作为新工程接回';apply.hidden=true;actions.append(apply);
 const source=document.createElement('section');source.id='studio-source-import';source.hidden=true;source.style.cssText='padding:12px;background:#fff3cf;border:1px solid #d7b455;margin:8px 0;color:#272727';
 const label=document.createElement('p'),confirm=document.createElement('button');confirm.textContent='按当前学习项目导入分镜';source.append(label,confirm);document.querySelector('aside.left').prepend(source);let pending;
 window.addEventListener('message',event=>{if(event.origin!==parentOrigin||event.source!==window.parent||event.data?.type!=='comic-layout:source')return;pending=event.data;source.hidden=false;label.textContent='待导入：'+pending.title+' · '+pending.shots.length+' 格。请先在下方选择对应学习项目。';});
 confirm.onclick=async()=>{if(!pending)return;try{confirm.disabled=true;const r=await fetch('/api/integration/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...pending,learningProjectId:document.getElementById('project').value})});const v=await r.json();if(!r.ok)throw Error(v.error);window.parent.postMessage({type:'comic-layout:imported'},parentOrigin);location.href='/?integrated=1&id='+encodeURIComponent(v.id);}catch(e){label.textContent=e.message;confirm.disabled=false;}};
 window.addEventListener('message',event=>{if(event.origin===parentOrigin&&event.source===window.parent&&event.data?.type==='comic-layout:request-apply'){if(!(directBusy&&script?.id===directScript)&&mode==='draft'&&packet&&script)apply.click();else status('尚无可接回的布局，请先完成Codex自动排版。',true);}});
 let lastSelection='';function update(){const hidden=directBusy&&script?.id===directScript||!(mode==='draft'&&packet&&script?.studioSource?.projectId);if(apply.hidden!==hidden)apply.hidden=hidden;const selection=JSON.stringify({type:'comic-layout:selection',scriptId:script?.id||'',sourceProjectId:script?.studioSource?.projectId||'',planningMode:!!script?.studioSource?.planningBatchId,canApply:!hidden});if(selection!==lastSelection){lastSelection=selection;window.parent.postMessage(JSON.parse(selection),parentOrigin);}}
 new MutationObserver(update).observe(document.querySelector('.actions'),{attributes:true,subtree:true});window.addEventListener('layout-trial-complete',update);setInterval(update,1000);
 apply.onclick=async()=>{try{if(directBusy&&script?.id===directScript)throw Error('排版尚未完成，请等待进度确认');apply.disabled=true;const r=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:currentId,packet})});const v=await r.json();if(!r.ok)throw Error(v.error);packet=v.packet;dirty=false;window.parent.postMessage({type:'comic-layout:apply',scriptId:currentId},parentOrigin);status('正在接回漫画工作台，原工程保留。');}catch(e){status(e.message,true);}finally{apply.disabled=false;}};

 if(directToken&&directScript&&/^[-a-zA-Z0-9]{1,90}$/.test(directToken)){
  let launched=false;
  const readyTimer=setInterval(()=>{if(launched||mode!=='draft'||script?.id!==directScript)return;launched=true;clearInterval(readyTimer);void runDirect();},150);
  async function runDirect(){
   const key='comic-direct-layout-receipt-v1:'+directToken;let receipt;
   const persist=()=>localStorage.setItem(key,JSON.stringify(receipt));
   const announce=(state,message)=>{status(message,state==='failed'||state==='uncertain');window.parent.postMessage({type:'comic-layout:direct-progress',runToken:directToken,scriptId:directScript,jobId:receipt?.jobId,status:state,message,preDispatch:receipt?.preDispatch===true},parentOrigin);};
   try{
    if(!script.layoutRuleContract||!script.studioSource)throw Error('此快捷入口需要工作台送入的固定分镜与统一规则');
    try{receipt=JSON.parse(localStorage.getItem(key)||'null');}catch{receipt=null;}
    if(receipt&&receipt.scriptId!==directScript)throw Error('排版恢复凭据与当前分镜不一致');
    if(!receipt){
     const resume=directParams.get('resumeJob');
     if(resume&&/^[-a-zA-Z0-9]{1,90}$/.test(resume)){receipt={scriptId:directScript,jobId:resume,phase:'polling'};persist();}
     else if(directParams.get('allowStart')!=='1'){receipt={scriptId:directScript,phase:'recovering'};persist();}
     else{receipt={scriptId:directScript,phase:'preparing'};persist();}
    }
    const acknowledgedJob=directParams.get('resumeJob');
    if(!receipt.jobId&&acknowledgedJob&&/^[-a-zA-Z0-9]{1,90}$/.test(acknowledgedJob)){receipt.jobId=acknowledgedJob;receipt.phase='polling';persist();}
    const resolve=allowPreview=>api('/api/model/resolve',{id:directScript,requestId:directToken,allowPreview,...(receipt.jobId?{resumeJob:receipt.jobId}:{})});
    async function finish(){
     if(script?.id!==directScript||currentId!==directScript)throw Error('当前预览已切换，请重新打开本次排版结果');
     if(dirty)throw Error('当前预览有未保存的人工调整，已保留；不会用任务结果覆盖');
     const checked=await resolve(true);if(!checked.previewAvailable)throw Error(checked.message||'尚无通过完整校验的本次有效预览，原稿保留');
     const latest=await api('/api/drafts/'+directScript);
     if(dirty)throw Error('预览读取期间出现人工调整，已保留；请先保存');
     if(JSON.stringify(latest)!==JSON.stringify(checked.packet))throw Error('预览在读取期间更新，请继续查询；未覆盖当前预览');
     packet=latest;if(script.layoutRuleContract?.kind==='learned-project'&&packet.generator?.engine==='unified-rule-layout-v1'){receipt.phase='failed';persist();announce('failed','旧接入结果未经过原助手完整学习规则校验，请返回清单点击重新排版；原结果保留。');return;}selected=-1;dirty=false;render();inspector();previewZoom.fitWidth(720);
     receipt.phase='done';persist();directBusy=false;update();window.dispatchEvent(new Event('layout-trial-complete'));
     announce('done',(receipt.reused?'已复用完整校验通过的有效预览，未调用模型。':'Codex排版已完成。')+'请检查预览；满意后点击“'+(script.studioSource.planningBatchId?'接回前期新工程':'接回带图新工程')+'”。原工程保留。');
    }
    if(receipt.phase==='done'){await finish();return;}
    if(receipt.phase==='failed'&&!receipt.jobId){announce('failed','上次准备或预览校验未通过，旧稿保留；请明确重新排版以另建稿件。');return;}
    const checked=await resolve(receipt.phase==='preparing'&&!receipt.jobId&&directParams.get('preferExisting')==='1'&&directParams.get('forceNew')!=='1');
    if(checked.sourceMatch===false){if(checked.jobId)receipt.jobId=checked.jobId;receipt.phase=['done','failed'].includes(checked.status)?'failed':'polling';persist();announce(receipt.phase==='failed'?'failed':'uncertain','原请求来源已变化，保留原任务，不能复用结果');return;}
    if(checked.jobId){receipt.jobId=checked.jobId;receipt.phase='polling';persist();
     if(checked.status==='uncertain'){announce('uncertain',checked.message||'原任务状态尚未确认；不会另开任务');return;}
     if(checked.status==='failed'){receipt.phase='failed';persist();announce('failed',checked.message||'原任务失败，旧稿保留');return;}
     if(checked.status==='done'){await finish();return;}
    }
    if(!receipt.jobId&&checked.previewAvailable){receipt.reused=true;await finish();return;}
    if(!receipt.jobId&&checked.previewPresent&&!checked.previewAvailable)throw Error('已有预览未通过完整校验，旧稿保留；明确重新排版会另建稿件。'+(checked.message||''));
    if(!receipt.jobId){
     if(receipt.phase!=='preparing'){announce('uncertain','原请求暂未查到可确认的任务；已保留请求编号，不重复启动。');return;}
     const health=await api('/api/integration/status');if(health.busy)throw Error('排版库已有任务在运行或状态待确认，请继续查询原任务');
     receipt.phase='dispatching';persist();announce('starting','已送入本话资料，正在启动Codex自动排版…');
     let result;
     try{result=await api('/api/model/generate',{id:directScript,reasoningEffort:'high',requestId:directToken,forceNew:directParams.get('forceNew')==='1'});}
     catch(error){if(error.preDispatch){receipt.phase='failed';receipt.preDispatch=true;persist();announce('failed','启动前检查未通过，未启动模型：'+error.message);return;}throw error;}
     receipt.jobId=result.jobId;receipt.phase='polling';persist();
     if(result.status==='uncertain'){announce('uncertain','已取回原请求，但状态尚未确认；不会另开任务');return;}
    }
    announce('running','Codex正在排版，任务编号：'+receipt.jobId+'。关闭面板后可从同一入口恢复查看。');
    let interruptions=0;
    async function poll(){
     try{
      const job=await api('/api/jobs/'+receipt.jobId);interruptions=0;
      if(job.status==='done'){
       await finish();return;
      }
      if(job.status==='failed'){receipt.phase='failed';persist();announce('failed',job.message||'排版失败，已保留日志；原工程未改动');return;}
      announce('running',job.message||'Codex正在排版…');setTimeout(()=>{void poll();},2500);
     }catch(error){interruptions++;announce('uncertain','进度读取暂时中断，任务编号已保留；重新打开此入口会恢复查看，不会重新启动。'+error.message);if(interruptions<3)setTimeout(()=>{void poll();},4000);}
    }
    await poll();
   }catch(error){const uncertain=['dispatching','recovering'].includes(receipt?.phase)||!!receipt?.jobId;if(receipt&&!uncertain&&!receipt.jobId){receipt.phase='failed';try{persist();}catch{}}announce(uncertain?'uncertain':'failed',error.message);}
  }
 }
 const preview=document.getElementById('openPreview');new MutationObserver(()=>{if(preview.href&&!preview.href.includes('integrated=1'))preview.href+='&integrated=1';}).observe(preview,{attributes:true,attributeFilter:['href']});
})();
