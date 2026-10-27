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
 const clean=explicitClean.text?explicitClean:/(?:不要|不准|禁止|不得)[^。\n]{0,40}(?:气泡|对话框)|无(?:对白)?气泡|无泡/u.test(legacy.text)?legacy:explicitClean;
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
export function productionPanelDataIssues(record){
 const fields={...record?.production,...record?.original},raw=record?.original||{},actors=(Array.isArray(fields['出现角色'])?fields['出现角色']:String(fields['出现角色']||'').split(/[、，,；;\n]/u)).map(n=>String(n).trim()).filter(n=>n&&!/^(无|空镜|暂无|—|-)$/u.test(n));
 const states=String(fields['角色状态（服装/形态）']||''),issues=[];
 for(const actor of actors)if(!raw['服装']?.[actor]&&!states.includes(actor+':')&&!states.includes(actor+'：'))issues.push('人物服装未对应：'+actor);
 if(!String(fields['当前场景']||'').trim())issues.push('当前场景未填写');
 if(!Object.hasOwn(fields,'出现道具'))issues.push('出镜道具未声明（无道具请写无或空数组）');
 return issues;
}
