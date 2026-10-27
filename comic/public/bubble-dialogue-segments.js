import {applyBubbleMaterial} from './bubble-material.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const dialogueSegments=b=>Array.isArray(b.dialogueSegments)?b.dialogueSegments:[];
export const isDoubleBubble=b=>b.comicStyleId==='builtin-double'||b.shape==='asset'&&b.assetParts?.some(p=>p.id==='upper-bubble');
export const bubbleSourceTextIds=b=>[...new Set([b.productionTextId,...dialogueSegments(b).map(s=>s.sourceTextId)].filter(Boolean))];
export function defaultDialogueBox(b,index){
 const upper=b.assetParts?.find(p=>p.id==='upper-bubble');
 return index===0&&upper?{x:upper.x+upper.w*.16,y:upper.y+upper.h*.16,w:upper.w*.68,h:upper.h*.64}:index===0?{x:.17,y:.12,w:.66,h:.32}:{x:.15,y:.45,w:.70,h:.40};
}
export function syncDialogueText(b){b.text=dialogueSegments(b).map(s=>s.text).join('\n\n');delete b.textLayout;return b;}
export function segmentBubble(b,index){
 const segment=dialogueSegments(b)[index],box=segment.textBox||defaultDialogueBox(b,index),next={...b,text:segment.text,textBox:segment.independentBox?{...segment.independentBox}:{x:box.x*b.w,y:box.y*b.h,w:Math.max(1,box.w*b.w),h:Math.max(1,box.h*b.h)},overflow:'fit'};
 delete next.dialogueSegments;delete next.textLayout;delete next.textFrameLayout;if(segment.textLayout)next.textLayout=segment.textLayout;
 return next;
}
export function validDialogueSegments(b){
 const list=b.dialogueSegments;if(list===undefined)return true;
 return Array.isArray(list)&&list.length===2&&new Set(list.map(s=>s?.id)).size===2&&list.every(s=>s&&typeof s.id==='string'&&s.id.length>0&&s.id.length<=40&&typeof s.text==='string'&&s.text.length<=4000&&(s.sourceTextId===undefined||typeof s.sourceTextId==='string'&&s.sourceTextId.length<=120)&&(s.speaker===undefined||typeof s.speaker==='string'&&s.speaker.length<=180)&&s.textBox&&['x','y','w','h'].every(k=>Number.isFinite(s.textBox[k]))&&s.textBox.x>=0&&s.textBox.y>=0&&s.textBox.w>0&&s.textBox.h>0&&s.textBox.x+s.textBox.w<=1.00001&&s.textBox.y+s.textBox.h<=1.00001)&&b.text===list.map(s=>s.text).join('\n\n')&&b.text.length<=4000;
}
export function addDialogueSegment(b,text=''){
 if(b.locked)throw Error('请先解锁气泡');if(!isDoubleBubble(b))throw Error('请先选择双圆气泡');if(dialogueSegments(b).length)throw Error('双圆气泡已有两段台词');
 const next=structuredClone(b);next.dialogueSegments=[{id:'dialogue-1',text:b.text,sourceTextId:b.productionTextId,speaker:b.speaker||'',textBox:defaultDialogueBox(b,0)},{id:'dialogue-2',text:String(text),textBox:defaultDialogueBox(b,1)}];
 delete next.textBox;delete next.textFrameLayout;delete next.productionAutoLettering;
 syncDialogueText(next);if(!validDialogueSegments(next))throw Error('两段台词合计最多 4000 字');return next;
}
export function editDialogueSegment(b,index,{text,dx=0,dy=0,resize=false,box}={}){
 const next=structuredClone(b),segment=dialogueSegments(next)[index];if(!segment||b.locked)return next;
 if(text!==undefined){segment.text=String(text);delete segment.textLayout;syncDialogueText(next);if(!validDialogueSegments(next))throw Error('两段台词合计最多 4000 字');return next;}
 const normalized=segment.textBox||defaultDialogueBox(next,index),current=segment.independentBox||{x:normalized.x*b.w,y:normalized.y*b.h,w:normalized.w*b.w,h:normalized.h*b.h};
 if(box){segment.textBox=box;delete segment.independentBox;delete segment.textLayout;return next;}
 segment.independentBox=resize?{...current,w:Math.max(1,current.w+dx),h:Math.max(1,current.h+dy)}:{...current,x:current.x+dx,y:current.y+dy};if(resize)delete segment.textLayout;return next;
}
export function mergeDialogueBubbles(first,second,bounds){
 if(first.locked||second.locked)throw Error('请先解锁两句台词');if(first.id===second.id||dialogueSegments(first).length||dialogueSegments(second).length)throw Error('请选择两句尚未合并的台词');
 if(first.parentPanelId!==second.parentPanelId||first.productionSegment!==second.productionSegment||(first.productionGridId||first.productionOriginal?.['格ID'])!==(second.productionGridId||second.productionOriginal?.['格ID']))throw Error('只能合并同一格的两句台词');
 if(first.type!=='speech'||second.type!=='speech')throw Error('请选择两句对白台词');
 const x=Math.min(first.x,second.x),y=Math.min(first.y,second.y),w=Math.max(first.x+first.w,second.x+second.w)-x,h=Math.max(first.y+first.h,second.y+second.h)-y;
 let next=applyBubbleMaterial({...first,...(bounds||{x,y,w,h}),type:'speech'},'builtin-double');
 next=addDialogueSegment(next,second.text);Object.assign(next.dialogueSegments[1],{sourceTextId:second.productionTextId,speaker:second.speaker||''});
 // Retain both original source records without keeping a second visible layer.
 next.dialogueSources=[structuredClone(first.productionOriginal||{}),structuredClone(second.productionOriginal||{})];
 next.tail={visible:true,side:'bottom',base:.6};next.name='双圆气泡 · 两段台词';return next;
}
