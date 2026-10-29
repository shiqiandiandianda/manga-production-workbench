import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function mockMoku(){
 const projectId=randomUUID(),episodes=[],engineers=[],snapshots=new Map(),assets=new Map(),uploads=new Map(),calls=[],subjects=[],json=x=>Response.json(x);let loseSnapshot=false,corrupt=false;
 const request=async(route,options={})=>{const method=options.method||'GET',u=new URL(route,'http://fake'),p=u.pathname,input=typeof options.body==='string'?JSON.parse(options.body):options.body;calls.push({route,method,input});
  assert.ok(!/^\/api\/(uploads|documents|folders)(\/|$)/.test(p),'no legacy write/read routes');if(method==='POST')assert.match(options.headers?.['Idempotency-Key']||'',/^[a-f0-9-]{36}$/i);
  if(p==='/api/project-library/taxonomy')return json({routeVersion:1,items:[{kind:'image',type:'character'}]});if(p==='/api/auth/me')return json({user:{id:randomUUID(),displayName:'合成验收'}});if(p==='/api/projects')return json({items:[{id:projectId,name:'合成作品'}]});if(p==='/api/global-library/taxonomy')return json({items:[]});
  if(p==='/api/projects/'+projectId+'/episodes'){if(method==='GET')return json({items:episodes});const row={id:randomUUID(),projectId,name:'第'+input.number+'话',episodeNumber:input.number};episodes.push(row);return json(row);}
  if(p==='/api/project-library/'+projectId+'/subjects')return json({items:subjects});
  if(p.endsWith('/objects')&&method==='POST'){const row={id:randomUUID(),kind:p.split('/').at(-2),name:input.name};subjects.push(row);return json(row);}
  if(p==='/api/project-library/'+projectId+'/engineerings'){if(method==='GET')return json({items:engineers});const row={id:randomUUID(),projectId,...input,objectVersion:1,panels:[],currentSnapshotId:null};engineers.push(row);return json(row);}
  const panel=/\/engineerings\/([^/]+)\/panels$/.exec(p);if(panel){const e=engineers.find(x=>x.id===panel[1]);if(method==='GET')return json({items:e.panels});const row={id:randomUUID(),...input};e.panels.push(row);return json(row);}
  const snapshot=/\/engineerings\/([^/]+)\/snapshots(?:\/([^/]+))?$/.exec(p);if(snapshot){const e=engineers.find(x=>x.id===snapshot[1]);if(method==='GET')return json(snapshots.get(snapshot[2]));assert.equal(input.objectVersion,e.objectVersion);assert.equal(input.tagDecision,'none');for(const ref of input.references){assert.ok(e.panels.some(p=>p.id===ref.panelId));assert.ok(['reference','image'].includes(ref.role));}const id=randomUUID();snapshots.set(id,{id,engineeringId:e.id,...input});e.currentSnapshotId=id;e.objectVersion++;if(loseSnapshot){loseSnapshot=false;throw Error('response lost after commit');}return json({snapshotId:id,engineeringId:e.id,objectVersion:e.objectVersion});}
  const upload=/^(\/api\/(?:project-library\/[^/]+\/[^/]+\/[^/]+\/[^/]+|global-library\/[^/]+\/[^/]+))\/uploads(?:\/([^/]+)(?:\/(chunks\/(\d+)|complete))?)?$/.exec(p);
  if(upload&&!upload[2]&&method==='POST'&&upload[1].endsWith('/image/scene')){
   assert.ok(Array.isArray(input.sceneIds)&&input.sceneIds.length,'场景图片必须选择本项目的具体场景');
   assert.ok(input.sceneIds.includes(input.objectId),'场景关联必须包含当前场景对象');
   assert.ok(input.sceneIds.every(id=>subjects.some(s=>s.id===id&&s.kind==='scene')),'场景必须属于当前项目');
  }
  if(upload){const root=upload[1];if(!upload[2]){const row={id:randomUUID(),root,...input,chunkSize:16384,chunks:[],state:'uploading'};uploads.set(row.id,row);return json(row);}const row=uploads.get(upload[2]);assert.equal(row.root,root);if(upload[3]?.startsWith('chunks')){const bytes=Buffer.from(input);assert.equal(hash(bytes),options.headers['X-Chunk-SHA256']);row.chunks[Number(upload[4])]={index:Number(upload[4]),sha256:hash(bytes),size:bytes.length,bytes};return json({ok:true});}if(upload[3]==='complete'){const bytes=Buffer.concat(row.chunks.map(c=>c.bytes));assert.equal(hash(bytes),row.expectedSha256);assert.equal(row.tagDecision,row.tags?.length?'provided':'none');const id=randomUUID(),rid=randomUUID(),parts=root.split('/'),global=parts[2]==='global-library',detail={id,projectId:global?null:projectId,episodeId:global||parts[4]==='project'?null:parts[4],assetKind:parts.at(-2),assetType:parts.at(-1),name:row.name,mime:row.mime,tags:row.tags||[],objectVersion:1,objectId:row.objectId,variantName:row.variantName,recommendedRevisionId:rid,revisions:[{id:rid,sha256:corrupt?'0'.repeat(64):hash(bytes),size:String(bytes.length),originalName:row.name,mime:row.mime}],bytes};assets.set(id,detail);Object.assign(row,{state:'completed',assetId:id,revisionId:rid});return json(row);}return json(row);}
  const asset=/\/assets\/([^/]+)$/.exec(p);if(asset)return json(assets.get(asset[1]));
  if(p.includes('/catalog')||p.startsWith('/api/global-library/')&&p.endsWith('/assets'))return json({items:[],total:0});
  throw Error('unexpected '+method+' '+route);
 };
 const remembered=new Map(),reader={supported:async()=>({routeVersion:1}),remember:item=>remembered.set(item.id,item),handle:async route=>{const rid=/\/revisions\/([^/]+)\/download$/.exec(route)?.[1];if(!rid)return null;const asset=[...assets.values()].find(a=>a.recommendedRevisionId===rid);assert.ok(asset);return new Response(asset.bytes);}};
 return {projectId,episodes,engineers,snapshots,assets,uploads,calls,request,reader,loseNextSnapshot(){loseSnapshot=true;},corruptHash(){corrupt=true;}};
}
