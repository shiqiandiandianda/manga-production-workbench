export function canonicalBubbleTail(bubble){
 const t=bubble.tail;if(!t||typeof t!=='object'||Array.isArray(t))return null;
 // Old group moves added offsets to an absent tip: undefined + delta became NaN,
 // then JSON null. Restore the absent tip; preserve every finite artist coordinate.
 const missing=v=>v===null||Number.isNaN(v);
 if(missing(t.x)&&missing(t.y)){const next={...t,invalidTipBackup:{x:null,y:null,reason:'group-move-without-tip'}};delete next.x;delete next.y;return next;}
 if(t.mode!=='normalized'||![t.x,t.y,bubble.x,bubble.y,bubble.w,bubble.h].every(Number.isFinite)||t.x>=-2&&t.x<=3&&t.y>=-2&&t.y<=3)return null;
 const x=bubble.x+t.x*bubble.w,y=bubble.y+t.y*bubble.h;
 return Number.isSafeInteger(Math.trunc(x))&&Number.isSafeInteger(Math.trunc(y))?{...t,mode:'absolute',x,y}:null;
}

/** Missing source tail metadata used to turn off ordinary production dialogue. */
export function bubbleTailVisible(bubble){
 const tail=bubble.tail;
 if(tail?.visible!==false)return !!tail||bubble.type==='speech';
 return bubble.type==='speech'&&bubble.shape!=='none'&&!!bubble.productionOriginal
  &&!Object.hasOwn(bubble.productionOriginal,'泡尾')&&!bubble.comicStyleId&&!bubble.styleTextureId
  &&!tail.visibilityExplicit&&!Number.isFinite(tail.x)&&!Number.isFinite(tail.y);
}
export function productionTailVisible(text,type){
 return Object.hasOwn(text||{},'泡尾')?!!text['泡尾']:type==='speech';
}
