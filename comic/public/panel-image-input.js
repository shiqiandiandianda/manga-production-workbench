const types=['image/png','image/jpeg','image/webp'];
const editable=target=>target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
export function mountPanelImageInput({getTarget,isCurrent,upload,onApply,pasteLayer,canPasteLayer,toast}){
 let busy=false;
 const sync=()=>{for(const button of document.querySelectorAll('[data-action="upload-local-image"],[data-action="paste-local-image"]'))button.disabled=busy||button.dataset.imageLocked==='true';};
 async function receive(file,target=getTarget()){
  if(busy)return;if(!target)throw Error('请先选择要放入图片的格子');
  if(target.locked)throw Error('请先解锁画格和画板');
  if(!file||!types.includes(file.type))throw Error('请选择 PNG、JPEG 或 WebP 图片');
  if(!file.size||file.size>60*1024*1024)throw Error('图片为空或超过60MB');
  busy=true;sync();try{const result=await upload(file,target);if(!isCurrent(target)){toast('图片已存入原格子；当前选择保持不变');return;}await onApply(result);toast('图片已放入当前格子，原图保留在候选版本中');}finally{busy=false;sync();}
 }
 function choose(){const target=getTarget();if(!target)throw Error('请先选择格子');if(target.locked)throw Error('请先解锁画格和画板');const input=document.createElement('input');input.type='file';input.accept=types.join(',');input.onchange=()=>{if(input.files[0])void receive(input.files[0],target).catch(e=>toast(e.message,true));};input.click();}
 async function paste(){const target=getTarget();if(!target)throw Error('请先选择格子');if(!navigator.clipboard?.read)throw Error('请复制图片，选中格子后按 Ctrl+V');try{const items=await navigator.clipboard.read();for(const item of items){const type=item.types.find(t=>types.includes(t));if(type){await receive(await item.getType(type),target);return;}}throw Error('剪贴板里没有图片，请先复制图片');}catch(error){if(error.name==='NotAllowedError')throw Error('请选中格子后按 Ctrl+V 粘贴图片');throw error;}}
 document.addEventListener('paste',event=>{
  if(event.defaultPrevented||editable(event.target)||document.querySelector('dialog[open]')||!getTarget()&&!canPasteLayer())return;
  const file=[...(event.clipboardData?.items||[])].find(item=>item.kind==='file'&&types.includes(item.type))?.getAsFile()||[...(event.clipboardData?.files||[])].find(file=>types.includes(file.type));
  if(file&&getTarget()){event.preventDefault();void receive(file).catch(e=>toast(e.message,true));}
  else if(canPasteLayer()){event.preventDefault();pasteLayer();}
 });
 return {choose,paste,receive,sync};
}
