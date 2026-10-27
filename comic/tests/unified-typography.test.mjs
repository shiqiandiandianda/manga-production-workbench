import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createStudio} from '../server.mjs';import {createProject,id,normalizeRows} from '../public/model.js';
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {bubbleLayout} from '../public/lettering.js';import {recommendedComicProfile} from '../public/comic-styles.js';
import {applyProjectTypography,validateTypography,renderTypographyPreview,TYPOGRAPHY_DEFAULT} from '../public/unified-typography.js';
test('统一字体保留原文、图片、尾巴和气泡造型；跳过锁定和特效字',()=>{
 const project=createProject('合成话',true);while(project.pages[0].bubbles.length<3){project.pages[0].bubbles.push({...structuredClone(project.pages[0].bubbles[0]),id:id('bubble')});}const before=structuredClone(project);
 const bubbles=project.pages.flatMap(p=>p.bubbles);assert.ok(bubbles.length>=2);bubbles[0].locked=true;bubbles[1].type='sfx';
 const original=structuredClone(project),result=applyProjectTypography(project,{fontFamily:'source-han-serif',fontSize:60});
 assert.equal(result.locked,1);assert.deepEqual(project.pages.map(p=>p.panels),original.pages.map(p=>p.panels));
 for(const [i,bubble] of bubbles.entries()){assert.equal(bubble.text,original.pages.flatMap(p=>p.bubbles)[i].text);assert.deepEqual(bubble.tail,original.pages.flatMap(p=>p.bubbles)[i].tail);assert.equal(bubble.shape,original.pages.flatMap(p=>p.bubbles)[i].shape);if(i>=2&&['speech','thought','caption'].includes(bubble.type)){assert.equal(bubble.fontSize,60);assert.equal(bubble.fontFamily,'source-han-serif');}}
 assert.equal(bubbles[0].fontSize,before.pages.flatMap(p=>p.bubbles)[0].fontSize);assert.deepEqual(bubbles[1],original.pages.flatMap(p=>p.bubbles)[1]);
});
test('全部话统一字体原子保存，版本冲突和非法字体不部分修改',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-typography-'));const fake={close(){}},studio=createStudio({dataDir:directory,bridge:fake,jimengBridge:fake,storyboardGenerator:fake});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
 const projects=[createProject('第11话',true),createProject('第12话',true)];studio.store.db.projects.push(...projects);studio.store.save();
 const request=async body=>{const response=await fetch('http://127.0.0.1:'+studio.server.address().port+'/api/projects/typography',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 const payload={fontFamily:'source-han-serif',fontSize:64,projectIds:projects.map(p=>p.id),expectedRevisions:Object.fromEntries(projects.map(p=>[p.id,p.revision]))};
 const invalid=await request({...payload,expectedRevisions:{...payload.expectedRevisions,[projects[1].id]:-1}});assert.equal(invalid.status,409);assert.equal(studio.store.db.projects[0].revision,projects[0].revision);
 const saved=await request(payload);assert.equal(saved.status,200);assert.equal(saved.data.projects.length,2);assert.ok(saved.data.changed>0);
 for(const project of saved.data.projects){assert.deepEqual(project.typography,validateTypography({fontFamily:'source-han-serif',fontSize:64}));assert.ok(project.pages.flatMap(p=>p.bubbles).filter(b=>['speech','thought','caption'].includes(b.type)).every(b=>b.fontFamily==='source-han-serif'&&b.fontSize===64));}
 assert.equal((await request(payload)).status,409);assert.equal((await request({...payload,fontSize:97})).status,400);assert.equal((await request({...payload,fontFamily:'unknown'})).status,400);
});
test('统一字号覆盖44到96，并拒绝非法数值',()=>{for(const value of [44,60,96])assert.equal(validateTypography({fontFamily:'system-sans',fontSize:value}).fontSize,value);for(const value of [43,97,NaN])assert.throws(()=>validateTypography({fontFamily:'system-sans',fontSize:value}));});




test('非法排版选项被拒绝，旧版两项字体设置可升级',()=>{
 const old=validateTypography({fontFamily:'source-han-serif',fontSize:51});assert.equal(old.lineHeight,1.32);assert.equal(old.fontWeight,400);
 for(const change of [{fontWeight:450},{lineHeight:.5},{letterSpacing:-11},{textColor:'red'},{writingMode:'sideways'},{textDirection:'wrong'},{padding:100}])assert.throws(()=>validateTypography({...TYPOGRAPHY_DEFAULT,...change}));
});
