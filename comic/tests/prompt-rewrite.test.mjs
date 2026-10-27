import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPromptRewriteAPI,promptRewriteInstructions} from '../lib/prompt-rewrite-api.mjs';
import {createProject} from '../public/model.js';
import {ensurePanelGeneration} from '../public/panel-generation.js';
import {generationPromptSelection} from '../public/prompt-source.js';

function fixture(t){
 const dataDir=fs.mkdtempSync(path.resolve(process.env.COMIC_TEST_OUTPUT_DIR||'.','prompt-rewrite-')),p=createProject('隔离文字任务'),panel=p.pages[0].panels[0];p.revision=3;ensurePanelGeneration(p,panel);panel.generation.promptOverrides={imported:'原提示词：两个人物，图1对应主角，无气泡。'};
 let requests=[],calls=0;
 const bridge={rewritePrompt(directory,input,{signal}){calls++;return new Promise((resolve,reject)=>{requests.push({directory,input,resolve,reject,signal});signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});}};
 const config={dataDir,store:{project:id=>{assert.equal(id,p.id);return p;}},bridge,body:async req=>req.input,json:(res,status,value)=>Object.assign(res,{status,...value})},api=createPromptRewriteAPI(config);
 t.after(()=>api.close());
 const call=async(method='POST',input={},suffix='')=>{const res={},url=new URL('http://localhost/api/projects/'+p.id+'/prompt-rewrite'+suffix);await api.handle({input},res,{method,pathname:url.pathname,url});return res;};
 const submit=extra=>call('POST',{requestId:randomUUID(),expectedRevision:p.revision,panelId:panel.id,source:'imported',notes:'把镜头拉近，其余保留。',...extra});
 return {dataDir,p,panel,requests,call,submit,config,api,calls:()=>calls};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('修改任务只写独立记录，重复提交不重复调用，原词和工程保持原样',async t=>{
 const f=fixture(t),before=JSON.stringify(f.p),id=randomUUID(),a=await f.submit({requestId:id}),b=await f.submit({requestId:id});assert.equal(a.status,202);assert.equal(b.job.id,id);assert.equal(f.calls(),1);
 assert.equal(f.requests[0].input.basePrompt,generationPromptSelection(f.panel,f.p).text);assert.match(fs.readFileSync(f.requests[0].directory+'/request.txt','utf8'),/不生成图片/);
 f.requests[0].resolve({prompt:'修改后的完整提示词'});await tick();const done=await f.call('GET',{},'/'+id);assert.equal(done.job.status,'completed');assert.equal(done.job.result,'修改后的完整提示词');assert.equal(JSON.stringify(f.p),before);assert.equal(f.api.running(),0);
 await assert.rejects(f.submit({requestId:id,notes:'不同请求'}),/编号已被使用/);
});
test('拒绝旧版本、错误模式、锁定画格及空意见，失败结果不改原词',async t=>{
 const f=fixture(t),before=JSON.stringify(f.p);
 await assert.rejects(f.submit({expectedRevision:0}),/工程已改变/);await assert.rejects(f.submit({source:'direct'}),/模式已改变/);await assert.rejects(f.submit({notes:' '}),/修改意见/);
 f.panel.locked=true;await assert.rejects(f.submit(),/解锁/);f.panel.locked=false;assert.equal(f.calls(),0);
 const a=await f.submit();f.requests[0].resolve({prompt:''});await tick();assert.equal((await f.call('GET',{},'/'+a.job.id)).job.status,'failed');assert.equal(JSON.stringify(f.p),before);
});
test('取消会中止通道，迟到结果不能恢复已取消任务',async t=>{
 const f=fixture(t),a=await f.submit();await f.call('POST',{},'/'+a.job.id+'/cancel');assert.equal(f.requests[0].signal.aborted,true);f.requests[0].resolve({prompt:'迟到结果'});await tick();assert.equal((await f.call('GET',{},'/'+a.job.id)).job.status,'cancelled');
});
test('服务重启把未完成任务标为失败，不自动重发；损坏记录不会拖垮工具',async t=>{
 const f=fixture(t),a=await f.submit(),reloaded=createPromptRewriteAPI(f.config),res={},url=new URL('http://localhost/api/projects/'+f.p.id+'/prompt-rewrite/'+a.job.id);await reloaded.handle({},res,{method:'GET',pathname:url.pathname,url});assert.equal(res.job.status,'failed');assert.equal(f.calls(),1);
 f.api.close();await tick();fs.writeFileSync(path.join(f.dataDir,'prompt-rewrites/jobs.json'),'{bad');
 const clean=createPromptRewriteAPI(f.config);assert.equal(clean.running(),0);assert.ok(fs.readdirSync(path.join(f.dataDir,'prompt-rewrites')).some(n=>n.includes('.invalid-')));
});
test('修改意见作为创作数据，要求保留未涉及的图号、原文和模式约束',()=>{
 const s=promptRewriteInstructions({basePrompt:'图1是主角。',notes:'侧身',source:'post-lettering',frame:{}});assert.match(s,/不调用工具/);assert.match(s,/不把意见简单附加/);assert.match(s,/空泡\/无泡/);assert.match(s,/图1是主角/);
});
