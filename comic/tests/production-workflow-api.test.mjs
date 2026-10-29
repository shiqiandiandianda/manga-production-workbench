import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';
import {writeXlsx} from '../lib/xlsx.mjs';

import {inspectTransparentForegroundFile} from '../lib/codex.mjs';
import {createAssetProductionHandler} from '../lib/asset-production-api.mjs';

// Local invented inputs and a synthetic PNG only. No production project, account,
// external service, workbook supplied by the user, or real image model is used.
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const ownRoot=path.resolve(projectRoot,'.test-temp','production-workflow-api');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const pythonBin=process.env.COMIC_PYTHON_BIN||'python';
function syntheticPng(width,height,transparent=false){
 const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const type=Buffer.from(name),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([size,type,data,checksum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const rows=Buffer.alloc(height*(1+width*4));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=y*(1+width*4)+1+x*4;rows[at]=transparent?35:255;rows[at+1]=transparent?130:255;rows[at+2]=transparent?210:255;rows[at+3]=transparent&&(x<width*.25||x>=width*.75||y<height*.1||y>=height*.9)?0:255;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const uploaded=(name,bytes)=>({name,base64:Buffer.from(bytes).toString('base64')});
test('读取请求体期间工程已修改时，旧版本资产生成请求不能进入队列',async()=>{
 const old=createProject('旧设定',true);old.revision=1;const latest=structuredClone(old);latest.revision=2;
 let current=old,queued=0;const store={db:{assets:[]},project:()=>current};
 const handler=createAssetProductionHandler({store,body:async()=>{current=latest;return{revision:1,assetId:'C001',stageId:'face',provider:'codex'};},json:()=>assert.fail('旧版本不应返回成功'),saveProject:()=>assert.fail('不能写入'),enqueue:()=>{queued++;}});
 await assert.rejects(handler({},null,{method:'POST',pathname:`/api/projects/${old.id}/asset-production/generate`}),e=>e.status===409);
 assert.equal(queued,0);assert.equal(current.revision,2);
});

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitUntil(predicate,label){for(let i=0;i<250;i++){const value=await predicate();if(value)return value;await pause(12);}throw Error('合成测试等待超时：'+label);}
function fakeBridge(provider){const calls=[];let active=0,peak=0;return {
 calls,python:pythonBin,get peak(){return peak;},status:async()=>({connected:true,installed:true,imageFeature:true,supportsTransparentBackground:true,provider}),close(){for(const c of calls)c.finish();},
 async generate(directory,input,referenceFiles,options={}){let release;const wait=new Promise(resolve=>release=resolve),entry={directory,input:structuredClone(input),referenceFiles:[...referenceFiles],options,finish:release};calls.push(entry);active++;peak=Math.max(peak,active);try{const supplied=await wait;return supplied||{bytes:png,imageToolSeen:true,description:'隔离合成输出',timings:{totalMs:1}};}finally{active--;}}
};}
