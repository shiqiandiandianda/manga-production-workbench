/* View-only zoom. Never modifies panel coordinates or layout data. */
(function(root){
 'use strict';
 function wheelScale(scale,delta,mode=0,pageHeight=800){
  const pixels=delta*(mode===1?16:mode===2?pageHeight:1);
  return Math.min(4,Math.max(.005,scale*Math.exp(-Math.max(-300,Math.min(300,pixels))*.0015)));
 }
 function attach({viewport,content,onChange=()=>{}}){
  let naturalWidth=1280,naturalHeight=1400,scale=.5;
  function center(){const r=viewport.getBoundingClientRect();return {x:r.left+viewport.clientLeft+viewport.clientWidth/2,y:r.top+viewport.clientTop+viewport.clientHeight/2};}
  function apply(next,anchor=center()){
   if(!Number.isFinite(next))return;
   next=Math.min(4,Math.max(.005,next));
   const old=content.getBoundingClientRect(),point={x:(anchor.x-old.left)/(old.width||naturalWidth*scale),y:(anchor.y-old.top)/(old.height||naturalHeight*scale)};
   scale=next;content.style.width=naturalWidth*scale+'px';content.style.height=naturalHeight*scale+'px';
   const after=content.getBoundingClientRect();
   viewport.scrollLeft+=after.left+point.x*after.width-anchor.x;
   viewport.scrollTop+=after.top+point.y*after.height-anchor.y;
   onChange({scale,width:naturalWidth*scale,height:naturalHeight*scale});
  }
  function wheel(event){
   if(!event.ctrlKey||!event.deltaY)return;
   event.preventDefault();event.stopPropagation();
   apply(wheelScale(scale,event.deltaY,event.deltaMode,viewport.clientHeight),{x:event.clientX,y:event.clientY});
  }
  viewport.addEventListener('wheel',wheel,{passive:false});
  function available(){const style=root.getComputedStyle(viewport);return {w:viewport.clientWidth-parseFloat(style.paddingLeft||0)-parseFloat(style.paddingRight||0),h:viewport.clientHeight-parseFloat(style.paddingTop||0)-parseFloat(style.paddingBottom||0)};}
  return {
   setSize(width,height){naturalWidth=width;naturalHeight=height;content.style.width=width*scale+'px';content.style.height=height*scale+'px';onChange({scale,width:width*scale,height:height*scale});},
   setScale:apply,
   fitWidth(maxWidth=Infinity){apply(Math.min(maxWidth,available().w)/naturalWidth);},
   fitAll(){const a=available();apply(Math.min(a.w/naturalWidth,a.h/naturalHeight));viewport.scrollTop=0;},
   getScale(){return scale;},
   destroy(){viewport.removeEventListener('wheel',wheel);}
  };
 }
 const api={attach,wheelScale};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.LayoutPreviewZoom=api;
})(typeof window!=='undefined'?window:globalThis);
