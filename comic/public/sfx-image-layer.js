export const isSfxImage=layer=>layer?.sfxImage===true;
const finite=(v,d=0)=>Number.isFinite(v)?v:d;
export function sfxImageRotation(layer){return isSfxImage(layer)?Math.max(-180,Math.min(180,finite(layer.rotation))):0;}
export function sfxImageTransform(layer){return isSfxImage(layer)?` rotate(${sfxImageRotation(layer)} ${layer.w/2} ${layer.h/2})`:'';}
export function sfxImageBounds(layer){const angle=sfxImageRotation(layer)*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle)),w=layer.w*c+layer.h*s,h=layer.w*s+layer.h*c;return {x:layer.x+(layer.w-w)/2,y:layer.y+(layer.h-h)/2,w,h};}
export function sfxImageDelta(layer,dx,dy){const angle=sfxImageRotation(layer)*Math.PI/180;return {x:dx*Math.cos(angle)+dy*Math.sin(angle),y:-dx*Math.sin(angle)+dy*Math.cos(angle)};}
export function makeSfxImageLayer(asset,item,{id,page,frame=null,visibleTop=0,visibleHeight=600}={}){
 if(!asset?.id||!(asset.width>0&&asset.height>0))throw new Error('冲刺线尺寸未读取，无法添加');
 const scale=Math.min((frame?.w||page.width*.6)/asset.width,(frame?.h||Math.min(500,visibleHeight*.65))/asset.height),w=Math.max(20,Math.round(asset.width*scale)),h=Math.max(20,Math.round(asset.height*scale));
 const x=Math.max(8,Math.min(page.width-w-8,frame?frame.x+(frame.w-w)/2:(page.width-w)/2)),y=Math.max(8,Math.min(page.height-h-8,frame?frame.y+(frame.h-h)/2:visibleTop+Math.max(20,(visibleHeight-h)/3)));
 return {id,shotId:'',name:'冲刺线 · '+item.label,sfxImage:true,sfxImageKey:item.id,sourceFilePath:asset.filePath||item.filePath,x,y,w,h,sfxImageBaseWidth:w,rotation:0,
  points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'panel',visible:true,locked:false,border:0,borderColor:'#111111',feather:0,
  imageAssetId:asset.id,imageTransform:{x:0,y:0,scale:w/asset.width},candidates:[],generationToken:null,referenceIds:[]};
}
export function scaleSfxImage(layer,ratio,{maxWidth=3840,pageWidth=1280}={}){
 if(!(ratio>0&&Number.isFinite(ratio)))throw new Error('缩放比例必须大于零');ratio=Math.max(20/layer.w,20/layer.h,Math.min(maxWidth/layer.w,ratio));
 const next=structuredClone(layer);next.w=layer.w*ratio;next.h=layer.h*ratio;next.x=Math.max(-pageWidth,Math.min(pageWidth*2,layer.x+(layer.w-next.w)/2));next.y=layer.y+(layer.h-next.h)/2;
 if(next.imageTransform)for(const key of ['x','y','scale'])next.imageTransform[key]*=ratio;return next;
}
// Reuse the existing image corner drag and commit/cancel lifecycle.
export function resizeSfxImageCorner(layer,index,{dx,dy},{maxWidth=3840,pageWidth=1280}={}){
 const [sx,sy]=[[-1,-1],[1,-1],[1,1],[-1,1]][index]||[1,1],local=sfxImageDelta(layer,dx,dy);
 const ratio=1+(local.x*sx*layer.w+local.y*sy*layer.h)/(layer.w*layer.w+layer.h*layer.h),next=scaleSfxImage(layer,Math.max(.0001,ratio),{maxWidth,pageWidth});
 const angle=sfxImageRotation(layer)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),cx=layer.x+layer.w/2,cy=layer.y+layer.h/2;
 const ox=cx-c*sx*layer.w/2+s*sy*layer.h/2,oy=cy-s*sx*layer.w/2-c*sy*layer.h/2;
 next.x=Math.max(-pageWidth,Math.min(pageWidth*2,ox+c*sx*next.w/2-s*sy*next.h/2-next.w/2));
 next.y=oy+s*sx*next.w/2+c*sy*next.h/2-next.h/2;return next;
}
export function sfxImageInspector(layer,{escape,numberField,page,asset}){
 const n=(label,key,value,min,max,step=1,section='panel')=>numberField(label,key,value,section,min,max,step);
 return `<div class="common-inspector"><label>图层名称<input data-section="panel" data-field="name" maxlength="120" value="${escape(layer.name)}"></label><div class="field-grid">${n('旋转 °','rotation',sfxImageRotation(layer),-180,180)}${n('X px','x',layer.x,-page.width,page.width*2)}${n('Y px','y',layer.y,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER-layer.h)}${n('裁切宽 px','w',layer.w,20,page.width*3)}${n('裁切高 px','h',layer.h,20,Number.MAX_SAFE_INTEGER-layer.y)}</div><button data-action="sfx-image-crop" class="wide">取景 / 裁切</button><button data-action="mirror-image" class="wide" aria-pressed="${layer.imageTransform?.flipX===true}">${layer.imageTransform?.flipX===true?'取消水平镜像':'水平镜像冲刺线'}</button><div class="row"><button data-action="layer-up">上移一层</button><button data-action="layer-down">下移一层</button></div><label>原图路径<input readonly value="${escape(asset?.filePath||layer.sourceFilePath||'')}" title="只引用本地路径，不复制原图"></label><p class="sub-note">源文件缺失或共享盘断开时，预览/导出会提示；原图不存进工程或发布包。</p></div>`;
}
