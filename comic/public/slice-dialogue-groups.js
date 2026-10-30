import {mergeDialogueBubbles,dialogueSegments,validDialogueSegments,defaultDialogueBox} from './bubble-dialogue-segments.js';
import {applyBubbleMaterial} from './bubble-material.js';
import {validateSliceRegion} from './panel-slices.js';

export const localDialogueId=id=>'local:'+id;
export const dialogueGroupFor=(groups,id)=>Object.values(groups).find(g=>g.textIds.includes(id));
export function groupPreviewBubble(group,preview){
 const r=group.region,scale=group.coordinateScale||1,b={...group.bubble,x:r.x*preview.width/scale,y:r.y*preview.height/scale,w:r.w*preview.width/scale,h:r.h*preview.height/scale,visible:true};
 b.dialogueSegments=structuredClone(group.segments);b.text=b.dialogueSegments.map(s=>s.text).join('\n\n');return b;
}
export function groupTextRegions(group){
 const r=group.region;return Object.fromEntries(group.textIds.map((id,i)=>{const box=group.segments[i].textBox;return [id,{x:r.x+box.x*r.w,y:r.y+box.y*r.h,w:box.w*r.w,h:box.h*r.h}];}));
}
export function updateGroupTextRegion(groups,id,region){
 const g=dialogueGroupFor(groups,id);if(!g||!region)return;
 const r=g.region,w=Math.max(.002,Math.min(1,region.w/r.w)),h=Math.max(.002,Math.min(1,region.h/r.h));
 g.segments[g.textIds.indexOf(id)].textBox={x:Math.max(0,Math.min(1-w,(region.x-r.x)/r.w)),y:Math.max(0,Math.min(1-h,(region.y-r.y)/r.h)),w,h};g.changed=true;
 return groupTextRegions(g)[id];
}
export function createSliceDialogueGroup(ids,{texts,positions,regions,groups,existing,preview,fontFamily}){
 if(ids.length!==2||ids[0]===ids[1])throw Error('请勾选两句台词');
 const lines=ids.map(id=>texts.find(t=>t['文字ID']===id));if(lines.some(t=>!t)||lines[0]['格ID']!==lines[1]['格ID'])throw Error('只能合并同一格的两句台词');
 if(lines.some(t=>t['类型']!=='对白'))throw Error('请选择两句对白台词');
 if(ids.some(id=>dialogueGroupFor(groups,id)))throw Error('这句台词已在双圆气泡中');
 if(ids.some(id=>existing.get(id)?.locked))throw Error('请先解锁台词');
 const grid=regions[lines[0]['格ID']];if(!grid)throw Error('请先确认本格区域');
 const available=ids.map(id=>positions[id]).filter(Boolean),x=available.length?Math.min(...available.map(r=>r.x)):grid.x+grid.w*.3,y=available.length?Math.min(...available.map(r=>r.y)):grid.y+grid.h*.1;
 const w=Math.min(1-x,Math.max(grid.w*.4,...available.map(r=>r.x+r.w-x))),h=Math.min(1-y,Math.max(w*preview.width/preview.height*.9,...available.map(r=>r.y+r.h-y)));
 const bubble=applyBubbleMaterial({type:'speech',visible:true,fontSize:existing.get(ids[0])?.fontSize||preview.letteringStyle?.fontSize||36,fontFamily:fontFamily||'source-han-sans',fontWeight:500,lineHeight:1.32,textAlign:'center',textColor:'#111111',fillColor:'#ffffff',fillOpacity:1,outlineWidth:2},'builtin-double');
 const group={textIds:ids,region:{x,y,w,h},bubble,coordinateScale:preview.letteringScale||1,segments:lines.map((t,i)=>({id:'dialogue-'+(i+1),sourceTextId:t.localDialogue?undefined:t['文字ID'],speaker:t['说话人']||'',text:existing.get(t['文字ID'])?.text??t['文本'],textBox:defaultDialogueBox(bubble,i)})),changed:true};
 if(group.segments.map(s=>s.text).join('\n\n').length>4000)throw Error('两段台词合计最多 4000 字');
 groups[ids[0]]=group;Object.assign(positions,groupTextRegions(group));return group;
}
/** Runs on the project copy, after normal lettering. Only explicit changed groups are applied. */
export function applySliceDialogueGroups(project,segment,root,groups,convert){
 if(groups===undefined)return 0;if(!Array.isArray(groups)||groups.length>500)throw Error('双圆气泡分组无效');
 const page=project.pages.find(p=>p.panels.some(p=>p.id===root.id)),episode=project.productionPackage.episodes.find(e=>e.episode===segment.episode),used=new Set();let count=0;
 for(const g of groups){
  if(!g||!Array.isArray(g.textIds)||g.textIds.length!==2||!Array.isArray(g.segments)||g.segments.length!==2||g.textIds.some(id=>typeof id!=='string'||used.has(id))||g.textIds[0]===g.textIds[1])throw Error('每个双圆气泡需要两段独立台词');
  g.textIds.forEach(id=>used.add(id));
  const sources=g.textIds.map(id=>episode.texts.find(t=>t['文字ID']===id&&t['段ID']===segment.localId)),manual=g.textIds[1]===localDialogueId(g.textIds[0]);
  if(!sources[0]||(!sources[1]&&!manual)||sources.some(t=>t&&t['类型']!=='对白')||sources[1]&&sources[0]['格ID']!==sources[1]['格ID'])throw Error('只能合并同一格的两句对白');
  const match=id=>page.bubbles.find(b=>b.productionSegment===segment.id&&!page.panels.find(p=>p.id===b.parentPanelId)?.productionGrid&&(b.productionTextId===id||dialogueSegments(b).some(s=>s.sourceTextId===id)));
  const first=match(g.textIds[0]),second=match(g.textIds[1]);if(!first||!manual&&!second)throw Error('待合并台词不存在');if(page.locked||first.locked||second?.locked||page.panels.find(p=>p.id===first.parentPanelId)?.locked||page.panels.find(p=>p.id===second?.parentPanelId)?.locked)throw Error('请先解锁台词与所属画格');
  if(dialogueSegments(first).length&&(!g.textIds.every((id,i)=>id===localDialogueId(g.textIds[0])?!first.dialogueSegments[i].sourceTextId:first.dialogueSegments[i].sourceTextId===id)||second&&first!==second))throw Error('台词分组已改变，请重新打开裁格排字');
  if(!validateSliceRegion(g.region)||!validDialogueSegments({dialogueSegments:g.segments,text:g.segments.map(s=>s?.text).join('\n\n')}))throw Error('双圆气泡的台词或区域无效');
  const r=convert(g.region),bounds={x:root.x+r.x*root.w,y:root.y+r.y*root.h,w:Math.max(30,r.w*root.w),h:Math.max(20,r.h*root.h)};
  let merged;if(dialogueSegments(first).length)merged={...structuredClone(first),...bounds};
  else {const extra=manual?{...first,id:'manual-dialogue',productionTextId:undefined,productionOriginal:undefined,text:''}:second;merged=mergeDialogueBubbles(first,extra,bounds);}
  merged.dialogueSegments=g.segments.map((s,i)=>({id:'dialogue-'+(i+1),sourceTextId:sources[i]?.['文字ID'],speaker:sources[i]?.['说话人']||first.speaker||'',text:s.text,textBox:structuredClone(s.textBox)}));merged.text=merged.dialogueSegments.map(s=>s.text).join('\n\n');
  Object.assign(first,merged);if(second&&second!==first){page.bubbles.splice(page.bubbles.indexOf(second),1);project.layerOrder=project.layerOrder?.filter(id=>id!==second.id);}
  count++;
 }
 return count;
}
