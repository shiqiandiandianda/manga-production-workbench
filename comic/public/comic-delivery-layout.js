import {layoutLongStrip,bounds} from './model.js';
import {pageEpisode,currentBoardEpisode,resolveBoard,hasEpisodeBoard} from './episode-boards.js';
import {sceneLayers} from './layers.js';
import {bubbleLayout} from './lettering.js';

/** Read-only export views keep original document coordinates and layer ordering. */
export function comicDeliveryLayouts(project,episode,assets=[],{requireBody=true}={}){
 if(!Number.isInteger(episode)||episode<1||episode>9999)throw Object.assign(Error('请选择要导出的单话'),{status:400});
 const original=layoutLongStrip(project.pages),entries=original.pages.filter(e=>(pageEpisode(project,e.page)||currentBoardEpisode(project,e.page))===episode);
 const section=list=>{let y=0;const pages=[],parts=[];for(const e of list){pages.push({...e,y,endY:y+e.height});parts.push({kind:'comic',episode,sourcePageId:e.pageId,sourceY:e.y,sourceHeight:e.height,y,height:e.height,endY:y+e.height});y+=e.height;}return {width:1280,height:y,pages,episodeBoardParts:parts,originalLayout:original};};
 const body=section(entries.filter(e=>!['cover','tail'].includes(e.page.designEpisodeRole)));
 if(requireBody&&body.height<3)throw Object.assign(Error('本话正文不足 3 像素，无法分成 3 张'),{status:400});
 const groups={body};
 for(const kind of ['cover','tail']){const own=entries.filter(e=>e.page.designEpisodeRole===kind);if(own.length){groups[kind]=section(own);continue;}if(!hasEpisodeBoard(project,kind,episode))continue;const board=resolveBoard(project,kind,episode,assets);groups[kind]={width:1280,height:board.height,pages:[{pageId:'fixed-'+kind,page:{id:'fixed-'+kind,width:1280,height:board.height,panels:[],bubbles:[]},y:0,height:board.height,endY:board.height}],episodeBoardParts:[{kind,episode,board,y:0,height:board.height,endY:board.height}],originalLayout:original};}
 return {episode,groups};
}
export const deliveryDimensions=plan=>Object.fromEntries(Object.entries(plan.groups).map(([kind,l])=>[kind,{width:l.width,height:l.height}]));

/** Text and discrete frames veto cuts. Full-screen raster gaps are checked on actual pixels. */
export function deliveryProtectedRanges(project,layout,measurement){
 const result=[],layers=sceneLayers(project,layout.originalLayout);
 for(const part of layout.episodeBoardParts){for(const item of layers){const f=item.frame;if(!f.visible||item.type==='gradient')continue;
  let boxes=[];
  if(item.type==='bubble'){
   const l=measurement?bubbleLayout(measurement,f):null,layouts=l?[l,...l.dialogueLayouts||[]]:[];
   boxes=[{x:0,y:0,w:f.w,h:f.h},...(layouts.flatMap(v=>[v.textBox,...(Array.isArray(v.drawOutline)?v.drawOutline:[]).map(p=>({x:p.x,y:p.y,w:1,h:1})),...(v.lines||[]).map(line=>({x:line.x-(line.width||0),y:line.y-v.fontSize,w:Math.max(1,(line.width||0)*2),h:v.fontSize*1.6}))]).filter(Boolean))];
   if(f.tail&&Number.isFinite(f.tail.y))boxes.push({x:0,y:f.tail.mode==='normalized'?f.tail.y*f.h:f.tail.y-f.y,w:1,h:1});
  }else{
   if(f.productionSegment||f.productionBackground||f.productionBackgroundInstance||f.kind==='background'||f.cutoutLayer&&f.visible===false)continue;
   if(f.imageAssetId&&f.h>Math.max(1600,item.entry?.page.height*.7)&&f.w>=(item.entry?.page.width||1280)*.8)continue;
   boxes=[bounds(f)];
  }
  const rotation=(item.type==='bubble'?(f.sfxRotation||0):(f.rotation||0))*Math.PI/180,c=Math.cos(rotation),s=Math.sin(rotation),ys=[];
  for(const b of boxes.filter(b=>[b.x,b.y,b.w,b.h].every(Number.isFinite)))for(const x of [b.x,b.x+b.w])for(const y of [b.y,b.y+b.h])ys.push(item.offsetY+(f.y+f.h/2+(x-f.w/2)*s+(y-f.h/2)*c)*item.scale);
  if(!ys.length)continue;const start=Math.max(part.sourceY,Math.min(...ys)-12*item.scale),end=Math.min(part.sourceY+part.height,Math.max(...ys)+12*item.scale);
  if(end>start)result.push({start:Math.max(0,Math.floor(part.y+start-part.sourceY)),end:Math.min(layout.height,Math.ceil(part.y+end-part.sourceY)),kind:item.type==='bubble'?'text':'frame'});
 }}
 return result;
}
