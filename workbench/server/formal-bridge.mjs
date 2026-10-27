import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {check, id} from './project-center.mjs';
import {inspectImage} from '../../center/lib/images.mjs';

// Compatibility is a projection of the project ledger. It never starts a second generator.
export function createFormalBridge(core, formal) {
  const store = formal.store;
  const credentials = JSON.parse(fs.readFileSync(path.join(store.directory, '首次连接凭据.local.json')));
  const worker = store.auth(credentials.worker), client = store.auth(credentials.client);
  const links = () => core.list('formalLink');
  function projectFor(work) {
    let project = core.list('project').find(p => p.externalKey === work.externalKey);
    if (!project) { project = core.createProject({title:work.title}); project.externalKey = work.externalKey; core.put('project', project); }
    return project;
  }
  function connectTask(task, project) {
    let link = links().find(l => l.formalTaskId === task.id);
    if (link) return link;
    const refs = task.brief.references.map(v => {
      const version = store.version(v);
      return core.upload(project.id, {name:task.brief.name + '-reference-' + v + version.extension, mime:version.mime, type:'reference'}, fs.readFileSync(path.join(store.directory,'blobs',version.sha256+version.extension))).id;
    });
    const result = core.requestAsset(project.id, {role:task.brief.role === 'style' ? 'prop' : task.brief.role, name:task.brief.name, state:task.brief.state, prompt:task.brief.prompt, referenceFileIds:refs, requester:'漫画工作台', episode:task.brief.usages[0]?.episode, usages:task.brief.usages, clientRequestId:'comic:' + task.id, executor:project.defaultExecutor || 'local'});
    if(result.reused)result.task=core.get('task',result.version.taskId);
    check(result.task, '资产请求未创建');
    if(task.provider==='external'&&!result.reused){result.task.executor='manual';core.put('task',result.task);}
    if (task.status === 'needs_info'&&!result.reused) { result.task.status = 'needs_update'; result.task.message = '漫画端需要先确认角色形态或设计资料'; core.put('task',result.task); }
    link = core.put('formalLink', {id:id('link'), projectId:project.id, formalTaskId:task.id, coreTaskId:result.task.id});
    return link;
  }
  async function handle(r, bytes) {
    const pathname=r.url.pathname, method=r.method;
    if (method !== 'POST') return null;
    const input=JSON.parse(bytes.toString('utf8') || '{}');
    const actor=store.auth(String(r.headers.authorization||'').replace(/^Bearer /,''));
    if (pathname === '/api/v1/requirements/batches') {
      check(['admin','client'].includes(actor.role),'此操作需要工作台权限',403);
      const work=input.work?.id ? store.work(input.work.id) : input.work;
      if (input.work?.id) store.allow(actor,work.id);
      const p=projectFor(work); const standard=core.standards(p.id);
      for(const need of input.needs||[])for(const ref of need.references||[]){const prior=links().find(l=>l.formalVersionId===ref);if(prior){const origin=core.get('task',prior.coreTaskId),version=origin.versionId&&core.get('version',origin.versionId);check(version&&!version.stale,'固定参考已受甲方改动影响，请更新后重新提交',409);}}
      const receipt=store.submit(actor, {...input, idempotencyKey:'central-'+createHash('sha256').update(input.idempotencyKey+standard.id).digest('hex')});
      for(const entry of receipt.entries) if(entry.taskId) connectTask(store.task(entry.taskId),p);
      return {status:201,body:receipt};
    }
    if(pathname === '/api/v1/tasks/claim' && input.provider !== 'external') return {body:{task:null,managedBy:'project-center'}};
    const delivery=/^\/api\/v1\/tasks\/([^/]+)\/result$/.exec(pathname);
    if(delivery){const link=links().find(l=>l.formalTaskId===delivery[1]);if(link){const task=core.get('task',link.coreTaskId);if(task.executor==='manual'){
      check(['admin','worker'].includes(actor.role),'此操作需要接单器权限',403);store.lease(actor,delivery[1],input.leaseToken);const bytes=Buffer.from(input.imageBase64||'','base64'),info=await inspectImage(bytes);
      if(!task.versionId){task.status='running';core.put('task',task);}const version=core.candidate(task.id,bytes),destination=path.join(store.directory,'blobs',info.sha256+info.extension);if(!fs.existsSync(destination))fs.writeFileSync(destination,bytes,{flag:'wx'});const result=store.commitImage(actor,delivery[1],input,info);link.formalVersionId=result.id;link.leaseToken=input.leaseToken;core.put('formalLink',link);return {status:201,body:result};
    }}}
    const review=/^\/api\/v1\/versions\/([^/]+)\/review$/.exec(pathname);
    if(review) {
      const version=store.version(review[1]); store.allow(actor,version.workId);
      check(['admin','client'].includes(actor.role),'此操作需要工作台权限',403);
      const link=links().find(l=>l.formalVersionId===version.id);
      if(!link)return null;
      const task=core.get('task',link.coreTaskId), asset=core.get('asset',task.assetId);
      check(version.status==='review' && input.expectedApprovedVersionId===store.asset(version.assetId).approvedVersionId,'正式版本已变化，请刷新',409);
      if(input.action==='approve') core.approve(link.projectId, task.versionId,{expectedApprovedVersionId:asset.approvedVersionId});
      else {check(input.action==='reject','审核操作无效');const v=core.get('version',task.versionId); v.status='rejected';core.put('version',v);task.status='failed';task.message=input.reason||'人工退回';core.put('task',task);}
      return {body:store.review(actor,version.id,input)};
    }
    const control=/^\/api\/v1\/tasks\/([^/]+)\/control$/.exec(pathname);
    if(control){
      const task=store.task(control[1]);store.allow(actor,task.workId);
      const link=links().find(l=>l.formalTaskId===task.id);if(!link)return null;
      check(['admin','client'].includes(actor.role),'此操作需要工作台权限',403);
      const current=core.get('task',link.coreTaskId);
      if(input.action==='ready')check(task.status==='needs_info'&&input.confirmInfo===true,'请先确认需求中的角色形态与设计资料',409);
      if(input.action==='ready'||input.action==='retry')core.retry(link.projectId,current.id,input);
      else if(input.action==='regenerate') { check(current.status==='done','原任务尚未结束',409); current.status='failed';core.put('task',current);core.retry(link.projectId,current.id,input); }
      else if(input.action==='cancel'){check(['queued','needs_update','failed'].includes(current.status),'任务已经开始，不能作为未开始任务取消',409);current.status='cancelled';core.put('task',current);}
      let result;if(input.action==='cancel'){store.db.prepare("UPDATE tasks SET status='cancelled',message='已取消中心排队任务',owner=NULL,lease_digest=NULL,expires=NULL WHERE id=?").run(task.id);result=store.task(task.id);}else result=store.control(actor,task.id,input);link.leaseToken=null;link.formalVersionId=null;core.put('formalLink',link);return {body:result};
    }
    return null;
  }
  async function sync() {
    for(const link of links()) {
      const task=core.get('task',link.coreTaskId);let ft=store.task(link.formalTaskId);
      if(ft.status==='needs_info')continue;
      if(task.executor==='manual'&&!task.versionId)continue;
      if(!link.leaseToken && ['queued','claimed','running','review','uncertain'].includes(task.status) && ft.status==='pending') {
        const lease=store.claim(worker,{provider:ft.provider,taskId:ft.id}); if(!lease.task)continue;
        link.leaseToken=lease.leaseToken;core.put('formalLink',link);
      }
      if(link.leaseToken && ['leased','running','uncertain'].includes(ft.status)) {
        store.heartbeat(worker,ft.id,{leaseToken:link.leaseToken,running:true,message:task.message||'统一中心排队中'});
        if(task.versionId && !link.formalVersionId) {
          const v=core.get('version',task.versionId),file=core.get('file',v.fileId),bytes=fs.readFileSync(file.path),info=await inspectImage(bytes);
          const destination=path.join(store.directory,'blobs',info.sha256+info.extension);if(!fs.existsSync(destination))fs.writeFileSync(destination,bytes,{flag:'wx'});
          const result=store.commitImage(worker,ft.id,{leaseToken:link.leaseToken,idempotencyKey:'central:'+v.id},info);
          link.formalVersionId=result.id;core.put('formalLink',link);ft=store.task(ft.id);
        }else if(['failed','uncertain','needs_update','cancelled'].includes(task.status))store.db.prepare('UPDATE tasks SET status=?,message=?,updated=? WHERE id=?').run(task.status==='needs_update'?'uncertain':task.status,task.message||'来源版本有变化',new Date().toISOString(),ft.id);
      }
      if(link.formalVersionId && task.versionId){
        const v=core.get('version',task.versionId),fv=store.version(link.formalVersionId);
        if(v.stale){store.db.prepare('UPDATE assets SET approved_id=NULL WHERE id=? AND approved_id=?').run(fv.assetId,fv.id);continue;}
        if(v.status==='rejected'&&fv.status==='review')store.review(client,fv.id,{action:'reject',reason:v.reason||'中心退回',expectedApprovedVersionId:store.asset(fv.assetId).approvedVersionId});
        if(v.status==='approved' && !v.stale && fv.status==='review')store.review(client,fv.id,{action:'approve',expectedApprovedVersionId:store.asset(fv.assetId).approvedVersionId});
      }
    }
  }
  return {handle,sync,projectFor};
}
