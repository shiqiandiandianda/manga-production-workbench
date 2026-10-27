export function mountAssetSidebarResize({root=document,storage=globalThis.localStorage}={}){
 const shell=root.querySelector('.app-shell'),sidebar=root.querySelector('.sidebar'),inspector=root.querySelector('#inspector-panel');
 if(!shell||!sidebar)return;
 const key='comic-asset-sidebar-width',handle=root.createElement('div');handle.className='asset-sidebar-resize';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label','拖动调整资产列表宽度');handle.title='向右拖动加宽资产列表；双击恢复默认宽度';shell.append(handle);
 let wanted=0,drag=null;try{const value=Number(storage.getItem(key));if(Number.isFinite(value)&&value>=226)wanted=Math.min(720,value);}catch{}
 const bounds=()=>{const rail=root.querySelector('.workspace-rail')?.getBoundingClientRect().width||56,right=inspector&&!shell.classList.contains('inspector-collapsed')?inspector.getBoundingClientRect().width:0;return {min:226,max:Math.max(226,Math.min(720,shell.clientWidth-rail-right-(innerWidth>1250?280:180)))};};
 function place(){handle.style.left=(sidebar.offsetLeft+sidebar.getBoundingClientRect().width-5)+'px';const b=bounds();handle.setAttribute('aria-valuemin',b.min);handle.setAttribute('aria-valuemax',b.max);handle.setAttribute('aria-valuenow',Math.round(sidebar.getBoundingClientRect().width));}
 function apply(value,{save=false}={}){const b=bounds(),width=Math.round(Math.max(b.min,Math.min(b.max,value)));shell.style.setProperty('--asset-sidebar-width',width+'px');if(save){wanted=width;try{storage.setItem(key,String(width));}catch{}}place();}
 if(wanted)apply(wanted);
 handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();drag={id:event.pointerId,x:event.clientX,width:sidebar.getBoundingClientRect().width};handle.setPointerCapture(event.pointerId);root.body.classList.add('asset-sidebar-resizing');});
 handle.addEventListener('pointermove',event=>{if(drag?.id!==event.pointerId)return;event.preventDefault();apply(drag.width+event.clientX-drag.x,{save:true});});
 const end=event=>{if(drag?.id!==event.pointerId)return;drag=null;if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);root.body.classList.remove('asset-sidebar-resizing');};
 for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,end);
 handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const b=bounds();apply(event.key==='Home'?b.min:event.key==='End'?b.max:sidebar.getBoundingClientRect().width+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?50:10),{save:true});});
 handle.addEventListener('dblclick',()=>{wanted=0;shell.style.removeProperty('--asset-sidebar-width');try{storage.removeItem(key);}catch{}place();});
 const resizeToFit=()=>{if(wanted)apply(wanted);else place();};
 new ResizeObserver(place).observe(sidebar);const observer=new MutationObserver(resizeToFit);for(const node of [root.body,shell])observer.observe(node,{attributes:true,attributeFilter:['class']});window.addEventListener('resize',resizeToFit);place();
 return {handle};
}
