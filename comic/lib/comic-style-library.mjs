import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {comicStyles,comicStyle} from '../public/comic-styles.js';
import {inspectImageFile} from './image-files.mjs';
import {imagePathKey} from './image-directory.mjs';
import {uid,check} from './store.mjs';
import {sendFile} from './send-file.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),customCache=process.env.COMIC_STYLE_LIBRARY_DIR?path.resolve(process.env.COMIC_STYLE_LIBRARY_DIR):null;
const catalogueRoot=(()=>{const value=comicStyles.find(item=>typeof item.filePath==='string')?.filePath||'',parts=value.split(/[\\/]/),index=parts.lastIndexOf('漫画素材');return index>=0&&path.isAbsolute(value)?path.resolve(parts.slice(0,index+1).join(path.sep)):null;})();
const bundledCache=path.join(root,'materials','漫画素材');
// The catalogue records the original D: paths. COMIC_STYLE_LIBRARY_DIR points at a copy of the
// 漫画素材 folder on another computer; the same relative path is looked up there.
export function comicStyleSourcePath(item){const parts=String(item.filePath||'').split(/[\\/]/),index=parts.lastIndexOf('漫画素材');if(index<0)return '';const relative=parts.slice(index+1);if(customCache)return path.join(customCache,...relative);if(item.filePath&&fs.existsSync(item.filePath))return item.filePath;return path.join(bundledCache,...relative);}
export function comicStyleFile(id){const item=comicStyle(id);check(item,'素材款式不存在',404);const source=comicStyleSourcePath(item);check(source&&fs.existsSync(source),'素材文件缺失，请恢复素材库或设置 COMIC_STYLE_LIBRARY_DIR',404);const file=fs.realpathSync(source),roots=customCache?[customCache]:[catalogueRoot,bundledCache];check(roots.filter(Boolean).some(base=>{if(!fs.existsSync(base))return false;const relative=path.relative(fs.realpathSync(base),file);return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative); }),'素材路径超出素材库',400);return file;}
/** 素材文件在本机是否存在；不存在时排版改用可编辑的文字字效。 */
export function comicStyleAvailable(id){const item=comicStyle(id);if(!item)return false;try{return fs.existsSync(comicStyleSourcePath(item));}catch{return false;}}
export function registerComicStyle(store,id){
 const item=comicStyle(id),file=comicStyleFile(id),existing=store.db.assets.find(asset=>imagePathKey(asset.filePath)===imagePathKey(file));if(existing)return existing;
 const info=inspectImageFile(file),asset={id:uid('asset'),name:item.label,...info,source:'comic-style-library',comicStyleId:id,comicKind:item.kind,word:item.word||'',family:item.family,sourceUrl:item.sourceUrl,created:new Date().toISOString()};store.db.assets.push(asset);return asset;
}
export function hydrateComicStyleAssets(project,store){
 for(const page of project.pages)for(const bubble of page.bubbles){if(bubble.styleTextureId)bubble.styleTextureAssetId=registerComicStyle(store,bubble.styleTextureId).id;if(bubble.visualStyleId&&comicStyle(bubble.visualStyleId))bubble.visualAssetId=registerComicStyle(store,bubble.visualStyleId).id;if(bubble.visualAssetId)store.asset(bubble.visualAssetId);}
 return project;
}
export async function handleComicStyleLibrary(request,response,url,store,json,body){
 if(request.method==='GET'&&url.pathname==='/api/comic-style-library'){json(response,200,{items:comicStyles.map(({filePath,sourceSvgPath,...item})=>({...item,available:fs.existsSync(comicStyleSourcePath({filePath})),previewUrl:'/api/comic-style-library/items/'+encodeURIComponent(item.id)+'/image'})),custom:store.db.assets.filter(asset=>asset.source==='comic-sfx-design')});return true;}
 const match=url.pathname.match(/^\/api\/comic-style-library\/items\/([A-Za-z0-9_-]+)\/image$/);
 if(request.method==='GET'&&match){const file=comicStyleFile(match[1]);await sendFile(response,file,{'Content-Type':'image/png','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'},{missingMessage:'素材文件缺失，请恢复素材库'});return true;}
 if(request.method==='POST'&&url.pathname==='/api/comic-style-library/register'){const input=await body(request);check(Array.isArray(input.ids)&&input.ids.length<=130,'素材选择数量无效');const assets=[...new Set(input.ids)].map(id=>registerComicStyle(store,id));store.save();json(response,200,{assets});return true;}
 return false;
}
