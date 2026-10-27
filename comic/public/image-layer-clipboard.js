import {clone,id,clamp} from './model.js';
import {findLayer,normalizeLayerOrder} from './layers.js';

// An in-memory snapshot of artwork only. Assets and source shots stay shared;
// every piece of editable geometry is cloned again for each pasted instance.
export function copyImageLayer(project,key){
 const source=findLayer(project,key);
 if(source?.type!=='panel')return null;
 return {projectId:project.id,pageId:source.pageId,sourcePanelId:source.item.id,item:clone(source.item)};
}
export function pasteImageLayer(project,clipboard,{pageId=clipboard?.pageId}={}){
 if(!clipboard||clipboard.projectId!==project.id)return null;
 const page=project.pages.find(p=>p.id===pageId);
 if(!page)return null;
 if(page.panels.length>=1000)throw new Error('当前画板画面层已达上限，请切换画板后粘贴');
 const item=clone(clipboard.item),shot=project.shots.find(s=>s.id===item.shotId);
 const name=item.name||(shot?shot.code+' · '+shot.title:'画面');
 item.id=id('panel');item.name=name.slice(0,113)+' · 副本';item.locked=false;
 item.generationToken=null;item.copiedFromPanelId=clipboard.sourcePanelId;
 item.x=clamp(item.x+24,-page.width,page.width*2);
 const order=normalizeLayerOrder(project),sourceIndex=order.indexOf(clipboard.sourcePanelId);
 page.panels.push(item);order.splice(sourceIndex<0?order.length:sourceIndex+1,0,item.id);
 return {type:'panel',item,page,pageId:page.id};
}
export function imageLayerShortcut(event){
 const target=event.target;
 if(event.defaultPrevented||event.isComposing||event.altKey||event.shiftKey||!(event.ctrlKey||event.metaKey))return null;
 if(target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return null;
 return {c:'copy',v:'paste',d:'duplicate'}[event.key.toLowerCase()]||null;
}
