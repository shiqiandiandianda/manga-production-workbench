import {bindWheelNavigation} from './core.mjs';
export class AnnotationEditor {
  constructor({cursor,canvas,dialog,viewport,space,tool,color,size,text,fontSize,undoButton,zoomOut,zoomFit,zoomIn,toolbar,saveButton,loadingPanel,loadingText,retryButton,onSave}){
    Object.assign(this,{cursor,canvas,dialog,viewport,space,tool,color,size,text,fontSize,undoButton,zoomOut,zoomFit,zoomIn,toolbar,saveButton,loadingPanel,loadingText,retryButton,onSave});
    this.ctx=canvas.getContext('2d');this.pointer=null;this.panning=null;this.spaceHeld=false;this.zoom=1;this.loading=false;this.marks=[];
    canvas.addEventListener('pointerdown',event=>{
      if(this.loading||event.button!==0||this.spaceHeld)return;
      canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);const point=this.point(event);
      if(tool.value==='text'){if(text.value.trim())this.marks.push({kind:'text',x:point.x,y:point.y,text:text.value.trim(),fontSize:Number(fontSize.value),color:color.value});this.render();return;}
      const mark={kind:'stroke',points:[point],size:Number(size.value),color:color.value};this.marks.push(mark);this.pointer=mark;this.render();
    });
    canvas.addEventListener('pointermove',event=>{this.cursorInside=true;this.cursorPoint={x:event.clientX,y:event.clientY};this.updateCursor();if(!this.pointer)return;this.pointer.points.push(this.point(event));this.render();});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{this.pointer=null;});
    bindWheelNavigation(viewport,{blocked:()=>this.loading||!!this.pointer||!!this.panning,onPan:(x,y)=>{viewport.scrollLeft+=x;viewport.scrollTop+=y;},onZoom:(multiplier,event)=>this.zoomAt(this.zoom*multiplier,event.clientX,event.clientY)});
    canvas.addEventListener('pointerenter',event=>{this.cursorInside=true;this.cursorPoint={x:event.clientX,y:event.clientY};this.updateCursor();});canvas.addEventListener('pointerleave',()=>{this.cursorInside=false;this.updateCursor();});for(const event of ['input','focus','blur'])size.addEventListener(event,()=>this.updateCursor());tool.addEventListener('change',()=>this.updateCursor());
    viewport.addEventListener('pointerdown',event=>{
      if(this.loading||!((this.spaceHeld&&event.button===0)||event.button===1))return;
      event.preventDefault();event.stopPropagation();canvas.focus({preventScroll:true});viewport.setPointerCapture(event.pointerId);
      this.panning={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};canvas.style.cursor='grabbing';
    },true);
    viewport.addEventListener('pointermove',event=>{if(!this.panning)return;event.preventDefault();event.stopPropagation();viewport.scrollLeft=this.panning.left+this.panning.x-event.clientX;viewport.scrollTop=this.panning.top+this.panning.y-event.clientY;});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(name,()=>{this.panning=null;this.updateCursor();});
    dialog.addEventListener('keydown',event=>{
      if(!dialog.open||this.loading||event.isComposing||this.typing(event.target))return;
      if(event.key===' '&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopPropagation();this.spaceHeld=true;this.updateCursor();return;}
      if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopPropagation();this.undo();}
    });
    dialog.addEventListener('keyup',event=>{if(event.key===' '){this.spaceHeld=false;this.updateCursor();}});
    dialog.addEventListener('close',()=>this.resetPointer());window.addEventListener('blur',()=>this.resetPointer());
    zoomOut.addEventListener('click',()=>this.zoomAt(this.zoom/1.2));zoomIn.addEventListener('click',()=>this.zoomAt(this.zoom*1.2));zoomFit.addEventListener('click',()=>this.fit());
  }
  setLoading(value,message='正在读取清晰的标注画面…'){
    this.loading=value;this.space.hidden=value;this.loadingPanel.hidden=!value;this.loadingText.textContent=message;this.retryButton.hidden=true;this.viewport.setAttribute('aria-busy',String(value));
    for(const input of this.toolbar.querySelectorAll('button,input,select'))input.disabled=value;
    this.saveButton.disabled=value;
  }
  beginLoading(){this.resetPointer();this.setLoading(true);if(!this.dialog.open)this.dialog.showModal();this.dialog.querySelector('#annotation-close').focus({preventScroll:true});}
  showError(message){this.setLoading(true,message);this.retryButton.hidden=false;}
  typing(target){return ['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable;}
  updateCursor(){
    const visible=this.cursor&&this.dialog.open&&!this.loading&&!this.panning&&!this.spaceHeld&&this.tool.value==='brush'&&this.cursorPoint&&(this.cursorInside||document.activeElement===this.size);
    if(this.cursor){this.cursor.hidden=!visible;if(visible){const diameter=Number(this.size.value)*this.zoom;this.cursor.style.width=`${diameter}px`;this.cursor.style.height=`${diameter}px`;this.cursor.style.left=`${this.cursorPoint.x}px`;this.cursor.style.top=`${this.cursorPoint.y}px`;}}
    this.canvas.style.cursor=this.panning?'grabbing':this.spaceHeld?'grab':this.tool.value==='text'?'text':visible?'none':'crosshair';
  }
  resetPointer(){this.pointer=null;this.panning=null;this.spaceHeld=false;this.cursorInside=false;this.cursorPoint=null;this.updateCursor();}
  point(event){const bounds=this.canvas.getBoundingClientRect();return{x:this.crop.x+(event.clientX-bounds.x)*this.canvas.width/bounds.width,y:this.crop.y+(event.clientY-bounds.y)*this.canvas.height/bounds.height};}
  open(base,crop,marks=[]){this.resetPointer();this.base=base;this.crop=crop;this.marks=structuredClone(marks);this.canvas.width=crop.width;this.canvas.height=crop.height;if(!this.dialog.open)this.dialog.showModal();this.setLoading(false);this.render();this.fit();this.canvas.focus({preventScroll:true});}
  layout(){
    const width=this.canvas.width*this.zoom,height=this.canvas.height*this.zoom;
    this.canvas.style.width=`${width}px`;this.canvas.style.height=`${height}px`;
    this.space.style.width=`${Math.max(width,this.viewport.clientWidth-20)}px`;this.space.style.height=`${Math.max(height,this.viewport.clientHeight-20)}px`;
    this.updateCursor();this.zoomFit.textContent=`${Math.round(this.zoom*100)}% · 适合窗口`;
    this.zoomOut.disabled=this.zoom<=.1;this.zoomIn.disabled=this.zoom>=8;
  }
  fit(){if(this.loading)return;this.zoom=Math.max(.1,Math.min(1,(this.viewport.clientWidth-20)/this.canvas.width,(this.viewport.clientHeight-20)/this.canvas.height));this.layout();this.viewport.scrollLeft=0;this.viewport.scrollTop=0;}
  zoomAt(value,clientX,clientY){
    if(this.loading||this.pointer||this.panning)return;
    const viewportBounds=this.viewport.getBoundingClientRect();clientX??=viewportBounds.x+this.viewport.clientWidth/2;clientY??=viewportBounds.y+this.viewport.clientHeight/2;
    const before=this.canvas.getBoundingClientRect(),x=(clientX-before.x)/before.width,y=(clientY-before.y)/before.height;
    this.zoom=Math.max(.1,Math.min(8,value));this.layout();const after=this.canvas.getBoundingClientRect();
    this.viewport.scrollLeft+=after.x+x*after.width-clientX;this.viewport.scrollTop+=after.y+y*after.height-clientY;
  }
  render(){this.undoButton.disabled=!this.marks.length;const c=this.ctx;c.clearRect(0,0,this.canvas.width,this.canvas.height);c.drawImage(this.base,0,0);c.save();c.translate(-this.crop.x,-this.crop.y);for(const mark of this.marks){c.fillStyle=c.strokeStyle=mark.color;if(mark.kind==='text'){c.font=`${mark.fontSize}px "Microsoft YaHei",sans-serif`;c.textBaseline='top';c.fillText(mark.text,mark.x,mark.y);}else{c.lineWidth=mark.size;c.lineCap='round';c.lineJoin='round';c.beginPath();mark.points.forEach((p,index)=>index?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();if(mark.points.length===1){const p=mark.points[0];c.beginPath();c.arc(p.x,p.y,mark.size/2,0,Math.PI*2);c.fill();}}}c.restore();}
  undo(){if(this.loading)return;this.pointer=null;if(!this.marks.length)return;this.marks.pop();this.render();}
  clear(){if(this.loading)return;this.pointer=null;this.marks=[];this.render();}
  save(){if(this.loading)return;this.onSave(structuredClone(this.marks),this.marks.length?this.canvas.toDataURL('image/png'):null);this.dialog.close();}
}
