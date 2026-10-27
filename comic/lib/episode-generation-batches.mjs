import {randomUUID} from 'node:crypto';

const ACTIVE=new Set(['ready','submitting','running','waiting']);
const TERMINAL=new Set(['done','failed','cancelled']);

// Plans and their committed jobs share the same Store transaction. A restart can
// recover an interrupted local enqueue without ever repeating a remote request.
export function createEpisodeGenerationBatches({db,save,submit,select,capacity,isExecuting=()=>false,clock=Date.now,random=Math.random,redact=String}){
 db.episodeGenerationBatches??=[];
 let ticking=false,closed=false,timer=null;
 const plans=()=>db.episodeGenerationBatches;
 const active=()=>plans().filter(p=>ACTIVE.has(p.state));
 const touch=p=>{p.updatedAt=clock();save();};
 const waveJobs=p=>db.jobs.filter(j=>j.episodeBatchId===p.id&&j.episodeBatchWave===p.wave);
 function snapshot(){return plans().map(p=>{
  const current=waveJobs(p),settled=p.waveSettled?[]:current.filter(j=>TERMINAL.has(j.status)&&!isExecuting(j.id));
  return {id:p.id,projectId:p.projectId,episode:p.episode,provider:p.request.provider,state:p.state,active:ACTIVE.has(p.state),total:p.panelIds.length,submitted:p.submitted,finished:p.finished+settled.length,failed:p.failed+settled.filter(j=>j.status==='failed').length,skipped:p.skipped.length,wave:p.wave,batchSize:p.batchSize,nextAt:p.nextAt,message:p.message||'',createdAt:p.createdAt,updatedAt:p.updatedAt,pendingPanelIds:ACTIVE.has(p.state)?p.panelIds.slice(p.cursor):[]};
 });}
 function stop(id){const p=plans().find(p=>p.id===id);if(p&&ACTIVE.has(p.state)){p.state='stopped';p.nextAt=null;p.message='已停止后续提交；已提交的任务继续执行';touch(p);}return p;}
 function stopProject(projectId){for(const p of active())if(p.projectId===projectId)stop(p.id);}
 function start({projectId,episode,pageId,panelIds,request}){
  const existing=active().find(p=>p.projectId===projectId&&p.episode===episode);if(existing)return existing;
  const p={id:'episode_batch_'+randomUUID(),projectId,episode,pageId,panelIds,request,cursor:0,submitted:0,finished:0,failed:0,skipped:[],wave:0,batchSize:capacity(request.provider),nextAt:null,state:'ready',createdAt:clock(),updatedAt:clock()};
  db.episodeGenerationBatches=plans().filter(old=>ACTIVE.has(old.state)||old.projectId!==projectId||old.episode!==episode);plans().push(p);touch(p);return p;
 }
 async function advance(p){
  if(p.state==='submitting'){
   // Only jobs saved before pump() can reach the provider.
   if(waveJobs(p).length)p.state='running';
   else{p.cursor=p.waveStart;p.wave--;p.state='ready';}
   touch(p);
  }
  if(p.state==='running'){
   const current=waveJobs(p);
   if(!current.length)throw Error('本批任务记录缺失，请核对原任务后重新发起');
   if(current.some(j=>!TERMINAL.has(j.status)||isExecuting(j.id)))return;
   p.finished+=current.length;p.failed+=current.filter(j=>j.status==='failed').length;
   // Retire this wave from counters, without removing any task records.
   p.lastWave=p.wave;p.waveSettled=true;
   if(p.cursor>=p.panelIds.length){p.state='done';p.nextAt=null;touch(p);return;}
   p.nextAt=clock()+60000+Math.floor(Math.max(0,Math.min(1,random()))*120000);
   p.state='waiting';touch(p);return;
  }
  if(p.state==='waiting'&&clock()<p.nextAt)return;
  if(!ACTIVE.has(p.state)||closed)return;
  const batchSize=Math.max(1,Math.floor(capacity(p.request.provider))),ids=[];let end=p.cursor;
  while(end<p.panelIds.length&&ids.length<batchSize){const id=p.panelIds[end++],reason=select(p,id);if(reason){if(!p.skipped.some(item=>item.panelId===id))p.skipped.push({panelId:id,reason});}else ids.push(id);}
  if(!ids.length){p.cursor=end;p.state='done';p.nextAt=null;touch(p);return;}
  p.waveStart=p.cursor;p.cursor=end;p.wave++;p.waveSettled=false;p.batchSize=batchSize;p.state='submitting';p.nextAt=null;touch(p);
  const beforeCommit=()=>{if(closed||p.state!=='submitting')throw Error('本话自动提交已停止');for(const id of ids){const reason=select(p,id);if(reason)throw Error(reason);}};
  try{await submit({...p.request,projectId:p.projectId,panelIds:ids,action:'generate'},{beforeCommit,onCommitted:jobs=>{for(const j of jobs){j.episodeBatchId=p.id;j.episodeBatchWave=p.wave;}p.submitted+=jobs.length;p.state='running';p.updatedAt=clock();}});}
  catch(error){if(p.state==='stopped'||closed)return;p.cursor=p.waveStart;p.wave--;p.waveSettled=true;throw error;}
 }
 async function tick(){if(ticking||closed)return;ticking=true;try{for(const p of active()){try{await advance(p);}catch(error){p.state='failed';p.nextAt=null;p.message=redact(error.message);try{touch(p);}catch{}}}}finally{ticking=false;}}
 function run(){if(timer)return;closed=false;timer=setInterval(()=>void tick(),1000);timer.unref?.();void tick();}
 return {start,stop,stopProject,tick,run,active,snapshot,reserved:(projectId,panelId)=>active().some(p=>p.projectId===projectId&&p.panelIds.slice(p.cursor).includes(panelId)),close(){closed=true;clearInterval(timer);timer=null;}};
}
