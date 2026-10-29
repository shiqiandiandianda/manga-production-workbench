import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {referenceRecordMatch,createReferenceGenerationResults} from '../lib/reference-generation-results.mjs';
import {galleryRecordAssignments,galleryReturnDecision} from '../public/asset-gallery-batch.js';
import {automaticTextAssetDescription} from '../public/asset-text-description.js';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {createProject,panel} from '../public/model.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {createStudio} from '../server.mjs';
import {panelTextAssets} from '../public/panel-text-assets.js';

test('同名场景无需名称核对，旧服务返回的同名场景结果分配到各需求卡，跨项目仍拒绝',()=>{
 const projectId='project-a',context={project:{id:projectId},need:{name:'福州林家大院',role:'scene',state:''}};
 const raw={id:'production-a',name:'福州林家大院',type:'scene',outfit:'侧视 · 夜晚 · 阴',source:{projectId,panelId:'crop',needId:'scene-crop'}};
 assert.equal(referenceRecordMatch(raw,context).matchNote,'');
 assert.match(referenceRecordMatch({...raw,name:'福州林家大院后庭'},{...context,need:{...context.need,name:'林家大院后庭'}}).matchNote,/核对/);
 const rows=['screen','crop'].map((key,i)=>({key,role:'scene',name:raw.name,state:i?'':'主库待映射',uses:[{panelId:key,needId:'scene-'+key,missing:true}]}));
 const item={...raw,role:'scene',status:'completed',available:true,partial:false,imageUrl:'/result.png',context:{projectId,panelId:'screen',needId:'scene-screen'},matchNote:'场景名称相近，请核对后采用'};
 const assigned=galleryRecordAssignments(rows,item,{projectId});assert.equal(assigned.length,2);
 for(const {row,record}of assigned)assert.equal(galleryReturnDecision(row,[record],{projectId}).status,'ready');
 assert.equal(galleryRecordAssignments(rows,{...item,source:{projectId:'other'}},{projectId}).length,0);
 assert.equal(galleryReturnDecision(rows[0],[{...assigned[0].record,matchNote:'部分完成，须核对'}],{projectId}).status,'review');
});

test('服务端整项目结果保留整屏和裁格两种场景需求，不再只返回第一张同名卡',{timeout:15000},async t=>{
 const report=await inspectProductionPackage(syntheticFiles());
 const project=productionProject(report),screen=project.pages[0].panels.find(p=>p.productionSegment);
 const p=createProject('裁格'),shot=p.shots[0];shot.location='测试庭院';project.shots.push(shot);
 const crop=panel(shot.id,40,40,400,600);project.pages[0].panels.push(crop);
 const first=auditPanelReferences(project,screen,[]).needs.find(n=>n.role==='scene');
 assert.ok(first);const second=auditPanelReferences(project,crop,[]).needs.find(n=>n.role==='scene');assert.ok(second);
 const record={id:'production_'+randomUUID(),name:'测试庭院',type:'scene',status:'completed',outfit:'侧视 · 夜晚',finished:['scene-front','scene-reverse'],imageUrl:'/unused.png',source:{projectId:project.id,panelId:crop.id,needId:second.id}};
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:[record]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const store={db:{projects:[project],assets:[],jobs:[]},project:()=>project};
 const handle=createReferenceGenerationResults({store,library:{},assetStudioUrl:'http://127.0.0.1:'+server.address().port,mapping:{},save(){},saveProject(){}});
 const url=new URL('http://local/api/project-center/reference-generation/results?'+new URLSearchParams({projectId:project.id,panelId:crop.id,needId:second.id,scope:'work'}));let output;
 await handle({}, {},{pathname:url.pathname,method:'GET',url},(status,value)=>{assert.equal(status,200);output=value;},()=>{});
 const rows=assetWorkspaceInventory(project,[],{scope:'work',includeSources:false}).filter(r=>r.role==='scene');
 assert.equal(output.items.length,rows.length);assert.ok(output.items.some(r=>r.context.panelId===crop.id&&r.context.needId===second.id));
 assert.ok(output.items.every(r=>r.matchNote===''));
});

test('文生自动读取导入设定、原文及同一人物残影依据，不编造年龄服装且不改原资料',()=>{
 const project={pages:[],productionPackage:{ledger:[{file:'人物设定.json',records:[{'名称':'余沧海','固定设定':'身材矮小，短须。','状态说明':'待与项目主库对应，未绑定实际图片或固定版本；本批没有生成资产图。'}]}]}};
 const row={role:'character',name:'余沧海残影',state:'未知（待确认）',sources:[{description:'角色乙掌心穿过余沧海留下的残影。',notes:'残影属于同一人身法，不新增实体人物。',source:{file:'第031话.json'}}]};
 const before=JSON.stringify({project,row}),result=automaticTextAssetDescription(project,row);
 for(const value of ['余沧海','身材矮小','短须','掌心穿过','不新增实体人物'])assert.ok(result.description.includes(value));
 assert.ok(!result.description.includes('四十岁'));assert.ok(!result.description.includes('未绑定实际图片'));assert.deepEqual(result.sources,['人物设定.json','第031话.json']);assert.equal(JSON.stringify({project,row}),before);
 const fallback=automaticTextAssetDescription({pages:[]},{name:'木剑',role:'prop',sources:[]});assert.equal(fallback.description,'道具：木剑');
});

test('浏览器直接使用自动文生描述，空输入也调用原资料，保存刷新保留且不提交生成',{timeout:30000},async t=>{
 const evidence=path.resolve('../verification/asset-generation-repair-20261026');fs.mkdirSync(evidence,{recursive:true});const directory=fs.mkdtempSync(path.join(evidence,'text-'));process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_LIBRARY_CONFIG=path.join(directory,'no-library.json');
 const fake={close(){},status:async()=>({connected:false})},studio=createStudio({dataDir:directory,seedReference:false,bridge:fake,jimengBridge:fake});let browser;t.after(async()=>{await browser?.close();studio.close();studio.server.closeAllConnections();});
 const project=createProject('文生自动资料隔离验证'),shot=project.shots[0];Object.assign(shot,{participants:'余沧海残影',description:'角色乙的掌心穿过余沧海留下的残影。',sourceFields:{'画面备注':'残影属于同一人身法，不新增实体人物。'}});studio.store.db.projects.push(project);studio.store.save();await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1864,height:949}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+studio.server.address().port+'/?project='+project.id);await page.locator('#canvas-tool-dock').waitFor();await page.locator('[data-rail-tab="references"]').click();
 const card=page.locator('.asset-gallery-card').filter({has:page.locator('.asset-gallery-caption>strong',{hasText:'余沧海残影'})});await card.locator('[data-gallery-text]').click();await card.locator('.asset-list-item').click();const field=page.locator('[data-asset-text-description]');assert.match(await field.inputValue(),/掌心穿过/);assert.match(await field.inputValue(),/不新增实体人物/);await page.screenshot({path:path.join(evidence,'text-auto-description.png')});
 await field.fill('');await page.locator('[data-asset-action="save-text"]').click();await page.waitForFunction(()=>document.querySelector('#asset-detail-panel').hidden);const saved=panelTextAssets(studio.store.project(project.id),studio.store.project(project.id).pages[0].panels[0]);assert.equal(saved.length,1);assert.match(saved[0].description,/掌心穿过/);assert.equal(studio.store.db.jobs.length,0);
 await page.reload();await page.locator('#canvas-tool-dock').waitFor();await page.locator('[data-rail-tab="references"]').click();await card.locator('.asset-list-item').click();assert.equal(await field.inputValue(),saved[0].description);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(evidence,'text-auto-report.json'),JSON.stringify({ok:true,automatic:true,blankUsesSource:true,persisted:true,newJobs:0,errors},null,2));
});
