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
export function speakerMarkup(project,bubble,assets=[],{editable=false}={}){
  const speaker=bubbleSpeaker(project,bubble);if(!speaker)return '';
  const asset=speakerAvatar(project,bubble,assets),avatar=asset?speakerAvatarMarkup(asset,speaker.name,{assigned:!!project?.speakerAvatars?.[speaker.name],escape:esc}):'<span class="speaker-initial" aria-hidden="true">'+esc([...speaker.name][0])+'</span>';
  return '<div class="bubble-speaker-info">'+avatar+'<div><small>'+esc(speaker.label)+'</small><strong>'+esc(speaker.name)+'</strong></div>'+(editable&&speaker.known?'<button type="button" data-action="choose-speaker-avatar" title="为本话这个人物选择头像">'+(asset?'换头像':'选头像')+'</button>':'')+'</div>';
}
export function mountBubbleSpeaker({stage,scroll,getProject,getSelection,getAssets}){
  const chip=document.createElement('div');chip.className='bubble-speaker-chip';chip.hidden=true;chip.setAttribute('role','status');chip.setAttribute('aria-live','polite');document.body.append(chip);
  function refresh(){
    const selection=getSelection(),project=getProject(),bubble=selection?.type==='bubble'?project?.pages?.flatMap(page=>page.bubbles||[]).find(item=>item.id===selection.id):null;
    if(!bubbleSpeaker(project,bubble)){chip.hidden=true;return;}
    const node=stage.querySelector('[data-bubble="'+bubble.id+'"]');if(!node){chip.hidden=true;return;}
    // The complete SVG bounds include the tail; the badge belongs to the body.
    const matrix=node.getScreenCTM();if(!matrix){chip.hidden=true;return;}
    const width=Number(node.dataset.renderW)||bubble.w,height=Number(node.dataset.renderH)||bubble.h;
    const corners=[[0,0],[width,0],[0,height],[width,height]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f}));
    const rect={left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))},area=scroll.getBoundingClientRect();if(rect.right<area.left||rect.left>area.right||rect.bottom<area.top||rect.top>area.bottom){chip.hidden=true;return;}
    chip.innerHTML=speakerMarkup(project,bubble,getAssets());chip.hidden=false;
    const chipWidth=chip.offsetWidth,chipHeight=chip.offsetHeight,above=rect.top-chipHeight-8>=area.top,left=above?rect.left:rect.left-chipWidth-8>=area.left?rect.left-chipWidth-8:rect.right+8;chip.style.left=Math.max(area.left+6,Math.min(left,area.right-chipWidth-6))+'px';chip.style.top=Math.max(area.top+6,Math.min(above?rect.top-chipHeight-8:rect.top,area.bottom-chipHeight-6))+'px';
  }
  scroll.addEventListener('scroll',refresh,{passive:true});window.addEventListener('resize',refresh);return {refresh,hide:()=>{chip.hidden=true;}};
}
