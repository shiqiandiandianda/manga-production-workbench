import {upscaleLabel} from './upscale-models.js';
import {id,clone,fitImage} from './model.js';

export const isCutoutLayer=item=>!!item?.cutoutLayer?.parentPanelId;
export const isUpscaleLayer=item=>isCutoutLayer(item)&&item.cutoutLayer.kind==='upscale';
export function createUpscaleLayer(project,parent,asset,sourceAsset,{sessionId,model=''}={}){
 if(asset.width<sourceAsset.width||asset.height<sourceAsset.height)throw Error('高清图尺寸不能小于来源原图');
 const item=createCutoutLayer(project,parent,asset,sourceAsset,{sessionId,position:'above'}),scale=asset.width/sourceAsset.width;
 item.name='高清 '+Number(scale.toFixed(2))+'× · '+(model?upscaleLabel(model)+' · ':'')+(parent.name||'原画面').slice(0,95);
 Object.assign(item.cutoutLayer,{kind:'upscale',scale,width:asset.width,height:asset.height,model:String(model).slice(0,160)});
 for(const key of ['feather','featherEdges','mask','border','borderColor'])if(parent[key]!==undefined)item[key]=clone(parent[key]);
 const siblings=project.pages.flatMap(p=>p.panels).filter(f=>f.id!==item.id&&isUpscaleLayer(f)&&f.cutoutLayer.parentPanelId===parent.id),order=project.layerOrder.filter(key=>key!==item.id),at=Math.max(order.indexOf(parent.id),...siblings.map(f=>order.indexOf(f.id)));order.splice(at+1,0,item.id);project.layerOrder=order;return item;
}
export function createCutoutLayer(project,parent,asset,sourceAsset,{sessionId,position='above'}={}){
 const page=project.pages.find(p=>p.panels.includes(parent));if(!page||parent.locked||page.locked)throw Error('请先解锁原画格和画板');
 if(isCutoutLayer(parent))throw Error('请在原画格上新增抠图层');if(page.panels.length>=1000)throw Error('当前画板图层数量已达上限');
 if(Math.abs(asset.width/asset.height-sourceAsset.width/sourceAsset.height)>.001)throw Error('图片比例已改变，无法按原位置叠加，请使用替换画格');
 const transform=clone(parent.imageTransform||fitImage(parent,sourceAsset));transform.scale*=sourceAsset.width/asset.width;
 const item={id:id('panel'),shotId:parent.shotId,name:(parent.name||'画格').slice(0,100)+' · 抠图层',x:parent.x,y:parent.y,w:parent.w,h:parent.h,points:clone(parent.points),kind:'panel',border:0,borderColor:parent.borderColor,feather:0,visible:true,locked:false,imageAssetId:asset.id,imageTransform:transform,candidates:[asset.id],referenceIds:[],cutoutLayer:{version:1,parentPanelId:parent.id,sourceAssetId:sourceAsset.id,sessionId}};
 const ids=new Set(project.pages.flatMap(p=>[...p.panels,...p.bubbles]).map(f=>f.id).concat((project.gradients||[]).map(g=>g.id))),order=[...new Set([...(project.layerOrder||[]),...ids])].filter(key=>ids.has(key));
 page.panels.push(item);project.layerOrder=order;setCutoutPosition(project,item,position);return item;
}
export function cutoutPosition(project,item){const order=project.layerOrder||[];return order.indexOf(item.id)>order.indexOf(item.cutoutLayer?.parentPanelId)?'above':'below';}
export function setCutoutPosition(project,item,position){
 if(!isCutoutLayer(item)||!['above','below'].includes(position))throw Error('抠图层位置无效');if(item.locked)throw Error('请先解锁抠图层');
 const parent=project.pages.flatMap(p=>p.panels).find(p=>p.id===item.cutoutLayer.parentPanelId);if(!parent)throw Error('原画格已删除');
 const order=(project.layerOrder||[]).filter(key=>key!==item.id),at=order.indexOf(parent.id);if(at<0)throw Error('原画格图层顺序无效');order.splice(at+(position==='above'?1:0),0,item.id);project.layerOrder=order;return item;
}
export function cutoutPositionMarkup(item,position){return isCutoutLayer(item)?`<div class="cutout-position-tools" data-cutout-position-tools><strong>${isUpscaleLayer(item)?'高清图层':item.cutoutLayer.kind==='repair-patch'?'补图层':'抠图'}叠放位置</strong><div class="row"><button data-action="cutout-above" aria-pressed="${position==='above'}" ${item.locked?'disabled':''}>原图上方</button><button data-action="cutout-below" aria-pressed="${position==='below'}" ${item.locked?'disabled':''}>原图下方</button></div></div>`:'';}
