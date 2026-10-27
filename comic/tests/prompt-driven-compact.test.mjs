import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {productionProject} from '../lib/production-package-document.mjs';
import {validateProject} from '../lib/store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectPromptDrivenPackage} from '../lib/prompt-driven-package.mjs';
import {loadPackageFiles,inspectProductionPackage,packageDigest as sha} from '../lib/production-package.mjs';
import {buildCompactPromptPackage} from '../tools/compact-prompt-package.mjs';

const modes=['带字','空泡','无泡'];
const file=(relativePath,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));return {relativePath,bytes,sha256:sha(bytes),sourceType:'local'};};
function manifest(files){return [...files.filter(f=>f.relativePath!=='文件校验.json'),file('文件校验.json',files.filter(f=>f.relativePath!=='文件校验.json').map(f=>({'文件':f.relativePath,'大小':f.bytes.length,sha256:f.sha256})))];}
function fixture(){
 const texts=[{'说话人':'合成人物','类型':'对白','文本':'合成原文，保留换行。'}],sfx=['砰'];
 const asset={'资产ID':'C001','版本':'青衣v1','类型':'人物','名称':'合成人物','状态说明':'青衣','提示词':'二维人物资产原文'};
 const units=kind=>[{'单元ID':kind==='屏段'?'E901-S01':'E901-G001','格号':[1],'画幅':kind==='屏段'?'1:3':'3:4','有效前情':{'文本':'先前合成动作'},'提示词':Object.fromEntries(modes.map(m=>[m,'合成'+kind+m+'\n不要改写。'])),'参考':[{'名称':'C001/青衣v1｜合成人物'}]}];
 const screen=units('屏段'),single=units('单格'),panel={'格号':1,'格ID':'E901-001','出现角色':['合成人物'],'当前场景':'合成庭院','台词':texts,'特效字':sfx,'资产索引':[['C001','青衣v1']]};
 const final={'格式':'提示词驱动制作1.0','阶段':'定稿','作品':'合成精简资料','话':901,'格':[panel],'生成单元':screen,'单格生成单元':single,'资产库':[asset]};
 const execution={'格式':'双套执行提示词1.0','组':[{'方式':'屏段','生成单元':screen},{'方式':'单格','生成单元':single}]};
 const index=[],txt=[];
 for(const group of execution['组'])for(const unit of group['生成单元'])for(const mode of modes){
  const bytes=Buffer.from(unit['提示词'][mode].replaceAll('\n','\r\n')+'\r\n'),name='提示词/'+group['方式']+'/'+unit['单元ID']+'_'+mode+'.txt';
  index.push({'话':901,'方式':group['方式'],'单元ID':unit['单元ID'],'格号':[1],'模式':mode,'文件':name,sha256:sha(bytes)});txt.push(file(name,bytes));
 }
 return manifest([file('同源定稿/第901话_定稿.json',final),file('同源定稿/第901话_执行提示词.json',execution),file('提示词索引.json',index),file('文字层.json',[{'话':901,'格号':1,'格ID':'E901-001','生成单元':'E901-S01','台词':texts,'特效字':sfx}]),...txt]);
}
function compact(legacy){
 const execution=JSON.parse(legacy.find(f=>f.relativePath.endsWith('_执行提示词.json')).bytes),index=JSON.parse(legacy.find(f=>f.relativePath==='提示词索引.json').bytes);
 for(const group of execution['组'])for(const unit of group['生成单元'])for(const mode of modes){const row=index.find(r=>r['方式']===group['方式']&&r['单元ID']===unit['单元ID']&&r['模式']===mode);unit['提示词'][mode]=legacy.find(f=>f.relativePath===row['文件']).bytes.toString('utf8');}
 return manifest([...legacy.filter(f=>!f.relativePath.endsWith('.txt')&&!f.relativePath.endsWith('_执行提示词.json')&&f.relativePath!=='文件校验.json'),file('同源定稿/第901话_执行提示词.json',execution),file('精简导入.json',{'格式':'提示词驱动精简包1.0','提示词存储':'执行JSON'})]);
}
function mutate(files,name,edit){return manifest(files.map(f=>f.relativePath===name?file(name,edit(JSON.parse(f.bytes))):f));}

test('新资料的准备说明单独保留，不导入成服装；专用服装字段优先且提示词逐字不变',()=>{
 const note='文字设计存在，实际人物母版、衣装组合与图像版本尚未提供；剧情状态另按格记录。',original=fixture();
 const files=mutate(original,'同源定稿/第901话_定稿.json',doc=>{doc['资产库'][0]['状态说明']=note;return doc;}),parsed=inspectPromptDrivenPackage(files),ref=parsed.episodes[0].segments[0].references[0];
 const project=productionProject(parsed);ensureProjectPanelGeneration(project,[]);validateProject(project);assert.equal(ref['服装'],'');assert.equal(ref.preparationNote,note);assert.deepEqual(parsed.episodes[0].panelRecords[0].original['服装'],{});assert.equal(parsed.ledger[0].records[0]['状态说明'],note);
 assert.deepEqual(parsed.episodes[0].segments[0].prompts,inspectPromptDrivenPackage(original).episodes[0].segments[0].prompts);
 const explicit=inspectPromptDrivenPackage(mutate(files,'同源定稿/第901话_定稿.json',doc=>{doc['资产库'][0]['服装']='青色长衫';return doc;}));assert.equal(explicit.episodes[0].segments[0].references[0]['服装'],'青色长衫');assert.equal(explicit.episodes[0].panelRecords[0].original['服装']['合成人物'],'青色长衫');
});

test('旧完整包继续读取三模式TXT原文',()=>{
 const parsed=inspectPromptDrivenPackage(fixture());assert.equal(parsed.count.panels,1);assert.equal(parsed.count.segments,1);
 for(const mode of modes)assert.ok(parsed.episodes[0].segments[0].prompts[mode].endsWith('\r\n'));
});
test('精简包保留屏段、独立单格、前情、资产及文字，并记录实际JSON指针',()=>{
 const legacy=fixture(),before=inspectPromptDrivenPackage(legacy),after=inspectPromptDrivenPackage(compact(legacy));
 assert.deepEqual(after.count,before.count);assert.deepEqual(after.ledger,before.ledger);
 assert.deepEqual(after.episodes[0].segments[0].prompts,before.episodes[0].segments[0].prompts);
 assert.deepEqual(after.episodes[0].segments[0].sourceContext,before.episodes[0].segments[0].sourceContext);
 assert.deepEqual(after.episodes[0].segments[0].references,before.episodes[0].segments[0].references);
 assert.deepEqual(after.episodes[0].panelRecords[0].original,before.episodes[0].panelRecords[0].original);
 for(const source of Object.values(after.episodes[0].segments[0].source.promptFiles)){assert.equal(source.file,'同源定稿/第901话_执行提示词.json');assert.ok(source.pointer.startsWith('/组/0/生成单元/0/提示词/'));assert.ok(source.originalFile.endsWith('.txt'));}
});
test('没有精简声明时仍拒绝丢失的TXT',()=>{const files=compact(fixture()).filter(f=>f.relativePath!=='精简导入.json');assert.throws(()=>inspectPromptDrivenPackage(manifest(files)),/缺少索引文件.*\.txt/);});
test('改动内嵌提示词并重做文件校验也不能绕过原文摘要',()=>{
 const files=mutate(compact(fixture()),'同源定稿/第901话_执行提示词.json',value=>{value['组'][0]['生成单元'][0]['提示词']['空泡']+='被改写';return value;});
 assert.throws(()=>inspectPromptDrivenPackage(files),/提示词摘要不符/);
});
test('文件损坏、缺失及无效精简版本均拒绝',()=>{
 const files=compact(fixture());assert.throws(()=>inspectPromptDrivenPackage(files.filter(f=>f.relativePath!=='文字层.json')),/缺少索引文件/);
 assert.throws(()=>inspectPromptDrivenPackage(files.map(f=>f.relativePath==='文字层.json'?{...f,bytes:Buffer.from('[]')}:f)),/文件校验失败/);
 assert.throws(()=>inspectPromptDrivenPackage(mutate(files,'精简导入.json',v=>({...v,'格式':'未支持2.0'}))),/不支持的精简/);
});
test('文件校验中必须包含精简声明',()=>{const files=compact(fixture());const bad=files.map(f=>f.relativePath==='文件校验.json'?file(f.relativePath,JSON.parse(f.bytes).filter(r=>r['文件']!=='精简导入.json')):f);assert.throws(()=>inspectPromptDrivenPackage(bad),/清单缺少精简导入声明/);});
test('文件夹上传及墨库固定版本使用同一精简解析结果',async()=>{
 const files=compact(fixture()),upload=await loadPackageFiles({files:files.map(f=>({relativePath:'上传目录/'+f.relativePath,dataBase64:f.bytes.toString('base64')}))});
 const direct=await inspectProductionPackage(files),uploaded=await inspectProductionPackage(upload);assert.deepEqual(uploaded.episodes,direct.episodes);
 const ids=files.map((_,i)=>'asset-'+i),revs=files.map((_,i)=>'revision-'+i);
 const library={read:async route=>{if(route.startsWith('/api/assets?'))return {items:files.map((f,i)=>({id:ids[i],name:path.posix.basename(f.relativePath),folder:'制作资料/'+path.posix.dirname(f.relativePath).replace(/^\.$/,''),displayRevisionId:revs[i]}))};const i=ids.indexOf(route.split('/').at(-1));return {recommendedRevisionId:revs[i],objectVersion:1,revisions:[{id:revs[i],sha256:files[i].sha256,size:files[i].bytes.length}]};},remote:async route=>new Response(files[revs.indexOf(route.split('/')[3])].bytes)};
 const loaded=await loadPackageFiles({sourceType:'moku',remoteProjectId:'public',folder:'制作资料'},library);assert.deepEqual((await inspectProductionPackage(loaded)).episodes,direct.episodes);
});
test('转换器只写新目录，原包和已存在目标均受保护',async()=>{
 const root=fileURLToPath(new URL('../../verification/prompt-compact-20261026/',import.meta.url));fs.mkdirSync(root,{recursive:true});const base=fs.mkdtempSync(path.join(root,'fixture-')),source=path.join(base,'source'),output=path.join(base,'compact');
 const files=fixture();for(const f of files){const target=path.join(source,...f.relativePath.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,f.bytes);}
 const result=await buildCompactPromptPackage({sourceDirectory:source,outputDirectory:output});assert.equal(result.compactFiles,7);assert.equal(result.exactPrompts,6);
 for(const f of files)assert.equal(sha(fs.readFileSync(path.join(source,...f.relativePath.split('/')))),f.sha256);
 assert.deepEqual((await inspectProductionPackage(await loadPackageFiles({directory:output}))).count,result.count);
 await assert.rejects(buildCompactPromptPackage({sourceDirectory:source,outputDirectory:output}),/目录已存在/);
 await assert.rejects(buildCompactPromptPackage({sourceDirectory:source,outputDirectory:path.join(source,'child')}),/互不包含/);
});

test('精简包通过实际扫描、导入、来源读取及工程导出再导入接口',{timeout:20000},async t=>{
 const root=fileURLToPath(new URL('../../verification/prompt-compact-20261026/',import.meta.url));fs.mkdirSync(root,{recursive:true});const dataDir=fs.mkdtempSync(path.join(root,'api-'));
 const values={COMIC_PROJECT_SYNC:'0',COMIC_SLOT_DIR:path.join(dataDir,'slots'),COMIC_LIBRARY_CONFIG:path.join(dataDir,'moku.json'),COLLAB_CLIENT_CONFIG:path.join(dataDir,'no-collaboration.json')},saved=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 Object.assign(process.env,values);fs.writeFileSync(values.COMIC_LIBRARY_CONFIG,JSON.stringify({base:'http://127.0.0.1:9'}));t.after(()=>{for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 const {createStudio}=await import('../server.mjs'),{productionFrame}=await import('../public/production-package-model.js'),{generationPromptSelection}=await import('../public/prompt-source.js');
 let generated=0;const bridge={close(){},ensurePoolSize(){},status:async()=>({connected:false,message:'合成测试'}),generate:async()=>{generated++;throw Error('测试禁止真实生成');}},jimengBridge={close(){},status:async()=>({connected:false}),models:async()=>({items:[]})};
 const studio=createStudio({dataDir,bridge,jimengBridge,seedReference:false});await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+studio.server.address().port;
 t.after(async()=>{const closed=new Promise(resolve=>studio.server.once('close',resolve));studio.close();await closed;});
 const api=async(route,method='GET',value)=>{const response=await fetch(origin+route,{method,headers:value?{'Content-Type':'application/json'}:{},body:value?JSON.stringify(value):undefined});const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body;};
 const files=compact(fixture()),scan=await api('/api/production-packages/scan','POST',{files:files.map(f=>({relativePath:f.relativePath,dataBase64:f.bytes.toString('base64')}))});
 assert.equal(scan.files.length,6);assert.equal(scan.count.episodes,1);assert.ok(!scan.issues.some(i=>i.severity==='conflict'));
 const project=await api('/api/production-packages/import','POST',{scanId:scan.scanId}),frame=productionFrame(project,'E901-S001');
 assert.equal(generationPromptSelection(frame,project).text,inspectPromptDrivenPackage(fixture()).episodes[0].segments[0].prompts['无泡']);
 const source=project.productionPackage.episodes[0].segments[0].source.promptFiles['无泡'],response=await fetch(origin+'/api/projects/'+project.id+'/production/source?path='+encodeURIComponent(source.file));assert.equal(response.status,200);
 const document=await response.json(),parts=source.pointer.split('/').slice(1);let value=document;for(const part of parts)value=value[part];assert.equal(sha(Buffer.from(value)),source.sha256);
 const exported=await api('/api/projects/'+project.id+'/export');assert.equal(exported.packageSources.length,6);
 const restored=await api('/api/projects/import','POST',exported);assert.notEqual(restored.id,project.id);assert.equal(restored.productionPackage.episodes[0].panelRecords[0].original['格ID'],'E901-001');assert.equal(generated,0);
});
