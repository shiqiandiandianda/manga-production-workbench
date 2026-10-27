import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createMokuClassifiedReader} from '../lib/moku-classified-reader.mjs';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('头图尾图列表、详情和固定原件采用各自分类路由',async()=>{
 const projectId=randomUUID(),episodeId=randomUUID(),rows=['header','footer'].map(assetType=>card(projectId,{assetType,category:assetType,episodeId})),f=fixture({rows});
 for(const item of rows){const listed=await f.read('/api/assets?projectId='+projectId+'&categoryId='+item.assetType);assert.equal(listed.items.length,1);await f.read('/api/assets/'+item.id);assert.equal(await(await f.reader.handle('/api/revisions/'+item.recommendedRevisionId+'/download')).text(),'fixed version bytes');assert.ok(f.calls.some(r=>r.includes('/'+episodeId+'/image/'+item.assetType+'/assets/'+item.id)));}
});
const card=(projectId,extra={})=>({id:randomUUID(),projectId,episodeId:null,assetKind:'image',assetType:'character',category:'character',name:'宋玄_黑衣.png',objectId:randomUUID(),variantName:'黑衣',recommendedRevisionId:randomUUID(),...extra});
function fixture({rows=[],globals=[],detail,assets=[]}={}){
 const calls=[],reader=createMokuClassifiedReader({getAssets:()=>assets,request:async route=>{
  calls.push(route);const u=new URL(route,'http://local');
  if(u.pathname==='/api/project-library/taxonomy')return json({routeVersion:1,items:[{kind:'image',type:'character',name:'角色'}]});
  if(u.pathname==='/api/global-library/taxonomy')return json({items:[{kind:'file',type:'font',name:'字体'}]});
  if(u.pathname==='/api/projects')return json({items:[...new Set(rows.map(x=>x.projectId))].map(id=>({id}))});
  if(u.pathname.endsWith('/subjects'))return json({items:rows.filter(x=>x.projectId===u.pathname.split('/')[3]).map(x=>({id:x.objectId,kind:'character',name:'宋玄'}))});
  if(u.pathname.endsWith('/catalog')||u.pathname.startsWith('/api/global-library/')&&u.pathname.endsWith('/assets')){
   const filtered=(u.pathname.endsWith('/catalog')?rows.filter(x=>x.projectId===u.pathname.split('/')[3]):globals.filter(x=>x.assetType===u.pathname.split('/')[4])).filter(x=>!u.searchParams.has('q')||x.name.includes(u.searchParams.get('q'))).filter(x=>!u.searchParams.has('assetType')||x.assetType===u.searchParams.get('assetType'));
   const offset=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit'));assert.ok(limit<=100,'new API max page size');return json({items:filtered.slice(offset,offset+limit),total:filtered.length,limit,offset});
  }
  if(/\/assets\/[a-f0-9-]{36}$/.test(u.pathname)){const item=[...rows,...globals].find(x=>x.id===u.pathname.split('/').at(-1));assert.ok(item,'asset identity');return json({...item,revisions:[{id:item.recommendedRevisionId},...(detail?.revisions||[])]});}
  if(u.pathname.includes('/revisions/'))return new Response('fixed version bytes',{headers:{'Content-Type':'image/png'}});
  throw Object.assign(Error('old or unknown route '+route),{status:410});
 }});return {calls,reader,read:async route=>(await reader.handle(route)).json()};
}
test('classified catalogue paginates at 100 while retaining 200-row local pages and independent outfit IDs',async()=>{
 const p=randomUUID(),rows=Array.from({length:235},(_,i)=>card(p,{name:'宋玄_'+i+'.png'})),f=fixture({rows});
 const first=await f.read('/api/assets?projectId='+p+'&groupCharacters=true&limit=200');assert.equal(first.items.length,200);assert.equal(first.more,true);assert.equal(first.total,235);assert.equal(first.items[0].characterName,'宋玄');assert.equal(first.items[0].outfitName,'黑衣');
 const second=await f.read('/api/assets?projectId='+p+'&limit=200&offset=200');assert.equal(second.items.length,35);assert.equal(second.more,false);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,235);assert.ok(f.calls.filter(x=>x.includes('/catalog')).every(x=>x.includes('scopeId=all')));assert.ok(!f.calls.some(x=>x.startsWith('/api/assets')));
});
test('episode-specific detail, historical versions, thumbnails and download stay on original classification',async()=>{
 const p=randomUUID(),episodeId=randomUUID(),item=card(p,{episodeId}),old=randomUUID(),f=fixture({rows:[item],detail:{revisions:[{id:old}]}});
 await f.read('/api/assets?projectId='+p);const detail=await f.read('/api/assets/'+item.id);assert.equal(detail.scopeId,episodeId);assert.equal(detail.revisions[1].id,old);
 for(const suffix of ['download','preview/thumb.webp'])assert.equal(await (await f.reader.handle('/api/revisions/'+old+'/'+suffix)).text(),'fixed version bytes');
 const base='/api/project-library/'+p+'/'+episodeId+'/image/character/assets/'+item.id;assert.ok(f.calls.includes(base));assert.ok(f.calls.includes(base+'/revisions/'+old+'/download'));assert.ok(!f.calls.some(x=>x.startsWith('/api/revisions')));
});
test('global assets use global routes; category selection and pagination do not mix libraries',async()=>{
 const font=card(null,{assetKind:'file',assetType:'font',category:'font',name:'字体.ttf'}),bubble=card(null,{assetType:'bubble',category:'bubble',name:'气泡.png'}),f=fixture({globals:[bubble,font]});
 const result=await f.read('/api/assets?projectId=public&categoryId=font');assert.deepEqual(result.items.map(x=>x.id),[font.id]);const d=await f.read('/api/assets/'+font.id);assert.equal(d.scopeId,'global');assert.ok(f.calls.includes('/api/global-library/file/font/assets/'+font.id));assert.ok(!f.calls.some(x=>x.includes('/project-library/public/')));assert.equal((await f.read('/api/categories?projectId=public')).items[0].id,'font');
});
test('cold revision request restores context from existing binding, including a non-recommended version',async()=>{
 const p=randomUUID(),item=card(p),old=randomUUID(),f=fixture({rows:[item],detail:{revisions:[{id:old}]},assets:[{library:{assetId:item.id,revisionId:old}}]});
 assert.equal(await (await f.reader.handle('/api/revisions/'+old+'/download')).text(),'fixed version bytes');assert.ok(f.calls.some(x=>x.endsWith('/assets/'+item.id+'/revisions/'+old+'/download')));
});
test('UUID category filters retain later-page matches instead of leaking other classes',async()=>{
 const p=randomUUID(),categoryId=randomUUID(),rows=Array.from({length:103},(_,i)=>card(p,{categoryId:i===102?categoryId:randomUUID()})),f=fixture({rows});
 const r=await f.read('/api/assets?projectId='+p+'&categoryId='+categoryId+'&limit=40');assert.deepEqual(r.items.map(x=>x.id),[rows[102].id]);assert.equal(r.more,false);
});
test('only absent new taxonomy allows legacy fallback; authentication and service errors stay visible',async()=>{
 for(const status of [401,403,503]){const reader=createMokuClassifiedReader({request:async()=>{throw Object.assign(Error('upstream '+status),{status});}});await assert.rejects(reader.handle('/api/assets?projectId=public'),e=>e.status===status);}
 const legacy=createMokuClassifiedReader({request:async()=>{throw Object.assign(Error('not found'),{status:404});}});assert.equal(await legacy.handle('/api/assets?projectId=public'),null);
});
test('failed project searches reject without turning partial results into a complete match',async()=>{
 const reader=createMokuClassifiedReader({request:async route=>{if(route==='/api/project-library/taxonomy')return json({routeVersion:1});throw Object.assign(Error('catalogue unavailable'),{status:503});}});await assert.rejects(reader.handle('/api/assets?projectId='+randomUUID()),/catalogue unavailable/);
});

test('account switching rejects a late catalogue response instead of caching the old account assets',async()=>{
 const p=randomUUID(),old=card(p);let release,started;
 const reached=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const reader=createMokuClassifiedReader({request:async route=>{
  if(route==='/api/project-library/taxonomy')return json({routeVersion:1,items:[{kind:'image',type:'character'}]});
  if(route.includes('/catalog')){started();await gate;return json({items:[old],total:1});}
  if(route==='/api/projects')return json({items:[]});
  if(route.startsWith('/api/global-library/'))return json({items:[],total:0});
  throw Error('unexpected request '+route);
 }});
 const pending=reader.handle('/api/assets?projectId='+p);await reached;reader.clear();release();await assert.rejects(pending,/账号已切换/);
 await assert.rejects(reader.handle('/api/assets/'+old.id),e=>e.status===404);
});
