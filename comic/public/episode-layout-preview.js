import {episodePreviewSource,acceptsPreviewPacket,previewRows} from './episode-preview-model.js';
import {layoutLongStrip} from './model.js';
import {paintSceneRegion} from './render.js';
import {storyFadeSteps} from './story-fade-curve.js';
const NS='http://www.w3.org/2000/svg',svgNode=(tag,attrs={},text)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
const safeColor=value=>/^#[\da-f]{6}$/i.test(value||'')?value:'#ffffff';
export function mountEpisodeLayoutPreview({container,project,episode,origin,scriptId,geometry:providedGeometry}){
 const source=providedGeometry?{kind:'latest',episode:Number(episode),scriptId,geometry:providedGeometry}:episodePreviewSource(project,episode,scriptId);let disposed=false,scale=1,fitMode='width',size={width:1280,height:1},observer,resize,helper,timer,deadline;
 container.className='episode-layout-preview';
 container.innerHTML='<div class="episode-preview-heading"><div><h3>第'+source.episode+'话 · 整话预览</h3><p data-preview-summary role="status"></p></div><div class="episode-preview-tools"><button data-fit-width>适合宽度</button><button data-fit-all>整话总览</button><button data-zoom-out aria-label="缩小整话预览">−</button><span data-scale>100%</span><button data-zoom-in aria-label="放大整话预览">＋</button></div></div><p class="episode-preview-help">普通滚轮上下浏览整话 · Ctrl＋滚轮缩放 · 预览不会修改工程或启动生图</p><div class="episode-preview-viewport" tabindex="0" aria-label="当前话整话预览，滚轮上下浏览"><div class="episode-preview-content"></div></div>';
 const summary=container.querySelector('[data-preview-summary]'),viewport=container.querySelector('.episode-preview-viewport'),content=container.querySelector('.episode-preview-content'),percent=container.querySelector('[data-scale]');
 const css=document.createElement('style');css.textContent='.episode-layout-preview{margin:18px 0 24px;border:1px solid #49647a;border-radius:10px;background:#182c3c;overflow:hidden}.episode-preview-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 16px}.episode-preview-heading h3{font-size:17px;margin:0 0 6px}.episode-preview-heading p{font-size:12px;color:#c1d3df;margin:0;max-width:680px}.episode-preview-tools{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.episode-preview-tools button{padding:6px 10px}.episode-preview-tools span{min-width:45px;text-align:center;font-size:12px}.episode-preview-help{font-size:12px;margin:0;padding:0 16px 12px;color:#adc5d8}.episode-preview-viewport{height:62vh;min-height:340px;max-height:760px;overflow:auto;overscroll-behavior:contain;background:#101b26;padding:20px;outline-offset:-3px;scrollbar-gutter:stable}.episode-preview-content{position:relative;margin:0 auto;flex-shrink:0;background:#fff;box-shadow:0 3px 16px #0006}.episode-preview-content>svg{display:block;width:100%;height:100%}.episode-preview-tile{position:absolute;left:0;width:100%;overflow:hidden;background:#e8ecee}.episode-preview-tile canvas{display:block;width:100%;height:100%}.episode-preview-empty{padding:32px 20px;color:#bcd0df}.episode-layout-preview [hidden]{display:none!important}@media(max-width:700px){.episode-preview-viewport{padding:10px;min-height:300px;height:58vh}.episode-preview-heading{padding:12px}.episode-preview-tools{gap:4px}}';container.append(css);
 function setScale(value,anchor){
  const old=scale;scale=Math.max(.005,Math.min(2,value));
  const at=anchor||{x:viewport.clientWidth/2,y:viewport.clientHeight/2},x=(viewport.scrollLeft+at.x)/old,y=(viewport.scrollTop+at.y)/old;
  content.style.width=size.width*scale+'px';content.style.height=size.height*scale+'px';percent.textContent=(scale<.1?(scale*100).toFixed(1):Math.round(scale*100))+'%';
  viewport.scrollLeft=x*scale-at.x;viewport.scrollTop=y*scale-at.y;
 }
 function fit(){setScale(fitMode==='all'?Math.min((viewport.clientWidth-48)/size.width,(viewport.clientHeight-48)/size.height):(viewport.clientWidth-48)/size.width);}
 container.querySelector('[data-fit-width]').onclick=()=>{fitMode='width';fit();};container.querySelector('[data-fit-all]').onclick=()=>{fitMode='all';fit();viewport.scrollTop=0;};
 container.querySelector('[data-zoom-out]').onclick=()=>{fitMode=null;setScale(scale/1.2);};container.querySelector('[data-zoom-in]').onclick=()=>{fitMode=null;setScale(scale*1.2);};
 viewport.addEventListener('wheel',event=>{if(!event.ctrlKey)return;event.preventDefault();fitMode=null;const box=viewport.getBoundingClientRect();setScale(scale*Math.exp(-event.deltaY*.002),{x:event.clientX-box.left,y:event.clientY-box.top});},{passive:false});
 resize=new ResizeObserver(()=>{if(fitMode&&size.height>1)fit();});resize.observe(viewport);
 function geometryPreview(geometry,rows,{exact=false}={}){
  if(disposed)return;content.classList.remove('episode-preview-empty');viewport.style.minHeight='';viewport.style.height='';size={width:geometry.canvas.width,height:geometry.canvas.height};const savedTop=viewport.scrollTop;
  for(const button of container.querySelectorAll('.episode-preview-tools button'))button.disabled=false;
  const svg=svgNode('svg',{viewBox:`0 0 ${size.width} ${size.height}`,role:'img','aria-label':'第'+source.episode+'话连续版式，共'+geometry.panels.length+'格'}),defs=svgNode('defs');svg.append(defs);
  svg.append(svgNode('rect',{width:size.width,height:size.height,fill:'#ffffff'}));
  for(const [i,bg]of (geometry.backgrounds||[]).entries()){
   let fill=safeColor(bg.color);if(bg.mode==='linear'){const id='episode-background-'+i,gradient=svgNode('linearGradient',{id,x1:0,y1:0,x2:0,y2:1});if(bg.easing==='smoothstep'){const a=[1,3,5].map(j=>parseInt(fill.slice(j,j+2),16)),end=safeColor(bg.endColor),b=[1,3,5].map(j=>parseInt(end.slice(j,j+2),16));for(const v of storyFadeSteps){const color='#'+a.map((n,j)=>Math.round(n+(b[j]-n)*v.amount).toString(16).padStart(2,'0')).join('');gradient.append(svgNode('stop',{offset:v.offset,'stop-color':color}));}}else gradient.append(svgNode('stop',{offset:'0%','stop-color':fill}),svgNode('stop',{offset:'100%','stop-color':safeColor(bg.endColor)}));defs.append(gradient);fill='url(#'+id+')';}
   svg.append(svgNode('rect',{x:bg.x,y:bg.y,width:bg.w,height:bg.h,fill}));
  }
  const byKey=new Map(rows.map(row=>[row.key,row]));
  for(const [i,p]of geometry.panels.entries()){
   const row=byKey.get(p.key)||{},color=p.role==='main'?'#245c49':'#5c7f8d';
   svg.append(svgNode('rect',{x:p.x,y:p.y,width:p.w,height:p.h,fill:p.role==='main'?'#f3f6eb':'#f8f8f0',stroke:color,'stroke-width':Math.max(2,p.border||4)}));
   const clipId='episode-panel-'+i,clip=svgNode('clipPath',{id:clipId});clip.append(svgNode('rect',{x:p.x+10,y:p.y+10,width:Math.max(1,p.w-20),height:Math.max(1,p.h-20)}));defs.append(clip);
   const group=svgNode('g',{'clip-path':'url(#'+clipId+')','font-family':'Microsoft YaHei, sans-serif','font-size':26,fill:'#23433b'}),label=`${i+1} · ${p.role==='main'?'主格':'副格'} · ${p.key}`;
   group.append(svgNode('text',{x:p.x+22,y:p.y+48,'font-weight':600},label),svgNode('text',{x:p.x+22,y:p.y+91,'font-size':23},(row.shotSize?row.shotSize+' · ':'')+Math.round(p.w)+' × '+Math.round(p.h)+' · 尚未填入成图'));
   const text=String(row.description||''),chars=Math.max(5,Math.floor((p.w-48)/27));for(let line=0;line<6&&line*chars<text.length;line++)group.append(svgNode('text',{x:p.x+22,y:p.y+145+line*40,fill:'#60736c'},text.slice(line*chars,(line+1)*chars)));
   svg.append(group);
  }
  content.replaceChildren(svg);fit();viewport.scrollTop=savedTop;
  const hasScreenArt=project.pages.some(page=>page.panels.some(p=>p.visible!==false&&p.imageAssetId&&p.productionSegment&&project.productionPackage?.episodes.find(e=>Number(e.episode)===source.episode)?.segments.some(s=>s.id===p.productionSegment)));
  summary.textContent=(source.kind==='frozen'?'当前工程已接回的版式':'Codex排版结果 · 接回前预览')+' · '+geometry.panels.length+'格'+(exact?'，底色与排版结果一致。':'，底色暂用白色。')+(hasScreenArt?' 已有整屏图片；确认裁格并接回带图工程后显示格内图片。':' 目前显示框位和分镜内容，尚未生成图片。');
 }
 async function artworkPreview(){
  const layout=layoutLongStrip(project.pages);size={width:layout.width,height:layout.height};content.replaceChildren();fit();let errors=0;
  summary.textContent='当前已接回工程的整话画面 · 图片、可编辑文字及图层顺序按工程显示。';
  observer=new IntersectionObserver(entries=>{for(const entry of entries){const tile=entry.target;if(entry.isIntersecting)void paint(tile);else if(!tile.painting&&tile.canvas){tile.canvas.width=tile.canvas.height=1;tile.replaceChildren();tile.canvas=null;}}},{root:viewport,rootMargin:'600px 0px'});
  for(let y=0;y<size.height;y+=2048){const tile=document.createElement('div');tile.className='episode-preview-tile';tile.previewY=y;tile.previewHeight=Math.min(2048,size.height-y);tile.style.top=100*y/size.height+'%';tile.style.height=100*tile.previewHeight/size.height+'%';content.append(tile);observer.observe(tile);}
  async function paint(tile){
   if(disposed||tile.painting||tile.canvas)return;tile.painting=true;const canvas=document.createElement('canvas'),resolution=.6;canvas.width=Math.ceil(size.width*resolution);canvas.height=Math.ceil(tile.previewHeight*resolution);
   try{const ctx=canvas.getContext('2d');ctx.scale(resolution,resolution);ctx.translate(0,-tile.previewY);await paintSceneRegion(ctx,project,{layout,region:{x:0,y:tile.previewY,w:size.width,h:tile.previewHeight},renderScale:resolution});if(disposed){canvas.width=canvas.height=1;return;}tile.canvas=canvas;tile.replaceChildren(canvas);}
   catch(error){canvas.width=canvas.height=1;errors++;tile.textContent='此段预览读取失败，可重新打开重试。';summary.textContent='有'+errors+'段图片未能读取：'+error.message+'。原图和工程未改动。';}
   finally{tile.painting=false;}
  }
 }
 function stopHelper(){clearInterval(timer);clearTimeout(deadline);helper?.remove();window.removeEventListener('message',onPacket);}
 function onPacket(event){
  if(disposed||event.origin!==origin||event.source!==helper?.contentWindow||event.data?.type!=='comic-layout:preview-packet'||event.data.requestId!==requestId)return;
  const data=event.data;if(!acceptsPreviewPacket(source,project,data.script,data.packet)){if(source.kind==='frozen')summary.textContent='当前工程已接回的'+source.geometry.panels.length+'格版式。排版库中的稿件已有变化，预览保留本工程框位；底色暂用白色。';stopHelper();return;}
  geometryPreview(source.kind==='frozen'?source.geometry:data.packet,data.script.shots,{exact:true});stopHelper();
 }
 const requestId=crypto.randomUUID();
 if(source.kind==='artwork')void artworkPreview();
 else{
  if(source.geometry)geometryPreview(source.geometry,previewRows(project,source.episode),{exact:!!providedGeometry||!!source.binding?.geometry});else{summary.textContent='本话排版完成后会在这里显示整话预览。';content.classList.add('episode-preview-empty');content.style.background='#162b3a';content.textContent='尚无本话已完成的排版预览。';viewport.style.minHeight='120px';viewport.style.height='160px';for(const button of container.querySelectorAll('.episode-preview-tools button'))button.disabled=true;}
  if(source.scriptId&&origin&&!providedGeometry){
   helper=document.createElement('iframe');helper.hidden=true;helper.title='读取当前话排版预览';helper.src=origin+'/?'+new URLSearchParams({integrated:'1',readonly:'1',view:'preview',id:source.scriptId});container.append(helper);window.addEventListener('message',onPacket);
   const request=()=>helper?.contentWindow?.postMessage({type:'comic-layout:request-preview',requestId,scriptId:source.scriptId},origin);helper.onload=request;timer=setInterval(request,400);
   deadline=setTimeout(()=>{if(source.kind!=='frozen')summary.textContent='暂未读到本话已完成排版。任务完成后返回此页刷新预览；不会重新启动排版。';stopHelper();},15000);
  }
 }
 return {destroy(){disposed=true;stopHelper();observer?.disconnect();resize?.disconnect();for(const tile of content.querySelectorAll('canvas'))tile.width=tile.height=1;}};
}
