// Right-click changes the editing tool without changing the selected objects.
export function bindSelectionToolMenu({menu,surfaces,canOpen,getTool,onChoose,focusCanvas}){
 const doc=menu.ownerDocument,win=doc.defaultView,buttons=[...menu.querySelectorAll('[data-menu-tool]')];
 const close=({focus=false}={})=>{if(menu.hidden)return;menu.hidden=true;if(focus)focusCanvas();};
 const choose=button=>{
  if(!button||!canOpen()){close({focus:true});return;}
  const tool=button.dataset.menuTool;close();onChoose(tool);focusCanvas();
 };
 const open=event=>{
  if(!canOpen())return;
  event.preventDefault();
  for(const button of buttons)button.setAttribute('aria-checked',String(button.dataset.menuTool===getTool()));
  menu.hidden=false;
  const margin=8,box=menu.getBoundingClientRect();
  menu.style.left=Math.max(margin,Math.min(event.clientX,win.innerWidth-box.width-margin))+'px';
  menu.style.top=Math.max(margin,Math.min(event.clientY,win.innerHeight-box.height-margin))+'px';
  (buttons.find(button=>button.dataset.menuTool===getTool())||buttons[0]).focus({preventScroll:true});
 };
 for(const surface of surfaces)surface.addEventListener('contextmenu',event=>{
  // Keep the native text menu and unrelated toolbar controls available.
  if(event.target.closest('input,textarea,select,[contenteditable=true]'))return;
  if(surface.id==='floating-tools'&&!event.target.closest('[data-tool=select],[data-tool=frame-move],[data-tool=layer-move]'))return;
  open(event);
 });
 menu.addEventListener('contextmenu',event=>event.preventDefault());
 menu.addEventListener('click',event=>choose(event.target.closest('[data-menu-tool]')));
 menu.addEventListener('keydown',event=>{
  event.stopPropagation();
  const index=buttons.indexOf(doc.activeElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();
   const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
   buttons[next].focus({preventScroll:true});
  }else if(['Enter',' '].includes(event.key)){event.preventDefault();choose(buttons[index]);}
  else if(event.key==='Tab')close({focus:true});
 });
 doc.addEventListener('keydown',event=>{
  if(!menu.hidden&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close({focus:true});}
 },true);
 doc.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))close();},true);
 doc.addEventListener('wheel',()=>close(),{capture:true,passive:true});
 win.addEventListener('resize',()=>close());win.addEventListener('blur',()=>close());
 return{close};
}
