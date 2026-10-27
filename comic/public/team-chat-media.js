const imageTypes=new Set(['image/png','image/jpeg','image/webp','image/gif']);
export const previewableImage=file=>imageTypes.has(String(file?.type||'').toLowerCase());
/** Use clipboard bytes only; never fetch image URLs from copied HTML. */
export function clipboardImages(clipboard,now=new Date()){
 const list=[...(clipboard?.items||[])].filter(item=>item.kind==='file'&&String(item.type).startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
 const files=list.length?list:[...(clipboard?.files||[])].filter(file=>String(file.type).startsWith('image/'));
 return files.map((file,index)=>{
  const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'})[file.type]||'img';
  const stamp=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0'),'_',String(now.getHours()).padStart(2,'0'),String(now.getMinutes()).padStart(2,'0'),String(now.getSeconds()).padStart(2,'0')].join('');
  return new File([file],'粘贴图片_'+stamp+'_'+(index+1)+'.'+ext,{type:file.type,lastModified:now.getTime()});
 });
}
