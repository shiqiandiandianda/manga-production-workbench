import {BOARD_KINDS,BOARD_LABELS,ensureEpisodeBoards,currentBoardEpisode,resolveBoard,boardImageTransform} from './episode-boards.js';
import {mountBoardImageInput} from './episode-board-images.js';
const field=(label,key,value,min,max)=>`<label>${label}<input type="number" data-board-image="${key}" value="${value}" min="${min}" max="${max}" step="1"></label>`;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function mountEpisodeBoards({getProject,getAssets=()=>[],getPage,edit,onRender,onPreview=onRender,onLocate=()=>{},openInspector,onBackground,onUpload,toast}){
 const body=document.querySelector('#inspector-body'),host=document.querySelector('#stage');
 let kind=null,number=1,projectId=null,drag=null,generation=0;
 const isActive=()=>!!kind&&getProject()?.id===projectId;
 const board=()=>resolveBoard(getProject(),kind,number,getAssets());
 const target=()=>({projectId,kind,number,generation});
 const isCurrent=t=>isActive()&&t.projectId===projectId&&t.kind===kind&&t.number===number&&t.generation===generation;
 function mutate(fn,operation='episode-boards.image.edit'){
  const current=board();
  edit(()=>{
   const state=ensureEpisodeBoards(getProject()),entry=state.episodes[number]||={};
   const frame=entry[kind]||={useOwnBackground:false,backgroundAssetId:null};
   // Freeze dimensions before replacement; all new changes belong to this episode.
   Object.assign(frame,{useOwnBackground:true,backgroundAssetId:current.backgroundAssetId,frameHeight:current.height,imageFit:current.imageFit,imageTransform:boardImageTransform(current.imageTransform),enabled:true,present:true});fn(frame);
  },{source:'manual',operation});
 }
 function applyBackground(asset,t){if(!isCurrent(t)){toast('画板已切换，请返回原画板重新选择图片',true);return;}generation++;mutate(frame=>{frame.backgroundAssetId=asset.id;frame.imageTransform=boardImageTransform();frame.imageFit='contain';},'episode-boards.image.replace');}
 const imageInput=mountBoardImageInput({body,isActive,snapshot:target,isCurrent,upload:onUpload,onApply:applyBackground,toast});
 function cards(){const project=getProject();if(!project)return {cover:'',tail:''};const episode=isActive()?number:currentBoardEpisode(project,getPage());const card=k=>`<button class="page-card fixed-board-card ${isActive()&&kind===k?'active':''}" data-episode-board="${k}"><span class="fixed-board-thumb">${k==='cover'?'封':'完'}</span><span>${BOARD_LABELS[k]}<div class="count">固定格子 · 第 ${episode} 话</div><small>上传图片 / 墨库选图</small></span></button>`;return {cover:card('cover'),tail:card('tail')};}
 function open(nextKind,{locate=true}={}){
  if(!BOARD_KINDS.includes(nextKind)||!getProject())return;finish();const project=getProject(),nextNumber=currentBoardEpisode(project,getPage());
  if(!project.episodeBoards)edit(()=>ensureEpisodeBoards(project),{operation:'episode-boards.initialize'});
  if(kind!==nextKind||number!==nextNumber||projectId!==project.id){cancelDrag();generation++;}kind=nextKind;number=nextNumber;projectId=project.id;
  document.body.classList.add('episode-board-selected');openInspector();onRender();if(locate)onLocate(kind);
 }
 function close({render=true}={}){finish();cancelDrag();kind=null;projectId=null;generation++;document.body.classList.remove('episode-board-selected');if(render)onRender();}
 function sync(){if(drag&&drag.project!==getProject())cancelDrag();if(kind&&(!isActive()||currentBoardEpisode(getProject(),getPage())!==number))close({render:false});}
 function finish(){if(!isActive())return;const input=document.activeElement;if(body.contains(input)&&input.matches('[data-board-image],[data-board-height]'))input.blur();}
 function preview(){if(isActive())onPreview();}
 function inspector(){
  if(!isActive())return;const b=board(),t=drag?.next||b.imageTransform;
  document.querySelector('#inspector-kind').textContent=BOARD_LABELS[kind]+' · 固定格子';document.querySelector('#inspector-title').textContent=`第 ${number} 话 · ${b.width} × ${b.height} px`;document.querySelector('#delete-layer').disabled=true;body.dataset.inspectorKey='fixed-'+kind;
  body.innerHTML=`<div class="board-inspector"><section><h3>${BOARD_LABELS[kind]}图片</h3><label>格子高度 px<input type="number" data-board-height value="${b.height}" min="1" max="65536" step="1"></label><button class="primary wide" data-board-upload>上传图片</button><div class="board-two-columns"><button data-board-background>从墨库选择</button><button data-board-paste>粘贴图片</button></div><p class="sub-note" data-board-upload-status>支持 Ctrl+V · PNG / JPEG / WebP ≤60MB</p><p class="sub-note">${b.backgroundAssetId?'在格子里直接拖动图片调整位置。':'上传或从墨库选择图片。'}仅修改当前话的${BOARD_LABELS[kind]}。</p></section>${b.backgroundAssetId?`<section><h3>图片取景</h3><div class="board-two-columns"><button data-board-action="contain">完整显示</button><button data-board-action="cover">填满格子</button><button data-board-action="flipX">水平镜像</button><button data-board-action="flipY">垂直镜像</button><button data-board-action="left">左转 90°</button><button data-board-action="right">右转 90°</button></div><div class="board-two-columns">${field('图片缩放 %','scale',Math.round(t.scale*100),5,2000)}${field('图片旋转 °','rotation',t.rotation,-360,360)}${field('水平位置 px','x',Math.round(t.x),-65536,65536)}${field('垂直位置 px','y',Math.round(t.y),-65536,65536)}</div><button class="wide" data-board-action="reset">重置取景</button><button class="wide" data-board-action="clear">移除图片</button></section>`:''}</div>`;imageInput.sync();
 }
 body.addEventListener('change',event=>{if(!isActive())return;if(event.target.matches('[data-board-height]')){const input=event.target,value=Number(input.value);if(input.value===''||!input.checkValidity()||!Number.isSafeInteger(value)){toast('格子高度须为 1—65536 的整数像素',true);inspector();return;}if(value!==board().height)mutate(frame=>{frame.frameHeight=value;},'episode-boards.frame.resize');return;}if(!event.target.matches('[data-board-image]'))return;const input=event.target,key=input.dataset.boardImage;if(!['scale','rotation','x','y'].includes(key))return;if(input.value===''||!input.checkValidity()||!Number.isFinite(Number(input.value))){toast('请输入有效的图片取景数值',true);inspector();return;}mutate(frame=>{frame.imageTransform[key]=Number(input.value)/(key==='scale'?100:1);});});
 body.addEventListener('click',event=>{
  if(!isActive())return;if(event.target.closest('[data-board-background]')){const t=target();onBackground({currentAssetId:board().backgroundAssetId,onApply:asset=>applyBackground(asset,t)});return;}
  const action=event.target.closest('[data-board-action]')?.dataset.boardAction;if(!action)return;generation++;mutate(frame=>{const t=frame.imageTransform;if(action==='clear'){frame.backgroundAssetId=null;frame.imageTransform=boardImageTransform();}else if(action==='contain'||action==='cover'){frame.imageFit=action;frame.imageTransform=boardImageTransform();}else if(action==='reset'){frame.imageFit='contain';frame.imageTransform=boardImageTransform();}else if(action==='flipX'||action==='flipY')t[action]=!t[action];else if(action==='left'||action==='right')t.rotation=(t.rotation+(action==='left'?-90:90))%360;});
 });
 const point=event=>{const svg=host.querySelector('[data-fixed-board="'+kind+'"]>svg'),matrix=svg?.getScreenCTM();return matrix?new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()):null;};
 function cancelDrag(){if(!drag)return;const pointerId=drag.pointerId;drag=null;if(host.hasPointerCapture(pointerId))host.releasePointerCapture(pointerId);}
 function pointerDown(event){if(!isActive()||event.button!==0||!board().backgroundAssetId)return;const start=point(event);if(!start)return;event.preventDefault();event.stopPropagation();const original=board().imageTransform;drag={project:getProject(),pointerId:event.pointerId,start,original,next:{...original}};host.setPointerCapture(event.pointerId);}
 host.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;event.preventDefault();event.stopImmediatePropagation();if(drag.project!==getProject()){cancelDrag();return;}const p=point(event);if(!p)return;for(const axis of ['x','y']){drag.next[axis]=clamp(drag.original[axis]+p[axis]-drag.start[axis],-65536,65536);const input=body.querySelector('[data-board-image="'+axis+'"]');if(input)input.value=Math.round(drag.next[axis]);}preview();});
 host.addEventListener('pointerup',event=>{if(!drag||event.pointerId!==drag.pointerId)return;event.stopImmediatePropagation();const {next,original,project}=drag;cancelDrag();if(project===getProject()&&(next.x!==original.x||next.y!==original.y))mutate(frame=>{frame.imageTransform=next;},'episode-boards.image.move');});
 host.addEventListener('pointercancel',()=>{cancelDrag();preview();inspector();});host.addEventListener('lostpointercapture',()=>{if(drag){cancelDrag();preview();inspector();}});
 host.addEventListener('keydown',event=>{if(!isActive()||!event.target.closest('[data-fixed-board]')||!board().backgroundAssetId)return;const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!d)return;event.preventDefault();event.stopPropagation();mutate(frame=>{frame.imageTransform.x=clamp(frame.imageTransform.x+d[0]*(event.shiftKey?10:1),-65536,65536);frame.imageTransform.y=clamp(frame.imageTransform.y+d[1]*(event.shiftKey?10:1),-65536,65536);});});
 return {get active(){return isActive();},get editing(){return !!drag;},get episode(){return number;},get kind(){return kind;},get selection(){return isActive()?{kind,episode:number,key:'image',previewTransform:drag?.next}:null;},open,pointerDown,close,sync,finish,cards,preview,inspector,get board(){return isActive()?board():null;}};
}
