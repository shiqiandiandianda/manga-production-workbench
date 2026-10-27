import {createHash} from 'node:crypto';
import {CHARACTER_CARD_LAYOUT_RULES} from '../public/hand-card-rules.js';
import {characterAppearancePrompt} from './character-appearance.mjs';
import {asset2DStyle} from './scene-asset-prompts.mjs';
export const CHARACTER_ASSET_PROMPT_VERSION=1;
const text=v=>typeof v==='string'?v.trim():'';
export function characterAssetBase(project,need,provenance=[]){
 const versions=new Set(provenance.map(p=>p.assetVersion).filter(Boolean)),found=[];
 for(const ledger of project.productionPackage?.ledger||[])for(const a of ledger.records||[])if(a['名称']===need.name&&(!versions.size||versions.has(a['资产ID']+'/'+a['版本'])))found.push({record:a,file:ledger.file});
 const exact=found.find(x=>x.record['状态说明']===need.state)||found[0];return exact||null;
}
export function buildCharacterAssetPrompt({project,need,settings,referencePlan,provenance=[],sourceDescription=''}){
 const base=characterAssetBase(project,need,provenance),originalPrompt=text(base?.record['提示词']),identity=text(base?.record['固定设定']),state=text(need.state)||'未指定服装，按人物身份参考制作候选',style=project.style||originalPrompt.split('\n')[0]||'',hasIdentity=referencePlan.references.some(r=>r.role==='人物身份');
 const prompt=[
  '【任务】为“'+need.name+'”制作一张漫画人物资产卡。本次仅处理这个人物与指定服装，不画剧情镜头或其他人物。',
  '【人物身份】'+(hasIdentity?'以已选人物形象图为身份锚点；保持脸型、五官、年龄、发型基础、肤色、身高和体型，换装不得换人。':identity||'缺少已确认形象图，依据当前资料制作待确认候选。'),
  identity?'资料基础设定（无身份图时采用；已有身份图时不强改本人外貌）：'+identity:'',
  '【服装结构与状态】本次采用方案：'+state+'。只把文字中明确的衣服、颜色、领口、腰带、鞋靴、随身物和状态落实到图像；没有写明的细节作为克制的候选设计，不宣称是小说原文。',
  '【参考约束】'+referencePlan.guidance,
  '【外观补充】'+characterAppearancePrompt({type:'character',name:need.name,description:identity||sourceDescription,...settings}),
  '【出图结构】'+CHARACTER_CARD_LAYOUT_RULES,
  '【画风】'+asset2DStyle(style),
  style&&!/\d+\s*[:：]\s*\d+|人物设计板/u.test(style)?'资料包画风基底：'+style:'',
  settings.appearanceNotes?'【本次人工要求】'+settings.appearanceNotes:'',
  settings.assetBrief?'【本次资产补充】'+settings.assetBrief:'',
  '【验收】各视图必须为同一人、同一套服装，正侧背结构和配色一致；手部、配饰遵守版式。人物自然比例，背景干净；不画剧情对白、气泡、界面、资产编号和水印。旧资产保留，新图等待人工采用。'
 ].filter(Boolean).join('\n');
 return {prompt,originalPrompt,baseSource:base?.file||null,baseSha256:originalPrompt?createHash('sha256').update(originalPrompt).digest('hex'):null,version:CHARACTER_ASSET_PROMPT_VERSION};
}
