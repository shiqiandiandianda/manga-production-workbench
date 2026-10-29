import {comparableProject,syncEpisodeBoardRevision} from './revision-sync.js';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const copy=v=>v===undefined?undefined:structuredClone(v);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const keyed=v=>Array.isArray(v)&&v.every(x=>object(x)&&typeof x.id==='string')&&new Set(v.map(x=>x.id)).size===v.length;
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>own(v,k)).map(k=>[k,v[k]]));

// Three-way reconciliation uses the last acknowledged content, not just a revision
// number: generation completion can update artwork without incrementing revision.
// Arrays with stable IDs merge by identity. Unidentified arrays and coupled geometry
// stay atomic, so simultaneous crop/resize/reorder changes cannot silently combine.
export function mergeProjectRevision({baseComparable,local,server}){
 if(!baseComparable||!local||!server||local.id!==server.id||!Number.isInteger(server.revision)||server.revision<local.revision)return {ok:false,conflicts:['project']};
 let base;try{base=JSON.parse(baseComparable);}catch{return {ok:false,conflicts:['base']};}
 if(base.id!==local.id)return {ok:false,conflicts:['project']};
 const conflicts=[];
 function merge(b,l,r,path){
  if(equal(l,r))return copy(l);
  if(equal(l,b))return copy(r);
  if(equal(r,b))return copy(l);
  if(object(b)&&object(l)&&object(r)){
   const groups=Array.isArray(b.points)?[['imageAssetId','imageTransform','w','h','points'],['x','y','w','h','points']]:[];
   for(const keys of groups){const bv=pick(b,keys),lv=pick(l,keys),rv=pick(r,keys);if(!equal(lv,bv)&&!equal(rv,bv)&&!equal(lv,rv)){conflicts.push(path+'.'+keys[0]);return copy(l);}}
   const result={};for(const k of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
    if(['__proto__','constructor','prototype'].includes(k)){conflicts.push(path+'.'+k);continue;}
    const value=merge(b[k],l[k],r[k],path+'.'+k);if(value!==undefined)result[k]=value;
   }return result;
  }
  if(keyed(b)&&keyed(l)&&keyed(r)){
   const bm=new Map(b.map(v=>[v.id,v])),lm=new Map(l.map(v=>[v.id,v])),rm=new Map(r.map(v=>[v.id,v]));
   const shared=b.map(v=>v.id).filter(id=>lm.has(id)&&rm.has(id)),ls=l.map(v=>v.id).filter(id=>shared.includes(id)),rs=r.map(v=>v.id).filter(id=>shared.includes(id));
   if(!equal(ls,shared)&&!equal(rs,shared)&&!equal(ls,rs)){conflicts.push(path+'.order');return copy(l);}
   const order=!equal(rs,shared)?r:l,extra=order===r?l:r,ids=order.map(v=>v.id);
   for(let i=0;i<extra.length;i++){const id=extra[i].id;if(ids.includes(id))continue;const previous=extra.slice(0,i).reverse().find(v=>ids.includes(v.id));ids.splice(previous?ids.indexOf(previous.id)+1:0,0,id);}
   const result=[];for(const id of ids){const value=merge(bm.get(id),lm.get(id),rm.get(id),path+'['+id+']');if(value!==undefined)result.push(value);}return result;
  }
  conflicts.push(path);return copy(l);
 }
 const merged=merge(base,JSON.parse(comparableProject(local)),JSON.parse(comparableProject(server)),'project');
 if(conflicts.length)return {ok:false,conflicts};
 merged.revision=server.revision;merged.updated=server.updated;
 if(server.productionAssets!==undefined)merged.productionAssets=copy(server.productionAssets);
 syncEpisodeBoardRevision(server,merged);
 const panels=new Map(server.pages.flatMap(p=>p.panels.map(f=>[f.id,f])));
 for(const page of merged.pages)for(const panel of page.panels){const remote=panels.get(panel.id);if(!remote)continue;for(const key of ['candidates','generationToken','breakoutCandidates','imageEffects']){if(remote[key]!==undefined)panel[key]=copy(remote[key]);else delete panel[key];}}
 return {ok:true,project:merged,conflicts:[]};
}
