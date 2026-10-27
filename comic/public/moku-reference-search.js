import {fuzzyAssetCandidates} from './asset-fuzzy-search.js';
import {assetUnavailable} from './asset-availability.js';
import {isCollaborationFile} from './collaboration-files.js';
import {libraryProjectScopes} from './library-project-scope.js';
import {createAsyncCache} from './bounded-cache.js';
import {filterAssetCandidateTypes,candidateAssetRole} from './asset-candidate-types.js';
const uuid=value=>/^[a-f0-9-]{36}$/i.test(value||'');
export const mokuRevision=item=>item.displayRevisionId||item.recommendedRevisionId;
export const usableMokuImage=item=>!isCollaborationFile(item)&&!item.deletedAt&&!assetUnavailable(item)&&uuid(item.id)&&uuid(mokuRevision(item));
export function mokuCandidate(item){return {...item,id:'remote_'+item.id,filePath:'remote:'+item.id,libraryRole:candidateAssetRole(item),library:{assetId:item.id,revisionId:mokuRevision(item),projectId:item.projectId,category:item.category,assetType:item.assetType,tags:item.tags||[],characterGroupId:item.characterGroupId,characterName:item.characterName,outfitName:item.outfitName}};}

/** One catalogue for the drive. New selections always come from an immutable Moku revision. */
export function createMokuReferenceSearch({api,project,assets=[],verify=()=>{}}){
 let catalogue;const queryPages=createAsyncCache({name:'moku-search-pages',maxEntries:24,maxBytes:8*1024*1024,ttl:30000,maxPending:4}),controllers=new Set();
 async function request(route){const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),20000);try{return await api(route,'GET',undefined,{signal:controller.signal});}finally{clearTimeout(timer);controllers.delete(controller);}}
 const cachedPage=route=>queryPages.load(route,()=>request(route));
 const projects=()=>catalogue||=(async()=>{const result=await request('/api/library/projects');verify();return (result.items||[]).filter(p=>!p.deletedAt&&uuid(p.id));})().catch(error=>{catalogue=null;throw error;});
 return {projects,clear(){for(const controller of controllers)controller.abort();controllers.clear();catalogue=null;queryPages.clear();},stats:()=>queryPages.stats(),async search(query,{scope='all',maxPages=10,role,allTypes=false,onProgress=()=>{},verifySearch=()=>{}}={}){
  const check=()=>{verify();verifySearch();};check();const libraries=await projects(),preferred=libraryProjectScopes(project,assets,libraries).ids;
  const ids=scope==='all'?[...new Set([...preferred,'public',...libraries.map(p=>p.id)])]:[scope];
  // An empty query browses the current production, rather than downloading the entire drive.
  const scopes=query.trim()?ids:scope==='all'?[...new Set([...preferred,'public'])]:ids;
  const pages=new Array(scopes.length),notes=[],names=new Map(libraries.map(p=>[p.id,p.name]));names.set('public','公共素材库');let cursor=0,complete=true;
  async function worker(){for(;;){const index=cursor++;if(index>=scopes.length)return;const projectId=scopes[index],items=[];try{
   // Query the server as well as the bounded local fuzzy catalogue. Otherwise
   // an exact name or tag beyond the first pages can never be found.
   for(const term of query.trim()?[query.trim().slice(0,200),'']:[''])for(let page=0;page<maxPages;page++){
    check();onProgress('搜索墨库 · '+(names.get(projectId)||'项目库'));
    const result=await cachedPage('/api/library/assets?'+new URLSearchParams({projectId,kind:'image',groupCharacters:'false',q:term,limit:'200',offset:String(page*200)}));check();
    const rows=result.items||[];items.push(...rows.filter(usableMokuImage).map(item=>({...item,projectId:item.projectId||projectId,projectName:names.get(projectId)||'项目库'})));
    if(result.more===false||result.more===undefined&&rows.length<200)break;
    if(!rows.length||page===maxPages-1){complete=false;notes.push((names.get(projectId)||'项目库')+' 搜索未覆盖全部素材，已返回名称或标签匹配结果，请人工核对');break;}
   }
  }catch(error){check();complete=false;notes.push((names.get(projectId)||'项目库')+'：'+error.message);}pages[index]=items;}}
  await Promise.all(Array.from({length:Math.min(4,scopes.length)},worker));check();
  const items=[...new Map(pages.flat().filter(Boolean).map(item=>[item.id+'@'+mokuRevision(item),item])).values()];
  return {items:fuzzyAssetCandidates(filterAssetCandidateTypes(items,role,{allTypes}),query),complete,notes,searched:scopes.length};
 }};
}
