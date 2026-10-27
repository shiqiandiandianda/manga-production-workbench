import {createHash} from 'node:crypto';
import {episodeLayerProject} from '../public/episode-workspace.js';
import {pageEpisode} from '../public/episode-boards.js';
import {inspectAssetBindings} from '../public/asset-auto-bind.js';
import {projectLibraryAssets} from '../public/project-asset-library.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
const assetName=value=>String(value||'').normalize('NFKC').trim().toLowerCase();
const copy=value=>structuredClone(value),labels={character:'角色',scene:'场景',prop:'道具',style:'画风'};
export function buildAssetRequirements(project,episode,assets=[],{provider='external',includeMatched=false}={}){
 const page=project.pages.find(page=>pageEpisode(project,page)===Number(episode));if(!page)throw Object.assign(Error('当前话不存在'),{status:404});const scoped=episodeLayerProject(copy(project),page);ensureProjectPanelGeneration(scoped,assets);const preview=inspectAssetBindings(scoped,projectLibraryAssets(project,assets));
 const needs=preview.needs.filter(need=>includeMatched||!need.assetId).map(need=>{
  const shots=scoped.shots.filter(shot=>preview.shotNeeds.get(shot.id)?.has(need.id)||scoped.pages.some(page=>page.panels.some(panel=>panel.shotId===shot.id&&preview.panelNeeds.get(panel.id)?.has(need.id))));
  const usages=shots.map(shot=>({episode:Number(episode),unitId:shot.sourceFields?.['格ID']||shot.storyboard?.unitId||'E'+String(episode).padStart(3,'0')+'-'+String(shot.code).padStart(3,'0'),shotId:shot.id,sourceLocation:shot.sourceLocation||'',plot:shot.description.slice(0,4000)}));
  const evidence=usages.map(u=>u.unitId+(u.sourceLocation?'（'+u.sourceLocation+'）':'')+'：'+u.plot).join('\n').slice(0,12000),spec={width:1536,height:1024,transparent:false,views:need.role==='character'?'角色设定参考，完整人物正面、侧面与背面，保持同一身份与同一服装':need.role==='scene'?'场景主景，明确空间结构、入口及主要陈设':need.role==='prop'?'独立道具参考，主体完整，关键结构清晰':'画风参考'};
  const prompt=['制作漫画生产用'+labels[need.role]+'资产参考图。','资产名称：'+need.name,need.state?'本次服装/形态/状态：'+need.state:'',spec.views,'只制作这一项资产，不把不同资产或剧情镜头混在一张图中。','身份、服装、形态与结构按资料保持一致；原文未明确的外观属于原创候选设计，须人工确认，不能当作原著既定事实。','不画对白气泡、无关文字、编号或水印。',project.style?'画风：'+project.style:'',evidence?'原剧情依据（仅作外观和用途参考，不画成整段剧情）：\n'+evidence:''].filter(Boolean).join('\n').slice(0,16000);
  const stableId='req_'+createHash('sha256').update(JSON.stringify([project.id,need.role,assetName(need.name),need.state||''])).digest('hex').slice(0,24);
  const plan=project.assetProduction,explicit=plan?.needs?.[need.id],implicit=projectLibraryAssets(project,assets).filter(asset=>asset.center&&((asset.libraryRole===need.role&&assetName(asset.libraryName)===assetName(need.name))||asset.libraryRole==='style')).map(asset=>({assetId:asset.id,versionId:asset.center.versionId,version:asset.center.version,sha256:asset.center.sha256,name:asset.name,role:asset.libraryRole==='style'?'style':'content'}));
  const referenceImages=[...new Map((plan?[plan.styleReference,...(explicit?.references||[])].filter(Boolean):implicit).map(ref=>[ref.versionId,ref])).values()];
  const style=[project.style,plan?.styleGuide?'固定风格约定 v'+plan.styleVersion+'：'+plan.styleGuide:''].filter(Boolean).join('\n');
  const fullPrompt=[prompt,plan?.styleGuide?'固定风格约定 v'+plan.styleVersion+'（优先服从已确认参考）：\n'+plan.styleGuide:'',referenceImages.length?'参考图顺序与用途：\n'+referenceImages.map((ref,i)=>(i+1)+'. '+ref.name+' · '+(ref.role==='style'?'仅统一画风、线条、上色、材质':'对应资产的身份/建筑/空间参考；不擅自替换服装或推断未展示布局')+' · 固定版本 '+ref.versionId).join('\n'):'',explicit?.designNotes?'本项设定补充（新增且未经原图证明的部分须作为候选核对）：\n'+explicit.designNotes:'','同一资产变体保持结构与身份；参考图中的拼图、标题和版式不照抄，输出一张可用的单项资产候选。'].filter(Boolean).join('\n').slice(0,16000);
  return {stableId,workTitle:project.title,workExternalKey:project.id,role:need.role,name:need.name,state:need.state||'',aliases:need.aliases||[],description:need.reason,prompt:fullPrompt,style,sourceEvidence:evidence,spec:provider==='asset-workbench'?{...spec,width:1536,height:864}:spec,referenceImages,references:referenceImages.map(ref=>ref.versionId),needsConfirmation:['review','conflict'].includes(need.status)||need.hasState&&/未知|待确认|待设计|未指定/.test(need.state),usages,localNeedId:need.id,localStatus:need.status};
 });
 const payload={format:'comic-asset-requirements-v1',work:project.assetCenter?.workId?{id:project.assetCenter.workId}:{externalKey:project.id,title:project.title},provider,needs};payload.idempotencyKey='batch-'+createHash('sha256').update(JSON.stringify(payload)).digest('hex');return {...payload,episode:Number(episode)};
}
