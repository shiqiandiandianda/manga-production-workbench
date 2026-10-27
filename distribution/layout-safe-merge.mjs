/** Conservative, dependency-free three-way text merge. Ambiguous overlaps stop. */
const normalize=value=>String(value).replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
export function edits(baseText,nextText){
 const a=normalize(baseText).split(/(?<=\n)/),b=normalize(nextText).split(/(?<=\n)/),out=[];
 function span(a0,a1,b0,b1,depth=0){
  while(a0<a1&&b0<b1&&a[a0]===b[b0]){a0++;b0++;}while(a0<a1&&b0<b1&&a[a1-1]===b[b1-1]){a1--;b1--;}
  if(a0===a1&&b0===b1)return;
  const am=new Map(),bm=new Map();for(let i=a0;i<a1;i++)am.set(a[i],am.has(a[i])?-1:i);for(let i=b0;i<b1;i++)bm.set(b[i],bm.has(b[i])?-1:i);
  const pairs=[];for(let i=a0;i<a1;i++)if(am.get(a[i])===i&&bm.get(a[i])>=0)pairs.push([i,bm.get(a[i])]);
  const tails=[],previous=[];for(let i=0;i<pairs.length;i++){let lo=0,hi=tails.length;while(lo<hi){const m=(lo+hi)>>1;if(pairs[tails[m]][1]<pairs[i][1])lo=m+1;else hi=m;}previous[i]=lo?tails[lo-1]:-1;tails[lo]=i;}
  const anchors=[];for(let i=tails.at(-1);i!==undefined&&i>=0;i=previous[i])anchors.push(pairs[i]);anchors.reverse();
  if(!anchors.length||depth>80){out.push({start:a0,end:a1,lines:b.slice(b0,b1)});return;}
  let x=a0,y=b0;for(const [i,j]of anchors){span(x,i,y,j,depth+1);x=i+1;y=j+1;}span(x,a1,y,b1,depth+1);
 }
 span(0,a.length,0,b.length);return out;
}
export function mergeText(base,local,incoming,label='共用文件'){
 if(normalize(local)===normalize(base))return normalize(incoming);if(normalize(incoming)===normalize(base)||normalize(local)===normalize(incoming))return normalize(local);
 const own=edits(base,local),upstream=edits(base,incoming),combined=[...own];
 for(const u of upstream){let duplicate=false;for(const l of own){if(l.start===u.start&&l.end===u.end&&JSON.stringify(l.lines)===JSON.stringify(u.lines)){duplicate=true;break;}const overlap=l.start===l.end?l.start>=u.start&&l.start<=u.end:u.start===u.end?u.start>=l.start&&u.start<=l.end:Math.max(l.start,u.start)<Math.min(l.end,u.end);if(overlap)throw Error(label+'存在重叠修改，保留本地文件并停止；请先合并冲突');}if(!duplicate)combined.push(u);}
 const result=normalize(base).split(/(?<=\n)/);for(const e of combined.sort((a,b)=>b.start-a.start||b.end-a.end))result.splice(e.start,e.end-e.start,...e.lines);return result.join('');
}
