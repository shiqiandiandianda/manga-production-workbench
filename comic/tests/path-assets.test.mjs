import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createStudio} from '../server.mjs';
import {Store,uid} from '../lib/store.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const root=fileURLToPath(new URL('../',import.meta.url));
async function fixture(t,{generate}={}){
 const parent=path.join(root,'.runtime','temp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'path-assets-test-')),dataDir=path.join(directory,'data'),original=path.join(directory,'中文 原图.png');fs.writeFileSync(original,png);
 const calls=[],bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async(dir,input,refs)=>{calls.push({dir,input,refs});if(generate)return generate({dir,input,refs,directory});const filePath=path.join(directory,'原生生图.png');fs.writeFileSync(filePath,png);return {filePath,imageToolSeen:true};}};
 const studio=createStudio({dataDir,bridge,jimengBridge:bridge});await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+studio.server.address().port;
 const request=async(route,method='GET',data)=>{const response=await fetch(url+route,{method,headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};};
 t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(parent));assert.ok(path.basename(target).startsWith('path-assets-test-'));fs.rmSync(target,{recursive:true,force:true});});
 const settle=async()=>{for(let i=0;i<100;i++){const {data}=await request('/api/state');if(data.jobs.every(j=>!['queued','running'].includes(j.status)))return data;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('模拟队列未结束');};
 return {directory,dataDir,original,studio,calls,request,settle,url};
}
test('登记中文路径与 file URL 只写元数据，重复登记复用 ID，预览读取原文件',async t=>{
 const f=await fixture(t),asset=(await f.request('/api/assets','POST',{filePath:'"'+f.original+'"'})).data;
 assert.equal(asset.filePath,fs.realpathSync(f.original));assert.equal(asset.storage,'path');assert.equal(asset.dataUrl,undefined);
 const duplicate=await f.request('/api/assets','POST',{filePath:pathToFileURL(f.original).href});assert.equal(duplicate.data.id,asset.id);
 assert.equal(f.studio.store.db.assets.length,1);assert.equal(fs.existsSync(path.join(f.dataDir,'assets')),false);
 const response=await fetch(f.url+'/assets/'+asset.id);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);assert.match(response.headers.get('cache-control'),/no-cache/);
 const persisted=JSON.parse(fs.readFileSync(f.studio.store.file));assert.equal(persisted.assets[0].filePath,asset.filePath);assert.equal(persisted.assets[0].dataUrl,undefined);
 assert.equal((await f.request('/api/assets','POST',{dataUrl:'data:image/png;base64,'+png.toString('base64')})).status,400);
});
test('导出 v2 只带路径；重新导入保留图片索引、建立独立工程和分镜',async t=>{
 const f=await fixture(t),p=(await f.request('/api/projects','POST',{title:'路径工程'})).data,asset=(await f.request('/api/assets','POST',{filePath:f.original})).data;
 await f.request(`/api/projects/${p.id}/panels/${p.pages[0].panels[0].id}/image`,'POST',{assetId:asset.id});
 const {data:exported}=await f.request('/api/projects/'+p.id+'/export?mode=local');assert.equal(exported.version,2);assert.equal(exported.assets[0].filePath,asset.filePath);assert.equal(exported.assets[0].dataUrl,undefined);
 const imported=await f.request('/api/projects/import','POST',exported);assert.equal(imported.status,201);assert.notEqual(imported.data.id,p.id);assert.notEqual(imported.data.shots[0].id,p.shots[0].id);assert.equal(imported.data.pages[0].panels[0].imageAssetId,asset.id);assert.equal(fs.existsSync(path.join(f.dataDir,'assets')),false);
});
test('原文件移动后明确报错，同尺寸重新指定路径保留 ID、画格和取景',async t=>{
 const f=await fixture(t),p=(await f.request('/api/projects','POST',{title:'路径修复'})).data,asset=(await f.request('/api/assets','POST',{filePath:f.original})).data;
 const attached=(await f.request(`/api/projects/${p.id}/panels/${p.pages[0].panels[0].id}/image`,'POST',{assetId:asset.id})).data;
 const moved=path.join(f.directory,'移动后 原图.png');fs.renameSync(f.original,moved);assert.equal((await fetch(f.url+'/assets/'+asset.id)).status,404);
 const relinked=await f.request('/api/assets/'+asset.id+'/path','PUT',{filePath:moved});assert.equal(relinked.status,200);assert.equal(relinked.data.id,asset.id);assert.deepEqual((await f.request('/api/projects/'+p.id)).data,attached);assert.equal((await fetch(f.url+'/assets/'+asset.id)).status,200);
 const different=Buffer.from(png);different.writeUInt32BE(2,16);const wrong=path.join(f.directory,'尺寸不同.png');fs.writeFileSync(wrong,different);
 assert.equal((await f.request('/api/assets/'+asset.id+'/path','PUT',{filePath:wrong})).status,400);assert.equal(f.studio.store.assetPath(asset.id),fs.realpathSync(moved));
});
test('任务引用原始路径，回填直接登记生成路径，不产生 assets/ref 副本',async t=>{
 const f=await fixture(t),p=(await f.request('/api/projects','POST',{title:'路径生图模拟'})).data,asset=(await f.request('/api/assets','POST',{filePath:f.original})).data;p.references=[{assetId:asset.id,role:'character',name:'角色'}];p.pages[0].panels[0].referenceIds=[asset.id];p.pages[0].panels[0].generation.referenceRoles=structuredClone(p.references);const saved=(await f.request('/api/projects/'+p.id,'PUT',p)).data;
 const queued=await f.request('/api/jobs','POST',{projectId:saved.id,panelIds:[saved.pages[0].panels[0].id],provider:'codex'});assert.equal(queued.status,202);
 const state=await f.settle(),job=state.jobs[0];assert.equal(job.status,'done');assert.equal(job.applied,true);assert.deepEqual(f.calls[0].refs,[fs.realpathSync(f.original)]);assert.equal(fs.existsSync(path.join(f.calls[0].dir,'refs')),false);assert.equal(fs.existsSync(path.join(f.dataDir,'assets')),false);
 assert.equal(f.studio.store.assetPath(job.assetId),path.join(f.directory,'原生生图.png'));
});
test('生成中参考文件移动时，已生成结果保留候选，不自动覆盖格子',async t=>{
 const f=await fixture(t,{generate:async({directory,refs})=>{fs.renameSync(refs[0],path.join(directory,'生成时移走.png'));const filePath=path.join(directory,'原生结果.png');fs.writeFileSync(filePath,png);return {filePath,imageToolSeen:true};}}),p=(await f.request('/api/projects','POST',{title:'变化保护'})).data,asset=(await f.request('/api/assets','POST',{filePath:f.original})).data;p.references=[{assetId:asset.id,role:'character',name:'角色'}];p.pages[0].panels[0].referenceIds=[asset.id];p.pages[0].panels[0].generation.referenceRoles=structuredClone(p.references);await f.request('/api/projects/'+p.id,'PUT',p);
 await f.request('/api/jobs','POST',{projectId:p.id,panelIds:[p.pages[0].panels[0].id],provider:'codex'});const state=await f.settle();assert.equal(state.jobs[0].status,'done');assert.equal(state.jobs[0].applied,false);assert.equal(state.projects[0].pages[0].panels[0].imageAssetId,null);assert.equal(state.projects[0].pages[0].panels[0].candidates.length,1);
});
test('旧工程仅补原图片路径，不移动文件或修改工程绑定',async t=>{
 const f=await fixture(t),assetId=uid('asset'),legacy=path.join(f.dataDir,'assets',assetId+'.png');fs.mkdirSync(path.dirname(legacy));fs.writeFileSync(legacy,png);f.studio.store.db.assets=[{id:assetId,name:'旧图',extension:'.png',width:1,height:1,mime:'image/png'}];f.studio.store.save();const reopened=new Store(f.dataDir);assert.equal(reopened.assetPath(assetId),legacy);assert.deepEqual(fs.readFileSync(legacy),png);assert.equal(reopened.db.assets[0].id,assetId);
});
