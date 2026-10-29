// Shared by the editor, classified Moku reader and all asset upload entrypoints.
// Names describe content; immutable asset/revision IDs continue to identify files.
export const ASSET_NAMING_VERSION=1;
export const cleanAssetText=value=>String(value??'').normalize('NFKC').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
const key=value=>cleanAssetText(value).toLowerCase().replace(/[\s_｜|·（）()\-]+/gu,'');
const withoutExtension=value=>cleanAssetText(value).replace(/\.(?:png|jpe?g|webp|avif)$/i,'');
const placeholder=value=>!value||/未知|待确认|待绑定|待核实|待设计|未指定|不明确|待与(?:项目)?主库对应/u.test(value);
const separator=/^[\s_\-|｜·:：]+/u;
function removePrefix(value,prefix){
 if(!prefix)return value;
 if(value.toLowerCase()===prefix.toLowerCase())return '';
 if(value.slice(0,prefix.length).toLowerCase()===prefix.toLowerCase()&&separator.test(value.slice(prefix.length)))return value.slice(prefix.length).replace(separator,'');
 return value;
}
export function canonicalSubjectName(value,{workName=''}={}){
 let text=withoutExtension(value),prior;
 do{prior=text;text=removePrefix(text,cleanAssetText(workName));}while(text!==prior&&text);
 return text;
}
export function canonicalVariantName(value,{workName='',subjectName='',sourceName=''}={}){
 let text=withoutExtension(value),work=cleanAssetText(workName),subject=canonicalSubjectName(subjectName,{workName:work});
 // Older pinned local images may not yet carry the project title. Derive it
 // only when the same explicit subject boundary occurs in the source label.
 if(!work&&subject){const original=withoutExtension(sourceName),at=original.indexOf('-'+subject+'-');if(at>0){const prefix=original.slice(0,at);if(text.startsWith(prefix+'-'+subject+'-'))work=prefix;}}
 for(let i=0;i<12;i++){const before=text;text=removePrefix(removePrefix(removePrefix(text,work),cleanAssetText(subjectName)),subject);if(text===before)break;}
 text=text.replace(/(?:^|[\s_·-]+)生成(?:版)?[\s_·-]*\([a-f0-9-]{6,}(?:[·_\s]+[a-f0-9-]{6,})*\)(?=$|[\s_·-])/igu,' ');
 text=text.replace(/(?:^|[\s_·-]+)(?:生成(?:版)?[\s_·-]*[（(]?[a-f0-9-]{6,}[)）]?|[vr]\d+)(?=$|[\s_·-])/igu,' ').trim();
 const tokens=text.split(/(?:__|[|｜]|\s*·\s*|_)/u).map(s=>s.trim()).filter(s=>s&&!/^(?:设定|设定图|设定卡|标准卡|角色卡|完整角色卡|整张角色卡|普通人物角色卡|主景|原始生成图|[vr]\d+|20\d{6}(?:[- ]?\d{6})?)$/iu.test(s));
 text=tokens.join('·').replace(/^[\s_·-]+|[\s_·-]+$/gu,'');
 return placeholder(text)?'':text;
}
export function sceneIdentityName(subjectName,variantName){
 const subject=cleanAssetText(subjectName),variant=cleanAssetText(variantName);
 if(!variant||key(subject).includes(key(variant)))return subject;
 // A room/area is a scene identity, not a camera direction. Preserve location
 // qualifiers; never collapse two buildings, floors or rooms by suffix alone.
 if(/书房|客房|大堂|前院|后院|院中|门口|大门|走廊|庭院|大厅|内室|卧室|卧房|[一二三四五六七八九十\d]+楼|路段|山道|城门|街道|地窟|楼梯|地牢/u.test(variant)){
  const area=variant.replace(/(?:[·_\s-]*)(?:正视图?|反打|侧视图?|俯视图?|日景|夜景|白天|夜晚|清晨|黄昏)$/u,'').replace(/[·_\s-]+$/u,'');
  if(area&&!key(subject).includes(key(area)))return subject+'·'+area;
 }
 return subject;
}
export function canonicalAssetNaming({role='',workName='',objectName='',variantName='',name=''}={}){
 const sourceName=cleanAssetText(name),subjectName=canonicalSubjectName(objectName,{workName}),variant=canonicalVariantName(variantName,{workName,subjectName,sourceName}),issues=[];
 if(!subjectName)issues.push('缺少明确的所属资产对象');
 if(variantName&&placeholder(withoutExtension(variantName)))issues.push('变体是待确认占位，未作为服装/机位采用');
 if(variantName&&!variant&&!placeholder(withoutExtension(variantName)))issues.push('变体仅含名称前缀或文件技术标记');
 const identityName=role==='scene'?sceneIdentityName(subjectName,variant):subjectName;
 const displayName=subjectName?[subjectName,variant].filter(Boolean).join('__'):sourceName;
 return {namingVersion:ASSET_NAMING_VERSION,subjectName,variantName:variant,identityName,displayName,sourceName,issues};
}
export function canonicalAssetFileName(input,extension='.png'){
 const result=canonicalAssetNaming(input),ext=/^\.(?:png|jpe?g|webp|avif)$/i.test(extension)?extension.toLowerCase():'.png';
 if(!result.subjectName)throw Error('资产名称缺少所属人物、场景或道具');
 return result.displayName.replace(/[\\/:*?"<>|]/g,'_').slice(0,180)+ext;
}
