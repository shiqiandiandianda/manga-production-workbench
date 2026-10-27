import {panelComposition} from './panel-composition.js';
import {productionSegment} from './production-package-model.js';
import {generationPromptSelection} from './prompt-source.js';
import {productionDisplayContext} from './production-display-context.js';
import {characterPreparationNote} from './character-preparation.js';
import {assetUrl} from './asset-url.js';
export const PANEL_DISPLAY_MODES=Object.freeze({technical:'镜头号 / 比例像素',content:'生图提示词',characters:'出现角色'});
export const panelDisplayMode=value=>Object.hasOwn(PANEL_DISPLAY_MODES,value)?value:'technical';
const string=value=>Array.isArray(value)?value.map(v=>typeof v==='string'?v:typeof v?.name==='string'?v.name:'').filter(Boolean).join('、'):typeof value==='string'?value.trim():'';
export function panelDisplayData(frame,shot,project){
 const snapshot=frame.generation?.sourceSnapshot,original=snapshot?.original,fields=shot?.sourceFields||{},client=shot?.storyboard?.clientFields||{},prior=original?.sourceFields||{};
 const first=(...values)=>values.map(string).find(Boolean)||'';
 const data={code:first(frame.layoutUnitId,fields['格ID'],client['格ID'],shot?.code,snapshot?.code)||'未绑定',ratio:panelComposition(frame).ratioText,pixels:Math.round(frame.w)+' × '+Math.round(frame.h)+' px',content:first(fields['画面内容'],fields['画面描述'],client['画面内容'],client['画面描述'],shot?.description,prior['画面内容'],original?.description),characters:first(fields['出现角色'],fields['出场人物'],client['出现角色'],shot?.participants,prior['出现角色'],original?.participants)};
 const segment=productionSegment(project,frame.productionSegment||frame.productionBackground?.replace(/-BG$/,''));
 if(segment){if(frame.productionBackground){data.label='共用底图';data.characters='覆盖 '+(frame.backgroundSegments||[segment.id]).join('、')+'；采用整段色调参考';}else{data.label=segment.singleMode?'单格':'屏段';if(segment.singleMode)data.code=segment.panelIds?.[0]||data.code;data.characters=segment.references.filter(r=>r['类型']==='设定卡').map(r=>r['人物']+(r['服装']?'（'+r['服装']+'）':'')).join('、')||'本段未声明人物设定卡';const episode=project.productionPackage.episodes.find(e=>e.episode===segment.episode);data.content=episode.panelRecords.filter(r=>r.segmentId===segment.id).map(r=>r.id+'：'+(r.original['画面内容']||'')).join('\n');}}
 data.content=generationPromptSelection(frame,project||{shots:shot?[{...shot,id:frame.shotId}]:[]}).text;
 const context=productionDisplayContext(project,null,frame);
 if(context.segment&&!frame.productionBackground){
  const names=[...new Set(context.records.flatMap(r=>{const value=r.original?.['出现角色'];return (Array.isArray(value)?value:typeof value==='string'?value.split(/[、，,；;\n]+/u):[]).map(v=>typeof v==='string'?v.trim():'').filter(Boolean);} ))];
  data.characterCards=names.map(name=>{
   const reference=context.segment.references.find(r=>r['类型']==='设定卡'&&r['人物']===name&&!r.skipped);
   const binding=reference?.binding,valid=binding&&(!binding.characterName||binding.characterName===name)&&/^asset_[a-f0-9-]{36}$/i.test(binding.assetId||'');
   const states=[];
   for(const record of context.records){
    const value=record.original?.['当前状态']?.[name]||record.original?.['人物状态']?.[name];
    const text=typeof value==='string'?value:value&&typeof value==='object'?Object.entries(value).filter(([k,v])=>k!=='造型参考'&&typeof v==='string'&&!/待绑定|待提供|尚未提供/u.test(v)).map(([k,v])=>k+'：'+v).join('；'):'';
    if(text&&!characterPreparationNote(text)&&!states.some(s=>s.text===text))states.push({panelId:record.id,text});
   }
   return {name,assetId:valid?binding.assetId:null,outfit:valid?binding.outfitName||'':'',states};
  });
  if(names.length)data.characters=names.join('、');
  else if(!context.gridId){const refs=context.segment.references.filter(r=>r['类型']==='设定卡'&&r['人物']).map(r=>r['人物']+(r['服装']?'（'+r['服装']+'）':''));data.characters='分镜未标注出场人物'+(refs.length?'；本段参考：'+refs.join('、'):'');}
  else data.characters='本格未声明出场人物';
 }
 return data;
}
export function panelDisplayMarkup(frame,shot,escape,mode,project){
 const data=panelDisplayData(frame,shot,project),kind=panelDisplayMode(mode),characters=kind==='characters'&&data.characterCards?.length?data.characterCards.map(c=>'<div class="panel-character-card">'+(c.assetId?'<img loading="lazy" src="'+escape(assetUrl(c.assetId))+'" alt="'+escape(c.name)+'角色卡">':'')+'<div><strong>'+escape(c.name)+'</strong><small>'+escape(c.assetId?'已绑定角色卡'+(c.outfit?' · '+c.outfit:''):'尚未绑定角色卡')+'</small>'+c.states.map(s=>'<small>'+escape(s.panelId+' · '+s.text)+'</small>').join('')+(!c.states.length?'<small>本格未注明具体状态</small>':'')+'</div></div>').join(''):null,body=kind==='technical'?`<div class="panel-info-dimensions">${escape(data.ratio)}<br>${escape(data.pixels)}</div>`:`<div class="panel-mode-content" data-info-source-field="${kind}">${characters??escape(data[kind]||(kind==='content'?'本格未提供当前模式的生图提示词':'分镜表未填写出现角色'))}</div>`;
 return `<div class="panel-mode-heading">${data.label||'镜头'} ${escape(data.code)}</div>${body}`;
}
