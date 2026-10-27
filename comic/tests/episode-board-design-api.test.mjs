import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';
import {ensureEpisodeBoards,boardContext,boardAssetIds,resolveBoard} from '../public/episode-boards.js';
import {writeXlsx} from '../lib/xlsx.mjs';

import {readEpisodeOutline} from '../lib/episode-boards.mjs';


import {sourceOriginalPath} from '../lib/source-originals.mjs';


const root=fileURLToPath(new URL('../',import.meta.url)),ownRoot=path.join(root,'.runtime','episode-board-design-api');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const outline={version:1,sourceKey:'synthetic-workbook',workTitle:'合成漫画',episodes:[{episode:1,title:'门前'},{episode:2,title:'来访'}]};
const operation=project=>({id:'lettering',tool:'bubble.typography',target:{kind:'bubble',id:project.pages[0].bubbles[0].id},args:{fontSize:42,fontFamily:'system-sans'}});
const raw=project=>({format:'comic-design-plan-v2',baseProjectId:project.id,operations:[operation(project)]});
function inventedProject(number=1,{boards=true,shared=true}={}){const project=createProject('合成漫画',true);project.pages[0].storyboard={episode:number};for(const bubble of project.pages[0].bubbles)bubble.parentPanelId=project.pages[0].panels.find(frame=>frame.shotId===bubble.shotId).id;if(shared)project.episodeOutline=structuredClone(outline);if(boards)ensureEpisodeBoards(project);return project;}

async function fixture(t,{projects=[inventedProject()],generate}={}){
 fs.mkdirSync(ownRoot,{recursive:true});const directory=fs.mkdtempSync(path.join(ownRoot,'case-'));
 const fake={python:process.env.COMIC_PYTHON_BIN,status:async()=>({connected:false}),models:async()=>({items:[]}),close(){}};
 const calls=[],generator={async generate(input){calls.push(input);assert.ok(generate,'不应启动合成文字通道');return generate(input);},close(){}};
 const studio=createStudio({dataDir:directory,bridge:fake,jimengBridge:fake,storyboardGenerator:generator,maxConcurrent:1,seedReference:false});
 studio.store.db.projects.push(...projects);studio.store.save();await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));const relative=path.relative(ownRoot,directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(directory,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+studio.server.address().port;
 async function request(route,method='GET',data,status=200){const response=await fetch(origin+route,{method,headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined}),value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
 const get=id=>request('/api/projects/'+id),put=project=>request('/api/projects/'+project.id,'PUT',project);
 const design=async(id,tail,data,status=200)=>request('/api/projects/'+id+'/'+tail,'POST',{expectedRevision:(await get(id)).revision,...data},status);
 async function asset(name){const filePath=path.join(directory,name+'.png');fs.writeFileSync(filePath,png);return request('/api/assets','POST',{filePath},201);}
 async function waitRun(id,runId){for(let i=0;i<150;i++){const result=await request('/api/projects/'+id+'/design-runs/'+runId);if(!['queued','running'].includes(result.run.status))return result;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('合成设计任务未结束');}
 return {studio,directory,request,get,put,design,asset,waitRun,calls};
}

test('无模板的旧 AI 工程导入设计方案时补齐默认封面，采用与撤销均保留',async t=>{
 const legacy=inventedProject(1,{boards:false,shared:false}),h=await fixture(t,{projects:[legacy]});assert.equal(h.studio.store.project(legacy.id).episodeBoards,undefined);
 const imported=await h.design(legacy.id,'design-plans/import',{plan:raw(legacy)}),boardState=structuredClone(imported.project.episodeBoards);
 assert.equal(boardState.templates.cover.width,1280);assert.equal(boardState.sharedKey,legacy.id);
 const applied=await h.design(legacy.id,'design-plans/'+imported.planId+'/apply',{});assert.deepEqual(applied.project.episodeBoards,boardState);assert.equal(applied.project.pages[0].bubbles[0].fontSize,42);
 const undone=await h.design(legacy.id,'design-plans/'+imported.planId+'/undo',{});assert.deepEqual(undone.project.episodeBoards,boardState);assert.equal(undone.project.pages[0].bubbles[0].fontSize,legacy.pages[0].bubbles[0].fontSize);
});

test('手调共用底图与单话名称后，合成设计生成、采用、撤销保留模板和共享版本',async t=>{
 const first=inventedProject(),second=inventedProject(2),h=await fixture(t,{projects:[first,second],generate:()=>raw(first)}),common=await h.asset('shared'),own=await h.asset('own');
 let p=await h.get(first.id);p.episodeBoards.templates.cover.backgroundAssetId=common.id;p.episodeBoards.templates.cover.background='#334455';p.episodeBoards.episodes[1]={episodeTitle:'本话手改',nextEpisodeTitle:'下一话手改',tail:{useOwnBackground:true,backgroundAssetId:own.id}};p=await h.put(p);
 const template=structuredClone(p.episodeBoards.templates),templateRevision=p.episodeBoards.templateRevision,siblingBefore=await h.get(second.id);
 assert.deepEqual(siblingBefore.episodeBoards.templates,template);assert.equal(boardContext(siblingBefore,2).episodeTitle,'来访');
 p.episodeBoards.episodes[1].episodeTitle='只改当前话';p=await h.put(p);assert.equal((await h.get(second.id)).revision,siblingBefore.revision);assert.equal(p.episodeBoards.templateRevision,templateRevision);
 const started=await h.design(first.id,'design-runs',{count:1},202),finished=await h.waitRun(first.id,started.run.id);assert.equal(finished.run.status,'completed',JSON.stringify(finished.run));assert.equal(h.calls.length,1);
 const id=finished.run.candidates[0].planId,applied=await h.design(first.id,'design-plans/'+id+'/apply',{});
 assert.deepEqual(applied.project.episodeBoards.templates,template);assert.equal(applied.project.episodeBoards.templateRevision,templateRevision);assert.equal(boardContext(applied.project,1).episodeTitle,'只改当前话');assert.equal(resolveBoard(applied.project,'tail',1).backgroundAssetId,own.id);
 const undone=await h.design(first.id,'design-plans/'+id+'/undo',{});assert.deepEqual(undone.project.episodeBoards,applied.project.episodeBoards);assert.deepEqual(undone.project.episodeOutline,outline);assert.equal((await h.get(second.id)).revision,siblingBefore.revision);
});

test('兄弟话修改共用模板后，旧候选与整体撤销都拒绝回滚共享模板',async t=>{
 const first=inventedProject(),second=inventedProject(2),h=await fixture(t,{projects:[first,second]});
 let p=await h.get(first.id);p.episodeBoards.templates.tail.background='#112233';await h.put(p);
 const imported=await h.design(first.id,'design-plans/import',{plan:raw(first)});let sibling=await h.get(second.id);sibling.episodeBoards.templates.tail.background='#445566';await h.put(sibling);
 const rejected=await h.design(first.id,'design-plans/'+imported.planId+'/apply',{},409);assert.equal(rejected.code,'design_revision_conflict');
 const fresh=await h.design(first.id,'design-plans/import',{plan:raw(first)});await h.design(first.id,'design-plans/'+fresh.planId+'/apply',{});
 sibling=await h.get(second.id);sibling.episodeBoards.templates.tail.background='#778899';await h.put(sibling);
 const blockedUndo=await h.design(first.id,'design-plans/'+fresh.planId+'/undo',{},409);assert.equal(blockedUndo.code,'design_undo_conflict');assert.equal((await h.get(first.id)).episodeBoards.templates.tail.background,'#778899');
});

test('封面专用底图与单话底图工程跨独立数据目录往返，映射新 ID 并形成独立作品',async t=>{
 const original=inventedProject(),source=await fixture(t,{projects:[original]}),target=await fixture(t,{projects:[]}),common=await source.asset('cover-background'),own=await source.asset('tail-override');
 let p=await source.get(original.id);p.episodeBoards.templates.cover.backgroundAssetId=common.id;p.episodeBoards.episodes[1]={episodeTitle:'工程手改名',tail:{useOwnBackground:true,backgroundAssetId:own.id}};await source.put(p);
 const exported=await source.request('/api/projects/'+original.id+'/export');assert.deepEqual(new Set(exported.assets.map(a=>a.id)),new Set([common.id,own.id]));assert.ok(exported.assets.every(a=>a.filePath&&!a.dataUrl));
 const imported=await target.request('/api/projects/import','POST',exported,201);assert.equal(imported.episodeBoards.sharedKey,imported.id);assert.equal(boardContext(imported,1).episodeTitle,'工程手改名');assert.equal(boardAssetIds(imported).length,2);assert.ok(boardAssetIds(imported).every(id=>![common.id,own.id].includes(id)));
 const roundtrip=await target.request('/api/projects/'+imported.id+'/export');assert.equal(roundtrip.assets.length,2);assert.equal(resolveBoard(imported,'tail',1).backgroundAssetId,imported.episodeBoards.episodes[1].tail.backgroundAssetId);
 let isolated=await target.get(imported.id);isolated.episodeBoards.templates.cover.background='#abcdef';await target.put(isolated);assert.notEqual((await source.get(original.id)).episodeBoards.templates.cover.background,'#abcdef');
});




