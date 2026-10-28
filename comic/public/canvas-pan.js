export function mountCanvasPan({scroll,viewport,root=document}){
 let space=false,drag=null;
 const editable=target=>target?.closest?.('input,textarea,select,[contenteditable="true"]');
 const cursor=()=>scroll.classList.toggle('canvas-hand-ready',space);
 const finish=()=>{if(drag&&scroll.hasPointerCapture(drag.id))scroll.releasePointerCapture(drag.id);drag=null;scroll.classList.remove('canvas-hand-dragging');};
 root.addEventListener('keydown',event=>{if(event.code!=='Space'||event.ctrlKey||event.metaKey||event.altKey||editable(event.target)||root.querySelector('dialog[open]'))return;event.preventDefault();space=true;cursor();},true);
 root.addEventListener('keyup',event=>{if(event.code==='Space'){space=false;finish();cursor();}},true);
 scroll.addEventListener('pointerdown',event=>{if(!space||event.button!==0)return;event.preventDefault();event.stopImmediatePropagation();drag={id:event.pointerId,x:event.clientX,y:event.clientY};scroll.setPointerCapture(event.pointerId);scroll.classList.add('canvas-hand-dragging');},true);
 scroll.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();viewport.panBy(event.clientX-drag.x,event.clientY-drag.y);drag.x=event.clientX;drag.y=event.clientY;},true);
 for(const type of ['pointerup','pointercancel','lostpointercapture'])scroll.addEventListener(type,()=>{if(drag){const active=drag;drag=null;if(scroll.hasPointerCapture(active.id))scroll.releasePointerCapture(active.id);scroll.classList.remove('canvas-hand-dragging');}},true);
 window.addEventListener('blur',()=>{space=false;finish();cursor();});
}
