import {check,validateProject} from './store.mjs';
import {assetWorkspaceInventory,assetRequirementKey} from '../public/asset-workspace-model.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {bindWorkspaceAsset} from './asset-workspace-binding.mjs';
import {assetUnavailable} from '../public/asset-availability.js';
import {pageEpisode} from '../public/episode-boards.js';
const format='comic-episode-asset-reuse',uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v),active=new Set(['queued','preparing','running','recoverable','delegated','awaiting_confirmation']);
const fixed=a=>a?.library&&uuid(a.library.assetId)&&uuid(a.library.revisionId)&&/^[a-f0-9]{64}$/.test(a.library.sha256||'')&&!assetUnavailable(a)&&!a.deletedAt&&!a.trashedAt;
const same=(a,ref)=>fixed(a)&&a.library.assetId===ref.assetId&&a.library.revisionId===ref.revisionId&&a.library.sha256===ref.sha256&&(a.library.projectId??null)===ref.projectId;
function inventory(project,assets,pageId){check(project.pages.some(p=>p.id===pageId)&&pageEpisode(project,project.pages.find(p=>p.id===pageId)),'请先选择有明确话号的画板');return assetWorkspaceInventory(project,assets,{scope:'episode',pageId,includeSources:false}).filter(r=>['character','scene'].includes(r.role));}
export function exportEpisodeSelections(project,assets,pageId){
 const items=[],skipped=[];
 for(const row of inventory(project,assets,pageId)){
  const selected=row.assetIds.map(id=>assets.find(a=>a.id===id)),unique=new Map(selected.filter(fixed).map(a=>[a.library.assetId+':'+a.library.revisionId,a]));
  if(!selected.length)continue;
  if(unique.size!==1||selected.some(a=>!fixed(a))){skipped.push(row.name+'：存在多个版本或尚未采用墨库固定版本');continue;}
  const a=[...unique.values()][0];items.push({name:row.name,role:row.role,state:row.state||'',asset:{assetId:a.library.assetId,revisionId:a.library.revisionId,sha256:a.library.sha256,projectId:a.library.projectId??null}});
 }
 check(items.length,'本话还没有可导出的已采用人物或场景图片');
 return {bundle:{format,version:1,source:{title:project.title,episode:pageEpisode(project,project.pages.find(p=>p.id===pageId))},items},skipped};
}
export function validateReuseBundle(bundle){
 check(bundle?.format===format&&bundle.version===1&&Array.isArray(bundle.items)&&bundle.items.length>0&&bundle.items.length<=500,'复用文件格式无效或资产数量超过500项');
 check(JSON.stringify(bundle).length<=2*1024*1024,'复用文件超过2MB');const keys=new Set();
 for(const item of bundle.items){check(item&&['character','scene'].includes(item.role)&&typeof item.name==='string'&&item.name.trim()&&item.name.length<=300&&typeof item.state==='string'&&item.state.length<=300,'复用文件的人物、场景或服装名称无效');const ref=item.asset;check(ref&&uuid(ref.assetId)&&uuid(ref.revisionId)&&/^[a-f0-9]{64}$/.test(ref.sha256||'')&&(ref.projectId===null||uuid(ref.projectId)),'复用文件缺少有效墨库固定版本');const key=assetRequirementKey(item);check(!keys.has(key),'复用文件中同一人物服装或场景存在重复项，请重新导出');keys.add(key);}
 return bundle;
}
function usableTargets(store,project,row){
 const panels=new Map(project.pages.flatMap(p=>p.panels.map(f=>[f.id,f]))),blocked=use=>use.locked||use.skipped||use.text||store.db.jobs.some(j=>j.projectId===project.id&&j.panelId===use.panelId&&active.has(j.status));
 const protectedSegments=new Set(row.uses.filter(blocked).map(u=>panels.get(u.panelId)?.productionSegment).filter(Boolean));
 return row.uses.filter(u=>!blocked(u)&&!protectedSegments.has(panels.get(u.panelId)?.productionSegment));
}
export function previewEpisodeSelections(store,project,input){
 const bundle=validateReuseBundle(input.bundle),rows=inventory(project,store.db.assets,input.pageId),byKey=new Map(rows.map(r=>[r.key,r]));
 const items=bundle.items.map((item,index)=>{
  const row=byKey.get(assetRequirementKey(item));if(!row)return {index,name:item.name,state:item.state,role:item.role,status:'unused',count:0};
  const targets=usableTargets(store,project,row);
  const chosen=row.assetIds.map(id=>store.db.assets.find(a=>a.id===id)),conflict=chosen.some(a=>!same(a,item.asset));
  const status=!targets.length?'blocked':conflict?'conflict':chosen.length&&row.uses.every(u=>!u.missing)?'same':'reuse';
  return {index,name:item.name,state:item.state,role:item.role,status,count:targets.length,blocked:row.uses.length-targets.length};
 });
 const keys=new Set(bundle.items.map(assetRequirementKey));return {source:{title:String(bundle.source?.title||'').slice(0,300),episode:bundle.source?.episode},items,newItems:rows.filter(r=>!keys.has(r.key)&&!r.assetIds.length).map(r=>({name:r.name,state:r.state,role:r.role}))};
}
export async function importEpisodeSelections(store,old,input,library){
 const preview=previewEpisodeSelections(store,old,input);check(Array.isArray(input.selected)&&input.selected.length>0&&new Set(input.selected).size===input.selected.length,'请选择需要复用的资产');
 for(const index of input.selected)check(Number.isInteger(index)&&preview.items[index]&&['reuse','conflict'].includes(preview.items[index].status),'所选资产状态已改变，请重新预览');
 const snapshot=JSON.stringify(old),assertCurrent=()=>check(JSON.stringify(store.project(old.id))===snapshot&&store.project(old.id).revision===input.expectedRevision,'导入期间工程已改变，未覆盖当前内容，请重新导入',409);
 assertCurrent();const imported=[];
 for(const index of input.selected){
  const ref=input.bundle.items[index].asset;let asset=store.db.assets.find(a=>same(a,ref));
  if(!asset){check(library?.importAsset,'墨库连接尚未就绪');const result=await library.importAsset({assetId:ref.assetId,revisionId:ref.revisionId});asset=result?.asset;}
  assertCurrent();check(same(asset,ref),'图片固定版本或归属与复用文件不一致，未修改工程');imported.push({index,asset});
 }
 const next=structuredClone(old),rows=inventory(next,store.db.assets,input.pageId),byKey=new Map(rows.map(r=>[r.key,r]));let applied=0,blocked=0;
 for(const {index,asset}of imported){const row=byKey.get(assetRequirementKey(input.bundle.items[index]));
  const allowed=new Set(usableTargets(store,next,row).map(u=>u.panelId+':'+u.needId));
  for(const use of row.uses){const page=next.pages.find(p=>p.id===use.pageId),panel=page.panels.find(p=>p.id===use.panelId);
   if(!allowed.has(use.panelId+':'+use.needId)){blocked++;continue;}
   const need=auditPanelReferences(next,panel,store.db.assets).needs.find(n=>n.id===use.needId);check(need&&assetRequirementKey(need)===row.key,'资产需求已改变，请重新导入',409);
   bindWorkspaceAsset(next,panel,need,asset,store,{userSelected:true});applied++;
  }
 }
 next.assetLibrary||={version:1,assetIds:[],directories:[],recursive:true};next.assetLibrary.assetIds=[...new Set([...next.assetLibrary.assetIds,...imported.map(i=>i.asset.id)])];
 validateProject(next);assertCurrent();return {project:next,assets:imported.map(i=>i.asset),summary:{assets:imported.length,applied,blocked,newItems:preview.newItems.length}};
}
