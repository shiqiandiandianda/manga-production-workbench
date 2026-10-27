import {bounds,clamp} from './model.js';

export function panelComposition(panel){
 const box=bounds(panel),ratio=box.w/box.h;
 const mode=ratio<.8?'portrait':ratio>1.25?'landscape':'square';
 return {width:box.w,height:box.h,ratio,mode,label:{portrait:'竖幅',landscape:'横幅',square:'近方形'}[mode],ratioText:ratio.toFixed(3)+':1',box};
}
export function currentPanelLayout(panel,project){
 const composition=panelComposition(panel),intent=panel.layoutIntent||{},owner=project?.pages?.find(page=>page.panels.some(frame=>frame.id===panel.id));

 const basis=intent.layoutBasis,changed=basis&&(Math.abs(basis.w-panel.w)>.01||Math.abs(basis.h-panel.h)>.01);
 const scaleRect=rect=>({x:rect.x*panel.w/basis.w,y:rect.y*panel.h/basis.h,w:rect.w*panel.w/basis.w,h:rect.h*panel.h/basis.h});
 let safeArt=changed&&intent.safeArt?scaleRect(intent.safeArt):intent.safeArt;
 if(!safeArt)safeArt={x:composition.box.x+composition.width*.08,y:composition.box.y+composition.height*.08,w:composition.width*.84,h:composition.height*.84};
 const minimum=Math.min(1,composition.width*.1,composition.height*.1),x=clamp(safeArt.x,composition.box.x,composition.box.x+composition.width-minimum),y=clamp(safeArt.y,composition.box.y,composition.box.y+composition.height-minimum);
 safeArt={x,y,w:Math.max(minimum,Math.min(safeArt.w,composition.box.x+composition.width-x)),h:Math.max(minimum,Math.min(safeArt.h,composition.box.y+composition.height-y))};
 const letteringZones=owner?owner.bubbles.filter(bubble=>bubble.visible!==false&&bubble.parentPanelId===panel.id&&bubble.type!=='sfx').map(bubble=>({x:bubble.x-panel.x,y:bubble.y-panel.y,w:bubble.w,h:bubble.h,type:bubble.type})):intent.letteringZones||[];
 return {...composition,safeArt,letteringZones,overlapReserves:intent.overlapReserves||[],fullBleed:intent.fullBleed===true};
}
export function compositionDirection(panel){
 const state=panelComposition(panel);
 return state.mode==='portrait'?'当前为竖幅构图：按上下层次与纵深组织原有场景，完整呈现关键主体和动作，避免把旧方形画面直接拉长。':state.mode==='landscape'?'当前为横幅构图：按横向空间与人物关系组织原有场景，完整呈现关键主体和动作，避免把旧方形画面直接拉宽。':'当前为近方形构图：围绕关键主体和动作集中组织原有场景，保持适当背景和安全边距。';
}
export function closestModelRatio(panel,flag){
 const target=panelComposition(panel).ratio,values=(flag?.values||[]).map(String),choices=values.map(value=>{const pair=/^([\d.]+)\s*[:x/]\s*([\d.]+)$/i.exec(value),ratio=pair?Number(pair[1])/Number(pair[2]):/^\d+(?:\.\d+)?$/.test(value)?Number(value):NaN;return {value,ratio};}).filter(item=>Number.isFinite(item.ratio)&&item.ratio>0);
 if(choices.length)return choices.reduce((best,item)=>Math.abs(Math.log(item.ratio/target))<Math.abs(Math.log(best.ratio/target))?item:best).value;
 if(flag?.default!==undefined&&(!values.length||values.includes(String(flag.default))))return String(flag.default);
 if(flag?.required)throw Object.assign(new Error('模型没有可自动匹配的画幅，请在生图设置手动选择比例'),{status:400});
 return '';
}
