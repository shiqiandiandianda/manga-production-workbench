import {resolveSpeakerAvatar,speakerAvatarMarkup} from './speaker-avatar.js';
const esc=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function bubbleSpeaker(project,bubble){
  if(!bubble||!['speech','thought','caption'].includes(bubble.type))return null;
  const shot=project?.shots?.find(item=>item.id===bubble.shotId),line=shot?.dialogueLines?.find(item=>item.id===bubble.storyboard?.lineId);
  const name=String(bubble.speaker||line?.speaker||'').trim();return {name:name||(bubble.type==='caption'?'旁白':'未指定说话人'),known:!!name,label:bubble.type==='thought'?'心声':bubble.type==='caption'?'旁白':'说话人'};
}
export function speakerAvatar(project,bubble,assets=[],options={}){
  const speaker=bubbleSpeaker(project,bubble);if(!speaker?.known)return null;
  return resolveSpeakerAvatar(project,bubble,speaker.name,assets,options);
}
/** Number each source dialogue occurrence in reading order; the same speaker may speak again. */
export function speakerOrder(project,bubble,scope='segment'){
 const segments=project?.productionPackage?.episodes||[],segmentId=bubble?.productionSegment||project?.pages?.flatMap(p=>p.panels||[]).find(p=>p.id===bubble?.parentPanelId)?.panelSlice?.segmentId;
 const episode=segments.find(e=>e.segments?.some(s=>s.id===segmentId));if(!episode)return null;
 const segment=episode.segments.find(s=>s.id===segmentId),textId=bubble.productionTextId||bubble.productionOriginal?.['文字ID'];
 const rows=(episode.texts||[]).filter(t=>t['渲染']==='工具'&&/对白|心声|内心|意念/.test(String(t['类型']||''))&&String(t['说话人']||'').trim()&&(scope==='episode'||t['段ID']===segment?.localId));
 const index=rows.findIndex(t=>t['文字ID']===textId);return index<0?null:index+1;
}
export function speakerMarkup(project,bubble,assets=[],{editable=false}={}){
  const speaker=bubbleSpeaker(project,bubble);if(!speaker)return '';
  const asset=speakerAvatar(project,bubble,assets),avatar=asset?speakerAvatarMarkup(asset,speaker.name,{assigned:!!project?.speakerAvatars?.[speaker.name],escape:esc}):'<span class="speaker-initial" aria-hidden="true">'+esc([...speaker.name][0])+'</span>';
  return '<div class="bubble-speaker-info">'+avatar+'<div><small>'+esc(speaker.label)+'</small><strong>'+esc(speaker.name)+'</strong></div>'+(editable&&speaker.known?'<button type="button" data-action="choose-speaker-avatar" title="为本话这个人物选择头像">'+(asset?'换头像':'选头像')+'</button>':'')+'</div>';
}
export function badgePosition(rect,area,width,height,controls){
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
 const candidates=[rect.left-width-14,rect.right+14].flatMap(left=>[rect.top,rect.bottom-height,(rect.top+rect.bottom-height)/2,...controls.flatMap(r=>[r.top-height-12,r.bottom+12])].map(y=>{const top=clamp(y,area.top+6,area.bottom-height-6);return {left,top,right:left+width,bottom:top+height};}));
 // Never clamp a side badge back over the body or put it above the bubble.
 // Prefer the visible side, then a free vertical position beside the controls.
 return candidates.map((p,i)=>({...p,score:(width*height-overlap(p,area))*100+controls.reduce((sum,r)=>sum+overlap(p,r),0)*10,i})).sort((a,b)=>a.score-b.score||a.i-b.i)[0];
}
export function mountBubbleSpeaker({stage,scroll,getProject,getSelection,getAssets,displayOnCanvas=true}){
  const chip=document.createElement('div');chip.className='bubble-speaker-chip';chip.hidden=true;chip.setAttribute('role','status');chip.setAttribute('aria-live','polite');document.body.append(chip);
  function refresh(){
    if(!displayOnCanvas){chip.hidden=true;return;}
    const selection=getSelection(),project=getProject(),bubble=selection?.type==='bubble'?project?.pages?.flatMap(page=>page.bubbles||[]).find(item=>item.id===selection.id):null;
    if(!bubbleSpeaker(project,bubble)){chip.hidden=true;return;}
    const node=stage.querySelector('[data-bubble="'+bubble.id+'"]');if(!node){chip.hidden=true;return;}
    // The complete SVG bounds include the tail; the badge belongs to the body.
    const matrix=node.getScreenCTM();if(!matrix){chip.hidden=true;return;}
    const width=Number(node.dataset.renderW)||bubble.w,height=Number(node.dataset.renderH)||bubble.h;
    const corners=[[0,0],[width,0],[0,height],[width,height]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f}));
    const rect={left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))},area=scroll.getBoundingClientRect();if(rect.right<area.left||rect.left>area.right||rect.bottom<area.top||rect.top>area.bottom){chip.hidden=true;return;}
    let scope='segment';try{scope=localStorage.getItem('comic-speaker-order:'+project.id)==='episode'?'episode':'segment';}catch{}
    const order=speakerOrder(project,bubble,scope);chip.innerHTML=speakerMarkup(project,bubble,getAssets())+(order?'<div class="speaker-order-row"><span class="speaker-order-number" title="说话顺序">'+order+'</span><button type="button" class="speaker-order-scope" data-speaker-order-scope title="切换编号范围">'+(scope==='segment'?'本屏':'整话')+'</button></div>':'');chip.hidden=false;
    const controls=[...stage.querySelectorAll('[data-bubble="'+CSS.escape(bubble.id)+'"] [data-bubble-handle]')].map(n=>n.getBoundingClientRect()),position=badgePosition(rect,area,chip.offsetWidth,chip.offsetHeight,controls);chip.style.left=position.left+'px';chip.style.top=position.top+'px';
  }
  chip.addEventListener('click',event=>{if(!event.target.closest('[data-speaker-order-scope]'))return;const project=getProject();if(!project)return;let next='episode';try{const key='comic-speaker-order:'+project.id;next=localStorage.getItem(key)==='episode'?'segment':'episode';localStorage.setItem(key,next);}catch{}refresh();});
  scroll.addEventListener('scroll',refresh,{passive:true});window.addEventListener('resize',refresh);return {refresh,hide:()=>{chip.hidden=true;}};
}
