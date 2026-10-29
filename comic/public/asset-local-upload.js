const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readFile=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('无法读取本地图片'));reader.readAsDataURL(file);});

export function mountAssetLocalUpload({host,api,onAsset,onDone}){
 let active=null;
 return {async open({input,verify}){
  if(active)return;
  const route='/api/projects/'+input.projectId+'/asset-workspace/';
  const dialog=document.createElement('dialog');dialog.className='asset-upload-dialog';active=dialog;
  dialog.innerHTML='<header><strong>本地上传资产</strong><button type="button" data-upload-close aria-label="关闭上传">×</button></header><p role="status">正在读取墨库归属…</p>';
  host.append(dialog);dialog.showModal();
  let stopped=false,running=false,files=[],next=0;
  const close=()=>{stopped=true;dialog.close();dialog.remove();if(active===dialog)active=null;};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{if(event.target.closest('[data-upload-close]'))close();});
  try{
   const info=await api(route+'upload-context','POST',input);verify();if(stopped)return;
   dialog.innerHTML='<header><div><strong>上传到墨库</strong><small>'+esc(info.name)+' · '+esc({character:'人物',scene:'场景',prop:'道具'}[info.role])+'</small></div><button type="button" data-upload-close aria-label="关闭上传">×</button></header><label>所属墨库作品<select data-upload-project><option value="">请选择作品</option>'+info.projects.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===info.projectId?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><div class="asset-upload-tags"><span>自动标签</span><div>'+info.tags.map(tag=>'<b>'+esc(tag)+'</b>').join('')+'</div></div><button type="button" class="primary" data-upload-choose>选择本地图片并上传</button><input type="file" data-asset-upload-input accept=".png,.jpg,.jpeg,.webp" multiple hidden><p class="asset-inline-note">PNG / JPEG / WebP · 每张 ≤24 MB · 支持多选</p><p role="status" data-upload-status></p><button type="button" data-upload-retry hidden>重试未完成的图片</button>';
   const select=dialog.querySelector('[data-upload-project]'),choose=dialog.querySelector('[data-upload-choose]'),fileInput=dialog.querySelector('[data-asset-upload-input]'),status=dialog.querySelector('[data-upload-status]'),retry=dialog.querySelector('[data-upload-retry]');
   const update=()=>{choose.disabled=running||!select.value;select.disabled=running;};update();select.addEventListener('change',update);
   async function upload(){
    if(running||stopped)return;running=true;retry.hidden=true;update();
    const projectId=select.value;
    try{
     for(;next<files.length;next++){
      if(stopped)return;verify();const file=files[next];
      if(!file.size||file.size>24*1024*1024)throw Error(file.name+'：单张图片须小于24 MB');
      if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw Error(file.name+'：请选择 PNG、JPEG 或 WebP 图片');
      status.textContent='正在上传 '+(next+1)+' / '+files.length+'：'+file.name;
      const dataBase64=await readFile(file);verify();if(stopped)return;
      const result=await api(route+'upload','POST',{...input,sessionVersion:info.sessionVersion,mokuProjectId:projectId,fileName:file.name,dataBase64});
      onAsset(result.asset);verify();
     }
     if(!stopped){onDone(files.length);close();}
    }catch(error){if(!stopped){status.textContent=error.message;status.setAttribute('role','alert');retry.hidden=false;}}
    finally{running=false;update();}
   }
   choose.addEventListener('click',()=>fileInput.click());
   fileInput.addEventListener('change',()=>{files=Array.from(fileInput.files||[]);next=0;fileInput.value='';if(files.length)void upload();});
   retry.addEventListener('click',()=>void upload());
  }catch(error){if(!stopped){dialog.querySelector('[role=status]').textContent=error.message;}}
 }};
}
