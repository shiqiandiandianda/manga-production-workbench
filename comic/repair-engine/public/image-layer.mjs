export function imagePlacement(width,height,pageWidth,pageHeight,center){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40000000||width>16384||height>16384)throw new Error('图层图片最多支持 4000 万像素，单边不超过 16384 px');
  const scale=Math.min(1,pageWidth/width,pageHeight/height);
  return {scale,x:Math.round(Math.max(0,Math.min(pageWidth-width*scale,center.x-width*scale/2))),y:Math.round(Math.max(0,Math.min(pageHeight-height*scale,center.y-height*scale/2)))};
}
export async function decodeLayerFile(file){
  if(!file||!(/^image\/(png|jpeg|webp)$/.test(file.type)||(!file.type&&/\.(png|jpe?g|webp)$/i.test(file.name))))throw new Error('请选择 PNG、JPG 或 WebP 图片');
  if(file.size>48*1024*1024)throw new Error('图层图片不能超过 48 MB');
  const url=URL.createObjectURL(file);
  try{const image=new Image();image.src=url;await image.decode();return image;}catch{throw new Error('图片无法读取，请检查文件是否完整');}finally{URL.revokeObjectURL(url);}
}
