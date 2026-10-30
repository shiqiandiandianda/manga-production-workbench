export const BUBBLE_APPEARANCE_VERSION=1;
/** Old imports left a contour with both fill and stroke zero. Explicit edits are protected. */
export function repairLegacyBubbleAppearance(project){
 const result={changed:0,fill:0,tail:0,locked:0};
 for(const page of project.pages||[])for(const b of page.bubbles||[]){
  const parent=page.panels.find(p=>p.id===b.parentPanelId);
  if(page.locked||parent?.locked||b.locked){result.locked++;continue;}
  if(b.visible===false||parent?.visible===false||b.shape==='none'||!['speech','thought','caption','label','system'].includes(b.type))continue;
  const production=!!b.productionTextId||!!b.productionOriginal;
  let changed=false;
  if(production&&!b.materialVisibilityVersion&&!b.styleTextureId&&b.fillOpacity===0&&b.outlineWidth===0){b.fillOpacity=1;b.fillColor||='#ffffff';b.outlineWidth=2.8;b.outlineColor||='#171b20';if(b.shape==='asset')b.materialOutlineWidth=2.8;b.materialVisibilityVersion=2;result.fill++;changed=true;}
  const bubbleKind=b.type==='speech'||b.type==='thought'&&b.assetParts?.some(p=>p.id==='upper-bubble');
  if(production&&bubbleKind&&b.tail?.visible===false&&!b.tail.visibilityExplicit&&!b.tail.defaultVersion&&!Number.isFinite(b.tail.x)&&!Number.isFinite(b.tail.y)&&!b.assetFrame&&!b.assetRays&&!b.styleTextureId){b.tail={...b.tail,visible:true,defaultVersion:1};result.tail++;changed=true;}
  if(changed)result.changed++;
 }
 return result;
}
