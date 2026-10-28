import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,clone,id,panel,layoutLongStrip} from '../public/model.js';
import {splitProductionScreenBoards} from '../public/production-screen-boards.js';
import {mergeReflowIntoOriginal} from '../public/auto-layout-reflow.mjs';
import {screenFrameGaps,resizeScreenGap} from '../public/production-screen-spacing.js';

function fixture(){
 const p=createProject('合成成图重排'),page=p.pages[0];page.height=3300;page.storyboard={episode:1,projection:'manual'};page.panels=[];page.bubbles=[];
 const segments=[];
 for(let i=0;i<3;i++){
  const key='S'+i,root=panel(p.shots[0].id,0,0,1280,3000);root.productionSegment=key;root.visible=false;
  const crop=panel(p.shots[0].id,40,i*1100+100,600,800);crop.panelSlice={segmentId:key,rootPanelId:root.id,panelId:'G'+i};crop.imageAssetId='original-image-'+i;crop.imageTransform={x:4,y:5,scale:.8};
  page.panels.push(root,crop);segments.push({id:key,localId:'段0'+(i+1),scene:'合成场景',order:i,panelId:root.id});
  page.bubbles.push({id:id('bubble'),parentPanelId:crop.id,productionSegment:key,visible:true,x:50,y:i*1100+130,w:200,h:100,text:'保留台词'+i,fontSize:30,textBox:{x:4,y:8,w:180,h:70},tail:{mode:'absolute',x:80,y:i*1100+260}});
 }
 // Archived background instances must not be dropped or made visible again.
 const background=panel(p.shots[0].id,0,0,1280,3300);background.visible=false;background.productionBackgroundInstance={segmentId:'S2',sourcePanelId:page.panels[0].id};page.panels.push(background);
 const other=clone(page);other.id=id('page');other.name='另一话';other.storyboard={episode:2,projection:'production-screen',segmentId:'OTHER'};other.panels=[];other.bubbles=[];p.pages.push(other);
 p.productionPackage={episodes:[{episode:1,segments}]};p.productionScreenBoards=1;p.episodeReflows={1:{mode:'screen-crop-reflow',episode:1,batchId:'synthetic'}};
 p.layerOrder=page.panels.concat(page.bubbles).map(l=>l.id);return p;
}
function documentLayers(p){return new Map(layoutLongStrip(p.pages).pages.flatMap(e=>[...e.page.panels,...e.page.bubbles].map(f=>[f.id,{...clone(f),y:f.y+e.y,...(f.tail?.mode!=='normalized'&&Number.isFinite(f.tail?.y)?{tail:{...f.tail,y:f.tail.y+e.y}}:{})}])));}

test('错误已分屏标记的重排长图恢复为每屏一板，图层和绝对位置不变',()=>{
 const p=fixture(),before=clone(p),result=splitProductionScreenBoards(p),q=result.project;
 assert.equal(result.changed,true);assert.equal(q.pages.length,4);
 assert.deepEqual(q.pages.slice(0,3).map(p=>p.screenBoard.segmentId),['S0','S1','S2']);
 assert.deepEqual(documentLayers(q),documentLayers(p));assert.deepEqual(q.pages[3],p.pages[1]);assert.deepEqual(q.layerOrder,p.layerOrder);assert.deepEqual(q.shots,p.shots);assert.deepEqual(q.productionPackage,p.productionPackage);assert.deepEqual(p,before);
 for(const page of q.pages.slice(0,3))assert.ok(page.panels.filter(f=>f.visible!==false).every(f=>f.panelSlice.segmentId===page.screenBoard.segmentId));
 assert.equal(splitProductionScreenBoards(q).changed,false);
});

test('重排接回原工程立即分屏，多画板重排接回也不能丢后续屏段',()=>{
 const p=fixture(),original=splitProductionScreenBoards(p).project,derived=clone(p);derived.autoLayoutSource=p.episodeReflows[1];
 const q=mergeReflowIntoOriginal(original,derived,1);assert.equal(q.id,original.id);assert.equal(q.pages.filter(p=>p.storyboard.episode===1).length,3);assert.deepEqual(q.pages.at(-1),original.pages.at(-1));assert.deepEqual(documentLayers(q),documentLayers(p));
 const multi=splitProductionScreenBoards(derived).project;multi.autoLayoutSource=derived.autoLayoutSource;const again=mergeReflowIntoOriginal(original,multi,1);assert.equal(again.pages.length,4);assert.deepEqual(documentLayers(again),documentLayers(p));
});

test('恢复后间距修改只改本屏；已分屏板和无重排记录工程不重复迁移',()=>{
 const p=fixture(),q=splitProductionScreenBoards(p).project,first=q.pages[0],crop=first.panels.find(f=>f.visible!==false),gap=screenFrameGaps(q,crop.id).below;
 const resized=resizeScreenGap(q,crop.id,'below',gap.height+100).project;assert.equal(resized.pages[0].height,first.height+100);assert.deepEqual(resized.pages.slice(1),q.pages.slice(1));
 delete p.episodeReflows;assert.equal(splitProductionScreenBoards(p).changed,false);
});
