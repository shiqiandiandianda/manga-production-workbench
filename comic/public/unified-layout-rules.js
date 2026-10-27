import {artworkFrame} from './artwork-framing.mjs';
import {id,clone,bounds} from './model.js';

/** This is packing of model-decided frame sizes, not a second artistic layout. */
export function generationPlans(episode,geometry){
 const byKey=new Map(geometry.panels.map(p=>[p.key,p]));
 return episode.segments.map(s=>{
  const frames=s.panelIds.map(key=>{const p=byKey.get(key);if(!p)throw Error('生成屏段缺少目标格号：'+key);return p;});
  const margin=40,gap=40,width=1280,inner=width-margin*2;
  let top=margin;const rects=frames.map(p=>{const w=p.w*inner/1280,h=p.h*inner/1280;const r={panelId:p.key,rect:{x:margin+(inner-w)/2,y:top,w,h}};top+=h+gap;return r;});
  const height=Math.ceil(top-gap+margin);
  if(height>16384)throw Error(s.localId+'按原格型容纳后超过16384px，请在制作资料阶段调整分屏；不会压扁格子或自动拆段');
  return {segmentId:s.id,localId:s.localId,imagePlan:{width,height,background:'white',overlap:false},unit:'normalized',coordinateSpace:'planned-image',panels:rects.map(p=>({panelId:p.panelId,rect:{x:p.rect.x/width,y:p.rect.y/height,w:p.rect.w/width,h:p.rect.h/height}}))};
 });
}

export function buildPreplannedProject(original,script,geometry){
 const project=clone(original),ep=project.productionPackage.episodes.find(e=>e.episode===Number(script.episode));
 if(!ep)throw Error('前期规划话数不存在');
 const plans=generationPlans(ep,geometry),contract=clone(script.layoutRuleContract),now=new Date().toISOString();
 project.id=id('project');project.revision=0;project.created=now;project.updated=now;
 project.title=(original.title+' · 第'+ep.episode+'话统一版式准备').slice(0,180);
 project.layoutRuleBindings||={};project.layoutRuleBindings[ep.episode]={contract,scriptId:script.id,geometry:clone(geometry),targetPanels:clone(geometry.panels),generationSegments:plans,created:now};
 project.layoutPlanningSource={sourceProjectId:original.id,sourceRevision:original.revision,scriptId:script.id,episode:ep.episode,noImagesGenerated:true};
 for(const plan of plans){
  const s=ep.segments.find(s=>s.id===plan.segmentId),f=project.pages.flatMap(p=>p.panels).find(f=>f.id===s.panelId),page=project.pages.find(p=>p.panels.includes(f));
  if(f.imageAssetId)throw Error('已有图片不能应用前期框位，请使用成图裁格重排');
  s.plannedRegions=Object.fromEntries(plan.panels.map(p=>[p.panelId,clone(p.rect)]));s.imagePlan=clone(plan.imagePlan);s.layoutDesignVersion='unified-'+contract.digest.slice(0,16);
  // Retain the imported design snapshot as source. The explicit binding is authoritative.
  s.unifiedLayoutRuleDigest=contract.digest;
  const height=f.w*plan.imagePlan.height/plan.imagePlan.width,delta=height-f.h;f.h=height;
  if(page.storyboard?.projection==='production-screen')page.height=Math.ceil(Math.max(height+f.y,page.height+delta));
 }
 for(const record of ep.panelRecords)record.unifiedDesignRect=clone(geometry.panels.find(p=>p.key===record.id));
 if(project.episodeBoards)project.episodeBoards.sharedKey=project.id;
 delete project.deletedAt;return project;
}

export function unifiedGenerationInstructions(project,panel){
 const grid=panel.productionGrid||panel.panelSlice;
 if(grid){const ep=project.productionPackage?.episodes.find(e=>e.panelRecords.some(r=>r.id===grid.panelId&&r.segmentId===grid.segmentId)),binding=project.layoutRuleBindings?.[ep?.episode],target=binding?.targetPanels?.find(p=>p.key===grid.panelId);if(target&&grid.placementSource==='assistant-preview'){const box=bounds(panel);return '\n【本格采用已确认的排版助手预览】\n只生成 '+grid.panelId+' 这一格，目标尺寸 '+Math.round(box.w)+'×'+Math.round(box.h)+'，严格保持此宽高比；下方源提示词的旧画幅和排版尺寸以本目标为准。人物、剧情、台词、原构图和参考绑定保持原文。规则：'+binding.contract.name+'；冻结版本：'+binding.contract.version+'。\n';}}
 if(!panel.productionSegment)return '';
 const ep=project.productionPackage?.episodes.find(e=>e.segments.some(s=>s.id===panel.productionSegment)),binding=project.layoutRuleBindings?.[ep?.episode];
 if(!binding)return '';
 const plan=binding.generationSegments.find(s=>s.segmentId===panel.productionSegment);
 if(!plan||ep.segments.find(s=>s.id===panel.productionSegment)?.unifiedLayoutRuleDigest!==binding.contract.digest)throw Error('统一排版规划与当前屏段不一致，请重新规划');
 return '\n\n【统一版式约束：框位与尺寸以此段为准；下方源提示词的旧排数、格宽高与框位不再作为布局依据，人物、剧情、台词、构图内容仍原样保留】\n'
  +'选用规则：'+binding.contract.name+'；冻结版本：'+binding.contract.version+'；规则摘要：'+binding.contract.digest+'。\n'
  +'整屏尺寸 '+plan.imagePlan.width+'×'+plan.imagePlan.height+'，白底、直边、各格分离留白缝，不在生成屏段内叠格。严格按以下归一化计划矩形出图，保留格ID、顺序和宽高比，不拉伸或压扁人物，不增加或拆分镜头。计划框不是裁区；成图后须实际核对。\n'
  +JSON.stringify(plan.panels)+'\n最终画格比例：'+JSON.stringify(binding.targetPanels.filter(p=>plan.panels.some(q=>q.panelId===p.key)).map(p=>({gridId:p.key,w:p.w,h:p.h})))+'\n';
}

export function assertNativeAspect(script,geometry){
 if(!script.layoutRuleContract)return;
 if(geometry.layoutRuleDigest!==script.layoutRuleContract.digest)throw Object.assign(Error('排版规则与冻结版本不一致'),{status:400});
 for(const shot of script.shots){const a=artworkFrame(shot),p=geometry.panels.find(p=>p.key===shot.key);if(a&&(!p||Math.abs(p.h-p.w*a.height/a.width)>1.01))throw Object.assign(Error('排版框与已确认的目标框形冲突：'+shot.key+'；请在助手中修正框位，不会重新生图'),{status:400});}
}
