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

// Keep the image nodes and scroll position of cards whose content did not change.
export function reconcileWorkspaceCards(target,entries){
 const old=new Map([...target.children].map(n=>[n.dataset.galleryRenderKey,n]));let cursor=target.firstElementChild;
 for(const {key,html} of entries){let node=old.get(key);old.delete(key);if(!node||node.__assetMarkup!==html){const template=document.createElement('template');template.innerHTML=html;const next=template.content.firstElementChild;next.dataset.galleryRenderKey=key;next.__assetMarkup=html;if(node){if(cursor===node)cursor=next;node.replaceWith(next);}node=next;}
  if(node!==cursor)target.insertBefore(node,cursor);cursor=node.nextElementSibling;
 }
 for(const node of old.values())node.remove();
}
