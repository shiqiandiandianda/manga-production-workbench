import {assetUnavailable} from './asset-availability.js';
import {assetMetadata,assetNameKey} from './asset-metadata.js';
const available=asset=>asset&&!['candidate','stale'].includes(asset.productionStatus)&&!assetUnavailable(asset);
const sameName=(a,b)=>assetNameKey(a)===assetNameKey(b);
const named=(ref,name)=>ref.role==='character'&&[ref.name,...(ref.names||[])].some(n=>sameName(n,name));
function uniqueAvatar(ids,byId){
 const choices=new Map();
 for(const id of ids){const asset=byId.get(id);if(!available(asset))continue;const hash=asset.library?.sha256||asset.sha256,path=asset.filePath?.replaceAll('\\','/').toLowerCase();choices.set(hash?'sha:'+hash:path?'path:'+path:'id:'+asset.id,asset);}
 return choices.size===1?choices.values().next().value:null;
}
/** Resolve only from the selected panel/screen first. Multiple registry IDs for the same bytes are one choice. */
export function resolveSpeakerAvatar(project,bubble,name,assets,{segment}={}){
 const byId=new Map(assets.map(a=>[a.id,a])),assigned=project?.speakerAvatars?.[name];
 if(assigned)return available(byId.get(assigned))?byId.get(assigned):null;
 const pages=project?.pages||[],frames=pages.flatMap(p=>p.panels||[]),owner=pages.find(p=>(p.bubbles||[]).some(b=>b.id&&b.id===bubble.id)),parents=[];
 let parent=frames.find(f=>f.id===bubble.parentPanelId);
 for(let i=0;parent&&i<8&&!parents.includes(parent);i++){parents.push(parent);parent=frames.find(f=>f.id===(parent.cutoutLayer?.parentPanelId||parent.panelSlice?.rootPanelId||parent.productionGrid?.rootPanelId));}
 const shot=project?.shots?.find(s=>s.id===(bubble.shotId||parents[0]?.shotId)),segmentId=bubble.productionSegment||bubble.storyboard?.segmentId||parents.map(f=>f.productionSegment||f.productionGrid?.segmentId||f.panelSlice?.segmentId).find(Boolean)||owner?.screenBoard?.segmentId||owner?.storyboard?.segmentId||shot?.productionSegment||shot?.productionSliceSegment;
 const screen=segment||(project?.productionPackage?.episodes||[]).flatMap(e=>e.segments||[]).find(s=>s.id===segmentId);
 const refs=(screen?.references||[]).filter(r=>r['类型']==='设定卡'&&sameName(r['人物'],name));
 if(refs.length)return uniqueAvatar(refs.filter(r=>!r.skipped).map(r=>r.binding?.assetId),byId);
 for(const frame of parents){
  const bindings=Object.values(frame.referenceNeedBindings||{}).filter(r=>named(r,name));
  if(bindings.length)return uniqueAvatar(bindings.map(r=>r.assetId),byId);
  const ids=frame.referenceIds,roles=(frame.generation?.referenceRoles||[]).filter(r=>named(r,name)&&(!Array.isArray(ids)||ids.includes(r.assetId)));
  if(roles.length)return uniqueAvatar(roles.map(r=>r.assetId),byId);
  const matches=(ids||[]).map(id=>byId.get(id)).filter(a=>a&&assetMetadata(a).role==='character'&&assetMetadata(a).keys.includes(assetNameKey(name)));
  if(matches.length)return uniqueAvatar(matches.map(a=>a.id),byId);
 }
 const shotMatches=(shot?.referenceIds||[]).map(id=>byId.get(id)).filter(a=>a&&assetMetadata(a).role==='character'&&assetMetadata(a).keys.includes(assetNameKey(name)));
 if(shotMatches.length)return uniqueAvatar(shotMatches.map(a=>a.id),byId);
 const explicit=[...(project?.references||[]),...Object.values(project?.assetBindings||{})].filter(r=>named(r,name));
 if(explicit.length)return uniqueAvatar(explicit.map(r=>r.assetId),byId);
 // A production screen with known identity but no confirmed card must not borrow another costume from the registry.
 if(screen)return null;
 const scope=project?.assetLibrary?.assetIds,allowed=Array.isArray(scope)?new Set(scope):null;
 return uniqueAvatar(assets.filter(a=>(!allowed||allowed.has(a.id))&&assetMetadata(a).role==='character'&&assetMetadata(a).keys.includes(assetNameKey(name))).map(a=>a.id),byId);
}
export function speakerPortrait(asset,{assigned=false}={}){
 return !assigned&&asset?.width/asset?.height>1.6?{x:0,y:.2,w:.34,h:.65,width:asset.width,height:asset.height}:null;
}
export function speakerAvatarMarkup(asset,name,{assigned=false,escape}={}){
 const url='/api/assets/'+encodeURIComponent(asset.id)+'/thumbnail',portrait=speakerPortrait(asset,{assigned}),label=escape(name+'头像'),id=escape(asset.id);
 if(!portrait)return '<img src="'+url+'" alt="'+label+'" data-speaker-avatar="'+id+'">';
 const p=portrait;return '<svg role="img" aria-label="'+label+'" data-speaker-avatar="'+id+'" viewBox="'+[p.x*p.width,p.y*p.height,p.w*p.width,p.h*p.height].join(' ')+'" preserveAspectRatio="xMidYMid slice"><image href="'+url+'" width="'+p.width+'" height="'+p.height+'"/></svg>';
}
