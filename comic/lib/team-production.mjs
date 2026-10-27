import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {check} from './store.mjs';
import {writeFileAtomicSync} from './durable-files.mjs';
import {publicationConnection} from '../../distribution/publication-client.mjs';
import {pageEpisode} from '../public/episode-boards.js';
import {volunteerCapacity,volunteerPending} from '../../协作/lib/volunteer.mjs';

const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const localActive=new Set(['queued','running','awaiting_confirmation','recoverable','delegated']);
const fingerprint=p=>createHash('sha256').update([p.panelContentKey??'',p.geometryKey??'',p.referenceKey??'',p.revision??''].join('\n')).digest('hex').slice(0,16);
const text=(v,n=240)=>String(v??'').slice(0,n);
const sameMachine=(name,machine)=>name===machine||name===machine+' 漫画节点';

export function createTeamProduction({root,dataDir,store,collabClient,body,json,fetcher=fetch,nodeConfigFile=null}){
  const codeRoot=path.resolve(root,'..'),nodeFile=nodeConfigFile||path.join(codeRoot,'runtime-data/team/canvas-node.local.json');
  const journalFile=path.join(dataDir,'team-production/requests.local.json');
  let journal=read(journalFile)||{version:1,items:[]},pendingSnapshot=null,cached=null,cachedAt=0;
  const submissions=new Map();
  function save(){fs.mkdirSync(path.dirname(journalFile),{recursive:true});writeFileAtomicSync(journalFile,JSON.stringify(journal,null,2));}
  function person(){return read(path.join(dataDir,'teamwork/local.json'))?.profile?.name||(()=>{const a=read(path.join(dataDir,'library-account.local.json'));return a?.displayName||a?.name||a?.username;})()||os.hostname();}
  function reservations(projectId,panelIds){return journal.items.filter(r=>r.projectId===projectId&&panelIds.includes(r.panelId)&&!r.endedAt);}
  function assertAvailable(projectId,panelIds){check(!reservations(projectId,panelIds).length,'所选画格已请求同事帮忙，请先在项目生产中心查看或取消原请求',409);}
  async function teamData(){
    try{const c=publicationConnection(codeRoot),r=await fetcher(c.channel.masterUrl+'/api/team/generation-board',{headers:c.headers,signal:AbortSignal.timeout(3500)});check(r.ok,'团队任务暂不可达',503);return await r.json();}
    catch{return {items:[],members:[],unavailable:true};}
  }
  function reconcile(tasks){
    let changed=false;
    for(const r of journal.items){
      const t=tasks.find(t=>t.id===r.taskId||t.submittedBy===collabClient.config.clientId&&t.idempotencyKey===r.idempotencyKey);
      if(!t)continue;
      if(r.taskId!==t.id){r.taskId=t.id;changed=true;}
      if(r.status!==t.status){r.status=t.status;changed=true;}
      if(['done','failed','cancelled'].includes(t.status)){if(!r.endedAt){r.endedAt=t.updatedAt||new Date().toISOString();changed=true;}}else if(r.endedAt){delete r.endedAt;changed=true;}
    }
    if(changed)save();
  }
  async function collect(){
    const [overviewResult,teamResult,statusResult]=await Promise.allSettled([collabClient.overview(),teamData(),collabClient.status()]);
    const overview=overviewResult.status==='fulfilled'?overviewResult.value:{tasks:[],nodes:[]};
    const team=teamResult.status==='fulfilled'?teamResult.value:{items:[],members:[],unavailable:true};
    const connection=statusResult.status==='fulfilled'?statusResult.value:{configured:false,hubReachable:false};
    if(overviewResult.status==='fulfilled')reconcile(overview.tasks||[]);
    const nodeConfig=read(nodeFile),members=team.members||[];
    const nodes=(overview.nodes||[]).filter(n=>!n.revoked).map(n=>{
      const member=members.find(m=>sameMachine(n.name,m.machine));
      const online=n.status?.online===true&&Date.now()-Date.parse(n.status.lastSeenAt||0)<30000;
      const enabled=n.settings?.enabled!==false&&!n.settings?.paused;
      return {id:n.id,name:member?.name||n.name,machine:member?.machine||n.name,online,enabled,
        freeSlots:online&&enabled?Number(n.status?.freeSlots)||0:0,concurrency:Number(n.settings?.maxConcurrency)||1,
        running:n.status?.runningTaskIds?.length||0,message:text(n.status?.message),mine:n.id===nodeConfig?.nodeId,
        ready:online&&enabled&&n.status?.local?.available!==false&&Number(n.status?.local?.concurrency)>0};
    });
    const nodeNames=new Map(nodes.map(n=>[n.id,n.name]));
    const selfNode=(overview.nodes||[]).find(n=>n.id===nodeConfig?.nodeId);
    const manualHelp=volunteerCapacity(selfNode,overview.tasks||[],{timeout:15000});
    const tasks=(overview.tasks||[]).map(t=>({id:t.id,kind:'collaboration',projectId:t.projectId,work:t.projectName||'未填写作品',name:t.panelCode||t.shotCode||'画格生成',episode:t.episode,
      status:t.status,phase:t.phase,owner:t.requesterName||(t.submittedBy===collabClient.config.clientId?person():'发起人未上报'),mine:t.submittedBy===collabClient.config.clientId,
      helper:nodeNames.get(t.assignedNodeId||(volunteerPending(t)?t.volunteer.nodeId:null))||'',preferredNodeId:t.preferredNodeId||'',preferredName:nodeNames.get(t.preferredNodeId)||'',
      message:text(t.message||t.events?.at(-1)?.message||(t.status==='queued'?'等待空闲同事接单':'')),
      apply:{status:t.apply?.status||'pending',detail:text(t.apply?.detail)},createdAt:t.submittedAt,updatedAt:t.updatedAt,
      hasResult:!!t.result?.sha256,resultUrl:t.result?.sha256?'/api/collab/tasks/'+encodeURIComponent(t.id)+'/result':null,
      panelId:t.panelId,attempt:t.activeAttempt||0,
      volunteerNodeId:volunteerPending(t)?t.volunteer.nodeId:'',
      canVolunteer:!!selfNode&&t.status==='queued'&&t.submittedBy!==collabClient.config.clientId&&!volunteerPending(t)&&(!t.preferredNodeId||t.preferredNodeId===selfNode.id)&&(!selfNode.capabilities?.allowedProjectIds?.length||selfNode.capabilities.allowedProjectIds.includes(t.projectId))&&(!selfNode.capabilities?.allowedTaskTypes?.length||selfNode.capabilities.allowedTaskTypes.includes(t.type))}));
    for(const a of team.items||[])tasks.push({id:'asset:'+a.id,kind:'asset',work:a.asset?.work?.title||'未填写作品',name:[a.asset?.name,a.asset?.state].filter(Boolean).join(' · '),
      status:a.status==='completed'?'done':a.status,owner:a.ownerName,helper:a.ownerName,mine:false,message:a.message,createdAt:a.createdAt,updatedAt:a.seenAt,hasResult:false});
    const projects=store.db.projects.filter(p=>!p.deletedAt).map(p=>({id:p.id,title:p.title,revision:p.revision,
      pages:(p.pages||[]).filter(page=>!page.fixedKind).map(page=>({id:page.id,name:page.name,episode:pageEpisode(p,page),
        panels:(page.panels||[]).filter(f=>!f.breakoutForeground&&f.coordinateSource?.generation!=='不生成').map(f=>({id:f.id,name:f.name||p.shots?.find(s=>s.id===f.shotId)?.code||f.id,
          hasImage:!!f.imageAssetId,locked:!!f.locked,busy:store.db.jobs.some(j=>j.projectId===p.id&&j.panelId===f.id&&localActive.has(j.status))||reservations(p.id,[f.id]).length>0}))}))}));
    return {updatedAt:Date.now(),self:{name:person(),nodeId:nodeConfig?.nodeId||'',clientId:collabClient.config.clientId||'',manualHelp},connection:{configured:connection.configured,reachable:connection.hubReachable&&overviewResult.status==='fulfilled',
      message:overviewResult.status==='rejected'?text(overviewResult.reason.message):connection.lastError||'',teamReachable:!team.unavailable},nodes,tasks,projects,
      pendingRequests:journal.items.filter(r=>!r.endedAt&&!r.taskId).map(({id,projectId,panelId,status})=>({id,projectId,panelId,status})),
      members:members.filter(m=>m.id!=='publisher').map(m=>({name:m.name,machine:m.machine,connection:m.connection,
        connected:nodes.some(n=>sameMachine(n.machine,m.machine)||sameMachine(n.name,m.machine))})),materialsUrl:'/api/library/open'};
  }
  async function snapshot(force=false){
    if(!force&&cached&&Date.now()-cachedAt<2500)return structuredClone(cached);
    if(!pendingSnapshot)pendingSnapshot=collect().then(v=>(cached=v,cachedAt=Date.now(),v)).finally(()=>pendingSnapshot=null);
    return structuredClone(await pendingSnapshot);
  }
  async function dispatch(input){
    const project=store.project(input.projectId);
    check(Number.isInteger(input.expectedRevision)&&input.expectedRevision===project.revision,'工程已有更新，请先保存画布并刷新画格列表',409);
    const prepared=collabClient.prepare(input),ids=prepared.panels.map(p=>p.panelId),key=project.id+':'+[...ids].sort().join(',');
    if(submissions.has(key))return submissions.get(key);
    check(!store.db.jobs.some(j=>j.projectId===project.id&&ids.includes(j.panelId)&&localActive.has(j.status)),'画格已有本机任务，请先完成或取消原任务',409);
    const node=input.preferredNodeId||null;
    if(node){const view=await snapshot(true);check(view.nodes.some(n=>n.id===node),'指定同事的接单设备不存在',404);}
    const operation=(async()=>{
      const entries=prepared.panels.map(p=>({panelId:p.panelId,idempotencyKey:project.id+':'+p.panelId+':'+fingerprint(p.target.expected||{})}));
      for(const e of entries)check(reservations(project.id,[e.panelId]).every(r=>r.idempotencyKey===e.idempotencyKey),'画格已有其他协作请求，先核对或取消原请求',409);
      for(const e of entries)if(!reservations(project.id,[e.panelId]).length)journal.items.push({id:randomUUID(),projectId:project.id,...e,status:'submitting',createdAt:new Date().toISOString()});
      save();
      try{const result=await collabClient.distribute({...input,requesterName:person(),preferredNodeId:node});
        for(const t of result.tasks){const r=reservations(project.id,[t.panelId])[0];if(r){r.taskId=t.taskId;r.status='queued';}}for(const r of reservations(project.id,ids))if(!r.taskId)r.status='uncertain';save();cached=null;return {...result,message:result.errors.length?'部分请求需要核对，请查看原请求状态':'已交给同事协作队列，结果会回到原画格'};
      }catch(e){for(const r of reservations(project.id,ids))if(!r.taskId)r.status='uncertain';save();throw e;}
    })();submissions.set(key,operation);try{return await operation;}finally{submissions.delete(key);}
  }
  async function nodeSettings(input){
    const conf=read(nodeFile);check(conf?.nodeId&&conf?.token,'本机尚未接入帮忙生图，请在团队接入中修复连接',409);
    const patch={};if(input.enabled!==undefined){check(typeof input.enabled==='boolean','接单开关无效');patch.paused=!input.enabled;patch.enabled=true;}
    if(input.concurrency!==undefined){check(Number.isInteger(input.concurrency)&&input.concurrency>=1&&input.concurrency<=4,'帮忙并发为 1 至 4');patch.maxConcurrency=input.concurrency;}
    const r=await fetcher(conf.hubUrl+'/api/node/settings',{method:'POST',headers:{'Content-Type':'application/json','x-collab-token':conf.token},body:JSON.stringify(patch),signal:AbortSignal.timeout(10000)}),v=await r.json();check(r.ok,v.error||'接单设置保存失败',r.status);cached=null;return {ok:true,message:'接单设置已保存，已领取任务继续回传'};
  }
  async function volunteer(input){
    check(typeof input.taskId==='string'&&input.taskId.length>0&&input.taskId.length<=160,'请选择待接单任务');
    const conf=read(nodeFile);check(conf?.nodeId&&conf?.token,'本机尚未接入帮忙生图，请升级并启动工具',409);
    const r=await fetcher(conf.hubUrl+'/api/node/volunteer',{method:'POST',headers:{'Content-Type':'application/json','x-collab-token':conf.token},body:JSON.stringify({taskId:input.taskId}),signal:AbortSignal.timeout(10000)}),value=await r.json();
    check(r.ok,value.error||'领取失败，请刷新任务状态',r.status);cached=null;
    return {ok:true,taskId:value.taskId,status:value.status,reused:value.reused,message:'已主动领取，接单器确认后在本机生成，结果自动回传原工程。'};
  }
  const timer=setInterval(()=>{if(journal.items.length)void snapshot(true).catch(()=>{});},5000);timer.unref?.();
  return {snapshot,dispatch,assertAvailable,async refreshReservations(projectId){if(journal.items.some(r=>r.projectId===projectId)){const v=await collabClient.overview();reconcile(v.tasks||[]);cached=null;}},close(){clearInterval(timer);},async handle(req,res,url){
    if(!url.pathname.startsWith('/api/production-center/'))return false;
    try{if(req.method==='GET'&&url.pathname==='/api/production-center/status'){json(res,200,await snapshot());return true;}
      if(req.method==='POST'&&url.pathname==='/api/production-center/dispatch'){json(res,202,await dispatch(await body(req,16384)));return true;}
      if(req.method==='POST'&&url.pathname==='/api/production-center/node-settings'){json(res,200,await nodeSettings(await body(req,4096)));return true;}
      if(req.method==='POST'&&url.pathname==='/api/production-center/volunteer'){json(res,202,await volunteer(await body(req,4096)));return true;}
      json(res,404,{error:'生产中心操作不存在'});return true;
    }catch(e){json(res,e.status||500,{error:text(e.message,800)});return true;}
  }};
}
