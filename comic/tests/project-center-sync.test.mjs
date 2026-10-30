import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {createProjectCenterSync} from '../lib/project-center.mjs';
import {panelContentKey} from '../public/panel-generation.js';
import {rectangle} from '../public/model.js';
const audit=path.resolve(import.meta.dirname,'../../audit/cache-tests');fs.mkdirSync(audit,{recursive:true});
test('项目中心断开时说明缺少的服务；不重试写入、不创建生图任务',async()=>{
 const dir=fs.mkdtempSync(path.join(audit,'unavailable-')),previous=process.env.PROJECT_CENTER_URL;
 const server=http.createServer((req,res)=>res.end('{}'));await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 process.env.PROJECT_CENTER_URL='http://127.0.0.1:'+port;
 const project={id:'project_unavailable',revision:1},store={db:{projects:[project],assets:[],jobs:[]},project:()=>project,save(){assert.fail('失败的提交不应写入工程');}};
 const sync=createProjectCenterSync({store,dataDir:dir,apiOrigin:()=>''});
 try{await assert.rejects(sync.preflight(project,[]),error=>error.status===503&&error.code==='project_center_unavailable'&&error.message.includes(String(port))&&error.message.includes('启动工作台.cmd'));assert.deepEqual(store.db.jobs,[]);assert.equal(project.productionPolicy,undefined);}
 finally{sync.close();if(previous===undefined)delete process.env.PROJECT_CENTER_URL;else process.env.PROJECT_CENTER_URL=previous;}
});
test('中心缓存校验恢复和满载委派只处理等待画格，提交失联不重复本机生成',async()=>{
 const dir=fs.mkdtempSync(path.join(audit,'run-')),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),sha=createHash('sha256').update(bytes).digest('hex');
 const source=path.join(dir,'source.png');fs.writeFileSync(source,bytes);
 const asset={id:'asset_'+randomUUID(),name:'原图.png',extension:'.png',filePath:source,width:1,height:1},panel={id:'panel_1',shotId:'shot_1',x:0,y:0,w:100,h:100,imageAssetId:asset.id},project={id:'project_'+randomUUID(),revision:1,title:'缓存与满载测试',references:[],pages:[{id:'page_1',width:1280,episode:5,panels:[panel],bubbles:[]}],shots:[{id:'shot_1',episode:5,description:'Synthetic imported shot'}]};
 const policy={projectId:'central',standardsId:'std1',rules:{}},job={id:'waiting',projectId:project.id,panelId:panel.id,status:'queued',provider:'codex',action:'generate',input:{projectPolicy:policy}};
 panel.points=rectangle();job.panelContentKey=panelContentKey(project,panel,[asset]);let uploaded,downloads=0,dispatches=0;
 const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');let chunks=[];for await(const b of req)chunks.push(b);const input=chunks.length?JSON.parse(Buffer.concat(chunks)):null;
  if(req.url==='/api/v1/projects'&&req.method==='POST')return res.end(JSON.stringify({id:'central',sharePanels:true}));
  if(req.url==='/api/v1/projects/central')return res.end(JSON.stringify({project:{id:'central',sharePanels:true,standardsId:'std1'},artifacts:[],versions:[]}));
  if(req.url==='/api/v1/projects/central/files'){if(input.name==='原图.png')uploaded=Buffer.from(input.data,'base64');return res.end(JSON.stringify({id:input.name==='原图.png'?'file_image':'file_snapshot'}));}
  if(req.url==='/api/v1/files/file_image/content'){downloads++;res.setHeader('Content-Type','image/png');return res.end(bytes);}
  if(req.url==='/api/v1/projects/central/comic-snapshots'||req.url==='/api/v1/projects/central/progress')return res.end('{"ok":true}');
  res.statusCode=404;res.end('{"error":"unexpected route"}');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const previousTeamHelp=process.env.COMIC_TEAM_HELP;process.env.COMIC_TEAM_HELP='1';const previous=process.env.PROJECT_CENTER_URL;process.env.PROJECT_CENTER_URL='http://127.0.0.1:'+server.address().port;
 const store={db:{assets:[asset],projects:[project],jobs:[job],repairLinks:[]},save(){},assetPath(){return asset.filePath;},project(){return project;}};
 const sync=createProjectCenterSync({store,dataDir:dir,generationSlots:{mainLimit:()=>1,snapshot:()=>({running:1})},collabClient:{status:async()=>({hubReachable:true}),distribute:async()=>{dispatches++;assert.equal(job.status,'delegated');throw Error('模拟提交回包失联');}},apiOrigin:()=> 'http://127.0.0.1:1'});
 try{
  await sync.sync(structuredClone(project));assert.deepEqual(uploaded,bytes);assert.notEqual(asset.filePath,source);assert.equal(asset.originalFilePath,source);assert.equal(asset.projectCenterFile.fileId,'file_image');
  fs.writeFileSync(asset.filePath,Buffer.from('corrupt cache'));await sync.ensureAssets([asset.id]);assert.equal(downloads,1);assert.deepEqual(fs.readFileSync(asset.filePath),bytes);assert.deepEqual(fs.readFileSync(source),bytes);
  await sync.ensureAssets([asset.id]);assert.equal(downloads,1,'有效缓存不会重复下载');
  await sync.tick();assert.equal(dispatches,1);assert.equal(job.status,'delegated');assert.equal(job.phase,'uncertain');await sync.tick();assert.equal(dispatches,1,'提交结果未知不能重派');
 }finally{sync.close();if(previousTeamHelp===undefined)delete process.env.COMIC_TEAM_HELP;else process.env.COMIC_TEAM_HELP=previousTeamHelp;if(previous===undefined)delete process.env.PROJECT_CENTER_URL;else process.env.PROJECT_CENTER_URL=previous;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('分镜直导保留项目中心归档，不上传旧修图、不执行旧字号版式规则、不推送无话数进度',async()=>{
 const dir=fs.mkdtempSync(path.join(audit,'direct-')),oldFile=path.join(dir,'old.psd');fs.writeFileSync(oldFile,'retired');
 const project={id:'project_direct',revision:1,title:'Direct import',references:[],typography:{fontFamily:'用户字体',fontSize:20},shots:[{id:'shot_11',episode:11},{id:'shot_zero',episode:0}],pages:[{id:'page_11',episode:11,width:1280,panels:[{id:'panel_11',shotId:'shot_11'}]},{id:'page_zero',episode:0,width:1280,panels:[{id:'panel_zero',shotId:'shot_zero'}]}]};
 const uploads=[],progress=[],standard={id:'old-rule',number:1,rules:{layout:{pageWidth:999},typography:{family:'旧字体',minSize:90,maxSize:96}}};
 const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');let body='';for await(const chunk of req)body+=chunk;const input=body?JSON.parse(body):null;
  if(req.url==='/api/v1/projects'&&req.method==='POST')return res.end('{"id":"central_direct"}');
  if(req.url==='/api/v1/projects/central_direct')return res.end(JSON.stringify({project:{id:'central_direct',standardsId:standard.id},standards:[standard],artifacts:[],versions:[]}));
  if(req.url.endsWith('/files')){uploads.push(input.name);return res.end(JSON.stringify({id:'file_'+uploads.length}));}
  if(req.url.endsWith('/progress'))progress.push(input);
  res.end('{"ok":true}');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const previous=process.env.PROJECT_CENTER_URL;process.env.PROJECT_CENTER_URL='http://127.0.0.1:'+server.address().port;
 const store={db:{projects:[project],assets:[],jobs:project.pages.map(p=>({projectId:project.id,panelId:p.panels[0].id,batchId:'batch',status:'done',updated:new Date().toISOString()})),repairLinks:[{id:'old-edit',projectId:project.id,pageId:'page_11',status:'editing',nativeDocumentPath:oldFile}]},save(){},project:()=>project};
 const sync=createProjectCenterSync({store,dataDir:dir,generationSlots:{mainLimit:()=>0},apiOrigin:()=>''});
 try{
  const policy=await sync.preflight(project,['panel_11']);assert.equal(policy.standardsId,standard.id);assert.equal('rules' in policy,false);assert.equal(await sync.isPolicyCurrent(policy,'panel_11'),true);
  await sync.tick();assert.ok(uploads.includes(project.id+'.comic.json'));assert.equal(uploads.some(name=>name.endsWith('.psd')),false);assert.deepEqual(progress.map(p=>p.episode),[11]);assert.equal(progress[0].stage,'review');assert.equal(sync.status().lastError,'');
 }finally{sync.close();if(previous===undefined)delete process.env.PROJECT_CENTER_URL;else process.env.PROJECT_CENTER_URL=previous;server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('archiving an evicted shared asset restores exact bytes into the target project and discards expired cached links',async()=>{
 const dir=fs.mkdtempSync(path.join(audit,'archive-owner-')),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),sha=createHash('sha256').update(bytes).digest('hex'),asset={id:'asset_'+randomUUID(),name:'共用原图.png',extension:'.png',filePath:path.join(dir,'evicted.png'),storageEvicted:{at:'synthetic'},projectCenterFile:{projectId:'old_archive',fileId:'old_file',sha256:sha}},project={id:'project_'+randomUUID(),revision:1,title:'归档归属合成验收',references:[{assetId:asset.id}],pages:[],shots:[]};let snapshot,downloads=0;const uploaded=new Map();
 fs.writeFileSync(path.join(dir,'project-center-sync.local.json'),JSON.stringify({['target_archive:共用原图.png:'+sha]:'expired_file'}));
 const server=http.createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;const data=body?JSON.parse(body):null;res.setHeader('Content-Type','application/json');if(req.url==='/api/v1/projects'&&req.method==='POST')return res.end('{"id":"target_archive"}');if(req.url==='/api/v1/projects/target_archive')return res.end(JSON.stringify({project:{id:'target_archive'},files:[]}));if(req.url==='/api/v1/files/old_file/content'){downloads++;res.setHeader('Content-Type','image/png');return res.end(bytes);}if(req.url==='/api/v1/projects/target_archive/files'){const id='file_'+(uploaded.size+1);uploaded.set(id,data);return res.end(JSON.stringify({id}));}if(req.url==='/api/v1/projects/target_archive/comic-snapshots'){snapshot=data;return res.end('{"ok":true}');}res.statusCode=404;res.end('{"error":"unexpected route"}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const previous=process.env.PROJECT_CENTER_URL;process.env.PROJECT_CENTER_URL='http://127.0.0.1:'+server.address().port;
 const store={db:{projects:[project],assets:[asset],jobs:[]},project:()=>project,assetPath:()=>asset.filePath,save(){}};const sync=createProjectCenterSync({store,dataDir:dir,apiOrigin:()=>''});
 try{await sync.sync(project);assert.equal(downloads,1);assert.ok(uploaded.has(snapshot.files[asset.id]));assert.notEqual(snapshot.files[asset.id],'old_file');assert.notEqual(snapshot.files[asset.id],'expired_file');assert.equal(asset.projectCenterFile.projectId,'target_archive');assert.equal(asset.storageEvicted,undefined);assert.deepEqual(fs.readFileSync(asset.filePath),bytes);assert.ok(uploaded.has(snapshot.sourceFileId));}finally{sync.close();if(previous===undefined)delete process.env.PROJECT_CENTER_URL;else process.env.PROJECT_CENTER_URL=previous;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
