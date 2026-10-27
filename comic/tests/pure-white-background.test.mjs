import test from 'node:test';import assert from 'node:assert/strict';
import {inspectProductionPackage,packageDigest} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
function whiteFiles(){const files=syntheticFiles(),data=JSON.parse(files[1].bytes);for(const s of data['屏段'])s['底图']={'方式':'纯白','说明':'不出底图，格子后面是纯白'};files[1].bytes=Buffer.from(JSON.stringify(data));files[1].sha256=packageDigest(files[1].bytes);return files;}
test('纯白屏段保留提示词和底图原意，不建立不存在的底图生成任务',async()=>{
 const files=whiteFiles(),raw=JSON.parse(files[1].bytes),source=await inspectProductionPackage(files),project=productionProject(source);
 assert.equal(source.count.backgrounds,0);assert.equal(project.pages.length,2);
 assert.ok(project.pages.every(p=>p.background==='#ffffff'));
 assert.equal(project.shots.filter(s=>s.productionBackground).length,0);
 assert.equal(project.pages.flatMap(p=>p.panels).filter(p=>p.productionBackground||p.productionBackgroundInstance).length,0);
 for(const [i,s]of project.productionPackage.episodes[0].segments.entries()){
  assert.deepEqual(s.background,raw['屏段'][i]['底图']);assert.equal(s.backgroundPanelId,undefined);
  assert.equal(project.shots.find(v=>v.id===s.shotId).sourceFields['生图提示词'],raw['屏段'][i]['提示词']['空泡']);
 }
});
test('未知底图方式仍拒绝',async()=>{const files=whiteFiles(),data=JSON.parse(files[1].bytes);data['屏段'][0]['底图']['方式']='未知';files[1].bytes=Buffer.from(JSON.stringify(data));await assert.rejects(inspectProductionPackage(files),/底图提示词或方式无效/);});
test('出图底图缺提示词仍拒绝',async()=>{const files=syntheticFiles(),data=JSON.parse(files[1].bytes);delete data['屏段'][0]['底图']['提示词'];files[1].bytes=Buffer.from(JSON.stringify(data));await assert.rejects(inspectProductionPackage(files),/底图提示词或方式无效/);});
test('既有出图与共用底图保留',async()=>{const source=await inspectProductionPackage(syntheticFiles()),project=productionProject(source);assert.equal(source.count.backgrounds,1);assert.equal(project.shots.filter(s=>s.productionBackground).length,1);assert.ok(project.productionPackage.episodes[0].segments[0].backgroundPanelId);});
