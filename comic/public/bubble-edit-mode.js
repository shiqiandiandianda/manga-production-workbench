// Compatibility exports: bubble controls are shown together, as in the original editor.
export function getBubbleEditMode(){return 'all';}
export function setBubbleEditMode(){}

/** Keep the 24px hit targets separate at every canvas zoom. */
export function tailControlPositions(tail,zoom=1){
 const gap=30/Math.max(.01,zoom),taken=[];
 return [{name:'tail',...tail.tip},{name:'tail-anchor',...tail.anchor},...(tail.anchors||[]).map((p,index)=>({name:'tail-width',...p,index}))].filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)).map(p=>{
  let shown={x:p.x,y:p.y};
  for(let ring=0;ring<10;ring++){
   const candidates=ring===0?[shown]:Array.from({length:8*ring},(_,i)=>({x:p.x+Math.cos(i*Math.PI*2/(8*ring))*gap*ring,y:p.y+Math.sin(i*Math.PI*2/(8*ring))*gap*ring}));
   const free=candidates.find(c=>taken.every(t=>Math.hypot(c.x-t.x,c.y-t.y)>=gap-.001));if(free){shown=free;break;}
  }
  taken.push(shown);return {...p,shownX:shown.x,shownY:shown.y,offsetX:shown.x-p.x,offsetY:shown.y-p.y};
 });
}
