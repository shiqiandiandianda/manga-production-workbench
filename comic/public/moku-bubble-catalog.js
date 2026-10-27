import {COMIC_STYLE_CATALOG} from './comic-style-data.js';
import {REFERENCE_BUBBLE_STYLES} from './reference-bubble-data.js';
import {REFERENCE_BUBBLE_UPDATES} from './reference-bubble-updates.js';
import {REFERENCE_THOUGHT_BUBBLES} from './reference-thought-bubble-data.js';
import {VERTICAL_LABEL_FRAMES} from './vertical-label-frame-data.js';

const definitions=[...COMIC_STYLE_CATALOG.items,...REFERENCE_BUBBLE_STYLES,...REFERENCE_BUBBLE_UPDATES,...REFERENCE_THOUGHT_BUBBLES,...VERTICAL_LABEL_FRAMES].filter(s=>s.kind==='bubble');
const name=value=>String(value||'').normalize('NFC').replace(/\.png$/i,'');
const uuid=value=>/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value||'');

// Older uploads contain PNGs rather than a styles manifest. Only exact, unique
// catalogue matches can inherit editable geometry; unrelated images are not guessed.
export function classifiedBubbleDefinitions(assets){
 const groups=new Map();
 for(const asset of assets||[]){
  if(asset.deletedAt||asset.trashed||!['bubble','nameplate'].includes(asset.assetType)||asset.assetKind!=='image'||asset.projectId!==null||!uuid(asset.id)||!uuid(asset.recommendedRevisionId))continue;
  const matches=definitions.filter(s=>name(s.label)===name(asset.name));
  if(matches.length!==1)continue;
  const style=matches[0],rows=groups.get(style.id)||[];
  rows.push({...style,assetId:asset.id,revisionId:asset.recommendedRevisionId,assetType:asset.assetType,previewUrl:'/api/library/revisions/'+encodeURIComponent(asset.recommendedRevisionId)+'/download',definitionSource:'matched-bundled-definition'});
  groups.set(style.id,rows);
 }
 return [...groups.values()].filter(rows=>rows.length===1).map(rows=>rows[0]);
}

export async function readClassifiedBubbleAssets(api){
 const assets=[];
 for(const assetType of ['bubble','nameplate']){
  let offset=0;
  for(let page=0;page<100;page++){
   const result=await api('/api/library/assets?projectId=public&assetType='+assetType+'&limit=100&offset='+offset);
   if(!Array.isArray(result.items))throw Error('墨库全局气泡列表格式无效');
   assets.push(...result.items);
   if(!result.more)break;
   if(!result.items.length)throw Error('墨库气泡列表分页未前进');
   offset+=result.items.length;
   if(page===99)throw Error('墨库气泡列表过大，请缩小分类');
  }
 }
 return {items:classifiedBubbleDefinitions(assets),source:'moku',classified:true};
}
