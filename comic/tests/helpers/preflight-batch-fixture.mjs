import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createStudio} from '../../server.mjs';
import {writeXlsx} from '../../lib/xlsx.mjs';

export const root=fileURLToPath(new URL('../../',import.meta.url));
export const evidence=path.join(root,'merge-audit','preflight-batch');
export const headers=['格号','画面内容','台词','景别','机位角度'];
const camera=['高位俯拍','侧面平视','极近','斜侧低机位','侧后','前景遮挡','长焦','正视'];
export const sheets=Array.from({length:3},(_,index)=>({name:'第'+(index+1)+'话',rows:[headers,...camera.map((angle,row)=>[
  'S'+String(row+1).padStart(2,'0'),'第'+(index+1)+'话原剧情 '+(row+1)+'：甲查看石台上的印记。',
  '甲：第'+(index+1)+'话原对白 '+(row+1)+'，标点也要保留！',row===2?'中全景':'中景',angle
])]}));
export const bytes=writeXlsx(sheets);
export const input=()=>({name:'批量预检合成三话.xlsx',dataBase64:bytes.toString('base64')});
export const binding=s=>({fileKey:s.fileKey,sheet:s.sheet,expectedVersion:s.version});
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const originalRows=name=>sheets.find(s=>s.name===name).rows.slice(1);
export const verifyOriginalRows=(assert,view)=>{
  const original=originalRows(view.sheet);
  assert.equal(view.rows.length,original.length);
  view.rows.forEach((row,index)=>{
    assert.equal(row.code,original[index][0]);
    assert.equal(row.description,original[index][1]);
    assert.equal(row.dialogue,original[index][2]);
    assert.equal(row.shotSizeRaw,original[index][3]);
    assert.equal(row.cameraAngleRaw,original[index][4]);
  });
};

export async function fixture(t,label,{generate=async()=>[]}={}){
  fs.mkdirSync(evidence,{recursive:true});
  const runDirectory=path.join(evidence,'runs',label+'-'+Date.now()+'-'+process.pid),dataDir=path.join(runDirectory,'data');
  fs.mkdirSync(dataDir,{recursive:true});
  if(!path.resolve(dataDir).startsWith(path.resolve(evidence)+path.sep))throw Error('Test data must stay in the project evidence directory');
  const providerCalls=[],generatorCalls=[];
  const forbidden=async()=>{providerCalls.push('unexpected account/image call');throw Error('Batch preflight tests must not call real accounts or image generators');};
  const studio=createStudio({dataDir,seedReference:false,
    bridge:{status:forbidden,generate:forbidden,close(){}},jimengBridge:{status:forbidden,models:forbidden,generate:forbidden,close(){}},
    storyboardGenerator:{generate:async args=>{generatorCalls.push({outputKind:args.outputKind,prompt:args.prompt,directory:args.directory});return generate(args);},close(){}}});
  await new Promise((resolve,reject)=>{studio.server.once('error',reject);studio.server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+studio.server.address().port;
  t.after(async()=>{const closed=new Promise(resolve=>studio.server.once('close',resolve));studio.close();await closed;});
  const request=async(route,method='GET',body)=>{
    const response=await fetch(origin+route,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  };
  const start=async()=>{const response=await request('/api/storyboards/check','POST',input());if(response.status!==200)throw Error(JSON.stringify(response));return response.data;};
  const job=async(session,id)=>{
    const started=Date.now();let value;
    do{const response=await request('/api/storyboards/check/'+session.id+'/batch/'+id);if(response.status!==200)throw Error(JSON.stringify(response));value=response.data;
      if(!['queued','running'].includes(value.status))return value;
      await new Promise(resolve=>setTimeout(resolve,20));
    }while(Date.now()-started<10000);
    throw Error('Batch mock job did not finish: '+JSON.stringify(value));
  };
  return {studio,origin,dataDir,runDirectory,providerCalls,generatorCalls,request,start,job};
}
