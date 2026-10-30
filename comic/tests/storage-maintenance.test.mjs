import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {randomUUID,createHash} from 'node:crypto';
import {createStorageMaintenance,safeMaintenanceFile} from '../lib/storage-maintenance.mjs';
import {compactProjectFile,expandProjectFile} from '../lib/compact-project-file.mjs';
import {createProject} from '../public/model.js';
import {createProjectPortability} from '../lib/project-portability.mjs';
import {uploadVerifiedBackup,backupEntryBytes} from '../lib/maintenance-backup.mjs';
import {readZip} from '../lib/xlsx.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function fixture(t,{badReadback=false}={}){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'storage-policy-')),dataDir=path.join(base,'runtime-data','comic');fs.mkdirSync(dataDir,{recursive:true});
 const p=createProject('Storage synthetic'),image='asset_'+randomUUID(),remoteProject=randomUUID(),assetId=randomUUID(),revisionId=randomUUID(),file=path.join(dataDir,'library-cache','source.png');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,png);
 p.references=[{assetId:image,role:'character',name:'Synthetic'}];
 const asset={id:image,name:'Synthetic',filePath:file,width:1,height:1,mime:'image/png',library:{projectId:remoteProject,scopeId:'project',assetKind:'image',assetType:'comic_panel',assetId,revisionId,sha256:hash(png),size:png.length}};
 const db={projects:[p],assets:[asset],jobs:[],layouts:[]},store={root:dataDir,db,save:()=>true,asset:id=>db.assets.find(a=>a.id===id),assetPath:id=>db.assets.find(a=>a.id===id).filePath},archives=new Map();
 const library={baseUrl:'http://synthetic.invalid',withSession:fn=>fn(),assertSession(){},rememberClassifiedAsset(){},read:async()=>({items:[{id:remoteProject,name:p.title}]}),
  async packProject(project){return {project,assets:[{...asset,library:{...asset.library}}],fonts:[],originals:[]};},
  async uploadAsset(input){const revisionId=randomUUID();archives.set(revisionId,input.bytes);return {assetId:randomUUID(),revisionId,projectId:remoteProject};},
  async remote(url){const revision=url.split('/')[3],bytes=revision===revisionId?png:archives.get(revision);return new Response(badReadback?Buffer.from('corrupt'):bytes);},
  async ensureAsset(){fs.writeFileSync(file,png);delete asset.storageEvicted;},
 };
 let isBusy=false;
 const center={compact:async()=>({files:0,remaining:0}),storageStatus:async()=>({bytes:0})};
 const maintenance=createStorageMaintenance({dataDir,codeRoot:base,store,library,busy:()=>isBusy,projectCenter:center,policy:{completedTargetBytes:1,intervalMs:10,batchDelayMs:10},startTimer:false});
 t.after(()=>maintenance.close());return {base,dataDir,p,asset,store,library,maintenance,file,archives,center,setBusy:v=>isBusy=v};
}
async function finish(m){for(let n=0;n<500;n++){const r=m.view().run;if(r&&['done','failed'].includes(r.phase))return r;await new Promise(r=>setTimeout(r,5));}throw Error('maintenance timeout');}
test('compact engineering round-trip is exact; corrupt and oversized wrappers fail closed',()=>{
 const project=createProject('Compact');project.notes='原文和中文'.repeat(50000);const original={format:'comic-strip-studio',version:3,project,assets:[]},packed=compactProjectFile(original);
 assert.equal(packed.format,'comic-strip-studio-compact');assert.ok(JSON.stringify(packed).length<JSON.stringify(original).length/10);assert.deepEqual(expandProjectFile(packed),original);
 assert.throws(()=>expandProjectFile({...packed,sha256:'0'.repeat(64)}),/校验/);assert.throws(()=>expandProjectFile({...packed,jsonBytes:1024**3}),/大小/);
});
test('native import accepts compact engineering without rewriting imported text',async t=>{
 const f=fixture(t);f.p.notes='retain exact source'.repeat(10000);const input={format:'comic-strip-studio',version:3,project:f.p,assets:[{...f.asset,dataBase64:png.toString('base64'),sha256:hash(png)}]};
 const portability=createProjectPortability({dataDir:f.dataDir,store:f.store,library:f.library,productionPackages:{}});
 const restored=await portability.prepareImport(compactProjectFile(input));assert.equal(restored.input.project.notes,f.p.notes);
});
test('verified Moku backup precedes cold eviction and opening restores the exact original',async t=>{
 const f=fixture(t);await f.maintenance.execute({legacy:false,completedProjectId:f.p.id});const result=await finish(f.maintenance);
 assert.equal(result.phase,'done',result.message);assert.ok(f.archives.size>0);assert.equal(fs.existsSync(f.file),false);assert.equal(f.asset.storageEvicted.sha256,hash(png));
 await f.maintenance.open(f.p.id,'client');assert.deepEqual(fs.readFileSync(f.file),png);
});
test('active and dirty windows remain pinned even after an archive is verified',async t=>{
 const f=fixture(t);f.maintenance.touch({clientId:'active',projectId:f.p.id,dirty:false});await f.maintenance.execute({legacy:false,completedProjectId:f.p.id});assert.equal((await finish(f.maintenance)).phase,'done');assert.equal(fs.existsSync(f.file),true);
 f.maintenance.touch({clientId:'active',projectId:f.p.id,dirty:true});await assert.rejects(f.maintenance.backupProject(f.p.id),/未保存/);
});
test('failed backup readback never evicts originals or deletes old exports',async t=>{
 const f=fixture(t,{badReadback:true}),exportFile=path.join(f.dataDir,'exports','old.png');fs.mkdirSync(path.dirname(exportFile));fs.writeFileSync(exportFile,png);fs.utimesSync(exportFile,new Date(0),new Date(0));
 await f.maintenance.execute({legacy:false,completedProjectId:f.p.id});const r=await finish(f.maintenance);assert.equal(r.phase,'failed');assert.equal(fs.existsSync(f.file),true);assert.equal(fs.existsSync(exportFile),true);
});
test('shared asset remains local while any owning project is active',async t=>{
 const f=fixture(t),other=createProject('Other');other.references=[...f.p.references];f.store.db.projects.push(other);
 f.maintenance.touch({clientId:'other',projectId:other.id,dirty:false});await f.maintenance.execute({legacy:false,completedProjectId:f.p.id});await finish(f.maintenance);assert.equal(fs.existsSync(f.file),true);
});
test('busy work blocks cleanup and path escape or junctions are rejected',async t=>{
 const f=fixture(t);f.setBusy(true);await assert.rejects(f.maintenance.execute(),/任务/);assert.equal(fs.existsSync(f.file),true);
 assert.throws(()=>safeMaintenanceFile(f.dataDir,path.join(f.base,'outside')),/超出/);
 const outside=path.join(f.base,'outside-dir');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'keep');const link=path.join(f.dataDir,'link');try{fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>safeMaintenanceFile(f.dataDir,path.join(link,'keep.txt')),/链接/);}catch(e){if(e.code!=='EPERM')throw e;}
});
test('backup ZIP is verified against its original bytes before returning a receipt',async t=>{
 const f=fixture(t);const receipt=await uploadVerifiedBackup({library:f.library,dataDir:f.dataDir,projectId:f.asset.library.projectId,name:'test.zip',entries:[{name:'source.json',data:'{"source":"原文"}'}]});assert.equal(hash(f.archives.get(receipt.revisionId)),receipt.sha256);assert.ok(receipt.verifiedAt);assert.equal(fs.existsSync(receipt.local),false,'云端验证后不积累本地完整备份ZIP');
});
test('historical center files restore from a verified archive after local ZIP cache removal',async t=>{
 const f=fixture(t),directory=path.join(f.base,'runtime-data','center','project-center'),file=path.join(directory,'projects','historical','blobs',hash(png)+'.png');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,png);
 const record={id:'file_history',path:file,projectTitle:f.p.title,localProjectId:'project_old',bytes:png.length,sha256:hash(png)};
 f.center.storageInventory=async()=>({directory,files:[record]});f.center.storageFile=async()=>({directory,file:record});
 f.center.evictStorage=async rows=>{const row=rows[0];assert.equal(hash(fs.readFileSync(file)),row.sha256);record.storageBackup={...row.backup,entry:'objects/'+row.sha256,fileSha256:row.sha256,fileBytes:png.length};fs.unlinkSync(file);return {files:1,bytes:png.length};};
 await f.maintenance.execute({legacy:false});const r=await finish(f.maintenance);assert.equal(r.phase,'done',r.message);assert.equal(fs.existsSync(file),false);
 await f.maintenance.restoreCenterFile(record.id);assert.deepEqual(fs.readFileSync(file),png);
});
test('unavailable historical typed asset links use verified original archives without rewriting bindings',async t=>{
 const f=fixture(t),originalLibrary=structuredClone(f.asset.library);f.library.packProject=async()=>{throw Error('Historical asset no longer listed');};
 f.library.exportProjectSources=()=>[{relativePath:'原始资料.json',dataBase64:Buffer.from('原文保持一致').toString('base64')}];
 const receipt=await f.maintenance.backupProject(f.p.id);assert.deepEqual(f.asset.library,originalLibrary);assert.ok(f.asset.storageBackupRef);
 const zipped=f.archives.get(receipt.revisionId),native=expandProjectFile(JSON.parse(readZip(zipped).read('工程.json')));
 assert.equal(native.backupMode,'verified-original-archives');assert.ok(native.assets[0].archive);assert.deepEqual(native.assets[0].library,originalLibrary);
 const dir=path.join(f.base,'other-machine');fs.mkdirSync(dir);const otherStore={db:{assets:[],libraryFonts:[]},save(){return true;}};
 const portable=createProjectPortability({dataDir:dir,store:otherStore,library:f.library,productionPackages:{}});const restored=await portable.prepareImport(native);
 assert.deepEqual(fs.readFileSync(restored.input.assets[0].filePath),png);assert.deepEqual(restored.input.project.references,f.p.references);
 assert.equal(restored.input.packageSources[0].relativePath,'原始资料.json');
 const tampered=structuredClone(native);tampered.assets[0].archive.fileSha256='0'.repeat(64);await assert.rejects(portable.prepareImport(tampered),/身份|摘要/);
});
