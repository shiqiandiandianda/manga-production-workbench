import {clone,bounds,layoutLongStrip} from './model.js';
import {groupForLayer} from './layer-groups.js';
import {isProductionScreenBoard} from './production-screen-boards.js';
const sourceFrames=page=>new Set(page.panels.filter(f=>f.visible!==false).map(f=>f.productionGrid?.rootPanelId||f.panelSlice?.rootPanelId).filter(Boolean));
const background=f=>f.kind==='background'||f.productionBackground||f.productionBackgroundInstance||f.productionBackgroundResource;
export function screenFrameGaps(project,panelId,{bubbleSizes={}}={}){
 const page=project.pages.find(p=>p.panels.some(f=>f.id===panelId));if(!isProductionScreenBoard(page))return null;const excluded=sourceFrames(page),group=groupForLayer(project,panelId),own=new Set(group?.members.map(e=>e.item.id)||[panelId]),boxes=[];
 for(const f of page.panels)if(!background(f)&&!excluded.has(f.id)&&f.visible!==false){const b=bounds(f);boxes.push({id:f.id,top:f.y+b.y,bottom:f.y+b.y+b.h});}
 for(const b of page.bubbles)if(b.visible!==false){const size=bubbleSizes[b.id]||b,tip=size.tail?.tip;boxes.push({id:b.id,top:b.y+Math.min(0,tip?.y||0),bottom:b.y+Math.max(size.h,tip?.y||0)});}
 const target=boxes.filter(b=>own.has(b.id));if(!target.length)return {above:{height:0,blocked:true},below:{height:0,blocked:true}};const top=Math.min(...target.map(b=>b.top)),bottom=Math.max(...target.map(b=>b.bottom)),other=boxes.filter(b=>!own.has(b.id)),above={from:Math.max(0,...other.filter(b=>b.bottom<=top+.001).map(b=>b.bottom)),to:top},below={from:bottom,to:Math.min(page.height,...other.filter(b=>b.top>=bottom-.001).map(b=>b.top))};
 for(const gap of [above,below]){gap.height=Math.max(0,gap.to-gap.from);gap.blocked=gap.to<gap.from||other.some(b=>b.top<gap.to-.001&&b.bottom>gap.from+.001);gap.pageId=page.id;gap.screen=true;}return {above,below};
}
/** Reflow within this board only; later boards move through their layout offset. */
export function resizeScreenGap(source,panelId,side,height,{bubbleSizes={},assets=[]}={}){
 if(!Number.isFinite(height)||height<0||height>10000)throw Error('间距请输入 0—10000 px');const gap=screenFrameGaps(source,panelId,{bubbleSizes})?.[side];if(!gap||gap.blocked)throw Error('本屏此处有画格或文字重叠，请先调整位置');const project=clone(source),page=project.pages.find(p=>p.id===gap.pageId),delta=Math.round(height)-gap.height;if(page.locked)throw Error('请先解锁当前屏画板');if(page.height+delta<20)throw Error('画板高度不能小于20像素');
 const excluded=sourceFrames(page),shifting=page.panels.filter(f=>!background(f)&&!excluded.has(f.id)&&f.y+bounds(f).y>=gap.to-.001),texts=page.bubbles.filter(b=>b.y>=gap.to-.001);if(delta&&[...shifting,...texts].some(v=>v.locked))throw Error('本屏下方有锁定图层，请先解锁');for(const f of shifting)f.y+=delta;for(const b of texts){b.y+=delta;if(b.tail?.mode!=='normalized'&&Number.isFinite(b.tail?.y))b.tail.y+=delta;}
 const layout=layoutLongStrip(source.pages),entry=layout.pages.find(e=>e.pageId===page.id),cut=entry.y+gap.to;for(const g of project.gradients||[]){if(g.y>=cut)g.y+=delta;else if(g.y+g.h>cut)g.h=Math.max(1,g.h+delta);}
 page.height=Math.ceil(page.height+delta);const byId=new Map((assets instanceof Map?[...assets.values()]:assets).map(a=>[a.id,a]));for(const f of page.panels.filter(f=>f.productionBackgroundInstance)){f.h=Math.max(20,page.height-f.y);const a=byId.get(f.imageAssetId);if(a?.width&&a.height){const t=f.imageTransform||{x:0,y:0,scale:1},scale=Math.max(t.scale,page.width/a.width,f.h/a.height);f.imageTransform={...t,scale,x:Math.min(0,Math.max(page.width-a.width*scale,t.x)),y:Math.min(0,Math.max(f.h-a.height*scale,t.y))};}}
 return {project,pageId:page.id,height:Math.round(height),delta};
}
