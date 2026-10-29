import {withStatePrompt} from './character-states.js';
const invalid=(message,field,value)=>Object.assign(new Error(message),{status:400,field,originalValue:value});
export const SHOT_SIZES=Object.freeze(['大远景','远景','全景','中远景','中景','中近景','近景','特写','大特写','极特写']);
export const CAMERA_ANGLES=Object.freeze(['平视','高位俯视','俯拍','仰拍','大仰角','虫视视角','侧拍','背面拍摄','过肩镜头','主观视角','鸟瞰','顶视','倾斜镜头','荷兰角','正面拍摄','正面平视','过肩俯拍','过肩仰拍','侧面俯拍','正反打']);
const CAMERA_ALIASES=Object.freeze({'平视正面':'正面平视','正视':'正面拍摄','正面':'正面拍摄','侧视':'侧拍','侧位':'侧拍','侧面':'侧拍','背视':'背面拍摄','背面':'背面拍摄','俯视':'俯拍','仰视':'仰拍','过肩':'过肩镜头','过肩俯视':'过肩俯拍','俯视过肩':'过肩俯拍','过肩仰视':'过肩仰拍','仰视过肩':'过肩仰拍','俯视侧位':'侧面俯拍','侧位俯视':'侧面俯拍'});
export function normalizeCameraAngle(value){return typeof value==='string'?(CAMERA_ALIASES[value.trim()]||value.trim()):value;}
// Presets are suggestions. Imported cinematography may include a precise freeform viewpoint.
export function validCameraAngle(value){return typeof value==='string'&&value.length<=100&&!SHOT_SIZES.includes(value.trim());}
export function shotSetting(shot,key){
 if(shot?.[key])return shot[key];const field=key==='shotSize'?'景别':'机位角度';
 return shot?.storyboard?.clientFields?.[field]||new RegExp(field+'[：:]([^\\n；;]+)').exec(shot?.description||'')?.[1]?.trim()||'';
}
export function effectiveShotDescription(shot){
 let text=shot?.productionPrompt?.trim()||shot?.description||'';
 for(const [key,label] of [['shotSize','景别'],['cameraAngle','机位角度']])if(shot?.[key]){const expression=new RegExp(label+'[：:][^\\n；;]*','gu');text=expression.test(text)?text.replace(expression,()=>label+'：'+shot[key]):text+'\n'+label+'：'+shot[key];}
 for(const [key,rawKey,label] of [['shotSize','shotSizeRaw','原分镜景别备注'],['cameraAngle','cameraAngleRaw','原分镜机位备注']]){
  const raw=typeof shot?.[rawKey]==='string'?shot[rawKey].trim():'',current=shotSetting(shot,key),normalized=key==='cameraAngle'?normalizeCameraAngle(raw):raw;
  if(raw&&normalized!==current)text+='\n'+label+'：'+raw+'（保留原始镜头补充信息）';
 }
 return withStatePrompt(text,shot);
}
export function validateShotSettings(shot){
 for(const field of ['characterStates','propStates','sourceLocation'])if(shot[field]!==undefined&&(typeof shot[field]!=='string'||shot[field].length>4000))throw invalid('人物状态、道具状态及出处必须是4000字以内的文本',field,shot[field]);
 if(shot.productionPrompt!==undefined&&(typeof shot.productionPrompt!=='string'||shot.productionPrompt.length>20000))throw invalid('提示词需要文本且不超过20000字');
  if(shot.cameraAngle!==undefined&&typeof shot.cameraAngle==='string'){const raw=shot.cameraAngle;shot.cameraAngle=normalizeCameraAngle(raw);if(raw!==shot.cameraAngle&&shot.cameraAngleRaw===undefined)shot.cameraAngleRaw=raw;}
  if(shot.shotSize!==undefined&&(typeof shot.shotSize!=='string'||shot.shotSize&&!SHOT_SIZES.includes(shot.shotSize)))throw invalid(`景别「${String(shot.shotSize).slice(0,160)}」不在可选范围中`,'shotSize',shot.shotSize);
  if(shot.cameraAngle!==undefined&&!validCameraAngle(shot.cameraAngle))throw invalid(SHOT_SIZES.includes(shot.cameraAngle)?`机位角度「${shot.cameraAngle}」属于景别，请确认实际机位；原值保留`:'机位角度需要100字以内的文本','cameraAngle',shot.cameraAngle);
 return shot;
}
export function shotSettingsMarkup(shot,escape){
 const inherited=(key)=>shotSetting({...shot,[key]:''},key);
 const select=(key,label,options)=>`<label>${label}<select data-section="shot" data-field="${key}" aria-label="${label}"><option value="">${inherited(key)?'沿用分镜（'+escape(inherited(key))+'）':'未指定'}</option>${shot?.[key]&&!options.includes(shot[key])?`<option value="${escape(shot[key])}" selected>${escape(shot[key])}（自定义）</option>`:''}${options.map(value=>`<option value="${value}" ${shot?.[key]===value?'selected':''}>${value}</option>`).join('')}</select></label>`;
 return `<div class="field-grid">${select('shotSize','景别',SHOT_SIZES)}${select('cameraAngle','机位角度',CAMERA_ANGLES)}</div><label>提示词<textarea data-section="shot" data-field="${shot.storyboard?'productionPrompt':'description'}" rows="6" maxlength="20000" placeholder="描述这个格子的角色、动作、场景和画面">${escape(shot.storyboard?(shot.productionPrompt??shot.description):shot.description)}</textarea></label>${shot.storyboard?'<small class="sub-note">原分镜及对白保留。</small>':''}`;
}
