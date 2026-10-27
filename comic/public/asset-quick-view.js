import {fuzzyAssetCandidates} from './asset-fuzzy-search.js';
import {assetPreparationMarkup} from './asset-source-evidence.js';
import {assetUnavailable} from './asset-availability.js';
import {unknownState} from './character-states.js';
import {characterRole} from './character-role.js';
import {imageCardControls} from './image-card-controls.js';
import {assetUrl} from './asset-url.js';
import {automaticCharacterIdentity} from './character-identity-reference.js';
import {createAsyncCache} from './bounded-cache.js';
import {novelReaderUrl} from './novel-reader-core.js';
import {stateReferenceMetadata,characterIdentityMatches} from './character-state-references.js';
import {mokuCandidate,mokuRevision,usableMokuImage} from './moku-reference-search.js';
import {filterAssetCandidateTypes,candidateAssetRole} from './asset-candidate-types.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function shortAssetState(state=''){
 if(unknownState(state))return '服装未指定';
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
 for(const item of items){const a=mokuCandidate(item);if(!usableMokuImage(item)||seen.has(key(a)))continue;seen.add(key(a));result.push({...item,kind:'remote',id:item.id,label:item.outfitName||item.name,revisionId:mokuRevision(item),thumbnail:'/api/library/revisions/'+mokuRevision(item)+'/preview/thumb.webp'});}
 for(const a of assets){if(!a.library?.revisionId||assetUnavailable(a)||seen.has(key(a)))continue;seen.add(key(a));result.push({...a,kind:'local',id:a.id,label:a.library?.outfitName||a.name,revisionId:a.library.revisionId,thumbnail:'/api/assets/'+encodeURIComponent(a.id)+'/thumbnail'});}
 return result;
}
export function quickCharacterSearchFeedback(project,row,assets,items=[],query='',{allTypes=false}={}){
 const pool=fuzzyAssetCandidates(quickCharacterCandidates(project,row,assets,items),query),candidates=filterAssetCandidateTypes(pool,row.role,{allTypes});
 const labels={character:'人物',scene:'场景',prop:'道具'},counts=new Map();for(const item of pool){const type=candidateAssetRole(item);if(labels[type])counts.set(type,(counts.get(type)||0)+1);}
 const emptyMessage=pool.length&&!candidates.length?[...counts].map(([type,count])=>count+' 张'+labels[type]+'图').join('、')+'；没有找到“'+row.name+'”的'+labels[row.role]+'图。可查看全部图片类型，或直接文生 / 生成资产。':'暂未找到候选图。试试部分名称，如“青城”“马车”，或直接文生 / 生成资产。';
 return {candidates,emptyMessage,message:candidates.length?'找到 '+candidates.length+' 张候选图，点击图片直接采用':emptyMessage};
}
export function quickCharacterMarkup({project,row,variants,assets,settings,items=[],query='',scopeFooter='',correction='',page=0,allTypes=false}){
 const chosen=assets.find(a=>a.id===row.assetIds[0]),reference=assets.find(a=>a.id===settings.generationReferenceAssetId),{candidates,emptyMessage}=quickCharacterSearchFeedback(project,row,assets,items,query,{allTypes});
 const pages=Math.max(1,Math.ceil(candidates.length/24)),currentPage=Math.min(page,pages-1),label=row.role==='character'?'人物':row.role==='scene'?'场景':'道具';
 const card=(item,current=false)=>'<article class="asset-choice-card '+(current?'is-current':'')+'"><button class="asset-choice-open" '+(current?'data-asset-action="preview-current"':'data-asset-use-'+(item.kind==='local'?'local':'moku')+'="'+esc(item.id)+'"')+' title="'+(current?'查看当前图片':'点击直接采用')+'"><b>'+(current?'当前已选':'点击采用')+'</b><img loading="lazy" src="'+esc(item.thumbnail)+'" data-fallback="'+(item.kind==='remote'?'/api/library/revisions/'+item.revisionId+'/download':'/assets/'+encodeURIComponent(item.id))+'" alt="'+esc(item.name)+'"><span>'+esc(item.name)+'</span></button><div class="asset-choice-tools"><button data-asset-preview-candidate="'+esc(item.id)+'" data-candidate-kind="'+(item.kind||'local')+'">放大</button><button data-asset-reference-candidate="'+esc(item.id)+'" data-candidate-kind="'+(item.kind||'local')+'">作生成参考</button></div></article>';
 return '<div class="asset-quick-view"><div class="asset-quick-columns"><section class="asset-quick-library"><header><h3>搜索后，直接点图采用</h3><small>'+esc(label)+' · '+row.uses.length+'处</small></header><div class="asset-inventory-search"><input type="search" data-asset-moku-query value="'+esc(query)+'" placeholder="模糊搜索：人物名、服装或场景关键词" aria-label="模糊搜索资产"><button data-asset-moku-search>搜索</button></div><p class="asset-inline-note">用哪个人物、哪套衣服、哪个场景，由你选。支持部分名称和多个关键词。</p>'+
  '<label class="checkbox-field"><input type="checkbox" data-asset-all-types '+(allTypes?'checked':'')+'>全部图片类型（手动选图）</label>'+
  (variants.length>1?'<div class="asset-quick-states">'+variants.map(r=>'<button data-asset-variant-source="'+esc(r.key)+'" aria-pressed="'+(r.key===row.key)+'">'+esc(shortAssetState(r.state))+'<small>'+r.uses.length+'处</small></button>').join('')+'</div>':'')+
 '<div class="asset-choice-strip" aria-label="当前已选与搜索候选图">'+(chosen?card({id:chosen.id,name:chosen.name,thumbnail:'/api/assets/'+encodeURIComponent(chosen.id)+'/thumbnail'},true):'')+candidates.slice(currentPage*24,(currentPage+1)*24).map(i=>card(i)).join('')+(!chosen&&!candidates.length?'<p class="asset-choice-note">'+esc(emptyMessage)+'</p>':'')+'</div>'+
 (pages>1?'<div class="asset-pagination"><button data-asset-moku-prev '+(!currentPage?'disabled':'')+'>上一页</button><span>'+(currentPage+1)+' / '+pages+' 页 · '+candidates.length+' 张</span><button data-asset-moku-next '+(currentPage===pages-1?'disabled':'')+'>下一页</button></div>':'')+
 '<details class="asset-quick-scope"><summary>应用到本话这项资产 · 调整范围</summary>'+scopeFooter+'</details></section><aside class="asset-quick-generate"><h3>没有合适的图</h3><button class="asset-text-direct" data-asset-action="save-text">文生，不用资产图</button><p class="asset-inline-note">直接使用已有文字设定和本格提示词。</p><form data-asset-form><h3>生成一张资产图</h3><div class="asset-simple-reference">'+(reference?'<img src="/api/assets/'+encodeURIComponent(reference.id)+'/thumbnail" alt="生成参考图"><span>'+esc(reference.name)+'</span><button data-generation-ref-clear="generationReferenceAssetId">移除参考图</button>':'<p>可选一张参考图，也可直接文生资产。</p>')+'<button data-generation-ref="generationReferenceAssetId">'+(reference?'更换参考图':'选择一张参考图')+'</button></div><label>生成要求（可选）<textarea data-setting="assetBrief" rows="3" maxlength="12000" placeholder="例如：穿蓝灰色长衫；或改成马车内部视角">'+esc(settings.assetBrief||'')+'</textarea></label><button class="primary" data-asset-action="submit-generation">'+(reference?'参考此图生成资产':'直接生成资产图')+'</button><details><summary>更多生成设置</summary>'+
 (row.role==='character'?'<label>人物定位<select data-setting="characterRole"><option value="auto" '+(!settings.characterRole||settings.characterRole==='auto'?'selected':'')+'>按资料</option><option value="lead" '+(settings.characterRole==='lead'?'selected':'')+'>主要人物</option><option value="background" '+(settings.characterRole==='background'?'selected':'')+'>普通人物</option></select></label><label>外观补充<textarea data-setting="appearanceNotes" maxlength="1600">'+esc(settings.appearanceNotes||'')+'</textarea></label>':row.role==='scene'?'<label>输出<select data-setting="sceneOutputMode"><option value="front" '+(settings.sceneOutputMode!=='both'?'selected':'')+'>单张场景</option><option value="both" '+(settings.sceneOutputMode==='both'?'selected':'')+'>正视图与反打</option></select></label>':'')+
 '<button data-asset-action="preview-prompt">查看提示词</button><textarea readonly data-asset-prompt-preview rows="6"></textarea><button data-asset-action="save-settings">保存设置</button></details></form></aside></div><details class="asset-quick-original"><summary>文字描述、资料与使用位置</summary><p>资料标注：'+esc(row.role==='character'?shortAssetState(row.state):row.state||row.name)+'</p>'+assetPreparationMarkup(row)+'<button data-asset-action="text">编辑文生描述</button><button data-asset-action="usage">查看使用位置</button>'+(row.role==='character'?'<details class="asset-quick-evidence"><summary>查看小说原文</summary><div data-quick-novel>正在读取原文…</div><button data-quick-novel-upload>补充小说章节</button><input type="file" data-quick-novel-input accept=".txt,.md" multiple hidden></details><details class="asset-quick-correction"><summary>修改资料中的服装 / 状态</summary>'+correction+'</details>':'')+'</details></div>';
}
export function createQuickEvidenceLoader(api){
 const cache=createAsyncCache({name:'novel-short-excerpts',maxEntries:32,maxBytes:3*1024*1024,ttl:120000,maxPending:3});let epoch=0;
 async function load(project,row,host){const ticket=epoch,node=host.querySelector('[data-quick-novel]');if(!node)return;const route='/api/projects/'+project.id+'/novel-evidence?'+new URLSearchParams({name:row.name,state:row.state,chapters:assetChapters(row).join(',')});try{const result=await cache.load(route,()=>api(route));if(ticket!==epoch||!node.isConnected)return;node.innerHTML=result.excerpts?.length?result.excerpts.map(e=>`<blockquote><span>${esc(e.quote)}</span><small>${esc(e.location)} · <a href="${esc(novelReaderUrl(project.id,e,row.name))}" target="_blank" rel="noopener">查看本章原文</a></small></blockquote>`).join('')+(!result.clothingExplicit?'<p>本段未明确服装细节，当前服装属于制作设定，请人工判断。</p>':''):`<p>${result.available?'本章未找到直接的服装原句，可核对章节全文。':'当前工程没有保存这些章节的小说正文。请补充原文章节，制作说明不能代替原文。'}</p>`;}catch(error){if(ticket===epoch&&node.isConnected)node.textContent=error.message;}}
 return {load,clear(){epoch++;cache.clear();}};
}
