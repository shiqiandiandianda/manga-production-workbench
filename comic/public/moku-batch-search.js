import {usableMokuImage,mokuRevision} from './moku-reference-search.js';
import {filterAssetCandidateTypes} from './asset-candidate-types.js';
import {exactAssetCandidates} from './asset-exact-search.js';
import {estimateRetainedBytes} from './bounded-cache.js';

/** A per-click catalogue: all names of one type share the same complete read.
 * Never share snapshots across accounts, projects or subsequent match runs.
 * Partial catalogues may suggest candidates, but cannot authorize adoption.
 */
export function createMokuBatchSearch({api,projectIds,projects=[],verify=()=>{},onProgress=()=>{},maxPages=50,maxBytes=24*1024*1024}){
 const pending=new Map(),controllers=new Set(),names=new Map(projects.map(p=>[p.id,p.name]));let closed=false,retainedBytes=0;
 const check=()=>{if(closed)throw Error('本次匹配已结束');verify();};
 async function read(projectId,role){
  const items=[],notes=[];let offset=0,complete=false;
  try{for(let page=0;page<maxPages;page++){
   check();onProgress('读取 '+(names.get(projectId)||'公共素材库')+' · '+({character:'人物',scene:'场景',prop:'道具'}[role]||'图片')+'目录 · 第'+(page+1)+'页');
   const params=new URLSearchParams({projectId,kind:'image',groupCharacters:'false',pageMode:'source',q:'',limit:'200',offset:String(offset)});
   if(['character','scene','prop'].includes(role))params.set('assetType',role);
   const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),20000);let result;
   try{result=await api('/api/library/assets?'+params,'GET',undefined,{signal:controller.signal});}finally{clearTimeout(timer);controllers.delete(controller);}
   check();if(!Array.isArray(result.items))throw Error('素材目录格式无效');
   const rows=result.items.filter(usableMokuImage).map(item=>({...item,projectId:item.projectId||projectId,projectName:names.get(projectId)||'公共素材库'}));
   const bytes=estimateRetainedBytes(rows);if(retainedBytes+bytes>maxBytes){notes.push('素材目录超过本次读取上限，请缩小范围后核对');break;}retainedBytes+=bytes;items.push(...rows);
   if(result.more===false||result.more===undefined&&result.items.length<200){complete=true;break;}
   const next=result.nextOffset??offset+200;if(!Number.isSafeInteger(next)||next<=offset)throw Error('素材分页未向后推进');offset=next;
  }}catch(error){check();notes.push((names.get(projectId)||'公共素材库')+'：'+error.message);}
  if(!complete&&!notes.length)notes.push('素材目录尚未读取完整，请人工核对；未自动采用');
  return {items,complete,notes};
 }
 async function catalogue(role){
  check();if(!pending.has(role))pending.set(role,(async()=>{
   const results=[];const ids=[...new Set(projectIds)];
   // Scope count is normally one. Bound network concurrency when libraries are linked.
   for(let i=0;i<ids.length;i+=3)results.push(...await Promise.all(ids.slice(i,i+3).map(id=>read(id,role))));
   check();return {items:[...new Map(results.flatMap(r=>r.items).map(i=>[i.id+'@'+mokuRevision(i),i])).values()],complete:ids.length>0&&results.every(r=>r.complete),notes:results.flatMap(r=>r.notes)};
  })());return pending.get(role);
 }
 return {async search(query,{role,...options}={}){const data=await catalogue(role);check();return {...data,items:exactAssetCandidates(filterAssetCandidateTypes(data.items,role),query,{role,...options})};},clear(){closed=true;for(const c of controllers)c.abort();controllers.clear();pending.clear();}};
}
