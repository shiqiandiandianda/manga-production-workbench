import type {Project} from './scenes.ts';

export function createProjectSaver(request:typeof fetch=fetch){
  let tail:Promise<void>=Promise.resolve();
  const revisions=new Map<string,Map<string|undefined,string>>();
  return (project:Project)=>{
    const body=JSON.stringify(project);
    const next=tail.catch(()=>{}).then(async()=>{
      const snapshot=JSON.parse(body) as Project;const history=revisions.get(snapshot.id);let revision=snapshot._revision;const visited=new Set<string|undefined>();while(history?.has(revision)&&!visited.has(revision)){visited.add(revision);revision=history.get(revision);}snapshot._revision=revision;
      const response=await request('/api/project',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
      if(!response.ok){const result=await response.json();throw Error(result.error||'本地文件保存失败。');}
      const result=await response.json();if(result.revision){const history=revisions.get(snapshot.id)||new Map();history.set(revision,result.revision);revisions.set(snapshot.id,history);project._revision=result.revision;}
    });
    tail=next;return next;
  };
}
