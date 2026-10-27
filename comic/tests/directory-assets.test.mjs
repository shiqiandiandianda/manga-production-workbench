import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createStudio} from '../server.mjs';
import {scanImageDirectory,importImageDirectory,registerImagePaths,createImageDirectoryIndex,inferAssetRole} from '../lib/image-directory.mjs';
import {inspectImageFileAsync,selectImageDirectory} from '../lib/image-files.mjs';
import {mountedImageIO,isMountedImagePath} from '../lib/mounted-io.mjs';
import {uid} from '../lib/store.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
async function fixture(t){
 const parent=path.join(root,'.runtime','temp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'directory-assets-test-')),source=path.join(directory,'中文 资产'),dataDir=path.join(directory,'data');fs.mkdirSync(source);
 const write=(relative,bytes=png)=>{const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return file;};
 const blocked={close(){},status:async()=>({connected:false}),generate(){throw Error('禁止真实生成');}};
 const studio=createStudio({dataDir,bridge:blocked,jimengBridge:blocked});await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+studio.server.address().port;
 const request=async(route,body)=>{const response=await fetch(url+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
 t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(parent));assert.ok(path.basename(target).startsWith('directory-assets-test-'));fs.rmSync(target,{recursive:true,force:true});});
 return {studio,directory,source,dataDir,write,request};
}
test('递归识别中文和空格路径，分类子目录；相同文件名保留两条路径',async t=>{
 const f=await fixture(t);f.write('01_角色/版本A/角色甲.png');f.write('01_角色/版本B/角色甲.png');f.write('02_场景/公堂.PNG');f.write('03_道具与特效/剑.png');f.write('04_参考资料/画风.png');f.write('根图.png');f.write('说明.txt',Buffer.from('说明'));
 const scan=await scanImageDirectory('"'+f.source+'"');assert.equal(scan.count,6);assert.equal(scan.ignored.unsupported,1);assert.equal(scan.files.filter(x=>x.name==='角色甲.png').length,2);assert.equal(scan.files.find(x=>x.name==='剑.png').role,'prop');assert.equal(scan.files.find(x=>x.name==='公堂.PNG').role,'scene');assert.ok(scan.files.every(x=>path.isAbsolute(x.filePath)));
 const direct=await scanImageDirectory(pathToFileURL(f.source).href,{recursive:false});assert.equal(direct.count,1);assert.equal(direct.files[0].name,'根图.png');assert.equal(f.studio.store.db.assets.length,0);
});
test('顶层资产分类优先，混合资产包子目录名称不覆盖道具特效和版式分类',()=>{
 assert.equal(inferAssetRole('01_资产/03_道具与特效/示例项目_资产包2_场景道具与资料/特效.png'),'prop');
 assert.equal(inferAssetRole('01_资产/05_标题头图与版式/场景资料/标题.png'),'style');
 assert.equal(inferAssetRole('03_道具与特效/版本B/图.png'),'prop');
 assert.equal(inferAssetRole('01_角色/场景版/人物.png'),'character');
});
test('目录批量导入报告坏图并保留好图，只登记路径，不改变工程；重复导入复用ID',async t=>{
 const f=await fixture(t);f.write('01_角色/角色.png');f.write('02_场景/场景.png');f.write('坏图.jpg',Buffer.from('not a jpeg image but longer than twenty four bytes'));
 const {data:project}=await f.request('/api/projects',{title:'保留原工程'}),before=JSON.stringify(f.studio.store.db.projects);
 const {status,data}=await f.request('/api/assets/directories/import',{directory:f.source});assert.equal(status,200);assert.equal(data.scanned,3);assert.equal(data.created,2);assert.equal(data.failed.length,1);assert.ok(data.assets.every(a=>a.storage==='path'&&a.directoryRoot===fs.realpathSync(f.source)&&!a.dataUrl));assert.equal(JSON.stringify(f.studio.store.db.projects),before);assert.equal(project.references.length,0);assert.equal(fs.existsSync(path.join(f.dataDir,'assets')),false);
 const again=await importImageDirectory(f.studio.store,f.source);assert.equal(again.created,0);assert.equal(again.reused,2);assert.deepEqual(again.assets.map(a=>a.id),data.assets.map(a=>a.id));assert.equal(f.studio.store.db.assets.length,2);
});
test('目录库允许超过60张，单话参考和画格不会被批量登记填满',async t=>{
 const f=await fixture(t);for(let i=0;i<65;i++)f.write('01_角色/角色'+i+'.png');await f.request('/api/projects',{title:'空工程'});const before=JSON.stringify(f.studio.store.db.projects);
 const result=await importImageDirectory(f.studio.store,f.source);assert.equal(result.created,65);assert.equal(f.studio.store.db.projects[0].references.length,0);assert.equal(JSON.stringify(f.studio.store.db.projects),before);
});
test('混合文件URL、引号路径和坏路径批量导入时去重且可重试',async t=>{
 const f=await fixture(t),file=f.write('角色 一.png');const result=await f.request('/api/assets/batch',{filePaths:[pathToFileURL(file).href,'"'+file+'"',path.join(f.source,'缺失.png')]});assert.equal(result.status,200);assert.equal(result.data.created,1);assert.equal(result.data.assets.length,1);assert.equal(result.data.failed.length,1);
 const again=await registerImagePaths(f.studio.store,[file]);assert.equal(again.reused,1);assert.equal(again.assets[0].id,result.data.assets[0].id);
});
test('无效目录与空目录明确返回结果；扫描上限不产生半导入数据',async t=>{
 const f=await fixture(t);const bad=await f.request('/api/assets/directories/scan',{directory:path.join(f.source,'不存在')});assert.equal(bad.status,404);
 const empty=await f.request('/api/assets/directories/import',{directory:f.source});assert.equal(empty.data.created,0);assert.equal(empty.data.scanned,0);
 f.write('1.png');f.write('2.png');await assert.rejects(scanImageDirectory(f.source,{maxFiles:1}),/最多扫描/);assert.equal(f.studio.store.db.assets.length,0);
});
test('目录链接不会把外部目录或循环带入递归扫描',async t=>{
 const f=await fixture(t);f.write('1.png');const other=path.join(f.directory,'外部');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'外部.png'),png);
 try{fs.symlinkSync(other,path.join(f.source,'外部链接'),process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('系统不允许创建测试目录链接');return;}throw error;}
 const scan=await scanImageDirectory(f.source);assert.equal(scan.count,1);assert.equal(scan.ignored.links,1);
});
test('再次导入尺寸已变化的路径不破坏既有资产尺寸和工程取景',async t=>{
 const f=await fixture(t),file=f.write('图片.png');const first=await registerImagePaths(f.studio.store,[file]),id=first.assets[0].id;const changed=Buffer.from(png);changed.writeUInt32BE(2,16);fs.writeFileSync(file,changed);
 const result=await importImageDirectory(f.studio.store,f.source);assert.equal(result.assets.length,0);assert.equal(result.failed.length,1);assert.equal(f.studio.store.asset(id).width,1);
});
test('异步图片头读取兼容现有尺寸检查；目录选择返回中文路径或取消',async t=>{
 const f=await fixture(t),file=f.write('图片.png'),info=await inspectImageFileAsync(file);assert.equal(info.width,1);assert.equal(info.height,1);assert.equal(info.filePath,fs.realpathSync(file));
 if(process.platform==='win32'){
  const chosen=await selectImageDirectory({runner:async()=>({code:0,stdout:JSON.stringify(f.source)})});assert.equal(chosen,f.source);
  assert.equal(await selectImageDirectory({runner:async()=>({code:0,stdout:'null'})}),null);
 }
});
test('扫描后登记与重复登记复用服务端清单，token不能换目录；明确刷新才重扫',async t=>{
 const f=await fixture(t);f.write('角色.png');let scans=0;
 const index=createImageDirectoryIndex({scanner:async(...args)=>{scans++;return scanImageDirectory(...args);}});
 const first=await index.scan(f.source),reused=await index.import(f.studio.store,f.source,{scanToken:first.scanToken});
 assert.equal(scans,1);assert.equal(reused.created,1);assert.equal(reused.cacheReused,true);
 const duplicate=await index.import(f.studio.store,f.source);assert.equal(scans,1);assert.equal(duplicate.reused,1);
 await assert.rejects(index.import(f.studio.store,path.join(f.source,'另一个目录'),{scanToken:first.scanToken}),/已过期或目录已改变/);
 await assert.rejects(index.import(f.studio.store,f.source,{recursive:false,scanToken:first.scanToken}),/已过期或目录已改变/);
 f.write('新图.png');assert.equal((await index.scan(f.source)).count,1);assert.equal(scans,1);
 const fresh=await index.scan(f.source,{refresh:true});assert.equal(fresh.count,2);assert.equal(scans,2);assert.notEqual(fresh.scanToken,first.scanToken);
});
test('扫描缓存有时效；同目录重叠扫描合并，不重复遍历',async t=>{
 const f=await fixture(t);f.write('图.png');let scans=0,time=1000;
 const index=createImageDirectoryIndex({now:()=>time,ttlMs:100,scanner:async(...args)=>{scans++;await new Promise(r=>setTimeout(r,10));return scanImageDirectory(...args);}});
 const [a,b]=await Promise.all([index.scan(f.source),index.scan(f.source)]);assert.equal(scans,1);assert.equal(a.scanToken,b.scanToken);
 time=1100;await assert.rejects(index.import(f.studio.store,f.source,{scanToken:a.scanToken}),/已过期/);assert.equal(scans,1);
 await index.scan(f.source);assert.equal(scans,2);
});
test('挂载目录登记只写路径，可保留不存在的待读取图片；不改变工程、不复制原图',async t=>{
 if(process.platform!=='win32'){t.skip('Windows挂载路径');return;}
 const f=await fixture(t);await f.request('/api/projects',{title:'挂载路径隔离'});const before=JSON.stringify(f.studio.store.db.projects);
 const directory='K:\\__comic_offline_fixture__',files=[{filePath:directory+'\\角色.png',relativePath:'角色.png',name:'角色.png',role:'character'}];
 const index=createImageDirectoryIndex({scanner:async()=>({directory,recursive:true,files,count:1,directories:1,ignored:{unsupported:0,links:0,unreadable:0},warnings:[]})});
 const scan=await index.scan(directory),result=await index.import(f.studio.store,directory,{scanToken:scan.scanToken});
 assert.equal(result.pathOnly,true);assert.equal(result.created,1);assert.equal(result.assets[0].inspection,'pending');assert.equal(result.assets[0].width,undefined);assert.equal(result.assets[0].fileSize,undefined);
 assert.equal(JSON.stringify(f.studio.store.db.projects),before);assert.equal(fs.existsSync(path.join(f.dataDir,'assets')),false);
 const again=await index.import(f.studio.store,directory,{scanToken:scan.scanToken});assert.equal(again.reused,1);assert.equal(again.assets[0].id,result.assets[0].id);
});
test('待读取路径按选用补齐尺寸，坏路径单独报告，手动批量复用同一个ID',async t=>{
 const f=await fixture(t),file=f.write('待选用.png'),asset={id:uid('asset'),name:'待选用',filePath:file,storage:'path',extension:'.png',mime:'image/png',inspection:'pending'},bad={...asset,id:uid('asset'),filePath:path.join(f.source,'不存在.png')};
 f.studio.store.db.assets.push(asset,bad);f.studio.store.save();const p=(await f.request('/api/projects',{title:'按需读取'})).data;
 const result=await f.request('/api/assets/resolve',{assetIds:[asset.id,bad.id]});assert.equal(result.status,200);assert.equal(result.data.assets.length,1);assert.equal(result.data.failed.length,1);assert.equal(result.data.failed[0].assetId,bad.id);
 assert.equal(f.studio.store.asset(asset.id).inspection,'ready');assert.equal(f.studio.store.asset(asset.id).width,1);assert.equal(f.studio.store.asset(bad.id).width,undefined);
 const duplicate=await registerImagePaths(f.studio.store,[file]);assert.equal(duplicate.reused,1);assert.equal(duplicate.assets[0].id,asset.id);
 const attached=await f.request(`/api/projects/${p.id}/panels/${p.pages[0].panels[0].id}/image`,{assetId:asset.id});assert.equal(attached.data.pages[0].panels[0].imageAssetId,asset.id);assert.ok(Number.isFinite(attached.data.pages[0].panels[0].imageTransform.scale));
});
test('手动登记能解析尚未读取的同路径资产，而不是误报尺寸变化',async t=>{
 const f=await fixture(t),file=f.write('未读取.png'),asset={id:uid('asset'),name:'未读取',filePath:file,storage:'path',extension:'.png',mime:'image/png',inspection:'pending'};f.studio.store.db.assets.push(asset);f.studio.store.save();
 const result=await f.request('/api/assets',{filePath:file});assert.equal(result.status,201);assert.equal(result.data.id,asset.id);assert.equal(result.data.width,1);assert.equal(f.studio.store.db.assets.length,1);
});
test('按需填图等待期间的用户修改保留，不向过期工程对象回填',async t=>{
 const f=await fixture(t),file=f.write('慢读取.png'),asset={id:uid('asset'),name:'慢读取',filePath:file,storage:'path',extension:'.png',mime:'image/png',inspection:'pending'};f.studio.store.db.assets.push(asset);f.studio.store.save();
 const p=(await f.request('/api/projects',{title:'用户正在编辑'})).data,panelId=p.pages[0].panels[0].id;
 let release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r),original=fs.promises.lstat;
 fs.promises.lstat=async(...args)=>{if(args[0]===file){entered();await gate;}return original(...args);};
 let attaching;
 try{
  attaching=f.request(`/api/projects/${p.id}/panels/${panelId}/image`,{assetId:asset.id});await waiting;
  p.title='读取期间已修改';p.pages[0].panels[0].x+=15;
  const response=await fetch('http://127.0.0.1:'+f.studio.server.address().port+'/api/projects/'+p.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});assert.equal(response.status,200);await response.json();
  release();const result=await attaching;assert.equal(result.status,409);assert.match(result.data.error,/画格已修改/);const current=f.studio.store.project(p.id);assert.equal(current.title,p.title);assert.equal(current.pages[0].panels[0].x,p.pages[0].panels[0].x);assert.equal(current.pages[0].panels[0].imageAssetId,null);
 }finally{release();fs.promises.lstat=original;await attaching;}
});
test('同一已登记图片可使用ETag复用浏览器缓存，避免再次传输原图',async t=>{
 const f=await fixture(t),file=f.write('缓存图.png'),asset=(await f.request('/api/assets',{filePath:file})).data,url='http://127.0.0.1:'+f.studio.server.address().port+'/assets/'+asset.id;
 const first=await fetch(url);assert.equal(first.status,200);await first.arrayBuffer();const etag=first.headers.get('etag');assert.ok(etag);
 const cached=await fetch(url,{headers:{'If-None-Match':etag}});assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);
});
test('挂载盘I/O串行、低频且失败后继续；本地盘不被挂载队列拖住',async()=>{
 assert.equal(isMountedImagePath('K:\\素材\\图.png'),true);assert.equal(isMountedImagePath('k:/素材'),true);assert.equal(isMountedImagePath('\\\\server\\share\\图.png'),true);assert.equal(isMountedImagePath('D:\\素材'),false);
 const starts=[];let active=0,maxActive=0;
 const run=fail=>mountedImageIO('K:\\__comic_offline_fixture__',async()=>{starts.push(Date.now());active++;maxActive=Math.max(maxActive,active);try{await new Promise(r=>setTimeout(r,15));if(fail)throw Error('模拟失败');return 'ok';}finally{active--;}});
 const tasks=[run(true),run(false),run(false)];assert.equal(mountedImageIO('D:\\__local_fixture__',()=>42),42);
 const results=await Promise.allSettled(tasks);assert.equal(maxActive,1);assert.equal(results[0].status,'rejected');assert.equal(results[1].value,'ok');assert.equal(results[2].value,'ok');assert.ok(starts[1]-starts[0]>=290);assert.ok(starts[2]-starts[1]>=290);
});
