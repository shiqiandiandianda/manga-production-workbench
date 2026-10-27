import {check,id} from './project-center.mjs';
export function recordSnapshot(core,projectId,input){
  const project=core.get('project',projectId);
  check(Array.isArray(input.panels)&&input.panels.length<=10000,'漫画快照格式无效');
  const files=input.files||{};for(const f of Object.values(files))core.get('file',f,projectId);
  for(const edge of input.derivatives||[]){core.get('file',edge.sourceId,projectId);core.get('file',edge.targetId,projectId);core.depend(projectId,edge.sourceId,edge.targetId);}
  for(const source of input.assetSources||[]){core.get('file',source.fileId,projectId);const link=core.list('formalLink',projectId).find(l=>l.formalVersionId===source.formalVersionId);if(link){const task=core.get('task',link.coreTaskId);if(task.versionId)core.depend(projectId,task.versionId,source.fileId);}}
  const saved=[];
  for(const panel of input.panels){
    check(typeof panel.externalId==='string'&&panel.externalId.length<300,'画格编号无效');
    const old=core.list('artifact',projectId).find(a=>a.tool==='comic'&&a.externalId===panel.externalId);
    const record=core.put('artifact',{...old,id:old?.id||id('artifact'),projectId,tool:'comic',externalId:panel.externalId,type:'panel',episode:panel.episode,responsible:input.person||old?.responsible||'',title:panel.title,locked:!!panel.locked,revision:input.revision,standardsId:input.standardsId||project.standardsId,sourceAssetIds:panel.assetIds||[],stale:!!old?.stale});
    if(record.standardsId)core.depend(projectId,record.standardsId,record.id);
    for(const assetId of panel.assetIds||[])if(files[assetId])core.depend(projectId,files[assetId],record.id);
    for(const versionId of panel.centerVersionIds||[]){const link=core.list('formalLink',projectId).find(l=>l.formalVersionId===versionId);if(link){const task=core.get('task',link.coreTaskId);if(task.versionId)core.depend(projectId,task.versionId,record.id);}}
    saved.push(record.id);
  }
  if(input.sourceFileId)for(const target of saved)core.depend(projectId,input.sourceFileId,target);
  core.event(projectId,'comic.snapshot',{revision:input.revision,panels:saved.length});return {ok:true,artifactIds:saved};
}
