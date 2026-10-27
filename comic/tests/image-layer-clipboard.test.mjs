import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,clone,id} from '../public/model.js';
import {normalizeLayerOrder} from '../public/layers.js';
import {attachBubbleGroups,movePanelGroup} from '../public/layer-groups.js';
import {copyImageLayer,pasteImageLayer,imageLayerShortcut} from '../public/image-layer-clipboard.js';
import {validateProject} from '../lib/store.mjs';

function fixture(){
 const project=createProject('Synthetic artwork clipboard'),page=project.pages[0],item=page.panels[0];
 Object.assign(item,{x:80,y:100,w:1000,h:500,imageAssetId:id('asset'),imageTransform:{x:0,y:0,scale:1},generationToken:id('job'),candidates:[id('asset')],mask:{enabled:false,strokes:[]},layoutSourceKey:'original-layout'});
 page.bubbles=[{id:id('bubble'),shotId:item.shotId,parentPanelId:item.id,x:100,y:650,w:300,h:100,text:'Original dialogue',type:'speech',shape:'oval',visible:true,locked:false,fontSize:28}];
 attachBubbleGroups(project);normalizeLayerOrder(project);return {project,page,item};
}
test('artwork snapshot retains source, never clones dialogue or generation jobs',()=>{
 const {project,page,item}=fixture(),before=clone(project),clipboard=copyImageLayer(project,item.id);
 assert.deepEqual(project,before);const copy=pasteImageLayer(project,clipboard).item;
 assert.notEqual(copy.id,item.id);assert.equal(copy.imageAssetId,item.imageAssetId);assert.equal(copy.shotId,item.shotId);
 assert.equal(copy.layoutSourceKey,item.layoutSourceKey);assert.equal(copy.copiedFromPanelId,item.id);assert.equal(copy.generationToken,null);
 assert.deepEqual(page.bubbles,before.pages[0].bubbles);assert.deepEqual(project.shots,before.shots);
 assert.equal(project.layerOrder.indexOf(copy.id),project.layerOrder.indexOf(item.id)+1);validateProject(project);
});
test('clipboard is a snapshot; repeated pastes have independent crop, effects and positions',()=>{
 const {project,item}=fixture(),clipboard=copyImageLayer(project,item.id);item.imageTransform.x=99;
 const a=pasteImageLayer(project,clipboard).item,b=pasteImageLayer(project,clipboard).item;
 a.points[1].x=.35;a.imageTransform.x=-500;a.candidates.push(id('asset'));a.mask.strokes.push({points:[]});
 assert.equal(b.points[1].x,1);assert.equal(b.imageTransform.x,0);assert.equal(item.imageTransform.x,99);
 assert.equal(b.mask.strokes.length,0);assert.equal(b.candidates.length,1);assert.equal(clipboard.item.imageTransform.x,0);
 assert.equal(new Set([item.id,a.id,b.id]).size,3);const originalBubbles=clone(project.pages[0].bubbles);
 assert.equal(movePanelGroup(project,a.id,{x:600,y:100}),true);assert.deepEqual(project.pages[0].bubbles,originalBubbles);assert.notEqual(item.x,a.x);
});
test('undo snapshots restore paste and next paste never reuses an ID',()=>{
 let {project,item}=fixture();const clipboard=copyImageLayer(project,item.id),before=clone(project),first=pasteImageLayer(project,clipboard).item;
 project=clone(before);assert.equal(project.pages[0].panels.some(p=>p.id===first.id),false);
 const second=pasteImageLayer(project,clipboard).item;assert.notEqual(first.id,second.id);
});
test('only artwork can be copied; stale project/page and layer capacity are handled',()=>{
 const {project,page,item}=fixture(),clipboard=copyImageLayer(project,item.id);
 assert.equal(copyImageLayer(project,page.bubbles[0].id),null);assert.equal(copyImageLayer(project,'missing'),null);
 assert.equal(pasteImageLayer(createProject(),clipboard),null);assert.equal(pasteImageLayer(project,clipboard,{pageId:'missing'}),null);
 page.panels=Array.from({length:1000},()=>item);assert.throws(()=>pasteImageLayer(project,clipboard),/上限/);
});
test('keyboard shortcuts defer to text editors, IME, dialogs handled by app and browser modifiers',()=>{
 const event={ctrlKey:true,key:'c',target:{closest:()=>null}};
 assert.equal(imageLayerShortcut(event),'copy');assert.equal(imageLayerShortcut({...event,key:'v'}),'paste');assert.equal(imageLayerShortcut({...event,key:'d'}),'duplicate');
 assert.equal(imageLayerShortcut({...event,ctrlKey:false,metaKey:true}),'copy');
 for(const extra of [{shiftKey:true},{altKey:true},{isComposing:true},{defaultPrevented:true},{target:{isContentEditable:true}},{target:{closest:()=>({})}}])assert.equal(imageLayerShortcut({...event,...extra}),null);
});
