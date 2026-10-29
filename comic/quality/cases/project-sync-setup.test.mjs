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
  const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/project-sync.css"><dialog id="modal"></dialog><p id="error"></p><script type="module">
    import {mountProjectSyncSetup} from '/project-sync-setup.js';import {assignMissingEpisodes} from '/project-episode-classification.js';
    const project={id:'project_test',pages:[{id:'page_test',name:'画板',panels:[]}],shots:[]};window.calls=[];window.mode='hold';window.closes=0;
    const api=async(route,method,body)=>{window.calls.push({route,method,body});if(route==='/api/library/projects')return {items:[{id:'${remoteId}',name:'隔离项目'}]};if(route==='/api/project-sync/push'){if(window.mode==='hold')return new Promise(resolve=>{window.releaseUpload=()=>resolve({status:'synced'})});if(window.mode==='error')throw Error('网络中断（合成）');return {status:window.mode};}if(route.startsWith('/api/project-sync/subjects'))return {items:[]};return {};};
    const modal=(title,markup,actions)=>{const host=document.querySelector('#modal');host.innerHTML='<h1>'+title+'</h1>'+markup;for(const action of actions){const button=document.createElement('button');button.textContent=action.label;button.onclick=async()=>{try{await action.run()}catch(error){document.querySelector('#error').textContent=error.message}};host.append(button)}if(!host.open)host.showModal()};
    const ui=mountProjectSyncSetup({api,getProject:()=>project,flushSave:async()=>{},modal,closeModal:()=>{window.closes++;document.querySelector('#modal').close()},toast:message=>{window.message=message},assignEpisodes:async entries=>assignMissingEpisodes(project,entries)});window.ui=ui;await ui.open();window.ready=true;
  </script>`;
  const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://fixture');if(url.pathname==='/')return res.end(html);const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const {chromium}=createRequire(import.meta.url)(process.env.COMIC_TEST_PLAYWRIGHT_MODULE);browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
  await page.getByRole('button',{name:'保存并上传'}).click();assert.match(await page.locator('[data-sync-message]').innerText(),/请选择墨库项目/);
  await page.locator('[data-sync-project]').selectOption(remoteId);
  assert.equal(await page.locator('[data-sync-subjects],[data-sync-subject]').count(),0,'工程归属只选项目和话，不再加载可选角色场景列表');
  await page.locator('[data-sync-episode]').fill('0');await page.getByRole('button',{name:'保存并上传'}).click();assert.match(await page.locator('[data-sync-message]').innerText(),/阿拉伯数字/);
  await page.locator('[data-sync-episode]').fill('7');await page.getByRole('button',{name:'重试上传'}).click();
  await page.waitForFunction(()=>window.releaseUpload);
  assert.equal(await page.locator('[data-sync-status]').getAttribute('data-sync-state'),'busy');
  assert.equal(await page.locator('[data-sync-progress]').isVisible(),true);
  assert.match(await page.locator('[data-sync-message]').innerText(),/3 \/ 3/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#modal').evaluate(node=>node.open),true,'上传时 Escape 不关闭窗口');
  assert.equal(await page.locator('[data-sync-project]').isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'上传处理中…'}).isDisabled(),true);
  await page.getByRole('button',{name:'上传处理中…'}).evaluate(button=>button.click());
  if(process.env.COMIC_SYNC_EVIDENCE_DIR){fs.mkdirSync(process.env.COMIC_SYNC_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.COMIC_SYNC_EVIDENCE_DIR,'upload-progress.png')});}
  await page.evaluate(()=>window.releaseUpload());await page.waitForFunction(()=>window.message==='工程已上传墨库');
  assert.equal(await page.locator('[data-sync-status]').getAttribute('data-sync-state'),'success');
  assert.equal(await page.locator('[data-sync-progress]').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.closes),0,'成功结果保留，不自动关闭');
  if(process.env.COMIC_SYNC_EVIDENCE_DIR)await page.screenshot({path:path.join(process.env.COMIC_SYNC_EVIDENCE_DIR,'upload-success.png')});
  assert.equal(await page.getByRole('button',{name:'已上传',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'完成',exact:true}).click();assert.equal(await page.evaluate(()=>window.closes),1);
  const calls=await page.evaluate(()=>window.calls),link=calls.find(item=>item.route==='/api/project-sync/link');assert.equal(link.body.remoteProjectId,remoteId);assert.deepEqual(link.body.classification,{characterIds:[],sceneIds:[]});assert.equal(calls.filter(item=>item.route==='/api/project-sync/push').length,1);assert.equal(calls.filter(item=>item.route.startsWith('/api/project-sync/subjects')).length,0);
  for(const mode of ['error','generating','formal-only','unexpected']){
    await page.evaluate(async mode=>{window.mode=mode;window.message='';await window.ui.open()},mode);
    await page.locator('[data-sync-project]').selectOption(remoteId);
    await page.getByRole('button',{name:'保存并上传'}).click();
    const expected=['error','unexpected'].includes(mode)?'error':'pending';
    await page.waitForFunction(expected=>document.querySelector('[data-sync-status]').dataset.syncState===expected,expected);
    assert.equal(await page.locator('[data-sync-project]').isDisabled(),false);
    assert.notEqual(await page.evaluate(()=>window.message),'工程已上传墨库','未上传不能误报成功');
    if(mode==='error'){
      assert.match(await page.locator('[data-sync-message]').innerText(),/网络中断/);
      if(process.env.COMIC_SYNC_EVIDENCE_DIR)await page.screenshot({path:path.join(process.env.COMIC_SYNC_EVIDENCE_DIR,'upload-error.png')});
      await page.evaluate(()=>window.mode='unchanged');await page.getByRole('button',{name:'重试上传'}).click();
      await page.waitForFunction(()=>document.querySelector('[data-sync-status]').dataset.syncState==='success');
      assert.match(await page.locator('[data-sync-message]').innerText(),/最新工程快照/);
    }else if(mode==='generating')assert.match(await page.locator('[data-sync-message]').innerText(),/上传暂缓/);
    else if(mode==='formal-only')assert.match(await page.locator('[data-sync-message]').innerText(),/尚未上传正式版本/);
    else assert.match(await page.locator('[data-sync-message]').innerText(),/尚未收到墨库上传成功确认/);
  }
});
