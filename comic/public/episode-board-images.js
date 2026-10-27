const imageTypes=['image/png','image/jpeg','image/webp'];
const editable=target=>target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
export function mountBoardImageInput({body,isActive,snapshot,isCurrent,upload,onApply,toast}){
 let busy=false;
 function status(message){const el=body.querySelector('[data-board-upload-status]');if(el)el.textContent=message;}
 function sync(){for(const el of body.querySelectorAll('[data-board-upload],[data-board-paste]'))el.disabled=busy;}
 async function receive(file,target=snapshot()){
  if(busy)return;
  if(!file||!imageTypes.includes(file.type))return toast('请选择 PNG、JPEG 或 WebP 图片',true);
  if(!file.size||file.size>60*1024*1024)return toast('图片为空或超过60MB',true);
  busy=true;sync();status('正在保存图片…');
  try{const asset=await upload(file,target);if(!isCurrent(target)){toast('图片已保存；画板已切换，请返回原画板重新选择',true);return;}onApply(asset,target);toast('已设置'+(target.kind==='cover'?'封面':'尾图')+'图片，原图完整保留');}
  catch(error){status(error.message);toast(error.message,true);}
  finally{busy=false;sync();}
 }
 body.addEventListener('click',async event=>{
  if(!isActive()||busy)return;
  if(event.target.closest('[data-board-upload]')){const target=snapshot(),input=document.createElement('input');input.type='file';input.accept=imageTypes.join(',');input.onchange=()=>{if(input.files[0])void receive(input.files[0],target);};input.click();}
  if(event.target.closest('[data-board-paste]')){const target=snapshot();try{if(!navigator.clipboard?.read)throw Error('请选中画板后按 Ctrl+V 粘贴图片');const items=await navigator.clipboard.read();for(const item of items){const type=item.types.find(type=>imageTypes.includes(type));if(type){await receive(await item.getType(type),target);return;}}throw Error('剪贴板里没有图片，请复制图片后按 Ctrl+V');}catch(error){const message=error.name==='NotAllowedError'?'未获准读取剪贴板，请选中画板后按 Ctrl+V':error.message;status(message);toast(message,true);}}
 });
 document.addEventListener('paste',event=>{
  if(!isActive()||editable(event.target)||document.querySelector('dialog[open]'))return;
  const file=[...(event.clipboardData?.items||[])].find(item=>item.kind==='file'&&imageTypes.includes(item.type))?.getAsFile();
  if(file){event.preventDefault();void receive(file);}
 });
 return {sync};
}
