import {placementRows,placementSettings,preparePlacement,placePreparedDialogue} from '../../public/manual-dialogue-placement.js';
import {productionStyleKind,resolveProductionStyle,productionBoxSettings} from '../../public/production-lettering-style.js';
/** Synthetic explicit clicks, independent of the disabled automatic lettering path. */
export function placeSourceDialogue(project,page,{segmentId=page.screenBoard?.segmentId,gridId,parent=page.panels.find(p=>p.productionSegment===segmentId)||page.panels[0],styleId}={}){
 const placed=[];
 for(const row of placementRows(project,page).filter(r=>(!segmentId||r.segmentId===segmentId)&&(!gridId||r.gridId===gridId)&&!r.placed)){
  const style=resolveProductionStyle(project,row.segmentId),box=productionBoxSettings(style,productionStyleKind({productionOriginal:row.sourceText}));
  const settings={...placementSettings(project,page),...style,...box,styleId:styleId||box.styleId||'builtin-oval'};
  const prepared=preparePlacement(null,row,settings,{pageWidth:page.width});
  if(prepared.status!=='fitted')throw Error('Synthetic manual placement could not fit');
  placed.push(placePreparedDialogue(project,row,prepared.bubble,page,{x:parent.x+parent.w/2,y:parent.y+180+placed.length*200},parent));
 }
 return placed;
}
