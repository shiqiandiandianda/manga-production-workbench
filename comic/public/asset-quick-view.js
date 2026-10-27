import {assetUnavailable} from './asset-availability.js';
import {imageCardControls} from './image-card-controls.js';
import {assetUrl} from './asset-url.js';
import {automaticCharacterIdentity} from './character-identity-reference.js';
import {createAsyncCache} from './bounded-cache.js';
import {novelReaderUrl} from './novel-reader-core.js';
import {stateReferenceMetadata,characterIdentityMatches} from './character-state-references.js';
import {mokuCandidate,mokuRevision,usableMokuImage} from './moku-reference-search.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function shortAssetState(state=''){
 if(/尸体|死亡|死去/u.test(state))return '死亡状态';
 const rank=/镇抚使|百户|千户|总旗/u.exec(state)?.[0]||'',garment=/(?:[黑白青灰红蓝紫黄]色)?(?:家常|夜行|玄衣)?(?:长衫|儒衫|官服|长袍|衣袍|衣裙|斗篷|甲胄|夜行衣)/u.exec(state)?.[0];
 return garment?(rank&&/官服/u.test(garment)?rank+' · '+garment:garment):state.split(/[，；;。]/u)[0].slice(0,24)||'服装未指定';
}
export const assetChapters=row=>[...new Set(row.sources.flatMap(s=>[...String(s.novelLocation||'').matchAll(/第\s*(\d+)\s*章/gu)].map(m=>Number(m[1]))))];
export function sameCharacterCandidate(project,row,asset){
 if(!asset||assetUnavailable(asset))return false;
 const meta=stateReferenceMetadata(project,asset);
 if(!characterIdentityMatches(row,meta,asset))return false;
 return meta.role!=='other'||!/纸伞|雨伞|令牌|腰牌|武器|长剑|纯阳剑|道具|佩剑/u.test(asset.name||'')||/人物|角色|立绘|全身|儒衫|长衫|官服|衣裙|长袍/u.test(asset.name||'');
}
export function quickCharacterCandidates(project,row,assets,items=[]){
 const chosen=assets.find(a=>a.id===row.assetIds[0]),key=a=>a.library?.revisionId?'version:'+a.library.revisionId:'asset:'+a.id,seen=new Set(chosen?[key(chosen)]:[]),result=[];
 const linked=new Set(project.assetLibrary?.assetIds||[]),workIds=new Set(assets.filter(a=>linked.has(a.id)).map(a=>a.library?.projectId).filter(Boolean));
 for(const a of assets){if(!a.library?.revisionId||!sameCharacterCandidate(project,row,a)||workIds.size&&a.library.projectId&&!workIds.has(a.library.projectId)||seen.has(key(a)))continue;seen.add(key(a));result.push({kind:'local',id:a.id,name:a.name,label:a.library?.outfitName||a.name,tags:a.library?.tags||[],remoteAssetId:a.library?.assetId,scopeLabel:a.library?.scopeLabel,revisionId:a.library.revisionId,thumbnail:'/api/assets/'+encodeURIComponent(a.id)+'/thumbnail'});}
 for(const item of items){const a=mokuCandidate(item);if(!usableMokuImage(item)||!sameCharacterCandidate(project,row,a)||seen.has(key(a)))continue;seen.add(key(a));result.push({kind:'remote',id:item.id,name:item.name,label:item.outfitName||item.name,tags:item.tags||[],remoteAssetId:item.id,scopeLabel:item.scopeLabel,revisionId:mokuRevision(item),thumbnail:'/api/library/revisions/'+mokuRevision(item)+'/preview/thumb.webp'});}
 return result;
}
export function quickCharacterMarkup({project,row,variants,assets,settings,items=[],query='',scopeFooter='',correction='',confirmation='',removals=''}){
 const automatic=automaticCharacterIdentity(project,assets,row,{defaultIds:row.assetIds||[],appearanceNotes:settings.appearanceNotes}),identity=settings.identityReferenceMode==='none'?null:assets.find(a=>a.id===(settings.identityAssetId||automatic.assetId)),chosen=assets.find(a=>a.id===row.assetIds[0]);
 const terms=query.trim()===row.name?[]:query.trim().toLowerCase().split(/\s+/u),candidates=quickCharacterCandidates(project,row,assets,items).filter(c=>terms.every(t=>[c.name,c.label,...(c.tags||[])].join(' ').toLowerCase().includes(t))),card=(item,current=false)=>`<div class="asset-choice-card ${current?'is-current':''}"><button class="asset-choice-open" ${current?'data-asset-review-current="'+esc(item.id)+'"':item.kind==='local'?'data-asset-review-local="'+esc(item.id)+'"':'data-asset-moku-use="'+esc(item.id)+'"'} title="查看整图：${esc(item.name)}"><b>${current?'当前已选':'待选择'}</b><img loading="lazy" src="${esc(item.thumbnail)}" alt="${esc(item.name)}"><span>${esc(item.label||item.name)}</span><small>${current?'点击看整图':item.scopeLabel?esc(item.scopeLabel)+' · 看整图':'点击看整图'}</small></button>${current?imageCardControls({remove:'data-asset-action="remove-current"',add:'data-asset-moku-search',replace:'data-asset-action="focus-asset-search"'}):`<button class="asset-choice-use" data-asset-use-${item.kind==='local'?'local':'moku'}="${esc(item.id)}" aria-label="选用 ${esc(item.label||item.name)}" title="直接选用此图">✓ 选用</button>`}${item.remoteAssetId?`<small>标签：${esc((item.tags||[]).join("、")||"暂无")}</small><input data-asset-tag-input="${esc(item.remoteAssetId)}" maxlength="100" value="${esc(row.name)}" aria-label="为${esc(item.name)}添加标签"><button data-asset-add-tag="${esc(item.remoteAssetId)}">添加墨库标签</button>`:""}</div>`;

 return `<div class="asset-quick-view"><div class="asset-quick-states">${variants.map(r=>`<button data-asset-variant-source="${esc(r.key)}" aria-pressed="${r.key===row.key}">${esc(shortAssetState(r.state))}<small>${r.uses.length}处</small></button>`).join('')}</div>
 <section class="asset-quick-evidence"><div><strong>小说原文</strong><small>${esc(assetChapters(row).map(c=>'第'+c+'章').join('、'))}</small></div><div data-quick-novel>正在读取原文…</div><button data-quick-novel-upload>补充小说章节</button><input type="file" data-quick-novel-input accept=".txt,.md" multiple hidden></section>
 <div class="asset-quick-columns"><section class="asset-quick-library"><header><h3>选择对应资产</h3><small>当前：${esc(shortAssetState(row.state))}</small></header>${confirmation}<div class="asset-inventory-search"><input type="search" data-asset-moku-query value="${esc(query||row.name)}" placeholder="搜索名称、服装或墨库标签"><button data-asset-moku-search data-asset-state-confirm="${esc(row.key)}">查找资产</button></div>
 <div class="asset-choice-strip" aria-label="当前已选与同人物候选资产">${chosen?card({id:chosen.id,name:chosen.name,thumbnail:'/api/assets/'+encodeURIComponent(chosen.id)+'/thumbnail'},true):'<div class="asset-choice-empty"><b>当前未选图</b><span>从右侧候选中选择</span></div>'}${candidates.slice(0,24).map(item=>card(item)).join('')||'<p class="asset-choice-note">暂无其他同人物资产，可查找或生成。</p>'}</div>${candidates.length>24?'<p>候选较多，请用服装关键词缩小范围。</p>':''}${removals}<details class="asset-quick-scope"><summary>采用范围</summary>${scopeFooter}</details></section>
 <aside class="asset-quick-generate"><h3>缺图就生成</h3><form data-asset-form><p class="asset-inline-note">人物身份参考 · 保持脸、发型和体型；服装按下方设置。</p><div class="asset-quick-identity">${identity?`<div class="asset-quick-identity-picture"><img src="/api/assets/${encodeURIComponent(identity.id)}/thumbnail" alt="人物形象参考">${imageCardControls({remove:'data-generation-ref-clear="identityAssetId"',replace:'data-generation-ref="identityAssetId"'})}</div><span>${esc(identity.name)}</span>`:'<span>先选一张这个人物的形象图，换装时保持同一张脸。</span>'}<button data-generation-ref="identityAssetId">${identity?'更换身份参考':'选择人物身份参考'}</button></div>
 <label>本次服装 / 状态<input readonly value="${esc(shortAssetState(row.state))}"></label><button class="primary" data-asset-action="submit-generation">按此服装生成</button><details class="asset-quick-correction"><summary>改一下服装 / 状态</summary>${correction}</details><label>补充要求（可选）<textarea data-setting="appearanceNotes" maxlength="1600" rows="2" placeholder="如：衣领合拢、衣面干燥">${esc(settings.appearanceNotes||'')}</textarea></label>
 <details><summary>提示词与更多设置</summary><label>资产补充<textarea data-setting="assetBrief" maxlength="12000">${esc(settings.assetBrief||'')}</textarea></label><button data-asset-action="preview-prompt">查看整理后的提示词</button><textarea readonly data-asset-prompt-preview rows="9"></textarea><button data-generation-ref="costumeAssetId">选服装参考（可选）</button><button data-asset-action="save-settings">保存设置</button></details></form></aside></div>
 <details class="asset-quick-original"><summary>资料包原始说明与使用位置</summary><p>资料设定：${esc(row.state)}</p><p>此说明来自制作资料，不作为小说原文。</p><p>${esc(row.sources.map(s=>s.code).join('、'))}</p><button data-asset-action="usage">查看 / 调整使用范围</button><button data-asset-action="text">改用文字描述</button></details></div>`;
}
export function createQuickEvidenceLoader(api){
 const cache=createAsyncCache({name:'novel-short-excerpts',maxEntries:32,maxBytes:3*1024*1024,ttl:120000,maxPending:3});let epoch=0;
 async function load(project,row,host){const ticket=epoch,node=host.querySelector('[data-quick-novel]');if(!node)return;const route='/api/projects/'+project.id+'/novel-evidence?'+new URLSearchParams({name:row.name,state:row.state,chapters:assetChapters(row).join(',')});try{const result=await cache.load(route,()=>api(route));if(ticket!==epoch||!node.isConnected)return;node.innerHTML=result.excerpts?.length?result.excerpts.map(e=>`<blockquote><span>${esc(e.quote)}</span><small>${esc(e.location)} · <a href="${esc(novelReaderUrl(project.id,e,row.name))}" target="_blank" rel="noopener">查看本章原文</a></small></blockquote>`).join('')+(!result.clothingExplicit?'<p>本段未明确服装细节，当前服装属于制作设定，请人工判断。</p>':''):`<p>${result.available?'本章未找到直接的服装原句，可核对章节全文。':'当前工程没有保存这些章节的小说正文。请补充原文章节，制作说明不能代替原文。'}</p>`;}catch(error){if(ticket===epoch&&node.isConnected)node.textContent=error.message;}}
 return {load,clear(){epoch++;cache.clear();}};
}
