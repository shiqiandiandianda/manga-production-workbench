import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';

// Ordinary synthetic coordinator for asset-workspace HTTP tests. Never load the
// distributed channel or the installation's saved machine/signing identity.
export async function teamChannelFixture(t,directory){
 const claims=new Map(),calls=[],invitation='synthetic-local-fixture';
 const server=http.createServer(async(req,res)=>{
  const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try{
   if(req.headers['x-team-invitation']!==invitation)return reply(403,{error:'synthetic invitation required'});
   let raw='';for await(const chunk of req)raw+=chunk;
   const input=JSON.parse(raw||'{}'),action=req.url.split('/').at(-1);calls.push({action,input});
   if(action==='claim'){
    if(!input.asset?.work?.title||!input.asset?.role)return reply(400,{error:'classified work identity required'});
    if(!claims.has(input.requestId))claims.set(input.requestId,{id:randomUUID(),token:'synthetic-claim-token'});
    return reply(200,{claim:claims.get(input.requestId)});
   }
   if(['heartbeat','finish','status'].includes(action))return reply(200,{ok:true,items:[]});
   reply(404,{error:'unexpected synthetic coordinator route'});
  }catch(error){reply(400,{error:error.message});}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const channel=path.join(directory,'synthetic-team-channel.json'),identity=path.join(directory,'synthetic-team-identity');
 fs.mkdirSync(identity,{recursive:true});fs.writeFileSync(channel,JSON.stringify({masterUrl:'http://127.0.0.1:'+server.address().port,enrollmentCode:invitation}));
 return {calls,env:{COMIC_TEAM_CHANNEL_FILE:channel,COMIC_TEAM_IDENTITY_ROOT:identity}};
}
