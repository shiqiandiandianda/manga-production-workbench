import test from 'node:test';import assert from 'node:assert/strict';
import {validateShotSettings,shotSettingsMarkup} from '../public/shot-settings.js';
import {readStoryboardData} from '../lib/storyboard-data.mjs';
import {validateProject} from '../lib/store.mjs';
test('imported camera descriptions retain elevation and front-facing direction',()=>{
 const high={cameraAngle:'高位俯视'},front={cameraAngle:'平视正面'};
 assert.equal(validateShotSettings(high).cameraAngle,'高位俯视');assert.equal(validateShotSettings(front).cameraAngle,'正面平视');assert.equal(front.cameraAngleRaw,'平视正面');
 assert.match(shotSettingsMarkup(high,String),/value="高位俯视" selected/);
 assert.throws(()=>validateShotSettings({cameraAngle:'特写'}),/属于景别/);assert.equal(validateShotSettings({cameraAngle:'未知自由值'}).cameraAngle,'未知自由值');
});
test('storyboard import and repeated project validation preserve source wording and layout',async()=>{
 const rows=[{episode:1,code:'01',description:'原画面一',cameraAngle:'高位俯视'},{episode:1,code:'02',description:'原画面二',cameraAngle:'平视正面'}],raw=JSON.stringify(rows);
 const p=await readStoryboardData({name:'测试.json',text:raw});p.layerOrder=[...p.pages.flatMap(page=>[...page.panels,...page.bubbles]).map(x=>x.id),...(p.gradients||[]).map(x=>x.id)];validateProject(p);assert.deepEqual(p.shots.map(s=>s.cameraAngle),['高位俯视','正面平视']);assert.deepEqual(p.shots.map(s=>s.cameraAngleRaw),['高位俯视','平视正面']);
 assert.equal(JSON.stringify(rows),raw);const once=JSON.stringify(p);validateProject(p);assert.equal(JSON.stringify(p),once);
});
