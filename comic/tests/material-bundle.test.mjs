import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createProject} from '../public/model.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';

import {writeXlsx,writeZip} from '../lib/xlsx.mjs';


import {createStudio} from '../server.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const ownRoot=path.join(root,'design-audit','material-bundle-tests');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const upload=(name,bytes)=>({name,base64:Buffer.from(bytes).toString('base64')});
const novel=Buffer.from('\ufeff第一章 赠宝\r\n甲收下珠子，没有吞服。\r\n第二章 吞珠\r\n甲吞服珠子。\r\n第三章 出门\r\n甲离开山林。\r\n','utf8');
const client=()=>writeXlsx([{name:'分集细纲',rows:[['话数','话名','原著参考章节','本话目标','起','承','转','合'],[1,'赠宝','1','收到珠子','山林遇蛇','获得珠子','作出选择','收藏珠子']]},{name:'角色资产表',rows:[['编号','角色名','身份/功能定位','视觉设定'],['C001','甲','主角','短发少年']]}]);



// The production readZip helper returns UTF-8 text; originals need exact binary inspection.
function zipBytes(buffer){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}assert.ok(end>=0,'material bundle must be a ZIP');
 const count=buffer.readUInt16LE(end+10),files=new Map();let cursor=buffer.readUInt32LE(end+16);
 for(let i=0;i<count;i++){assert.equal(buffer.readUInt32LE(cursor),0x02014b50);const method=buffer.readUInt16LE(cursor+10),size=buffer.readUInt32LE(cursor+20),nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),offset=buffer.readUInt32LE(cursor+42),name=buffer.toString('utf8',cursor+46,cursor+46+nameLength);cursor+=46+nameLength+extra+comment;assert.ok(!files.has(name),'ZIP entry names must be unique');assert.equal(buffer.readUInt32LE(offset),0x04034b50);const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28),compressed=buffer.subarray(start,start+size);assert.ok(method===0||method===8);files.set(name,method===8?zlib.inflateRawSync(compressed):Buffer.from(compressed));}
 return files;
}
function bundleFiles(response){assert.equal(response.status,200);assert.ok(response.data.archive?.downloadUrl,'export=all must return a downloadable archive');assert.ok(response.data.exportId);assert.ok(fs.existsSync(response.archivePath));return zipBytes(fs.readFileSync(response.archivePath));}
function containsOriginal(files,bytes){return [...files].filter(([,content])=>content.equals(bytes)).map(([name])=>name);}
function reportText(files){return [...files].filter(([name])=>/清单|缺失|说明|manifest|readme/iu.test(name)).map(([,bytes])=>bytes.toString('utf8')).join('\n');}
function manifestOf(files){assert.ok(files.has('资料包清单.json'));return JSON.parse(files.get('资料包清单.json'));}





















test('真实 HTTP 下载完整 ZIP，下载编号只能用于所属工程',{timeout:30000},async t=>{
 fs.mkdirSync(ownRoot,{recursive:true});const directory=path.join(ownRoot,randomUUID());fs.mkdirSync(directory,{recursive:true});const calls=[],fake={close(){},status:async()=>{calls.push('account');throw Error('No account checks permitted');},generate:async()=>{calls.push('AI');throw Error('No AI permitted');}},studio=createStudio({dataDir:directory,bridge:fake,jimengBridge:fake,storyboardGenerator:fake,seedReference:false});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+studio.server.address().port,project=createProject('HTTP 原件工程'),other=createProject('另一个 HTTP 工程'),imageId='asset_'+randomUUID(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1cAAAAASUVORK5CYII=','base64'),imagePath=path.join(directory,'合成参考图.png');fs.writeFileSync(imagePath,png);studio.store.db.assets.push({id:imageId,name:'合成参考图',filePath:imagePath,extension:'.png',mime:'image/png',width:1,height:1,bytes:png.length});project.pages[0].panels[0].imageAssetId=imageId;studio.store.db.projects.push(project,other);studio.store.save();
 t.after(async()=>{studio.close();if(studio.server.listening)await new Promise(resolve=>studio.server.close(resolve));assert.deepEqual(calls,[]);const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(ownRoot));fs.rmSync(resolved,{recursive:true,force:true});});
 const saved=await fetch(`${origin}/api/projects/${project.id}/novel-production`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:project.revision,operation:'import',inputs:{novel:upload('完整原著.txt',novel)}})});assert.equal(saved.status,200,await saved.text());
 const generated=await fetch(`${origin}/api/projects/${project.id}/novel-production?export=all`);assert.equal(generated.status,200);const bundle=await generated.json(),download=await fetch(new URL(bundle.archive.downloadUrl,origin));assert.equal(download.status,200);assert.match(download.headers.get('Content-Type'),/application\/zip/);const files=zipBytes(Buffer.from(await download.arrayBuffer()));assert.equal(containsOriginal(files,novel).length,1);assert.equal(containsOriginal(files,png).length,1);assert.ok(files.has('资料包清单.json'));const manifest=manifestOf(files);assert.equal(manifest.project.id,project.id);assert.equal(manifest.images.find(image=>image.assetId===imageId).status,'included');assert.ok(files.has(manifest.images.find(image=>image.assetId===imageId).archivePath));
 const wrongUrl=new URL(bundle.archive.downloadUrl.replace(project.id,other.id),origin),wrong=await fetch(wrongUrl);assert.ok([400,404].includes(wrong.status),'other project cannot download this project export');
});
