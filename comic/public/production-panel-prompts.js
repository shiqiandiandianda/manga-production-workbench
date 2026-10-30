import {stateFor,stateKey} from './character-states.js';
import {resolvedTextAsset} from './asset-text-references.js';
import {cleanPromptVariant} from './clean-prompt-variant.js';
const normalized=value=>String(value).normalize('NFKC').replace(/\s+/gu,'');
const emptyColumns=['生图提示词(空泡)','单格提示词(空泡)','空泡提示词','空泡'];
const cleanColumns=['生图提示词(无泡)','单格提示词(无泡)','无泡提示词','无泡','生图提示词(后期嵌字)','后期嵌字提示词','后期嵌字生图提示词'];
/** Read the two source variants verbatim. A generic prompt is clean only when it explicitly forbids bubbles. */
export function productionPanelPrompts(record){
 const sources=[record?.original,record?.production].filter(Boolean);
 const read=names=>{
  for(const fields of sources){
   for(const [column,text] of Object.entries(fields))if(names.includes(normalized(column))&&typeof text==='string'&&text.trim())return {text,column};
   for(const key of ['提示词','单格提示词'])for(const [column,text] of Object.entries(fields[key]||{}))if(names.includes(normalized(column))&&typeof text==='string'&&text.trim())return {text,column:key+'.'+column};
  }
  return {text:'',column:null};
 };
 const empty=read(emptyColumns),explicitClean=read(cleanColumns),legacy=read(['生图提示词','生产提示词','productionPrompt','prompt']);
 const derived=cleanPromptVariant(empty.text),clean=explicitClean.text?explicitClean:derived?{text:derived,column:empty.column,derived:true,label:'单格无框提示词（由空泡原文转换）'}:/(?:不要|不准|禁止|不得)[^。\n]{0,40}(?:气泡|对话框)|无(?:对白)?气泡|无泡/u.test(legacy.text)?legacy:explicitClean;
 return {empty,clean,legacy};
}
export function productionPanelPromptSource(record,stored){
 const prompts=productionPanelPrompts(record);
 if(['post-lettering','imported'].includes(stored))return stored;
 return prompts.clean.text?'post-lettering':'imported';
}
export function productionPanelPromptFields(record){
 const prompts=productionPanelPrompts(record);
 return {'生图提示词（空泡）':prompts.empty.text,'生图提示词（无泡）':prompts.clean.text};
}
export function productionPanelDataIssues(record,{referenceAudit}={}){
 const fields={...record?.production,...record?.original},actors=(Array.isArray(fields['出现角色'])?fields['出现角色']:String(fields['出现角色']||'').split(/[、，,；;\n]/u)).map(n=>String(n).trim()).filter(n=>n&&!/^(无|空镜|暂无|—|-)$/u.test(n));
 const states=String(fields['角色状态（服装/形态）']||''),issues=[];
 // Image and text are two explicit reference modes. All generation entry points
 // use the same audited choice; missing source costume is not an image requirement in text mode.
 for(const actor of actors){
  const declared=Object.entries(fields['服装']||{}).some(([name,state])=>stateKey(name)===stateKey(actor)&&String(state||'').trim())||stateFor(states,actor);
  const selected=referenceAudit?.needs?.some(need=>need.role==='character'&&stateKey(need.name)===stateKey(actor)&&(resolvedTextAsset(need)||need.status==='ready'&&need.blocking===false&&need.selectedIds?.length&&!need.conflictingIds?.length));
  if(!declared&&!selected)issues.push('人物服装未对应：'+actor);
 }
 if(!String(fields['当前场景']||'').trim())issues.push('当前场景未填写');
 // The 2.2 storyboard explicitly records both no held props and no prop references.
 // Only accept this as no props when its asset index contains character/scene entries alone.
 const index=fields['资产索引'],explicitNoProps=Array.isArray(fields['道具持用'])&&!fields['道具持用'].length&&Array.isArray(fields['需要道具参考'])&&!fields['需要道具参考'].length&&Array.isArray(index)&&index.every(entry=>Array.isArray(entry)&&typeof entry[0]==='string'&&/^[CL]\d+$/u.test(entry[0]));
 if(!Object.hasOwn(fields,'出现道具')&&!explicitNoProps)issues.push('出镜道具未声明（无道具请写无或空数组）');
 return issues;
}
