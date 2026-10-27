const normalize=value=>String(value||'').normalize('NFKC').trim();
const time=r=>Date.parse(r.createdAt||r.updatedAt||'')||0;
const newest=(a,b)=>time(b)-time(a)||String(a.id).localeCompare(String(b.id));
const image=r=>!!(r.imageUrl||r.slots?.['scene-front']?.url||r.slots?.face?.url||r.slots?.prop?.url);
const ongoing=r=>['queued','running','claimed','recoverable','awaiting_confirmation','delegated'].includes(r.status)||Object.values(r.phases||{}).some(p=>['queued','running','recoverable','awaiting_confirmation','delegated'].includes(p.status));
/** Group versions for display only. Original records, identifiers and files stay intact. */
export function productionRecordGroups(records=[]){
 const byId=new Map(records.filter(r=>r?.id&&!r.deletedAt).map(r=>[r.id,r]));
 function original(record){let current=record;const visited=new Set();while(current.revisionOf?.recordId&&byId.has(current.revisionOf.recordId)){if(visited.has(current.id))return [...visited].sort().map(id=>byId.get(id))[0]||record;visited.add(current.id);current=byId.get(current.revisionOf.recordId);}return current;}
 function identity(record){const name=normalize(record.name);if(!name)return 'record:'+record.id;const work=record.source?.work?.projectId||record.source?.projectId||record.source?.work?.mokuProjectId||record.projectId;if(!work)return 'record:'+(record.revisionOf?.recordId||record.id);const meta=record.type==='scene'?record.sceneMeta||{}:{};return JSON.stringify([work,record.type||'',name,normalize(record.outfit),normalize(meta.camera),normalize(meta.time),normalize(meta.weather)]);}
 const groups=new Map();for(const r of byId.values()){const root=original(r),id=identity(root),group=groups.get(id)||{id,versions:[]};group.versions.push(r);groups.set(id,group);}
 return [...groups.values()].map(g=>{
  g.versions.sort(newest);const latest=g.versions[0],originals=g.versions.filter(r=>!r.revisionOf).sort((a,b)=>-newest(a,b)),first=originals[0]||g.versions.at(-1);
  const display=g.versions.find(r=>['completed','legacy'].includes(r.status)&&image(r))||g.versions.find(r=>!ongoing(r)&&!['failed','cancelled'].includes(r.status)&&image(r))||[...originals].reverse().find(image)||[...g.versions].reverse().find(image)||latest;
  return {...g,latest,display,original:first,pending:ongoing(latest),hasFailedLatest:latest.status==='failed'||latest.status==='cancelled'};
 }).sort((a,b)=>newest(a.latest,b.latest));
}
