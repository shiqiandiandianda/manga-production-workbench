import {randomUUID} from 'node:crypto';
import {canonicalAssetNaming} from '../public/asset-naming.js';
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const projectTypes=new Set(['storyboard','production_table','novel','comic_project','character','scene','prop','pet','comic_panel','episode_strip','header','footer']);
const globalTypes=[['image','bubble'],['image','nameplate'],['image','sfx_text'],['file','font']];
const failure=(message,status=409)=>Object.assign(Error(message),{status});
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

/** Keep local asset URLs stable while using Moku 0.7 classified routes upstream. */
export function createMokuClassifiedReader({request,getAssets=()=>[]}){
 let capability,accountEpoch=0;
 const unchanged=ticket=>{if(ticket!==accountEpoch)throw Object.assign(failure('墨库账号已切换，请重新查询素材',409),{code:'SESSION_ACCOUNT_CHANGED'});};
 const assets=new Map(),revisions=new Map(),pending=new Map();
 async function cached(route){
  const now=Date.now(),hit=pending.get(route);if(hit&&hit.until>now)return hit.value;
  const ticket=accountEpoch,entry={until:now+30000,value:request(route).then(r=>r.json()).then(value=>{unchanged(ticket);return value;})};pending.set(route,entry);
  if(pending.size>48)pending.delete(pending.keys().next().value);
  try{return await entry.value;}catch(error){if(pending.get(route)===entry)pending.delete(route);throw error;}
 }
 async function supported(){
  return capability||=(async()=>{try{const value=await cached('/api/project-library/taxonomy');return value.routeVersion>=1||value.items?.some(i=>i.kind&&i.type)?value:null;}catch(error){if(error.status===404)return null;capability=null;throw error;}})();
 }
 function context(item){
  if(!uuid(item?.id)||!item.assetKind||!item.assetType)return null;
  const global=item.projectId===null||item.projectId==='global',scope=item.scopeId||item.episodeId||'project';
  if(global&&!globalTypes.some(([kind,type])=>kind===item.assetKind&&type===item.assetType))return null;
  if(!global&&(!uuid(item.projectId)||!(scope==='project'||uuid(scope))||!projectTypes.has(item.assetType)||!['image','file'].includes(item.assetKind)))return null;
  return global?'/api/global-library/'+item.assetKind+'/'+item.assetType:'/api/project-library/'+item.projectId+'/'+scope+'/'+item.assetKind+'/'+item.assetType;
 }
 function remember(item){
  if(!context(item))return item;
  assets.delete(item.id);assets.set(item.id,item);
  for(const id of [item.displayRevisionId,item.recommendedRevisionId,item.previewRevisionId,...(item.revisions||[]).map(r=>r.id)])if(uuid(id)){revisions.delete(id);revisions.set(id,item.id);}
  while(assets.size>10000)assets.delete(assets.keys().next().value);
  while(revisions.size>20000)revisions.delete(revisions.keys().next().value);
  return item;
 }
 async function normalize(items){
  const ticket=accountEpoch;
  const managed=new Set(['character','scene','prop','pet']),ids=[...new Set(items.filter(i=>managed.has(i.assetType)&&uuid(i.projectId)).map(i=>i.projectId))],subjects=new Map();
  const projects=ids.length?(await cached('/api/projects')).items||[]:[],projectNames=new Map(projects.map(p=>[p.id,p.name]));
  await Promise.all(ids.map(async id=>{const value=await cached('/api/project-library/'+id+'/subjects');subjects.set(id,new Map((value.items||[]).map(i=>[i.id,i])));}));
  unchanged(ticket);return items.map(item=>{
   const objectId=item.objectId||item.characterIds?.[0]||item.sceneIds?.[0],subject=subjects.get(item.projectId)?.get(objectId),objectName=subject?.kind===item.assetType?subject.name:item.objectName||(item.assetType==='character'?item.characterName:'');
   const named=managed.has(item.assetType)&&objectName?canonicalAssetNaming({role:item.assetType,workName:projectNames.get(item.projectId),objectName,variantName:item.variantName||item.outfitName,name:item.name}):null;
   const extension=String(item.name||'').match(/\.(png|jpe?g|webp|avif)$/i)?.[0]||'';
   return remember({...item,category:item.category||item.assetType,...(named?{name:named.displayName+extension,sourceName:item.name,projectName:projectNames.get(item.projectId)||'',subjectName:named.subjectName,canonicalName:named.identityName,canonicalVariantName:named.variantName,namingVersion:named.namingVersion,namingIssues:named.issues,...(item.assetType==='scene'?{sceneName:named.identityName}:{}),...(item.assetType==='prop'?{propName:named.subjectName}:{}),...(item.assetType==='character'?{characterName:named.subjectName,outfitName:named.variantName}:{} )}:{}),...(item.assetType==='character'?{characterName:named?.subjectName||objectName,characterGroupId:objectId||item.characterGroupId,...(!named?{outfitName:item.variantName||item.outfitName}:{})}:{}),scopeId:item.projectId===null?'global':item.episodeId||'project'});
  });
 }
 async function page(route,params,offset,limit){
  const rows=[];let total;
  for(let cursor=offset;rows.length<limit;){
   const size=Math.min(100,limit-rows.length),query=new URLSearchParams(params);query.set('limit',String(size));query.set('offset',String(cursor));
   const value=await cached(route+'?'+query),items=value.items;
   if(!Array.isArray(items))throw failure('墨库分类列表格式无效',502);
   rows.push(...items);cursor+=items.length;total=Number.isFinite(value.total)?value.total:undefined;
   if(items.length<size||total!==undefined&&cursor>=total)break;
  }
  return {items:await normalize(rows),total,offset,limit,more:total!==undefined?offset+rows.length<total:rows.length===limit};
 }
 async function list(params){
  const id=params.get('projectId'),offset=Math.max(0,Number(params.get('offset'))||0),limit=Math.max(1,Math.min(200,Number(params.get('limit'))||40)),query=new URLSearchParams();
  for(const key of ['q','folder','trash','characterId','sceneId','engineeringId','panelId','repairId'])if(params.has(key))query.set(key,params.get(key));
  const type=params.get('assetType')||params.get('category')||params.get('categoryId');
  if(id==='public'||id==='global'){
   const rows=[];for(const [kind,name]of globalTypes){if(type&&type!==name)continue;
    for(let cursor=0;;cursor+=100){const value=await page('/api/global-library/'+kind+'/'+name+'/assets',query,cursor,100);rows.push(...value.items);if(!value.more)break;if(cursor>=9900)throw failure('墨库全局素材过多，请补充分类或关键词');}
   }
   return {items:rows.slice(offset,offset+limit),offset,limit,total:rows.length,more:rows.length>offset+limit};
  }
  if(!uuid(id))throw failure('请选择明确的墨库项目',400);
  query.set('scopeId',params.get('scopeId')||'all');
  if(params.has('assetKind'))query.set('assetKind',params.get('assetKind'));
  if(projectTypes.has(type))query.set('assetType',type);
  if(type&&!projectTypes.has(type)){
   // Older category menus contain UUIDs. Filter authoritative rows, never drop the filter.
   const rows=[];for(let cursor=0;;cursor+=100){const value=await page('/api/project-library/'+id+'/catalog',query,cursor,100);rows.push(...value.items.filter(i=>i.categoryId===type||i.category===type));if(!value.more)break;if(cursor>=9900)throw failure('墨库分类结果过多，请补充关键词');}
   return {items:rows.slice(offset,offset+limit),offset,limit,total:rows.length,more:rows.length>offset+limit};
  }
  return page('/api/project-library/'+id+'/catalog',query,offset,limit);
 }
 async function locate(id,revision=false){
  let item=assets.get(revision?revisions.get(id):id);if(item)return item;
  // Saved bindings carry immutable IDs. Find their current classification without changing them.
  if(revision){const saved=getAssets().find(a=>a.library?.revisionId===id)?.library;if(saved?.assetId){item=await locate(saved.assetId);return detail(item);}}
  const projects=await cached('/api/projects');
  for(const projectId of [...(projects.items||[]).filter(p=>!p.deletedAt&&uuid(p.id)).map(p=>p.id),'public']){
   for(let offset=0;;offset+=200){const result=await list(new URLSearchParams({projectId,offset:String(offset),limit:'200'}));item=assets.get(revision?revisions.get(id):id);if(item)return item;if(!result.more)break;if(offset>=9800)throw failure('墨库目录过大，请先搜索目标素材');}
  }
  throw failure(revision?'缺少此固定版本的分类上下文，请重新搜索并打开对应素材':'此资产不在可访问的已分类目录中，请在墨库检查分类或删除状态',404);
 }
 async function detail(item){
  const ticket=accountEpoch;
  const value=await request(context(item)+'/assets/'+item.id).then(r=>r.json());
  unchanged(ticket);
  if(value.id!==item.id)throw failure('墨库返回的资产身份不一致',502);
  return (await normalize([{...item,...value}]))[0];
 }
 async function appendTags(assetId,labels){
  if(!uuid(assetId)||!Array.isArray(labels)||!labels.length||labels.length>50||labels.some(t=>typeof t!=='string'||/[\x00-\x1f\x7f]/.test(t)||!t.normalize('NFKC').trim()||t.normalize('NFKC').trim().length>100))throw failure('标签须为1至50项，每项1至100个字符且不能含控制字符',400);
  const ticket=accountEpoch,wanted=labels.map(t=>t.normalize('NFKC').trim());
  const taxonomy=await supported();unchanged(ticket);if(!taxonomy)throw failure('当前墨库不支持分类标签修改，请升级墨库',409);
  for(let attempt=0;attempt<3;attempt++){
   const item=await detail(await locate(assetId));unchanged(ticket);
   const tags=[...(item.tags||[])],keys=new Set(tags.map(t=>t.normalize('NFKC').trim().toLowerCase()));
   for(const label of wanted){const key=label.toLowerCase();if(!keys.has(key)){keys.add(key);tags.push(label);}}
   if(tags.length===(item.tags||[]).length)return item;
   if(tags.length>50)throw failure('追加后超过墨库每个文件50个标签的上限',400);
   try{
    const value=await request(context(item)+'/assets/'+assetId,{method:'PATCH',body:JSON.stringify({objectVersion:item.objectVersion,tags,tagDecision:'provided'}),headers:{'Idempotency-Key':randomUUID()}}).then(r=>r.json());
    unchanged(ticket);if(value.id!==assetId)throw failure('标签更新返回了其他资产',502);pending.clear();return (await normalize([{...item,...value}]))[0];
   }catch(error){unchanged(ticket);if(error.status!==409||error.code&&error.code!=='VERSION_CONFLICT'||attempt===2)throw error;}
  }
 }
 return {supported,remember,appendTags,invalidate(){assets.clear();revisions.clear();pending.clear();},clear(){accountEpoch++;capability=null;assets.clear();revisions.clear();pending.clear();},async handle(route,options={}){
  const ticket=accountEpoch;
  if((options.method||'GET')!=='GET')return null;
  const url=new URL(route,'http://local'),history=url.pathname.match(/^\/api\/assets\/([a-f0-9-]{36})\/revisions(?:\/([a-f0-9-]{36}))?$/i),match=url.pathname.match(/^\/api\/(assets\/([a-f0-9-]{36})|revisions\/([a-f0-9-]{36})\/(download|references|preview\/[a-zA-Z0-9_.-]+))$/i);
  if(!['/api/assets','/api/categories'].includes(url.pathname)&&!match&&!history)return null;
  const taxonomy=await supported();if(!taxonomy)return null;
  if(history){
   const item=await locate(history[1]),base=context(item)+'/assets/'+item.id+'/revisions';
   const result=await request(base+(history[2]?'/'+history[2]:'')+url.search,options),value=await result.json();unchanged(ticket);
   for(const revision of history[2]?[value]:(value.items||[])){if(!uuid(revision.id)||revision.assetId!==item.id)throw failure('墨库返回的历史版本身份不一致',502);revisions.set(revision.id,item.id);}
   return response(value);
  }
  if(url.pathname==='/api/assets')return response(await list(url.searchParams));
  if(url.pathname==='/api/categories'){
   const global=['public','global'].includes(url.searchParams.get('projectId')),value=global?await cached('/api/global-library/taxonomy'):taxonomy;
   return response({items:(value.items||[]).map(i=>({...i,id:i.type}))});
  }
  if(match[2])return response(await detail(await locate(match[2])));
  const item=await locate(match[3],true);
  return request(context(item)+'/assets/'+item.id+'/revisions/'+match[3]+'/'+match[4]+url.search,options);
 }};
}
