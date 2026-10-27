/* The tour only changes navigation and opens empty forms. It never submits work. */
(() => {
 const key='character-studio-walkthrough-v2';let active=false,index=0,root,snapshot,ownedForm=false,raf=0,notice='';
 const steps=[
  ['首页快捷工具','打开工具先看到这些入口，可以直接处理手里的图片；下面的项目入口用于继续整部作品。','home','','.home-tools'],
  ['转换外部角色卡','上传其他地方出的角色卡，不必创建项目。选画风和是否配手部，明确提交后才转换；结果独立保存在快捷工具，也能存入素材库的角色卡分类。','converter','','.tool-form-card'],
  ['建立项目','从这里新建项目。可以上传多个小说或剧本文件，也可以先建空项目。','project','script','[data-action="create-project"]'],
  ['选择章节范围','先填本次制作的起止章节。上传后只读取选中的章节，不会把整本书直接交给分析。','form','','.script-range-field'],
  ['上传剧本文件','在这里选择文件或拖入文件。支持 EPUB、文档、文本和压缩包；项目名称会根据文件识别。','form','','.script-upload-field'],
  ['选择画风与制作方式','指定画风就跳过推荐。手动模式逐步确认；全自动模式按流程制作。教程不会勾选自动生成。','form','','.workflow-choice-field'],
  ['保存项目','填写完成后自己点击创建。这里只介绍入口；退出教程也可以保留正在填写的表单。','form','','#modal-form .modal-footer [type="submit"]'],
  ['拆解选中的剧情','点击拆剧本后分析角色、时期、造型、服装和群像，记录原文依据及未知项。','project','script','[data-kind="analyze"]'],
  ['逐章素材清单','每章查看需要的角色、衣服与群像，以及已做、缺失和待核验的资产。','project','inventory','.chapter-requirements'],
  ['人物时期与定脸','主角和配角分别管理穿越前后及年龄时期。先生成3张差异明显的候选头图，再选择确认。','project','face','.appearance-panel'],
  ['五官微调','需要修改时选择部位、方向和力度，比较预览后明确采用；仅生成预览不会替换原图。','project','face','[data-action="face-refine"]'],
  ['身体底稿','确认完整头部后制作身体底稿，锁定年龄、身材和比例；支持批量制作。','project','body','[data-kind="base"]'],
  ['服装与手部','每套衣服单独制作角色卡及8格手部卡，袖口、护腕、手套随衣服变化。特殊技能可另出动作。','project','outfit','[data-kind="outfit"]'],
  ['合成与导出','角色卡和手部卡上下合并；项目 ZIP 包含项目图片和资料，供后续制作使用。','project','output','[data-kind="combine"]'],
  ['统一素材库','五官、发型、身体、服装、群像和转换角色卡按类别保存。身体模板按男女老少、高矮胖瘦筛选，统一穿白色基础衣着，便于换装。可以收藏；回收站可恢复，也能设置定期清理或手动清理。','library','','.material-tabs'],
  ['从素材组装角色','在素材组装页挑选脸、发型、服装和可选身体。保存到项目后按统一模板制作完整角色卡。','assembly','','.assembly-workspace'],
  ['任务进度与并发','这里查看任务进度、排队和失败原因，最多同时进行8个任务；缺少前置的任务会等待。','queue','','.scheduler-panel'],
  ['随时重新学习','教程不会替你提交生成任务。以后从右上角“新手指引”继续或从头学习，也可下载使用说明。','project','script','[data-action="open-guide"]']
 ];
 function save(completed=false){localStorage.setItem(key,JSON.stringify({index,completed}));localStorage.setItem('character-studio-guide-seen','1');}
 function dirty(){return ownedForm&&dialog.open&&!!($('#project-name',dialog)?.value.trim()||ui.projectFormState?.sourceFiles?.length||$('#project-script',dialog)?.value.trim());}
 function navigate(next){
  if(steps[next][2]!=='form'&&ownedForm&&dialog.open){if(dirty()){notice='请先保存正在填写的项目，或退出教程继续填写。教程不会丢弃表单。';refresh();return;}closeModal();ownedForm=false;}
  index=next;notice='';const [, ,page,stage]=steps[index];
  if(page==='form'){if(!dialog.open){projectForm();ownedForm=true;}}
  else{ui.page=page;if(stage)ui.projectStage=stage;
   if(page==='project'&&!['script','inventory'].includes(stage)){const chars=currentProject()?.characters||[];if(!chars.some(c=>c.id===ui.characterId&&['主角','配角'].includes(c.category))){ui.characterId=chars.find(c=>['主角','配角'].includes(c.category))?.id||ui.characterId;ui.category='全部';}}
   render();}
  save();requestAnimationFrame(()=>{findTarget()?.scrollIntoView({block:'center',behavior:'instant'});refresh();});
 }
 function findTarget(){return [...document.querySelectorAll(steps[index][4])].find(e=>e.getClientRects().length)|| (dialog.open?$('#modal-form'):$('#main .page-heading')||$('#main'));}
 function refresh(){if(!active)return;cancelAnimationFrame(raf);raf=requestAnimationFrame(draw);}
 function draw(){
  if(!active)return;const host=dialog.open?dialog:document.body;if(!root){root=document.createElement('div');root.className='guided-tour';}if(root.parentElement!==host)host.append(root);
  const [title,description]=steps[index];const target=findTarget();if(!target)return;const r=target.getBoundingClientRect(),w=innerWidth,h=innerHeight;
  const l=Math.max(4,r.left-6),t=Math.max(4,r.top-6),right=Math.min(w-4,r.right+6),bottom=Math.min(h-4,r.bottom+6);
  root.innerHTML='<div class="tour-block tour-top"></div><div class="tour-block tour-left"></div><div class="tour-block tour-right"></div><div class="tour-block tour-bottom"></div><div class="tour-ring"></div><section class="tour-coach" role="region" aria-label="逐步新手教程"><div class="tour-count">第 '+(index+1)+' / '+steps.length+' 步 <button data-tour-action="stop" aria-label="退出教程">×</button></div><progress value="'+(index+1)+'" max="'+steps.length+'"></progress><h2>'+escape(title)+'</h2><p>'+escape(description)+'</p>'+(notice?'<p class="tour-notice">'+escape(notice)+'</p>':'')+'<label class="tour-jump">跳到步骤<select aria-label="选择教程步骤" data-tour-jump>'+steps.map((s,i)=>'<option value="'+i+'" '+(i===index?'selected':'')+'>'+(i+1)+' · '+escape(s[0])+'</option>').join('')+'</select></label><div class="tour-actions"><button class="button small" data-tour-action="prev" '+(!index?'disabled':'')+'>上一步</button><button class="button primary small" data-tour-action="next">'+(index===steps.length-1?'完成教程':'下一步')+'</button></div><div class="tour-links"><button data-tour-action="restart">从头开始</button><button data-tour-action="stop">退出教程</button><a href="/help.txt" download>使用说明</a></div></section>';
  const rect=(sel,x,y,width,height)=>Object.assign(root.querySelector(sel).style,{left:x+'px',top:y+'px',width:Math.max(0,width)+'px',height:Math.max(0,height)+'px'});
  rect('.tour-top',0,0,w,t);rect('.tour-left',0,t,l,bottom-t);rect('.tour-right',right,t,w-right,bottom-t);rect('.tour-bottom',0,bottom,w,h-bottom);rect('.tour-ring',l,t,right-l,bottom-t);
  const coach=root.querySelector('.tour-coach'),cw=Math.min(350,w-24),ch=coach.offsetHeight;coach.style.width=cw+'px';
  let x,y;if(w-right>cw+28){x=right+14;y=t;}else if(l>cw+28){x=l-cw-14;y=t;}else if(h-bottom>ch+24){x=(w-cw)/2;y=bottom+12;}else if(t>ch+24){x=(w-cw)/2;y=t-ch-12;}else{x=w-cw-12;y=h-ch-12;}
  coach.style.left=Math.max(12,Math.min(w-cw-12,x))+'px';coach.style.top=Math.max(12,Math.min(h-ch-12,y))+'px';
 }
 function stop(completed=false){if(!active)return;save(completed);active=false;cancelAnimationFrame(raf);root?.remove();root=null;
  if(ownedForm&&dialog.open&&!dirty())closeModal();const keepForm=ownedForm&&dialog.open;ownedForm=false;
  if(!keepForm&&snapshot&&state.projects.some(p=>p.id===snapshot.projectId)&&ui.projectId===snapshot.projectId){Object.assign(ui,snapshot);render();}else if(!keepForm)render();}
 function start(){if(active){refresh();return;}if(dialog.open){toast('请先完成或关闭当前窗口，再开始教程。');return;}snapshot=Object.fromEntries(['page','projectId','characterId','outfitId','category','projectStage','libraryKind'].map(k=>[k,ui[k]]));let saved;try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}active=true;index=saved?.completed?0:Math.min(steps.length-1,Math.max(0,Number(saved?.index)||0));navigate(index);}
 document.addEventListener('click',e=>{const b=e.target.closest('[data-tour-action]');if(!b||!active)return;e.preventDefault();e.stopPropagation();const a=b.dataset.tourAction;if(a==='stop')stop();if(a==='prev')navigate(Math.max(0,index-1));if(a==='restart')navigate(0);if(a==='next'){if(index===steps.length-1)stop(true);else navigate(index+1);}});
 document.addEventListener('change',e=>{if(active&&e.target.matches('[data-tour-jump]'))navigate(Number(e.target.value));});
 document.addEventListener('keydown',e=>{if(!active)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();stop();}},true);
 window.addEventListener('resize',refresh);document.addEventListener('scroll',refresh,true);
 window.characterTour={start,stop,refresh,get active(){return active;},get index(){return index;}};
})();
