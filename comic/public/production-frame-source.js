/** Source identity shared by screens, backgrounds, generated grids and crops. */
export function productionFrameSegment(frame){
 return frame?.productionSegment||frame?.productionBackground?.replace(/-BG$/,'')||frame?.panelSlice?.segmentId||frame?.productionGrid?.segmentId;
}
