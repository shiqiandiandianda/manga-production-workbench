import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {z} from '../vendor/zod/index.js';
import {localStore,imageLimiter,readJson} from './storage.mjs';
import {configManager,configured} from './config.mjs';
import {providerClient} from './provider.mjs';
import {analyzeScript} from './analyze.mjs';
import {batchPipeline} from './pipeline.mjs';
import {codexClient} from './codex.mjs';
import {frameAndLabelShots} from './shot-labels.mjs';
import {stackShots} from './png-composition.mjs';
import {assetSchema} from '../src/lib/asset-schema.ts';
import {repairSource} from '../src/lib/source-repair.ts';
import {assetExport} from '../src/lib/scenes.ts';
const APP_ID='scene-studio-local';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
function reply(res,value,status=200){const bytes=Buffer.from(JSON.stringify(value));res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);}
async function jsonBody(req,max=100*1024*1024){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Object.assign(Error('请使用 JSON 请求。'),{status:415});if(Number(req.headers['content-length'])>max)throw Object.assign(Error('本地项目文件过大，请减少或分卷保存。'),{status:413});let length=0;const buffers=[];for await(const chunk of req){length+=chunk.length;if(length>max)throw Object.assign(Error('请求内容过大。'),{status:413});buffers.push(chunk);}try{return JSON.parse(Buffer.concat(buffers).toString('utf8'));}catch{throw Object.assign(Error('JSON 内容无法读取。'),{status:400});}}
export async function createLocalServer({root,dataDir=path.join(root,'data'),fetcher=fetch,codexAdapter}={}){
  const config=configManager(root,dataDir),store=localStore(dataDir),limiter=imageLimiter(dataDir),model=providerClient(config,fetcher);const codex=codexAdapter||codexClient(dataDir);let analyzing=false;
  await mkdir(path.join(dataDir,'images'),{recursive:true});
  async function generateImage(input){const c=await config.read();let lease,started=false,finished=false;try{
        lease=await limiter.acquire();if(c.imageEngine==='codex'){started=true;const bytes=await codex.image({...input,model:c.codexModel});finished=true;const id=randomUUID()+'.png';await writeFile(path.join(dataDir,'images',id),bytes);return {image:'/api/images/'+id};}let body={model:c.imageModel,prompt:input.prompt,n:1,size:input.size,quality:'medium',output_format:'png'},form=false;
        if(input.references.length){form=true;body=new FormData();for(const [key,value]of Object.entries({model:c.imageModel,prompt:input.prompt,n:'1',size:input.size,quality:'medium',output_format:'png'}))body.set(key,value);for(const [i,ref]of input.references.entries()){const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(ref);if(!m)throw Error('参考图格式不正确。');const bytes=Buffer.from(m[2],'base64');if(bytes.length>5*1024*1024)throw Error('单张参考图超过 5 MB。');body.append('image[]',new Blob([bytes],{type:'image/'+m[1]}),'reference-'+i+'.'+m[1]);}}
        started=true;const data=await model(form?'images/edits':'images/generations',body,form);finished=true;if(!data.data?.[0]?.b64_json)throw Error('模型没有返回 PNG 图片。');const bytes=Buffer.from(data.data[0].b64_json,'base64');if(bytes.length>40*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('模型返回的图片格式无效。');const id=randomUUID()+'.png';await writeFile(path.join(dataDir,'images',id),bytes);return {image:'/api/images/'+id};
      }catch(e){if(e.providerConfirmed)finished=true;throw e;}finally{if(lease&&(!started||finished))await limiter.release(lease);}
  }
  async function generateSceneImage(input){
    if(input.layout!=='shot-reverse')return generateImage(input);
    await input.onProgress?.('forward');const top=await generateImage(input),topBytes=await readFile(path.join(dataDir,'images',path.basename(top.image)));
    await input.onProgress?.('reverse');const bottom=await generateImage({...input,prompt:input.reversePrompt,references:['data:image/png;base64,'+topBytes.toString('base64')]}),bottomBytes=await readFile(path.join(dataDir,'images',path.basename(bottom.image)));
    await input.onProgress?.('composing');let bytes;try{bytes=await frameAndLabelShots(stackShots(topBytes,bottomBytes,input.size),input.sceneName);}catch(error){throw Object.assign(Error(error.message||'图片拼接失败，请重试此版。'),{code:'image_composition_failed',providerConfirmed:true});}const id=randomUUID()+'.png';await writeFile(path.join(dataDir,'images',id),bytes);return {image:'/api/images/'+id};
  }
  const server=http.createServer(async(req,res)=>{try{
    const port=server.address()?.port;const hosts=new Set(['127.0.0.1:'+port,'localhost:'+port,'[::1]:'+port]);
    if(!hosts.has(req.headers.host))return reply(res,{error:'仅允许从本机地址访问。'},403);
    const url=new URL(req.url,'http://'+req.headers.host),pathname=url.pathname;
    if(['POST','PUT','DELETE','PATCH'].includes(req.method)&&!['http://127.0.0.1:'+port,'http://localhost:'+port,'http://[::1]:'+port].includes(req.headers.origin))return reply(res,{error:'请求来源不匹配。请使用本机工作台页面。'},403);
    if(pathname==='/api/pipeline/status'&&req.method==='GET'){const project=await store.load();await pipeline.reconcileImages(project);return reply(res,{...pipeline.state,currentProjectId:project?.id,projectRevisionToken:project?._revision,modelState:codex.state});}
    if(pathname==='/api/pipeline/start'&&req.method==='POST'){const options=z.object({automaticImages:z.boolean().optional(),oneBatch:z.boolean().optional()}).parse(await jsonBody(req,4096));const c=await config.read();if(c.engine==='codex'||options.automaticImages!==false&&c.imageEngine==='codex'){const auth=await codex.status();if(!auth.authenticated)throw Error(auth.message);}return reply(res,await pipeline.start(options));}
    if(pathname==='/api/pipeline/pause'&&req.method==='POST'){const body=await jsonBody(req,4096);return reply(res,await pipeline.pause(body.mode==='analysis'?'analysis':body.mode==='images'?'images':'all'));}
    if(pathname==='/api/pipeline/enqueue'&&req.method==='POST'){const body=z.object({sceneIds:z.array(z.string().min(1)).max(3000).optional(),batchId:z.string().optional(),versions:z.array(z.number().int().min(0).max(1)).min(1).max(2).optional(),regenerate:z.boolean().optional()}).parse(await jsonBody(req,200000));return reply(res,await pipeline.enqueue(body));}
    if(pathname==='/api/pipeline/resume-images'&&req.method==='POST'){const body=z.object({jobIds:z.array(z.string().min(1)).min(1).max(6000).optional()}).parse(await jsonBody(req,400000));return reply(res,await pipeline.resumeImages(body));}
    if(pathname==='/api/scenes/preference'&&req.method==='POST'){const body=z.object({sceneId:z.string().min(1),version:z.number().int().min(0).max(1)}).parse(await jsonBody(req,4096));return reply(res,await pipeline.prefer(body.sceneId,body.version));}
    if(pathname==='/api/analysis-state'&&req.method==='GET')return reply(res,codex.state);
    if(pathname==='/api/status'&&req.method==='GET'){
      const c=await config.read(),info=(c.engine==='codex'||c.imageEngine==='codex')?await codex.status(url.searchParams.get('probe')==='1'):null;
      const result={applicationId:APP_ID,version:'1.5.3',local:true,busy:analyzing||!!pipeline.state.running||!!codex.state.active||(await limiter.count())>0,engine:c.engine,connected:c.engine==='codex'?info?.authenticated:configured(c),imageEngine:c.imageEngine,imageConfigured:c.imageEngine==='codex'?info?.authenticated:configured(c),textModel:c.engine==='codex'?(c.codexModel||'本机 Codex 当前模型'):c.textModel,imageModel:c.imageModel,dataDirectory:dataDir,message:info?.message||'API 配置已读取；请检测连接以确认可达性。',codexAvailable:info?.available};
      if(c.engine!=='codex'&&url.searchParams.get('probe')==='1'){try{const data=await model('models');const ids=new Set(data.data?.map(x=>x.id));Object.assign(result,{reachable:true,textModelAvailable:ids.has(c.textModel),imageModelAvailable:ids.has(c.imageModel),message:'模型接口可达。连接测试不验证生成权限或计费状态。'});}catch(e){Object.assign(result,{reachable:false,message:e.message,code:e.info?.code||e.code});}}return reply(res,result);
    }
    if(pathname==='/api/config'&&req.method==='GET')return reply(res,await config.safe());
    if(pathname==='/api/config'&&req.method==='PUT'){await config.update(await jsonBody(req,4096));return reply(res,await config.safe());}
    if(pathname==='/api/project'&&req.method==='GET'){const loaded=await store.load();if(!loaded)return reply(res,{project:null});const result=repairSource(loaded);if(result.repaired)await store.save(result.project);return reply(res,{project:result.repaired?await store.load():result.project,sourceRepaired:result.repaired,ignoredTocEntries:result.removed});}
    if(pathname==='/api/project'&&req.method==='PUT'){if(pipeline.state.running)return reply(res,{error:'整部批量任务正在后台保存项目，请暂停任务后再编辑。'},409);const p=await jsonBody(req);if(typeof p?.id!=='string'||typeof p?.text!=='string'||p.text.length>5000000)throw Error('本地项目格式不正确。');const previous=await store.load();if(previous?.id===p.id&&previous.sourceParsingVersion===2&&p.sourceParsingVersion!==2)return reply(res,{error:'正文识别已修正，请刷新工作台后继续。'},409);const normalized=repairSource(p).project;assetSchema.parse(assetExport(normalized));const revision=await store.save(normalized,{requireRevision:true});return reply(res,{saved:true,revision});}
    if(pathname==='/api/analyze'&&req.method==='POST'){if(pipeline.state.running)return reply(res,{error:'整部批量任务正在后台拆解，请在当前工作台查看进度。',code:'pipeline_active'},409);const input=await jsonBody(req,2000000);if(analyzing)return reply(res,{error:'本机另一个拆解请求正在处理中，稍后继续。',code:'analysis_busy',retryable:true,retryAfterMs:3000},409);analyzing=true;const controller=new AbortController();const cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);try{return reply(res,await analyzeScript(input,await config.read(),model,codex,controller.signal));}finally{res.removeListener('close',cancel);analyzing=false;}}
    if(pathname==='/api/image'&&req.method==='POST'){
      const input=z.object({prompt:z.string().min(1).max(18000),size:z.enum(['1536x864','2048x1152']),references:z.array(z.string().max(7500000)).max(3)}).parse(await jsonBody(req,25000000));return reply(res,await generateImage(input));
    }
    if(pathname.startsWith('/api/images/')&&req.method==='GET'){const name=pathname.slice('/api/images/'.length);if(!/^[a-f0-9-]{36}\.png$/.test(name))return reply(res,{error:'图片地址不正确。'},404);const bytes=await readFile(path.join(dataDir,'images',name));res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=31536000'});return res.end(bytes);}
    if(pathname.startsWith('/api/'))return reply(res,{error:'本地接口不存在。'},404);
    if(req.method!=='GET'&&req.method!=='HEAD')return reply(res,{error:'请求方法不支持。'},405);
    const dist=path.join(root,'dist');let file=path.resolve(dist,'.'+decodeURIComponent(pathname));if(!file.startsWith(dist+path.sep))file=path.join(dist,'index.html');let bytes;try{bytes=await readFile(file);}catch{if(path.extname(pathname))return reply(res,{error:'文件不存在。'},404);file=path.join(dist,'index.html');bytes=await readFile(file);}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(e){const info=e.info;reply(res,{error:e instanceof z.ZodError?'输入或项目格式不正确。':e.code==='ENOENT'?'本地文件不存在。':e.message,code:info?.code||e.code,retryable:!!info?.retryable,retryAfterMs:info?.retryAfterMs,requestId:info?.requestId},info?.status||e.status||400);}});
  const pipeline=batchPipeline({dataDir,store,analyze:async(input,signal)=>await analyzeScript(input,await config.read(),model,codex,signal),image:generateSceneImage});await pipeline.restore();
  server.requestTimeout=600000;server.headersTimeout=30000;return {server,config,store,limiter,pipeline};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));const profile=await readJson(path.join(root,'.local-profile.json'),{});const port=Number(process.env.SCENE_PORT||profile.port||8765);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('本地端口需为 1024 至 65535。');const dataDir=process.env.SCENE_DATA_DIR||path.join(root,'data');const app=await createLocalServer({root,dataDir});app.server.listen(port,'127.0.0.1',async()=>{await writeFile(path.join(dataDir,'server.pid'),String(process.pid));console.log('场记本地版：http://127.0.0.1:'+port+'/');});app.server.on('error',()=>{console.error('本地服务启动失败，请检查端口或 data 文件夹权限。');process.exit(1);});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(async()=>{await app.store.flush();process.exit(0);}));
}

