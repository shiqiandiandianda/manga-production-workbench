import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createImageThumbnails} from '../lib/image-thumbnail.mjs';
import {createStudio} from '../server.mjs';
import {uid} from '../lib/store.mjs';

const require=createRequire(import.meta.url),deps=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),native=require(process.env.COMIC_TEST_CANVAS_MODULE||path.join(deps,'@napi-rs/canvas'));
const root=fileURLToPath(new URL('../',import.meta.url)),audit=path.join(root,'merge-audit','thumbnail-fix');
function fixture(){fs.mkdirSync(audit,{recursive:true});return fs.mkdtempSync(path.join(audit,'synthetic-'));}
function png(){const image=native.createCanvas(960,600),context=image.getContext('2d');context.fillStyle='#267b98';context.fillRect(0,0,960,600);context.fillStyle='#dc8b37';context.fillRect(120,80,540,330);return image.toBuffer('image/png');}
function signedMetadataPng(bytes){
 const body=Buffer.from('caBXsynthetic C2PA metadata <svg></svg>'),chunk=Buffer.alloc(body.length+8);chunk.writeUInt32BE(body.length-4);body.copy(chunk,4);
 let crc=0xffffffff;for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}chunk.writeUInt32BE((crc^0xffffffff)>>>0,body.length+4);
 return Buffer.concat([bytes.subarray(0,33),chunk,bytes.subarray(33)]);
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('C2PA SVG metadata can be thumbnailed without changing the source, and corrupt cache is rebuilt',async()=>{
 const directory=fixture(),filePath=path.join(directory,'metadata.png'),source=signedMetadataPng(png());fs.writeFileSync(filePath,source);
 await assert.rejects(native.loadImage(source),/Invalid SVG/);
 const cache=path.join(directory,'thumbnails'),load=createImageThumbnails(cache),asset={filePath},file=await load(asset),image=await native.loadImage(fs.readFileSync(file));
 assert.equal(image.width,448);assert.equal(image.height,280);const sample=native.createCanvas(image.width,image.height),context=sample.getContext('2d');context.drawImage(image,0,0);assert.deepEqual([...context.getImageData(0,0,1,1).data],[38,123,152,255]);assert.equal(hash(fs.readFileSync(filePath)),hash(source));
 fs.writeFileSync(file,fs.readFileSync(file).subarray(0,33));
 const results=await Promise.all(Array.from({length:8},()=>load(asset)));assert.ok(results.every(value=>value===file));assert.equal((await native.loadImage(fs.readFileSync(file))).width,448);
 assert.deepEqual(fs.readdirSync(cache),[path.basename(file)]);assert.equal(hash(fs.readFileSync(filePath)),hash(source));
});

test('concurrent thumbnail readers wait until the entire cached PNG is atomically published',async t=>{
 const directory=fixture(),filePath=path.join(directory,'concurrent.png'),cache=path.join(directory,'thumbnails');fs.writeFileSync(filePath,png());
 const originalWrite=fs.promises.writeFile;let release,started,partial;
 const held=new Promise(resolve=>release=resolve),writing=new Promise(resolve=>started=resolve);
 fs.promises.writeFile=async function(file,bytes,...args){
  if(String(file).startsWith(cache+path.sep)){partial=String(file);await originalWrite.call(this,file,bytes.subarray(0,33),...args);started();await held;}
  return originalWrite.call(this,file,bytes,...args);
 };
 t.after(()=>{release();fs.promises.writeFile=originalWrite;});
 const load=createImageThumbnails(cache),first=load({filePath});await writing;
 assert.ok(partial.endsWith('.tmp'));assert.equal(fs.readdirSync(cache).filter(file=>file.endsWith('.png')).length,0);
 let settled=false;const second=load({filePath}).then(value=>{settled=true;return value;});await new Promise(resolve=>setTimeout(resolve,25));assert.equal(settled,false);
 release();const [a,b]=await Promise.all([first,second]);assert.equal(a,b);assert.equal((await native.loadImage(fs.readFileSync(a))).height,280);assert.deepEqual(fs.readdirSync(cache),[path.basename(a)]);
});

test('binding cards and needs use valid thumbnails, fall back to originals once, and mark truly missing files', {timeout:30000},async t=>{
 const directory=fixture(),source=path.join(directory,'source');fs.mkdirSync(source);const assets=[];
 for(const [name,metadata] of [['训练场',true],['林荫道',false],['缺图',false]]){
  const filePath=path.join(source,name+'_主景.png');if(name!=='缺图')fs.writeFileSync(filePath,metadata?signedMetadataPng(png()):png());
  assets.push({id:uid('asset'),name:name+'_主景.png',filePath,width:960,height:600,mime:'image/png',extension:'.png',libraryRole:'scene'});
 }
 const blocked={close(){},status:async()=>({connected:false,message:'synthetic only'})},studio=createStudio({dataDir:path.join(directory,'data'),bridge:blocked,jimengBridge:blocked});
 studio.store.db.assets.push(...assets);studio.store.save();await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 let browser;t.after(async()=>{await browser?.close();studio.close();await new Promise(resolve=>studio.server.close(resolve));});
 const {chromium}=require(path.join(deps,'playwright'));browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),origin='http://127.0.0.1:'+studio.server.address().port,requests=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 await page.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
 await page.route('**/thumbnail-harness',route=>route.fulfill({contentType:'text/html',body:'<!DOCTYPE html><link rel="stylesheet" href="/asset-directory.css"><dialog id="modal" open style="width:1300px;height:850px"><div id="modal-body"></div><div id="modal-actions"><button class="primary">应用</button></div></dialog>'}));
 const failures=assets.slice(1);for(const asset of failures)await page.route('**/api/assets/'+asset.id+'/thumbnail',route=>route.fulfill({status:500,contentType:'application/json',body:'{"error":"synthetic thumbnail failure"}'}));
 await page.goto(origin+'/thumbnail-harness');
 await page.evaluate(async assets=>{
  const {openAssetBindingUI}=await import('/asset-binding-ui.js');const project={id:'synthetic-project',references:[],shots:assets.map((asset,index)=>({id:'synthetic-shot-'+index,code:String(index+1),location:asset.name.replace('_主景.png',''),participants:[]}))};
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  openAssetBindingUI({api:async()=>{throw Error('unexpected synthetic API mutation');},modal:(_title,html)=>document.querySelector('#modal-body').innerHTML=html,closeModal:()=>{},escape,toast:()=>{},getAssets:()=>assets,getProject:()=>project,onAssets:()=>{},onApplyBindings:()=>{}});
 },assets);
 const loaded=selector=>page.waitForFunction(selector=>{const images=[...document.querySelectorAll(selector)];return images.length&&images.every(image=>image.complete&&image.naturalWidth>1);},selector);
 await loaded('[data-binding-thumbnail="'+assets[0].id+'"]');assert.equal(await page.locator('[data-binding-thumbnail="'+assets[0].id+'"][data-original-fallback]').count(),0);
 await loaded('.binding-needs [data-binding-thumbnail="'+assets[1].id+'"]');
 await page.locator('[data-binding-need="name:scene:林荫道"]').click();await loaded('[data-binding-thumbnail="'+assets[1].id+'"]');await loaded('.binding-large-image');
 assert.equal(await page.locator('[data-binding-thumbnail="'+assets[1].id+'"][data-original-fallback="1"]').count(),2);assert.equal(await page.locator('.binding-asset.unavailable').count(),0);
 await page.screenshot({path:path.join(directory,'fallback-preview.png')});
 await page.locator('[data-binding-need="name:scene:缺图"]').click();await page.waitForFunction(()=>document.querySelector('.binding-asset.unavailable>img')?.getAttribute('src')==='/icons/photo.svg');
 const failed=page.locator('.binding-asset.unavailable>img');assert.equal(await failed.getAttribute('data-original-fallback'),'1');assert.equal(await failed.getAttribute('data-failed'),'1');
 assert.ok(requests.some(url=>url.includes('/assets/'+assets[1].id)));assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({ok:true,synthetic:true,liveDataTouched:false,checks:['C2PA metadata thumbnail loads','left and middle thumbnails fall back to original','missing source gets a bounded icon fallback'],errors},null,2));
});
