import {episodePages} from './episode-workspace.js';
import {currentBoardEpisode} from './episode-boards.js';
import {bubbleLayout,bubbleTextBox,normalizeBubbleStyle} from './lettering.js';
import {panelForBubble} from './layer-groups.js';
import {isLibrarySfx} from './sfx-library.js';
import {dialogueSegments} from './bubble-dialogue-segments.js';
import {bubbleLineBreakMode} from './bubble-text-flow.js';
import {renderedTextBounds} from './bubble-fit-layout.js';

const styleFields=['shape','fontFamily','fontWeight','fontStyle','textColor','lineHeight','letterSpacing','textAlign','padding','outlineWidth','outlineColor','fillColor','fillOpacity','writingMode','textDirection'];
const materialFields=['points','assetContour','assetInsets','assetParts','assetTailKind','assetRays','assetFrame','comicStyleId','comicStyleLabel','styleTextureId','styleTextureAssetId','styleLibrary','materialOutlineWidth','materialVisibilityVersion','materialAspectRatio','textureInkVersion'];
const singleDialogue=b=>b?.type==='speech'&&!isLibrarySfx(b)&&normalizeBubbleStyle(b).shape!=='none'&&!dialogueSegments(b).length;

// Copy appearance and the user's independent frame geometry, never identity,
// dialogue, provenance, position or another speaker's tail coordinates.
export function applyDialogueTemplate(context,bubble,template,{maxWidth=8192}={}){
 const next=structuredClone(bubble),style=normalizeBubbleStyle(template),box=bubbleTextBox(template);
 for(const field of styleFields)next[field]=style[field];
 for(const field of materialFields){delete next[field];if(template[field]!==undefined)next[field]=structuredClone(template[field]);}
 next.w=template.w;next.h=template.h;next.textBox={...box};
 next.lineBreakMode=bubbleLineBreakMode(template);next.textFlowVersion=1;next.overflow='fit';
 delete next.textLayout;delete next.textFrameLayout;
 // Retain the chosen frame as the minimum. Longer horizontal text grows down;
 // vertical text grows across. Extra space comes from content, not preset margins.
 for(let pass=0;pass<4;pass++){
  const layout=bubbleLayout(context,next),bounds=renderedTextBounds(context,layout);
  if(![bounds.w,bounds.h].every(Number.isFinite))break;
  const contentWidth=style.writingMode==='vertical'?Math.max(bounds.w,(layout.lines.length-1)*layout.fontSize*layout.lineHeight+layout.fontSize*1.05):bounds.w;
  const width=Math.max(box.w,Math.min(contentWidth>box.w?contentWidth+.01:box.w,maxWidth-template.w+box.w)),height=Math.max(box.h,bounds.h>box.h?bounds.h+.01:box.h);
  if(Math.abs(width-next.textBox.w)<1e-7&&Math.abs(height-next.textBox.h)<1e-7)break;
  next.textBox={...box,w:width,h:height};next.w=template.w+width-box.w;next.h=template.h+height-box.h;
 }
 return next;
}

// Plan first so a failed measurement cannot leave a partially edited episode.
export function episodeBubbleFitPlan(context,project,currentPage,selectedBubble){
 const pages=episodePages(project,currentPage),template=pages.flatMap(p=>p.bubbles||[]).find(b=>b.id===selectedBubble?.id);
 if(!singleDialogue(template)||!String(template.text||'').trim())throw Error('请先选中一个已调好的单段对白气泡作为样板');
 const result={episode:currentBoardEpisode(project,currentPage),changes:[],total:0,locked:0,hidden:0,empty:0,unsupported:0,unchanged:0,overflow:0};
 for(const page of pages){
  if(page.designEpisodeRole)continue;
  for(const bubble of page.bubbles||[]){
   result.total++;
   const owner=panelForBubble(project,bubble.id)?.item;
   if(page.locked||bubble.locked||owner?.locked){result.locked++;continue;}
   if(page.visible===false||bubble.visible===false){result.hidden++;continue;}
   if(!singleDialogue(bubble)||template.w>page.width*2){result.unsupported++;continue;}
   if(!String(bubble.text||'').trim()){result.empty++;continue;}
   if(bubble.id===template.id){result.unchanged++;continue;}
   const fitted=applyDialogueTemplate(context,bubble,template,{maxWidth:page.width*2});
   if(bubbleLayout(context,fitted,{autoFit:false}).overflow)result.overflow++;
   if(JSON.stringify(fitted)===JSON.stringify(bubble)){result.unchanged++;continue;}
   result.changes.push({pageId:page.id,bubble:fitted});
  }
 }
 return result;
}

export function episodeBubbleFitMessage(result){
 const skipped=result.locked+result.hidden+result.empty+result.unsupported;
 return '第'+result.episode+'话：已按当前气泡和字体应用 '+result.changes.length+' 个对白气泡'+(result.unchanged?'，'+result.unchanged+' 个保留原样（含选中样板）':'')+(skipped?'；跳过 '+skipped+' 个（锁定 '+result.locked+'、隐藏 '+result.hidden+'、空白 '+result.empty+'、其他类型/无框/多段或尺寸不适用 '+result.unsupported+'）':'')+(result.overflow?'；'+result.overflow+' 个仍有文字溢出，请单独检查':'')+(result.changes.length?'。可一次撤销。':'。');
}
