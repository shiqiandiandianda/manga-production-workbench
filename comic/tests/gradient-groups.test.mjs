import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';
import {createProject,panel,id,rectangle,layoutLongStrip} from '../public/model.js';
import {makeGradientLayer,migrateLayerDocument,normalizeLayerOrder,gradientFrame,orderedLayers} from '../public/layers.js';
import {GRADIENT_HANDLES,resizeGradientRegion} from '../public/gradient-region.js';
import {attachBubbleGroups,panelForBubble,layerGroups,assignBubbleToPanel,movePanelGroup,moveGroupedLayer,setGroupFlag,deleteGroupedLayer} from '../public/layer-groups.js';
import {layerListMarkup} from '../public/layer-ui.js';
import {renderSceneSvg} from '../public/scene-svg.js';
import {renderStripSegment} from '../public/render.js';import {validateProject} from '../lib/store.mjs';import {createStudio} from '../server.mjs';
function fixture(){
 const p=createProject('区域与归组测试'),pg=p.pages[0];pg.width=1280;pg.height=6000;pg.background='#ffffff';
 p.shots=[{id:id('shot'),code:'S01',title:'第一格',description:'画面一',dialogue:'',referenceIds:[]},{id:id('shot'),code:'S02',title:'第二格',description:'画面二',dialogue:'',referenceIds:[]}];const a=panel(p.shots[0].id,100,100,500,500),b=panel(p.shots[1].id,100,1500,500,500);pg.panels=[a,b];pg.bubbles=[{id:id('bubble'),shotId:a.shotId,type:'speech',text:'这句属于第一格',visible:true,x:180,y:20,w:200,h:100,fontSize:24}];p.gradients=[];normalizeLayerOrder(p);return p;
}
test('渐变新建为当前位置局部区域，显式整话覆盖仍保留，规则底色不被转成局部遮罩',()=>{
 const p=fixture(),g=makeGradientLayer(p,{y:2500});assert.deepEqual([g.coverage,g.x,g.y,g.w,g.h],['area',0,2500,1280,1920]);Object.assign(g,{coverage:'document',y:0,h:6000});g.gradient.start={x:.5,y:.2};g.gradient.end={x:.5,y:.3};p.gradients=[g];normalizeLayerOrder(p);const before=structuredClone(p),m=migrateLayerDocument(p),n=m.project.gradients[0];assert.equal(m.changed,true);assert.equal(m.project.editorLayoutVersion,2);assert.equal(n.id,g.id);assert.deepEqual([n.coverage,n.w,n.h],['document',1280,6000]);assert.equal(gradientFrame(g,layoutLongStrip(p.pages)).h,6000);assert.deepEqual(p,before);assert.equal(migrateLayerDocument(m.project).changed,false);validateProject(m.project);
});
test('四角及四边八种调整保持相对边固定，并限制为正尺寸',()=>{
 const initial={x:100,y:200,w:1280,h:1920};for(const [handle] of GRADIENT_HANDLES){const n=resizeGradientRegion(initial,handle,{x:400,y:500});assert.ok(n.w>0&&n.h>0);if(!handle.includes('w'))assert.equal(n.x,initial.x);if(!handle.includes('e'))assert.equal(n.x+n.w,initial.x+initial.w);if(!handle.includes('n'))assert.equal(n.y,initial.y);if(!handle.includes('s'))assert.equal(n.y+n.h,initial.y+initial.h);}assert.equal(resizeGradientRegion(initial,'nw',{x:9000,y:9000}).w,1);
});
test('真实渐变拖动事件：边中点按增量移动，抓取边缘与没有所属页时也不会跳',()=>{
 const code=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=code.indexOf("stage.addEventListener('pointermove',event=>{"),end=code.indexOf('function finishDrag(event)',start);assert.ok(start>0&&end>start);
 for(const [handle,hx,hy] of GRADIENT_HANDLES){const initial={id:'gradient',x:100,y:200,w:1280,h:1920},item=structuredClone(initial),at={x:initial.x+hx*initial.w+7,y:initial.y+hy*initial.h+9};let handler;
 const context={stage:{addEventListener(type,fn){handler=fn;}},drag:{kind:'gradient-resize',type:'gradient',pointer:3,pageId:null,handle,initial,start:at},dragItem:()=>item,documentPoint:e=>e.point,project:{pages:[]},GRADIENT_HANDLES,resizeGradientRegion,renderCanvas(){},queueBatchPreview(){}};
 vm.runInNewContext(code.slice(start,end),context);handler({pointerId:3,point:at});assert.deepEqual(item,initial);handler({pointerId:3,point:{x:at.x-25,y:at.y-50}});const expected=resizeGradientRegion(initial,handle,{x:initial.x+hx*initial.w-25,y:initial.y+hy*initial.h-50});assert.deepEqual({x:item.x,y:item.y,w:item.w,h:item.h},expected);}
});
test('范围模式八点和渐变起止点模式分别可用；绘制捕获仅限区域，锁定禁用控制点',()=>{
 const p=fixture(),g=makeGradientLayer(p,{y:0});g.gradient.enabled=true;p.gradients=[g];normalizeLayerOrder(p);
 const state={mode:'continuous',zoom:.25,currentPageId:p.pages[0].id,window:{startY:0,endY:2200}},options={assets:new Map(),measurement:{measureText:s=>({width:s.length*20})},selection:{id:g.id,type:'gradient'},tool:'move',brush:{size:120},escape:String,shotFor:()=>null};
 let svg=renderSceneSvg(p,state,options).content;assert.equal((svg.match(/data-gradient-resize=/g)||[]).length,8);assert.match(svg,/data-gradient-move/);
 svg=renderSceneSvg(p,state,{...options,tool:'gradient'}).content;assert.match(svg,/width="1280" height="1920" fill="transparent" data-paint-target/);assert.equal((svg.match(/data-gradient-endpoint=/g)||[]).length,2);assert.equal((svg.match(/data-gradient-resize=/g)||[]).length,0);
 g.locked=true;svg=renderSceneSvg(p,state,options).content;assert.equal((svg.match(/data-gradient-resize=/g)||[]).length,0);
});
let canvas;try{canvas=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE);}catch{}
test('director transitions stay below dialogue in existing projects, SVG and actual exported pixels; manual foregrounds retain order',{skip:!canvas},async()=>{
 const p=fixture(),bubble=p.pages[0].bubbles[0];Object.assign(bubble,{x:200,y:200,w:300,h:160,fontSize:24,text:'Synthetic dialogue',shape:'rounded-rect',fill:'#ffffff',fillColor:'#ffffff',padding:20});
 const g=makeGradientLayer(p,{y:0});Object.assign(g,{x:0,y:0,w:1280,h:700,designEpisode:1});g.gradient={...g.gradient,enabled:true,mode:'color',startColor:'#000000',endColor:'#000000'};p.gradients=[g];p.layerOrder=[...p.pages[0].panels.map(f=>f.id),bubble.id,g.id];const before=structuredClone(p),ordered=orderedLayers(p).map(e=>e.item.id);assert.ok(ordered.indexOf(g.id)<ordered.indexOf(bubble.id));assert.deepEqual(p,before);
 const state={mode:'continuous',zoom:1,currentPageId:p.pages[0].id,window:{startY:0,endY:800}},svg=renderSceneSvg(p,state,{assets:new Map(),measurement:{measureText:s=>({width:s.length*15})},selection:null,tool:'move',escape:String,shotFor:()=>null}).content;assert.ok(svg.indexOf(g.id)>=0&&svg.indexOf(bubble.id)>svg.indexOf(g.id));
 const image=await renderStripSegment(layoutLongStrip(p.pages),{y:0,height:700},{project:p,canvasFactory:()=>canvas.createCanvas(1,1)}),pixel=(x,y)=>[...image.getContext('2d').getImageData(x,y,1,1).data];assert.deepEqual(pixel(250,220),[255,255,255,255]);assert.deepEqual(pixel(1000,300),[0,0,0,255]);
 delete g.designEpisode;assert.equal(orderedLayers(p).at(-1).item.id,g.id);normalizeLayerOrder(p);assert.equal(p.layerOrder.at(-1),g.id);
});
test('实际导出像素：矩形外四周不被渐变覆盖，改宽高后范围同步',{skip:!canvas},async()=>{
 const p=fixture();p.pages[0].panels=[];p.pages[0].bubbles=[];const g=makeGradientLayer(p);Object.assign(g,{x:200,y:100,w:500,h:500});g.gradient={...g.gradient,enabled:true,mode:'color',startColor:'#ff0000',endColor:'#ff0000'};p.gradients=[g];normalizeLayerOrder(p);
 const render=()=>renderStripSegment(layoutLongStrip(p.pages),{y:0,height:800},{project:p,canvasFactory:()=>canvas.createCanvas(1,1)});
 const pixel=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data];let c=await render();assert.deepEqual(pixel(c,400,300),[255,0,0,255]);for(const xy of [[100,300],[800,300],[400,50],[400,650]])assert.deepEqual(pixel(c,...xy),[255,255,255,255]);g.w=200;g.h=200;c=await render();assert.deepEqual(pixel(c,300,150),[255,0,0,255]);assert.deepEqual(pixel(c,500,500),[255,255,255,255]);
});
test('实际导出像素：颜色到颜色及颜色到透明都限定在同一矩形',{skip:!canvas},async()=>{
 const p=fixture();p.pages[0].panels=[];p.pages[0].bubbles=[];const g=makeGradientLayer(p);Object.assign(g,{x:200,y:100,w:500,h:500});g.gradient={...g.gradient,enabled:true,mode:'color',startColor:'#ff0000',endColor:'#0000ff'};p.gradients=[g];normalizeLayerOrder(p);
 const render=()=>renderStripSegment(layoutLongStrip(p.pages),{y:0,height:800},{project:p,canvasFactory:()=>canvas.createCanvas(1,1)}),px=(c,y)=>[...c.getContext('2d').getImageData(400,y,1,1).data];let c=await render();assert.ok(px(c,120)[0]>200&&px(c,580)[2]>200);assert.deepEqual(px(c,650),[255,255,255,255]);g.gradient.mode='transparent';c=await render();assert.ok(px(c,120)[1]<50&&px(c,580)[1]>200);assert.deepEqual(px(c,650),[255,255,255,255]);
});
test('对白归属优先显式格子和镜头身份，移动对白不会重新猜归属；搜索带上所属格子',()=>{
 const p=fixture(),b=p.pages[0].bubbles[0],a=p.pages[0].panels[0];b.y=1550;attachBubbleGroups(p);assert.equal(b.parentPanelId,a.id);b.y=5000;assert.equal(panelForBubble(p,b.id).item.id,a.id);const before=structuredClone(p),html=layerListMarkup(p,{escape:String,selectedId:b.id,search:b.text});assert.ok(html.includes('data-layer-group="'+a.id+'"'));assert.ok(html.includes('data-layer="'+b.id+'"'));assert.deepEqual(p,before);
});
test('归属选择只修改所属格子和镜头，不移动文字；不能绑定不存在的格子',()=>{
 const p=fixture(),b=p.pages[0].bubbles[0],next=p.pages[0].panels[1];attachBubbleGroups(p);const before=[b.x,b.y,b.text];assignBubbleToPanel(p,b.id,next.id);assert.equal(b.parentPanelId,next.id);assert.equal(b.shotId,next.shotId);assert.deepEqual([b.x,b.y,b.text],before);assert.throws(()=>assignBubbleToPanel(p,b.id,id('panel')),/当前画板/);validateProject(p);
});
test('整体移动格子时对白随组平移，重复鼠标移动按起始快照计算；锁定文字阻止整体移动',()=>{
 const p=fixture(),a=p.pages[0].panels[0],b=p.pages[0].bubbles[0];attachBubbleGroups(p);const before=structuredClone(p);assert.equal(movePanelGroup(p,a.id,{x:150,y:-100},before),true);assert.deepEqual([a.x,a.y,b.x,b.y],[150,-100,230,-180]);movePanelGroup(p,a.id,{x:180,y:-150},before);assert.deepEqual([a.x,a.y,b.x,b.y],[180,-150,260,-230]);b.locked=true;const saved=structuredClone(p);assert.equal(movePanelGroup(p,a.id,{x:200,y:200}),false);assert.deepEqual(p,saved);validateProject(p);
});
test('组排序、显隐、锁定和删除包含所属文字，其他组不受影响',()=>{
 const p=fixture(),[a,next]=p.pages[0].panels,b=p.pages[0].bubbles[0];attachBubbleGroups(p);moveGroupedLayer(p,a.id,next.id,'above');assert.deepEqual(p.layerOrder.slice(-2),[a.id,b.id]);setGroupFlag(p,a.id,'visible',false);assert.equal(b.visible,false);assert.equal(next.visible,true);setGroupFlag(p,a.id,'locked',true);assert.equal(b.locked,true);const saved=structuredClone(p);deleteGroupedLayer(p,a.id);assert.equal(p.pages[0].bubbles.length,0);assert.equal(p.pages[0].panels[0].id,next.id);validateProject(p);validateProject(saved);
});
test('保存、备份、工程导入与旧窗口保护：归属ID映射后不丢失，区域保持不扩大',async t=>{
 const base=path.resolve('.runtime/temp');fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(path.join(base,'gradient-groups-')),studio=createStudio({dataDir:dir,seedReference:false,bridge:{close(){}},jimengBridge:{close(){}}});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>{studio.close();assert.ok(path.resolve(dir).startsWith(base+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 const original=fixture();studio.store.db.projects=[original];studio.store.save();const url='http://127.0.0.1:'+studio.server.address().port,req=async(route,method='GET',data)=>{const r=await fetch(url+route,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};};
 const migrated=await req('/api/projects/'+original.id+'/migrate-layers','POST',{expectedRevision:original.revision});assert.equal(migrated.status,200);assert.equal(migrated.data.editorLayoutVersion,2);assert.ok(fs.existsSync(path.join(dir,'backups',original.id+'_before_layers_'+original.revision+'.json')));const stale=structuredClone(original);stale.revision=migrated.data.revision;stale.layerSchema=1;assert.equal((await req('/api/projects/'+original.id,'PUT',stale)).status,409);
 const updated=migrated.data,g=makeGradientLayer(updated,{y:1400});g.w=700;g.h=900;updated.gradients=[g];normalizeLayerOrder(updated);assert.equal((await req('/api/projects/'+original.id,'PUT',updated)).status,200);
 const packed=(await req('/api/projects/'+original.id+'/export')).data,imported=await req('/api/projects/import','POST',packed);assert.equal(imported.status,201);const p=imported.data;assert.equal(p.pages[0].bubbles[0].parentPanelId,p.pages[0].panels[0].id);assert.notEqual(p.pages[0].panels[0].id,original.pages[0].panels[0].id);assert.deepEqual([p.gradients[0].coverage,p.gradients[0].w,p.gradients[0].h],['area',700,900]);validateProject(p);
});
