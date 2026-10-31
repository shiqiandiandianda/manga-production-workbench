import {comicDeliveryLayouts,deliveryDimensions} from './comic-delivery-layout.js';
import {validateDeliveryCuts} from './comic-delivery-cuts.js';
import {renderStripSegment,pngBlob,clearImageCache,loadImage} from './render.js';
async function encode(blob){const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);}
export async function prepareComicDelivery({project,assets=[],episode,onProgress=()=>{},request=globalThis.fetch,canvasFactory,imageLoader=loadImage,signal}={}){
 if(!project?.id||!Number.isInteger(project.revision))throw Error('请先保存工程');
 if(typeof document!=='undefined')await document.fonts?.ready;clearImageCache();
 const plan=comicDeliveryLayouts(project,episode,assets),dimensions=deliveryDimensions(plan),check=()=>{if(signal?.aborted)throw Error('已取消导出');};
 async function post(url,input){check();const response=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal});let value;try{value=await response.json();}catch{throw Error('交付导出服务返回异常');}if(!response.ok)throw Error(value.error||'交付导出失败');return value;}
 let session;
 try{
  session=await post('/api/comic-delivery-exports',{projectId:project.id,expectedRevision:project.revision,episode,templateRevision:project.episodeBoards?.templateRevision});
  if(!/^delivery_[a-f0-9-]{36}$/.test(session.id)||Object.keys(session.groups).length!==Object.keys(dimensions).length||Object.entries(dimensions).some(([kind,g])=>session.groups[kind]?.width!==g.width||session.groups[kind]?.height!==g.height))throw Error('导出尺寸与已保存工程不一致，请重新打开导出');
  const route='/api/comic-delivery-exports/'+session.id,total=Object.values(dimensions).reduce((n,g)=>n+g.height,0);let completed=0;
  for(const [group,layout]of Object.entries(plan.groups)){let index=0;for(let y=0;y<layout.height;y+=4096){check();const height=Math.min(4096,layout.height-y);onProgress('正在准备'+({body:'正文',cover:'封面',tail:'尾图'}[group])+' '+Math.floor(completed/total*100)+'%');const canvas=await renderStripSegment(layout,{y,height},{project,canvasFactory,imageLoader});try{const receipt=await post(route+'/parts',{group,index,y,dataBase64:await encode(await pngBlob(canvas))});if(receipt.nextY!==y+height||receipt.received!==index+1)throw Error('图片接收不完整，已停止导出');}finally{canvas.width=1;canvas.height=1;}index++;completed+=height;}}
  onProgress('正在识别正文的大缝隙…');const analysis=await post(route+'/analyze',{});check();validateDeliveryCuts(plan.groups.body.height,analysis.cuts);
  return {session,plan,analysis,async complete(cuts,reviewed=false){validateDeliveryCuts(plan.groups.body.height,cuts);onProgress('正在生成封面、正文 3 张和尾图…');const result=await post(route+'/complete',{cuts,reviewed});if(result.files.filter(f=>f.kind==='body').length!==3||result.url!==route+'/download')throw Error('交付文件数量不正确，未下载不完整结果');return result;},async preview(y){const layout=plan.groups.body,gap=analysis.gaps.find(g=>y>=g.start&&y<=g.end),height=Math.min(layout.height,2048,Math.max(640,gap?gap.end-gap.start+400:640)),start=Math.max(0,Math.min(layout.height-height,Math.round(y-height/2))),canvas=await renderStripSegment(layout,{y:start,height},{project,canvasFactory,imageLoader});try{const c=canvas.getContext('2d');c.setTransform(1,0,0,1,0,0);c.fillStyle='#ff3a47';const lineWidth=Math.max(3,Math.ceil(height/260*2));c.fillRect(0,y-start-Math.floor(lineWidth/2),layout.width,lineWidth);return {blob:await pngBlob(canvas),start,end:start+height};}finally{canvas.width=1;canvas.height=1;}},async dispose(){try{await request(route,{method:'DELETE'});}catch{}}};
 }catch(error){if(session?.id)try{await request('/api/comic-delivery-exports/'+session.id,{method:'DELETE'});}catch{}throw error;}
}
