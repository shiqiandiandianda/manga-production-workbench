/** Comic direction is a production design choice, never evidence about the source story. */
export const COMIC_DIRECTION_VERSION='1.0.0';
const entries=items=>Object.freeze(items.map(([id,label,instruction])=>Object.freeze({id,label,instruction})));
export const COMIC_VIEWS=entries([
 ['auto','按分镜 / 剧情选择',''],['eye','平视','平视镜头，优先看清人物关系和视线。'],
 ['low','低机位仰视','低机位仰视，用前后景大小反差表现当前人物的气势，保留自然人体比例。'],
 ['extreme-low','大仰角','大仰角仰视，让主体向画面上方展开，用透视纵深加强压迫或爆发；脸部保持可辨识。'],
 ['worm','虫视视角','贴近地面的虫视视角，从脚步或前景向上看主体，近大远小，动作方向和身体连接清楚。'],
 ['high','高位俯视','高位俯视，交代人物在空间里的位置、距离和行动通道。'],
 ['bird','鸟瞰 / 顶视','鸟瞰或顶视，用人物与环境的尺度差建立空间关系，关键人物仍可辨认。'],
 ['dutch','荷兰角','荷兰角构图，画面倾斜约10–20度，用倾斜地平线表现当前不稳定或危机感；不改变人物左右关系。'],
 ['over-shoulder','过肩视角','过肩视角，前景肩部形成遮挡，焦点落在对方表情或双方之间的关键动作。'],
 ['pov','主观视角','以分镜已明确的观察者为主观视角，画面方向与其视线一致；不凭空增加观察者。'],
 ['close','大特写视角','大特写，聚焦本格已存在的眼神、表情、手部或关键道具，只保留能说明当前信息的细节。'],
 ['rear','背面跟随','背面跟随视角，以背影、行进方向和前方空间组织画面，侧后方人物关系可读。']
]);
export const COMIC_LENSES=entries([
 ['auto','按分镜比例',''],['16mm','16mm 大广角','16mm大广角的漫画透视，前景与远景尺度反差鲜明；主体脸部避开画面极边缘，保持角色身份与肢体结构。'],
 ['24mm','24mm 广角','24mm广角，保留动作通道和场景纵深，透视服务动作关系。'],
 ['28mm','28mm 空间叙事','28mm空间透视，让人物行进和场景入口形成清晰前后层次。'],
 ['35mm','35mm 人物关系','35mm自然空间透视，兼顾人物表情与关系，不夸张拉伸五官。'],
 ['50mm','50mm 自然透视','50mm自然透视，突出人物表演，保留必要环境线索。'],
 ['85mm','85mm 情绪聚焦','85mm压缩空间的漫画透视，聚焦眼神和微表情，背景简化成能说明场景的少量线索。']
]);
export const COMIC_COMPOSITIONS=entries([
 ['auto','按剧情选择构图',''],['frame','框式构图','用原场景已有的门框、窗框或前景轮廓形成框式构图，将视线引向人物和关键动作；不新建故事中的物件。'],
 ['diagonal','对角线动势','主体动作与视线沿一条明确对角线展开，避免人物、道具和背景争夺视觉中心。'],
 ['depth','前中后景纵深','前景遮挡、中景人物、远景空间形成三层纵深，当前行动与视线引导阅读方向。'],
 ['negative-space','负空间','保留有目的的负空间，以人物与空白的比例表现当前距离、孤立或停顿；兼顾外部气泡覆盖区。'],
 ['triangle','三角关系','用已出场人物或既有道具建立三角形视觉关系，突出本格的关系焦点；不为凑构图增加人物。'],
 ['symmetry','对称 / 中轴','以中轴或近似对称建立秩序和仪式感，人物表情与关键动作打破机械呆板。'],
 ['leading-lines','引导线','利用道路、屋檐、台阶或原场景透视线指向本格视觉焦点，不凭空增加场景结构。'],
 ['foreground','前景遮挡','用已存在的前景轮廓制造窥视或压迫的空间层次，关键脸部和动作仍清楚可读。'],
 ['size-contrast','大小反差','以近大远小、人物与环境尺度反差表现本格明确的力量或处境，不改变人物实际身高设定。'],
 ['silhouette','剪影与明暗块','用清晰剪影、轮廓光和大块明暗组织视线，保留身份所需的发型、衣服和道具特征。'],
 ['s-curve','S形行进线','用原场景与人物行动组成S形行进线，把视线带向本格的目的地。']
]);
export const COMIC_EMOTIONS=entries([
 ['auto','按原分镜情绪','不凭空加入情绪事件；用本格既有动作、眼神和人物距离表现剧情。'],
 ['calm','平静 / 余韵','克制的表情与舒展的构图，留出呼吸感，用细微眼神和停顿形成余韵。'],
 ['curiosity','好奇 / 探索','用眼神追随、身体略前倾和焦点层次表现好奇，动作幅度服从原分镜。'],
 ['tension','紧张 / 悬念','收紧视觉中心，强化眼神、手部或距离变化；明暗和遮挡服务已存在的悬念。'],
 ['pressure','威压 / 对峙','用视角高低、人物尺度和明暗反差表现已有的威压或对峙，保留双方视线和距离关系。'],
 ['impact','爆发 / 冲击','冻结原动作最可读的瞬间，清楚呈现发力、接触点和运动方向，以线条节奏与明暗反差制造冲击。'],
 ['surprise','惊讶 / 反应','集中表现目光、眉眼和原有反应动作，背景信息适当减少，形成短促的情绪停顿。'],
 ['warmth','温暖 / 亲近','柔和但有层次的明暗，用自然视线与人物距离表现原有的亲近关系。'],
 ['grief','悲伤 / 低落','压低动作幅度，聚焦眼神与姿态，以留白、距离和节奏表现原分镜已有的悲伤。'],
 ['wonder','奇观 / 敬畏','用尺度差、层次与光暗关系呈现已存在的奇观，保持视觉中心和人物反应可读。']
]);
export const COMIC_EFFECT_ROUTES=entries([
 ['external','特效全部外部编辑',''],['atmosphere','氛围线在图内，字效外部',''],['integrated','氛围及指定字效在图内','']
]);
export const ART_DIRECTION_DEFAULTS=Object.freeze({version:1,view:'auto',lens:'auto',composition:'auto',emotion:'auto',intensity:1,effectsMode:'external',effectsWords:[],breakout:'none',breakoutSubject:'',designNotes:''});
const invalid=(field,message)=>Object.assign(new Error(message),{status:400,field:'artDirection.'+field});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const enumValue=(value,field,list,fallback)=>{const result=value??fallback;if(typeof result!=='string'||!list.some(o=>o.id===result))throw invalid(field,'漫画设计选项无效：'+field);return result;};
/** Used by the store and editor. Unknown fields are not copied into production instructions. */
export function normalizeBreakoutExtents(value){
 if(value===undefined||value===null)return undefined;if(!plain(value)||value.unit!==undefined&&value.unit!=='ratio')throw invalid('breakoutExtents','破框范围须为画格宽高比例');
 const result={unit:'ratio'};for(const edge of ['left','right','top','bottom']){const n=value[edge]??0;if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)throw invalid('breakoutExtents','破框范围每边须为0–1');result[edge]=n;}return result;
}
export function normalizeArtDirection(value){
 if(value===undefined||value===null)value={};if(!plain(value))throw invalid('','漫画设计需要对象');
 if(value.version!==undefined&&value.version!==1)throw invalid('version','漫画设计版本无效');
 const intensity=value.intensity??1;if(!Number.isInteger(intensity)||intensity<1||intensity>3)throw invalid('intensity','画面张力请选择1–3级');
 const text=(field,max)=>{const result=value[field]??'';if(typeof result!=='string'||result.length>max)throw invalid(field,'漫画设计文本过长或无效：'+field);return result.trim();};
 const effectsWords=value.effectsWords??[];if(!Array.isArray(effectsWords)||effectsWords.length>12||effectsWords.some(v=>typeof v!=='string'||!v.trim()||[...v.trim()].length>24||/[\r\n]/u.test(v)))throw invalid('effectsWords','图内字效最多12项，每项不超过24字');
 const breakout=value.breakout??'none';if(!['none','foreground'].includes(breakout))throw invalid('breakout','破框方式无效');
 const result={version:1,view:enumValue(value.view,'view',COMIC_VIEWS,'auto'),lens:enumValue(value.lens,'lens',COMIC_LENSES,'auto'),composition:enumValue(value.composition,'composition',COMIC_COMPOSITIONS,'auto'),emotion:enumValue(value.emotion,'emotion',COMIC_EMOTIONS,'auto'),intensity,effectsMode:enumValue(value.effectsMode,'effectsMode',COMIC_EFFECT_ROUTES,'external'),effectsWords:[...new Set(effectsWords.map(v=>v.trim()))],breakout,breakoutSubject:text('breakoutSubject',800),designNotes:text('designNotes',2000)};
 if(value.breakoutExtents!==undefined)result.breakoutExtents=normalizeBreakoutExtents(value.breakoutExtents);
 if(value.visibleCharacters!==undefined){if(!Array.isArray(value.visibleCharacters)||value.visibleCharacters.length>30||value.visibleCharacters.some(v=>typeof v!=='string'||!v.trim()||v.length>80))throw invalid('visibleCharacters','可见人物名单无效');result.visibleCharacters=[...new Set(value.visibleCharacters.map(v=>v.trim()))];}
 return result;
}
export function panelArtDirection(panel,shot){
 const saved=panel?.artDirection??panel?.generation?.artDirection??shot?.artDirection;if(saved!==undefined)return normalizeArtDirection(saved);
 // Existing explicit embedded SFX are already a user instruction, not an inferred sound word.
 const approved=(panel?.generation?.embeddedTexts??shot?.embeddedTexts??[]).filter(v=>v&&typeof v==='object'&&/特效|音效|拟声|sfx/iu.test(v.type||'')).map(v=>v.text).filter(v=>typeof v==='string'&&v.trim()&&[...v.trim()].length<=24&&!/[\r\n]/u.test(v));
 return normalizeArtDirection(approved.length?{effectsMode:'integrated',effectsWords:approved.slice(0,12)}:undefined);
}
/** Suggestions are explicitly proposed design, never silently approved or written back. */

/** Only removes known machine-generated legacy lines, not arbitrary instructions in source fiction.
 * 旧《大周玄衣卫》专属模板曾把规则行写进已保存的提示词；模板下线后仍在生图前清掉这些行。 */
export function stripLegacyArtBoilerplate(description){return String(description||'');}
const selected=(catalog,key)=>catalog.find(o=>o.id===key)?.instruction||'';
export function comicStyleInstructions(style=''){return String(style||'');}

const directionOrigin=panel=>panel?.artDirection||panel?.generation?.artDirection?'用户确认的画面设计':'默认漫画生产约束';
/** Auto choices are resolved for this request only; the source and saved settings are never rewritten. */



/** Report scene-wide names that should not become actors merely because they have an anchor. */
export function panelCastAudit(panel,shot){
 const d=panelArtDirection(panel,shot),anchors=[...new Set([...(panel?.layoutIntent?.characterPlacement||[]).map(v=>v.name),...Object.keys(panel?.layoutIntent?.characterSlots||{})])];
 const text=stripLegacyArtBoilerplate(panel?.generation?.prompt||panel?.layoutIntent?.readingUnit?.description||shot?.productionPrompt||shot?.description||'');
 // A saved local prompt is authoritative. An old reading-unit participant array must not undo an edit.
 const explicit=d.visibleCharacters??(!panel?.generation?panel?.layoutIntent?.readingUnit?.participants:undefined);
 const named=anchors.filter(name=>text.includes(name)),confirmed=explicit??(named.length?named:null);
 return {confirmed:confirmed?[...confirmed]:null,unconfirmed:confirmed?anchors.filter(name=>!confirmed.includes(name)):[],requiresReview:!confirmed&&anchors.length>0};
}
/** A background and an alpha-verified foreground must be separate assets and layers. */
export function breakoutGenerationPlan(panel,{provider='codex',backgroundAssetId=null}={}){
 const d=panelArtDirection(panel);if(d.breakout==='none')return {enabled:false,tasks:[]};
 const missing=[];if(!d.breakoutSubject)missing.push('请明确越框的现有人物及部位');if(!backgroundAssetId)missing.push('请先确认背景主图作为前景透视与姿态参考');if(provider!=='codex')missing.push('当前即梦通道未提供透明参数及真实alpha验收，不能生成破框前景');
 return {enabled:true,ready:missing.length===0,missing,contractVersion:1,tasks:[{kind:'panel-background',transparentBackground:false,layerRole:'clipped-background',panelId:panel.id},{kind:'breakout-foreground',provider:'codex',dependsOn:'confirmed-background',backgroundAssetId,subject:d.breakoutSubject,...(d.breakoutExtents?{extents:d.breakoutExtents}:{}),transparentBackground:true,requiredFormat:'image/png',requireRealAlpha:true,layerRole:'unclipped-foreground',panelId:panel.id}],composition:{keepSingleIdentity:true,matchPosePerspective:true,doNotDuplicateSubject:true,preserveEditableDialogue:true}};
}
/** Reject a white/opaque PNG or empty alpha result. Semantic cutout QC remains a visual task. */
export function inspectForegroundAlpha({width,height,data}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!data||data.length!==width*height*4)throw new Error('透明前景需要完整RGBA像素');
 let transparent=0,visible=0,opaque=0;for(let i=3;i<data.length;i+=4){const alpha=data[i];if(alpha<=4)transparent++;if(alpha>=16)visible++;if(alpha>=250)opaque++;}
 return validateForegroundAlphaStats({width,height,transparentPixels:transparent,visiblePixels:visible,opaquePixels:opaque});
}
export function validateForegroundAlphaStats(value){
 const {width,height,transparentPixels,visiblePixels,opaquePixels}=value||{},total=width*height;
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>100000||height>100000||![transparentPixels,visiblePixels,opaquePixels].every(n=>Number.isInteger(n)&&n>=0&&n<=total)||transparentPixels+visiblePixels>total||opaquePixels>visiblePixels)throw new Error('透明前景像素检查结果无效');
 const crosses=value.outsideVisiblePixels===undefined||Number.isInteger(value.outsideVisiblePixels)&&value.outsideVisiblePixels>=Math.max(1,Math.ceil(total*.0001))&&value.outsideVisiblePixels<=visiblePixels;
 const valid=transparentPixels>=Math.max(1,Math.ceil(total*.01))&&visiblePixels>0&&crosses;
 return {...value,totalPixels:total,transparentRatio:transparentPixels/total,valid,reason:valid?'真实alpha已通过；仍需核对人物、边缘与背景姿态。':!crosses?'透明主体没有实际越过原格边缘，不能当作破框前景；请重生候选。':visiblePixels===0?'前景没有可见主体，不能应用。':'图片没有足够的真实透明背景，不能当破框PNG应用。'};
}

