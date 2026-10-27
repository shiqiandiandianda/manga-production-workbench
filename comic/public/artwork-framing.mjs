/** Native pixels never change. Only the destination frame and its uniform view do. */
export function artworkFrame(shot){
 const a=shot.existingArtwork;if(!a)return null;
 if(![a.width,a.height].every(n=>Number.isFinite(n)&&n>0))throw Error('已有图片尺寸无效：'+shot.key);
 const p=shot.artworkLayout;if(!p)return a;
 if(p.version!==1||!['preserve','cover'].includes(p.fit)||!['fixed','rules'].includes(p.framePolicy))throw Error('已有图片取景约束无效：'+shot.key);
 if(p.fit==='preserve'&&p.framePolicy!=='fixed')throw Error('保留取景必须冻结当前框形');
 if(p.framePolicy==='rules')return null;
 if(![p.width,p.height].every(n=>Number.isFinite(n)&&n>0))throw Error('目标框形无效：'+shot.key);
 return {width:p.width,height:p.height};
}

export function sourceAspect(record){
 const raw=record?.original||{},p=record?.production||{};
 for(const key of ['目标宽高比','单格画幅','画幅']){
  const value=raw[key]??p[key];if(value===undefined)continue;
  const m=String(value).trim().match(/^(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)$/);
  return m&&Number(m[1])>0&&Number(m[2])>0?{width:Number(m[1]),height:Number(m[2])}:null;
 }
 return null;
}

export function coverSettings(frame,size,view={}){
 const old=size.currentFrame,t=old?.imageTransform;
 const zoom=view.zoom??(t?Math.max(1,Math.min(3,t.scale/Math.max(old.w/size.width,old.h/size.height))):1),scale=Math.max(frame.w/size.width,frame.h/size.height)*zoom;
 const focus=(axis,length,target)=>{if(!t)return .5;const center=((old[axis==='x'?'w':'h']/2-t[axis])/(length*t.scale))*length*scale,extra=length*scale-target;return extra>1e-7?Math.max(0,Math.min(1,(center-target/2)/extra)):.5;};
 return {focusX:view.focusX??focus('x',size.width,frame.w),focusY:view.focusY??focus('y',size.height,frame.h),zoom};
}
export function coverView(frame,size,view={}){
 const {focusX:x,focusY:y,zoom}=coverSettings(frame,size,view);
 if(![x,y,zoom].every(Number.isFinite)||x<0||x>1||y<0||y>1||zoom<1||zoom>3)throw Error('取景范围无效');
 const scale=Math.max(frame.w/size.width,frame.h/size.height)*zoom;
 return {x:(frame.w-size.width*scale)*x,y:(frame.h-size.height*scale)*y,scale,rotation:0,flipX:false,flipY:false};
}
