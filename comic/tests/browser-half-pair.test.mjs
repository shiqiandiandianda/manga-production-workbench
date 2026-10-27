import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {writeXlsx} from '../lib/xlsx.mjs';
import {productionHeaders,productionRows} from './helpers/storyboard-production.mjs';
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

test('browser imports five independent half-pair rows directly and displays the editable page on desktop and mobile',{timeout:60000},async t=>{
 const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'browser-half-pair-')),evidence=path.resolve('merge-audit/half-pair');fs.mkdirSync(evidence,{recursive:true});let browser;
 const errors=[],calls=[],fake={status:async()=>({connected:false}),close(){},generate(){calls.push('unexpected');throw Error('No real AI');}};
 const studio=createStudio({dataDir:path.join(dir,'data'),bridge:fake,jimengBridge:fake,storyboardGenerator:fake});await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await browser?.close();studio.close();await new Promise(resolve=>studio.server.close(resolve));assert.equal(path.dirname(dir),parent);fs.rmSync(dir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+studio.server.address().port,rows=Array.from({length:10},(_,i)=>productionHeaders.map((key,index)=>key==='格号'?String(i+1):key==='主副格'?'副格':key==='台词'?'甲：先看这里。':key==='画面内容'?'甲在石桥旁观察第'+(i+1)+'处水纹。':productionRows[1][index]));
 const plan={episode:11,spreads:Array.from({length:5},(_,i)=>({spread:'half-pair',units:[i*2+1,i*2+2].map(n=>'E011-'+String(n).padStart(3,'0')),pace:'normal'}))};
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1864,height:949}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin||['data:','blob:'].includes(new URL(route.request().url()).protocol)?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(origin);await page.locator('#rule-import').click();
  await page.locator('#storyboard-data-file').setInputFiles({name:'半格并排_合成分镜.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:writeXlsx([{name:'第11话',rows:[productionHeaders,...rows]}])});
  await page.locator('#storyboard-layout-files').setInputFiles({name:'第011话_排版计划.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(plan))});
  await page.waitForFunction(()=>document.querySelector('[data-layout-file-summary]').textContent.includes('已识别 1 话')&&!document.querySelector('[data-layout-file-summary]').textContent.includes('识别中'));
  await page.getByRole('button',{name:'导入并排版',exact:true}).click();await page.locator('#rule-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#project-label').textContent.includes('半格并排_合成分镜'));
  assert.equal(await page.locator('.comic-design-dialog[open]').count(),0);assert.deepEqual(calls,[]);
  const saved=studio.store.db.projects[0],body=saved.pages.find(p=>!p.designEpisodeRole);assert.equal(body.panels.length,10);
  const catalog=await(await fetch(origin+'/api/projects/'+saved.id+'/layout-components')).json();assert.equal(catalog.components.filter(c=>c.builtIn).length,32);assert.equal(catalog.components.find(c=>c.id==='half-pair').slots.length,2);
  const prompt=await(await fetch(origin+'/api/projects/'+saved.id+'/design-prompt?episode=11&aiOnly=1')).json();assert.match(prompt.prompt,/half-pair/);
  await page.locator('[data-rail-tab="pages"]') .click();await page.locator('#page-list [data-page="'+body.id+'"]').click();await page.locator('#zoom').selectOption('0.65');
  const first=page.locator('#stage [data-panel="'+body.panels[0].id+'"][data-layer-type="panel"]').first(),second=page.locator('#stage [data-panel="'+body.panels[1].id+'"][data-layer-type="panel"]').first();
  const pairIds=[body.panels[0].id,body.panels[1].id],pairBoxes=async()=>{await page.waitForFunction(ids=>ids.every(id=>document.querySelector('#stage [data-panel="'+id+'"][data-layer-type="panel"]')?.getBoundingClientRect().width>0),pairIds);return page.evaluate(ids=>ids.map(id=>{const r=document.querySelector('#stage [data-panel="'+id+'"][data-layer-type="panel"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}),pairIds);};
  const [a,b]=await pairBoxes();assert.ok(Math.abs(a.y-b.y)<1);assert.ok(a.x+a.width<b.x);assert.ok(a.width>200&&a.height>200);
  await page.screenshot({path:path.join(evidence,'desktop-half-pair.png')});
  await page.locator('#zoom').selectOption('fit');await page.setViewportSize({width:390,height:844});if(await page.locator('#sidebar-close').isVisible())await page.locator('#sidebar-close').click();if(await page.locator('#inspector-close').isVisible())await page.locator('#inspector-close').click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const [ma,mb]=await pairBoxes();assert.ok(Math.abs(ma.y-mb.y)<1);assert.ok(ma.x+ma.width<mb.x);assert.ok(ma.width>30&&mb.width>30);assert.ok(ma.x>=0&&mb.x+mb.width<=390);assert.ok(ma.y<844&&ma.y+ma.height>0);
  await page.screenshot({path:path.join(evidence,'mobile-half-pair.png')});assert.deepEqual(errors,[]);assert.deepEqual(calls,[]);
 }catch(error){await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
});
