import {FORWARD_TEMPLATE,REVERSE_TEMPLATE} from './shot-templates.ts';
import {parseScript,SOURCE_PARSING_VERSION} from './script-structure.ts';
export type Chapter={id:string;title:string;text:string;index:number};
export type Evidence={chapterId:string;quote:string};
export type ImageTiming={startedAt:number;finishedAt:number;durationMs:number;stages?:{forward?:number;reverse?:number;composing?:number}};
export type Scene={imageTimings?:(ImageTiming|null)[];imageHistory?:{index:0|1;image:string;replacedAt:number;timing?:ImageTiming}[];preferredVersion?:0|1;id:string;projectId:string;type:'scene';canonicalKey:string;name:string;description:string;time:string;interior:string;unknowns:string[];evidence:Evidence[];panels:string[];characterIds:string[];images:(string|null)[]};
export type Batch={id:string;chapters:Chapter[];status:string;completedParts:number};
export type Format={layout?:'four-panel'|'shot-reverse';reverseTemplate?:string;confirmed:boolean;style:string;template:string;referenceImages:string[];referenceNames:string[];size:string;referencePresetVersion?:string;showChapterSubtitle?:boolean;showPanelLabels?:boolean};
export type Project={_revision?:string;sourceParsingVersion?:number;id:string;title:string;text:string;scenes:Scene[];characters:{id:string;name:string;[key:string]:unknown}[];batches:Batch[];format:Format};
export const LEGACY_TEMPLATE=`采用横向16:9场景概念设计展示板排版，整体为“一张大主图＋底部三张辅助图”的四宫格布局。

顶部设置通栏深黑色标题带，占画面高度约6%，左侧放置白色中文标题“{{name}}”，字体简洁，左对齐，保留适当边距。

标题下方为大幅横向主场景图，占画面高度约55%，横跨整页。{{main}}

底部安排三张辅助场景图，高度一致，宽度比例约为43:27:30：
左图最宽，{{left}}；
中图较窄，{{middle}}；
右图{{right}}。

整页采用暖米白色底板，四周保留均匀窄边框，各图之间用细米白色间隔分开，图框为直角，排列整齐，主次明确。所有画面保持统一的{{style}}。除顶部标题外，不添加说明文字、编号、水印或装饰图标。

场景原文确定的内容：{{description}}
时间与光照：{{time}}（剧本明确的光照优先于通用风格）
本张展示板方案：{{variant}}
只展示场景环境，不绘制人物。参考图仅用于排版和视觉风格，不能把参考图中的建筑和物件强加到本场景。原文没有明确的细节不得作为确定的剧情设定。`;
export const ORIGINAL_EXAMPLE=`采用横向16:9场景概念设计展示板排版，整体为“一张大主图＋底部三张辅助图”的四宫格布局。
顶部设置通栏深黑色标题带，占画面高度约6%，左侧放置白色中文标题“沿途县衙与鸣冤鼓”，字体简洁，左对齐，保留适当边距。
标题下方为大幅横向主场景图，占画面高度约55%，横跨整页。采用低机位广角构图，县衙正门位于中部，右侧前景突出鸣冤鼓，左侧展示围墙、旗杆与灯笼，形成清晰的前景、中景和背景层次。
底部安排三张辅助场景图，高度一致，宽度比例约为43:27:30：
左图最宽，展示县衙大堂内部，采用正面、近似对称构图；
中图较窄，展示门廊与院落通道，以斜向透视强化纵深；
右图展示破损县衙门口，突出倒塌门板、碎木与台阶细节。
整页采用暖米白色底板，四周保留均匀窄边框，各图之间用细米白色间隔分开，图框为直角，排列整齐，主次明确。所有画面保持统一的中式古建筑游戏场景概念美术风格，灰黑、暗红、土褐色调，阴天光照，材质斑驳，细节丰富。除顶部标题外，不添加说明文字、编号、水印或装饰图标。`;
export const EXAMPLE_TEMPLATE=FORWARD_TEMPLATE;
export const DEFAULT_FORMAT:Format={layout:'shot-reverse',reverseTemplate:REVERSE_TEMPLATE,confirmed:true,style:'中式古建筑游戏场景概念美术，清晰的手绘描线，写实空间与透视，灰黑、暗红、土褐色调，旧木与石材斑驳，细节丰富。保持同一空间的材质与空间层次；自然光照服从剧本。',template:EXAMPLE_TEMPLATE,referenceImages:[],referenceNames:[],size:'1536x864',showChapterSubtitle:false,showPanelLabels:false};
export function newProject():Project{return {sourceParsingVersion:SOURCE_PARSING_VERSION,id:crypto.randomUUID(),title:'未命名剧本',text:'',scenes:[],characters:[],batches:[],format:structuredClone(DEFAULT_FORMAT)};}
export function chaptersFrom(text:string):Chapter[]{return parseScript(text).chapters;}
export function batchesFrom(chapters:Chapter[]):Batch[]{const out:Batch[]=[];for(let i=0;i<chapters.length;i+=10)out.push({id:'batch-'+(i/10+1),chapters:chapters.slice(i,i+10),status:'pending',completedParts:0});return out;}
export function segments(batch:Batch,limit=12000):Chapter[][]{const out:Chapter[][]=[];let current:Chapter[]=[];let length=0;for(const chapter of batch.chapters)for(let offset=0;offset<chapter.text.length;offset+=limit){const piece={...chapter,text:chapter.text.slice(offset,offset+limit)};if(length+piece.text.length>limit&&current.length){out.push(current);current=[];length=0;}current.push(piece);length+=piece.text.length;}if(current.length)out.push(current);return out;}
export function verify(scenes:Scene[],chapters:Chapter[]):Scene[]{return scenes.map(s=>{const evidence=s.evidence.filter(e=>chapters.some(c=>c.id===e.chapterId&&e.quote.trim()&&c.text.includes(e.quote)));if(!evidence.length)throw new Error('场景“'+s.name+'”没有有效原文证据，本段结果未保存。');return {...s,evidence};});}
export function merge(existing:Scene[],incoming:Scene[],projectId:string):Scene[]{const result=structuredClone(existing);for(const item of incoming){const target=result.find(s=>s.canonicalKey===item.canonicalKey);if(target){target.evidence=Array.from(new Map([...target.evidence,...item.evidence].map(e=>[e.chapterId+'|'+e.quote,e])).values());if(!target.description.includes(item.description))target.description+='\n'+item.description;target.unknowns=Array.from(new Set([...target.unknowns,...item.unknowns]));}else result.push({...item,id:'scene-'+crypto.randomUUID(),projectId,type:'scene',images:[null,null],characterIds:[]});}return result;}
export function promptFor(s:Scene,f:Format,index:number,chapters:Chapter[]=[]){const p=s.panels.length===4?s.panels:[s.description,'展示同一场景的空间全貌','展示同一场景的另一视角','展示原文明确的环境细节'];const values:Record<string,string>={name:s.name,description:s.description,time:s.time,style:f.style,unknowns:s.unknowns.join('；')||'无额外未明确项',main:p[0],left:p[1],middle:p[2],right:p[3],variant:index===0?'方案 A：以空间全貌和布局为主':'方案 B：保持场景一致，以不同观察位置和环境细节为主'};let prompt=f.template.replace(/\{\{(\w+)\}\}/g,(match,key)=>values[key]??match);
if(f.layout==='shot-reverse')return prompt+'\n生成纯场景单幅正打，严格不绘制人物、标题、标签或拼贴。';
const subtitle=Array.from(new Set(s.evidence.map(e=>chapters.find(c=>c.id===e.chapterId)?.title).filter(Boolean))).slice(0,6).join(' / ');
if(f.showChapterSubtitle||f.showPanelLabels)prompt=prompt.replace('除顶部标题外，不添加说明文字、编号、水印或装饰图标。','除明确启用的顶部标题、副标题和画面标签外，不添加文字、编号、水印或装饰图标。');
prompt+='\n\n本次文字规则（优先于样板中的文字）：'+(f.showChapterSubtitle&&subtitle?'标题带添加章节副标题“'+subtitle+'”。':'不添加章节副标题。')+(f.showPanelLabels?'四幅画面允许添加简短中文空间标签，标签依据各画面已知内容命名。':'四幅画面不添加说明标签。')+'不添加水印、编号或装饰图标，不复制参考图中的县衙名称、章节号、匾额文字或标注。';
return prompt;}
export function reversePromptFor(s:Scene,f:Format){return (f.reverseTemplate||REVERSE_TEMPLATE)+'\n本次场景名称：'+s.name+'。参考附件只有本版刚生成的正打图。不得套用示例房间的床、书桌或门。保持本版正打的所有已知世界位置、物件身份和光照，仅生成单幅16:9反打。';}
export type Job={diagnosticId?:string;queuedAt?:number;selectionId?:string;pauseReason?:string;errorCode?:string;startedAt?:number;finishedAt?:number;durationMs?:number;stageStartedAt?:number;stageDurations?:ImageTiming['stages'];stage?:'forward'|'reverse'|'composing';id:string;sceneId:string;index:number;name:string;status:string;error?:string;batchId?:string;origin?:'manual'|'automatic';regenerate?:boolean};
export async function runTwo(jobs:Job[],worker:(j:Job)=>Promise<string>,onResult:(j:Job,r:{status:string;image?:string;error?:string})=>void,signal?:AbortSignal){let cursor=0;async function consume(){while(cursor<jobs.length&&!signal?.aborted){const j=jobs[cursor++];try{onResult(j,{status:'running'});const image=await worker(j);onResult(j,{status:'done',image});}catch(e){onResult(j,{status:signal?.aborted?'paused':'failed',error:(e as Error).message});}}}await Promise.all([consume(),consume()]);}
export function assetExport(p:Project){return {schemaVersion:'1.0',sourceParsingVersion:p.sourceParsingVersion,projectId:p.id,title:p.title,source:{text:p.text,chapters:chaptersFrom(p.text)},modules:{scenes:p.scenes,characters:p.characters},format:p.format,batches:p.batches,exportedAt:new Date().toISOString()};}
