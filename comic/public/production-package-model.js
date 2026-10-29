import {productionReferenceOutfit} from './episode-outfit.js';
import {roundBubbleSize} from './round-bubble-default.js';
import {bubbleSourceTextIds,dialogueSegments} from './bubble-dialogue-segments.js';
import {productionTailVisible} from './bubble-tail-compat.js';
import {assetUnavailable} from './asset-availability.js';
import {PRODUCTION_PACKAGE_LIMITS as limits} from './production-package-limits.js';
import {validateLayoutDesign} from './layout-design.js';
import {productionTextContent} from './production-text.js';
import {textAssetBinding,textAssetSignature} from './asset-text-references.js';
import {productionReferenceSubject} from './production-extra-references.js';
import {obsoleteProductionReference} from './production-reference-policy.js';
import {applyBubbleEdit} from './bubble-editor.js';
import {id,clone} from './model.js';
import {productionExtraReferenceRoles} from './production-extra-references.js';
const invalid=message=>Object.assign(Error(message),{status:400});
export function productionSegment(project,key){return project?.productionPackage?.episodes.flatMap(e=>e.segments).find(s=>s.id===key);}
export function productionFrame(project,key){return project.pages.flatMap(p=>p.panels).find(f=>f.productionSegment===key||f.productionBackground===key);}
export function validateProductionPackage(project){
 const p=project.productionPackage;if(p===undefined){if(project.pages.some(page=>page.panels.some(f=>f.productionGrid)))throw invalid('单格生成缺少制作资料来源');return;}
 if(p?.generationUnit!==undefined&&!['screen','panel'].includes(p.generationUnit))throw invalid('生成单位无效');
 if(p?.version!==1||!/^[a-f0-9]{24}$/.test(p.id||'')||!/^[a-f0-9]{64}$/.test(p.hash||'')||!Array.isArray(p.episodes)||!p.episodes.length||p.episodes.length>100||!Array.isArray(p.manifest)||p.manifest.length>limits.files)throw invalid('制作资料包元数据无效');
 const frames=new Map(project.pages.flatMap(page=>page.panels.map(f=>[f.id,f]))),shots=new Set(project.shots.map(s=>s.id)),seen=new Set(),names=new Set();
 for(const f of p.manifest){if(typeof f.relativePath!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256||'')||names.has(f.relativePath.toLowerCase()))throw invalid('制作资料原件清单无效');names.add(f.relativePath.toLowerCase());}
 for(const e of p.episodes){if(e.layoutDesign)validateLayoutDesign(e.layoutDesign.data);if(!Number.isInteger(e.episode)||e.episode<1||!Array.isArray(e.segments)||!Array.isArray(e.panelRecords)||!Array.isArray(e.texts))throw invalid('制作话数据无效');for(const s of e.segments){if(!s.id||seen.has(s.id)||frames.get(s.panelId)?.productionSegment!==s.id||!shots.has(s.shotId)||!Array.isArray(s.references))throw invalid('屏段关联画格或来源镜头不存在');seen.add(s.id);for(const r of s.references)if(r.binding&&(!/^asset_[a-f0-9-]{36}$/i.test(r.binding.assetId||'')||!r.binding.revisionId||!/^[a-f0-9]{64}$/.test(r.binding.sha256||'')))throw invalid('制作附图固定版本无效');}}
 for(const e of p.episodes)for(const s of e.segments){if(s.generationUnit!==undefined&&!['screen','panel'].includes(s.generationUnit))throw invalid('生成单位无效');if(s.panelPromptSources&&(typeof s.panelPromptSources!=='object'||Array.isArray(s.panelPromptSources)||Object.entries(s.panelPromptSources).some(([key,value])=>!s.panelIds.includes(key)||!['imported','post-lettering'].includes(value))))throw invalid('单格提示词模式无效');}
 for(const frame of frames.values())if(frame.productionGrid){const source=frame.productionGrid,record=p.episodes.flatMap(e=>e.panelRecords).find(r=>r.id===source.panelId&&r.segmentId===source.segmentId),shot=project.shots.find(s=>s.id===frame.shotId);if(source.version!==1||!record||frames.get(source.rootPanelId)?.productionSegment!==source.segmentId||frame.productionSegment||frame.productionBackground||shot?.productionGridId!==source.panelId||shot?.productionSliceSegment!==source.segmentId)throw invalid('单格生成的分镜来源关联无效');}
}
export function productionSourceAsset(frame){return frame?.packageCutout?.assetId===frame?.imageAssetId?frame.packageCutout.originalAssetId:frame?.imageAssetId;}
export function productionRequirementKey(ref){return JSON.stringify([ref['类型'],ref['人物']||'',ref['服装']||'',ref['说明']||'']);}
export function productionJobSignature(project,frame){const s=productionSegment(project,frame.productionSegment||frame.productionBackground?.replace(/-BG$/,'')),shot=project.shots.find(v=>v.id===frame.shotId);return JSON.stringify([project.productionPackage.hash,shot?.sourceFields,frame.generation?.promptSource||'imported',s?.references.map(r=>[r.slot,r.binding,r.skipped]),...(s?.unifiedLayoutRuleDigest?[s.unifiedLayoutRuleDigest,project.layoutRuleBindings?.[s.episode]]:[]),...(textAssetSignature(frame).length?[textAssetSignature(frame)]:[]),...(frame.generation?.omitCharacterOutfitLabels===true?['character-labels-identity-only']:[])]);}
export function productionTextReference(frame,segment,ref,project){return textAssetBinding(frame,{id:segment.id+'@'+ref.slot,name:productionReferenceSubject(ref),role:ref['类型']==='设定卡'?'character':ref['类型'].includes('场景')?'scene':/道具/.test(ref['类型'])?'prop':'style',state:(project?productionReferenceOutfit(project,ref):ref['服装'])||ref['说明']||ref['段ID']||'',predecessor:ref['类型']==='上一段成图'});}
export function productionReferencePlan(project,frame,assets=[]){
 if(!frame.productionSegment&&!frame.productionBackground)return null;const s=productionSegment(project,frame.productionSegment||frame.productionBackground.replace(/-BG$/,''));if(!s)throw invalid('屏段来源缺失');if(s.pendingSourceFields)throw invalid('此屏段有待处理的源提示词更新，请先接受或保留本地版本');
 const refs=[],dependencies=[],missing=[];const byId=new Map(assets.map(a=>[a.id,a]));
 for(const ref of frame.productionBackground?[]:s.references.filter(r=>!obsoleteProductionReference(r))){
  if(productionTextReference(frame,s,ref,project))continue;
  if(ref.skipped){if(ref['必须'])missing.push('必需参考不能跳过');continue;}
  if(ref['类型']==='上一段成图'){const predecessor=project.productionPackage.episodes.find(e=>e.episode===s.episode).segments.find(v=>v.localId===ref['段ID']),prior=productionFrame(project,predecessor?.id),assetId=productionSourceAsset(prior);if(assetId)refs.push({assetId,name:ref['段ID']+' · 接续成图',role:'style'});else dependencies.push(prior?.id);continue;}
  const binding=ref.binding,asset=binding&&byId.get(binding.assetId);
  if(!asset){if(ref['必须'])missing.push([ref['人物'],ref['服装']].filter(Boolean).join(' · ')||ref['类型']);continue;}
  if(assetUnavailable(asset))throw invalid('所选素材被标记为不能使用：'+asset.name);
  if(binding.sourceType==='local'){if(binding.revisionId!=='local-sha256:'+binding.sha256)throw invalid('本地参考原件版本无效，请重新绑定：'+asset.name);}
  else if(!binding.revisionId||asset.library?.revisionId!==binding.revisionId||asset.library?.sha256!==binding.sha256)throw invalid('参考素材固定版本发生变化，请重新绑定：'+asset.name);
  refs.push({assetId:asset.id,name:ref['类型']==='设定卡'?[ref['人物'],ref['服装']].filter(Boolean).join(' · '):productionReferenceSubject(ref)||asset.name,role:ref['类型']==='设定卡'?'character':ref['类型'].includes('场景')?'scene':/道具/.test(ref['类型'])?'prop':'style'});
 }
 if(frame.productionBackground){const prior=productionFrame(project,s.id),assetId=productionSourceAsset(prior);if(assetId)refs.push({assetId,name:s.localId+' · 底图色调参考',role:'style'});}
 if(!frame.productionBackground)for(const ref of productionExtraReferenceRoles(project,frame,assets))if(!refs.some(r=>r.assetId===ref.assetId))refs.push(ref);
 if(missing.length)throw invalid('缺少必需设定卡：'+missing.join('；'));
 if(refs.length>60)throw invalid('附图超过60张');const seen=new Set();for(const ref of refs){if(seen.has(ref.assetId))throw invalid('不同附图槽位指向同一图片，请核对素材身份');seen.add(ref.assetId);}return {refs,dependencies:dependencies.filter(Boolean),segment:s};
}
export function prepareProductionFrame(project,frame,assets,{deferPanelIds=[],jobs=[]}={}){const plan=productionReferencePlan(project,frame,assets);if(!plan)return null;const episode=project.productionPackage.episodes.find(e=>e.episode===plan.segment.episode);if(!frame.productionBackground)for(const ref of plan.segment.references.filter(r=>r['类型']==='上一段成图'&&!r.skipped)){const previous=episode.segments.find(s=>s.localId===ref['段ID']),prior=productionFrame(project,previous?.id);if(prior&&(deferPanelIds.includes(prior.id)||jobs.some(j=>j.projectId===project.id&&j.panelId===prior.id&&['queued','running','awaiting_confirmation','recoverable'].includes(j.status)))){plan.dependencies=[...new Set([...plan.dependencies,prior.id])];plan.refs=plan.refs.filter(r=>r.name!==ref['段ID']+' · 接续成图');}}frame.referenceIds=plan.refs.map(r=>r.assetId);if(frame.generation)frame.generation.referenceRoles=plan.refs;return plan;}
export function applyProductionLettering(project,key,{regions,positions={},fontFamily='source-han-sans',confirmed=false,replace=false,adjustedTextIds=[],fontChanged=false}={},{coordinateBounds}={}){
 const segment=productionSegment(project,key),frame=productionFrame(project,key),episode=project.productionPackage.episodes.find(e=>e.episode===segment?.episode),page=project.pages.find(p=>p.panels.some(f=>f.id===frame?.id));if(!segment||!frame||!page)throw invalid('屏段不存在');if(!frame.imageAssetId)throw invalid('请先采用屏段成图，再定位和排字');
 const limit=coordinateBounds||{x:0,y:0,w:1,h:1};
 const valid=rect=>rect&&['x','y','w','h'].every(k=>Number.isFinite(rect[k]))&&rect.x>=limit.x-.00001&&rect.y>=limit.y-.00001&&rect.w>0&&rect.h>0&&rect.x+rect.w<=limit.x+limit.w+.00001&&rect.y+rect.h<=limit.y+limit.h+.00001;
 for(const pid of segment.panelIds)if(!valid(regions?.[pid]))throw invalid('格区超出了当前图片范围：'+pid);if(!confirmed)throw invalid('请确认格区和文字位置后排字');
 segment.regions=clone(regions);segment.positions=clone(positions);segment.layoutAssetId=frame.imageAssetId;segment.layoutConfirmedAt=new Date().toISOString();const mode=frame.generation?.promptSource==='post-lettering'?'clean':'empty',scale=frame.w/(episode.typography['参考画布宽']||1280),fontSize=(episode.typography['字号']||36)*scale;let count=0;
 for(const text of episode.texts.filter(t=>t['段ID']===segment.localId&&t['渲染']==='工具')){
  const exists=page.bubbles.find(b=>bubbleSourceTextIds(b).includes(text['文字ID'])&&!page.panels.find(p=>p.id===b.parentPanelId)?.productionGrid);if(exists&&dialogueSegments(exists).length){if(fontChanged&&!exists.locked)exists.fontFamily=fontFamily;continue;}if(exists&&!replace){if(adjustedTextIds.includes(text['文字ID'])){const pos=positions[text['文字ID']];if(!valid(pos))throw invalid('文字位置无效：'+text['文字ID']);if(exists.locked)throw invalid('请先解锁台词：'+text['文字ID']);const moved=applyBubbleEdit(exists,{type:'move',dx:frame.x+pos.x*frame.w-exists.x,dy:frame.y+pos.y*frame.h-exists.y}),resized=applyBubbleEdit(moved,{type:'resize',dx:Math.max(30,pos.w*frame.w)-moved.w,dy:Math.max(20,pos.h*frame.h)-moved.h});Object.assign(exists,resized);count++;}if(fontChanged&&!exists.locked)exists.fontFamily=fontFamily;continue;}
  const region=regions[text['格ID']],anchor=episode.anchors[text['锚点']]?.['中心']||[.5,.14],lines=text['分行']||[text['文本']];let width=Math.max(80,Math.min(frame.w*.48,Math.max(...lines.map(l=>[...l].length))*fontSize+fontSize)),height=Math.max(35,lines.length*fontSize*(48/36)+fontSize*.8);
  if(mode==='clean'&&!/字幕|旁白|人名|地点|时间/.test(text['类型']))({w:width,h:height}=roundBubbleSize(productionTextContent(text),fontSize,{maxSize:Math.min(frame.w,frame.h)}));
  let x=frame.x+(region.x+region.w*anchor[0])*frame.w-width/2,y=frame.y+(region.y+region.h*anchor[1])*frame.h-height/2;
  if(text['连泡'])y+=(text['连泡']['第几个']-1)*(height+12);const pos=positions[text['文字ID']];if(pos){if(!valid(pos))throw invalid('文字位置无效：'+text['文字ID']);x=frame.x+pos.x*frame.w;y=frame.y+pos.y*frame.h;}
  if(mode==='empty'&&!pos)throw invalid('空泡模式需要为每条台词确认文字框位置：'+text['文字ID']);
  const thought=/心声|意念/.test(text['类型']),caption=/字幕|旁白/.test(text['类型']);const w=pos?pos.w*frame.w:width,h=pos?pos.h*frame.h:height;
  const bubble={id:exists?.id||id('bubble'),parentPanelId:frame.id,shotId:frame.shotId,productionTextId:text['文字ID'],productionSegment:segment.id,productionGridId:text['格ID'],name:text['文字ID']+' · '+text['类型'],x:Math.max(0,Math.min(page.width-w,x)),y,w:Math.max(30,w),h:Math.max(20,h),text:productionTextContent(text),type:thought?'thought':caption?'caption':'speech',shape:mode==='empty'?'none':caption?'rounded-rect':thought?'burst':'oval',fillColor:'#ffffff',fillOpacity:mode==='empty'?0:1,outlineWidth:mode==='empty'?0:2,textColor:'#111111',fontFamily,fontWeight:500,fontSize,lineHeight:48/36,lineBreakMode:'auto',textFlowVersion:1,textAlign:'center',visible:true,locked:false,tail:{visible:mode==='clean'&&productionTailVisible(text,thought?'thought':caption?'caption':'speech'),side:({上:'top',下:'bottom',左:'left',右:'right'})[text['泡尾']?.['方向']]||'bottom',base:.5},speaker:text['说话人']||'',productionOriginal:clone(text)};
  if(exists)Object.assign(exists,bubble);else page.bubbles.push(bubble);count++;
 }return count;
}
