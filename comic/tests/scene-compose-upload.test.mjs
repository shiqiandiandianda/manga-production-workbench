import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const native=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('实际拼版入库使用墨库场景分类和明确对象，原件摘要一致',{timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scene-classified-'));
 const projectId=randomUUID(),objectId=randomUUID(),assetId=randomUUID(),revisionId=randomUUID(),uploadId=randomUUID();
 const prefix='/api/project-library/'+projectId+'/project/image/scene',requests=[],chunks=[];
 let uploadInput,completed=false;
 const fake=http.createServer(async(req,res)=>{
  const parts=[];for await(const chunk of req)parts.push(chunk);const bytes=Buffer.concat(parts);
  const payload=bytes.length&&String(req.headers['content-type']||'').includes('json')?JSON.parse(bytes):null;
  requests.push({method:req.method,url:req.url,body:payload});res.setHeader('Content-Type','application/json');
  const send=(value,status=200)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  if(req.url==='/api/auth/me')return send({user:{id:'synthetic-maker'}});
  if(req.url==='/api/project-library/'+projectId+'/subjects')return send({items:[{id:objectId,kind:'scene',name:'合成雅间'}]});
  if(req.url===prefix+'/uploads'&&req.method==='POST'){uploadInput=payload;return send({id:uploadId,chunkSize:1024*1024});}
  if(req.url===prefix+'/uploads/'+uploadId&&req.method==='GET')return send(completed?{state:'completed',assetId,revisionId}:{state:'uploading',chunks:[]});
  if(req.url===prefix+'/uploads/'+uploadId+'/chunks/0'&&req.method==='PUT'){chunks.push(bytes);assert.equal(req.headers['x-chunk-sha256'],hash(bytes));return send({ok:true});}
  if(req.url===prefix+'/uploads/'+uploadId+'/complete'&&req.method==='POST'){completed=true;return send({ok:true});}
  if(req.url===prefix+'/assets/'+assetId)return send({id:assetId,projectId,assetKind:'image',assetType:'scene',scopeId:'project',objectId,name:uploadInput.name,revisions:[{id:revisionId,sha256:uploadInput.expectedSha256,size:uploadInput.size}]});
  if(req.url==='/api/assets'&&req.method==='POST')return send({id:'asset_local'},201);
  if(req.url==='/api/projects/project_test')return send({id:'project_test',revision:1});
  if(req.url==='/api/projects/project_test/asset-library')return send({ok:true});
  if(req.url==='/api/health')return send({ok:true});
  return send({error:'unexpected '+req.method+' '+req.url},404);
 });
 fake.listen(0,'127.0.0.1');await once(fake,'listening');t.after(()=>{fake.closeAllConnections();fake.close();});
 const origin='http://127.0.0.1:'+fake.address().port;
 fs.writeFileSync(path.join(dir,'asset-studio.json'),JSON.stringify({projectId:'project_assets',mainProjectId:'project_test'}));
 fs.writeFileSync(path.join(dir,'moku.json'),JSON.stringify({base:origin,cookie:'synthetic-only',projectId}));
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 let output='';const child=spawn(process.execPath,[path.join(root,'asset-studio/app/roles/assets.mjs'),'--port',String(port)],{cwd:root,env:{...process.env,ASSET_STUDIO_DATA_DIR:dir,ASSET_EDITOR:origin,ASSET_MOKU_SESSION_FILE:'',ASSET_CANVAS_MODULE:process.env.COMIC_TEST_CANVAS_MODULE},windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);t.after(()=>child.kill());
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:'+port+'/api/health')).ok)break;}catch{}if(i===99)assert.fail(output);await new Promise(resolve=>setTimeout(resolve,100));}
 const canvas=native.createCanvas(1536,864);canvas.getContext('2d').fillRect(0,0,1536,864);const bytes=canvas.toBuffer('image/png');
 const response=await fetch('http://127.0.0.1:'+port+'/api/compose-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'合成雅间',outfit:'俯拍',type:'scene',data:'data:image/png;base64,'+bytes.toString('base64')})}),result=await response.json();
 assert.equal(response.status,201,JSON.stringify(result));assert.equal(result.warning,'');assert.equal(result.moku.assetId,assetId);assert.equal(result.moku.revisionId,revisionId);
 assert.equal(uploadInput.objectId,objectId);assert.deepEqual(uploadInput.sceneIds,[objectId]);assert.equal(uploadInput.tagDecision,'none');assert.equal(uploadInput.expectedSha256,hash(bytes));
 assert.deepEqual(Buffer.concat(chunks),bytes);assert.deepEqual(fs.readFileSync(result.file),bytes);
 assert.equal(requests.some(r=>r.url==='/api/uploads'),false,'不得回退到无分类旧接口');
});
