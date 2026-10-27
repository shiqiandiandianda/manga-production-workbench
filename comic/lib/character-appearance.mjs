import {characterRole} from '../public/character-role.js';
export {characterRole} from '../public/character-role.js';
const text=value=>typeof value==='string'?value.trim():'';
export const CHARACTER_APPEARANCE_VERSION=1;
export const CHARACTER_ROLES=['auto','lead','background'];
export const characterGenerationMode=asset=>asset?.characterOutputMode==='components'?'components':'card';
export function characterAppearanceSettings(input){
 const result={};
 if(input.characterRole!==undefined){if(!CHARACTER_ROLES.includes(input.characterRole))throw Error('人物定位无效');result.characterRole=input.characterRole;}
 if(input.characterOutputMode!==undefined){if(!['card','components'].includes(input.characterOutputMode))throw Error('人物生成方式无效');result.characterOutputMode=input.characterOutputMode;}
 if(input.appearanceNotes!==undefined){if(typeof input.appearanceNotes!=='string'||input.appearanceNotes.length>1600)throw Error('人物外观补充格式无效或过长');result.appearanceNotes=input.appearanceNotes.trim();}
 return result;
}
function targetBuild(asset){
 const name=text(asset.name),aliases=[name,name.replace(/^围观/u,'')].filter(Boolean),source=text(asset.description)+'\n'+text(asset.prompt);
 for(const alias of aliases){const at=source.indexOf('瘦高的'+alias);if(at>=0||source.includes(alias+'身材瘦高'))return '保留来源明确的瘦高体型，脸型偏长、面颊略窄，五官平常，不画成尖下巴的美型少年。';}
 for(const alias of aliases)if(source.includes('圆脸的'+alias)||source.includes('圆脸'+alias)||source.includes(alias+'是圆脸'))return '保留来源明确的圆脸，脸颊自然饱满，下颌圆钝，五官平常。';
 return '采用普通人的自然脸型，下颌有正常宽度，眉毛平实、眼型常见，鼻梁和嘴唇比例自然；不要尖下巴、大亮眼和精修美型五官。';
}
export function characterAppearancePrompt(asset){
 const role=characterRole(asset),notes=text(asset.appearanceNotes||asset.workflow?.appearanceNotes);
 if(role!=='background')return notes?'本角色人工外观补充：'+notes+'。保持已确认身份和来源指定的年龄、性别、体型。':'';
 return ['人物定位：普通路人角色，姓名或称呼为「'+asset.name+'」。以普通人的外貌为标准，不使用男主角、偶像或俊美公子的外观模板。',
  targetBuild(asset),'发型与身份、时代相符，束发或发髻朴素实用，发量与轮廓自然，不加飘逸碎发、精致层层刘海、华丽发饰或主角式造型。',
  '与本作品男主和主要人物区分脸部轮廓、眉眼比例与发型剪影；不能只换衣服、发色或配饰后复用同一张脸。',
  '普通不等于丑化：年龄、性别、体型沿用资料，不强加肥胖、衰老、残疾、疤痕或滑稽表情；衣着朴素、自然干净，符合原定服装。',
  '脸部特写与正侧背全身必须是这个同一位普通路人，不能在全身图里重新美化成俊美男主。',
  notes?'本角色人工外观补充：'+notes:'未明确的外观只作为候选设计；已有本人的确认参考时保持该身份，除非用户明确要求重新设计。'].join('\n');
}
