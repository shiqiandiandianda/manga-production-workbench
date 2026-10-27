export function updateTaskRailNavigation(root){
 const rail=root.querySelector('.task-card-rail');if(!rail)return;
 const end=Math.max(0,rail.scrollWidth-rail.clientWidth);
 for(const button of root.querySelectorAll('[data-task-scroll]'))button.disabled=Number(button.dataset.taskScroll)<0?rail.scrollLeft<=1:rail.scrollLeft>=end-1;
}
export function mountTaskRailNavigation(root){
 const rail=()=>root.querySelector('.task-card-rail');
 root.addEventListener('click',event=>{const button=event.target.closest('[data-task-scroll]');if(!button)return;rail()?.scrollBy({left:Number(button.dataset.taskScroll)*Math.max(250,rail().clientWidth*.8),behavior:'smooth'});});
 root.addEventListener('wheel',event=>{
  const target=event.target.closest('.task-card-rail');if(!target||event.ctrlKey||event.metaKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
  const amount=event.deltaY*(event.deltaMode===1?20:event.deltaMode===2?target.clientWidth:1),next=Math.max(0,Math.min(target.scrollWidth-target.clientWidth,target.scrollLeft+amount));
  if(next!==target.scrollLeft){event.preventDefault();target.scrollLeft=next;}
 },{passive:false});
 root.addEventListener('keydown',event=>{
  const target=rail();if(event.target!==target||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();
  if(event.key==='Home'||event.key==='End')target.scrollLeft=event.key==='Home'?0:target.scrollWidth;
  else target.scrollLeft+=(event.key==='ArrowLeft'?-1:1)*274;
 });
 root.addEventListener('scroll',()=>updateTaskRailNavigation(root),true);
 const observer=new ResizeObserver(()=>updateTaskRailNavigation(root));observer.observe(root);
 return ()=>observer.disconnect();
}
