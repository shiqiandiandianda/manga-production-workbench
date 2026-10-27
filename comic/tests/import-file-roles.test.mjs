import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectProductionPackage,packageDigest} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {normalizeLayerOrder} from '../public/layers.js';
import {validateProject} from '../lib/store.mjs';

function sourceFile(relativePath,data){
 const bytes=Buffer.from(JSON.stringify(data));
 return {relativePath,bytes,sha256:packageDigest(bytes)};
}
function sourceFiles(count=2){
 const panels=Array.from({length:count},(_,i)=>({'格ID':'E041-'+String(i+1).padStart(3,'0'),'画面内容':'合成画面 '+(i+1),'当前场景':'合成庭院','景别':'全景','机位角度':'平视','生图提示词':'单格原文 '+(i+1)}));
 const board={'格式':'分镜 JSON 2.2','作品':'合成导入验收','话':41,'话名':'合成测试','格':panels};
 const screens={'版本':'屏段文字层 1.1','作品':board['作品'],'话':41,'出图模式':'空泡','屏段':panels.map((panel,i)=>({'段ID':'段'+String(i+1).padStart(3,'0'),'图片':'屏'+i+'.png','场景':'合成庭院','格':[{'格ID':panel['格ID'],'格号':i+1}],'附图':[],'提示词':{'空泡':'空泡整屏原文 '+i,'无泡':'无泡整屏原文 '+i},'底图':{'方式':'本段出图','图片':'底图'+i+'.png','提示词':'合成底色'}})),'文字':[]};
 return [sourceFile('分镜JSON/第041话_分镜.json',board),sourceFile('屏段/第041话_屏段文字层.json',screens)];
}
function draftFile(relativePath='底稿JSON/第041话.json'){
 return sourceFile(relativePath,{'作品':'合成导入验收','话':41,'格':[{'画面内容':'来源底稿','原著位置':'合成位置'}],'节拍表':[],'账本':{}});
}

test('底稿与正式分镜并存时使用正式分镜，保留底稿原件摘要，扫描顺序不影响结果',async()=>{
 for(const reversed of [false,true]){
  const files=[...sourceFiles(),draftFile()];if(reversed)files.reverse();
  const before=files.map(file=>[file.relativePath,packageDigest(file.bytes)]);
  const source=await inspectProductionPackage(files);
  assert.equal(source.count.episodes,1);assert.equal(source.count.panels,2);
  assert.ok(source.episodes[0].panelRecords.every(record=>record.source.file==='分镜JSON/第041话_分镜.json'));
  assert.equal(source.episodes[0].panelRecords[0].original['生图提示词'],'单格原文 1');
  assert.equal(source.issues.filter(issue=>issue.severity==='conflict').length,0);
  assert.equal(source.manifest.find(file=>file.relativePath==='底稿JSON/第041话.json').sha256,draftFile().sha256);
  assert.deepEqual(files.map(file=>[file.relativePath,packageDigest(file.bytes)]),before);
 }
});

test('明确的底稿文件名和底稿结构均不冒充分镜',async()=>{
 for(const name of ['原件/第041话_底稿.json','原件/第041话.json']){
  const source=await inspectProductionPackage([...sourceFiles(),draftFile(name)]);
  assert.equal(source.count.panels,2);
  assert.ok(source.manifest.some(file=>file.relativePath===name));
 }
});

test('两个真正的正式分镜仍报冲突，并指出话号和两份文件',async()=>{
 const files=sourceFiles(),second=sourceFile('分镜JSON/第041话_另一版本.json',JSON.parse(files[0].bytes));
 await assert.rejects(inspectProductionPackage([...files,second]),error=>{
  assert.match(error.message,/同一话有多个分镜JSON版本：第41话/);
  assert.ok(error.message.includes(files[0].relativePath));assert.ok(error.message.includes(second.relativePath));return true;
 });
});

test('明确声明为正式分镜的文件不会仅因放在底稿目录就被忽略',async()=>{
 const files=sourceFiles(),second=sourceFile('底稿JSON/第041话.json',JSON.parse(files[0].bytes));
 await assert.rejects(inspectProductionPackage([...files,second]),/多个分镜JSON版本/);
});

test('没有格式标记的单份旧版分镜仍可导入',async()=>{
 const files=sourceFiles(),board=JSON.parse(files[0].bytes);delete board['格式'];
 files[0]=sourceFile('旧版/第041话.json',board);
 const source=await inspectProductionPackage(files);assert.equal(source.count.panels,2);
 assert.equal(source.episodes[0].panelRecords[0].source.file,'旧版/第041话.json');
});

test('屏段计划保留为来源，不冒充有版本号的屏段文字层',async()=>{
 const files=sourceFiles(),text=JSON.parse(files[1].bytes);
 files.unshift(sourceFile('屏段/第041话_屏段计划.json',{'作品':text['作品'],'话':41,'默认模式':'空泡','屏段':text['屏段']}));
 const source=await inspectProductionPackage(files);assert.equal(source.count.segments,2);
 assert.ok(source.manifest.some(file=>file.relativePath.endsWith('_屏段计划.json')));
});

test('资产绑定需求等辅助JSON含屏段数组时仍只作为来源保留',async()=>{
 const auxiliary=sourceFile('资产绑定需求.json',{'状态':'待绑定','说明':'合成辅助文件','屏段':[{'段ID':'E041-S001','需要':['合成人物']}]}),files=[...sourceFiles(),auxiliary];
 const source=await inspectProductionPackage(files);assert.equal(source.count.episodes,1);assert.equal(source.count.segments,2);
 assert.equal(source.manifest.find(file=>file.relativePath===auxiliary.relativePath).sha256,auxiliary.sha256);
});

test('真正的文字层缺少版本时指出文件和未声明状态',async()=>{
 const files=sourceFiles(),text=JSON.parse(files[1].bytes);delete text['版本'];
 await assert.rejects(inspectProductionPackage([files[0],sourceFile(files[1].relativePath,text)]),error=>{
  assert.match(error.message,/版本缺失|版本：未声明/);assert.ok(error.message.includes(files[1].relativePath));return true;
 });
});

test('纯白底图沿用白色画板，不要求生图提示词或创建底图生成任务',async()=>{
 const files=sourceFiles(),text=JSON.parse(files[1].bytes);for(const segment of text['屏段'])segment['底图']={'方式':'纯白','说明':'使用画板原有白底'};
 files[1]=sourceFile(files[1].relativePath,text);const source=await inspectProductionPackage(files),project=productionProject(source);
 ensureProjectPanelGeneration(project,[]);normalizeLayerOrder(project);validateProject(project);
 assert.equal(source.count.backgrounds,0);assert.equal(project.pages.length,2);
 assert.ok(project.pages.every(page=>page.background.toLowerCase()==='#ffffff'));
 assert.equal(project.pages.flatMap(page=>page.panels).filter(panel=>panel.productionBackground).length,0);
 assert.equal(project.shots.filter(shot=>shot.productionBackground).length,0);
 assert.equal(source.episodes[0].segments[0].background['方式'],'纯白');
});

test('未知底图方式和缺少生成提示词仍被拒绝',async()=>{
 for(const background of [{'方式':'未知'},{'方式':'本段出图','图片':'bg.png'}]){
  const files=sourceFiles(),text=JSON.parse(files[1].bytes);text['屏段'][0]['底图']=background;
  await assert.rejects(inspectProductionPackage([files[0],sourceFile(files[1].relativePath,text)]),/底图提示词或方式无效/);
 }
});

test('真正不兼容的文字层版本与重复文字层仍被拒绝',async()=>{
 const files=sourceFiles(),text=JSON.parse(files[1].bytes);text['版本']='屏段文字层 2.0';
 await assert.rejects(inspectProductionPackage([files[0],sourceFile(files[1].relativePath,text)]),/不支持的屏段文字层版本/);
 await assert.rejects(inspectProductionPackage([...files,sourceFile('屏段/第041话_另一文字层.json',JSON.parse(files[1].bytes))]),/同一话有多个屏段版本/);
});

test('超过100屏的制作资料可建立画板并通过保存校验',async()=>{
 const source=await inspectProductionPackage(sourceFiles(120)),project=productionProject(source);
 ensureProjectPanelGeneration(project,[]);normalizeLayerOrder(project);validateProject(project);
 assert.equal(project.pages.length,120);assert.equal(source.count.segments,120);
});

test('制作资料仍受1000屏安全上限约束，普通工程仍保留100画板上限',async()=>{
 await assert.rejects(inspectProductionPackage(sourceFiles(1001)),/资料格数或屏段数超出上限/);
 const source=await inspectProductionPackage(sourceFiles(101)),project=productionProject(source);
 ensureProjectPanelGeneration(project,[]);normalizeLayerOrder(project);delete project.productionPackage;
 assert.throws(()=>validateProject(project),/工程需要 1—100 张画板/);
});
