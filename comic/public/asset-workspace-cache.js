import {assetWorkspaceInventory} from './asset-workspace-model.js';
import {createReferenceAuditContext} from './reference-audit-context.js';
import {BoundedCache} from './bounded-cache.js';

// Metadata changes can happen without changing the number of registered images.
export const workspaceAssetStamp=assets=>JSON.stringify(assets.map(a=>[a.id,a.name,a.libraryRole,a.libraryName,a.libraryState,a.libraryAliases,a.libraryStateAliases,a.productionStatus,a.productionAssetId,a.productionStageId,a.library]));
export function createWorkspaceInventoryCache(){
 let owner=null,revision,assetStamp='',context;const entries=new BoundedCache({name:'asset-inventory',maxEntries:8,maxBytes:16*1024*1024,ttl:120000});
 function reset(){owner=null;revision=undefined;assetStamp='';entries.clear();context=null;}
 function read(project,assets,options={}){
  if(!project)return [];
  const stamp=workspaceAssetStamp(assets);
  if(owner!==project||revision!==project.revision||assetStamp!==stamp){owner=project;revision=project.revision;assetStamp=stamp;context=createReferenceAuditContext(project,assets);entries.clear();}
  const key=JSON.stringify([options.scope||'episode',options.pageId,options.panelId]);
  let result=entries.get(key);if(!result){result=assetWorkspaceInventory(project,assets,{...options,referenceContext:context});entries.set(key,result);}return result;
 }
 return {read,reset,stats:()=>entries.stats()};
}

export function groupWorkspaceRows(rows){
 const groups=new Map();
 for(const row of rows){const key=row.role==='character'?JSON.stringify(['character',row.name.normalize('NFKC').trim().toLowerCase()]):row.key;let group=groups.get(key);if(!group)groups.set(key,group={key,name:row.name,role:row.role,rows:[]});group.rows.push(row);}
 return [...groups.values()];
}

// Combine display cards only when the selected immutable image and location agree.
export function groupSameSceneImages(groups,assets){
 const byId=new Map(assets.map(a=>[a.id,a])),normal=s=>String(s||'').normalize('NFKC').replace(/[\s·・_\-（）()]/gu,'');
 const signature=row=>{if(row.role!=='scene'||row.status!=='ready'||row.assetIds.length!==1)return '';const a=byId.get(row.assetIds[0]);return a?.library?.revisionId&&a.library.sha256?a.library.revisionId+':'+a.library.sha256:'';};
 const place=(general,specific)=>{const a=normal(general.name),b=normal(specific.name),state=normal(general.state).split(/[；;，,]/u)[0];return a&&b.startsWith(a)&&b.length>a.length&&state&&(state===b||b.endsWith(state));};
 const out=[];for(const group of groups){if(group.role!=='scene'||group.rows.length!==1){out.push(group);continue;}const row=group.rows[0],sig=signature(row);let match=sig&&out.find(g=>g.role==='scene'&&g.rows.length===1&&signature(g.rows[0])===sig&&(place(g.rows[0],row)||place(row,g.rows[0])));if(match){match.sameSceneRows||=[];match.sameSceneRows.push(row);}else out.push({...group});}return out;
}

// Keep the image nodes and scroll position of cards whose content did not change.
export function reconcileWorkspaceCards(target,entries){
 const old=new Map([...target.children].map(n=>[n.dataset.galleryRenderKey,n]));let cursor=target.firstElementChild;
 for(const {key,html} of entries){let node=old.get(key);old.delete(key);if(!node||node.__assetMarkup!==html){const template=document.createElement('template');template.innerHTML=html;const next=template.content.firstElementChild;next.dataset.galleryRenderKey=key;next.__assetMarkup=html;if(node){if(cursor===node)cursor=next;node.replaceWith(next);}node=next;}
  if(node!==cursor)target.insertBefore(node,cursor);cursor=node.nextElementSibling;
 }
 for(const node of old.values())node.remove();
}
