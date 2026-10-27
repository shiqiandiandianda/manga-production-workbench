import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {paths} from './paths.mjs';
export function teamBridge(){
 const root=path.resolve(paths.root,'..');
 const comicOrigin=()=>{try{const own=JSON.parse(fs.readFileSync(process.env.COMIC_SERVICE_FILE||path.join(root,'comic-service.local.json')));return 'http://127.0.0.1:'+Number(own.port);}catch{return 'http://127.0.0.1:18898';}};
 async function queue(project){const base=comicOrigin(),headers={};const [tasks,nodes]=await Promise.all(['/api/collab/tasks?projectId='+encodeURIComponent(project.externalKey||''),'/api/collab/nodes'].map(async route=>{const r=await fetch(base+route,{headers,signal:AbortSignal.timeout(5000)});const value=await r.json();if(!r.ok)throw Error(value.error||'协作中控未连接');return value;}));return {tasks:(tasks.tasks||[]).filter(t=>t.projectId===project.externalKey),nodes:nodes.nodes||[]};}
 const route={method:'*',pattern:/^\/api\/(health|pair|node(?:\/.*)?|nodes(?:\/.*)?|tasks(?:\/.*)?|blobs(?:\/.*)?|assets(?:\/.*)?|notifications(?:\/.*)?|admin(?:\/.*)?|events)$/,options:{scope:null},async handler(r,res){
  const bytes=['GET','HEAD'].includes(r.method)?null:await r.raw(48*1024*1024);
  await new Promise((resolve,reject)=>{const headers={host:'127.0.0.1:18897',...(r.headers['x-collab-token']?{'x-collab-token':r.headers['x-collab-token']}:{}),...(r.headers.authorization?{authorization:r.headers.authorization}:{}),...(r.headers['x-sha256']?{'x-sha256':r.headers['x-sha256']}:{}),...(bytes?{'content-type':r.headers['content-type']||'application/octet-stream','content-length':bytes.length}:{})};const request=http.request({host:'127.0.0.1',port:18897,path:r.url.pathname+r.url.search,method:r.method,headers},upstream=>{res.writeHead(upstream.statusCode,{'Content-Type':upstream.headers['content-type']||'application/json','Cache-Control':'no-store'});upstream.pipe(res);upstream.on('end',resolve);upstream.on('error',reject);});request.on('error',reject);request.setTimeout(30000,()=>request.destroy(Error('协作中控不可用')));request.end(bytes);});
 }};
 return {queue,routes:['GET','POST','PUT','DELETE'].map(method=>({...route,method}))};
}
