import {bubbleMaterials} from './bubble-material.js';
import {bubbleStyleStatus,loadRemoteBubbleStyles} from './bubble-styles-remote.js';
import {comicPreviewUrl} from './comic-styles.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function openBubbleMaterialPicker({bubble,modal,closeModal,onPick,api}){
 if(!document.querySelector('#bubble-material-css')){const link=document.createElement('link');link.id='bubble-material-css';link.rel='stylesheet';link.href='/bubble-material.css';document.head.append(link);}
 const source=bubbleStyleStatus();
 const note=source.loaded?`来自墨库全局素材· ${source.count} 款`:(source.error?`墨库样式未读取：${escape(source.error)}`:'内置目录（墨库样式尚未读取）');
 modal('选择气泡素材款式','<p>点击款式替换当前气泡轮廓；对白、位置、尺寸和文字框保持原样。参考新款使用对应尾型；双层款可独立调整上方框；竖版人名/地名框会应用竖向尺寸与竖排文字。</p><p class="sub-note" data-bubble-material-source>'+note+'</p><div class="bubble-material-picker" data-bubble-material-picker>'+bubbleMaterials.map(style=>'<button type="button" class="bubble-material-card" data-bubble-material="'+escape(style.id)+'" aria-pressed="'+(style.id===bubble.comicStyleId)+'"><img loading="lazy" src="'+comicPreviewUrl(style.id)+'" alt="'+escape(style.label)+'"><span>'+escape(style.label.replaceAll('_',' · '))+'</span><small>'+escape(style.family)+'</small></button>').join('')+'</div><p data-bubble-material-status role="status"></p>',[{label:'取消',run:closeModal}]);
 const grid=document.querySelector('[data-bubble-material-picker]'),dialog=grid.closest('dialog'),status=dialog.querySelector('[data-bubble-material-status]');let busy=false;
 const paint=()=>{grid.innerHTML=bubbleMaterials.map(style=>'<button type="button" class="bubble-material-card" data-bubble-material="'+escape(style.id)+'" aria-pressed="'+(style.id===bubble.comicStyleId)+'"><img loading="lazy" src="'+comicPreviewUrl(style.id)+'" alt="'+escape(style.label)+'"><span>'+escape(style.label.replaceAll('_',' · '))+'</span><small>'+escape(style.family)+'</small></button>').join('');};
 if(api&&!bubbleStyleStatus().loaded){
  status.textContent='正在读取墨库全局素材…';
  void loadRemoteBubbleStyles(api).then(result=>{
   if(!dialog.open||!grid.isConnected)return;
   const label=dialog.querySelector('[data-bubble-material-source]');
   if(label)label.textContent=result.loaded?`来自墨库全局素材· ${result.count} 款`:`墨库样式未读取：${result.error}（当前显示内置目录）`;
   status.textContent='';paint();
  });
 }
 grid.addEventListener('click',async event=>{
  const button=event.target.closest('[data-bubble-material]');if(!button||busy)return;busy=true;
  for(const choice of grid.querySelectorAll('button'))choice.disabled=true;
  try{await onPick(button.dataset.bubbleMaterial,()=>dialog.open&&grid.isConnected);if(dialog.open&&grid.isConnected)closeModal();}
  catch(error){if(dialog.open&&grid.isConnected)status.textContent=error.message;}
  finally{busy=false;for(const choice of grid.querySelectorAll('button'))choice.disabled=false;}
 });
}
