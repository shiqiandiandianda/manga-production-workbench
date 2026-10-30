/** Move each independent text frame's centre with geometry; glyph metrics stay fixed. */
export function scaleReflowLettering(bubble,ratio,verticalRatio=ratio){
 if(!Number.isFinite(ratio)||ratio<=0||!Number.isFinite(verticalRatio)||verticalRatio<=0)return bubble;
 const move=box=>{if(!box)return;box.x=(box.x+box.w/2)*ratio-box.w/2;box.y=(box.y+box.h/2)*verticalRatio-box.h/2;};
 move(bubble.textBox);for(const segment of bubble.dialogueSegments||[])move(segment.independentBox);
 return bubble;
}


/** Keep resized body geometry valid without changing the font or stored rows. */
export function ensureReflowLetteringMinimum(bubble){
 const factor=Math.max(1,30/bubble.w,20/bubble.h);
 if(!Number.isFinite(factor)||factor<=1+1e-10)return false;
 const cx=bubble.x+bubble.w/2,cy=bubble.y+bubble.h/2,from={fontSize:bubble.fontSize,w:bubble.w,h:bubble.h};
 bubble.w*=factor;bubble.h*=factor;bubble.x=cx-bubble.w/2;bubble.y=cy-bubble.h/2;
 scaleReflowLettering(bubble,factor);
 // Multiplication at the exact lower bound can round one ULP below the bound.
 bubble.w=Math.max(30,bubble.w);bubble.h=Math.max(20,bubble.h);
 if(bubble.tail?.mode!=='normalized'&&Number.isFinite(bubble.tail?.x)&&Number.isFinite(bubble.tail?.y)){bubble.tail.x=cx+(bubble.tail.x-cx)*factor;bubble.tail.y=cy+(bubble.tail.y-cy)*factor;}
 bubble.autoLayoutMinimumLettering={version:1,from,factor,reason:'缩图后独立保留合法文字尺寸、气泡比例和已有分行'};
 return true;
}
