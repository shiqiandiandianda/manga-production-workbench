import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {createRemoteLibrary} from '../../lib/remote-library.mjs';
import {mockMoku} from '../../tests/moku-project-library-fixture.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHHsAAAAASUVORK5CYII=','base64');
const hash=b=>createHash('sha256').update(b).digest('hex');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const readBody=async req=>{const chunks=[];for await(const c of req)chunks.push(c);return Buffer.concat(chunks);};
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};

test('真实工作台适配器经合成 HTTP 墨库完成登录、分类上传、幂等重试、固定版本下载和账号切换',{timeout:30000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moku-http-')),fixture=mockMoku(),users={a:randomUUID(),b:randomUUID()};
  const cloud=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://fixture'),bytes=await readBody(req);
      if(url.pathname==='/api/auth/login'&&req.method==='POST'){
        const input=JSON.parse(bytes.toString());
        if(!users[input.username]||input.password!=='synthetic')return json(res,401,{error:'invalid synthetic login'});
        res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'library_session='+input.username+'; HttpOnly'});return res.end('{}');
      }
      const account=/library_session=([ab])/.exec(req.headers.cookie||'')?.[1];
      if(!account)return json(res,401,{error:'synthetic login required'});
      if(url.pathname==='/api/auth/me')return json(res,200,{user:{id:users[account],username:account}});
      if(url.pathname==='/api/global-library/image/bubble/assets')return json(res,200,{items:[...fixture.assets.values()].filter(a=>a.assetType==='bubble'),total:fixture.assets.size});
      const revision=/\/revisions\/([^/]+)\/download$/.exec(url.pathname)?.[1];
      if(revision){const asset=[...fixture.assets.values()].find(a=>a.recommendedRevisionId===revision);if(!asset)return json(res,404,{error:'missing revision'});res.writeHead(200,{'Content-Type':'image/png'});return res.end(asset.bytes);}
      const value=await fixture.request(url.pathname+url.search,{method:req.method,headers:{'Idempotency-Key':req.headers['idempotency-key'],'X-Chunk-SHA256':req.headers['x-chunk-sha256']},body:bytes.length?(req.headers['content-type']?.includes('application/json')?bytes.toString():bytes):undefined});
      res.writeHead(value.status,{'Content-Type':value.headers.get('content-type')||'application/json'});res.end(Buffer.from(await value.arrayBuffer()));
    }catch(error){json(res,500,{error:error.message});}
  });
  const cloudUrl=await listen(cloud),config=path.join(dir,'moku.json');fs.writeFileSync(config,JSON.stringify({base:cloudUrl}));
  const store={db:{assets:[],projects:[],libraryFonts:[]},save(){}},library=createRemoteLibrary({dataDir:dir,configPath:config,store,addAsset(file,name){const asset={id:'asset_'+randomUUID(),name,filePath:file};store.db.assets.push(asset);return asset;},body:async req=>JSON.parse((await readBody(req)).toString()||'{}'),json});
  const editor=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://fixture');if(!await library.handle(req,res,{pathname:url.pathname,method:req.method,url}))json(res,404,{});}catch(error){json(res,error.status||500,{error:error.message});}});
  const editorUrl=await listen(editor);t.after(async()=>{editor.closeAllConnections();cloud.closeAllConnections();await Promise.all([new Promise(r=>editor.close(r)),new Promise(r=>cloud.close(r))]);fs.rmSync(dir,{recursive:true,force:true});});
  const call=async(route,method='GET',body)=>{const response=await fetch(editorUrl+route,{method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});return {response,value:await response.json()};};
  assert.equal((await call('/api/library/status')).value.connected,false);
  assert.equal((await call('/api/library/login','POST',{username:'a',password:'synthetic'})).response.status,200);
  assert.equal((await call('/api/library/status')).value.user.id,users.a);
  // A retry needs the same operation identity; equal bytes alone must not
  // collapse two intentionally separate asset uploads.
  const input={projectId:null,scopeId:'global',assetKind:'image',assetType:'bubble',name:'合成气泡.png',mime:'image/png',bytes:png,operationId:'synthetic-bubble-upload'};
  const first=await library.uploadAsset(input),again=await library.uploadAsset(input);
  assert.equal(first.assetId,again.assetId);assert.equal(first.revisionId,again.revisionId);assert.equal(fixture.uploads.size,1);assert.equal(first.sha256,hash(png));
  const listed=await call('/api/library/assets?projectId=public&kind=bubble');assert.equal(listed.value.items[0].id,first.assetId);
  const imported=await call('/api/library/import','POST',{assetId:first.assetId,revisionId:first.revisionId});assert.equal(imported.response.status,201);assert.equal(imported.value.asset.library.revisionId,first.revisionId);assert.equal(hash(fs.readFileSync(store.db.assets[0].filePath)),hash(png));
  assert.equal((await call('/api/library/login','POST',{username:'b',password:'synthetic'})).response.status,200);
  assert.equal((await call('/api/library/status')).value.user.id,users.b);
  const second=await library.uploadAsset(input);assert.notEqual(second.assetId,first.assetId);assert.equal(fixture.uploads.size,2,'account-specific receipts must not be reused');
  const independent={...input};delete independent.operationId;
  const third=await library.uploadAsset(independent),fourth=await library.uploadAsset(independent);
  assert.notEqual(third.assetId,fourth.assetId,'separate uploads with identical content must remain distinct');
  assert.equal(fixture.uploads.size,4);
});
