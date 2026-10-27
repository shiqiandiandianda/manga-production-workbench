import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';
import {exportCompleteStrip} from '../public/complete-strip-export.js';
import {exportEpisode} from '../public/render.js';
import {createProject,makePage} from '../public/model.js';
import {ensureEpisodeBoards} from '../public/episode-boards.js';
import {episodeExportLayout} from '../public/episode-board-export.js';
import {createStripExports} from '../lib/strip-export.mjs';
const session='export_11111111-1111-4111-8111-111111111111';
const layout={width:1280,height:9001,pages:[{}]},project={id:'project-fixture',revision:7,title:'合成完整长图'};
function transport({fail='',badSize=false}={}){const calls=[];return {calls,request:async(url,init)=>{const input=JSON.parse(init.body);calls.push({url,input});if(fail&&url.endsWith(fail))return {ok:false,status:409,json:async()=>({error:'合成导出失败'})};let value;if(url.endsWith('/parts'))value={received:input.index+1,nextY:Math.min(layout.height,input.y+4096)};else if(url.endsWith('/complete'))value={width:layout.width,height:layout.height,files:1,url:'/api/strip-exports/'+session+'/download'};else value={id:session,width:layout.width,height:layout.height+(badSize?1:0)};return {ok:true,json:async()=>value};}};}
test('完整长图分块顺序上传，只下载一个真正PNG链接，不返回ZIP',async()=>{
 const api=transport(),saved=[],segments=[];
 const result=await exportCompleteStrip({project,layout,request:api.request,renderSegment:async s=>{segments.push(s);return new Blob(['synthetic PNG']);},downloadURL:(url,name)=>saved.push({url,name})});
 assert.deepEqual(segments.map(s=>[s.y,s.height]),[[0,4096],[4096,4096],[8192,809]]);assert.equal(result.parts,1);assert.equal(result.partsRendered,3);assert.equal(saved.length,1);assert.match(saved[0].name,/\.png$/);assert.match(saved[0].url,/\/download$/);
 assert.deepEqual(api.calls[0].input,{projectId:project.id,expectedRevision:7,episode:null});assert.equal(api.calls.at(-1).url,'/api/strip-exports/'+session+'/complete');
});
test('上传、合并失败或工程尺寸变化时，不下载片段或假完整文件',async()=>{
 for(const config of [{fail:'/parts'},{fail:'/complete'},{badSize:true}]){let saved=0;await assert.rejects(exportCompleteStrip({project,layout,request:transport(config).request,renderSegment:async()=>new Blob(['x']),downloadURL:()=>saved++}));assert.equal(saved,0);}
});
test('必须先保存工程，且拒绝空话或不安全的处理尺寸',async()=>{
 for(const input of [{project:{}},{layout:{...layout,pages:[]}},{segmentHeight:8193}])await assert.rejects(exportCompleteStrip({project,layout,...input,request:()=>{throw Error('不应请求服务');}}));
});
test('真实浏览器渲染接口经HTTP合并为单张PNG，封面正文尾图、话号与跨8192接缝均保留',async t=>{
 const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url),canvas=require(process.env.COMIC_TEST_CANVAS_MODULE||path.join(root,'runtime/node/node_modules/@napi-rs/canvas'));
 const dir=fs.mkdtempSync(path.join(root,'verification','complete-strip-'));
 process.env.COMIC_PYTHON_BIN=path.join(root,'runtime/python/python.exe');
 const p=createProject('单张完整PNG合成验收');p.revision=8;p.pages=[];p.shots=[];
 for(const [episode,color,height]of [[31,'#d02020',10003],[31,'#2050d0',1201],[32,'#20c020',1700]]){const page=makePage([],'stack',1280,height);page.background=color;page.storyboard={episode};p.pages.push(page);}
 ensureEpisodeBoards(p);p.episodeBoards.templates.cover.layers=[];p.episodeBoards.templates.tail.layers=[];p.episodeBoards.templates.cover.background='#dddddd';p.episodeBoards.templates.tail.background='#eeeeee';
 const before=structuredClone(p),view=episodeExportLayout(p,{episode:31}),messages=[],downloaded=[],created=[];
 const body=async(req,max=2*1024*1024)=>{const parts=[];let size=0;for await(const b of req){size+=b.length;if(size>max)throw Error('请求过大');parts.push(b);}return JSON.parse(Buffer.concat(parts).toString()||'{}');};
 const json=(res,status,v)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
 const exports=createStripExports({dataDir:dir,store:{project:id=>{assert.equal(id,p.id);return p;},db:{assets:[]}},body,json});
 const server=http.createServer(async(req,res)=>{try{if(!await exports.handle(req,res,new URL(req.url,'http://localhost').pathname,req.method))json(res,404,{});}catch(e){json(res,e.status||500,{error:e.message});}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const origin='http://127.0.0.1:'+server.address().port;
 const result=await exportEpisode(p,m=>messages.push(m),{episode:31,request:(url,init)=>fetch(origin+url,init),canvasFactory:()=>{const c=canvas.createCanvas(1,1);created.push(c);c.toBlob=callback=>callback(new Blob([c.toBuffer('image/png')],{type:'image/png'}));return c;},downloadURL:async(url,name)=>{const r=await fetch(origin+url);assert.equal(r.headers.get('content-type'),'image/png');const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const file=path.join(dir,name);fs.writeFileSync(file,bytes);downloaded.push(file);}});
 assert.equal(downloaded.length,1);assert.equal(result.files,1);assert.equal(result.width,1280);assert.equal(result.height,view.height);assert.equal(result.partsRendered,Math.ceil(view.height/4096));assert.deepEqual(p,before);assert.ok(created.every(c=>c.height===1));
 const comicParts=view.episodeBoardParts.filter(x=>x.kind==='comic'),samples=[{y:comicParts[0].y+10,rgb:[208,32,32]},{y:comicParts[1].y+10,rgb:[32,80,208]}];
 for(let y=4096;y<view.height;y+=4096){for(const row of [y-1,y]){const part=view.episodeBoardParts.find(x=>row>=x.y&&row<x.endY);if(part.kind==='comic')samples.push({y:row,rgb:part===comicParts[0]?[208,32,32]:[32,80,208]});}}
 const check=spawnSync(process.env.COMIC_PYTHON_BIN,['-B','-c','import json,sys;from PIL import Image;i=Image.open(sys.argv[1]);i.load();s=json.loads(sys.argv[2]);assert i.size==tuple(s["size"]);assert all(i.getpixel((640,v["y"]))==tuple(v["rgb"]) for v in s["samples"]);print(json.dumps({"size":i.size,"pixelsChecked":len(s["samples"])}))',downloaded[0],JSON.stringify({size:[1280,view.height],samples})],{encoding:'utf8',windowsHide:true});assert.equal(check.status,0,check.stderr);fs.writeFileSync(path.join(dir,'验收.json'),JSON.stringify({result,pixelChecks:JSON.parse(check.stdout),output:downloaded[0]},null,2));
 const stale=await fetch(origin+'/api/strip-exports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:p.id,expectedRevision:7,episode:31})});assert.equal(stale.status,409);
});
