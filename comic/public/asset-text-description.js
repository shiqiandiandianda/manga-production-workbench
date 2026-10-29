import {assetProvenance} from './asset-provenance.js';
import {assetNameKey} from './asset-metadata.js';
import {unknownState,libraryStatePlaceholder} from './character-states.js';
import {TEXT_ASSET_MAX_LENGTH,textAssetDescriptionContent} from './asset-text-references.js';

const clean=value=>typeof value==='string'?value.trim():'';
const usefulState=value=>clean(value)&&!unknownState(value)&&!libraryStatePlaceholder(value)?clean(value):'';
/** Use imported facts and source excerpts; never invent age, clothes or another identity. */
export function automaticTextAssetDescription(project,row){
 const sources=[...(row.sources||[])];
 if(!sources.length)for(const use of row.uses||[]){const panel=project.pages.flatMap(page=>page.panels).find(panel=>panel.id===use.panelId);if(panel)sources.push(...assetProvenance(project,panel,{...row,id:use.needId}));}
 const ledger=(project.productionPackage?.ledger||[]).flatMap(part=>(part.records||[]).map(record=>({record,file:part.file})));
 const related=row.role==='character'?row.name.replace(/(?:残影|遗体|尸体|倒影)$/u,''):row.name;
 const knownRelated=related!==row.name&&ledger.some(item=>assetNameKey(item.record['名称'])===assetNameKey(related));
 const names=[row.name,...(knownRelated?[related]:[])],matches=ledger.filter(item=>names.some(name=>assetNameKey(name)===assetNameKey(item.record['名称'])));
 const lines=[({character:'人物',scene:'场景',prop:'道具'})[row.role]+'：'+row.name],origins=[];
 if(knownRelated)lines.push('人物身份和已有造型沿用“'+related+'”，本项仅表示当前分镜中的'+row.name.slice(related.length)+'状态。');
 for(const {record,file}of matches){
  const identity=clean(record['固定设定']).replace(/[；;]PLAN编号.*$/u,'');
  if(identity&&!/的角色身份[。.]?$/u.test(identity))lines.push('资料设定：'+identity);
  const state=usefulState(record['状态说明']);if(state)lines.push('资料状态：'+state);
  for(const key of ['外观描述','外观','人物小传','描述'])if(clean(record[key]))lines.push('资料描述：'+clean(record[key]));
  if(file)origins.push(file);
 }
 const state=usefulState(row.state);if(state)lines.push('当前状态：'+state);
 for(const source of sources){
  if(source.novelQuote)lines.push('原文摘录：'+source.novelQuote);
  if(source.description)lines.push(textAssetDescriptionContent('本格画面依据：'+source.description));
  if(source.notes)lines.push('分镜备注：'+source.notes);
  if(source.source?.file)origins.push(source.source.file);
  if(lines.join('\n').length>TEXT_ASSET_MAX_LENGTH)break;
 }
 return {description:[...new Set(lines)].join('\n').slice(0,TEXT_ASSET_MAX_LENGTH),sources:[...new Set(origins)]};
}
