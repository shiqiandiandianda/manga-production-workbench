import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createMokuClassifiedReader} from '../lib/moku-classified-reader.mjs';
test('fixed project archives retain classification context for verified readback and cold restore',async()=>{
 const projectId=randomUUID(),assetId=randomUUID(),revisionId=randomUUID(),bytes=Buffer.from('Verified backup bytes'),routes=[];
 const reader=createMokuClassifiedReader({request:async route=>{routes.push(route);if(route==='/api/project-library/taxonomy')return new Response(JSON.stringify({routeVersion:1,items:[{kind:'file',type:'project_archive'}]}));assert.equal(route,'/api/project-library/'+projectId+'/project/file/project_archive/assets/'+assetId+'/revisions/'+revisionId+'/download');return new Response(bytes);}});
 reader.remember({id:assetId,projectId,scopeId:'project',assetKind:'file',assetType:'project_archive',recommendedRevisionId:revisionId});
 const response=await reader.handle('/api/revisions/'+revisionId+'/download');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(routes.length,2);
});
