import {HAND_CARD_RULES,CHARACTER_CARD_LAYOUT_RULES,CHARACTER_CARD_LAYOUT_VERSION} from '../public/hand-card-rules.js';
import {asset2DStyle,propAssetPrompt,sceneFrontPrompt} from './scene-asset-prompts.mjs';
import {characterAppearancePrompt,characterAppearanceSettings,characterRole} from './character-appearance.mjs';
// Asset design is a separate workflow from panel generation. Images stay candidates
// until a person confirms them, and downstream requests retain dependency versions.
import {createHash} from 'node:crypto';

const clone=value=>structuredClone(value);
const KINDS=['major','simple','crowd','scene','prop','style','other'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=value=>typeof value==='string'?value.trim():'';
const imageId=value=>typeof value==='string'&&/^asset_[0-9a-f-]{36}$/.test(value);
const check=(condition,message,status=400)=>{if(!condition){const error=Error(message);error.status=status;throw error;}};
const now=()=>new Date().toISOString();
const stageDefs={
 major:[['face','脸部 + 发型四视图',[]],['body','白衣全身三视图',['face']],['hands','手部特写 + 表情',['face','body']],['role-card','剧情角色卡',['face','body','hands']]],
 simple:[['role-card','普通人物角色卡',[]]],crowd:[['crowd-card','群像人脸与服装卡',[]]],
 scene:[['scene-card','场景设定图',[]]],prop:[['prop-card','道具设定图',[]]],style:[['style-card','统一画风参考',[]]],other:[['asset-card','资产设定图',[]]]
};

export function assetWorkflowKind(asset){
 if(KINDS.includes(asset.workflow?.kind)&&asset.workflow.selection!=='auto')return asset.workflow.kind;
 if(asset.type==='crowd'||asset.roleClass==='crowd'||asset.type==='character'&&/群像|人群/u.test(asset.name))return 'crowd';
 if(asset.type!=='character')return KINDS.includes(asset.type)?asset.type:'other';
 const episodes=new Set((asset.episodeNumbers||[]).map(Number).filter(n=>Number.isInteger(n)&&n>0));
 return asset.roleClass==='major'||(asset.appearanceScopeStatus!=='client-estimate'&&episodes.size>=3)?'major':'simple';
}
export function assetSourceKey(asset){return hash({name:asset.name,type:asset.type,description:asset.description||'',prompt:asset.prompt||'',roleClass:asset.roleClass||''});}
export function initializeProductionAsset(input){
 const asset=clone(input),kind=assetWorkflowKind(asset);
 if(asset.workflow?.kind&&asset.workflow.kind!==kind&&asset.stages?.length){asset.productionHistory=[...(asset.productionHistory||[]),{workflow:clone(asset.workflow),stages:clone(asset.stages),archived:now()}].slice(-10);asset.stages=[];}
 asset.workflow={version:1,selection:'auto',outfitDescription:'',propDescription:'',crowdRequirements:'',extraReferenceIds:[],...asset.workflow,kind};
 asset.stages||=[];
 for(const [id,label,dependencies] of stageDefs[kind])if(!asset.stages.some(s=>s.id===id))asset.stages.push({id,label,dependencies,version:0,status:'pending',confirmedAssetId:null,candidates:[]});
 return asset;
}
function stageFor(asset,id){const stage=asset.stages.find(s=>s.id===id&&!s.archived);check(stage,'资产生产步骤不存在',404);return stage;}
function dependencySnapshot(asset,stage){return (stage.dependencies||[]).map(id=>{const dependency=stageFor(asset,id);return {stageId:id,version:dependency.version||0,assetId:dependency.confirmedAssetId||null,status:dependency.status};});}
function majorIdentityReferences(project){return (project.productionAssets||[]).flatMap(raw=>{const a=initializeProductionAsset(raw);if(a.workflow.kind!=='major')return [];const face=a.stages.find(s=>s.id==='face');return face?.status==='confirmed'&&face.confirmedRequestKey===stageKey(project,a,face)?[{assetId:face.confirmedAssetId,version:face.version,name:a.name}]:[];});}
function stageKey(project,asset,stage){const card=stage.id.startsWith('role-card');return hash({source:assetSourceKey(asset),style:project.style||'',kind:asset.workflow.kind,stage:stage.id,notes:stage.notes||'',...(stage.componentReferenceIds?.length||stage.componentReferenceNotes?{componentReferenceIds:stage.componentReferenceIds||[],componentReferenceNotes:stage.componentReferenceNotes||''}:{}),...(card?{outfit:stage.outfitDescription??asset.workflow.outfitDescription,props:stage.propDescription??asset.workflow.propDescription}:{}),...(asset.workflow.kind==='crowd'?{crowd:asset.workflow.crowdRequirements,majorIdentityReferences:(asset.workflow.extraReferenceIds||[]).length?[]:majorIdentityReferences(project)}:{}),extraReferenceIds:asset.workflow.extraReferenceIds||[],dependencySnapshot:dependencySnapshot(asset,stage),styleReferenceIds:(project.references||[]).filter(r=>r.role==='style').map(r=>r.assetId),...(characterAppearancePrompt(asset)?{appearance:characterAppearancePrompt(asset)}:{})});}
function freshAsset(project,raw){const asset=initializeProductionAsset(raw);for(let pass=0;pass<asset.stages.length;pass++)for(const stage of asset.stages){const key=stageKey(project,asset,stage);if(stage.status==='confirmed'&&stage.confirmedRequestKey!==key){stage.status='stale';stage.staleReason='设定、画风或参考依赖已改变，请重新核验';}for(const candidate of stage.candidates)if(candidate.requestKey!==key)candidate.status='stale';}return asset;}
function invalidateDownstream(asset,changedId){const changed=new Set([changedId]);let progress=true;while(progress){progress=false;for(const stage of asset.stages)if(!changed.has(stage.id)&&(stage.dependencies||[]).some(id=>changed.has(id))){changed.add(stage.id);progress=true;}}for(const stage of asset.stages.filter(s=>s.id!==changedId&&changed.has(s.id))){if(stage.confirmedAssetId)stage.status='stale';for(const candidate of stage.candidates||[])candidate.status='stale';stage.staleReason='上游基础图已改变，请重新生成或核验';}return asset;}
function invalidateAll(asset,reason){for(const stage of asset.stages||[]){if(stage.confirmedAssetId)stage.status='stale';for(const candidate of stage.candidates||[])candidate.status='stale';stage.staleReason=reason;}}

export function mergeProductionAssets(existing=[],incoming=[]){
 const merged=existing.map(initializeProductionAsset),byId=new Map(merged.map(a=>[a.id,a]));
 for(const item of incoming){const prior=byId.get(item.id);if(!prior){const added=initializeProductionAsset(item);merged.push(added);byId.set(added.id,added);continue;}
  const previousKey=assetSourceKey(prior),previousEpisodes=prior.episodeNumbers||[],previousScope=prior.appearanceScopeStatus,keep={workflow:prior.workflow,stages:prior.stages,productionHistory:prior.productionHistory};
  Object.assign(prior,clone(item),keep);const episodes=previousScope==='client-estimate'&&item.appearanceScopeStatus&&item.appearanceScopeStatus!=='client-estimate'?(item.episodeNumbers||[]):[...previousEpisodes,...(item.episodeNumbers||[])];prior.episodeNumbers=[...new Set(episodes)].sort((a,b)=>Number(a)-Number(b));
  if(assetSourceKey(prior)!==previousKey)invalidateAll(prior,'来源人物或资产描述已改变，请重新核验');
 }
 validateProductionAssets(merged);return merged;
}

export function validateProductionAssets(assets){
 check(Array.isArray(assets)&&assets.length<=2000,'拆解资产列表无效或超过 2000 项');const ids=new Set();
 for(const a of assets){check(a&&typeof a==='object'&&typeof a.id==='string'&&a.id.trim()&&a.id.length<=180&&!ids.has(a.id),'拆解资产编号重复或无效');ids.add(a.id);check(text(a.name)&&a.name.length<=180,'拆解资产需要名称');
  for(const field of ['description','prompt'])check(a[field]===undefined||typeof a[field]==='string'&&a[field].length<=20000,'资产描述或提示词过长');
  if(!a.workflow&&!a.stages)continue;check(a.workflow?.version===1&&KINDS.includes(a.workflow.kind),'资产生产流程无效');
  for(const field of ['outfitDescription','propDescription','crowdRequirements'])check(a.workflow[field]===undefined||typeof a.workflow[field]==='string'&&a.workflow[field].length<=10000,'资产设计描述无效');
  check(Array.isArray(a.workflow.extraReferenceIds||[])&&(a.workflow.extraReferenceIds||[]).length<=10&&(a.workflow.extraReferenceIds||[]).every(imageId),'资产生产参考图无效');
  check(Array.isArray(a.stages)&&a.stages.length<=40,'资产生产步骤无效或过多');const stageIds=new Set(a.stages.map(s=>s.id));check(stageIds.size===a.stages.length,'资产生产步骤重复');
  for(const s of a.stages){if(s.componentReferenceIds!==undefined)check(s.component&&Array.isArray(s.componentReferenceIds)&&s.componentReferenceIds.length<=2&&s.componentReferenceIds.every(imageId),'上游组件参考格式无效');if(s.componentReferenceNotes!==undefined)check(typeof s.componentReferenceNotes==='string'&&s.componentReferenceNotes.length<=4000,'上游组件说明无效');check(!s.component||['face','views','hands','scene','prop'].includes(s.component)&&s.id==='component-'+s.component,'资产组件类型无效');check(s&&text(s.id)&&s.id.length<=100&&text(s.label)&&s.label.length<=180&&Array.isArray(s.dependencies)&&s.dependencies.length<=10&&s.dependencies.every(id=>stageIds.has(id)&&id!==s.id),'资产步骤依赖无效');check(Number.isInteger(s.version)&&s.version>=0&&['pending','candidate','confirmed','stale'].includes(s.status),'资产步骤状态无效');check(!s.confirmedAssetId||imageId(s.confirmedAssetId),'已确认资产编号无效');check(Array.isArray(s.candidates)&&s.candidates.length<=40&&s.candidates.every(c=>imageId(c.assetId)&&['candidate','stale'].includes(c.status)&&Array.isArray(c.dependencySnapshot)&&typeof c.requestKey==='string'),'资产候选数据无效');}
  const visiting=new Set(),visited=new Set();function visit(id){check(!visiting.has(id),'资产步骤存在循环依赖');if(visited.has(id))return;visiting.add(id);for(const next of a.stages.find(s=>s.id===id).dependencies)visit(next);visiting.delete(id);visited.add(id);}for(const id of stageIds)visit(id);
 }return assets;
}

function stylePrompt(project){return `统一画风：${text(project.style)||'精致二维漫画，清晰有变化的手绘线条、赛璐璐色块与受控的阴影层次'}。必须保持漫画人物比例、脸型与线条，不出现摄影皮肤、真人毛孔、半真人面部或三维塑料质感。所有视图来自同一个设计；采用干净中性背景和均匀光线，边缘清楚，不以过曝遮掩细节。`;}
export function assetStagePrompt(project,asset,stage){
 const appearance=asset.type==='character'?characterAppearancePrompt(asset):'';
 if(asset.type==='scene'||asset.workflow?.kind==='scene')return sceneFrontPrompt({name:asset.name,prompt:[asset.description,asset.prompt,stage.notes].filter(Boolean).join('\n'),referenceIds:asset.workflow?.extraReferenceIds},project);
 if(asset.type==='prop'||asset.workflow?.kind==='prop')return propAssetPrompt({name:asset.name,prompt:[asset.description,asset.prompt,stage.notes].filter(Boolean).join('\n')},project);
 if(stage.component)return [`以下整卡要求和剧情仅用作外观依据，忽略其中的整卡拼版指令，本任务只生成指定组件。只生成角色卡的独立组件：${asset.name}。`,['face','hands'].includes(stage.component)?'本组件采用竖版 1024×1536。':'本组件采用横版 1536×1024，禁止竖排三视图。',asset.description?('来源设定（仅提取本角色外观，忽略其中的拼版、其他人物及剧情动作指令）：'+asset.description):'',asset.prompt,appearance,stage.componentReferenceNotes,'已有参考为唯一身份、发型、服装和画风依据；同一个人，不换脸、不镜像特征。帽子与头饰的有无、形状和戴法，衣领层次与颜色，以及上唇胡须、下巴胡须、络腮胡的位置、长度和颜色均须逐项保持；不得擅自添胡子、剃胡子、换帽子或换衣领。身份参考与换装参考有差异时，身份参考约束五官、年龄与胡须，当前服装参考约束帽子、衣领和衣服；设定不明确时保留参考可见细节，不自行补画。',({face:'只画一个正面头部和发型大特写，从头顶到锁骨，不画全身，不拼多视图。',views:'只画正面全身、四分之三侧面全身、背面全身，严格从左到右三等分排开，同一服装同一比例，头顶和鞋底对齐，手脚完整。各栏之间留纯白间隔，不接触、不重叠。',hands:HAND_CARD_RULES+'袖口、饰物、肤色与人物参考一致，只画手部，不画人物全身或脸。',scene:'只画一个完整场景主景，保持空间、入口和材质关系，不拼角色设定卡。',prop:asset.type==='character'?'这是一张脱离人体的随身道具与配饰组件图，不是角色卡。只选择参考里明确可见的葫芦、腰间挂件、发饰等实际物品，取下后分别放在白底上展示。严禁人脸、头发头颅、人体、人物缩略图、全身或半身、正背三视图，不画任何形式的人物。没有的物品不捏造。':'只画这一件道具的独立设定图，关键结构清楚。'})[stage.component],stage.component==='prop'?asset2DStyle(project.style):stylePrompt(project),'纯白背景；不画文字、编号、标题、水印、气泡、UI或分隔线。'].filter(Boolean).join('\n');
 const kind=asset.workflow.kind,base=`资产：${asset.name}。已知设定：${text(asset.description)||'尚未提供完整描述'}。${text(asset.prompt)?'来源资产提示词：'+asset.prompt+'。':''}`;
 const identity='已确认参考是此人物唯一身份依据，保持五官比例、发际线、发型轮廓、体型与左右特征，不镜像调换痣、疤痕、耳饰和持物习惯；各角度不得变成不同的人。';
 let plan='';
 const species='物种与原形态以已知设定为准。上述人类脸型、发型、白衣服和手部要求只适用于人形人物；明确为蛇、兽类或灵虫的角色必须保持原生结构，不新增人类四肢或人类服装。非人形的基础图对应为头部多视图、自然全身比例多视图、原生附肢或鳞甲细节与表情；无相关附肢时只展示真实存在的结构。';
 if(kind==='major'&&stage.id==='face')plan='只生成一张脸部与发型基础设定图。四个等大的近景视图依次为正面、侧面、背面、四分之三侧面；完整保留头顶发型、耳朵、下巴和后脑发束。用同一中性表情和一致年龄，正面身份是其他角度的同一人，背面不额外画脸。先确定原创脸型与头发，不加入剧情服装、道具或戏剧光效。';
 else if(kind==='major'&&stage.id==='body')plan=`${identity}只生成一张身体比例基础图，使用已确认的脸部四视图。三个等大的站立全身视图依次为正面、侧面、背面；从头顶到鞋底完整展示，同一身高、肩宽、体型和四肢长度，同一站立水平线。穿简单、不透明的普通白衣与白色长裤、朴素鞋履，用于判断身高比例，不穿剧情华服或盔甲，不裸露，不以透视夸大身材。`;
 else if(kind==='major'&&stage.id==='hands')plan=`${identity}只生成一张手部特写与表情基础设定图，使用已确认的脸图和身体比例图。左侧手部区域按以下规则排版：${HAND_CARD_RULES}；右侧是同一角色的中性、喜悦、愤怒、惊讶、忧虑、坚定表情近景，变化来自眉眼嘴角，不改变身份。服装继续采用普通白衣，不添加剧情特定道具。`;
 else if(kind==='major')plan=`${identity}使用已确认的脸部、全身、手部参考，按下列统一版式生成剧情角色卡。${CHARACTER_CARD_LAYOUT_RULES}\n剧情服装：${text(stage.outfitDescription??asset.workflow.outfitDescription)}。剧情道具与手势补充：${text(stage.propDescription??asset.workflow.propDescription)||'没有额外指定道具，不捏造物品'}。三个全身视图与四手的材质、颜色、纹样、扣系结构必须一致。`;
 else if(kind==='simple')plan=`一次出图生成一张完整的普通人物角色卡。所有栏目在同一张图内一次画完，不拆分组件任务，不生成组件后拼接。${CHARACTER_CARD_LAYOUT_RULES}\n${identity}根据已知设定设计同一原创人物，人物不要与其他主要角色过于相似。${text(asset.workflow.outfitDescription)?'服装要求：'+asset.workflow.outfitDescription+'。':''}${text(asset.workflow.propDescription)?'道具要求：'+asset.workflow.propDescription+'。':''}来源描述和参考图中的其他拼版只用于外观依据，最终栏目和位置严格采用上述统一版式。`;
 else if(kind==='crowd')plan=`生成一张群像组合人物卡。左侧是严格3×3的九宫格人脸特写，按阅读顺序标注A01至A09；九人发型、脸型、眉眼比例、表情和默认年龄段均要有明显差异，不能是同一张脸换发型，不得与主要角色参考高度相似。右侧排列九个颈部以下的完整服装身体设计，按顺序标注B01至B09，A01对应B01依次类推；身体从颈口到鞋底，不能出现头部或面部，必须包含双手、双脚与鞋，表现为完整衣服造型展示而非伤口或恐怖断头。身材、服装搭配和站姿各有区别，服装符合剧情年代与身份，九人共用统一漫画画风和相同制图尺度。特殊要求：${text(asset.workflow.crowdRequirements)||'九人来自不同年龄段，保持性别和身份符合已知设定'}。若设定明确限定同龄群体，遵守该范围并以脸型、发型、表情和体型区分，不擅自加入老人或儿童。编号必须一对一，不能缺号、错配或复制同一个造型。`;
 else if(kind==='scene')plan='生成一张可复用场景设定图：主区域全景、清楚的入口出口与层级关系，以及必要的关键地标局部。以同一建筑或空间的合理结构为依据，保持材质、尺度、天气和光线一致，避免把多个无关场所拼在一起。不添加未指定的人物，不改变已知地理关系。';
 else if(kind==='prop')plan='生成一张道具资产设定图：主视图、侧视图、背面或关键构造细节，物体轮廓完整，尺度、材质、纹样与使用结构一致。道具状态按已知设定呈现，不捏造其功能，不加入持有者整个人物或剧情场景。';
 else if(kind==='style')plan='生成一张统一漫画画风参考图，清楚展示人物线条、脸部绘制方式、服装材质、环境色块和阴影表现。风格用于后续资产一致性，不把此图中的人物当作剧情角色。';
 else plan='生成一张独立可复用资产设计图，清楚展示已知外形、材质、尺度和必要细节，不添加来源没有提供的剧情事件。';
  return [base,plan,appearance,...(['major','simple','crowd'].includes(kind)?[species]:[]),stylePrompt(project),text(stage.notes)?'本步骤补充设计：'+stage.notes+'。':'','这是一张资产设计拼版，可以使用清楚的分区排版；群像仅允许指定A/B资产编号。不得绘制对白气泡、剧情台词、宣传标题、水印、无关文字或界面截图。不要用设计图的多个视图表示连续剧情动作。'].filter(Boolean).join('\n');
}
const dimensionsFor=(kind,stageId)=>kind==='scene'?{width:2048,height:1152}:kind==='prop'?{width:1536,height:1024}:stageId==='body'?{width:1536,height:1024}:{width:2048,height:1024};
export function prepareAssetGeneration(project,input,assets=[]){
 const expected=input.expectedRevision??input.revision;check(Number.isInteger(expected)&&expected===project.revision,'工程已改变，请刷新资产状态后重试',409);
 check(['codex','jimeng'].includes(input.provider),'请选择 Codex 或即梦');const raw=(project.productionAssets||[]).find(a=>a.id===input.assetId);check(raw,'拆解资产不存在',404);const asset=freshAsset(project,raw),stage=stageFor(asset,input.stageId);
 const dependencies=dependencySnapshot(asset,stage);check(dependencies.every(d=>d.status==='confirmed'&&d.assetId),'请先确认所有上游基础图；过期图不能用于正式生成',409);
 if(asset.workflow.kind==='major'&&stage.id.startsWith('role-card'))check(text(stage.outfitDescription??asset.workflow.outfitDescription),'请填写当前剧情服装描述，再生成剧情角色卡');
 check(text(asset.description)||text(asset.prompt),'缺少资产设定，请先补充人物、场景或道具描述');
 const byId=new Map(assets.map(a=>[a.id,a])),referenceRoles=[];const add=(id,role,name)=>{check(byId.has(id),'参考图片不存在，请重新绑定：'+name,409);const image=byId.get(id);check(text(image.filePath),'参考图片没有可读取的原始路径：'+name,409);if(!referenceRoles.some(r=>r.assetId===id))referenceRoles.push({assetId:id,role,name});};
 for(const d of dependencies)add(d.assetId,'character',asset.name+' · 已确认'+stageFor(asset,d.stageId).label);
 for(const id of stage.componentReferenceIds||[])add(id,'character',asset.name+' · 本次已完成上游组件参考');
 for(const id of asset.workflow.extraReferenceIds||[])add(id,({major:'character',simple:'character',crowd:'character',scene:'scene',style:'style',prop:'prop'})[asset.workflow.kind]||'prop','人工指定资产参考');
 if(asset.workflow.kind==='crowd'&&!(asset.workflow.extraReferenceIds||[]).length)for(const main of majorIdentityReferences(project))add(main.assetId,'character','主要人物'+main.name+'身份对照：仅用于避免脸和发型近似，群像不要复制此人物');
 for(const ref of project.references||[])if(ref.role==='style')add(ref.assetId,'style',ref.name||'统一画风');
 check(referenceRoles.length<=(stage.componentReferenceNotes?5:10),stage.componentReferenceNotes?'当前组件最多使用5张参考图，请减少人工或画风参考':'资产生产最多使用 10 张参考图，请减少人工参考');
 const dimensions=stage.component?(['face','hands'].includes(stage.component)?{width:1024,height:1536}:{width:1536,height:1024}):dimensionsFor(asset.workflow.kind,stage.id),prompt=assetStagePrompt(project,asset,stage),requestKey=stageKey(project,asset,stage);
 const stageSnapshot={assetId:asset.id,stageId:stage.id,version:stage.version,sourceKey:assetSourceKey(asset),requestKey,dependencySnapshot:dependencies};
 const contract={kind:asset.workflow.kind,stage:stage.id,allowLayoutDividers:true,allowAssetCodes:asset.workflow.kind==='crowd',dimensions,transparentBackground:false,...(!stage.component&&stage.id.startsWith('role-card')?{characterCardLayoutVersion:CHARACTER_CARD_LAYOUT_VERSION}:{})};
 const bridgeInput={kind:'asset-production',action:'generate',projectId:project.id,projectTitle:project.title,shot:{code:asset.id+':'+stage.id,title:asset.name+' · '+stage.label,description:prompt,productionPrompt:prompt,shotSize:'资产设定图',cameraAngle:'正交多视图',dialogue:'',referenceIds:referenceRoles.map(r=>r.assetId),embeddedTexts:[],assetProductionContract:contract},style:['scene','prop'].includes(asset.type)||['scene','prop'].includes(asset.workflow.kind)||stage.component==='prop'?asset2DStyle(project.style):project.style||'',panel:{x:0,y:0,w:dimensions.width,h:dimensions.height,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'panel',border:0,feather:0},referenceRoles};
 return {asset,stage,prompt,provider:input.provider,projectId:project.id,expectedRevision:expected,referenceIds:referenceRoles.map(r=>r.assetId),referencePaths:referenceRoles.map(r=>byId.get(r.assetId).filePath),referenceRoles,dimensions,stageSnapshot,requestKey,bridgeInput};
}

export function applyAssetResult(input,request,result){
 check(imageId(result.assetId),'生成结果需要已登记的真实图片编号');const project=clone(input),index=(project.productionAssets||[]).findIndex(a=>a.id===(request.asset?.id||request.stageSnapshot?.assetId));check(index>=0,'生成资产已删除；结果保留在图片库',409);
 const asset=freshAsset(project,project.productionAssets[index]),stage=stageFor(asset,request.stage?.id||request.stageSnapshot.stageId);const stale=result.stale===true||stageKey(project,asset,stage)!==request.requestKey||stage.version!==request.stageSnapshot.version;
 const candidate={assetId:result.assetId,jobId:result.jobId||null,requestKey:request.requestKey,dependencySnapshot:clone(request.stageSnapshot.dependencySnapshot),status:stale?'stale':'candidate',source:result.source||'generated',created:result.created||now()};
 if(!stage.candidates.some(c=>c.assetId===candidate.assetId&&c.requestKey===candidate.requestKey))stage.candidates=[...stage.candidates,candidate].slice(-40);
 if(!stage.confirmedAssetId)stage.status=stale?'stale':'candidate';project.productionAssets[index]=asset;return {project,assetId:asset.id,stageId:stage.id,stale,candidate};
}

export function applyAssetProductionAction(input,action,assets=[]){
 const expected=action.expectedRevision??action.revision;check(Number.isInteger(expected)&&expected===input.revision,'工程已改变，请刷新资产状态后重试',409);
 if(action.type==='create-editable-card'){
  check(text(action.assetId)&&text(action.name)&&text(action.description),'资产编号、名称和要求不能为空');
  check(['character','scene','prop'].includes(action.role),'资产类型无效');
  check(Array.isArray(action.referenceIds)&&action.referenceIds.length<=3&&action.referenceIds.every(id=>assets.some(a=>a.id===id)),'资产参考无效');
  const project=clone(input);project.productionAssets||=[];
  if(project.productionAssets.some(a=>a.id===action.assetId))return project;
  check(action.characterOutputMode===undefined||['card','components'].includes(action.characterOutputMode),'人物输出方式无效');const single=action.role==='character'&&action.characterOutputMode==='card',components=action.role==='character'?['face','views','hands','prop']:[action.role];
  project.productionAssets.push(initializeProductionAsset({id:action.assetId,type:action.role,name:action.name,description:action.description,prompt:action.prompt||'',workflow:{version:1,kind:action.role==='character'?'simple':action.role,selection:'manual',extraReferenceIds:action.referenceIds},...characterAppearanceSettings(action),characterOutputMode:single?'card':'components',stages:single?[]:components.map(component=>({id:'component-'+component,label:({face:'脸部与发型',views:'正侧背全身',hands:'四手参考',scene:'场景主景',prop:'道具设定'})[component],component,dependencies:[],version:0,status:'pending',confirmedAssetId:null,candidates:[]}))}));
  validateProductionAssets(project.productionAssets);return project;
 }
 const project=clone(input),index=(project.productionAssets||[]).findIndex(a=>a.id===action.assetId);check(index>=0,'拆解资产不存在',404);let asset=freshAsset(project,project.productionAssets[index]);const byId=new Map(assets.map(a=>[a.id,a]));
 if(action.type==='configure-component-references'){const stage=stageFor(asset,action.stageId);check(stage.component,'只能为独立组件配置上游参考');check(Array.isArray(action.componentReferenceIds)&&action.componentReferenceIds.length<=2&&action.componentReferenceIds.every(id=>imageId(id)&&byId.has(id)),'上游组件参考无效');check(typeof action.componentReferenceNotes==='string'&&action.componentReferenceNotes.length<=4000,'上游组件说明无效');const oldKey=stageKey(project,asset,stage);stage.componentReferenceIds=[...new Set(action.componentReferenceIds)];stage.componentReferenceNotes=action.componentReferenceNotes;if(stageKey(project,asset,stage)!==oldKey){for(const c of stage.candidates)c.status='stale';if(stage.status==='confirmed')stage.status='stale';}project.productionAssets[index]=asset;validateProductionAssets(project.productionAssets);return project;}
 if(action.type==='configure'){
   const appearance=characterAppearanceSettings(action);if(Object.entries(appearance).some(([key,value])=>(asset[key]||'')!==value)){Object.assign(asset,appearance);invalidateAll(asset,'人物定位或外观要求已改变；原图保留，请核对新候选');}
  const kind=action.kind||asset.workflow.kind;check(KINDS.includes(kind),'资产流程类型无效');const previousStageKeys=new Map(asset.stages.map(s=>[s.id,stageKey(project,asset,s)]));if(action.kind)asset.workflow.selection='manual';
  if(kind!==asset.workflow.kind){asset.productionHistory=[...(asset.productionHistory||[]),{workflow:clone(asset.workflow),stages:clone(asset.stages),archived:now()}].slice(-10);asset.workflow.kind=kind;asset.stages=[];asset=initializeProductionAsset(asset);}
  for(const field of ['outfitDescription','propDescription','crowdRequirements'])if(action[field]!==undefined){check(typeof action[field]==='string'&&action[field].length<=10000,'设计描述过长');asset.workflow[field]=action[field];}
  if(action.description!==undefined){check(typeof action.description==='string'&&action.description.length<=20000,'资产描述过长');if(asset.description!==action.description){asset.description=action.description;invalidateAll(asset,'资产设定已修改，请重新核验');}}
  if(action.extraReferenceIds!==undefined){check(Array.isArray(action.extraReferenceIds)&&action.extraReferenceIds.length<=10&&action.extraReferenceIds.every(id=>imageId(id)&&byId.has(id)),'请选择已登记的参考图片');asset.workflow.extraReferenceIds=[...new Set(action.extraReferenceIds)];}
  for(const s of asset.stages)if(previousStageKeys.has(s.id)&&previousStageKeys.get(s.id)!==stageKey(project,asset,s)){if(s.confirmedAssetId)s.status='stale';for(const c of s.candidates)c.status='stale';s.staleReason='服装、道具、流程或参考设定已修改';}
 }else if(action.type==='add-outfit'){
  check(asset.workflow.kind==='major','只有主要角色使用多套剧情角色卡');check(text(action.label)&&text(action.outfitDescription),'请填写角色卡名称与剧情服装');check(asset.stages.length<40,'剧情角色卡数量过多');
  const id='role-card-'+hash({label:action.label,outfit:action.outfitDescription,created:now(),count:asset.stages.length}).slice(0,12);asset.stages.push({id,label:action.label.slice(0,180),outfitDescription:action.outfitDescription.slice(0,10000),propDescription:String(action.propDescription||'').slice(0,10000),dependencies:['face','body','hands'],version:0,status:'pending',confirmedAssetId:null,candidates:[]});
 }else{
  const stage=stageFor(asset,action.stageId);
  if(action.type==='bind-candidate'){
   check(imageId(action.imageAssetId)&&byId.has(action.imageAssetId),'请选择已登记的图片');check(dependencySnapshot(asset,stage).every(d=>d.status==='confirmed'&&d.assetId),'请先确认上游基础图，再核验此步骤图片',409);
   const requestKey=stageKey(project,asset,stage);const candidate={assetId:action.imageAssetId,jobId:null,requestKey,dependencySnapshot:dependencySnapshot(asset,stage),status:'candidate',source:'existing',created:now()};stage.candidates=[...stage.candidates.filter(c=>c.assetId!==candidate.assetId),candidate].slice(-40);if(!stage.confirmedAssetId&&['pending','stale'].includes(stage.status))stage.status='candidate';
  }else if(action.type==='confirm'){
   check(imageId(action.imageAssetId)&&byId.has(action.imageAssetId),'确认的图片不存在');const candidate=stage.candidates.find(c=>c.assetId===action.imageAssetId&&c.status==='candidate'&&c.requestKey===stageKey(project,asset,stage));check(candidate,'候选图片依赖或设定已过期，请重新生成或重新登记核验',409);
   check(dependencySnapshot(asset,stage).every(d=>d.status==='confirmed'&&d.assetId),'上游基础图已过期，请先重新确认',409);const changed=stage.confirmedAssetId!==action.imageAssetId||stage.status!=='confirmed'||stage.confirmedRequestKey!==candidate.requestKey;
   stage.confirmedAssetId=action.imageAssetId;stage.confirmedRequestKey=candidate.requestKey;stage.status='confirmed';stage.confirmedAt=now();delete stage.staleReason;if(changed){stage.version++;invalidateDownstream(asset,stage.id);}
  }else if(action.type==='use-reference'){
   check(!['face','body','hands'].includes(stage.id),'三张基础图用于身份与服装依赖；请使用已确认剧情角色卡作为本话参考');check(stage.status==='confirmed'&&stage.confirmedRequestKey===stageKey(project,asset,stage)&&byId.has(stage.confirmedAssetId),'请先确认当前有效的资产图片',409);
   const role=action.role||({major:'character',simple:'character',crowd:'character',scene:'scene',prop:'prop',style:'style',other:'prop'})[asset.workflow.kind],name=action.name||asset.name;check(['character','scene','prop','style'].includes(role)&&text(name)&&name.length<=180,'本话参考类型或名称无效');
   project.references||=[];if(!project.references.some(r=>r.assetId===stage.confirmedAssetId)){check(project.references.length<60,'本话参考最多 60 张，请先移除不需要的参考');project.references.push({assetId:stage.confirmedAssetId,role,name,sourceAssetId:asset.id,productionStageId:stage.id,productionVersion:stage.version,...(role==='character'?{characterState:stage.outfitDescription??asset.workflow.outfitDescription??stage.label}:{}),source:'manual-production-confirmed'});}
  }else check(false,'资产生产操作不支持');
 }
 project.productionAssets[index]=asset;validateProductionAssets(project.productionAssets);return project;
}

export function assetProductionView(project,assets=[]){const byId=new Map(assets.map(a=>[a.id,a]));return (project.productionAssets||[]).map(raw=>{const asset=freshAsset(project,raw);return {...asset,stages:asset.stages.map(stage=>({...stage,blocked:dependencySnapshot(asset,stage).filter(d=>d.status!=='confirmed'||!d.assetId).map(d=>d.stageId),confirmedImage:byId.get(stage.confirmedAssetId)||null,candidates:stage.candidates.map(c=>({...c,image:byId.get(c.assetId)||null,current:c.status==='candidate'&&c.requestKey===stageKey(project,asset,stage)})),prompt:assetStagePrompt(project,asset,stage)}))};});}

export function collectProductionAssetImageIds(project){const ids=new Set();const addState=state=>{for(const id of state.workflow?.extraReferenceIds||[])ids.add(id);for(const stage of state.stages||[]){for(const id of stage.componentReferenceIds||[])ids.add(id);if(stage.confirmedAssetId)ids.add(stage.confirmedAssetId);for(const c of stage.candidates||[])ids.add(c.assetId);}};for(const a of project.productionAssets||[]){addState(a);for(const history of a.productionHistory||[])addState(history);}return [...ids];}
// Export importers pass both source and imported projects after remapping ordinary
// references. Only keys that were current in the original document are rebased.
export function remapProductionAssets(originalProject,importedProject,mapping){
 const project=clone(importedProject),resolve=id=>{if(!id)return id;const value=mapping instanceof Map?mapping.get(id):mapping[id];check(value&&imageId(value),'工程缺少资产生产的原始图片，不能完整恢复');return value;};
 const oldById=new Map((originalProject.productionAssets||[]).map(a=>[a.id,initializeProductionAsset(a)]));
 for(const raw of project.productionAssets||[]){Object.assign(raw,initializeProductionAsset(raw));const old=oldById.get(raw.id);raw.workflow.extraReferenceIds=(raw.workflow.extraReferenceIds||[]).map(resolve);for(const stage of raw.stages||[]){if(stage.componentReferenceIds)stage.componentReferenceIds=stage.componentReferenceIds.map(resolve);if(stage.confirmedAssetId)stage.confirmedAssetId=resolve(stage.confirmedAssetId);for(const c of stage.candidates||[]){c.assetId=resolve(c.assetId);c.dependencySnapshot=c.dependencySnapshot.map(d=>({...d,assetId:resolve(d.assetId)}));}}
  const current=initializeProductionAsset(raw);for(const stage of current.stages){const previous=old?.stages.find(s=>s.id===stage.id);if(!previous)continue;const previousKey=stageKey(originalProject,old,previous),nextKey=stageKey(project,current,stage);if(previous.confirmedRequestKey===previousKey)stage.confirmedRequestKey=nextKey;for(let i=0;i<stage.candidates.length;i++)if(previous.candidates[i]?.requestKey===previousKey)stage.candidates[i].requestKey=nextKey;}
  Object.assign(raw,current);for(const history of raw.productionHistory||[]){history.workflow.extraReferenceIds=(history.workflow.extraReferenceIds||[]).map(resolve);for(const s of history.stages||[]){if(s.componentReferenceIds)s.componentReferenceIds=s.componentReferenceIds.map(resolve);if(s.confirmedAssetId)s.confirmedAssetId=resolve(s.confirmedAssetId);for(const c of s.candidates||[]){c.assetId=resolve(c.assetId);c.dependencySnapshot=c.dependencySnapshot.map(d=>({...d,assetId:resolve(d.assetId)}));}}}
 }return project;
}
