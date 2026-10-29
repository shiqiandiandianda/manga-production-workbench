import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMokuClassifiedReader} from '../lib/moku-classified-reader.mjs';
import {assetMetadata} from '../public/asset-metadata.js';
import {mokuCandidate} from '../public/moku-reference-search.js';
import {automaticGalleryMatch} from '../public/asset-gallery-batch.js';
import {relevantAssetCandidates} from '../public/asset-fuzzy-search.js';
import {assetUnavailable} from '../public/asset-availability.js';
function fixture(){
 const projectId=randomUUID(),character=randomUUID(),scene=randomUUID(),prop=randomUUID(),subjects=[{id:character,kind:'character',name:'花满楼'},{id:scene,kind:'scene',name:'明州·五羊城千户所'},{id:prop,kind:'prop',name:'绣花针'}];
 const make=(assetType,objectId,variantName)=>({id:randomUUID(),projectId,assetKind:'image',assetType,objectId,variantName,name:'大周玄衣卫-'+subjects.find(s=>s.id===objectId).name+'-'+variantName,mime:'image/png',recommendedRevisionId:randomUUID()});
 const rows=[make('character',character,'大周玄衣卫-花满楼-玄衣卫官服'),make('scene',scene,'大周玄衣卫-明州·五羊城千户所-书房'),make('scene',scene,'大周玄衣卫-明州·五羊城千户所-客房'),make('scene',scene,'大堂'),make('prop',prop,'银色')],calls=[];
 const reader=createMokuClassifiedReader({request:async route=>{calls.push(route);const u=new URL(route,'http://test');
  if(u.pathname==='/api/project-library/taxonomy')return Response.json({routeVersion:1});
  if(u.pathname==='/api/projects')return Response.json({items:[{id:projectId,name:'大周玄衣卫'}]});
  if(u.pathname.endsWith('/subjects'))return Response.json({items:subjects});
  if(u.pathname.endsWith('/catalog'))return Response.json({items:rows,total:rows.length});
  const item=rows.find(a=>u.pathname.endsWith('/assets/'+a.id));if(item)return Response.json({...item,revisions:[{id:item.recommendedRevisionId,sha256:'a'.repeat(64)}]});
  throw Error('unexpected '+route);
 }});
 return {reader,rows,projectId,calls,list:async()=>(await reader.handle('/api/assets?projectId='+projectId)).json()};
}
test('classified names normalize subject and variant while keeping source names and every immutable identity',async()=>{
 const f=fixture(),{items}=await f.list(),card=items[0];
 assert.equal(card.name,'花满楼__玄衣卫官服');assert.equal(card.outfitName,'玄衣卫官服');assert.equal(card.variantName,f.rows[0].variantName,'raw remote field is retained for audit');
 assert.equal(card.sourceName,f.rows[0].name);assert.equal(card.objectId,f.rows[0].objectId);assert.equal(card.recommendedRevisionId,f.rows[0].recommendedRevisionId);
 assert.deepEqual(assetMetadata(mokuCandidate(card)).state,'玄衣卫官服');
 assert.equal(automaticGalleryMatch({role:'character',name:'花满楼',state:'玄衣卫官服'},[card],{projectIds:[f.projectId]}).id,card.id);
 assert.equal(automaticGalleryMatch({role:'character',name:'花满楼',state:'未知（待确认）'},[card],{projectIds:[f.projectId]}),null);
 const detail=await(await f.reader.handle('/api/assets/'+card.id)).json();assert.equal(detail.name,card.name);assert.equal(detail.sourceName,f.rows[0].name);
});
test('a specific room query excludes sibling rooms; automatic binding still requires exact scene identity',async()=>{
 const f=fixture(),{items}=await f.list(),scenes=items.filter(i=>i.assetType==='scene'),selected=relevantAssetCandidates(scenes,'五羊城千户所书房',{role:'scene'});
 assert.equal(selected.length,1);assert.equal(selected[0].sceneName,'明州·五羊城千户所·书房');
 assert.equal(automaticGalleryMatch({role:'scene',name:'明州·五羊城千户所·书房'},selected,{projectIds:[f.projectId]}).id,selected[0].id);
 assert.equal(automaticGalleryMatch({role:'scene',name:'五羊城千户所书房'},selected,{projectIds:[f.projectId]}),null,'location qualifiers require an explicit alias, not an automatic merge');
 assert.equal(assetMetadata(mokuCandidate(items[4])).name,'绣花针');
});
test('different image versions with the same cleaned costume remain ambiguous',async()=>{
 const f=fixture(),{items}=await f.list(),duplicate={...items[0],id:randomUUID(),recommendedRevisionId:randomUUID()};
 assert.equal(automaticGalleryMatch({role:'character',name:'花满楼',state:'玄衣卫官服'},[items[0],duplicate],{projectIds:[f.projectId]}),null);
});
test('a cleaned display name cannot reactivate an explicitly disabled source image',()=>{
 assert.equal(assetUnavailable({name:'花满楼__官服',sourceName:'大周玄衣卫-花满楼-官服_禁用'}),true);
 assert.equal(assetUnavailable({name:'庭院',library:{sourceName:'庭院_作废'}}),true);
 assert.equal(assetUnavailable({name:'废弃庭院'}),false);
});
