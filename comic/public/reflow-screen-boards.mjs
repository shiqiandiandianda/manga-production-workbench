import {clone,id} from './model.js';
const fail=message=>{throw Object.assign(Error(message),{status:409});};
const parent=f=>f.cutoutLayer?.parentPanelId||f.parentPanelId||f.breakoutForeground?.backgroundPanelId;

/** Legacy reflow archives keep original board-local coordinates; new visible layers use strip coordinates. */
export function restoreLegacyReflowScreenBoards(original){
 const source=original.autoLayoutSource,episode=Number(source?.episode);
 if(source?.mode!=='screen-crop-reflow'||original.pages.length!==1)return {project:original,changed:false};
 const snapshots=source.sourcePages,ep=original.productionPackage?.episodes.find(e=>e.episode===episode);
 if(!ep||!Array.isArray(snapshots))fail('旧重排稿缺少可核对的原屏段快照，未猜测分屏');
 const target=snapshots.filter(p=>p.storyboard?.episode===episode&&!p.designEpisodeRole),expected=ep.segments.map(s=>s.id);
 if(target.length<=1)return {project:original,changed:false};
 if(JSON.stringify(target.map(p=>p.storyboard?.segmentId))!==JSON.stringify(expected)||new Set(snapshots.map(p=>p.id)).size!==snapshots.length||snapshots.some(p=>p.width!==1280||!Number.isSafeInteger(p.height)||p.height<1))fail('旧稿屏段顺序或原画板尺寸不完整，未合并或猜测画板');
 const project=clone(original),collapsed=project.pages[0],records=new Map(project.productionPackage.episodes.flatMap(e=>e.panelRecords.map(r=>[r.id,r.segmentId]))),bySegment=new Map(snapshots.filter(p=>p.storyboard?.segmentId).map(p=>[p.storyboard.segmentId,p.id])),snapshotById=new Map(snapshots.map(p=>[p.id,p])),frames=new Map(collapsed.panels.map(f=>[f.id,f])),shots=new Map(project.shots.map(s=>[s.id,s])),owners=new Map();
 if(collapsed.locked)fail('请先解锁旧重排画板，未改变画板结构');
 function owner(item,seen=new Set()){
  if(owners.has(item.id))return owners.get(item.id);if(seen.has(item.id))fail('旧稿图层的来源父子关系循环');seen.add(item.id);
  const archived=item.autoLayoutOriginalPageId;if(archived&&snapshotById.has(archived)){if(item.visible!==false)fail('旧原件已被人工显示，请先核对屏段归属；未移动人工内容');owners.set(item.id,archived);return archived;}
  const segment=item.panelSlice?.segmentId||item.productionGrid?.segmentId||item.productionSegment||item.productionBackgroundInstance?.segmentId||item.productionBackground?.replace(/-BG$/,'')||records.get(item.productionGridId)||shots.get(item.shotId)?.productionSliceSegment||shots.get(item.shotId)?.productionSegment;
  let result=bySegment.get(segment);const p=parent(item);if(!result&&p&&frames.has(p))result=owner(frames.get(p),seen);
  if(result)owners.set(item.id,result);return result;
 }
 for(const f of [...collapsed.panels,...collapsed.bubbles])owner(f);
 const cuts=[0];
 for(let i=1;i<target.length;i++){
  const current=collapsed.panels.filter(f=>f.visible!==false&&owners.get(f.id)===target[i].id&&!f.productionBackground&&!f.productionBackgroundInstance&&!f.cutoutLayer);
  if(!current.length)fail('旧重排稿有屏段缺少可定位的正文格，未按格数强拆：'+target[i].name);
  const cut=Math.floor(Math.min(...current.map(f=>f.y)));
  if(cut<=cuts.at(-1)||cut>=collapsed.height)fail('旧稿跨屏顺序无法保持原位置，请先核对画格');cuts.push(cut);
 }
 cuts.push(collapsed.height);
 const targetIndex=new Map(target.map((p,i)=>[p.id,i])),pageIds=new Map(snapshots.map(p=>[p.id,p.id===target[0].id?collapsed.id:id('page')]));
 const pages=snapshots.map(p=>{const index=targetIndex.get(p.id),active=index!==undefined,height=active?cuts[index+1]-cuts[index]:p.height;return {...(active?clone(collapsed):{}),id:pageIds.get(p.id),name:p.name,width:p.width,height,background:active?collapsed.background:'#ffffff',panels:[],bubbles:[],storyboard:clone(p.storyboard||{}),productionUnit:active?'panel':'screen',productionLayoutViews:{version:1,screen:{height:p.height,background:'#ffffff'},panel:{height,background:collapsed.background}},screenBoard:{version:1,segmentId:p.storyboard?.segmentId,sourcePageId:p.id,restoredFromReflowCanvas:collapsed.id}};});
 const pageMap=new Map(snapshots.map((p,i)=>[p.id,pages[i]]));
 function targetForY(y){const index=cuts.findIndex((cut,i)=>i<cuts.length-1&&y>=cut&&y<cuts[i+1]);return target[index<0?(y<0?0:target.length-1):index].id;}
 for(const [type,list]of [['panels',collapsed.panels],['bubbles',collapsed.bubbles]])for(const item of list){
  const archived=snapshotById.has(item.autoLayoutOriginalPageId),key=owners.get(item.id)||targetForY(item.y+item.h/2),page=pageMap.get(key);if(!page)fail('旧稿图层无法找到来源画板');
  const index=targetIndex.get(key);if(!archived&&index!==undefined){item.y-=cuts[index];if(item.tail?.mode!=='normalized'&&Number.isFinite(item.tail?.y))item.tail.y-=cuts[index];}
  page[type].push(item);owners.set(item.id,key);
 }
 for(const g of project.gradients||[]){if(g.assistantLayoutAnchor&&pageIds.has(g.assistantLayoutAnchor.pageId))g.assistantLayoutAnchor.pageId=pageIds.get(g.assistantLayoutAnchor.pageId);if(g.stripSpace&&pageIds.has(g.stripSpace.pageId))g.stripSpace.pageId=pageIds.get(g.stripSpace.pageId);}
 project.pages=pages;project.productionScreenBoards=1;project.productionEpisodeViews||={};project.productionEpisodeViews[episode]={...(project.productionEpisodeViews[episode]||{}),unit:'panel',segments:Object.fromEntries(expected.map(s=>[s,'panel']))};
 project.reflowBoardRestoration={version:1,episode,legacyCanvasId:collapsed.id,legacyCanvasName:collapsed.name,sourceBatchId:source.batchId,boards:target.length,sourceBoardMap:Object.fromEntries(pageIds)};
 return {project,changed:true,episode,boards:target.length};
}
