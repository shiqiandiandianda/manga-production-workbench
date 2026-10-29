/** Native pixels never change. Only the destination frame and its uniform view do. */
export function artworkFrame(shot){
 const a=shot.existingArtwork;if(!a)return null;
 if(![a.width,a.height].every(n=>Number.isFinite(n)&&n>0))throw Error('已有图片尺寸无效：'+shot.key);
 const p=shot.artworkLayout;if(!p)return a;
 if(p.version!==1||!['preserve','cover','contain','frame-to-artwork'].includes(p.fit)||!['fixed','rules'].includes(p.framePolicy))throw Error('已有图片取景约束无效：'+shot.key);
 if(p.fit==='preserve'&&p.framePolicy!=='fixed')throw Error('保留取景必须冻结当前框形');
 if(p.fit==='frame-to-artwork')return a;
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

/** Remove only unused rectangular frame area; retain the exact visible artwork viewport. */
export function tightenedArtworkView(frame,size){
 const t=frame?.imageTransform;if(!t||t.rotation||t.flipX||t.flipY||frame.locked||!Number.isFinite(t.scale)||t.scale<=0)return null;
 const expected=[[0,0],[1,0],[1,1],[0,1]];if(frame.points?.length!==4||frame.points.some((p,i)=>p.x!==expected[i][0]||p.y!==expected[i][1]))return null;
 const rim=Math.min(2,size.width/100,size.height/100);
 const left=Math.max(0,t.x+rim*t.scale),top=Math.max(0,t.y+rim*t.scale),right=Math.min(frame.w,t.x+(size.width-rim)*t.scale),bottom=Math.min(frame.h,t.y+(size.height-rim)*t.scale);
 if(right-left<2||bottom-top<2||Math.abs(left)<.01&&Math.abs(top)<.01&&Math.abs(right-frame.w)<.01&&Math.abs(bottom-frame.h)<.01)return null;
 return {left,top,w:right-left,h:bottom-top,imageTransform:{...structuredClone(t),x:t.x-left,y:t.y-top}};
}
