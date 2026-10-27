import {assetUnavailable} from './asset-availability.js';
import {assetNameKey} from './asset-metadata.js';
import {stateReferenceMetadata} from './character-state-references.js';
import {episodeOutfit} from './episode-outfit.js';

// One calculation owns this context. It is never kept across project edits.
// Sharing it across panels avoids parsing the same asset and finding the same
// segment/episode hundreds of times in one inventory or record request.
export function createReferenceAuditContext(project,assets=[]){
 const byId=new Map(assets.map(a=>[a.id,a])),segments=new Map(),episodes=new Map(),records=new Map(),frames=new Map(),refEpisodes=new WeakMap(),metadata=new Map(),info=new Map();
 for(const episode of project?.productionPackage?.episodes||[]){
  episodes.set(episode.episode,episode);
  for(const segment of episode.segments){segments.set(segment.id,segment);for(const ref of segment.references||[])refEpisodes.set(ref,episode.episode);}
  for(const record of episode.panelRecords||[]){let list=records.get(record.segmentId);if(!list)records.set(record.segmentId,list=[]);list.push(record);}
 }
 for(const page of project?.pages||[])for(const panel of page.panels||[])if(panel.productionSegment||panel.productionBackground)frames.set(panel.productionSegment||panel.productionBackground,panel);
 function meta(asset){if(!metadata.has(asset))metadata.set(asset,stateReferenceMetadata(project,asset));return metadata.get(asset);}
 function assetInfo(asset){
  if(!info.has(asset)){
   const m=meta(asset),stem=String(asset.name||'').replace(/\.(png|jpe?g|webp|avif)$/i,'');
   info.set(asset,{meta:m,identityKeys:new Set([m.name,...m.aliases,...stem.split(/[_\s·|]+/u)].map(assetNameKey)),stateKeys:new Set([...(m.stateLabels||[]),...m.parts].map(assetNameKey)),forbidden:assetUnavailable(asset)});
  }return info.get(asset);
 }
 const expectedFiles=new WeakMap();
 function expectedFile(ref){if(!expectedFiles.has(ref)){const note=String(ref['说明']||'');expectedFiles.set(ref,/\.(?:png|jpe?g|webp)/i.test(note)?note.match(/[^\s（）()]+\.(?:png|jpe?g|webp)/i)?.[0]:null);}return expectedFiles.get(ref);}
 let characterIndex;
 function characterCandidates(name){
  if(!characterIndex){characterIndex=new Map();for(const asset of assets){const i=assetInfo(asset);if(i.forbidden||i.meta.identityOnly)continue;for(const key of i.identityKeys){let list=characterIndex.get(key);if(!list)characterIndex.set(key,list=[]);list.push(asset);}}}
  return characterIndex.get(assetNameKey(name))||[];
 }
 return {project,assets,byId,segments,episodes,records,frames,meta,assetInfo,characterCandidates,expectedFile,outfit:ref=>episodeOutfit(project,refEpisodes.get(ref),ref['人物'],ref['服装'])};
}
