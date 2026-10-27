export const revisionComponentNames={card:'整张资产图',face:'头像（脸、发型与头饰）',views:'正侧背三视图',front:'正面全身',side:'侧面全身',back:'背面全身',hands:'手部',prop:'道具配饰','scene-front':'场景正视图','scene-reverse':'场景反打'};
export function availableRevisionComponents(r){if(!r)return [];if(r.type==='scene')return ['scene-front','scene-reverse'].filter(k=>r.slots?.[k]);if(r.type==='character'&&r.characterOutputMode!=='card'&&!r.legacy)return ['face','front','side','back','views','hands','prop','card'].filter(k=>k==='card'?r.imageUrl:k==='views'?['front','side','back'].every(v=>r.slots?.[v]):r.slots?.[k]);return r.imageUrl?['card']:[];}
export function inferRevisionIntent(record,notes,overrides={}){
 const choices=availableRevisionComponents(record),text=String(notes||'').trim();let target='',reference='',handCell='',detail='',ambiguous=false;
 // Reference clauses and explicit preservation clauses are not edit targets.
 const edit=text.replace(/(?:以|参照|参考|按照|按)(?:[^，。；;\n]*?)(?:为准|为参考|为依据|作参考)[，。；;]?/g,'').replace(/(?:不要|别|不许|无需)(?:改动|改变|修改|改|动)[^，。；;\n]*/g,'').replace(/[^，。；;\n]*(?:保持不变|不变|不修改|不用改|不动|无需改)[^，。；;\n]*/g,'');
 if(record?.type==='scene'){target=/反打|反面|背面/.test(edit)?'scene-reverse':/正视|正面|前景/.test(edit)?'scene-front':choices.length===1?choices[0]:'';}
 else if(record?.type==='prop')target='card';
 else{
  const hands=/手部|手心|掌心|手背|手指|手套|护腕|左手|右手/.test(edit),head=/头饰|帽子|发冠|发簪|发型|头发|胡子|胡须|大脸|头像|脸部|五官|脸型|眼睛|眉毛|鼻子/.test(edit),body=/全身|三视图|衣服|服装|衣领|领口|袖口|袍子|腰带|靴|鞋|头身比|身高|身材/.test(edit),prop=/道具|剑|刀|剑鞘|配饰|葫芦/.test(edit);
  const viewTargets=[[/正面|正视图/,'front'],[/侧面|侧视图/,'side'],[/背面|后背/,'back']].filter(([rx])=>rx.test(edit)&&!(hands&&/手背/.test(edit))).map(([,id])=>id);
  if(hands){target='hands';const cells=[['左上','top-left'],['右上','top-right'],['左下','bottom-left'],['右下','bottom-right']].filter(([name])=>edit.includes(name));if(cells.length===1)handCell=cells[0][1];if(head||viewTargets.length)ambiguous=true;}
  else if(viewTargets.length){target=viewTargets.length===1?viewTargets[0]:'views';}
  else if(/佩|挂|持|拿|握|腰间|腰部|左腰|右腰|背负/.test(edit)&&prop){target='views';detail='只调整全身图里的道具及佩戴位置，其他外貌与服装保持。';}
  else if(head){target='face';if(/头饰|帽子|发冠|发簪/.test(edit))detail='以参照中的帽子、头饰、发冠或发簪为准，只修正头像对应部分，保留五官、年龄、胡须及未要求修改的发型和衣领。';else if(/胡子|胡须/.test(edit))detail='以参照中的上唇、下巴和两颊胡须为准，只统一胡须形状、位置、长度和颜色，保留五官、年龄与服装。';}
  else if(body){target=/不统一|不匹配|对不上|不一致/.test(edit)&&/衣领|领口|衣服|服装/.test(edit)?'face':'views';}
  else if(prop)target='prop';
  if(head&&hands)ambiguous=true;
 }
 if(overrides.component){if(target!==overrides.component)detail='';target=overrides.component;ambiguous=false;}
 const semanticTarget=target;if(target&&!choices.includes(target)&&choices.includes('card'))target='card';
 if(!choices.includes(target))target='';
 if(target==='face')reference=['views','front','side','back'].find(k=>choices.includes(k))||'';
 else if(['views','front','side','back'].includes(target))reference=choices.includes('face')?'face':'';
 else if(target==='hands')reference=handCell?'hands':choices.includes('views')?'views':'';
 if(/(?:以|参照|参考|按照|按)[^，。；;\n]*(?:三视图|全身图)[^，。；;\n]*(?:为准|为参考|为依据|作参考)/.test(text)&&choices.includes('views')&&target!=='views')reference='views';
 if(overrides.referenceComponent!==undefined)reference=overrides.referenceComponent;
 const referenceChoices=['',...choices.filter(k=>k!=='card'&&(k!==target||target==='hands'&&handCell))];if(!referenceChoices.includes(reference))reference='';
 if(target!=='hands')handCell='';
 const requiresSelection=!!text&&(!target||ambiguous),labels=revisionComponentNames,summary=requiresSelection?'这条意见涉及多个部位或未说明部位，请选择修改部位，或进入精细修改。':target?'修改 '+labels[target]+(handCell?' · '+({'top-left':'左上那只手','top-right':'右上那只手','bottom-left':'左下那只手','bottom-right':'右下那只手'})[handCell]:'')+'；'+(reference?'以'+labels[reference]+'为参照':'按原图及文字要求')+'。':'';
 const extra=target==='card'&&semanticTarget==='face'?'这是一张完整角色卡，只修正大脸头像对应部分，以卡中正侧背全身图为一致性依据，其他区域保持。':detail;
 return {component:target,referenceComponent:reference,handCell,summary,requiresSelection,choices,referenceChoices,notes:[text,extra].filter(Boolean).join('\n')};
}
