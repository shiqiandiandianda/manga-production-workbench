import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProject,id,clone} from '../public/model.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {setPanelReferences} from '../public/panel-references.js';
import {libraryProjectScopes} from '../public/library-project-scope.js';
import {planPanelReferenceProcessing,processPanelReferences} from '../public/reference-processing.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';

test('墨库范围优先已链接库，旧工程只匹配唯一作品名，不跨作品搜索',()=>{
 const project=createProject('开局神戒，召唤万虫 第11-21话 V005'),target={id:randomUUID(),name:'召唤万虫'},foreign={id:randomUUID(),name:'大周玄衣卫'};
 assert.deepEqual(libraryProjectScopes(project,[],[foreign,target]).ids,[target.id]);
 assert.deepEqual(libraryProjectScopes(project,[],[foreign]).ids,['public']);
 assert.deepEqual(libraryProjectScopes(project,[],[target,{...target,id:randomUUID()}]).ids,['public']);
 const linked={id:id('asset'),library:{projectId:foreign.id}};project.assetLibrary={assetIds:[linked.id]};
 assert.deepEqual(libraryProjectScopes(project,[linked],[target]).ids,[foreign.id]);
});

test('训练场主景与细节同库时只取唯一主景，固定推荐版本并保留原有参考；再次处理不重复取图',async()=>{
 const project=createProject('开局神戒，召唤万虫 第11-21话 V005'),panel=project.pages[0].panels[0],shot=project.shots.find(s=>s.id===panel.shotId);
 Object.assign(shot,{participants:'无',location:'训练场',props:'无'});project.references=[];project.assetLibrary={version:1,assetIds:[]};ensureProjectPanelGeneration(project,[]);setPanelReferences(panel,[],{project,assets:[]});
 const main={id:randomUUID(),name:'006_预备杂役宿舍_训练场_主景.png',category:'scene',recommendedRevisionId:randomUUID()},detail={id:randomUUID(),name:'006_预备杂役宿舍_训练场_细节.png',category:'scene',recommendedRevisionId:randomUUID()},scope={id:randomUUID(),name:'召唤万虫'},foreign={id:randomUUID(),name:'大周玄衣卫'},calls=[],before=clone(project);
 let assets=[];const imported={id:id('asset'),name:main.name,filePath:'D:/synthetic/training.png',library:{projectId:scope.id,assetId:main.id,revisionId:main.recommendedRevisionId,category:'scene'}};
 const options={project,panel,getAssets:()=>assets,onAssets:items=>{for(const a of items)if(!assets.some(x=>x.id===a.id))assets.push(a);},api:async(route,method,body)=>{
  calls.push({route,method,body});if(route==='/api/library/status')return {connected:true};if(route==='/api/library/projects')return {items:[foreign,scope]};
  if(route.startsWith('/api/library/assets?')){const p=new URL(route,'http://local').searchParams;assert.equal(p.get('projectId'),scope.id);assert.equal(p.get('q'),'训练场');return {items:[main,detail]};}
  if(route==='/api/library/import'){assert.deepEqual(body,{assetId:main.id,revisionId:main.recommendedRevisionId});return {asset:imported};}
  if(route==='/api/assets/resolve')return {assets,failed:[]};throw Error('Unexpected request '+route);
 }};
 const result=await processPanelReferences(options);assert.deepEqual(result.ids,[imported.id]);assert.equal(result.matches[0].role,'scene');assert.deepEqual(project,before);
 panel.referenceRequirements=result.requirements;setPanelReferences(panel,result.ids,{project,assets});assert.equal(auditPanelReferences(project,panel,assets).needs[0].status,'ready');
 const firstCalls=calls.length;const second=await processPanelReferences(options);assert.equal(second.added,0);assert.equal(calls.length,firstCalls);assert.equal(calls.filter(c=>c.route==='/api/library/import').length,1);
 assert.ok(!calls.some(c=>/jobs|generate/.test(c.route)));
});

test('同名场景有多个主景时不自动取图；单独细节也需看图选择',()=>{
 const project=createProject('场景测试'),panel=project.pages[0].panels[0],shot=project.shots.find(s=>s.id===panel.shotId);Object.assign(shot,{participants:'无',location:'训练场',props:'无'});project.references=[];ensureProjectPanelGeneration(project,[]);setPanelReferences(panel,[],{project,assets:[]});
 const assets=['006_预备杂役宿舍_训练场_主景.png','007_外门_训练场_主景.png','006_预备杂役宿舍_训练场_细节.png'].map(name=>({id:id('asset'),name,filePath:'D:/synthetic/'+name,libraryRole:'scene'}));project.assetLibrary={assetIds:assets.map(a=>a.id)};
 const multiple=planPanelReferenceProcessing(project,panel,assets);assert.deepEqual(multiple.ids,[]);assert.ok(multiple.issues.some(i=>i.role==='scene'&&i.status==='review'));
 const detail=planPanelReferenceProcessing(project,panel,[assets[2]]);assert.deepEqual(detail.ids,[]);assert.ok(detail.issues.some(i=>i.status==='review'));
});
