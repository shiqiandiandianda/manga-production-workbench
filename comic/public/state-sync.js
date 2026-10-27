// 增量读取 /api/state：带上上次拿到的内容戳，没变化的工程、素材和任务沿用本地已有数据。
// 返回的数据格式与完整接口相同（projects / assets / jobs 都是完整列表），调用方无需改动。
export function createStateSync(api){
 let cache=null;
 function remember(data){
  cache={projects:new Map(data.projects.map(p=>[p.id,p])),assets:data.assets,jobs:new Map(data.jobs.map(j=>[j.id,j])),jobOrder:data.jobs.map(j=>j.id),stamps:data.stamps||null};
  if(!cache.stamps)cache=null;
  return data;
 }
 async function full(){return remember(await api('/api/state'));}
 async function fetchState(){
  if(!cache)return full();
  const {s,p,a,j,jm}=cache.stamps,data=await api('/api/state?known='+encodeURIComponent(JSON.stringify({s,p,a,j,jm})));
  if(!data.incremental)return remember(data);
  const projects=data.projects.map(item=>item.unchanged?cache.projects.get(item.id):item);
  if(projects.some(item=>!item)||(data.assetsUnchanged&&!cache.assets))return full();
  const jobs=new Map(cache.jobs);for(const job of data.jobs)jobs.set(job.id,job);
  const order=data.jobIds||[...cache.jobOrder,...data.jobs.map(job=>job.id).filter(id=>!cache.jobs.has(id))];
  if(order.some(id=>!jobs.has(id)))return full();
  const {incremental,assetsUnchanged,jobIds,...rest}=data;
  return remember({...rest,projects,assets:data.assetsUnchanged?cache.assets:data.assets,jobs:order.map(id=>jobs.get(id))});
 }
 return {fetch:fetchState,reset(){cache=null;}};
}
