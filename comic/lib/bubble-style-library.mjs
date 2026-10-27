import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {comicStyles,validAssetContour} from '../public/comic-styles.js';
import {comicStyleSourcePath} from './comic-style-library.mjs';
import {check} from './store.mjs';
import {writeFileAtomicSync} from './durable-files.mjs';
import {createClassifiedBubbleStyles} from './classified-bubble-styles.mjs';

/**
 * 气泡样式库放在墨库的独立文件夹里，不再以本地 comic-style-data.js 为准。
 *
 * 发布：当前全部样式的预览图 + 一份清单（轮廓/内缩/用途/纹理标记）上传到公共素材库的
 * `气泡素材` 文件夹；清单本身也是一个不可变版本，编辑器按 revisionId 读取。
 * 读取：优先墨库清单，失败时用上一次成功读取的缓存，不静默改用本地旧目录。
 */
export const BUBBLE_STYLE_FOLDER='气泡素材';
const MANIFEST_NAME='气泡素材库.json';
const MANIFEST_FORMAT='comic-bubble-style-library';

const pick=style=>({id:style.id,label:style.label,family:style.family||'',uses:[...(style.uses||[])],contour:style.contour,insets:{...style.insets},texture:!!style.texture,width:style.width||null,height:style.height||null,parts:style.parts,rays:style.rays,frame:style.frame,preset:style.preset,tailKind:style.tailKind,tailPreset:style.tailPreset});

export function createBubbleStyleLibrary({dataDir,library,store,json,body,getStyles,sourcePath}){
  const cacheFile=path.join(dataDir,'bubble-styles.local.json');
  let cache={};try{cache=JSON.parse(fs.readFileSync(cacheFile,'utf8'));}catch{}
  let manifestCache=null,manifestAt=0;
  const save=()=>{try{writeFileAtomicSync(cacheFile,JSON.stringify(cache));}catch{}};
  const localStyles=getStyles||(()=>comicStyles.filter(style=>style.kind==='bubble'&&validAssetContour(style.contour)));
  const classified=createClassifiedBubbleStyles({library,cacheFile:path.join(dataDir,'bubble-styles.classified.local.json'),getStyles:localStyles,sourcePath:sourcePath||comicStyleSourcePath,pick});

  function withPreview(item){return {...item,previewUrl:'/api/library/revisions/'+encodeURIComponent(item.revisionId)+'/download'};}

  async function publish({force=false}={}){
    if(await library.supportsClassified?.())return classified.publish({force});
    check(library?.uploadAsset,'墨库适配层不支持上传');
    const items=cache.items||(cache.items={});
    const list=[];
    for(const style of localStyles()){
      let entry=items[style.id];
      if(!entry||force){
        const file=comicStyleSourcePath(style);
        check(file&&fs.existsSync(file),'气泡样式预览文件缺失：'+style.label);
        const bytes=fs.readFileSync(file);
        const uploaded=await library.uploadAsset({projectId:null,name:style.label+'.png',bytes,mime:'image/png',folder:BUBBLE_STYLE_FOLDER,category:'reference'});
        entry=items[style.id]={assetId:uploaded.assetId,revisionId:uploaded.revisionId,name:style.label+'.png',sha256:createHash('sha256').update(bytes).digest('hex')};
        save();
      }
      if(/^ref(?:22|23)-/.test(style.id)&&style.sourceSvgPath&&!entry.svgRevisionId){
        const svgBytes=fs.readFileSync(style.sourceSvgPath),svg=await library.uploadAsset({projectId:null,name:style.label+'.svg',bytes:svgBytes,mime:'image/svg+xml',folder:BUBBLE_STYLE_FOLDER,category:'reference'});
        Object.assign(entry,{svgAssetId:svg.assetId,svgRevisionId:svg.revisionId,svgSha256:createHash('sha256').update(svgBytes).digest('hex')});save();
      }
      list.push({svgAssetId:entry.svgAssetId,svgRevisionId:entry.svgRevisionId,...pick(style),assetId:entry.assetId,revisionId:entry.revisionId,previewName:entry.name});
    }
    check(list.length,'没有可发布的气泡样式');
    const manifest={format:MANIFEST_FORMAT,version:1,folder:BUBBLE_STYLE_FOLDER,publishedAt:new Date().toISOString(),items:list};
    const uploaded=await library.uploadAsset({projectId:null,name:MANIFEST_NAME,bytes:Buffer.from(JSON.stringify(manifest)),mime:'application/json',folder:BUBBLE_STYLE_FOLDER,category:'reference'});
    cache.folder=BUBBLE_STYLE_FOLDER;
    cache.manifest={assetId:uploaded.assetId,revisionId:uploaded.revisionId,publishedAt:manifest.publishedAt,count:list.length,name:MANIFEST_NAME};
    save();
    manifestCache=manifest;manifestAt=Date.now();
    return {ok:true,folder:BUBBLE_STYLE_FOLDER,count:list.length,manifest:cache.manifest};
  }

  async function readManifest({refresh=false}={}){
    if(await library.supportsClassified?.())return classified.readManifest();
    if(!refresh&&manifestCache&&Date.now()-manifestAt<60000)return manifestCache;
    check(cache.manifest?.revisionId,'气泡样式库尚未发布到墨库');
    const response=await library.remote('/api/revisions/'+encodeURIComponent(cache.manifest.revisionId)+'/download');
    const manifest=JSON.parse(await response.text());
    check(manifest?.format===MANIFEST_FORMAT&&Array.isArray(manifest.items)&&manifest.items.length,'墨库气泡样式清单格式不正确');
    manifestCache=manifest;manifestAt=Date.now();save();
    return manifest;
  }

  async function handle(request,response,{pathname,method,url}){
    if(!pathname.startsWith('/api/library/bubble-styles'))return false;
    if(method==='GET'&&pathname==='/api/library/bubble-styles'){
      try{
        const manifest=await readManifest({refresh:url.searchParams.get('refresh')==='1'});
        json(response,200,{ok:true,source:'moku',classified:!!manifest.classified,folder:BUBBLE_STYLE_FOLDER,publishedAt:manifest.publishedAt,count:manifest.items.length,items:manifest.items.map(withPreview)});
      }catch(error){
        json(response,200,{ok:false,source:'none',folder:BUBBLE_STYLE_FOLDER,items:[],error:error.message});
      }
      return true;
    }
    if(method==='POST'&&pathname==='/api/library/bubble-styles/publish'){
      await body(request);
      json(response,200,await publish({force:url.searchParams.get('force')==='1'}));
      return true;
    }
    if(method==='GET'&&pathname==='/api/library/bubble-styles/status'){
      json(response,200,{folder:BUBBLE_STYLE_FOLDER,manifest:cache.manifest||null,published:!!cache.manifest?.revisionId});
      return true;
    }
    json(response,404,{error:'气泡样式库接口不存在'});return true;
  }

  return {handle,publish,readManifest,folder:BUBBLE_STYLE_FOLDER};
}
