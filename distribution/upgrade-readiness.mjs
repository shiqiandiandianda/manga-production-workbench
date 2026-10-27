export const SERVICE_NAMES=Object.freeze({comic:'漫画编辑器',assets:'资产工作室',center:'本机生成执行器',publisher:'团队中心与版本发布','team-worker':'项目接单器','canvas-node':'画格协作节点','auto-layout':'自动排版后台'});
const text=(value,max=240)=>typeof value==='string'?value.trim().slice(0,max):'';
export function readableServiceMessage(value){let result=text(value,1000);for(const [key,name]of Object.entries(SERVICE_NAMES))result=result.replace(new RegExp('\\b'+key+'\\b','g'),name);return result;}
export function assetUpgradeBlockers(items){return items.filter(item=>!item.finishedAt).map(item=>({
 kind:'asset-generation',owner:text(item.ownerName,80)||'姓名未填写',work:text(item.asset?.work?.title,180)||'作品未填写',target:[text(item.asset?.name,180),text(item.asset?.state,180)].filter(Boolean).join(' · ')||'资产生成',
 status:item.status==='uncertain'?'执行状态待核实':'生成中',message:item.status==='uncertain'?'暂时未收到执行电脑的状态回传，原任务仍保留。':text(item.message)||'正在准备生成',lastSeenAt:Number.isFinite(item.seenAt)?new Date(item.seenAt).toISOString():null,
 reason:'重启团队中心会中断这项任务的协调与状态回传。',nextAction:item.status==='uncertain'?'请执行人核实原任务是否结束；确认后再升级。':'等原任务完成后即可升级，期间可以继续制作。'
}));}
export function serviceBlockers(name,result){
 const label=SERVICE_NAMES[name]||'本机服务',details=Array.isArray(result.details)?result.details:[];
 if(!result.busy&&!result.error)return [];
 const records=details.length?details:[{status:result.error?'状态待核实':'处理中',message:result.error?'尚未完成任务状态核对。':label+'仍有任务未结束。',reason:'升级需要先确认相关任务已结束。',nextAction:result.error?'稍后点击“重新检查任务”。':'任务结束后可升级，期间可以继续制作。'}];
 return records.slice(0,100).map(item=>({service:name,serviceName:label,kind:text(item.kind,60),owner:text(item.owner,80),work:text(item.work,180),target:text(item.target,240),status:text(item.status,80)||'处理中',message:readableServiceMessage(item.message),reason:text(item.reason)||'升级需要等待这项任务结束。',nextAction:text(item.nextAction)||'任务结束后即可升级。',lastSeenAt:text(item.lastSeenAt,50)||null}));
}
export async function inspectManaged(children,request){
 const live=children.filter(item=>item.child.exitCode===null&&!item.child.signalCode),results=await Promise.all(live.map(async item=>{try{return {name:item.name,result:await request(item.child,'distribution-status')};}catch{return {name:item.name,result:{error:'未收到状态确认'}};}})),blockers=results.flatMap(row=>serviceBlockers(row.name,row.result));
 return {allowed:blockers.length===0,checkedAt:new Date().toISOString(),summary:blockers.length?'暂缓升级：还有 '+blockers.length+' 项任务或状态需要确认。':'任务检查通过，可以安全升级。',blockers};
}
export function upgradeBlocked(readiness){
 const lines=readiness.blockers.map(item=>[item.serviceName,item.owner,item.work,item.target,item.status].filter(Boolean).join(' · '));
 const state={checkedAt:new Date().toISOString(),summary:'暂缓升级：仍有任务或状态需要确认。',...readiness};
 return Object.assign(Error('暂缓升级，仍有任务进行中：\n'+lines.join('\n')+'\n任务结束或状态核实后再升级，期间可以继续制作。'),{code:'upgrade_blocked',readiness:state});
}
