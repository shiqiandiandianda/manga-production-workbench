/** Uniformly carry editable typography, frozen manual rows and independent double-bubble text frames. */
export function scaleReflowLettering(bubble,ratio){
 const fields=(value,keys)=>{if(value)for(const key of keys)if(Number.isFinite(value[key]))value[key]*=ratio;};
 const key=value=>{try{const a=JSON.parse(value);if(!Array.isArray(a)||a.length!==11)return value;for(const i of [2,5])if(Number.isFinite(a[i]))a[i]*=ratio;return JSON.stringify(a);}catch{return value;}};
 const layout=value=>{if(!value)return;fields(value,['w','h','lineHeight','effectiveFontSize','effectiveLetterSpacing']);if(value.key)value.key=key(value.key);if(value.requestKey)value.requestKey=key(value.requestKey);for(const line of value.lines||[]){fields(line,['x','y','width','left','right','availableWidth']);for(const glyph of line.glyphs||[])fields(glyph,['x','y']);}};
 fields(bubble,['fontSize','outlineWidth','padding','letterSpacing','shadowOffsetX','shadowOffsetY']);fields(bubble.textBox,['x','y','w','h']);layout(bubble.textLayout);
 for(const segment of bubble.dialogueSegments||[]){fields(segment.independentBox,['x','y','w','h']);layout(segment.textLayout);}
 return bubble;
}
