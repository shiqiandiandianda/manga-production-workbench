import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createProject,makePage,panel,id} from '../public/model.js';
import {comicDeliveryLayouts,deliveryProtectedRanges} from '../public/comic-delivery-layout.js';
import {chooseDeliveryCuts,validateDeliveryCuts,deliveryCutSafe} from '../public/comic-delivery-cuts.js';
import {prepareComicDelivery,exportComicDeliveryBoard} from '../public/comic-delivery-export.js';
import {deliveryFixture,native,canvasFactory} from './fixtures/comic-delivery.mjs';

test('two large gaps are chosen with three usable portions; unsafe or missing gaps never masquerade as automatic recognition',()=>{
 const gaps=[{start:100,end:700},{start:3200,end:3700},{start:6500,end:7300},{start:8600,end:8620}],p=chooseDeliveryCuts(10000,gaps);
 assert.equal(p.automatic,true);assert.ok(p.cuts[0]>3200&&p.cuts[0]<3700);assert.ok(p.cuts[1]>6500&&p.cuts[1]<7300);assert.equal(validateDeliveryCuts(10000,p.cuts).reduce((n,p)=>n+p.height,0),10000);
 assert.equal(chooseDeliveryCuts(10000,[]).automatic,false);assert.equal(chooseDeliveryCuts(10000,[gaps[1]]).automatic,false);
 for(const cuts of [[0,1000],[1000,1000],[8000,2000],[1000,10000],[.5,6000]])assert.throws(()=>validateDeliveryCuts(10000,cuts));
 assert.equal(deliveryCutSafe(3400,gaps,[{start:3350,end:3450}]),false);
});
test('cover/tail source pages and episode boundaries remain separate; text, tails and discrete frames veto cuts without changing the project',()=>{
 const p=createProject('合成坐标测试');p.pages=[];for(const [role,h,episode]of [['cover',600,41],['',3000,41],['tail',700,41],['',800,42]]){const page=makePage([],null,1280,h);page.storyboard={episode};if(role)page.designEpisodeRole=role;p.pages.push(page);}
 const page=p.pages[1];page.panels.push(panel(null,0,200,1280,500));page.bubbles.push({id:id('bubble'),x:300,y:1000,w:500,h:100,text:'合成文字',visible:true,type:'speech',shape:'oval',tail:{x:600,y:1260},textBox:{x:0,y:0,w:500,h:160}});
 const before=structuredClone(p),plan=comicDeliveryLayouts(p,41),ranges=deliveryProtectedRanges(p,plan.groups.body,native.createCanvas(1,1).getContext('2d'));
 assert.equal(plan.groups.body.height,3000);assert.equal(plan.groups.cover.height,600);assert.equal(plan.groups.tail.height,700);assert.equal(plan.groups.body.episodeBoardParts[0].sourceY,600);
 assert.ok(ranges.some(r=>r.kind==='frame'&&r.start<=200&&r.end>=700));assert.ok(ranges.some(r=>r.kind==='text'&&r.start<=1000&&r.end>=1260));assert.deepEqual(p,before);
});
test('real renderer and HTTP export produce five PNGs and a ZIP, preserve every body row, reject stale revisions and recover a completed request',{timeout:90000},async t=>{
 const f=await deliveryFixture(t),before=structuredClone(f.project),created=[],job=await prepareComicDelivery({project:f.project,assets:f.assets,episode:41,request:f.request,canvasFactory:()=>{const c=canvasFactory();created.push(c);return c;},imageLoader:f.imageLoader});
 assert.equal(job.analysis.automatic,true,JSON.stringify(job.analysis));assert.ok(job.analysis.gaps.some(g=>g.start<6900&&g.end>6900),'dark gaps are supported');assert.ok(job.analysis.cuts.every(y=>deliveryCutSafe(y,job.analysis.gaps,job.analysis.protectedRanges)));
 const route='/api/comic-delivery-exports/'+job.session.id;
 const preview=await job.preview(job.analysis.cuts[0]),previewImage=await native.loadImage(Buffer.from(await preview.blob.arrayBuffer())),previewCanvas=native.createCanvas(previewImage.width,previewImage.height);previewCanvas.getContext('2d').drawImage(previewImage,0,0);assert.deepEqual([...previewCanvas.getContext('2d').getImageData(10,job.analysis.cuts[0]-preview.start,1,1).data].slice(0,3),[255,58,71],'the cut marker is actually drawn at the proposed row');previewCanvas.width=1;previewCanvas.height=1;
 assert.equal((await f.call(route+'/complete',{cuts:[1000,9000]})).status,409);
 assert.equal((await f.call(route+'/complete',{cuts:[1000,1000],reviewed:true})).status,400);
 const result=await job.complete(job.analysis.cuts);assert.equal(result.files.length,5);assert.equal(result.files.filter(f=>f.kind==='body').length,3);assert.equal(result.files.filter(f=>f.kind==='body').reduce((n,f)=>n+f.height,0),10240);
 assert.equal(result.files.find(f=>f.kind==='cover').height,600);assert.equal(result.files.find(f=>f.kind==='tail').height,700);assert.ok(created.every(c=>c.width===1&&c.height===1));assert.deepEqual(f.project,before);
 const response=await f.request(result.url);assert.equal(response.headers.get('content-type'),'application/zip');const zip=Buffer.from(await response.arrayBuffer());assert.equal(zip.readUInt32LE(0),0x04034b50);fs.writeFileSync(path.join(f.dir,'交付结果.zip'),zip);
 const retried=await f.call(route+'/complete',{cuts:job.analysis.cuts});assert.equal(retried.status,200);assert.deepEqual(retried.value.files,result.files);
 const spec={dir:path.join(f.dir,'delivery-exports',job.session.id),files:result.files},python=process.env.COMIC_PYTHON_BIN;
 const code='import hashlib,json,os,sys,zipfile;from PIL import Image;s=json.loads(sys.argv[1]);d=s["dir"];a=hashlib.sha256();b=hashlib.sha256();parts=sorted([n for n in os.listdir(d) if n.startswith("body_") and n.endswith(".png")],key=lambda n:int(n[5:-4]));\nfor n in parts:\n with Image.open(os.path.join(d,n)) as im:\n  for row in range(0,im.height,64):a.update(im.crop((0,row,im.width,min(im.height,row+64))).convert("RGB").tobytes())\nfor f in s["files"]:\n with Image.open(os.path.join(d,f["name"])) as im:\n  assert im.size==(f["width"],f["height"]);im.load()\n  if f["kind"]=="body":\n   for row in range(0,im.height,64):b.update(im.crop((0,row,im.width,min(im.height,row+64))).convert("RGB").tobytes())\n with open(os.path.join(d,f["name"]),"rb") as data:assert hashlib.sha256(data.read()).hexdigest()==f["sha256"]\nassert a.digest()==b.digest(),"body rows changed"\nwith zipfile.ZipFile(os.path.join(d,"delivery.zip")) as z:\n assert len([n for n in z.namelist() if n.endswith(".png")])==5\n assert z.testzip() is None\nprint("pixel hashes, PNG dimensions and ZIP passed")';
 assert.ok(python,'set COMIC_PYTHON_BIN to an isolated Python with Pillow');const check=spawnSync(python,['-B','-c',code,JSON.stringify(spec)],{encoding:'utf8',windowsHide:true});assert.equal(check.status,0,check.stderr);assert.match(check.stdout,/passed/);
 const downloads=[];for(const kind of ['cover','tail'])await exportComicDeliveryBoard({project:f.project,assets:f.assets,episode:41,kind,request:f.request,canvasFactory,imageLoader:f.imageLoader,downloadURL:async(url,name)=>{const r=await f.request(url);assert.equal(r.headers.get('content-type'),'image/png');const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');downloads.push(name);fs.writeFileSync(path.join(f.dir,name),bytes);}});assert.ok(downloads[0].includes('封面'));assert.ok(downloads[1].includes('尾图'));
 f.project.revision++;assert.equal((await f.call(route+'/complete',{cuts:job.analysis.cuts})).status,409);
 fs.writeFileSync(path.join(f.proof,'delivery-verification.json'),JSON.stringify({synthetic:true,realAI:false,output:f.dir,result,independentBoards:downloads,pixelsUnchanged:true,projectUnchanged:true},null,2));
});
