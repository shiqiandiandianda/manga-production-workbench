const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountPublishing({mode,refresh,message}){
 let state,preview,requestId;
 const panel=document.createElement('section');panel.className='panel publication-panel';
 panel.innerHTML='<div class="section-heading"><div><h2>版本发布权限</h2><p data-publication-status>正在读取发布权限…</p></div><button class="primary" data-publish-local hidden>发布本机新版</button></div><p class="note">授权按成员设备保存。新版由主版本签名分发，任务空闲后安全升级。</p><p data-last-publication></p>';
 document.querySelector('.team-own-name').after(panel);
 const dialog=document.createElement('dialog');dialog.className='publication-dialog';
 dialog.innerHTML='<form method="dialog"><div class="section-heading"><h2>发布本机新版</h2><button value="cancel" aria-label="关闭发布窗口">关闭</button></div><p data-base-version></p><div class="publication-files"></div><label>本次更新说明<textarea required maxlength="1000" rows="3" placeholder="说明修复或新增了什么"></textarea></label><p class="note">仅提交工具代码，不上传工程、账号、素材、模型或缓存。发布后，主版本和其他同事通过安全升级接收。</p><p class="publication-error" role="status"></p><button type="button" class="primary" data-confirm-publication>确认发布</button></form>';
 document.body.append(dialog);
 const action=async(url,input,headers={})=>{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)}),value=await response.json();if(!response.ok)throw Error(value.error||'发布操作失败');return value;};
 panel.querySelector('[data-publish-local]').onclick=async()=>{
  const button=panel.querySelector('[data-publish-local]');button.disabled=true;
  try{const response=await fetch('/api/team-release/preview',{cache:'no-store'});preview=await response.json();if(!response.ok)throw Error(preview.error);if(!preview.changes.length&&!preview.removed.length)throw Error('本机没有可发布的代码改动');
   requestId=crypto.randomUUID();dialog.querySelector('[data-base-version]').textContent='基于 '+preview.baseVersion+' · '+preview.changes.length+' 个新增或修改，'+preview.removed.length+' 个删除';
   dialog.querySelector('.publication-files').innerHTML='<ul>'+[...preview.changes.map(row=>'<li>'+escape(row.action)+' · '+escape(row.path)+'</li>'),...preview.removed.map(name=>'<li>删除 · '+escape(name)+'</li>')].join('')+'</ul>';
   dialog.querySelector('textarea').value='';dialog.querySelector('.publication-error').textContent='';dialog.showModal();
  }catch(error){message(error.message);}finally{button.disabled=false;}
 };
 dialog.querySelector('[data-confirm-publication]').onclick=async()=>{
  const note=dialog.querySelector('textarea').value.trim(),button=dialog.querySelector('[data-confirm-publication]');if(!note){dialog.querySelector('textarea').reportValidity();return;}
  button.disabled=true;dialog.querySelector('.publication-error').textContent='正在校验并发布，请稍候…';
  try{const result=await action('/api/team-release/publish',{baseContentId:preview.baseContentId,changeId:preview.changeId,requestId,note});dialog.close();await refresh();message(result.version+' 已发布，团队成员可安全升级。');}
  catch(error){dialog.querySelector('.publication-error').textContent=error.message;}
  finally{button.disabled=false;}
 };
 document.querySelector('#members').addEventListener('click',async event=>{
  const button=event.target.closest('[data-toggle-publish]');if(!button)return;button.disabled=true;
  try{await action(mode==='publisher'?'/api/publication/permission':'/api/team-release/permission',{memberId:button.dataset.togglePublish,enabled:button.dataset.enabled!=='true'},{'X-Dashboard-Control':state.nameControl});await refresh();}
  catch(error){message(error.message);button.disabled=false;}
 });
 return {
  cell(member,current){return '<td class="publication-permission"><span class="pill '+(member.canPublish?'current':'unknown')+'">'+(member.id==='publisher'?'管理员':member.canPublish?'允许发布':'未授权')+'</span>'+(current.canManagePublishPermissions&&member.id!=='publisher'?'<button data-toggle-publish="'+escape(member.id)+'" data-enabled="'+!!member.canPublish+'">'+(member.canPublish?'撤销发布权限':'允许发布新版')+'</button>':'')+'</td>';},
  update(value){state=value;panel.querySelector('[data-publication-status]').textContent=value.canManagePublishPermissions?'在下方成员的“版本发布”列授权或撤销权限。授权成员可发布自己电脑修改的代码。':value.canPublish?'你已获得发布权限，可以在此预览并发布本机修改。':'你尚未获得发布权限，请联系主版本管理员。';panel.querySelector('[data-publish-local]').hidden=mode!=='editor'||value.role==='publisher'||!value.canPublish;panel.querySelector('[data-last-publication]').textContent=value.lastPublication?'最近发布：'+value.lastPublication.author.name+' · '+value.lastPublication.note:'';}
 };
}
