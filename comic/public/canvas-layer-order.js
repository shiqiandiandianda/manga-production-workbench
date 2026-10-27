import {findLayer,orderedLayers} from './layers.js';
import {layerGroups} from './layer-groups.js';
import {isLibrarySfx} from './sfx-library.js';

export function layerOrderAvailability(project,key){
 const entry=project&&findLayer(project,key),result={entry,up:false,down:false};if(!entry)return result;
 const groups=layerGroups(project),group=groups.find(g=>g.members.some(e=>e.item.id===key));
 const locked=entry.item.locked||entry.page?.locked||(entry.type==='panel'&&group?.id===key&&group.members.some(e=>e.item.locked))||(entry.item.stripSpace&&project.pages.find(p=>p.id===entry.item.stripSpace.pageId)?.locked);
 if(locked)return {...result,locked:true};
 if(entry.type==='bubble'||entry.item.cutoutLayer){
  const rows=orderedLayers(project),keys=isLibrarySfx(entry.item)?rows.map(e=>e.item.id):rows.filter(e=>group?.members.some(m=>m.item.id===e.item.id)).map(e=>e.item.id),at=keys.indexOf(key);
  return {...result,up:at>=0&&at<keys.length-1,down:at>0};
 }
 const at=groups.findIndex(g=>g.id===group?.id);return {...result,up:at>0,down:at>=0&&at<groups.length-1};
}

export function mountCanvasLayerOrder({wrap,scroll,stage,getState,onMove}){
 const root=document.createElement('div');root.className='canvas-layer-order';root.hidden=true;root.setAttribute('role','toolbar');root.setAttribute('aria-label','选中图层快捷操作');
 root.innerHTML='<button type="button" data-canvas-layer-order="up" aria-label="上移一层" title="上移一层：调整图层叠放顺序"><b aria-hidden="true">↑</b><span>上移一层</span></button><button type="button" data-canvas-layer-order="down" aria-label="下移一层" title="下移一层：调整图层叠放顺序"><b aria-hidden="true">↓</b><span>下移一层</span></button>';
 wrap.append(root);const buttons=[...root.querySelectorAll('button')],actions=[];
 function sync(){
  const state=getState(),availability=state.project&&state.keys?.length===1?layerOrderAvailability(state.project,state.keys[0]):null;
  if(state.fixed||!availability?.entry||!state.box){root.hidden=true;return;}
  const matrix=stage.getScreenCTM();if(!matrix){root.hidden=true;return;}
  const region=scroll.getBoundingClientRect(),origin=wrap.getBoundingClientRect(),board=stage.getBoundingClientRect(),box=state.box;
  const top=matrix.d*(box.y-(state.offset||0))+matrix.f,bottom=top+box.h*matrix.d;
  if(bottom<region.top||top>region.bottom||region.height<70||region.width<45){root.hidden=true;return;}
  root.hidden=false;root.classList.toggle('compact',board.left-region.left<120);
  for(const action of actions)action.button.hidden=!action.visible(state);
  for(const button of buttons){const side=button.dataset.canvasLayerOrder;button.disabled=!!state.busy||!availability[side];button.title=availability.locked?'图层已锁定':!availability[side]?(side==='up'?'已到最上层':'已到最下层'):(side==='up'?'上移一层：调整图层叠放顺序':'下移一层：调整图层叠放顺序');}
  const {width,height}=root.getBoundingClientRect();root.style.left=Math.max(region.left-origin.left+6,board.left-origin.left-width-10)+'px';root.style.top=Math.max(region.top-origin.top+8,Math.min(top-origin.top+16,region.bottom-origin.top-height-8))+'px';
 }
 root.addEventListener('pointerdown',event=>event.stopPropagation());
 root.addEventListener('click',event=>{const button=event.target.closest('[data-canvas-layer-order]');if(!button||button.disabled)return;onMove(button.dataset.canvasLayerOrder==='up'?1:-1);sync();});
 root.addEventListener('keydown',event=>{const at=buttons.indexOf(event.target);if(at<0||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const enabled=buttons.filter(b=>!b.disabled);if(!enabled.length)return;const next=event.key==='Home'?enabled[0]:event.key==='End'?enabled.at(-1):enabled[(enabled.indexOf(event.target)+(event.key==='ArrowUp'?-1:1)+enabled.length)%enabled.length];next.focus();});
 scroll.addEventListener('scroll',sync,{passive:true});window.addEventListener('resize',sync);
 return {sync,addAction(button,{visible=()=>true}={}){root.append(button);actions.push({button,visible});sync();},destroy(){scroll.removeEventListener('scroll',sync);window.removeEventListener('resize',sync);root.remove();}};
}
