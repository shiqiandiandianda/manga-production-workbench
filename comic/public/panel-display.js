import {panelComposition} from './panel-composition.js';
import {productionSegment} from './production-package-model.js';
export const PANEL_DISPLAY_MODES=Object.freeze({technical:'镜头号 / 比例像素',content:'画面内容',characters:'出现角色'});
export const panelDisplayMode=value=>Object.hasOwn(PANEL_DISPLAY_MODES,value)?value:'technical';
const string=value=>Array.isArray(value)?value.map(v=>typeof v==='string'?v:typeof v?.name==='string'?v.name:'').filter(Boolean).join('、'):typeof value==='string'?value.trim():'';
export function panelDisplayData(frame,shot,project){
 const snapshot=frame.generation?.sourceSnapshot,original=snapshot?.original,fields=shot?.sourceFields||{},client=shot?.storyboard?.clientFields||{},prior=original?.sourceFields||{};
 const first=(...values)=>values.map(string).find(Boolean)||'';
 const data={code:first(frame.layoutUnitId,fields['格ID'],client['格ID'],shot?.code,snapshot?.code)||'未绑定',ratio:panelComposition(frame).ratioText,pixels:Math.round(frame.w)+' × '+Math.round(frame.h)+' px',content:first(fields['画面内容'],fields['画面描述'],client['画面内容'],client['画面描述'],shot?.description,prior['画面内容'],original?.description),characters:first(fields['出现角色'],fields['出场人物'],client['出现角色'],shot?.participants,prior['出现角色'],original?.participants)};
 const segment=productionSegment(project,frame.productionSegment||frame.productionBackground?.replace(/-BG$/,''));
 if(segment){if(frame.productionBackground){data.label='共用底图';data.characters='覆盖 '+(frame.backgroundSegments||[segment.id]).join('、')+'；采用整段色调参考';}else{data.label='屏段';data.characters=segment.references.filter(r=>r['类型']==='设定卡').map(r=>r['人物']+(r['服装']?'（'+r['服装']+'）':'')).join('、')||'本段未声明人物设定卡';const episode=project.productionPackage.episodes.find(e=>e.episode===segment.episode);data.content=episode.panelRecords.filter(r=>r.segmentId===segment.id).map(r=>r.id+'：'+(r.original['画面内容']||'')).join('\n');}}
 return data;
}
export function panelDisplayMarkup(frame,shot,escape,mode,project){
 const data=panelDisplayData(frame,shot,project),kind=panelDisplayMode(mode),body=kind==='technical'?`<div class="panel-info-dimensions">${escape(data.ratio)}<br>${escape(data.pixels)}</div>`:`<div class="panel-mode-content" data-info-source-field="${kind}">${escape(data[kind]||(kind==='content'?'分镜表未填写画面内容':'分镜表未填写出现角色'))}</div>`;
 return `<div class="panel-mode-heading">${data.label||'镜头'} ${escape(data.code)}</div>${body}`;
}
