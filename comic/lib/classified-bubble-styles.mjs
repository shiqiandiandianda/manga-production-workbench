import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {writeFileAtomicSync} from './durable-files.mjs';
import {check} from './store.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const root=type=>'/api/global-library/image/'+type;
const typeOf=style=>/^ref23-person-/.test(style.id)?'nameplate':'bubble';

// Keep editable geometry beside its exact image revision, using classified routes.
export function createClassifiedBubbleStyles({library,cacheFile,getStyles,sourcePath,pick}){
 let running;
 async function identity(){const me=await library.read('/api/auth/me');check(me?.user?.id||me?.id,'墨库未返回制作账号身份');return hash(JSON.stringify([library.baseUrl,me.user?.id||me.id]));}
 function cacheFor(account){let cache;try{cache=JSON.parse(fs.readFileSync(cacheFile,'utf8'));}catch{}return cache?.account===account?cache:{account,items:{}};}
 const save=cache=>writeFileAtomicSync(cacheFile,JSON.stringify(cache));
 async function probe(){try{await library.read(root('bubble')+'/styles?limit=1');await library.read(root('nameplate')+'/styles?limit=1');}catch(e){if(e.status===404)throw Error('当前墨库尚未提供固定版本气泡样式接口，请先升级墨库；本次未上传任何样式');throw e;}}
 async function readManifest(){
  await identity();const items=[];
  for(const type of ['bubble','nameplate']){let offset=0;for(let page=0;page<10000;page++){
   const result=await library.read(root(type)+'/styles?limit=100&offset='+offset);check(Array.isArray(result.items),'墨库气泡样式目录格式无效');
   for(const item of result.items){library.rememberClassifiedAsset?.({...item,id:item.assetId,recommendedRevisionId:item.revisionId});items.push(item);}
   if(!result.more)break;check(result.items.length,'墨库气泡样式分页未前进');offset+=result.items.length;
  }}
  check(items.length,'墨库全局库尚未发布可编辑气泡样式');
  return {format:'comic-bubble-style-library',version:2,classified:true,items,publishedAt:items.map(i=>i.publishedAt||'').sort().at(-1)};
 }
 async function publishFresh({force=false}={}){
  const account=await identity();await probe();const cache=cacheFor(account),styles=getStyles();check(styles.length,'没有可发布的气泡样式');
  let count=0;
  for(const style of styles){
   const file=sourcePath(style);check(file&&fs.existsSync(file),'气泡样式预览文件缺失：'+style.label);
   const svgPath=style.sourceSvgPath?sourcePath({...style,filePath:style.sourceSvgPath}):null;
   check(!svgPath||fs.existsSync(svgPath),'气泡样式SVG源稿缺失：'+style.label);
   const bytes=fs.readFileSync(file),assetType=typeOf(style),sourceSvgBase64=svgPath?fs.readFileSync(svgPath).toString('base64'):undefined;
   const payload={style:pick(style),...(sourceSvgBase64?{sourceSvgBase64}:{})},fingerprint=hash(JSON.stringify([assetType,hash(bytes),payload]));
   let entry=cache.items[style.id];
   if(!entry||entry.fingerprint!==fingerprint||force&&entry.confirmed){
    let previous;if(entry?.assetId){previous=await library.read(root(assetType)+'/assets/'+entry.assetId);check(previous.assetType===assetType,'样式分类已变化，请先核对原样式');}
    const uploaded=await library.uploadAsset({projectId:null,assetKind:'image',assetType,name:style.label+'.png',bytes,mime:'image/png',operationId:'bubble-style:'+hash(JSON.stringify([account,style.id,fingerprint,previous?.id,previous?.objectVersion])),...(previous?{assetId:previous.id,objectVersion:previous.objectVersion}:{})});
    entry=cache.items[style.id]={fingerprint,assetType,assetId:uploaded.assetId,revisionId:uploaded.revisionId,key:randomUUID(),confirmed:false};save(cache);
   }
   // A lost response retries the same revision and key, never another upload.
   const fixed=root(assetType)+'/assets/'+entry.assetId+'/revisions/'+entry.revisionId;
   const result=await library.remote(fixed+'/styles',{method:'POST',headers:{'Idempotency-Key':entry.key},body:JSON.stringify(payload)}).then(r=>r.json());
   check(result.revisionId===entry.revisionId&&result.id===style.id,'墨库没有返回固定样式登记回执');entry.confirmed=true;save(cache);count++;
  }
  return {ok:true,classified:true,count,folder:'气泡素材',manifest:{count,publishedAt:new Date().toISOString()}};
 }
 const pinned=fn=>library.withSession?library.withSession(fn):fn();
 return {readManifest:()=>pinned(readManifest),publish(options){if(running)return running;running=pinned(()=>publishFresh(options)).finally(()=>{running=null;});return running;}};
}
