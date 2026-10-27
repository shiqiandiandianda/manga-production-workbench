export function usesRoundBubbleDefault(bubble){
 return ['speech','thought'].includes(bubble.type||'speech')&&(!bubble.shape||['oval','burst','cloud','legacy-thought'].includes(bubble.shape)||bubble.comicStyleId==='builtin-oval');
}

// An inscribed square gives text room inside a circle. Font parameters are read
// here, never changed; long text wraps into additional rows instead of a flat oval.
export function roundBubbleSize(text,fontSize=36,{lineHeight=4/3,letterSpacing=0,padding=18,maxSize=Infinity}={}){
 const rows=String(text??'').split('\n').map(row=>[...row].length),step=fontSize*lineHeight,charWidth=Math.max(1,fontSize+letterSpacing);
 let side=Math.max(fontSize*4+padding*2,Math.sqrt(Math.max(4,rows.reduce((a,b)=>a+b,0))*charWidth*step)/.68+padding*2);
 for(let i=0;i<200;i++){const inside=Math.max(1,side*.68-padding*2),columns=Math.max(1,Math.floor(inside/charWidth)),count=rows.reduce((n,length)=>n+Math.max(1,Math.ceil(length/columns)),0);if(count*step<=inside)break;side+=fontSize*.5;}
 const diameter=Math.max(1,Math.ceil(Math.min(maxSize,side)));return {w:diameter,h:diameter};
}
