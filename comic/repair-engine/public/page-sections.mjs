export function sectionManifest(layers){return layers.filter(layer=>layer.type==='section').map(layer=>{
 const cuts=(layer.sourceCutouts||[]).map(item=>{const y=Math.max(item.y,layer.sourceStart),end=Math.min(item.y+item.height,layer.sourceStart+layer.sourceHeight);return{...item,y,height:end-y};}).filter(item=>item.height>0);
 return{id:layer.id,start:layer.sourceStart,end:layer.sourceStart+layer.sourceHeight,height:layer.height,visible:layer.visible!==false,...(cuts.length?{cutouts:cuts}:{})};
});}

export function normalizeSections(sections,height,width=32768){
 if(!Array.isArray(sections)||sections.length>200)throw new Error('漫画最多支持 200 个分段图层');
 const ids=new Set(),result=sections.map(item=>{
  if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id))throw new Error('漫画图层编号无效');ids.add(item.id);
  if(!Number.isInteger(item.start)||!Number.isInteger(item.end)||item.start<0||item.end<item.start||item.end>height)throw new Error('漫画图层图片范围无效');
  if(!Number.isInteger(item.height)||item.height<Math.max(1,item.end-item.start)||item.height>1000000)throw new Error('图层长度不能短于画面，最长为 100 万 px');
  const cuts=item.cutouts||[];if(!Array.isArray(cuts)||cuts.length>500)throw new Error('漫画剪切数量无效');
  for(const cut of cuts)if(!cut||!['x','y','width','height'].every(key=>Number.isInteger(cut[key]))||cut.x<0||cut.y<item.start||cut.width<1||cut.height<1||cut.x+cut.width>width||cut.y+cut.height>item.end)throw new Error('漫画剪切范围无效');
  return {id:item.id,start:item.start,end:item.end,height:item.height,visible:item.visible!==false,...(cuts.length?{cutouts:cuts}: {})};
 });
 if(result.filter(item=>item.visible).reduce((sum,item)=>sum+item.height,0)>1000000)throw new Error('漫画总长度不能超过 100 万 px');return result;
}
export function sectionSegments(sections){
 let outputStart=0;
 return sections.filter(item=>item.visible!==false).map(item=>{const result={...item,outputStart,offset:outputStart-item.start};outputStart+=item.height;return result;});
}
export function sectionsHeight(sections){return Math.max(1,sections.filter(item=>item.visible!==false).reduce((sum,item)=>sum+item.height,0));}
export function sectionAt(y,sections){return sectionSegments(sections).find(item=>y>=item.outputStart&&y<item.outputStart+item.height)||null;}
export function sectionDisplayPoint(y,sections){
 const item=sectionAt(y,sections);if(!item)return {y:0,inGap:true,sectionId:null};
 const offset=y-item.outputStart,content=item.end-item.start;
 return {y:item.start+Math.min(content,offset),inGap:offset>=content,sectionId:item.id};
}
export function sectionSourceY(y,sections){
 const segments=sectionSegments(sections),item=segments.find(item=>y>=item.start&&y<item.end)||segments.find(item=>y===item.end);
 return item?item.outputStart+y-item.start:y;
}
export function splitSection(layer,offset,ids){
 if(!Number.isInteger(offset)||offset<=0||offset>=layer.height)throw new Error('请在图层内部点击裁断');
 const content=Math.min(layer.sourceHeight,offset);
 return [{...layer,id:ids[0],sourceHeight:content,height:offset,locked:false},{...layer,id:ids[1],sourceStart:layer.sourceStart+content,sourceHeight:layer.sourceHeight-content,height:layer.height-offset,locked:false}];
}
