import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Download,Maximize2,Minus,Plus,X,Loader2} from 'lucide-react';
import type {ImageTiming} from '../lib/scenes';
import {ImageTimingText} from './image-timing';

export type PreviewImage={src:string;title:string;filename:string;timing?:ImageTiming|null};

export function ImagePreview({image,onClose}:{image:PreviewImage;onClose:()=>void}){
  const dialog=useRef<HTMLElement>(null),viewport=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null);
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null);
  const [natural,setNatural]=useState({width:0,height:0}),[area,setArea]=useState({width:0,height:0}),[mode,setMode]=useState<'fit'|'manual'>('fit'),[manual,setManual]=useState(1),[failed,setFailed]=useState(false),[dragging,setDragging]=useState(false);
  const ready=natural.width>0&&!failed;
  const fit=ready&&area.width>0?Math.max(.01,Math.min(1,(area.width-48)/natural.width,(area.height-48)/natural.height)):1;
  const scale=mode==='fit'?fit:manual,minScale=Math.min(fit,.1);
  const width=Math.round(natural.width*scale),height=Math.round(natural.height*scale);
  function zoom(factor:number){setManual(Math.min(4,Math.max(minScale,scale*factor)));setMode('manual');}
  function fitWindow(){setMode('fit');viewport.current?.scrollTo({left:0,top:0});}

  useEffect(()=>{const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';close.current?.focus();return()=>{document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
  useEffect(()=>{const element=viewport.current;if(!element)return;const observer=new ResizeObserver(()=>setArea({width:element.clientWidth,height:element.clientHeight}));observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{function keydown(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();onClose();return;}
    if(event.key==='Tab'){const buttons=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')||[]);const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}return;}
    if(!ready||event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='+'||event.key==='='){event.preventDefault();zoom(1.25);}
    if(event.key==='-'){event.preventDefault();zoom(.8);}
    if(event.key==='0'){event.preventDefault();fitWindow();}
  }document.addEventListener('keydown',keydown,true);return()=>document.removeEventListener('keydown',keydown,true);},[ready,scale,minScale,onClose]);

  return createPortal(<div className="image-lightbox" onClick={onClose}><section ref={dialog} className="image-preview" role="dialog" aria-modal="true" aria-label="图片放大预览" onClick={event=>event.stopPropagation()}>
    <div className="image-preview-header"><div className="image-preview-title"><strong>{image.title}</strong><span>{ready?natural.width+' × '+natural.height:'图片预览'}</span><ImageTimingText timing={image.timing?{label:'生成用时',durationMs:image.timing.durationMs,stages:image.timing.stages}:{label:'用时未记录'}}/></div><button ref={close} type="button" aria-label="关闭图片预览" onClick={onClose}><X size={20}/></button></div>
    <div className="image-preview-tools"><div><button type="button" aria-label="缩小图片" disabled={!ready||scale<=minScale} onClick={()=>zoom(.8)}><Minus size={17}/></button><output aria-label="图片缩放比例">{ready?Math.round(scale*100)+'%':'—'}</output><button type="button" aria-label="放大图片" disabled={!ready||scale>=4} onClick={()=>zoom(1.25)}><Plus size={17}/></button><button type="button" disabled={!ready} onClick={fitWindow}><Maximize2 size={15}/>适应窗口</button><button type="button" disabled={!ready} onClick={()=>{setManual(1);setMode('manual');}}>100% 原图</button></div><a href={image.src} download={image.filename}><Download size={15}/>下载 PNG</a></div>
    <div ref={viewport} className={'image-preview-viewport'+(dragging?' dragging':'')} aria-busy={!ready&&!failed}
      onPointerDown={event=>{const element=viewport.current;if(!element||!ready||event.button!==0||event.pointerType!=='mouse'||(element.scrollWidth<=element.clientWidth&&element.scrollHeight<=element.clientHeight))return;event.preventDefault();drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:element.scrollLeft,top:element.scrollTop};element.setPointerCapture(event.pointerId);setDragging(true);}}
      onPointerMove={event=>{const start=drag.current,element=viewport.current;if(start&&element&&start.id===event.pointerId){element.scrollLeft=start.left-(event.clientX-start.x);element.scrollTop=start.top-(event.clientY-start.y);}}}
      onPointerUp={()=>{drag.current=null;setDragging(false);}} onPointerCancel={()=>{drag.current=null;setDragging(false);}} onLostPointerCapture={()=>{drag.current=null;setDragging(false);}}>
      {!ready&&<div className="image-preview-message" role="status">{failed?<><strong>图片暂时无法加载</strong><span>请关闭预览后重试，并确认本地工作台仍在运行。</span></>:<><Loader2 size={30} className="spin"/><span>正在加载原图…</span></>}</div>}
      <div className="image-preview-stage" style={{width:Math.max(width+48,area.width),height:Math.max(height+48,area.height),visibility:ready?'visible':'hidden'}}><img src={image.src} alt={image.title} draggable={false} style={{width,height}} onLoad={event=>setNatural({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={()=>setFailed(true)}/></div>
    </div><p className="image-preview-hint">放大后可拖动或滚动查看细节 · + / − 缩放 · 0 适应窗口 · Esc 关闭</p>
  </section></div>,document.body);
}
