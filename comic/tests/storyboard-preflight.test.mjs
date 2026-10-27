import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {createStudio} from '../server.mjs';import {writeXlsx} from '../lib/xlsx.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),native=require(process.env.COMIC_TEST_CANVAS_MODULE),fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/xlsx-camera-structure.json',import.meta.url),'utf8'));
const input=()=>({name:'真实结构回归.xlsx',dataBase64:writeXlsx(fixture.sheets.map(s=>({name:s.name,rows:[[s.name+' 合成标题'],fixture.headers,...s.rows.map(r=>[r.panel,'甲','合成场景','晴','日','中景',r.angle,'甲核对桌上的印记，中景。','甲：这句必须保留。','',''])]}))).toString('base64')});
const bind=s=>({fileKey:s.fileKey,sheet:s.sheet,expectedVersion:s.version});
const aliases=s=>s.issues.filter(i=>i.kind==='CAMERA_ALIAS').map(i=>({issueId:i.id,action:'alias',value:i.suggestions[0].value}));
const unspecified=s=>s.issues.filter(i=>i.fieldKey==='cameraAngle'&&i.severity==='blocking').map(i=>({issueId:i.id,action:'edit',value:''}));
const expectedCells=['第15话!G17','第15话!G31','第17话!G17','第19话!G26','第19话!G34','第20话!G26'];
async function server(t){const data=fs.mkdtempSync(path.join(os.tmpdir(),'comic-preflight-')),calls=[],blocked={status:async()=>{calls.push('account');throw Error('No accounts');},generate:async()=>{calls.push('generation');throw Error('No generation');},close(){}};const studio=createStudio({dataDir:data,bridge:blocked,jimengBridge:blocked});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(path.resolve(data)),path.resolve(os.tmpdir()));fs.rmSync(data,{recursive:true,force:true});assert.deepEqual(calls,[]);});return {studio,request:async(route,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}};}



test('批量同类别名是原子人工决定，未经确认不能创建，取消不写库',async t=>{const f=await server(t),before=fs.readFileSync(f.studio.store.file,'utf8');let s=(await f.request('/api/storyboards/check','POST',input())).data;const group=s.issues.filter(i=>i.kind==='CAMERA_ALIAS'&&i.originalValue==='正视'),oldVersion=s.version;let r=await f.request('/api/storyboards/check/'+s.id,'PATCH',{...bind(s),decisions:group.map(i=>({issueId:i.id,action:'alias',value:'正面拍摄'}))});assert.equal(r.status,200);s=r.data;assert.equal(s.version,oldVersion+1);assert.equal(s.decisions.length,14);assert.equal(s.issues.some(i=>i.originalValue==='正视'),false);const unresolved=await f.request('/api/storyboards/check/'+s.id+'/confirm','POST',bind(s));assert.equal(unresolved.status,400);const invalid=await f.request('/api/projects/rule-layout','POST',{project:{ruleLayout:{mode:'whole-strip'},pages:[{}]}});assert.equal(invalid.status,400);assert.match(invalid.data.error,/先完成/);assert.equal(fs.readFileSync(f.studio.store.file,'utf8'),before);assert.equal((await f.request('/api/storyboards/check/'+s.id,'DELETE')).status,200);assert.equal(fs.readFileSync(f.studio.store.file,'utf8'),before);assert.equal((await f.request('/api/storyboards/check/'+s.id+'/confirm','POST',bind(s))).status,410);});












