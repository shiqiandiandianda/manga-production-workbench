import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {createStudio} from '../server.mjs';import {importStoryboard} from '../lib/storyboard-import.mjs';import {normalizeRows} from '../public/model.js';import {CAMERA_ANGLES,normalizeCameraAngle,validateShotSettings,effectiveShotDescription} from '../public/shot-settings.js';import {writeXlsx} from '../lib/xlsx.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),structure=JSON.parse(fs.readFileSync(new URL('./fixtures/xlsx-camera-structure.json',import.meta.url),'utf8'));
export function cameraFixtureWorkbook(){return writeXlsx(structure.sheets.map(sheet=>({name:sheet.name,rows:[[sheet.name+' 合成测试'],structure.headers,...sheet.rows.map(row=>[row.panel,'甲','合成场景','晴','日','中景',row.angle,'  合成画面原文 '+row.panel+'\n保留换行。','甲： 合成原句。  ','','合成备注'])]})));}
async function fixture(t){const data=fs.mkdtempSync(path.join(os.tmpdir(),'comic-xlsx-angle-'));const calls=[],blocked={status:async()=>{calls.push('status');throw Error('No account probe permitted');},generate:async()=>{calls.push('generate');throw Error('No generation permitted');},close(){}};const studio=createStudio({dataDir:data,bridge:blocked,jimengBridge:blocked});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(path.resolve(data)),path.resolve(os.tmpdir()));fs.rmSync(data,{recursive:true,force:true});assert.deepEqual(calls,[]);});return {studio,origin,request:async(route,body)=>{const r=await fetch(origin+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}};}
const unsupported=[['第15话','G17'],['第15话','G31'],['第17话','G17'],['第19话','G26'],['第19话','G34'],['第20话','G26']];

test('机位只做明确别名映射，正视保留正面方向、复合机位保留两个要素',()=>{
 const expected={'正视':'正面拍摄','侧视':'侧拍','侧位':'侧拍','背视':'背面拍摄','俯视':'俯拍','仰视':'仰拍','过肩':'过肩镜头','过肩俯视':'过肩俯拍','仰视过肩':'过肩仰拍','过肩仰视':'过肩仰拍','俯视侧位':'侧面俯拍','正面平视':'正面平视','正反打':'正反打'};
 for(const [raw,canonical] of Object.entries(expected)){const shot=validateShotSettings({description:'原描述',cameraAngle:raw});assert.equal(shot.cameraAngle,canonical);assert.ok(CAMERA_ANGLES.includes(canonical));if(raw!==canonical)assert.equal(shot.cameraAngleRaw,raw);assert.match(effectiveShotDescription(shot),new RegExp(canonical));}
 assert.notEqual(normalizeCameraAngle('正视'),'平视');assert.throws(()=>validateShotSettings({cameraAngle:'未知自由值'}),/未知自由值/);assert.throws(()=>validateShotSettings({cameraAngle:'特写'}),/属于景别/);
});

test('实际结构：标题行＋11列表头＋10工作表，保留原文、原机位和真实 Excel 行号',async t=>{
 const f=await fixture(t),dataBase64=cameraFixtureWorkbook().toString('base64'),issues=[];let passed=0;
 for(const sheet of structure.sheets){const result=await f.request('/api/storyboards/parse',{name:'结构回归.xlsx',dataBase64,sheet:sheet.name});const bad=sheet.rows.filter(r=>r.angle==='特写');
  if(bad.length){assert.equal(result.status,400);assert.equal(result.data.code,'STORYBOARD_IMPORT_ROWS');assert.equal(result.data.importInfo.rows.length,sheet.rows.length);assert.deepEqual(result.data.importInfo.sheets,structure.sheets.map(s=>s.name));assert.equal(result.data.importIssues.length,bad.length);for(const issue of result.data.importIssues){assert.equal(issue.originalValue,'特写');assert.equal(issue.column,'G');assert.match(issue.message,/属于景别/);issues.push([issue.sheet,issue.cell]);}continue;}
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.shots.length,sheet.rows.length);passed++;
  for(const [i,shot] of result.data.shots.entries()){const source=sheet.rows[i];assert.equal(shot.sourceRow,source.row);assert.equal(shot.sourceSheet,sheet.name);assert.equal(shot.cameraAngleRaw,source.angle);assert.equal(shot.cameraAngle,normalizeCameraAngle(source.angle));assert.equal(shot.description,'  合成画面原文 '+source.panel+'\n保留换行。');assert.equal(shot.dialogue,'甲： 合成原句。  ');}
 }
 assert.equal(passed,6);assert.deepEqual(issues,unsupported);assert.deepEqual((await f.request('/api/state')).data.projects,[]);
});

test('明确选择机位未指定后原值仍保留，原表不改、原行不删、未指定不会被填为平视',async t=>{
 const f=await fixture(t),failed=await f.request('/api/storyboards/parse',{name:'结构.xlsx',dataBase64:cameraFixtureWorkbook().toString('base64'),sheet:'第15话'});assert.equal(failed.status,400);
 const rows=structuredClone(failed.data.importInfo.rows);for(const row of rows)if(row['机位角度']==='特写')row['机位角度']='';
 const result=await f.request('/api/storyboards/parse',{text:JSON.stringify(rows)});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.shots.length,29);
 for(const line of [17,31]){const shot=result.data.shots.find(s=>s.sourceRow===line);assert.equal(shot.cameraAngle,undefined);assert.equal(shot.cameraAngleRaw,'特写');assert.equal(shot.sourceSheet,'第15话');}
 assert.equal(failed.data.importInfo.rows.filter(r=>r['机位角度']==='特写').length,2);
});

test('XLSX 空白行不造成定位漂移，表头行和列字母来自原工作表',async()=>{
 const dataBase64=writeXlsx([{name:'定位测试',rows:[['标题'],[],structure.headers,[1,'甲','','','','中景','未知机位','原描述','原句'],[],[2,'乙','','','','中景','正视','第二原描述','第二原句']]}]).toString('base64');
 const imported=await importStoryboard({name:'定位.xlsx',dataBase64});assert.deepEqual(imported.rowNumbers,[4,6]);assert.equal(imported.headerRow,3);assert.equal(imported.columns['机位角度'],'G');
 assert.throws(()=>normalizeRows(imported.rows,imported),e=>{assert.equal(e.importIssues[0].cell,'G4');assert.equal(e.importIssues[0].sheet,'定位测试');assert.equal(e.importIssues[0].originalValue,'未知机位');return true;});
});

test('用户实际 XLSX 只读复核：10表292行，首表30格可导入，6个不支持值准确定位', {skip:!process.env.COMIC_REAL_XLSX},async t=>{
 const file=process.env.COMIC_REAL_XLSX,bytes=fs.readFileSync(file),hash=createHash('sha256').update(bytes).digest('hex');assert.equal(hash,structure.sourceSHA256);
 const f=await fixture(t),issues=[],summary=[];
 for(const sheet of structure.sheets){const imported=await importStoryboard({name:'用户工作簿.xlsx',dataBase64:bytes.toString('base64'),sheet:sheet.name});assert.equal(imported.rows.length,sheet.rows.length);const result=await f.request('/api/storyboards/parse',{name:'用户工作簿.xlsx',dataBase64:bytes.toString('base64'),sheet:sheet.name});
  if(result.status===400){for(const issue of result.data.importIssues)issues.push([issue.sheet,issue.cell]);assert.equal(result.data.importInfo.rows.length,imported.rows.length);summary.push({sheet:sheet.name,rows:imported.rows.length,needsConfirmation:result.data.importIssues.map(i=>({cell:i.cell,value:i.originalValue}))});}
  else{assert.equal(result.status,200,JSON.stringify(result.data));for(const [i,shot] of result.data.shots.entries()){assert.equal(shot.description,imported.rows[i]['画面内容']);assert.equal(shot.dialogue,imported.rows[i]['台词']);assert.equal(shot.cameraAngleRaw,imported.rows[i]['机位角度']);assert.equal(shot.sourceRow,imported.rowNumbers[i]);}summary.push({sheet:sheet.name,rows:result.data.shots.length,ok:true});}
 }
 assert.deepEqual(issues,unsupported);assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash);
 fs.writeFileSync(path.join(root,'merge-audit/xlsx-user-verification.json'),JSON.stringify({ok:true,sourceSHA256:hash,originalUnchanged:true,sheets:summary,accountCalls:false,generationCalls:false},null,2)+'\n');
});
