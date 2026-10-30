const segmenter=typeof Intl?.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'grapheme'}):null;
const wordSegmenter=typeof Intl?.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'word'}):null;
export const textGraphemes=text=>segmenter?[...segmenter.segment(String(text))].map(s=>s.segment):[...String(text)];
const closing=/^[\p{Pe}\p{Pf}，、。？！：；…‥’”!?.,:;%‰]/u,opening=/[\p{Ps}\p{Pi}「『【《〈‘“]$/u;
export const meaningfulLength=text=>(String(text).match(/[\p{L}\p{N}]/gu)||[]).length;
export const orphanLine=text=>meaningfulLength(text)<2;

function unitsFor(text,protectedWords=[],preserveWords=true){
 const chars=textGraphemes(text),natural=preserveWords&&wordSegmenter?[...wordSegmenter.segment(text)].filter(s=>s.isWordLike&&/\p{Script=Han}/u.test(s.segment)&&s.segment.length>1).map(s=>s.segment):[],words=[...protectedWords,...natural].filter(w=>w&&w.length>1).sort((a,b)=>b.length-a.length),units=[];
 for(let i=0;i<chars.length;i++){
  let unit=chars[i],rest=chars.slice(i).join(''),word=words.find(w=>rest.startsWith(w));
  if(word){unit=word;i+=textGraphemes(word).length-1;}
  else if(/[a-zA-Z0-9]/.test(unit)){while(i+1<chars.length&&/^[a-zA-Z0-9_'-]$/.test(chars[i+1]))unit+=chars[++i];}
  if(units.length&&(closing.test(unit)||opening.test(units.at(-1))))units[units.length-1]+=unit;else units.push(unit);
 }
 if(units.length>1&&opening.test(units.at(-1)))units[units.length-2]+=units.pop();return units;
}
/** Greedy determines the line count; a bounded dynamic pass balances those lines.
 * Original characters are never changed. Punctuation and known names are indivisible. */
export function balancedWrapRows(context,text,widthAt,{letterSpacing=0,protectedWords=[],repairOrphanBreaks=true,preserveWords=true}={}){
 let paragraphs=String(text??'').split('\n');
 if(repairOrphanBreaks)for(let i=paragraphs.length-1;i>0;i--)if(paragraphs[i].trim()&&orphanLine(paragraphs[i])&&paragraphs[i-1].trim())paragraphs.splice(i-1,2,paragraphs[i-1]+paragraphs[i]);
 const out=[];
 for(const paragraph of paragraphs){
  const units=unitsFor(paragraph,protectedWords,preserveWords),start=out.length,cache=new Map(),measure=value=>{if(!cache.has(value))cache.set(value,context.measureText(value).width+Math.max(0,textGraphemes(value).length-1)*letterSpacing);return cache.get(value);};
  if(!units.length){out.push('');continue;}
  const greedy=[];let line='';for(const unit of units){if(line&&measure(line+unit)>Math.max(1,widthAt(start+greedy.length))+.01){greedy.push(line);line='';}line+=unit;}greedy.push(line);
  if(greedy.length===1){out.push(...greedy);continue;}
  if(units.length>240||greedy.length>65){
   // Long documents use a local repair instead of quadratic layout work.
   for(let row=greedy.length-1;row>0;row--)if(orphanLine(greedy[row])){const previous=unitsFor(greedy[row-1],protectedWords);while(previous.length>1&&orphanLine(greedy[row])){const unit=previous.at(-1),candidate=unit+greedy[row];if(measure(candidate)>Math.max(1,widthAt(start+row))+.01||meaningfulLength(previous.slice(0,-1).join(''))<2)break;previous.pop();greedy[row]=candidate;greedy[row-1]=previous.join('');}}
   out.push(...(preserveWords&&orphanLine(greedy.at(-1))?balancedWrapRows(context,paragraph,i=>widthAt(start+i),{letterSpacing,protectedWords,repairOrphanBreaks:false,preserveWords:false}):greedy));continue;
  }
  const count=greedy.length,n=units.length,target=measure(paragraph)/count,memo=new Map();
  function solve(index,row){
   if(row===count)return index===n?{cost:0,lines:[]}:null;
   const key=index+':'+row;if(memo.has(key))return memo.get(key);let best=null,value='';
   const cap=Math.max(1,widthAt(start+row));
   for(let end=index+1;end<=n-(count-row-1);end++){
    value+=units[end-1];const width=measure(value);if(width>cap+.01&&end>index+1)break;
    const tail=solve(end,row+1);if(!tail)continue;
    const significant=meaningfulLength(value),last=row===count-1,pause=/[。？！!?；;]$/.test(value)?-.24:/[，、,:：]$/.test(value)?-.10:0;
    const cost=tail.cost+((width-target)/Math.max(1,cap))**2+(last&&significant<2?10000:significant===0?10000:0)+(width>cap+.01?100000:0)+pause;
    if(!best||cost<best.cost)best={cost,lines:[value,...tail.lines]};
   }
   memo.set(key,best);return best;
  }
  const resolved=solve(0,0)?.lines||greedy;
  out.push(...(preserveWords&&orphanLine(resolved.at(-1))?balancedWrapRows(context,paragraph,i=>widthAt(start+i),{letterSpacing,protectedWords,repairOrphanBreaks:false,preserveWords:false}):resolved));
 }
 return out;
}
