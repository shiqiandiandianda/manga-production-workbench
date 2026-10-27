import {isSfxImage} from './sfx-image-layer.js';
import {isCutoutLayer} from './cutout-layer.js';
import {isLibrarySfx} from './sfx-library.js';
import {id,clone} from './model.js';
import {constrainedPanelDelta} from './panel-width.js';
function entries(project){return project.pages.flatMap(page=>[...page.panels.map(item=>({type:'panel',item,page,pageId:page.id})),...page.bubbles.map(item=>({type:'bubble',item,page,pageId:page.id}))]).concat((project.gradients||[]).map(item=>({type:'gradient',item,page:null,pageId:null})));}
function ordered(project){const all=entries(project),map=new Map(all.map(e=>[e.item.id,e])),out=[];for(const key of project.layerOrder||[])if(map.has(key)){out.push(map.get(key));map.delete(key);}return out.concat([...map.values()]);}
export function panelInPage(page,bubble){
 if(isLibrarySfx(bubble))return null;
 const panels=page.panels.filter(f=>!isSfxImage(f)&&!f.breakoutForeground&&!isCutoutLayer(f)),explicit=panels.find(f=>f.id===bubble.parentPanelId);if(explicit)return explicit;if(!panels.length)return null;
 const matched=bubble.shotId?panels.filter(f=>f.shotId===bubble.shotId):[],candidates=matched.length?matched:panels,cx=bubble.x+bubble.w/2,cy=bubble.y+bubble.h/2;
 const distance=f=>Math.hypot(Math.max(f.x-cx,0,cx-f.x-f.w),Math.max(f.y-cy,0,cy-f.y-f.h))+.0001*Math.hypot(cx-f.x-f.w/2,cy-f.y-f.h/2);
 return candidates.reduce((a,f)=>distance(f)<distance(a)?f:a,candidates[0]);
}
export function panelForBubble(project,key){for(const page of project.pages){const item=page.bubbles.find(b=>b.id===key);if(!item)continue;const owner=panelInPage(page,item);return owner?{type:'panel',item:owner,page,pageId:page.id}:null;}return null;}
export function attachBubbleGroups(project){let changed=false;for(const page of project.pages)for(const b of page.bubbles){const owner=panelForBubble(project,b.id);if(owner&&b.parentPanelId!==owner.item.id){b.parentPanelId=owner.item.id;changed=true;}else if(!owner&&b.parentPanelId){delete b.parentPanelId;changed=true;}}if(project.layerGroupsVersion!==1){project.layerGroupsVersion=1;changed=true;}return changed;}
export function layerGroups(project){const rows=ordered(project),index=new Map(rows.map((e,i)=>[e.item.id,i])),groups=new Map();for(const e of rows)if(e.type!=='bubble'&&!isCutoutLayer(e.item))groups.set(e.item.id,{id:e.item.id,root:e,members:[e]});for(const e of rows)if(e.type==='bubble'||isCutoutLayer(e.item)){const owner=e.type==='bubble'?panelInPage(e.page,e.item):e.page.panels.find(f=>f.id===e.item.cutoutLayer.parentPanelId),g=owner&&groups.get(owner.id);if(g)g.members.push(e);else groups.set(e.item.id,{id:e.item.id,root:e,members:[e]});}return [...groups.values()].sort((a,b)=>Math.max(...b.members.map(e=>index.get(e.item.id)))-Math.max(...a.members.map(e=>index.get(e.item.id))));}
export function groupForLayer(project,key){return layerGroups(project).find(g=>g.members.some(e=>e.item.id===key))||null;}
export function setGroupFlag(project,key,field,value){const group=groupForLayer(project,key);if(!group)return;for(const e of group.members)e.item[field]=value;}
export function moveGroupedLayer(project,key,target,side='above'){
 const rows=ordered(project),source=rows.find(e=>e.item.id===key);if(!source)return false;const groups=layerGroups(project),sourceGroup=groupForLayer(project,key),rootPanel=source.type==='panel'&&sourceGroup?.id===key;let targetGroup;
 if(isLibrarySfx(source.item)){const order=rows.map(e=>e.item.id),old=order.indexOf(key);let to;if(typeof target==='number'){to=Math.max(0,Math.min(order.length-1,old+target));if(to===old)return false;order.splice(old,1);}else{if(target===key||!order.includes(target))return false;order.splice(old,1);to=order.indexOf(target)+(side==='above'?1:0);}order.splice(to,0,key);project.layerOrder=order;return true;}
 if(typeof target==='number'){
  if(rootPanel||source.type==='gradient'){const at=groups.findIndex(g=>g.id===sourceGroup.id),to=at-target;if(to<0||to>=groups.length)return false;targetGroup=groups[to];side=target>0?'above':'below';}
  else {const siblings=sourceGroup.members.map(e=>e.item.id).sort((a,b)=>rows.findIndex(e=>e.item.id===a)-rows.findIndex(e=>e.item.id===b)),i=siblings.indexOf(key),to=i+target;if(to<0||to>=siblings.length)return false;side=target>0?'above':'below';target=siblings[to];}
 }
 const order=rows.map(e=>e.item.id),moving=rootPanel?sourceGroup.members.map(e=>e.item.id):[key],selected=new Set(moving),block=order.filter(k=>selected.has(k)),remaining=order.filter(k=>!selected.has(k));
 if(rootPanel||source.type==='gradient'){targetGroup||=groupForLayer(project,target);if(!targetGroup||targetGroup.id===sourceGroup.id)return false;const indices=targetGroup.members.map(e=>remaining.indexOf(e.item.id)).filter(i=>i>=0);const insertion=side==='above'?Math.max(...indices)+1:Math.min(...indices);remaining.splice(insertion,0,...block);}
 else {const targetEntry=rows.find(e=>e.item.id===target);if(!targetEntry||target===key||isCutoutLayer(source.item)&&groupForLayer(project,target)?.id!==sourceGroup.id)return false;const newOwner=targetEntry.type==='panel'?targetEntry:targetEntry.type==='bubble'?panelForBubble(project,target):null;if(source.type==='bubble'&&newOwner&&!isCutoutLayer(newOwner.item)&&newOwner.pageId===source.pageId&&newOwner.item.id!==source.item.parentPanelId){source.item.parentPanelId=newOwner.item.id;source.item.shotId=newOwner.item.shotId;}const insertion=remaining.indexOf(target);if(insertion<0)return false;remaining.splice(insertion+(side==='above'?1:0),0,...block);}
 project.layerOrder=remaining;return true;
}
export function deleteGroupedLayer(project,key){const group=groupForLayer(project,key),entry=group?.members.find(e=>e.item.id===key);if(!entry)return false;const keys=new Set(entry.type==='panel'&&group.id===key?group.members.map(e=>e.item.id):[key]);if(entry.type==='panel')for(const page of project.pages)for(const f of page.panels)if(f.breakoutForeground?.backgroundPanelId===key)keys.add(f.id);for(const page of project.pages){page.panels=page.panels.filter(e=>!keys.has(e.id));page.bubbles=page.bubbles.filter(e=>!keys.has(e.id));}project.gradients=(project.gradients||[]).filter(e=>!keys.has(e.id));project.layerOrder=ordered(project).map(e=>e.item.id);return true;}
export function duplicateLayer(project,key){const group=groupForLayer(project,key),source=group?.members.find(e=>e.item.id===key);if(!source)return null;const members=source.type==='panel'&&group.id===key?[...group.members,...entries(project).filter(e=>e.type==='panel'&&e.item.breakoutForeground?.backgroundPanelId===key)]:[source],page=source.page;
 if(page&&(page.panels.length+members.filter(e=>e.type==='panel').length>1000||page.bubbles.length+members.filter(e=>e.type==='bubble').length>3200))throw new Error('当前画板图层数量已达上限，请先整理图层');if(source.type==='gradient'&&(project.gradients||[]).length>=200)throw new Error('渐变图层数量已达上限');
 const mapping=new Map(members.map(e=>[e.item.id,id(e.type)])),copies=members.map(e=>{const item=clone(e.item);item.id=mapping.get(e.item.id);item.locked=false;const shot=project.shots.find(s=>s.id===item.shotId),name=item.name||(e.type==='panel'?(shot?shot.code+' · '+shot.title:'格子'):e.type==='bubble'?item.text.slice(0,22):'渐变');item.name=name.slice(0,113)+' · 副本';if(e.type==='panel')item.generationToken=null;if(item.cutoutLayer)item.cutoutLayer.parentPanelId=mapping.get(item.cutoutLayer.parentPanelId)||item.cutoutLayer.parentPanelId;if(item.localRegion)item.localRegion.sourcePanelId=mapping.get(item.localRegion.sourcePanelId)||item.localRegion.sourcePanelId;if(item.localReplacement)item.localReplacement.patchLayerId=mapping.get(item.localReplacement.patchLayerId)||item.localReplacement.patchLayerId;if(item.parentPanelId)item.parentPanelId=mapping.get(item.parentPanelId)||item.parentPanelId;if(item.breakoutForeground)item.breakoutForeground.backgroundPanelId=mapping.get(item.breakoutForeground.backgroundPanelId)||item.breakoutForeground.backgroundPanelId;if(item.breakoutCandidates)for(const c of item.breakoutCandidates){c.status='stale';if(c.foregroundPanelId)c.foregroundPanelId=mapping.get(c.foregroundPanelId)||c.foregroundPanelId;}return {...e,item};});
 const order=ordered(project).map(e=>e.item.id),at=Math.max(...members.map(e=>order.indexOf(e.item.id))),copiedOrder=order.filter(k=>mapping.has(k)).map(k=>mapping.get(k));order.splice(at+1,0,...copiedOrder);
 for(const e of copies)if(e.type==='gradient')project.gradients.push(e.item);else e.page[e.type==='panel'?'panels':'bubbles'].push(e.item);project.layerOrder=order;return copies.find(e=>e.type===source.type&&e.item.id===mapping.get(source.item.id));}

export function assignBubbleToPanel(project,bubbleId,panelId){
 const bubble=entries(project).find(e=>e.type==='bubble'&&e.item.id===bubbleId),panel=bubble?.page.panels.find(f=>f.id===panelId);
 if(!bubble||!panel)throw new Error('请选择当前画板中的格子');
 if(bubble.item.locked)throw new Error('请先解锁对白');
 bubble.item.parentPanelId=panel.id;bubble.item.shotId=panel.shotId;return bubble.item;
}
export function movePanelGroup(project,key,position,initial=project){
 const source=groupForLayer(initial,key),target=entries(project).find(e=>e.type==='panel'&&e.item.id===key);
 if(isCutoutLayer(target?.item)){const before=entries(initial).find(e=>e.item.id===key);if(!before||target.item.locked||![position.x,position.y].every(Number.isFinite))return false;target.item.x=before.item.x+constrainedPanelDelta([before],position.x-before.item.x);target.item.y=position.y;return true;}
 const foregrounds=source?.root?.page?.panels.filter(f=>f.breakoutForeground?.backgroundPanelId===key).map(item=>({type:'panel',item,page:source.root.page,pageId:source.root.pageId}))||[];
 if(!source||source.root.type!=='panel'||!target||[...source.members,...foregrounds].some(e=>e.item.locked)||!Number.isFinite(position.x)||!Number.isFinite(position.y))return false;
 const dx=constrainedPanelDelta([source.root,...foregrounds],position.x-source.root.item.x),dy=position.y-source.root.item.y;
 const snapshots=[...source.members,...foregrounds].map(e=>({id:e.item.id,x:e.item.x,y:e.item.y,tail:e.item.tail?clone(e.item.tail):null,type:e.type}));
 for(const snapshot of snapshots){const item=entries(project).find(e=>e.item.id===snapshot.id)?.item;if(item){item.x=snapshot.x+dx;item.y=snapshot.y+dy;if(snapshot.type==='bubble'&&snapshot.tail&&snapshot.tail.mode!=='normalized'&&Number.isFinite(snapshot.tail.x)&&Number.isFinite(snapshot.tail.y))item.tail={...snapshot.tail,x:snapshot.tail.x+dx,y:snapshot.tail.y+dy};}}return true;
}
