const fail=message=>{throw Object.assign(Error(message),{status:409});};
/** Compatibility checks only. Artistic decisions belong to the assistant. */
export function validateAssistantGeometry(geometry,episode,sourceShots=[]){
 const g=geometry,ids=episode.panelRecords.map(r=>r.id),panels=g?.panels;
 if(g?.canvas?.width!==1280||!Number.isSafeInteger(g.canvas.height)||g.canvas.height<20||g.canvas.height>2000000||!Array.isArray(panels)||JSON.stringify(panels.map(p=>p.key))!==JSON.stringify(ids))fail('助手预览与本话源格不一致，请在排版助手核对本话');
 for(const p of panels)if(![p.x,p.y,p.w,p.h].every(Number.isFinite)||p.x<0||p.y<0||p.w<20||p.h<20||p.x+p.w>1280.01||p.y+p.h>g.canvas.height+.01||p.shape&&p.shape!=='rectangle'||p.border!==undefined&&(!Number.isFinite(p.border)||p.border<0||p.border>80)||p.feather!==undefined&&(!Number.isFinite(p.feather)||p.feather<0||p.feather>10000))fail('助手画格参数无效：'+p.key);
 if(g.generator?.mode==='native-style-rules'&&(g.generator.styleBookVersion==='dazhou-native-v11'||g.nativeUserConstraints?.maximumHOverW!==undefined)){
  const c=g.nativeUserConstraints;
  if(c?.minimumHOverW!==1||c.maximumHOverW!==16/9||c.maximumHeightNumerator!==16||c.maximumHeightDenominator!==9||c.mainFullWidth!==true||c.mainX!==0)fail('助手新格尺寸约束缺失或改变');
  const shots=new Map(sourceShots.map(s=>[s.key,s]));
  for(const p of panels){
   const art=shots.get(p.key)?.existingArtwork;
   if(art){if(![art.width,art.height].every(v=>Number.isFinite(v)&&v>0)||Math.abs(p.h-p.w*art.height/art.width)>1.01)fail('助手必须保留已有图真实比例：'+p.key);}
   else if(!Number.isSafeInteger(p.w)||!Number.isSafeInteger(p.h)||p.h<p.w||p.h>Math.floor(p.w*16/9))fail('助手新格须宽≤高≤floor(宽×16/9)：'+p.key);
   if(p.role==='main'&&(p.x!==0||p.w!==1280))fail('助手主格须x=0且铺满1280：'+p.key);
  }
 }
 for(const b of g.backgrounds||[])if(![b.x,b.y,b.w,b.h].every(Number.isFinite)||b.x<0||b.y<0||b.w<1||b.h<1||b.x+b.w>1280.01||b.y+b.h>g.canvas.height+.01||!/^#[\da-f]{6}$/i.test(b.color)||b.endColor&&!/^#[\da-f]{6}$/i.test(b.endColor)||b.mode&&!['solid','linear'].includes(b.mode))fail('助手底色参数无效，请检查预览');
 return g;
}
