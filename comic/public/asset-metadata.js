import {canonicalSubjectName,canonicalVariantName} from './asset-naming.js';
export const assetNameKey=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s_｜|·（）()\-]+/gu,'');
export function assetLibraryRole(asset){const explicit=asset?.libraryRole;if(['character','scene','prop','style'].includes(explicit))return explicit;if(asset?.library?.characterGroupId||asset?.characterGroupId)return 'character';return ({character:'character',角色:'character',人物:'character',scene:'scene',场景:'scene',prop:'prop',道具:'prop',style:'style',画风:'style'})[asset?.library?.category]||null;}
export function assetMetadata(asset){
 const file=String(asset.name||asset.relativePath||asset.filePath||'').replace(/\\/g,'/').split('/').at(-1),stem=file.replace(/\.(png|jpe?g|webp)$/i,'').normalize('NFKC');
 const prefix=/^(?:(?:BASE|SUP)_)?(CHAR|SCENE|PROP|STYLE)_\d+(?:_DETAIL)?(?:_R\d+)?_/i.exec(stem);
 const version=/(?:^|_)(?:v|r)(\d+)(?:_|$)/i.exec(stem)?.[1]||'';
 const body=stem.replace(/^(?:(?:BASE|SUP)_)?(?:CHAR|SCENE|PROP|STYLE)_\d+(?:_DETAIL)?(?:_R\d+)?_/i,'').replace(/^\d{2,}[_-]/,'').replace(/_(?:v|r)\d+(?=_|$)/ig,'');
 const tokens=body.split(/[_|]+/).map(s=>s.trim()).filter(Boolean),kind=tokens.includes('主景')?'主景':tokens.includes('细节')?'细节':tokens.some(s=>/^(设定|设定卡|三视图)$/.test(s))?'设定':'图片';
 const words=tokens.filter(s=>! /^(主景|细节|设定|设定图|设定卡|三视图|标准卡|角色卡|完整角色卡|DETAIL|R\d+)$/i.test(s));
 const role=assetLibraryRole(asset)||({CHAR:'character',SCENE:'scene',PROP:'prop',STYLE:'style'})[prefix?.[1].toUpperCase()]||(['主景','细节'].includes(kind)?'scene':'other');
 const groupedName=asset.library?.characterName||asset.characterName||asset.library?.sceneName||asset.sceneName||asset.library?.propName||asset.propName;
 const named=asset.libraryName||groupedName||words.join(' · ')||stem;
 const rawState=asset.libraryState??asset.library?.canonicalVariantName??asset.canonicalVariantName??asset.library?.outfitName??asset.outfitName??((role==='character'||body.includes('|'))?words.slice(1).join(' · '):'');
 const workName=asset.library?.projectName||asset.projectName||'',rawName=asset.libraryName||groupedName||(role==='character'||body.includes('|')?words[0]:named),name=canonicalSubjectName(rawName,{workName}),state=canonicalVariantName(rawState,{workName,subjectName:name,sourceName:asset.library?.sourceName||asset.sourceName||asset.name});
 const aliases=Array.isArray(asset.libraryAliases)?asset.libraryAliases:String(asset.libraryAliases||'').split(/[、,，;；]+/).filter(Boolean);
 return {name:name||file,state,role,kind,version,file,parts:words,aliases,keys:[name,...aliases,...(role==='scene'?words:[])].map(assetNameKey).filter(Boolean)};
}
