/** A reflow archive is read-only; a source-bound crop returned to the original
 * project is an editable panel. Older returns retained the archive's flag.
 * Interpret that legacy flag without rewriting the user's saved document. */
export function panelSourceBlocksGeneration(panel,project){
 if(!panel?.autoLayoutCrop)return panel?.coordinateSource?.generation==='不生成';
 const source=panel.panelSlice;
 if(!project||project.autoLayoutSource?.mode==='screen-crop-reflow'||panel.visible===false||panel.autoLayoutOriginalPageId||panel.autoLayoutCrop?.version!==1||source?.sourceBindingVersion!==1)return true;
 const record=project.productionPackage?.episodes?.flatMap(e=>e.panelRecords||[]).find(r=>r.id===source.panelId&&r.segmentId===source.segmentId);
 const shot=project.shots?.find(s=>s.id===panel.shotId);
 return !record||shot?.productionGridId!==record.id;
}
