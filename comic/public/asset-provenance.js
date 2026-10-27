import {deriveSceneReference} from './reference-scene-source.js';
import {assetNameKey} from './asset-metadata.js';
import {episodeOutfit} from './episode-outfit.js';
const text=v=>typeof v==='string'?v.trim():Array.isArray(v)?v.join('、'):'';
const list=v=>(Array.isArray(v)?v:String(v||'').split(/[、，,；;\n]+/u)).map(v=>String(v).trim()).filter(Boolean);
const equal=(a,b)=>text(a).normalize('NFKC').toLowerCase()===text(b).normalize('NFKC').toLowerCase();
/** Read imported evidence verbatim; storyboard descriptions are never presented as novel quotations. */
export function assetProvenance(project,panel,need,referenceContext){
 const segmentId=panel.productionSegment||panel.panelSlice?.segmentId||panel.productionGrid?.segmentId;
 const sourceId=panel.panelSlice?.panelId||panel.productionGrid?.panelId;
 const episode=referenceContext?.episodes.get(referenceContext.segments.get(segmentId)?.episode)||project.productionPackage?.episodes.find(e=>e.segments.some(s=>s.id===segmentId));
 const records=(referenceContext?.records.get(segmentId)||episode?.panelRecords||[]).filter(r=>r.segmentId===segmentId&&(!sourceId||r.id===sourceId));
 const matches=r=>{const raw={...r.production,...r.original};if(!list(raw[need.role==='character'?'出现角色':need.role==='scene'?'当前场景':'出现道具']).some(n=>equal(n,need.name)))return false;if(need.role!=='character')return true;const declared=raw['当前状态']?.[need.name],version=declared?.['本次文字方案'];if(version&&need.assetSourceId&&need.assetSourceVersion)return version===need.assetSourceId+'/'+need.assetSourceVersion;const state=text(raw['服装']?.[need.name]||declared?.['造型']);return !state||!need.state||assetNameKey(episodeOutfit(project,episode?.episode,need.name,state))===assetNameKey(need.state);};
 const rows=records.filter(matches);
 if(rows.length)return rows.map(r=>{const raw={...r.production,...r.original},fields=r.production||{},locations=Array.isArray(raw['原著位置'])?raw['原著位置']:[],quotation=locations.filter(v=>/^非空段\d+[：:]/u.test(v)).map(v=>v.replace(/^非空段\d+[：:]\s*/u,'')),design=raw['当前状态']?.[need.name];return {
  episode:episode.episode,segmentId,code:r.id,panelId:panel.id,source:r.source||{},
  novelLocation:text(fields['原著位置']||(locations.length?locations.filter(v=>!/^非空段\d+[：:]|^事件[：:]/u.test(v)):raw['原著位置'])||raw['原文出处']),
  novelQuote:text(raw['原文摘录']||raw['原著摘录']||raw['原著原文'])||quotation.join('\n'),
  novelQuoteLabel:'资料包提供的原文摘录（请结合原件核对）',
  adaptationNote:locations.filter(v=>/^事件[：:]/u.test(v)).join('\n'),assetVersion:design?.['本次文字方案']||[need.assetSourceId,need.assetSourceVersion].filter(Boolean).join('/'),
  sourceState:text(design?.['造型']||raw['服装']?.[need.name]),
  description:text(raw['画面内容']),notes:text(raw['画面备注']),
  state:need.role==='character'?text(raw['服装']?.[need.name]||fields['角色状态（服装/形态）']):need.role==='scene'?[text(raw['当前时间']),text(raw['当前天气'])].filter(Boolean).join(' · '):text(raw['道具状态']),
  dialogue:text(fields['台词'])||(Array.isArray(raw['台词'])?raw['台词']:[]).map(t=>typeof t==='object'?[t['说话人'],t['文本']].filter(Boolean).join('：'):String(t)).join('\n'),
  scene:text(raw['当前场景']),time:text(raw['当前时间']),weather:text(raw['当前天气']),camera:text(raw['机位角度'])
 };});
 const scene=need.role==='scene'?deriveSceneReference(project,panel):null,shot=(scene?.kind==='continuous'&&project.shots.find(s=>s.code===scene.sourceCode))||project.shots.find(s=>s.id===panel.shotId)||panel.generation?.sourceSnapshot?.original||{},fields=shot.sourceFields||{};
 return [{episode:shot.episode||episode?.episode||null,segmentId,code:shot.code||panel.name||'',panelId:panel.id,source:shot.source||{file:shot.sourceLocation||''},novelLocation:text(fields['原著位置']||fields['原文出处']),novelQuote:text(fields['原文摘录']||fields['原著摘录']),description:text(fields['画面内容']||shot.description),notes:text(fields['画面备注']),dialogue:text(shot.dialogue||fields['台词']),state:need.state||'',scene:text(fields['当前场景']||shot.location),time:text(fields['当前时间']||shot.time),weather:text(fields['当前天气']||shot.weather),camera:text(fields['机位角度']||shot.cameraAngle)}];
}
