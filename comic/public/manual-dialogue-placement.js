import {TEXT_FONT_DEFAULTS} from './text-font-defaults.js';
import {dialogueEntries,dialogueVisible,dialogueLocked} from './dialogue-entries.js';
import {id,layoutLongStrip} from './model.js';
import {currentBoardEpisode} from './episode-boards.js';
import {bubbleSourceTextIds} from './bubble-dialogue-segments.js';
import {productionStyleKind,resolveProductionStyle,applyProductionStyle} from './production-lettering-style.js';
import {productionTextContent} from './production-text.js';
import {fitDialogueObject} from './auto-lettering.js';
import {applyBubbleEdit} from './bubble-editor.js';
import {TEXT_FONT_DEFAULTS_VERSION} from './text-font-defaults.js';
import {bubbleLayout} from './lettering.js';
import {fitBubbleToCurrentLayout} from './bubble-fit-layout.js';

export const MANUAL_DIALOGUE_PLACEMENT_VERSION=1;
export function placementRows(project,currentPage){
 const episode=currentBoardEpisode(project,currentPage),pages=project.pages.filter(p=>!p.designEpisodeRole&&currentBoardEpisode(project,p)===episode),{ordered:entries,byId,bySource}=dialogueEntries(project,pages),rows=[],used=new Set(),selected=new Set();
 for(const source of project.productionPackage?.episodes.filter(e=>e.episode===episode)||[])for(const segment of source.segments)for(const text of source.texts.filter(t=>t['段ID']===segment.localId&&t['渲染']==='工具'&&String(t['文本']||'').trim())){
  const matches=bySource.get(segment.id+':'+text['文字ID'])||[],entry=matches[0];for(const match of matches)used.add(match.bubble.id);if(entry&&selected.has(entry.bubble.id))continue;if(entry)selected.add(entry.bubble.id);
  rows.push({key:segment.id+':'+text['文字ID'],segmentId:segment.id,gridId:text['格ID'],textId:text['文字ID'],sourceText:structuredClone(text),sourceBubble:entry&&structuredClone(entry.bubble),text:entry?.bubble.text??productionTextContent(text),speaker:entry?.bubble.speaker||text['说话人']||'',kind:productionStyleKind({productionOriginal:text}),bubbleId:entry?.bubble.id,pageId:entry?.page.id,placed:!!entry&&dialogueVisible(entry),locked:dialogueLocked(entry)});
 }
 if(!project.productionPackage)for(const shot of project.shots||[]){if(shot.episode&&Number(shot.episode)!==episode||!String(shot.dialogue||'').trim())continue;const entry=entries.find(e=>e.bubble.manualDialogueSource===shot.id||e.bubble.shotId===shot.id&&e.bubble.text===shot.dialogue);if(entry)used.add(entry.bubble.id);rows.push({key:'shot:'+shot.id,shotId:shot.id,text:entry?.bubble.text||shot.dialogue,speaker:entry?.bubble.speaker||'',kind:'speech',bubbleId:entry?.bubble.id,pageId:entry?.page.id,placed:!!entry&&dialogueVisible(entry),locked:dialogueLocked(entry)});}
 for(const row of rows)if(row.bubbleId&&!row.sourceBubble)row.sourceBubble=structuredClone(byId.get(row.bubbleId).bubble);
 for(const e of entries)if(!used.has(e.bubble.id))rows.push({key:'bubble:'+e.bubble.id,text:e.bubble.text,sourceBubble:structuredClone(e.bubble),speaker:e.bubble.speaker||'',kind:productionStyleKind(e.bubble),bubbleId:e.bubble.id,pageId:e.page.id,placed:dialogueVisible(e),locked:dialogueLocked(e)});
 return rows;
}
export function placementSettings(project,page){
 const style=resolveProductionStyle(project,page.screenBoard?.segmentId||'page:'+page.id);
 return {fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,letterSpacing:style.letterSpacing,textColor:style.textColor,textAlign:'center',writingMode:'horizontal',textDirection:'ltr',padding:18,styleId:'none',fillColor:'#ffffff',fillOpacity:1,outlineColor:'#171b20',outlineWidth:2.8,tailVisible:true,columns:8,...project.manualDialogueSettings,...(project.manualDialogueSettings?.placementStyleDefaultsVersion===1?{}:{styleId:'none',definition:undefined,localAssetId:undefined}),placementStyleDefaultsVersion:1,...(project.manualDialogueSettings?.fontDefaultsVersion===TEXT_FONT_DEFAULTS_VERSION?{}:TEXT_FONT_DEFAULTS),fontDefaultsVersion:TEXT_FONT_DEFAULTS_VERSION};
}
/** Preparation is pure: the project gets no object until the main-canvas click. */
export function preparePlacement(context,row,settings,{pageWidth=1280,preserveExisting=false}={}){
 if(preserveExisting&&row.sourceBubble&&row.text===row.sourceBubble.text){const bubble=applyBubbleEdit(row.sourceBubble,{type:'move',dx:-row.sourceBubble.x,dy:-row.sourceBubble.y});bubble.manualPlacementVersion=1;bubble.autoLettering={...bubble.autoLettering,mode:'manual'};return {bubble,status:'fitted',rows:bubbleLayout(context,bubble).lines.map(l=>l.text)};}
 const kind=row.kind||'speech',bubble={id:id('bubble'),type:kind==='speech'?'speech':kind==='thought'?'thought':'caption',productionBoxKind:kind,text:String(row.text||''),speaker:row.speaker||'',x:0,y:0,w:340,h:180,shape:'oval',visible:true,locked:false,lineBreakMode:'auto',textFlowVersion:1,tail:{visible:true,side:'bottom',base:.54},...(row.segmentId?{productionSegment:row.segmentId}:{}),...(row.textId?{productionTextId:row.textId,productionOriginal:structuredClone(row.sourceText),productionGridId:row.gridId}:{}),...(row.shotId?{shotId:row.shotId,manualDialogueSource:row.shotId}:{})};
 if(row.sourceBubble?.dialogueSegments?.length){const parts=String(row.text).split(/\n\s*\n/);if(parts.length!==2)return {status:'requires-segments',bubble};bubble.dialogueSegments=structuredClone(row.sourceBubble.dialogueSegments).map((s,i)=>({...s,text:parts[i]}));bubble.dialogueSources=structuredClone(row.sourceBubble.dialogueSources||[]);bubble.text=parts.join('\n\n');}
 applyProductionStyle(bubble,{...settings,boxes:{[kind]:{styleId:settings.styleId,definition:settings.definition,localAssetId:settings.localAssetId,fillColor:settings.fillColor,fillOpacity:settings.fillOpacity,outlineColor:settings.outlineColor,outlineWidth:settings.outlineWidth,tailVisible:settings.styleId==='none'?false:['speech','thought'].includes(kind)&&settings.tailVisible}}});
 const fitted=fitDialogueObject(context,bubble,{pageWidth,parentWidth:pageWidth,maxHeight:16384,textWidth:settings.fontSize*settings.columns,protectedWords:[row.speaker].filter(Boolean)});if(fitted.status!=='fitted')return fitted;
 // Initial wrapping is followed by exactly the same contour fit as the inspector button.
 const contour=fitBubbleToCurrentLayout(context,fitted.bubble,{maxWidth:pageWidth,maxHeight:16384});
 if(contour.status==='fitted')fitted.bubble=contour.bubble;
 fitted.bubble.autoLettering.mode='manual';fitted.bubble.manualPlacementVersion=1;fitted.bubble.x=0;fitted.bubble.y=0;return fitted;
}
/** Match the visible long-strip position even when a panel crosses its source page. */
export function positionPreparedDialogue(project,prepared,page,point){
 const layout=layoutLongStrip(project.pages),entry=layout.pages.find(e=>e.pageId===page.id),scale=entry?.scale||1;
 const minY=entry?-entry.y/scale:0,maxY=entry?(layout.height-entry.y)/scale:page.height;
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),x=clamp(point.x-prepared.w/2,0,Math.max(0,page.width-prepared.w)),y=clamp(point.y-prepared.h/2,minY,Math.max(minY,maxY-prepared.h));
 return applyBubbleEdit(prepared,{type:'move',dx:x-prepared.x,dy:y-prepared.y});
}
export function placePreparedDialogue(project,row,prepared,page,point,parent){
 if(page.visible===false||parent?.visible===false)throw Error('请在可见画板和画格上摆放台词');
 if(page.locked||parent?.locked||row.locked)throw Error('请先解锁画板、画格或台词');
 const existing=project.pages.flatMap(p=>p.bubbles.map(b=>({page:p,b}))).find(e=>row.bubbleId?e.b.id===row.bubbleId:row.textId&&e.b.productionSegment===row.segmentId&&bubbleSourceTextIds(e.b).includes(row.textId)),next=positionPreparedDialogue(project,prepared,page,point);
 if(existing&&(existing.b.locked||existing.page.locked||existing.page.panels.find(p=>p.id===existing.b.parentPanelId)?.locked))throw Error('请先解锁原台词及所属画板、画格');
 next.visible=true;delete next.productionModeHidden;delete next.productionModeVisible;
 next.id=existing?.b.id||next.id;
 if(parent){next.parentPanelId=parent.id;next.shotId=parent.shotId||next.shotId;}else delete next.parentPanelId;
 if(existing){const moved=applyBubbleEdit(existing.b,{type:'move',dx:next.x-existing.b.x,dy:next.y-existing.b.y});next.tail={...next.tail,...(existing.b.tail?.mode==='absolute'?moved.tail:{})};existing.page.bubbles.splice(existing.page.bubbles.indexOf(existing.b),1);}
 page.bubbles.push(next);project.layerOrder||=[];project.layerOrder=project.layerOrder.filter(key=>key!==next.id);project.layerOrder.push(next.id);return next;
}
