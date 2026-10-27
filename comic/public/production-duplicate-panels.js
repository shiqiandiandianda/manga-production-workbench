/** Retain old empty placeholders and their lettering as hidden, recoverable layers. */
export function retireEmptyProductionDuplicates(project){
 let changed=0;
 for(const page of project.pages||[]){
  if(page.locked)continue;
  for(const frame of page.panels){
   const source=frame.productionGrid;
   if(!source||frame.panelSlice||frame.imageAssetId||frame.locked||frame.productionSupersededBy)continue;
   const crop=page.panels.find(f=>f.panelSlice?.segmentId===source.segmentId&&f.panelSlice.panelId===source.panelId&&f.imageAssetId);
   if(!crop)continue;
   const children=[...page.panels.filter(f=>f.cutoutLayer?.parentPanelId===frame.id),...page.bubbles.filter(b=>b.parentPanelId===frame.id)];
   if(children.some(f=>f.locked))continue;
   for(const item of [frame,...children]){
    item.productionSupersededBy=crop.id;
    item.productionSupersededVisible=item.visible!==false;
    item.visible=false;
    delete item.productionModeHidden;delete item.productionModeVisible;
   }
   changed++;
  }
 }
 return changed;
}
