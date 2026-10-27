export function formatMemory(bytes){return Number.isFinite(bytes)&&bytes>=0?(bytes>=1024**3?(bytes/1024**3).toFixed(2)+' GB':Math.round(bytes/1024**2)+' MB'):'不可用';}
export function mountMemoryStatus(element,{fetcher=fetch,performanceInfo=performance,interval=5000}={}){
 if(!element)return ()=>{};
 let timer,stopped=false,pending=false,controller;
 async function refresh(){
  if(stopped||pending||document.hidden)return;
  pending=true;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),4000);
  try{
   const response=await fetcher('/api/runtime-memory',{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error('memory unavailable');const value=await response.json();
   if(!Number.isFinite(value.rssBytes)||value.rssBytes<0)throw Error('invalid memory');
   if(stopped)return;
   const heap=performanceInfo.memory?.usedJSHeapSize;
   element.textContent='内存 · 编辑服务 '+formatMemory(value.rssBytes)+' · 页面JS '+formatMemory(heap);
   element.title='每5秒刷新。编辑服务：当前漫画编辑后台进程的驻留内存（RSS），不含排版、模型等其他服务。页面JS：浏览器提供的JS堆近似值，不含全部图片、浏览器进程及显存，不能视作工具总内存。更新时间：'+new Date(value.sampledAt).toLocaleTimeString();
  }catch{if(!stopped){element.textContent='内存 · 暂不可用';element.title='内存读取失败，稍后自动重试；不显示过期数值。';}}
  finally{clearTimeout(timeout);pending=false;}
 }
 const resume=()=>{if(!document.hidden)refresh();};
 timer=setInterval(refresh,interval);document.addEventListener('visibilitychange',resume);refresh();
 return ()=>{stopped=true;clearInterval(timer);controller?.abort();document.removeEventListener('visibilitychange',resume);};
}
const stop=mountMemoryStatus(document.querySelector('#runtime-memory'));
window.addEventListener('pagehide',stop,{once:true});
