// Cuts use original coordinates so repair tasks retain their source positions.
export function normalizePageGaps(gaps=[],height){
  if(!Array.isArray(gaps)||gaps.length>100)throw new Error('最多支持 100 处漫画间隔');
  const result=gaps.map(item=>{
    if(!item||!Number.isInteger(item.y)||item.y<1||item.y>=height)throw new Error('裁断位置必须在图片顶部和底部之间');
    if(!Number.isInteger(item.gap)||item.gap<1||item.gap>10000)throw new Error('间隔应为 1–10000 px 的整数');
    return {id:String(item.id||'gap-'+item.y).slice(0,80),y:item.y,gap:item.gap};
  }).sort((a,b)=>a.y-b.y);
  if(result.some((item,i)=>i&&item.y===result[i-1].y))throw new Error('同一裁断位置只能设置一处间隔');
  if(height+result.reduce((sum,item)=>sum+item.gap,0)>1000000)throw new Error('增加间隔后的图片高度不能超过 100 万 px');
  return result;
}
export function pageSegments(height,gaps=[]){
  const result=[];let start=0,offset=0;
  for(const item of gaps){result.push({start,end:item.y,offset});start=item.y;offset+=item.gap;}
  result.push({start,end:height,offset});return result;
}
export function pageHeight(height,gaps=[]){return height+gaps.reduce((sum,item)=>sum+item.gap,0);}
export function sourceToDisplay(y,gaps=[]){return y+gaps.filter(item=>item.y<=y).reduce((sum,item)=>sum+item.gap,0);}
export function displayToSource(y,gaps=[]){
  let offset=0;
  for(const item of gaps){const start=item.y+offset;if(y<start)break;if(y<start+item.gap)return {y:item.y,inGap:true};offset+=item.gap;}
  return {y:y-offset,inGap:false};
}
