import {characterPreparationNote} from './character-preparation.js';
export const CHARACTER_STATE_FIELDS=Object.freeze({sourceLocation:'原著位置',characterStates:'角色状态',propStates:'道具状态'});
export const UNKNOWN_CHARACTER_STATE='未知（待确认）';
export const stateKey=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/[\s·・，,、。]/gu,'');
export const libraryStatePlaceholder=value=>/^待与(?:项目)?主库对应/u.test(String(value??'').trim());
export const unknownState=value=>!String(value??'').trim()||/未知|待确认|待核实|待设计|未指定|不明确/u.test(String(value))||libraryStatePlaceholder(value)||!!characterPreparationNote(value);

const sourceKey=value=>String(value).normalize('NFKC').replace(/\s/gu,'');
const sourceValue=(row,keys)=>{for(const key of keys){const found=Object.keys(row||{}).find(name=>sourceKey(name)===sourceKey(key)),value=found===undefined?'':String(row[found]??'').trim();if(value)return value;}return '';};
export function sourceCharacterStates(row){
 const values=[sourceValue(row,['characterStates','人物服装状态','角色状态','角色状态（服装/形态）','人物服装与状态']),sourceValue(row,['人物状态'])].filter((value,index,all)=>value&&all.indexOf(value)===index);
 if(values.length<2)return values[0]||'';
 const parsed=values.map(parseNamedStates);if(parsed.some(value=>value.errors.length))return values.join('\n');
 const merged=new Map();for(const value of parsed)for(const entry of value.entries){const key=stateKey(entry.name),prior=merged.get(key)||{name:entry.name,states:[]};if(!prior.states.includes(entry.state))prior.states.push(entry.state);merged.set(key,prior);}
 return [...merged.values()].map(entry=>entry.name+':'+entry.states.join('，')).join('；');
}
export function sourceStateFields(shot){
 const raw=shot?.sourceFields||{},character=sourceCharacterStates(raw),legacy=sourceValue(raw,['characterStates','人物服装状态','角色状态','人物状态']),current=String(shot?.characterStates??'').trim();
 return {characterStates:character&&(!current||current===legacy)?character:current,propStates:shot?.propStates??sourceValue(raw,['propStates','道具状态'])};
}

/** State labels are explicit text, never guesses from pixels or a neighbouring character. */
export function parseNamedStates(value){
 const entries=[],errors=[],seen=new Set();
 for(const part of String(value??'').split(/[；;\r\n]+/u).map(v=>v.trim()).filter(Boolean)){
  const match=/^([^:：]{1,80})\s*[:：]\s*(.{1,1000})$/u.exec(part);
  if(!match){errors.push('状态格式应为“人物:状态”，多人用分号分隔：'+part.slice(0,100));continue;}
  const name=match[1].trim(),state=match[2].trim(),key=stateKey(name);
  if(!name||!state){errors.push('人物和状态都不能留空');continue;}
  if(seen.has(key)){errors.push('同一格重复填写“'+name+'”的状态');continue;}
  seen.add(key);entries.push({name,state});
 }
 return {entries,errors};
}
export function stateFor(value,name,aliases=[]){
 const names=[name,...aliases].map(stateKey),{entries}=parseNamedStates(value);
 return entries.find(entry=>names.includes(stateKey(entry.name)))?.state||'';
}
export function fillUnknownCharacterStates(value,names){
 const text=String(value??'').trim(),parsed=parseNamedStates(text);
 if(parsed.errors.length)return text;
 const existing=new Set(parsed.entries.map(entry=>stateKey(entry.name))),missing=[...new Set(names)].filter(name=>name&&!/^(无|空镜|—|-)$/u.test(name)&&!existing.has(stateKey(name)));
 return [text,...missing.map(name=>name+':'+UNKNOWN_CHARACTER_STATE)].filter(Boolean).join('；');
}
export function characterStatePrompt(value){
 return String(value??'').trim()?'人物状态：'+String(value).trim()+'。每个人只使用本格指定服装与状态；身份参考中的其他服装不代表本格服装。未知或待设计项仍待确认，不捏造成原著事实。':'';
}
export function withStatePrompt(prompt,shot){
 let result=String(prompt??'');
 for(const [field,label] of [['characterStates','人物状态'],['propStates','道具状态']]){
  if(!Object.hasOwn(shot||{},field))continue;
  const expression=new RegExp('^'+label+'[：:][^\\r\\n]*','gmu');
  result=result.replace(expression,'').replace(/\n{3,}/gu,'\n\n');
  const value=String(shot[field]??'').trim();if(value)result+='\n'+(field==='characterStates'?characterStatePrompt(value):label+'：'+value);
 }
 return result.trim();
}

/** Check declarations and continuity only; this does not inspect generated image pixels. */
export function inspectCharacterStates(rows,assets=[],{source=null}={}){
 const issues=[],byId=new Map(assets.map(a=>[a.id,a])),previous=new Map();
 const add=(row,kind,message,hint='补充状态及依据；不确定时填写“未知（待确认）”')=>issues.push({level:'警告',episode:row.episode,rowId:row.id,field:kind==='SOURCE_LOCATION'?'原著位置':'角色状态',kind,message,hint});
 for(const row of rows){
  const names=(row.characterIds||[]).map(id=>byId.get(id)).filter(Boolean),listed=names.length?names.map(a=>a.name):String(row.client?.['出现角色']||'').split(/[、，,；;]+/u).map(v=>v.trim()).filter(v=>v&&!/^(无|空镜|—|-)$/u.test(v));
  const parsed=parseNamedStates(row.characterStates),validNames=new Set([...listed,...names.flatMap(a=>a.aliases||[])].map(stateKey));
  for(const message of parsed.errors)add(row,'STATE_FORMAT',message);
  for(const entry of parsed.entries)if(!validNames.has(stateKey(entry.name)))add(row,'STATE_CHARACTER_NOT_VISIBLE','状态里的“'+entry.name+'”不在本格出现人物中','核对人物名称和别名；只记录本格实际出场人物');
  const flash=(row.markers||[]).some(marker=>/^(闪回|回忆|想象|幻想)/u.test(marker));
  for(const name of listed){
   const identity=names.find(a=>a.name===name),value=stateFor(row.characterStates,name,identity?.aliases||[]);
   if(!value){add(row,'STATE_MISSING','没写“'+name+'”此刻的服装或形态状态');continue;}
   if(unknownState(value)){add(row,'STATE_UNKNOWN','“'+name+'”的服装或形态状态待确认');continue;}
   const catalog=identity?.states||[];if(catalog.length&&!catalog.some(state=>stateKey(state)===stateKey(value)))add(row,'STATE_UNREGISTERED','“'+name+'”的状态“'+value+'”未在服装/状态包中登记','确认状态名称或补充对应服装角色卡，不能借用同名人物的其他状态');
   const key=row.episode+':'+(identity?.id||stateKey(name)),prior=previous.get(key);
   if(!flash&&prior&&prior.sceneId===row.sceneId&&prior.timeOfDay===row.timeOfDay&&stateKey(prior.state)!==stateKey(value)){
    const evidence=[row.client?.['画面内容'],row.client?.['画面备注'],row.note].filter(Boolean).join('\n');
    const transition=(row.markers||[]).some(m=>/转场|时间叠化|蒙太奇/u.test(m))||/换装|更衣|换上|脱下|穿上|披上|套上|受伤|伤愈|沾血|染血|血染|淋湿|湿透|撕裂|破损|破裂|包扎|清洗|洗净|变身|化形|蜕变|进化|升级|突破|状态变更已确认/u.test(evidence);
    if(!transition)add(row,'STATE_CONTINUITY','“'+name+'”从 '+prior.rowId+' 的“'+prior.state+'”变为“'+value+'”，同场景同时间未写状态变化依据','核对换装、受伤或形态变化；若已确认，在制作备注记录依据');
   }
   if(!flash)previous.set(key,{state:value,rowId:row.id,sceneId:row.sceneId,timeOfDay:row.timeOfDay});
  }
  const location=String(row.sourceLocation??'').trim();
  if(location){
   const parts=location.split(/[；;\n]+/u).map(v=>v.trim()).filter(Boolean);
   for(const part of parts){const match=/^第(\d+)章第(\d+)段$/u.exec(part);if(!match){add(row,'SOURCE_LOCATION','原著位置无法定位：“'+part+'”','填写“第N章第M段”，多处用分号分隔');continue;}
    if(source){const chapter=source.chapters?.find(c=>c.number===Number(match[1]));if(!chapter||!chapter.lines?.[Number(match[2])-1])add(row,'SOURCE_LOCATION','原著位置“'+part+'”不在已导入原著中','补齐原著或修正出处；位置存在也不代表状态语义已核验');}
   }
  }else if(listed.length&&source&&Object.hasOwn(row,'characterStates'))add(row,'SOURCE_LOCATION','角色状态缺少可追溯的原著位置','填写支持本格状态的章段；原著没有的补设应写明待设计及确认依据');
 }
 return issues;
}
