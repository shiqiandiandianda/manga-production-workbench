export function mountLibraryBulkUI({section,api,toast,getScope,onTrashChange,onComplete}){
 const bar=document.createElement('div');
 bar.className='library-page-controls';
 bar.innerHTML='<label><input type="checkbox" data-library-trash>查看回收站</label><span data-library-selection role="status">已选 0 项</span><button type="button" data-library-bulk disabled>批量回收</button><button type="button" data-library-clear disabled>清空选择</button><button type="button" data-library-pending hidden>待核对的批量操作</button>';
 section.querySelector('#library-summary').before(bar);
 const chosen=new Map();let scope='',trash=false,accountId='',dialog=null,busy=false,epoch=0,pendingTicket=0,pendingPlans=[];
 const pendingButton=bar.querySelector('[data-library-pending]');
 const count=()=>{bar.querySelector('[data-library-selection]').textContent='已选 '+chosen.size+' 项（包括其他页）';bar.querySelector('[data-library-bulk]').disabled=!chosen.size||busy;bar.querySelector('[data-library-clear]').disabled=!chosen.size||busy;bar.querySelector('[data-library-bulk]').textContent=trash?'批量恢复':'批量回收';};
 function reset(){chosen.clear();epoch++;pendingTicket++;pendingPlans=[];pendingButton.hidden=true;if(dialog?.open)dialog.close();dialog=null;count();}
 function setContext(actor,value){if(accountId!==(actor||'')||scope!==value){accountId=actor||'';scope=value;reset();void loadPending();}}
 function setScope(value){if(scope!==value){scope=value;reset();void loadPending();}}
 function setAccount(value){if(accountId!==value){accountId=value||'';reset();void loadPending();}}
 async function loadPending(){
  const ticket=++pendingTicket,currentEpoch=epoch,selectedScope=getScope(),actor=accountId;
  if(!actor||!selectedScope)return;
  try{
   const result=await api('/api/library/recycle/pending?projectId='+encodeURIComponent(selectedScope));
   if(ticket!==pendingTicket||currentEpoch!==epoch||actor!==accountId||selectedScope!==getScope())return;
   pendingPlans=Array.isArray(result.items)?result.items:[];
   pendingButton.hidden=!pendingPlans.length;
   pendingButton.textContent='待核对的批量操作（'+pendingPlans.length+'）';
  }catch(error){
   if(ticket!==pendingTicket||currentEpoch!==epoch||actor!==accountId||selectedScope!==getScope())return;
   pendingPlans=[];pendingButton.hidden=false;pendingButton.textContent='待核对操作读取失败，点击重试';pendingButton.title=error.message;
  }
 }
 function render(items){setScope(getScope());for(const item of items){const card=section.querySelector('[data-library-asset="'+CSS.escape(item.id)+'"]');if(!card)continue;const valid=typeof item.assetKind==='string'&&typeof item.assetType==='string'&&Number.isInteger(item.objectVersion)&&item.objectVersion>0;const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.librarySelect=item.id;check.checked=chosen.has(item.id);check.disabled=!valid;label.append(check,document.createTextNode(' 选择'));card.prepend(label);if(trash)for(const button of card.querySelectorAll('[data-library-use]'))button.disabled=true;}count();}
 function attachDialog(dlg){dialog=dlg;document.body.append(dlg);dlg.addEventListener('close',()=>{dlg.remove();if(dialog===dlg)dialog=null;});dlg.showModal();}
 function showPlan(plan,ticket,selectedScope,expectedUserId,recovered=false){
  const dlg=document.createElement('dialog');dlg.className='library-detail-dialog';
  const heading=document.createElement('h2');heading.textContent=(plan.action==='restore'?'确认恢复':'确认移入回收站')+' · '+plan.total+' 项';
  const note=document.createElement('p');
  note.textContent=recovered?'此前提交的结果尚未确认，请先核对以下项目。确认后沿用原批次重试；也可先到墨库查看状态。':plan.action==='restore'?'恢复到原项目、话和类别。':'墨库中的选定素材将移入回收站，其他人暂时无法新选；历史原件和固定引用保留。';
  const list=document.createElement('ul');for(const item of plan.items){const li=document.createElement('li');li.textContent=item.name+' · '+item.assetType+' · '+item.scopeId;list.append(li);}
  const status=document.createElement('p');status.setAttribute('role','status');
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=()=>dlg.close();
  const confirm=document.createElement('button');confirm.type='button';confirm.textContent=plan.action==='restore'?'确认恢复':'确认回收';
  let committing=false;
  dlg.addEventListener('cancel',event=>{if(committing)event.preventDefault();});
  dlg.append(heading,note,list,status,cancel,confirm);
  confirm.onclick=async()=>{
   if(committing)return;committing=true;confirm.disabled=true;cancel.disabled=true;status.textContent='正在提交，请稍候…';
   try{
    const result=await api('/api/library/recycle/commit','POST',{planId:plan.id,expectedUserId});
    if(ticket!==epoch||selectedScope!==getScope()||expectedUserId!==accountId)return;
    dlg.close();chosen.clear();count();toast((plan.action==='restore'?'已恢复 ':'已回收 ')+result.changedCount+' 项');
    await onComplete();void loadPending();
   }catch(error){if(ticket===epoch){status.textContent=error.code==='RECYCLE_PLAN_REJECTED'?error.message:'提交未确认：'+error.message+'。可重试同一批次，或在墨库核对状态。';if(error.code==='RECYCLE_PLAN_REJECTED')confirm.dataset.rejected='true';void loadPending();}}
   finally{committing=false;if(confirm.isConnected){confirm.disabled=confirm.dataset.rejected==='true';cancel.disabled=false;}}
  };
  attachDialog(dlg);
 }
 section.addEventListener('change',event=>{const box=event.target.closest('[data-library-select]');if(!box)return;const item=section.__libraryItems?.find(i=>i.id===box.dataset.librarySelect);if(!item)return;if(box.checked){const projectId=getScope();chosen.set(item.id,{id:item.id,objectVersion:item.objectVersion,assetKind:item.assetKind,assetType:item.assetType,scopeId:projectId==='public'?'global':item.scopeId||item.episodeId||'project'});}else chosen.delete(item.id);count();});
 bar.querySelector('[data-library-trash]').addEventListener('change',event=>{trash=event.target.checked;reset();void loadPending();onTrashChange(trash);});
 bar.querySelector('[data-library-clear]').addEventListener('click',()=>{reset();for(const box of section.querySelectorAll('[data-library-select]'))box.checked=false;void loadPending();});
 bar.querySelector('[data-library-bulk]').addEventListener('click',async()=>{
  if(busy||!chosen.size)return;if(!accountId){toast('请先登录墨库并刷新素材',true);return;}
  busy=true;count();const ticket=epoch,selectedScope=getScope(),expectedUserId=accountId,action=trash?'restore':'recycle';
  try{
   const plan=await api('/api/library/recycle/preview','POST',{projectId:selectedScope,action,expectedUserId,items:[...chosen.values()]});
   if(ticket!==epoch||selectedScope!==getScope()||expectedUserId!==accountId)return;
   showPlan(plan,ticket,selectedScope,expectedUserId);
  }catch(error){if(ticket===epoch)toast(error.message,true);}finally{busy=false;count();}
 });
 pendingButton.addEventListener('click',async()=>{
  if(!pendingPlans.length){await loadPending();if(!pendingPlans.length)return;}
  const ticket=epoch,selectedScope=getScope(),expectedUserId=accountId,dlg=document.createElement('dialog');
  dlg.className='library-detail-dialog';const heading=document.createElement('h2');heading.textContent='待核对的批量操作';dlg.append(heading);
  const note=document.createElement('p');note.textContent='这些批次已提交但结果尚未确认。选择一批后核对，系统不会自动重试。';dlg.append(note);
  for(const plan of pendingPlans){const row=document.createElement('p'),button=document.createElement('button');button.type='button';button.textContent=(plan.action==='restore'?'恢复':'回收')+' '+plan.total+' 项 · '+plan.createdAt;button.onclick=()=>{dlg.close();if(ticket===epoch&&selectedScope===getScope()&&expectedUserId===accountId)showPlan(plan,ticket,selectedScope,expectedUserId,true);};row.append(button);dlg.append(row);}
  const close=document.createElement('button');close.type='button';close.textContent='取消';close.onclick=()=>dlg.close();dlg.append(close);attachDialog(dlg);
 });
 return {setContext,setScope,setAccount,reset,render,isTrash:()=>trash};
}
