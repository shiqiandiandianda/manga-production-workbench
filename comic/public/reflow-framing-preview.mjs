import {ensureReflowZoom} from './reflow-image-zoom.mjs';
import {coverView} from './artwork-framing.mjs';
import {paintSceneRegion} from './render.js';
import {assetUrl} from './asset-url.js';
import {bubbleLayout} from './lettering.js';

/** The editor's real image and lettering painters, with no saved-project mutations. */
export async function showReflowFramingPreview(data,{onApply,onCancel=()=>{}}){
 const dialog=document.createElement('dialog');dialog.id='reflow-framing-preview';dialog.setAttribute('aria-label','成图重排取景预览');
 dialog.style.cssText='position:fixed;inset:20px;margin:auto;width:min(1040px,94vw);height:90vh;max-height:90vh;padding:18px;background:#122230;color:#deebf7;border:1px solid #527999;border-radius:12px;z-index:10020;box-sizing:border-box;overflow:auto';
 const header=document.createElement('header');header.style.cssText='position:sticky;top:-18px;background:#122230;padding:12px 0;z-index:2';
 const title=document.createElement('strong');title.textContent='成图重排 · 实际图片与对白预览';header.append(title);
 const note=document.createElement('p');note.textContent='先按排版规则确定框位，再等比缩放取景。原图完整保留；接回后仍可用图片工具调整。图片按目标框等比铺满；接回前核对关键人物、动作、道具和文字。已有手动取景保留。';const decisions=data.backgroundDecisions||[],pending=decisions.filter(d=>d.status==='pending').length,preconfigured=decisions.filter(d=>['script-preconfigured','reference-preconfigured'].includes(d.status)).length;note.textContent+=' 底图按剧情段落判断并保持同场景连贯；渐变避开画格、文字、气泡及泡尾。';if(pending)note.textContent+=' '+pending+'段主色待确认，暂用中性底。';if(preconfigured)note.textContent+=' '+preconfigured+'段为脚本或同场景参考预配，并非目标成图实测。';note.style.cssText='font-size:13px;line-height:1.6';header.append(note);
 const apply=document.createElement('button'),cancel=document.createElement('button'),message=document.createElement('span');apply.textContent='确认取景，接回原画布';cancel.textContent='保留来源，暂不接回';for(const b of [apply,cancel])b.style.cssText='padding:10px 14px;margin:0 10px 8px 0;border-radius:6px;cursor:pointer';header.append(apply,cancel,message);dialog.append(header);
 const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px';dialog.append(grid);document.body.append(dialog);dialog.showModal();
 const views={},images=new Map(),project=structuredClone(data.project),page=project.pages[0];let closed=false;
 const imageLoader=key=>{if(!images.has(key))images.set(key,new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('原图或文字样式图片读取失败'));image.src=data.imageUrls[key]||assetUrl(key);}));return images.get(key);};
 const cleanup=()=>{closed=true;dialog.close();dialog.remove();};
 cancel.onclick=()=>{cleanup();onCancel();};dialog.oncancel=e=>{e.preventDefault();cancel.click();};
 apply.disabled=true;apply.onclick=async()=>{apply.disabled=true;cancel.disabled=true;try{await onApply({projectId:data.projectId,revision:data.revision,packetHash:data.packetHash,backgroundPolicyVersion:data.backgroundPolicyVersion,views:Object.entries(views).map(([key,v])=>({key,...v}))});cleanup();}catch(e){message.textContent=e.message;apply.disabled=false;cancel.disabled=false;}};
 try{
  await document.fonts?.ready;
  for(const row of data.frames){
   if(closed)return;
   const f=page.panels.find(f=>f.visible!==false&&f.panelSlice?.panelId===row.key),section=document.createElement('section'),label=document.createElement('strong'),canvas=document.createElement('canvas');
   label.textContent=row.key+' · '+(f.layoutRole==='main'?'主格':'副格')+' · '+Math.round(f.w)+'×'+Math.round(f.h);section.append(label);
   const native=document.createElement('div');native.textContent='原图 '+row.width+'×'+row.height+' · '+(row.fit==='frame-to-artwork'?'画框按原图收紧并等比铺满':row.fit==='cover'?'等比取景':row.fit==='preserve'?'保留当前手动取景':'原图等比容纳');native.style.cssText='font-size:12px;margin:6px 0;color:#a9c9df';section.append(native);
   const related=page.bubbles.filter(b=>b.visible!==false&&b.parentPanelId===f.id),measure=canvas.getContext('2d'),boxes=related.map(b=>{const l=bubbleLayout(measure,b),points=[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y+b.h}];for(const part of l.dialogueLayouts||[l])for(const line of part.lines){const glyphs=line.glyphs||[{x:line.x,y:line.y,width:line.width}],align=line.glyphs?'center':part.textAlign;for(const glyph of glyphs){const w=glyph.width||part.fontSize,dx=align==='center'?w/2:align==='right'?w:0;points.push({x:b.x+glyph.x-dx,y:b.y+glyph.y-part.fontSize*.65},{x:b.x+glyph.x-dx+w,y:b.y+glyph.y+part.fontSize*.65});}}if(l.tail?.tip)points.push({x:b.x+l.tail.tip.x,y:b.y+l.tail.tip.y});return {left:Math.min(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),right:Math.max(...points.map(p=>p.x)),bottom:Math.max(...points.map(p=>p.y))};});
   const left=Math.max(0,Math.min(f.x,...boxes.map(b=>b.left))-18),top=Math.max(0,Math.min(f.y,...boxes.map(b=>b.top))-18),right=Math.min(1280,Math.max(f.x+f.w,...boxes.map(b=>b.right))+18),bottom=Math.min(page.height,Math.max(f.y+f.h,...boxes.map(b=>b.bottom))+18),region={x:left,y:top,w:right-left,h:bottom-top},scale=Math.min(1,400/region.w,580/region.h);
   canvas.width=Math.ceil(region.w*scale);canvas.height=Math.ceil(region.h*scale);canvas.style.cssText='display:block;max-width:100%;height:auto;margin:8px auto;border:1px solid #314b60';section.append(canvas);grid.append(section);
   // Render one real frame plus its editable lettering; gradients retain the actual page coordinates.
   const local={...project,pages:[{...page,panels:[f],bubbles:related}],layerOrder:project.layerOrder};let painting=false,again=false;
   const paint=async()=>{if(painting){again=true;return;}painting=true;do{again=false;const c=canvas.getContext('2d');c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,canvas.width,canvas.height);c.scale(scale,scale);c.translate(-region.x,-region.y);await paintSceneRegion(c,local,{region,renderScale:scale,imageLoader});}while(again&&!closed);painting=false;};
   if(row.fit==='cover'){
    const originalTransform=structuredClone(f.imageTransform),initialView=row.view||{focusX:.5,focusY:.5,zoom:1};views[row.key]={...initialView};
    const controls=document.createElement('div');controls.style.cssText='font-size:12px;display:grid;gap:7px';section.append(controls);const sliders=[];
    for(const [key,text,min,max,step]of [['focusX','左右取景',0,1,.01],['focusY','上下取景',0,1,.01],['zoom','等比放大',1.08,3,.01]]){const wrap=document.createElement('label'),input=document.createElement('input');wrap.textContent=text+' ';input.type='range';input.min=min;input.max=max;input.step=step;input.value=views[row.key][key];input.style.width='70%';input.setAttribute('aria-label',row.key+' '+text);wrap.append(input);controls.append(wrap);sliders.push([key,input]);input.oninput=()=>{views[row.key][key]=Number(input.value);f.imageTransform=coverView(f,row,views[row.key]);ensureReflowZoom(f,row);void paint().catch(e=>message.textContent=e.message);};}
    const reset=document.createElement('button');reset.textContent='恢复本次初始取景';reset.onclick=()=>{views[row.key]={...initialView};for(const [key,input]of sliders)input.value=views[row.key][key];f.imageTransform=structuredClone(originalTransform);void paint();};controls.append(reset);
   }
   await paint();
  }
  if(!closed)apply.disabled=false;
 }catch(e){message.textContent=e.message;}
 return dialog;
}
