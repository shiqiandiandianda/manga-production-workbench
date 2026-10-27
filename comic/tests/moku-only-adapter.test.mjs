import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRemoteLibrary} from '../lib/remote-library.mjs';
import {createClassifiedBubbleStyles} from '../lib/classified-bubble-styles.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
function temp(t){const dir=fs.mkdtempSync(path.join(import.meta.dirname,'fixture-moku-only-'));t.after(()=>{assert.equal(path.dirname(dir),import.meta.dirname);fs.rmSync(dir,{recursive:true,force:true});});return dir;}

test('分类历史版本接口按指定资产校验身份，取用旧版本保留摘要及原件',async t=>{
 const dir=temp(t),assetId=randomUUID(),revisionId=randomUUID(),latest=randomUUID(),bytes=Buffer.from('fixed-original-image'),calls=[];
 const detail={id:assetId,name:'测试气泡.png',projectId:null,scopeId:'global',assetKind:'image',assetType:'bubble',recommendedRevisionId:latest,revisions:[],versionCount:2,objectVersion:2};
 const revision={id:revisionId,assetId,sha256:hash(bytes),size:bytes.length,mime:'image/png',originalName:'original.png',versionNumber:1};
 const fetchBefore=globalThis.fetch;let foreign=false;
 globalThis.fetch=async(url,options={})=>{
  const p=new URL(url).pathname;calls.push(p);assert.equal(options.method||'GET','GET');
  if(p==='/api/project-library/taxonomy')return Response.json({routeVersion:1});
  if(p==='/api/projects')return Response.json({items:[]});
  if(p.endsWith('/assets'))return Response.json({items:p.includes('/bubble/')?[detail]:[],total:p.includes('/bubble/')?1:0});
  if(p.endsWith('/assets/'+assetId))return Response.json(detail);
  if(p.endsWith('/revisions/'+revisionId))return Response.json({...revision,assetId:foreign?randomUUID():assetId});
  if(p.endsWith('/revisions'))return Response.json({items:[revision],nextCursor:null});
  if(p.endsWith('/revisions/'+revisionId+'/download'))return new Response(bytes);
  throw Error('Unexpected route: '+p);
 };t.after(()=>{globalThis.fetch=fetchBefore;});
 const config=path.join(dir,'session.json');fs.writeFileSync(config,JSON.stringify({base:'http://moku.invalid',cookie:'library_session=synthetic'}));
 const store={db:{assets:[],projects:[]},save(){}};
 const library=createRemoteLibrary({dataDir:dir,configPath:config,store,addAsset(file,name){const asset={id:'asset_'+randomUUID(),filePath:file,name};store.db.assets.push(asset);return asset;}});
 assert.equal((await library.read('/api/assets/'+assetId+'/revisions')).items[0].id,revisionId);
 const result=await library.importAsset({assetId,revisionId});assert.equal(result.asset.library.revisionId,revisionId);assert.equal(hash(fs.readFileSync(result.asset.filePath)),revision.sha256);
 assert.ok(calls.includes('/api/global-library/image/bubble/assets/'+assetId+'/revisions/'+revisionId+'/download'));
 assert.ok(!calls.some(p=>/^\/api\/(assets|revisions)\//.test(p)));
 foreign=true;await assert.rejects(library.importAsset({assetId,revisionId}),/身份不一致|不属于/);assert.equal(store.db.assets.length,1);
});

test('切换墨库账号后丢弃迟到响应，旧会话链不能继续发起操作',async t=>{
 const dir=temp(t),config=path.join(dir,'session.json');fs.writeFileSync(config,JSON.stringify({base:'http://moku.invalid',cookie:'library_session=old'}));
 const originalFetch=globalThis.fetch;let arrived,release;const started=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);const cookies=[];
 globalThis.fetch=async(url,options={})=>{
  cookies.push(options.headers.Cookie);
  if(new URL(url).pathname==='/api/auth/login')return new Response('{}',{headers:{'Set-Cookie':'library_session=new; Path=/'}});
  if(new URL(url).pathname==='/api/auth/me'){arrived();await gate;return Response.json({user:{id:randomUUID()}});}
  throw Error('Unexpected request');
 };t.after(()=>{release();globalThis.fetch=originalFetch;});
 const library=createRemoteLibrary({dataDir:dir,configPath:config,store:{db:{assets:[],projects:[]},save(){}},json(){},body:async req=>req.payload});
 const pending=library.withSession(async()=>{await library.read('/api/auth/me');assert.fail('Old account operation must stop');});
 const rejected=assert.rejects(pending,/账号已切换/);await started;
 await library.handle({payload:{username:'synthetic',password:'synthetic'}},{},{pathname:'/api/library/login',method:'POST',url:new URL('http://moku.invalid/api/library/login')});
 release();await rejected;assert.equal(cookies.length,2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'library-session.local.json'))).cookie,'library_session=new');
});

test('离线退出持久清空本机会话并拒绝迟到响应，明确告知服务器未确认注销',async t=>{
 const dir=temp(t),config=path.join(dir,'session.json');fs.writeFileSync(config,JSON.stringify({base:'http://moku.invalid',cookie:'library_session=old'}));
 const originalFetch=globalThis.fetch;let arrived,release;const started=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);let output;
 globalThis.fetch=async(url,options={})=>{
  const p=new URL(url).pathname;
  if(p==='/api/auth/me'){arrived();await gate;return Response.json({user:{id:randomUUID()}});}
  if(p==='/api/auth/logout'){assert.equal(options.headers.Cookie,'library_session=old');return Response.json({error:'offline'},{status:503});}
  throw Error('Unexpected request '+p);
 };t.after(()=>{release();globalThis.fetch=originalFetch;});
 const library=createRemoteLibrary({dataDir:dir,configPath:config,store:{db:{assets:[],projects:[]},save(){}},json(_res,_status,value){output=value;},body:async req=>req.payload});
 const pending=library.withSession(async()=>{await library.read('/api/auth/me');assert.fail('Logged out operation must stop');}),rejected=assert.rejects(pending,/账号已切换/);await started;
 await library.handle({payload:{}},{},{pathname:'/api/library/logout',method:'POST',url:new URL('http://moku.invalid/api/library/logout')});
 release();await rejected;assert.equal(output.ok,true);assert.equal(output.remoteRevoked,false);assert.match(output.warning,/本机已退出/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'library-session.local.json'))).cookie,'');
});

test('气泡铭牌登记回执丢失后重试同一版本，修改定义才追加固定版本',async t=>{
 const dir=temp(t),file=path.join(dir,'bubble.png');fs.writeFileSync(file,'synthetic original');
 const definitions=[{id:'test-speech',label:'对白',contour:[{x:0,y:0}],insets:{left:.1}},{id:'ref23-person-test',label:'铭牌',contour:[{x:0,y:0}],insets:{left:.2}}];
 const rows=new Map(),registered=new Map(),calls=[],uploads=[];let lose=true;
 const library={baseUrl:'http://synthetic.invalid',withSession:fn=>fn(),rememberClassifiedAsset(){},
  async read(route){
   if(route==='/api/auth/me')return {user:{id:'synthetic-maker'}};
   const u=new URL(route,'http://fake'),type=u.pathname.split('/')[4];
   if(u.pathname.endsWith('/styles'))return {items:[...registered.values()].filter(x=>x.assetType===type),more:false};
   if(u.pathname.includes('/assets/'))return rows.get(u.pathname.split('/').at(-1));
   throw Error(route);
  },
  async uploadAsset(input){assert.equal(input.projectId,null);assert.equal(input.assetKind,'image');assert.equal(hash(input.bytes),hash(fs.readFileSync(file)));const assetId=input.assetId||randomUUID(),revisionId=randomUUID();if(input.assetId)assert.equal(input.objectVersion,rows.get(assetId).objectVersion);rows.set(assetId,{id:assetId,assetType:input.assetType,objectVersion:(rows.get(assetId)?.objectVersion||0)+1});uploads.push(input);return {assetId,revisionId};},
  async remote(route,options){const payload=JSON.parse(options.body),parts=route.split('/'),item={...payload.style,assetId:parts[6],revisionId:parts[8],assetType:parts[4]};calls.push({route,key:options.headers['Idempotency-Key']});registered.set(item.id,item);if(lose){lose=false;throw Error('response lost');}return Response.json(item);}
 };
 const make=()=>createClassifiedBubbleStyles({library,cacheFile:path.join(dir,'cache.json'),getStyles:()=>definitions,sourcePath:()=>file,pick:style=>structuredClone(style)});
 await assert.rejects(make().publish(),/response lost/);assert.equal(uploads.length,1);
 const retry=make();assert.equal((await retry.publish()).count,2);assert.equal(uploads.length,2);assert.equal(calls[0].route,calls[1].route);assert.equal(calls[0].key,calls[1].key);
 const first=await retry.readManifest();assert.deepEqual(new Set(first.items.map(x=>x.assetType)),new Set(['bubble','nameplate']));
 await retry.publish();assert.equal(uploads.length,2);
 definitions[0].insets.left=.3;await retry.publish();assert.equal(uploads.length,3);assert.equal(uploads[2].assetId,first.items.find(x=>x.id==='test-speech').assetId);
 const changed=(await retry.readManifest()).items.find(x=>x.id==='test-speech');assert.notEqual(changed.revisionId,first.items.find(x=>x.id==='test-speech').revisionId);assert.equal(changed.insets.left,.3);
});
