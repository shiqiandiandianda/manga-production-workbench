import {LOCAL_BACKGROUND_POLICY as POLICY,scriptColorCues,colorRGB,colorFamily,blackLike,confirmedSpecialFlashback} from './local-background-policy.js';
const weight={environment:4,light:3,person:1.5,clothing:1};
const distance=(a,b)=>{const x=colorRGB(a),y=colorRGB(b);return Math.sqrt(x.reduce((sum,v,i)=>sum+(v-y[i])**2,0))/441.7;};
function rangesFor(packet,shots){
 const order=packet.panels.map(p=>p.key),ranges=[];
 if(packet.sections?.length){for(const s of packet.sections){const start=order.indexOf(s.startShotCode),end=order.indexOf(s.endShotCode);if(start<0||end<start)throw Error('底图叙事区间与源格不符');ranges.push(order.slice(start,end+1));}}
 else {let first=0;for(let i=1;i<=shots.length;i++)if(i===shots.length||shots[i].location!==shots[i-1].location||shots[i].time!==shots[i-1].time){ranges.push(shots.slice(first,i).map(s=>s.key));first=i;}}
 if(JSON.stringify(ranges.flat())!==JSON.stringify(order))throw Error('底图剧情段落没有完整按序覆盖本话');return ranges;
}
function chooseColor(keys,items,shots){
 const rows=keys.map(key=>shots.find(s=>s.key===key)||{key}),scene=rows[0].location||'',cues=rows.flatMap(s=>scriptColorCues(s).map(c=>({...c,key:s.key}))),sources=keys.map(key=>items.find(i=>i.key===key)).filter(Boolean),hasArtwork=sources.some(i=>i.filePath||i.asset||i.sha256),special=rows.length>0&&rows.every(confirmedSpecialFlashback),choices=[];
 for(const item of sources){const p=item.palette;if(p?.version!==2||p.sha256!==item.sha256)continue;
  const shot=rows.find(s=>s.key===item.key)||{},size=String(shot.shotSize||shot.shotSizeRaw||shot.sourceFields?.['景别']||''),wide=/^(大全景|大远景|远景|全景|中远景)$/.test(size);
  // A broad scene view with the same hue spread across several interior sides supports a scene/light
  // inference. A central costume, face close-up, isolated mark or single corner cannot satisfy this gate.
  if(wide)for(const c of p.candidates||[])if(colorRGB(c.color)&&!blackLike(c.color)&&c.coverage>=.12&&c.spatialTiles>=8&&c.edgeSides>=3){
   choices.push({color:c.color,status:'artwork-inferred',score:2*(.5+c.coverage)*c.edgeSides/4,evidence:{key:item.key,sourceSha256:item.sha256,role:'environment-and-light-inference',shotSize:size,coverage:c.coverage,tileIds:c.tileIds,edgeSides:c.edgeSides,kind:'wide-shot-spatial-palette',method:p.method,uncertainty:'依据宽景及多个内部区域的共同色调推定，未声称像素级人物或环境识别'}});
  }
  for(const c of p.candidates||[])for(const cue of cues){
   if(!(c.family===cue.family||['brown','orange'].includes(c.family)&&['brown','orange'].includes(cue.family))||c.family==='black'||c.coverage<.04||c.spatialTiles<4)continue;
   if(Math.max(...colorRGB(c.color))<96&&cue.role==='clothing')continue;
   choices.push({color:c.color,status:'artwork-supported',score:weight[cue.role]*(.5+c.coverage)*Math.min(c.spatialTiles,8)/8,evidence:{key:item.key,sourceSha256:item.sha256,role:cue.role,field:cue.field,quote:cue.quote,method:p.method,kind:'target-artwork-with-script-color'}});
  }
  for(const r of p.regionObservations||[])if(r.sourceSha256===item.sha256&&r.confirmed===true&&weight[r.role])for(const c of r.candidates||[]){
   if(!colorRGB(c.color)||blackLike(c.color)||c.coverage<.08)continue;
   choices.push({color:c.color,status:'artwork-supported',score:weight[r.role]*(.5+c.coverage),evidence:{key:item.key,sourceSha256:item.sha256,role:r.role,region:r.rect,kind:'confirmed-target-region'}});
  }
 }
 // A reliable reference must be locally verified and explicitly bound to the same scene.
 for(const item of sources)for(const ref of item.referencePalettes||[])if(scene&&ref.scene===scene&&ref.verifiedLocal===true&&/^[a-f0-9]{64}$/.test(ref.sha256||'')){
  for(const r of ref.regionObservations||[])if(r.sourceSha256===ref.sha256&&r.confirmed===true&&['environment','light'].includes(r.role))for(const c of r.candidates||[])if(colorRGB(c.color)&&!blackLike(c.color))choices.push({color:c.color,status:'reference-preconfigured',score:weight[r.role]*(.5+c.coverage),evidence:{key:item.key,sourceSha256:ref.sha256,role:r.role,scene,kind:'same-scene-reference',referenceId:ref.assetId}});
 }
 if(!hasArtwork)for(const c of cues)if(c.family!=='black'&&c.family!=='white')choices.push({color:c.color,status:'script-preconfigured',score:weight[c.role],evidence:{key:c.key,role:c.role,field:c.field,quote:c.quote,kind:'script-explicit-color'}});
 if(special)return {color:'#000000',status:'confirmed-special-flashback',scene,evidence:rows.map(s=>({key:s.key,kind:'confirmed-special-flashback',...s.backgroundNarrative.specialFlashback})),reason:'本段已明确确认特殊回忆，黑底承担该叙事含义'};
 const safe=choices.filter(c=>!blackLike(c.color)).sort((a,b)=>b.score-a.score),best=safe[0];
 if(!best)return {color:POLICY.neutral,status:'pending',scene,evidence:[],reason:'主色待确认：颜色候选尚无可靠人物、衣料、环境或光线依据；中性底不代表成图取色'};
 return {color:best.color,status:best.status,scene,evidence:safe.filter(c=>colorFamily(c.color)===colorFamily(best.color)).map(c=>c.evidence),reason:best.status==='artwork-supported'?'按本段原文的可见色彩依据核对成图局部候选，综合角色与环境关系选择衬底':best.status==='artwork-inferred'?'依据本段实际宽景图多个内部区域的共同主色及原镜头信息推定衬底；并非逐像素语义识别':best.status==='reference-preconfigured'?'依据已绑定且核验过的同场景参考预配；并非目标成图实测':'依据本段脚本明确颜色预配；并非目标成图实测'};
}
/** Vertical gradients span the strip width, so every visible object blocks its complete Y interval. */
export function safeBackgroundGaps(packet,obstacles=[]){
 const intervals=[...packet.panels,...obstacles].filter(r=>r.visible!==false&&Number.isFinite(r.y)&&Number.isFinite(r.h)&&r.h>=0).map(r=>({top:Math.max(0,r.y-8),bottom:Math.min(packet.canvas.height,r.y+r.h+8)})).sort((a,b)=>a.top-b.top),merged=[];
 for(const r of intervals){const last=merged.at(-1);if(last&&r.top<=last.bottom)last.bottom=Math.max(last.bottom,r.bottom);else merged.push({...r});}
 const gaps=[];let y=0;for(const r of merged){if(r.top>y)gaps.push({top:y,bottom:r.top});y=Math.max(y,r.bottom);}if(y<packet.canvas.height)gaps.push({top:y,bottom:packet.canvas.height});return gaps;
}
export function artworkBackgroundGeometry(packet,items=[],shots=[],{obstacles=[]}={}){
 const sections=rangesFor(packet,shots).map(keys=>({keys,...chooseColor(keys,items,shots)})),gaps=safeBackgroundGaps(packet,obstacles),backgrounds=[],decisions=[];
 const add=(y,h,color,endColor=null)=>{if(h>0)backgrounds.push({x:0,y,w:1280,h,color,endColor,mode:endColor?'linear':'solid',reason:'按剧情段落的可靠色彩依据铺底；渐变仅连接两段颜色并避开正文和文字',name:'剧情段落衬底',...(endColor?{easing:'smoothstep'}:{})});};
 let cursor=0,current=sections[0]?.color||POLICY.neutral,previous=null;
 for(let i=0;i<sections.length;i++){
  const s=sections[i];
  if(previous?.scene&&previous.scene===s.scene&&previous.status!=='pending'&&!blackLike(previous.color)&&s.status!=='confirmed-special-flashback'&&(s.status==='pending'||distance(previous.color,s.color)<.12))Object.assign(s,{color:previous.color,status:'same-scene-continuity',evidence:[...previous.evidence],reason:'同一已确认场景保持前段衬色；未声称从本格重新取色'});
  let transition=null;
  if(i&&s.color!==current){const index=packet.panels.findIndex(p=>p.key===s.keys[0]),before=Math.max(...packet.panels.slice(0,index).map(p=>p.y+p.h)),after=packet.panels[index].y,slot=gaps.find(g=>Math.min(g.bottom,after)-Math.max(g.top,before)>=24);
   if(slot){const top=Math.max(slot.top,before),bottom=Math.min(slot.bottom,after),h=Math.min(480,bottom-top),y=top+(bottom-top-h)/2;add(cursor,y-cursor,current);add(y,h,current,s.color);cursor=y+h;current=s.color;transition={y,h,from:backgrounds.at(-1).color,to:s.color};}
   else {if(blackLike(current)!==blackLike(s.color))throw Object.assign(Error('特殊回忆边界没有可安全换底的留白，请先核对文字范围；未增加间距或改变正文'),{status:409});s.deferredColor=s.color;s.color=current;s.reason+='；当前边界没有避开文字及画格的安全留白，保留连续底色，未新增间隙';}
  }
  decisions.push({startKey:s.keys[0],endKey:s.keys.at(-1),...s,transition});previous=s;
 }
 add(cursor,packet.canvas.height-cursor,current);
 // Keep the old contiguous geometry for compatibility/previews, but create only the
 // actual color-section layers. Adjacent layers overlap within the already-safe gap.
 const storyBackgroundLayers=[],transitions=decisions.map(d=>d.transition).filter(Boolean);
 let start=0,color=transitions[0]?.from||current,fadeIn=0,lastEnd=0;
 for(const t of transitions){if(t.y<lastEnd||t.h<=0||t.y+t.h>packet.canvas.height)throw Error('底色衔接区间无效');storyBackgroundLayers.push({x:0,y:start,w:1280,h:t.y+t.h-start,color,fadeIn,fadeOut:t.h,name:'剧情段落衬底'});start=t.y;color=t.to;fadeIn=t.h;lastEnd=t.y+t.h;}
 storyBackgroundLayers.push({x:0,y:start,w:1280,h:packet.canvas.height-start,color,fadeIn,fadeOut:0,name:'剧情段落衬底'});
 return {...structuredClone(packet),backgrounds,storyBackgroundLayers,artworkPaletteDecisions:decisions,localBackgroundPolicy:{version:POLICY.version,referenceEpisodes:[...POLICY.referenceEpisodes]},generator:{...packet.generator,backgrounds:decisions.every(d=>d.status==='pending')?'local-palette-pending':'local-story-color-evidence-v2'}};
}
