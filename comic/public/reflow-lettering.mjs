/** Uniformly carry editable typography, frozen manual rows and independent double-bubble text frames. */
export function scaleReflowLettering(bubble,ratio){
 const fields=(value,keys)=>{if(value)for(const key of keys)if(Number.isFinite(value[key]))value[key]*=ratio;};
 const key=value=>{try{const a=JSON.parse(value);if(!Array.isArray(a)||a.length!==11)return value;for(const i of [2,5])if(Number.isFinite(a[i]))a[i]*=ratio;return JSON.stringify(a);}catch{return value;}};
 const layout=value=>{if(!value)return;fields(value,['w','h','lineHeight','effectiveFontSize','effectiveLetterSpacing']);if(value.key)value.key=key(value.key);if(value.requestKey)value.requestKey=key(value.requestKey);for(const line of value.lines||[]){fields(line,['x','y','width','left','right','availableWidth']);for(const glyph of line.glyphs||[])fields(glyph,['x','y']);}};
 fields(bubble,['fontSize','outlineWidth','padding','letterSpacing','shadowOffsetX','shadowOffsetY']);fields(bubble.textBox,['x','y','w','h']);layout(bubble.textLayout);
 for(const segment of bubble.dialogueSegments||[]){fields(segment.independentBox,['x','y','w','h']);layout(segment.textLayout);}
 return bubble;
}


/** Keep uniformly scaled source lettering within the editor's actual size contract. */
export function ensureReflowLetteringMinimum(bubble){
 const factor=Math.max(1,10/bubble.fontSize,30/bubble.w,20/bubble.h);
 if(!Number.isFinite(factor)||factor<=1+1e-10)return false;
 const cx=bubble.x+bubble.w/2,cy=bubble.y+bubble.h/2,from={fontSize:bubble.fontSize,w:bubble.w,h:bubble.h};
 bubble.w*=factor;bubble.h*=factor;bubble.x=cx-bubble.w/2;bubble.y=cy-bubble.h/2;
 scaleReflowLettering(bubble,factor);
 // Multiplication at the exact lower bound can round one ULP below the bound.
 bubble.fontSize=Math.max(10,bubble.fontSize);bubble.w=Math.max(30,bubble.w);bubble.h=Math.max(20,bubble.h);
 if(bubble.tail?.mode!=='normalized'&&Number.isFinite(bubble.tail?.x)&&Number.isFinite(bubble.tail?.y)){bubble.tail.x=cx+(bubble.tail.x-cx)*factor;bubble.tail.y=cy+(bubble.tail.y-cy)*factor;}
 bubble.autoLayoutMinimumLettering={version:1,from,factor,reason:'缩图后独立保留合法文字尺寸、气泡比例和已有分行'};
 return true;
}
