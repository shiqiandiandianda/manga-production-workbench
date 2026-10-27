(()=>{
 const select=document.getElementById('project'),panel=document.createElement('section');panel.className='library-controls';
 panel.innerHTML=`<strong>项目学习库</strong><div class="new-project"><input id="libraryName" placeholder="新项目名称" aria-label="新项目名称"><button id="libraryCreate">新增项目</button></div>
 <p class="muted">导入成熟长图 → 保存边界核对 → 选择参考范围 → 学习 → 试排并预览后启用。</p>
 <button id="libraryScope">选择学习参考范围</button><p id="libraryScopeSummary" role="status"></p>
 <p class="muted">范围修改用于下一次学习，已启用版本和已有任务保留。</p>
 <button id="libraryLearn" class="primary" disabled>学习当前项目参考</button><label>学习版本<select id="libraryVersion"></select></label>
 <label>试排速度<select id="libraryEffort"><option value="high">标准速度</option><option value="inherit">沿用本机深度设置</option></select></label>
 <button id="libraryActivate">将所选版本设为项目默认</button><details><summary>查看所选版本的学习内容</summary><div id="libraryRules"></div></details><p id="libraryStatus" role="status"></p>`;
 document.querySelector('aside.left').insertBefore(panel,document.querySelector('aside.left .tabs'));
 const dialog=document.createElement('dialog');dialog.id='libraryScopeDialog';dialog.setAttribute('aria-labelledby','libraryScopeTitle');
 dialog.innerHTML=`<div class="scope-heading"><h2 id="libraryScopeTitle">选择学习参考范围</h2><button id="scopeClose" aria-label="关闭学习范围窗口">关闭</button></div>
 <p id="scopeProjectName"></p><p class="muted">只显示当前项目的参考长图。勾选后点击“保存学习范围”，下次学习只使用所选资料。</p>
 <div class="scope-range"><label>起始话数<input id="scopeStart" type="number" min="1" step="1" placeholder="例如 21"></label><label>结束话数<input id="scopeEnd" type="number" min="1" step="1" placeholder="例如 25"></label><button id="scopeApplyRange">按话数选择</button></div>
 <p class="muted">话数来自文件名中的“第21话”等标记；没有可识别话数的长图仍可逐份勾选。</p>
 <div class="scope-tools"><button id="scopeSelectAll">全选本项目参考</button><button id="scopeClear">清空选择</button><span id="scopeCount" role="status"></span></div>
 <div id="scopeReferences" class="scope-reference-list"></div><p id="scopeError" role="alert"></p><div class="scope-footer"><button id="scopeCancel">取消</button><button id="scopeSave" class="primary">保存学习范围</button></div>`;
 document.body.append(dialog);
 const el=id=>document.getElementById(id),collator=new Intl.Collator('zh-CN',{numeric:true});
 let library,lastProject,refreshTicket=0,rulesTicket=0,scope=null;
 const references=key=>(state?.references||[]).filter(r=>r.projectId===key).sort((a,b)=>(a.episode??Infinity)-(b.episode??Infinity)||collator.compare(a.name,b.name));
 const projectName=key=>state?.projects.find(p=>p.id===key)?.name||key;
 function scopeSummary(refs){
  const chosen=refs.filter(r=>r.learningSelected);
  if(!refs.length)return '本项目尚无参考长图，请先在“参考学习”中导入。';
  if(!chosen.length)return `尚未选择参考，已导入 ${refs.length} 份。请先选择并保存学习范围。`;
  const episodes=[...new Set(chosen.map(r=>r.episode).filter(Number.isInteger))].sort((a,b)=>a-b),extra=chosen.filter(r=>!Number.isInteger(r.episode)).length;
  return `下次学习已选 ${chosen.length} / ${refs.length} 份参考`+(episodes.length?'：第'+episodes.join('、')+'话':'')+(extra?`；另有${extra}份按文件名选择`:'')+'。';
 }
 function renderScope(){
  if(!scope)return;const refs=references(scope.projectId);el('scopeProjectName').textContent='当前项目：'+projectName(scope.projectId);
  el('scopeCount').textContent=`已选 ${refs.filter(r=>scope.selected.has(r.id)).length} / ${refs.length} 份参考`;
  const list=el('scopeReferences');list.replaceChildren();
  if(!refs.length){list.textContent='本项目还没有参考长图。关闭窗口后，进入“参考学习”，点击“＋ 导入”添加。';return;}
  for(const ref of refs){
   const row=document.createElement('label');row.className='scope-reference';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=scope.selected.has(ref.id);checkbox.disabled=scope.saving;checkbox.setAttribute('aria-label',ref.name);checkbox.dataset.referenceId=ref.id;
   const text=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=ref.name;detail.textContent=(Number.isInteger(ref.episode)?`第${ref.episode}话 · `:'未识别话数 · ')+`已核对 ${ref.checked} / ${ref.candidates} 格`;
   text.append(name,detail);row.append(checkbox,text);list.append(row);
   checkbox.onchange=()=>{if(checkbox.checked)scope.selected.add(ref.id);else scope.selected.delete(ref.id);el('scopeError').textContent='';el('scopeCount').textContent=`已选 ${scope.selected.size} / ${refs.length} 份参考`;};
  }
 }
 el('libraryScope').onclick=()=>{if(!state)return;scope={projectId:project,selected:new Set(references(project).filter(r=>r.learningSelected).map(r=>r.id)),saving:false};el('scopeStart').value='';el('scopeEnd').value='';el('scopeError').textContent='';renderScope();dialog.showModal();};
 for(const id of ['scopeClose','scopeCancel'])el(id).onclick=()=>{if(!scope?.saving)dialog.close();};
 dialog.addEventListener('cancel',event=>{if(scope?.saving)event.preventDefault();});dialog.addEventListener('close',()=>{scope=null;});
 el('scopeSelectAll').onclick=()=>{scope.selected=new Set(references(scope.projectId).map(r=>r.id));el('scopeError').textContent='';renderScope();};
 el('scopeClear').onclick=()=>{scope.selected.clear();el('scopeError').textContent='';renderScope();};
 el('scopeApplyRange').onclick=()=>{
  const start=el('scopeStart').valueAsNumber,end=el('scopeEnd').valueAsNumber;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start){el('scopeError').textContent='请填写有效的起始和结束话数，结束话数不能小于起始话数。';return;}
  const matches=references(scope.projectId).filter(r=>Number.isInteger(r.episode)&&r.episode>=start&&r.episode<=end);
  if(!matches.length){el('scopeError').textContent='当前项目没有这个话数范围的参考。请核对文件名，或在下方逐份勾选；现有选择已保留。';return;}
  scope.selected=new Set(matches.map(r=>r.id));el('scopeError').textContent='';renderScope();
 };
 el('scopeSave').onclick=async()=>{
  if(!scope||scope.saving)return;const pending=scope;
  if(pending.projectId!==project){el('scopeError').textContent='当前项目已经变化，请关闭窗口后重新选择。';return;}
  pending.saving=true;for(const node of dialog.querySelectorAll('button,input'))node.disabled=true;
  try{
   const ids=references(pending.projectId).filter(r=>pending.selected.has(r.id)).map(r=>r.id);await api('/api/library/select',{projectId:pending.projectId,referenceIds:ids});dialog.close();await refreshState();
   el('libraryStatus').textContent=ids.length?`已保存本项目的 ${ids.length} 份学习参考。点击“学习当前项目参考”生成新版本；原版本保留。`:'已保存空范围。选择并保存至少一份参考后才能开始学习。';
  }catch(error){el('scopeError').textContent=error.message;}finally{pending.saving=false;for(const node of dialog.querySelectorAll('button,input'))node.disabled=false;}
 };
 async function refresh(forceLatest=false){
  const key=project,ticket=++refreshTicket,result=await api('/api/library');if(ticket!==refreshTicket||key!==project)return;
  library=result;const current=library.projects.find(p=>p.id===key),refs=references(key);
  if(dialog.open&&scope?.projectId!==key)dialog.close();el('libraryScopeSummary').textContent=scopeSummary(refs);el('libraryLearn').disabled=!refs.some(r=>r.learningSelected)||current?.learningJob?.status==='running';
  const version=el('libraryVersion'),previous=lastProject===key?version.value:'';lastProject=key;
  version.replaceChildren(...(current?.versions||[]).map((v,i)=>({...v,displayName:v.label||('版本'+(i+1))})).reverse().map(v=>new Option(v.displayName+(v.id===current.activeVersion?' · 当前默认':v.trialPassed?' · 已试排':' · 待试排'),v.id)));
  const desired=forceLatest?current?.candidateVersion:previous||current?.candidateVersion||current?.activeVersion;if(desired)version.value=desired;
  el('libraryActivate').disabled=!current?.versions.some(v=>v.id===version.value&&(v.trialPassed||v.status==='active'));
  if(script?.layoutRuleContract&&script.projectId===key){const c=script.layoutRuleContract;version.replaceChildren(new Option(c.name+' · 冻结版本',c.version));version.disabled=true;el('libraryActivate').disabled=true;}else version.disabled=false;
  el('libraryStatus').textContent=current?.activeVersion?'当前已启用：版本'+(current.versions.findIndex(v=>v.id===current.activeVersion)+1):'尚未启用学习版本。先选择参考并学习，再试排和预览。';await renderRules();
 }
 el('libraryVersion').onchange=()=>{renderRules();const p=library?.projects.find(p=>p.id===project);el('libraryActivate').disabled=!p?.versions.some(v=>v.id===el('libraryVersion').value&&(v.trialPassed||v.status==='active'));};
 async function renderRules(){
  const box=el('libraryRules'),key=project,version=el('libraryVersion').value,ticket=++rulesTicket;box.replaceChildren();if(!version)return;
  try{
   const result=await api('/api/library/version/'+encodeURIComponent(key)+'/'+encodeURIComponent(version));if(ticket!==rulesTicket||project!==key||el('libraryVersion').value!==version)return;
   const summary=document.createElement('p');summary.textContent=result.style.summary;box.append(summary);const list=document.createElement('ul');for(const pattern of result.style.patterns){const li=document.createElement('li');li.textContent=pattern.name+'：'+pattern.transferRule;list.append(li);}box.append(list);
   const intro=document.createElement('p');intro.textContent=result.parameterOrigin+'（1280宽画布）：';box.append(intro);
   for(const [key,label] of [['continuationGapRange','连续剧情'],['informationGapRange','新信息段落'],['informationRevealGapRange','关键揭示'],['transitionGapRange','真实转场']])if(result.policy[key]){const p=document.createElement('p');p.textContent=label+'：'+result.policy[key].join('—')+' px';box.append(p);}
   const source=document.createElement('p');source.textContent='该版本实际参考：'+result.project.referenceIds.map(id=>state.references.find(r=>r.id===id)?.name||id).join('、');box.append(source);
  }catch(error){if(ticket===rulesTicket)box.textContent=error.message;}
 }
 el('libraryCreate').onclick=async()=>{try{if(dirty)throw Error('请先保存当前修改');const p=await api('/api/projects',{name:el('libraryName').value});el('libraryName').value='';project=p.id;await refreshState();await switchMode('reference');await refresh();}catch(error){el('libraryStatus').textContent=error.message;}};
 el('libraryLearn').onclick=async()=>{
  try{
   if(dirty)throw Error('请先点击“保存核对”，再开始学习');if(!references(project).some(r=>r.learningSelected))throw Error('请先选择并保存至少一份本项目参考。');
   const key=project,job=await api('/api/library/learn',{projectId:key});el('libraryLearn').disabled=true;el('libraryStatus').textContent='本机Codex正在学习本项目已选参考…';
   const poll=async()=>{try{const status=await api('/api/jobs/'+job.jobId);if(project===key)el('libraryStatus').textContent=status.message;if(status.status==='done'||status.status==='failed'){await refresh(status.status==='done');}else setTimeout(poll,3000);}catch(error){if(project===key){el('libraryLearn').disabled=false;el('libraryStatus').textContent=error.message;}}};setTimeout(poll,2000);
  }catch(error){el('libraryStatus').textContent=error.message;}
 };
 el('libraryActivate').onclick=async()=>{try{await api('/api/library/activate',{projectId:project,version:el('libraryVersion').value});await refresh();el('libraryStatus').textContent+='。Agent新任务将使用此版本，已有任务保留原版本。';}catch(error){el('libraryStatus').textContent=error.message;}};
 const originalRefresh=refreshState;refreshState=async()=>{await originalRefresh();await refresh();};select.addEventListener('change',()=>refresh());
 const timer=setInterval(()=>{if(state){clearInterval(timer);refresh();}},250);window.addEventListener('layout-trial-complete',()=>refresh());
})();
