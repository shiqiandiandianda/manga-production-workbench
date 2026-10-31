import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createRequire} from 'node:module';
import {createProject,makePage,panel,id} from '../../public/model.js';
import {ensureEpisodeBoards} from '../../public/episode-boards.js';
import {createStripExports} from '../../lib/strip-export.mjs';
import {listenForFetch} from '../helpers/listen-for-fetch.mjs';
const require=createRequire(import.meta.url);
export const native=require(process.env.COMIC_TEST_CANVAS_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
export const canvasFactory=()=>{const c=native.createCanvas(1,1);c.toBlob=cb=>cb(new Blob([c.toBuffer('image/png')],{type:'image/png'}));return c;};
export async function deliveryFixture(t){
 const proof=process.env.QUALITY_EVIDENCE_DIR||path.resolve('../verification/comic-client-delivery-20261031');fs.mkdirSync(proof,{recursive:true});const dir=fs.mkdtempSync(path.join(proof,'synthetic-')),project=createProject('合成甲方交付测试');project.revision=10;
 const assets=[],images=new Map(),height=10240;project.pages=[];
 function asset(kind,h,paint){const canvas=native.createCanvas(1280,h);canvas.naturalWidth=1280;canvas.naturalHeight=h;const ctx=canvas.getContext('2d');paint(ctx);const bytes=canvas.toBuffer('image/png'),a={id:id('asset'),name:'合成_'+kind+'.png',width:1280,height:h,filePath:path.join(dir,kind+'.png')};fs.writeFileSync(a.filePath,bytes);assets.push(a);images.set(a.id,{canvas,bytes});return a;}
 const bodyAsset=asset('正文',height,c=>{c.fillStyle='#f9faf7';c.fillRect(0,0,1280,height);for(const [i,[y,h]]of [[60,3050],[3800,2860],[7440,2700]].entries()){c.fillStyle=['#486b87','#7b6659','#376e64'][i];c.fillRect(40,y,1200,h);for(let x=80;x<1200;x+=80){c.fillStyle=x%160?'#cfb384':'#305166';c.fillRect(x,y+80,35,h-160);}c.fillStyle='#fff';c.font='72px sans-serif';c.fillText('SYNTHETIC PANEL '+(i+1),130,y+190);}c.fillStyle='#152a3a';c.fillRect(0,6660,1280,500);});
 const page=makePage([],null,1280,height);page.name='第41话 正文';page.storyboard={episode:41};const image=panel(null,0,0,1280,height);Object.assign(image,{imageAssetId:bodyAsset.id,border:0,feather:0,productionSegment:'synthetic-screen'});page.panels=[image];project.pages.push(page);
 const other=makePage([],null,1280,600);other.name='第42话正文';other.storyboard={episode:42};other.background='#ff00ff';project.pages.push(other);
 const cover=asset('封面',600,c=>{c.fillStyle='#954431';c.fillRect(0,0,1280,600);c.fillStyle='white';c.font='76px sans-serif';c.fillText('SYNTHETIC COVER',150,330);});
 const tail=asset('尾图',700,c=>{c.fillStyle='#315b91';c.fillRect(0,0,1280,700);c.fillStyle='white';c.font='76px sans-serif';c.fillText('SYNTHETIC END',150,380);});
 ensureEpisodeBoards(project);project.episodeBoards.templates.cover.backgroundAssetId=cover.id;project.episodeBoards.templates.tail.backgroundAssetId=tail.id;
 const store={db:{assets,jobs:[]},project:key=>{if(key!==project.id)throw Error('Unknown synthetic project');return project;},assetPath:key=>assets.find(a=>a.id===key).filePath};
 const body=async(req,max=2*1024*1024)=>{const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw Error('too large');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString()||'{}');},json=(res,status,v)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
 const api=createStripExports({dataDir:dir,store,body,json}),root=path.resolve(import.meta.dirname,'../../public');let html='';const writes=[];
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://synthetic');if(req.method==='POST')writes.push(url.pathname);if(await api.handle(req,res,url.pathname,req.method))return;
  if(url.pathname==='/api/health')return json(res,200,{synthetic:true});if(url.pathname==='/')return res.end(html);if(url.pathname==='/fixture')return json(res,200,{project,assets});
  if(url.pathname.startsWith('/api/assets/')||url.pathname.startsWith('/assets/')){const id=url.pathname.split('/')[url.pathname.startsWith('/assets/')?2:3],record=images.get(id);if(!record)return json(res,404,{});res.writeHead(200,{'Content-Type':'image/png'});return res.end(record.bytes);}
  const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return json(res,404,{});res.writeHead(200,{'Content-Type':/\.[cm]?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream'});res.end(fs.readFileSync(file));
 }catch(error){json(res,error.status||500,{error:error.message});}});const origin=await listenForFetch(server);t.after(()=>{server.closeAllConnections();server.close();for(const record of images.values()){record.canvas.width=1;record.canvas.height=1;}});
 const request=(url,init)=>fetch(origin+url,init),call=async(url,input)=>{const r=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,value:await r.json()};};
 return {project,assets,origin,request,call,dir,proof,writes,bodyAsset,setHTML:value=>{html=value;},imageLoader:async key=>images.get(key).canvas};
}
