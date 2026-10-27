import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {localPrimaryChannel,retargetPrimaryAccess} from '../primary-channel.mjs';
import {readChannel,join} from '../colleague.mjs';
import {publicationConnection} from '../publication-client.mjs';
import {existingCanvasHub} from '../publisher.mjs';
import {createTeamReleaseContext} from '../../comic/lib/team-release-context.mjs';
const proof=path.resolve(import.meta.dirname,'../../verification/team-network-recovery-20261025');fs.mkdirSync(proof,{recursive:true});
const put=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
function fixture(){const root=fs.mkdtempSync(path.join(proof,'fixture-'));put(root,'runtime-data/distribution/master/master.local.json',{publicKey:'SYNTHETIC-PUBLIC',privateKey:'SYNTHETIC-PRIVATE'});return root;}
const channel={format:'comic-team-channel-v1',publicKey:'SYNTHETIC-PUBLIC',masterUrl:'http://192.0.2.44:18914',enrollmentCode:'SYNTHETIC-INVITE',collabHubUrl:'http://192.0.2.44:18897'};
test('主机签名身份匹配才使用本机发布地址，保留端口和对外频道文件',()=>{
 const root=fixture();put(root,'distribution/channel.json',channel);const before=fs.readFileSync(path.join(root,'distribution/channel.json'),'utf8');
 assert.equal(localPrimaryChannel(root,channel).masterUrl,'http://127.0.0.1:18914');assert.equal(readChannel(root).masterUrl,'http://127.0.0.1:18914');assert.equal(publicationConnection(root).channel.masterUrl,'http://127.0.0.1:18914');assert.equal(channel.masterUrl,'http://192.0.2.44:18914');assert.equal(fs.readFileSync(path.join(root,'distribution/channel.json'),'utf8'),before);
 assert.equal(localPrimaryChannel(root,{...channel,publicKey:'OTHER-TEAM'}).masterUrl,channel.masterUrl);
 fs.unlinkSync(path.join(root,'runtime-data/distribution/master/master.local.json'));assert.equal(localPrimaryChannel(root,channel),channel);
});
test('主机网卡旧IP不可达时，实际团队接口从同一台主机取回团队状态',async t=>{
 const root=fixture(),publisher=http.createServer((req,res)=>{assert.equal(req.url,'/api/dashboard');assert.equal(req.headers['x-team-invitation'],'SYNTHETIC-INVITE');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({role:'publisher',online:3,registered:3,members:[],latest:'SYNTHETIC V1'}));});
 await new Promise(r=>publisher.listen(0,'127.0.0.1',r));t.after(()=>{publisher.closeAllConnections();publisher.close();});const c={...channel,masterUrl:'http://192.0.2.44:'+publisher.address().port};put(root,'distribution/channel.json',c);
 let response;const api=createTeamReleaseContext({root:path.join(root,'comic'),dataDir:path.join(root,'runtime-data/comic'),channelFile:path.join(root,'distribution/channel.json'),store:{db:{projects:[],jobs:[]}},json:(_res,status,value)=>{response={status,value};}});
 assert.equal(await api.handle({method:'GET'},{},new URL('http://localhost/api/team-release/team')),true);assert.equal(response.status,200);assert.equal(response.value.role,'publisher');assert.equal(response.value.online,3);
});
test('旧IP的自有协作中控仅在客户端ID和令牌摘要均匹配时从原状态恢复',async()=>{
 const root=fixture(),token='SYNTHETIC-TOKEN',dataRoot=path.join(root,'runtime-data/comic');put(root,'runtime-data/comic/collab/client-config.json',{hubUrl:'http://192.0.2.44:18897',token,clientId:'synthetic-client',enabled:true});put(root,'runtime-data/distribution/master/canvas-hub/hub-state.json',{hubId:'synthetic-hub',clients:[{id:'synthetic-client',tokenHash:createHash('sha256').update(token).digest('hex')}],tasks:[]});
 const request=async url=>{if(url.includes(':18909/'))return Response.json({application:'comic-merged-studio',dataRoot});throw Error('旧IP已不可达');};assert.equal(await existingCanvasHub({root,request}),null);
 put(root,'runtime-data/comic/collab/client-config.json',{hubUrl:'http://192.0.2.44:18897',token:'WRONG-TOKEN',clientId:'synthetic-client',enabled:true});await assert.rejects(()=>existingCanvasHub({root,request}),/未创建第二套中控/);
});
test('旧IP被其他中控使用时禁止把原配对令牌发过去',async()=>{
 const root=fixture(),token='SYNTHETIC-TOKEN',dataRoot=path.join(root,'runtime-data/comic');put(root,'runtime-data/comic/collab/client-config.json',{hubUrl:'http://192.0.2.44:18897',token,clientId:'synthetic-client',enabled:true});put(root,'runtime-data/distribution/master/canvas-hub/hub-state.json',{hubId:'original-hub',clients:[{id:'synthetic-client',tokenHash:createHash('sha256').update(token).digest('hex')}]});
 let pairing=0;await assert.rejects(()=>existingCanvasHub({root,request:async(url,options)=>{assert.equal(options?.headers?.Authorization,undefined);if(url.includes('/api/admin/pairing'))pairing++;return Response.json(url.includes(':18909/')?{application:'comic-merged-studio',dataRoot}:{application:'photocraft-collab-hub',hubId:'another-hub'});}}),/身份已变化/);assert.equal(pairing,0);
});
test('主机接入后使用本机中心和中控，保留原节点及凭据，不重复配对',async t=>{
 const root=fixture(),publisher=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({connection:{hub:'http://192.0.2.22:8790',projectIds:['synthetic-project'],token:'SYNTHETIC-CENTER'},canvas:{hubUrl:'http://192.0.2.22:18897',pairingCode:'SYNTHETIC-PAIR'}}));});await new Promise(r=>publisher.listen(0,'127.0.0.1',r));t.after(()=>{publisher.closeAllConnections();publisher.close();});
 put(root,'distribution/channel.json',{...channel,masterUrl:'http://192.0.2.22:'+publisher.address().port});const existing={hubUrl:'http://127.0.0.1:18897',nodeId:'original-node',token:'ORIGINAL-NODE-TOKEN'};put(root,'runtime-data/team/canvas-node.local.json',existing);put(root,'协作/lib/node-core.mjs','export function pairNode(){throw Error("不应重复配对");}');
 await join(root);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'runtime-data/team/canvas-node.local.json'))),existing);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'runtime-data/team/接入配置.local.json'))).hub,'http://127.0.0.1:8790');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'runtime-data/team/canvas-pair.local.json'))).hubUrl,'http://127.0.0.1:18897');
});
test('网卡地址更新仅迁移原主机的接入URL，远程中心、端口、令牌和设备身份均保留',()=>{
 const state={clients:{a:{hub:'http://192.0.2.44:8790',token:'TOKEN-A',projectIds:['project-a']},b:{hub:'http://remote.example:8790',token:'TOKEN-B'}}},original=structuredClone(state);
 assert.equal(retargetPrimaryAccess(state,'http://192.0.2.44:18914','http://192.0.2.22:18914'),1);assert.equal(state.clients.a.hub,'http://192.0.2.22:8790');assert.equal(state.clients.a.token,original.clients.a.token);assert.deepEqual(state.clients.a.projectIds,original.clients.a.projectIds);assert.deepEqual(state.clients.b,original.clients.b);
});
