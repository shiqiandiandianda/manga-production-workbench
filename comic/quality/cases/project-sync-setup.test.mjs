import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createProjectSync} from '../../lib/project-sync.mjs';

test('同步链接允许空角色场景，但拒绝跨项目对象',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sync-link-')),projectId='project_'+randomUUID(),remoteId=randomUUID(),foreign=randomUUID(),project={id:projectId,title:'合成工程'};
  const store={db:{assets:[],jobs:[]},project(id){assert.equal(id,projectId);return project;}},library={baseUrl:'http://fixture',async read(route){if(route==='/api/projects')return {items:[{id:remoteId,name:'项目'}]};if(route.endsWith('/subjects'))return {items:[]};throw Error('unexpected '+route);}};
  const sync=createProjectSync({dataDir:dir,store,library,projectView:p=>p,body:async req=>req.body,json:(res,status,value)=>Object.assign(res,{status,value}),enabled:true});t.after(()=>sync.close());
  async function link(classification){const response={};await sync.handle({body:{projectId,remoteProjectId:remoteId,classification}},response,{pathname:'/api/project-sync/link',method:'POST',url:new URL('http://fixture/api/project-sync/link')});return response;}
  const saved=await link({characterIds:[],sceneIds:[]});assert.equal(saved.status,200);assert.equal(saved.value.target.projectId,remoteId);
  const before=fs.readFileSync(path.join(dir,'project-sync.local.json'),'utf8');
  await assert.rejects(link({characterIds:[foreign],sceneIds:[]}),/不属于该墨库项目/);
  assert.equal(fs.readFileSync(path.join(dir,'project-sync.local.json'),'utf8'),before);
});

test('页面先选项目和数字话号，无角色场景也能提交',{timeout:45000},async t=>{
  const remoteId=randomUUID(),root=path.resolve(import.meta.dirname,'../../public');
  const html=`<!doctype html><meta charset="utf-8"><div id="modal"></div><p id="error"></p><script type="module">
    import {mountProjectSyncSetup} from '/project-sync-setup.js';import {assignMissingEpisodes} from '/project-episode-classification.js';
    const project={id:'project_test',pages:[{id:'page_test',name:'画板',panels:[]}],shots:[]};window.calls=[];
    const api=async(route,method,body)=>{window.calls.push({route,method,body});if(route==='/api/library/projects')return {items:[{id:'${remoteId}',name:'隔离项目'}]};if(route.startsWith('/api/project-sync/subjects'))return {items:[]};return {};};
    const modal=(title,markup,actions)=>{const host=document.querySelector('#modal');host.innerHTML='<h1>'+title+'</h1>'+markup;for(const action of actions){const button=document.createElement('button');button.textContent=action.label;button.onclick=async()=>{try{await action.run()}catch(error){document.querySelector('#error').textContent=error.message}};host.append(button)}};
    const ui=mountProjectSyncSetup({api,getProject:()=>project,flushSave:async()=>{},modal,closeModal:()=>{},toast:message=>{window.message=message},assignEpisodes:async entries=>assignMissingEpisodes(project,entries)});await ui.open();window.ready=true;
  </script>`;
  const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://fixture');if(url.pathname==='/')return res.end(html);const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(file));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const {chromium}=createRequire(import.meta.url)(process.env.COMIC_TEST_PLAYWRIGHT_MODULE);browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
  await page.getByRole('button',{name:'保存并上传'}).click();assert.match(await page.locator('#error').innerText(),/请选择墨库项目/);
  await page.locator('[data-sync-project]').selectOption(remoteId);
  assert.equal(await page.locator('[data-sync-subjects],[data-sync-subject]').count(),0,'工程归属只选项目和话，不再加载可选角色场景列表');
  await page.locator('[data-sync-episode]').fill('0');await page.getByRole('button',{name:'保存并上传'}).click();assert.match(await page.locator('#error').innerText(),/阿拉伯数字/);
  await page.locator('[data-sync-episode]').fill('7');await page.getByRole('button',{name:'保存并上传'}).click();await page.waitForFunction(()=>window.message==='工程已上传墨库');
  const calls=await page.evaluate(()=>window.calls),link=calls.find(item=>item.route==='/api/project-sync/link');assert.equal(link.body.remoteProjectId,remoteId);assert.deepEqual(link.body.classification,{characterIds:[],sceneIds:[]});assert.equal(calls.filter(item=>item.route==='/api/project-sync/push').length,1);assert.equal(calls.filter(item=>item.route.startsWith('/api/project-sync/subjects')).length,0);
});
