import {assetMetadata} from './asset-metadata.js';
// Search is broader than automatic matching. A result is a candidate, not a binding.
const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const pairs=value=>new Set(Array.from(value).slice(0,-1).map((_,i)=>Array.from(value).slice(i,i+2).join('')));
export function assetSearchScore(item,query){
 const terms=String(query??'').trim().split(/[\s,，、;；]+/u).map(normalize).filter(Boolean);
 if(!terms.length)return 1;
 const library=item.library||{},fields=[item.name,item.sourceName,item.canonicalName,item.sceneName,item.propName,item.characterName,item.outfitName,item.libraryName,item.libraryState,library.characterName,library.outfitName,library.sceneName,library.propName,...(item.aliases||[]),...(item.tags||[]),...(library.tags||[])].filter(v=>typeof v==='string').map(normalize);
 let score=0;
 for(const term of terms){let best=0;const grams=pairs(term);for(const field of fields){
  if(field===term)best=Math.max(best,1000);
  else if(field.includes(term))best=Math.max(best,700+term.length);
  else if(term.includes(field)&&field.length>=2)best=Math.max(best,300+field.length);
  else {const common=[...grams].filter(g=>field.includes(g)).length,characters=[...new Set(term)].filter(c=>field.includes(c)).length;if(common)best=Math.max(best,Math.round(100*common/Math.max(1,grams.size))+common+characters);}
 }score+=best;}
 return score;
}
export function fuzzyAssetCandidates(items,query){return items.map((item,index)=>({item,index,score:assetSearchScore(item,query)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).map(r=>r.item);}
export function relevantAssetCandidates(items,query,{role}={}){
 const ranked=fuzzyAssetCandidates(items,query),q=normalize(query);
 if(!q||!['character','scene','prop'].includes(role))return ranked;
 const strong=ranked.filter(item=>{const m=assetMetadata(item),fields=[m.name,...m.aliases,item.canonicalName,item.sceneName,item.propName,item.characterName].filter(Boolean).map(normalize);return fields.some(f=>f===q||(role!=='character'&&q.length>=3&&f.includes(q)));});
 // When a specific room exists, sibling rooms and unrelated buildings are not
 // useful alternatives. Without a strong match retain review candidates.
 return strong.length?strong:ranked;
}
