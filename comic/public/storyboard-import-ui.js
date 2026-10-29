export function initStoryboardImportUI({api,flushSave,refreshState,chooseProject,getProject,onImported,toast}){
 const dialog=document.querySelector('#storyboard-import-dialog'),body=dialog.querySelector('.storyboard-import-body'),actions=dialog.querySelector('.storyboard-import-actions');let file=null,busy=false;
 const status=text=>body.querySelector('[data-import-status]').textContent=text;
 async function importData(){
  if(busy)return;busy=true;for(const control of dialog.querySelectorAll('button,input,textarea,select'))control.disabled=true;
  try{
   await flushSave();const text=body.querySelector('#storyboard-paste').value,episode=body.querySelector('#storyboard-fallback-episode').value,title=body.querySelector('#storyboard-import-title').value,current=body.querySelector('#storyboard-import-target').value==='current'?getProject():null;
   if(!file&&!text.trim())throw Error('请选择分镜表或粘贴分镜内容');
   const input={title,...(episode?{episode:Number(episode)}:{}),...(current?{projectId:current.id,expectedRevision:current.revision}:{})};
   if(file){if(file.size>8*1024*1024)throw Error('分镜文件超过8MB');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('分镜文件读取失败'));reader.readAsDataURL(file);});Object.assign(input,{name:file.name,dataBase64:data.split(',')[1]});}else input.text=text;
   status('正在读取分镜并创建画格…');const saved=await api('/api/projects/storyboard-import','POST',input);
   if(current&&onImported)await onImported(saved);else{await refreshState();await chooseProject(saved,{fit:true});}
   dialog.close();toast('分镜已导入，可直接编辑和生图');
  }catch(error){status(error.message);toast(error.message,true);}finally{busy=false;for(const control of dialog.querySelectorAll('button,input,textarea,select'))control.disabled=false;}
 }
 function openImport({target='new'}={}){
  file=null;const current=getProject();body.innerHTML='<div class="storyboard-data-import"><label>导入到<select id="storyboard-import-target"><option value="new">新建工程</option>'+(current?'<option value="current">更新当前工程</option>':'')+'</select></label><button id="storyboard-pick-file" class="primary">选择分镜表</button><input id="storyboard-data-file" type="file" accept=".xlsx,.csv,.tsv,.json,.txt" hidden><p id="storyboard-file-name" role="status">尚未选择分镜表</p><label>工程名称（新建时可留空）<input id="storyboard-import-title" maxlength="180"></label><label>话号（表内没有话号时填写）<input id="storyboard-fallback-episode" type="number" min="1" max="9999"></label><label>粘贴分镜表<textarea id="storyboard-paste" rows="7" placeholder="格号&#9;出现角色&#9;当前场景&#9;画面内容&#9;台词&#9;生图提示词"></textarea></label><p data-import-status role="status"></p></div>';
  if(current&&target==='current')body.querySelector('#storyboard-import-target').value='current';
  body.querySelector('#storyboard-pick-file').onclick=()=>body.querySelector('#storyboard-data-file').click();
  body.querySelector('#storyboard-data-file').onchange=event=>{file=event.target.files[0]||null;body.querySelector('#storyboard-file-name').textContent=file?.name||'尚未选择分镜表';body.querySelector('#storyboard-paste').disabled=!!file;};
  actions.replaceChildren();for(const [label,run,primary] of [['取消',()=>{if(!busy)dialog.close();},false],['导入分镜',importData,true]]){const button=document.createElement('button');button.textContent=label;if(primary)button.className='primary';button.onclick=run;actions.append(button);}
  dialog.querySelector('[data-storyboard-import-close]').onclick=()=>{if(!busy)dialog.close();};dialog.showModal();
 }
 return {openImport};
}
