import {generationPromptSelection} from './prompt-source.js';
const text=value=>Array.isArray(value)?value.join('、'):typeof value==='string'?value.trim():'';
export function declaredScene(shot){
 const fields=shot?.sourceFields||{};
 return text(shot?.location)||text(shot?.sceneName)||text(shot?.scene)||['当前场景','场景','场景名称','地点','主场景','场景/地点','scene','location'].map(key=>text(fields[key])).find(Boolean)||text(shot?.sceneId)||'';
}
const places=['林荫道','林间小道','训练场','练武场','演武场','练功场','议事厅','藏书阁','山脚小院','林道','宿舍','书房','卧室','庭院','小院','走廊','长廊','山门','山道','山洞','洞府','大殿','客栈','酒楼','树林','密林','森林','竹林','街道','街巷','广场','大厅','码头','河岸','湖边','峡谷','山谷','擂台'];
const noScene=/纯(?:白|黑|色)背景|(?:无|没有|不要|不画|不绘制)背景|背景(?:留白|纯白|纯黑|透明)/u;
const explicitNone=/^(?:无|暂无|none|n\/a|—|-)$/iu;
function locationInPrompt(content,names){
 if(noScene.test(content))return {none:true};
 const terms=[...new Set([...names,...places])].filter(name=>name.length>=2).sort((a,b)=>b.length-a.length),matches=[];
 for(const name of terms){let from=0;for(let at=content.indexOf(name,from);at>=0;at=content.indexOf(name,from)){
  from=at+name.length;const prefix=content.slice(Math.max(0,at-16),at),suffix=content.slice(from,from+8);
  if(/(?:不在|没有|不画|不出现|画外提到|对白提到)[^，。；\n]{0,8}$/u.test(prefix)||/(?:走向|前往|通往|去往|望向|赶往|朝向|朝)[^，。；\n]{0,5}$/u.test(prefix))continue;
  // A distant landmark alone is not the camera's current location.
  if(/(?:远处|栏外|窗外远处)[^，。；\n]{0,6}$/u.test(prefix)&&!/^中|内|外|前|旁|，|。/u.test(suffix))continue;
  matches.push({name,at});
 }}
 matches.sort((a,b)=>a.at-b.at||b.name.length-a.name.length);return matches.length?{name:matches[0].name,quote:content.slice(Math.max(0,matches[0].at-14),matches[0].at+matches[0].name.length+25)}:null;
}
const episode=shot=>shot?.episode||/^(?:E|第)0*(\d+)(?:-|话)/iu.exec(shot?.code||'')?.[1]||null;
/** Read-only location evidence. Never changes the imported production prompt. */
export function deriveSceneReference(project,panel,{sceneNames=[]}={}){
 const source=project.shots.find(s=>s.id===panel.shotId)||panel.generation?.sourceSnapshot?.original||{},declared=declaredScene(source),content=generationPromptSelection(panel,project).text;
 if(declared)return {location:explicitNone.test(declared)?'':declared,explicitNone:explicitNone.test(declared),kind:'field',sourceCode:source.code||'',quote:declared};
 const direct=locationInPrompt(content,sceneNames);
 if(direct?.none)return {location:'',explicitNone:true,kind:'prompt',sourceCode:source.code||'',quote:'画面明确不绘制背景'};
 if(direct)return {location:direct.name,kind:'prompt',sourceCode:source.code||'',quote:direct.quote};
 const index=project.shots.findIndex(s=>s.id===source.id),key=episode(source);
 if(index>=0&&key&&!/转场|切换到|另一处|另一边|与此同时/u.test(content)){
  for(let i=index-1;i>=Math.max(0,index-30);i--){const previous=project.shots[i];if(String(episode(previous))!==String(key))break;
   const field=declaredScene(previous),prior=field?{name:field,quote:field}:locationInPrompt(previous.productionPrompt||previous.description||'',sceneNames);
   if(prior?.none||field&&explicitNone.test(field))break;
   if(prior?.name)return {location:prior.name,kind:'continuous',sourceCode:previous.code||'',quote:prior.quote,note:'沿用同话连续场景：'+(previous.code||'上一格')+' · '+prior.name+'（请核对转场）'};
  }
 }
 return {location:'',kind:'undefined',sourceCode:source.code||'',quote:'',note:'本格场景未标注，尚未核对场景参考'};
}
/** 当前格只有人物动作、没有空间描述时，回退到同话里真正写出该场景的那一格。 */
export function sceneSpaceEvidence(project,panel){
 const scene=deriveSceneReference(project,panel);
 if(scene.kind!=='continuous'||!scene.sourceCode)return null;
 const shot=project.shots.find(s=>s.code===scene.sourceCode);
 if(!shot)return null;
 const text=generationPromptSelection({generation:{},shotId:shot.id},project).text||shot.productionPrompt||shot.description||'';
 if(!text.trim())return null;
 return {code:shot.code,text:text.trim().slice(0,600),quote:scene.quote||'',note:scene.note||''};
}
