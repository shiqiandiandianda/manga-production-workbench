import {speakerAvatar} from './bubble-speaker.js';
import {speakerPortrait} from './speaker-avatar.js';
export function annotationSpeaker(project,segment,text,assets){
 const name=String(text['说话人']||'').trim(),kind=text['类型']||'对白',narration=/旁白|字幕|地点|时间/.test(kind)&&(!name||/^(旁白|字幕|地点|时间|无|—|-)$/.test(name));
 if(narration)return {name:/地点/.test(kind)?'地点':/时间/.test(kind)?'时间':'旁白',icon:/地点/.test(kind)?'地':/时间/.test(kind)?'时':'叙',kind,assetId:null,missing:false};
 const assigned=project.speakerAvatars?.[name],asset=speakerAvatar(project,{speaker:name,type:'speech'},assets,{segment}),portrait=speakerPortrait(asset,{assigned:!!assigned});
 return {name:name||'说话人未标注',kind,assetId:asset?.id||null,icon:name?.[0]||'?',missing:!asset,portrait};
}
export function annotationAvatarMarkup(who,esc){if(!who?.assetId)return esc(who?.icon||'?');const url='/api/assets/'+encodeURIComponent(who.assetId)+'/thumbnail',r=who.portrait;if(!r)return '<img src="'+url+'" alt="'+esc(who.name)+'头像" loading="lazy">';return '<svg role="img" aria-label="'+esc(who.name)+'头像" viewBox="'+[r.x*r.width,r.y*r.height,r.w*r.width,r.h*r.height].join(' ')+'" preserveAspectRatio="xMidYMid slice"><image href="'+url+'" width="'+r.width+'" height="'+r.height+'"/></svg>';}
