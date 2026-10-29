import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStudio} from '../server.mjs';
import {createProject,normalizeRows,panel} from '../public/model.js';
import {validateShotSettings,shotSettingsMarkup,effectiveShotDescription} from '../public/shot-settings.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {writeXlsx} from '../lib/xlsx.mjs';
import {importStoryboard} from '../lib/storyboard-import.mjs';

test('中远景从 XLSX 原样导入，景别菜单可选择且不误当机位',async()=>{
 const rows=[['格号','出场人物','当前场景','天气','时间','景别','机位角度','画面内容','台词'],['01','甲','院落','晴','夜','中远景','平视','甲站在院落中','']];
 const parsed=await importStoryboard({name:'synthetic.xlsx',dataBase64:writeXlsx([{name:'合成分镜',rows}]).toString('base64')});
 const [shot]=normalizeRows(parsed.rows,parsed);assert.equal(shot.shotSize,'中远景');
 assert.match(shotSettingsMarkup(shot,s=>String(s)),/value="中远景" selected/);
 assert.match(effectiveShotDescription(shot),/景别：中远景/);
 assert.throws(()=>validateShotSettings({cameraAngle:'中远景'}),/属于景别/);
});

test('custom camera directions remain literal; aliases, field errors and limits retain validation',()=>{
 for(const cameraAngle of ['居高临低斜看','肩后低位斜看','从主位后上方越过肩线俯看中央']){
  const shot=validateShotSettings({cameraAngle,description:'画面原文'});
  assert.equal(shot.cameraAngle,cameraAngle);assert.ok(effectiveShotDescription(shot).includes(cameraAngle));
 }
 assert.equal(validateShotSettings({cameraAngle:'俯视'}).cameraAngle,'俯拍');
 for(const cameraAngle of [42,null,{},[], '高'.repeat(101)])assert.throws(()=>validateShotSettings({cameraAngle}),/100字/);
 assert.throws(()=>validateShotSettings({cameraAngle:'特写'}),/属于景别/);
 assert.throws(()=>validateShotSettings({shotSize:'未知景别'}),/不在可选范围/);
 const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const markup=shotSettingsMarkup({cameraAngle:'斜看"<img>',description:''},escape);
 assert.ok(markup.includes('value="斜看&quot;&lt;img&gt;" selected'));assert.ok(!markup.includes('<img>'));
});

test('中远景与自定义机位在导入、保存、重开和导出重导入中原样保留',async()=>{
 const parent=path.resolve('.runtime');fs.mkdirSync(parent,{recursive:true});
 const dataDir=fs.mkdtempSync(path.join(parent,'custom-camera-'));
 const calls=[],blocked={status:async()=>({connected:false}),generate(){calls.push('generate');throw Error('No generation');},close(){}};
 const studio=createStudio({dataDir,bridge:blocked,jimengBridge:blocked});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+studio.server.address().port;
 const api=async(route,method='GET',body)=>{const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
 try{
  const project=createProject('自定义机位导入回归');
  project.shots=normalizeRows([{code:'G01',description:'人物看向窗外',景别:'中远景',cameraAngle:'居高临低斜看',productionPrompt:'提示词原文\n完整保留'}]);
  assert.equal(project.shots[0].shotSize,'中远景');
  project.pages[0].panels=[panel(project.shots[0].id,0,0,600,700)];
  ensureProjectPanelGeneration(project);project.pages[0].panels[0].generation.cameraAngle='从主位后上方越过肩线俯看中央';
  const input={format:'comic-strip-studio',version:2,imageStorage:'path',project,assets:[]};
  let imported=await api('/api/projects/import','POST',input);
  assert.equal(imported.shots[0].cameraAngle,'居高临低斜看');
  assert.equal(imported.shots[0].shotSize,'中远景');
  assert.equal(imported.pages[0].panels[0].generation.shotSize,'中远景');
  assert.equal(imported.pages[0].panels[0].generation.cameraAngle,project.pages[0].panels[0].generation.cameraAngle);
  imported.title+=' 已保存';await api('/api/projects/'+imported.id,'PUT',imported);
  imported=await api('/api/projects/'+imported.id);
  assert.equal(imported.shots[0].cameraAngle,'居高临低斜看');
  const exported=await api('/api/projects/'+imported.id+'/export?mode=local');
  const reopened=await api('/api/projects/import','POST',exported);
  assert.equal(reopened.shots[0].cameraAngle,imported.shots[0].cameraAngle);
  assert.equal(reopened.shots[0].shotSize,'中远景');
  assert.equal(reopened.pages[0].panels[0].generation.shotSize,'中远景');
  assert.equal(reopened.shots[0].productionPrompt,project.shots[0].productionPrompt);
  assert.equal(reopened.pages[0].panels[0].generation.cameraAngle,imported.pages[0].panels[0].generation.cameraAngle);
  assert.deepEqual(calls,[]);
 }finally{studio.close();studio.server.closeAllConnections();}
});
