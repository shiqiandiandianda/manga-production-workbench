import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createStudio} from '../server.mjs';import {projectLibraryAssets} from '../public/project-asset-library.js';
const root=path.resolve('.runtime/temp'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
async function fixture(t){
 fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'project-library-'));let studio;
 const fake={close(){},status:async()=>({connected:false}),generate(){throw Error('No real generation in tests');}};
 const start=async()=>{studio=createStudio({dataDir:path.join(dir,'data'),bridge:fake,jimengBridge:fake,storyboardGenerator:{close(){}}});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));};await start();
 t.after(async()=>{await stop();assert.equal(path.dirname(dir),root);fs.rmSync(dir,{recursive:true,force:true});});
 const stop=async()=>{if(!studio)return;const s=studio;studio=null;s.close();await new Promise(r=>s.server.close(r));};
 const request=async(route,method='GET',input)=>{const res=await fetch('http://127.0.0.1:'+studio.server.address().port+route,{method,headers:{'Content-Type':'application/json'},body:input?JSON.stringify(input):undefined});return {status:res.status,data:await res.json()};};
 const api=async(...args)=>{const result=await request(...args);assert.ok(result.status<400,JSON.stringify(result.data));return result.data;};
 const folder=name=>{const directory=path.join(dir,name);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'角色_同名.png'),png);return directory;};
 return {dir,api,request,folder,get studio(){return studio;},restart:async()=>{await stop();await start();}};
}
test('multi-directory imports belong to one project; replace and clear persist without removing shared files or canvas images',async t=>{
 const f=await fixture(t),a=f.folder('角色'),b=f.folder('场景'),c=f.folder('道具');
 let p=await f.api('/api/projects','POST',{title:'项目甲'}),q=await f.api('/api/projects','POST',{title:'项目乙'});
 const route='/api/projects/'+p.id+'/asset-library';let result=await f.api(route,'POST',{revision:p.revision,type:'directories',directories:[a,b,a],recursive:true});p=result.project;
 assert.equal(result.directories.length,2);assert.equal(result.assets.length,2);assert.equal(projectLibraryAssets(q,f.studio.store.db.assets).length,0);
 assert.equal((await f.api('/api/projects/'+q.id+'/asset-production')).libraryAssets.length,0);
 const first=result.assets[0],other=result.assets[1];p.references=[{assetId:first.id,name:first.name,role:'character'}];p.shots[0].referenceIds=[first.id];p.pages[0].panels[0].referenceIds=[first.id];p.pages[0].panels[0].generation.referenceRoles=[p.references[0]];p.assetBindings={hero:{assetId:first.id}};
 p=await f.api('/api/projects/'+p.id,'PUT',p);p=await f.api('/api/projects/'+p.id+'/panels/'+p.pages[0].panels[0].id+'/image','POST',{assetId:first.id});
 const originalImage=p.pages[0].panels[0].imageAssetId;result=await f.api(route,'POST',{revision:p.revision,type:'directories',directories:[c]});p=result.project;
 assert.equal(result.assets.length,1);assert.ok(!result.assets.some(asset=>asset.id===first.id||asset.id===other.id));assert.equal(p.references.length,0);assert.equal(p.pages[0].panels[0].referenceIds.length,0);assert.deepEqual(p.assetBindings,{});assert.equal(p.pages[0].panels[0].imageAssetId,originalImage);
 q=await f.api('/api/projects/'+q.id+'/asset-library','POST',{revision:q.revision,type:'directories',directories:[a]});assert.equal(q.assets[0].id,first.id);
 const exported=await f.api('/api/projects/'+p.id+'/export');assert.equal(exported.assets.length,2);const imported=await f.api('/api/projects/import','POST',exported);assert.equal(projectLibraryAssets(imported,f.studio.store.db.assets).length,1);
 result=await f.api(route,'POST',{revision:p.revision,type:'clear'});assert.equal(result.assets.length,0);assert.equal(result.directories.length,0);assert.equal(result.removed,1);assert.equal(result.project.pages[0].panels[0].imageAssetId,originalImage);
 await f.restart();assert.equal((await f.api(route)).assets.length,0);assert.equal((await f.api('/api/projects/'+q.project.id+'/asset-library')).assets.length,1);assert.ok(fs.existsSync(first.filePath));assert.equal((await fetch('http://127.0.0.1:'+f.studio.server.address().port+'/assets/'+first.id)).status,200);
});
test('invalid directories and stale revisions keep the saved import list; individual pictures survive a directory replacement',async t=>{
 const f=await fixture(t),a=f.folder('甲'),b=f.folder('乙'),manual=path.join(f.dir,'手动.png');fs.writeFileSync(manual,png);
 const p=await f.api('/api/projects','POST',{title:'独立清单'}),route='/api/projects/'+p.id+'/asset-library';let result=await f.api(route,'POST',{revision:p.revision,type:'images',filePaths:[manual]});
 result=await f.api(route,'POST',{revision:result.project.revision,type:'directories',directories:[a]});assert.equal(result.assets.length,2);const before=result;
 const bad=await f.request(route,'POST',{revision:before.project.revision,type:'directories',directories:[b,path.join(f.dir,'不存在')]});assert.ok(bad.status>=400);assert.deepEqual((await f.api(route)).project.assetLibrary,before.project.assetLibrary);
 assert.equal((await f.request(route,'POST',{revision:p.revision,type:'clear'})).status,409);
 result=await f.api(route,'POST',{revision:before.project.revision,type:'directories',directories:[b]});assert.equal(result.assets.length,2);assert.ok(result.assets.some(asset=>asset.filePath===manual));assert.ok(!result.assets.some(asset=>asset.filePath.startsWith(a+path.sep)));
});
