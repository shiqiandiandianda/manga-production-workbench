import {assetUrl} from './asset-url.js';
import {validateSliceRegion} from './panel-slices.js';
import {mountSliceEditor} from './slice-editor-interaction.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function openPanelSlices({segmentId,sourcePanelId,api,getProject,flushSave,accept,modal,closeModal,toast,selectFrame,exportOnly=false,onExport}){
 await flushSave();const project=getProject(),endpoint='/api/projects/'+project.id+'/production/slices/',preview=await api(endpoint+'preview','POST',{segmentId,sourcePanelId,expectedRevision:project.revision}),regions=structuredClone(preview.regions);let busy=false;



 function feedback(text,error=false){const status=document.querySelector('[data-slices-action-status]');if(status){status.textContent=text;status.classList.toggle('error',error);status.setAttribute('role',error?'alert':'status');}}
 async function execute(action){
  if(busy)return;const h=document.querySelector('.panel-slices'),buttons=[...document.querySelectorAll('#modal-actions>button')];let actionButton,originalLabel;
  try{
   const missing=preview.expected.find(id=>!validateSliceRegion(regions[id]));if(missing){editor?.selectTarget('grid',missing,{focus:true});throw Error('请先为 '+missing+' 框定有效裁切区域，再点击裁切。');}if(getProject().id!==project.id)throw Error('工程已切换，请重新打开裁格');
   const lettering={enabled:false};
   busy=true;h.setAttribute('aria-busy','true');for(const button of buttons)button.disabled=true;actionButton=buttons[action==='apply'?2:1];originalLabel=actionButton?.textContent;if(actionButton)actionButton.textContent=action==='apply'?'正在裁切并加入…':'正在打包…';feedback(action==='apply'?'正在裁切 '+preview.expected.length+' 格并加入画布，请稍候…':'正在裁切并打包独立 PNG，请稍候…');
   await flushSave();if(getProject().id!==project.id)throw Error('工程已切换，请重新打开裁格');const result=await api(endpoint+action,'POST',{previewId:preview.id,expectedRevision:getProject().revision,regions,confirmed:true,lettering,hideSource:document.querySelector('[data-slices-hide]').checked});
   if(action==='apply'){await accept(result.project);if(document.querySelector('.panel-slices')===h)closeModal();const id=result.created[0]||result.reused[0],frame=getProject().pages.flatMap(p=>p.panels).find(f=>f.id===id);if(frame)selectFrame(frame);toast('裁格完成：新增 '+result.created.length+' 格，已存在 '+result.reused.length+' 格；整屏原图保留');}
   else if(exportOnly){await onExport?.(result);closeModal();toast('裁格副本已确认，原工程与原图保留');}
   else{const a=document.createElement('a');a.href=result.zipUrl;a.download=segmentId+'_裁格.zip';a.click();h.querySelector('[data-slices-output]').innerHTML='<p>已导出 '+result.files.length+' 张 PNG。保存文件夹：</p><code>'+esc(result.folder)+'</code><p>'+result.files.map(f=>'<a href="'+esc(f.url)+'" download>'+esc(f.panelId)+' · '+f.width+'×'+f.height+'</a>').join('　')+'</p><a href="'+esc(result.zipUrl)+'" download>重新下载 ZIP</a>';feedback('已导出 '+result.files.length+' 张 PNG，下载已开始。');}
  }catch(error){feedback(error.message,true);}finally{busy=false;h?.removeAttribute('aria-busy');for(const button of buttons)button.disabled=false;if(actionButton)actionButton.textContent=originalLabel;}
 }



 modal((exportOnly?'确认裁格 · 只保存图片副本 · ':'裁格 · ')+segmentId,`<section class="panel-slices slice-workspace slice-workspace-v2">
 <aside class="slice-object-panel"><h3>确认格子</h3><div class="slice-source-row"><select data-slices-source aria-label="来源图片">${preview.sources.map(s=>'<option value="'+esc(s.panelId)+'" '+(s.panelId===preview.sourcePanelId?'selected':'')+'>'+esc(s.label)+'</option>').join('')}</select><small>${preview.width} × ${preview.height} px</small></div><select data-layout-target aria-label="定位对象" hidden>${preview.expected.map(id=>'<option value="grid:'+esc(id)+'">格区 '+esc(id)+'</option>').join('')}</select><div class="slice-object-list"><div data-slices-grids><p class="slice-list-note">按阅读顺序核对边缘，点击缩略图放大这一格。</p><div class="slice-grid-list">${preview.expected.map((id,i)=>'<button data-slice-id="'+esc(id)+'"><canvas data-slice-thumb="'+esc(id)+'" width="180" height="100"></canvas><span><b>'+(i+1)+'</b> '+esc(id)+'</span></button>').join('')}</div></div></div></aside>
 <main class="slice-center"><div class="slice-stage-heading"><strong data-slices-stage-title>确认格子边缘</strong><div><button data-slices-prev aria-label="上一个区域">上一个</button><button data-slices-next aria-label="下一个区域">下一个</button></div></div><div class="slice-view-toolbar"><div role="group" aria-label="画板操作"><button data-slices-interaction="edit" aria-pressed="true">选择</button><button data-slices-interaction="hand" aria-pressed="false">移动画板</button><button data-slices-interaction="draw" aria-pressed="false">重画矩形</button><button data-slices-draw-polygon>斜边 / 多边形</button></div><div><button data-slices-undo disabled>撤销</button><button data-slices-redo disabled>重做</button><button data-slices-zoom="out" aria-label="缩小画板">−</button><input data-slices-zoom-number aria-label="裁格画板缩放百分比" type="number" min="2" max="800" step="1"><span>%</span><button data-slices-zoom="in" aria-label="放大画板">＋</button><button data-slices-focus>看当前格</button><button data-slices-fit>全屏图</button></div></div><div class="slice-polygon-actions" data-slices-polygon-actions hidden><span>按边缘顺序点角，点绿色起点闭合</span><button data-slices-back-point>撤销末点</button><button data-slices-finish>完成轮廓 ↵</button><button data-slices-cancel-polygon>取消重画</button></div><div class="slice-preview" data-slices-viewport><canvas data-slices-canvas tabindex="0" aria-label="裁格画板"></canvas></div><div class="slice-stage-footer"><p data-slices-help></p><label><input data-slices-show-all type="checkbox">同时显示所有标注</label><p data-slices-status role="status"></p></div></main>
 <aside class="slice-property-panel"><div class="slice-current-speaker" data-slices-speaker></div><p data-slices-current-text class="slice-current-content"></p><div class="slice-region-actions"><button data-slices-replace-area>重画矩形</button><button data-slices-reset>恢复原区域</button></div><details class="slice-precision" open><summary>位置与尺寸 · px</summary><div class="slice-values">${['x','y','w','h'].map(k=>'<label>'+({x:'左',y:'上',w:'宽',h:'高'}[k])+'<input type="number" min="0" step="1" data-slice-value="'+k+'"></label>').join('')}</div><button data-slices-clear>清除当前区域</button></details><select data-slices-mode hidden><option value="rect">矩形</option><option value="polygon">多边形</option></select><div data-slices-output></div></aside></section>`,exportOnly?[{label:'返回裁格清单',run:closeModal},{label:'确认裁格并用于重排',primary:true,run:()=>execute('export')}]:[{label:'关闭',run:closeModal},{label:'下载独立 PNG / ZIP',run:()=>execute('export')},{label:'裁出并加入画布',primary:true,run:()=>execute('apply')}]);
 const actions=document.querySelector('#modal-actions');actions.insertAdjacentHTML('afterbegin','<div class="slice-action-notice"><p data-slices-action-status role="status" aria-live="polite">核对格区后即可裁切。</p><label><input type="checkbox" data-slices-hide checked>加入后隐藏整屏及其高清图层（原图保留）</label></div>');
 if(exportOnly){actions.querySelector('label').hidden=true;feedback('检查每个源格ID的裁区，确认后仅保存裁图副本，不改变原画布。');}
 const host=document.querySelector('.panel-slices'),image=new Image();image.src=assetUrl(preview.sourceAssetId);await image.decode();if(!host.isConnected)return;
 const safe=fn=>async e=>{try{await fn(e);}catch(error){feedback(error.message,true);}};
 const editor=mountSliceEditor({host,image,preview,regions,positions:{},texts:[],clean:false,existing:new Map(),feedback,onAdjusted:()=>{},getBusy:()=>busy});editor.update();




 host.querySelector('[data-slices-source]').onchange=safe(e=>openPanelSlices({segmentId,sourcePanelId:e.target.value,api,getProject,flushSave,accept,modal,closeModal,toast,selectFrame,exportOnly,onExport}));
}
