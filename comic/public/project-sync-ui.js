/**
 * 顶栏墨库快照状态：保存工程后自动上传，失败可点击重试。
 * 不参与本机保存流程：任何墨库错误只改这里的状态文字。
 */
export function mountProjectSyncUI({getProject,getJobs=()=>null,api,toast,openLibrary,openLogin=openLibrary,openSetup}){
  const anchor=document.querySelector('.save-indicator');
  if(!anchor)return {refresh(){}};
  const button=document.createElement('button');
  button.type='button';button.id='moku-sync';button.className='moku-sync is-idle';
  button.innerHTML='<span class="dot" aria-hidden="true"></span><span class="moku-sync-text" data-moku-sync-text>墨库</span>';
  anchor.insertAdjacentElement('afterend',button);
  const label=button.querySelector('[data-moku-sync-text]');
  const summary=text=>String(text||'').replace(/\s+/g,' ').slice(0,220);
  const clock=value=>{
    const date=value?new Date(value):null;
    if(!date||Number.isNaN(date.getTime()))return '';
    return String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0');
  };
  const set=({kind='idle',text='墨库',title=''}={})=>{
    button.classList.remove('is-idle','is-synced','is-pending','is-error','is-off','is-busy');
    button.classList.add('is-'+kind);
    label.textContent=text;button.title=title;button.setAttribute('aria-label',text+'（'+title+'）');
  };
  let connected=null,connectionAt=0,busy=false,state={},epoch=0,timer=null,refreshTimer=null;
  const generating=()=>{const list=getJobs();return Array.isArray(list)?list.some(j=>j.projectId===getProject()?.id&&['queued','preparing','running','recoverable','delegated','awaiting_confirmation'].includes(j.status)):state.generation?.active||state.status==='generating';};

  function paint(){
    const project=getProject();
    button.disabled=busy||!!project&&generating()||(!project&&connected!==false);
    if(project&&generating()){set({kind:'pending',text:'生成中 · 暂停上传',title:'当前工程有未完成的生成任务；本机继续保存，生成结束后自动继续同步'});return;}
    if(connected===false){set({kind:'off',text:'墨库未登录',title:'点击直接输入墨库账号和密码'});return;}
    if(!project){set({kind:'idle',text:'墨库',title:'打开工程后，保存会自动上传工程快照'});return;}
    if(busy){set({kind:'busy',text:'上传中…',title:'正在把当前工程快照上传到墨库'});return;}
    if(state.setupRequired){set({kind:'pending',text:'选择墨库归属',title:'本机已保存；点击选择项目和话，角色或场景可选'});return;}
    if(state.error){set({kind:'error',text:'墨库同步失败',title:summary(state.error)+'（点击重试）'});return;}
    if(state.pending){set({kind:'pending',text:'墨库待上传',title:'本次保存的快照等待上传；点击立即上传'});return;}
    if(state.syncedAt){
      const target=state.target?.name?' · '+state.target.name:'';
      set({kind:'synced',text:'墨库 '+clock(state.syncedAt),title:'工程快照已同步到墨库'+target+'；点击立即上传最新版本'});
      return;
    }
    set({kind:'idle',text:'墨库未同步',title:'点击把当前工程快照上传到墨库'});
  }

  async function refresh({force=false}={}){
    const ticket=++epoch,project=getProject();
    try{
      if(force||connected===null||Date.now()-connectionAt>60000){
        const status=await api('/api/library/status');
        connected=!!status.connected;connectionAt=Date.now();
      }
    }catch{connected=false;connectionAt=Date.now();}
    let next={};
    if(project){
      try{next=await api('/api/project-sync/status?projectId='+encodeURIComponent(project.id));}catch{}
    }
    if(ticket!==epoch)return;
    state=next||{};paint();
  }

  function schedule(delay=1500){
    clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{refreshTimer=null;void refresh();},delay);
  }

  button.addEventListener('click',async()=>{
    const project=getProject();
    if(busy)return;
    if(connected===false){openLogin?.();return;}
    if(!project)return toast?.('请先打开工程',true);
    if(generating()){paint();return;}
    if(state.setupRequired&&openSetup){await openSetup();return;}
    busy=true;paint();
    try{
      const result=await api('/api/project-sync/push','POST',{projectId:project.id});
      state=result.state||state;
      toast?.(result.status==='formal-only'?'本机已保存；请在“本话版本”提交正式版本':result.status==='generating'?'生成中，已暂停上传；生成结束后继续同步':result.status==='unchanged'?'墨库已有最新工程快照':`已上传工程快照到墨库${result.target?.name?' · '+result.target.name:''}`);
    }catch(error){try{const latest=await api('/api/project-sync/status?projectId='+encodeURIComponent(project.id));state=latest;if(latest.setupRequired&&openSetup)await openSetup();else toast?.('上传墨库失败：'+(latest.error||error.message),true);}catch{toast?.('上传墨库失败：'+error.message,true);}}
    finally{busy=false;await refresh({force:true});}
  });

  const saveState=document.querySelector('#save-state');
  if(saveState){
    let last=saveState.textContent;
    new MutationObserver(()=>{
      const text=saveState.textContent;
      if(text===last)return;
      last=text;
      if(/已保存到本机|正在保存/.test(text))schedule();
    }).observe(saveState,{childList:true,characterData:true,subtree:true});
  }
  const projectLabel=document.querySelector('#project-label');
  if(projectLabel)new MutationObserver(()=>schedule(300)).observe(projectLabel,{childList:true,characterData:true,subtree:true});
  timer=setInterval(()=>{if(!document.hidden)void refresh();},20000);timer.unref?.();
  window.addEventListener('focus',()=>{void refresh();});
  window.addEventListener('moku-auth-changed',()=>{void refresh({force:true});});
  void refresh({force:true});
  return {refresh:()=>refresh({force:true}),paint};
}
