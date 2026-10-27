// Render and upload bounded slices; only the server's finished PNG is downloaded.
export function downloadCompletePng(url,name){
 const link=document.createElement('a');link.href=url;link.download=name;link.click();
}
async function base64(blob){
 const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
 return btoa(binary);
}
export async function exportCompleteStrip({project,layout,episode=null,renderSegment,onProgress=()=>{},request=globalThis.fetch,downloadURL=downloadCompletePng,segmentHeight=4096}){
 if(!project?.id||!Number.isInteger(project.revision))throw Error('请先保存工程，再导出完整长图');
 if(!layout.pages.length||layout.height<1)throw Error('没有可导出的页面');
 if(!Number.isSafeInteger(segmentHeight)||segmentHeight<1||segmentHeight>8192)throw Error('导出处理高度无效');
 async function post(url,input){
  const response=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  let value;try{value=await response.json();}catch{throw Error('完整长图导出服务返回异常，请重试导出');}
  if(!response.ok)throw Error(value.error||'完整长图导出失败（HTTP '+response.status+'）');
  return value;
 }
 const session=await post('/api/strip-exports',{projectId:project.id,expectedRevision:project.revision,episode});
 if(!/^export_[0-9a-f-]{36}$/.test(session.id)||session.width!==layout.width||session.height!==layout.height)throw Error('导出尺寸与已保存工程不一致，请重新保存后导出');
 const route='/api/strip-exports/'+session.id;let count=0;
 for(let y=0;y<layout.height;y+=segmentHeight){
  const height=Math.min(segmentHeight,layout.height-y);
  onProgress('正在合成完整长图 '+Math.floor(y/layout.height*100)+'%');
  const blob=await renderSegment({index:count,y,height});
  const receipt=await post(route+'/parts',{index:count,y,dataBase64:await base64(blob)});
  if(receipt.nextY!==y+height||receipt.received!==count+1)throw Error('完整长图接收进度异常，未下载不完整图片');
  count++;
 }
 onProgress('正在写入完整 PNG，请稍候');
 const result=await post(route+'/complete',{});
 if(result.files!==1||result.width!==layout.width||result.height!==layout.height||result.url!==route+'/download')throw Error('完整长图合并结果异常，未下载不完整图片');
 await downloadURL(result.url,project.title+'_整话.png');
 return {...result,parts:1,partsRendered:count};
}
