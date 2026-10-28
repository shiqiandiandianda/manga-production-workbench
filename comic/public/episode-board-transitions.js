import {pageEpisode,currentBoardEpisode,resolveBoard,hasEpisodeBoard} from './episode-boards.js';
import {storyFadeSteps} from './story-fade-curve.js';
import {sceneLayers} from './layers.js';
import {gradientStops,gradientColorAt} from './gradient-stops.js';
import {rectangle} from './model.js';
import {assetUrl} from './asset-url.js';

const COLOR=/^#[0-9a-f]{6}$/i;
const rectangular=f=>f.points?.length===4&&rectangle().every(c=>f.points.some(p=>Math.abs(p.x-c.x)<1e-8&&Math.abs(p.y-c.y)<1e-8));
const clamp=n=>Math.max(0,Math.min(1,n));

// Cache only ephemeral inspection results; original board assets and project files stay untouched.
const imageSafety=new Map();
const imageSafetyKey=board=>[assetUrl(board.backgroundAssetId),board.kind,board.height,board.background,board.imageFit].join('|');
export function boardTransitionImageSafety(board){return board.backgroundAssetId?imageSafety.get(imageSafetyKey(board))?.value:null;}
function inspectBoardEdge(board,image,canvasFactory){
 const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;if(!(iw>0&&ih>0))return 0;
 const max=Math.min(480,board.height),width=320,scale=width/1280,height=Math.max(1,Math.ceil(max*scale)),c=canvasFactory();c.width=width;c.height=height;
 try{
  const ctx=c.getContext('2d'),sourceTop=board.kind==='cover'?board.height-max:0,fit=(board.imageFit==='contain'?Math.min:Math.max)(1280/iw,board.height/ih),x=(1280-iw*fit)/2,y=(board.height-ih*fit)/2;
  ctx.scale(scale,scale);ctx.translate(0,-sourceTop);ctx.fillStyle=board.background;ctx.fillRect(0,sourceTop,1280,max);ctx.drawImage(image,x,y,iw*fit,ih*fit);
  const data=ctx.getImageData(0,0,width,height).data,margin=16;let clear=height;
  for(let offset=0;offset<height;offset++){
   const row=board.kind==='cover'?height-1-offset:offset,lum=[];
   for(let x=0;x<width;x++){const i=(row*width+x)*4;lum.push(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]);}
   const sorted=[...lum].sort((a,b)=>a-b),median=sorted[Math.floor(width/2)],contrasts=lum.filter(v=>Math.abs(v-median)>35).length;
   // Distinct markings or highly textured rows can include text; stop before them.
   if(contrasts/width>.006){clear=offset;break;}
  }
  return Math.max(0,Math.min(max,clear/scale-margin));
 }finally{c.width=1;c.height=1;}
}
export function requestBoardTransitionSafety(board,{imageLoader,canvasFactory=()=>document.createElement('canvas')}={}){
 if(!board?.backgroundAssetId)return null;const key=imageSafetyKey(board);if(imageSafety.has(key))return null;
 if(imageSafety.size>=128)for(const [k,v]of imageSafety)if(v.state!=='pending'){imageSafety.delete(k);break;}
 const entry={state:'pending',value:0};imageSafety.set(key,entry);
 entry.promise=Promise.resolve().then(()=>imageLoader(board.backgroundAssetId)).then(image=>inspectBoardEdge(board,image,canvasFactory)).catch(()=>0).then(value=>{entry.state='ready';entry.value=value;return value;});
 return entry.promise;
}
export async function ensureBoardTransitionSafety(board,options){
 if(!board?.backgroundAssetId)return null;const key=imageSafetyKey(board),created=requestBoardTransitionSafety(board,options),entry=imageSafety.get(key);return created||entry?.promise||entry?.value||0;
}

/** Read the actual opaque body backdrop at the adjoining edge; ambiguous overlays stay unresolved. */
export function episodeEdgeBackground(project,layout,episode,kind,{hiddenLayerIds=new Set(),episodeLayerIds=null,draft=false}={}){
 const entries=layout.pages.filter(e=>(pageEpisode(project,e.page)||currentBoardEpisode(project,e.page))===episode);if(!entries.length)return null;
 const entry=kind==='cover'?entries[0]:entries.at(-1),y=kind==='cover'?entry.y+.001:entry.endY-.001;
 let color=COLOR.test(entry.page.background||'')?entry.page.background:null;if(draft)return color;
 for(const d of sceneLayers(project,layout)){
  if(d.frame.visible===false||hiddenLayerIds.has(d.frame.id)||episodeLayerIds&&!episodeLayerIds.has(d.frame.id))continue;
  const f=d.frame;
  // A visible image-backed body background has no single trustworthy edge color here.
  if(d.type==='panel'&&f.imageAssetId&&(f.kind==='background'||f.productionBackground||f.productionBackgroundInstance)){
   const top=d.offsetY+f.y*d.scale,bottom=top+f.h*d.scale,left=f.x*d.scale,right=left+f.w*d.scale;
   if(pageEpisode(project,d.page)===episode&&top<=y&&bottom>y&&left<layout.width&&right>0)color=null;
   continue;
  }
  if(d.type!=='gradient')continue;
  const g=f.gradient;if(!g?.enabled||f.y>y||f.y+f.h<=y||f.x>=layout.width||f.x+f.w<=0)continue;
  if((f.assistantLayoutAnchor?.episode||f.designEpisode)&&Number(f.assistantLayoutAnchor?.episode||f.designEpisode)!==episode)continue;
  const stops=gradientStops(g),opaque=g.mode==='color'&&g.opacity===1&&stops.every(s=>s.opacity===1&&COLOR.test(s.color||''));
  const edges=f.featherEdges||{},localY=y-f.y,safeFeather=!(f.feather>0)&&!(edges.left>0)&&!(edges.right>0)&&(!(edges.top>0)||localY>=edges.top)&&(!(edges.bottom>0)||localY<=f.h-edges.bottom);
  const full=f.x<=0&&f.x+f.w>=layout.width&&rectangular(f)&&safeFeather&&!(f.mask?.enabled&&f.mask.strokes?.length);
  if(!opaque||!full||![g.start?.x,g.start?.y,g.end?.x,g.end?.y].every(Number.isFinite)){color=null;continue;}
  if(stops.every(s=>s.color.toLowerCase()===stops[0].color.toLowerCase())){color=stops[0].color;continue;}
  if(Math.abs(g.start.x-g.end.x)>1e-8||Math.abs(g.start.y-g.end.y)<1e-8){color=null;continue;}
  const fraction=clamp((y-f.y-g.start.y*f.h)/((g.end.y-g.start.y)*f.h));color=gradientColorAt(g,fraction).color;
 }
 return color;
}

/** A separate joining area continues the two adjacent backgrounds without changing their source boards. */
export const BOARD_BRIDGE_HEIGHT=480;
export function planEpisodeBoardTransition(project,layout,board,measurement,options={}){
 if(!project||!board||!['cover','tail'].includes(board.kind)||!hasEpisodeBoard(project,board.kind,board.episode))return null;
 const color=episodeEdgeBackground(project,layout,board.episode,board.kind,options);if(!COLOR.test(color||''))return null;
 // Image edges with markings cannot safely be extended without repeating text/art.
 if(board.backgroundAssetId&&(boardTransitionImageSafety(board)??0)<24)return null;
 return {kind:board.kind,color,height:BOARD_BRIDGE_HEIGHT};
}

/** Only inspect images for boards that actually participate in this export. */
export function imageBoardsForTransition(project,{assets=project?.assets||[],episode=null}={}){
 if(!project?.episodeBoards)return [];const numbers=new Set((project.pages||[]).map(page=>pageEpisode(project,page)||currentBoardEpisode(project,page)).filter(n=>episode===null||n===episode)),boards=[];
 for(const n of numbers)for(const kind of ['cover','tail'])if(hasEpisodeBoard(project,kind,n)){const board=resolveBoard(project,kind,n,assets);if(board.backgroundAssetId)boards.push(board);}
 return boards;
}
/** Preflight the same image safety in browser and server before calculating the strip height. */
export async function ensureProjectBoardTransitionSafety(project,{assets=project?.assets||[],episode=null,imageLoader,canvasFactory,refresh=false}={}){
 if(typeof imageLoader!=='function')return;const tasks=[];
 for(const board of imageBoardsForTransition(project,{assets,episode})){const key=imageSafetyKey(board);if(refresh&&imageSafety.get(key)?.state!=='pending')imageSafety.delete(key);tasks.push(ensureBoardTransitionSafety(board,{imageLoader,canvasFactory}));}
 await Promise.all(tasks);
}

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Two separately masked continuations of the existing board and body backgrounds. */
export function boardBridgeSvg(board,plan,{y=0,idPrefix=''}={}){
 if(!board||!plan)return '';const cover=board.kind==='cover',height=plan.height,id=idPrefix+'board_bridge_'+board.kind+'_'+board.episode;
 const stops=toBoard=>storyFadeSteps.map(v=>{const n=Math.round((toBoard?(cover?1-v.amount:v.amount):(cover?v.amount:1-v.amount))*255);return `<stop offset="${v.offset}" stop-color="rgb(${n},${n},${n})"/>`;}).join('');
 const mask=(key,toBoard)=>`<linearGradient id="${id}_${key}_gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${height}">${stops(toBoard)}</linearGradient><mask id="${id}_${key}" maskUnits="userSpaceOnUse" x="0" y="0" width="1280" height="${height}" style="mask-type:luminance"><rect width="1280" height="${height}" fill="url(#${id}_${key}_gradient)"/></mask>`;
 const edge=cover?Math.max(0,board.height-1):0,image=board.backgroundAssetId?`<image href="${escape(assetUrl(board.backgroundAssetId))}" width="1280" height="${board.height}" preserveAspectRatio="xMidYMid ${board.imageFit==='contain'?'meet':'slice'}"/>`:'';
 return `<g data-board-bridge="${board.kind}" transform="translate(0 ${y})"><defs>${mask('board',true)}${mask('body',false)}</defs><g style="isolation:isolate"><g style="mix-blend-mode:plus-lighter" mask="url(#${id}_board)"><svg width="1280" height="${height}" viewBox="0 ${edge} 1280 1" preserveAspectRatio="none"><rect width="1280" height="${board.height}" fill="${board.background}"/>${image}</svg></g><g style="mix-blend-mode:plus-lighter" mask="url(#${id}_body)"><rect width="1280" height="${height}" fill="${plan.color}"/></g></g><rect width="1280" height="${height}" fill="transparent" pointer-events="all"/></g>`;
}

/** Canvas equivalent of the two feathered continuations, bounded to the 480px joining area. */
export async function paintBoardBridge(context,board,plan,{y=0,imageLoader,canvasFactory=()=>document.createElement('canvas')}={}){
 if(!board||!plan)return;const height=plan.height,cover=board.kind==='cover',edge=canvasFactory(),upper=canvasFactory(),combined=canvasFactory();edge.width=1280;edge.height=1;upper.width=combined.width=1280;upper.height=combined.height=height;
 try{
  const e=edge.getContext('2d');e.fillStyle=board.background;e.fillRect(0,0,1280,1);
  if(board.backgroundAssetId){const image=await imageLoader(board.backgroundAssetId),iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height,fit=(board.imageFit==='contain'?Math.min:Math.max)(1280/iw,board.height/ih),x=(1280-iw*fit)/2,iy=(board.height-ih*fit)/2-(cover?board.height-1:0);e.drawImage(image,x,iy,iw*fit,ih*fit);}
  const a=upper.getContext('2d');a.drawImage(edge,0,0,1280,height);const boardFade=a.createLinearGradient(0,0,0,height);for(const v of storyFadeSteps)boardFade.addColorStop(v.offset,`rgba(0,0,0,${cover?1-v.amount:v.amount})`);a.globalCompositeOperation='destination-in';a.fillStyle=boardFade;a.fillRect(0,0,1280,height);
  const c=combined.getContext('2d');c.drawImage(upper,0,0);c.globalCompositeOperation='lighter';const rgb=[1,3,5].map(i=>parseInt(plan.color.slice(i,i+2),16)),bodyFade=c.createLinearGradient(0,0,0,height);for(const v of storyFadeSteps)bodyFade.addColorStop(v.offset,`rgba(${rgb.join(',')},${cover?v.amount:1-v.amount})`);c.fillStyle=bodyFade;c.fillRect(0,0,1280,height);
  context.drawImage(combined,0,y);
 }finally{for(const canvas of [edge,upper,combined]){canvas.width=1;canvas.height=1;}}
}
