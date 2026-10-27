import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';
import {zipStore} from '../public/render.js';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {chromium}=require(process.env.COMIC_PLAYWRIGHT_PATH);
const native=require(process.env.COMIC_TEST_CANVAS_MODULE||path.join(root,'runtime/node/node_modules/@napi-rs/canvas'));
const qa=path.join(root,'development','qa');fs.mkdirSync(qa,{recursive:true});
const temp=path.join(root,'.runtime','temp');fs.mkdirSync(temp,{recursive:true});
const directory=fs.mkdtempSync(path.join(temp,'browser-rule-'));
const calls=[],blocked={status:async()=>{calls.push('status');throw Error('No external connection');},generate:async()=>{calls.push('generate');throw Error('No generation');},close(){}};
const studio=createStudio({dataDir:directory,bridge:blocked,jimengBridge:blocked});
await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+studio.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1500,height:1000},acceptDownloads:true});
const page=await context.newPage(),errors=[],badResponses=[],network=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status()});});
page.on('request',r=>network.push(r.url()));
const check=async(fn)=>{await fn();assert.deepEqual(errors,[]);};
const scenes=['establish','dialogue-pair','dialogue-address','dialogue-group','combat','action','procedure','empty','transition','reaction'];
const source=Array.from({length:60},(_,i)=>{
 const scene=scenes[Math.floor(i/6)%scenes.length];
 const empty=scene==='empty';
 const description=scene==='establish'?'雨夜城南茶楼，灯火与门口人影，中远景，交代空间关系。':
 scene==='combat'?'甲向右挥剑，乙后退闪避，中景，衣袖和剑锋带出运动。':
 scene==='procedure'?'乙翻阅账册，手指停在印记旁，特写，账册与手指清楚可见。':
 empty?'雨水沿屋檐落入石槽，严格空镜，无人物。':
 scene==='transition'?'次日清晨，街口的新场景，路旁屋舍与晨雾，全景。':
 scene==='reaction'?'乙听到线索后沉默，抬眼看向甲，面部近景。':'甲与乙核对商队失踪的线索，保持甲左乙右，两人中景。';
 return {'镜头编号':'S'+String(i+1).padStart(2,'0'),'画面描述':description,'台词':empty?'':
 i===16?'甲：'+('账册上的每个记号都需要核对，不能漏掉原文、数字123和标点。').repeat(5)+'\n乙：我会逐项查明。':
 i%7===0?'旁白：雨仍未停。':
 '甲：线索在这里，我们继续核对。\n乙：先看这个印记。\n甲：好，记住刚才的位置。',
 '场面类型':scene,'叙事职责':i%11===0?'reveal':i%5===0?'detail':'main',
 '景别':empty||scene==='transition'?'wide':scene==='procedure'?'detail':i%3===0?'close':'medium',
 '场面编号':'G'+Math.floor(i/12),'参与人物':empty||scene==='transition'?'':scene==='dialogue-group'?'甲、乙、丙':scene==='dialogue-address'?'甲、乙、丙、丁':'甲、乙',
 '时间':i<48?'雨夜':'次日清晨','地点':i<48?'茶楼':'街口','转场':i===48?'time':'none','人物站位':empty?'':'甲:左;乙:右'};
});
let report={};
try{
 await page.goto(url);await page.locator('#rule-import-empty').waitFor({state:'visible'});
 assert.equal((await (await fetch(url+'/api/state')).json()).projects.length,0);
 await page.screenshot({path:path.join(qa,'01-纯净首页.png')});
 console.log('PASS empty startup');
 await page.locator('#rule-import-empty').click();await page.locator('#rule-text').fill(JSON.stringify(source));
 await page.getByRole('button',{name:'开始整话试排',exact:true}).click();
 await page.getByRole('button',{name:'保存并打开整话',exact:true}).waitFor({state:'visible',timeout:45000});
 assert.equal(await page.getByRole('button',{name:'保存并打开整话',exact:true}).isEnabled(),true,await page.locator('.rule-status').textContent());
 await page.locator('#rule-title').fill('整话规则试排验证（60格）');
 assert.equal(await page.locator('.rule-body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(251, 252, 252)');
 await page.screenshot({path:path.join(qa,'02-真实台词试排.png')});
 const phone=page.locator('.rule-phone-scroll');
 await phone.screenshot({path:path.join(qa,'03-手机试读-开头.png')});
 await phone.evaluate(e=>e.scrollTop=(e.scrollHeight-e.clientHeight)*.48);
 await phone.screenshot({path:path.join(qa,'04-手机试读-中段.png')});
 await phone.evaluate(e=>e.scrollTop=e.scrollHeight);
 await phone.screenshot({path:path.join(qa,'05-手机试读-结尾.png')});
 await page.getByRole('button',{name:'保存并打开整话',exact:true}).click();
 await page.locator('#rule-dialog').waitFor({state:'hidden'});
 let state=await (await fetch(url+'/api/state')).json(),saved=state.projects[0];
 assert.equal(saved.pages.length,1);assert.equal(saved.shots.length,60);assert.equal(saved.pages[0].panels.length,60);
 assert.ok(saved.pages[0].bubbles.length>100);
 assert.deepEqual(saved.shots.map(s=>s.dialogue),source.map(s=>s['台词']));
 report=await page.evaluate(async p=>{const {validateStrip}=await import('/rule-engine.js');return validateStrip(p,document.createElement('canvas').getContext('2d'));},saved);
 assert.equal(report.ok,true,JSON.stringify(report.issues.filter(i=>i.severity==='error')));
 assert.equal(saved.pages[0].bubbles.every(b=>b.fontSize>=44),true);
 console.log('PASS 60-panel whole-strip planning',saved.pages[0].height,saved.pages[0].bubbles.length);
 const last=saved.pages[0].panels.at(-1).id;
 await page.locator('#canvas-scroll').evaluate(e=>e.scrollTop=e.scrollHeight);
 await page.locator('#stage [data-panel="'+last+'"]').first().waitFor({state:'visible',timeout:15000});
 const viewportBounds=await page.locator('#stage').boundingBox();
 assert.ok(viewportBounds.height<20000,'Finite SVG viewport must remain bounded');
 await page.screenshot({path:path.join(qa,'06-编辑器-长条结尾.png')});
 await page.reload();await page.locator('#rule-summary').waitFor({state:'visible'});
 state=await (await fetch(url+'/api/state')).json();assert.equal(state.projects.length,1);
 assert.equal(state.projects[0].pages[0].height,saved.pages[0].height);
 console.log('PASS reload and bounded editor');
 const c=native.createCanvas(20,20),cc=c.getContext('2d');cc.fillStyle='#365e78';cc.fillRect(0,0,20,20);
 const original=path.join(studio.store.root,'isolated-fill.png');fs.writeFileSync(original,c.toBuffer('image/png'));const uploaded=await (await fetch(url+'/api/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'隔离填图像素测试',filePath:original})})).json();
 await fetch(url+'/api/projects/'+saved.id+'/panels/'+saved.pages[0].panels[0].id+'/image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assetId:uploaded.id})});
 await page.reload();await page.locator('#rule-summary').waitFor({state:'visible'});
 await page.locator('#rule-reader').click();
 assert.equal(await page.locator('.rule-reader image[href^="/assets/'+uploaded.id+'"]').count(),1);
 const filledPhone=page.locator('.rule-reader .rule-phone-scroll');
 await filledPhone.evaluate(e=>e.scrollTop=e.scrollHeight);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const phoneBytes=await filledPhone.screenshot({path:path.join(qa,'07-填图试读-末段.png')});
 const phoneImage=await native.loadImage(phoneBytes),phoneCanvas=native.createCanvas(phoneImage.width,phoneImage.height),phoneContext=phoneCanvas.getContext('2d');
 phoneContext.drawImage(phoneImage,0,0);const phonePixels=phoneContext.getImageData(12,12,phoneImage.width-36,phoneImage.height-24).data;
 let phoneInk=0;for(let i=0;i<phonePixels.length;i+=4)if(Math.min(phonePixels[i],phonePixels[i+1],phonePixels[i+2])<235)phoneInk++;
 assert.ok(phoneInk>1000,'Filled reader must show the last panels, independently of the editor viewport clip');
 await page.getByRole('button',{name:'关闭',exact:true}).last().click();
 console.log('PASS actual-image fill and faithful mobile reader');

 await page.locator('#rule-check').click();await page.getByRole('heading',{name:'当前整话检查',exact:true}).waitFor();
 assert.ok((await page.locator('.rule-status').textContent()).includes('结构检查通过'));
 await page.getByRole('button',{name:'关闭',exact:true}).last().click();
 await page.locator('#rule-reflow').click();await page.getByRole('button',{name:'保存并打开整话',exact:true}).waitFor({state:'visible'});
 await page.locator('.rule-classification summary').click();
 await page.locator('[data-rule-field="sceneType"][data-shot-index="0"]').selectOption('establish');
 assert.equal(await page.getByRole('button',{name:'保存并打开整话',exact:true}).isEnabled(),false);
 await page.getByRole('button',{name:'重新试排',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'保存并打开整话',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'保存并打开整话',exact:true}).click();await page.locator('#rule-dialog').waitFor({state:'hidden'});
 state=await (await fetch(url+'/api/state')).json();assert.equal(state.projects.length,2);
 assert.equal(state.projects[0].pages[0].height,saved.pages[0].height);saved=state.projects[1];
 console.log('PASS editable classification and preserved original project');
 const promptDownloadEvent=page.waitForEvent('download');
 await page.locator('#rule-export-prompts').click();const promptDownload=await promptDownloadEvent;
 await promptDownload.saveAs(path.join(qa,'画格提示词_验证.json'));
 const promptData=JSON.parse(fs.readFileSync(path.join(qa,'画格提示词_验证.json'),'utf8'));
 assert.equal(promptData.panels.length,60);assert.ok(promptData.panels[1].prompt.includes('主体安全区'));
 console.log('PASS deterministic prompt contract export');

 const downloadEvent=page.waitForEvent('download',{timeout:180000});
 await page.locator('#rule-export-single').click();
 const downloaded=await downloadEvent;
 const output=path.join(qa,'整话规则试排验证_完整长条.png');await downloaded.saveAs(output);
 const bytes=fs.readFileSync(output);
 assert.equal(bytes.readUInt32BE(16),1280);assert.equal(bytes.readUInt32BE(20),saved.pages[0].height);
 assert.equal(downloaded.suggestedFilename().endsWith('.png'),true);
 console.log('PASS single-PNG full episode export',bytes.length);
 await page.locator('#rule-import').click();
 const templateEvent=page.waitForEvent('download');await page.locator('#rule-template').click();
 const template=await templateEvent;await template.saveAs(path.join(qa,'分镜表_空白模板.csv'));
 assert.equal(fs.readFileSync(path.join(qa,'分镜表_空白模板.csv'),'utf8').trim().split(/\r?\n/).length,1);
 await page.locator('#rule-text').fill('画面描述\t台词\t场面类型\t景别\t构图宽度\n城市全景\t\t建立\t全景\t满宽\n另一城市全景\t\t建立\t全景\t满宽');
 await page.getByRole('button',{name:'开始整话试排',exact:true}).click();
 await page.locator('#toast').filter({hasText:'严禁满格接满格'}).waitFor({state:'visible'});
 assert.equal((await (await fetch(url+'/api/state')).json()).projects.length,2);
 assert.deepEqual(calls,[]);
 assert.deepEqual(errors,[]);
 assert.equal(network.some(u=>/\/api\/(jimeng|codex|jobs)/.test(u)),false);
 console.log('PASS conflict reporting, blank template, zero AI requests');
 fs.writeFileSync(path.join(qa,'browser-report.json'),JSON.stringify({ok:true,url,sourceRows:60,report,
  output:{path:output,width:1280,height:saved.pages[0].height,bytes:bytes.length},
  pageErrors:errors,badResponses,externalGenerationCalls:calls,aiRequests:network.filter(u=>/\/api\/(jimeng|codex|jobs)/.test(u)),screenshots:7,phoneEndPixels:phoneInk},null,2));
 // The visual test project is an audit artifact, never part of the production data folder.
 const portable=await (await fetch(url+'/api/projects/'+saved.id+'/export')).json();
 fs.writeFileSync(path.join(qa,'整话试排_验证工程.comic.json'),JSON.stringify(portable,null,2));
 fs.writeFileSync(path.join(qa,'整话试排_验证分镜.json'),JSON.stringify(source,null,2));
}catch(e){
 await page.screenshot({path:path.join(qa,'browser-failure.png')}).catch(()=>{});
 fs.writeFileSync(path.join(qa,'browser-failure.json'),JSON.stringify({error:e.stack,pageErrors:errors,badResponses,network,calls},null,2));
 throw e;
}finally{
 await browser.close();studio.close();await new Promise(resolve=>studio.server.close(resolve));
 const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(temp));assert.ok(path.basename(target).startsWith('browser-rule-'));
 fs.rmSync(target,{recursive:true,force:true});
}
