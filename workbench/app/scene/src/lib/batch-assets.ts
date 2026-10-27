import type {Batch,Project,Scene,Job} from './scenes.ts';

export type ReusedScene={scene:Scene;firstBatch:number};
export type BatchAssets={id:string;index:number;ready:boolean;scenes:Scene[];added:Scene[];reused:ReusedScene[];pendingImages:number};
// Derive provenance from saved evidence so old projects and exports retain feedback.
export function batchAssets(batches:Batch[],scenes:Scene[]):BatchAssets[]{
  const chapterBatch=new Map(batches.flatMap((batch,index)=>batch.chapters.map(chapter=>[chapter.id,index] as const)));
  const results=batches.map((batch,index)=>({id:batch.id,index,ready:batch.status==='done',scenes:[] as Scene[],added:[] as Scene[],reused:[] as ReusedScene[],pendingImages:0}));
  for(const scene of scenes){
    const appearances=Array.from(new Set(scene.evidence.map(e=>chapterBatch.get(e.chapterId)).filter((i):i is number=>i!==undefined))).sort((a,b)=>a-b);
    const first=appearances[0];if(first===undefined)continue;
    for(const index of appearances){const result=results[index];result.scenes.push(scene);if(index===first){result.added.push(scene);result.pendingImages+=scene.images.filter(image=>!image).length;}else result.reused.push({scene,firstBatch:first});}
  }
  return results;
}
export function imageJobs(project:Project,sceneIds?:string[],batchId?:string,versions:readonly number[]=[0,1],regenerate=false):Job[]{
  if(regenerate&&(!sceneIds||new Set(sceneIds).size!==1||batchId))throw Error('重新生成时请明确选择一个场景。');
  const reports=batchAssets(project.batches,project.scenes);
  const readyIds=new Set(reports.filter(report=>report.ready).flatMap(report=>report.added.map(scene=>scene.id)));
  if(batchId){const report=reports.find(b=>b.id===batchId);if(!report?.ready)throw Error('本批尚未拆解完成。');sceneIds=report.added.map(scene=>scene.id);}
  else if(sceneIds?.some(id=>!project.scenes.some(scene=>scene.id===id)))throw Error('所选场景不存在，请刷新场景列表。');
  const selected=sceneIds?new Set(sceneIds):readyIds;
  const indices=Array.from(new Set(versions));if(!indices.length||indices.some(index=>index!==0&&index!==1))throw Error('请选择 A 或 B 版本。');
  return project.scenes.filter(scene=>selected.has(scene.id)).flatMap(scene=>indices.filter(index=>regenerate||!scene.images[index]).map(index=>({id:scene.id+'-'+index,sceneId:scene.id,index,name:scene.name,status:'pending',batchId,...(regenerate?{regenerate:true}:{})})));
}
export function applySegment(project:Project,batchIndex:number,part:number,scenes:Scene[],mergeScenes:(existing:Scene[],incoming:Scene[],projectId:string)=>Scene[]):Project{
  return {...project,scenes:mergeScenes(project.scenes,scenes,project.id),batches:project.batches.map((batch,index)=>index===batchIndex?{...batch,completedParts:part+1}:batch)};
}
