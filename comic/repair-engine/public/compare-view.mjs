import {sectionSegments,sectionsHeight} from './page-sections.mjs';
import {pageSegments,pageHeight} from './page-layout.mjs';
// Anchor the source pixel at the viewport centre; retain an exact return view for transparent extensions.
export function compareViewport({current,next,height,sections=null,gaps=[],zoom,panX,panY,bookmark}){
 const segments=sections?sectionSegments(sections):pageSegments(height,gaps),outputHeight=sections?sectionsHeight(sections):pageHeight(height,gaps),currentHeight=current==='original'?height:outputHeight,nextHeight=next==='original'?height:outputHeight;
 if(bookmark?.from===next&&bookmark?.to===current&&bookmark.height===outputHeight&&bookmark.zoom===zoom&&bookmark.panX===panX&&Math.abs(bookmark.toPanY-panY)<1e-7)return{panY:bookmark.fromPanY,bookmark:null};
 const centre=currentHeight/2-panY/zoom;
 let source=centre,preferred=null;
 if(current!=='original'){
  const segment=segments.find(item=>centre>=item.start+item.offset&&centre<item.start+item.offset+(item.height??item.end-item.start));
  if(segment){source=segment.start+Math.min(segment.end-segment.start,centre-segment.start-segment.offset);preferred=segment.id;}
 }
 let target=source;
 if(next!=='original'){const segment=segments.find(item=>item.id===preferred&&source>=item.start&&source<=item.end)||segments.find(item=>source>=item.start&&source<item.end)||segments.find(item=>source===item.end);if(segment)target=source+segment.offset;}
 const toPanY=(nextHeight/2-target)*zoom;
 return{panY:toPanY,bookmark:{from:current,to:next,height:outputHeight,zoom,panX,fromPanY:panY,toPanY}};
}
