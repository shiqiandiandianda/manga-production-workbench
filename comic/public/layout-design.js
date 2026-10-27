/** Production layout v1. Pure validation; no invented coordinates or crop claims. */
const fail=message=>{throw Object.assign(Error('排版布局：'+message),{status:400});};
const require=(ok,message)=>{if(!ok)fail(message);};
const number=v=>typeof v==='number'&&Number.isFinite(v);
const rect=(r,w,h,label)=>require(r&&['x','y','w','h'].every(k=>number(r[k]))&&r.x>=0&&r.y>=0&&r.w>0&&r.h>0&&r.x+r.w<=w+1e-6&&r.y+r.h<=h+1e-6,label+'坐标越界或尺寸无效');
export function validateLayoutDesign(d,{board,boardSha}={}){
 require(d?.format==='comic-layout-design'&&d.version===1,'不支持的format/version');
 require(d.status==='ready','草案不能作为生产布局');
 require(Number.isInteger(d.episode)&&d.episode>=1&&d.episode<=9999&&typeof d.work==='string'&&d.work.trim(),'作品或话号无效');
 require(typeof d.layoutVersion==='string'&&d.layoutVersion.trim(),'缺少布局版本');
 require(/^[a-f0-9]{64}$/.test(d.source?.storyboardSha256||''),'缺少源分镜SHA-256');
 const name=d.source?.storyboardPath;require(typeof name==='string'&&name&&!/^[\\/]|:/.test(name)&&name.replaceAll('\\','/').split('/').every(p=>p&&!['.','..'].includes(p)),'源分镜必须使用安全相对路径');
 if(boardSha!==undefined)require(d.source.storyboardSha256===boardSha,'源分镜摘要不符');
 const profile=d.styleProfile,min=profile?.minimumAspectHOverW;
 require(profile?.allPanelsPortrait===true&&number(min)&&min>=1.05&&min<=4,'正文必须全部竖幅，比例底线至少1.05');
 const f=d.finalLayout,c=f?.canvas;
 require(f?.unit==='px'&&f.coordinateSpace==='episode-document'&&c?.width===1280&&number(c.height)&&c.height>0&&c.height<=1000000,'整话画布或坐标单位无效');
 require(Array.isArray(f.panels)&&f.panels.length>0&&f.panels.length<=1000,'画格数量无效');
 const keys=f.panels.map(p=>p.panelId),layers=new Set();require(keys.every(k=>typeof k==='string'&&k)&&new Set(keys).size===keys.length,'格ID缺失或重复');
 f.panels.forEach((p,i)=>{require(p.readingOrder===i+1&&['main','support'].includes(p.role),'阅读顺序或主副格无效');rect(p.rect,1280,c.height,p.panelId);require(p.rect.h/p.rect.w+1e-6>=min,p.panelId+'不是合规竖格');require(Number.isInteger(p.layerOrder)&&p.layerOrder>0&&!layers.has(p.layerOrder),'图层顺序无效或重复');layers.add(p.layerOrder);if(i)require(p.rect.y>f.panels[i-1].rect.y,'画格顶部必须随阅读递增');});
 const overlaps=f.overlaps||[];require(Array.isArray(overlaps),'叠格说明必须为数组');
 for(let i=0;i<f.panels.length;i++)for(let j=i+1;j<f.panels.length;j++){const a=f.panels[i],b=f.panels[j],r=a.rect,q=b.rect;if(Math.min(r.x+r.w,q.x+q.w)>Math.max(r.x,q.x)&&Math.min(r.y+r.h,q.y+q.h)>Math.max(r.y,q.y)){const note=overlaps.find(n=>n.from===a.panelId&&n.to===b.panelId);require(j===i+1&&note&&typeof note.reason==='string'&&note.reason.trim()&&typeof note.protectedContent==='string'&&note.protectedContent.trim()&&note.verificationStatus==='pending-artwork','相交画格需相邻且声明叠格目的、保护内容和待成图状态');}}
 if(board){require(d.work===board['作品']&&d.episode===board['话'],'与分镜作品或话号不一致');require(JSON.stringify(keys)===JSON.stringify(board['格']?.map(p=>p['格ID'])),'格ID、格数或顺序与源分镜不一致');f.panels.forEach((p,i)=>{if(board['格'][i]['主格']===true||String(board['格'][i]['画面备注']||'').includes('【主格】'))require(p.role==='main',p.panelId+'不能降低已定稿主格');});}
 require(Array.isArray(d.generationSegments)&&d.generationSegments.length,'缺少生成屏段');
 const covered=[],locals=new Set(),ids=new Set();
 for(const s of d.generationSegments){
  require(/^段\d{2,4}$/.test(s.localId||''),'屏段本地编号无效');require(s.segmentId===`E${String(d.episode).padStart(3,'0')}-S${String(Number(s.localId.slice(1))).padStart(3,'0')}`,'屏段全局ID与话号/本地编号不一致');require(!locals.has(s.localId)&&!ids.has(s.segmentId),'屏段ID重复');locals.add(s.localId);ids.add(s.segmentId);
  require(s.unit==='normalized'&&s.coordinateSpace==='planned-image','生成坐标必须为计划图像归一化坐标');const image=s.imagePlan;
  require(image&&['width','height'].every(k=>Number.isInteger(image[k])&&image[k]>=128&&image[k]<=16384)&&image.background==='white'&&image.overlap===false,'生成图像尺寸或白底策略无效');require(Array.isArray(s.panels)&&s.panels.length,'空屏段');
  s.panels.forEach((p,i)=>{require(keys.includes(p.panelId),'屏段引用未知格ID');rect(p.rect,1,1,p.panelId);const r=p.rect,ratio=r.h*image.height/(r.w*image.width),target=f.panels[keys.indexOf(p.panelId)].rect;require(ratio+1e-6>=min,p.panelId+'生成视图被压成横格');require(Math.abs(ratio/(target.h/target.w)-1)<=.03,p.panelId+'生成框与最终框比例相差超过3%');if(i)require(r.y>s.panels[i-1].rect.y,'屏段阅读位置倒序');for(const q of s.panels.slice(0,i)){const a=q.rect,dx=Math.max(r.x-a.x-a.w,a.x-r.x-r.w),dy=Math.max(r.y-a.y-a.h,a.y-r.y-r.h);require(Math.max(dx,dy)>=.01-1e-6,p.panelId+'生成框重叠或缺少可切白缝');}covered.push(p.panelId);});
 }
 require(JSON.stringify(covered)===JSON.stringify(keys),'屏段覆盖漏格、重复或改变顺序');return d;
}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function layoutDesignSvg(d,segmentId){
 const s=d.generationSegments.find(s=>s.segmentId===segmentId),c=s?s.imagePlan:d.finalLayout.canvas;
 const items=s?s.panels:[...d.finalLayout.panels].sort((a,b)=>a.layerOrder-b.layerOrder);
 let svg=`<svg data-layout-design-preview="true" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block" viewBox="0 0 ${c.width} ${c.height}" role="img"><title>排版设计框位</title><rect width="100%" height="100%" fill="white"/>`;
 for(const p of items){const r=s?Object.fromEntries(Object.entries(p.rect).map(([k,v])=>[k,v*(['x','w'].includes(k)?c.width:c.height)])):p.rect,main=d.finalLayout.panels.find(q=>q.panelId===p.panelId)?.role==='main';svg+=`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${main?'#d9e5dc':'#e9eef3'}" stroke="#28483f" stroke-width="3"/><text x="${r.x+18}" y="${r.y+48}" font-family="Microsoft YaHei,sans-serif" font-size="28">${esc(p.panelId)} ${main?'主格':'副格'}</text>`;}
 return svg+'</svg>';
}
